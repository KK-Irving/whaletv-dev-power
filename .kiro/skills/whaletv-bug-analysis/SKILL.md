---
name: whaletv-bug-analysis
description: |
  Bug Issue 自动分析工作流（v3 起优先调 analyze_issue 一键端到端）。TRIGGERS: "分析下 #334001" / "帮我看看这个 Bug" / "分析一下这个问题" / "看看为什么崩了" / "Bug 分析" / 任何用户明确说 "分析"（且非修复）的 Zmind bug issue. 一键模式：analyze_issue(issue_id, include_aosp=true) 串完（拉 issue → 工作目录 → 关键词 → 三源检索 → 平台/模块推断 → AOSP 精搜 → 渲染 analysis-context.md）；失败回退到分步。Use this skill for pure bug analysis without fixing. Do NOT use if user wants to fix the bug end-to-end (use whaletv-pr-cr).
---

# Bug 分析工作流

## 触发场景

用户请求分析 Bug Issue（如"分析下 #334001"、"帮我看看这个 Bug"、"分析一下这个问题"）

## 前置条件

- Zmind MCP Server 可用（`ZMIND_API_KEY` 已配置）
- 当前目录为源码目录（包含 `.repo` 或典型子目录如 `frameworks/`、`packages/`）

## 工作流步骤

### ① 获取 Issue 详情

**AI 动作**: 调用 `get_issue` 获取 Issue 完整信息，包括标题、描述、附件列表、评论历史、复现条件等
**预期输出**: Issue 完整详情，特别关注 subject、description、attachments、journals
**错误处理**: IF `get_issue` 调用失败，THEN 报告错误信息并记录到 `.learnings/ERRORS.md`，等待用户指示

> **v2 一键模式**：如果用户描述较为清晰（含具体 issue 编号），优先调 `analyze_issue(issue_id, include_aosp=true)` 一次串完步骤 ① 到 ⑥（拉 issue → 工作目录 → 关键词 → 三源 hybrid 检索 → 平台/模块推断 → AOSP 精搜 → 渲染 analysis-context.md）。详见 `knowledge-base-workflow.md`。本工作流的分步流程作为 `analyze_issue` 失败回退或需要更细控制时使用。

### ①.5 检索历史经验

**AI 动作**: 多源并行：

1. **本地 `.learnings/`**：在 `.learnings/LEARNINGS.md` 和 `.learnings/ERRORS.md` 中搜索关键词（模块名、异常类名）
2. **`search_local(source="all", mode="hybrid")`**（v2 起 ★ 推荐）：在本地知识库（zmind PR + gerrit changes + confluence pages）做毫秒级跨源检索，找类似历史 PR、修复 commit、设计文档
3. （fallback）`search_confluence` live 调用文档中心

- IF 找到相关历史经验 → 展示给用户："发现历史相关经验：[摘要]，上次的解决方案是 [方案]，对应 [URL]"
- IF 未找到 → 继续正常流程

**预期输出**: 历史经验参考（如有）+ 各源 Top-K 命中
**错误处理**: 搜索失败不阻塞主流程，继续下一步

### ② 一站式准备工作目录（v2.0.0 推荐）

**AI 动作**: 调用 zmind-mcp-server 的 `prepare_issue_workspace(issue_id, workspace_root)` 工具，一次性完成：
- 创建 `.workspace/issue-<id>/` 目录（含 attachments/ extracted/ 子目录）
- 下载所有附件到 `attachments/`
- 按类型自动路由：
  - `.log` `.txt` `.xml` `.json` `.conf` 等文本 → 直接落盘
  - `.zip` → 自动解压到 `extracted/<name>/`
  - `.tar.gz` `.tgz` → 自动解压
  - `.7z` `.rar` → 落盘 + 检测本机 7z 命令
  - HCI / btsnoop log → 落盘 + 检测本机 tshark
  - PDF → 落盘 + 检测本机 pdftotext
  - 图片（png/jpg/gif/bmp）→ 落盘，AI 后续用 read_file + vision 读
  - 视频 → 默认跳过下载（避免大文件），可显式 `skip_video: false` 关闭
- 写 `README.md` 索引

**预期输出**: 工作目录已就绪，附件清单 + 处理结果 + AI 后续 hint
**错误处理**: IF 调用失败 THEN 回退到旧的逐个 download_attachment 流程

### ④ 提取异常信息

**AI 动作**: 从 prepare_issue_workspace 返回的附件结果中读取日志/文本（text_content 或 read_file extracted/），从中提取以下关键信息：

1. **异常堆栈**: Exception/Error 及其完整调用链（如 `java.lang.NullPointerException` + `at com.xxx.ClassName.methodName(File.java:123)`）
2. **时间点事件**: 异常发生前后 5 秒内的关键事件（如 Activity 生命周期、Service 启停、广播接收等）
3. **重复错误关键字**: 在日志中重复出现 2 次以上的错误关键字或错误模式

**预期输出**: 结构化的异常信息摘要
**错误处理**: IF 未发现异常堆栈或错误关键字，THEN 在分析报告中标注"未发现明确异常"并列出日志最后 20 行作为参考上下文

### ⑤ 本地代码定位

**AI 动作**: 按 `local-code-guide.md` 的 5 档搜索策略：

0. **先用 `codebase-taxonomy.md` 确定平台**（D4 / X5 / STB）—— 从 Zmind `issue.project` 字段或 workspace 路径推断，无法确定时问用户。**平台决定业务代码根**（D4 用 `vendor/zeasn/`，X5/STB 用 `vendor/whale/`），影响后面所有路径搜索。
1. **模块路径地图查表**（`module-path-map.md`）：从异常信息/Issue 描述中提取关键词（类名、模块名、功能名如 "TvScanConfig"、"TvSettings"、"PQ"、"CEC"），在地图的**对应平台小节**中找路径前缀
2. **本地知识库 `search_local(source="gerrit")`**（v2 起 ★ 推荐）：找历史改过该模块的 commit，看 commit_message 里描述哪个文件 / 函数 → 直读
3. 用路径前缀**限定 git grep 搜索范围**：`git grep -n "ClassName" -- "<path-prefix>/**"`（去掉 wrapper 目录前缀，相对源码根）
4. 未命中时按 local-code-guide 标准优先级（git grep 全仓 → 读取已知路径 → OpenGrok `search_symbol`）

**预期输出**: 定位到相关代码的文件路径和行号

**IF git grep 无结果**:

改用 OpenGrok `search_symbol` 工具进行二次搜索，并在报告中标注定位方式为"OpenGrok"

```
定位方式：OpenGrok（本地 git grep 未匹配）
```

**错误处理**: IF 两种方式均未找到结果，THEN 在报告中标注"未能定位到相关代码"，列出搜索过的关键词供用户参考；同时记录到 `.learnings/LEARNINGS.md`（分类 `knowledge_gap`），用于补充模块路径地图

### ⑥ 输出结构化分析报告

**AI 动作**: 按以下固定格式输出分析报告

```markdown
## Bug 分析报告

### 现象
- Issue 标题及复现条件

### 关键 Log
（不超过 30 行的核心异常日志片段）

### 根因定位
- 文件:行号
- 定位方式：git grep / OpenGrok

### 修复建议
1. [可操作的修改方向 1]
2. [可操作的修改方向 2]
3. [可操作的修改方向 3]
```

**格式说明**:
- **现象**: 包含 Issue 标题、复现条件（从描述或评论中提取）
- **关键 Log**: 核心异常日志片段，不超过 30 行，聚焦异常堆栈和关键事件
- **根因定位**: 文件路径:行号，标注定位方式（git grep 或 OpenGrok）
- **修复建议**: 不超过 3 条可操作的修改方向，每条应具体到修改哪个类/方法、如何修改

**预期输出**: 完整的结构化分析报告
**错误处理**: IF 信息不足以给出修复建议，THEN 在修复建议中标注"信息不足，建议补充日志后重新分析"

## 输出格式

最终产出物为 Markdown 格式的分析报告，包含四个部分：

| 部分 | 内容 | 约束 |
|------|------|------|
| 现象 | Issue 标题 + 复现条件 | 简明扼要 |
| 关键 Log | 核心异常日志片段 | ≤ 30 行 |
| 根因定位 | 文件:行号 + 定位方式 | 标注 git grep / OpenGrok |
| 修复建议 | 可操作的修改方向 | ≤ 3 条 |

## 错误恢复

任一步骤执行失败时：

1. **报告失败**: 明确告知用户失败发生在哪个步骤，以及具体的错误信息
2. **记录经验**: 将错误记录到 `.learnings/ERRORS.md`
3. **等待指示**: 等待用户决定是重试当前步骤、补充信息、还是终止分析
4. **不自动重试**: 不在未经用户确认的情况下自动重试失败的操作

## 经验沉淀

分析完成后，自动将本次分析的关键发现记录到 `.learnings/LEARNINGS.md`：

- **分类**: `insight`
- **内容**: Issue ID、异常类型、根因模块、修复方向
- **目的**: 后续遇到类似问题时可快速检索到历史分析结果

## 关键约束

| 约束 | 说明 |
|------|------|
| 附件识别规则 | 日志文件自动下载分析；压缩包/图片/视频展示信息后询问用户 |
| 代码定位优先级 | ① 先查 `module-path-map` 缩小范围 → ② `git grep` 限定路径搜索 → ③ OpenGrok `search_symbol` 兜底 |
| 报告格式 | 严格按四部分格式输出（现象、关键 Log、根因定位、修复建议） |
| 关键 Log 长度 | 不超过 30 行 |
| 修复建议数量 | 不超过 3 条 |
| 定位方式标注 | 必须在报告中标注使用了 module-path-map / git grep / OpenGrok 中哪种 |


## Completion Rule（v3 治理层）

**Bug 分析完成后（无论完整走完还是中途停止），MUST 调用 `generate_report` 生成结构化报告**：

```
generate_report({
  scenario: "bug-analysis",
  task_identifier: "<issue_id>",          // 如 "PR337540"
  skill_name: "whaletv-bug-analysis",
  business_summary: {
    title: "<Issue 标题>",
    conclusion: "<一句话结论>",
    details: {
      issue_status: "<从 Zmind 读的原文，如 处理中 / 已解决>",
      symptom_type: "<crash|functional_error|performance|... 从枚举选>",
      root_cause_category: "<logic_bug|null_reference|... 从枚举选>",
      // 允许自由添加业务字段：codebase, modules_touched, ...
    },
    risks: [{ level: "low|medium|high|critical", description: "..." }]
  },
  phases: [/* 每个 phase 有 phase_id/name/status/summary，可含 outputs/tools/rules_hit/gate */],
  artifacts: [
    { type: "zmind_issue_url", value: "<URL>", label: "原 Issue" },
    { type: "log_slice", value: "<路径>" },
    // ...
  ],
  hook_metrics: { hooks_triggered: X, hook_names: [...] },  // 可选
  output_dir: "<cwd>/report-output"  // 默认
})
```

**枚举必填规则**（治理归因用）：
- `symptom_type` **必须从 13 值枚举里选**：`crash / functional_error / performance / display_artifact / audio_video_sync / playback_failure / network_error / compatibility / data_error / security / config_error / build_packaging / other`
- `root_cause_category` **必须从 14 值枚举里选**：`logic_bug / null_reference / race_condition / memory_issue / resource_leak / api_misuse / third_party_defect / hardware_driver / config_missing / network_protocol / data_format / environment / requirement_gap / unknown`
- 实在不匹配 → 选 `other` / `unknown` 并在 `conclusion` 里说明

**输出**：`report-output/<issue_id>/<report_id>-report-fact-v1.{json,html}`。HTML 是自包含单文件（内嵌 CSS+JS，无外部依赖），可直接用浏览器打开或分享。

**（可选）上传到 S3**：如果 SoT 里 `s3_issue_analysis` 配置完整，调 `upload_report({ html_path, report_id })` 归档到 `s3://<bucket>/issueAnalysis/<year>/w<week>/`。团队按 ISO 周聚合分析。

**Issue 状态感知**（避免重复分析）：
- Zmind issue 状态是 `新建` / `处理中` → 正常走完整分析并 generate_report
- 状态是 `已解决` / `已关闭` → 跳过详细分析，`conclusion` 填 "Issue 已解决，跳过分析"；phases 只记录"读取 issue + 检测已解决状态"
- 检测到本 issue 之前**已有报告文件**（同 `report_id` 存在于 `report-output/`）→ **[GATE]** 询问用户"该 Issue 已有分析记录，是否重新分析？"，等确认再执行
