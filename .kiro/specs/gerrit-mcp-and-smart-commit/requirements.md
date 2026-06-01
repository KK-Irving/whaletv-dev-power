# Requirements Document

## Introduction

本特性（Gerrit MCP Server 与智能 Commit Message 生成）在 `whaletv-dev-power` 中新增两大能力，使本地代码修改 → 提交 → Gerrit 推送的链路完全 MCP 化、智能化：

1. **Gerrit MCP Server**：独立的 MCP 服务器（位于 `mcp-servers/gerrit-mcp-server/`），通过 Gerrit REST API 提供读（Change/Branch/Comment 查询）和写（Cherry-Pick、推送 refs/for/xxx、评论操作、Reviewer/Label 管理）能力，替代当前依赖外部 `gerritpush` 命令的模式。
2. **智能 Commit Message 生成器**：基于 `git diff`、Zmind Issue 上下文和分支信息自动识别修改点和关联问题点，输出符合团队规范（首行 `[版本号][类型][whaletv][Zmind#ID]简述` + what/why/how/test/impact 五段式）的完整 Commit Message。

两大模块共同支撑端到端工作流（Zmind 分析 → Gerrit/文档检索 → 代码定位 → 修改 → hunk 级 add → 智能 commit → 用户确认 → 推送 → 验证），并要求更新现有 Steering 文件（pr-cr-workflow、gerrit-workflow、cherry-pick-workflow）和 POWER.md 元数据。

## Glossary

- **Power**: `whaletv-dev-power`，本仓库定义的 Kiro Power 工具包
- **Gerrit_MCP_Server**: 本特性新增的独立 MCP 服务器，位于 `mcp-servers/gerrit-mcp-server/`，通过 stdio 与 Kiro 通信
- **Gerrit_Query_Tool**: Gerrit MCP Server 提供的只读工具集合（query_change、list_branches、get_change_comments、search_changes）
- **Gerrit_Cherry_Pick_Tool**: Gerrit MCP Server 提供的 cherry-pick 工具（`cherry_pick_change`）
- **Gerrit_Push_Tool**: Gerrit MCP Server 提供的推送工具（`push_to_gerrit`），将本地 commit 推送到 `refs/for/<target_branch>`
- **Gerrit_Comment_Tool**: Gerrit MCP Server 提供的评论工具集合（`add_review_comment`、`reply_inline_comment`、`mark_comment_resolved`）
- **Gerrit_Reviewer_Tool**: Gerrit MCP Server 提供的 Reviewer/Label 管理工具集合（`add_reviewer`、`remove_reviewer`、`set_review_label`）
- **Commit_Message_Generator**: 本特性新增的智能 Commit Message 生成能力，由 Steering File 描述其行为契约（输入：git diff + Issue + 分支信息；输出：格式化 commit message）
- **Branch_Detector**: 远程目标分支识别能力，由 Steering File 描述多级降级策略
- **Steering_File**: Power 中位于 `steering/` 目录下的工作流指南文件
- **Developer**: 使用 Power 的 WhaleTV 开发工程师
- **Change**: Gerrit 中一次代码评审单元，由 Change-Id（如 `I1234567...`）或数字 Change Number 标识
- **MP_Branch**: 名称匹配 `*_mp` 模式的 release 分支（如 `os10_mp`、`os10_3_mp`）
- **Zmind_Issue_ID**: Zmind 系统中的 Issue 数字 ID（如 `334001`）
- **Refs_For_Target**: Gerrit 推送目标 ref，格式为 `refs/for/<target_branch>`，其中 `<target_branch>` 为远程分支名

## Requirements

### Requirement 1: Gerrit MCP Server 项目结构与发布配置

**User Story:** 作为 Power 维护者，我希望 Gerrit MCP Server 遵循现有 zmind-mcp-server 与 opengrok-mcp-server 的目录约定，以便发布、维护和测试方式保持一致。

#### Acceptance Criteria

1. THE Power SHALL 在 `mcp-servers/gerrit-mcp-server/` 目录下创建独立的 MCP 服务器项目，目录结构包含 `package.json`、`tsconfig.json`、`src/index.ts` 三个必需文件
2. THE Gerrit_MCP_Server `package.json` SHALL 声明包名 `@kk-irving/gerrit-mcp-server`、`type` 为 `module`、`bin` 字段映射到 `./dist/index.js`，且 `scripts` 字段包含 `start`（值为 `tsx src/index.ts`）、`build`（值为 `tsc`）、`prepublishOnly`（值为 `npm run build`）三项
3. THE Gerrit_MCP_Server `package.json` SHALL 声明运行时依赖 `@modelcontextprotocol/sdk` 版本 `1.12.1`、`zod` 版本 `3.24.4`，开发依赖 `typescript` 版本 `5.8.3`、`tsx` 版本 `4.19.4`、`@types/node` 版本 `24.0.3`
4. THE Gerrit_MCP_Server SHALL 使用 stdio 传输协议（`StdioServerTransport`）与 Kiro 通信
5. THE Gerrit_MCP_Server `tsconfig.json` SHALL 配置编译输出目录为 `dist/`、目标 ES 版本支持 Node.js 18+ 运行
6. WHEN Developer 执行 `npm run build` 时，THE Gerrit_MCP_Server SHALL 生成 `dist/index.js` 可执行入口文件，且文件首行包含 `#!/usr/bin/env node` shebang

### Requirement 2: Gerrit 认证与环境变量配置

**User Story:** 作为 Developer，我希望通过环境变量配置 Gerrit 认证凭据，以便 Gerrit MCP Server 在调用 REST API 时自动携带认证信息。

#### Acceptance Criteria

1. THE Gerrit_MCP_Server SHALL 通过环境变量 `GERRIT_URL` 读取 Gerrit 服务的基础 URL（格式为完整 HTTPS URL，例如 `https://whale-gerrit.zeasn.com`）
2. THE Gerrit_MCP_Server SHALL 通过环境变量 `GERRIT_USERNAME` 读取 Gerrit 用户名
3. THE Gerrit_MCP_Server SHALL 通过环境变量 `GERRIT_HTTP_PASSWORD` 读取 Gerrit HTTP Password（在 Gerrit Settings → HTTP Credentials 页面生成的 Token）
4. THE Gerrit_MCP_Server SHALL 在所有 REST API 请求的 `Authorization` 头中携带 HTTP Basic 认证（base64 编码的 `<GERRIT_USERNAME>:<GERRIT_HTTP_PASSWORD>`）
5. THE Gerrit_MCP_Server SHALL 在所有需要认证的 REST API 请求路径前自动追加 `/a/` 前缀（Gerrit 认证端点约定）
6. IF 环境变量 `GERRIT_URL`、`GERRIT_USERNAME` 或 `GERRIT_HTTP_PASSWORD` 中任意一个未配置或值为空字符串，THEN THE Gerrit_MCP_Server SHALL 在工具调用时（而非启动时）返回错误信息，错误信息中明确指出缺失的具体环境变量名；THE Gerrit_MCP_Server SHALL 允许在缺少 Gerrit 凭据的情况下完成进程启动并向 Kiro 完成 MCP 握手
7. THE Gerrit_MCP_Server SHALL 在解析 Gerrit REST API 响应时跳过响应体首行的 `)]}'` XSSI 防护前缀后再解析 JSON
8. WHERE 环境变量 `GERRIT_TIMEOUT_MS` 已配置为任意正整数（毫秒），THE Gerrit_MCP_Server SHALL 使用该值作为单次 HTTP 请求超时（即使该值小于 30000 也仍以配置值为准）；WHERE `GERRIT_TIMEOUT_MS` 未配置或值不为正整数，THE Gerrit_MCP_Server SHALL 使用默认值 30000 毫秒

### Requirement 3: Gerrit 读操作工具集

**User Story:** 作为 Developer，我希望通过 MCP 工具查询 Gerrit Change 详情、分支列表和评论，以便完成历史检索、CP 目标分支发现和评论上下文分析。

#### Acceptance Criteria

1. THE Gerrit_MCP_Server SHALL 提供 `query_change` 工具，接受 Change 标识符（必填，可为 Change-Id 字符串如 `I1234567...`、数字 Change Number 或 `<project>~<branch>~<changeId>` 三元组），返回 Change 的 subject、status、project、branch、owner、当前 patch set 编号、关联的 Topic、关联的 Issue ID（从 commit message 提取）
2. THE Gerrit_MCP_Server SHALL 提供 `list_branches` 工具，接受 project 标识符（必填）和分支名匹配模式（可选，如 `_mp`），返回该 project 下匹配的分支列表，每条记录包含分支全名（如 `refs/heads/os10_mp`）和当前 HEAD commit
3. THE Gerrit_MCP_Server SHALL 提供 `get_change_comments` 工具，接受 Change 标识符（必填），返回该 Change 上所有评论（review 评论与 inline 评论），每条评论包含评论 ID、作者、时间、所在文件路径（inline 评论）、所在行号（inline 评论）、评论文本、`unresolved` 标志
4. THE Gerrit_MCP_Server SHALL 提供 `search_changes` 工具，接受 Gerrit 查询字符串（必填，遵循 Gerrit search syntax 如 `topic:332669 status:merged branch:master`）和返回数量上限（可选，默认 25，最大 100），返回匹配的 Change 列表
5. WHEN 任一读操作工具被调用且 Change 标识符无效或不存在时，THE Gerrit_MCP_Server SHALL 返回错误信息，错误信息中包含原始的 Change 标识符值
6. WHEN `list_branches` 未匹配到任何分支时，THE Gerrit_MCP_Server SHALL 返回空数组并附带说明 `no branches matched the pattern`，不抛出异常
7. WHEN `get_change_comments` 返回评论列表时，THE Gerrit_MCP_Server SHALL 按时间升序排列评论

### Requirement 4: Gerrit Cherry-Pick 写操作

**User Story:** 作为 Developer，我希望通过 MCP 工具程序化执行 Cherry-Pick，以便跨分支同步修复时无需依赖 git CLI 的复杂操作。

#### Acceptance Criteria

1. THE Gerrit_MCP_Server SHALL 提供 `cherry_pick_change` 工具，接受源 Change 标识符（必填）、目标分支名（必填，如 `os10_mp`）、目标分支的 commit message 覆盖文本（可选，默认沿用源 Change 的 commit message）
2. WHEN `cherry_pick_change` 被调用且 Gerrit 返回成功时，THE Gerrit_MCP_Server SHALL 返回结果对象，其中 `status` 字段值为 `success`，并包含新创建的目标 Change 的 Change-Id、Change Number 和 Web URL
3. IF Gerrit API 返回 HTTP 409 Conflict 表示目标分支已包含等效提交，THEN THE Gerrit_MCP_Server SHALL 返回结构化结果对象，其中 `status` 字段值为 `skipped_already_merged`、`reason` 字段说明已存在等效提交
4. IF Gerrit API 返回 HTTP 409 Conflict 表示 cherry-pick 产生代码冲突，THEN THE Gerrit_MCP_Server SHALL 返回结构化结果对象，其中 `status` 字段值为 `conflict`、并在 `conflicting_files` 字段中列出从 Gerrit 响应解析出的冲突文件路径列表
5. IF Gerrit API 返回 HTTP 404（无论原因为目标分支不存在、权限不足导致 404 还是其他），THEN THE Gerrit_MCP_Server SHALL 终止 cherry-pick 操作并返回错误信息明确指出目标分支不存在（不返回结构化的 status 对象）
6. WHEN `cherry_pick_change` 调用成功时，THE Gerrit_MCP_Server SHALL 在 commit message 中保留源 Change 的 Change-Id 行（除非调用者通过参数显式覆盖）

### Requirement 5: Gerrit 推送写操作（替代 gerritpush）

**User Story:** 作为 Developer，我希望通过 MCP 工具将本地 commit 推送到 Gerrit 的 refs/for/xxx，以便不再依赖外部 `gerritpush` 命令完成推送。

#### Acceptance Criteria

1. THE Gerrit_MCP_Server SHALL 提供 `push_to_gerrit` 工具，接受本地工作目录绝对路径（必填）、目标远程分支名（必填，如 `master`、`os10_mp`）、Reviewer 邮箱列表（可选）、是否标记为 work-in-progress（可选布尔值，默认 false）、Topic 字符串（可选）
2. WHEN `push_to_gerrit` 被调用时，THE Gerrit_Push_Tool SHALL 在指定工作目录中执行 `git push <gerrit_remote> HEAD:refs/for/<target_branch>` 命令，其中 `<gerrit_remote>` 通过查询本地 git 配置确定（默认尝试 `gerrit`，若不存在则尝试 `origin`）
3. WHERE 调用方提供 Reviewer 邮箱列表，THE Gerrit_Push_Tool SHALL 在推送命令中追加 `%r=<email1>,r=<email2>,...` 的 push option
4. WHERE 调用方将 work-in-progress 参数设为 true，THE Gerrit_Push_Tool SHALL 在推送命令中追加 `%wip` push option
5. WHERE 调用方提供 Topic 字符串，THE Gerrit_Push_Tool SHALL 在推送命令中追加 `%topic=<topic>` push option
6. IF 目标分支名匹配 `*_mp` 模式（MP 分支），THEN THE Gerrit_Push_Tool SHALL 拒绝执行推送（不调用 `git push`），返回工具自有的结构化错误对象，其中 `error_type` 字段值为 `mp_branch_push_blocked`、`message` 字段说明 MP 分支必须由 Developer 在 Steering 工作流中显式确认后通过其他流程推送（不接受自动推送），且不返回 git 退出码
7. WHEN `git push` 命令成功完成时，THE Gerrit_Push_Tool SHALL 解析 stderr 输出中的 Gerrit Change URL，并在返回结果中包含该 URL；IF 解析失败，THEN THE Gerrit_Push_Tool SHALL 返回原始 stderr 文本并在结果中标注 `change_url_unavailable`
8. IF `git push` 命令以非零状态码退出，THEN THE Gerrit_Push_Tool SHALL 返回错误信息，错误信息中包含 stderr 完整文本和退出码

### Requirement 6: Gerrit 评论写操作

**User Story:** 作为 Developer，我希望通过 MCP 工具添加 review 评论、回复 inline 评论并标记 resolved，以便在终端内完成 Gerrit 评论处理工作流。

#### Acceptance Criteria

1. THE Gerrit_MCP_Server SHALL 提供 `add_review_comment` 工具，接受 Change 标识符（必填）、评论文本（必填）、可选 patch set 编号（默认值为当前 patch set），向指定 Change 添加 review 级别评论
2. THE Gerrit_MCP_Server SHALL 提供 `reply_inline_comment` 工具，接受 Change 标识符（必填）、原 inline 评论 ID（必填）、回复文本（必填）、是否标记 resolved（必填布尔值），在指定 inline 评论上发布回复
3. THE Gerrit_MCP_Server SHALL 提供 `mark_comment_resolved` 工具，接受 Change 标识符（必填）、评论 ID（必填），将该评论的 `unresolved` 标志置为 false（不附带新的回复文本）
4. WHEN `add_review_comment` 或 `reply_inline_comment` 调用成功时，THE Gerrit_Comment_Tool SHALL 在返回结果中包含新评论的 ID 和创建时间
5. IF 评论文本为空字符串或仅包含空白字符，THEN THE Gerrit_Comment_Tool SHALL 拒绝执行并返回错误信息说明评论文本不可为空
6. IF 调用 `reply_inline_comment` 或 `mark_comment_resolved` 时提供的评论 ID 在该 Change 上不存在，THEN THE Gerrit_Comment_Tool SHALL 返回错误信息明确指出评论 ID 不存在

### Requirement 7: Gerrit Reviewer 与 Code-Review 标签管理

**User Story:** 作为 Developer，我希望通过 MCP 工具管理 Reviewer 和设置 Code-Review 标签，以便完成代码评审流程的元数据操作。

#### Acceptance Criteria

1. THE Gerrit_MCP_Server SHALL 提供 `add_reviewer` 工具，接受 Change 标识符（必填）、Reviewer 邮箱或用户名（必填），将该用户添加为 Change 的 Reviewer
2. THE Gerrit_MCP_Server SHALL 提供 `remove_reviewer` 工具，接受 Change 标识符（必填）、Reviewer 邮箱或用户名（必填），将该用户从 Change 的 Reviewer 列表移除
3. THE Gerrit_MCP_Server SHALL 提供 `set_review_label` 工具，接受 Change 标识符（必填）、标签名（必填，如 `Code-Review`、`Verified`）、标签值（必填，整数取值范围 -2 至 +2），在当前 patch set 上设置该标签
4. WHEN `add_reviewer` 调用成功时，THE Gerrit_Reviewer_Tool SHALL 返回结果中包含被添加用户的账号 ID 和确认信息
5. IF `set_review_label` 的标签值超出 -2 至 +2 范围，THEN THE Gerrit_Reviewer_Tool SHALL 拒绝执行并返回错误信息说明合法值范围
6. IF `add_reviewer` 提供的用户邮箱或用户名在 Gerrit 中不存在（Gerrit 返回 HTTP 422 或 404），THEN THE Gerrit_Reviewer_Tool SHALL 返回错误信息明确指出用户标识符无效
7. IF 当前认证用户对 Change 无权限设置指定标签（Gerrit 返回 HTTP 403），THEN THE Gerrit_Reviewer_Tool SHALL 返回错误信息明确指出权限不足

### Requirement 8: Gerrit MCP Server 错误处理与超时

**User Story:** 作为 Developer，我希望 Gerrit MCP Server 在网络异常、服务不可达和各类 HTTP 错误下都能返回结构化错误，以便 AI 能据此向我汇报具体故障原因。

#### Acceptance Criteria

1. IF Gerrit REST API 返回 HTTP 401，THEN THE Gerrit_MCP_Server SHALL 返回错误信息，错误信息中包含 HTTP 状态码 401、提示语 `Gerrit 认证失败`、以及检查 `GERRIT_USERNAME` 和 `GERRIT_HTTP_PASSWORD` 的建议
2. IF Gerrit REST API 返回 HTTP 403，THEN THE Gerrit_MCP_Server SHALL 返回错误信息，错误信息中包含 HTTP 状态码 403、提示语 `当前用户对该资源无操作权限`、以及目标资源标识
3. IF Gerrit REST API 返回 HTTP 404，THEN THE Gerrit_MCP_Server SHALL 返回错误信息，错误信息中包含 HTTP 状态码 404、提示语 `资源不存在`、以及被访问的资源标识（如 Change-Id 或分支名）
4. IF Gerrit REST API 返回 HTTP 409，THEN THE Gerrit_MCP_Server SHALL 在结果对象中区分 `conflict`（代码冲突）与 `skipped_already_merged`（已存在等效提交）两种业务语义，且不抛出未捕获异常
5. IF Gerrit REST API 返回 HTTP 5xx，THEN THE Gerrit_MCP_Server SHALL 返回错误信息，错误信息中包含 HTTP 状态码、Gerrit 响应体的前 500 字符
6. IF HTTP 请求耗时超过配置的超时阈值（来自 `GERRIT_TIMEOUT_MS` 或默认 30000 毫秒），THEN THE Gerrit_MCP_Server SHALL 终止该请求并返回超时错误，错误信息中包含目标 URL 和实际超时时长
7. IF Gerrit 服务地址 DNS 解析失败或 TCP 连接被拒绝，THEN THE Gerrit_MCP_Server SHALL 返回错误信息，错误信息中包含 `GERRIT_URL` 配置值和原始网络错误描述
8. WHEN 任一工具因配置错误、网络错误、API 错误或程序内部异常失败时，THE Gerrit_MCP_Server SHALL 在 MCP 响应中返回结构化错误对象（包含 `error_type`、`message`、`http_status` 三个字段），将所有抛出的异常（包括非预期的程序异常）统一捕获并转换为结构化错误，不向 MCP 客户端泄露未被 catch 的异常

### Requirement 9: 智能 Commit Message 生成器输入与输出契约

**User Story:** 作为 Developer，我希望 AI 在 commit 阶段自动分析 git diff 和上下文生成完整的 Commit Message，以便不再需要手工填写 what/why/how/test/impact 五段式。

#### Acceptance Criteria

1. THE Power SHALL 包含名为 `commit-message-workflow.md` 的 Steering File（位于 `steering/` 目录），该文件描述 Commit_Message_Generator 的输入、输出与执行步骤
2. THE Steering_File SHALL 定义 Commit_Message_Generator 的输入包含以下三类信息：暂存区 git diff（来自 `git diff --staged`）、Zmind Issue 详情对象（subject、description、tracker、target_version、journals）、当前分支信息（本地分支名、上游远程分支名、由 Branch_Detector 识别的目标推送分支名）
3. THE Steering_File SHALL 定义 Commit_Message_Generator 的输出格式与 pr-cr-workflow Steering File 中已规定的格式一致：第一行格式为 `[版本号][类型][whaletv][Zmind#ID]简述`，其后包含 `[what]`、`[why]`、`[how]`、`[test]`、`[impact]` 五个字段，每个字段独占一行且以字段名开头
4. THE Steering_File SHALL 指导 AI 通过分析 git diff 自动生成 `[what]` 字段：列出本次修改的文件路径、被修改的函数或类名、新增/删除/修改的代码行数概要
5. THE Steering_File SHALL 指导 AI 通过结合 Issue subject、description 和 journals 自动生成 `[why]` 字段：说明本次修改对应的问题现象或需求背景
6. THE Steering_File SHALL 指导 AI 通过结合 git diff 中的代码变更逻辑自动生成 `[how]` 字段：用一句话概括技术方案
7. THE Steering_File SHALL 指导 AI 自动生成 `[test]` 字段，从 Zmind Issue 描述或评论中提取复现/验证步骤；IF Issue 中无明确验证步骤，THEN AI SHALL 基于 git diff 推断出至少一条手动验证步骤建议
8. THE Steering_File SHALL 指导 AI 通过分析 git diff 涉及的模块（基于文件路径）自动生成 `[impact]` 字段：列出受影响的模块或子系统名称
9. WHEN Commit_Message_Generator 完成所有字段（首行、what、why、how、test、impact）的生成且每个字段均为非空文本时，THE Steering_File SHALL 要求 AI 在执行 `git commit` 前向 Developer 展示 Commit Message 全文（即使首行长度超过第 10 条约束的 100 字符上限也照原文展示，由 Developer 决定是否修订）并等待 Developer 输入明确的确认指令；IF 任一字段生成失败或为空，THEN AI SHALL 在补全该字段前不展示完整 Commit Message 也不允许 Developer 进入确认状态；IF Developer 要求修改某字段，THEN AI SHALL 重新生成该字段后重新展示完整 Commit Message
10. THE Steering_File SHALL 定义生成的 Commit Message 满足以下结构性约束：第一行总长度不超过 100 个字符（用于 git log 一行展示）、五个字段段之间不插入空行（保持紧凑）、字段顺序固定为 what → why → how → test → impact
11. THE Commit_Message_Generator 输出的 Commit Message 文本 SHALL 可被解析回结构化字段，对于任意合法的 Commit Message 字段对象 m，parse(format(m)) 等价于 m，以便后续工具能从已存在的 commit 中重新提取字段做二次处理

### Requirement 10: 智能 Commit Message 字段自动补全规则

**User Story:** 作为 Developer，我希望 Commit Message 中的版本号、类型、Zmind#ID 等元数据由 AI 自动从 Issue 上下文补全，以便我只需关注修改本身而非格式化字段。

#### Acceptance Criteria

1. THE Steering_File SHALL 定义版本号字段的来源严格优先级（严格按序，前一级有值时不参考后续级）：① Zmind Issue 的 `target_version`（即 fixed_version）字段 → ② Developer 在当前会话中显式指定的版本号 → ③ 询问 Developer；WHEN Issue 的 `target_version` 字段有值，THE AI SHALL 直接使用该值且不接受 Developer 的覆盖输入
2. THE Steering_File SHALL 禁止 AI 从分支名（如 `os10_mp`）、commit 历史或其他间接信息推断版本号；IF 上述三个来源均未提供版本号，THEN AI SHALL 询问 Developer 提供版本号且不得自行填充
3. THE Steering_File SHALL 定义类型字段（取值限定为 `bugfix`、`feature`、`refactor`、`hotfix` 之一）的推断规则：WHEN Issue 的 Tracker 为 `Bug`，THE AI SHALL 选择 `bugfix`；WHEN Issue 的 Tracker 为 `Feature`，THE AI SHALL 选择 `feature`；WHEN Issue 的 Tracker 不为前两类，THE AI SHALL 询问 Developer 选择类型
4. THE Steering_File SHALL 定义 Zmind#ID 字段的来源：当前正在处理的 Zmind Issue 的数字 ID
5. THE Steering_File SHALL 定义简述字段的生成规则：基于 git diff 的核心修改内容，长度不超过 50 个字符，使用动词开头（如 `修复`、`新增`、`重构`）
6. IF 当前会话上下文中未关联任何 Zmind Issue，THEN AI SHALL 拒绝生成 Commit Message 并提示 Developer 先关联 Issue（提供 Issue ID 或通过 PR/CR 工作流上下文）

### Requirement 11: 远程目标分支识别（Branch_Detector）

**User Story:** 作为 Developer，我希望 AI 在推送 Gerrit 前能自动识别正确的远程目标分支，以便 `refs/for/<target_branch>` 中的 `<target_branch>` 不会出错。

#### Acceptance Criteria

1. THE Power SHALL 在 Steering 文件中定义 Branch_Detector 的多级降级识别策略，按以下顺序尝试：① 读取 `git rev-parse --abbrev-ref @{upstream}` 的输出并提取远程分支名 → ② 读取 `git config branch.<current>.merge` 的值并提取分支名 → ③ 读取仓库根目录的 `.gitreview` 文件中 `defaultbranch` 字段 → ④ 通过 `git log` 检查最近 commit 的 Change-Id 在 Gerrit 中关联的分支 → ⑤ 询问 Developer
2. WHEN Branch_Detector 在某一级成功识别出非空的目标分支名时，THE Branch_Detector SHALL 停止后续降级尝试并返回该分支名及其识别来源（用于向 Developer 展示）
3. WHEN Branch_Detector 完成识别时，THE Steering_File SHALL 要求 AI 向 Developer 展示识别出的目标分支名和识别来源，并等待 Developer 输入明确的确认指令后才用于推送
4. IF 多级策略均未识别出目标分支名，THEN THE Branch_Detector SHALL 询问 Developer 提供目标分支名且不得自行填充；WHEN Developer 输入了非空分支名作为响应，THE Branch_Detector SHALL 将该分支名作为最终识别结果并完成识别流程，进入第 2 条与第 3 条定义的展示与确认环节
5. IF 识别出的目标分支名匹配 `*_mp` 模式（MP_Branch），THEN THE Steering_File SHALL 要求 AI 在展示给 Developer 时附加显著警告标记，提示 MP 分支推送需要额外确认
6. THE Branch_Detector SHALL 不依赖任何远程网络调用即可完成 ① 至 ③ 级识别（仅基于本地 git 命令和文件读取），仅 ④ 级（Change-Id 反查）需要 Gerrit MCP 工具调用

### Requirement 12: 端到端工作流与现有 Steering 集成

**User Story:** 作为 Developer，我希望从 Zmind 分析到 Gerrit 推送的完整链路使用新的 Gerrit MCP 工具和智能 Commit Message 生成器，以便现有 Steering 工作流不再依赖外部 `gerritpush` 命令。

#### Acceptance Criteria

1. THE Power SHALL 更新 `steering/pr-cr-workflow.md`，将原"⑥ 生成 Commit Message"步骤的 Commit Message 生成方式替换为调用 Commit_Message_Generator，且步骤序列前后保持一致
2. THE Power SHALL 更新 `steering/pr-cr-workflow.md`，将原"⑦ 推送 Gerrit"步骤的推送方式从 `gerritpush` 命令替换为调用 Gerrit_Push_Tool，并通过 Branch_Detector 识别目标分支
3. THE Power SHALL 更新 `steering/pr-cr-workflow.md`，将原"⑧ 处理 Gerrit-AI 评论"步骤的评论操作替换为调用 Gerrit_Comment_Tool 实现回复和 mark resolved
4. THE Power SHALL 更新 `steering/gerrit-workflow.md`，将原"① 推送代码"步骤的 `gerritpush` 调用替换为调用 Gerrit_Push_Tool，并将原"② 轮询等待 Gerrit-AI 评论"步骤的评论查询替换为调用 Gerrit_Query_Tool 的 `get_change_comments`
5. THE Power SHALL 更新 `steering/gerrit-workflow.md`，将原"③ 评论处理"步骤中的回复和 mark resolved 操作替换为调用 Gerrit_Comment_Tool
6. THE Power SHALL 更新 `steering/cherry-pick-workflow.md`，将原"② 搜索 master 已合入的 Changes"步骤替换为调用 Gerrit_Query_Tool 的 `search_changes`，将原"③ 发现目标 MP 分支"步骤替换为调用 `list_branches`，将原"⑤ 批量执行 Cherry-Pick"步骤替换为调用 Gerrit_Cherry_Pick_Tool
7. THE Power SHALL 在新增的 `steering/commit-message-workflow.md` 中定义端到端工作流的入口步骤序列：① 分析 Zmind Issue（含附件分析） → ② 通过 Gerrit_Query_Tool 检索历史 Change（同文件/同 Issue） → ③ 本地代码分析（git grep + OpenGrok 降级） → ④ 修改代码 → ⑤ 用户确认 diff → ⑥ `git add -p` → ⑦ Commit_Message_Generator 生成 commit message → ⑧ 用户确认 → ⑨ Gerrit_Push_Tool 推送 → ⑩ 用户验证修复效果
8. THE Power SHALL 在所有更新后的 Steering File 中保留原有的"用户确认点"约束（diff 确认、push 确认），且不削弱任何已有的安全约束

### Requirement 13: POWER.md 元数据与 mcp.json 更新

**User Story:** 作为 Power 维护者，我希望 POWER.md 和 mcp.json 反映新增的 Gerrit MCP Server，以便 Developer 在导入 Power 后即可看到新工具并完成配置。

#### Acceptance Criteria

1. THE Power SHALL 更新 `POWER.md` 的 `keywords` 字段，新增以下关键词：`gerrit-mcp`、`commit-message`、`cherry-pick`（如已存在则保留），且不删除现有关键词
2. THE Power SHALL 更新 `POWER.md` 的"MCP 服务器"表格，新增 `gerrit-mcp-server` 一行，记录其工具数量与功能概述（含读+写操作）
3. THE Power SHALL 更新 `POWER.md` 的"环境变量说明"表格，新增以下三个变量：`GERRIT_URL`（必需）、`GERRIT_USERNAME`（必需）、`GERRIT_HTTP_PASSWORD`（必需），并在表格中为每个变量提供用途说明和示例
4. THE Power SHALL 更新 `POWER.md` 的"mcp.json 配置（关键步骤）"章节，在 JSON 示例中新增 `gerrit-mcp-server` 条目，含 `command`、`args`、`env`、`disabled` 字段
5. THE Power SHALL 更新仓库根目录 `mcp.json` 文件，新增 `gerrit-mcp-server` 配置项，结构与示例与现有 `zmind-mcp-server` 项保持一致（包含 `command`、`args`、`env`、`disabled`、`autoApprove` 字段），且 `env` 中包含三个 Gerrit 环境变量占位（值为空字符串）
6. THE Power SHALL 在 `POWER.md` 的"Gerrit MCP Server 工具列表"小节列出所有新增工具的名称（query_change、list_branches、get_change_comments、search_changes、cherry_pick_change、push_to_gerrit、add_review_comment、reply_inline_comment、mark_comment_resolved、add_reviewer、remove_reviewer、set_review_label）及一句话用途
7. THE Power SHALL 在 `POWER.md` 的"配置验证"小节新增 Gerrit 连接验证命令（例如使用 `curl -u "$GERRIT_USERNAME:$GERRIT_HTTP_PASSWORD" "$GERRIT_URL/a/accounts/self"` 检查 HTTP 状态为 200）

### Requirement 14: 写操作的安全约束与人工授权

**User Story:** 作为 Developer，我希望 Gerrit MCP Server 的写操作和智能 Commit Message 生成器都受到与现有 safety-rules 一致的人工授权约束，以便不会因 AI 自动化导致误推或误操作。

#### Acceptance Criteria

1. THE Steering_File SHALL 要求 AI 在调用 Gerrit_Push_Tool 前向 Developer 展示以下信息并等待明确确认：commit message 全文、目标分支名、Branch_Detector 识别来源、Reviewer 列表
2. IF Branch_Detector 识别出的目标分支匹配 `*_mp` 模式，THEN THE Steering_File SHALL 要求 AI 向 Developer 展示二次确认提示（与一般推送区分开），且 Developer 必须输入明确确认才允许推送
3. THE Steering_File SHALL 要求 AI 在调用 Gerrit_Cherry_Pick_Tool 之前展示完整 CP 计划（源 Change、目标分支、合计次数）并等待 Developer 明确确认；IF 目标分支为 MP_Branch，THEN AI SHALL 在确认提示中显著标注 MP 分支风险
4. THE Steering_File SHALL 要求 AI 在调用 Gerrit_Reviewer_Tool 的 `set_review_label` 设置 `Code-Review` 标签为非零值（即 +1、+2、-1、-2）之前，向 Developer 展示标签值和目标 Change 并等待明确确认
5. THE Steering_File SHALL 要求 AI 在调用 Commit_Message_Generator 后，向 Developer 展示生成的 Commit Message 全文并等待明确确认；IF Developer 拒绝或要求修改，THEN AI SHALL 不执行 `git commit` 直到 Developer 确认
6. THE hooks/safety-hooks.json 文件 SHALL 不包含任何会拦截新增 Gerrit MCP 工具调用的规则（即 MCP 工具调用走 Steering 层人工确认，不走 Hook 层 shell 命令拦截），但 SHALL 保留对 `git push` shell 命令的现有拦截规则
7. THE Steering_File SHALL 要求 AI 在 `git add -p` 之后、调用 Commit_Message_Generator 之前再次执行 `git diff --staged` 并展示给 Developer 确认（保留 pr-cr-workflow 中现有的 diff 确认约束）

### Requirement 15: 与 Zmind 附件分析的端到端衔接

**User Story:** 作为 Developer，我希望端到端工作流的"分析 Zmind"步骤能同步分析 PR 中的附件（日志、截图、复现步骤），以便后续的代码定位和 Commit Message 生成有更完整的上下文。

#### Acceptance Criteria

1. THE Steering_File `commit-message-workflow.md` SHALL 在"① 分析 Zmind Issue"步骤中要求 AI 调用 Zmind MCP 的 `get_issue` 后，进一步遍历 Issue 的 `attachments` 字段，并按现有 bug-analysis-workflow Steering File 中已定义的附件分类规则（日志/配置/压缩包/图片/视频/文档）进行分类
2. THE Steering_File SHALL 要求 AI 对分类为"日志"或"配置"的附件直接调用 Zmind MCP 的 `download_attachment` 进行内容获取
3. WHERE 附件分类为"压缩包"、"图片"或"视频"，THE Steering_File SHALL 要求 AI 向 Developer 展示附件清单并询问是否需要下载，不自动下载
4. THE Steering_File SHALL 要求 AI 在 Commit_Message_Generator 的输入中，将下载到的日志关键摘要（异常堆栈、错误关键字）注入到生成 `[why]` 字段的上下文中
5. IF Issue 不包含任何附件，THEN THE Steering_File SHALL 要求 AI 仅基于 Issue 的 subject、description、journals 继续后续步骤，不阻塞工作流
