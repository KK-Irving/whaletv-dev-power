/**
 * Reviewer / Code-Review 标签管理工具。
 *
 * 提供 3 个工具函数：
 *   - addReviewer:     POST /changes/{id}/reviewers                 添加 Reviewer
 *   - removeReviewer:  DELETE /changes/{id}/reviewers/{reviewer-id} 移除 Reviewer
 *   - setReviewLabel:  POST /changes/{id}/revisions/current/review  设置 Code-Review / Verified 等标签
 *
 * 设计要点：
 *   - 入参非空校验在工具层进行（与 src/index.ts 的 zod schema 形成双重保险，避免直接调用本模块时绕过）
 *   - 路径参数（change_id、reviewer）使用 `encodeURIComponent` 编码，覆盖 `@` `+` `~` 等特殊字符
 *   - 标签值范围 `[-2, +2]` 在工具层亦做校验（Property 13；与 zod schema 对齐）
 *   - HTTP 错误（401/403/404/422 等）由底层 `gerritPost/Delete` 统一抛 StructuredError；
 *     本层捕获后**重新抛出**并在 message 前缀注入 change_id / reviewer / label，
 *     满足 Property 5（错误消息保留原始输入标识符）。error_type / http_status 不变。
 *
 * 不在 `src/index.ts` 注册 MCP 工具（统一由任务 5.9 的注册步骤处理）。
 */

import { gerritDelete, gerritPost } from "../http-client.js";
import { StructuredError } from "../errors.js";

// =============================================================================
// 内部类型：Gerrit 响应模型
// =============================================================================

/**
 * Gerrit `POST /changes/{id}/reviewers` 的响应结构（仅取本工具用到的字段）。
 *
 * 文档：https://gerrit-review.googlesource.com/Documentation/rest-api-changes.html#add-reviewer
 *
 * 字段语义：
 *   - reviewers: 被成功加为 Reviewer 的账号条目（一般长度 1，组添加可能多条）
 *   - ccs:       被加为 CC（仅观察）的账号；当 reviewer 是组且策略要求只能加 CC 时使用
 *   - error:     Gerrit 拒绝原因（账号无效等场景）；HTTP 仍可能为 200
 *   - confirm:   `true` 表示是组添加需要二次确认；本工具不支持二次确认流程
 */
interface GerritAddReviewerResult {
  input?: string;
  reviewers?: GerritAddReviewerEntry[];
  ccs?: GerritAddReviewerEntry[];
  error?: string;
  confirm?: boolean;
}

interface GerritAddReviewerEntry {
  _account_id?: number;
  name?: string;
  email?: string;
  username?: string;
  display_name?: string;
}

// =============================================================================
// 内部辅助：错误消息上下文注入
// =============================================================================

/**
 * 把底层 StructuredError 重新抛出，message 前缀加入工具层上下文。
 *
 * 保留原 error_type / http_status / details，仅修改 message。这样：
 *   - Property 5 满足：上下文（change_id / reviewer / label）必出现在 message 中
 *   - 上层 dispatcher 仍能通过 error_type 对 401/403/404 做分类提示
 *   - 非 StructuredError 的兜底由 src/index.ts 的 withErrorHandling 统一处理
 */
function rewrapWithContext(err: unknown, contextPrefix: string): never {
  if (err instanceof StructuredError) {
    throw new StructuredError(
      err.error_type,
      `${contextPrefix}: ${err.message}`,
      err.http_status,
      err.details,
    );
  }
  throw err;
}

// =============================================================================
// 1. addReviewer
// =============================================================================

/**
 * 向 Change 添加一名 Reviewer。
 *
 * @param args.change_id Change 标识符（Change-Id 字符串、Change Number 或 project~branch~changeId 三元组）
 * @param args.reviewer  email / username / account-id（任一形式 Gerrit 都接受）
 *
 * @throws StructuredError("internal_error") 当 reviewer 标识符为空或仅含空白
 * @throws StructuredError(...)              HTTP 错误（401/403/404/422 等）由底层抛出后透传
 */
export async function addReviewer(args: {
  change_id: string;
  reviewer: string;
}): Promise<{ account_id: number; display_name: string; change_id: string }> {
  if (typeof args.reviewer !== "string" || args.reviewer.trim().length === 0) {
    throw new StructuredError("internal_error", "Reviewer 标识符不可为空");
  }

  const path = `/changes/${encodeURIComponent(args.change_id)}/reviewers`;
  const contextPrefix = `添加 Reviewer ${args.reviewer} 到 Change ${args.change_id} 失败`;

  let result: GerritAddReviewerResult;
  try {
    result = await gerritPost<GerritAddReviewerResult>(path, { reviewer: args.reviewer });
  } catch (err) {
    rewrapWithContext(err, contextPrefix);
  }

  // Gerrit 在 200 OK 中通过 `error` 字段拒绝（如账号不存在的某些 Gerrit 版本不返 422 而走该字段）
  if (result!.error && result!.error.length > 0) {
    throw new StructuredError(
      "not_found",
      `${contextPrefix}: ${result!.error}`,
      undefined,
      { input: result!.input, gerrit_error: result!.error },
    );
  }

  // 组 reviewer 需要二次确认时，Gerrit 返回 confirm:true 而不直接添加；本工具不支持该流程
  if (result!.confirm === true) {
    throw new StructuredError(
      "internal_error",
      `${contextPrefix}: Gerrit 要求二次确认（可能为组 reviewer），本工具暂不支持`,
      undefined,
      { input: result!.input, confirm: true },
    );
  }

  // 优先取 reviewers[0]；当 reviewer 因策略只能加为 CC 时退化到 ccs[0]
  const entry =
    (result!.reviewers && result!.reviewers[0]) ?? (result!.ccs && result!.ccs[0]);
  if (!entry || typeof entry._account_id !== "number") {
    throw new StructuredError(
      "internal_error",
      `${contextPrefix}: Gerrit 未返回有效账号信息`,
      undefined,
      { result: result! },
    );
  }

  return {
    account_id: entry._account_id,
    display_name:
      entry.name ?? entry.display_name ?? entry.username ?? entry.email ?? args.reviewer,
    change_id: args.change_id,
  };
}

// =============================================================================
// 2. removeReviewer
// =============================================================================

/**
 * 从 Change 移除一名 Reviewer。
 *
 * Gerrit 在 reviewer-id 上接受 email / username / numeric account-id，URL 编码后即可。
 * 成功为 HTTP 204 No Content（响应体为空）。
 *
 * @throws StructuredError("internal_error") 当 reviewer 标识符为空或仅含空白
 * @throws StructuredError(...)              HTTP 错误透传（404 → not_found、403 → permission_denied 等）
 */
export async function removeReviewer(args: {
  change_id: string;
  reviewer: string;
}): Promise<{ ok: true; change_id: string; reviewer: string }> {
  if (typeof args.reviewer !== "string" || args.reviewer.trim().length === 0) {
    throw new StructuredError("internal_error", "Reviewer 标识符不可为空");
  }

  const path =
    `/changes/${encodeURIComponent(args.change_id)}` +
    `/reviewers/${encodeURIComponent(args.reviewer)}`;
  const contextPrefix = `从 Change ${args.change_id} 移除 Reviewer ${args.reviewer} 失败`;

  try {
    await gerritDelete(path);
  } catch (err) {
    rewrapWithContext(err, contextPrefix);
  }

  return {
    ok: true,
    change_id: args.change_id,
    reviewer: args.reviewer,
  };
}

// =============================================================================
// 3. setReviewLabel
// =============================================================================

/**
 * 在 Change 的当前 patch set 上设置一个标签值（如 Code-Review / Verified）。
 *
 * 调用 Gerrit `POST /changes/{id}/revisions/current/review`，body 形如：
 *   { "labels": { "Code-Review": +1 } }
 *
 * @param args.label 标签名（如 "Code-Review"、"Verified"），不可为空
 * @param args.value 整数，范围 -2..+2
 *
 * @throws StructuredError("internal_error") label 为空 / value 非整数 / value 超范围
 * @throws StructuredError(...)              HTTP 错误透传（403 → permission_denied 等）
 */
export async function setReviewLabel(args: {
  change_id: string;
  label: string;
  value: number;
}): Promise<{ ok: true; change_id: string; label: string; value: number }> {
  // ① 标签值范围（与 zod schema 对齐；Property 13 双重保险）
  if (!Number.isInteger(args.value) || args.value < -2 || args.value > 2) {
    throw new StructuredError(
      "internal_error",
      `标签值超出 -2 至 +2 范围: ${args.value}`,
    );
  }

  // ② 标签名非空
  if (typeof args.label !== "string" || args.label.trim().length === 0) {
    throw new StructuredError("internal_error", "标签名不可为空");
  }

  const path = `/changes/${encodeURIComponent(args.change_id)}/revisions/current/review`;
  const body = {
    labels: {
      [args.label]: args.value,
    },
  };
  const contextPrefix = `在 Change ${args.change_id} 设置标签 ${args.label}=${args.value} 失败`;

  try {
    await gerritPost(path, body);
  } catch (err) {
    rewrapWithContext(err, contextPrefix);
  }

  return {
    ok: true,
    change_id: args.change_id,
    label: args.label,
    value: args.value,
  };
}
