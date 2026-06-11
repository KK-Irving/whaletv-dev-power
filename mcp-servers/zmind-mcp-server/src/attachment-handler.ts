/**
 * Zmind 附件处理 pipeline (v2.0.0)。
 *
 * 职责：
 *   - 按文件扩展名 + magic bytes 识别附件类型
 *   - 路由到不同处理器：
 *     - 文本（log/txt/xml/json/conf/prop）→ 落盘 + 内容内联返回
 *     - zip → 落盘 + yauzl 自动解压
 *     - tar / tar.gz / tgz → 落盘 + tar 库自动解压
 *     - 7z / rar → 落盘 + 提示用户用 7z 命令
 *     - 图片（png/jpg/gif/bmp）→ 落盘，让 AI 用 vision 直接读
 *     - HCI log（btsnoop magic 或文件名含 btsnoop）→ 落盘 + 检测 tshark 可用性
 *     - PDF → 落盘 + 检测 pdftotext 可用性
 *     - 视频 → 落盘 + 提示用户描述关键帧
 *     - 其他 → 落盘 + 元信息
 *
 * 路径约定：
 *   - workspace 根目录（Kiro 当前 workspace 的 cwd）下 `.workspace/issue-<id>/`
 *   - 子目录：`attachments/` 原始附件，`extracted/` 解压结果
 *
 * 安全：
 *   - 解压时校验路径不逃出目标目录（zip slip / tar slip 防御）
 *   - 单个 archive 内最多 5000 个 entry，防止 zip bomb
 *   - 单个 entry 解压后大小 ≤ 200MB
 */

import { spawn } from "node:child_process";
import { existsSync, createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, writeFile, readdir, rm, rename, utimes } from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fromBuffer as yauzlFromBuffer } from "yauzl";
import * as tar from "tar";

import { zmindFetch } from "./http-client.js";

// =============================================================================
// 常量
// =============================================================================

const TEXT_EXTENSIONS = new Set([
  "log", "txt", "xml", "json", "csv", "conf", "cfg", "prop", "properties",
  "ini", "yaml", "yml", "md", "sh", "py", "js", "ts", "java", "kt", "c", "h",
  "cpp", "hpp", "rs", "go", "rb",
]);
const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "webp", "svg",
]);
const VIDEO_EXTENSIONS = new Set([
  "mp4", "avi", "mov", "mkv", "webm", "flv",
]);
const ZIP_EXTENSIONS = new Set(["zip"]);
// tar 系列：包含原生 tar 和单文件 gzip/bzip2/xz（tar 库自动识别）
const TAR_EXTENSIONS = new Set(["tar", "gz", "tgz", "tar.gz", "bz2", "tbz2", "xz", "txz", "tar.bz2", "tar.xz"]);
// rar / 7z：交给三档降级解压器（unar / unrar / 7z）
const RARSEVENZ_EXTENSIONS = new Set(["7z", "rar"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const OFFICE_EXTENSIONS = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx"]);

const TEXT_INLINE_MAX_CHARS = 100_000; // 内联返回的文本上限
const ARCHIVE_MAX_ENTRIES = 5000;
const ARCHIVE_MAX_ENTRY_SIZE = 200 * 1024 * 1024; // 200 MB

// =============================================================================
// 类型
// =============================================================================

/**
 * 附件类型枚举（按处理路径分类，不直接对应文件扩展名）。
 */
export type AttachmentKind =
  | "text"        // 直接读取
  | "image"       // 让 AI 用 vision 读
  | "video"       // 提示用户描述
  | "zip"         // yauzl 解压
  | "tar"         // tar 解压（含 .tar / .tar.gz / .tgz）
  | "sevenz"      // 7z / rar，提示
  | "pdf"         // 检测 pdftotext
  | "office"      // 提示用户复制粘贴
  | "hci_log"     // btsnoop / Bluetooth HCI log，检测 tshark
  | "binary"      // 未知二进制
  | "unknown";    // 解析失败

export interface AttachmentMeta {
  filename: string;
  /** 解析后的类型 */
  kind: AttachmentKind;
  /** 落盘绝对路径 */
  saved_path: string;
  /** 文件大小（字节） */
  size: number;
  /** 类型识别细节（扩展名 / magic bytes） */
  detection_reason: string;
}

export interface ExtractedSummary {
  /** 解压后的根目录 */
  extract_dir: string;
  /** 解压出的文件数量 */
  file_count: number;
  /** 解压后总大小（字节） */
  total_size: number;
  /** 文件清单（最多 100 条；超出时截断） */
  files: Array<{ rel_path: string; size: number }>;
  truncated: boolean;
}

export interface AttachmentProcessResult {
  meta: AttachmentMeta;
  /** 文本内容（仅 text 类型有值），≤ TEXT_INLINE_MAX_CHARS */
  text_content?: string;
  /** 解压结果（仅 zip/tar 类型且解压成功有值） */
  extracted?: ExtractedSummary;
  /** AI 应该如何处理本附件的提示 */
  hint: string;
  /** 检测到的可选工具（hci_log/pdf 类型）：tshark/pdftotext 是否在 PATH */
  external_tool_available?: { tool: string; available: boolean };
}

// =============================================================================
// 类型识别
// =============================================================================

/**
 * 根据扩展名 + magic bytes 识别附件类型。
 *
 * @param filename 文件名
 * @param magicHead 前 16 个字节（用于无扩展名 / 扩展名误导的场景）
 */
export function detectAttachmentKind(
  filename: string,
  magicHead?: Buffer,
): { kind: AttachmentKind; reason: string } {
  const lower = filename.toLowerCase();

  // 多扩展名优先（.tar.gz / .tar.bz2）
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tar.bz2")) {
    return { kind: "tar", reason: `composite ext: ${filename.match(/\.[^.]+\.[^.]+$/)?.[0] ?? ""}` };
  }

  const ext = lower.split(".").pop() ?? "";

  // HCI / btsnoop 优先识别（特殊文件名 or magic bytes）
  if (lower.includes("btsnoop") || lower.includes("hci_log") || lower.endsWith(".cfa") || lower.endsWith(".log.cfa")) {
    return { kind: "hci_log", reason: "filename pattern btsnoop/hci_log" };
  }
  if (magicHead && magicHead.length >= 8 && magicHead.slice(0, 8).toString("ascii") === "btsnoop\0") {
    return { kind: "hci_log", reason: "magic bytes btsnoop\\0" };
  }

  if (TEXT_EXTENSIONS.has(ext)) return { kind: "text", reason: `ext .${ext}` };
  if (IMAGE_EXTENSIONS.has(ext)) return { kind: "image", reason: `ext .${ext}` };
  if (VIDEO_EXTENSIONS.has(ext)) return { kind: "video", reason: `ext .${ext}` };
  if (ZIP_EXTENSIONS.has(ext)) return { kind: "zip", reason: `ext .${ext}` };
  if (TAR_EXTENSIONS.has(ext)) return { kind: "tar", reason: `ext .${ext}` };
  if (RARSEVENZ_EXTENSIONS.has(ext)) return { kind: "sevenz", reason: `ext .${ext}` };
  if (PDF_EXTENSIONS.has(ext)) return { kind: "pdf", reason: `ext .${ext}` };
  if (OFFICE_EXTENSIONS.has(ext)) return { kind: "office", reason: `ext .${ext}` };

  // Magic bytes 二次识别
  if (magicHead && magicHead.length >= 4) {
    const hex = magicHead.slice(0, 4).toString("hex").toLowerCase();
    if (hex === "504b0304" || hex === "504b0506") return { kind: "zip", reason: "magic PK\\x03\\x04" };
    if (hex.startsWith("1f8b")) return { kind: "tar", reason: "magic gzip" };
    if (hex === "25504446") return { kind: "pdf", reason: "magic %PDF" };
    if (hex.startsWith("89504e47")) return { kind: "image", reason: "magic PNG" };
    if (hex.startsWith("ffd8ff")) return { kind: "image", reason: "magic JPEG" };
    // RAR：v4 = "Rar!\\x1a\\x07\\x00"，v5 = "Rar!\\x1a\\x07\\x01\\x00"
    if (hex === "52617221") return { kind: "sevenz", reason: "magic Rar!" };
    // 7z："7z\\xbc\\xaf\\x27\\x1c"
    if (hex === "377abcaf") return { kind: "sevenz", reason: "magic 7z\\xbc\\xaf" };
    // xz："\\xfd7zXZ\\x00"
    if (hex === "fd377a58") return { kind: "tar", reason: "magic xz (delegated to tar)" };
  }

  return { kind: "binary", reason: ext.length > 0 ? `unknown ext .${ext}` : "no ext + no magic match" };
}

// =============================================================================
// 工作目录管理
// =============================================================================

/**
 * 获取或创建一个 issue 工作目录，结构：
 *
 *   <workspaceRoot>/.workspace/issue-<id>/
 *   ├── attachments/
 *   ├── extracted/
 */
export async function ensureIssueWorkspace(
  workspaceRoot: string,
  issueId: number,
): Promise<{
  root: string;
  attachments: string;
  extracted: string;
}> {
  const root = path.join(workspaceRoot, ".workspace", `issue-${issueId}`);
  const attachments = path.join(root, "attachments");
  const extracted = path.join(root, "extracted");
  await mkdir(attachments, { recursive: true });
  await mkdir(extracted, { recursive: true });
  return { root, attachments, extracted };
}

// =============================================================================
// HTTP 下载（带认证）
// =============================================================================

/**
 * 下载附件到指定路径，并返回前 N 字节的 Buffer 用于 magic bytes 识别。
 */
export async function downloadAttachment(
  attachmentUrl: string,
  apiKey: string,
  savePath: string,
): Promise<{ size: number; magicHead: Buffer }> {
  const url = new URL(attachmentUrl);
  url.searchParams.set("key", apiKey);
  const res = await zmindFetch(url.toString());
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${attachmentUrl}`);
  }
  if (!res.body) {
    throw new Error(`empty body downloading ${attachmentUrl}`);
  }

  // 保存到磁盘并捕获 magic head
  const ws = createWriteStream(savePath);
  const reader = res.body.getReader();
  const magicChunks: Buffer[] = [];
  let magicCollected = 0;
  let total = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const buf = Buffer.from(value);
    total += buf.length;
    if (magicCollected < 16) {
      const need = 16 - magicCollected;
      magicChunks.push(buf.slice(0, Math.min(need, buf.length)));
      magicCollected += Math.min(need, buf.length);
    }
    ws.write(buf);
  }
  await new Promise<void>((resolve, reject) => {
    ws.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
  });

  return { size: total, magicHead: Buffer.concat(magicChunks) };
}

// =============================================================================
// zip 解压（yauzl，纯 JS，零依赖外部命令）
// =============================================================================

/** zip slip 防御：确保 entry 路径不逃出 destDir */
function safeJoin(destDir: string, relPath: string): string {
  // 拒绝绝对路径与 ..
  const normalized = relPath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.includes("..")) {
    throw new Error(`unsafe entry path: ${relPath}`);
  }
  const target = path.resolve(destDir, normalized);
  const destResolved = path.resolve(destDir);
  if (!target.startsWith(destResolved + path.sep) && target !== destResolved) {
    throw new Error(`entry escapes target dir: ${relPath}`);
  }
  return target;
}

export async function extractZip(
  zipPath: string,
  destDir: string,
): Promise<ExtractedSummary> {
  await mkdir(destDir, { recursive: true });
  const buf = await import("node:fs").then((fs) => fs.promises.readFile(zipPath));

  const files: Array<{ rel_path: string; size: number }> = [];
  let totalSize = 0;
  let count = 0;

  await new Promise<void>((resolve, reject) => {
    yauzlFromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("yauzl failed to open zip"));

      zip.readEntry();
      zip.on("entry", async (entry) => {
        try {
          if (count >= ARCHIVE_MAX_ENTRIES) {
            zip.close();
            return reject(new Error(`zip archive contains > ${ARCHIVE_MAX_ENTRIES} entries`));
          }
          if (entry.uncompressedSize > ARCHIVE_MAX_ENTRY_SIZE) {
            zip.close();
            return reject(
              new Error(`zip entry too large: ${entry.fileName} (${entry.uncompressedSize} bytes)`),
            );
          }

          if (/\/$/.test(entry.fileName)) {
            // 目录
            const dir = safeJoin(destDir, entry.fileName);
            await mkdir(dir, { recursive: true });
            zip.readEntry();
            return;
          }

          const target = safeJoin(destDir, entry.fileName);
          await mkdir(path.dirname(target), { recursive: true });

          zip.openReadStream(entry, async (errStream, stream) => {
            if (errStream || !stream) {
              zip.close();
              return reject(errStream ?? new Error("openReadStream failed"));
            }
            try {
              await pipeline(stream, createWriteStream(target));
              files.push({ rel_path: entry.fileName, size: entry.uncompressedSize });
              totalSize += entry.uncompressedSize;
              count++;
              zip.readEntry();
            } catch (e) {
              zip.close();
              reject(e);
            }
          });
        } catch (e) {
          zip.close();
          reject(e);
        }
      });
      zip.on("end", () => resolve());
      zip.on("error", (e) => reject(e));
    });
  });

  return {
    extract_dir: destDir,
    file_count: count,
    total_size: totalSize,
    files: files.slice(0, 100),
    truncated: files.length > 100,
  };
}

// =============================================================================
// tar / tar.gz 解压
// =============================================================================

export async function extractTar(
  tarPath: string,
  destDir: string,
): Promise<ExtractedSummary> {
  await mkdir(destDir, { recursive: true });

  const files: Array<{ rel_path: string; size: number }> = [];
  let totalSize = 0;
  let count = 0;

  await tar.extract({
    file: tarPath,
    cwd: destDir,
    onReadEntry: (entry) => {
      if (count >= ARCHIVE_MAX_ENTRIES) {
        throw new Error(`tar archive contains > ${ARCHIVE_MAX_ENTRIES} entries`);
      }
      if (entry.size && entry.size > ARCHIVE_MAX_ENTRY_SIZE) {
        throw new Error(`tar entry too large: ${entry.path} (${entry.size} bytes)`);
      }
      const safePath = entry.path.replace(/\\/g, "/");
      if (safePath.startsWith("/") || safePath.includes("..")) {
        throw new Error(`unsafe tar entry path: ${entry.path}`);
      }
      if (entry.type === "File") {
        files.push({ rel_path: entry.path, size: entry.size ?? 0 });
        totalSize += entry.size ?? 0;
        count++;
      }
    },
  });

  return {
    extract_dir: destDir,
    file_count: count,
    total_size: totalSize,
    files: files.slice(0, 100),
    truncated: files.length > 100,
  };
}

// =============================================================================
// 通用解压辅助：0 字节防御、wrap 目录展平、子进程执行
// =============================================================================

/**
 * 检查目录下是否至少有 1 个非 0 字节的文件（递归）。
 *
 * 解压器（特别是旧 p7zip 处理 RAR5）有时会返回成功状态码，但目录里全是 0 字节
 * 占位文件——下游分析时全空看起来"日志为空"。我们用此函数实现真"成功"判定。
 */
export async function hasUsefulContent(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile()) {
        try {
          const st = await stat(full);
          if (st.size > 0) return true;
        } catch {
          /* skip */
        }
      } else if (entry.isDirectory()) {
        if (await hasUsefulContent(full)) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * 顶层只有 1 个子目录、0 个文件时，自动展平（把子目录内容上提一层）。
 *
 * RAR/ZIP 普遍把内容包在与归档同名的 wrap 目录里。展平能让最终路径变成
 * `<stem>/file.txt` 而不是 `<stem>/<wrap>/file.txt`，下游路径解析更直观。
 *
 * 展平失败不视为解压失败——还是有真日志可用，只是多了一层路径前缀。
 */
export async function flattenSingleDirWrap(targetDir: string): Promise<void> {
  try {
    const entries = await readdir(targetDir, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0].isDirectory()) return;
    const wrap = path.join(targetDir, entries[0].name);
    const inner = await readdir(wrap, { withFileTypes: true });
    for (const item of inner) {
      const src = path.join(wrap, item.name);
      const dst = path.join(targetDir, item.name);
      try {
        await rename(src, dst);
      } catch {
        /* 同名冲突等情况，跳过这一项 */
      }
    }
    try {
      await rm(wrap, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore - flattening is best effort */
  }
}

/**
 * 执行外部进程并收集 stdout / stderr。
 *
 * @returns { exitCode, stdout, stderr }；spawn 失败（命令不存在等）→ exitCode=-1
 */
function runProcess(
  cmd: string,
  args: string[],
  timeoutMs: number = 5 * 60 * 1000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let proc;
    try {
      proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    } catch (e) {
      resolve({ exitCode: -1, stdout: "", stderr: `spawn error: ${(e as Error).message}` });
      return;
    }
    proc.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", (e) => {
      resolve({ exitCode: -1, stdout, stderr: stderr + `\n${e.message}` });
    });
    proc.on("close", (code) => {
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
    setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      resolve({ exitCode: -1, stdout, stderr: stderr + `\n[timeout after ${timeoutMs}ms]` });
    }, timeoutMs);
  });
}

// =============================================================================
// RAR / 7z 解压（三档降级 + 0 字节防御 + wrap 展平）
// =============================================================================

/**
 * 解压 .rar 或 .7z 文件，按 unar → unrar → 7z 三档降级。
 *
 * 设计要点：
 *   - 每次尝试前清空目标目录（避免上一档残留 0 字节占位污染下一档判断）
 *   - 解压器声明成功后，**必须验证 hasUsefulContent**——旧 p7zip 处理 RAR5
 *     会返回 0 但产生全 0 字节文件（"Unsupported Method" 静默失败）
 *   - 顶层 wrap 目录自动展平
 *   - 三档全失败时清空目标目录，返回错误清单（每档的 stderr 前 200 字）
 *
 * @param archivePath 归档文件绝对路径
 * @param destDir     解压目标目录（必须存在或本函数会创建）
 * @returns 成功返回 ExtractedSummary；失败抛 Error（含三档失败摘要）
 */
export async function extractRarOrSevenz(
  archivePath: string,
  destDir: string,
): Promise<ExtractedSummary> {
  await mkdir(destDir, { recursive: true });

  const errors: Array<{ tool: string; reason: string }> = [];

  /** 尝试一档解压，成功且非空 → return true；否则 reset target 并返回 false */
  async function tryWith(tool: string, args: string[]): Promise<boolean> {
    const result = await runProcess(tool, args);
    if (result.exitCode !== 0) {
      errors.push({
        tool,
        reason: `exit ${result.exitCode}: ${(result.stderr || result.stdout).trim().slice(0, 200)}`,
      });
      await resetDir(destDir);
      return false;
    }
    if (!(await hasUsefulContent(destDir))) {
      errors.push({
        tool,
        reason: `${tool} reported success but produced empty/0-byte tree (possible RAR5 with old p7zip)`,
      });
      await resetDir(destDir);
      return false;
    }
    return true;
  }

  async function resetDir(dir: string): Promise<void> {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    await mkdir(dir, { recursive: true });
  }

  // 第 1 档：unar — RAR5 原生支持，最稳
  if (
    await tryWith("unar", [
      "-quiet",
      "-force-overwrite",
      "-output-directory",
      destDir,
      archivePath,
    ])
  ) {
    await flattenSingleDirWrap(destDir);
    return summarizeDir(destDir);
  }

  // 第 2 档：unrar (Win32: unrar.exe; Linux: unrar)
  if (
    await tryWith("unrar", [
      "x",
      "-y",         // assume yes
      "-inul",      // disable progress display
      archivePath,
      destDir + path.sep,
    ])
  ) {
    await flattenSingleDirWrap(destDir);
    return summarizeDir(destDir);
  }

  // 第 3 档：7z (兜底，对老版本 RAR5 不灵但 .7z 与 RAR3 都行)
  if (
    await tryWith("7z", [
      "x",
      "-y",
      `-o${destDir}`,
      archivePath,
    ])
  ) {
    await flattenSingleDirWrap(destDir);
    return summarizeDir(destDir);
  }

  // 三档全失败：清空目标目录（防止残留 0 字节文件污染上层 hint）
  await resetDir(destDir);
  const summary = errors.map((e) => `[${e.tool}] ${e.reason}`).join("; ");
  throw new Error(
    `RAR/7z 解压全部失败 (尝试了 ${errors.length} 个工具): ${summary}. ` +
      `请安装 unar (推荐) 或 7-Zip 后重试。`,
  );
}

/** 扫描目录生成 ExtractedSummary（用于 RAR/7z 解压成功路径） */
async function summarizeDir(destDir: string): Promise<ExtractedSummary> {
  const files: Array<{ rel_path: string; size: number }> = [];
  let totalSize = 0;
  let count = 0;

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          const st = await stat(full);
          count++;
          totalSize += st.size;
          if (files.length < 100) {
            files.push({
              rel_path: path.relative(destDir, full).replace(/\\/g, "/"),
              size: st.size,
            });
          }
        } catch {
          /* skip */
        }
      }
    }
  }

  await walk(destDir);

  return {
    extract_dir: destDir,
    file_count: count,
    total_size: totalSize,
    files,
    truncated: count > 100,
  };
}

// =============================================================================

/**
 * 检测某个 CLI 工具是否在 PATH 上（不实际执行任何业务命令）。
 */
export function detectExternalTool(tool: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(tool, ["--version"], { stdio: "ignore", shell: false });
    proc.on("error", () => resolve(false));
    proc.on("close", () => resolve(true));
    setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      resolve(false);
    }, 5000);
  });
}

// =============================================================================
// 读取文本文件（含截断）
// =============================================================================

export async function readTextWithLimit(
  filePath: string,
  maxChars: number = TEXT_INLINE_MAX_CHARS,
): Promise<string> {
  const fs = await import("node:fs/promises");
  const content = await fs.readFile(filePath, "utf8");
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + `\n\n... [文件过大，已截断，共 ${content.length} 字符]`;
}

// =============================================================================
// 主入口：处理单个附件
// =============================================================================

/**
 * 下载并处理单个附件：识别类型 → 落盘 → 路由处理。
 *
 * @param args.attachment_url Zmind 附件下载 URL
 * @param args.filename       附件文件名
 * @param args.api_key        Zmind API key
 * @param args.attachments_dir 附件落盘目录
 * @param args.extracted_dir  解压根目录
 *
 * @returns 处理结果，含 meta + text_content / extracted / hint
 */
export async function processAttachment(args: {
  attachment_url: string;
  filename: string;
  api_key: string;
  attachments_dir: string;
  extracted_dir: string;
}): Promise<AttachmentProcessResult> {
  // 把不安全的字符（非 ASCII 字母数字 / .-_）替换成 _，避免路径问题
  const safeName = args.filename.replace(/[^\w.\-]/g, "_");
  const savedPath = path.join(args.attachments_dir, safeName);

  // 下载
  const { size, magicHead } = await downloadAttachment(
    args.attachment_url,
    args.api_key,
    savedPath,
  );

  // 类型识别
  const { kind, reason } = detectAttachmentKind(args.filename, magicHead);

  const meta: AttachmentMeta = {
    filename: args.filename,
    kind,
    saved_path: savedPath,
    size,
    detection_reason: reason,
  };

  // 路由处理
  switch (kind) {
    case "text": {
      const text = await readTextWithLimit(savedPath);
      return {
        meta,
        text_content: text,
        hint: "文本附件已落盘并内联返回。AI 可直接基于 text_content 字段分析；如需更多上下文，可 read_file 读取 saved_path。",
      };
    }
    case "image": {
      return {
        meta,
        hint: `图片附件已落盘到 ${savedPath}。AI 可用 read_file 读取（Claude vision 支持），或直接基于 image content 分析问题截图/现象图。`,
      };
    }
    case "video": {
      return {
        meta,
        hint: `视频附件已落盘到 ${savedPath}。AI 无法直接看视频；建议询问用户描述关键帧、时间点和现象。`,
      };
    }
    case "zip": {
      const extractDir = path.join(args.extracted_dir, safeName.replace(/\.zip$/i, ""));
      try {
        const extracted = await extractZip(savedPath, extractDir);
        return {
          meta,
          extracted,
          hint: `zip 已自动解压到 ${extractDir}（${extracted.file_count} 个文件）。AI 可遍历 extracted.files 用 read_file 分析关键文件。`,
        };
      } catch (e) {
        return {
          meta,
          hint: `zip 解压失败: ${(e as Error).message}。文件已落盘到 ${savedPath}，建议用户手动解压。`,
        };
      }
    }
    case "tar": {
      const extractDir = path.join(
        args.extracted_dir,
        safeName.replace(/\.(tar\.gz|tar\.bz2|tar|tgz|tbz2|gz|bz2)$/i, ""),
      );
      try {
        const extracted = await extractTar(savedPath, extractDir);
        return {
          meta,
          extracted,
          hint: `tar 已自动解压到 ${extractDir}（${extracted.file_count} 个文件）。`,
        };
      } catch (e) {
        return {
          meta,
          hint: `tar 解压失败: ${(e as Error).message}。文件已落盘到 ${savedPath}。`,
        };
      }
    }
    case "sevenz": {
      const archiveStem = safeName.replace(/\.(7z|rar)$/i, "");
      const extractDir = path.join(args.extracted_dir, archiveStem);
      const stampPath = `${savedPath}.extracted_ok`;

      // 缓存检查：归档已落盘 + stamp 存在 + 解压目录非空 → 跳过
      if (existsSync(stampPath) && (await hasUsefulContent(extractDir))) {
        const cached = await summarizeDir(extractDir);
        return {
          meta,
          extracted: cached,
          hint: `RAR/7z 已缓存解压结果 (${cached.file_count} 个文件)，跳过重新解压。AI 可直接遍历 extracted.files。`,
        };
      }

      // 旧 stamp 失效：删掉，避免下面"已成功"误判
      if (existsSync(stampPath)) {
        try {
          await rm(stampPath, { force: true });
        } catch {
          /* ignore */
        }
      }

      try {
        const extracted = await extractRarOrSevenz(savedPath, extractDir);
        // 解压成功 → 写 stamp（next call 命中缓存）
        try {
          await writeFile(stampPath, new Date().toISOString(), "utf8");
        } catch {
          /* stamp 失败不影响主流程 */
        }
        return {
          meta,
          extracted,
          hint: `RAR/7z 已自动解压到 ${extractDir}（${extracted.file_count} 个文件）。AI 可遍历 extracted.files 用 read_file 分析关键文件。`,
        };
      } catch (e) {
        // 三档全失败：尝试探测 7z 工具是否在 PATH（给用户更准的安装提示）
        const has7z = await detectExternalTool("7z");
        const hasUnar = await detectExternalTool("unar");
        const tools: string[] = [];
        if (hasUnar) tools.push("unar");
        if (has7z) tools.push("7z");
        const installHint =
          tools.length === 0
            ? "本机未检测到 unar / 7z；请安装 unar (推荐, 原生支持 RAR5) 或 7-Zip 后重试。Windows: choco install unar 7zip; Linux: apt install unar p7zip-full; macOS: brew install unar p7zip"
            : `本机已检测到: ${tools.join(", ")}，但解压依然失败——可能归档损坏或受密码保护`;
        return {
          meta,
          external_tool_available: { tool: "unar/7z", available: tools.length > 0 },
          hint: `RAR/7z 自动解压失败: ${(e as Error).message}\n${installHint}\n文件已落盘到 ${savedPath}。`,
        };
      }
    }
    case "pdf": {
      const hasPdftotext = await detectExternalTool("pdftotext");
      return {
        meta,
        external_tool_available: { tool: "pdftotext", available: hasPdftotext },
        hint: hasPdftotext
          ? `PDF 已落盘到 ${savedPath}。本机检测到 pdftotext 可用，可运行: pdftotext "${savedPath}" - 转为可读文本（AI 可用 execute 命令调用）`
          : `PDF 已落盘到 ${savedPath}。本机未检测到 pdftotext；请用户用 PDF 阅读器打开并复制粘贴关键内容。`,
      };
    }
    case "office": {
      return {
        meta,
        hint: `Office 文档已落盘到 ${savedPath}。建议用户在 Word/Excel 中打开并复制粘贴关键内容；或用 pandoc 转 markdown。`,
      };
    }
    case "hci_log": {
      const hasTshark = await detectExternalTool("tshark");
      return {
        meta,
        external_tool_available: { tool: "tshark", available: hasTshark },
        hint: hasTshark
          ? `HCI/btsnoop log 已落盘到 ${savedPath}。本机检测到 tshark 可用，可运行: tshark -r "${savedPath}" -V 转为可读文本以分析蓝牙协议交互`
          : `HCI/btsnoop log 已落盘到 ${savedPath}。本机未检测到 tshark；请用户安装 Wireshark 或在另一台机器上分析后提供文本。`,
      };
    }
    case "binary":
    case "unknown":
    default: {
      // 尝试当作文本读取（utf-8）；如果包含太多空字符就放弃
      try {
        const text = await readTextWithLimit(savedPath);
        const nullCount = (text.match(/\u0000/g) ?? []).length;
        if (nullCount < text.length / 100 && text.length > 0) {
          return {
            meta: { ...meta, kind: "text" },
            text_content: text,
            hint: "未识别扩展名但内容看起来是文本，已尝试当作文本读取。",
          };
        }
      } catch {
        /* ignore */
      }
      return {
        meta,
        hint: `未知二进制附件已落盘到 ${savedPath}。无法自动分析；请用户描述用途或手动解析。`,
      };
    }
  }
}

// =============================================================================
// 工作目录索引：写 README.md
// =============================================================================

/**
 * 在 issue 工作目录写 README.md，索引附件清单 + 处理结果。
 */
export async function writeWorkspaceReadme(
  workspaceRoot: string,
  issue: {
    id: number;
    subject: string;
    description?: string;
    project_name?: string;
    status?: string;
    target_version?: string;
  },
  attachments: AttachmentProcessResult[],
): Promise<string> {
  const lines: string[] = [];
  lines.push(`# Issue #${issue.id}: ${issue.subject}`);
  lines.push("");
  if (issue.project_name) lines.push(`- **项目**: ${issue.project_name}`);
  if (issue.status) lines.push(`- **状态**: ${issue.status}`);
  if (issue.target_version) lines.push(`- **目标版本**: ${issue.target_version}`);
  lines.push(`- **生成时间**: ${new Date().toISOString()}`);
  lines.push("");

  if (issue.description) {
    lines.push("## 描述");
    lines.push("");
    lines.push(issue.description);
    lines.push("");
  }

  lines.push("## 附件清单");
  lines.push("");
  if (attachments.length === 0) {
    lines.push("（无附件）");
  } else {
    lines.push("| # | 文件 | 类型 | 大小 | 处理结果 |");
    lines.push("|---|------|------|------|---------|");
    for (let i = 0; i < attachments.length; i++) {
      const a = attachments[i];
      const sizeKB = (a.meta.size / 1024).toFixed(1);
      let status = a.meta.kind;
      if (a.text_content) status += " (内联)";
      else if (a.extracted) status += ` (已解压 ${a.extracted.file_count} 个文件)`;
      lines.push(
        `| ${i + 1} | ${a.meta.filename} | ${a.meta.kind} | ${sizeKB} KB | ${status} |`,
      );
    }
  }
  lines.push("");

  lines.push("## 子目录");
  lines.push("");
  lines.push("- `attachments/` — 原始附件（按 zmind 文件名保存）");
  lines.push("- `extracted/` — 自动解压的内容");
  lines.push("- `analysis.md` — AI 分析报告（待生成）");
  lines.push("- `notes.md` — 用户/AI 沟通记录（待生成）");

  const readmePath = path.join(workspaceRoot, "README.md");
  await writeFile(readmePath, lines.join("\n"), "utf8");
  return readmePath;
}
