/**
 * Gerrit 读操作工具集 (REST 通道，v1.0.0)。
 *
 * 自 v1.0.0 起，gerrit-mcp-server 主通道改回 REST API。SSH 通道在 Windows OpenSSH
 * 上对部分子命令静默 exit 255 不稳定，且 REST 通道有以下优势：
 *   - get_change_comments 直接含 uuid / unresolved / in_reply_to 字段（不再需要 NoteDb 黑魔法）
 *   - cherry_pick_change 可自动执行（POST /changes/{id}/revisions/{rev}/cherrypick）
 *   - 错误响应有结构化 HTTP 状态码与 body，比 SSH stderr 文本更可控
 *
 * REST 端点映射：
 *   - queryChange:        GET /changes/{id}?o=CURRENT_REVISION&o=CURRENT_COMMIT&o=DETAILED_LABELS
 *   - listBranches:       GET /projects/{name}/branches/?m={pattern}
 *   - getChangeComments:  GET /changes/{id}/comments
 *   - searchChanges:      GET /changes/?q={query}&n={limit}&o=CURRENT_REVISION&o=CURRENT_COMMIT
 *
 * 行为契约（与 v0.x 保持等价）：
 *   - listBranches 空匹配返回 [] + note（Property 6）
 *   - getChangeComments 按 created/timestamp 升序，时间相同按 id 字典序（Property 7）
 *   - 错误消息保留 change_id / project / pattern 标识符（Property 5，由 wrapToolHandler 注入）
 */

import { gerritGet } from "../http-client.js";
import { StructuredError } from "../errors.js";
import type { GerritBranch, GerritChange, GerritComment } from "../types.js";

// =============================================================================
// Gerrit REST API 响应类型（仅声明本模块用到的字段）
// =============================================================================

interface ChangeInfo {
  /** project~branch~Change-Id 三元组 */
  id: string;
  /** project 名 */
  project: string;
  /** 分支名（不含 refs/heads/） */
  branch: string;
  /** Change-Id (Ixxx...) */
  change_id: string;
  /** 数字编号 */
  _number: number;
  subject: string;
  status: "NEW" | "MERGED" | "ABANDONED";
  topic?: string;
  owner?: { _account_id?: number; name?: string; email?: string };
  current_revision?: string;
  /** 仅在 o=CURRENT_REVISION 时返回 */
  revisions?: Record<
    string,
    {
      _number: number;
      commit?: { message?: string };
    }
  >;
}

interface BranchInfo {
  ref: string;
  revision: string;
}

interface CommentInfo {
  id: string;
  /** Comment author 信息 */
  author?: { _account_id?: number; name?: string; email?: string };
  /** ISO 8601 时间字符串（含小数秒） */
  updated: string;
  message: string;
  /** thread 是否未解决（按 thread 中最末一条评论的状态） */
  unresolved?: boolean;
  /** 父评论 uuid（用于重建 thread） */
  in_reply_to?: string;
  /** 行号 */
  line?: number;
  /** 多行评论的范围 */
  range?: {
    start_line: number;
    start_character: number;
    end_line: number;
    end_character: number;
  };
  /** patch set 编号 */
  patch_set?: number;
  /** 1=REVISION, 0=PARENT */
  side?: number;
  tag?: string;
}

// =============================================================================
// 内部辅助
// =============================================================================

/** 从 commit message 中按出现顺序提取 Zmind#(\d+) 的数字 ID 列表。 */
function extractZmindIssueIds(commitMessage: string | undefined | null): number[] {
  if (typeof commitMessage !== "string" || commitMessage.length === 0) return [];
  const ids: number[] = [];
  for (const m of commitMessage.matchAll(/Zmind#(\d+)/g)) {
    const id = parseInt(m[1], 10);
    if (Number.isFinite(id)) ids.push(id);
  }
  return ids;
}

/** 拼接 Gerrit Change Web URL；优先 GERRIT_URL，缺省时从 ChangeInfo.id 拼接。 */
function buildChangeWebUrl(info: ChangeInfo): string {
  const base = (process.env.GERRIT_URL ?? "").replace(/\/+$/, "");
  if (base.length > 0) {
    return `${base}/c/${encodeURI(info.project)}/+/${info._number}`;
  }
  return `/c/${encodeURI(info.project)}/+/${info._number}`;
}

/** ChangeInfo → GerritChange 映射 */
function mapToGerritChange(info: ChangeInfo): GerritChange {
  let commitMessage: string | undefined;
  if (info.current_revision && info.revisions) {
    commitMessage = info.revisions[info.current_revision]?.commit?.message;
  }
  const currentPatchSet =
    info.current_revision && info.revisions
      ? info.revisions[info.current_revision]?._number ?? 0
      : 0;

  return {
    id: info.id,
    change_id: info.change_id,
    number: info._number,
    subject: info.subject,
    status: info.status,
    project: info.project,
    branch: info.branch,
    topic: info.topic,
    owner: {
      name: info.owner?.name ?? "",
      email: info.owner?.email,
    },
    current_revision: info.current_revision,
    current_patch_set: currentPatchSet,
    zmind_issue_ids: extractZmindIssueIds(commitMessage),
    web_url: buildChangeWebUrl(info),
  };
}

/**
 * 对 Gerrit Change-Id / 数字 ID / 三元组做 URL path 编码。
 *
 * Gerrit 接受的 id 形式：
 *   - 纯数字 _number（如 "114401"）
 *   - Change-Id（如 "Iabc123..."）
 *   - 三元组（如 "project~branch~Iabc123..."）
 *
 * 由于三元组里 `~` 是合法字符但 `/` 等需要编码，整体 encodeURIComponent 即可。
 */
function encodeChangeId(changeId: string): string {
  const trimmed = changeId.trim();
  if (trimmed.length === 0) {
    throw new StructuredError("internal_error", "change_id 不可为空");
  }
  return encodeURIComponent(trimmed);
}

// =============================================================================
// 1. queryChange
// =============================================================================

/**
 * 查询单个 Gerrit Change 详情（REST 通道）。
 *
 * 端点：GET /a/changes/{id}?o=CURRENT_REVISION&o=CURRENT_COMMIT
 *
 * @throws StructuredError("not_found") 当 Gerrit 返回 404
 */
export async function queryChange(changeId: string): Promise<GerritChange> {
  const path = `/changes/${encodeChangeId(changeId)}?o=CURRENT_REVISION&o=CURRENT_COMMIT`;
  const info = await gerritGet<ChangeInfo>(path);
  return mapToGerritChange(info);
}

// =============================================================================
// 2. listBranches
// =============================================================================

export interface ListBranchesResult {
  branches: GerritBranch[];
  note?: string;
}

/**
 * 列出指定 project 的分支（REST 通道）。
 *
 * 端点：GET /a/projects/{name}/branches/?m={pattern}
 *
 * 行为：
 *   - 服务端 substring 过滤（pattern 经 m 参数传给 Gerrit）
 *   - 最多 500 条（Gerrit 默认）
 *   - 空匹配返回 [] + note（Property 6）
 */
export async function listBranches(
  project: string,
  pattern?: string,
): Promise<ListBranchesResult> {
  let path = `/projects/${encodeURIComponent(project)}/branches/`;
  if (pattern) {
    path += `?m=${encodeURIComponent(pattern)}`;
  }
  const info = await gerritGet<BranchInfo[]>(path);

  const branches: GerritBranch[] = info.slice(0, 500).map((b) => ({
    ref: b.ref,
    revision: b.revision,
    name: b.ref.startsWith("refs/heads/")
      ? b.ref.slice("refs/heads/".length)
      : b.ref,
  }));

  if (pattern && branches.length === 0) {
    return {
      branches: [],
      note: `no branches matched the pattern: ${pattern}`,
    };
  }
  return { branches };
}

// =============================================================================
// 3. getChangeComments
// =============================================================================

/**
 * 获取一个 Change 的全部评论（REST 通道）。
 *
 * 端点：GET /a/changes/{id}/comments
 * 返回结构：`Map<file_path, CommentInfo[]>`
 *
 * v1.0.0 起 REST 通道直接含 uuid / unresolved / in_reply_to，比 SSH 完整。
 *
 * @throws StructuredError("not_found") 当 Gerrit 返回 404
 */
export async function getChangeComments(
  changeId: string,
): Promise<GerritComment[]> {
  const path = `/changes/${encodeChangeId(changeId)}/comments`;
  const grouped = await gerritGet<Record<string, CommentInfo[]>>(path);

  const all: GerritComment[] = [];
  for (const [filePath, comments] of Object.entries(grouped)) {
    for (const c of comments) {
      all.push({
        id: c.id,
        author: {
          name: c.author?.name ?? "",
          email: c.author?.email,
        },
        created: c.updated,
        message: c.message ?? "",
        unresolved: c.unresolved === true,
        path: filePath,
        line: c.line,
        patch_set: c.patch_set,
        in_reply_to: c.in_reply_to,
      });
    }
  }

  // 升序：created 主键，相同时 id 字典序（Property 7）
  all.sort((a, b) => {
    if (a.created < b.created) return -1;
    if (a.created > b.created) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  return all;
}

// =============================================================================
// 4. searchChanges
// =============================================================================

/**
 * 按 Gerrit 查询语法搜索 Change（REST 通道）。
 *
 * 端点：GET /a/changes/?q={query}&n={limit}&o=CURRENT_REVISION&o=CURRENT_COMMIT
 *
 * @param query Gerrit search syntax 字符串
 * @param limit 返回数量上限（默认 25，最大 100）
 */
export async function searchChanges(
  query: string,
  limit: number = 25,
): Promise<GerritChange[]> {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("n", String(limit));
  params.append("o", "CURRENT_REVISION");
  params.append("o", "CURRENT_COMMIT");
  const path = `/changes/?${params.toString()}`;
  const list = await gerritGet<ChangeInfo[]>(path);
  return list.map(mapToGerritChange);
}
