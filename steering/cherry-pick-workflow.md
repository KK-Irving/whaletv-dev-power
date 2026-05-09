# Cherry-Pick 同步工作流

## 触发场景

用户请求将修复同步到 MP 分支，例如：
- "把 #332669 cp 到 mp"
- "cherry-pick I1234567 到 mp 分支"
- "同步这个修复到所有 mp"

## 前置条件

- Zmind MCP Server 可用（`ZMIND_API_KEY` 已配置）
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

**AI 动作**：通过 Gerrit API 查询与指定 Issue 关联的所有已合入 master 的 Change。

- 使用 Gerrit 搜索查询：`topic:<issue_id>` 或 `message:<issue_id>` + `status:merged` + `branch:master`
- 识别每个 Change 所属的 project

**预期输出**：已合入 master 的 Change 列表，包含 Change ID、project、subject

**错误处理**：IF Gerrit API 查询失败 → 报告错误并等待用户指示；IF 未找到已合入的 Change → 通知用户并终止流程

---

### ③ 发现目标 MP 分支

**AI 动作**：通过 Gerrit API 查询每个相关 project 中名称包含 `_mp` 后缀的活跃分支。

- 对步骤 ② 中发现的每个 project，查询其分支列表
- 筛选名称匹配 `*_mp` 模式的分支作为 CP 目标

**预期输出**：每个 project 对应的 MP 分支列表

**错误处理**：IF 某个 project 无 MP 分支 → 在计划表中标注"无 MP 分支"，继续处理其他 project

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

### ⑤ 批量执行 Cherry-Pick

**AI 动作**：通过 Gerrit API 逐个执行 Cherry-Pick 操作。

- 按计划表格顺序，对每个 (源 Change, 目标分支) 组合执行 CP
- 使用 Gerrit REST API 的 cherry-pick 端点
- 记录每次 CP 的执行结果

**预期输出**：每次 CP 操作的执行状态

**错误处理**：IF Gerrit API 调用失败 → 立即停止后续 CP 操作，转入步骤 ⑥ 汇报已完成和未完成项目

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
