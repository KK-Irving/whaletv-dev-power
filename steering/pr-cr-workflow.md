# PR/CR 处理工作流

## 触发场景

用户请求处理 PR/CR Issue（如"帮我处理 PR #XXXXX"、"处理下这个 CR"）

## 前置条件

- Zmind MCP Server 可用（`ZMIND_API_KEY` 已配置）
- 当前目录为源码目录（包含 `.repo` 或典型子目录如 `frameworks/`、`packages/`）
- git 工作区干净（`git status` 无未提交变更）

## 工作流步骤

### ① 获取 Issue

**AI 动作**: 调用 `get_issue` 获取 Issue 详情，包括标题、描述、评论历史、附件、关联 Issue、target_version 等
**预期输出**: Issue 完整信息，特别关注 subject、description、journals（评论）、fixed_version（版本号）
**错误处理**: IF `get_issue` 调用失败，THEN 报告错误信息，等待用户指示

### ② 分析问题

**AI 动作**: 阅读 Issue 描述、评论历史，理解需求或 Bug 的具体内容，明确修改目标
**预期输出**: 对问题的理解总结，包括：
- 问题现象或需求描述
- 预期的修改方向
- 涉及的模块/组件
**错误处理**: IF 信息不足以理解问题，THEN 向用户询问补充信息

### ③ 定位代码

**AI 动作**: 按照 local-code-guide 的搜索策略优先级定位代码（① git grep → ② 读取已知路径 → ③ OpenGrok）
**预期输出**: 定位到需要修改的文件和代码位置
**错误处理**: IF `git grep` 未找到结果，THEN 使用 `search_code` 或 `search_symbol` 进行 OpenGrok 远程搜索作为补充

### ④ 修改代码

**AI 动作**: 根据分析结果修改代码，确保修改符合问题需求

**Brainstorming 触发**: IF 修改涉及多个文件或存在多种方案，THEN 先执行 brainstorming（列出方案、等待用户选择）后再动手修改

**预期输出**: 完成代码修改
**错误处理**: IF 修改涉及多个文件且逻辑复杂，THEN 逐步修改并解释每处变更的目的

---

### ④.5 代码自审

**AI 动作**: 修改完成后自动执行代码自审检查（参见 code-review skill）：
- 确认无调试代码残留
- 确认无硬编码
- 确认变更范围精确（无无关修改）
- IF 发现可自动修复的问题（如多余空行），直接修复
- IF 发现阻塞问题，修复后重新自审

**预期输出**: 自审通过，展示简要结果
**错误处理**: IF 自审发现无法自动修复的问题，THEN 向用户说明并请求指示

---

### 👤 用户确认点：代码变更确认

**展示内容**: 执行 `git diff` 展示完整变更内容 + 自审结果摘要
```bash
git diff
```
**等待条件**: 等待用户输入明确的确认指令后才继续执行后续步骤。IF 用户要求修改，THEN 返回步骤 ④ 调整代码后重新展示 diff

---

### ⑤ 精确暂存

**AI 动作**: 使用 `git add -p` 进行 hunk 级别的精确暂存，仅暂存与当前 Issue 相关的代码变更，避免提交无关改动
```bash
git add -p
```
**预期输出**: 仅相关变更被暂存到 staging area
**错误处理**: IF 暂存过程中发现无关变更混入，THEN 使用 `git reset HEAD <file>` 取消暂存并重新选择

**关键约束**: git add 必须使用 `-p` 参数，禁止使用 `git add .` 或 `git add -A`

### ⑥ 生成 Commit Message

**AI 动作**: 调用 Commit_Message_Generator 生成完整的五段式 commit message。

**输入**：
- `git diff --staged` 的暂存区 diff
- 当前 Zmind Issue 详情（已在步骤 ① 获取）
- Branch_Detector 识别的目标推送分支（在步骤 ⑦ 推送前完成识别）

**输出**：符合团队规范的完整五段式 Commit Message（首行 `[版本号][类型][whaletv][Zmind#ID]简述` + `[what]` `[why]` `[how]` `[test]` `[impact]` 五段）

**详细行为契约**：参见 `commit-message-workflow.md`（涵盖字段生成算法、元数据补全规则、format/parse round-trip 契约）

**预期输出**: 符合格式规范的完整 Commit Message
**错误处理**: IF 任一字段生成失败或为空，THEN 不展示完整 commit message，按 `commit-message-workflow.md` 章节 ⑩ 错误恢复处理；IF 无 Issue 上下文，THEN 拒绝生成并提示 Developer 关联 Issue

#### 格式快速参考

> 详细规则与行为契约请加载 steering: `commit-message-workflow`

```
[版本号][类型][whaletv][Zmind#ID]简述
[what]具体做了什么修改
[why]为什么需要这个修改
[how]如何实现的（技术方案简述）
[test]如何验证（测试方法）
[impact]影响范围
```

| 字段 | 说明 |
|------|------|
| **版本号** | 从 Issue 的 `target_version` 字段获取。IF target_version 为空，THEN 询问用户指定版本号 |
| **类型** | 取值限定为 `bugfix` \| `feature` \| `refactor` \| `hotfix` 之一 |
| **whaletv** | 固定标识 |
| **Zmind#ID** | 当前处理的 Issue ID |
| **简述** | 一句话概括修改内容 |

---

### 👤 用户确认点：推送确认

**展示内容**: 展示将要推送的 commit 信息和目标分支
```
即将推送:
- Commit Message: [完整 commit message]
- 目标分支: [当前分支名]
```
**等待条件**: 等待用户输入明确的确认指令后才执行推送。IF 用户要求修改 commit message，THEN 返回步骤 ⑥ 重新生成

---

### ⑦ 推送 Gerrit

**AI 动作**: 严格按以下顺序执行：
1. 调用 Branch_Detector 识别目标远程分支并向 Developer 展示识别来源（详见 `commit-message-workflow.md` ③ 章节）
2. 等待 Developer 确认目标分支（含 MP 分支的 ⚠️ 警告与二次确认）
3. 执行 `git commit`（基于步骤 ⑥ 生成的 commit message）
4. 调用 Gerrit MCP Server 的 `push_to_gerrit` 工具（参数：`cwd`、`target_branch`、可选 `reviewers` / `wip` / `topic`）
5. 处理工具返回结果：
   - `{ ok: true, change_url }` → 展示 Change URL 给 Developer
   - `{ ok: true, change_url_unavailable: true }` → 展示原始 stderr 给 Developer
   - `{ ok: false, error_type: "mp_branch_push_blocked" }` → 提示 Developer MP 分支不能自动推送
   - `{ ok: false, error_type: "git_push_failed" }` → 报告 stderr 与 exit_code，等待 Developer 指示

**禁止使用**：外部 `gerritpush` shell 命令（已被 Gerrit_Push_Tool 替代）

**预期输出**: 代码成功推送到 Gerrit 并展示 Change URL
**错误处理**: IF 工具返回 `ok: false`，THEN 根据 `error_type` 分类汇报，等待 Developer 指示是否重试或终止

### ⑧ 处理 Gerrit-AI 评论

**AI 动作**: 通过 Gerrit MCP Server 的工具处理评论：
1. 调用 `get_change_comments(change_id)` 拉取所有评论（已按时间升序排序）
2. 逐条分析评论内容判断是否采纳
3. 根据评论类型选择回复工具：
   - **inline 评论**（含 path、line）→ 使用 `reply_inline_comment(change_id, parent_comment_id, message, unresolved=false)`（同时回复并 mark resolved）
   - **review 级评论**（path/line 为空） → 使用 `add_review_comment(change_id, message)`，再单独调用 `mark_comment_resolved(change_id, comment_id)`
4. 采纳：修复代码 → 回复修复说明 → 标记 resolved
5. 不采纳：回复不采纳理由 → 标记 resolved

**关键约束**：每条评论必须 resolved（无论采纳或不采纳）

**预期输出**: 所有 Gerrit-AI 评论已处理完毕，每条评论都有回复且标记为 resolved
**错误处理**: IF 无法判断某条评论是否应采纳，THEN 向用户展示评论内容并请求指示

### ⑨ 更新 Zmind

**AI 动作**: 调用 `add_comment` 在对应 Issue 下添加评论，评论内容包含：
- 本次修改摘要
- Gerrit Change 链接

评论格式示例：
```
已提交修复：
- 修改内容：[简要描述]
- Gerrit Change: [Change 链接]
- 分支：[目标分支]
```
**预期输出**: Zmind Issue 评论更新成功
**错误处理**: IF `add_comment` 调用失败，THEN 报告错误信息，等待用户指示

## 错误恢复

任一步骤执行失败时（如 Zmind API 调用失败、Gerrit push 被拒绝、或 git 操作报错）：

1. **报告失败**: 明确告知用户失败发生在哪个步骤，以及具体的错误信息
2. **记录经验**: 将错误记录到 `.learnings/ERRORS.md`（参见 self-improving skill）
3. **等待指示**: 等待用户决定是重试当前步骤、跳过、还是终止整个流程
4. **不自动重试**: 不在未经用户确认的情况下自动重试失败的操作

## 关键约束

| 约束 | 说明 |
|------|------|
| `git add -p` | 必须使用 `-p` 参数进行 hunk 级别暂存，禁止 `git add .` 或 `git add -A` |
| 用户确认点不可跳过 | 两个 👤 确认点（diff 确认、push 确认）必须等待用户明确确认后才继续 |
| 版本号来源 | 从 Issue 的 `target_version` 获取，如果没有则询问用户，不得自行推断 |
| 步骤顺序 | 9 个步骤必须严格按顺序执行，不可跳过或乱序 |


## 进化集成

- 错误记录：所有步骤失败记录到 `.learnings/ERRORS.md`
- 经验沉淀：成功完成后，将关键修改经验记录到 `.learnings/LEARNINGS.md`（分类 `insight`）
- 能力缺口：IF 工作流中遇到未覆盖的场景，THEN 通过 find-skill 检查是否需要新能力
- 流程优化：IF 用户反馈某步骤不够高效，THEN 记录到 `.learnings/FEATURE_REQUESTS.md` 并建议优化
