---
inclusion: auto
---

# Skill: 自我改进与经验沉淀

## 目的

在开发过程中自动捕获错误、修正和最佳实践，形成可检索的团队知识库，避免重复踩坑，持续提升效率。

## 触发时机

以下情况发生时，**必须**记录到 `.learnings/` 目录：

| 触发场景 | 记录目标 | 分类 |
|---------|---------|------|
| 命令或操作失败 | ERRORS.md | — |
| 用户纠正 AI（"不对"、"应该是..."） | LEARNINGS.md | correction |
| 发现知识过时或不准确 | LEARNINGS.md | knowledge_gap |
| 发现更好的做法 | LEARNINGS.md | best_practice |
| 用户请求不存在的功能 | FEATURE_REQUESTS.md | — |
| API 或外部工具调用失败 | ERRORS.md | — |

## 记录格式

### Learning 条目（追加到 `.learnings/LEARNINGS.md`）

```markdown
## [LRN-YYYYMMDD-XXX] category

**时间**: ISO-8601
**优先级**: low | medium | high | critical
**状态**: pending
**领域**: zmind | gerrit | docs | code | workflow | config

### 摘要
一句话描述学到了什么

### 详情
完整上下文：发生了什么、哪里错了、正确做法是什么

### 建议动作
具体的修复或改进措施

### 元数据
- 来源: conversation | error | user_feedback
- 相关文件: path/to/file
- 标签: tag1, tag2
- 关联: LRN-20260101-001（如果与已有条目相关）
---
```

### Error 条目（追加到 `.learnings/ERRORS.md`）

```markdown
## [ERR-YYYYMMDD-XXX] 失败的操作名

**时间**: ISO-8601
**优先级**: high
**状态**: pending
**领域**: zmind | gerrit | docs | code | workflow | config

### 摘要
简述什么失败了

### 错误信息
```
实际的错误输出
```

### 上下文
- 执行的命令/操作
- 输入参数
- 环境信息

### 建议修复
如果能识别，如何解决

### 元数据
- 可复现: yes | no | unknown
- 相关文件: path/to/file
---
```

### Feature Request 条目（追加到 `.learnings/FEATURE_REQUESTS.md`）

```markdown
## [FEAT-YYYYMMDD-XXX] 功能名称

**时间**: ISO-8601
**优先级**: medium
**状态**: pending

### 请求的功能
用户想做什么

### 用户场景
为什么需要，解决什么问题

### 复杂度估计
simple | medium | complex

### 建议实现
如何构建
---
```

## 周期性回顾

在以下时机回顾 `.learnings/` 目录：

- **开始新任务前** — 检查是否有相关的历史经验
- **Bug 分析时** — 搜索是否有类似问题的历史记录
- **PR/CR 处理时** — 检查该模块是否有已知的坑
- **用户说"回顾经验"时** — 展示 pending 状态的高优先级条目

### 回顾命令

```bash
# 统计待处理条目
grep -h "状态\*\*: pending" .learnings/*.md | wc -l

# 查找高优先级待处理
grep -B5 "优先级\*\*: high" .learnings/*.md | grep "^## \["

# 按领域搜索
grep -l "领域\*\*: gerrit" .learnings/*.md
```

## 经验晋升

当一条经验被证明**广泛适用**（不是一次性问题）时，根据类型选择不同的晋升路径：

### 晋升到现有文件

| 条件 | 晋升目标 |
|------|---------|
| 工作流改进 | 对应的 steering 文件 |
| 工具使用技巧 | 对应的 skill 文件 |
| 安全规则 | safety-rules.md |
| 项目约定 | README.md 或 POWER.md |

### 晋升为新 skill

当经验**重复出现 3 次以上**且无法归入现有 skill 时：

1. 执行 `find-skill` 确认确实没有覆盖
2. 触发 `skill-creator` 创建新 skill
3. 将原条目状态改为 `promoted`，标注 `Skill-Path: .kiro/skills/xxx.md`

### FEATURE_REQUESTS 的实现路径

`FEATURE_REQUESTS.md` 中的条目通过以下路径被实现：

```
FEAT 条目 (pending)
    │
    ▼
find-skill: 是否已有能力覆盖？
    │
    ├── 是 → 将条目状态改为 resolved，标注已有 skill
    │
    └── 否 → skill-creator: 创建新 skill
                │
                └── 创建完成 → 条目状态改为 resolved
```

触发时机：
- 周期性回顾时自动检查 pending 的 FEAT 条目
- 用户说"处理功能请求"时
- 新任务开始前的经验回顾中

晋升后将原条目状态改为 `promoted`。

## 关键约束

- 记录时**不暴露**密码、API Key 等敏感信息
- 错误信息可以摘要，不需要完整输出
- 每次记录后简短告知用户"已记录到经验库"
- 不要为琐碎问题（如拼写错误）创建条目
- ID 格式：`TYPE-YYYYMMDD-XXX`（如 `LRN-20260514-001`）

## 进化闭环

本 skill 与 `find-skill` 和 `skill-creator` 共同构成项目的自我进化机制：

```
日常使用
    │
    ├── 成功 → 沉淀 insight 到 LEARNINGS.md
    │
    ├── 失败 → 记录到 ERRORS.md
    │           │
    │           └── 重复 3 次 → 晋升为 skill 规则
    │
    ├── 能力缺口 → 记录到 FEATURE_REQUESTS.md
    │               │
    │               └── find-skill → skill-creator → 新 skill
    │
    └── 用户纠正 → 记录 correction 到 LEARNINGS.md
                    │
                    └── 修正现有 skill 中的错误指导
```

**目标：项目越用越强，每次使用都在积累能力。**
