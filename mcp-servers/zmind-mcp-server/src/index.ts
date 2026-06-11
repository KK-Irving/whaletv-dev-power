#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import {
  AttachmentProcessResult,
  ensureIssueWorkspace,
  processAttachment,
  writeWorkspaceReadme,
} from "./attachment-handler.js";
import { describeHttpClientConfig, zmindFetch } from "./http-client.js";

// === 环境变量与常量 ===
const BASE_URL = process.env.ZMIND_URL || "https://zmind.whaletv.com";
const API_KEY = process.env.ZMIND_API_KEY || "";

// === 校验函数 ===
function validateConfig(): void {
  if (!API_KEY) {
    throw new Error("环境变量 ZMIND_API_KEY 未配置，请设置后重试");
  }
}

// === HTTP 辅助函数 ===
async function redmineGet(path: string, params?: Record<string, string>): Promise<any> {
  validateConfig();
  const url = new URL(path, BASE_URL);
  url.searchParams.set("key", API_KEY);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await zmindFetch(url.toString(), {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Zmind API 错误 (HTTP ${res.status}): ${errorText}`);
  }
  return res.json();
}

async function redminePut(path: string, body: any): Promise<number> {
  validateConfig();
  const url = new URL(path, BASE_URL);
  url.searchParams.set("key", API_KEY);
  const res = await zmindFetch(url.toString(), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Zmind API 错误 (HTTP ${res.status}): ${errorText}`);
  }
  return res.status;
}

async function redminePost(path: string, body: any): Promise<any> {
  validateConfig();
  const url = new URL(path, BASE_URL);
  url.searchParams.set("key", API_KEY);
  const res = await zmindFetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Zmind API 错误 (HTTP ${res.status}): ${errorText}`);
  }
  return res.json();
}


// === 格式化辅助函数 ===
function formatIssue(data: any): string {
  const issue = data.issue;
  let text = `# ${issue.subject}\n\n`;
  text += `- ID: ${issue.id}\n`;
  text += `- 状态: ${issue.status?.name || "未知"}\n`;
  text += `- 优先级: ${issue.priority?.name || "未知"}\n`;
  text += `- 指派人: ${issue.assigned_to?.name || "未指派"}\n`;
  text += `- 项目: ${issue.project?.name || "未知"}\n`;
  text += `- Tracker: ${issue.tracker?.name || "未知"}\n`;
  text += `- 完成度: ${issue.done_ratio || 0}%\n`;
  if (issue.estimated_hours) text += `- 预估工时: ${issue.estimated_hours}h\n`;
  if (issue.fixed_version) text += `- 目标版本: ${issue.fixed_version.name}\n`;
  if (issue.parent) text += `- 父任务: #${issue.parent.id}\n`;
  text += `- 创建时间: ${issue.created_on || "未知"}\n`;
  text += `- 更新时间: ${issue.updated_on || "未知"}\n`;

  if (issue.description) {
    text += `\n## 描述\n\n${issue.description}\n`;
  }

  if (issue.allowed_statuses?.length) {
    text += `\n## 可流转状态\n\n`;
    text += issue.allowed_statuses
      .map((s: any) => `- ${s.name} (ID: ${s.id})`)
      .join("\n");
    text += "\n";
  }

  if (issue.children?.length) {
    text += `\n## 子任务\n\n`;
    text += issue.children
      .map((c: any) => `- #${c.id} ${c.subject}`)
      .join("\n");
    text += "\n";
  }

  if (issue.relations?.length) {
    text += `\n## 关联关系\n\n`;
    text += issue.relations
      .map((r: any) => `- ${r.relation_type} #${r.issue_to_id}`)
      .join("\n");
    text += "\n";
  }

  if (issue.attachments?.length) {
    text += `\n## 附件\n\n`;
    text += issue.attachments
      .map((a: any) => `- ${a.filename} (${a.content_url})`)
      .join("\n");
    text += "\n";
  }

  if (issue.journals?.length) {
    const comments = issue.journals.filter((j: any) => j.notes);
    if (comments.length > 0) {
      text += `\n## 评论历史\n\n`;
      for (const j of comments) {
        text += `### [${j.created_on}] ${j.user?.name || "未知用户"}\n\n${j.notes}\n\n`;
      }
    }
  }

  return text;
}

function formatIssueList(data: any): string {
  const issues = data.issues || [];
  if (issues.length === 0) return "未找到匹配的 Issue";
  return issues
    .map(
      (i: any) =>
        `#${i.id} [${i.status?.name}] ${i.subject} (${i.assigned_to?.name || "未指派"})`
    )
    .join("\n");
}

// === Server 实例化 ===
const server = new McpServer({ name: "zmind-mcp-server", version: "2.1.1" });

// === 查询工具 ===

(server.tool as any)(
  "get_issue",
  "获取 Zmind 上指定 ID 的 Issue 完整详情（含评论、附件、关联、子任务、可流转状态）",
  {
    issue_id: z.number().describe("Issue ID"),
  },
  async ({ issue_id }: { issue_id: number }) => {
    try {
      const data = await redmineGet(`/issues/${issue_id}.json`, {
        include: "journals,attachments,relations,children",
      });
      const text = formatIssue(data);
      return { content: [{ type: "text", text }] };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `获取 Issue 失败: ${err.message}` }],
        isError: true,
      };
    }
  }
);

(server.tool as any)(
  "my_issues",
  "获取当前用户被指派的 Issue 列表，按更新时间降序排列",
  {
    status: z
      .enum(["open", "closed", "*"])
      .default("open")
      .describe("状态过滤: open(默认)、closed、*(全部)"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(25)
      .describe("返回数量，默认 25，最大 100"),
  },
  async ({ status, limit }: { status: string; limit: number }) => {
    try {
      const statusValue = status === "open" ? "open" : status === "closed" ? "closed" : "*";
      const data = await redmineGet("/issues.json", {
        assigned_to_id: "me",
        status_id: statusValue,
        limit: String(limit),
        sort: "updated_on:desc",
      });
      const text = formatIssueList(data);
      return { content: [{ type: "text", text }] };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `获取我的 Issue 失败: ${err.message}` }],
        isError: true,
      };
    }
  }
);

(server.tool as any)(
  "search_issues",
  "按关键词搜索 Issue，支持按项目、状态、Tracker、指派人过滤",
  {
    query: z.string().describe("搜索关键词（必填）"),
    project: z.string().optional().describe("项目标识符（可选）"),
    status: z
      .enum(["open", "closed", "*"])
      .optional()
      .describe("状态过滤（可选）: open、closed、*"),
    tracker_id: z.number().optional().describe("Tracker ID（可选）"),
    assigned_to_id: z.number().optional().describe("指派人用户 ID（可选）"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe("返回数量，默认 10，最大 100"),
  },
  async ({ query, project, status, tracker_id, assigned_to_id, limit }: { query: string; project?: string; status?: string; tracker_id?: number; assigned_to_id?: number; limit: number }) => {
    try {
      const params: Record<string, string> = {
        subject: `~${query}`,
        limit: String(limit),
        sort: "updated_on:desc",
      };
      if (project) params.project_id = project as string;
      if (status) params.status_id = status as string;
      if (tracker_id) params.tracker_id = String(tracker_id);
      if (assigned_to_id) params.assigned_to_id = String(assigned_to_id);

      const data = await redmineGet("/issues.json", params);
      const text = formatIssueList(data);
      return { content: [{ type: "text", text }] };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `搜索 Issue 失败: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// === 写入工具 ===

(server.tool as any)(
  "update_issue",
  "更新 Issue（修改状态、指派、优先级、完成度或添加备注）",
  {
    issue_id: z.number().describe("Issue ID"),
    status_id: z.number().optional().describe("新状态 ID"),
    assigned_to_id: z.number().optional().describe("指派人用户 ID"),
    priority_id: z.number().optional().describe("优先级 ID"),
    done_ratio: z.number().min(0).max(100).optional().describe("完成百分比 0-100"),
    notes: z.string().optional().describe("添加备注/评论"),
  },
  async ({ issue_id, status_id, assigned_to_id, priority_id, done_ratio, notes }) => {
    try {
      const issue: Record<string, any> = {};
      if (status_id !== undefined) issue.status_id = status_id;
      if (assigned_to_id !== undefined) issue.assigned_to_id = assigned_to_id;
      if (priority_id !== undefined) issue.priority_id = priority_id;
      if (done_ratio !== undefined) issue.done_ratio = done_ratio;
      if (notes !== undefined) issue.notes = notes;

      if (Object.keys(issue).length === 0) {
        return {
          content: [{ type: "text", text: "错误: 至少需要提供一个要更新的字段（status_id、assigned_to_id、priority_id、done_ratio 或 notes）" }],
          isError: true,
        };
      }

      await redminePut(`/issues/${issue_id}.json`, { issue });
      return { content: [{ type: "text", text: `✅ Issue #${issue_id} 已更新成功` }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `错误: ${err.message}` }], isError: true };
    }
  }
);

(server.tool as any)(
  "create_issue",
  "创建新 Issue",
  {
    project_id: z.string().describe("项目标识符"),
    subject: z.string().describe("Issue 标题"),
    description: z.string().optional().describe("Issue 描述"),
    tracker_id: z.number().optional().describe("Tracker 类型 ID"),
    priority_id: z.number().optional().describe("优先级 ID"),
    assigned_to_id: z.number().optional().describe("指派人用户 ID"),
    parent_issue_id: z.number().optional().describe("父任务 ID"),
    fixed_version_id: z.number().optional().describe("目标版本 ID"),
  },
  async ({ project_id, subject, description, tracker_id, priority_id, assigned_to_id, parent_issue_id, fixed_version_id }) => {
    try {
      const issue: Record<string, any> = {
        project_id,
        subject,
      };
      if (description !== undefined) issue.description = description;
      if (tracker_id !== undefined) issue.tracker_id = tracker_id;
      if (priority_id !== undefined) issue.priority_id = priority_id;
      if (assigned_to_id !== undefined) issue.assigned_to_id = assigned_to_id;
      if (parent_issue_id !== undefined) issue.parent_issue_id = parent_issue_id;
      if (fixed_version_id !== undefined) issue.fixed_version_id = fixed_version_id;

      const data = await redminePost("/issues.json", { issue });
      const newIssue = data.issue;
      return {
        content: [{
          type: "text",
          text: `✅ 已创建 Issue #${newIssue.id}\n标题: ${newIssue.subject}\n项目: ${newIssue.project?.name}\n状态: ${newIssue.status?.name}\n优先级: ${newIssue.priority?.name}`,
        }],
      };
    } catch (err: any) {
      return { content: [{ type: "text", text: `错误: ${err.message}` }], isError: true };
    }
  }
);

(server.tool as any)(
  "add_comment",
  "给 Issue 添加评论",
  {
    issue_id: z.number().describe("Issue ID"),
    comment: z.string().describe("评论内容"),
    private: z.boolean().default(false).describe("是否为私密评论"),
  },
  async ({ issue_id, comment, private: isPrivate }: { issue_id: number; comment: string; private: boolean }) => {
    try {
      await redminePut(`/issues/${issue_id}.json`, {
        issue: { notes: comment, private_notes: isPrivate },
      });
      return { content: [{ type: "text", text: `✅ 已在 Issue #${issue_id} 添加评论` }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `错误: ${err.message}` }], isError: true };
    }
  }
);

(server.tool as any)(
  "create_time_entry",
  "记录工时",
  {
    issue_id: z.number().describe("Issue ID"),
    hours: z.number().positive().describe("工时（小时），必须为正数"),
    activity_id: z.number().optional().describe("活动类型 ID"),
    spent_on: z.string().optional().describe("日期，格式 YYYY-MM-DD，默认今天"),
    comments: z.string().optional().describe("工时备注"),
  },
  async ({ issue_id, hours, activity_id, spent_on, comments }) => {
    try {
      const time_entry: Record<string, any> = {
        issue_id,
        hours,
      };
      if (activity_id !== undefined) time_entry.activity_id = activity_id;
      if (spent_on !== undefined) {
        time_entry.spent_on = spent_on;
      } else {
        time_entry.spent_on = new Date().toISOString().split("T")[0];
      }
      if (comments !== undefined) time_entry.comments = comments;

      const data = await redminePost("/time_entries.json", { time_entry });
      const entry = data.time_entry;
      return {
        content: [{
          type: "text",
          text: `✅ 已记录工时: ${entry.hours}h on Issue #${entry.issue?.id} (${entry.spent_on})`,
        }],
      };
    } catch (err: any) {
      return { content: [{ type: "text", text: `错误: ${err.message}` }], isError: true };
    }
  }
);

// === 辅助查询工具 ===

(server.tool as any)(
  "list_projects",
  "获取 Zmind 上的项目列表",
  {
    limit: z.number().min(1).default(25).describe("返回数量，默认 25"),
  },
  async ({ limit }) => {
    try {
      const data = await redmineGet("/projects.json", {
        limit: String(limit),
      });
      const projects = data.projects || [];
      if (projects.length === 0) return { content: [{ type: "text", text: "未找到任何项目" }] };
      const text = projects
        .map((p: any) => `[${p.identifier}] ${p.name}`)
        .join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `错误: ${err.message}` }], isError: true };
    }
  }
);

(server.tool as any)(
  "get_versions",
  "获取指定项目的版本列表",
  {
    project_id: z.string().describe("项目标识符"),
  },
  async ({ project_id }) => {
    try {
      const data = await redmineGet(`/projects/${project_id}/versions.json`);
      const versions = data.versions || [];
      if (versions.length === 0) return { content: [{ type: "text", text: "该项目暂无版本" }] };
      const text = versions
        .map((v: any) => `${v.id}: ${v.name} (${v.status})`)
        .join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `错误: ${err.message}` }], isError: true };
    }
  }
);

(server.tool as any)(
  "get_project_members",
  "获取指定项目的成员及角色列表",
  {
    project_id: z.string().describe("项目标识符"),
  },
  async ({ project_id }) => {
    try {
      const data = await redmineGet(`/projects/${project_id}/memberships.json`);
      const memberships = data.memberships || [];
      if (memberships.length === 0) return { content: [{ type: "text", text: "该项目暂无成员" }] };
      const text = memberships
        .map((m: any) => {
          const name = m.user?.name || m.group?.name || "未知";
          const roles = (m.roles || []).map((r: any) => r.name).join(", ");
          return `${name} - ${roles}`;
        })
        .join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `错误: ${err.message}` }], isError: true };
    }
  }
);

(server.tool as any)(
  "get_issue_statuses",
  "获取所有 Issue 状态列表",
  {},
  async () => {
    try {
      const data = await redmineGet("/issue_statuses.json");
      const statuses = data.issue_statuses || [];
      if (statuses.length === 0) return { content: [{ type: "text", text: "未找到任何状态" }] };
      const text = statuses
        .map((s: any) => `${s.id}: ${s.name}`)
        .join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `错误: ${err.message}` }], isError: true };
    }
  }
);

(server.tool as any)(
  "get_trackers",
  "获取所有 Tracker 类型列表",
  {},
  async () => {
    try {
      const data = await redmineGet("/trackers.json");
      const trackers = data.trackers || [];
      if (trackers.length === 0) return { content: [{ type: "text", text: "未找到任何 Tracker" }] };
      const text = trackers
        .map((t: any) => `${t.id}: ${t.name}`)
        .join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `错误: ${err.message}` }], isError: true };
    }
  }
);

(server.tool as any)(
  "get_priorities",
  "获取所有 Issue 优先级列表",
  {},
  async () => {
    try {
      const data = await redmineGet("/enumerations/issue_priorities.json");
      const priorities = data.issue_priorities || [];
      if (priorities.length === 0) return { content: [{ type: "text", text: "未找到任何优先级" }] };
      const text = priorities
        .map((p: any) => `${p.id}: ${p.name}`)
        .join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `错误: ${err.message}` }], isError: true };
    }
  }
);

(server.tool as any)(
  "get_time_activities",
  "获取所有工时活动类型列表",
  {},
  async () => {
    try {
      const data = await redmineGet("/enumerations/time_entry_activities.json");
      const activities = data.time_entry_activities || [];
      if (activities.length === 0) return { content: [{ type: "text", text: "未找到任何活动类型" }] };
      const text = activities
        .map((a: any) => `${a.id}: ${a.name}`)
        .join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `错误: ${err.message}` }], isError: true };
    }
  }
);

// === 附件工具（v2.0.0 全新工作流）===

(server.tool as any)(
  "download_attachment",
  "★ 下载 Zmind Issue 的附件。v2.0.0 行为升级：\n" +
    "- 默认（save_to 不传）：保留 v1.x 行为（文本内联返回，二进制只返元信息）\n" +
    "- 推荐：传 save_to 让附件落盘到 workspace 内的指定路径，便于后续 read_file / 解压 / 转换\n" +
    "- 更推荐：直接调 prepare_issue_workspace 一站式处理整个 Issue 的所有附件",
  {
    attachment_url: z.string().describe("附件下载 URL（从 get_issue 返回的 attachments 中获取 content_url）"),
    filename: z.string().optional().describe("附件文件名（用于判断文件类型）"),
    save_to: z.string().optional().describe("可选；落盘到指定绝对路径。若指定则不内联返回内容"),
  },
  async ({ attachment_url, filename, save_to }: { attachment_url: string; filename?: string; save_to?: string }) => {
    try {
      validateConfig();

      const name = filename || attachment_url.split("/").pop() || "unknown";

      // 构建带认证的 URL
      const url = new URL(attachment_url);
      url.searchParams.set("key", API_KEY);

      const res = await zmindFetch(url.toString());
      if (!res.ok) {
        throw new Error(`下载附件失败 (HTTP ${res.status}): ${name}`);
      }

      // save_to 模式：直接落盘，不内联
      if (save_to) {
        await mkdir(path.dirname(save_to), { recursive: true });
        const buf = Buffer.from(await res.arrayBuffer());
        await writeFile(save_to, buf);
        return {
          content: [{
            type: "text",
            text: `✅ 附件已落盘\n- 文件: ${name}\n- 路径: ${save_to}\n- 大小: ${(buf.length / 1024).toFixed(1)} KB\n\nAI 可用 read_file 工具读取该路径，或调 prepare_issue_workspace 做完整路由处理。`,
          }],
        };
      }

      // 旧行为：基于扩展名的简单判定 + 内联返回
      const ext = name.split(".").pop()?.toLowerCase() || "";
      const textExtensions = ["log", "txt", "xml", "json", "csv", "conf", "cfg", "prop", "properties", "ini", "sh", "py", "java", "kt", "c", "h", "cpp", "md"];
      const compressedExtensions = ["gz", "zip", "tar", "bz2", "7z", "rar"];
      const binaryExtensions = ["png", "jpg", "jpeg", "gif", "bmp", "mp4", "avi", "mov", "mkv", "apk", "so", "bin", "img", "pdf", "doc", "docx", "xls", "xlsx"];

      const isText = textExtensions.includes(ext);
      const isCompressed = compressedExtensions.includes(ext);
      const isBinary = binaryExtensions.includes(ext);

      if (isText) {
        const content = await res.text();
        const truncated = content.length > 100000
          ? content.substring(0, 100000) + "\n\n... [文件过大，已截断，共 " + content.length + " 字符]"
          : content;
        return { content: [{ type: "text", text: `📄 ${name}\n\n${truncated}` }] };
      } else if (isCompressed || isBinary) {
        const size = res.headers.get("content-length") || "未知";
        const sizeKB = size !== "未知" ? `${(parseInt(size) / 1024).toFixed(1)} KB` : "未知";
        const typeLabel = isBinary ? "二进制文件" : "压缩包";
        const hint = isBinary
          ? "此文件为二进制格式，无法直接读取内容。建议传 save_to 参数让附件落盘，或调 prepare_issue_workspace 自动处理。"
          : "此文件为压缩包。建议传 save_to 参数让附件落盘 + 用 prepare_issue_workspace 自动解压。";

        return {
          content: [{
            type: "text",
            text: `📦 ${name}\n- 类型: ${typeLabel}\n- 大小: ${sizeKB}\n- 下载链接: ${attachment_url}\n\n${hint}`,
          }],
        };
      } else {
        const content = await res.text();
        if (content.length > 0 && !content.includes("\x00")) {
          const truncated = content.length > 100000
            ? content.substring(0, 100000) + "\n\n... [文件过大，已截断]"
            : content;
          return { content: [{ type: "text", text: `📄 ${name}\n\n${truncated}` }] };
        } else {
          return {
            content: [{
              type: "text",
              text: `📦 ${name}\n- 类型: 未知二进制文件\n- 下载链接: ${attachment_url}\n\n建议传 save_to 参数让附件落盘。`,
            }],
          };
        }
      }
    } catch (err: any) {
      return { content: [{ type: "text", text: `下载附件失败: ${err.message}` }], isError: true };
    }
  }
);

// =============================================================================
// prepare_issue_workspace（v2.0.0 ★ 核心新工具）
// =============================================================================
(server.tool as any)(
  "prepare_issue_workspace",
  "★★ **一站式准备 Issue 工作目录** ★★\n" +
    "\n" +
    "在 workspace 根下创建 `.workspace/issue-<id>/` 目录，自动下载并处理所有附件：\n" +
    "  - 文本（log/txt/xml/json/conf 等）→ 落盘 + 内联返回内容\n" +
    "  - 图片（png/jpg 等）→ 落盘，AI 可用 read_file + vision 读\n" +
    "  - zip / tar.gz / tgz → 落盘 + 自动解压\n" +
    "  - 7z / rar → 落盘 + 检测本机 7z 命令\n" +
    "  - HCI / btsnoop log → 落盘 + 检测本机 tshark\n" +
    "  - PDF → 落盘 + 检测本机 pdftotext\n" +
    "  - 视频 → 落盘 + 提示用户描述关键帧\n" +
    "  - 其他 → 落盘 + 元信息\n" +
    "\n" +
    "目录结构：\n" +
    "  .workspace/issue-<id>/\n" +
    "  ├── README.md         AI 自动生成的 Issue 摘要 + 文件索引\n" +
    "  ├── attachments/      原始附件\n" +
    "  ├── extracted/        解压后的内容\n" +
    "  ├── analysis.md       AI 分析报告（待生成）\n" +
    "  └── notes.md          沟通笔记（待生成）\n" +
    "\n" +
    "建议在 .gitignore 加入 .workspace/ 排除项。\n" +
    "\n" +
    "返回结构化的处理结果数组，AI 可据此决定后续动作（read_file / 进一步分析）。",
  {
    issue_id: z.number().int().positive().describe("Zmind Issue ID"),
    workspace_root: z
      .string()
      .min(1)
      .describe("Workspace 根目录绝对路径（如 ~/cvte_code/amlogic 或 W:\\code\\950_stm\\amlogic）"),
    only_filenames: z
      .array(z.string())
      .optional()
      .describe(
        "可选；仅处理指定文件名的附件（用于已部分处理过的 Issue 增量补充）",
      ),
    skip_video: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否跳过视频附件（默认 true，避免下载大文件）"),
  },
  async (args: {
    issue_id: number;
    workspace_root: string;
    only_filenames?: string[];
    skip_video?: boolean;
  }) => {
    try {
      validateConfig();

      // 1. 拉取 Issue 详情
      const data = await redmineGet(`/issues/${args.issue_id}.json`, {
        include: "journals,attachments",
      });
      const issue = data.issue;
      if (!issue) {
        throw new Error(`Issue #${args.issue_id} 不存在或不可访问`);
      }

      // 2. 创建工作目录
      const dirs = await ensureIssueWorkspace(args.workspace_root, args.issue_id);

      // 3. 处理附件
      const attachments: any[] = issue.attachments ?? [];
      const filtered = attachments.filter((a) => {
        if (args.only_filenames && args.only_filenames.length > 0) {
          return args.only_filenames.includes(a.filename);
        }
        if (args.skip_video !== false) {
          const lower = a.filename.toLowerCase();
          if (/\.(mp4|avi|mov|mkv|webm|flv)$/.test(lower)) return false;
        }
        return true;
      });

      const results: AttachmentProcessResult[] = [];
      const errors: Array<{ filename: string; error: string }> = [];

      for (const att of filtered) {
        try {
          const result = await processAttachment({
            attachment_url: att.content_url,
            filename: att.filename,
            api_key: API_KEY,
            attachments_dir: dirs.attachments,
            extracted_dir: dirs.extracted,
          });
          results.push(result);
        } catch (e) {
          errors.push({
            filename: att.filename,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      // 4. 写 README.md
      const readmePath = await writeWorkspaceReadme(
        dirs.root,
        {
          id: issue.id,
          subject: issue.subject,
          description: issue.description,
          project_name: issue.project?.name,
          status: issue.status?.name,
          target_version: issue.fixed_version?.name,
        },
        results,
      );

      // 5. 组装人类可读 + 结构化输出
      const summary = {
        issue_id: args.issue_id,
        workspace: dirs.root,
        readme: readmePath,
        attachments_processed: results.length,
        attachments_skipped: attachments.length - filtered.length,
        attachments_errored: errors.length,
        attachments: results.map((r) => ({
          filename: r.meta.filename,
          kind: r.meta.kind,
          size: r.meta.size,
          saved_path: r.meta.saved_path,
          extracted_dir: r.extracted?.extract_dir,
          extracted_files: r.extracted?.file_count,
          has_text_content: !!r.text_content,
          external_tool: r.external_tool_available,
          hint: r.hint,
        })),
        errors,
      };

      // 人类可读 + JSON
      let humanText = `🎉 Issue #${args.issue_id} 工作目录已就绪\n\n`;
      humanText += `📁 ${dirs.root}\n`;
      humanText += `📄 README.md: ${readmePath}\n\n`;
      humanText += `处理了 ${results.length} 个附件`;
      if (errors.length > 0) humanText += `（${errors.length} 个失败）`;
      humanText += `:\n\n`;
      for (const r of results) {
        humanText += `  • [${r.meta.kind}] ${r.meta.filename} → ${r.meta.saved_path}\n`;
        if (r.extracted) {
          humanText += `    解压到 ${r.extracted.extract_dir}（${r.extracted.file_count} 个文件）\n`;
        }
        humanText += `    💡 ${r.hint}\n\n`;
      }
      if (errors.length > 0) {
        humanText += `\n失败的附件:\n`;
        for (const e of errors) {
          humanText += `  ❌ ${e.filename}: ${e.error}\n`;
        }
      }
      humanText += `\n---\n结构化数据:\n${JSON.stringify(summary, null, 2)}`;

      return { content: [{ type: "text", text: humanText }] };
    } catch (err: any) {
      return {
        content: [
          { type: "text", text: `prepare_issue_workspace 失败: ${err.message}` },
        ],
        isError: true,
      };
    }
  },
);

// === 启动 ===
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[zmind-mcp-server v2.1.1] started — RAR5 ready, WAF retry on (${describeHttpClientConfig()})`,
  );
}

main().catch(console.error);
