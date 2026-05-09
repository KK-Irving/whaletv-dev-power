# PR/CR 处理工作流

## 触发场景

用户请求处理 PR/CR Issue（如"帮我处理 PR #XXXXX"、"处理下这个 CR"）

## 前置条件

- Zmind MCP Server 可用（`ZMIND_API_KEY` 已配置）
- 当前目录为 AOSP 源码目录（包含 `.repo` 或典型子目录如 `frameworks/`、`packages/`）
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

**AI 动作**: 使用 `git grep` 搜索相关代码，读取文件获取上下文
```bash
# 搜索类名
git grep -n "class TargetClass" -- "*.java" "*.kt"
# 搜索方法
git grep -n "methodName" -- "*.java" "*.kt"
# 搜索字符串常量
git grep -rn "CONSTANT_NAME" -- "*.java" "*.xml"
```
**预期输出**: 定位到需要修改的文件和代码位置
**错误处理**: IF `git grep` 未找到结果，THEN 使用 `search_code` 或 `search_symbol` 进行 OpenGrok 远程搜索作为补充

### ④ 修改代码

**AI 动作**: 根据分析结果修改代码，确保修改符合问题需求
**预期输出**: 完成代码修改
**错误处理**: IF 修改涉及多个文件且逻辑复杂，THEN 逐步修改并解释每处变更的目的

---

### 👤 用户确认点：代码变更确认

**展示内容**: 执行 `git diff` 展示完整变更内容
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

**AI 动作**: 按以下格式规范生成 Commit Message

```
[版本号][类型][whaletv][Zmind#ID]简述

[what]具体做了什么修改
[why]为什么需要这个修改
[how]如何实现的（技术方案简述）
[test]如何验证（测试方法）
[impact]影响范围
```

**格式说明**:
- **版本号**: 从 Issue 的 `target_version` 字段获取。IF target_version 为空，THEN 询问用户指定版本号
- **类型**: 取值限定为 `bugfix` | `feature` | `refactor` | `hotfix` 之一
- **whaletv**: 固定标识
- **Zmind#ID**: 当前处理的 Issue ID
- **简述**: 一句话概括修改内容

**预期输出**: 符合格式规范的完整 Commit Message
**错误处理**: IF 无法确定类型，THEN 根据 Issue tracker 类型推断（Bug→bugfix, Feature→feature），不确定时询问用户

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

**AI 动作**: 执行 commit 并使用 `gerritpush` 命令推送到 Gerrit
```bash
git commit
gerritpush
```
**预期输出**: 代码成功推送到 Gerrit，获得 Change 链接
**错误处理**: IF push 被拒绝或失败，THEN 报告错误信息（如权限不足、冲突等），等待用户指示是否重试或终止

### ⑧ 处理 Gerrit-AI 评论

**AI 动作**: 逐条读取 Gerrit-AI 生成的评论，结合代码变更上下文判断是否采纳：
- **采纳**: 修复代码 → 回复修复说明 → 标记 resolved
- **不采纳**: 回复不采纳理由 → 标记 resolved

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
2. **等待指示**: 等待用户决定是重试当前步骤、跳过、还是终止整个流程
3. **不自动重试**: 不在未经用户确认的情况下自动重试失败的操作

## 关键约束

| 约束 | 说明 |
|------|------|
| `git add -p` | 必须使用 `-p` 参数进行 hunk 级别暂存，禁止 `git add .` 或 `git add -A` |
| 用户确认点不可跳过 | 两个 👤 确认点（diff 确认、push 确认）必须等待用户明确确认后才继续 |
| 版本号来源 | 从 Issue 的 `target_version` 获取，如果没有则询问用户，不得自行推断 |
| 步骤顺序 | 9 个步骤必须严格按顺序执行，不可跳过或乱序 |
