/**
 * Confluence 认证与配置读取（v1.0.0）。
 *
 * Atlassian 6.x 文档中心使用 cookie 认证，没有独立的 API Token 体系。
 * 凭据来自浏览器登录后的会话 cookie：JSESSIONID、seraph.confluence、acw_tc 等。
 *
 * 推荐通过 `scripts/refresh-auth.{ps1,sh}` 自动维护此 cookie；过期（401/302）
 * 时再跑一次刷新脚本即可。
 */

// =============================================================================
// 类型与常量
// =============================================================================

export const DEFAULT_CONFLUENCE_TIMEOUT_MS = 30000;
export const DEFAULT_CONFLUENCE_REQUEST_DELAY_MS = 150; // 防 Aliyun WAF 限速

export interface ConfluenceConfig {
  /** 服务基址，如 https://docs.whaletv.com */
  url: string;
  /** 浏览器登录后的完整 Cookie 头部值 */
  cookie: string;
  /** 单次请求超时（毫秒） */
  timeoutMs: number;
  /** 连续请求之间的最小间隔（毫秒，全量爬时用） */
  requestDelayMs: number;
}

// =============================================================================
// 错误类（与 gerrit-mcp 风格一致）
// =============================================================================

export type ConfluenceErrorType =
  | "config_error"
  | "auth_failed"
  | "permission_denied"
  | "not_found"
  | "request_timeout"
  | "network_error"
  | "internal_error";

export class ConfluenceError extends Error {
  public readonly error_type: ConfluenceErrorType;
  public readonly http_status?: number;
  public readonly details?: unknown;

  constructor(
    error_type: ConfluenceErrorType,
    message: string,
    http_status?: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "ConfluenceError";
    this.error_type = error_type;
    this.http_status = http_status;
    this.details = details;
    Object.setPrototypeOf(this, ConfluenceError.prototype);
  }
}

// =============================================================================
// 配置读取
// =============================================================================

function parsePositiveInt(s: string | undefined, defaultValue: number): number {
  if (typeof s !== "string") return defaultValue;
  const trimmed = s.trim();
  if (!/^\d+$/.test(trimmed)) return defaultValue;
  const value = parseInt(trimmed, 10);
  return Number.isFinite(value) && value >= 0 ? value : defaultValue;
}

export function getConfluenceConfig(): ConfluenceConfig {
  return {
    url: (process.env.CONFLUENCE_BASE_URL ?? "").trim().replace(/\/+$/, ""),
    cookie: (process.env.CONFLUENCE_COOKIE ?? "").trim(),
    timeoutMs: parsePositiveInt(
      process.env.CONFLUENCE_TIMEOUT_MS,
      DEFAULT_CONFLUENCE_TIMEOUT_MS,
    ),
    requestDelayMs: parsePositiveInt(
      process.env.CONFLUENCE_REQUEST_DELAY_MS,
      DEFAULT_CONFLUENCE_REQUEST_DELAY_MS,
    ),
  };
}

export function requireConfluenceConfig(): ConfluenceConfig {
  const cfg = getConfluenceConfig();
  const missing: string[] = [];
  if (!cfg.url) missing.push("CONFLUENCE_BASE_URL");
  if (!cfg.cookie) missing.push("CONFLUENCE_COOKIE");
  if (missing.length > 0) {
    throw new ConfluenceError(
      "config_error",
      `缺少必需的 Confluence 环境变量: ${missing.join(", ")}。请运行 scripts/refresh-auth.{ps1,sh} 自动获取，或参考 steering/auth-refresh.md 手动配置。`,
      undefined,
      { missing_env_vars: missing },
    );
  }
  return cfg;
}
