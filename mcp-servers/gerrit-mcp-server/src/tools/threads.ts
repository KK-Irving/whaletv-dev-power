/**
 * get_unresolved_threads 工具：返回当前 change 上**未解决的 thread**（REST 通道，v1.0.0）。
 *
 * 自 v1.0.0 起，本工具改走 REST API，不再需要 NoteDb meta ref + git fetch 的黑魔法：
 *   - GET /changes/{id}/comments 直接返回每条评论的 id / in_reply_to / unresolved
 *   - 用这些字段就能在内存里重建 thread 视图
 *   - 比 SSH NoteDb 方案少一次网络往返，且无需临时 git working dir
 *
 * 输出格式与 v0.x 保持完全兼容（root_uuid / chain / latest 字段名不变），
 * 上层 code-review-handling steering 调用方式无需修改。
 */

import { gerritGet } from "../http-client.js";
import { StructuredError } from "../errors.js";
import { queryChange } from "./query.js";

// =============================================================================
// REST API 响应类型
// =============================================================================

interface CommentInfo {
  id: string;
  author?: { _account_id?: number; name?: string; email?: string };
  /** ISO 8601 时间字符串 */
  updated: string;
  message: string;
  unresolved?: boolean;
  in_reply_to?: string;
  line?: number;
  patch_set?: number;
  side?: number;
  tag?: string;
}

// =============================================================================
// 出参类型（暴露给 MCP 客户端，与 v0.x 保持兼容）
// =============================================================================

export interface ThreadCommentView {
  uuid: string;
  author_id: number;
  author_username?: string;
  /** ISO 8601 */
  written_on: string;
  message: string;
  unresolved: boolean;
  parent_uuid?: string;
}

export interface UnresolvedThreadView {
  /** 直接用作 in_reply_to 喂给 submit_review_reply */
  root_uuid: string;
  file: string;
  /** patchset-level 评论这里返回 0；具体文件评论是行号 */
  line: number;
  root_author_id: number;
  root_message: string;
  root_written_on: string;
  /** thread 完整链（按时间升序） */
  chain: ThreadCommentView[];
  /** 链的最末一条 */
  latest: ThreadCommentView;
}

export interface GetUnresolvedThreadsResult {
  change_id: string;
  project: string;
  current_patch_set: number;
  current_revision: string;
  total_threads: number;
  unresolved_thread_count: number;
  unresolved_threads: UnresolvedThreadView[];
}

// =============================================================================
// Thread 重建
// =============================================================================

interface ThreadInternal {
  root: { file: string; comment: CommentInfo };
  chain: Array<{ file: string; comment: CommentInfo }>;
  is_unresolved: boolean;
  latest: CommentInfo;
}

/**
 * 把扁平评论按 in_reply_to 重建成 thread 视图。
 *
 * 规则：
 *   1. 没有 in_reply_to 或指向不存在 id 的评论 → root
 *   2. 沿 child index 收集所有后代
 *   3. 按 updated 升序排序
 *   4. is_unresolved = chain[最后一条].unresolved
 */
function buildThreads(
  groupedByFile: Record<string, CommentInfo[]>,
): ThreadInternal[] {
  // 全部 comment + 来源 file
  const allWithFile: Array<{ file: string; comment: CommentInfo }> = [];
  for (const [file, comments] of Object.entries(groupedByFile)) {
    for (const c of comments) {
      allWithFile.push({ file, comment: c });
    }
  }
  if (allWithFile.length === 0) return [];

  const byId = new Map<string, { file: string; comment: CommentInfo }>();
  for (const item of allWithFile) {
    byId.set(item.comment.id, item);
  }

  // 子节点索引
  const childrenByParent = new Map<
    string,
    Array<{ file: string; comment: CommentInfo }>
  >();
  for (const item of allWithFile) {
    const parentId = item.comment.in_reply_to;
    if (parentId && byId.has(parentId)) {
      const list = childrenByParent.get(parentId) ?? [];
      list.push(item);
      childrenByParent.set(parentId, list);
    }
  }

  // 找 root：无 in_reply_to 或 parent 不存在
  const roots = allWithFile.filter(
    (item) =>
      !item.comment.in_reply_to || !byId.has(item.comment.in_reply_to),
  );

  const threads: ThreadInternal[] = [];
  for (const root of roots) {
    const chain: Array<{ file: string; comment: CommentInfo }> = [];
    const visited = new Set<string>();
    const stack: Array<{ file: string; comment: CommentInfo }> = [root];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (visited.has(cur.comment.id)) continue;
      visited.add(cur.comment.id);
      chain.push(cur);
      const kids = childrenByParent.get(cur.comment.id) ?? [];
      stack.push(...kids);
    }
    chain.sort((a, b) => {
      if (a.comment.updated < b.comment.updated) return -1;
      if (a.comment.updated > b.comment.updated) return 1;
      return a.comment.id < b.comment.id
        ? -1
        : a.comment.id > b.comment.id
          ? 1
          : 0;
    });
    const latest = chain[chain.length - 1].comment;
    threads.push({
      root,
      chain,
      latest,
      is_unresolved: latest.unresolved === true,
    });
  }
  return threads;
}

// =============================================================================
// 主入口
// =============================================================================

/**
 * 获取一个 Change 当前 patch set 上的所有未解决 thread。
 *
 * @param args.change_id           Change-Id 或 Change Number
 * @param args.include_resolved    可选；默认 false（只返回未解决）
 * @param args.author_id_filter    可选；只保留指定 author_id 的 root 评论的 thread（gerrit-ai = 1000192）
 *
 * @throws StructuredError("not_found")  Change 不存在
 */
export async function getUnresolvedThreads(args: {
  change_id: string;
  include_resolved?: boolean;
  author_id_filter?: number;
}): Promise<GetUnresolvedThreadsResult> {
  // 先拿 change 元信息（project / current_revision / current_patch_set）
  const change = await queryChange(args.change_id);
  if (!change.current_revision) {
    throw new StructuredError(
      "internal_error",
      `Change ${args.change_id} 缺少 current_revision`,
    );
  }

  // GET /changes/{id}/comments → 全部评论分组在 file 下
  const path = `/changes/${encodeURIComponent(args.change_id)}/comments`;
  const grouped = await gerritGet<Record<string, CommentInfo[]>>(path);

  const threads = buildThreads(grouped);
  const totalThreads = threads.length;

  const includeResolved = args.include_resolved === true;
  const filtered = threads.filter((t) => {
    if (!includeResolved && !t.is_unresolved) return false;
    if (
      typeof args.author_id_filter === "number" &&
      t.root.comment.author?._account_id !== args.author_id_filter
    ) {
      return false;
    }
    return true;
  });

  const unresolvedThreads: UnresolvedThreadView[] = filtered.map((t) => {
    const chain: ThreadCommentView[] = t.chain.map((item) => ({
      uuid: item.comment.id,
      author_id: item.comment.author?._account_id ?? 0,
      written_on: item.comment.updated,
      message: item.comment.message,
      unresolved: item.comment.unresolved === true,
      parent_uuid: item.comment.in_reply_to,
    }));
    return {
      root_uuid: t.root.comment.id,
      file: t.root.file,
      line: typeof t.root.comment.line === "number" ? t.root.comment.line : 0,
      root_author_id: t.root.comment.author?._account_id ?? 0,
      root_message: t.root.comment.message,
      root_written_on: t.root.comment.updated,
      chain,
      latest: chain[chain.length - 1],
    };
  });

  return {
    change_id: args.change_id,
    project: change.project,
    current_patch_set: change.current_patch_set,
    current_revision: change.current_revision,
    total_threads: totalThreads,
    unresolved_thread_count: unresolvedThreads.filter(
      (t) => t.latest.unresolved === true,
    ).length,
    unresolved_threads: unresolvedThreads,
  };
}
