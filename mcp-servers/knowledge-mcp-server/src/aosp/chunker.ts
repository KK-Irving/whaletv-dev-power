/**
 * 文件切块（chunker）。
 *
 * 设计：
 *   - 不上 tree-sitter（500MB+ 体积、需各语言 wasm）
 *   - 用 **正则边界识别 + 行级硬切**，足够覆盖 AOSP 主流语言（Java/Kotlin/C/C++/Python/Shell/AIDL/HIDL/XML 注释边界）
 *   - 每个 chunk ≤ MAX_CHUNK_CHARS（默认 2000 字符）
 *   - 优先在边界（class / fn / method）切；落不到边界时按 200 行硬切
 *   - 每个 chunk 记录 file_path、line_start、line_end、symbol_kind、symbol_name
 *
 * 黑名单：在 indexer 层处理（跳过 .git / out / build / 二进制 / >5MB）
 */

const MAX_CHUNK_CHARS = 2000;
const HARD_LINES = 200;

export interface Chunk {
  /** 1-indexed inclusive */
  line_start: number;
  /** 1-indexed inclusive */
  line_end: number;
  /** "class" | "method" | "function" | "block" | "header" */
  symbol_kind: string;
  symbol_name: string;
  content: string;
}

interface Boundary {
  line: number; // 1-indexed
  kind: string;
  name: string;
}

// =============================================================================
// 边界识别（正则）
// =============================================================================

function detectBoundariesJava(lines: string[]): Boundary[] {
  // class / interface / enum / methods
  const result: Boundary[] = [];
  // 顶层 class / interface / enum
  const classRe = /^\s*(?:public|private|protected|abstract|final|static|sealed)?\s*(class|interface|enum|@interface)\s+(\w+)/;
  // method（有 paren 的非 class 行；不严格，但够用）
  const methodRe =
    /^\s*(?:public|private|protected|static|final|abstract|synchronized|default|native)\s+(?:[\w<>?,\s.\[\]]+\s+)?(\w+)\s*\(/;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln) continue;
    let m = ln.match(classRe);
    if (m) {
      result.push({ line: i + 1, kind: m[1], name: m[2] });
      continue;
    }
    m = ln.match(methodRe);
    if (m && !ln.trimStart().startsWith("//")) {
      // 排除 control statement
      if (!/^\s*(if|for|while|switch|catch|synchronized|try)\s*\(/.test(ln)) {
        result.push({ line: i + 1, kind: "method", name: m[1] });
      }
    }
  }
  return result;
}

function detectBoundariesKotlin(lines: string[]): Boundary[] {
  const result: Boundary[] = [];
  const classRe = /^\s*(?:open|abstract|sealed|data|enum|object)?\s*(class|interface|object|enum)\s+(\w+)/;
  const funRe = /^\s*(?:override|open|private|public|protected|internal|suspend|inline)?\s*fun\s+(?:<[^>]*>\s*)?(?:(\w+)\.)?(\w+)\s*\(/;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln) continue;
    let m = ln.match(classRe);
    if (m) {
      result.push({ line: i + 1, kind: m[1], name: m[2] });
      continue;
    }
    m = ln.match(funRe);
    if (m) {
      result.push({ line: i + 1, kind: "function", name: m[2] || m[1] || "" });
    }
  }
  return result;
}

function detectBoundariesCpp(lines: string[]): Boundary[] {
  const result: Boundary[] = [];
  // class / struct
  const classRe = /^\s*(?:template\s*<[^>]*>\s*)?(class|struct)\s+(\w+)/;
  // 函数定义（含返回类型）；非常宽松：以 ) { 结尾的行
  const funRe = /^\s*(?:[\w:<>*&\s,]+)\s+(\w+)\s*\([^)]*\)\s*(?:const)?\s*(?:override)?\s*\{?\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln) continue;
    let m = ln.match(classRe);
    if (m) {
      result.push({ line: i + 1, kind: m[1], name: m[2] });
      continue;
    }
    m = ln.match(funRe);
    if (m && !ln.trim().startsWith("//") && !/^\s*(if|for|while|switch|catch|return)\s*\(/.test(ln)) {
      // 至少要看像函数签名（含返回类型字符）：放到稍后 dedup
      if (ln.includes(" ") || ln.includes(":")) {
        result.push({ line: i + 1, kind: "function", name: m[1] });
      }
    }
  }
  return result;
}

function detectBoundariesPython(lines: string[]): Boundary[] {
  const result: Boundary[] = [];
  const re = /^\s*(class|def|async def)\s+(\w+)/;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln) continue;
    const m = ln.match(re);
    if (m) {
      result.push({ line: i + 1, kind: m[1].includes("class") ? "class" : "function", name: m[2] });
    }
  }
  return result;
}

function detectBoundariesGeneric(_lines: string[]): Boundary[] {
  return []; // 未识别语言走纯硬切
}

function pickDetector(fileExt: string): (lines: string[]) => Boundary[] {
  switch (fileExt.toLowerCase()) {
    case ".java":
    case ".aidl":
    case ".hal":
      return detectBoundariesJava;
    case ".kt":
    case ".kts":
      return detectBoundariesKotlin;
    case ".c":
    case ".cc":
    case ".cpp":
    case ".cxx":
    case ".h":
    case ".hh":
    case ".hpp":
      return detectBoundariesCpp;
    case ".py":
      return detectBoundariesPython;
    default:
      return detectBoundariesGeneric;
  }
}

// =============================================================================
// 切块主入口
// =============================================================================

/**
 * 把单个文件内容切成 chunks。
 *
 * 策略：
 *   1. 用语言对应的正则识别边界点
 *   2. 在每两个边界之间组成 chunk（如果合并段超 MAX_CHUNK_CHARS，按 HARD_LINES 硬切）
 *   3. 没有边界时按 HARD_LINES 硬切
 *
 * 行号统一 1-indexed inclusive。
 */
export function chunkFile(filePath: string, content: string): Chunk[] {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return [];

  const ext = filePath.slice(filePath.lastIndexOf("."));
  const detect = pickDetector(ext);
  const boundaries = detect(lines);

  // 把"文件起点"作为虚拟边界
  const cuts: Boundary[] = [{ line: 1, kind: "header", name: "" }, ...boundaries];

  const chunks: Chunk[] = [];

  // 按相邻边界切片
  for (let i = 0; i < cuts.length; i++) {
    const start = cuts[i].line;
    const end = i + 1 < cuts.length ? cuts[i + 1].line - 1 : lines.length;
    if (end < start) continue;
    sliceAndPush(lines, filePath, start, end, cuts[i].kind, cuts[i].name, chunks);
  }

  return chunks;
}

function sliceAndPush(
  lines: string[],
  _filePath: string,
  startLine: number,
  endLine: number,
  kind: string,
  name: string,
  out: Chunk[],
): void {
  // 把 [startLine..endLine] 视作一个 region，超长就硬切
  let cursor = startLine;
  while (cursor <= endLine) {
    const lineCount = Math.min(endLine - cursor + 1, HARD_LINES);
    let endCursor = cursor + lineCount - 1;
    let body = lines.slice(cursor - 1, endCursor).join("\n");
    // 字符上限再约束一次（超长则进一步缩 endCursor）
    while (body.length > MAX_CHUNK_CHARS && endCursor > cursor) {
      endCursor = cursor + Math.max(0, Math.floor((endCursor - cursor) * 0.8));
      body = lines.slice(cursor - 1, endCursor).join("\n");
    }
    if (body.trim().length === 0) {
      cursor = endCursor + 1;
      continue;
    }
    out.push({
      line_start: cursor,
      line_end: endCursor,
      symbol_kind: kind,
      symbol_name: name,
      content: body,
    });
    cursor = endCursor + 1;
  }
}

// =============================================================================
// 文件类型过滤（黑名单）
// =============================================================================

const SOURCE_EXTS = new Set([
  ".java", ".kt", ".kts", ".aidl", ".hal",
  ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp",
  ".py", ".sh", ".bp", ".mk", ".rs", ".go",
  ".xml", ".rc", ".te", ".sepolicy",
  ".js", ".ts", ".jsx", ".tsx", ".vue",
  ".md", ".txt",
]);

const SKIP_DIR_NAMES = new Set([
  ".git", ".repo", "out", "build", ".gradle", "node_modules",
  "__pycache__", ".idea", ".vscode",
  "obj", "bin", "Debug", "Release", "target",
]);

/** 是否应该索引该文件路径（基于扩展名 + 大小）。 */
export function shouldIndexFile(filePath: string, sizeBytes: number): boolean {
  if (sizeBytes > 5 * 1024 * 1024) return false; // 单文件 5MB 上限
  if (sizeBytes === 0) return false;
  const i = filePath.lastIndexOf(".");
  if (i < 0) return false;
  const ext = filePath.slice(i).toLowerCase();
  return SOURCE_EXTS.has(ext);
}

/** 是否应该跳过目录（按目录名）。 */
export function shouldSkipDir(dirName: string): boolean {
  if (dirName.startsWith(".") && SKIP_DIR_NAMES.has(dirName)) return true;
  return SKIP_DIR_NAMES.has(dirName);
}
