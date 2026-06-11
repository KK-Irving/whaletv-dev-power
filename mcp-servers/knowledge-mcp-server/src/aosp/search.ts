/**
 * AOSP chunks 检索：vector / fts / hybrid 三模式 + platform/module 过滤。
 *
 * 与三源 search 共享 embedder 与 FTS5 设计，但单独存矩阵（aosp_chunks 通常远多于
 * zmind_issues，可独立 invalidate）。
 */

import { config } from "../config.js";
import { blobToVector, getDb } from "../db.js";
import { embedOne } from "../embedder.js";
import { loadModuleMap, resolveModulePaths } from "./module-map-loader.js";

interface AospRow {
  id: number;
  platform: string;
  module: string;
  module_path: string;
  file_path: string;
  line_start: number;
  line_end: number;
  symbol_kind: string;
  symbol_name: string;
  content: string;
  embedding: Buffer | null;
}

export interface AospHit {
  id: number;
  source: "aosp";
  platform: string;
  module: string;
  file_path: string;
  line_start: number;
  line_end: number;
  symbol_kind: string;
  symbol_name: string;
  snippet: string;
  score: number;
  match: "vector" | "fts" | "both";
}

export interface SearchAospArgs {
  query: string;
  platform?: string;
  module?: string;
  /** 直接传路径前缀（绕过 module-map 查询） */
  module_path?: string;
  mode?: "vector" | "fts" | "hybrid";
  limit?: number;
}

// =============================================================================
// 进程内向量索引（按 platform+module 维度懒加载）
// =============================================================================

interface AospIndex {
  ids: number[];
  matrix: Float32Array;
  count: number;
  meta: Map<number, AospRow>;
}

const _cache = new Map<string, AospIndex>();

function cacheKey(platform: string | undefined, module: string | undefined, modulePath: string | undefined): string {
  return `${(platform ?? "*").toUpperCase()}::${(module ?? "*").toLowerCase()}::${modulePath ?? ""}`;
}

export function invalidateAospIndex(): void {
  _cache.clear();
}

function loadAospIndex(args: {
  platform?: string;
  module?: string;
  modulePathPrefixes?: string[];
}): AospIndex {
  const key = cacheKey(args.platform, args.module, (args.modulePathPrefixes ?? []).join("|"));
  const cached = _cache.get(key);
  if (cached) return cached;

  const db = getDb();
  const dim = config.embeddingDim;
  const where: string[] = ["embedding IS NOT NULL"];
  const params: any[] = [];
  if (args.platform) {
    where.push("platform = ?");
    params.push(args.platform.toUpperCase());
  }
  if (args.module) {
    where.push("module = ?");
    params.push(args.module.toLowerCase());
  }
  if (args.modulePathPrefixes && args.modulePathPrefixes.length > 0) {
    const ors = args.modulePathPrefixes.map(() => "module_path LIKE ?").join(" OR ");
    where.push(`(${ors})`);
    for (const p of args.modulePathPrefixes) params.push(`${p}%`);
  }

  const rows = db
    .prepare(
      `SELECT id, platform, module, module_path, file_path,
              line_start, line_end, symbol_kind, symbol_name, content, embedding
         FROM aosp_chunks
        WHERE ${where.join(" AND ")}`,
    )
    .all(...params) as unknown as AospRow[];

  const matrix = new Float32Array(rows.length * dim);
  const ids: number[] = [];
  const meta = new Map<number, AospRow>();

  rows.forEach((r, i) => {
    if (!r.embedding) return;
    const vec = blobToVector(r.embedding, dim);
    matrix.set(vec, i * dim);
    ids.push(r.id);
    meta.set(r.id, r);
  });

  const idx: AospIndex = { ids, matrix, count: rows.length, meta };
  _cache.set(key, idx);
  return idx;
}

// =============================================================================
// FTS 检索
// =============================================================================

function ftsSearch(args: {
  query: string;
  platform?: string;
  module?: string;
  modulePathPrefixes?: string[];
  limit: number;
}): Array<{ row: AospRow; bm25: number }> {
  const db = getDb();
  const safeQ = escapeFts5(args.query);
  if (!safeQ) return [];

  const where: string[] = [];
  const params: any[] = [];
  where.push("aosp_chunks_fts MATCH ?");
  params.push(safeQ);
  if (args.platform) {
    where.push("a.platform = ?");
    params.push(args.platform.toUpperCase());
  }
  if (args.module) {
    where.push("a.module = ?");
    params.push(args.module.toLowerCase());
  }
  if (args.modulePathPrefixes && args.modulePathPrefixes.length > 0) {
    const ors = args.modulePathPrefixes.map(() => "a.module_path LIKE ?").join(" OR ");
    where.push(`(${ors})`);
    for (const p of args.modulePathPrefixes) params.push(`${p}%`);
  }

  const sql = `
    SELECT a.id, a.platform, a.module, a.module_path, a.file_path,
           a.line_start, a.line_end, a.symbol_kind, a.symbol_name, a.content,
           bm25(aosp_chunks_fts) AS bm
      FROM aosp_chunks_fts
      JOIN aosp_chunks a ON a.id = aosp_chunks_fts.rowid
     WHERE ${where.join(" AND ")}
     ORDER BY bm
     LIMIT ?
  `;

  const rows = db.prepare(sql).all(...params, args.limit) as unknown as Array<AospRow & { bm: number }>;
  return rows.map((r) => ({ row: r, bm25: r.bm }));
}

function escapeFts5(q: string): string {
  const tokens = q
    .replace(/["']/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"`).join(" ");
}

function snippetOf(content: string): string {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length <= config.snippetMaxChars ? clean : clean.slice(0, config.snippetMaxChars).trimEnd() + "…";
}

function rowToHit(r: AospRow, score: number, match: "vector" | "fts" | "both"): AospHit {
  return {
    id: r.id,
    source: "aosp",
    platform: r.platform,
    module: r.module,
    file_path: r.file_path,
    line_start: r.line_start,
    line_end: r.line_end,
    symbol_kind: r.symbol_kind,
    symbol_name: r.symbol_name,
    snippet: snippetOf(r.content),
    score,
    match,
  };
}

function normalizeFts(values: number[]): Map<number, number> {
  const map = new Map<number, number>();
  if (values.length === 0) return map;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  values.forEach((v) => map.set(v, 1 - (v - min) / span));
  return map;
}

// =============================================================================
// 公共入口
// =============================================================================

export async function searchAosp(args: SearchAospArgs): Promise<{
  source: "aosp";
  query: string;
  mode: string;
  hits: AospHit[];
  filter: { platform?: string; module?: string; module_paths?: string[] };
}> {
  const limit = Math.max(1, Math.min(config.searchMaxLimit, args.limit ?? config.searchDefaultLimit));
  const mode = args.mode ?? "hybrid";
  if (!args.query.trim()) {
    return {
      source: "aosp",
      query: args.query,
      mode,
      hits: [],
      filter: {},
    };
  }

  // 把 module 翻译成 module_path 前缀
  let modulePathPrefixes: string[] | undefined;
  if (args.module_path) {
    modulePathPrefixes = [args.module_path];
  } else if (args.module && args.platform) {
    try {
      const map = await loadModuleMap();
      const paths = resolveModulePaths(map, args.platform, args.module);
      if (paths.length > 0) modulePathPrefixes = paths;
    } catch {
      /* fallback to no prefix filter */
    }
  }

  // FTS 部分
  let ftsHits: Array<{ row: AospRow; bm25: number }> = [];
  if (mode === "fts" || mode === "hybrid") {
    ftsHits = ftsSearch({
      query: args.query,
      platform: args.platform,
      module: args.module,
      modulePathPrefixes,
      limit: limit * 2,
    });
  }

  // Vector 部分
  let vectorHits: Array<{ row: AospRow; score: number }> = [];
  if (mode === "vector" || mode === "hybrid") {
    try {
      const vec = await embedOne(args.query);
      const idx = loadAospIndex({ platform: args.platform, module: args.module, modulePathPrefixes });
      if (idx.count > 0) {
        const dim = config.embeddingDim;
        const scores = new Float32Array(idx.count);
        for (let i = 0; i < idx.count; i++) {
          let s = 0;
          const off = i * dim;
          for (let j = 0; j < dim; j++) s += idx.matrix[off + j] * vec[j];
          scores[i] = s;
        }
        const indices = Array.from({ length: idx.count }, (_, k) => k).sort(
          (a, b) => scores[b] - scores[a],
        );
        for (let i = 0; i < Math.min(limit * 2, indices.length); i++) {
          const id = idx.ids[indices[i]];
          const row = idx.meta.get(id);
          if (row) vectorHits.push({ row, score: scores[indices[i]] });
        }
      }
    } catch (e) {
      if (mode === "vector") throw e;
    }
  }

  let hits: AospHit[];
  if (mode === "vector") {
    hits = vectorHits.map((h) => rowToHit(h.row, h.score, "vector")).slice(0, limit);
  } else if (mode === "fts") {
    const norm = normalizeFts(ftsHits.map((h) => h.bm25));
    hits = ftsHits
      .map((h) => rowToHit(h.row, norm.get(h.bm25) ?? 0, "fts"))
      .slice(0, limit);
  } else {
    // hybrid 合并
    const merged = new Map<number, AospHit>();
    for (const h of vectorHits) {
      merged.set(h.row.id, rowToHit(h.row, h.score, "vector"));
    }
    const norm = normalizeFts(ftsHits.map((h) => h.bm25));
    for (const h of ftsHits) {
      const ftsScore = norm.get(h.bm25) ?? 0;
      const existed = merged.get(h.row.id);
      if (existed) {
        merged.set(h.row.id, { ...existed, score: Math.max(existed.score, ftsScore), match: "both" });
      } else {
        merged.set(h.row.id, rowToHit(h.row, ftsScore, "fts"));
      }
    }
    hits = Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  return {
    source: "aosp",
    query: args.query,
    mode,
    hits,
    filter: {
      platform: args.platform,
      module: args.module,
      module_paths: modulePathPrefixes,
    },
  };
}
