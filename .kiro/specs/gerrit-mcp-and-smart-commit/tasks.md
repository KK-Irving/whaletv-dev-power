# Implementation Plan: Gerrit MCP Server 与智能 Commit Message 生成

## Overview

本实施计划将 design.md 中的架构、12 工具表、Branch_Detector 五级策略、format/parse 契约和 21 个 Correctness Properties 拆解为可由代码生成 LLM 增量执行的步骤。组织上分为 6 个模块：

1. **Module 1**：Gerrit MCP Server 项目骨架与基础设施层（auth / http-client / errors / types）
2. **Module 2**：4 个 Gerrit 读操作工具（query_change / list_branches / get_change_comments / search_changes）
3. **Module 3**：8 个 Gerrit 写操作工具（cherry-pick / push / comment×3 / reviewer×3）
4. **Module 4**：Commit_Message_Generator 与 Branch_Detector 的 Steering File 与契约 PBT
5. **Module 5**：现有 Steering File（pr-cr / gerrit / cherry-pick）与新工具集成
6. **Module 6**：POWER.md 与 mcp.json 元数据更新

每个模块结束有 Checkpoint 任务用于阶段性验证。所有属性测试 (PBT) 任务作为 sub-task 紧贴对应实现，统一使用 `fast-check` + `Vitest`，并按 `[ ]*` 形式标记为可选（MVP 路径可跳过）。实现语言为 **TypeScript**（与 zmind-mcp-server / opengrok-mcp-server 一致，design.md 已锁定）。

## Tasks

- [x] 1. Gerrit MCP Server 项目骨架与基础设施
  - [x] 1.1 创建目录树与项目配置文件
    - 创建目录 `mcp-servers/gerrit-mcp-server/src/` 与 `mcp-servers/gerrit-mcp-server/src/tools/`
    - 创建 `package.json`：`name=@kk-irving/gerrit-mcp-server`，`version=0.1.0`，`type=module`，`bin={"gerrit-mcp-server":"./dist/index.js"}`，`main="./dist/index.js"`
    - `package.json` `scripts` 字段：`start`(值 `tsx src/index.ts`)、`build`(值 `tsc`)、`prepublishOnly`(值 `npm run build`)
    - `package.json` `dependencies`：`@modelcontextprotocol/sdk@1.12.1`、`zod@3.24.4`
    - `package.json` `devDependencies`：`typescript@5.8.3`、`tsx@4.19.4`、`@types/node@24.0.3`、`vitest@^1.6.0`、`fast-check@^3.20.0`
    - 创建 `tsconfig.json`：`target=ES2022`、`module=NodeNext`、`moduleResolution=NodeNext`、`outDir=dist`、`rootDir=src`、`strict=true`、`esModuleInterop=true`、`skipLibCheck=true`、`declaration=false`
    - 创建占位 `src/index.ts`：首行 `#!/usr/bin/env node`，仅初始化 `Server`、注册空的 ListTools handler、`StdioServerTransport.connect()` 并 `console.error` 一行启动日志（避免污染 stdio 协议）
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 1.2 实现基础设施模块（auth / http-client / errors / types）
    - 创建 `src/types.ts`：导出 `GerritChange`、`GerritBranch`、`GerritComment`、`CherryPickResult`、`PushResult`、`BranchDetectionResult`、`CommitMessageFields`、`StructuredErrorPayload` 等类型，与 design Data Models 一致
    - 创建 `src/auth.ts`：导出 `getGerritConfig()`（一次性读取 `GERRIT_URL` / `GERRIT_USERNAME` / `GERRIT_HTTP_PASSWORD` / `GERRIT_TIMEOUT_MS`）、`requireGerritConfig()`（缺任一必需变量则抛 `StructuredError(error_type="config_error")`）、`basicAuthHeader(username, password)`（返回 `"Basic " + base64(username + ":" + password)`，Property 1 契约）、`parseTimeoutMs(s)`（Property 4 契约）
    - 创建 `src/errors.ts`：定义 `StructuredError` 类（含 `error_type`、`message`、`http_status?`、`details?`）；`mapHttpStatus(status, body)` 将 401/403/404/409/5xx 映射到 `{auth_failed, permission_denied, not_found, conflict, gerrit_server_error}`；`withErrorHandling(fn)` 包装器，把任意 throw（含 `throw "string"`、`throw null`、Promise reject）转成 `StructuredError(internal_error)`，确保 Property 14 的 error_type 枚举封闭性
    - 创建 `src/http-client.ts`：`gerritGet/Post/Put/Delete(path, body?)` 封装；自动注入 `/a/` 前缀（已含则不重复，Property 2 契约）；剥离响应体首行 `)]}'` XSSI 前缀（兼容 `)]}'\n` 与 `)]}'  ` 等空白变体，Property 3 契约）；通过 `AbortController` + `setTimeout` 实现请求超时（默认 30000ms，可被 `GERRIT_TIMEOUT_MS` 覆盖）；HTTP 非 2xx 响应转 `StructuredError`（截断响应体到前 500 字符）
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [ ]* 1.3 基础设施层属性测试
    - 在 `tests/infrastructure.spec.ts` 编写 fast-check 属性，使用 Vitest 运行
    - **Property 1: Basic Auth round-trip** — 任意非空 `(username, password)`，`basicAuthHeader` 输出以 `"Basic "` 开头且 base64 解码等于 `username + ":" + password`
    - **Property 2: /a/ 前缀注入幂等** — 任意 path（含已有 `/a/` 前缀的），http-client 拼出的 URL 路径以 `/a/` 开头且不出现 `//a//a/`
    - **Property 3: XSSI 前缀剥离 round-trip** — 任意合法 JSON 对象 obj，`stripXssi(JSON.stringify(obj))` 与 `stripXssi(")]}'" + JSON.stringify(obj))`、`stripXssi(")]}'\n" + JSON.stringify(obj))` 经 `JSON.parse` 后均等于 obj
    - **Property 4: GERRIT_TIMEOUT_MS 解析** — 任意字符串 s，`parseTimeoutMs(s)` 在 s 表示正整数时返回 `parseInt(s,10)`，否则返回 `30000`
    - **Property 14: StructuredError 兜底枚举** — 用 `withErrorHandling` 包装会随机 throw（数字、字符串、null、Error、Promise reject）的函数，输出的 `error_type` 必属于 `{auth_failed, permission_denied, not_found, conflict, gerrit_server_error, request_timeout, network_error, config_error, internal_error}`
    - _Requirements: 2.4, 2.5, 2.7, 2.8, 8.8_

- [x] 2. Checkpoint - 验证骨架可编译可启动
  - 执行 `npx tsc --noEmit` 通过（无类型错误）
  - 执行 `npm run build` 生成 `dist/index.js` 且首行为 `#!/usr/bin/env node` shebang
  - 执行 `npm start` 进程能完成 MCP 握手并保持监听（无 unhandled rejection）
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Gerrit 读操作工具集
  - [x] 3.1 实现 `src/tools/query.ts` 与读工具注册
    - 实现 `query_change(change_id)`：调用 `GET /changes/{id}?o=CURRENT_REVISION&o=DETAILED_LABELS`，从 commit message 正则提取 `Zmind#(\d+)` 作为 issue_id，返回 `GerritChange`
    - 实现 `list_branches(project, pattern?)`：调用 `GET /projects/{project}/branches/`；当 `pattern` 提供时进行客户端过滤（substring 匹配）；空匹配时返回 `[]` 并附 `note: "no branches matched the pattern"`（Property 6）
    - 实现 `get_change_comments(change_id)`：调用 `GET /changes/{id}/comments`；将所有文件下的 inline 评论与 review 评论合并；按 `created` 字段升序排序（Property 7）
    - 实现 `search_changes(query, limit?)`：调用 `GET /changes/?q={query}&n={limit}`；`limit` 默认 25、上限 100（用 zod schema `.min(1).max(100).default(25)`）
    - 在 `src/index.ts` 中通过 zod schema 描述入参并注册这 4 个 MCP 工具，每个 handler 用 `withErrorHandling` 包装并在错误消息中保留传入的 `change_id`/`project`/`pattern`（Property 5）
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ]* 3.2 读操作属性测试
    - 在 `tests/query.spec.ts` 编写 fast-check 属性，mock `gerritGet` 控制响应
    - **Property 5: 错误消息保留输入标识符** — 对随机字符串 `change_id`，当 mock 返回 404 时 StructuredError.message 必含原始 `change_id` 子串（适用 query_change/get_change_comments）
    - **Property 6: list_branches 无匹配返回空数组** — 任意 `pattern`（含长 UUID），mock 返回不匹配集时 `list_branches` 返回 `[]` 而非抛异常或返回 null
    - **Property 7: get_change_comments 时间升序** — 任意乱序时间戳的 `GerritComment[]` 输入，输出相邻元素满足 `output[i].created <= output[i+1].created`
    - _Requirements: 3.5, 3.6, 3.7_

- [x] 4. Checkpoint - 4 个读工具可被 MCP 客户端调用
  - 在 MCP Inspector 或集成测试中验证 `query_change`/`list_branches`/`get_change_comments`/`search_changes` 入参 schema 与返回结构
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Gerrit 写操作工具集
  - [x] 5.1 实现 `src/tools/cherry-pick.ts`
    - 实现 `cherry_pick_change(change_id, target_branch, message?)`：调用 `POST /changes/{id}/revisions/current/cherrypick` 携带 `{destination, message}` body
    - 三态判别：HTTP 200 → `status="success"`；HTTP 409 → 调用 `classifyConflict(text)` 区分 `skipped_already_merged`（含 `already exists` / `no changes were made` / `nothing to cherry pick`，不区分大小写）与 `conflict`（Property 8、Property 21）
    - 当 `status="conflict"` 时，从 409 响应文本通过 `parseConflictingFiles(text)` 提取冲突文件列表（正则匹配 Gerrit 常见冲突描述）并填入返回对象的 `conflicting_files` 字段
    - HTTP 404（目标分支不存在）走 throw `StructuredError(not_found)`，不在三态枚举内
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 5.2 Cherry-Pick 属性测试
    - 在 `tests/cherry-pick.spec.ts` 编写 fast-check 属性
    - **Property 8: Cherry-Pick 409 文本分类** — 任意 409 响应文本，含三个关键短语任一时 `classifyConflict` 必返回 `skipped_already_merged`，否则返回 `conflict`；同一输入多次调用结果稳定
    - **Property 21: status 枚举值域** — 对随机 mock 的成功响应（200 + 409 两类），`cherry_pick_change` 返回的 `status` ∈ `{"success", "skipped_already_merged", "conflict"}`，永不返回该集合外的值
    - _Requirements: 4.2, 4.3, 4.4_

  - [x] 5.3 实现 `src/tools/push.ts`
    - 实现 `push_to_gerrit(remote, target_branch, reviewers?, wip?, topic?, cwd?)`：通过 `child_process.spawn("git", ["push", remote, "HEAD:refs/for/" + target_branch + buildOptionSuffix(...)])` 调用本地 git
    - `buildOptionSuffix(reviewers, wip, topic)`：将 `reviewers` 列表展开为 `r=email1,r=email2,...`、`wip` 时追加 `wip`、`topic` 时追加 `topic=<topic>`；各 option 用 `,` 分隔，整体以 `%` 起始（仅当至少一个 option 时；Property 9）
    - 定义 `MP_BRANCH_PATTERN = /_mp$/i` 并在调用 spawn 前判定：若匹配，立即返回 `error_type="mp_branch_push_blocked"`，**不**调用子进程（Property 10）
    - 子进程退出后从 stderr 通过 `parseGerritChangeUrl(stderr)`（正则 `/https?:\/\/[^\/\s]+\/c\/[^\/\s]+\/\+\/\d+/`）提取 Change URL；返回前对 stderr 调用 `sanitizeStderr` 截断到 1KB 并清除潜在 token
    - 若子进程退出码非 0 且 stderr 含 `Permission denied`/`unauthorized`/`auth`/`forbidden` 关键字，映射 `error_type="permission_denied"`；否则 `internal_error`（保留 sanitized stderr 在 details）
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [ ]* 5.4 Push 属性测试
    - 在 `tests/push.spec.ts` 编写 fast-check 属性，spawn 用注入的 mock 替换
    - **Property 9: push 命令构造一致性** — 任意合法 `(remote, target_branch, reviewers, wip, topic)`，spawn 调用第一个参数固定为 `"push"`、第二个等于 `remote`、第三个为 `"HEAD:refs/for/" + target_branch + optionSuffix`，optionSuffix 包含且仅包含传入的 reviewers（每个 email 一次，`r=` 前缀）、wip 标志与 topic
    - **Property 10: MP 分支拒绝对称性** — 任意字符串 `target_branch`，`MP_BRANCH_PATTERN.test(t)` 等价于 `t.toLowerCase().endsWith("_mp")`；当且仅当判定为 true 时返回 `error_type="mp_branch_push_blocked"` 且 spawn mock 调用次数为 0
    - **Property 11: parseGerritChangeUrl 提取一致性** — 任意 stderr 字符串，含至少一个匹配子串时返回第一个匹配（且能被 `new URL()` 构造）；否则返回 null
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 5.5 实现 `src/tools/comment.ts`
    - 实现 `add_review_comment(change_id, message, label_value?)`：`POST /changes/{id}/revisions/current/review` 携带 `{message, labels?}`；`message.trim().length === 0` 时返回 `error_type="invalid_input"`
    - 实现 `reply_inline_comment(change_id, parent_comment_id, message, in_reply_to?)`：`POST /changes/{id}/revisions/current/review` 携带 `{comments: { [path]: [{ in_reply_to, message, ... }] }}`；同样的空白校验（Property 12）
    - 实现 `mark_comment_resolved(change_id, comment_id)`：通过 review API 提交 `unresolved=false` 的回复来标记已解决
    - 工具失败时错误消息包含原始 `change_id`/`comment_id`（Property 5 复用）
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 5.6 评论工具属性测试
    - 在 `tests/comment.spec.ts` 编写 fast-check 属性
    - **Property 12: 评论文本空白校验** — 任意 `message`，`message.trim().length === 0` 时 `add_review_comment`/`reply_inline_comment` 必返回错误（`error_type` 在内部错误枚举内）；非空时进入正常处理
    - _Requirements: 6.5_

  - [x] 5.7 实现 `src/tools/reviewer.ts`
    - 实现 `add_reviewer(change_id, reviewer)`：`POST /changes/{id}/reviewers` 携带 `{reviewer}`
    - 实现 `remove_reviewer(change_id, account_id)`：`DELETE /changes/{id}/reviewers/{account-id}`
    - 实现 `set_review_label(change_id, label, value)`：`POST /changes/{id}/revisions/current/review` 携带 `{labels: {[label]: value}}`；用 zod schema `z.number().int().min(-2).max(2)` 强制值域（Property 13）
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ]* 5.8 Reviewer 工具属性测试
    - 在 `tests/reviewer.spec.ts` 编写 fast-check 属性
    - **Property 13: set_review_label 值范围校验** — 任意整数 value，`value < -2 || value > 2` 时被 zod schema 在 MCP 入参层拒绝；`-2 <= value <= 2` 时通过校验
    - _Requirements: 7.5_

  - [x] 5.9 在 `src/index.ts` 注册 8 个写工具
    - 通过 zod schema 描述每个工具入参并将其加入 ListTools 响应
    - 在 CallTool dispatcher 中将每个工具名映射到对应实现，统一通过 `withErrorHandling` 包装
    - 确认 src/index.ts 共 12 个工具注册（4 读 + 8 写），所有工具均不会在 stdout 输出与 MCP 协议无关的日志
    - _Requirements: 1.4_

- [x] 6. Checkpoint - 12 个 MCP 工具可用
  - 执行 `npm run build` 通过；`dist/index.js` 体积合理（无明显 dead code）
  - 用 MCP Inspector 验证 12 个工具的 schema 与样例调用
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Steering File：Commit_Message_Generator 与 Branch_Detector
  - [x] 7.1 创建 `steering/commit-message-workflow.md`
    - 章节 ①：触发场景与前置条件（已 `git add -p` 完成、Zmind Issue 已分析、远程目标分支已经过 Branch_Detector 识别）
    - 章节 ②：输入数据收集 — `git diff --staged` 摘要 + Zmind `get_issue` 返回字段 + Branch_Detector 输出 `BranchDetectionResult`
    - 章节 ③：Branch_Detector 五级降级策略 —— L1 `git rev-parse --abbrev-ref @{upstream}`；L2 `git config branch.<X>.merge`；L3 `.gitreview` 中的 `defaultbranch`；L4 `query_change(change_id)` 反查；L5 询问 Developer。任一级 `ok=true` 立即返回；五级全 `ok=false` 时返回 sentinel `ASK_DEVELOPER`（Property 20 契约，伪代码须写成可被外部 PBT 引用的纯函数形式）
    - 章节 ④：字段生成算法 —— 给出 what/why/how/test/impact 五段的语义边界、字数上限与从 git diff + Issue 抽取每段所需事实的指引
    - 章节 ⑤：元数据补全规则 —— 版本号严格优先级（target_version > developer_override > `ASK_DEVELOPER`，Property 17）；类型按 Tracker 推断（Bug→bugfix、Feature→feature、其他→`ASK_DEVELOPER`，Property 18）；Zmind#ID 必填来自 Issue；简述 ≤ 50 字符（Property 19）
    - 章节 ⑥：format/parse round-trip 契约 —— 用伪代码描述 `format(m: CommitMessageFields): string` 与 `parse(s: string): CommitMessageFields`，明确 first line 正则 `^\[[^\]]+\]\[(bugfix|feature|refactor|hotfix)\]\[whaletv\]\[Zmind#\d+\].+$`、长度 ≤ 100、五段顺序 `[what][why][how][test][impact]`、五段间无空行（Property 15、Property 16）
    - 章节 ⑦：用户确认点（生成完整 commit message 后必须 echo 给 Developer 等待确认）
    - 章节 ⑧：端到端 10 步工作流 —— ① Zmind 分析 → ② Gerrit 检索 → ③ 本地代码定位 → ④ 修改 → ⑤ git diff 确认 → ⑥ git add -p → ⑦ Commit_Message_Generator → ⑧ Developer 确认 → ⑨ Gerrit_Push_Tool 推送 → ⑩ Developer 验证
    - 章节 ⑨：与 Zmind 附件分析的衔接（在 ① 步引用 zmind-mcp-server 的 `analyze_attachment` 工具）
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 12.7, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 15.1, 15.2, 15.3, 15.4, 15.5_

  - [ ]* 7.2 Steering File 契约属性测试
    - 在 `mcp-servers/gerrit-mcp-server/src/commit-message.ts` 实现可选辅助纯函数模块（reference 实现，仅供契约验证使用，不在 12 工具表中暴露）：`format(m)`、`parse(s)`、`pickVersion(target_version, developer_override)`、`inferType(tracker_name)`、`truncateSubject(s)`、`detectBranch(L1, L2, L3, L4, L5)`
    - 在 `tests/commit-message.spec.ts` 编写 fast-check 属性
    - **Property 15: format 输出结构约束** — 任意合法 `CommitMessageFields`（subject 长度受控保证首行 ≤ 100），`format(m)` 输出第一行匹配元数据正则、长度 ≤ 100、后续 5 行依次以 `[what]/[why]/[how]/[test]/[impact]` 开头、五段间无空行
    - **Property 16: parse(format(m)) round-trip** — 任意合法 m（subject 不含 `]`），`parse(format(m))` 等价于 m
    - **Property 17: 版本号严格优先级** — 任意 `(target_version, developer_override)` 元组（含 undefined / 空串 / 非空），`pickVersion` 满足三档输出：target > override > `ASK_DEVELOPER`
    - **Property 18: 类型字段推断映射** — `inferType("Bug")="bugfix"`、`inferType("Feature")="feature"`、其他任意输入 → `ASK_DEVELOPER`
    - **Property 19: 简述长度上限** — 任意输入字符串，`truncateSubject(s).length <= 50`
    - **Property 20: Branch_Detector 优先级与全失败语义** — 任意五元组 `(L1..L5)`（每个 `{ok:true,branch}|{ok:false}`），`detectBranch` 返回首个 `ok:true` 的级别；全 false 时返回 sentinel `ASK_DEVELOPER`
    - 在 `commit-message.ts` 顶部加注释说明本模块是 Steering File 契约的 reference 实现，不通过 MCP ListTools 暴露
    - _Requirements: 9.10, 9.11, 10.1, 10.2, 10.3, 10.5, 11.1, 11.2, 11.4_

- [x] 8. 现有 Steering File 与 Gerrit MCP 工具集成
  - [x] 8.1 更新 `steering/pr-cr-workflow.md`
    - 步骤 ⑥：Commit Message 生成方式从手写改为调用 Commit_Message_Generator（链接到 `commit-message-workflow.md`）
    - 步骤 ⑦：推送方式从外部 `gerritpush` shell 命令改为 Gerrit_Push_Tool（`push_to_gerrit`），并要求先经 Branch_Detector 识别目标分支再调用
    - 步骤 ⑧：评论操作从手工 web 改为 Gerrit_Comment_Tool（`add_review_comment` / `reply_inline_comment` / `mark_comment_resolved`）
    - 在 Tools 索引节增加 12 个新工具的引用并保留原 Zmind/OpenGrok 工具引用
    - _Requirements: 12.1, 12.2, 12.3, 12.8_

  - [x] 8.2 更新 `steering/gerrit-workflow.md`
    - 步骤 ①：推送命令从 `gerritpush` 替换为 `push_to_gerrit`
    - 步骤 ②：评论查询从手工 web 替换为 `get_change_comments`，要求按时间升序展示
    - 步骤 ③：评论操作（回复 inline、mark resolved、添加 review comment）替换为 Gerrit_Comment_Tool
    - 增补 Reviewer/Label 操作链接到 `add_reviewer` / `remove_reviewer` / `set_review_label`
    - _Requirements: 12.4, 12.5, 12.8_

  - [x] 8.3 更新 `steering/cherry-pick-workflow.md`
    - 步骤 ②：源 Change 检索从手工查找替换为 `search_changes`（建议 query 模板 `topic:... status:merged branch:master`）
    - 步骤 ③：目标分支发现从手工 list 替换为 `list_branches`（建议 pattern `_mp` 过滤）
    - 步骤 ⑤：CP 执行替换为 `cherry_pick_change`，按返回 `status` 三态分类汇报：`success` → 提示 Developer review；`skipped_already_merged` → 友好告知；`conflict` → 列出 `conflicting_files` 并提示 Developer 手动 resolve
    - _Requirements: 12.6, 12.8_

- [x] 9. Checkpoint - Steering Files 一致性
  - 通读 5 份 Steering File（pr-cr / gerrit / cherry-pick / commit-message / 既有 safety-rules）确认工具引用一致、术语统一、无遗留 `gerritpush` 字面引用
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. POWER.md 与 mcp.json 元数据更新
  - [x] 10.1 更新 `POWER.md`
    - keywords 数组追加 `gerrit-mcp` 与 `commit-message`（保留原有 keywords）
    - MCP 服务器表格新增 `gerrit-mcp-server` 行：包名、stdio 传输、12 工具数量、对应 Steering 文档
    - 环境变量表格新增四行：`GERRIT_URL`（必需）、`GERRIT_USERNAME`（必需）、`GERRIT_HTTP_PASSWORD`（必需）、`GERRIT_TIMEOUT_MS`（可选，默认 30000）
    - 配置示例 mcp.json 块新增 `gerrit-mcp-server` 配置（与 10.2 保持一致）
    - 新增"Gerrit MCP Server 工具列表"小节：列出 4 个读工具（query_change / list_branches / get_change_comments / search_changes）+ 8 个写工具（cherry_pick_change / push_to_gerrit / add_review_comment / reply_inline_comment / mark_comment_resolved / add_reviewer / remove_reviewer / set_review_label），每项一句话描述
    - 配置验证小节增加命令：`curl -u "$GERRIT_USERNAME:$GERRIT_HTTP_PASSWORD" "$GERRIT_URL/a/accounts/self"`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_

  - [x] 10.2 更新仓库根目录 `mcp.json`
    - 在 `mcpServers` 对象中新增 `gerrit-mcp-server` 块：`command="npx"`、`args=["-y","@kk-irving/gerrit-mcp-server"]`、`env={"GERRIT_URL":"...","GERRIT_USERNAME":"...","GERRIT_HTTP_PASSWORD":"...","GERRIT_TIMEOUT_MS":"30000"}` 占位值
    - `disabled=false`、`autoApprove=[]`（写操作默认不自动批准，遵循三层安全的 Steering 确认机制）
    - 确保整体仍是合法 JSON（无尾随逗号、双引号包裹）
    - _Requirements: 13.5_

- [x] 11. Final Checkpoint - 全部资产验收
  - 在 `mcp-servers/gerrit-mcp-server/` 执行 `npm install` + `npm run build` 通过
  - 在仓库根执行 `node -e "JSON.parse(require('fs').readFileSync('mcp.json','utf8'))"` 验证 mcp.json 合法
  - 全部 Properties 测试（基础设施 / query / cherry-pick / push / comment / reviewer / commit-message）在 `vitest --run` 下通过
  - 通读 Steering Files 确认 10 步端到端工作流闭环可执行
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 标记为 `[ ]*` 的子任务为 optional 测试任务（property tests 与 reference 实现），可在 MVP 路径跳过；核心实现任务（无 `*`）必须执行
- Property tests 使用 `fast-check@^3.20.0` + `vitest@^1.6.0`；测试文件统一放在 `mcp-servers/gerrit-mcp-server/tests/` 目录
- 所有 21 个 Properties 来自 design.md `## Correctness Properties` 章节，每个 PBT 子任务在标题中显式引用 Property 编号与 Validates 的 Requirements 子条款
- 模块依赖关系：Module 1 子任务串行（项目骨架先于业务）；Module 2 / Module 3 内部多个工具文件互不依赖可并行；Module 4.1 完成后 Module 4.2 与 Module 5 可并行；Module 6 在最后
- 不引入 simple-git 等 git 包装库；push 工具直接使用 `child_process.spawn`（与 design 决策一致）
- 写操作工具（cherry-pick/push/comment/reviewer）的 `autoApprove` 保持空数组，依赖 Steering 层用户确认机制（与现有三层安全模型一致）
- Steering File 中的伪代码契约通过 Module 4.2 的 reference 实现 + PBT 来形式化保证，避免 Steering 描述与运行时行为发散

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "3.1", "5.1", "5.3", "5.5", "5.7"] },
    { "id": 3, "tasks": ["3.2", "5.2", "5.4", "5.6", "5.8"] },
    { "id": 4, "tasks": ["5.9"] },
    { "id": 5, "tasks": ["7.1"] },
    { "id": 6, "tasks": ["7.2", "8.1", "8.2", "8.3"] },
    { "id": 7, "tasks": ["10.1", "10.2"] }
  ]
}
```
