/**
 * cherry_pick_change 工具：调用 Gerrit cherry-pick REST 端点，按响应分三态汇报。
 *
 * 三态判别逻辑（来自 design.md 第 4 节）：
 *   - HTTP 200 → `success`：含新 Change 的 change_id / change_number / web_url
 *   - HTTP 409 + 含 `already exists` / `no changes were made` / `nothing to cherry pick`
 *     任一关键短语（不区分大小写） → `skipped_already_merged`：reason 为响应文本
 *   - HTTP 409 + 其他文本 → `conflict`：conflicting_files 由 parseConflictingFiles 解析
 *   - HTTP 404 → 抛 StructuredError("not_found")：保留 destination_branch 与 change_id 上下文
 *   - 其他 HTTP / 网络 / 配置错误 → 透传底层 StructuredError（不修改）
 *
 * 公共导出（`classifyConflict` 与 `parseConflictingFiles`）是供 PBT 直接验证 Property 8 / 21 的纯函数。
 *
 * 设计要点：
 *   - 路径参数 `change_id` 使用 `encodeURIComponent` 编码，覆盖 `~` `+` `@` 等特殊字符
 *   - 业务侧从 `err.details.response_body` 优先读取响应体（http-client 写入的字段）；
 *     缺失时回退 `err.message`，保证调用 classifyConflict / parseConflictingFiles 不会因
 *     details 为非对象而失败
 *   - web_url 使用 `getGerritConfig`（不抛异常的版本）拼接，避免在 cherry-pick 已成功的
 *     场景下因配置访问触发 config_error；尾部 `/` 通过 `replace(/\/+$/, "")` 清理
 *   - 错误消息中保留 change_id 与 destination_branch（Property 5）
 *   - 不在 src/index.ts 注册 MCP 工具（统一由 5.9 任务处理）
 */

import { gerritPost } from "../http-client.js";
import { StructuredError } from "../errors.js";
import { getGerritConfig } from "../auth.js";
import type { CherryPickResult } from "../types.js";

// =============================================================================
// 公共纯函数（与网络解耦，便于属性测试）
// =============================================================================

/**
 * 用于识别"已存在等效提交"的关键短语集合（小写形式）。
 *
 * 任一短语在响应文本（小写化后）中作为子串出现，即视为 `skipped_already_merged`。
 * 同一输入必须产生确定性输出（Property 21）。
 */
const ALREADY_MERGED_PHRASES: readonly string[] = [
  "already exists",
  "no changes were made",
  "nothing to cherry pick",
];

/**
 * 将 Gerrit 409 响应文本分类为业务侧的两类冲突状态。
 *
 * 契约（Property 8、Property 21）：
 *   - 含 `already exists` / `no changes were made` / `nothing to cherry pick` 任一
 *     （不区分大小写） → `"skipped_already_merged"`
 *   - 否则 → `"conflict"`
 *   - 同一输入多次调用结果稳定（无副作用、不依赖外部状态）
 *
 * 边界处理：
 *   - 非字符串输入或空字符串视为 `"conflict"`（保守策略：无法证明已合入则归类为冲突）
 */
export function classifyConflict(text: string): "skipped_already_merged" | "conflict" {
  if (typeof text !== "string" || text.length === 0) return "conflict";
  const lower = text.toLowerCase();
  for (const phrase of ALREADY_MERGED_PHRASES) {
    if (lower.includes(phrase)) return "skipped_already_merged";
  }
  return "conflict";
}

/**
 * 从 Gerrit 409 冲突响应文本中解析冲突文件路径列表。
 *
 * 算法：
 *   1. 按 `\n` 切分成行
 *   2. 每行做 `trim`
 *   3. 保留同时满足以下两个条件的行：
 *      - 行尾匹配扩展名形式 `/\.[a-zA-Z0-9]+$/`
 *      - 行首不以 `cherry` / `conflict` / `merge` / `error` 开头（不区分大小写）
 *   4. 任意失败或无匹配 → 返回 `[]`
 *
 * Gerrit 冲突响应文本通常形如：
 *   `"Cherry pick failed because of merge conflict\nfoo.java\nbar.xml"`
 * 期望解析输出：`["foo.java", "bar.xml"]`。
 */
export function parseConflictingFiles(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length === 0) return false;
      // 必须以 .扩展名 结尾才视作文件路径
      if (!/\.[a-zA-Z0-9]+$/.test(line)) return false;
      // 排除以 cherry/conflict/merge/error 开头的描述性行
      if (/^(cherry|conflict|merge|error)/i.test(line)) return false;
      return true;
    });
}

// =============================================================================
// 内部辅助
// =============================================================================

/**
 * Gerrit cherrypick 端点成功响应（仅取本工具需要的字段）。
 *
 * 文档：https://gerrit-review.googlesource.com/Documentation/rest-api-changes.html#cherry-pick
 */
interface GerritCherryPickResponse {
  /** 仅 Change-Id（如 `Ixxxxxxx`），用于返回给调用方 */
  change_id: string;
  /** Change 数字编号 */
  _number: number;
  /** project 名，用于拼接 web_url */
  project: string;
}

/**
 * 拼接 Gerrit Change Web URL：`${GERRIT_URL}/c/${project}/+/${changeNumber}`。
 *
 * 使用 `getGerritConfig`（不抛异常，缺失时返回空 url）以避免在 cherry-pick 已成功
 * 的场景下因配置访问触发额外错误。`replace(/\/+$/, "")` 清理 `GERRIT_URL` 配置中
 * 可能的尾部斜杠（如 `https://gerrit.example.com/`）。
 */
function buildChangeWebUrl(project: string, changeNumber: number): string {
  const cfg = getGerritConfig();
  const baseUrl = cfg.url.replace(/\/+$/, "");
  return `${baseUrl}/c/${encodeURI(project)}/+/${changeNumber}`;
}

/**
 * 从底层 StructuredError 中提取响应体文本（用于 classifyConflict / parseConflictingFiles）。
 *
 * - http-client 在抛出 HTTP 错误时把响应体放在 `details.response_body`
 * - 若 details 不是对象或不含该字段，回退到 `err.message`（仍能复用 buildHttpErrorMessage
 *   中嵌入的响应体片段，因为 message 在 http-client 内已包含截断后的响应体）
 */
function extractResponseBody(err: StructuredError): string {
  if (err.details !== null && typeof err.details === "object") {
    const d = err.details as { response_body?: unknown };
    if (typeof d.response_body === "string") return d.response_body;
  }
  return err.message;
}

// =============================================================================
// cherryPickChange 主入口
// =============================================================================

/**
 * Cherry-pick 一个 Change 到指定目标分支。
 *
 * @param args.change_id          源 Change 标识符（Change-Id 字符串、Change Number 或
 *                                 project~branch~changeId 三元组）
 * @param args.destination_branch 目标分支名（如 `os10_mp`、`master`）
 * @param args.message            可选 commit message 覆盖；不传时 Gerrit 沿用源 commit message
 *
 * @returns CherryPickResult 三态对象（success / skipped_already_merged / conflict）
 *
 * @throws StructuredError("not_found", 404)  目标分支不存在或权限不足导致 404
 * @throws StructuredError(...)               其他 HTTP / 网络 / 配置错误透传
 */
export async function cherryPickChange(args: {
  change_id: string;
  destination_branch: string;
  message?: string;
}): Promise<CherryPickResult> {
  const path = `/changes/${encodeURIComponent(args.change_id)}/revisions/current/cherrypick`;
  const body = {
    destination: args.destination_branch,
    message: args.message,
    allow_conflicts: false,
  };

  let result: GerritCherryPickResponse;
  try {
    result = await gerritPost<GerritCherryPickResponse>(path, body);
  } catch (err) {
    if (err instanceof StructuredError) {
      // ── HTTP 409：业务侧再分类为 skipped_already_merged 或 conflict
      if (err.http_status === 409) {
        const responseBody = extractResponseBody(err);
        const classification = classifyConflict(responseBody);
        if (classification === "skipped_already_merged") {
          return {
            status: "skipped_already_merged",
            reason: responseBody,
          };
        }
        return {
          status: "conflict",
          conflicting_files: parseConflictingFiles(responseBody),
          reason: responseBody,
        };
      }

      // ── HTTP 404：目标分支不存在或权限不足；message 中保留 destination_branch 与 change_id（Property 5）
      if (err.http_status === 404) {
        throw new StructuredError(
          "not_found",
          `目标分支不存在或权限不足: ${args.destination_branch} (change_id=${args.change_id})`,
          404,
          err.details,
        );
      }
    }
    // 其他错误（401 / 403 / 5xx / network / timeout / config）透传不变
    throw err;
  }

  // ── HTTP 200：success
  return {
    status: "success",
    change_id: result.change_id,
    change_number: result._number,
    web_url: buildChangeWebUrl(result.project, result._number),
  };
}
