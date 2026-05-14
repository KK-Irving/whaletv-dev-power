---
inclusion: auto
---

# Skill: Skill 编写与创建（Skill Creator）

## 目的

当 `find-skill` 未找到合适的 skill 来处理当前需求时，自动创建一个新的 skill。创建前会 review 现有所有 skill，确保不重复、风格一致。

## 触发时机

- `find-skill` 执行后未找到匹配的 skill
- `FEATURE_REQUESTS.md` 中有 pending 状态的功能请求需要实现
- 用户主动说"创建新 skill"、"写一个 steering"、"添加工作流"

## 创建流程

### ① Review 现有 skill

创建前必须先扫描现有文件，避免重复：

```bash
# 列出所有现有 skill
ls .kiro/skills/*.md

# 列出所有 steering
ls steering/*.md
```

检查：
- 是否已有功能相近的 skill（避免重复）
- 现有 skill 的命名风格和结构（保持一致）
- 是否可以扩展现有 skill 而非创建新的

### ② 确定 skill 类型

| 类型 | 文件位置 | inclusion | 适用场景 |
|------|---------|-----------|---------|
| 通用行为指导 | `.kiro/skills/` | auto | 每次对话都需要的规则 |
| 特定工作流 | `steering/` | auto | 多步骤流程定义 |
| 按需参考 | `.kiro/skills/` | manual | 特定场景才需要的指南 |

### ③ 编写 skill

遵循以下结构规范：

```markdown
---
inclusion: auto | manual
---

# [标题]

## 目的
一句话说明解决什么问题

## 触发时机
什么情况下激活

## [核心内容]
...

## 关键约束
必须遵守的规则
```

### ④ 质量检查

| # | 检查项 | 通过标准 |
|---|--------|---------|
| 1 | 有明确的触发时机 | 读者能判断何时使用 |
| 2 | 步骤可执行 | 每步有具体的 AI 动作 |
| 3 | 有错误处理 | 定义了失败时的行为 |
| 4 | 不重复现有内容 | 与已有文件无功能重叠 |
| 5 | 工具名正确 | 引用的工具名与 MCP Server 中一致 |
| 6 | 格式一致 | 遵循结构规范 |

### ⑤ 创建并记录

1. 创建文件到对应目录
2. 在 `.learnings/LEARNINGS.md` 记录一条 `best_practice`：为什么创建、解决什么问题
3. 如果是从 `FEATURE_REQUESTS.md` 实现的，将对应条目状态改为 `resolved`
4. 告知用户新 skill 已创建

## 从 FEATURE_REQUESTS 自动实现

当用户说"处理功能请求"或 AI 在周期性回顾中发现 pending 的 FEAT 条目时：

1. 读取 `FEATURE_REQUESTS.md` 中 pending 状态的条目
2. 对每个条目执行 `find-skill` 检查是否已有能力覆盖
3. 如果未覆盖且复杂度为 simple/medium，自动创建 skill
4. 如果复杂度为 complex，向用户展示并请求确认后再创建

## 关键约束

- 创建前**必须** review 现有 skill，不允许跳过
- 新 skill 的命名必须使用 kebab-case
- 新 skill 必须通过质量检查清单
- 不要创建过于细碎的 skill（一个 skill 应该解决一类问题，而非一个具体问题）
- 如果可以通过扩展现有 skill 解决，优先扩展而非新建
