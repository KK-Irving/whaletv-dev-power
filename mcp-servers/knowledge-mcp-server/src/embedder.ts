/**
 * 嵌入器：单例 ONNX 模型 + batch encode。
 *
 * 默认模型 BAAI/bge-small-zh-v1.5（中文友好，512 dim，~80MB）。
 * 通过 @xenova/transformers 在 Node 端运行 ONNX，无需 GPU。
 *
 * 首次调用会下载并缓存模型到 KNOWLEDGE_MODEL_CACHE_DIR（默认 ./data/models）。
 */

import { config } from "./config.js";

let _embedderPromise: Promise<EmbedFn> | null = null;

type EmbedFn = (texts: string[]) => Promise<Float32Array[]>;

async function buildEmbedder(): Promise<EmbedFn> {
  // 控制 ONNX runtime 线程数（防止低配机吃光）
  process.env.OMP_NUM_THREADS = String(config.embeddingThreads);
  process.env.MKL_NUM_THREADS = String(config.embeddingThreads);

  const transformers = (await import("@xenova/transformers")) as any;
  // 重定向模型缓存目录
  if (transformers?.env) {
    transformers.env.cacheDir = config.modelCacheDir;
    // 默认开启的远程下载
    transformers.env.allowRemoteModels = true;
  }

  const pipeline = transformers.pipeline as (
    task: string,
    model: string,
    opts?: any,
  ) => Promise<any>;

  const extractor = await pipeline("feature-extraction", config.embeddingModelId, {
    quantized: true, // 用 quantized 模型省内存
  });

  return async (texts: string[]): Promise<Float32Array[]> => {
    if (texts.length === 0) return [];
    // 截断防止 token 超 BGE 512 上限
    const trimmed = texts.map((t) =>
      typeof t === "string" ? t.slice(0, config.maxTextChars) : "",
    );
    const out = await extractor(trimmed, { pooling: "mean", normalize: true });
    // out.data 是 Float32Array，dims = [N, dim]
    const dims: number[] = out.dims;
    const dim = dims[dims.length - 1];
    const flat: Float32Array = out.data;
    if (dim !== config.embeddingDim) {
      throw new Error(
        `模型输出维度 ${dim} 与 config.embeddingDim ${config.embeddingDim} 不一致；请调整 KNOWLEDGE_EMBEDDING_DIM`,
      );
    }
    const result: Float32Array[] = [];
    for (let i = 0; i < trimmed.length; i++) {
      const start = i * dim;
      // 必须复制独立 buffer（否则共享底层 ArrayBuffer 会被下次 batch 覆盖）
      result.push(new Float32Array(flat.buffer.slice(flat.byteOffset + start * 4, flat.byteOffset + (start + dim) * 4)));
    }
    return result;
  };
}

export async function getEmbedder(): Promise<EmbedFn> {
  if (!_embedderPromise) _embedderPromise = buildEmbedder();
  return _embedderPromise;
}

/**
 * 批量嵌入 N 条文本，按 config.embeddingBatchSize 切片调用 ONNX。
 */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const embed = await getEmbedder();
  const result: Float32Array[] = [];
  const batch = Math.max(1, config.embeddingBatchSize);
  for (let i = 0; i < texts.length; i += batch) {
    const slice = texts.slice(i, i + batch);
    const out = await embed(slice);
    for (const v of out) result.push(v);
  }
  return result;
}

/**
 * 单条嵌入便捷方法。
 */
export async function embedOne(text: string): Promise<Float32Array> {
  const out = await embedTexts([text]);
  return out[0];
}
