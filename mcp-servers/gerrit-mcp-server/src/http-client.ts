/**
 * Gerrit REST API HTTP 客户端封装（v1.1.0，双通道认证）。
 *
 * 职责：
 *   - 提供 `gerritGet/Post/Put/Delete(path, body?)` 便捷方法
 *   - **按当前认证模式决定路径前缀**：
 *     - session 模式 → 走 non-/a/ 路径（cookie 鉴权）
 *     - basic 模式   → 走 /a/ 路径（HTTP Auth 鉴权）
 *   - **按当前认证模式决定 headers**：
 *     - session 模式 → `Authorization`（raw, nginx 用）+ `Cookie`（Gerrit 用）
 *     - basic 模式   → `Authorization: Basic <b64(user:pwd)>`
 *   - 通过 `AbortController + setTimeout` 实现请求超时（默认 30000ms，可被 GERRIT_TIMEOUT_MS 覆盖）
 *   - 剥离 Gerrit 响应体首行的 `)]}'` XSSI 防护前缀（兼容空白变体，幂等）
 *   - 将 HTTP 非 2xx 响应转换为 StructuredError（响应体截断到前 500 字符）
 *   - 401 错误信息按当前 auth 模式给出针对性诊断（cookie 过期 vs HTTP_PASSWORD 错）
 *   - 将 AbortError 映射到 `request_timeout`、其他 fetch 异常映射到 `network_error`
 *
 * 依赖：
 *   - auth.ts：requireGerritConfig / getAuthMode / basicAuthHeader
 *   - errors.ts：StructuredError / mapHttpStatus
 *   - 不依赖任何 tools/* 模块
 */

import {
  basicAuthHeader,
  getAuthMode,
  requireGerritConfig,
  type GerritAuthMode,
  type GerritConfig,
} from "./auth.js";
import { StructuredError, mapHttpStatus } from "./errors.js";

// =============================================================================
// 常量
// =============================================================================

/** Gerrit 防 XSSI 前缀字面量。 */
const XSSI_PREFIX = ")]}'";

/** HTTP 响应体在错误对象中的最大保留字符数。 */
const RESPONSE_BODY_TRUNCATE_CHARS = 500;

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

// =============================================================================
// 工具函数
// =============================================================================

/**
 * 根据认证模式注入路径前缀。
 *
 * 契约（Property 1：双通道幂等性）：
 *   - **session 模式**：non-/a/ 路径
 *     - `/changes/123`        → `/changes/123`
 *     - `/a/changes/123`      → `/changes/123`（剥掉 /a/，因为 cookie 模式打 /a/ 反而 401）
 *     - `changes/123`         → `/changes/123`
 *   - **basic 模式**：/a/ 路径
 *     - `/changes/123`        → `/a/changes/123`
 *     - `/a/changes/123`      → `/a/changes/123`（不变）
 *     - `changes/123`         → `/a/changes/123`
 *   - 输出永不包含 `//a//a/` 等重复前缀
 *
 * @param path Gerrit REST 路径（开头是否有 `/` 都接受）
 * @param mode 当前认证模式
 */
export function injectAuthPrefix(path: string, mode: GerritAuthMode): string {
  // ① 规范化前导斜杠
  const normalized = path.startsWith("/") ? path : `/${path}`;

  if (mode === "session") {
    // session 模式：剥掉 /a/ 前缀（如有）
    if (normalized === "/a") return "/";
    if (normalized.startsWith("/a/")) return normalized.slice(2); // "/a/changes/..." → "/changes/..."
    return normalized;
  }

  // basic 或 missing 模式：注入 /a/ 前缀
  if (normalized === "/a" || normalized.startsWith("/a/")) {
    return normalized;
  }
  return `/a${normalized}`;
}

/**
 * 剥离 Gerrit 响应体首行的 `)]}'` XSSI 防护前缀及随后的连续空白。
 *
 * 契约（Property 2：XSSI 剥离幂等性）：
 *   - `)]}'\n{...}`        → `{...}`
 *   - `)]}'\n\n{...}`      → `{...}`（连续空白行也被去除）
 *   - `)]}'  {...}`        → `{...}`（行内空白变体）
 *   - 不以 `)]}'` 开头     → 原样返回（不破坏正常 JSON 文本的前导空白）
 */
export function stripXssiPrefix(text: string): string {
  if (text.startsWith(XSSI_PREFIX)) {
    return text.slice(XSSI_PREFIX.length).trimStart();
  }
  return text;
}

/**
 * 截断字符串到指定最大长度，超长时附加 `...[truncated]` 标记。
 */
export function truncateBody(body: string, maxChars: number = RESPONSE_BODY_TRUNCATE_CHARS): string {
  if (body.length <= maxChars) return body;
  return `${body.slice(0, maxChars)}...[truncated]`;
}

// =============================================================================
// 内部辅助
// =============================================================================

/**
 * 根据认证模式构造请求头。
 *
 * - session 模式：透传 raw authHeader + 透传 raw cookie
 * - basic 模式：计算 Basic Auth header
 */
function buildHeaders(cfg: GerritConfig, mode: GerritAuthMode): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (mode === "session") {
    h["Authorization"] = cfg.authHeader; // raw "Basic xxx"，过 nginx
    h["Cookie"] = cfg.cookie; // 过 Gerrit 自身 session
  } else {
    // basic 模式
    h["Authorization"] = basicAuthHeader(cfg.username, cfg.password);
  }
  return h;
}

/**
 * 判断 fetch 抛出的异常是否来自 AbortController（即超时触发）。
 */
function isAbortError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const e = err as { name?: unknown; cause?: unknown };
  if (e.name === "AbortError") return true;
  const cause = e.cause as { name?: unknown } | null | undefined;
  if (cause && typeof cause === "object" && cause.name === "AbortError") return true;
  return false;
}

/**
 * 提取 fetch 异常的可读消息，优先使用 `.cause.message`。
 */
function extractCauseMessage(err: unknown): string {
  if (err === null || typeof err !== "object") return String(err);
  const e = err as { message?: unknown; cause?: { message?: unknown; code?: unknown } | null };
  if (e.cause && typeof e.cause === "object") {
    const causeMsg = typeof e.cause.message === "string" ? e.cause.message : "";
    const causeCode = typeof e.cause.code === "string" ? e.cause.code : "";
    if (causeCode && causeMsg) return `${causeCode}: ${causeMsg}`;
    if (causeMsg) return causeMsg;
    if (causeCode) return causeCode;
  }
  return typeof e.message === "string" ? e.message : String(err);
}

/**
 * 根据 HTTP 状态码、auth 模式与已截断的响应体构造 StructuredError 的 message 文本。
 *
 * 401 分支根据当前 auth 模式给出**针对性**诊断：
 *   - session 模式 → 提示 cookie 已过期，引导跑刷新脚本
 *   - basic 模式   → 提示 HTTP_PASSWORD 错误
 */
function buildHttpErrorMessage(status: number, truncatedBody: string, mode: GerritAuthMode): string {
  let prefix: string;
  if (status === 401) {
    if (mode === "session") {
      prefix =
        "Gerrit 认证失败 (HTTP 401, session 模式): 浏览器会话凭据 (GERRIT_AUTH_HEADER 或 GERRIT_COOKIE) 已过期或无效。请运行 scripts/refresh-auth 重新抓取，或手动 F12 复制最新 Authorization 与 Cookie 头";
    } else {
      prefix =
        "Gerrit 认证失败 (HTTP 401, basic 模式): 请检查 GERRIT_USERNAME 和 GERRIT_HTTP_PASSWORD 是否正确";
    }
  } else if (status === 403) {
    prefix = `当前用户对该资源无操作权限 (HTTP 403)`;
  } else if (status === 404) {
    prefix = `资源不存在 (HTTP 404)`;
  } else if (status === 409) {
    prefix = `Gerrit 请求冲突 (HTTP 409)`;
  } else if (status >= 500 && status <= 599) {
    prefix = `Gerrit 服务器错误 (HTTP ${status})`;
  } else {
    prefix = `Gerrit 请求失败 (HTTP ${status})`;
  }
  return truncatedBody.length > 0 ? `${prefix}: ${truncatedBody}` : prefix;
}

// =============================================================================
// 核心 fetch 封装
// =============================================================================

/**
 * 执行单次 Gerrit REST API 调用并返回解析后的 JSON。
 *
 * 错误传递规则：
 *   - 缺失环境变量            → StructuredError(config_error)（来自 requireGerritConfig）
 *   - 请求被 AbortController 中断（超时）→ StructuredError(request_timeout)
 *   - fetch 阶段抛非 Abort 异常 → StructuredError(network_error)
 *   - HTTP 非 2xx                          → StructuredError(<由 mapHttpStatus 决定>)，详情含响应体前 500 字符
 *   - 响应 JSON 解析失败                   → StructuredError(internal_error)
 *
 * 成功返回：解析后的 JSON 值（响应体为空时返回 null）。
 */
async function gerritFetch<T = unknown>(
  method: HttpMethod,
  path: string,
  body?: unknown,
): Promise<T> {
  const cfg = requireGerritConfig();
  const mode = getAuthMode(cfg);
  const apiPath = injectAuthPrefix(path, mode);
  const url = new URL(apiPath, cfg.url).toString();

  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: buildHeaders(cfg, mode),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutTimer);
    if (isAbortError(err)) {
      throw new StructuredError(
        "request_timeout",
        `Gerrit 请求超时 (${cfg.timeoutMs}ms): ${url}`,
        undefined,
        { url, timeout_ms: cfg.timeoutMs, auth_mode: mode },
      );
    }
    const causeMessage = extractCauseMessage(err);
    throw new StructuredError(
      "network_error",
      `Gerrit 网络错误: ${causeMessage} (GERRIT_URL=${cfg.url})`,
      undefined,
      { url, original: causeMessage, auth_mode: mode },
    );
  }
  clearTimeout(timeoutTimer);

  // 读取响应体并剥离 XSSI 前缀
  const rawText = await res.text();
  const stripped = stripXssiPrefix(rawText);

  if (!res.ok) {
    const truncated = truncateBody(stripped);
    throw new StructuredError(
      mapHttpStatus(res.status, stripped),
      buildHttpErrorMessage(res.status, truncated, mode),
      res.status,
      { url, response_body: truncated, auth_mode: mode },
    );
  }

  if (stripped.length === 0) {
    // 一些 Gerrit 端点（如 DELETE /reviewers）成功时返回 204 + 空体
    return null as T;
  }

  try {
    return JSON.parse(stripped) as T;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new StructuredError(
      "internal_error",
      `Gerrit 响应 JSON 解析失败: ${message}`,
      undefined,
      { url, body_preview: truncateBody(stripped), auth_mode: mode },
    );
  }
}

// =============================================================================
// 便捷方法导出
// =============================================================================

export const gerritGet = <T = unknown>(path: string): Promise<T> => gerritFetch<T>("GET", path);

export const gerritPost = <T = unknown>(path: string, body?: unknown): Promise<T> =>
  gerritFetch<T>("POST", path, body);

export const gerritPut = <T = unknown>(path: string, body?: unknown): Promise<T> =>
  gerritFetch<T>("PUT", path, body);

export const gerritDelete = <T = unknown>(path: string): Promise<T> =>
  gerritFetch<T>("DELETE", path);
