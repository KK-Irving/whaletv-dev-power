/**
 * Reviewer / Code-Review 标签管理工具 (SSH 通道)。
 *
 * 实现：
 *   - addReviewer:    `gerrit set-reviewers --add <user> <change>`
 *   - removeReviewer: `gerrit set-reviewers --remove <user> <change>`
 *   - setReviewLabel: `gerrit review --label <NAME>=<VALUE> <change,patchset>`
 *
 * 实证（2026-06，change 114401）：
 *   - set-reviewers --add will.huang@zeasn.com 114401  → 静默退出 0
 *   - 通过 `gerrit query --all-reviewers` 验证 will.huang 出现在 allReviewers 列表
 *   - --remove 同样工作正常
 *
 * 输入校验：
 *   - reviewer 非空（trim 后长度 > 0）
 *   - label 非空、value 必须是 [-2, +2] 整数（Property 13）
 *
 * 错误处理：
 *   - SSH 子进程错误统一映射到 StructuredError（由 ssh-client.ts 处理）
 *   - 错误消息保留 change_id / reviewer / label（Property 5，由 wrapToolHandler 注入）
 */

import { sshGerritPlain } from "../ssh-client.js";
import { StructuredError } from "../errors.js";

// =============================================================================
// 内部辅助
// =============================================================================

function escapeIdentifier(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    throw new StructuredError("internal_error", "标识符不可为空");
  }
  if (/[\s`"'\\]/.test(trimmed)) {
    throw new StructuredError(
      "internal_error",
      `标识符包含非法字符: ${trimmed}`,
    );
  }
  return trimmed;
}

/**
 * 取 change 的 currentPatchSet.number；setReviewLabel 用。
 * 不复用 query.ts 的 queryChange 避免循环依赖。
 */
async function resolveCurrentPatchSet(changeId: string): Promise<number> {
  const { sshGerritJson } = await import("../ssh-client.js");
  const { rows } = await sshGerritJson<{ currentPatchSet?: { number?: number } }>([
    "gerrit",
    "query",
    "--format=JSON",
    "--current-patch-set",
    `change:${escapeIdentifier(changeId)}`,
  ]);
  if (rows.length === 0) {
    throw new StructuredError(
      "not_found",
      `Change 不存在或不可见: change_id=${changeId}`,
      404,
    );
  }
  const ps = rows[0].currentPatchSet?.number;
  if (typeof ps !== "number" || !Number.isFinite(ps) || ps <= 0) {
    throw new StructuredError(
      "internal_error",
      `Change ${changeId} 缺少 currentPatchSet.number`,
    );
  }
  return ps;
}

// =============================================================================
// 1. addReviewer
// =============================================================================

/**
 * 向 Change 添加一名 Reviewer（SSH 通道）。
 *
 * @param args.reviewer email / username / numeric account-id（Gerrit 任一形式接受）
 *
 * @throws StructuredError("internal_error") reviewer 为空或仅含空白
 * @throws StructuredError(...)              SSH 错误透传（permission_denied / not_found 等）
 */
export async function addReviewer(args: {
  change_id: string;
  reviewer: string;
}): Promise<{ ok: true; change_id: string; reviewer: string }> {
  if (typeof args.reviewer !== "string" || args.reviewer.trim().length === 0) {
    throw new StructuredError("internal_error", "Reviewer 标识符不可为空");
  }

  await sshGerritPlain([
    "gerrit",
    "set-reviewers",
    "--add",
    args.reviewer.trim(),
    escapeIdentifier(args.change_id),
  ]);

  return {
    ok: true,
    change_id: args.change_id,
    reviewer: args.reviewer.trim(),
  };
}

// =============================================================================
// 2. removeReviewer
// =============================================================================

/**
 * 从 Change 移除一名 Reviewer（SSH 通道）。
 *
 * @throws StructuredError("internal_error") reviewer 为空或仅含空白
 * @throws StructuredError(...)              SSH 错误透传
 */
export async function removeReviewer(args: {
  change_id: string;
  reviewer: string;
}): Promise<{ ok: true; change_id: string; reviewer: string }> {
  if (typeof args.reviewer !== "string" || args.reviewer.trim().length === 0) {
    throw new StructuredError("internal_error", "Reviewer 标识符不可为空");
  }

  await sshGerritPlain([
    "gerrit",
    "set-reviewers",
    "--remove",
    args.reviewer.trim(),
    escapeIdentifier(args.change_id),
  ]);

  return {
    ok: true,
    change_id: args.change_id,
    reviewer: args.reviewer.trim(),
  };
}

// =============================================================================
// 3. setReviewLabel
// =============================================================================

/**
 * 在 Change 当前 patch set 上设置一个标签值（如 Code-Review / Verified）。
 *
 * SSH 命令：`gerrit review --label NAME=VALUE <change,patchset>`
 *
 * 注意：SSH 不接受 "current" 作为 patchset 占位符，必须用具体数字；
 * 因此本函数会先调用 query 拿到 currentPatchSet.number。
 *
 * @throws StructuredError("internal_error") label 为空 / value 超范围
 * @throws StructuredError(...)              SSH 错误透传（permission_denied 等）
 */
export async function setReviewLabel(args: {
  change_id: string;
  label: string;
  value: number;
}): Promise<{ ok: true; change_id: string; label: string; value: number; patch_set: number }> {
  // 标签值范围（Property 13）
  if (!Number.isInteger(args.value) || args.value < -2 || args.value > 2) {
    throw new StructuredError(
      "internal_error",
      `标签值超出 -2 至 +2 范围: ${args.value}`,
    );
  }

  // 标签名非空 + 不含空格 / `=` 等可能破坏 SSH 参数的字符
  if (typeof args.label !== "string" || args.label.trim().length === 0) {
    throw new StructuredError("internal_error", "标签名不可为空");
  }
  const labelTrimmed = args.label.trim();
  if (/[\s=`"'\\]/.test(labelTrimmed)) {
    throw new StructuredError(
      "internal_error",
      `标签名包含非法字符（不允许空格、=、引号、反引号、反斜杠）: ${labelTrimmed}`,
    );
  }

  const patchSet = await resolveCurrentPatchSet(args.change_id);

  await sshGerritPlain([
    "gerrit",
    "review",
    "--label",
    `${labelTrimmed}=${args.value}`,
    `${escapeIdentifier(args.change_id)},${patchSet}`,
  ]);

  return {
    ok: true,
    change_id: args.change_id,
    label: labelTrimmed,
    value: args.value,
    patch_set: patchSet,
  };
}
