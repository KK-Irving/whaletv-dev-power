/**
 * 公共类型定义。
 *
 * 与 design.md "Data Models" 章节一致，覆盖：
 *   - Gerrit MCP Server 工具的入参 / 出参类型（GerritChange、GerritBranch、GerritComment、CherryPickResult、PushResult）
 *   - Branch_Detector / Commit_Message_Generator 的概念性数据模型（BranchDetectionResult、CommitMessageFields）
 *   - 结构化错误对象的有线格式（StructuredErrorPayload、GerritErrorType）
 *
 * 本文件不依赖任何其他模块，是依赖图的最底层。
 */

// =============================================================================
// 错误模型
// =============================================================================

/**
 * 结构化错误的 error_type 封闭枚举。
 *
 * 此集合即 design.md Property 14 中要求 `withErrorHandling` 输出必属于的封闭集合，
 * 任何工具调用最终返回的 error_type 都必须落在这 9 个枚举值之一。
 */
export type GerritErrorType =
  | "auth_failed" //          HTTP 401
  | "permission_denied" //    HTTP 403
  | "not_found" //            HTTP 404
  | "conflict" //             HTTP 409（业务侧 cherry-pick 进一步细分 conflict / skipped_already_merged）
  | "gerrit_server_error" //  HTTP 5xx
  | "request_timeout" //      AbortController 触发
  | "network_error" //        DNS / TCP / fetch 抛出的非 Abort 错误
  | "config_error" //         缺失必需环境变量
  | "internal_error"; //      所有其他兜底（包括 throw "string"、throw null、未预期 JS 异常）

/**
 * MCP 工具响应中失败时返回的有线 JSON 结构。
 *
 * 通过 `withErrorHandling` 包装后会以 JSON.stringify 形式写入 MCP `text` content。
 */
export interface StructuredErrorPayload {
  error_type: GerritErrorType;
  message: string;
  http_status?: number;
  details?: unknown;
}

// =============================================================================
// Gerrit 实体模型
// =============================================================================

export interface GerritChange {
  /** project~branch~Change-Id 三元组（Gerrit 唯一标识）。 */
  id: string;
  /** 仅 Change-Id（如 `Ixxxxxxx`）。 */
  change_id: string;
  /** _number，Change 的数字编号。 */
  number: number;
  subject: string;
  status: "NEW" | "MERGED" | "ABANDONED";
  project: string;
  branch: string;
  topic?: string;
  owner: { name: string; email?: string };
  current_revision?: string;
  current_patch_set: number;
  /** 从 commit message 中以正则提取的 Zmind#ID 列表。 */
  zmind_issue_ids: number[];
  web_url: string;
}

export interface GerritBranch {
  /** 完整 ref，例如 `refs/heads/os10_mp`。 */
  ref: string;
  /** HEAD commit hash。 */
  revision: string;
  /** 去掉 `refs/heads/` 前缀后的分支名，例如 `os10_mp`。 */
  name: string;
}

export interface GerritComment {
  id: string;
  author: { name: string; email?: string };
  /** ISO 8601 时间字符串。 */
  created: string;
  message: string;
  unresolved: boolean;
  /** inline 评论的文件路径（review 级评论缺省）。 */
  path?: string;
  /** inline 评论的行号。 */
  line?: number;
  patch_set?: number;
  in_reply_to?: string;
}

// =============================================================================
// Cherry-Pick 三态结果
// =============================================================================

export type CherryPickStatus = "success" | "skipped_already_merged" | "conflict";

export type CherryPickResult =
  | {
      status: "success";
      change_id: string;
      change_number: number;
      web_url: string;
    }
  | {
      status: "skipped_already_merged";
      reason: string;
    }
  | {
      status: "conflict";
      conflicting_files: string[];
      reason?: string;
    };

// =============================================================================
// Push 结果
// =============================================================================

export type PushResult =
  | { ok: true; change_url: string; raw_stderr: string }
  | { ok: true; change_url_unavailable: true; raw_stderr: string }
  | {
      ok: false;
      error_type: "mp_branch_push_blocked" | "git_push_failed";
      message: string;
      exit_code?: number;
      stderr?: string;
    };

// =============================================================================
// Commit Message / Branch Detector 概念性模型
// =============================================================================

export interface CommitMessageFields {
  /** 版本号字符串，如 "5.0.10"。 */
  version: string;
  type: "bugfix" | "feature" | "refactor" | "hotfix";
  /** Zmind Issue 数字 ID。 */
  zmind_id: number;
  /** 简述（≤ 50 字符，由生成器约束）。 */
  subject: string;
  what: string;
  why: string;
  how: string;
  test: string;
  impact: string;
}

export type BranchDetectionSource =
  | "upstream" //            git rev-parse --abbrev-ref @{upstream}
  | "git_config" //          git config branch.<X>.merge
  | "gitreview" //           .gitreview defaultbranch
  | "gerrit_change_id" //    通过 query_change 反查
  | "developer_input"; //    询问 Developer

export interface BranchDetectionResult {
  target_branch: string;
  source: BranchDetectionSource;
  /** 是否匹配 *_mp 后缀（不区分大小写）。 */
  is_mp_branch: boolean;
}
