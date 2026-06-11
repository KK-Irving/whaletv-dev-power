#!/usr/bin/env node
/**
 * knowledge-mcp-server v1.0.0
 *
 * 本地三源知识库（Zmind PR / Gerrit changes / Confluence pages）：
 *   - SQLite + FTS5 全文索引
 *   - BGE-small-zh ONNX 嵌入（@xenova/transformers）+ Float32Array BLOB 列存向量
 *   - vector / fts / hybrid 三模式跨源融合检索
 *
 * 工具：
 *   1. sync_zmind        — 拉 Zmind issues 到本地（增量水位）
 *   2. sync_gerrit       — 拉 Gerrit changes 到本地（双通道认证）
 *   3. sync_confluence   — 拉 Confluence pages 到本地（cookie 认证）
 *   4. embed_pending     — 给未嵌入或已过期的行批量计算嵌入
 *   5. search_local      — 单源/跨源 vector|fts|hybrid 检索
 *   6. get_indexed       — 取本地索引完整记录
 *
 * 数据库：默认 ./data/knowledge.db（KNOWLEDGE_DB_PATH 可覆盖）
 * 模型：默认 Xenova/bge-small-zh-v1.5（首次启动自动下载到 ./data/models/）
 *
 * 凭据复用：
 *   - Zmind: ZMIND_URL + ZMIND_API_KEY
 *   - Gerrit: GERRIT_URL + (GERRIT_AUTH_HEADER + GERRIT_COOKIE) 或 (GERRIT_USERNAME + GERRIT_HTTP_PASSWORD)
 *   - Confluence: CONFLUENCE_BASE_URL + CONFLUENCE_COOKIE
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { config, isSourceName, type SourceName } from "./config.js";
import { syncZmind } from "./sources/zmind-sync.js";
import { syncGerrit } from "./sources/gerrit-sync.js";
import { syncConfluence } from "./sources/confluence-sync.js";
import { embedPending } from "./embed-pending.js";
import { searchLocal, getIndexed } from "./search.js";
import { getDb } from "./db.js";
import { indexAospModule, clearAospIndex } from "./aosp/indexer.js";
import { searchAosp } from "./aosp/search.js";
import { embedAospPending } from "./aosp/embed-aosp.js";
import { listModulesOfPlatform, loadModuleMap } from "./aosp/module-map-loader.js";
import { analyzeIssue } from "./analyze-issue.js";

const server = new McpServer({ name: "knowledge-mcp-server", version: "1.0.0" });

// =============================================================================
// 错误统一包装
// =============================================================================

function asJsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function wrap(handler: () => Promise<unknown>) {
  return async () => {
    try {
      const result = await handler();
      return { content: [{ type: "text" as const, text: asJsonText(result) }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: asJsonText({ error: msg }),
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
  "sync_zmind",
  "增量同步 Zmind issues 到本地 SQLite。默认按 sync_state 的 last_full_sync 水位增量拉取，未配置时全量从最新开始按 updated_on 降序拉。",
  {
    since: z.string().optional().describe("(可选) 仅同步 updated_on >= since 的 issues，YYYY-MM-DD"),
    limit: z.number().int().min(1).max(50000).default(1000).describe("最大同步条数"),
    statusId: z.string().optional().describe("(可选) 状态过滤；默认 '*' 全部"),
  },
  ({ since, limit, statusId }: { since?: string; limit?: number; statusId?: string }) =>
    wrap(() => syncZmind({ since, limit, statusId }))(),
);

(server.tool as any)(
  "sync_gerrit",
  "增量同步 Gerrit changes 到本地 SQLite。使用 v1.1 双通道认证。可指定 query 与 project 缩小范围。",
  {
    query: z.string().optional().describe("(可选) Gerrit 原生 query 表达式（拼接到 query 后）"),
    project: z.string().optional().describe("(可选) project 过滤"),
    since: z.string().optional().describe("(可选) after:\"YYYY-MM-DD\" 增量水位；未传则用 sync_state"),
    limit: z.number().int().min(1).max(50000).default(1000).describe("最大同步条数"),
  },
  ({ query, project, since, limit }: { query?: string; project?: string; since?: string; limit?: number }) =>
    wrap(() => syncGerrit({ query, project, since, limit }))(),
);

(server.tool as any)(
  "sync_confluence",
  "增量同步 Confluence pages 到本地 SQLite。space 不传时遍历所有 global 空间；HTML 自动转纯文本入库。",
  {
    space: z.string().optional().describe("(可选) 空间 key（CSV 多个，如 'TVENG,DOC'）；未传则全空间"),
    since: z.string().optional().describe("(可选) lastmodified > since（YYYY-MM-DD HH:MM）"),
    limit: z.number().int().min(1).max(50000).default(1000).describe("最大同步条数"),
  },
  ({ space, since, limit }: { space?: string; since?: string; limit?: number }) =>
    wrap(() => syncConfluence({ space, since, limit }))(),
);

(server.tool as any)(
  "embed_pending",
  "批量为未嵌入或嵌入过期（embedding_updated_at < updated）的行计算向量并回写。完成后内存索引会失效，下次 search_local 自动重建。",
  {
    source: z.enum(["zmind", "gerrit", "confluence"]).describe("数据源"),
    batch_size: z.number().int().min(1).max(5000).default(200).describe("单次处理上限"),
  },
  ({ source, batch_size }: { source: SourceName; batch_size?: number }) =>
    wrap(() => embedPending({ source, batch_size }))(),
);

(server.tool as any)(
  "search_local",
  "本地索引混合检索。source='all' 跨三源并行返回 { zmind, gerrit, confluence } 各自 Top-K。mode='hybrid' 走向量+FTS5 合并去重，'vector' 纯语义，'fts' 纯关键词。返回每条命中的 source/id/title/url/snippet/score/match。",
  {
    query: z.string().min(1).describe("查询字符串"),
    source: z.enum(["zmind", "gerrit", "confluence", "all"]).default("all").describe("数据源；'all' 跨源"),
    mode: z.enum(["vector", "fts", "hybrid"]).default("hybrid").describe("检索模式"),
    limit: z.number().int().min(1).max(20).default(5).describe("每个源返回上限"),
  },
  ({ query, source, mode, limit }: { query: string; source?: any; mode?: any; limit?: number }) =>
    wrap(() => searchLocal({ query, source, mode, limit }))(),
);

(server.tool as any)(
  "get_indexed",
  "从本地索引读取单条记录的完整字段（不含嵌入向量）。",
  {
    source: z.enum(["zmind", "gerrit", "confluence"]).describe("数据源"),
    id: z.union([z.string(), z.number()]).describe("主键（zmind=数字 / gerrit=Change-Id / confluence=页面 id）"),
  },
  ({ source, id }: { source: SourceName; id: string | number }) =>
    wrap(() => Promise.resolve(getIndexed({ source, id })))(),
);

// =============================================================================
// P2: AOSP 模块级精搜
// =============================================================================

(server.tool as any)(
  "list_aosp_modules",
  "列出 module-path-map 中某个平台已登记的全部模块名（来自 steering/module-path-map.md）。",
  {
    platform: z.enum(["D4", "X5", "STB"]).describe("平台"),
  },
  ({ platform }: { platform: string }) =>
    wrap(async () => {
      const map = await loadModuleMap();
      return {
        platform,
        modules: listModulesOfPlatform(map, platform),
        source: map.source,
        generated_at: map.generated_at,
      };
    })(),
);

(server.tool as any)(
  "index_aosp_module",
  "为指定平台的指定模块建立 chunk 索引：递归扫描 module_path 下源码，按函数/类边界切块，写入 aosp_chunks 表。完成后再调 embed_aosp_pending 计算向量。",
  {
    platform: z.enum(["D4", "X5", "STB"]).describe("平台"),
    module: z.string().min(1).describe("模块名（与 module-path-map 一致；用作过滤 key）"),
    module_path: z.string().min(1).describe("模块根路径（相对 repo_root 或绝对）"),
    repo_root: z.string().min(1).describe("AOSP 工作树根目录（绝对路径）"),
  },
  ({ platform, module, module_path, repo_root }: { platform: string; module: string; module_path: string; repo_root: string }) =>
    wrap(() => indexAospModule({ platform, module, module_path, repo_root }))(),
);

(server.tool as any)(
  "embed_aosp_pending",
  "给 aosp_chunks 中未嵌入的行批量计算向量。批量大小默认 200；可按 platform / module 过滤分批跑大模块。",
  {
    batch_size: z.number().int().min(1).max(5000).default(200).describe("单次处理上限"),
    platform: z.enum(["D4", "X5", "STB"]).optional().describe("(可选) 仅处理某平台"),
    module: z.string().optional().describe("(可选) 仅处理某模块"),
  },
  ({ batch_size, platform, module }: { batch_size?: number; platform?: string; module?: string }) =>
    wrap(() => embedAospPending({ batch_size, platform, module }))(),
);

(server.tool as any)(
  "search_aosp",
  "在 aosp_chunks 上做 vector / fts / hybrid 检索，可按 platform + module 过滤搜索域（自动从 module-path-map 翻译为路径前缀）。返回命中文件的相对路径、行号、symbol、snippet、score。",
  {
    query: z.string().min(1).describe("查询字符串（支持中英文）"),
    platform: z.enum(["D4", "X5", "STB"]).optional().describe("(可选) 平台过滤"),
    module: z.string().optional().describe("(可选) 模块名（需与 platform 同时给）"),
    module_path: z.string().optional().describe("(可选) 直接传路径前缀（绕过 module-map）"),
    mode: z.enum(["vector", "fts", "hybrid"]).default("hybrid").describe("检索模式"),
    limit: z.number().int().min(1).max(20).default(5).describe("返回上限"),
  },
  ({ query, platform, module, module_path, mode, limit }: { query: string; platform?: string; module?: string; module_path?: string; mode?: any; limit?: number }) =>
    wrap(() => searchAosp({ query, platform, module, module_path, mode, limit }))(),
);

(server.tool as any)(
  "clear_aosp_index",
  "按 platform / module 删除 aosp_chunks 行（用于源码大改后重建）。两个参数都不传则清空整张表。",
  {
    platform: z.enum(["D4", "X5", "STB"]).optional(),
    module: z.string().optional(),
  },
  ({ platform, module }: { platform?: string; module?: string }) =>
    wrap(() => Promise.resolve(clearAospIndex({ platform, module })))(),
);

// =============================================================================
// P2: analyze_issue 端到端工作流
// =============================================================================

(server.tool as any)(
  "analyze_issue",
  "一键 PR/Bug 端到端分析：拉 Zmind issue → 准备工作目录 → 提取关键词 → 三源 hybrid 检索 → 推断平台/模块 → (可选) AOSP 模块级精搜 → 渲染 analysis-context.md 落盘。返回 JSON 汇总，best-effort 模式（任何子步骤失败都继续）。",
  {
    issue_id: z.number().int().positive().describe("Zmind issue ID"),
    workspace_root: z.string().optional().describe("(可选) 工作目录根，最终路径 <root>/.workspace/issue-<id>/；默认 cwd"),
    include_aosp: z.boolean().default(false).describe("是否启用 AOSP 模块级精搜（需先 index_aosp_module + embed_aosp_pending）"),
    platform: z.enum(["D4", "X5", "STB"]).optional().describe("(可选) 强制指定平台；不传则从 issue/project 推断"),
    per_source_limit: z.number().int().min(1).max(10).default(3).describe("单源命中上限"),
  },
  ({ issue_id, workspace_root, include_aosp, platform, per_source_limit }: any) =>
    wrap(() => analyzeIssue({ issue_id, workspace_root, include_aosp, platform, per_source_limit }))(),
);

// =============================================================================
// 启动
// =============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // 提前初始化 DB（让首次工具调用不带建表延迟）
  try {
    getDb();
  } catch (e) {
    console.error(`[knowledge-mcp-server] DB 初始化失败: ${(e as Error).message}`);
  }

  console.error(
    `[knowledge-mcp-server v1.0.0] started — db=${config.dbPath}, model=${config.embeddingModelId} (dim=${config.embeddingDim}, threads=${config.embeddingThreads})`,
  );
}

main().catch((err) => {
  console.error("[knowledge-mcp-server] fatal error:", err);
  process.exit(1);
});
