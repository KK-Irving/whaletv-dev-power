/**
 * Report Fact v1 Schema — WhaleTV Skill Execution Report
 *
 * generate_report / upload_report 工具的 TypeScript 类型定义（同时作为文档 + runtime 验证）。
 *
 * 设计原则：
 *   - JSON 是 source of truth，HTML 由 JSON 渲染
 *   - business_summary.details 承载业务结果（治理归因用）
 *   - workflow_execution.phases[] 承载执行过程细节
 *   - quality_signals 承载 agent 治理指标
 *
 * 参考：agentengineeringframework/common/skills/skill-report-generate/schema/report-fact-v1.schema.json
 */

// =============================================================================
// 枚举定义（治理用，不可自由填写）
// =============================================================================

export const SCENARIO_VALUES = [
  "issue-analysis-resolution",
  "bug-analysis",
  "pr-cr-resolution",
  "cherry-pick-sync",
  "commit-message-generation",
  "code-review-handling",
  "knowledge-base-maintenance",
] as const;
export type Scenario = (typeof SCENARIO_VALUES)[number];

export const FINAL_STATUS_VALUES = [
  "completed",
  "partial",
  "aborted",
  "gate_blocked",
  "failed",
] as const;
export type FinalStatus = (typeof FINAL_STATUS_VALUES)[number];

export const PHASE_STATUS_VALUES = [
  "completed",
  "skipped",
  "aborted",
  "gate_blocked",
] as const;
export type PhaseStatus = (typeof PHASE_STATUS_VALUES)[number];

/** 问题现象分类（症状） */
export const SYMPTOM_TYPES = [
  "crash",
  "functional_error",
  "performance",
  "display_artifact",
  "audio_video_sync",
  "playback_failure",
  "network_error",
  "compatibility",
  "data_error",
  "security",
  "config_error",
  "build_packaging",
  "other",
] as const;
export type SymptomType = (typeof SYMPTOM_TYPES)[number];

/** 根因分类 */
export const ROOT_CAUSE_CATEGORIES = [
  "logic_bug",
  "null_reference",
  "race_condition",
  "memory_issue",
  "resource_leak",
  "api_misuse",
  "third_party_defect",
  "hardware_driver",
  "config_missing",
  "network_protocol",
  "data_format",
  "environment",
  "requirement_gap",
  "unknown",
] as const;
export type RootCauseCategory = (typeof ROOT_CAUSE_CATEGORIES)[number];

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const ARTIFACT_TYPES = [
  "gerrit_change_url",
  "commit_hash",
  "zmind_issue_url",
  "attachment_path",
  "log_slice",
  "modified_file",
  "generated_document",
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

// =============================================================================
// 结构定义
// =============================================================================

export interface Risk {
  level: RiskLevel;
  description: string;
  mitigation?: string;
}

export interface ToolCall {
  name: string; // 如 "zmind.get_issue"
  call_count?: number;
  success?: boolean;
}

export interface Gate {
  waiting_for: string;
  passed?: boolean;
}

export interface Phase {
  phase_id: string; // "step-1" / "phase-analysis"
  name: string; // 阶段名（如"获取 Issue"）
  status: PhaseStatus;
  summary: string; // 自然语言描述
  outputs?: Record<string, unknown>;
  gate?: Gate;
  rules_hit?: string[]; // 命中的 steering rules
  tools?: ToolCall[];
  knowledge_used?: string[];
  risks?: string[];
}

export interface Meta {
  scenario: Scenario;
  task_identifier: string;
  generated_at: string; // ISO 8601
  generator_version: string; // v1.0.0
  generator_source?: string;
}

export interface BusinessDetails {
  issue_status?: string;
  symptom_type?: SymptomType;
  root_cause_category?: RootCauseCategory;
  [k: string]: unknown;
}

export interface BusinessSummary {
  title: string;
  conclusion: string;
  details: BusinessDetails;
  risks?: Risk[];
}

export interface WorkflowExecution {
  skill_name: string;
  started_at?: string;
  ended_at?: string;
  duration_seconds?: number;
  final_status?: FinalStatus;
  phases: Phase[];
}

export interface QualitySignals {
  phase_metrics?: {
    total_phases?: number;
    completed_phases?: number;
    skipped_phases?: number;
    aborted_phases?: number;
  };
  gate_metrics?: {
    total_gates?: number;
    gates_passed?: number;
    gates_blocked?: number;
  };
  hook_metrics?: {
    hooks_triggered?: number;
    hooks_blocked?: number;
    hook_names?: string[];
  };
  tool_call_count?: number;
}

export interface Artifact {
  type: ArtifactType;
  value: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface ReportFactV1 {
  report_id: string; // {scenario}-{task_identifier}
  meta: Meta;
  business_summary: BusinessSummary;
  workflow_execution: WorkflowExecution;
  quality_signals: QualitySignals;
  artifacts?: Artifact[];
}

// =============================================================================
// Runtime 验证（简单，不引 zod 避免额外依赖 —— knowledge-mcp 已有 zod 也可以用）
// =============================================================================

/**
 * 校验 fact 数据是否符合 ReportFactV1。返回错误数组（空则说明合法）。
 */
export function validateReportFact(fact: unknown): string[] {
  const errors: string[] = [];

  if (typeof fact !== "object" || fact === null) {
    return ["fact must be an object"];
  }
  const f = fact as Record<string, unknown>;

  // report_id
  if (typeof f.report_id !== "string" || !f.report_id) {
    errors.push("report_id must be a non-empty string");
  }

  // meta
  if (typeof f.meta !== "object" || f.meta === null) {
    errors.push("meta must be an object");
  } else {
    const m = f.meta as Record<string, unknown>;
    if (!SCENARIO_VALUES.includes(m.scenario as Scenario)) {
      errors.push(
        `meta.scenario must be one of ${SCENARIO_VALUES.join(", ")}, got: ${m.scenario}`,
      );
    }
    if (typeof m.task_identifier !== "string" || !m.task_identifier) {
      errors.push("meta.task_identifier must be a non-empty string");
    }
    if (typeof m.generated_at !== "string" || !m.generated_at) {
      errors.push("meta.generated_at must be a non-empty ISO-8601 string");
    }
    if (typeof m.generator_version !== "string") {
      errors.push("meta.generator_version must be a string like v1.0.0");
    }
  }

  // business_summary
  if (typeof f.business_summary !== "object" || f.business_summary === null) {
    errors.push("business_summary must be an object");
  } else {
    const bs = f.business_summary as Record<string, unknown>;
    if (typeof bs.title !== "string") errors.push("business_summary.title must be string");
    if (typeof bs.conclusion !== "string") errors.push("business_summary.conclusion must be string");
    if (typeof bs.details !== "object" || bs.details === null) {
      errors.push("business_summary.details must be an object");
    } else {
      const d = bs.details as BusinessDetails;
      if (d.symptom_type !== undefined && !SYMPTOM_TYPES.includes(d.symptom_type)) {
        errors.push(
          `business_summary.details.symptom_type must be one of ${SYMPTOM_TYPES.join(", ")}, got: ${d.symptom_type}`,
        );
      }
      if (
        d.root_cause_category !== undefined &&
        !ROOT_CAUSE_CATEGORIES.includes(d.root_cause_category)
      ) {
        errors.push(
          `business_summary.details.root_cause_category must be one of ${ROOT_CAUSE_CATEGORIES.join(", ")}, got: ${d.root_cause_category}`,
        );
      }
    }
  }

  // workflow_execution
  if (typeof f.workflow_execution !== "object" || f.workflow_execution === null) {
    errors.push("workflow_execution must be an object");
  } else {
    const we = f.workflow_execution as Record<string, unknown>;
    if (typeof we.skill_name !== "string") errors.push("workflow_execution.skill_name must be string");
    if (!Array.isArray(we.phases)) {
      errors.push("workflow_execution.phases must be an array");
    } else {
      we.phases.forEach((phase, i) => {
        if (typeof phase !== "object" || phase === null) {
          errors.push(`workflow_execution.phases[${i}] must be an object`);
          return;
        }
        const p = phase as Record<string, unknown>;
        if (typeof p.phase_id !== "string") errors.push(`phases[${i}].phase_id must be string`);
        if (typeof p.name !== "string") errors.push(`phases[${i}].name must be string`);
        if (!PHASE_STATUS_VALUES.includes(p.status as PhaseStatus)) {
          errors.push(
            `phases[${i}].status must be one of ${PHASE_STATUS_VALUES.join(", ")}, got: ${p.status}`,
          );
        }
        if (typeof p.summary !== "string") errors.push(`phases[${i}].summary must be string`);
      });
    }
  }

  // quality_signals
  if (typeof f.quality_signals !== "object" || f.quality_signals === null) {
    errors.push("quality_signals must be an object");
  }

  return errors;
}

/**
 * 从 phases[] 自动计算 quality_signals（可选，帮助调用者省事）
 */
export function computeQualitySignals(phases: Phase[]): QualitySignals {
  const gates = phases.filter((p) => p.gate !== undefined);
  const gatesPassed = gates.filter((p) => p.gate?.passed === true).length;
  const gatesBlocked = gates.filter((p) => p.gate?.passed === false).length;

  const allTools = phases.flatMap((p) => p.tools ?? []);
  const toolCallCount = allTools.reduce((sum, t) => sum + (t.call_count ?? 1), 0);

  return {
    phase_metrics: {
      total_phases: phases.length,
      completed_phases: phases.filter((p) => p.status === "completed").length,
      skipped_phases: phases.filter((p) => p.status === "skipped").length,
      aborted_phases: phases.filter((p) => p.status === "aborted").length,
    },
    gate_metrics: {
      total_gates: gates.length,
      gates_passed: gatesPassed,
      gates_blocked: gatesBlocked,
    },
    tool_call_count: toolCallCount,
  };
}
