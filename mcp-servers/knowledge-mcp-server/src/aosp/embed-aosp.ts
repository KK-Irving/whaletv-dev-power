/**
 * AOSP chunks 的嵌入回写。
 *
 * 与三源 embed_pending 拆开：aosp 通常 chunk 数量级巨大（几十万），
 * 单独控制 batch / progress 更合理。
 */

import { getDb, runInTransaction, vectorToBlob } from "../db.js";
import { embedTexts } from "../embedder.js";
import { invalidateAospIndex } from "./search.js";

export interface EmbedAospStats {
  total_pending: number;
  embedded: number;
  remaining: number;
}

interface PendingChunk {
  id: number;
  content: string;
}

export async function embedAospPending(args: {
  batch_size?: number;
  platform?: string;
  module?: string;
} = {}): Promise<EmbedAospStats> {
  const limit = Math.max(1, Math.min(5000, args.batch_size ?? 200));
  const db = getDb();

  const where: string[] = ["embedding IS NULL"];
  const params: any[] = [];
  if (args.platform) {
    where.push("platform = ?");
    params.push(args.platform.toUpperCase());
  }
  if (args.module) {
    where.push("module = ?");
    params.push(args.module.toLowerCase());
  }

  // 1. 总待嵌入数（用于进度报告）
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM aosp_chunks WHERE ${where.join(" AND ")}`)
    .get(...params) as { n: number };
  const total = totalRow?.n ?? 0;
  if (total === 0) return { total_pending: 0, embedded: 0, remaining: 0 };

  // 2. 拉本批
  const rows = db
    .prepare(
      `SELECT id, content FROM aosp_chunks WHERE ${where.join(" AND ")} ORDER BY id LIMIT ?`,
    )
    .all(...params, limit) as unknown as PendingChunk[];

  if (rows.length === 0) return { total_pending: total, embedded: 0, remaining: total };

  // 3. embed
  const texts = rows.map((r) => r.content);
  const vectors = await embedTexts(texts);
  if (vectors.length !== rows.length) {
    throw new Error(`embedTexts 返回 ${vectors.length}，期望 ${rows.length}`);
  }

  // 4. 回写
  const ts = new Date().toISOString();
  const stmt = db.prepare(
    "UPDATE aosp_chunks SET embedding = ?, embedding_updated_at = ? WHERE id = ?",
  );
  runInTransaction(db, () => {
    for (let i = 0; i < rows.length; i++) {
      stmt.run(vectorToBlob(vectors[i]), ts, rows[i].id);
    }
  });

  invalidateAospIndex();
  return {
    total_pending: total,
    embedded: rows.length,
    remaining: total - rows.length,
  };
}
