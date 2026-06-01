/**
 * 结构化错误模型与 HTTP 状态码到 error_type 的映射。
 *
 * 设计要点：
 *   - `StructuredError` 继承自原生 Error，便于 `throw` / `catch` 与栈跟踪
 *   - `error_type` 字段是封闭枚举（见 types.ts 的 GerritErrorType），保证 Property 14 的封闭性
 *   - `mapHttpStatus(status, body?)` 将 HTTP 状态码映射到 error_type；body 暂未参与映射，仅作为预留参数（cherry-pick 业务态分类发生在工具层而非这里）
 *   - `withErrorHandling(fn)` 把任意 throw（含 `throw "string"`、`throw null`、`throw 42`、Promise reject）统一转成 `StructuredError(internal_error)`；已是 StructuredError 的保留原 error_type
 *
 * 不依赖 auth.ts / http-client.ts，避免循环依赖（auth/http-client 反过来依赖 errors）。
 */

import type { GerritErrorType, StructuredErrorPayload } from "./types.js";

// =============================================================================
// StructuredError 类
// =============================================================================

/**
 * 工具层抛出的统一错误类型。
 *
 * 字段：
 *   - error_type: 封闭枚举（GerritErrorType）
 *   - message: 人类可读的错误描述（来自基类 Error.message）
 *   - http_status: 仅 HTTP 引发的错误才有
 *   - details: 任意辅助信息（如冲突文件列表、原始 stderr）；序列化时由调用方决定是否暴露
 */
export class StructuredError extends Error {
  public readonly error_type: GerritErrorType;
  public readonly http_status?: number;
  public readonly details?: unknown;

  constructor(
    error_type: GerritErrorType,
    message: string,
    http_status?: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "StructuredError";
    this.error_type = error_type;
    this.http_status = http_status;
    this.details = details;

    // 兼容 ES2022 target 下 extending built-in Error 的 prototype 链
    Object.setPrototypeOf(this, StructuredError.prototype);
  }

  /** 序列化为对外暴露的有线格式。 */
  toPayload(): StructuredErrorPayload {
    const payload: StructuredErrorPayload = {
      error_type: this.error_type,
      message: this.message,
    };
    if (this.http_status !== undefined) payload.http_status = this.http_status;
    if (this.details !== undefined) payload.details = this.details;
    return payload;
  }
}

// =============================================================================
// HTTP 状态码 → error_type 映射
// =============================================================================

/**
 * 将 Gerrit REST API 的 HTTP 状态码映射到 error_type。
 *
 * 业务侧的 409 细分（`skipped_already_merged` vs `conflict`）发生在
 * `tools/cherry-pick.ts` 内基于响应文本进一步分类，不在此函数中处理。
 *
 * @param status HTTP 状态码
 * @param _body  响应体（保留参数，便于未来按 body 内容细分映射；当前未使用）
 */
export function mapHttpStatus(status: number, _body?: string): GerritErrorType {
  if (status === 401) return "auth_failed";
  if (status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status >= 500 && status <= 599) return "gerrit_server_error";
  // 4xx 中其他状态码（如 400/422）当前未在 design 中分类，归为 internal_error 兜底
  return "internal_error";
}

// =============================================================================
// 通用 withErrorHandling 包装器
// =============================================================================

/**
 * 把任意函数（可同步/异步）包装成"返回值为成功结果，失败时抛出 StructuredError"的形式。
 *
 * 行为契约（Property 14）：
 *   - 已经是 StructuredError 的异常 → 直接重新 throw（保留原 error_type、http_status、details）
 *   - 任何其他 throw（含 `throw "string"`、`throw null`、`throw 42`、`throw new TypeError(...)`、Promise reject 任意值）
 *     → 转成 `StructuredError("internal_error", ...)` 后 throw
 *
 * 此函数本身保持 throw 语义；MCP 响应层的"成功 content vs isError content"组装由调用方
 * （src/index.ts 的工具 dispatcher 或后续模块）负责，避免在基础设施层耦合 MCP SDK。
 */
export async function withErrorHandling<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    if (err instanceof StructuredError) {
      throw err;
    }
    throw new StructuredError("internal_error", coerceErrorMessage(err), undefined, {
      original_kind: classifyThrownValue(err),
    });
  }
}

/**
 * 将任意被 throw 的值转换为人类可读的字符串 message。
 *
 * 规则：
 *   - Error 实例：使用 .message（若为空字符串则 fallback "Error"）
 *   - string：直接使用
 *   - undefined / null：返回字面量 "undefined" / "null"
 *   - 其他对象：尝试 JSON.stringify，失败则 String(...)
 *   - 其他原始值：String(...)
 */
function coerceErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.length > 0 ? err.message : err.name || "Error";
  }
  if (typeof err === "string") return err;
  if (err === null) return "null";
  if (err === undefined) return "undefined";
  if (typeof err === "object") {
    try {
      return JSON.stringify(err);
    } catch {
      return Object.prototype.toString.call(err);
    }
  }
  return String(err);
}

/**
 * 标记被 throw 值的"原始 JavaScript 类型"，方便后续诊断异常源头。
 * 仅用作 details.original_kind，不参与 error_type 决策。
 */
function classifyThrownValue(err: unknown): string {
  if (err === null) return "null";
  if (err === undefined) return "undefined";
  if (err instanceof StructuredError) return "StructuredError"; // 实际不会走到（上层已 rethrow）
  if (err instanceof Error) return err.constructor.name;
  return typeof err;
}
