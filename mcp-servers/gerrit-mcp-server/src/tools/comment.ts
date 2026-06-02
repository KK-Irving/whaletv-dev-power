/**
 * Gerrit 评论写操作工具集 (SSH 通道)。
 *
 * 背景：本环境 nginx 双层认证使 REST `/a/...` 不可用，全部走 SSH `gerrit review --json`。
 * 实证（2026-06，change 114401）：
 *   - cover message + tag + notify=NONE 通过 stdin JSON 注入工作正常
 *   - inline comments[file][{line, message, unresolved}] 通过 stdin JSON 注入工作正常
 *   - 单次 review 可同时提交多条 inline + cover message + label 设置（即 Web UI "REPLY" 语义）
 *   - unresolved=false 在 Web UI 上正确显示为 "resolved"
 *   - UTF-8 / 中文 / emoji 通过 Buffer 写 stdin 完整保留
 *
 * 关键限制（与 REST 实现的差异）：
 *   - SSH `gerrit query --comments` 不返回 comment uuid，因此 reply_inline_comment
 *     **不能用 in_reply_to=<uuid> 精确串联到历史评论**
 *   - 替代方案（与你确认的 workaround C 一致）：reply_inline_comment 接受
 *     `(change_id, file, line, message, unresolved)`，作为顶层 inline 评论发到
 *     同一 file+line。Gerrit Web UI 在视觉上把它显示在原评论附近，且 unresolved
 *     状态在 Web UI 上正确反映为 "X resolved" 计数。
 *   - patchset-level 评论（file === "/PATCHSET_LEVEL"）不接受 line 字段（即使是 0）
 *
 * 四个工具：
 *   - submitReviewReply:   ★ Web UI "REPLY" 按钮的批量等价：单次 review 提交多条 inline + cover + label
 *                            处理 5 条 gerrit-ai 评论的标准方式，触发 1 次 OWNER 通知（不是 5 次）
 *   - addReviewComment:    cover-level 评论（gerrit review --json + {message, tag, notify}）
 *   - replyInlineComment:  单条 inline 回复（适合只回复 1 条评论的小流程）
 *   - markCommentResolved: 单条 mark resolved（同上）
 *
 * 错误处理：
 *   - 评论文本空白校验（Property 12）
 *   - SSH 子进程错误统一映射到 StructuredError（由 ssh-client.ts 处理）
 *   - 错误消息保留 change_id / file / line（Property 5）
 */

import { sshGerritPlain, sshGerritJson } from "../ssh-client.js";
import { StructuredError } from "../errors.js";

// =============================================================================
// 常量
// =============================================================================

/** 评论文本最大字符数；超出即拒绝。 */
const COMMENT_MESSAGE_MAX_CHARS = 16384;

/** 单次批量回复中最多 inline 评论条数（防止超大 payload）。 */
const MAX_INLINE_REPLIES_PER_BATCH = 50;

/** 合法 Gerrit 标签集合（用于 submit_review_reply 入参校验）。 */
const KNOWN_LABELS = ["Code-Review", "Verified"];

/** Notify 取值集合。 */
const NOTIFY_VALUES = ["NONE", "OWNER", "OWNER_REVIEWERS", "ALL"] as const;
type NotifyLevel = (typeof NOTIFY_VALUES)[number];

/** Gerrit review --json 接受的 ReviewInput 通用字段 */
interface ReviewInputBase {
  message?: string;
  tag?: string;
  notify?: NotifyLevel;
  comments?: Record<string, ReviewInputInlineComment[]>;
  labels?: Record<string, number>;
}

interface ReviewInputInlineComment {
  /** patchset-level 评论不能传 line（Gerrit 拒绝）；具体文件评论必须传。 */
  line?: number;
  message: string;
  unresolved?: boolean;
  /** 可选；SSH query 不返回 uuid，因此通常不传 */
  in_reply_to?: string;
}

// =============================================================================
// 内部辅助
// =============================================================================

/** 校验评论文本（Property 12）。 */
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
 * 提交 ReviewInput JSON 到 gerrit review。
 *
 * 第二个参数是 `<change-or-commit>,<patchset>` 字符串（gerrit review 命令位置参数）。
 * 当 patchSet 为 undefined 时使用 `current` —— SSH 不接受 "current"，需显式给数字；
 * 因此这种情况下需要先用 query 拿到 currentPatchSet.number。
 */
async function submitReview(
  changeId: string,
  patchSet: number,
  body: ReviewInputBase,
): Promise<void> {
  const json = JSON.stringify(body);
  const buf = Buffer.from(json, "utf8");
  await sshGerritPlain(
    [
      "gerrit",
      "review",
      "--json",
      `${escapeIdentifier(changeId)},${patchSet}`,
    ],
    buf,
  );
}

/**
 * 转义 Gerrit identifier（Change-Id / Change Number）。
 *
 * 不允许空格 / 引号 / 反引号 / 反斜杠，因为 spawn 数组传参不经 shell，但
 * gerrit 命令本身的 token 解析对这些字符敏感。
 */
function escapeIdentifier(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    throw new StructuredError("internal_error", "change_id 不可为空");
  }
  if (/[\s`"'\\]/.test(trimmed)) {
    throw new StructuredError(
      "internal_error",
      `change_id 包含非法字符: ${trimmed}`,
    );
  }
  return trimmed;
}

/**
 * 取 change 的 currentPatchSet.number；若调用方未提供 patch_set 时使用。
 *
 * 不引入 query.ts 的 queryChange 来避免循环依赖；直接走 ssh-client.ts。
 */
async function resolveCurrentPatchSet(changeId: string): Promise<number> {
  const { rows } = await sshGerritJson<{ currentPatchSet?: { number?: number } }>([
    "gerrit",
    "query",
    "--format=JSON",
    "--current-patch-set",
    `change:${escapeIdentifier(changeId)}`,
  ]);
  if (rows.length === 0) {
    throw new StructuredError(
      "not_found",
      `Change 不存在或不可见: change_id=${changeId}`,
      404,
    );
  }
  const ps = rows[0].currentPatchSet?.number;
  if (typeof ps !== "number" || !Number.isFinite(ps) || ps <= 0) {
    throw new StructuredError(
      "internal_error",
      `Change ${changeId} 缺少 currentPatchSet.number`,
    );
  }
  return ps;
}

// =============================================================================
// 1. addReviewComment
// =============================================================================

/**
 * 向 Change 的指定 patch set（默认 current）添加 review-cover 评论。
 *
 * 因 SSH 不返回新 message id，这里**不再返回 comment_id**，仅返回
 * `{ ok: true, change_id, patch_set }` 让上层确认提交成功即可。
 *
 * @throws StructuredError("internal_error") message 校验失败
 * @throws StructuredError(...)              SSH 错误透传
 */
export async function addReviewComment(args: {
  change_id: string;
  message: string;
  patch_set?: number;
}): Promise<{ ok: true; change_id: string; patch_set: number }> {
  validateCommentMessage(args.message);

  const patchSet =
    typeof args.patch_set === "number" && args.patch_set > 0
      ? args.patch_set
      : await resolveCurrentPatchSet(args.change_id);

  await submitReview(args.change_id, patchSet, {
    message: args.message,
    tag: "autogenerated:gerrit-mcp-server:add_review_comment",
    notify: "OWNER",
  });

  return { ok: true, change_id: args.change_id, patch_set: patchSet };
}

// =============================================================================
// 2. replyInlineComment（file+line anchor，与你确认的 workaround C）
// =============================================================================

/**
 * 在指定 file+line 上发布 inline 评论（可同时 unresolved=false 来 mark resolved）。
 *
 * 与 REST 实现的差异：
 *   - 不再接受 parent_comment_id（SSH 拿不到 uuid）
 *   - 接受 file+line 作为 anchor；Gerrit Web UI 会把回复显示在该位置原评论附近
 *   - in_reply_to 字段可选；如果调用方从浏览器 Inspect 取到了 uuid 可以传，否则留空
 *
 * @throws StructuredError("internal_error") message 校验失败 / file 为空 / line 非法
 * @throws StructuredError(...)              SSH 错误透传
 */
export async function replyInlineComment(args: {
  change_id: string;
  file: string;
  line: number;
  message: string;
  unresolved?: boolean;
  patch_set?: number;
  in_reply_to?: string;
}): Promise<{ ok: true; change_id: string; file: string; line: number; patch_set: number }> {
  validateCommentMessage(args.message);

  if (typeof args.file !== "string" || args.file.trim().length === 0) {
    throw new StructuredError("internal_error", "file 不可为空");
  }
  if (!Number.isInteger(args.line) || args.line < 0) {
    throw new StructuredError(
      "internal_error",
      `line 必须为非负整数: ${args.line}（patchset-level 评论用 line=0 + file=/PATCHSET_LEVEL）`,
    );
  }

  const patchSet =
    typeof args.patch_set === "number" && args.patch_set > 0
      ? args.patch_set
      : await resolveCurrentPatchSet(args.change_id);

  const inline: ReviewInputInlineComment = {
    line: args.line,
    message: args.message,
    unresolved: args.unresolved ?? true,
  };
  if (args.in_reply_to) inline.in_reply_to = args.in_reply_to;

  await submitReview(args.change_id, patchSet, {
    tag: "autogenerated:gerrit-mcp-server:reply_inline_comment",
    notify: "OWNER",
    comments: {
      [args.file]: [inline],
    },
  });

  return {
    ok: true,
    change_id: args.change_id,
    file: args.file,
    line: args.line,
    patch_set: patchSet,
  };
}

// =============================================================================
// 3. markCommentResolved（file+line anchor）
// =============================================================================

/**
 * 把指定 file+line 上的 inline 评论标记为 resolved。
 *
 * 实现：发送 unresolved=false 的 inline 评论到该 file+line，Gerrit 会把
 * 该位置的所有未解决评论标记为 resolved（实证：change 114401 上验证有效）。
 *
 * @param args.message 可选；不传则用默认文本 "已标记为 resolved"
 *
 * @throws StructuredError("internal_error") file 为空 / line 非法
 * @throws StructuredError(...)              SSH 错误透传
 */
export async function markCommentResolved(args: {
  change_id: string;
  file: string;
  line: number;
  message?: string;
  patch_set?: number;
}): Promise<{ ok: true; change_id: string; file: string; line: number; patch_set: number }> {
  if (typeof args.file !== "string" || args.file.trim().length === 0) {
    throw new StructuredError("internal_error", "file 不可为空");
  }
  if (!Number.isInteger(args.line) || args.line < 0) {
    throw new StructuredError(
      "internal_error",
      `line 必须为非负整数: ${args.line}`,
    );
  }

  const finalMessage =
    typeof args.message === "string" && args.message.trim().length > 0
      ? args.message
      : "已标记为 resolved";

  return replyInlineComment({
    change_id: args.change_id,
    file: args.file,
    line: args.line,
    message: finalMessage,
    unresolved: false,
    patch_set: args.patch_set,
  });
}


// =============================================================================
// 4. submitReviewReply（★ Web UI "REPLY" 按钮的批量等价）
// =============================================================================

/**
 * 单条 inline 回复入参（submitReviewReply 内的元素）。
 */
export interface InlineReplyEntry {
  /** 文件路径（与 get_change_comments 返回的 path 字段一致），或 "/PATCHSET_LEVEL" */
  file: string;
  /**
   * 行号；patchset-level 评论不传 line（Gerrit 拒绝带 line 的 patchset-level 评论）。
   * 具体文件评论必须传非负整数。
   */
  line?: number;
  /** 回复文本，1..16384 字符。 */
  message: string;
  /** 是否标记 unresolved；undefined 等价 false（即默认标记为 resolved）。 */
  unresolved?: boolean;
  /** 可选 comment uuid（仅当 Developer 从 Web UI 拿到 uuid 时传）。 */
  in_reply_to?: string;
}

/**
 * 批量提交 review 回复，对应 Web UI "REPLY" 按钮的语义。
 *
 * 一次 SSH `gerrit review --json` 调用同时提交：
 *   - 多条 inline 回复（含 unresolved 标记）
 *   - 可选的 cover message（review log 上的整体留言）
 *   - 可选的 label 设置（如 Code-Review +1）
 *   - 单次 OWNER 通知（默认 OWNER；可显式指定 NONE/OWNER_REVIEWERS/ALL）
 *
 * 用法（处理 5 条 gerrit-ai 评论的标准方式）：
 * ```
 * submit_review_reply({
 *   change_id: "114401",
 *   cover_message: "已处理所有 gerrit-ai 评论，详见 inline。",
 *   inline_replies: [
 *     { file: "/PATCHSET_LEVEL", message: "已采纳建议 ...", unresolved: false },
 *     { file: "src/foo.c", line: 42, message: "已修复 ...", unresolved: false },
 *     ...
 *   ],
 *   labels: { "Code-Review": -1 },  // 可选；如果还想等 AI 再 review 一轮
 *   notify: "OWNER",                 // 默认即 OWNER
 * })
 * ```
 *
 * 实证（change 114401，4 条 patchset-level + 1 条 file:25）：单次 SSH 调用全部
 * 成功提交，Web UI 显示为一次合并 review，unresolved 计数从 5 降到 0。
 *
 * @throws StructuredError("internal_error") inline_replies 为空 / 元素校验失败 / 标签值越界
 * @throws StructuredError("not_found")      change_id 不存在（resolveCurrentPatchSet 触发）
 * @throws StructuredError(...)              SSH 错误透传
 */
export async function submitReviewReply(args: {
  change_id: string;
  inline_replies: InlineReplyEntry[];
  cover_message?: string;
  labels?: Record<string, number>;
  notify?: NotifyLevel;
  patch_set?: number;
}): Promise<{
  ok: true;
  change_id: string;
  patch_set: number;
  submitted_inline_count: number;
  cover_message_included: boolean;
  labels_applied: Record<string, number> | null;
  notify: NotifyLevel;
}> {
  // ① 必备：inline_replies 非空数组
  if (!Array.isArray(args.inline_replies) || args.inline_replies.length === 0) {
    throw new StructuredError(
      "internal_error",
      "inline_replies 必须是非空数组（至少包含 1 条 inline 回复）。如仅需添加 cover message 而无 inline 回复，请改用 add_review_comment。",
    );
  }
  if (args.inline_replies.length > MAX_INLINE_REPLIES_PER_BATCH) {
    throw new StructuredError(
      "internal_error",
      `inline_replies 超出单批 ${MAX_INLINE_REPLIES_PER_BATCH} 条上限（实际 ${args.inline_replies.length}）。请分批提交。`,
    );
  }

  // ② cover_message（可选）非空白校验
  let coverMessage: string | undefined;
  if (typeof args.cover_message === "string") {
    const trimmed = args.cover_message.trim();
    if (trimmed.length === 0) {
      throw new StructuredError(
        "internal_error",
        "cover_message 提供时不可为空白；如不需要 cover message 请省略该字段",
      );
    }
    if (args.cover_message.length > COMMENT_MESSAGE_MAX_CHARS) {
      throw new StructuredError(
        "internal_error",
        `cover_message 超出 ${COMMENT_MESSAGE_MAX_CHARS} 字符上限`,
      );
    }
    coverMessage = args.cover_message;
  }

  // ③ notify 校验
  const notify: NotifyLevel = args.notify ?? "OWNER";
  if (!NOTIFY_VALUES.includes(notify)) {
    throw new StructuredError(
      "internal_error",
      `notify 取值非法: ${notify}（合法值 ${NOTIFY_VALUES.join(" / ")}）`,
    );
  }

  // ④ labels 校验
  let labelsValidated: Record<string, number> | null = null;
  if (args.labels && typeof args.labels === "object") {
    labelsValidated = {};
    for (const [name, value] of Object.entries(args.labels)) {
      if (!KNOWN_LABELS.includes(name)) {
        // 未知标签不阻塞，但记录便于排查（Gerrit 会自己报 422）
        // 仍校验 value 是合法整数
      }
      if (!Number.isInteger(value) || value < -2 || value > 2) {
        throw new StructuredError(
          "internal_error",
          `label '${name}' 值越界（必须为 -2..+2 整数）: ${value}`,
        );
      }
      if (typeof name !== "string" || name.trim().length === 0) {
        throw new StructuredError("internal_error", "label 名不可为空");
      }
      if (/[\s=`"'\\]/.test(name)) {
        throw new StructuredError(
          "internal_error",
          `label 名包含非法字符: ${name}`,
        );
      }
      labelsValidated[name] = value;
    }
    if (Object.keys(labelsValidated).length === 0) labelsValidated = null;
  }

  // ⑤ inline_replies 元素校验 + 按 file 分组
  const groupedByFile: Record<string, ReviewInputInlineComment[]> = {};
  for (let i = 0; i < args.inline_replies.length; i++) {
    const entry = args.inline_replies[i];
    if (typeof entry !== "object" || entry === null) {
      throw new StructuredError(
        "internal_error",
        `inline_replies[${i}] 不是对象`,
      );
    }
    if (typeof entry.file !== "string" || entry.file.trim().length === 0) {
      throw new StructuredError(
        "internal_error",
        `inline_replies[${i}].file 不可为空`,
      );
    }
    if (typeof entry.message !== "string" || entry.message.trim().length === 0) {
      throw new StructuredError(
        "internal_error",
        `inline_replies[${i}].message 不可为空（trim 后长度为 0）`,
      );
    }
    if (entry.message.length > COMMENT_MESSAGE_MAX_CHARS) {
      throw new StructuredError(
        "internal_error",
        `inline_replies[${i}].message 超出 ${COMMENT_MESSAGE_MAX_CHARS} 字符上限`,
      );
    }

    const isPatchsetLevel = entry.file === "/PATCHSET_LEVEL";
    if (isPatchsetLevel) {
      if (entry.line !== undefined) {
        // Gerrit 显式拒绝："Patchset-level comments can't have side, range, or line"
        throw new StructuredError(
          "internal_error",
          `inline_replies[${i}]: patchset-level 评论不可携带 line 字段`,
        );
      }
    } else {
      if (!Number.isInteger(entry.line) || (entry.line as number) < 0) {
        throw new StructuredError(
          "internal_error",
          `inline_replies[${i}].line 必须为非负整数（具体文件评论）；当前值 ${entry.line}`,
        );
      }
    }

    const inline: ReviewInputInlineComment = {
      message: entry.message,
      unresolved: entry.unresolved ?? false, // 默认 false：标记为 resolved
    };
    if (!isPatchsetLevel) inline.line = entry.line;
    if (entry.in_reply_to) inline.in_reply_to = entry.in_reply_to;

    if (!groupedByFile[entry.file]) groupedByFile[entry.file] = [];
    groupedByFile[entry.file].push(inline);
  }

  // ⑥ 解析 patch set 编号
  const patchSet =
    typeof args.patch_set === "number" && args.patch_set > 0
      ? args.patch_set
      : await resolveCurrentPatchSet(args.change_id);

  // ⑦ 构造完整 ReviewInput body
  const reviewInput: ReviewInputBase = {
    tag: "autogenerated:gerrit-mcp-server:submit_review_reply",
    notify,
    comments: groupedByFile,
  };
  if (coverMessage !== undefined) reviewInput.message = coverMessage;
  if (labelsValidated !== null) reviewInput.labels = labelsValidated;

  // ⑧ 通过 SSH 单次提交
  const buf = Buffer.from(JSON.stringify(reviewInput), "utf8");
  await sshGerritPlain(
    [
      "gerrit",
      "review",
      "--json",
      `${escapeIdentifier(args.change_id)},${patchSet}`,
    ],
    buf,
  );

  return {
    ok: true,
    change_id: args.change_id,
    patch_set: patchSet,
    submitted_inline_count: args.inline_replies.length,
    cover_message_included: coverMessage !== undefined,
    labels_applied: labelsValidated,
    notify,
  };
}
