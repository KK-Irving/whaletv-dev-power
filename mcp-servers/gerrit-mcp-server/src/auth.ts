/**
 * Gerrit 认证与配置读取。
 *
 * 职责：
 *   - 一次性读取 GERRIT_URL / GERRIT_USERNAME / GERRIT_HTTP_PASSWORD / GERRIT_TIMEOUT_MS 环境变量
 *   - 提供 `requireGerritConfig()` 校验必需变量（缺失则抛 StructuredError(config_error)）
 *   - 生成 HTTP Basic Auth 头部（Property 1 契约：`"Basic " + base64(username + ":" + password)`，UTF-8 编码）
 *   - 解析 GERRIT_TIMEOUT_MS（Property 4 契约：仅当字符串表示正整数时返回该值，否则 30000）
 *
 * 注意：
 *   - 依赖 errors.ts，但 errors.ts 不依赖本模块（避免循环依赖）
 *   - 不依赖 http-client.ts；http-client 反过来调用本模块
 *   - basicAuthHeader 使用 Node 原生 `Buffer.from(s, "utf8").toString("base64")`，而非全局 btoa
 *     （后者在 Node 中虽然可用但仅支持 Latin-1，无法正确处理 Unicode 用户名/密码）
 */

import { StructuredError } from "./errors.js";

// =============================================================================
// 配置读取
// =============================================================================

/** Gerrit 单次 HTTP 请求的默认超时（毫秒）。 */
export const DEFAULT_GERRIT_TIMEOUT_MS = 30000;

/**
 * 已解析的 Gerrit 运行时配置。
 *
 * - url / username / password 为可能空的字符串（缺失时为空字符串，由 requireGerritConfig 判定）
 * - timeoutMs 通过 parseTimeoutMs 解析；若环境变量缺失或非法，使用 DEFAULT_GERRIT_TIMEOUT_MS
 */
export interface GerritConfig {
  url: string;
  username: string;
  password: string;
  timeoutMs: number;
}

/**
 * 一次性读取 Gerrit 相关环境变量并打包成 GerritConfig。
 *
 * 不做必需变量校验（允许进程启动并完成 MCP 握手即使环境变量缺失，见 Req 2.6）；
 * 校验由 `requireGerritConfig()` 在工具调用入口执行。
 */
export function getGerritConfig(): GerritConfig {
  return {
    url: (process.env.GERRIT_URL ?? "").trim(),
    username: (process.env.GERRIT_USERNAME ?? "").trim(),
    password: process.env.GERRIT_HTTP_PASSWORD ?? "", // password 不 trim，允许尾随空格
    timeoutMs: parseTimeoutMs(process.env.GERRIT_TIMEOUT_MS),
  };
}

/**
 * 校验所有 Gerrit 必需环境变量已配置；否则抛出 StructuredError(config_error)。
 *
 * 错误消息中**只引用变量名**，不暴露变量值（安全：避免 password 泄露到错误日志）。
 *
 * @throws StructuredError 当 GERRIT_URL / GERRIT_USERNAME / GERRIT_HTTP_PASSWORD 任一缺失或为空字符串
 */
export function requireGerritConfig(): GerritConfig {
  const cfg = getGerritConfig();
  const missing: string[] = [];
  if (cfg.url.length === 0) missing.push("GERRIT_URL");
  if (cfg.username.length === 0) missing.push("GERRIT_USERNAME");
  if (cfg.password.length === 0) missing.push("GERRIT_HTTP_PASSWORD");

  if (missing.length > 0) {
    throw new StructuredError(
      "config_error",
      `缺少必需的 Gerrit 环境变量: ${missing.join(", ")}。请在 mcp.json 的 env 字段配置这些变量。`,
      undefined,
      { missing_env_vars: missing },
    );
  }
  return cfg;
}

// =============================================================================
// HTTP Basic Auth 头部生成
// =============================================================================

/**
 * 生成 HTTP Basic Auth 头部值。
 *
 * 输出格式：`"Basic " + base64(username + ":" + password)`，UTF-8 编码。
 *
 * 契约（Property 1）：
 *   - 输出以字符串 `"Basic "` 开头
 *   - 其后的 base64 段解码（按 UTF-8）后等价于 `username + ":" + password`
 *   - 支持 ASCII 与 Unicode 字符（包括 username 含 `:` 字符的边界情况——不会破坏 round-trip
 *     因为 base64 解码后能完整恢复原字符串）
 *
 * 安全：本函数不直接对外打印结果，调用方仅在 fetch 的 `Authorization` 头中使用。
 */
export function basicAuthHeader(username: string, password: string): string {
  // 使用 Node 内置 Buffer 进行 UTF-8 → base64 编码；不使用全局 btoa（仅支持 Latin-1）
  const encoded = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

// =============================================================================
// GERRIT_TIMEOUT_MS 解析
// =============================================================================

/**
 * 解析 GERRIT_TIMEOUT_MS 环境变量值。
 *
 * 契约（Property 4）：仅当输入字符串去除两端空白后**仅含数字字符**（即匹配 `/^\d+$/`）
 * 且 `parseInt(s, 10) > 0` 时返回该正整数；其他所有输入（含 undefined / "" /
 * 负数 "-1" / 零 "0" / 浮点 "1.5" / 非数字 "abc" / 含正负号 "+10" / 含科学记数 "1e3"）
 * 一律返回默认值 DEFAULT_GERRIT_TIMEOUT_MS（30000）。
 *
 * 设计考量：使用 `/^\d+$/` 而非依赖 parseInt 的容忍解析，能严格拒绝 "1.5" / "1e3" / "+10" 等
 * parseInt 会"成功解析"但语义不严格的输入。
 */
export function parseTimeoutMs(s: string | undefined): number {
  if (typeof s !== "string") return DEFAULT_GERRIT_TIMEOUT_MS;
  const trimmed = s.trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_GERRIT_TIMEOUT_MS;
  const value = parseInt(trimmed, 10);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_GERRIT_TIMEOUT_MS;
  return value;
}
