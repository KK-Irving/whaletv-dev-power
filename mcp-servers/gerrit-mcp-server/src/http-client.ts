/**
 * Gerrit REST API HTTP 客户端封装。
 *
 * 职责：
 *   - 提供 `gerritGet/Post/Put/Delete(path, body?)` 便捷方法
 *   - 自动注入 `/a/` 认证端点前缀（幂等，Property 2 契约）
 *   - 通过 `AbortController + setTimeout` 实现请求超时（默认 30000ms，可被 GERRIT_TIMEOUT_MS 覆盖）
 *   - 剥离 Gerrit 响应体首行的 `)]}'` XSSI 防护前缀（Property 3 契约，兼容空白变体）
 *   - 将 HTTP 非 2xx 响应转换为 StructuredError（响应体截断到前 500 字符）
 *   - 将 AbortError 映射到 `request_timeout`、其他 fetch 异常映射到 `network_error`
 *
 * 依赖：
 *   - auth.ts：requireGerritConfig / basicAuthHeader
 *   - errors.ts：StructuredError / mapHttpStatus
 *   - 不依赖任何 tools/* 模块
 */

import { basicAuthHeader, requireGerritConfig } from "./auth.js";
import { StructuredError, mapHttpStatus } from "./errors.js";

// =============================================================================
// 常量
// =============================================================================

/** Gerrit 防 XSSI 前缀字面量。 */
const XSSI_PREFIX = ")]}'";

/** HTTP 响应体在错误对象中的最大保留字符数（Req 8.5）。 */
const RESPONSE_BODY_TRUNCATE_CHARS = 500;

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

// =============================================================================
// 工具函数（导出供 PBT 测试与上层调用方使用）
// =============================================================================

/**
 * 将任意 Gerrit 路径注入认证端点前缀 `/a/`，保证幂等。
 *
 * 契约（Property 2）：
 *   - 输入 `/changes/123`           → 输出 `/a/changes/123`
 *   - 输入 `/a/changes/123`         → 输出 `/a/changes/123`（不变）
 *   - 输入 `changes/123`            → 输出 `/a/changes/123`
 *   - 输出始终以 `/a/` 开头（除空字符串边界外）
 *   - 输出永不包含 `//a//a/` 等重复前缀
 *
 * 实现策略：先把路径规范化为以 `/` 开头，再判断是否已有 `/a/` 前缀。
 */
export function injectAuthPrefix(path: string): string {
  // ① 规范化前导斜杠
  const normalized = path.startsWith("/") ? path : `/${path}`;
  // ② 已有前缀（`/a` 单独 或 `/a/...`）则保持不变
  if (normalized === "/a" || normalized.startsWith("/a/")) {
    return normalized;
  }
  // ③ 注入前缀
  return `/a${normalized}`;
}

/**
 * 剥离 Gerrit 响应体首行的 `)]}'` XSSI 防护前缀及随后的连续空白。
 *
 * 契约（Property 3）：
 *   - `)]}'\n{...}`        → `{...}`
 *   - `)]}'\n\n{...}`      → `{...}`（连续空白行也被去除）
 *   - `)]}'  {...}`        → `{...}`（行内空白变体）
 *   - 不以 `)]}'` 开头     → 原样返回（不破坏正常 JSON 文本的前导空白）
 *
 * 注意：仅在检测到前缀时才 trimStart，避免破坏没有前缀的合法 JSON 字符串首部空白。
 */
export function stripXssiPrefix(text: string): string {
  if (text.startsWith(XSSI_PREFIX)) {
    return text.slice(XSSI_PREFIX.length).trimStart();
  }
  return text;
}

/**
 * 截断字符串到指定最大长度，超长时附加 `...[truncated]` 标记。
 *
 * 用于将 Gerrit 错误响应体写入 StructuredError 时控制大小（Req 8.5：前 500 字符）。
 */
export function truncateBody(body: string, maxChars: number = RESPONSE_BODY_TRUNCATE_CHARS): string {
  if (body.length <= maxChars) return body;
  return `${body.slice(0, maxChars)}...[truncated]`;
}

// =============================================================================
// 内部辅助
// =============================================================================

/**
 * 判断 fetch 抛出的异常是否来自 AbortController（即超时触发）。
 *
 * 兼容多种实现：
 *   - DOMException 的 `.name === "AbortError"`（标准 Web API）
 *   - Node undici fetch 包装的 TypeError，其 `.cause.name === "AbortError"`
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
 * 提取 fetch 异常的可读消息，优先使用 `.cause.message`（undici 把底层 errno 包装在 cause 里）。
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
 * 根据 HTTP 状态码与已截断的响应体构造 StructuredError 的 message 文本。
 *
 * 文本格式遵循 design.md "Error Handling Matrix" 的描述。具体的资源标识符（change_id、
 * 分支名、reviewer 等）由调用方在 tools/* 层补充包装（Property 5），不在本层注入。
 */
function buildHttpErrorMessage(status: number, truncatedBody: string): string {
  let prefix: string;
  if (status === 401) {
    prefix = `Gerrit 认证失败 (HTTP 401): 请检查 GERRIT_USERNAME 和 GERRIT_HTTP_PASSWORD`;
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
 *   - fetch 阶段抛非 Abort 异常（DNS/ECONNREFUSED 等） → StructuredError(network_error)
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
  const apiPath = injectAuthPrefix(path);
  const url = new URL(apiPath, cfg.url).toString();

  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: basicAuthHeader(cfg.username, cfg.password),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
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
        { url, timeout_ms: cfg.timeoutMs },
      );
    }
    // DNS / TCP / TLS / undici 网络错误
    const causeMessage = extractCauseMessage(err);
    throw new StructuredError(
      "network_error",
      `Gerrit 网络错误: ${causeMessage} (GERRIT_URL=${cfg.url})`,
      undefined,
      { url, original: causeMessage },
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
      buildHttpErrorMessage(res.status, truncated),
      res.status,
      { url, response_body: truncated },
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
      { url, body_preview: truncateBody(stripped) },
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
