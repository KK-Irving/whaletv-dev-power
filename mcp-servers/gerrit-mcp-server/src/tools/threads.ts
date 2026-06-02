/**
 * get_unresolved_threads 工具：返回当前 change 上**未解决的 thread**（不是单条评论）。
 *
 * 使用场景：
 *   AI 处理 PR/CR 评论时调用本工具拿到 unresolved thread 列表 → 针对每个 thread 生成回复 →
 *   用 thread.root_uuid 喂给 submit_review_reply 的 in_reply_to → 触发 thread 真正闭环。
 *
 * 与 get_change_comments 的差异：
 *   - get_change_comments：走 SSH `gerrit query --comments`，快速展示，不含 uuid / unresolved
 *   - get_unresolved_threads：走 SSH git fetch NoteDb meta ref，慢但含完整 thread 视图
 *
 * 实现概要：
 *   1. 通过 queryChange 拿到 project name + currentPatchSet.revision
 *   2. fetchAndParseNoteDb 拉 meta ref 并解析全部评论
 *   3. buildThreads 重建 thread 视图
 *   4. 过滤出 is_unresolved === true 的 thread，组装成对外友好的格式
 *
 * 不做的事：
 *   - 不写 NoteDb（写入只能走 gerrit review --json）
 *   - 不缓存（每次调用都 fresh fetch；Gerrit 那边状态可能在调用间发生变化）
 *   - 不返回 resolved thread（避免噪声；如要全量 thread 视图可后续加参数）
 */

import { sshGerritJson } from "../ssh-client.js";
import { StructuredError } from "../errors.js";
import { fetchAndParseNoteDb, buildThreads } from "../note-db.js";

// =============================================================================
// 出参类型（暴露给 MCP 客户端）
// =============================================================================

/** 单条评论的对外视图（不暴露 NoteDb 内部 server-only 字段如 serverId） */
export interface ThreadCommentView {
  uuid: string;
  author_id: number;
  author_username?: string;
  /** ISO 8601 */
  written_on: string;
  message: string;
  unresolved: boolean;
  /** 父评论 uuid（root 评论无此字段） */
  parent_uuid?: string;
}

/** 单个未解决 thread 的对外视图 */
export interface UnresolvedThreadView {
  /** 直接用作 in_reply_to 喂给 submit_review_reply */
  root_uuid: string;
  file: string;
  /** patchset-level 评论这里返回 0；具体文件评论是行号 */
  line: number;
  /** root 评论的作者 account_id（gerrit-ai 是 1000192） */
  root_author_id: number;
  /** root 评论文本，AI 据此生成回复 */
  root_message: string;
  /** root 评论时间 */
  root_written_on: string;
  /** thread 完整链（按时间升序）；通常只有 1 条（gerrit-ai 原评论） */
  chain: ThreadCommentView[];
  /** 链的最末一条（决定 thread 状态）；冗余但便于 AI 直接读 */
  latest: ThreadCommentView;
}

export interface GetUnresolvedThreadsResult {
  change_id: string;
  /** Gerrit project 名（用作下次 submit_review_reply 时的上下文） */
  project: string;
  /** 当前 patch set 编号 */
  current_patch_set: number;
  /** 当前 patch set 的 commit SHA-1 */
  current_revision: string;
  /** 该 patch set 上的全部 thread 数（含已解决） */
  total_threads: number;
  /** 未解决 thread 数 */
  unresolved_thread_count: number;
  /** 未解决 thread 列表 */
  unresolved_threads: UnresolvedThreadView[];
}

// =============================================================================
// SSH query change 拿 project + revision
// =============================================================================

interface MinimalChangeInfo {
  project?: string;
  number?: number;
  currentPatchSet?: { number?: number; revision?: string };
}

async function fetchProjectAndRevision(changeId: string): Promise<{
  project: string;
  changeNumber: number;
  patchSet: number;
  revision: string;
}> {
  const trimmed = changeId.trim();
  if (trimmed.length === 0) {
    throw new StructuredError("internal_error", "change_id 不可为空");
  }
  if (/[\s`"'\\]/.test(trimmed)) {
    throw new StructuredError(
      "internal_error",
      `change_id 包含非法字符: ${trimmed}`,
    );
  }

  const { rows } = await sshGerritJson<MinimalChangeInfo>([
    "gerrit",
    "query",
    "--format=JSON",
    "--current-patch-set",
    `change:${trimmed}`,
  ]);
  if (rows.length === 0) {
    throw new StructuredError(
      "not_found",
      `Change 不存在或不可见: change_id=${changeId}`,
      404,
    );
  }
  const c = rows[0];
  if (
    typeof c.project !== "string" ||
    c.project.length === 0 ||
    typeof c.number !== "number" ||
    typeof c.currentPatchSet?.number !== "number" ||
    typeof c.currentPatchSet?.revision !== "string"
  ) {
    throw new StructuredError(
      "internal_error",
      `gerrit query 返回缺少必要字段（project / number / currentPatchSet）: change_id=${changeId}`,
      undefined,
      { received: c },
    );
  }
  return {
    project: c.project,
    changeNumber: c.number,
    patchSet: c.currentPatchSet.number,
    revision: c.currentPatchSet.revision,
  };
}

// =============================================================================
// 主入口：getUnresolvedThreads
// =============================================================================

/**
 * 获取一个 Change 当前 patch set 上的所有未解决 thread。
 *
 * @param args.change_id           Change-Id 字符串（如 "Ixxx..."）或 Change Number（如 "114401"）
 * @param args.include_resolved    可选；默认 false（只返回未解决）；true 时返回所有 thread
 * @param args.author_id_filter    可选；只保留指定 author_id 的 root 评论的 thread（如 1000192 = gerrit-ai）
 *
 * @returns GetUnresolvedThreadsResult，包含 unresolved_threads 列表
 *
 * @throws StructuredError("not_found")  Change 不存在 / meta ref 为空
 * @throws StructuredError(...)          SSH 错误透传
 */
export async function getUnresolvedThreads(args: {
  change_id: string;
  include_resolved?: boolean;
  author_id_filter?: number;
}): Promise<GetUnresolvedThreadsResult> {
  const { project, changeNumber, patchSet, revision } =
    await fetchProjectAndRevision(args.change_id);

  // Fetch + parse NoteDb meta ref
  const records = await fetchAndParseNoteDb({
    changeNumber,
    patchSetCommitSha: revision,
    projectName: project,
  });

  // 重建 thread 视图
  const threads = buildThreads(records);
  const totalThreads = threads.length;

  // 过滤
  const includeResolved = args.include_resolved === true;
  const filtered = threads.filter((t) => {
    if (!includeResolved && !t.is_unresolved) return false;
    if (
      typeof args.author_id_filter === "number" &&
      t.root.author?.id !== args.author_id_filter
    ) {
      return false;
    }
    return true;
  });

  const unresolvedThreads: UnresolvedThreadView[] = filtered.map((t) => {
    const chain: ThreadCommentView[] = t.chain.map((c) => ({
      uuid: c.key.uuid,
      author_id: c.author?.id ?? 0,
      written_on: c.writtenOn,
      message: c.message,
      unresolved: c.unresolved === true,
      parent_uuid: c.parentUuid,
    }));
    return {
      root_uuid: t.root.key.uuid,
      file: t.root.key.filename,
      line: typeof t.root.lineNbr === "number" ? t.root.lineNbr : 0,
      root_author_id: t.root.author?.id ?? 0,
      root_message: t.root.message,
      root_written_on: t.root.writtenOn,
      chain,
      latest: chain[chain.length - 1],
    };
  });

  return {
    change_id: args.change_id,
    project,
    current_patch_set: patchSet,
    current_revision: revision,
    total_threads: totalThreads,
    unresolved_thread_count: unresolvedThreads.filter((t) =>
      t.latest.unresolved === true,
    ).length,
    unresolved_threads: unresolvedThreads,
  };
}
