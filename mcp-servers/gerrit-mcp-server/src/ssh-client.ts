/**
 * Gerrit SSH 客户端封装。
 *
 * 背景：本环境的 nginx 在 Gerrit 前置了 Basic Auth，与 Gerrit 自带的 HTTP 凭据
 * 校验形成双层认证。HTTP 协议规定单次请求只能携带一个 Authorization 头，因此
 * 任何走 REST `/a/...` 的客户端都会 401。SSH 通道（端口 29418）不经 nginx，
 * 直接连 Gerrit 内置 SSH server，是当前唯一可用的写入通道。
 *
 * 本模块封装 `ssh -p 29418 user@host gerrit <subcommand>` 的子进程调用，并提供：
 *   - sshGerritJson(args, stdin?)            执行返回 JSON-Lines 的查询命令并解析
 *   - sshGerritPlain(args, stdin?)           执行返回纯文本（或无输出）的写命令
 *   - sshGitLsRemote(project)                通过 git ls-remote 获取项目分支（list_branches 用）
 *   - GerritSshConfig                        SSH 通道配置类型
 *   - requireSshConfig()                     校验必需 SSH 环境变量
 *
 * 关键设计：
 *   - stdin 用 Buffer 注入（Node child_process spawn 直接写字节），避免任何 shell
 *     转义层；UTF-8 中文 / emoji 在 change 114401 上实证保留完整
 *   - 子进程超时使用 SIGTERM → 1s 后 SIGKILL 双阶段（与 push.ts 的 spawnGit 一致）
 *   - stdout / stderr 累积上限 256KB（query 一次拉 1000 条 change 的极端场景）
 *   - SSH key 认证失败、host key 校验失败、网络错误统一映射到 StructuredError
 *
 * 不依赖 http-client.ts；http-client.ts 现已是 REST 通道的死代码，等 IT 修
 * nginx 后可重新启用。
 */

import { spawn } from "node:child_process";
import { StructuredError } from "./errors.js";
import { parseTimeoutMs, DEFAULT_GERRIT_TIMEOUT_MS } from "./auth.js";

// =============================================================================
// 配置
// =============================================================================

/** SSH 端口默认值（Gerrit 标准端口）。 */
const DEFAULT_GERRIT_SSH_PORT = "29418";

/** 子进程标准流累积上限（字符）—— 单次 query 1000 条 change 约 200KB，留点余量。 */
const MAX_STREAM_OUTPUT_CHARS = 256 * 1024;

/** SIGTERM → SIGKILL 等待间隔（毫秒）。 */
const FORCE_KILL_GRACE_MS = 1000;

/** SSH 相关环境变量解析结果。 */
export interface GerritSshConfig {
  user: string;
  host: string;
  port: string;
  /** 子进程超时（毫秒），默认 30000，由 GERRIT_TIMEOUT_MS 控制。 */
  timeoutMs: number;
}

/**
 * 一次性读取并校验 Gerrit SSH 配置。
 *
 * 环境变量优先级（取首个非空值）：
 *   - user: GERRIT_SSH_USER > GERRIT_USERNAME
 *   - host: GERRIT_SSH_HOST > 从 GERRIT_URL 提取 hostname
 *   - port: GERRIT_SSH_PORT，默认 29418
 *   - timeoutMs: GERRIT_TIMEOUT_MS，默认 30000
 *
 * @throws StructuredError("config_error") user / host 任一无法确定时
 */
export function requireSshConfig(): GerritSshConfig {
  const sshUser = (process.env.GERRIT_SSH_USER ?? "").trim();
  const fallbackUser = (process.env.GERRIT_USERNAME ?? "").trim();
  const user = sshUser.length > 0 ? sshUser : fallbackUser;

  const sshHost = (process.env.GERRIT_SSH_HOST ?? "").trim();
  const fallbackHost = extractHostFromUrl(process.env.GERRIT_URL);
  const host = sshHost.length > 0 ? sshHost : fallbackHost;

  const port = (process.env.GERRIT_SSH_PORT ?? "").trim() || DEFAULT_GERRIT_SSH_PORT;
  const timeoutMs = parseTimeoutMs(process.env.GERRIT_TIMEOUT_MS);

  const missing: string[] = [];
  if (user.length === 0) missing.push("GERRIT_SSH_USER (or GERRIT_USERNAME)");
  if (host.length === 0) missing.push("GERRIT_SSH_HOST (or GERRIT_URL hostname)");

  if (missing.length > 0) {
    throw new StructuredError(
      "config_error",
      `缺少必需的 Gerrit SSH 环境变量: ${missing.join(", ")}。请在 mcp.json 的 env 字段配置 GERRIT_SSH_USER 与 GERRIT_SSH_HOST（或同时配置 GERRIT_USERNAME 与 GERRIT_URL）。`,
      undefined,
      { missing_env_vars: missing },
    );
  }

  return { user, host, port, timeoutMs };
}

/** 从 GERRIT_URL 中安全提取 hostname；任意失败返回空字符串。 */
function extractHostFromUrl(rawUrl: string | undefined): string {
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) return "";
  try {
    const u = new URL(rawUrl.trim());
    return u.hostname;
  } catch {
    return "";
  }
}

// =============================================================================
// 子进程执行核心
// =============================================================================

export interface SshExecResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
}

/**
 * 执行任意命令（ssh / git）并接收可选 stdin buffer。
 *
 * 行为：
 *   - 累积 stdout/stderr 到 Buffer（保留二进制完整性，UTF-8 在调用方解码）
 *   - 任一流超过 256KB 时停止累积（不抛异常，由调用方判断是否截断标记）
 *   - 超时先 SIGTERM 再 SIGKILL，最终 reject StructuredError("request_timeout")
 *   - 子进程无法启动（如 ssh 二进制缺失）通过 reject(原始 Error) 暴露给上层
 *   - close 事件携带 exit code 即返回（ssh 异常退出不抛异常，由调用方根据 exitCode 决定）
 */
export function execChild(
  command: string,
  args: string[],
  stdin: Buffer | undefined,
  timeoutMs: number,
): Promise<SshExecResult> {
  return new Promise<SshExecResult>((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutCapped = false;
    let stderrCapped = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const appendCapped = (
      chunks: Buffer[],
      currentBytes: number,
      capped: boolean,
      next: Buffer,
    ): { newBytes: number; nowCapped: boolean } => {
      if (capped) return { newBytes: currentBytes, nowCapped: true };
      const remaining = MAX_STREAM_OUTPUT_CHARS - currentBytes;
      if (remaining <= 0) return { newBytes: currentBytes, nowCapped: true };
      if (next.length > remaining) {
        chunks.push(next.slice(0, remaining));
        return { newBytes: currentBytes + remaining, nowCapped: true };
      }
      chunks.push(next);
      return { newBytes: currentBytes + next.length, nowCapped: false };
    };

    proc.stdout?.on("data", (chunk: Buffer) => {
      const result = appendCapped(stdoutChunks, stdoutBytes, stdoutCapped, chunk);
      stdoutBytes = result.newBytes;
      stdoutCapped = result.nowCapped;
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      const result = appendCapped(stderrChunks, stderrBytes, stderrCapped, chunk);
      stderrBytes = result.newBytes;
      stderrCapped = result.nowCapped;
    });

    if (stdin && stdin.length > 0) {
      proc.stdin?.end(stdin);
    } else {
      proc.stdin?.end();
    }

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        /* 已退出 */
      }
      killTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* 已退出 */
        }
      }, FORCE_KILL_GRACE_MS);
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
        killTimer = undefined;
      }
    };

    proc.on("error", (err) => {
      cleanup();
      reject(err);
    });

    proc.on("close", (code) => {
      cleanup();
      if (timedOut) {
        reject(
          new StructuredError(
            "request_timeout",
            `命令执行超时 (${timeoutMs}ms): ${command} ${args.join(" ")}`,
            undefined,
            { command, args, timeout_ms: timeoutMs },
          ),
        );
        return;
      }
      resolve({
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        exitCode: code ?? -1,
      });
    });
  });
}

// =============================================================================
// SSH stderr → StructuredError 映射
// =============================================================================

/**
 * 将 SSH 子进程的退出码 + stderr 映射为 StructuredError。
 *
 * 不调用方直接抛出，而是返回 StructuredError 实例供调用方控制 throw 时机。
 *
 * 启发式（基于 ssh / gerrit ssh server 的常见 stderr）：
 *   - "Permission denied" / "publickey" / "password" → permission_denied
 *   - "Connection refused" / "Network is unreachable" / "could not resolve" → network_error
 *   - "Connection timed out" / "Operation timed out" → request_timeout
 *   - "Host key verification failed" → permission_denied（凭据问题大类）
 *   - "fatal:" 开头的 Gerrit 错误（如 `fatal: change not found`）→ not_found
 *   - 其他非零退出 → internal_error
 */
export function mapSshError(exitCode: number, stderr: string): StructuredError {
  const lower = stderr.toLowerCase();

  if (
    lower.includes("permission denied") ||
    lower.includes("publickey") ||
    lower.includes("host key verification failed")
  ) {
    return new StructuredError(
      "permission_denied",
      `SSH 认证失败 (exit ${exitCode}): ${truncate(stderr)}。请确认 SSH 公钥已上传到 Gerrit Settings → SSH Keys。`,
      undefined,
      { exit_code: exitCode, stderr_preview: truncate(stderr) },
    );
  }

  if (
    lower.includes("connection refused") ||
    lower.includes("network is unreachable") ||
    lower.includes("could not resolve") ||
    lower.includes("name or service not known") ||
    lower.includes("no route to host")
  ) {
    return new StructuredError(
      "network_error",
      `SSH 网络错误 (exit ${exitCode}): ${truncate(stderr)}`,
      undefined,
      { exit_code: exitCode, stderr_preview: truncate(stderr) },
    );
  }

  if (
    lower.includes("connection timed out") ||
    lower.includes("operation timed out")
  ) {
    return new StructuredError(
      "request_timeout",
      `SSH 连接超时 (exit ${exitCode}): ${truncate(stderr)}`,
      undefined,
      { exit_code: exitCode, stderr_preview: truncate(stderr) },
    );
  }

  // Gerrit 端 fatal 通常表示业务级错误（change 不存在、project 不存在等）
  if (lower.includes("fatal:") || lower.includes("not found")) {
    return new StructuredError(
      "not_found",
      `Gerrit SSH 命令报告资源不存在 (exit ${exitCode}): ${truncate(stderr)}`,
      undefined,
      { exit_code: exitCode, stderr_preview: truncate(stderr) },
    );
  }

  return new StructuredError(
    "internal_error",
    `SSH 命令失败 (exit ${exitCode}): ${truncate(stderr)}`,
    undefined,
    { exit_code: exitCode, stderr_preview: truncate(stderr) },
  );
}

function truncate(s: string, max: number = 500): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...[truncated]`;
}

// =============================================================================
// 高层入口：sshGerrit*（包含 stdin 注入与错误映射）
// =============================================================================

/** 构造 ssh 命令的固定参数前缀。 */
function buildSshArgs(cfg: GerritSshConfig, gerritArgs: string[]): string[] {
  return [
    "-p",
    cfg.port,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=10",
    `${cfg.user}@${cfg.host}`,
    ...gerritArgs,
  ];
}

/**
 * 执行返回 JSON-Lines 文本的 Gerrit SSH 命令（如 gerrit query --format=JSON）。
 *
 * 解析规则：
 *   - 按行切分
 *   - 跳过空行
 *   - 每行 JSON.parse；解析失败时整体抛 StructuredError("internal_error")
 *   - 末尾的 `{"type":"stats", ...}` 行作为统计信息单独返回，不混入业务数组
 *
 * @returns { rows: T[]; stats: object | null }
 * @throws StructuredError 子进程失败 / 超时 / JSON 解析失败
 */
export async function sshGerritJson<T>(
  gerritArgs: string[],
  stdin?: Buffer,
): Promise<{ rows: T[]; stats: Record<string, unknown> | null }> {
  const cfg = requireSshConfig();
  const result = await execChild(
    "ssh",
    buildSshArgs(cfg, gerritArgs),
    stdin,
    cfg.timeoutMs,
  );

  if (result.exitCode !== 0) {
    throw mapSshError(result.exitCode, result.stderr.toString("utf8"));
  }

  const text = result.stdout.toString("utf8");
  const rows: T[] = [];
  let stats: Record<string, unknown> | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new StructuredError(
        "internal_error",
        `Gerrit SSH 输出 JSON 解析失败: ${(err as Error).message}`,
        undefined,
        { line_preview: truncate(line, 200) },
      );
    }
    if (parsed && typeof parsed === "object" && (parsed as { type?: string }).type === "stats") {
      stats = parsed as Record<string, unknown>;
    } else {
      rows.push(parsed as T);
    }
  }

  return { rows, stats };
}

/**
 * 执行不需要 JSON 解析的 Gerrit SSH 写命令（如 gerrit review、gerrit set-reviewers）。
 *
 * 成功时通常无 stdout 输出（gerrit ssh 子命令成功后静默退出，exit 0）。
 *
 * @param gerritArgs ssh 参数（如 `["gerrit", "review", "--json", "114401,1"]`）
 * @param stdin      可选 stdin（用于 `gerrit review --json` 注入 ReviewInput JSON）
 *
 * @returns { stdout, stderr } 都是 UTF-8 字符串
 * @throws StructuredError 子进程失败 / 超时
 */
export async function sshGerritPlain(
  gerritArgs: string[],
  stdin?: Buffer,
): Promise<{ stdout: string; stderr: string }> {
  const cfg = requireSshConfig();
  const result = await execChild(
    "ssh",
    buildSshArgs(cfg, gerritArgs),
    stdin,
    cfg.timeoutMs,
  );

  if (result.exitCode !== 0) {
    throw mapSshError(result.exitCode, result.stderr.toString("utf8"));
  }

  return {
    stdout: result.stdout.toString("utf8"),
    stderr: result.stderr.toString("utf8"),
  };
}

/**
 * 通过 `git ls-remote --heads ssh://...` 列出指定 project 的所有分支。
 *
 * Gerrit SSH 没有专用的 `gerrit ls-branches`，但 git ls-remote 走同一 SSH 通道。
 *
 * @param project Gerrit project 名（不要 URL 编码——git URL 在传给 git 时由 git 处理）
 * @returns 形如 `[{ ref: "refs/heads/master", revision: "abc123..." }, ...]`
 * @throws StructuredError 子进程失败 / 超时
 */
export async function sshGitLsRemote(
  project: string,
): Promise<Array<{ ref: string; revision: string }>> {
  const cfg = requireSshConfig();
  const url = `ssh://${cfg.user}@${cfg.host}:${cfg.port}/${project}`;
  const result = await execChild(
    "git",
    ["ls-remote", "--heads", url],
    undefined,
    cfg.timeoutMs,
  );

  if (result.exitCode !== 0) {
    const stderrText = result.stderr.toString("utf8");
    throw mapSshError(result.exitCode, stderrText);
  }

  const text = result.stdout.toString("utf8");
  const branches: Array<{ ref: string; revision: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    // 格式：<sha>\t<ref>
    const tabIdx = trimmed.indexOf("\t");
    if (tabIdx <= 0) continue;
    const revision = trimmed.slice(0, tabIdx);
    const ref = trimmed.slice(tabIdx + 1);
    if (ref.startsWith("refs/heads/")) {
      branches.push({ ref, revision });
    }
  }
  return branches;
}

// =============================================================================
// 默认超时常量
// =============================================================================

export { DEFAULT_GERRIT_TIMEOUT_MS };
