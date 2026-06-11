/**
 * 进程内向量索引：lazy 加载 + invalidate。
 *
 * 每个 source（zmind / gerrit / confluence）维护一份：
 *   - ids: 主键数组
 *   - matrix: 单一连续 Float32Array（N × dim 行优先），便于一次循环算 cosine
 *   - meta: 主键 → 行元信息映射
 */

import { config, type SourceName } from "./config.js";
import { blobToVector, getDb } from "./db.js";

interface SourceIndex {
  ids: Array<string | number>;
  matrix: Float32Array; // N * dim
  count: number;
  meta: Map<string | number, RowMeta>;
}

export interface RowMeta {
  source: SourceName;
  id: string | number;
  title: string;
  url: string;
  snippet: string;
  status?: string;
  project?: string;
  space?: string;
  updated?: string;
  extra?: Record<string, unknown>;
}

const _cache = new Map<SourceName, SourceIndex>();

export function invalidateIndex(source?: SourceName): void {
  if (source) _cache.delete(source);
  else _cache.clear();
}

/**
 * 加载某个 source 的所有 embedded rows 到内存矩阵。
 * 首次调用或 invalidate 后下一次调用都会全表 SELECT。
 */
export function loadIndex(source: SourceName): SourceIndex {
  const cached = _cache.get(source);
  if (cached) return cached;

  const db = getDb();
  const dim = config.embeddingDim;
  const rows = selectRowsWithEmbedding(source, db);

  const matrix = new Float32Array(rows.length * dim);
  const ids: Array<string | number> = [];
  const meta = new Map<string | number, RowMeta>();

  rows.forEach((r, i) => {
    const vec = blobToVector(r.embedding as Buffer, dim);
    matrix.set(vec, i * dim);
    ids.push(r._key);
    meta.set(r._key, r._meta);
  });

  const idx: SourceIndex = { ids, matrix, count: rows.length, meta };
  _cache.set(source, idx);
  return idx;
}

interface RawRow {
  _key: string | number;
  _meta: RowMeta;
  embedding: Buffer | Uint8Array;
}

function selectRowsWithEmbedding(source: SourceName, db: ReturnType<typeof getDb>): RawRow[] {
  if (source === "zmind") {
    const rs = db
      .prepare(
        `SELECT id, subject, description, status, project_name, updated_on, embedding
           FROM zmind_issues
          WHERE embedding IS NOT NULL`,
      )
      .all() as Array<{
      id: number;
      subject: string;
      description: string;
      status: string;
      project_name: string;
      updated_on: string;
      embedding: Buffer;
    }>;
    return rs.map((r) => ({
      _key: r.id,
      _meta: {
        source: "zmind",
        id: r.id,
        title: r.subject ?? "",
        url: zmindUrl(r.id),
        snippet: snippet(r.description ?? "", config.snippetMaxChars),
        status: r.status ?? "",
        project: r.project_name ?? "",
        updated: r.updated_on ?? "",
      },
      embedding: r.embedding,
    }));
  }
  if (source === "gerrit") {
    const rs = db
      .prepare(
        `SELECT change_id, number, project, subject, commit_message, status, updated, embedding
           FROM gerrit_changes
          WHERE embedding IS NOT NULL`,
      )
      .all() as Array<{
      change_id: string;
      number: number;
      project: string;
      subject: string;
      commit_message: string;
      status: string;
      updated: string;
      embedding: Buffer;
    }>;
    return rs.map((r) => ({
      _key: r.change_id,
      _meta: {
        source: "gerrit",
        id: r.change_id,
        title: r.subject ?? "",
        url: gerritUrl(r.project, r.number),
        snippet: snippet(r.commit_message ?? "", config.snippetMaxChars),
        status: r.status ?? "",
        project: r.project ?? "",
        updated: r.updated ?? "",
        extra: { number: r.number },
      },
      embedding: r.embedding,
    }));
  }
  // confluence
  const rs = db
    .prepare(
      `SELECT id, space_key, title, body_text, version, webui, updated, embedding
         FROM confluence_pages
        WHERE embedding IS NOT NULL`,
    )
    .all() as Array<{
    id: string;
    space_key: string;
    title: string;
    body_text: string;
    version: number;
    webui: string;
    updated: string;
    embedding: Buffer;
  }>;
  return rs.map((r) => ({
    _key: r.id,
    _meta: {
      source: "confluence",
      id: r.id,
      title: r.title ?? "",
      url: confluenceUrl(r.webui),
      snippet: snippet(r.body_text ?? "", config.snippetMaxChars),
      space: r.space_key ?? "",
      updated: r.updated ?? "",
      extra: { version: r.version },
    },
    embedding: r.embedding,
  }));
}

// =============================================================================
// URL 帮手
// =============================================================================

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

function snippet(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return clean.slice(0, maxChars).trimEnd() + "…";
}

/**
 * 计算 query 向量与 source 索引的 top-K cosine（向量已 L2 normalize，dot=cosine）。
 *
 * @returns 按分数降序的 [{ id, score, meta }, ...]
 */
export function vectorTopK(
  source: SourceName,
  query: Float32Array,
  topK: number,
  excludeIds?: Set<string | number>,
): Array<{ id: string | number; score: number; meta: RowMeta }> {
  const idx = loadIndex(source);
  if (idx.count === 0) return [];
  const dim = config.embeddingDim;
  if (query.length !== dim) {
    throw new Error(`query dim ${query.length} != embedding dim ${dim}`);
  }

  // 简单全表 dot product
  const scores = new Float32Array(idx.count);
  for (let i = 0; i < idx.count; i++) {
    const offset = i * dim;
    let s = 0;
    for (let j = 0; j < dim; j++) {
      s += idx.matrix[offset + j] * query[j];
    }
    scores[i] = s;
  }

  // 取 top-K
  const indices: number[] = [];
  for (let i = 0; i < idx.count; i++) {
    if (excludeIds && excludeIds.has(idx.ids[i])) continue;
    indices.push(i);
  }
  indices.sort((a, b) => scores[b] - scores[a]);

  const out: Array<{ id: string | number; score: number; meta: RowMeta }> = [];
  for (let i = 0; i < Math.min(topK, indices.length); i++) {
    const idxRow = indices[i];
    const id = idx.ids[idxRow];
    const meta = idx.meta.get(id);
    if (!meta) continue;
    out.push({ id, score: scores[idxRow], meta });
  }
  return out;
}
