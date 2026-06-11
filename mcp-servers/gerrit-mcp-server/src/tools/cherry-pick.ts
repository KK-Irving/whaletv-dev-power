/**
 * cherry_pick_change 工具：通过 REST 自动执行 cherry-pick（v1.0.0）。
 *
 * v0.x 在 SSH 通道下退化为 manual_required 引导（SSH 命令集无 cherry-pick）。
 * v1.0.0 切回 REST 后，本工具升级为**自动执行**：
 *   POST /a/changes/{id}/revisions/{rev}/cherrypick
 *   Body: { destination: <branch>, message?: <override> }
 *
 * Gerrit 服务端语义：
 *   - 成功：自动创建一个新 Change（含 cherryPickOfChange 元数据，保留追溯链路）
 *           返回新 ChangeInfo
 *   - 冲突：返回 HTTP 409，body 含冲突文件信息
 *   - 已存在等效提交：返回 HTTP 409 with body "Cherry-pick already exists"
 *
 * 三态返回（保持与 v0.x 类型兼容）：
 *   - success：{ status: "success", change_id, change_number, web_url }
 *   - skipped_already_merged：{ status: "skipped_already_merged", reason }
 *   - conflict：{ status: "conflict", conflicting_files, reason? }
 *
 * 关键设计：
 *   - cherry-pick 是高风险操作，但 Gerrit REST 的实现保留 cherryPickOfChange 链路，
 *     不破坏追溯，比 git fetch + cherry-pick + push 客户端方案更安全
 *   - Web URL 仍包含在响应里，便于上层 cherry-pick-workflow 把链接展示给 Developer
 *   - 冲突时不抛异常，按 conflict 三态返回（不同于 not_found 等其他错误）
 */

import { gerritPost } from "../http-client.js";
import { StructuredError } from "../errors.js";
import type { CherryPickResult } from "../types.js";

// =============================================================================
// REST API 类型
// =============================================================================

interface ChangeInfo {
  id: string;
  project: string;
  branch: string;
  change_id: string;
  _number: number;
  subject: string;
  status: "NEW" | "MERGED" | "ABANDONED";
}

// =============================================================================
// 内部辅助
// =============================================================================

/**
 * 从 HTTP 409 响应文本判定冲突类别。
 */
function classifyConflict(text: string): "skipped_already_merged" | "conflict" {
  if (typeof text !== "string" || text.length === 0) return "conflict";
  const lower = text.toLowerCase();
  const phrases = [
    "already exists",
    "no changes were made",
    "nothing to cherry pick",
  ];
  for (const p of phrases) {
    if (lower.includes(p)) return "skipped_already_merged";
  }
  return "conflict";
}

/**
 * 从 HTTP 409 响应文本提取冲突文件列表。
 *
 * Gerrit 冲突响应通常形如：
 *   "Cherry pick failed; merge conflict in:\nfileA\nfileB"
 */
function parseConflictingFiles(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => /\.[a-zA-Z0-9]+$/.test(l) || l.includes("/"))
    .filter((l) => !/^(cherry|conflict|merge|error|fatal)/i.test(l));
}

/** 拼接 Change Web URL */
function buildWebUrl(info: ChangeInfo): string {
  const base = (process.env.GERRIT_URL ?? "").replace(/\/+$/, "");
  if (base.length > 0) {
    return `${base}/c/${encodeURI(info.project)}/+/${info._number}`;
  }
  return `/c/${encodeURI(info.project)}/+/${info._number}`;
}

// =============================================================================
// 主入口
// =============================================================================

/**
 * Cherry-pick 一个 Change 到目标分支（自动执行，REST 通道）。
 *
 * @param args.change_id          源 Change-Id / Change Number / 三元组
 * @param args.destination_branch 目标分支名（如 "os10_mp"）
 * @param args.message            可选 commit message 覆盖
 *
 * @returns 三态结果：success / skipped_already_merged / conflict
 *
 * @throws StructuredError("not_found") 源 Change 不存在
 * @throws StructuredError("permission_denied") 无 cherry-pick 权限
 * @throws StructuredError("conflict") 业务冲突 — 但 conflict 通常通过返回值表达，仅极端情况抛
 */
export async function cherryPickChange(args: {
  change_id: string;
  destination_branch: string;
  message?: string;
}): Promise<CherryPickResult> {
  // REST cherry-pick 端点要求 revision 参数；用 "current" 占位
  const path = `/changes/${encodeURIComponent(args.change_id)}/revisions/current/cherrypick`;
  const body: { destination: string; message?: string; allow_conflicts?: boolean } = {
    destination: args.destination_branch,
  };
  if (args.message) body.message = args.message;

  try {
    const result = await gerritPost<ChangeInfo>(path, body);
    return {
      status: "success",
      change_id: result.change_id,
      change_number: result._number,
      web_url: buildWebUrl(result),
    };
  } catch (err) {
    // http-client 会把 409 包装成 StructuredError(error_type="conflict")
    if (err instanceof StructuredError && err.error_type === "conflict") {
      // 从 details.response_body 提取冲突信息
      const details = err.details as { response_body?: string } | undefined;
      const body = details?.response_body ?? err.message;
      const status = classifyConflict(body);
      if (status === "skipped_already_merged") {
        return {
          status: "skipped_already_merged",
          reason: body.length > 0 ? body : "目标分支已包含等效提交",
        };
      }
      return {
        status: "conflict",
        conflicting_files: parseConflictingFiles(body),
        reason: body.length > 0 ? body : undefined,
      };
    }
    throw err;
  }
}
