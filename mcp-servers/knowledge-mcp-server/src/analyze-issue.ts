/**
 * analyze_issue —— 端到端 PR/Bug 分析编排（v1.0.0）。
 *
 * 一次调用串起：
 *   1. 拉 Zmind issue 详情（subject + description + journals + attachments）
 *   2. 准备工作目录（默认 `<workspace_root>/.workspace/issue-<id>/`）
 *   3. 提取查询关键词（标题去停用词 + 描述前 200 字符 token 化）
 *   4. 三源本地知识库混合检索（zmind / gerrit / confluence）
 *   5. 推断潜在 module（从命中的 gerrit/zmind 路径片段反查 module-map）
 *   6. （可选）AOSP 模块级精搜
 *   7. 渲染 `analysis-context.md` 落盘到工作目录
 *   8. 返回 JSON 汇总
 *
 * 任何子步骤失败均 best-effort 继续，错误写入 context.md "已知问题" 段。
 *
 * 注意：本工具**不下载附件**——附件下载由 zmind-mcp-server 的
 * `prepare_issue_workspace` 负责，此处只读取已有 workspace。如果调用时
 * workspace_root 不存在则只创建目录。
 */

import { mkdir, writeFile, readdir, stat } from "node:fs/promises";
import * as path from "node:path";

import { searchLocal } from "./search.js";
import { searchAosp } from "./aosp/search.js";
import { loadModuleMap } from "./aosp/module-map-loader.js";

const ZMIND_URL = (process.env.ZMIND_URL ?? "https://zmind.whaletv.com").replace(/\/+$/, "");
const ZMIND_API_KEY = process.env.ZMIND_API_KEY ?? "";

// =============================================================================
// 类型
// =============================================================================

interface ZmindIssue {
  id: number;
  tracker?: { name?: string };
  subject?: string;
  description?: string;
  status?: { name?: string };
  assigned_to?: { name?: string };
  project?: { id?: number; name?: string };
  fixed_version?: { name?: string };
  attachments?: Array<{ id: number; filename: string; filesize: number }>;
  journals?: Array<{
    user?: { name?: string };
    notes?: string;
    created_on?: string;
  }>;
}

export interface AnalyzeIssueArgs {
  issue_id: number;
  /** 工作目录根（默认 cwd）。最终路径 `<root>/.workspace/issue-<id>/` */
  workspace_root?: string;
  /** 是否在三源命中的基础上做 AOSP 模块级精搜 */
  include_aosp?: boolean;
  /** 强制指定平台（D4/X5/STB）；不传则尝试从 issue/project 名称推断 */
  platform?: string;
  /** 单源 limit（默认 3） */
  per_source_limit?: number;
}

export interface AnalyzeIssueResult {
  workspace_path: string;
  issue: {
    id: number;
    tracker: string;
    subject: string;
    status: string;
    assignee: string;
    project: string;
    target_version: string;
  };
  attachments_summary: { count: number; sample: string[] };
  keywords: string[];
  inferred_platform?: string;
  inferred_modules: string[];
  similar: Record<string, any[]>;
  aosp_hits: any[];
  context_md_path: string;
  errors: Array<{ stage: string; message: string }>;
}

// =============================================================================
// Zmind helper
// =============================================================================

async function fetchIssue(issueId: number): Promise<ZmindIssue> {
  if (!ZMIND_API_KEY) throw new Error("ZMIND_API_KEY 未配置");
  const url = new URL(`/issues/${issueId}.json`, ZMIND_URL + "/");
  url.searchParams.set("include", "attachments,journals");
  url.searchParams.set("key", ZMIND_API_KEY);
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Zmind HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { issue: ZmindIssue };
  return data.issue;
}

// =============================================================================
// 关键词提取
// =============================================================================

const STOPWORDS_ZH = new Set([
  "的", "了", "和", "是", "在", "有", "也", "就", "都", "这", "那", "我", "你", "他",
  "不", "为", "上", "下", "之", "对", "以", "及", "及其", "或", "等", "与",
  "请", "问题", "情况", "发现", "出现", "存在", "需要", "处理", "解决", "测试",
  "已", "未", "可", "能", "会", "时", "时候",
]);

const STOPWORDS_EN = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "of", "to", "in", "on", "at", "for", "with", "and", "or", "but",
  "this", "that", "these", "those", "it", "its", "as",
  "i", "we", "you", "they", "he", "she",
  "have", "has", "had", "do", "does", "did", "can", "will", "would", "should",
  "issue", "bug", "test", "fix", "fail", "failed", "problem",
]);

/**
 * 从 issue 标题 + 描述前 200 字符提取关键词。
 *
 * 简单策略：
 *   - 把内容按非字母数字字符切分
 *   - 同时切分中文（按字符为单位，但保留连续中文片段）
 *   - 过滤停用词、长度 < 2 的 token
 *   - 取前 8 个去重 token
 */
export function extractKeywords(subject: string, description: string): string[] {
  const text = (subject + " " + (description || "").slice(0, 200)).toLowerCase();
  // 同时切英文 token 与连续中文片段
  const englishTokens = (text.match(/[a-z][a-z0-9_-]+/g) ?? []).filter(
    (t) => t.length >= 2 && !STOPWORDS_EN.has(t),
  );
  const chineseTokens = (text.match(/[\u4e00-\u9fff]+/g) ?? []).filter(
    (t) => t.length >= 2 && !STOPWORDS_ZH.has(t),
  );

  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of [...englishTokens, ...chineseTokens]) {
    if (seen.has(t)) continue;
    seen.add(t);
    result.push(t);
    if (result.length >= 8) break;
  }
  return result;
}

// =============================================================================
// 平台 / 模块推断
// =============================================================================

const PLATFORM_KEYWORDS: Record<string, string[]> = {
  D4: ["d4", "am30", "at30", "calla", "redi", "soddy", "t982"],
  X5: ["x5", "am50", "br30", "bs30", "anemone", "dahlia", "daisy", "dryas"],
  STB: ["stb", "stb16", "pascal", "qurra", "raman", "ross"],
};

function inferPlatform(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const [platform, keywords] of Object.entries(PLATFORM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return platform;
    }
  }
  return undefined;
}

/**
 * 从命中的搜索结果（含 gerrit project / 文件路径片段）反查可能的 module。
 */
async function inferModulesFromHits(
  hits: any[],
  platform: string | undefined,
): Promise<string[]> {
  if (!platform || hits.length === 0) return [];
  let map;
  try {
    map = await loadModuleMap();
  } catch {
    return [];
  }
  const platformMap = map.platforms[platform.toUpperCase()];
  if (!platformMap) return [];

  const moduleScores = new Map<string, number>();
  // 对每个命中结果，扫描其 project / 路径片段，看是否匹配 module path 前缀
  for (const hit of hits) {
    const text = String(
      (hit?.project ?? "") + " " + (hit?.snippet ?? "") + " " + (hit?.title ?? ""),
    ).toLowerCase();
    for (const [moduleName, paths] of Object.entries(platformMap) as Array<[string, string[]]>) {
      let hitCount = 0;
      for (const p of paths) {
        const pLower = p.toLowerCase();
        // 取 path 最后一段作为最特征性 token
        const segs = pLower.split("/").filter(Boolean);
        for (const seg of segs.slice(-2)) {
          if (seg.length >= 4 && text.includes(seg)) {
            hitCount++;
            break;
          }
        }
        if (text.includes(moduleName)) hitCount++;
      }
      if (hitCount > 0) {
        moduleScores.set(moduleName, (moduleScores.get(moduleName) ?? 0) + hitCount);
      }
    }
  }

  return Array.from(moduleScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([m]) => m);
}

// =============================================================================
// 工作目录
// =============================================================================

async function ensureWorkspace(workspaceRoot: string, issueId: number): Promise<string> {
  const wsRoot = path.resolve(workspaceRoot);
  const target = path.join(wsRoot, ".workspace", `issue-${issueId}`);
  await mkdir(target, { recursive: true });
  return target;
}

async function summarizeAttachments(workspacePath: string): Promise<{ count: number; sample: string[] }> {
  const attachDir = path.join(workspacePath, "attachments");
  try {
    const st = await stat(attachDir);
    if (!st.isDirectory()) return { count: 0, sample: [] };
  } catch {
    return { count: 0, sample: [] };
  }
  const entries = await readdir(attachDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  return { count: files.length, sample: files.slice(0, 5) };
}

// =============================================================================
// Markdown 渲染
// =============================================================================

function renderContextMd(args: {
  issue: ZmindIssue;
  workspace: string;
  attachments: { count: number; sample: string[] };
  keywords: string[];
  platform: string | undefined;
  modules: string[];
  similar: Record<string, any[]>;
  aospHits: any[];
  errors: Array<{ stage: string; message: string }>;
}): string {
  const lines: string[] = [];
  const issue = args.issue;
  lines.push(`# Issue #${issue.id} 分析上下文`);
  lines.push("");
  lines.push(`- **标题**: ${issue.subject ?? "(无)"}`);
  lines.push(`- **类型**: ${issue.tracker?.name ?? ""}`);
  lines.push(`- **状态**: ${issue.status?.name ?? ""}`);
  lines.push(`- **指派**: ${issue.assigned_to?.name ?? ""}`);
  lines.push(`- **项目**: ${issue.project?.name ?? ""}`);
  lines.push(`- **目标版本**: ${issue.fixed_version?.name ?? ""}`);
  lines.push(`- **生成时间**: ${new Date().toISOString()}`);
  lines.push(`- **工作目录**: ${args.workspace}`);
  lines.push("");

  // 描述
  lines.push("## 问题描述");
  lines.push("");
  lines.push(issue.description ?? "(无描述)");
  lines.push("");

  // 附件
  lines.push("## 附件");
  lines.push("");
  if (args.attachments.count === 0) {
    lines.push("（暂无）— 如需下载附件请用 zmind-mcp 的 `prepare_issue_workspace` 工具");
  } else {
    lines.push(`共 ${args.attachments.count} 个；样本：`);
    for (const f of args.attachments.sample) lines.push(`- \`${f}\``);
  }
  lines.push("");

  // 关键词与平台/模块
  lines.push("## 推断信息");
  lines.push("");
  lines.push(`- **关键词**: ${args.keywords.length > 0 ? args.keywords.join(", ") : "(空)"}`);
  lines.push(`- **平台**: ${args.platform ?? "(未推断)"}`);
  lines.push(`- **可能模块**: ${args.modules.length > 0 ? args.modules.join(", ") : "(未推断)"}`);
  lines.push("");

  // 相似历史
  lines.push("## 相似历史（本地知识库 hybrid 检索）");
  lines.push("");
  for (const sourceName of ["zmind", "gerrit", "confluence"]) {
    const hits = args.similar[sourceName] ?? [];
    lines.push(`### ${sourceName} (${hits.length} 条)`);
    lines.push("");
    if (hits.length === 0) {
      lines.push("（无命中）");
    } else {
      for (const h of hits) {
        const titlePart = h.title ?? "(无标题)";
        const url = h.url ?? "";
        const snippet = (h.snippet ?? "").replace(/\n/g, " ");
        const score = typeof h.score === "number" ? h.score.toFixed(3) : "";
        lines.push(`- **[${h.id}]** [${titlePart}](${url}) · score=${score} · match=${h.match}`);
        if (snippet) lines.push(`  - ${snippet.slice(0, 240)}`);
      }
    }
    lines.push("");
  }

  // AOSP
  lines.push("## AOSP 代码（模块级精搜）");
  lines.push("");
  if (args.aospHits.length === 0) {
    lines.push("（未启用 / 未命中）");
  } else {
    for (const h of args.aospHits) {
      lines.push(
        `- **${h.module}** ${h.file_path}:${h.line_start}-${h.line_end} (${h.symbol_kind} ${h.symbol_name})`,
      );
      const snip = (h.snippet ?? "").replace(/\n/g, " ");
      if (snip) lines.push(`  - ${snip.slice(0, 240)}`);
    }
  }
  lines.push("");

  // 后续建议
  lines.push("## 推荐动作");
  lines.push("");
  lines.push("1. **复现验证** — 在 issue 描述场景下尝试本地复现");
  lines.push("2. **历史修复对比** — 重点查看上面三源 Top-K 命中里 status=Closed 的条目，对比修复方式");
  lines.push("3. **模块改动建议** — 结合 AOSP 命中代码片段定位修改点；如未命中可手动用 `search_aosp` 缩小范围");
  lines.push("");

  // 已知问题
  if (args.errors.length > 0) {
    lines.push("## 已知问题（运行期错误）");
    lines.push("");
    for (const e of args.errors) {
      lines.push(`- **${e.stage}**: ${e.message}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// =============================================================================
// 主入口
// =============================================================================

export async function analyzeIssue(args: AnalyzeIssueArgs): Promise<AnalyzeIssueResult> {
  const errors: Array<{ stage: string; message: string }> = [];
  const issueId = args.issue_id;
  const workspaceRoot = args.workspace_root ?? process.cwd();
  const perSourceLimit = Math.max(1, Math.min(10, args.per_source_limit ?? 3));

  // 1. 拉 issue
  let issue: ZmindIssue;
  try {
    issue = await fetchIssue(issueId);
  } catch (e) {
    errors.push({ stage: "fetch_issue", message: (e as Error).message });
    issue = { id: issueId };
  }

  // 2. 工作目录
  const wsPath = await ensureWorkspace(workspaceRoot, issueId);

  // 3. 附件汇总
  let attachSummary = { count: 0, sample: [] as string[] };
  try {
    attachSummary = await summarizeAttachments(wsPath);
  } catch (e) {
    errors.push({ stage: "summarize_attachments", message: (e as Error).message });
  }

  // 4. 关键词
  const keywords = extractKeywords(issue.subject ?? "", issue.description ?? "");

  // 5. 平台推断
  const platformText = `${issue.subject ?? ""} ${issue.description ?? ""} ${issue.project?.name ?? ""} ${issue.fixed_version?.name ?? ""}`;
  const inferredPlatform = (args.platform ?? inferPlatform(platformText) ?? "").toUpperCase() || undefined;

  // 6. 三源 hybrid 检索
  let similar: Record<string, any[]> = {};
  if (keywords.length > 0) {
    try {
      const query = keywords.join(" ");
      const result = (await searchLocal({
        query,
        source: "all",
        mode: "hybrid",
        limit: perSourceLimit,
      })) as any;
      similar = {
        zmind: result.zmind ?? [],
        gerrit: result.gerrit ?? [],
        confluence: result.confluence ?? [],
      };
    } catch (e) {
      errors.push({ stage: "search_local", message: (e as Error).message });
    }
  }

  // 7. 模块推断
  const allHitsForInference = [
    ...(similar.zmind ?? []),
    ...(similar.gerrit ?? []),
  ];
  let modules: string[] = [];
  try {
    modules = await inferModulesFromHits(allHitsForInference, inferredPlatform);
  } catch (e) {
    errors.push({ stage: "infer_modules", message: (e as Error).message });
  }

  // 8. AOSP 检索（可选）
  let aospHits: any[] = [];
  if (args.include_aosp && inferredPlatform && modules.length > 0 && keywords.length > 0) {
    try {
      const result = await searchAosp({
        query: keywords.join(" "),
        platform: inferredPlatform,
        module: modules[0],
        mode: "hybrid",
        limit: perSourceLimit,
      });
      aospHits = result.hits;
    } catch (e) {
      errors.push({ stage: "search_aosp", message: (e as Error).message });
    }
  }

  // 9. 渲染 context.md
  const md = renderContextMd({
    issue,
    workspace: wsPath,
    attachments: attachSummary,
    keywords,
    platform: inferredPlatform,
    modules,
    similar,
    aospHits,
    errors,
  });
  const ctxPath = path.join(wsPath, "analysis-context.md");
  try {
    await writeFile(ctxPath, md, "utf8");
  } catch (e) {
    errors.push({ stage: "write_context_md", message: (e as Error).message });
  }

  return {
    workspace_path: wsPath,
    issue: {
      id: issueId,
      tracker: issue.tracker?.name ?? "",
      subject: issue.subject ?? "",
      status: issue.status?.name ?? "",
      assignee: issue.assigned_to?.name ?? "",
      project: issue.project?.name ?? "",
      target_version: issue.fixed_version?.name ?? "",
    },
    attachments_summary: attachSummary,
    keywords,
    inferred_platform: inferredPlatform,
    inferred_modules: modules,
    similar,
    aosp_hits: aospHits,
    context_md_path: ctxPath,
    errors,
  };
}
