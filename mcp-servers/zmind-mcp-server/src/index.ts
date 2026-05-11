#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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
  const res = await fetch(url.toString(), {
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
  const res = await fetch(url.toString(), {
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
  const res = await fetch(url.toString(), {
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

async function redmineDelete(path: string): Promise<number> {
  validateConfig();
  const url = new URL(path, BASE_URL);
  url.searchParams.set("key", API_KEY);
  const res = await fetch(url.toString(), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Zmind API 错误 (HTTP ${res.status}): ${errorText}`);
  }
  return res.status;
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
const server = new McpServer({ name: "zmind-mcp-server", version: "1.0.0" });

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

(server.tool as any)(
  "delete_issue",
  "删除指定 Issue（不可恢复，请谨慎操作）",
  {
    issue_id: z.number().describe("要删除的 Issue ID"),
  },
  async ({ issue_id }) => {
    try {
      await redmineDelete(`/issues/${issue_id}.json`);
      return { content: [{ type: "text", text: `✅ Issue #${issue_id} 已删除` }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `错误: ${err.message}` }], isError: true };
    }
  }
);

// === 启动 ===
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
