#!/usr/bin/env node
/**
 * confluence-mcp-server v1.0.0
 *
 * 工具：
 *   1. search_confluence(query, space?, limit?)  —— CQL 全文检索（默认包装 text~"<query>"）
 *   2. get_page(page_id)                         —— 单页面详情（HTML→text, 截 8000 字）
 *   3. list_spaces()                             —— 列出所有 global 空间
 *
 * 环境变量：
 *   - CONFLUENCE_BASE_URL              必填，例 https://docs.whaletv.com
 *   - CONFLUENCE_COOKIE                必填，浏览器登录后抓的完整 Cookie 头
 *   - CONFLUENCE_TIMEOUT_MS            可选，单请求超时（默认 30000）
 *   - CONFLUENCE_REQUEST_DELAY_MS      可选，请求最小间隔（默认 150，防 WAF）
 *
 * 凭据维护：跑 `scripts/refresh-auth.{ps1,sh}` 自动抓取 cookie 写入 mcp.json。
 */

// v3: 先加载 SoT（~/.ai/whaletv.yaml）到 process.env，再读取 env（env 已存在则不覆盖）
import "./sot-loader.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { searchConfluence } from "./tools/search.js";
import { getPage } from "./tools/get-page.js";
import { listSpaces } from "./tools/list-spaces.js";
import { ConfluenceError, getConfluenceConfig } from "./auth.js";

const server = new McpServer({ name: "confluence-mcp-server", version: "1.0.0" });

// =============================================================================
// 错误统一包装：把 ConfluenceError 转成 MCP 友好 content
// =============================================================================

function asJsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function wrap(handler: () => Promise<unknown>) {
  return async () => {
    try {
      const result = await handler();
      return {
        content: [{ type: "text" as const, text: asJsonText(result) }],
      };
    } catch (e) {
      if (e instanceof ConfluenceError) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: asJsonText({
                error_type: e.error_type,
                message: e.message,
                http_status: e.http_status,
                details: e.details,
              }),
            },
          ],
        };
      }
      const msg = e instanceof Error ? e.message : String(e);
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: asJsonText({ error_type: "internal_error", message: msg }),
          },
        ],
      };
    }
  };
}

// =============================================================================
// 工具注册
// =============================================================================

(server.tool as any)(
  "search_confluence",
  "全文检索 Confluence 文档中心（CQL）。query 自动判定：含 CQL 关键字（AND/OR/space/title 等）则透传；否则包装为 text~\"<query>\"。可选 space 限定空间 key（如 'TVENG'）。返回命中页面（id、标题、URL、snippet 320 字、空间）。",
  {
    query: z.string().min(1).describe("查询字符串；可为关键字或 CQL 表达式"),
    space: z.string().optional().describe("（可选）限定空间 key"),
    limit: z.number().int().min(1).max(20).default(5).describe("返回上限（1-20，默认 5）"),
  },
  ({ query, space, limit }: { query: string; space?: string; limit?: number }) =>
    wrap(() => searchConfluence({ query, space, limit }))(),
);

(server.tool as any)(
  "get_page",
  "拉取单个 Confluence 页面的完整内容（HTML 转纯文本，截至 8000 字）。返回 id、标题、URL、空间、版本号、更新时间、body_text、body_truncated。",
  {
    page_id: z.string().min(1).describe("Confluence 页面 ID（数字字符串，从搜索结果或 URL 中获取）"),
  },
  ({ page_id }: { page_id: string }) => wrap(() => getPage({ page_id }))(),
);

(server.tool as any)(
  "list_spaces",
  "列出当前账户可见的全部 global 空间，分页累加返回 [{ key, name }, ...]。用于了解哪些空间存在以便用 space 参数缩小 search_confluence 的范围。",
  {},
  () => wrap(() => listSpaces())(),
);

// =============================================================================
// 启动
// =============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // 启动 banner（不输出凭据值，仅输出是否已配置）
  const cfg = getConfluenceConfig();
  const cookieStatus = cfg.cookie ? `cookie_set` : `cookie_missing`;
  const baseHint = cfg.url || "(未配置 CONFLUENCE_BASE_URL)";
  console.error(
    `[confluence-mcp-server v1.0.0] started (${cookieStatus}, base=${baseHint}, delay=${cfg.requestDelayMs}ms)`,
  );
}

main().catch((err) => {
  console.error("[confluence-mcp-server] fatal error:", err);
  process.exit(1);
});
