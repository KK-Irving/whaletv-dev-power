/**
 * cherry_pick_change 工具：SSH 通道下退化为 manual_required 引导。
 *
 * 背景：
 *   - Gerrit SSH 命令集（截至 3.6.0）**没有** cherry-pick 子命令；REST 才有。
 *   - 客户端层用 `git fetch refs/changes/.../X && git cherry-pick && git push refs/for/<dest>`
 *     在技术上能做，但会丢失 `cherryPickOfChange` 元数据，破坏 Gerrit 的 cherry-pick 链路追溯。
 *   - cherry-pick 误推到错分支属于高风险操作，本工具决定**不做客户端自动化**。
 *
 * 行为：
 *   - 任何调用都返回 `{ status: "manual_required", web_url, instructions }`
 *   - 不抛异常（除非环境变量缺失，由配置层抛 config_error）
 *   - 上层 cherry-pick-workflow steering 在收到该响应时，把 web_url 给 Developer，
 *     提示 Developer 在 Gerrit Web UI 上点击 "Cherry-Pick" 按钮完成
 */

import { requireSshConfig } from "../ssh-client.js";
import type { CherryPickResult } from "../types.js";

/** SSH 通道下扩展 CherryPickResult 加入 manual_required 状态。 */
export type CherryPickResultManual =
  | CherryPickResult
  | {
      status: "manual_required";
      web_url: string;
      destination_branch: string;
      change_id: string;
      reason: string;
      instructions: string[];
    };

/**
 * cherry_pick_change：SSH 通道下返回 manual_required 引导。
 *
 * @returns 始终返回 manual_required 状态的 CherryPickResultManual。
 *
 * @throws StructuredError("config_error") 当 SSH 必需环境变量缺失（由 requireSshConfig 抛出）
 */
export async function cherryPickChange(args: {
  change_id: string;
  destination_branch: string;
  message?: string;
}): Promise<CherryPickResultManual> {
  // 校验 SSH 配置（即使本工具不执行 SSH 命令，也要保证 mcp.json 配置完整）
  // 这样上层在调用本工具前能感知配置问题
  const cfg = requireSshConfig();
  const baseUrl = (process.env.GERRIT_URL ?? "").replace(/\/+$/, "");

  // 拼接 Gerrit Web UI 上的 Change 入口；若 GERRIT_URL 未配置则只返回 host
  const webUrl =
    baseUrl.length > 0
      ? `${baseUrl}/q/${encodeURIComponent(args.change_id)}`
      : `https://${cfg.host}/q/${encodeURIComponent(args.change_id)}`;

  return {
    status: "manual_required",
    web_url: webUrl,
    destination_branch: args.destination_branch,
    change_id: args.change_id,
    reason:
      "Gerrit SSH 通道不支持 cherry-pick 操作（gerrit SSH 命令集无 cherry-pick 子命令），且本环境的 nginx 双层认证使 REST API 不可用。Cherry-pick 误操作风险高（容易误推到错分支），故仅支持 Developer 在 Web UI 手动完成。",
    instructions: [
      `1. 打开 Change 页面: ${webUrl}`,
      `2. 点击页面右上角菜单 (⋮) → "Cherry pick"`,
      `3. 在弹出对话框的 "Branch" 字段输入: ${args.destination_branch}`,
      args.message
        ? `4. （可选）在 "Cherry Pick Commit Message" 字段填入自定义 message: ${args.message}`
        : `4. （可选）保留默认 commit message，或编辑后再提交`,
      `5. 点击 "CHERRY PICK" 按钮完成`,
      `6. 完成后请告诉 AI 操作结果（success / conflict / 已存在），AI 会继续后续工作流`,
    ],
  };
}

/** 保留导出供潜在 PBT；SSH 模式下并不实际使用。 */
export function classifyConflict(text: string): "skipped_already_merged" | "conflict" {
  if (typeof text !== "string" || text.length === 0) return "conflict";
  const lower = text.toLowerCase();
  const phrases = ["already exists", "no changes were made", "nothing to cherry pick"];
  for (const p of phrases) {
    if (lower.includes(p)) return "skipped_already_merged";
  }
  return "conflict";
}

export function parseConflictingFiles(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => /\.[a-zA-Z0-9]+$/.test(l))
    .filter((l) => !/^(cherry|conflict|merge|error)/i.test(l));
}
