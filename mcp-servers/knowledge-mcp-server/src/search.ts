/**
 * 检索：vector / fts / hybrid 三模式 + 单源/跨源。
 */

import { config, type SourceName, isSourceName } from "./config.js";
import { getDb } from "./db.js";
import { embedOne } from "./embedder.js";
import { type RowMeta, vectorTopK } from "./index-store.js";

export interface SearchHit extends RowMeta {
  score: number;
  match: "vector" | "fts" | "both";
}

export type SearchMode = "vector" | "fts" | "hybrid";
export type SearchSource = SourceName | "all";

const ALL_SOURCES: SourceName[] = ["zmind", "gerrit", "confluence"];

// =============================================================================
// FTS 单源
// =============================================================================

interface FtsHit {
  key: string | number;
  bm25: number;
  meta: RowMeta;
}

function ftsSearch(source: SourceName, query: string, limit: number): FtsHit[] {
  const db = getDb();
  // 注意：FTS5 MATCH 需要把 query 中的特殊字符转义，否则会被当成查询语法
  const safeQuery = escapeFts5(query);

  if (source === "zmind") {
    const rows = db
      .prepare(
        `SELECT z.id AS _key,
                bm25(zmind_issues_fts) AS bm,
                z.subject AS title,
                z.description AS body,
                z.status, z.project_name, z.updated_on
           FROM zmind_issues_fts
           JOIN zmind_issues z ON z.id = zmind_issues_fts.rowid
          WHERE zmind_issues_fts MATCH ?
          ORDER BY bm
          LIMIT ?`,
      )
      .all(safeQuery, limit) as Array<{
      _key: number;
      bm: number;
      title: string;
      body: string;
      status: string;
      project_name: string;
      updated_on: string;
    }>;
    return rows.map((r) => ({
      key: r._key,
      bm25: r.bm,
      meta: {
        source: "zmind",
        id: r._key,
        title: r.title ?? "",
        url: zmindUrl(r._key),
        snippet: snippet(r.body ?? "", config.snippetMaxChars),
        status: r.status ?? "",
        project: r.project_name ?? "",
        updated: r.updated_on ?? "",
      },
    }));
  }
  if (source === "gerrit") {
    const rows = db
      .prepare(
        `SELECT g.change_id AS _key,
                bm25(gerrit_changes_fts) AS bm,
                g.subject AS title,
                g.commit_message AS body,
                g.project, g.number, g.status, g.updated
           FROM gerrit_changes_fts
           JOIN gerrit_changes g ON g.rowid = gerrit_changes_fts.rowid
          WHERE gerrit_changes_fts MATCH ?
          ORDER BY bm
          LIMIT ?`,
      )
      .all(safeQuery, limit) as Array<{
      _key: string;
      bm: number;
      title: string;
      body: string;
      project: string;
      number: number;
      status: string;
      updated: string;
    }>;
    return rows.map((r) => ({
      key: r._key,
      bm25: r.bm,
      meta: {
        source: "gerrit",
        id: r._key,
        title: r.title ?? "",
        url: gerritUrl(r.project, r.number),
        snippet: snippet(r.body ?? "", config.snippetMaxChars),
        status: r.status ?? "",
        project: r.project ?? "",
        updated: r.updated ?? "",
        extra: { number: r.number },
      },
    }));
  }
  // confluence
  const rows = db
    .prepare(
      `SELECT c.id AS _key,
              bm25(confluence_pages_fts) AS bm,
              c.title,
              c.body_text AS body,
              c.space_key, c.webui, c.version, c.updated
         FROM confluence_pages_fts
         JOIN confluence_pages c ON c.rowid = confluence_pages_fts.rowid
        WHERE confluence_pages_fts MATCH ?
        ORDER BY bm
        LIMIT ?`,
    )
    .all(safeQuery, limit) as Array<{
    _key: string;
    bm: number;
    title: string;
    body: string;
    space_key: string;
    webui: string;
    version: number;
    updated: string;
  }>;
  return rows.map((r) => ({
    key: r._key,
    bm25: r.bm,
    meta: {
      source: "confluence",
      id: r._key,
      title: r.title ?? "",
      url: confluenceUrl(r.webui),
      snippet: snippet(r.body ?? "", config.snippetMaxChars),
      space: r.space_key ?? "",
      updated: r.updated ?? "",
      extra: { version: r.version },
    },
  }));
}

// =============================================================================
// Hybrid 合并
// =============================================================================

/** 把 BM25 分数 normalize 到 (0, 1]：bm25 越小越好（SQLite FTS5 约定为负数 / 越接近 0 越相似）。 */
function normalizeFtsScore(bm25Values: number[]): Map<number, number> {
  const map = new Map<number, number>();
  if (bm25Values.length === 0) return map;
  // FTS5 默认 bm25 返回值越小越好（相似度越高），通常是负数
  const min = Math.min(...bm25Values);
  const max = Math.max(...bm25Values);
  const span = max - min || 1;
  bm25Values.forEach((v) => {
    // map (min..max) → (1..0)
    map.set(v, 1 - (v - min) / span);
  });
  return map;
}

async function searchOneSource(
  source: SourceName,
  query: string,
  mode: SearchMode,
  limit: number,
): Promise<SearchHit[]> {
  if (!query.trim()) return [];

  let vectorHits: Array<{ id: string | number; score: number; meta: RowMeta }> = [];
  let ftsHits: FtsHit[] = [];

  if (mode === "vector" || mode === "hybrid") {
    try {
      const vec = await embedOne(query);
      vectorHits = vectorTopK(source, vec, limit * 2);
    } catch (e) {
      // 嵌入失败（模型未加载等）→ 在 hybrid 下降级为 fts only
      if (mode === "vector") throw e;
    }
  }
  if (mode === "fts" || mode === "hybrid") {
    try {
      ftsHits = ftsSearch(source, query, limit * 2);
    } catch (e) {
      if (mode === "fts") throw e;
    }
  }

  if (mode === "vector") {
    return vectorHits
      .slice(0, limit)
      .map((h) => ({ ...h.meta, score: h.score, match: "vector" as const }));
  }
  if (mode === "fts") {
    const norm = normalizeFtsScore(ftsHits.map((h) => h.bm25));
    return ftsHits
      .slice(0, limit)
      .map((h) => ({
        ...h.meta,
        score: norm.get(h.bm25) ?? 0,
        match: "fts" as const,
      }));
  }

  // hybrid：合并去重
  const merged = new Map<string, SearchHit>();
  for (const h of vectorHits) {
    const key = String(h.id) + "::" + h.meta.source;
    merged.set(key, { ...h.meta, score: h.score, match: "vector" });
  }
  const norm = normalizeFtsScore(ftsHits.map((h) => h.bm25));
  for (const h of ftsHits) {
    const key = String(h.key) + "::" + h.meta.source;
    const existed = merged.get(key);
    const ftsScore = norm.get(h.bm25) ?? 0;
    if (existed) {
      // 同时命中：取最高分，标 both
      const finalScore = Math.max(existed.score, ftsScore);
      merged.set(key, { ...h.meta, score: finalScore, match: "both" });
    } else {
      merged.set(key, { ...h.meta, score: ftsScore, match: "fts" });
    }
  }
  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// =============================================================================
// 公共入口
// =============================================================================

export async function searchLocal(args: {
  query: string;
  source?: SearchSource;
  mode?: SearchMode;
  limit?: number;
}): Promise<{ source: SearchSource; query: string; mode: SearchMode } & Record<string, any>> {
  const limit = Math.max(1, Math.min(config.searchMaxLimit, args.limit ?? config.searchDefaultLimit));
  const mode: SearchMode = args.mode ?? "hybrid";
  const source: SearchSource = args.source ?? "all";

  if (source === "all") {
    const out: Record<string, SearchHit[]> = {};
    await Promise.all(
      ALL_SOURCES.map(async (s) => {
        try {
          out[s] = await searchOneSource(s, args.query, mode, limit);
        } catch (e) {
          out[s] = [];
          (out as any)[s + "_error"] = (e as Error).message;
        }
      }),
    );
    return { source: "all", query: args.query, mode, ...out };
  }
  if (!isSourceName(source)) {
    throw new Error(`unknown source: ${source}`);
  }
  const hits = await searchOneSource(source, args.query, mode, limit);
  return { source, query: args.query, mode, hits };
}

// =============================================================================
// FTS5 query 转义
// =============================================================================

function escapeFts5(q: string): string {
  // 把每个 token 用双引号包起来，让 FTS5 当 phrase 处理；同时用空格连接（OR 语义会被 default 处理）
  // 简化版：保留中文/英文/数字 token，用空格分割
  const tokens = q
    .replace(/["']/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return q;
  return tokens.map((t) => `"${t}"`).join(" ");
}

// =============================================================================
// 取详情
// =============================================================================

export interface IndexedRecord {
  source: SourceName;
  id: string | number;
  data: Record<string, unknown>;
}

export function getIndexed(args: {
  source: SourceName;
  id: string | number;
}): IndexedRecord | null {
  const db = getDb();
  if (args.source === "zmind") {
    const r = db
      .prepare("SELECT * FROM zmind_issues WHERE id = ?")
      .get(typeof args.id === "string" ? parseInt(args.id, 10) : args.id) as Record<string, unknown> | undefined;
    if (!r) return null;
    delete r.embedding;
    return { source: "zmind", id: args.id, data: r };
  }
  if (args.source === "gerrit") {
    const r = db
      .prepare("SELECT * FROM gerrit_changes WHERE change_id = ?")
      .get(String(args.id)) as Record<string, unknown> | undefined;
    if (!r) return null;
    delete r.embedding;
    return { source: "gerrit", id: args.id, data: r };
  }
  const r = db
    .prepare("SELECT * FROM confluence_pages WHERE id = ?")
    .get(String(args.id)) as Record<string, unknown> | undefined;
  if (!r) return null;
  delete r.embedding;
  return { source: "confluence", id: args.id, data: r };
}

// =============================================================================
// 辅助函数
// =============================================================================

function snippet(text: string, n: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= n) return clean;
  return clean.slice(0, n).trimEnd() + "…";
}

function zmindUrl(id: number): string {
  const base = (process.env.ZMIND_URL ?? "https://zmind.whaletv.com").replace(/\/+$/, "");
  return `${base}/issues/${id}`;
}

function gerritUrl(project: string, num: number): string {
  const base = (process.env.GERRIT_URL ?? "").replace(/\/+$/, "");
  if (!base || !num) return "";
  return `${base}/c/${project}/+/${num}`;
}

function confluenceUrl(webui: string): string {
  if (!webui) return "";
  if (/^https?:\/\//i.test(webui)) return webui;
  const base = (process.env.CONFLUENCE_BASE_URL ?? "").replace(/\/+$/, "");
  return base ? base + webui : webui;
}
