#!/usr/bin/env node
// v3: 先加载 SoT（~/.ai/whaletv.yaml）到 process.env，再读取 env（env 已存在则不覆盖）
import "./sot-loader.js";

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
import { getUnresolvedThreads } from "./tools/threads.js";
import { cherryPickChange } from "./tools/cherry-pick.js";
import { pushToGerrit } from "./tools/push.js";
import {
  addReviewComment,
  markCommentResolved,
  replyInlineComment,
  submitReviewReply,
} from "./tools/comment.js";
import {
  addReviewer,
  removeReviewer,
  setReviewLabel,
} from "./tools/reviewer.js";

// =============================================================================
// Server 实例化
// =============================================================================
//
// 共注册 14 个工具：
//   - 5 读：query_change / list_branches / get_change_comments /
//           get_unresolved_threads / search_changes
//   - 9 写：cherry_pick_change / push_to_gerrit / submit_review_reply /
//           add_review_comment / reply_inline_comment / mark_comment_resolved /
//           add_reviewer / remove_reviewer / set_review_label
//
// v1.0.0 全部读写工具改走 Gerrit REST API。push_to_gerrit 因协议限制仍用 git+SSH。
// v1.1.0 引入双通道认证以支持公司 nginx + Gerrit 双层认证网关：
//   - session 模式（首选）：GERRIT_AUTH_HEADER + GERRIT_COOKIE
//   - basic 模式（备选）：GERRIT_USERNAME + GERRIT_HTTP_PASSWORD
//
// 必要的环境变量（见 src/auth.ts 决策表）：
//   - GERRIT_URL              Gerrit 服务完整 HTTPS URL（必填）
//   - GERRIT_AUTH_HEADER      session 模式：raw "Basic xxx" 头部值（过 nginx 用）
//   - GERRIT_COOKIE           session 模式：raw "GerritAccount=...; XSRF_TOKEN=..."（过 Gerrit 用）
//   - GERRIT_USERNAME         basic 模式：Gerrit 用户名
//   - GERRIT_HTTP_PASSWORD    basic 模式：Gerrit HTTP Credentials Token
//   - GERRIT_TIMEOUT_MS       可选，单次请求超时（毫秒，默认 30000）
// =============================================================================

import { getGerritConfig, getAuthMode } from "./auth.js";

const server = new McpServer({ name: "gerrit-mcp-server", version: "1.1.0" });

// =============================================================================
// 读工具 1：query_change
// =============================================================================
(server.tool as any)(
  "query_change",
  "查询 Gerrit Change 详情（含 owner、当前 patch set、关联 Topic、commit message 中提取的 Zmind#ID）。REST 通道：GET /changes/{id}?o=CURRENT_REVISION&o=CURRENT_COMMIT",
  {
    change_id: z
      .string()
      .min(1)
      .describe(
        "Change-Id (Ixxx...) | Change Number | project~branch~changeId 三元组",
      ),
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
  "列出指定 project 的分支（最多 500 条）；可选 pattern 进行 substring 过滤；空匹配返回空数组并附 note。REST 通道：GET /projects/{name}/branches/?m={pattern}",
  {
    project: z.string().min(1).describe("Gerrit project 名（必填）"),
    pattern: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe("分支名 substring 过滤模式（可选，由 Gerrit 服务端过滤）"),
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
  "获取 Change 的全部评论（inline + review 级），按时间升序排序；含 uuid / unresolved / in_reply_to。REST 通道：GET /changes/{id}/comments",
  {
    change_id: z
      .string()
      .min(1)
      .describe(
        "Change-Id (Ixxx...) | Change Number | project~branch~changeId 三元组",
      ),
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
  "按 Gerrit 查询语法搜索 Change（如 `topic:332669 status:merged branch:master`）；默认 25 条，上限 100。REST 通道：GET /changes/?q={query}&n={limit}",
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
// 读工具 5：get_unresolved_threads（★ 处理 PR/CR 评论闭环的关键）
// =============================================================================
(server.tool as any)(
  "get_unresolved_threads",
  "★★ **获取 Change 当前 patch set 上的未解决 thread 列表（含 UUID）** ★★\n" +
    "\n" +
    "处理 gerrit-ai 评论 / 人工 reviewer 评论的标准入口：返回每个 unresolved thread 的 root_uuid，AI 直接喂给 submit_review_reply 的 inline_replies[].in_reply_to 即可建立真正的 thread 关系，回复后父评论的 thread 状态会被翻转为 resolved（Web UI unresolved 计数下降）。\n" +
    "\n" +
    "v1.0.0 起走 REST GET /changes/{id}/comments，直接含 uuid / unresolved / in_reply_to 字段，比旧版 SSH+NoteDb 方案更快更可靠。\n" +
    "\n" +
    "典型流程（处理 5 条 gerrit-ai 评论）：\n" +
    "  1. get_unresolved_threads({ change_id, author_id_filter: 1000192 }) 拿到 5 个 thread\n" +
    "  2. AI 针对每个 thread.root_message 生成回复\n" +
    "  3. submit_review_reply({ change_id, inline_replies: [{ file, line, message, in_reply_to: thread.root_uuid, unresolved: false }, ...] })\n" +
    "  4. Gerrit Web UI 显示 0 unresolved，REPLY 闭环完成",
  {
    change_id: z
      .string()
      .min(1)
      .describe("Change-Id 或 Change Number（如 'I123abc' 或 '114401'）"),
    include_resolved: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否同时返回已解决 thread；默认 false 即只返回未解决"),
    author_id_filter: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "可选；只保留指定作者 account_id 的 root 评论的 thread（gerrit-ai = 1000192）",
      ),
  },
  wrapToolHandler(
    "get_unresolved_threads",
    (args: { change_id: string }) => args.change_id,
    async (args: {
      change_id: string;
      include_resolved?: boolean;
      author_id_filter?: number;
    }) => getUnresolvedThreads(args),
  ),
);

// =============================================================================
// 写工具 1：cherry_pick_change（v1.0.0 自动执行 ✨）
// =============================================================================
(server.tool as any)(
  "cherry_pick_change",
  "★ v1.0.0 升级：通过 REST 自动执行 cherry-pick（POST /changes/{id}/revisions/current/cherrypick）。三态返回：success（含新 Change URL）/ skipped_already_merged / conflict（含冲突文件列表）。Gerrit 服务端实现保留 cherryPickOfChange 元数据，追溯链路完整。",
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
    (args: {
      change_id: string;
      destination_branch: string;
      message?: string;
    }) => [args.change_id, args.destination_branch],
    async (args: {
      change_id: string;
      destination_branch: string;
      message?: string;
    }) => cherryPickChange(args),
  ),
);

// =============================================================================
// 写工具 2：push_to_gerrit
// =============================================================================
(server.tool as any)(
  "push_to_gerrit",
  "将本地 HEAD 推送到 Gerrit refs/for/<target_branch>，MP 分支硬拒绝；自动构造 push options。**唯一仍用 git+SSH 的工具**（git 协议无法用 REST 替代）。",
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
  "向 Change 添加 review-cover 级评论。REST 通道：POST /changes/{id}/revisions/{rev}/review with {message, tag, notify}",
  {
    change_id: z.string().min(1),
    message: z.string().min(1).max(16384).describe("评论文本，1-16384 字符"),
    patch_set: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("可选 patch set 编号；不传则查询当前 currentPatchSet"),
  },
  wrapToolHandler(
    "add_review_comment",
    (args: { change_id: string; message: string; patch_set?: number }) =>
      args.change_id,
    async (args: {
      change_id: string;
      message: string;
      patch_set?: number;
    }) => addReviewComment(args),
  ),
);

// =============================================================================
// 写工具 4：reply_inline_comment
// =============================================================================
(server.tool as any)(
  "reply_inline_comment",
  "★【单条快速回复】在指定 file+line 上发布单条 inline 评论。仅适合只回复 1 条评论的小流程。⚠️ **批量回复多条 gerrit-ai 评论请改用 submit_review_reply**（一次 REST 调用 + 1 次 OWNER 通知）。REST 通道下可选传 in_reply_to=<uuid> 精确串联到历史评论。",
  {
    change_id: z.string().min(1),
    file: z
      .string()
      .min(1)
      .max(1024)
      .describe("文件路径；patchset-level 评论用 '/PATCHSET_LEVEL'"),
    line: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "行号；patchset-level 评论不传 line，具体文件评论必须传非负整数",
      ),
    message: z.string().min(1).max(16384),
    unresolved: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否标记 unresolved；false 即同时回复并 resolve"),
    patch_set: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("可选；不传则查询当前 currentPatchSet"),
    in_reply_to: z
      .string()
      .min(1)
      .optional()
      .describe(
        "可选父评论 uuid；REST 通道直接接受，串联到具体评论形成 thread",
      ),
  },
  wrapToolHandler(
    "reply_inline_comment",
    (args: {
      change_id: string;
      file: string;
      line?: number;
      message: string;
    }) => {
      const ids = [args.change_id, args.file];
      if (typeof args.line === "number") ids.push(String(args.line));
      return ids;
    },
    async (args: {
      change_id: string;
      file: string;
      line?: number;
      message: string;
      unresolved?: boolean;
      patch_set?: number;
      in_reply_to?: string;
    }) =>
      replyInlineComment({
        change_id: args.change_id,
        file: args.file,
        line: typeof args.line === "number" ? args.line : 0,
        message: args.message,
        unresolved: args.unresolved,
        patch_set: args.patch_set,
        in_reply_to: args.in_reply_to,
      }),
  ),
);

// =============================================================================
// 写工具 5：mark_comment_resolved
// =============================================================================
(server.tool as any)(
  "mark_comment_resolved",
  "★【单条快速 mark resolved】把指定 file+line 上的 inline 评论标记为 resolved。⚠️ **批量场景请用 submit_review_reply**。",
  {
    change_id: z.string().min(1),
    file: z.string().min(1).max(1024),
    line: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("行号；patchset-level 评论不传"),
    message: z
      .string()
      .min(1)
      .max(16384)
      .optional()
      .describe("可选回复文本；不传则用默认 '已标记为 resolved'"),
    patch_set: z.number().int().positive().optional(),
  },
  wrapToolHandler(
    "mark_comment_resolved",
    (args: { change_id: string; file: string; line?: number }) => {
      const ids = [args.change_id, args.file];
      if (typeof args.line === "number") ids.push(String(args.line));
      return ids;
    },
    async (args: {
      change_id: string;
      file: string;
      line?: number;
      message?: string;
      patch_set?: number;
    }) =>
      markCommentResolved({
        change_id: args.change_id,
        file: args.file,
        line: typeof args.line === "number" ? args.line : 0,
        message: args.message,
        patch_set: args.patch_set,
      }),
  ),
);

// =============================================================================
// 写工具 6：submit_review_reply（★ Web UI "REPLY" 按钮的批量等价）
// =============================================================================
(server.tool as any)(
  "submit_review_reply",
  "★★ **批量提交 review 回复 —— 对应 Web UI 'REPLY' 按钮的语义** ★★\n" +
    "\n" +
    "处理多条 gerrit-ai 评论的标准方式：在一次 REST 调用中同时提交多条 inline 回复 + 可选 cover message + 可选 label 设置，触发 1 次 OWNER 通知（不是每条评论 1 次）。\n" +
    "\n" +
    "典型用法（处理 5 条 gerrit-ai 评论）：\n" +
    "1. 调用 get_unresolved_threads 拿到所有未解决 thread 与 root_uuid\n" +
    "2. AI 针对每条生成回复内容（采纳/不采纳的理由）\n" +
    "3. 一次性调用 submit_review_reply，inline_replies 含每条的 file/line/message/in_reply_to=root_uuid\n" +
    "4. cover_message 可附整体小结；labels 可顺手设 Code-Review +1\n",
  {
    change_id: z.string().min(1),
    inline_replies: z
      .array(
        z.object({
          file: z
            .string()
            .min(1)
            .max(1024)
            .describe("文件路径，或 '/PATCHSET_LEVEL' 表示 patchset-level 评论"),
          line: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe(
              "行号；'/PATCHSET_LEVEL' 时不传，具体文件时必须传非负整数",
            ),
          message: z.string().min(1).max(16384).describe("回复文本"),
          unresolved: z
            .boolean()
            .optional()
            .default(false)
            .describe(
              "是否保留 unresolved 状态；默认 false 即标记为 resolved",
            ),
          in_reply_to: z
            .string()
            .min(1)
            .optional()
            .describe(
              "父评论 uuid；从 get_unresolved_threads 的 thread.root_uuid 获取",
            ),
        }),
      )
      .min(1)
      .max(50)
      .describe("inline 回复列表，1..50 条"),
    cover_message: z
      .string()
      .min(1)
      .max(16384)
      .optional()
      .describe("可选整体留言（出现在 review log 顶部）"),
    labels: z
      .record(z.string(), z.number().int().min(-2).max(2))
      .optional()
      .describe("可选标签设置（如 { 'Code-Review': -1 }）"),
    notify: z
      .enum(["NONE", "OWNER", "OWNER_REVIEWERS", "ALL"])
      .optional()
      .default("OWNER")
      .describe("邮件通知级别；默认 OWNER（与 Web UI REPLY 行为一致）"),
    patch_set: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("可选 patch set 编号；不传则查询当前 currentPatchSet"),
  },
  wrapToolHandler(
    "submit_review_reply",
    (args: { change_id: string; inline_replies: Array<{ file: string }> }) => {
      const ids = [args.change_id];
      if (args.inline_replies?.[0]?.file) ids.push(args.inline_replies[0].file);
      return ids;
    },
    async (args: {
      change_id: string;
      inline_replies: Array<{
        file: string;
        line?: number;
        message: string;
        unresolved?: boolean;
        in_reply_to?: string;
      }>;
      cover_message?: string;
      labels?: Record<string, number>;
      notify?: "NONE" | "OWNER" | "OWNER_REVIEWERS" | "ALL";
      patch_set?: number;
    }) => submitReviewReply(args),
  ),
);

// =============================================================================
// 写工具 7：add_reviewer
// =============================================================================
(server.tool as any)(
  "add_reviewer",
  "向 Change 添加 Reviewer。REST 通道：POST /changes/{id}/reviewers with {reviewer}",
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
    (args: { change_id: string; reviewer: string }) => [
      args.change_id,
      args.reviewer,
    ],
    async (args: { change_id: string; reviewer: string }) => addReviewer(args),
  ),
);

// =============================================================================
// 写工具 8：remove_reviewer
// =============================================================================
(server.tool as any)(
  "remove_reviewer",
  "从 Change 移除一名 Reviewer。REST 通道：DELETE /changes/{id}/reviewers/{accountIdentifier}",
  {
    change_id: z.string().min(1),
    reviewer: z.string().min(1).max(255),
  },
  wrapToolHandler(
    "remove_reviewer",
    (args: { change_id: string; reviewer: string }) => [
      args.change_id,
      args.reviewer,
    ],
    async (args: { change_id: string; reviewer: string }) =>
      removeReviewer(args),
  ),
);

// =============================================================================
// 写工具 9：set_review_label
// =============================================================================
(server.tool as any)(
  "set_review_label",
  "在 Change 当前 patch set 上设置标签值（Code-Review/Verified 等，-2..+2）。REST 通道：POST /changes/{id}/revisions/{rev}/review with {labels}",
  {
    change_id: z.string().min(1),
    label: z
      .string()
      .min(1)
      .max(64)
      .describe("标签名（如 Code-Review、Verified）"),
    value: z.number().int().min(-2).max(2).describe("标签值，-2 至 +2"),
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

// =============================================================================
// 启动
// =============================================================================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // 启动 banner：检测当前 auth 模式（不输出凭据值，仅输出模式标识）
  let authModeLabel = "missing";
  try {
    const cfg = getGerritConfig();
    authModeLabel = getAuthMode(cfg);
  } catch {
    /* getGerritConfig 不抛异常，但保险起见 catch 一下 */
  }
  console.error(
    `[gerrit-mcp-server v1.1.0 REST] started (auth_mode=${authModeLabel}), awaiting MCP requests on stdio`,
  );
}

main().catch((err) => {
  console.error("[gerrit-mcp-server] fatal error:", err);
  process.exit(1);
});
