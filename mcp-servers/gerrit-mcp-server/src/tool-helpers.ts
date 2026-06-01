/**
 * MCP 工具 handler 通用包装。
 *
 * 把"业务函数 → MCP 响应对象"的格式转换 + 结构化错误处理 + 标识符注入抽象成单一入口，
 * 保证 4 个读工具（query_change / list_branches / get_change_comments / search_changes）
 * 与未来 8 个写工具的注册逻辑一致，不至于在 index.ts 重复书写 try/catch 与 JSON 序列化。
 *
 * 关键契约：
 *   - 业务函数 throw StructuredError 时，wrapper 输出 `{ content: [...], isError: true }`，
 *     content 中 JSON 包含 error_type / message / http_status / details 四字段
 *   - 业务函数 throw 任意非 StructuredError 时（含 `throw "string"` / `throw null` / 普通 Error），
 *     先经 `withErrorHandling` 兜底转成 StructuredError("internal_error")，再走上述路径
 *   - **Property 5**：错误 message 中保证 identifierExtractor 返回的全部标识符（如 change_id /
 *     project / pattern）作为子串出现；若已含则不重复注入，否则在 message 末尾追加
 *     `[<toolName>: <id1>, <id2>...]`
 *   - 业务函数成功返回 T 时，wrapper 输出 `{ content: [{ type: "text", text: JSON.stringify(T, null, 2) }] }`
 *     （pretty-print，避免 LLM 在阅读时被压缩 JSON 影响）
 *
 * 不依赖 MCP SDK 类型——返回 plain object，靠 `(server.tool as any)(...)` 在调用侧绕过类型检查
 * （与 zmind-mcp-server / opengrok-mcp-server 一致）。
 */

import { StructuredError, withErrorHandling } from "./errors.js";

// =============================================================================
// 类型
// =============================================================================

/**
 * 标识符抽取器。从 MCP 入参中抽取必须保留在错误消息内的字符串列表。
 *
 * - 返回单个字符串：作为唯一标识符（如 query_change 的 change_id）
 * - 返回数组：每个元素都视为独立标识符，wrapper 会逐个检查是否已出现在 message 中
 *
 * 空字符串元素会被忽略（避免 `undefined → ""` 时把空串注入消息）。
 */
export type IdentifierExtractor<TArgs> = (args: TArgs) => string | string[];

/**
 * MCP 工具 handler 的统一返回结构（与 zmind-mcp-server 等保持一致）。
 *
 * 用 `as const` 约束 type 字段，确保 MCP SDK 校验通过。
 */
export interface ToolResponse {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

// =============================================================================
// 内部辅助
// =============================================================================

/**
 * 把 IdentifierExtractor 的输出规范化为非空字符串数组。
 *
 * 任何 `""` / `null` / `undefined` 元素被丢弃，避免污染错误消息。
 */
function normalizeIdentifiers(raw: string | string[] | null | undefined): string[] {
  if (raw === null || raw === undefined) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.filter((s): s is string => typeof s === "string" && s.length > 0);
}

/**
 * 将业务错误的 message 与标识符合并。
 *
 * 规则：
 *   - 若 base message 已包含某标识符（substring），则不重复注入（避免冗长重复）
 *   - 否则把所有缺失的标识符以 `[<toolName>: <id1>, <id2>...]` 形式追加到 message 末尾
 *   - identifiers 为空数组时直接返回原 message
 */
function enrichErrorMessage(
  baseMessage: string,
  toolName: string,
  identifiers: string[],
): string {
  if (identifiers.length === 0) return baseMessage;
  const missing = identifiers.filter((id) => !baseMessage.includes(id));
  if (missing.length === 0) return baseMessage;
  return `${baseMessage} [${toolName}: ${missing.join(", ")}]`;
}

// =============================================================================
// 主入口
// =============================================================================

/**
 * 将一个业务函数包装成 MCP 工具的 handler。
 *
 * @param toolName             工具名（如 "query_change"），仅用于错误消息中的标记，不参与路由
 * @param identifierExtractor  从 MCP 入参中抽取要保留在错误消息内的标识符
 * @param fn                   业务实现；返回值会被 JSON.stringify 后写入 MCP text content
 *
 * @returns MCP 入口 handler，签名 `(args: TArgs) => Promise<ToolResponse>`
 */
export function wrapToolHandler<TArgs, TResult>(
  toolName: string,
  identifierExtractor: IdentifierExtractor<TArgs>,
  fn: (args: TArgs) => Promise<TResult> | TResult,
): (args: TArgs) => Promise<ToolResponse> {
  return async (args: TArgs): Promise<ToolResponse> => {
    try {
      const result = await withErrorHandling(() => fn(args));
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: unknown) {
      // withErrorHandling 已将任意 throw 统一封装为 StructuredError。
      // 这里的 instanceof 分支既是文档说明也是防御（理论上 else 分支不可达）。
      if (err instanceof StructuredError) {
        const identifiers = normalizeIdentifiers(identifierExtractor(args));
        const enrichedMessage = enrichErrorMessage(err.message, toolName, identifiers);

        const payload = {
          error_type: err.error_type,
          message: enrichedMessage,
          http_status: err.http_status ?? null,
          details: err.details,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          isError: true,
        };
      }
      // Defensive fallback：万一 withErrorHandling 失效，也不向 MCP 客户端泄露未捕获异常
      const fallbackMessage = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error_type: "internal_error",
                message: enrichErrorMessage(
                  fallbackMessage,
                  toolName,
                  normalizeIdentifiers(identifierExtractor(args)),
                ),
                http_status: null,
                details: { unwrapped: true },
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
  };
}
