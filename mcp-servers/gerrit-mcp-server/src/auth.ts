/**
 * Gerrit 认证与配置读取（v1.1.0，REST 主通道，双通道支持）。
 *
 * 职责：
 *   - 一次性读取 Gerrit 相关环境变量并打包 GerritConfig
 *   - 提供 `requireGerritConfig()` 校验必需变量（缺失则抛 StructuredError(config_error)）
 *   - 暴露 `getAuthMode()` 决策当前认证模式
 *   - 生成 HTTP Basic Auth 头部（仅 basic 模式用）
 *   - 解析 GERRIT_TIMEOUT_MS（仅当字符串表示正整数时返回该值，否则 30000）
 *
 * 双通道认证（v1.1 新增）：
 *   - **session 模式（首选）**：`GERRIT_AUTH_HEADER` + `GERRIT_COOKIE`
 *     适用于公司 nginx + Gerrit 双层认证网关；浏览器登录后从开发者工具复制
 *     - `Authorization` 头满足 nginx Basic Auth（SSO 登录密码）
 *     - `Cookie` 头满足 Gerrit 自身 session（GerritAccount + XSRF_TOKEN 等）
 *     - HTTP 协议允许 1 个 Authorization + 1 个 Cookie 同时存在 → 物理可达
 *     - 走 non-/a/ 路径（/a/ 强制 HTTP Auth，要 HTTP Cred；普通路径走 cookie）
 *   - **basic 模式（备选）**：`GERRIT_USERNAME` + `GERRIT_HTTP_PASSWORD`
 *     适用于无 nginx 直连 Gerrit 部署
 *     - 走 /a/ 鉴权前缀路径
 *     - 单一 `Authorization: Basic <b64(user:password)>` 头
 *
 * 注意：
 *   - 依赖 errors.ts，但 errors.ts 不依赖本模块（避免循环依赖）
 *   - basicAuthHeader 使用 Node 原生 `Buffer.from(s, "utf8").toString("base64")`，而非全局 btoa
 *     （后者在 Node 中虽然可用但仅支持 Latin-1，无法正确处理 Unicode 用户名/密码）
 */

import { StructuredError } from "./errors.js";

// =============================================================================
// 配置读取
// =============================================================================

/** Gerrit 单次 HTTP 请求的默认超时（毫秒）。 */
export const DEFAULT_GERRIT_TIMEOUT_MS = 30000;

/** 当前认证模式标识。 */
export type GerritAuthMode = "session" | "basic" | "missing";

export interface GerritConfig {
  url: string;
  /** 模式 A：浏览器会话凭据（首选，能过 nginx + Gerrit）。raw "Basic xxx" 或 "Bearer xxx"。 */
  authHeader: string;
  /** 模式 A：raw "GerritAccount=...; XSRF_TOKEN=..."。 */
  cookie: string;
  /** 模式 B：HTTP Credentials 直连。 */
  username: string;
  password: string;
  timeoutMs: number;
}

/** 一次性读取 Gerrit 相关环境变量并打包成 GerritConfig（不做必需变量校验）。 */
export function getGerritConfig(): GerritConfig {
  return {
    url: (process.env.GERRIT_URL ?? "").trim(),
    authHeader: (process.env.GERRIT_AUTH_HEADER ?? "").trim(),
    cookie: (process.env.GERRIT_COOKIE ?? "").trim(),
    username: (process.env.GERRIT_USERNAME ?? "").trim(),
    password: process.env.GERRIT_HTTP_PASSWORD ?? "",
    timeoutMs: parseTimeoutMs(process.env.GERRIT_TIMEOUT_MS),
  };
}

/**
 * 决策 GerritConfig 的当前认证模式。
 *
 * 决策表：
 * | authHeader | cookie | username | password | mode    |
 * |------------|--------|----------|----------|---------|
 * | ✓          | ✓      | *        | *        | session |
 * | ×          | ×      | ✓        | ✓        | basic   |
 * | 其他不完整组合                              | missing |
 */
export function getAuthMode(cfg: GerritConfig): GerritAuthMode {
  const hasSession = cfg.authHeader.length > 0 && cfg.cookie.length > 0;
  if (hasSession) return "session";
  const hasBasic = cfg.username.length > 0 && cfg.password.length > 0;
  if (hasBasic) return "basic";
  return "missing";
}

/**
 * 校验所有 Gerrit 必需环境变量已配置；否则抛 StructuredError(config_error)。
 *
 * 双模式校验：
 *   - 必须配置 `GERRIT_URL`
 *   - 在两组凭据中至少有一组完整：
 *     - session 组：`GERRIT_AUTH_HEADER` + `GERRIT_COOKIE`
 *     - basic 组：`GERRIT_USERNAME` + `GERRIT_HTTP_PASSWORD`
 *
 * @throws StructuredError 当 GERRIT_URL 缺失，或两组凭据都不完整
 */
export function requireGerritConfig(): GerritConfig {
  const cfg = getGerritConfig();
  const missing: string[] = [];

  if (cfg.url.length === 0) missing.push("GERRIT_URL");

  const mode = getAuthMode(cfg);
  if (mode === "missing") {
    // 一次性列全两组所需变量，方便用户一次配齐
    missing.push(
      "GERRIT_AUTH_HEADER + GERRIT_COOKIE (session 模式，过 nginx 双层认证)",
    );
    missing.push(
      "或 GERRIT_USERNAME + GERRIT_HTTP_PASSWORD (basic 模式，无 nginx 时直连)",
    );
  }

  if (missing.length > 0) {
    throw new StructuredError(
      "config_error",
      `缺少必需的 Gerrit 环境变量。请在 mcp.json 的 env 字段中配置：${missing.join("; ")}`,
      undefined,
      { missing_env_vars: missing, hint: "推荐使用 session 模式：浏览器登录 Gerrit 后从 F12 网络请求复制 Authorization 与 Cookie 头" },
    );
  }
  return cfg;
}

// =============================================================================
// HTTP Basic Auth 头部生成（basic 模式用）
// =============================================================================

/**
 * 生成 HTTP Basic Auth 头部值。
 *
 * 输出格式：`"Basic " + base64(username + ":" + password)`，UTF-8 编码。
 * 注意：仅 basic 模式调用；session 模式直接透传 `cfg.authHeader`。
 */
export function basicAuthHeader(username: string, password: string): string {
  const encoded = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

// =============================================================================
// GERRIT_TIMEOUT_MS 解析
// =============================================================================

/**
 * 解析 GERRIT_TIMEOUT_MS 环境变量值。
 *
 * 仅当输入字符串去除两端空白后**仅含数字字符**且 > 0 时返回该值；否则返回默认 30000。
 */
export function parseTimeoutMs(s: string | undefined): number {
  if (typeof s !== "string") return DEFAULT_GERRIT_TIMEOUT_MS;
  const trimmed = s.trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_GERRIT_TIMEOUT_MS;
  const value = parseInt(trimmed, 10);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_GERRIT_TIMEOUT_MS;
  return value;
}
