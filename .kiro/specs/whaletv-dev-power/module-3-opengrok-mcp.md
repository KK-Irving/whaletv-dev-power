---
inclusion: manual
---

# Skill: 模块 3 - OpenGrok MCP Server

## 适用范围

实现 `mcp-servers/opengrok-mcp-server/src/index.ts`，提供 2 个工具进行 AOSP 源码搜索。

## 技术栈

与 Zmind MCP Server 相同：TypeScript + @modelcontextprotocol/sdk + stdio + zod + 内置 fetch

## 代码结构规范

```typescript
// 1. 导入
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 2. 环境变量与常量
const OPENGROK_URL = process.env.OPENGROK_URL || "";
const OPENGROK_PROJECT = process.env.OPENGROK_PROJECT || "";
const REQUEST_TIMEOUT = 15000; // 15 秒

// 3. 校验函数
function validateConfig(): void { ... }

// 4. 搜索辅助函数
async function opengrokSearch(type: "full" | "def", query: string, maxResults: number): Promise<string> { ... }

// 5. 格式化函数
function formatResults(data: any, type: string): string { ... }

// 6. Server 实例化
const server = new McpServer({ name: "opengrok", version: "1.0.0" });

// 7. 工具注册
server.tool("search_code", ...);
server.tool("search_symbol", ...);

// 8. 启动
async function main() { ... }
main().catch(console.error);
```

## 超时处理规范

使用 AbortController 实现 15 秒超时：

```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
try {
  const res = await fetch(url, { signal: controller.signal });
  // ...
} catch (err) {
  if (err.name === "AbortError") {
    throw new Error(`OpenGrok 请求超时（超过 15 秒），服务地址: ${OPENGROK_URL}`);
  }
  // 连接错误处理...
} finally {
  clearTimeout(timeout);
}
```

## 错误处理规范

| 场景 | 错误信息格式 |
|------|-------------|
| OPENGROK_URL 未配置 | "环境变量 OPENGROK_URL 未配置，请设置 OpenGrok 服务地址" |
| 服务不可达 | "无法连接 OpenGrok 服务: {url}，请检查服务是否可达" |
| 请求超时 | "OpenGrok 请求超时（超过 15 秒），服务地址: {url}" |
| 无搜索结果 | "全文搜索未匹配到任何结果" / "符号定义搜索未匹配到任何结果" |
| 参数为空 | zod 校验自动拦截 |

## 搜索结果格式规范

每条结果包含：
- 文件路径 + 行号
- 匹配行前后各 3 行的代码上下文

格式：
```
文件: path/to/file.java:123
上下文:
  [前3行]
  > [匹配行]
  [后3行]

---

文件: path/to/another.java:456
...
```

## 关键约束

- query/symbol 参数长度：1-200 字符（zod 校验）
- max_results 默认 20，上限 100
- 超时固定 15 秒，不可配置
- 使用 stdio 传输协议
- 连接错误检测：ECONNREFUSED 和 ENOTFOUND
