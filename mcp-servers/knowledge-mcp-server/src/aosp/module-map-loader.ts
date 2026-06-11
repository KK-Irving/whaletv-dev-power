/**
 * 解析 steering/module-path-map.md，提取 D4/X5/STB 各平台的模块 → 路径映射。
 *
 * map 的 Markdown 结构（约定）：
 *
 * ```
 * ## D4 平台
 *
 * ### 一级目录: vendor/zeasn
 *
 * | 模块 | 路径 |
 * |---|---|
 * | tvsystemui | `vendor/zeasn/...` |
 * | asplayer | `vendor/zeasn/...` |
 * ```
 *
 * 我们只关注**含路径的代码块或表格**，按平台 → module → [paths] 三层结构提取。
 *
 * 输出 `data/module-map.json`，下次启动直接读 JSON 不再解析 markdown。
 */

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import * as path from "node:path";
import { existsSync } from "node:fs";

import { config } from "../config.js";

export interface ModuleMap {
  /** 平台 → 模块名 → 路径前缀数组 */
  platforms: Record<string, Record<string, string[]>>;
  /** 生成时间 */
  generated_at: string;
  /** 来源文件相对路径 */
  source: string;
}

const PLATFORM_NAMES = ["D4", "X5", "STB"] as const;

/**
 * 默认从仓库根的 `steering/module-path-map.md` 加载。
 * 先试 cache: data/module-map.json；缺失或源文件更新过时则重新解析。
 */
export async function loadModuleMap(opts: {
  /** module-path-map.md 路径；默认 './steering/module-path-map.md' */
  sourcePath?: string;
  /** cache JSON 路径；默认 './data/module-map.json' */
  cachePath?: string;
  /** 强制重建 */
  rebuild?: boolean;
} = {}): Promise<ModuleMap> {
  const sourcePath = opts.sourcePath ?? path.resolve("./steering/module-path-map.md");
  const cachePath = opts.cachePath ?? path.resolve(path.dirname(config.dbPath), "module-map.json");

  // 用 cache 如果存在且比源新
  if (!opts.rebuild && existsSync(cachePath) && existsSync(sourcePath)) {
    try {
      const [cacheStat, srcStat] = await Promise.all([stat(cachePath), stat(sourcePath)]);
      if (cacheStat.mtimeMs >= srcStat.mtimeMs) {
        const text = await readFile(cachePath, "utf8");
        return JSON.parse(text) as ModuleMap;
      }
    } catch {
      /* 落到重建 */
    }
  }

  // 解析 markdown
  if (!existsSync(sourcePath)) {
    return {
      platforms: {},
      generated_at: new Date().toISOString(),
      source: sourcePath,
    };
  }

  const md = await readFile(sourcePath, "utf8");
  const map = parseModulePathMap(md, sourcePath);

  // 写 cache
  try {
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(map, null, 2), "utf8");
  } catch {
    /* cache 失败不致命 */
  }

  return map;
}

// =============================================================================
// Markdown 解析
// =============================================================================

/**
 * 解析 module-path-map.md 文本。
 *
 * 思路：
 *   - 顺序扫描行，维护 currentPlatform / currentModule
 *   - 平台 heading 形式：`## D4 平台` / `## X5 平台` / `## STB 平台`（或英文）
 *   - 在表格行中提取 `| 模块名 | \`path/to/module\` |` 形式
 *   - 在 inline code 块中提取 `` `vendor/...` `` 形式
 *   - 模块名 token 化为 lowercase + 去空格用作 key
 */
export function parseModulePathMap(markdown: string, sourcePath: string): ModuleMap {
  const lines = markdown.split(/\r?\n/);
  const platforms: Record<string, Record<string, string[]>> = {};

  let currentPlatform: string | null = null;
  let currentModule: string | null = null;

  const platformHeadingRe = /^##\s+(D4|X5|STB)\s*(?:平台)?/i;
  const subHeadingRe = /^####\s+(.+?)\s*$/; // module 子节标题
  const tableRowRe = /^\|\s*([^|]+?)\s*\|\s*`([^`]+)`/;
  const codePathLineRe = /`([^`]+)`/g;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // 平台标题
    const pm = line.match(platformHeadingRe);
    if (pm) {
      const name = pm[1].toUpperCase();
      currentPlatform = PLATFORM_NAMES.includes(name as any) ? name : null;
      currentModule = null;
      if (currentPlatform && !platforms[currentPlatform]) platforms[currentPlatform] = {};
      continue;
    }
    if (!currentPlatform) continue;

    // 模块子标题（如 `#### TvSystemUI`）
    const sm = line.match(subHeadingRe);
    if (sm) {
      currentModule = normalizeModuleName(sm[1]);
      if (currentModule && !platforms[currentPlatform][currentModule]) {
        platforms[currentPlatform][currentModule] = [];
      }
      continue;
    }

    // 表格行：| 模块名 | `path` | ...
    const trm = line.match(tableRowRe);
    if (trm) {
      // 跳过表头分隔符
      if (/^[-:|\s]+$/.test(trm[1])) continue;
      // 跳过表头（"模块" / "路径" 这种无 path 的）
      const moduleName = normalizeModuleName(trm[1]);
      const pathStr = trm[2].trim();
      if (moduleName && pathStr) {
        if (!platforms[currentPlatform][moduleName]) platforms[currentPlatform][moduleName] = [];
        platforms[currentPlatform][moduleName].push(pathStr);
      }
      continue;
    }

    // 在 currentModule 段内的 inline code 路径
    if (currentModule) {
      let m: RegExpExecArray | null;
      const re = new RegExp(codePathLineRe.source, "g");
      while ((m = re.exec(line)) !== null) {
        const candidate = m[1].trim();
        // 只接受形如 `xxx/yyy/...` 的路径片段
        if (/^[\w._-]+\/[\w./_-]+/.test(candidate)) {
          const arr = platforms[currentPlatform][currentModule];
          if (arr && !arr.includes(candidate)) arr.push(candidate);
        }
      }
    }
  }

  return {
    platforms,
    generated_at: new Date().toISOString(),
    source: sourcePath,
  };
}

function normalizeModuleName(raw: string): string | null {
  const trimmed = raw
    .replace(/[`*_]/g, "")
    .trim()
    .toLowerCase();
  if (!trimmed) return null;
  if (/^(模块|路径|说明|备注|描述|—|-)/.test(trimmed)) return null;
  // 把空格 / 标点替换成短横线
  return trimmed.replace(/[\s,()（）/]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

// =============================================================================
// 查询帮手
// =============================================================================

/**
 * 给定 platform + module，返回路径前缀数组（可能为空）。
 */
export function resolveModulePaths(map: ModuleMap, platform: string, moduleId: string): string[] {
  const p = (platform || "").toUpperCase();
  const m = (moduleId || "").toLowerCase();
  return map.platforms[p]?.[m] ?? [];
}

export function listModulesOfPlatform(map: ModuleMap, platform: string): string[] {
  const p = (platform || "").toUpperCase();
  return Object.keys(map.platforms[p] ?? {}).sort();
}
