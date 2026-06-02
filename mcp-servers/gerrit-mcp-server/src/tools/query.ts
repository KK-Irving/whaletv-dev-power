/**
 * Gerrit 读操作工具集 (SSH 通道)。
 *
 * 因 nginx 双层认证导致 REST `/a/...` 不可用，本模块改走 SSH 通道：
 *   - queryChange:        ssh ... gerrit query --current-patch-set --commit-message change:<id>
 *   - listBranches:       git ls-remote --heads ssh://...:29418/<project>
 *   - getChangeComments:  ssh ... gerrit query --current-patch-set --comments change:<id>
 *   - searchChanges:      ssh ... gerrit query --format=JSON <query> limit:N
 *
 * 限制（与 REST 实现的差异）：
 *   - get_change_comments 缺失 `uuid` / `unresolved` / `in_reply_to` 字段（SSH `gerrit query --comments` 不返回）
 *     - 显示 / 阅读评论 → 完全够用
 *     - 程序化 reply / mark resolved → 在 reply_inline_comment / mark_comment_resolved 工具用 file+line anchor 替代 uuid
 *   - inline 评论的位置以 `/PATCHSET_LEVEL` 标识 patchset-level 评论（无具体行号）
 *
 * 行为契约保留（与 REST 版本一致）：
 *   - listBranches 空匹配返回 `[]` 与 note（Property 6）
 *   - getChangeComments 按 created/timestamp 升序，时间相同按 id 字典序（Property 7）
 *   - 错误消息保留 change_id / project / pattern 标识符（Property 5，由 wrapToolHandler 注入）
 */

import { sshGerritJson, sshGitLsRemote, requireSshConfig } from "../ssh-client.js";
import { StructuredError } from "../errors.js";
import type { GerritBranch, GerritChange, GerritComment } from "../types.js";

// =============================================================================
// Gerrit query SSH 输出模型
// =============================================================================

/**
 * `gerrit query --format=JSON --current-patch-set --commit-message change:<id>` 的输出结构。
 *
 * 字段对照（SSH 与 REST 字段命名差异）：
 *   - SSH `id`           = REST `change_id`（仅 Change-Id）
 *   - SSH `number`       = REST `_number`（数字编号）
 *   - SSH `commitMessage`= REST `revisions[current].commit.message`
 *   - SSH `currentPatchSet.number`  = REST `revisions[current]._number`
 *   - SSH `currentPatchSet.revision`= REST `current_revision`
 */
interface GerritSshChange {
  project: string;
  branch: string;
  /** 即 Change-Id（Ixxx...）；不是 REST 的 project~branch~Change-Id 三元组。 */
  id: string;
  number: number;
  subject: string;
  status: string;
  topic?: string;
  owner?: { username?: string; name?: string; email?: string };
  url?: string;
  commitMessage?: string;
  createdOn?: number;
  lastUpdated?: number;
  open?: boolean;
  /** review 级评论（不含 inline 内容；inline 在 currentPatchSet.comments）。 */
  comments?: GerritSshReviewMessage[];
  currentPatchSet?: {
    number: number;
    revision: string;
    ref?: string;
    uploader?: { username?: string };
    createdOn?: number;
    /** 当 query 带 --comments 时，inline 评论会出现在这里。 */
    comments?: GerritSshInlineComment[];
  };
}

/** SSH query --comments 返回的 review 级评论。 */
interface GerritSshReviewMessage {
  /** Unix 秒级时间戳。 */
  timestamp?: number;
  reviewer?: { username?: string; name?: string; email?: string };
  message: string;
}

/** SSH query --comments 返回的 inline 评论；缺 uuid/unresolved/in_reply_to。 */
interface GerritSshInlineComment {
  /** 文件路径，或 `/PATCHSET_LEVEL`。 */
  file: string;
  /** 行号；patchset-level 评论为 0。 */
  line: number;
  reviewer?: { username?: string; name?: string; email?: string };
  message: string;
  /** Unix 秒级时间戳；query --comments 不一定返回。 */
  timestamp?: number;
}

/** SSH `git ls-remote` 返回的最末尾 stats 行。 */
type GerritSshStats = Record<string, unknown> & { type: "stats"; rowCount: number };

// =============================================================================
// 内部辅助
// =============================================================================

/** 从 commit message 中按出现顺序提取 `Zmind#(\d+)` 中的数字 ID 列表。 */
function extractZmindIssueIds(commitMessage: string | undefined | null): number[] {
  if (typeof commitMessage !== "string" || commitMessage.length === 0) return [];
  const ids: number[] = [];
  for (const m of commitMessage.matchAll(/Zmind#(\d+)/g)) {
    const id = parseInt(m[1], 10);
    if (Number.isFinite(id)) ids.push(id);
  }
  return ids;
}

/** 拼接 Gerrit Change Web URL，优先使用 SSH 输出中的 url，回退到拼接形式。 */
function buildChangeWebUrl(
  info: GerritSshChange,
  fallbackBaseUrl: string,
): string {
  if (typeof info.url === "string" && info.url.length > 0) {
    return info.url;
  }
  const base = fallbackBaseUrl.replace(/\/+$/, "");
  return `${base}/c/${encodeURI(info.project)}/+/${info.number}`;
}

/** Unix 秒级时间戳转 ISO 8601 字符串；缺失返回空串。 */
function toIso(unix: number | undefined): string {
  if (typeof unix !== "number" || !Number.isFinite(unix)) return "";
  return new Date(unix * 1000).toISOString();
}

/** 把 GerritSshChange 映射为 GerritChange。 */
function mapToGerritChange(
  info: GerritSshChange,
  baseUrl: string,
): GerritChange {
  const status = (info.status === "MERGED"
    ? "MERGED"
    : info.status === "ABANDONED"
      ? "ABANDONED"
      : "NEW") as GerritChange["status"];

  return {
    // SSH 不返回 project~branch~Change-Id 三元组；用 Change-Id 字符串作为 id
    id: info.id,
    change_id: info.id,
    number: info.number,
    subject: info.subject,
    status,
    project: info.project,
    branch: info.branch,
    topic: info.topic,
    owner: {
      name: info.owner?.name ?? info.owner?.username ?? "",
      email: info.owner?.email,
    },
    current_revision: info.currentPatchSet?.revision,
    current_patch_set: info.currentPatchSet?.number ?? 0,
    zmind_issue_ids: extractZmindIssueIds(info.commitMessage),
    web_url: buildChangeWebUrl(info, baseUrl),
  };
}

/** 拿到 Gerrit Web 基础 URL（仅用于构造 Change URL）；缺失时返回空字符串。 */
function getBaseUrl(): string {
  return (process.env.GERRIT_URL ?? "").replace(/\/+$/, "");
}

// =============================================================================
// 1. queryChange
// =============================================================================

/**
 * 查询单个 Gerrit Change 详情（SSH 通道）。
 *
 * @throws StructuredError("not_found") 当 query 返回 0 条业务行（rowCount=0）
 */
export async function queryChange(changeId: string): Promise<GerritChange> {
  const { rows, stats } = await sshGerritJson<GerritSshChange>([
    "gerrit",
    "query",
    "--format=JSON",
    "--current-patch-set",
    "--commit-message",
    `change:${escapeQueryToken(changeId)}`,
  ]);

  if (rows.length === 0) {
    const rowCount =
      typeof stats?.rowCount === "number" ? (stats.rowCount as number) : 0;
    throw new StructuredError(
      "not_found",
      `Change 不存在或不可见: change_id=${changeId} (rowCount=${rowCount})`,
      404,
    );
  }

  // gerrit query change:<id> 通常返回 1 条；若多条则取第一条
  return mapToGerritChange(rows[0], getBaseUrl());
}

/**
 * 转义 Gerrit query token：去掉首尾空白；不允许包含空格 / 引号 / 反引号。
 *
 * Gerrit query 语法对 token 中的特殊字符敏感；调用方传入的 changeId 一般是
 * 数字、Change-Id 或三元组，本函数仅做基础防御。
 */
function escapeQueryToken(token: string): string {
  const trimmed = token.trim();
  if (/[\s`"'\\]/.test(trimmed)) {
    throw new StructuredError(
      "internal_error",
      `查询参数包含非法字符（不允许空格、引号、反引号、反斜杠）: ${trimmed}`,
    );
  }
  return trimmed;
}

// =============================================================================
// 2. listBranches
// =============================================================================

export interface ListBranchesResult {
  branches: GerritBranch[];
  note?: string;
}

/**
 * 列出指定 project 的分支（SSH 通道：git ls-remote）。
 *
 * 行为与 REST 版一致：
 *   - 客户端 substring 过滤（大小写敏感）
 *   - 最多 500 条
 *   - 空匹配返回 [] + note（Property 6）
 */
export async function listBranches(
  project: string,
  pattern?: string,
): Promise<ListBranchesResult> {
  const all = await sshGitLsRemote(project);

  const filtered = pattern
    ? all.filter((b) => b.ref.includes(pattern))
    : all;
  const capped = filtered.slice(0, 500);

  const branches: GerritBranch[] = capped.map((b) => ({
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
 * 获取一个 Change 的全部评论（review + inline，SSH 通道）。
 *
 * 与 REST 版的差异：
 *   - inline 评论的 `id` 字段由 `<file>:<line>:<timestamp_or_hash>` 合成
 *     （SSH 不返回 uuid；合成 id 用于 GerritComment.id 字段填充，保证排序稳定）
 *   - `unresolved` 字段缺失，统一填 false（SSH 不返回；上层若要判断未解决数量，
 *     需要从 query.message 中正则提取，例如 "Patch Set N: ... (M comments)"）
 *   - `in_reply_to` 字段始终 undefined
 *
 * @throws StructuredError("not_found") 当 query 返回 0 条业务行
 */
export async function getChangeComments(
  changeId: string,
): Promise<GerritComment[]> {
  const { rows, stats } = await sshGerritJson<GerritSshChange>([
    "gerrit",
    "query",
    "--format=JSON",
    "--current-patch-set",
    "--comments",
    `change:${escapeQueryToken(changeId)}`,
  ]);

  if (rows.length === 0) {
    const rowCount =
      typeof stats?.rowCount === "number" ? (stats.rowCount as number) : 0;
    throw new StructuredError(
      "not_found",
      `Change 不存在或不可见: change_id=${changeId} (rowCount=${rowCount})`,
      404,
    );
  }

  const change = rows[0];
  const merged: GerritComment[] = [];

  // ① review 级 messages
  if (Array.isArray(change.comments)) {
    for (let i = 0; i < change.comments.length; i++) {
      const c = change.comments[i];
      const isoTime = toIso(c.timestamp);
      merged.push({
        // SSH 不返回 message id；用 timestamp + index 合成稳定 id 用于排序
        id: `review:${c.timestamp ?? "?"}:${i}`,
        author: {
          name: c.reviewer?.name ?? c.reviewer?.username ?? "",
          email: c.reviewer?.email,
        },
        created: isoTime,
        message: c.message ?? "",
        unresolved: false,
      });
    }
  }

  // ② inline 评论（patchset-level 用 /PATCHSET_LEVEL 标识）
  const inlineList = change.currentPatchSet?.comments;
  if (Array.isArray(inlineList)) {
    for (let i = 0; i < inlineList.length; i++) {
      const c = inlineList[i];
      const isoTime = toIso(c.timestamp);
      const isPatchsetLevel = c.file === "/PATCHSET_LEVEL";
      merged.push({
        // 合成 id：file + line + index 保证稳定
        id: `inline:${c.file}:${c.line}:${i}`,
        author: {
          name: c.reviewer?.name ?? c.reviewer?.username ?? "",
          email: c.reviewer?.email,
        },
        created: isoTime,
        message: c.message ?? "",
        unresolved: false,
        // patchset-level 评论保留 path="/PATCHSET_LEVEL" 让上层识别它是 inline 而非 review
        // line 在 patchset-level 上保留 0（与 SSH 输出一致），便于上层把这条 path+line
        // 直接喂给 submit_review_reply 工具（patchset-level 不传 line 由工具内部处理）
        path: c.file,
        line: c.line,
        patch_set: change.currentPatchSet?.number,
      });
    }
  }

  // ③ 升序：created 主键，相同时 id 字典序
  merged.sort((a, b) => {
    if (a.created < b.created) return -1;
    if (a.created > b.created) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  return merged;
}

// =============================================================================
// 4. searchChanges
// =============================================================================

/**
 * 按 Gerrit 查询语法搜索 Change（SSH 通道）。
 *
 * @param query Gerrit search syntax 字符串
 * @param limit 返回数量上限（默认 25，最大 100；上限由 zod schema 在 index.ts 强制）
 *
 * 安全性：query 直接作为 ssh args 中的参数，由 child_process.spawn 数组形式传递，
 * 不经 shell 解释，无注入风险。但 query 字符串内部仍按 Gerrit 自己的 query 语法
 * 解析，调用方负责构造合法 query。
 */
export async function searchChanges(
  query: string,
  limit: number = 25,
): Promise<GerritChange[]> {
  // ssh 参数中 query 与 limit:N 作为 trailing args
  // gerrit query 接受多个空格分隔的 token，所以 spawn 数组形式天然分割正确
  const args = [
    "gerrit",
    "query",
    "--format=JSON",
    "--current-patch-set",
    "--commit-message",
    ...query.split(/\s+/).filter((s) => s.length > 0),
    `limit:${limit}`,
  ];

  const { rows } = await sshGerritJson<GerritSshChange>(args);
  const baseUrl = getBaseUrl();
  return rows.map((r) => mapToGerritChange(r, baseUrl));
}

// 触发 requireSshConfig 在模块导入时不执行（保持懒加载语义）；导出供测试使用
export { requireSshConfig };
