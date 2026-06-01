#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { wrapToolHandler } from "./tool-helpers.js";
import {
  getChangeComments,
  listBranches,
  queryChange,
  searchChanges,
} from "./tools/query.js";
import { cherryPickChange } from "./tools/cherry-pick.js";
import { pushToGerrit } from "./tools/push.js";
import {
  addReviewComment,
  markCommentResolved,
  replyInlineComment,
} from "./tools/comment.js";
import {
  addReviewer,
  removeReviewer,
  setReviewLabel,
} from "./tools/reviewer.js";

// === Server 实例化 ===
// 共注册 12 个工具：
//   - 4 个读工具：query_change / list_branches / get_change_comments / search_changes
//   - 8 个写工具：cherry_pick_change / push_to_gerrit / add_review_comment /
//                reply_inline_comment / mark_comment_resolved / add_reviewer /
//                remove_reviewer / set_review_label
const server = new McpServer({ name: "gerrit-mcp-server", version: "0.1.0" });

// =============================================================================
// 读工具 1：query_change
// =============================================================================
(server.tool as any)(
  "query_change",
  "查询 Gerrit Change 详情（含 owner、当前 patch set、关联 Topic、commit message 中提取的 Zmind#ID）",
  {
    change_id: z
      .string()
      .min(1)
      .describe("Change-Id (Ixxx...) | Change Number | project~branch~changeId 三元组"),
  },
  wrapToolHandler(
    "query_change",
    (args: { change_id: string }) => args.change_id,
    async (args: { change_id: string }) => queryChange(args.change_id),
  ),
);

// =============================================================================
// 读工具 2：list_branches
// =============================================================================
(server.tool as any)(
  "list_branches",
  "列出指定 project 的分支（最多 500 条）；可选 pattern 进行 substring 过滤；空匹配返回空数组并附 note",
  {
    project: z.string().min(1).describe("Gerrit project 名（必填）"),
    pattern: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe("分支名 substring 过滤模式（可选，大小写敏感）"),
  },
  wrapToolHandler(
    "list_branches",
    (args: { project: string; pattern?: string }) => {
      const ids = [args.project];
      if (args.pattern) ids.push(args.pattern);
      return ids;
    },
    async (args: { project: string; pattern?: string }) =>
      listBranches(args.project, args.pattern),
  ),
);

// =============================================================================
// 读工具 3：get_change_comments
// =============================================================================
(server.tool as any)(
  "get_change_comments",
  "获取 Change 的全部评论（inline + review 级）；按时间升序排序，时间相同按 id 字典序",
  {
    change_id: z
      .string()
      .min(1)
      .describe("Change-Id (Ixxx...) | Change Number | project~branch~changeId 三元组"),
  },
  wrapToolHandler(
    "get_change_comments",
    (args: { change_id: string }) => args.change_id,
    async (args: { change_id: string }) => getChangeComments(args.change_id),
  ),
);

// =============================================================================
// 读工具 4：search_changes
// =============================================================================
(server.tool as any)(
  "search_changes",
  "按 Gerrit 查询语法搜索 Change（如 `topic:332669 status:merged branch:master`）；默认 25 条，上限 100",
  {
    query: z
      .string()
      .min(1)
      .max(1024)
      .describe("Gerrit search syntax 字符串（必填）"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .describe("返回数量，默认 25，最大 100"),
  },
  wrapToolHandler(
    "search_changes",
    (args: { query: string; limit: number }) => args.query,
    async (args: { query: string; limit: number }) =>
      searchChanges(args.query, args.limit),
  ),
);

// =============================================================================
// 写工具 1：cherry_pick_change
// =============================================================================
(server.tool as any)(
  "cherry_pick_change",
  "将一个 Change cherry-pick 到指定目标分支，三态返回 success/skipped_already_merged/conflict",
  {
    change_id: z
      .string()
      .min(1)
      .describe("源 Change-Id (Ixxx...) | Change Number | 三元组"),
    destination_branch: z
      .string()
      .min(1)
      .max(255)
      .describe("目标分支名（如 os10_mp）"),
    message: z
      .string()
      .max(16384)
      .optional()
      .describe("可选 commit message 覆盖；不传则沿用源"),
  },
  wrapToolHandler(
    "cherry_pick_change",
    (args: { change_id: string; destination_branch: string; message?: string }) => [
      args.change_id,
      args.destination_branch,
    ],
    async (args: { change_id: string; destination_branch: string; message?: string }) =>
      cherryPickChange(args),
  ),
);

// =============================================================================
// 写工具 2：push_to_gerrit
// =============================================================================
(server.tool as any)(
  "push_to_gerrit",
  "将本地 HEAD 推送到 Gerrit refs/for/<target_branch>，MP 分支硬拒绝；自动构造 push options",
  {
    cwd: z.string().min(1).describe("本地 git 仓库工作目录绝对路径"),
    target_branch: z
      .string()
      .min(1)
      .max(255)
      .describe("目标远程分支名（不能是 *_mp 模式）"),
    reviewers: z
      .array(z.string().min(1))
      .max(20)
      .optional()
      .describe("Reviewer 邮箱列表"),
    wip: z
      .boolean()
      .optional()
      .default(false)
      .describe("标记为 work-in-progress"),
    topic: z.string().max(255).optional().describe("Gerrit topic"),
  },
  wrapToolHandler(
    "push_to_gerrit",
    (args: {
      cwd: string;
      target_branch: string;
      reviewers?: string[];
      wip?: boolean;
      topic?: string;
    }) => [args.target_branch, args.cwd],
    async (args: {
      cwd: string;
      target_branch: string;
      reviewers?: string[];
      wip?: boolean;
      topic?: string;
    }) => pushToGerrit(args),
  ),
);

// =============================================================================
// 写工具 3：add_review_comment
// =============================================================================
(server.tool as any)(
  "add_review_comment",
  "向 Change 添加 review 级评论",
  {
    change_id: z.string().min(1),
    message: z
      .string()
      .min(1)
      .max(16384)
      .describe("评论文本，1-16384 字符"),
    patch_set: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("可选 patch set 编号，默认 current"),
  },
  wrapToolHandler(
    "add_review_comment",
    (args: { change_id: string; message: string; patch_set?: number }) => args.change_id,
    async (args: { change_id: string; message: string; patch_set?: number }) =>
      addReviewComment(args),
  ),
);

// =============================================================================
// 写工具 4：reply_inline_comment
// =============================================================================
(server.tool as any)(
  "reply_inline_comment",
  "回复 inline 评论；可同时标记 resolved（unresolved=false）",
  {
    change_id: z.string().min(1),
    parent_comment_id: z.string().min(1).describe("被回复的 inline 评论 ID"),
    message: z.string().min(1).max(16384),
    unresolved: z
      .boolean()
      .describe("是否标记 unresolved；false 即同时 resolve"),
  },
  wrapToolHandler(
    "reply_inline_comment",
    (args: {
      change_id: string;
      parent_comment_id: string;
      message: string;
      unresolved: boolean;
    }) => [args.change_id, args.parent_comment_id],
    async (args: {
      change_id: string;
      parent_comment_id: string;
      message: string;
      unresolved: boolean;
    }) => replyInlineComment(args),
  ),
);

// =============================================================================
// 写工具 5：mark_comment_resolved
// =============================================================================
(server.tool as any)(
  "mark_comment_resolved",
  "将一条 inline 评论标记为 resolved（提交 unresolved=false 的回复）",
  {
    change_id: z.string().min(1),
    comment_id: z.string().min(1).describe("评论 ID"),
  },
  wrapToolHandler(
    "mark_comment_resolved",
    (args: { change_id: string; comment_id: string }) => [args.change_id, args.comment_id],
    async (args: { change_id: string; comment_id: string }) =>
      markCommentResolved(args),
  ),
);

// =============================================================================
// 写工具 6：add_reviewer
// =============================================================================
(server.tool as any)(
  "add_reviewer",
  "向 Change 添加 Reviewer",
  {
    change_id: z.string().min(1),
    reviewer: z
      .string()
      .min(1)
      .max(255)
      .describe("Reviewer 邮箱、用户名或 account-id"),
  },
  wrapToolHandler(
    "add_reviewer",
    (args: { change_id: string; reviewer: string }) => [args.change_id, args.reviewer],
    async (args: { change_id: string; reviewer: string }) => addReviewer(args),
  ),
);

// =============================================================================
// 写工具 7：remove_reviewer
// =============================================================================
(server.tool as any)(
  "remove_reviewer",
  "从 Change 移除一名 Reviewer",
  {
    change_id: z.string().min(1),
    reviewer: z.string().min(1).max(255),
  },
  wrapToolHandler(
    "remove_reviewer",
    (args: { change_id: string; reviewer: string }) => [args.change_id, args.reviewer],
    async (args: { change_id: string; reviewer: string }) => removeReviewer(args),
  ),
);

// =============================================================================
// 写工具 8：set_review_label
// =============================================================================
(server.tool as any)(
  "set_review_label",
  "在 Change 当前 patch set 上设置标签值（Code-Review/Verified 等，-2..+2）",
  {
    change_id: z.string().min(1),
    label: z
      .string()
      .min(1)
      .max(64)
      .describe("标签名（如 Code-Review、Verified）"),
    value: z
      .number()
      .int()
      .min(-2)
      .max(2)
      .describe("标签值，-2 至 +2"),
  },
  wrapToolHandler(
    "set_review_label",
    (args: { change_id: string; label: string; value: number }) => [
      args.change_id,
      args.label,
    ],
    async (args: { change_id: string; label: string; value: number }) =>
      setReviewLabel(args),
  ),
);

// === 启动 ===
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // 启动日志通过 stderr 输出，避免污染 stdio MCP 协议（stdout 专用于 JSON-RPC 帧）
  console.error("[gerrit-mcp-server] started, awaiting MCP requests on stdio");
}

main().catch((err) => {
  console.error("[gerrit-mcp-server] fatal error:", err);
  process.exit(1);
});
