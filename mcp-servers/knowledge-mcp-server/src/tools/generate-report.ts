/**
 * generate_report — 生成 Skill 执行报告（JSON + HTML）
 *
 * 输入：ReportFactV1 结构（可选自动计算 quality_signals）
 * 输出：JSON 文件 + HTML 文件，落盘到 <output_dir>/{issue_id}/{report_id}-report-fact-v1.json 和 .html
 *
 * 触发时机：
 *   - whaletv-bug-analysis / whaletv-pr-cr / analyze_issue 工作流完成时（skill 内的 Completion Rule）
 *   - 用户显式请求"生成报告"
 *   - 治理层需要按周聚合 skill 执行情况时
 *
 * 后续可通过 upload_report 工具上传到 S3。
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  ReportFactV1,
  Phase,
  validateReportFact,
  computeQualitySignals,
} from "./report-schema.js";
import { renderReportHtml } from "./report-template.js";

export const GENERATE_REPORT_VERSION = "v1.0.0";

export interface GenerateReportArgs {
  /** 报告场景（枚举），如 issue-analysis-resolution */
  scenario: string;
  /** 任务标识（如 Zmind issue ID: PR337540） */
  task_identifier: string;
  /** Skill 名 */
  skill_name: string;
  /** 业务总结 */
  business_summary: {
    title: string;
    conclusion: string;
    details?: Record<string, unknown>;
    risks?: Array<{ level: string; description: string; mitigation?: string }>;
  };
  /** 执行阶段列表 */
  phases: Phase[];
  /** 关联产出物（可选） */
  artifacts?: Array<{ type: string; value: string; label?: string; metadata?: Record<string, unknown> }>;
  /** 最终状态（可选，若不填则从 phases 状态推断） */
  final_status?: "completed" | "partial" | "aborted" | "gate_blocked" | "failed";
  /** hook_metrics（可选，若有 hook 触发记录传入） */
  hook_metrics?: {
    hooks_triggered?: number;
    hooks_blocked?: number;
    hook_names?: string[];
  };
  /** 输出目录（默认 <cwd>/report-output） */
  output_dir?: string;
  /** 执行开始时间（可选，ISO 8601） */
  started_at?: string;
}

export interface GenerateReportResult {
  ok: boolean;
  report_id: string;
  json_path: string;
  html_path: string;
  fact_size_bytes: number;
  html_size_bytes: number;
  validation_errors: string[];
  duration_seconds?: number;
}

/**
 * 从 phases 状态自动推断 final_status
 */
function inferFinalStatus(phases: Phase[]): ReportFactV1["workflow_execution"]["final_status"] {
  if (phases.length === 0) return "aborted";
  if (phases.some((p) => p.status === "aborted")) return "aborted";
  if (phases.some((p) => p.status === "gate_blocked")) return "gate_blocked";
  const anySkipped = phases.some((p) => p.status === "skipped");
  const allCompleted = phases.every((p) => p.status === "completed" || p.status === "skipped");
  if (allCompleted && anySkipped) return "partial";
  if (allCompleted) return "completed";
  return "partial";
}

/**
 * 生成 report_id：{scenario}-{task_identifier}
 * 只保留 [a-z0-9-] 且首尾非 -
 */
function buildReportId(scenario: string, taskId: string): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  return `${norm(scenario)}-${norm(taskId)}`;
}

/**
 * 主入口：生成 JSON + HTML，落盘。
 * 校验失败仍尝试落盘（错误信息返回），供人工排查。
 */
export async function generateReport(args: GenerateReportArgs): Promise<GenerateReportResult> {
  const startedTs = args.started_at ? new Date(args.started_at).getTime() : Date.now();
  const now = new Date();
  const endedAt = now.toISOString();
  const durationSeconds = Math.max(0, (now.getTime() - startedTs) / 1000);

  const reportId = buildReportId(args.scenario, args.task_identifier);

  // 自动计算 quality_signals（可被 hook_metrics 补充）
  const qualitySignals = computeQualitySignals(args.phases);
  if (args.hook_metrics) {
    qualitySignals.hook_metrics = args.hook_metrics;
  }

  // 组装 fact
  const finalStatus = args.final_status ?? inferFinalStatus(args.phases);
  const fact: ReportFactV1 = {
    report_id: reportId,
    meta: {
      scenario: args.scenario as ReportFactV1["meta"]["scenario"],
      task_identifier: args.task_identifier,
      generated_at: endedAt,
      generator_version: GENERATE_REPORT_VERSION,
      generator_source: "knowledge-mcp-server.generate_report",
    },
    business_summary: {
      title: args.business_summary.title,
      conclusion: args.business_summary.conclusion,
      details: args.business_summary.details ?? {},
      risks: (args.business_summary.risks ?? []) as ReportFactV1["business_summary"]["risks"],
    },
    workflow_execution: {
      skill_name: args.skill_name,
      started_at: args.started_at,
      ended_at: endedAt,
      duration_seconds: durationSeconds,
      final_status: finalStatus,
      phases: args.phases,
    },
    quality_signals: qualitySignals,
    ...(args.artifacts && args.artifacts.length > 0
      ? { artifacts: args.artifacts as ReportFactV1["artifacts"] }
      : {}),
  };

  // 校验（失败不 throw，只记录）
  const validationErrors = validateReportFact(fact);

  // 落盘
  const outputRoot = args.output_dir ?? path.resolve(process.cwd(), "report-output");
  const issueDir = path.join(outputRoot, args.task_identifier);
  await fs.mkdir(issueDir, { recursive: true });

  const jsonPath = path.join(issueDir, `${reportId}-report-fact-v1.json`);
  const htmlPath = path.join(issueDir, `${reportId}-report-v1.html`);

  const jsonContent = JSON.stringify(fact, null, 2);
  await fs.writeFile(jsonPath, jsonContent + "\n", "utf8");

  const htmlContent = renderReportHtml(fact);
  await fs.writeFile(htmlPath, htmlContent, "utf8");

  return {
    ok: validationErrors.length === 0,
    report_id: reportId,
    json_path: jsonPath,
    html_path: htmlPath,
    fact_size_bytes: Buffer.byteLength(jsonContent, "utf8"),
    html_size_bytes: Buffer.byteLength(htmlContent, "utf8"),
    validation_errors: validationErrors,
    duration_seconds: durationSeconds,
  };
}
