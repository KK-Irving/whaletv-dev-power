---
title: Conventions
domain: Rules
level: common
inclusion: always
last_updated: 2026-07-01
---

# Conventions — SHOULD-level 建议

强烈推荐；偏离需理由。这些约定让团队协作更顺畅、AI 输出更可预测。

## 代码搜索优先级（5 档策略）

**目的**：把"全仓 grep"压缩成"指定路径 grep"，避免命中大量噪音。详见 skill `whaletv-local-code` + `steering/codebase-taxonomy.md`（平台差异） + `steering/module-path-map.md`（具体路径）。

1. **模块路径地图查表**（最高优先级，零成本）：从关键词命中 `steering/module-path-map.md` 里的路径前缀
2. **本地知识库 `search_local`**（毫秒级）：hybrid 检索历史 PR / 修复 commit / 设计文档
3. **`git grep` 限定路径**：`git grep -n "Keyword" -- "<path-prefix>/**"`（比 rg 快 100x 且自动排除未跟踪目录）
4. **已知路径直读**：读文件拿完整上下文（比搜索片段更准确）
5. **OpenGrok `search_code` / `search_symbol`**（最低优先级）：本地无结果时降级

**关键**：`git grep` 优于 `rg`
- 大型代码库上 `rg` ~40s / `git grep` ~0.4s
- `git grep` 天然排除 `out/` / `prebuilts/` 等未跟踪目录

## 通信优先级

**总原则**：能用工具查的自己查；需要决策才问用户。

### 自己查 ✅
- 用户提代码片段 → 先 `git grep` / `search_local`，找不到再问
- 从日志/堆栈抽出文件路径行号 → 直接定位
- 分析问题时按 issue 性质推断涉及模块 → 主动定位
- Zmind 附件 triage：先按大小 + 类型判断，narrate 决策而非请求许可
  - 代码问题足够（明确功能 bug、feature 请求，无 crash）→ 完全不下载日志
  - Crash / ANR / NPE / 偶现 → 需要日志
  - 文件 < 5 MB → 下载 + 直读
  - 文件 ≥ 5 MB → 下载 + grep-only（`grep -n <keyword>` 定位锚点，`sed -n 'A,Bp'` 抽 ≤ 200 行切片）；**不**对整个文件用 read Line mode
- GitHub / GitLab 链接（`github.zeasn.com`）→ 主动访问，看 commit / 文件

### 问用户 ✅
- 方案选择（多个实现路径，选哪个？）
- 需求澄清（描述模糊 —— 具体想要什么？）
- Zmind target_version 缺失（且非 BringUp）
- 目标分支 Branch_Detector 五级都失败 → sentinel `ASK_DEVELOPER`

## Issue 识别符约定

**"PR/CR/Task + 数字" = Zmind issue，不是 Gerrit change**。

- `PR338387` / `CR 12345` / `Task#456` → 先调 `get_issue`
- 只有当用户明确说 "gerrit" / "gerrit change" / "code review"，或提供 `whale-gerrit.zeasn.com/c/...` 链接时，才用 Gerrit 工具
- 裸的数字（如 `338387`）不带前缀 → 有歧义，**先问用户**再调工具

## 代码规范

- 修改代码后，**列出所有变更文件 + 简要摘要**
- 关键代码段加注释；关键方法加 doc comment；**注释用英文**
- 修改点加日志便于后续调试
- 代码修改完执行**自审**：无调试代码残留、无硬编码、变更范围精确

## 文档语言

- 生成的文档（分析报告、总结等）**默认中文**，除非用户明确要求英文
- **代码注释英文**

## 图表标准

- **ASCII 图（默认）**：会话内解释流程、调用链、逻辑
- **Mermaid / PlantUML**：输出到 .md 文件或报告时用（可渲染）

## 三态确认词

接受的肯定确认词集合（去首尾空白后大小写不敏感）：

```
{ "confirm", "yes", "y", "ok", "确认", "继续" }
```

其他所有回复（含空、`no`、`否`、模糊回复如"差不多吧"）**一律视为未确认**。

## Commit Message 格式

严格五段式（详见 skill `whaletv-commit-message`）：

```
[版本号][类型][whaletv][Zmind#ID]简述
[what]具体做了什么修改
[why]为什么需要这个修改
[how]如何实现的（技术方案简述）
[test]如何验证（测试方法）
[impact]影响范围
```

- 首行 ≤ 100 字符；简述 ≤ 50 字符
- 类型限定：`bugfix` / `feature` / `refactor` / `hotfix`（非 Bug/Feature 必须询问用户）
- 版本号从 `issue.target_version` 取；缺失时询问用户，**不**推断

## Kiro Power namespace 兼容（v3 起自动）

v3 起 MCP server 通过 `sot-loader` 从 `~/.ai/whaletv.yaml` 读凭据，与 mcp.json 里的 key 前缀（`power-whaletv-dev-power-*`、`powers.mcpServers.*`）**无关**，无需 substring 匹配。

老的 `refresh-auth.mjs` / `setup-creds.mjs` 仍保留 mcp.json 双写作兜底，但优先级已让位给 SoT。

## 报告与治理

- Skill 执行完的报告（如 bug-analysis / pr-cr）建议记录到 `.learnings/LEARNINGS.md` 或 `report-output/`
- 错误记录到 `.learnings/ERRORS.md`（含分类：correction / knowledge_gap / best_practice）
- 知识缺口（关键词未命中 module-path-map）记录到 `.learnings/LEARNINGS.md`（分类 `knowledge_gap`），用于补充地图
