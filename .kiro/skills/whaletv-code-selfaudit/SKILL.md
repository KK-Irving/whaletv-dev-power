---
name: whaletv-code-selfaudit
description: |
  代码提交前自审 checklist（pre-commit self-review），减少 Gerrit-AI 评论修改轮次。TRIGGERS: "检查下代码" / "review 一下" / "自审" / "看看代码有没有问题" / git commit 前 / PR/CR workflow 步骤 ④ 修改代码完成后. 5 项必检：编译通过 / 无调试代码 / 无硬编码 / 变更范围精确 / commit message 格式. 与 whaletv-code-review（Gerrit-AI 评论三态处理）互补，前者是 push 前预防、后者是 push 后修正。Use this skill before ANY commit or push. Do NOT confuse with whaletv-code-review which handles post-push Gerrit comments.
---

# Skill: 代码自审（Pre-commit Review）

## 目的

在代码提交前进行自动化质量检查，减少 Gerrit-AI 评论修改轮次，提高一次通过率。

## 触发时机

在以下节点**自动执行**代码自审：

- PR/CR 工作流步骤 ④ "修改代码" 完成后、展示 diff 前
- 任何 `git commit` 操作前
- 用户说"检查下代码"或"review 一下"时

## 自审检查清单

### 必检项（每次都检查）

| # | 检查项 | 方法 |
|---|--------|------|
| 1 | **编译通过** | 确认修改后文件无语法错误 |
| 2 | **无调试代码** | 搜索 `Log.d`、`System.out.println`、`console.log`、`TODO`、`FIXME` 等临时代码 |
| 3 | **无硬编码** | 检查是否有硬编码的 IP、路径、密钥等 |
| 4 | **变更范围精确** | `git diff` 中是否有无关的修改（空行、格式化等） |
| 5 | **Commit Message 格式** | 符合 `[版本号][类型][whaletv][Zmind#ID]简述` 格式 |

### 选检项（复杂修改时检查）

| # | 检查项 | 方法 |
|---|--------|------|
| 6 | **空值安全** | 新增的对象引用是否有空值检查 |
| 7 | **异常处理** | 新增的 try-catch 是否有合理的错误处理（不是空 catch） |
| 8 | **资源释放** | 打开的流、连接是否在 finally 中关闭 |
| 9 | **线程安全** | 共享变量的访问是否有同步保护 |
| 10 | **向后兼容** | 接口变更是否影响其他调用方 |

## 自审输出格式

```
📋 代码自审结果

✅ 编译通过
✅ 无调试代码
✅ 无硬编码
⚠️ 变更范围 — 发现 2 处无关的空行修改（建议移除）
✅ Commit Message 格式正确

总结：1 个建议项，无阻塞问题。可以继续提交。
```

如果有阻塞问题：

```
📋 代码自审结果

✅ 编译通过
❌ 发现调试代码 — src/Main.java:45 包含 System.out.println
✅ 无硬编码
✅ 变更范围精确
✅ Commit Message 格式正确

总结：1 个阻塞问题，需要修复后再提交。
```

## 与现有工作流的融合

### PR/CR 工作流

在步骤 ④ 和用户确认 diff 之间插入自审：

```
④ 修改代码
   ↓
④.5 代码自审（自动执行，不需要用户触发）
   ↓ [如果有阻塞问题，自动修复后重新自审]
👤 用户确认 diff
```

### Gerrit 工作流

在调用 `push_to_gerrit` MCP 工具前执行自审，减少 Gerrit-AI 评论：

```
生成 Commit Message
   ↓
自审检查（确保无低级问题）
   ↓
👤 用户确认 push
   ↓
push_to_gerrit (Gerrit MCP Server)
```

## 自动修复

对于以下问题，AI 可以**自动修复**而不需要用户确认：

- 移除调试代码（`Log.d`、`println` 等）
- 移除多余的空行变更
- 修正 Commit Message 格式

对于以下问题，需要**用户确认**后修复：

- 添加空值检查（可能改变逻辑）
- 修改异常处理（可能影响行为）
- 接口变更（影响其他模块）

## 经验积累

自审发现的问题如果**重复出现 3 次以上**，自动记录到 `.learnings/LEARNINGS.md`：

```
## [LRN-YYYYMMDD-XXX] best_practice

### 摘要
[模块名] 频繁出现 [问题类型]，建议 [预防措施]
```

## 关键约束

- 自审是**辅助**，不替代 Gerrit 正式 Review
- 不要因为自审通过就跳过用户确认步骤
- 自审结果简洁展示，不要长篇大论
- 如果用户说"跳过检查"，尊重用户选择
