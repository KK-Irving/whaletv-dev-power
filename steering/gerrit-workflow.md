# Gerrit 操作工作流

## 触发场景

代码推送和 Gerrit-AI 评论处理（如"推送代码到 Gerrit"、"处理 Gerrit 评论"）

## 前置条件

- 代码已 commit（`git status` 显示 working tree clean 或仅有已暂存的变更已提交）
- Gerrit MCP Server 可用（GERRIT_URL/USERNAME/HTTP_PASSWORD 已在 mcp.json 中配置）
- 当前目录为源码目录（包含 `.repo` 或典型子目录如 `frameworks/`、`packages/`）

## 工作流步骤

### ① 推送代码

**AI 动作**: 严格按以下顺序执行：
1. 调用 Branch_Detector（详见 commit-message-workflow.md ③ 章节）识别目标远程分支
2. 等待 Developer 确认目标分支（MP 分支需 ⚠️ 二次确认）
3. 调用 Gerrit MCP Server 的 `push_to_gerrit` 工具（参数：cwd、target_branch、reviewers?）
4. 解析返回结果：
   - 成功：展示 Change URL 给 Developer
   - MP 分支被拒：提示 Developer 通过 Steering 工作流显式确认后通过其他流程
   - 推送失败：报告 stderr 与 exit_code

**预期输出**：代码成功推送到 Gerrit，获得 Change URL（或拒绝原因）

**错误处理**：IF 推送失败 THEN 报告 error_type 与 stderr，等待 Developer 指示

**禁止使用**：外部 `gerritpush` shell 命令

### ② 轮询等待 Gerrit-AI 评论

**AI 动作**: 推送完成后，轮询调用 Gerrit MCP Server 的 `get_change_comments(change_id)` 等待 Gerrit-AI 生成评论。

**轮询逻辑**（保持原约束）：
- 第 1 次轮询：推送完成后等待 15 秒，调用 `get_change_comments` 查询
- 第 2 次轮询：IF 第 1 次无新评论 THEN 再等待 15 秒，调用 `get_change_comments` 查询
- 第 3 次轮询：IF 第 2 次无新评论 THEN 再等待 15 秒，调用 `get_change_comments` 查询

**关键约束**（保持不变）：
- 轮询间隔固定 15 秒
- 最多轮询 3 次

**预期输出**：获取到 Gerrit-AI 生成的新评论列表（按时间升序），或确认 3 次轮询后无新评论
**错误处理**: IF 轮询过程中 Gerrit API 调用失败，THEN 报告错误信息，等待用户指示

### ③ 评论处理

**AI 动作**: 根据轮询结果进行分支处理

---

**IF 3 次轮询后无评论**:

通知用户当前无 Gerrit-AI 评论，结束流程。

输出示例：
```
Gerrit-AI 暂无评论（已轮询 3 次，间隔 15 秒），流程结束。
如需后续处理评论，请稍后再次触发。
```

---

**IF 有评论**:

逐条分析 Gerrit-AI 评论，结合代码变更上下文判断是否采纳：

#### 采纳评论

1. **修复代码**: 根据评论建议修改对应代码
2. 执行代码自审（参见 code-review skill）确认修复无低级问题
3. **回复修复说明**: 调用工具：
   - **inline 评论** → `reply_inline_comment(change_id, parent_comment_id, message="已采纳，修复说明：[内容]", unresolved=false)` （同时回复并 mark resolved）
   - **review 级评论** → `add_review_comment(change_id, message)` 后调用 `mark_comment_resolved(change_id, comment_id)`

回复格式示例：
```
已采纳，修复说明：[具体修复内容描述]
```

#### 不采纳评论

1. **回复不采纳理由**: 调用工具：
   - **inline 评论** → `reply_inline_comment(change_id, parent_comment_id, message="不采纳，理由：[原因]", unresolved=false)`
   - **review 级评论** → `add_review_comment(change_id, message)` 后调用 `mark_comment_resolved(change_id, comment_id)`

回复格式示例：
```
不采纳，理由：[具体不采纳原因]
```

**预期输出**: 所有 Gerrit-AI 评论已逐条处理完毕，每条评论都有回复且标记为 resolved
**错误处理**: IF 无法判断某条评论是否应采纳，THEN 向用户展示评论内容并请求指示

## 错误恢复

任一步骤执行失败时：

1. **报告失败**: 明确告知用户失败发生在哪个步骤，以及具体的错误信息
2. **记录经验**: 将错误记录到 `.learnings/ERRORS.md`（参见 self-improving skill）
3. **等待指示**: 等待用户决定是重试当前步骤、跳过、还是终止整个流程
4. **不自动重试**: 不在未经用户确认的情况下自动重试失败的操作

## 关键约束

| 约束 | 说明 |
|------|------|
| 每条评论必须标记 resolved | 无论采纳还是不采纳，回复后都必须将评论标记为 resolved |
| 轮询间隔固定 15 秒 | 每次轮询之间等待 15 秒，不可缩短或延长 |
| 最多轮询 3 次 | 超过 3 次仍无评论则通知用户并结束，不继续等待 |
| Reviewer 自动添加 | 通过 `push_to_gerrit` 的 `reviewers` 参数传入 Reviewer 邮箱列表自动添加 |


## 进化集成

- 错误记录：所有失败记录到 `.learnings/ERRORS.md`
- 经验沉淀：Gerrit-AI 评论中有价值的建议记录到 `.learnings/LEARNINGS.md`（分类 `best_practice`）
- 能力缺口：IF 遇到无法处理的评论类型，THEN 通过 find-skill 检查是否需要新能力
