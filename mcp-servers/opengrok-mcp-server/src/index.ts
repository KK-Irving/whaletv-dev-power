#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const OPENGROK_URL = process.env.OPENGROK_URL || "";
const OPENGROK_PROJECT = process.env.OPENGROK_PROJECT || "";
const REQUEST_TIMEOUT = 15000; // 15 秒超时

function validateConfig(): void {
  if (!OPENGROK_URL) {
    throw new Error("环境变量 OPENGROK_URL 未配置，请设置 OpenGrok 服务地址");
  }
}

async function opengrokSearch(
  type: "full" | "def",
  query: string,
  maxResults: number
): Promise<string> {
  validateConfig();

  const url = new URL("/api/v1/search", OPENGROK_URL);
  url.searchParams.set(type, query);
  if (OPENGROK_PROJECT) {
    url.searchParams.set("projects", OPENGROK_PROJECT);
  }
  url.searchParams.set("maxresults", String(maxResults));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(url.toString(), {
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`OpenGrok API 错误 (HTTP ${res.status}): ${await res.text()}`);
    }

    const data = await res.json();
    return formatResults(data, type);
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error(`OpenGrok 请求超时（超过 15 秒），服务地址: ${OPENGROK_URL}`);
    }
    if (err.cause?.code === "ECONNREFUSED" || err.cause?.code === "ENOTFOUND") {
      throw new Error(`无法连接 OpenGrok 服务: ${OPENGROK_URL}，请检查服务是否可达`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function formatResults(data: any, type: string): string {
  const results = data.results || [];
  if (results.length === 0) {
    return type === "full"
      ? "全文搜索未匹配到任何结果"
      : "符号定义搜索未匹配到任何结果";
  }

  return results
    .map((r: any) => {
      const lines = [
        `文件: ${r.path}:${r.lineNumber}`,
        `上下文:`,
        r.context || r.line,
      ];
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}

const server = new McpServer({ name: "opengrok", version: "1.0.0" });

(server.tool as any)(
  "search_code",
  "在 AOSP 源码中进行全文关键词搜索",
  {
    query: z.string().min(1).max(200).describe("搜索关键词（1-200 字符）"),
    max_results: z.number().min(1).max(100).default(20).describe("最大返回条数"),
  },
  async ({ query, max_results }: { query: string; max_results: number }) => {
    try {
      const text = await opengrokSearch("full", query, max_results);
      return { content: [{ type: "text", text }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `错误: ${err.message}` }], isError: true };
    }
  }
);

(server.tool as any)(
  "search_symbol",
  "搜索类、方法、变量的定义位置",
  {
    symbol: z.string().min(1).max(200).describe("符号名称（1-200 字符）"),
    max_results: z.number().min(1).max(100).default(20).describe("最大返回条数"),
  },
  async ({ symbol, max_results }: { symbol: string; max_results: number }) => {
    try {
      const text = await opengrokSearch("def", symbol, max_results);
      return { content: [{ type: "text", text }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `错误: ${err.message}` }], isError: true };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
