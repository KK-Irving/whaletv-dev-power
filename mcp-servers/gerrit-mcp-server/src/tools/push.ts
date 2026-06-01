/**
 * push_to_gerrit 工具：将本地 commit 推送到 Gerrit 的 refs/for/<target_branch>。
 *
 * 关键设计：
 *   - Push 必须走 git 协议（不能用 REST 替代），因此使用 child_process.spawn 调用本地 git
 *   - MP 分支（匹配 *_mp 后缀，不区分大小写）硬拒绝：Property 10 要求绝不调用 spawn
 *   - Push options 按 Property 9 构造：`%r=<email1>,r=<email2>,wip,topic=<topic>` 形式
 *   - stderr 在返回前做 sanitize，避免 Basic Auth 凭据泄露到错误响应
 *   - 子进程 120 秒超时，超时后先 SIGTERM 再 1 秒后 SIGKILL
 *   - stdout/stderr 累积上限 64KB，防止极端情况下的内存炸
 *
 * 依赖：
 *   - errors.ts：StructuredError（用于 detectGerritRemote 在两个 remote 都不存在时抛出）
 *   - types.ts：PushResult
 *   - 不依赖 http-client.ts（推送不走 REST）
 *
 * 注意：
 *   - 本文件不在 src/index.ts 注册工具；统一注册由 5.9 任务在 index.ts 内完成
 *   - 导出的所有顶层符号（MP_BRANCH_PATTERN / parseGerritChangeUrl / sanitizeStderr /
 *     buildPushOptionSuffix / spawnGit / detectGerritRemote / pushToGerrit）供 PBT
 *     测试与 index.ts 调用方使用
 */

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import * as path from "node:path";

import { StructuredError } from "../errors.js";
import type { PushResult } from "../types.js";

// =============================================================================
// 常量
// =============================================================================

/**
 * MP 分支匹配正则：以 `_mp` 结尾，不区分大小写。
 *
 * Property 10 对称性约束：`MP_BRANCH_PATTERN.test(t)` 必须等价于
 * `t.toLowerCase().endsWith("_mp")`。本正则即满足该等价关系，且与 Steering File
 * `commit-message-workflow.md` 中的 Branch_Detector 使用相同正则避免行为分歧。
 */
export const MP_BRANCH_PATTERN = /_mp$/i;

/** spawnGit 默认超时（毫秒）：push 操作 120 秒，足够多数 Gerrit 推送完成。 */
export const DEFAULT_GIT_PUSH_TIMEOUT_MS = 120_000;

/** detectGerritRemote 子进程的超时（毫秒）：列出 remotes 应当极快。 */
const REMOTE_LIST_TIMEOUT_MS = 30_000;

/** 单个标准流（stdout/stderr）累积上限（字节，按 UTF-16 字符近似）。 */
const MAX_STREAM_OUTPUT_CHARS = 64 * 1024;

/** SIGTERM 之后等待多久再发 SIGKILL（毫秒）。 */
const FORCE_KILL_GRACE_MS = 1000;

// =============================================================================
// 公共纯函数（与 spawn 解耦，便于属性测试）
// =============================================================================

/**
 * 从 Gerrit push 子进程的 stderr 中提取 Change Web URL。
 *
 * Property 11 契约：
 *   - 若 stderr 包含至少一个匹配 `https?://[^/\s]+/c/[^/\s]+/\+/\d+` 模式的子串，
 *     返回第一个匹配
 *   - 否则返回 null
 *   - 返回值若非 null，必须能被 `new URL()` 构造（本正则保证 URL 完整性）
 *
 * Gerrit push 输出形如：
 *   remote: New Changes:
 *   remote:   https://gerrit.example.com/c/project/+/12345 [WIP] subject
 */
export function parseGerritChangeUrl(stderr: string): string | null {
  const match = stderr.match(/https?:\/\/[^\/\s]+\/c\/[^\/\s]+\/\+\/\d+/);
  return match ? match[0] : null;
}

/**
 * 剥离字符串中可能嵌入的 HTTP Basic Auth 凭据，将密码部分替换为 `***`。
 *
 * 用于在返回 stderr 给调用方前清理潜在敏感信息（例如 git 错误信息中可能回显
 * `https://user:token@host/...` 形式的远程地址）。
 *
 * 正则：`(https?://[^@\s:]+):[^@\s]+@` → `$1:***@`
 *   - 第一个捕获组匹配 schema + 用户名（不含 `:` `@` 空白）
 *   - `:[^@\s]+@` 匹配密码段（不含 `@` 空白）
 *   - 替换成 `username:***@` 形式
 *
 * 注意：本函数不修改不含凭据的普通 URL；对没有冒号分隔密码的 `https://user@host`
 * 形式保持原样（无密码可泄露）。
 */
export function sanitizeStderr(text: string): string {
  return text.replace(/(https?:\/\/[^@\s:]+):[^@\s]+@/g, "$1:***@");
}

/**
 * 根据 push 参数构造 Gerrit push option 后缀。
 *
 * Property 9 契约：
 *   - 无任何选项时返回空字符串 `""`
 *   - 至少一个选项时返回以 `%` 起始、各选项以 `,` 分隔的字符串
 *   - 选项构造：reviewer 列表展开为 `r=<email>`、wip 为 `wip`、topic 为 `topic=<topic>`
 *   - 顺序：reviewers（按入参顺序） → wip → topic
 *
 * 调用方负责保证 reviewers/topic 的字符串内容不破坏 push option 语法（Gerrit 接受
 * 任意非空、不含 `,` 的字符串作为 reviewer email 与 topic）。
 */
export function buildPushOptionSuffix(args: {
  reviewers?: string[];
  wip?: boolean;
  topic?: string;
}): string {
  const opts: string[] = [];
  if (args.reviewers && args.reviewers.length > 0) {
    for (const reviewer of args.reviewers) {
      opts.push(`r=${reviewer}`);
    }
  }
  if (args.wip) {
    opts.push("wip");
  }
  if (args.topic) {
    opts.push(`topic=${args.topic}`);
  }
  if (opts.length === 0) return "";
  return `%${opts.join(",")}`;
}

// =============================================================================
// spawnGit：受控的 git 子进程封装
// =============================================================================

/** spawnGit 的返回值。 */
export interface SpawnGitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * 在指定 cwd 中执行 git 子命令，受控超时与输出上限。
 *
 * 行为：
 *   - 通过 `child_process.spawn("git", args, { cwd, env: process.env })` 启动子进程
 *   - 累积 stdout/stderr 到字符串；任一流超过 64KB 时截断并附加 `\n[truncated]` 标记
 *   - 关闭 stdin 防止子进程因等待输入而挂起
 *   - 超过 timeoutMs 时先发 SIGTERM，1 秒后若仍未退出再发 SIGKILL；最终通过
 *     reject(StructuredError("request_timeout")) 通知调用方
 *   - 子进程无法启动（如 git 二进制缺失）时通过 reject(原始 Error) 暴露给上层；
 *     `withErrorHandling` 会兜底转成 internal_error
 *   - 正常退出时 resolve `{ stdout, stderr, exitCode }`，exitCode 取自 `close` 事件
 *     的 code 参数（被信号杀死时 code 可能为 null，此处用 -1 兜底——在超时分支已
 *     reject 因此实际只在子进程被外部 SIGKILL 等极端场景出现）
 */
export function spawnGit(
  cwd: string,
  args: string[],
  timeoutMs: number = DEFAULT_GIT_PUSH_TIMEOUT_MS,
): Promise<SpawnGitResult> {
  return new Promise<SpawnGitResult>((resolve, reject) => {
    const proc = spawn("git", args, { cwd, env: process.env });

    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const appendToStream = (
      current: string,
      chunkText: string,
      truncated: boolean,
    ): { next: string; truncated: boolean } => {
      if (truncated) return { next: current, truncated: true };
      const remaining = MAX_STREAM_OUTPUT_CHARS - current.length;
      if (remaining <= 0) {
        return { next: current, truncated: true };
      }
      if (chunkText.length > remaining) {
        return {
          next: current + chunkText.slice(0, remaining) + "\n[truncated]",
          truncated: true,
        };
      }
      return { next: current + chunkText, truncated: false };
    };

    if (proc.stdout) {
      proc.stdout.on("data", (chunk: Buffer | string) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        const { next, truncated } = appendToStream(stdout, text, stdoutTruncated);
        stdout = next;
        stdoutTruncated = truncated;
      });
    }
    if (proc.stderr) {
      proc.stderr.on("data", (chunk: Buffer | string) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        const { next, truncated } = appendToStream(stderr, text, stderrTruncated);
        stderr = next;
        stderrTruncated = truncated;
      });
    }

    // 关闭 stdin 防止 git 等待输入挂起（git push 正常流程不需要交互输入）
    proc.stdin?.end();

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        // 子进程可能已退出，忽略
      }
      killTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // 已退出，忽略
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
            `git 命令执行超时 (${timeoutMs}ms): git ${args.join(" ")}`,
            undefined,
            { cwd, args, timeout_ms: timeoutMs },
          ),
        );
        return;
      }
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
  });
}

// =============================================================================
// detectGerritRemote：解析仓库 remote 配置
// =============================================================================

/**
 * 探测当前仓库可用的 Gerrit remote 名。
 *
 * 优先级：`gerrit` > `origin`。两者都不存在时抛 StructuredError(config_error)。
 *
 * 实现：执行 `git remote` 在指定 cwd 中列出所有 remote 名，逐个检查。
 *
 * @throws StructuredError(config_error) 当 git 仓库中既无 `gerrit` 也无 `origin` remote
 * @throws StructuredError(config_error) 当 git remote 子命令本身失败（例如 cwd 不是 git 仓库）
 */
export async function detectGerritRemote(cwd: string): Promise<string> {
  const result = await spawnGit(cwd, ["remote"], REMOTE_LIST_TIMEOUT_MS);
  if (result.exitCode !== 0) {
    throw new StructuredError(
      "config_error",
      `无法读取 git 仓库的 remote 列表 (exit ${result.exitCode}): ${cwd}` +
        (result.stderr ? `\n${result.stderr.trim()}` : ""),
      undefined,
      { cwd, exit_code: result.exitCode },
    );
  }
  const remotes = result.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (remotes.includes("gerrit")) return "gerrit";
  if (remotes.includes("origin")) return "origin";
  throw new StructuredError(
    "config_error",
    `git 仓库中既无 'gerrit' 也无 'origin' remote: ${cwd}`,
    undefined,
    { cwd, available_remotes: remotes },
  );
}

// =============================================================================
// pushToGerrit：主入口
// =============================================================================

/**
 * 将本地 HEAD 推送到 Gerrit 的 refs/for/<target_branch>，自动构造 push options。
 *
 * 严格执行顺序：
 *   ① 工作目录校验（cwd 存在 + 是目录 + 含 .git）
 *   ② MP 分支硬拒绝（匹配 *_mp 时立即返回，绝不调用 spawn——Property 10）
 *   ③ 探测 git remote（gerrit > origin）
 *   ④ 构造 push option suffix（Property 9）
 *   ⑤ 执行 git push（120 秒超时）
 *   ⑥ 处理结果：成功时尝试解析 Change URL；失败时返回 sanitized stderr 与退出码
 *
 * 错误处理策略：
 *   - 工作目录校验失败：返回 `{ ok: false, error_type: "git_push_failed", message: ... }`
 *     （PushResult 的业务结构化错误，不抛异常）
 *   - MP 分支：返回 `{ ok: false, error_type: "mp_branch_push_blocked", ... }`
 *   - detectGerritRemote 失败：抛 StructuredError(config_error)（由 withErrorHandling 兜底）
 *   - spawnGit 超时：抛 StructuredError(request_timeout)（同上）
 *   - git push 退出码非 0：返回 `{ ok: false, error_type: "git_push_failed", ... }`
 *     （含退出码与 sanitized stderr）
 *   - git push 退出码为 0：返回 `{ ok: true, change_url? | change_url_unavailable, raw_stderr }`
 */
export async function pushToGerrit(args: {
  cwd: string;
  target_branch: string;
  reviewers?: string[];
  wip?: boolean;
  topic?: string;
}): Promise<PushResult> {
  // ============================================================
  // ① 工作目录校验
  // ============================================================
  let cwdStat;
  try {
    cwdStat = await stat(args.cwd);
  } catch {
    return {
      ok: false,
      error_type: "git_push_failed",
      message: `工作目录不存在或不是目录: ${args.cwd}`,
    };
  }
  if (!cwdStat.isDirectory()) {
    return {
      ok: false,
      error_type: "git_push_failed",
      message: `工作目录不存在或不是目录: ${args.cwd}`,
    };
  }
  // .git 可以是子目录（普通仓库）或文件（worktree / submodule，含 gitdir 指向）
  try {
    await stat(path.join(args.cwd, ".git"));
  } catch {
    return {
      ok: false,
      error_type: "git_push_failed",
      message: `目录不是 git 仓库: ${args.cwd}`,
    };
  }

  // ============================================================
  // ② MP 分支硬拒绝（Property 10）：必须在 spawn 之前判定
  // ============================================================
  if (MP_BRANCH_PATTERN.test(args.target_branch)) {
    return {
      ok: false,
      error_type: "mp_branch_push_blocked",
      message:
        `目标分支 ${args.target_branch} 匹配 MP 分支模式（*_mp）。` +
        `MP 分支推送必须由 Developer 在 Steering 工作流中显式确认后通过其他流程完成，不接受自动推送。`,
    };
  }

  // ============================================================
  // ③ 检测 git remote
  // ============================================================
  const remote = await detectGerritRemote(args.cwd);

  // ============================================================
  // ④ 构造 push option suffix（Property 9）
  // ============================================================
  const suffix = buildPushOptionSuffix({
    reviewers: args.reviewers,
    wip: args.wip,
    topic: args.topic,
  });

  // ============================================================
  // ⑤ 执行 git push（120 秒超时）
  // ============================================================
  const refspec = `HEAD:refs/for/${args.target_branch}${suffix}`;
  const { stderr, exitCode } = await spawnGit(
    args.cwd,
    ["push", remote, refspec],
    DEFAULT_GIT_PUSH_TIMEOUT_MS,
  );

  // 在所有返回路径上对 stderr 做 sanitize（防 Basic Auth 凭据泄露）
  const sanitizedStderr = sanitizeStderr(stderr);

  // ============================================================
  // ⑥ 处理结果
  // ============================================================
  if (exitCode !== 0) {
    return {
      ok: false,
      error_type: "git_push_failed",
      message: `git push 失败 (exit ${exitCode}): ${sanitizedStderr}`,
      exit_code: exitCode,
      stderr: sanitizedStderr,
    };
  }

  // 成功：从原始 stderr 中提取 Change URL（Gerrit 把 URL 写到 stderr 而非 stdout）
  const changeUrl = parseGerritChangeUrl(stderr);
  if (changeUrl !== null) {
    return {
      ok: true,
      change_url: changeUrl,
      raw_stderr: sanitizedStderr,
    };
  }
  return {
    ok: true,
    change_url_unavailable: true,
    raw_stderr: sanitizedStderr,
  };
}
