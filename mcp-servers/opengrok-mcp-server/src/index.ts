#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// === 环境变量与常量 ===
const OPENGROK_URL = process.env.OPENGROK_URL || "";
const OPENGROK_USERNAME = process.env.OPENGROK_USERNAME || "";
const OPENGROK_PASSWORD = process.env.OPENGROK_PASSWORD || "";
const OPENGROK_PROJECT = process.env.OPENGROK_PROJECT || "";
const REQUEST_TIMEOUT = 15000; // 15 秒超时

// === 校验函数 ===
function validateConfig(): void {
  if (!OPENGROK_URL) {
    throw new Error("环境变量 OPENGROK_URL 未配置，请设置 OpenGrok 服务地址");
  }
}

// === 构建认证头 ===
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Accept": "application/json" };
  if (OPENGROK_USERNAME && OPENGROK_PASSWORD) {
    const cred = Buffer.from(`${OPENGROK_USERNAME}:${OPENGROK_PASSWORD}`).toString("base64");
    headers["Authorization"] = `Basic ${cred}`;
  }
  return headers;
}

// === 搜索辅助函数 ===
async function opengrokSearch(
  type: "full" | "def" | "path",
  query: string,
  maxResults: number,
  project?: string
): Promise<string> {
  validateConfig();

  const url = new URL("/api/v1/search", OPENGROK_URL);
  url.searchParams.set(type, query);
  const proj = project || OPENGROK_PROJECT;
  if (proj) {
    url.searchParams.set("projects", proj);
  }
  url.searchParams.set("maxresults", String(maxResults));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(url.toString(), {
      headers: getAuthHeaders(),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`OpenGrok API 错误 (HTTP ${res.status}): ${await res.text()}`);
    }

    const data = await res.json();
    return formatSearchResults(data, type);
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

// === 获取文件内容 ===
async function opengrokGetFile(filePath: string): Promise<string> {
  validateConfig();

  const url = new URL(`/raw${filePath}`, OPENGROK_URL);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const headers: Record<string, string> = {};
    if (OPENGROK_USERNAME && OPENGROK_PASSWORD) {
      const cred = Buffer.from(`${OPENGROK_USERNAME}:${OPENGROK_PASSWORD}`).toString("base64");
      headers["Authorization"] = `Basic ${cred}`;
    }

    const res = await fetch(url.toString(), {
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`OpenGrok API 错误 (HTTP ${res.status}): 无法获取文件 ${filePath}`);
    }

    return await res.text();
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error(`OpenGrok 请求超时（超过 15 秒），服务地址: ${OPENGROK_URL}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// === 格式化搜索结果 ===
function formatSearchResults(data: any, type: string): string {
  const resultCount = data.resultCount || 0;
  const results = data.results || {};
  const fileEntries = Object.entries(results);

  if (fileEntries.length === 0) {
    const typeLabel = type === "full" ? "全文搜索" : type === "def" ? "符号定义搜索" : "路径搜索";
    return `${typeLabel}未匹配到任何结果`;
  }

  let output = `找到 ${resultCount} 条结果（耗时 ${data.time}ms）：\n\n`;

  for (const [filePath, matches] of fileEntries) {
    output += `📄 ${filePath}\n`;
    const matchList = matches as any[];
    for (const match of matchList) {
      const line = (match.line || "").replace(/<\/?b>/g, ""); // 去掉 HTML 加粗标签
      const lineNum = match.lineNumber || "";
      const tag = match.tag ? ` [${match.tag}]` : "";
      output += `  L${lineNum}${tag}: ${line.trim()}\n`;
    }
    output += "\n";
  }

  return output.trim();
}

// === Server 实例化 ===
const server = new McpServer({ name: "opengrok-mcp-server", version: "1.1.0" });

// === 工具注册 ===

(server.tool as any)(
  "search_code",
  "在 OpenGrok 中进行全文关键词搜索（跨项目公版代码搜索）",
  {
    query: z.string().min(1).max(200).describe("搜索关键词（1-200 字符）"),
    project: z.string().optional().describe("项目名称（如 d4_code、stb16_code、x5_code），不填则搜索所有项目"),
    max_results: z.number().min(1).max(100).default(20).describe("最大返回条数"),
  },
  async ({ query, project, max_results }: { query: string; project?: string; max_results: number }) => {
    try {
      const text = await opengrokSearch("full", query, max_results, project);
      return { content: [{ type: "text", text }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `错误: ${err.message}` }], isError: true };
    }
  }
);

(server.tool as any)(
  "search_symbol",
  "在 OpenGrok 中搜索类、方法、变量的定义位置",
  {
    symbol: z.string().min(1).max(200).describe("符号名称（1-200 字符）"),
    project: z.string().optional().describe("项目名称（如 d4_code、stb16_code、x5_code），不填则搜索所有项目"),
    max_results: z.number().min(1).max(100).default(20).describe("最大返回条数"),
  },
  async ({ symbol, project, max_results }: { symbol: string; project?: string; max_results: number }) => {
    try {
      const text = await opengrokSearch("def", symbol, max_results, project);
      return { content: [{ type: "text", text }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `错误: ${err.message}` }], isError: true };
    }
  }
);

(server.tool as any)(
  "search_path",
  "在 OpenGrok 中按文件路径搜索文件",
  {
    path: z.string().min(1).max(200).describe("文件路径或文件名（如 TvScanConfig.java）"),
    project: z.string().optional().describe("项目名称（如 d4_code、stb16_code、x5_code），不填则搜索所有项目"),
    max_results: z.number().min(1).max(100).default(20).describe("最大返回条数"),
  },
  async ({ path, project, max_results }: { path: string; project?: string; max_results: number }) => {
    try {
      const text = await opengrokSearch("path", path, max_results, project);
      return { content: [{ type: "text", text }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `错误: ${err.message}` }], isError: true };
    }
  }
);

(server.tool as any)(
  "get_file_content",
  "从 OpenGrok 获取指定文件的完整源码内容（只读）",
  {
    file_path: z.string().min(1).describe("文件完整路径（如 /d4_code/amlogic/vendor/.../TvScanConfig.java）"),
  },
  async ({ file_path }: { file_path: string }) => {
    try {
      // 确保路径以 / 开头
      const normalizedPath = file_path.startsWith("/") ? file_path : `/${file_path}`;
      const content = await opengrokGetFile(normalizedPath);
      return { content: [{ type: "text", text: content }] };
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
