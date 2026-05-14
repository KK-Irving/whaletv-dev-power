---
inclusion: manual
---

# Skill: 模块 2 - Zmind MCP Server

## 适用范围

实现 `mcp-servers/zmind-mcp-server/src/index.ts`，提供 14 个工具与 Zmind (Redmine) 系统交互。

## 技术栈

- TypeScript (ES2022, ESM)
- `@modelcontextprotocol/sdk` (stdio transport)
- `zod` 参数校验
- Node.js 内置 `fetch`（不引入 axios 等第三方 HTTP 库）

## 代码结构规范

```typescript
// 1. 导入
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 2. 环境变量与常量
const BASE_URL = process.env.ZMIND_URL || "https://zmind.whaletv.com";
const API_KEY = process.env.ZMIND_API_KEY || "";

// 3. 校验函数
function validateConfig(): void { ... }

// 4. HTTP 辅助函数
async function redmineGet(path, params?): Promise<any> { ... }
async function redminePut(path, body): Promise<number> { ... }
async function redminePost(path, body): Promise<any> { ... }
async function redmineDelete(path): Promise<number> { ... }

// 5. 格式化辅助函数
function formatIssue(issue): string { ... }
function formatIssueList(issues): string { ... }

// 6. Server 实例化
const server = new McpServer({ name: "zmind-mcp-server", version: "1.0.0" });

// 7. 工具注册（按类别分组）
// 7a. 查询工具
server.tool("get_issue", ...);
server.tool("my_issues", ...);
server.tool("search_issues", ...);
// 7b. 写入工具
server.tool("update_issue", ...);
server.tool("create_issue", ...);
server.tool("add_comment", ...);
server.tool("create_time_entry", ...);
// 7c. 辅助查询工具
server.tool("list_projects", ...);
server.tool("get_versions", ...);
server.tool("get_project_members", ...);
server.tool("get_issue_statuses", ...);
server.tool("get_trackers", ...);
server.tool("get_priorities", ...);
server.tool("get_time_activities", ...);
// 7d. 删除工具
server.tool("delete_issue", ...);

// 8. 启动
async function main() { ... }
main().catch(console.error);
```

## 工具注册模式

每个工具遵循统一模式：

```typescript
server.tool(
  "tool_name",
  "中文工具描述",
  {
    param1: z.string().describe("参数说明"),
    param2: z.number().optional().describe("可选参数说明"),
  },
  async ({ param1, param2 }) => {
    const result = await redmineGet(...);
    return { content: [{ type: "text", text: formatResult(result) }] };
  }
);
```

## 错误处理规范

1. **环境变量缺失**：在每次工具调用的 handler 开头调用 `validateConfig()`
2. **API 错误**：捕获非 2xx 响应，返回 `Zmind API 错误 (HTTP {status}): {errorText}`
3. **参数校验失败**：由 zod 自动处理，返回参数错误信息
4. **业务逻辑错误**：如 update_issue 无可选字段时，返回明确中文错误信息
5. **不抛出未捕获异常**：所有 async handler 内部 try-catch

## 返回格式规范

- 所有工具返回 `{ content: [{ type: "text", text: string }] }`
- 文本内容使用中文
- Issue 详情使用结构化文本（字段名: 值）
- 列表使用编号格式
- 日期格式保持 API 原始格式

## 关键约束

- `update_issue` 必须校验至少提供一个可选更新字段
- `my_issues` 默认 limit=25，最大 100
- `search_issues` 默认 limit=10，最大 100
- `create_time_entry` 的 hours 必须为正数
- `add_comment` 的 private 参数默认 false
- API Key 通过 URL 参数传递（Redmine 标准方式）
