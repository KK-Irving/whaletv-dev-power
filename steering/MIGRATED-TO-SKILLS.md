---
title: v2 → v3 Migration Index
domain: Reference
inclusion: manual
last_updated: 2026-07-01
---

# v2 → v3 迁移索引：steering → skill

v3 起，workflow 类内容从 `steering/*.md` 迁移到 `.kiro/skills/whaletv-<name>/SKILL.md`，采用 **description-driven triggering**（Kiro 根据 SKILL.md 头部 YAML front-matter 的 description 语义匹配自动激活，无需用户显式引用）。

## 保留在 steering/ 的（`inclusion: always`）

| 文件 | 定位 |
|---|---|
| `critical-rules.md` | MUST NOT 硬约束（v3 新，取代散落在各 workflow 里的重复规则） |
| `conventions.md` | SHOULD-level 建议（v3 新） |
| `execution-rules.md` | 术语与元规则（v3 新） |
| `module-path-map.md` | D4/X5/STB 模块路径地图（工具数据，保留） |
| `safety-rules.md` | 三层防护体系描述 + 7 个 hook 索引（保留） |

## 迁移到 skill 的（`.kiro/skills/whaletv-<name>/SKILL.md`）

| 原 steering 文件 | 新 skill 位置 |
|---|---|
| `steering/onboarding.md` | `.kiro/skills/whaletv-onboarding/SKILL.md` |
| `steering/auth-refresh.md` | `.kiro/skills/whaletv-auth-refresh/SKILL.md` |
| `steering/pr-cr-workflow.md` | `.kiro/skills/whaletv-pr-cr/SKILL.md` |
| `steering/cherry-pick-workflow.md` | `.kiro/skills/whaletv-cherry-pick/SKILL.md` |
| `steering/bug-analysis-workflow.md` | `.kiro/skills/whaletv-bug-analysis/SKILL.md` |
| `steering/gerrit-workflow.md` | `.kiro/skills/whaletv-gerrit/SKILL.md` |
| `steering/code-review-handling.md` | `.kiro/skills/whaletv-code-review/SKILL.md` |
| `steering/commit-message-workflow.md` | `.kiro/skills/whaletv-commit-message/SKILL.md` |
| `steering/knowledge-base-workflow.md` | `.kiro/skills/whaletv-knowledge-base/SKILL.md` |
| `steering/local-code-guide.md` | `.kiro/skills/whaletv-local-code/SKILL.md` |

## 迁移原则

1. **内容一字不改**：只在 SKILL.md 头部加 YAML front-matter（name + description）
2. **description 语义化**：包含 TRIGGERS（用户可能说的原话）+ When to Use + When NOT to Use，让 Kiro 语义匹配更准
3. **skill 自动触发**：不需要 `#skill-name` 引用；用户自然语言里出现 TRIGGERS 关键词即可
4. **原 steering 引用不断链**：迁移脚本已删除原文件；其他文档（POWER.md / README.md）中的引用后续在 Task 4.5 更新

## 老用户升级路径

如果用户从 v2 升级到 v3：

1. `git pull` 拉最新代码
2. `node scripts/deploy.mjs`（部署 5 份 steering + 7 个 hook + 10 个 skill 到 `~/.kiro/`）
3. `node scripts/whaletv-credentials.mjs migrate`（一次性从 mcp.json 迁移凭据到 SoT）
4. 重启 Kiro

老 workflow 的自然语言触发依然工作（description 匹配的关键词与 v2 一致），因此用户无需改变使用习惯。
