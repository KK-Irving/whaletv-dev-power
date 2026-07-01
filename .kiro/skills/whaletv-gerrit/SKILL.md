---
name: whaletv-gerrit
description: |
  Gerrit 单点操作（push、评论查询、单 change 处理）。TRIGGERS: "推送代码到 Gerrit" / "查 gerrit change I1234567" / "看这个 change 的评论" / "gerrit-ai 说了什么" / 用户显式提 "gerrit" / 提供 whale-gerrit.zeasn.com/c/... 链接. 提供 14 工具（5 读 + 9 写）：push_to_gerrit、search_changes、query_change、list_branches、get_change_comments、post_review 等。Use this skill for standalone Gerrit ops. Do NOT use for full PR resolution (use whaletv-pr-cr) or for CP tasks (use whaletv-cherry-pick).
---

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

进入 `code-review-handling` steering 描述的 6 阶段流程，对每条 unresolved 评论做**封闭三态**评估（`ACCEPT` / `REJECT` / `ACK`），仅 ACCEPT 实做代码修改 + push 新 patch set，最后单次 `submit_review_reply` 提交全部回复。

简化版决策树：

```
get_unresolved_threads({ change_id, author_id_filter: 1000192 })
    ↓
逐条评估（含读现场代码 + 严重梯度判定）
    ↓
🔴 CHECKPOINT：Developer 审阅评估表
    ↓
ACCEPT → 改代码 → git add -p → push 新 patch set → 回复模板含 file+line+diff
REJECT → 不改代码 → 回复模板含 evidence
ACK    → 不改代码 → 建 Zmind follow-up → 回复模板含 follow-up Issue → unresolved=true 保留
    ↓
submit_review_reply 单次原子提交所有回复
    ↓
get_unresolved_threads 验证：unresolved 计数 == ACK 数
```

**关键约束**：
- ACCEPT 必须先 push 新 patch set 再回复（否则是假闭环）
- ACK 保留 unresolved=true（不允许 unresolved=false 把 follow-up 隐藏）
- CRITICAL 评论 AI 不可自主决定，Developer 必须逐条审

**详细评估算法、回复模板、Don't 黑名单见 `code-review-handling.md`**。

**预期输出**: 所有评论按三态处理；Web UI unresolved 计数 == ACK 数；新 patch set 已 push 含实际修复
**错误处理**: IF 评估歧义 / 修复冲突 / push 失败 / reply 失败，按 `code-review-handling.md` 章节 ⑩ 处理

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
