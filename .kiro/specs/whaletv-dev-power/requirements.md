# 需求文档：WhaleTV Developer Power

## 简介

WhaleTV Developer Power（项目名：`whaletv-dev-power`）是一个面向 WhaleTV 全体开发者的 Kiro Power 工具包。它将团队已验证的 MCP 服务器、工作流指南（Steering Files）和领域知识打包为一个可直接导入使用的 Power，使任何 WhaleTV 开发者无需复杂配置即可获得 AI 辅助的 AOSP 开发能力，包括项目管理（Zmind）、代码搜索（OpenGrok）、PR/CR 处理、Cherry-Pick 同步、Bug 分析等核心工作流。

## 术语表

- **Power**: Kiro 生态中的可分发能力包，包含 MCP 服务器、Steering 文件和文档
- **MCP_Server**: 基于 Model Context Protocol 的工具服务器，为 AI 提供外部系统访问能力
- **Steering_File**: Power 中的工作流指南文件，指导 AI 按照特定流程执行任务
- **Zmind**: WhaleTV 内部基于 Redmine 的项目管理系统，用于 Issue/PR/CR/Task 跟踪
- **OpenGrok**: WhaleTV 部署的 AOSP 源码搜索引擎，提供全文搜索和符号定义查找
- **Gerrit**: WhaleTV 使用的代码评审系统，管理代码提交和 Review 流程
- **Cherry_Pick**: 将已合入 master 的提交同步到 MP（release）分支的操作
- **MP_Branch**: Maintenance Patch 分支，即 release 分支（如 os10_mp、os10_3_mp）
- **AOSP**: Android Open Source Project，Android 开源项目源码
- **Hook**: Kiro 中的自动化拦截机制，在特定事件触发时执行预定义动作
- **Developer**: WhaleTV 的 AOSP 系统开发工程师，Power 的目标用户

## 需求

### 需求 1：Power 整体结构与元数据

**用户故事：** 作为 WhaleTV 开发者，我希望导入 Power 后即可获得完整的开发辅助能力，以便无需额外配置就能开始使用 AI 辅助工作流。

#### 验收标准

1. THE Power SHALL 包含符合 Kiro Power 规范的 POWER.md 文件，其中必须定义以下字段：Power 名称（值为 "whaletv-dev-power"）、描述（不超过 200 字符的一句话说明）、关键词列表和所含 MCP 服务器列表
2. THE Power SHALL 定义关键词包括：whaletv, aosp, zmind, gerrit, opengrok, cherry-pick, pr, cr, android, 项目管理, 代码搜索
3. THE Power SHALL 包含至少两个 MCP 服务器配置：Zmind MCP Server 和 OpenGrok MCP Server，每个配置须包含服务器标识名、启动命令、所需环境变量声明
4. THE Power SHALL 包含至少五个 Steering 工作流指南文件，每个文件须位于 steering/ 目录下且包含明确的工作流步骤定义
5. WHEN Developer 通过 Kiro Powers 面板导入 Power 时，THE Power SHALL 在导入完成后即处于可激活状态，即 Kiro 能识别 POWER.md、列出所有已声明的 MCP 服务器、且 Steering 文件出现在可用指南列表中
6. IF POWER.md 文件缺少必需字段（名称、描述、关键词或 MCP 服务器列表），THEN THE Power SHALL 在导入时显示错误信息指明缺失的字段名称

### 需求 2：Zmind MCP 服务器

**用户故事：** 作为 WhaleTV 开发者，我希望 AI 能直接访问 Zmind 系统读写 Issue 信息，以便在终端内完成项目管理操作而无需切换到浏览器。

#### 验收标准

1. THE Zmind_MCP_Server SHALL 提供 get_issue 工具，接受数字类型的 Issue ID 参数，返回该 Issue 的主题、状态、优先级、指派人、项目、Tracker 类型、完成度、描述、评论历史、附件列表、关联关系、子任务列表及可流转状态
2. THE Zmind_MCP_Server SHALL 提供 my_issues 工具，接受状态过滤参数（可选值：open、closed、*，默认 open）和返回数量参数（默认 25，最大 100），返回当前用户被指派的 Issue 列表并按更新时间降序排列
3. THE Zmind_MCP_Server SHALL 提供 search_issues 工具，接受关键词（必填）、项目标识符（可选）、状态（可选，可选值：open、closed、*）、Tracker ID（可选）、指派人 ID（可选）和返回数量参数（默认 10，最大 100），返回匹配的 Issue 列表
4. THE Zmind_MCP_Server SHALL 提供 update_issue 工具，接受 Issue ID（必填）及以下可选字段：状态 ID、指派人 ID、优先级 ID、完成度（整数 0-100）、评论内容，且至少提供一个可选字段方可执行更新
5. THE Zmind_MCP_Server SHALL 提供 create_issue 工具，接受项目标识符（必填）和标题（必填）作为必填参数，以及描述、Tracker ID、优先级 ID、指派人 ID、父任务 ID、目标版本 ID 作为可选参数，成功后返回新创建的 Issue ID 及详情
6. THE Zmind_MCP_Server SHALL 提供 add_comment 工具，接受 Issue ID（必填）和评论内容（必填）参数，支持设置评论是否私密
7. THE Zmind_MCP_Server SHALL 提供 create_time_entry 工具，接受 Issue ID（必填）和工时小时数（必填，正数）参数，以及活动类型 ID、日期（格式 YYYY-MM-DD，默认当天）、备注作为可选参数
8. THE Zmind_MCP_Server SHALL 提供辅助查询工具：list_projects（返回项目列表）、get_versions（接受项目标识符，返回该项目版本列表）、get_project_members（接受项目标识符，返回该项目成员及角色列表）、get_issue_statuses（返回所有状态及其 ID）、get_trackers（返回所有 Tracker 类型及其 ID）、get_priorities（返回所有优先级及其 ID）
9. IF 环境变量 ZMIND_URL 或 ZMIND_API_KEY 未配置或为空字符串，THEN THE Zmind_MCP_Server SHALL 在工具调用时返回错误信息，指明缺失的具体变量名称
10. THE Zmind_MCP_Server SHALL 使用 stdio 传输协议与 Kiro 通信
11. IF Zmind API 返回非成功状态码（如 401、403、404、500），THEN THE Zmind_MCP_Server SHALL 返回包含 HTTP 状态码和 API 错误描述的错误信息，不抛出未捕获异常
12. IF update_issue 工具被调用时未提供任何可选更新字段，THEN THE Zmind_MCP_Server SHALL 返回错误信息指明至少需要提供一个要更新的字段

### 需求 3：OpenGrok MCP 服务器

**用户故事：** 作为 WhaleTV 开发者，我希望 AI 能搜索 AOSP 源码中的代码和符号定义，以便快速定位实现细节而无需手动在 OpenGrok 网页上逐步查找。

#### 验收标准

1. THE OpenGrok_MCP_Server SHALL 提供 search_code 工具，接受关键词参数（1 至 200 字符）和可选的最大返回条数参数（默认 20，上限 100），在 AOSP 源码中进行全文关键词搜索
2. THE OpenGrok_MCP_Server SHALL 提供 search_symbol 工具，接受符号名称参数（1 至 200 字符）和可选的最大返回条数参数（默认 20，上限 100），搜索类、方法、变量的定义位置
3. WHEN 搜索返回结果时，THE OpenGrok_MCP_Server SHALL 返回匹配的文件路径、行号和匹配行前后各 3 行的代码片段上下文
4. THE OpenGrok_MCP_Server SHALL 支持通过环境变量 OPENGROK_URL 配置 OpenGrok 服务地址
5. THE OpenGrok_MCP_Server SHALL 支持通过环境变量 OPENGROK_PROJECT 配置默认搜索的项目名称
6. IF OpenGrok 服务不可达，THEN THE OpenGrok_MCP_Server SHALL 返回包含服务地址的连接失败错误信息
7. THE OpenGrok_MCP_Server SHALL 使用 stdio 传输协议与 Kiro 通信
8. IF 搜索关键词为空或搜索未匹配到任何结果，THEN THE OpenGrok_MCP_Server SHALL 返回明确的提示信息，说明无匹配结果
9. IF OpenGrok 服务返回响应超过 15 秒，THEN THE OpenGrok_MCP_Server SHALL 终止请求并返回超时错误信息

### 需求 4：PR/CR 处理工作流指南

**用户故事：** 作为 WhaleTV 开发者，我希望 AI 能按照团队规范的完整流程处理 PR/CR，以便从获取任务到更新状态的全链路都能在终端内高效完成。

#### 验收标准

1. THE Power SHALL 包含 PR/CR 处理 Steering 文件，定义从获取 Zmind Issue 到更新 Zmind 状态的工作流，覆盖以下 9 个步骤：获取 Issue、分析问题、定位代码、修改代码、精确暂存、生成 Commit Message、推送 Gerrit、处理 Gerrit-AI 评论、更新 Zmind
2. THE Steering_File SHALL 指导 AI 按以下固定顺序执行：获取 Issue → 分析问题 → 定位代码 → 修改代码 → 展示 diff 并等待用户确认 → 精确暂存 → 生成 Commit Message → 等待用户确认后推送 Gerrit → 处理 Gerrit-AI 评论 → 更新 Zmind
3. THE Steering_File SHALL 定义 Commit Message 格式规范为第一行 `[版本号][类型][whaletv][Zmind#ID]简述`（其中类型取值限定为 bugfix、feature、refactor、hotfix 之一），后跟 what、why、how、test、impact 五个字段，每个字段各占一行且以 `[字段名]` 开头
4. THE Steering_File SHALL 要求 AI 在代码修改完成后，通过 `git diff` 展示完整变更内容，并等待用户输入明确的确认指令后才继续执行后续步骤
5. THE Steering_File SHALL 要求 AI 在执行 push 操作前，向用户展示将要推送的 commit 信息和目标分支，并等待用户输入明确的确认指令后才执行推送
6. THE Steering_File SHALL 指导 AI 使用 `git add -p` 进行 hunk 级别的精确暂存，仅暂存与当前 Issue 相关的代码变更，避免提交无关改动
7. IF 工作流中任一步骤执行失败（如 Zmind API 调用失败、Gerrit push 被拒绝、或 git 操作报错），THEN THE Steering_File SHALL 指导 AI 向用户报告失败步骤及错误信息，并等待用户指示后再决定重试或终止流程
8. THE Steering_File SHALL 定义"处理 Gerrit-AI 评论"步骤为：AI 逐条读取 Gerrit-AI 生成的评论，结合代码变更上下文判断是否采纳，对每条评论生成回复内容，并将评论标记为 resolved
9. THE Steering_File SHALL 定义"更新 Zmind"步骤为：AI 调用 Zmind API 在对应 Issue 下添加评论，评论内容包含本次修改摘要和 Gerrit Change 链接

### 需求 5：Cherry-Pick 工作流指南

**用户故事：** 作为 WhaleTV 开发者，我希望 AI 能自动化跨代码库的 Cherry-Pick 操作，以便将 master 的修复高效同步到多个 MP 分支而不遗漏。

#### 验收标准

1. THE Power SHALL 包含 Cherry-Pick Steering 文件，定义从用户提供 Zmind Issue ID 或 Gerrit Change 号开始，经过搜索源 Change、发现目标分支、用户确认、批量执行 CP、结果汇报到更新 Zmind 的完整流程
2. THE Steering_File SHALL 指导 AI 通过 Gerrit API 查询与指定 Issue 关联的所有已合入 master 的 Change，并识别每个 Change 所属的 project
3. THE Steering_File SHALL 指导 AI 通过 Gerrit API 查询每个相关 project 中名称匹配 MP 分支命名模式（如包含 `_mp` 后缀）的所有活跃分支作为 CP 目标
4. THE Steering_File SHALL 要求 AI 在执行 CP 前以表格形式展示完整计划（包含源 Change 号、源 project、目标分支列表），并等待用户明确确认后才开始执行
5. THE Steering_File SHALL 指导 AI 对每个 CP 结果分类汇报：成功（含新 Change 链接）、跳过（目标分支已包含等效提交）、冲突（列出冲突文件列表并说明需人工处理）
6. THE Steering_File SHALL 指导 AI 在 CP 完成后自动调用 add_comment 更新 Zmind Issue 评论，评论内容包含 CP 执行摘要表格（目标分支、状态、新 Change 链接）
7. IF CP 执行过程中 Gerrit API 调用失败，THEN THE Steering_File SHALL 指导 AI 停止后续 CP 操作，汇报已完成和未完成的项目，并等待用户决定是否重试

### 需求 6：Bug 分析工作流指南

**用户故事：** 作为 WhaleTV 开发者，我希望 AI 能自动化 Bug 分析流程（获取 Issue、下载日志、解析异常、定位代码），以便快速获得结构化的分析报告。

#### 验收标准

1. THE Power SHALL 包含 Bug 分析 Steering 文件，定义按以下顺序执行的工作流步骤：获取 Issue 详情 → 识别并下载日志附件 → 解析日志提取异常信息 → 在代码库中定位相关代码 → 输出结构化分析报告
2. THE Steering_File SHALL 指导 AI 自动识别 Issue 附件中文件名包含 log、logcat、trace、tombstone 或扩展名为 .log、.txt、.gz、.zip 的文件作为日志文件并下载
3. IF Issue 不包含任何可识别的日志附件，THEN THE Steering_File SHALL 指导 AI 在分析报告中标注"无日志附件"并基于 Issue 描述文本中的错误信息继续分析流程
4. THE Steering_File SHALL 指导 AI 从日志中提取异常堆栈（Exception/Error 及其调用链）、异常发生前后 5 秒内的时间点事件、以及重复出现 2 次以上的错误关键字
5. IF 日志中未发现异常堆栈或错误关键字，THEN THE Steering_File SHALL 指导 AI 在分析报告中标注"未发现明确异常"并列出日志中最后 20 行作为参考上下文
6. THE Steering_File SHALL 指导 AI 使用异常堆栈中的类名和方法名作为搜索关键词，通过 git grep 在代码库中定位相关代码
7. IF git grep 未返回匹配结果，THEN THE Steering_File SHALL 指导 AI 改用 OpenGrok search_symbol 工具进行二次搜索，并在报告中标注定位方式
8. THE Steering_File SHALL 定义分析报告的输出格式包含：现象（Issue 标题及复现条件）、关键 Log（不超过 30 行的核心异常日志片段）、根因定位（文件:行号）、修复建议（不超过 3 条可操作的修改方向）

### 需求 7：安全机制与 Hook 配置

**用户故事：** 作为 WhaleTV 开发者，我希望 Power 内置安全防护机制，以便 AI 不会执行危险操作（如误推 release 分支、执行 sudo 命令等）。

#### 验收标准

1. THE Power SHALL 包含安全规则 Steering 文件，定义三层安全防护体系（规则约束、Hook 拦截、人工确认），并明确各层的职责边界：规则约束用于指导 AI 行为、Hook 拦截用于命令执行前自动阻断、人工确认用于高风险操作的显式授权
2. THE Steering_File SHALL 定义规则约束：MP 分支禁止自动推送、git add 必须精确到 hunk 级别（使用 `git add -p`）、Target version 必须由用户明确指定（AI 不得根据分支名或上下文自行推断）
3. THE Steering_File SHALL 定义 Hook 拦截规则：禁止以 sudo 开头的命令、禁止在根目录（/）或家目录（~）执行 find 或 grep 命令、禁止写入 /tmp 路径（引导到 ~/tmp）、禁止对 out/ 或 prebuilts/ 目录执行 find、grep 或 ls -R 命令
4. THE Steering_File SHALL 定义人工确认场景：当存在多个可行方案需要选择时、执行任何 git push 操作前、跨代码库操作前需用户指定目标仓库范围
5. THE Power SHALL 包含预配置的 Hook 定义文件，针对验收标准 3 中列出的每条拦截规则定义对应的命令匹配模式
6. WHEN AI 尝试执行被拦截的操作时，THE Hook SHALL 阻止执行并向用户显示包含以下内容的拦截信息：被拦截的命令、拦截原因、推荐的安全替代操作（如将 /tmp 写入替换为 ~/tmp）
7. WHEN 人工确认场景触发时，THE Power SHALL 暂停当前工作流，向用户展示待确认的操作内容，并等待用户输入明确的确认指令后才继续执行

### 需求 8：环境配置与安装指南

**用户故事：** 作为 WhaleTV 开发者，我希望有清晰的配置指南，以便能快速完成 Power 的环境变量设置并开始使用。

#### 验收标准

1. THE Power SHALL 在 POWER.md 中包含环境变量配置章节，以表格形式列出所有环境变量，每个变量标注名称、用途说明、是否必需、以及格式示例
2. THE Power SHALL 要求以下环境变量用于 Zmind 连接：ZMIND_API_KEY（必需，用户 API 密钥）、ZMIND_URL（可选，Zmind 服务地址，默认值为 https://zmind.whaletv.com），并为每个变量提供格式示例
3. THE Power SHALL 要求以下环境变量用于 OpenGrok 连接：OPENGROK_URL（必需，OpenGrok 服务地址，格式为完整 URL）、OPENGROK_PROJECT（可选，默认搜索的项目名称），并为每个变量提供格式示例
4. THE Power SHALL 在 POWER.md 中说明 Power 适用于远程 Linux 服务器（CLI 环境），无需 GUI
5. THE Power SHALL 在 POWER.md 中说明系统要求：Ubuntu 20.04+ 和 Node.js 18+
6. IF 用户激活 Power 时必需的环境变量未设置，THEN THE Power SHALL 在 POWER.md 中提供排查步骤，包含：如何检查变量是否已设置（验证命令）、如何正确设置变量（设置命令示例）、以及常见配置错误的解决方法
7. THE Power SHALL 在 POWER.md 中提供配置验证方法，说明用户如何在激活 Power 前确认环境变量已正确设置且对应服务可达

### 需求 9：Gerrit 操作工作流指南

**用户故事：** 作为 WhaleTV 开发者，我希望 AI 能辅助处理 Gerrit 代码评审相关操作，以便高效完成代码推送和评论回复。

#### 验收标准

1. THE Power SHALL 包含 Gerrit 操作 Steering 文件，定义代码推送和评论处理的工作流
2. THE Steering_File SHALL 指导 AI 使用 gerritpush 命令推送代码，并根据用户指定或项目配置的 Reviewer 列表自动添加 Reviewer
3. WHEN 推送完成后，THE Steering_File SHALL 指导 AI 轮询等待 Gerrit-AI 评论（最多 3 次，间隔 15 秒）
4. IF 轮询 3 次后仍未获取到 Gerrit-AI 评论，THEN THE Steering_File SHALL 指导 AI 通知用户当前无评论并结束 Gerrit 评论处理流程
5. THE Steering_File SHALL 指导 AI 逐条分析 Gerrit-AI 评论，结合代码变更上下文判断是否采纳：采纳时修复代码并回复修复说明，不采纳时回复不采纳的理由
6. THE Steering_File SHALL 要求 AI 在回复每条评论时将该评论标记为 resolved

### 需求 10：Kiro CLI 本地源码集成

**用户故事：** 作为 WhaleTV 开发者，我希望在服务器上通过 Kiro CLI 打开 AOSP 源码目录后，AI 能直接读取、搜索和修改本地代码，以便结合源码上下文进行分析和开发而无需额外配置。

#### 验收标准

1. THE Power SHALL 在 Steering 文件中指导 AI 优先使用本地文件系统工具（读取文件、搜索文件内容）直接操作当前工作目录下的 AOSP 源码，而非仅依赖 OpenGrok 远程搜索
2. THE Power SHALL 在 Steering 文件中指导 AI 使用 `git grep` 作为本地代码搜索的首选方式，因其在大型 AOSP 代码库中性能优于 ripgrep（0.4s vs 40s），且能自动排除未跟踪文件
3. THE Steering_File SHALL 定义本地源码搜索策略的优先级顺序：① git grep 精确搜索 → ② 读取已知路径文件 → ③ OpenGrok 远程搜索（当本地搜索无结果或需要跨代码库搜索时使用）
4. THE Power SHALL 在 Steering 文件中指导 AI 在分析 Bug 或处理 PR 时，直接读取本地源码文件获取完整上下文（如类的完整实现、调用链上下游），而非仅依赖搜索结果片段
5. THE Power SHALL 在 Steering 文件中说明典型的工作目录结构（如 `~/cvte_code/amlogic/` 下包含 frameworks/base、packages/apps 等 AOSP 标准目录），以便 AI 能根据模块名快速定位到正确的子目录
6. THE Steering_File SHALL 指导 AI 在执行代码修改时，先确认当前 git 分支和工作区状态（`git status`、`git branch`），避免在错误的分支上操作
7. THE Power SHALL 在 POWER.md 中说明推荐的使用方式：在 AOSP 源码根目录或子模块目录下启动 Kiro CLI，使 AI 能直接访问项目文件
8. THE Steering_File SHALL 指导 AI 在需要跨多个代码库（11 套）操作时，提示用户切换到目标代码库目录或指定目标路径，而非假设所有代码库都在当前工作目录下
9. IF 用户在非 AOSP 源码目录下启动 Kiro CLI，THEN THE Steering_File SHALL 指导 AI 提示用户当前目录可能不是源码目录，并建议切换到正确的源码路径

### 需求 11：项目命名与发布配置

**用户故事：** 作为 Power 维护者，我希望项目有规范的命名和发布配置，以便其他开发者能通过 Kiro Powers 面板轻松发现和导入。

#### 验收标准

1. THE Power SHALL 使用 "whaletv-dev-power" 作为项目根目录名，且 POWER.md 中的 identifier 字段值与目录名一致
2. THE Power SHALL 在 POWER.md 中使用 "WhaleTV Developer Power" 作为显示名称
3. THE Power SHALL 在 POWER.md 中包含不超过 80 个字符的一句话描述：面向 WhaleTV 开发者的 AOSP 开发辅助工具包，集成 Zmind 项目管理、OpenGrok 代码搜索和团队标准工作流
4. THE Power SHALL 遵循 Kiro Power 标准目录结构，项目根目录下包含以下必需条目：POWER.md 文件、mcp-servers/ 目录（含各 MCP 服务器子目录）、steering/ 目录（含工作流指南文件）
5. THE Power SHALL 在 package.json 中为每个 MCP 服务器（Zmind MCP Server 和 OpenGrok MCP Server）声明以下内容：服务器名称、相对路径、启动命令、所需环境变量列表和 npm 依赖（含固定版本号）
6. THE Power SHALL 在 POWER.md 中包含符合语义化版本规范（MAJOR.MINOR.PATCH）的版本号字段
