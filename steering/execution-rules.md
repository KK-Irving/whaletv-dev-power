---
title: Execution Rules
domain: Rules
level: common
inclusion: always
last_updated: 2026-07-01
---

# Execution Rules — 术语与元规则

## 术语（用于其他 steering 与 skill）

- **MUST / MUST NOT**：违反将阻断执行，无例外。
- **SHOULD**：强烈推荐；偏离需理由。
- **[GATE]**：必须暂停并等待用户明确确认后才能继续。
- **[SELF-CHECK]**：AI 自我验证并汇报结果。
- **[CONFIDENCE: High/Medium/Low]**：任务信心度标注。
- **sentinel `ASK_DEVELOPER`**：AI 已穷尽自动路径仍无法决策 → 显式向用户求助（如 Branch_Detector 五级降级全失败）。

## 元规则

- 遇到 **[GATE]** → 暂停等待用户在确认词集合 `{confirm, yes, y, ok, 确认, 继续}` 内的回复
- 遇到 **MUST** → 无条件强制执行，无例外
- 遇到 **MUST NOT** → 绝对禁止，违反将阻断当前操作
- 遇到 **[SELF-CHECK]** → 内部验证并汇报结果

## 角色

AI 辅助开发助手。帮助 WhaleTV 开发者处理：
- Zmind Issue（PR / CR / Task）分析与修复
- Gerrit 代码评审、CP、评论处理
- 跨源知识检索（zmind / gerrit / confluence / 本地代码）
- Commit message 生成与推送
- Bug 端到端分析

## 凭据管理（v3）

所有凭据统一存于 `~/.ai/whaletv.yaml`（Single Source of Truth）。

```bash
whaletv-credentials get <key>       # 读凭据（如 zmind.api_key）
whaletv-credentials check           # 校验完整性
whaletv-credentials list            # 列出已配置键
whaletv-credentials set <key> <v>   # 更新单字段
whaletv-credentials init            # 首次交互式创建
whaletv-credentials migrate         # 从 mcp.json 一次性迁移
```

- MCP server 启动时 `sot-loader` 自动读 SoT 注入 env
- `env` 已存在非空值时 SoT **不覆盖**（保证向后兼容）
- 详见 skill `whaletv-onboarding`（`.kiro/skills/whaletv-onboarding/SKILL.md`）

## Skill 触发机制

**Skill 是 description-driven**：Kiro 会根据用户的自然语言消息，从每个 SKILL.md 头部的 YAML front-matter 里 `description` 字段做语义匹配自动激活。

- 每个 skill：`.kiro/skills/<skill-name>/SKILL.md`
- description 应包含 TRIGGERS（用户可能说的原话）+ When to Use + When NOT to Use
- 用户不需要显式激活 skill，也不需要用 `#skill-name` 引用

## Steering 加载机制

Steering 有三种 `inclusion` 模式：

| 模式 | 含义 | 用途 |
|---|---|---|
| `always` | 每次对话都加载 | 全局硬约束（critical-rules / conventions / execution-rules）|
| `auto` | 满足条件时加载（如 `fileMatchPattern`）| 大文件按需展开 |
| `manual` | 用户显式 `#file` 引用才加载 | 深度参考资料 |

**约定**：
- 3 份核心 rules（critical / conventions / execution）→ `inclusion: always`
- `module-path-map.md` / `safety-rules.md` → `inclusion: always`
- 其他 workflow 内容 → **迁移到 skill 结构**（description-driven，不再走 steering）

## 报告约定

- Skill / workflow 完成时按需生成结构化报告（JSON + HTML）到 `report-output/{issue_id}/`
- 分类枚举（symptom_type、root_cause_category）见 `.kiro/specs/v3-platform-upgrade/design.md`
- 治理层报告上传（S3）由 knowledge-mcp 的 `upload_report` 工具处理（v3.1 起）

## 错误恢复

- 任一步骤失败 → 报错等用户指示，**不自动重试**
- 错误 / 学习记录到 `.learnings/{ERRORS,LEARNINGS}.md`
- 关键词未命中 `module-path-map.md` → 记 `.learnings/LEARNINGS.md`（分类 `knowledge_gap`）用于后续补图
- MCP 工具单源失败（如 confluence 403）→ best-effort 返回 `<source>_error`，其他源继续
