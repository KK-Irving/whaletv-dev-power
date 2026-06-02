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

### ⑤ 触发 Cherry-Pick（manual_required 引导）

> ⚠️ **本步骤已不再自动批量执行 CP**。
> 因 Gerrit SSH 命令集没有 cherry-pick 子命令、且目标环境的 nginx 双层认证使 REST 不可用，
> 加之 cherry-pick 是高风险操作（误推到错分支极易污染 MP 分支线），
> 工具固定返回 `status="manual_required"` + Web UI 链接，由 **Developer 在 Gerrit Web UI 手动完成**。

**AI 动作**：

1. 按 CP 计划表格**逐项**调用 Gerrit MCP Server 的 `cherry_pick_change` 工具，工具返回：
   ```json
   {
     "status": "manual_required",
     "web_url": "https://whale-gerrit.zeasn.com/q/<change_id>",
     "destination_branch": "<目标分支>",
     "change_id": "<源 Change>",
     "reason": "Gerrit SSH 通道不支持 cherry-pick 操作 ...",
     "instructions": [
       "1. 打开 Change 页面: <web_url>",
       "2. 点击页面右上角菜单 (⋮) → 'Cherry pick'",
       "3. 在弹出对话框的 'Branch' 字段输入: <目标分支>",
       "4. 保留默认 commit message，或编辑后再提交",
       "5. 点击 'CHERRY PICK' 按钮完成",
       "6. 完成后请告诉 AI 操作结果"
     ]
   }
   ```

2. AI 把每条 `manual_required` 的引导集中展示给 Developer，列表形式：
   ```
   📋 共 N 条 Cherry-Pick 需要 Developer 手动完成（Gerrit Web UI）：
   
   1. I1234567 → os10_mp:
      🔗 https://whale-gerrit.zeasn.com/q/I1234567
   
   2. I7654321 → os10_3_mp:
      🔗 https://whale-gerrit.zeasn.com/q/I7654321
   
   操作步骤（每条相同）：
      ① 打开链接 → ⋮ → "Cherry pick"
      ② Branch 字段填入对应目标分支
      ③ 点击 "CHERRY PICK" 按钮
   
   完成后请告诉我每条的结果（success / conflict / 已存在），我会继续后续工作流。
   ```

3. **等待** Developer 逐条回报结果，按以下三态收集：
   - `success` — Web UI 创建了新 Change，让 Developer 提供新 Change URL（用于 Zmind 评论）
   - `conflict` — Web UI 报告冲突，标记为待人工 resolve
   - `already_exists` / `skipped` — 目标分支已包含等效提交

**关键约束**：
- ❌ **不要**通过本地 `git fetch + cherry-pick + push` 自动化 CP（会丢失 `cherryPickOfChange` 元数据，破坏 Gerrit 的 cherry-pick 链路追溯）
- ❌ **不要**跳过 Developer 手动确认就假装 CP 完成（误操作风险高）
- ✅ AI 的角色是**引导**而非**执行**：把 Web URL + 步骤清晰列出，等 Developer 回报

**预期输出**：所有 CP 已被 Developer 在 Web UI 完成；AI 收集到每条结果（success / conflict / skipped）

**错误处理**：IF Developer 报告 conflict，THEN 询问是否需要 AI 协助本地手动 resolve（仍由 Developer 主导）；IF Developer 报告"目标分支不存在"，THEN 检查 list_branches 输出是否包含该分支

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
