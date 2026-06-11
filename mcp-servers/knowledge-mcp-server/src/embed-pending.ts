/**
 * embed_pending锛氭壒閲忓祵鍏?鏈祵鍏ユ垨宸茶繃鏈?鐨勮銆?
 *
 * "杩囨湡"鍒ゅ畾锛歟mbedding_updated_at 涓?NULL 鎴?< 涓昏〃鐨?updated 鍒椼€?
 */

import { config, type SourceName } from "./config.js";
import { getDb, runInTransaction, vectorToBlob } from "./db.js";
import { embedTexts } from "./embedder.js";
import { invalidateIndex } from "./index-store.js";

export interface EmbedStats {
  source: SourceName;
  embedded: number;
  total_pending: number;
}

interface PendingRow {
  _key: string | number;
  text: string;
}

function selectPending(source: SourceName, limit: number): PendingRow[] {
  const db = getDb();
  if (source === "zmind") {
    return db
      .prepare(
        `SELECT id AS _key,
                COALESCE(subject, '') || char(10) || COALESCE(description, '') AS text
           FROM zmind_issues
          WHERE embedding IS NULL
             OR embedding_updated_at IS NULL
             OR (updated_on IS NOT NULL AND embedding_updated_at < updated_on)
          ORDER BY updated_on DESC
          LIMIT ?`,
      )
      .all(limit) as unknown as PendingRow[];
  }
  if (source === "gerrit") {
    return db
      .prepare(
        `SELECT change_id AS _key,
                COALESCE(subject, '') || char(10) || COALESCE(commit_message, '') AS text
           FROM gerrit_changes
          WHERE embedding IS NULL
             OR embedding_updated_at IS NULL
             OR (updated IS NOT NULL AND embedding_updated_at < updated)
          ORDER BY updated DESC
          LIMIT ?`,
      )
      .all(limit) as unknown as PendingRow[];
  }
  return db
    .prepare(
      `SELECT id AS _key,
              COALESCE(title, '') || char(10) || COALESCE(body_text, '') AS text
         FROM confluence_pages
        WHERE embedding IS NULL
           OR embedding_updated_at IS NULL
           OR (updated IS NOT NULL AND embedding_updated_at < updated)
        ORDER BY updated DESC
        LIMIT ?`,
    )
    .all(limit) as unknown as PendingRow[];
}

function updateBlobs(source: SourceName, rows: Array<{ key: string | number; blob: Buffer; ts: string }>): void {
  const db = getDb();
  const sql = (() => {
    if (source === "zmind")
      return "UPDATE zmind_issues SET embedding = ?, embedding_updated_at = ? WHERE id = ?";
    if (source === "gerrit")
      return "UPDATE gerrit_changes SET embedding = ?, embedding_updated_at = ? WHERE change_id = ?";
    return "UPDATE confluence_pages SET embedding = ?, embedding_updated_at = ? WHERE id = ?";
  })();
  const stmt = db.prepare(sql);
  runInTransaction(db, () => {
    for (const it of rows) stmt.run(it.blob, it.ts, it.key);
  });
}

export async function embedPending(args: {
  source: SourceName;
  batch_size?: number;
}): Promise<EmbedStats> {
  const limit = Math.max(1, Math.min(5000, args.batch_size ?? 200));
  const pending = selectPending(args.source, limit);
  if (pending.length === 0) {
    return { source: args.source, embedded: 0, total_pending: 0 };
  }
  const texts = pending.map((r) => r.text);
  const vectors = await embedTexts(texts);
  if (vectors.length !== pending.length) {
    throw new Error(
      `embedTexts 杩斿洖 ${vectors.length} 椤癸紝鏈熸湜 ${pending.length}`,
    );
  }
  const ts = new Date().toISOString();
  const writeRows = pending.map((r, i) => ({
    key: r._key,
    blob: vectorToBlob(vectors[i]),
    ts,
  }));
  updateBlobs(args.source, writeRows);
  invalidateIndex(args.source);

  return { source: args.source, embedded: pending.length, total_pending: pending.length };
}

