/**
 * Confluence HTTP 客户端封装（v1.0.0）。
 *
 * 职责：
 *   - 在每个请求自动塞入 `Cookie` 与 `Accept` 头
 *   - 应用进程级请求间延迟（防 Aliyun WAF 限速）
 *   - 超时映射为 `request_timeout`，网络错误映射为 `network_error`
 *   - HTTP 4xx/5xx 映射为对应 ConfluenceErrorType
 *   - 401 / 重定向到 `/login.action` 都视为 auth_failed（cookie 过期）
 */

import { requireConfluenceConfig, ConfluenceError, type ConfluenceConfig } from "./auth.js";

let _lastRequestTimestamp = 0;
const _rateLockChain: Promise<void>[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 等待距离上一次请求至少 cfg.requestDelayMs 毫秒。
 */
async function paceBeforeRequest(cfg: ConfluenceConfig): Promise<void> {
  if (cfg.requestDelayMs <= 0) return;
  const previousTail = _rateLockChain[_rateLockChain.length - 1] ?? Promise.resolve();
  const myTurn = previousTail.then(async () => {
    const now = Date.now();
    const wait = cfg.requestDelayMs - (now - _lastRequestTimestamp);
    if (wait > 0) await sleep(wait);
    _lastRequestTimestamp = Date.now();
  });
  _rateLockChain.push(myTurn);
  await myTurn;
  if (_rateLockChain.length > 16) _rateLockChain.splice(0, _rateLockChain.length - 8);
}

function buildHeaders(cfg: ConfluenceConfig): Record<string, string> {
  return {
    Accept: "application/json",
    Cookie: cfg.cookie,
  };
}

function isAuthRedirect(res: Response): boolean {
  // 6.x Confluence 在 cookie 过期时常返回 302 → /login.action
  if (res.status === 302 || res.status === 303) {
    const location = res.headers.get("location") ?? "";
    if (/login\.action/i.test(location)) return true;
  }
  return false;
}

function truncateBody(text: string, n: number = 500): string {
  if (text.length <= n) return text;
  return text.slice(0, n) + "...[truncated]";
}

function mapHttpStatus(status: number): ConfluenceError["error_type"] {
  if (status === 401) return "auth_failed";
  if (status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status >= 500) return "internal_error";
  return "internal_error";
}

/**
 * 通用 GET：拼接 URL + 自动认证 + 错误映射。
 */
export async function confluenceGet<T = unknown>(
  pathOrUrl: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const cfg = requireConfluenceConfig();
  await paceBeforeRequest(cfg);

  const isAbsolute = /^https?:\/\//i.test(pathOrUrl);
  const url = new URL(isAbsolute ? pathOrUrl : pathOrUrl, cfg.url);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      headers: buildHeaders(cfg),
      redirect: "manual", // 手动处理 302 → /login.action（视为 auth_failed）
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === "AbortError") {
      throw new ConfluenceError(
        "request_timeout",
        `Confluence 请求超时 (${cfg.timeoutMs}ms): ${url.toString()}`,
      );
    }
    throw new ConfluenceError(
      "network_error",
      `Confluence 网络错误: ${e?.message ?? e}`,
      undefined,
      { url: url.toString() },
    );
  }
  clearTimeout(timer);

  if (isAuthRedirect(res)) {
    throw new ConfluenceError(
      "auth_failed",
      "Confluence cookie 已过期（302 → /login.action）。请运行 scripts/refresh-auth.{ps1,sh} 重新抓取。",
      res.status,
    );
  }

  const text = await res.text();
  if (!res.ok) {
    throw new ConfluenceError(
      mapHttpStatus(res.status),
      `Confluence 请求失败 (HTTP ${res.status}): ${truncateBody(text)}`,
      res.status,
      { url: url.toString(), response_body: truncateBody(text) },
    );
  }
  if (text.length === 0) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch (e: any) {
    throw new ConfluenceError(
      "internal_error",
      `Confluence 响应 JSON 解析失败: ${e?.message ?? e}`,
      undefined,
      { url: url.toString(), body_preview: truncateBody(text) },
    );
  }
}
