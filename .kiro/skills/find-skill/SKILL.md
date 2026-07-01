---
name: find-skill
description: |
  帮助用户发现和确认当前可用的 skill 集合。TRIGGERS: "有哪些 skill" / "怎么触发 xxx" / "有没有 skill 能做 yyy" / "帮我列 skill" / 用户不确定该激活哪个 skill 时. 列出所有 .kiro/skills/*/SKILL.md 的 name + description 摘要，帮用户选合适的工作流。Use when user is exploring capabilities. Do NOT use during active workflow execution.
---

# Skill: 能力发现（Find Skill）

## 目的

在处理用户需求前，自动搜索当前项目中是否存在能更高效处理该需求的 skill 或 steering。如果找到则调用，如果未找到则触发 skill-creator 创建新能力。

## 核心理念

**项目是活的，能力是可以生长的。** 不是所有需求都要靠现有 skill 硬撑——发现缺口时主动补齐，让项目越用越强。

## 触发时机

以下场景自动执行 find-skill：

| 场景 | 触发条件 |
|------|---------|
| 用户提出新需求 | 需求不明显属于已有工作流（PR/CR、Bug 分析、CP 等） |
| 工作流中遇到未覆盖的子任务 | 现有步骤无法处理某个环节 |
| FEATURE_REQUESTS.md 有 pending 条目 | 周期性回顾时 |
| 用户说"有没有更好的方式" | 对现有流程不满意时 |

## 搜索流程

### ① 解析需求关键词

从用户输入中提取：
- 动作（查询、创建、分析、同步、推送...）
- 对象（Issue、代码、日志、文档、分支...）
- 上下文（哪个系统、哪个模块...）

### ② 搜索现有 skill

按以下顺序搜索匹配：

```bash
# 1. 搜索 skill 文件的标题和触发时机
grep -l "关键词" .kiro/skills/*.md

# 2. 搜索 steering 文件的触发场景
grep -l "关键词" steering/*.md

# 3. 搜索 LEARNINGS.md 中是否有相关最佳实践
grep "关键词" .learnings/LEARNINGS.md
```

### ③ 匹配判断

| 匹配结果 | 动作 |
|---------|------|
| **精确匹配** — 找到完全对应的 skill/steering | 直接调用该 skill 执行 |
| **部分匹配** — 找到相关但不完全覆盖的 skill | 调用该 skill + 提示用户可能需要扩展 |
| **未匹配** — 没有任何 skill 能处理 | 触发 skill-creator 流程 |

### ④ 未匹配时的处理

当没有找到合适的 skill 时：

1. **告知用户**：
```
当前没有专门处理 [需求描述] 的 skill。

我可以：
A. 直接尝试处理（不保证最优流程）
B. 先创建一个专门的 skill，然后按规范流程处理

推荐选 B，这样后续同类需求都能高效处理。
```

2. **用户选择 B** → 调用 skill-creator 创建新 skill
3. **用户选择 A** → 直接处理，处理完后询问是否要沉淀为 skill

## 与其他 skill 的协作

### 与 self-improving 的协作

```
find-skill 未匹配
    │
    ├── 记录到 FEATURE_REQUESTS.md（如果是新能力需求）
    │
    └── 触发 skill-creator
            │
            ├── review 现有 skill
            ├── 创建新 skill
            └── 记录到 LEARNINGS.md（best_practice）
```

### 与 skill-creator 的协作

find-skill 是**发现者**，skill-creator 是**创建者**：
- find-skill 负责判断"需不需要新 skill"
- skill-creator 负责"如何创建好的 skill"

### 周期性进化

在周期性回顾（用户说"回顾经验"或开始新任务前）时：

1. 扫描 `FEATURE_REQUESTS.md` 中 pending 状态的条目
2. 对每个条目执行 find-skill 检查
3. 如果有可以通过创建 skill 解决的，向用户建议：
```
📋 发现 X 个待实现的功能请求：

1. [FEAT-20260514-001] XXX — 复杂度: simple
   → 建议创建 skill: xxx-handler.md

2. [FEAT-20260514-002] YYY — 复杂度: medium
   → 建议扩展现有 skill: zzz.md

要我处理哪个？
```

## 进化闭环

```
用户使用 Power
    │
    ├── 顺利完成 → 无动作
    │
    ├── 遇到能力缺口 → find-skill 未匹配
    │       │
    │       └── skill-creator 创建新 skill
    │               │
    │               └── 下次同类需求 → find-skill 命中
    │
    ├── 流程不够优化 → 用户反馈"有没有更好的方式"
    │       │
    │       └── find-skill 搜索 → 建议优化现有 skill
    │
    └── 操作失败 → self-improving 记录
            │
            └── 积累到一定量 → 晋升为 skill 规则
```

## 关键约束

- find-skill 是**轻量级**操作，不应该让用户感知到延迟
- 搜索范围仅限当前项目的 `.kiro/skills/` 和 `steering/` 目录
- 不要为每个小需求都触发 skill-creator（只有确实是新类型的需求才创建）
- 如果用户明确说了要用哪个工作流（如"帮我处理 PR"），直接执行，不需要 find-skill
- 创建新 skill 前必须获得用户确认
