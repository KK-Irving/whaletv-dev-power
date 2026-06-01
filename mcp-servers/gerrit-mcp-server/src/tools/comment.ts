/**
 * Gerrit 评论写操作工具集。
 *
 * 提供 3 个工具函数（在 src/index.ts 中由任务 5.9 统一注册为 MCP 工具）：
 *   - addReviewComment:    POST /changes/{id}/revisions/{rev}/review               添加 review 级评论
 *   - replyInlineComment:  POST /changes/{id}/revisions/{rev}/review (含 comments)  回复 inline 评论
 *   - markCommentResolved: POST /changes/{id}/revisions/{rev}/review (unresolved=false) 将评论标记为 resolved
 *
 * 设计要点（见 design.md 第 4 节 "Comment 工具：Robot vs Review Comments 选型"）：
 *   - 全部使用 **Review Comments API**（非 Robot Comments），保证 unresolved 计数与人类评审语义一致
 *   - 添加评论后无法直接获取新 comment_id（Gerrit POST review 不直接返回），通过事后查询
 *     `/messages` 或 `/comments` 端点定位新创建的条目（按时间倒序找最近一条）
 *   - 评论文本入参做空白校验（`trim().length === 0` 拒绝）与长度上限校验（≤ 16384 字符），
 *     满足 Property 12 契约
 *   - HTTP 错误（401/403/404 等）由底层 `gerritGet/Post` 透传 StructuredError；
 *     工具层在 message 中保留 `change_id` / `parent_comment_id` / `comment_id`，满足 Property 5
 *   - 路径参数（change_id、comment_id）通过 `encodeURIComponent` 编码
 *
 * 不在 `src/index.ts` 注册 MCP 工具（统一由任务 5.9 处理）。
 */

import { gerritGet, gerritPost } from "../http-client.js";
import { StructuredError } from "../errors.js";

// =============================================================================
// 常量
// =============================================================================

/** 评论文本最大字符数；超出即拒绝（保护客户端避免发出超大 body）。 */
const COMMENT_MESSAGE_MAX_CHARS = 16384;

// =============================================================================
// 内部类型：Gerrit 响应模型（仅取本工具用到的字段）
// =============================================================================

/**
 * `GET /changes/{id}/messages` 返回的 review 级 message。
 *
 * Gerrit 在添加 review 评论后会创建一条 ChangeMessage，message 字段通常包含
 * `Patch Set N:\n\n` 前缀加上原始评论文本，因此匹配时使用 `===` 精确等价或 `includes` 子串包含。
 */
interface GerritChangeMessageInfo {
  id: string;
  /** ISO 8601 时间字符串。 */
  date: string;
  message: string;
  _revision_number?: number;
  /** Gerrit `tag` 字段标记机器生成评论；本工具不过滤。 */
  tag?: string;
  author?: { _account_id?: number; name?: string; email?: string };
}

/**
 * `GET /changes/{id}/comments` 返回结构：以文件路径为 key 的 inline 评论字典。
 *
 * 文档：https://gerrit-review.googlesource.com/Documentation/rest-api-changes.html#list-change-comments
 */
type GerritCommentMap = Record<string, GerritCommentInfo[]>;

interface GerritCommentInfo {
  id: string;
  /** ISO 8601；Gerrit 部分版本仅提供 updated。 */
  updated?: string;
  created?: string;
  message?: string;
  unresolved?: boolean;
  line?: number;
  patch_set?: number;
  /** 父评论 ID（用于 inline 评论的回复链）。 */
  in_reply_to?: string;
  author?: { _account_id?: number; name?: string; email?: string };
}

/** 在 comments map 中定位到的某条评论的归属信息（path/line/patch_set 用于后续 POST review 时填充）。 */
interface LocatedComment {
  path: string;
  line?: number;
  patch_set?: number;
}

// =============================================================================
// 内部辅助
// =============================================================================

/**
 * 校验评论文本：必须为字符串、trim 后长度 > 0、长度 ≤ COMMENT_MESSAGE_MAX_CHARS。
 *
 * 失败时抛 `StructuredError("internal_error", ...)`，与 reviewer.ts 中输入校验风格一致。
 *
 * Property 12 契约：trim().length === 0 必拒绝；非空白文本必通过校验。
 */
function validateCommentMessage(message: string): void {
  if (typeof message !== "string" || message.trim().length === 0) {
    throw new StructuredError(
      "internal_error",
      "评论文本不可为空（trim 后长度为 0）",
    );
  }
  if (message.length > COMMENT_MESSAGE_MAX_CHARS) {
    throw new StructuredError(
      "internal_error",
      `评论文本超出 ${COMMENT_MESSAGE_MAX_CHARS} 字符上限`,
    );
  }
}

/**
 * 把底层 StructuredError 重新抛出，message 前缀加入工具层上下文（含原始 change_id 等标识符）。
 *
 * 保留原 error_type / http_status / details，仅修改 message。这样：
 *   - Property 5 满足：上下文必出现在 message 中
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

/**
 * 从 commentsMap 中查找指定 ID 的评论，返回其归属（path/line/patch_set）。
 *
 * @returns 找到时返回 LocatedComment + 原始评论；找不到返回 null（由调用方决定如何报错）
 */
function locateCommentById(
  map: GerritCommentMap | null | undefined,
  commentId: string,
): { located: LocatedComment; comment: GerritCommentInfo } | null {
  if (!map || typeof map !== "object") return null;
  for (const [path, list] of Object.entries(map)) {
    if (!Array.isArray(list)) continue;
    for (const c of list) {
      if (c && c.id === commentId) {
        return {
          located: { path, line: c.line, patch_set: c.patch_set },
          comment: c,
        };
      }
    }
  }
  return null;
}

/**
 * 把评论 map 拍平为评论数组，用于按 in_reply_to 过滤新创建的回复。
 */
function flattenComments(map: GerritCommentMap | null | undefined): GerritCommentInfo[] {
  if (!map || typeof map !== "object") return [];
  const flat: GerritCommentInfo[] = [];
  for (const list of Object.values(map)) {
    if (Array.isArray(list)) flat.push(...list);
  }
  return flat;
}

/**
 * 解析 ISO 8601 时间字符串为可比较的数值。无法解析时回退为 0（最早），保证排序稳定。
 */
function parseTime(s: string | undefined): number {
  if (typeof s !== "string" || s.length === 0) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

// =============================================================================
// 1. addReviewComment
// =============================================================================

/**
 * 向 Change 的指定 patch set（默认 current）添加 review 级评论。
 *
 * 实现：
 *   1. POST /changes/{id}/revisions/{rev}/review { message }
 *   2. GET  /changes/{id}/messages 拉所有 review 级 message
 *   3. 在结果中找出与传入 message 相等或包含传入 message 的最近一条（按 date 倒序）
 *   4. 返回 `{ comment_id, created }`
 *
 * Gerrit 的 ChangeMessage.message 字段通常自带 `Patch Set N:\n\n` 前缀，故先尝试精确匹配，
 * 失败再退化为子串包含，避免误匹配早期相同文本的历史评论。
 *
 * @throws StructuredError("internal_error") message 校验失败 / 添加成功后无法定位 comment_id
 * @throws StructuredError(...)              HTTP 错误透传（401/403/404 等）
 */
export async function addReviewComment(args: {
  change_id: string;
  message: string;
  patch_set?: number;
}): Promise<{ comment_id: string; created: string }> {
  validateCommentMessage(args.message);

  const revision =
    typeof args.patch_set === "number" && Number.isFinite(args.patch_set)
      ? String(args.patch_set)
      : "current";
  const encodedId = encodeURIComponent(args.change_id);
  const reviewPath = `/changes/${encodedId}/revisions/${revision}/review`;
  const messagesPath = `/changes/${encodedId}/messages`;
  const contextPrefix = `向 Change ${args.change_id} 添加 review 评论失败`;

  // ① POST 提交评论
  try {
    await gerritPost(reviewPath, { message: args.message });
  } catch (err) {
    rewrapWithContext(err, contextPrefix);
  }

  // ② 重新拉 messages 列表，按 date 倒序找最近一条匹配
  let messages: GerritChangeMessageInfo[];
  try {
    messages = await gerritGet<GerritChangeMessageInfo[]>(messagesPath);
  } catch (err) {
    rewrapWithContext(err, `${contextPrefix}（提交后回查 messages 失败）`);
  }

  const safeMessages = Array.isArray(messages!) ? messages! : [];
  // date 倒序：最新创建的 message 最先被遍历
  const sorted = safeMessages
    .slice()
    .sort((a, b) => parseTime(b.date) - parseTime(a.date));

  // 优先精确等价；找不到再用子串包含（兼容 Gerrit `Patch Set N:\n\n<msg>` 包装）
  const exact = sorted.find((m) => m.message === args.message);
  const candidate =
    exact ?? sorted.find((m) => typeof m.message === "string" && m.message.includes(args.message));

  if (!candidate) {
    throw new StructuredError(
      "internal_error",
      `添加评论后无法定位新创建的 comment_id（change_id=${args.change_id}）`,
      undefined,
      { message_count: safeMessages.length },
    );
  }

  return { comment_id: candidate.id, created: candidate.date };
}

// =============================================================================
// 2. replyInlineComment
// =============================================================================

/**
 * 在指定 inline 评论上发布回复（可同时设置 unresolved 状态）。
 *
 * 实现：
 *   1. GET  /changes/{id}/comments 找出 parent_comment_id 所在的 path/line/patch_set
 *      - 找不到 → 抛 StructuredError(not_found, 404)
 *   2. POST /changes/{id}/revisions/{parent.patch_set ?? "current"}/review
 *           { comments: { [path]: [{ line, in_reply_to, message, unresolved }] } }
 *   3. GET  /changes/{id}/comments 再次查询，按 in_reply_to===parent_comment_id 过滤，
 *      按 updated 倒序取最新一条
 *
 * @throws StructuredError("internal_error") message 校验失败 / 回复成功后无法定位 comment_id
 * @throws StructuredError("not_found", 404) parent_comment_id 不存在
 * @throws StructuredError(...)              HTTP 错误透传
 */
export async function replyInlineComment(args: {
  change_id: string;
  parent_comment_id: string;
  message: string;
  unresolved: boolean;
}): Promise<{ comment_id: string; created: string }> {
  validateCommentMessage(args.message);

  if (typeof args.parent_comment_id !== "string" || args.parent_comment_id.length === 0) {
    throw new StructuredError("internal_error", "parent_comment_id 不可为空");
  }

  const encodedId = encodeURIComponent(args.change_id);
  const commentsPath = `/changes/${encodedId}/comments`;
  const contextPrefix = `回复评论 ${args.parent_comment_id}（Change ${args.change_id}）失败`;

  // ① 定位父评论
  let firstMap: GerritCommentMap;
  try {
    firstMap = await gerritGet<GerritCommentMap>(commentsPath);
  } catch (err) {
    rewrapWithContext(err, `${contextPrefix}（查询 comments 失败）`);
  }

  const located = locateCommentById(firstMap!, args.parent_comment_id);
  if (!located) {
    throw new StructuredError(
      "not_found",
      `评论 ID 不存在: ${args.parent_comment_id}（Change ${args.change_id}）`,
      404,
    );
  }

  // ② 提交回复
  const revision =
    typeof located.located.patch_set === "number" && Number.isFinite(located.located.patch_set)
      ? String(located.located.patch_set)
      : "current";
  const reviewPath = `/changes/${encodedId}/revisions/${revision}/review`;
  const replyEntry: {
    in_reply_to: string;
    message: string;
    unresolved: boolean;
    line?: number;
  } = {
    in_reply_to: args.parent_comment_id,
    message: args.message,
    unresolved: args.unresolved,
  };
  // 仅当父评论是 inline（line 存在）时补 line；review 级或文件级评论保持 undefined
  if (typeof located.located.line === "number") {
    replyEntry.line = located.located.line;
  }
  const reviewBody = {
    comments: {
      [located.located.path]: [replyEntry],
    },
  };

  try {
    await gerritPost(reviewPath, reviewBody);
  } catch (err) {
    rewrapWithContext(err, contextPrefix);
  }

  // ③ 回查 comments 找新建的回复（按 in_reply_to 过滤、按 updated 倒序）
  let secondMap: GerritCommentMap;
  try {
    secondMap = await gerritGet<GerritCommentMap>(commentsPath);
  } catch (err) {
    rewrapWithContext(err, `${contextPrefix}（提交后回查 comments 失败）`);
  }

  const replies = flattenComments(secondMap!).filter(
    (c) => c.in_reply_to === args.parent_comment_id,
  );
  // updated 倒序；缺失 updated 退化为 created
  replies.sort((a, b) => parseTime(b.updated ?? b.created) - parseTime(a.updated ?? a.created));

  const newest = replies[0];
  if (!newest) {
    throw new StructuredError(
      "internal_error",
      `回复评论 ${args.parent_comment_id} 后无法定位新创建的 comment_id（Change ${args.change_id}）`,
    );
  }

  return {
    comment_id: newest.id,
    created: newest.updated ?? newest.created ?? "",
  };
}

// =============================================================================
// 3. markCommentResolved
// =============================================================================

/**
 * 将一条已存在的 inline 评论标记为 resolved。
 *
 * 通过提交一条 unresolved=false 的 review 回复实现（见 design.md 第 4 节"revision API 路径选择"
 * 与 Req 12 的"reply_inline_comment（含 unresolved=false 即同时回复并 resolve）或 mark_comment_resolved"
 * 描述）。这样能与 reply_inline_comment 共享同一 Gerrit 路径，避免对 Gerrit 内部 PUT 评论端点的依赖。
 *
 * @throws StructuredError("internal_error") comment_id 为空
 * @throws StructuredError("not_found", 404) comment_id 在该 Change 上不存在
 * @throws StructuredError(...)              HTTP 错误透传
 */
export async function markCommentResolved(args: {
  change_id: string;
  comment_id: string;
}): Promise<{ ok: true }> {
  if (typeof args.comment_id !== "string" || args.comment_id.length === 0) {
    throw new StructuredError("internal_error", "comment_id 不可为空");
  }

  const encodedId = encodeURIComponent(args.change_id);
  const commentsPath = `/changes/${encodedId}/comments`;
  const contextPrefix = `标记评论 ${args.comment_id}（Change ${args.change_id}）为 resolved 失败`;

  // ① 定位目标评论
  let map: GerritCommentMap;
  try {
    map = await gerritGet<GerritCommentMap>(commentsPath);
  } catch (err) {
    rewrapWithContext(err, `${contextPrefix}（查询 comments 失败）`);
  }

  const located = locateCommentById(map!, args.comment_id);
  if (!located) {
    throw new StructuredError(
      "not_found",
      `评论 ID 不存在: ${args.comment_id}（Change ${args.change_id}）`,
      404,
    );
  }

  // ② 提交 unresolved=false 的回复
  const revision =
    typeof located.located.patch_set === "number" && Number.isFinite(located.located.patch_set)
      ? String(located.located.patch_set)
      : "current";
  const reviewPath = `/changes/${encodedId}/revisions/${revision}/review`;
  const replyEntry: {
    in_reply_to: string;
    message: string;
    unresolved: boolean;
    line?: number;
  } = {
    in_reply_to: args.comment_id,
    message: "已标记为 resolved",
    unresolved: false,
  };
  if (typeof located.located.line === "number") {
    replyEntry.line = located.located.line;
  }
  const reviewBody = {
    comments: {
      [located.located.path]: [replyEntry],
    },
  };

  try {
    await gerritPost(reviewPath, reviewBody);
  } catch (err) {
    rewrapWithContext(err, contextPrefix);
  }

  return { ok: true };
}
