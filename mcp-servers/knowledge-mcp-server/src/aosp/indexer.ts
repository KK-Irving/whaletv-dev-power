/**
 * AOSP 模块索引器：遍历 module 路径下的源码 → 切块 → 入库。
 *
 * 设计：
 *   - 输入 platform + module + module_path（可绝对，也可相对 repo_root） + repo_root
 *   - 递归遍历，按 chunker 切块，写 aosp_chunks 表（UNIQUE 约束去重）
 *   - 跳过黑名单目录、二进制、>5MB 文件
 *   - 嵌入由后续 `embed_pending(source="aosp")` 异步处理
 *
 * 提供：
 *   - indexAospModule({ platform, module, module_path, repo_root })
 *   - clearAospIndex({ platform?, module? })
 */

import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

import { getDb, runInTransaction } from "../db.js";
import { chunkFile, shouldIndexFile, shouldSkipDir } from "./chunker.js";

export interface IndexAospArgs {
  platform: string; // D4 / X5 / STB
  module: string; // tvsystemui / asplayer / ...
  module_path: string; // 相对 repo_root 或绝对路径
  repo_root: string; // AOSP 工作树根
}

export interface IndexAospStats {
  platform: string;
  module: string;
  module_path: string;
  files_scanned: number;
  files_indexed: number;
  chunks_inserted: number;
  chunks_unchanged: number;
  errors: number;
  elapsed_ms: number;
}

const UPSERT_SQL = `
INSERT INTO aosp_chunks (
  platform, module, module_path, file_path,
  line_start, line_end, symbol_kind, symbol_name,
  content, content_hash, indexed_at
) VALUES (
  ?, ?, ?, ?,
  ?, ?, ?, ?,
  ?, ?, datetime('now')
)
ON CONFLICT(platform, module, file_path, line_start, line_end) DO UPDATE SET
  symbol_kind = excluded.symbol_kind,
  symbol_name = excluded.symbol_name,
  content = excluded.content,
  content_hash = excluded.content_hash,
  embedding = NULL,
  embedding_updated_at = NULL,
  indexed_at = excluded.indexed_at
WHERE aosp_chunks.content_hash IS NOT excluded.content_hash
`;

export async function indexAospModule(args: IndexAospArgs): Promise<IndexAospStats> {
  const t0 = Date.now();
  const stats: IndexAospStats = {
    platform: args.platform,
    module: args.module,
    module_path: args.module_path,
    files_scanned: 0,
    files_indexed: 0,
    chunks_inserted: 0,
    chunks_unchanged: 0,
    errors: 0,
    elapsed_ms: 0,
  };

  if (!args.repo_root) throw new Error("repo_root 不能为空");
  await mkdir(args.repo_root, { recursive: true }).catch(() => {});

  const absPath = path.isAbsolute(args.module_path)
    ? args.module_path
    : path.join(args.repo_root, args.module_path);
  const stRoot = await stat(absPath).catch(() => null);
  if (!stRoot) throw new Error(`module_path 不存在: ${absPath}`);
  if (!stRoot.isDirectory()) throw new Error(`module_path 不是目录: ${absPath}`);

  const db = getDb();
  const upsert = db.prepare(UPSERT_SQL);

  // BFS 遍历
  const queue: string[] = [absPath];
  const fileRows: Array<[string[], string]> = []; // [args[], hash]

  while (queue.length > 0) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      stats.errors++;
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue;
        queue.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      stats.files_scanned++;

      let st;
      try {
        st = await stat(full);
      } catch {
        stats.errors++;
        continue;
      }
      if (!shouldIndexFile(full, st.size)) continue;

      let content: string;
      try {
        content = await readFile(full, "utf8");
      } catch {
        stats.errors++;
        continue;
      }
      // 跳过包含 NUL 的伪文本（疑似二进制）
      if (content.indexOf("\u0000") >= 0) continue;

      const chunks = chunkFile(full, content);
      if (chunks.length === 0) continue;
      stats.files_indexed++;

      const relPath = path.relative(args.repo_root, full).replace(/\\/g, "/");
      for (const ch of chunks) {
        const hash = crypto
          .createHash("sha1")
          .update(ch.content)
          .digest("hex");
        fileRows.push([
          [
            args.platform.toUpperCase(),
            args.module.toLowerCase(),
            args.module_path,
            relPath,
            String(ch.line_start),
            String(ch.line_end),
            ch.symbol_kind,
            ch.symbol_name,
            ch.content,
            hash,
          ],
          hash,
        ]);
      }
    }
  }

  // 一次性事务写入
  if (fileRows.length > 0) {
    runInTransaction(db, () => {
      for (const [args2, _hash] of fileRows) {
        const info = upsert.run(...(args2 as any));
        if ((info?.changes ?? 0) > 0) stats.chunks_inserted++;
        else stats.chunks_unchanged++;
      }
    });
  }

  stats.elapsed_ms = Date.now() - t0;
  return stats;
}

// =============================================================================
// clear_aosp_index
// =============================================================================

export interface ClearAospArgs {
  platform?: string;
  module?: string;
}

export interface ClearAospStats {
  cleared: number;
  scope: string;
}

export function clearAospIndex(args: ClearAospArgs = {}): ClearAospStats {
  const db = getDb();
  const platform = args.platform?.toUpperCase();
  const module = args.module?.toLowerCase();

  let where = "";
  const params: any[] = [];
  if (platform && module) {
    where = "WHERE platform = ? AND module = ?";
    params.push(platform, module);
  } else if (platform) {
    where = "WHERE platform = ?";
    params.push(platform);
  } else if (module) {
    where = "WHERE module = ?";
    params.push(module);
  }

  const beforeRow = db
    .prepare(`SELECT COUNT(*) AS n FROM aosp_chunks ${where}`)
    .get(...params) as { n: number };
  const before = beforeRow?.n ?? 0;

  db.prepare(`DELETE FROM aosp_chunks ${where}`).run(...params);

  return {
    cleared: before,
    scope:
      platform && module
        ? `platform=${platform}, module=${module}`
        : platform
          ? `platform=${platform}`
          : module
            ? `module=${module}`
            : "all",
  };
}
