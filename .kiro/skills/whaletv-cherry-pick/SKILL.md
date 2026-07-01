---
name: whaletv-cherry-pick
description: |
  Gerrit change 跨分支 Cherry-Pick 同步。TRIGGERS: "把 #332669 cp 到 mp" / "cherry-pick I1234567 到 mp" / "同步这个修复到所有 mp" / "cp 到 master" / "反向 CP". 使用 Gerrit REST API cherry_pick_change 自动执行（禁止本地 CP + push），list_branches 发现 MP 分支，批量 CP + 分类汇报 + 更新 Zmind. Use this skill for any cross-branch CP task. Do NOT use for merging PRs or for one-off Gerrit ops on a single change (use whaletv-gerrit for those).
---

# Cherry-Pick 同步工作流

## 触发场景

用户请求将修复同步到 MP 分支，例如：
- "把 #332669 cp 到 mp"
- "cherry-pick I1234567 到 mp 分支"
- "同步这个修复到所有 mp"

## 前置条件

- Zmind MCP Server 可用（`ZMIND_API_KEY` 已配置）
- Gerrit MCP Server 可用（`GERRIT_URL` / `GERRIT_USERNAME` / `GERRIT_HTTP_PASSWORD` 已配置）
- Gerrit API 可达（用户环境可访问 Gerrit 服务）
- 用户提供了 Zmind Issue ID 或 Gerrit Change 号

## 工作流步骤

### ① 获取 Issue/Change 信息

**AI 动作**：从用户提供的 Zmind Issue ID 或 Gerrit Change 号开始，获取完整信息。

- IF 用户提供 Zmind Issue ID → 调用 `get_issue` 获取 Issue 详情，从评论或描述中提取关联的 Gerrit Change 号
- IF 用户提供 Gerrit Change 号 → 通过 Gerrit API 查询 Change 详情，获取关联的 Issue ID

**预期输出**：确认 Issue/Change 的基本信息（标题、状态、所属 project）

**错误处理**：IF `get_issue` 调用失败或 Change 号无效 → 报告错误，等待用户提供正确的 ID

---

### ② 搜索 master 已合入的 Changes

**AI 动作**: 调用 Gerrit MCP Server 的 `search_changes` 工具检索已合入 master 的源 Change。

**查询模板**（按情况选用）：
- 通过 Issue ID：`message:Zmind#<issue_id> status:merged branch:master`
- 通过 Topic：`topic:<topic> status:merged branch:master`
- 通过 Change-Id：`change:<change_id> status:merged`
- 通过 Hashtag：`hashtag:<tag> status:merged branch:master`

**输出**：源 Change 列表（每条含 change_id、project、subject、web_url、zmind_issue_ids）

**错误处理**：IF `search_changes` 返回空 THEN 询问 Developer 是否调整查询条件

---

### ③ 发现目标 MP 分支

**AI 动作**: 对步骤 ② 中发现的每个唯一 project，调用 `list_branches(project, pattern="_mp")` 获取 MP 分支列表。

**预期输出**：每个 project 下匹配 `_mp` pattern 的活跃分支列表（含 ref、name、HEAD revision）

**错误处理**：
- IF 某 project 返回空数组（含 note `no branches matched the pattern`）→ 在 CP 计划中标注"该 project 无 MP 分支"
- IF `list_branches` 调用失败 → 跳过该 project，继续后续；最终汇报失败的 project 列表

---

### ④ 展示 CP 计划表格

**AI 动作**：以表格形式向用户展示完整的 Cherry-Pick 计划。

**展示格式**：

```
| 源 Change | 源 Project | 目标分支 |
|-----------|-----------|---------|
| I1234567  | frameworks/base | os10_mp, os10_3_mp |
| I2345678  | packages/apps/TvSettings | os10_mp |
```

**预期输出**：清晰的 CP 计划表格，包含所有源 Change、所属 project 和目标分支

---

### 👤 用户确认点：确认 CP 计划

**展示内容**：完整的 CP 计划表格 + CP 总数统计（共 X 个 Change 需要 CP 到 Y 个分支，合计 Z 次 CP 操作）

**等待条件**：等待用户输入明确的确认指令后才开始执行。用户可以：
- 确认执行全部计划
- 修改计划（移除某些分支或 Change）
- 取消操作

IF 用户拒绝 → 终止流程，不执行任何 CP 操作

---

### ⑤ 触发 Cherry-Pick（v1.0.0 自动执行）

> ✨ **v1.0.0 升级**：cherry-pick 改走 REST API 自动执行，**不再需要 Developer 在 Web UI 手动操作**。
> Gerrit 服务端实现保留 `cherryPickOfChange` 元数据，追溯链路完整，比客户端 git fetch+cherry-pick+push 方案更安全。

**AI 动作**：

1. 按 CP 计划表格**逐项**调用 Gerrit MCP Server 的 `cherry_pick_change` 工具，工具自动执行并返回三态：
   - `{ status: "success", change_id, change_number, web_url }` — 成功创建新 Change
   - `{ status: "skipped_already_merged", reason }` — 目标分支已包含等效提交
   - `{ status: "conflict", conflicting_files: [...], reason }` — 自动合并冲突，需要人工 resolve

2. AI 实时汇报每条结果：
   ```
   ✅ I1234567 → os10_mp: 新 Change https://gerrit.xxx/c/12345
   ✅ I1234567 → os10_3_mp: 新 Change https://gerrit.xxx/c/12346
   ⏭️ I7654321 → os10_mp: 跳过（已合并）
   ❌ I2345678 → os10_mp: 冲突（src/Foo.java, src/Bar.java）— 请手动 cherry-pick 并 resolve
   ```

3. 对 conflict 的 Change：
   - 展示冲突文件列表给 Developer
   - 询问是否需要 AI 协助本地手动 cherry-pick + resolve
   - 不强制完成，可跳过等 Developer 单独处理

**关键约束**：
- ✅ AI 在 CP 计划已经 Developer 确认（步骤 👤）后才进入本步骤
- ✅ 每条 CP 实时汇报，便于 Developer 看到失败立即停下
- ❌ 不要在 conflict 时盲目继续后续 CP（应停下询问）

**预期输出**：批量 CP 执行完毕；每条 success / skipped / conflict 结果汇总到步骤 ⑥

**错误处理**：IF Gerrit API 整体不可达 THEN 中断后续 CP，汇报已完成与未完成的项目；IF 某条 CP 报 401/403 THEN 提示 Developer 检查权限

---

### ⑥ 分类汇报结果

**AI 动作**：对所有 CP 结果进行分类汇报。

**结果分类**：

- ✅ **成功**：CP 成功创建，附带新 Change 链接
  ```
  ✅ I1234567 → os10_mp: 成功 (新 Change: https://gerrit.xxx/c/12345)
  ```

- ⏭️ **跳过**：目标分支已包含等效提交，无需重复 CP
  ```
  ⏭️ I1234567 → os10_3_mp: 跳过（目标分支已包含等效提交）
  ```

- ❌ **冲突**：CP 产生冲突，需人工处理
  ```
  ❌ I2345678 → os10_mp: 冲突
     冲突文件:
     - src/com/example/Foo.java
     - res/values/strings.xml
     需要人工处理：请手动 cherry-pick 并解决冲突
  ```

**预期输出**：分类汇总表，包含成功/跳过/冲突的统计数字

---

### ⑦ 更新 Zmind 评论

**AI 动作**：调用 `add_comment` 在对应 Zmind Issue 下添加 CP 执行摘要评论。

**评论内容格式**：

```
Cherry-Pick 执行摘要：

| 源 Change | 目标分支 | 状态 | 新 Change |
|-----------|---------|------|-----------|
| I1234567  | os10_mp | ✅ 成功 | https://gerrit.xxx/c/12345 |
| I1234567  | os10_3_mp | ⏭️ 跳过 | - |
| I2345678  | os10_mp | ❌ 冲突 | 需人工处理 |

统计：成功 1 / 跳过 1 / 冲突 1
```

**预期输出**：Zmind 评论添加成功确认

**错误处理**：IF `add_comment` 调用失败 → 报告错误，将评论内容展示给用户以便手动添加

## 错误恢复

### 全局错误处理策略

1. **Gerrit API 调用失败**：立即停止后续 CP 操作，汇报已完成和未完成的项目，等待用户决定是否重试
2. **Zmind API 调用失败**：不影响 CP 执行结果，将评论内容展示给用户以便手动操作
3. **网络超时**：报告超时的具体操作，等待用户指示（重试或跳过）
4. **记录经验**：所有失败都记录到 `.learnings/ERRORS.md`，CP 冲突记录到 `.learnings/LEARNINGS.md`（分类 `insight`，便于后续同项目 CP 时参考）

### 错误汇报格式

```
⚠️ CP 执行中断

已完成：
- ✅ I1234567 → os10_mp: 成功

未完成：
- ⏳ I1234567 → os10_3_mp: 未执行
- ⏳ I2345678 → os10_mp: 未执行

失败原因：Gerrit API 返回 HTTP 500

请选择：
1. 重试未完成的 CP
2. 终止操作
```
