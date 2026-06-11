/**
 * 全局配置读取（从环境变量）。
 *
 * 路径与限制集中放这里，避免散落在各模块。
 */

import * as path from "node:path";
import * as os from "node:os";

function envInt(key: string, fallback: number): number {
  const raw = (process.env[key] ?? "").trim();
  if (!/^\d+$/.test(raw)) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  /** SQLite 主库路径 */
  dbPath: (process.env.KNOWLEDGE_DB_PATH ?? path.resolve("./data/knowledge.db")).trim(),

  /** ONNX 嵌入模型缓存目录 */
  modelCacheDir: (
    process.env.KNOWLEDGE_MODEL_CACHE_DIR ?? path.resolve("./data/models")
  ).trim(),

  /** 嵌入模型 ID（默认 BGE-small-zh ONNX，dim=512） */
  embeddingModelId: (
    process.env.KNOWLEDGE_EMBEDDING_MODEL ?? "Xenova/bge-small-zh-v1.5"
  ).trim(),

  /** 嵌入向量维度（必须与模型一致；BGE-small-zh-v1.5 是 512） */
  embeddingDim: envInt("KNOWLEDGE_EMBEDDING_DIM", 512),

  /** 嵌入 batch 大小 */
  embeddingBatchSize: envInt("KNOWLEDGE_EMBEDDING_BATCH", 32),

  /** ONNX runtime 线程数（防止低配机吃光） */
  embeddingThreads: envInt(
    "KNOWLEDGE_EMBEDDING_THREADS",
    Math.max(1, Math.min(4, Math.floor((os.cpus()?.length ?? 4) / 2))),
  ),

  /** 单条文本嵌入前的最大字符长度（防 token 超 BGE 512 上限） */
  maxTextChars: envInt("KNOWLEDGE_MAX_TEXT_CHARS", 1800),

  /** search_local 的默认 limit */
  searchDefaultLimit: 5,

  /** search_local 的 limit 上限 */
  searchMaxLimit: envInt("KNOWLEDGE_SEARCH_MAX_LIMIT", 20),

  /** snippet 截断字符数 */
  snippetMaxChars: envInt("KNOWLEDGE_SNIPPET_MAX_CHARS", 320),
};

export type SourceName = "zmind" | "gerrit" | "confluence";

export function isSourceName(s: string): s is SourceName {
  return s === "zmind" || s === "gerrit" || s === "confluence";
}
