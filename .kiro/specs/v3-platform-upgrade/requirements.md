# Requirements Document

> 中文标题：需求文档：whaletv-dev-power v3 架构级完善与治理化升级

## Introduction

本规划是 `whaletv-dev-power` Power 在 v2.0.0 发布并投入使用一段时间后，对照公司内部另一套成熟框架 `agentengineeringframework`（AEF）做完整 review 后，整理出的一轮**架构级完善**升级。v2 已经把 MCP 工具链、本地知识库、workflow 严谨性做到了 AEF 无法比拟的深度，但仍有若干**平台级架构成熟度**的短板需要补齐。

v3 的核心目标不是加新工具，而是**修 bug、清理架构、提升可运维性、引入治理层**，让本 Power 从"垂直深度强"升级到"垂直深度强 + 平台成熟"。

### 主要问题域

1. **[bug 级]** `hooks/safety-hooks.json` 使用自定义 schema，**不符合 Kiro 官方 hook schema**，实际上没被 Kiro 加载执行——三层防护体系里的第二层"Hook 拦截"当前是空的。
2. **[架构级]** 没有一键部署脚本把 skill/steering/hook 自动同步到 `~/.kiro/`；用户在多机器同步或非 Power 模式使用时体验割裂。
3. **[架构级]** 凭据没有单一真源，分散在 5 个 MCP server 的 env 里，改一处必须同步 4 处；`refresh-auth.mjs` 和 `setup-creds.mjs` 靠 substring 匹配双写，容易漏改。
4. **[信息密度]** 12 份 steering 有相当程度的**重叠内容**（如 gerrit-workflow / code-review-handling / pr-cr-workflow 都涉及"处理 gerrit-ai 评论"），且部分文件（commit-message-workflow、pr-cr-workflow）单文件 400-500 行，加载压力大。
5. **[治理层缺失]** 只有 `.learnings/` 给 AI 自己消化，没有面向团队/管理者的**结构化执行报告**、**症状/根因枚举分类**、**按周聚合上传**能力。
6. **[跨终端能力]** 所有能力必须进 Kiro 才能用，终端里想 `gerrit-show <id>` 看 diff 不行。
7. **[.kiro/skills/ 游离]** workspace 内的 `.kiro/skills/*.md` 与 `steering/*.md` 分工不清、内容重叠，用户看不出该激活哪个。
8. **[长期风险]** Zmind 直连模式在团队规模扩大后会遇到 WAF/统计/附件泄露压力（此项 v3 只做架构调研 + 演进准备，不实施）。

### 参考项目已验证的设计模式

v3 借鉴 AEF 的以下设计（**但不是照搬**，保留本项目在 knowledge-mcp / analyze_issue / module-path-map / commit-message property 契约 / Playwright cookie 刷新等方面的独有优势）：

- **单一凭据源** `~/.ai/*.yaml` + 统一 CLI 读取器
- **Init 脚本幂等 + 迁移检测**（marker block、PATH 管理、模板变量替换）
- **skills/rules 分工**：极简 rules（always inclusion） + 完整 skill（description-driven trigger）
- **结构化执行报告 schema + HTML 可视化 + S3 上传**
- **跨平台 CLI 工具**（Node.js 写，`bin/` 目录 + `.cmd` 包装器）
- **官方 Kiro hook schema**（`askAgent` / `runCommand` 类型，每个 hook 单独 JSON）

## Glossary

- **单一凭据源（Single Source of Truth, SoT）**：所有工具（MCP servers、CLI 脚本、部署脚本）都通过一个统一的凭据读取接口获取密钥/密码/cookie，避免多处冗余存储
- **Kiro 官方 Hook schema**：Kiro IDE 定义的 hook 配置格式，参见系统提示中的 `hooks` 章节；关键约束是每个 hook 单独一个 JSON 文件，包含 `name` / `version` / `when` / `then` 四个顶层字段
- **askAgent hook**：Kiro 支持的 hook 动作类型之一，触发时向 AI 发送一个 prompt 让 AI 自主判断如何处理；对应 `then.type: "askAgent"` 与 `then.prompt`
- **runCommand hook**：Kiro 支持的另一种 hook 动作类型，触发时直接执行一条 shell 命令；对应 `then.type: "runCommand"` 与 `then.command`
- **preToolUse hook**：Kiro 事件类型之一，在工具执行前触发；可通过 `when.toolTypes` 过滤（`read` / `write` / `shell` / `web` / `spec` / `*`）
- **postToolUse hook**：Kiro 事件类型之一，在工具执行后触发
- **一键部署脚本（deploy script）**：把 workspace 内的 skill/steering/hook 文件同步到用户 `~/.kiro/` 的脚本，幂等、支持迁移检测、跨 Windows/Linux/macOS
- **凭据 CLI（credentials CLI）**：读取单一凭据源的独立命令行工具，MCP server 启动时可以 spawn 它获取密钥
- **执行报告（execution report）**：Skill/Workflow 完成后生成的结构化 JSON + HTML，包含 phase outputs、症状分类、根因分类、gate 决策等；可上传到 S3 或团队内部 web
- **症状类型（symptom_type）**：一组固定的枚举值描述问题现象类型（crash / functional_error / performance / ...），用于治理分类
- **根因分类（root_cause_category）**：一组固定的枚举值描述问题根因类型（logic_bug / null_reference / race_condition / ...），用于治理分类
- **v3 SoT 文件**：`~/.ai/whaletv.yaml`，chmod 600，v3 引入的唯一凭据存储位置

## Requirements

### 需求 1：修复 Hook 格式（P0，bug 级）

**用户故事：** 作为使用本 Power 的开发者，我希望 `hooks/` 目录下的所有安全 hook 都能被 Kiro 正常加载并触发，以便在我尝试执行危险操作（sudo / MP 分支 push / 大范围搜索）时，Kiro 能真正拦截。

#### 验收标准

1. THE hooks 目录 SHALL 移除自定义格式的 `hooks/safety-hooks.json` 汇总文件（保留一份 archive 到 `.learnings/` 供参考）
2. THE hooks 目录 SHALL 为原先 `safety-hooks.json` 中的每一条规则单独创建一个 JSON 文件，命名与规则 id 一致（如 `block-sudo.json` / `block-mp-push.json` / `block-git-add-all.json` / `block-root-search.json` / `block-tmp-write.json` / `block-out-search.json` / `block-bulk-copy-out.json`）
3. THE 每个 hook JSON 文件 SHALL 使用 Kiro 官方 schema，包含 `name` / `version` / `when` / `then` 四个顶层字段
4. THE 每个 hook 的 `when.type` SHALL 为 `preToolUse`，`when.toolTypes` SHALL 为 `["shell"]`
5. THE 每个 hook 的 `then.type` SHALL 为 `askAgent`，`then.prompt` SHALL 包含明确的检测逻辑说明（"如果检测到 X 你必须停止"）以及替代方案说明
6. WHEN 用户执行匹配某个 hook 的 shell 命令时，THE Kiro 系统 SHALL 触发对应的 hook，AI SHALL 依据 hook prompt 决定是否停止或提示用户
7. THE POWER.md / README.md SHALL 更新 Hook 章节，展示新格式的 hook 清单及触发场景
8. THE steering/safety-rules.md SHALL 更新"第二层：Hook 拦截"章节，用 hook 文件路径与 prompt 摘要替代原来的自定义 pattern/action/reason 字段说明

### 需求 2：新增一键部署脚本（P1）

**用户故事：** 作为开发者，我希望有一个跨平台的脚本能一次性把 skill/steering/hook 部署到 `~/.kiro/`，让我在新机器上开箱即用，也让团队所有成员的配置保持一致。

#### 验收标准

1. THE 项目 SHALL 在 `scripts/` 下新增 `deploy.mjs` 脚本（Node.js，跨平台）
2. THE `deploy.mjs` SHALL 支持不带参数运行，默认部署到 `~/.kiro/`（用户级）
3. THE `deploy.mjs` SHALL 支持 `--workspace <path>` 参数，部署到 `<path>/.kiro/`（workspace 级）
4. THE `deploy.mjs` SHALL 部署以下资源到目标 `.kiro/` 下的对应子目录：
   - `steering/*.md` → `.kiro/steering/`（覆盖式）
   - `hooks/*.json` → `.kiro/hooks/`（覆盖式，仅包含符合 Kiro schema 的独立 hook JSON 文件）
   - `.kiro/skills/*.md` → `.kiro/skills/`（workspace 已有的 skill 定义，覆盖式）
5. THE `deploy.mjs` SHALL 在部署前检查环境依赖：Node.js ≥ 22.5.0，并在版本不符时打印明确错误信息并退出
6. THE `deploy.mjs` SHALL 支持 `--dry-run` 参数，仅打印将要执行的部署动作，不实际写入
7. THE `deploy.mjs` SHALL 在每次部署前将目标目录备份为 `.kiro/backup-<timestamp>/`，仅保留最近 3 个备份
8. THE `deploy.mjs` SHALL 在部署完成后打印每类资源的 `[OK] / [SKIP] / [FAIL]` 统计
9. IF `deploy.mjs` 检测到目标文件被 Kiro 锁定（PermissionError），THEN 打印 `[FAIL]` 并明确提示用户先关闭 Kiro 再重试
10. THE `deploy.mjs` SHALL 是幂等的——重复运行不产生副作用（除了覆盖式部署导致的时间戳变化）

### 需求 3：引入单一凭据源与凭据 CLI（P1）

**用户故事：** 作为开发者，我不想每次改密码 / cookie 都要同步修改 5 个 MCP server 的 env 配置，希望只在一处存储一份凭据，所有工具自动读取。

#### 验收标准

1. THE 项目 SHALL 定义单一凭据源文件路径 `~/.ai/whaletv.yaml`
2. THE `~/.ai/whaletv.yaml` SHALL 使用 YAML 格式，包含以下顶级字段：`zmind` / `opengrok` / `gerrit` / `confluence`
3. THE 项目 SHALL 在 `scripts/` 下新增 `whaletv-credentials.mjs` CLI，支持以下子命令：
   - `whaletv-credentials get <key>` — 读取指定键（如 `zmind.api_key` / `gerrit.auth_header` / `gerrit.cookie`）
   - `whaletv-credentials check` — 验证所有必需字段是否已配置，缺失时列出并 exit 1
   - `whaletv-credentials set <key> <value>` — 更新指定键（保留其他字段）
4. THE 项目 SHALL 在 `bin/` 下提供 `whaletv-credentials`（Unix shebang 版本）与 `whaletv-credentials.cmd`（Windows 包装器）
5. THE 5 个 MCP server（zmind / opengrok / gerrit / confluence / knowledge）SHALL 在启动时优先从 `~/.ai/whaletv.yaml` 读取凭据；如果 SoT 不存在或字段缺失，THEN 回退到当前的 env 变量方式，保持向后兼容
6. THE `scripts/refresh-auth.mjs` SHALL 更新为写入 `~/.ai/whaletv.yaml`（而不是遍历 mcp.json 里的多个 env 位置）
7. THE `scripts/setup-creds.mjs` SHALL 更新为写入 `~/.ai/whaletv.yaml`（同上）
8. THE `~/.ai/whaletv.yaml` SHALL 在写入时（Linux/macOS）设置为 `0600` 权限
9. THE `~/.ai/whaletv.yaml` SHALL 在写入前备份为 `~/.ai/whaletv.yaml.bak.<timestamp>`，保留最近 3 个备份
10. THE README.md 与 `steering/onboarding.md` SHALL 更新为引导用户使用 SoT 而不是分散的 env 配置

### 需求 4：Steering/Skill 分工重整（P1）

**用户故事：** 作为 AI 使用者，我希望"总是加载的行为约束"和"特定场景才展开的完整工作流"清晰分开，减少上下文加载压力、避免规则重复。

#### 验收标准

1. THE 项目 SHALL 引入 3 份**精简 rules**（放在 `steering/` 下，`inclusion: always`），每份不超过 200 行：
   - `steering/critical-rules.md` — MUST 级不可违反的硬约束
   - `steering/conventions.md` — SHOULD 级强烈建议的做法
   - `steering/execution-rules.md` — 术语（MUST / SHOULD / [GATE] / [SELF-CHECK]）+ 通用执行约定
2. THE 项目 SHALL 保留但重命名/移动现有的 12 份 workflow steering 为 skill 形态，放到 `.kiro/skills/<name>/SKILL.md`，每个 SKILL.md 包含 YAML front-matter（`name` / `description`）
3. THE 12 份 workflow steering 中的 MUST/SHOULD 硬约束条款 SHALL 抽取到步骤 1 的三份精简 rules 中，避免重复
4. THE 每份 SKILL.md 的 description SHALL 明确写明 TRIGGERS（触发关键词）与 "When to Use / When NOT to Use"，让 AI 通过语义匹配自主决定何时加载
5. THE 项目 SHALL 保留 `steering/module-path-map.md`（`inclusion: auto`）作为自动加载的知识库，因其被多个 skill 引用且用户可能未预料到需要它
6. THE 项目 SHALL 移除或标记为 deprecated 现有 `.kiro/skills/*.md` 中与新 skill 结构重复的文件（如 `.kiro/skills/code-review.md` 与 `code-review-handling` skill 重叠时保留一份）
7. THE deploy.mjs 部署逻辑 SHALL 更新为反映新的 skill/steering/rule 分工

### 需求 5：新增执行报告生成与治理层（P2）

**用户故事：** 作为团队 leader，我希望能看到每周团队用 AI 处理了多少 Issue、根因分类是什么、哪些工作流步骤经常卡住，以便针对性地改进流程或补充知识库。

#### 验收标准

1. THE 项目 SHALL 在 `mcp-servers/knowledge-mcp-server/` 下新增两个工具：`generate_report` 与 `upload_report`
2. THE `generate_report` 工具 SHALL 接受 `issue_id` / `workflow_type`（issue-analysis / pr-cr / cherry-pick / commit-message 等）/ `phases`（结构化数组）三个参数，产出结构化 JSON 报告
3. THE 生成的 JSON SHALL 符合项目定义的 `report-fact-v1.schema.json` schema（放在 `mcp-servers/knowledge-mcp-server/schemas/` 下）
4. THE report JSON SHALL 至少包含以下字段：
   - `report_id`（格式：`{scenario}-{task_identifier}`）
   - `meta`（generated_at / workflow_type / user_email 等）
   - `business_summary.details.issue_status`（新建/处理中/已解决/已关闭/已分析）
   - `business_summary.details.symptom_type`（枚举值）
   - `business_summary.details.root_cause_category`（枚举值）
   - `workflow_execution.phases[]`（每个 phase 含 summary / outputs / gate / rules_hit / tools_used）
   - `quality_signals`（phase / gate / hook 三维度指标）
5. THE `symptom_type` 枚举值 SHALL 至少覆盖：`crash` / `functional_error` / `performance` / `display_artifact` / `audio_video_sync` / `playback_failure` / `network_error` / `compatibility` / `data_error` / `security` / `config_error` / `build_packaging` / `other`
6. THE `root_cause_category` 枚举值 SHALL 至少覆盖：`logic_bug` / `null_reference` / `race_condition` / `memory_issue` / `resource_leak` / `api_misuse` / `third_party_defect` / `hardware_driver` / `config_missing` / `network_protocol` / `data_format` / `environment` / `requirement_gap` / `unknown`
7. THE `generate_report` 工具 SHALL 同时产出一份自包含的 HTML 报告（CSS + JS 内联，无外部依赖），文件命名 `{report_id}-report-v1.html`
8. THE HTML 模板 SHALL 通过嵌入 `<script type="application/json" id="report-json">...</script>` + 通用 KV 渲染器渲染 JSON
9. THE report 文件 SHALL 落盘到 `report-output/{issue_id}/` 目录下
10. THE `upload_report` 工具 SHALL 接受 `report_path` 参数，上传到 S3；bucket / region / access_key 从 `~/.ai/whaletv.yaml` 的 `s3_issue_analysis` 段读取
11. THE S3 对象键 SHALL 使用格式 `issueAnalysis/{year}/w{week}/{report_id}-report-v1.html`（year 为 4 位年份、week 为 ISO 周序号，格式 `w` + 两位数字）
12. WHEN issue 状态为 `已解决` / `已关闭` 时，THE `generate_report` 工具 SHALL 跳过详细分析，仅记录状态并在 `conclusion` 段注明"Issue 已解决，跳过分析"
13. WHEN issue 状态为 `已分析`（或存在历史报告）时，THE `generate_report` 工具 SHALL 返回一个明确的"需要人审确认"响应，等待用户确认是否重新分析，不擅自覆盖
14. THE analyze_issue skill / bug-analysis-workflow SHALL 在流程结束时（包括中途终止）自动调用 `generate_report` 生成报告
15. THE README.md SHALL 更新为包含"团队治理"章节，介绍报告能力

### 需求 6：跨终端 CLI 工具（P2）

**用户故事：** 作为开发者，我希望在不打开 Kiro 的情况下也能用一些常用能力（如 `gerrit-show <id>` 快速看 Gerrit change 的 diff），提升工作流灵活性。

#### 验收标准

1. THE 项目 SHALL 在 `bin/` 目录下提供以下跨平台 CLI 工具（Node.js 版本 + Windows `.cmd` 包装器）：
   - `whaletv-credentials`（已在需求 3 中定义）
   - `gerrit-show <change-id>` — 从 Gerrit REST API 获取 change 并输出 unified diff 到 stdout
   - `gerrit-api <path> [-d <json>]` — 通用的 Gerrit REST 客户端，GET/POST 均可
2. THE `gerrit-show` SHALL 支持 `-s` 选项，仅输出文件列表（不输出完整 diff）
3. THE `gerrit-show` SHALL 支持 `--full` 选项，输出完整 commit message + unified diff
4. THE 所有 CLI 工具 SHALL 通过 `whaletv-credentials get <key>` 读取凭据，与 MCP server 共享 SoT
5. THE `deploy.mjs` SHALL 支持将 `bin/` 添加到用户 PATH：
   - Linux/macOS：写入 `~/.zshrc` 或 `~/.bashrc`，使用 marker block（`# >>> whaletv-dev-power >>>` / `# <<< whaletv-dev-power <<<`）
   - Windows：更新 `HKCU\Environment\Path`，检测并去重旧位置
6. THE `deploy.mjs` SHALL 在检测到 PATH 中已存在但目录不同的旧 `bin/` 时（迁移场景），自动更新为当前 `bin/` 路径并提示用户可清理旧目录
7. THE README.md SHALL 新增"CLI 工具"章节，展示每个工具的用法

### 需求 7：Prerequisites 与 README 完善（P2）

**用户故事：** 作为新用户，我希望在装本 Power 之前就知道有哪些系统依赖、遇到常见问题应该如何自查，减少踩坑。

#### 验收标准

1. THE README.md SHALL 在开头新增"Prerequisites"表格，明确列出：Node.js ≥ 22.5.0（必需）、Python 3（可选，仅用于某些兼容性场景）、unar/7z/pdftotext/tshark（可选，用于附件处理）、Chromium 磁盘占用（首次 refresh-auth 约 150MB）、磁盘 5 GB 建议
2. THE README.md SHALL 在"Troubleshooting"章节列出常见问题：
   - Kiro IDE 未关闭导致部署失败
   - Node 版本过低（`node:sqlite` 需 ≥ 22.5）
   - `~/.ai/whaletv.yaml` 权限错误
   - MCP server 启动失败的检查步骤
   - cookie 过期的识别与刷新流程
3. THE README.md SHALL 提供 v2 → v3 的迁移路径章节，说明现有用户如何从"分散 env"迁移到"SoT"，一条命令搞定
4. THE POWER.md SHALL 更新版本号（v2 → v3）与核心升级摘要

### 需求 8：Codebase 分类知识补充（P2，条件性）

**用户故事：** 作为处理跨代码库问题的开发者，我希望有一份文档能告诉我"这个 codebase 属于哪类架构、遇到某类问题应该改哪里"，避免在错的目录里找代码。

#### 验收标准

1. THE 项目 SHALL 在开始实施本需求前，通过用户交互确认 WhaleTV 的代码库是否存在类似 AEF 的架构分类（Hook 架构 / 非 Hook 架构）
2. IF 用户确认存在类似分类，THEN THE 项目 SHALL 新增 `steering/codebase-taxonomy.md`（`inclusion: auto`），描述每个 codebase 的分类、Hook 位置、patch 机制等
3. IF 用户确认不需要，THEN 本需求视为已完成（不做实施）

### 需求 9：Zmind Hub 架构调研（P3，仅规划）

**用户故事：** 作为项目维护者，我希望在团队规模扩大前，有清晰的架构演进路线图，能够在合适的时机把 Zmind get_issue 抽到集中缓存 Hub。

#### 验收标准

1. THE 项目 SHALL 新增 `.kiro/specs/v3-platform-upgrade/zmind-hub-design.md`，仅做调研输出，**不实施**
2. THE 该文档 SHALL 描述以下内容：
   - 触发迁移的门槛条件（团队规模 / WAF 事件频率 / 附件泄露风险 等）
   - Hub 与本地 stdio server 的职责划分
   - 缓存策略（TTL、失效、按用户维度隔离）
   - HMAC 签名附件 URL 的实现思路
   - Rate limit 与统计能力
   - 与 AEF 的 `whale-zmind-hub` 参考实现的对比
3. THE 该文档 SHALL 明确列出"目前不实施"的原因（团队规模未到、优先级低于其他 v3 项）
4. IF 未来触发条件成立，THE 该文档 SHALL 作为 v4 规划的起点直接使用

## 优先级说明

- **P0 - bug 级 / 阻塞级**：不修则功能实际上没在跑。**需求 1**
- **P1 - 高优先级 / 体验大幅提升**：修复后短期收益显著、影响所有用户。**需求 2 / 3 / 4**
- **P2 - 中优先级 / 治理与扩展**：让项目从"工具集"变成"平台"，中期收益显著。**需求 5 / 6 / 7 / 8**
- **P3 - 长期演进 / 仅规划**：暂不实施，规划文档就绪即可。**需求 9**

## 非目标（v3 明确不做）

- **不重写现有 MCP servers**（zmind v2.1.1 / gerrit v1.1.0 / opengrok / confluence / knowledge v1.0.2 保持不变，仅增加 SoT 读取路径）
- **不新增 MCP 工具**（除了需求 5 的 report 工具）
- **不改变现有 workflow 的核心逻辑**（Property 契约、Branch_Detector、code-review 三态等全部保留）
- **不实施 Zmind Hub**（只做调研）
- **不 breaking-change 现有用户的 mcp.json**（SoT 是新增可选路径，env 方式保持向后兼容）
