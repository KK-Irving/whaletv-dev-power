---
title: Critical Rules
domain: Rules
level: common
inclusion: always
last_updated: 2026-07-01
---

# Critical Rules — MUST NOT 硬约束

这些规则源自真实事故。**无条件遵守，不受上下文长度或对话轮次影响**。每条 MUST NOT 都有对应的 Hook 拦截（第二层防护）与用户确认门（第三层防护）。

## MUST NOT（硬禁止 —— 违反将阻断执行）

### 不使用 sudo
- MUST NOT 使用 `sudo` 除非用户明确授权
- 开发操作不需要 root 权限；使用 sudo 通常意味着操作方向有误
- **对应 Hook**：`hooks/block-sudo.json`

### 不推 MP 保护分支
- MUST NOT push 到 `*_mp` / `*_v3_mp` 分支（release 保护分支）除非用户明确授权
- 即使用户在之前对话里说过"以后不用确认"，MP 分支**每次 push 仍需单独确认**
- **对应 Hook**：`hooks/block-mp-push.json`
- **对应 push_to_gerrit 规则**：`gerrit-mcp-server v1.1.0` 内置 MP 分支 `/^_mp$/i` 硬拦截

### 不用 git add . / -A / --all / *
- MUST NOT 用全量暂存命令 —— 文件可能含无关变更（调试代码、临时修改、其他 Issue 改动）
- **正确流程**：`git diff` → 逐 hunk 审阅 → `git add -p` → `git diff --cached` 展示给用户 → 用户确认 → commit
- 不确定是否属于当前任务 → **询问用户**
- **对应 Hook**：`hooks/block-git-add-all.json`

### 不在根目录 / 家目录搜索
- MUST NOT 在 `/` 或 `~/` 直接执行 `find` / `grep` / `rg`
- **正确做法**：先切换到具体子目录，再搜索
- **对应 Hook**：`hooks/block-root-search.json`

### 不写入 /tmp
- MUST NOT 用重定向（`>` / `>>`）写入 `/tmp/`
- 系统会清理 /tmp；多用户环境权限冲突风险高
- **替代**：使用 `~/tmp/` 或 workspace 内的 `.workspace/` 子目录
- **对应 Hook**：`hooks/block-tmp-write.json`

### 不搜索 out/ 和 prebuilts/
- MUST NOT 对 `out/` / `prebuilts/` 执行 `find` / `grep` / `ls -R`
- 这些目录体积巨大（50GB+ 编译输出、30GB+ 预编译工具链）；搜索会导致严重性能问题
- **替代**：`git grep` 自动排除未跟踪目录，或指定 `frameworks/` / `vendor/` / `packages/` 等业务路径
- **对应 Hook**：`hooks/block-out-search.json`

### 不批量复制 out/ 和 prebuilts/
- MUST NOT 对 `out/` / `prebuilts/` 执行 `rsync` / `cp -r`
- 这些目录批量复制会消耗大量磁盘和时间
- **对应 Hook**：`hooks/block-bulk-copy-out.json`

### 不猜测 target version
- **BringUp 例外**：用户明确说 BringUp，或 Issue 标题含 "BringUp" 时用 BringUp 格式，无需版本号
- Zmind Issue **有** `target_version` → 直接使用
- Zmind Issue **无** `target_version`（且非 BringUp）→ MUST NOT 猜测或从分支名推断 → **询问用户**
- 不接受 `<TBD>` / `<unknown>` / `master` 之类的占位符凑数

### 不用 git commit --amend -m 重写整段消息
- MUST NOT 用 `git commit --amend -m 'full new message'`
- `-m` 会重写整条 commit message，触发 commit-msg hook 生成新 Change-Id，Gerrit 会当成全新 change
- **正确做法**：`git commit --amend`（不带 `-m`），只在编辑器里改需要改的部分，保留原有 `Change-Id:` 行

### 不本地 cherry-pick 后 push 到别的分支
- MUST NOT 在本地 cherry-pick 后 push 到另一个分支
- **正确做法**：使用 Gerrit REST API `cherry_pick_change` 工具（`gerrit-mcp-server` v1.1.0 提供）
- Gerrit REST cherry-pick 保留 CP 关系链，本地 CP 会断链

### 不用写操作探测 Zmind
- MUST NOT 用 `add_comment` / `update_issue` 试探 Issue 是否存在
- 会污染 Issue 历史，可能触发用户通知
- **正确做法**：`get_issue` 读，完整读完 journals + attachments 再动作

### 不在 workspace 外直接写文件
- Kiro IDE 安全限制：AI 只能编辑当前 workspace 内的文件
- MUST NOT 尝试直接写 `~/.kiro/settings/mcp.json` 或 `~/.ai/whaletv.yaml` —— 会被 Kiro 拒绝
- **正确做法**：让用户在终端跑 `node scripts/setup-creds.mjs` / `whaletv-credentials.mjs` / `refresh-auth.*`；AI 只负责收集凭据 + 给出命令

## 强制人审的 GATE 场景

以下场景必须暂停等待用户明确确认词回复才能继续。**AI 不得依据"以前用户说过没关系"跳过**。

接受的确认词（大小写不敏感、去首尾空白后）：`{confirm, yes, y, ok, 确认, 继续}`

| GATE 场景 | 展示内容 | 触发条件 |
|---|---|---|
| 方案选择 | 多方案列表 + 优缺点 | 存在 ≥ 2 个可行方案 |
| git diff 确认 | `git diff` 完整输出 | 代码修改完成、暂存前 |
| git push 确认 | commit message 全文 + 目标分支 + 变更文件 | 任何 push 操作前 |
| MP 分支二次确认 | 目标分支名 + ⚠️ 警告 | Branch_Detector 识别到 `/_mp$/i` |
| cherry-pick 确认 | CP 计划表格 + 影响范围 | 批量 CP 前 |
| 跨代码库操作 | 目标仓库范围 + 操作计划 | 涉及多个 codebase |

模糊回复（如"差不多吧"、"应该可以"、"就这样"）**一律视为未确认**。
