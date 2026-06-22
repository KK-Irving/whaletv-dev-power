# Implementation Plan: whaletv-dev-power v2 平台升级

## Overview

四阶段渐进式实施，每阶段独立可发布。P0 优先解决卡顿能力，P0+ 提升运维自动化，P1 引入新数据源与本地知识库，P2 完成端到端工作流，P3 收尾部署与文档。

任务编号采用 `<阶段>.<模块>.<子任务>` 形式。⏱ 表示预估投入。

## Tasks

### 阶段 P0 — 紧急能力修复（解锁现有工具）

- [x] 1. **P0-A: Gerrit 双层认证修复**（需求 1） ⏱ 2-3h
  - [x] 1.1 改造 `mcp-servers/gerrit-mcp-server/src/auth.ts`
    - 扩展 `GerritConfig` 接口，新增 `authHeader: string`、`cookie: string` 字段（保留 `username`/`password`）
    - 修改 `getGerritConfig()` 读取新增的 `GERRIT_AUTH_HEADER` 与 `GERRIT_COOKIE` 环境变量
    - 改写 `requireGerritConfig()` 校验逻辑：会话凭据完整 OR 直连凭据完整即通过；否则抛 `config_error` 并列出两组所需变量
    - 新增导出 `getAuthMode(cfg): "session" | "basic"` 帮手函数
    - _Requirements: 1.1, 1.4_
  - [x] 1.2 改造 `mcp-servers/gerrit-mcp-server/src/http-client.ts`
    - 改造 `injectAuthPrefix(path)`：根据 auth mode 决定，session 模式不注入、basic 模式注入 `/a/`
    - 改造 `gerritFetch()` 中的 headers 构造：session 模式下同时塞 `Authorization`（raw header）与 `Cookie`，basic 模式下只塞 `Authorization: Basic <b64>`
    - 升级 `buildHttpErrorMessage()` 401 分支：根据当前 auth mode 给出针对性提示（cookie 过期 vs HTTP_PASSWORD 错）
    - _Requirements: 1.2, 1.3, 1.5, 1.6_
  - [x] 1.3 升级版本号
    - `mcp-servers/gerrit-mcp-server/package.json` version: `1.1.0`
    - 在 src/index.ts 启动 banner 中输出当前 auth mode（不输出具体凭据值）
    - _Requirements: 1.7, 1.8_
  - [ ] 1.4 跑通 smoke test（手工或脚本）
    - 配置 `GERRIT_AUTH_HEADER` + `GERRIT_COOKIE` 后逐个调用 14 个工具至少一次（query / get_change / list_branches / cherry_pick / comment / reviewer 等）
    - 至少要求 `search_changes` 与 `query_change` 在公司双层认证 Gerrit 上 200 通过
    - _Requirements: 1.7_

- [x] 2. **P0-B: 附件解压增强**（需求 3） ⏱ 3-4h
  - [x] 2.1 改造 `mcp-servers/zmind-mcp-server/src/attachment-handler.ts`
    - 新增 `extractRarOrSevenz(archivePath, destDir)` 函数，按 unar → unrar → 7z 三档降级
    - 新增 `hasUsefulContent(dir)` 函数检查是否全 0 字节
    - 解压成功后 touch `<archive>.extracted_ok` 标记
    - 失败时清空目标目录避免脏数据
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 2.2 缓存与失效逻辑
    - 在 `download_attachment` 中检查归档大小/etag 变化时删除 stamp
    - 已存在 stamp 且归档体积匹配则跳过解压
    - _Requirements: 3.4, 3.5_
  - [x] 2.3 扩展支持的归档类型
    - 在 `prepare_issue_workspace` 与 `download_attachment` 的解压分发器中添加 `.tar.xz`、`.gz`、`.7z` 处理
    - 顶层单子目录自动展平
    - _Requirements: 3.6, 3.7_
  - [x] 2.4 失败处理与文档
    - 任何附件解压失败仅写入返回值 `failed_extractions` 数组，不抛异常
    - README 增加各平台解压器安装命令
    - _Requirements: 3.8, 3.9_

- [x] 3. **P0-C: WAF 重试 + 共享客户端**（需求 4） ⏱ 2h
  - [x] 3.1 新增 `mcp-servers/zmind-mcp-server/src/http-client.ts`
    - 暴露 `zmindFetch(url, options)` 包装器：第一次走全局 fetch，retry 时强制 `Connection: close`，触发码 [403,429,502,503]，线性退避 0.8 * N 秒
    - 暴露 `describeHttpClientConfig()` 用于启动 banner
    - _Requirements: 4.1, 4.2, 4.3, 4.5_
  - [x] 3.2 替换 `attachment-handler.ts` + `index.ts` 中所有 fetch 调用为 `zmindFetch`
    - 失败附件继续后续，不阻断
    - _Requirements: 4.4_
  - [x] 3.3 新增并发与速率配置读取
    - 进程启动时读 `ZMIND_HTTP_MIN_INTERVAL` 与 `ZMIND_FETCH_CONCURRENCY`
    - 速率门用 promise chain 串行化避免并发跳过
    - 并发门用 semaphore + waiters 队列
    - _Requirements: 4.6, 4.7_

- [x] 4. **P0 阶段验收点**
  - [x] 4.1 编译三个改动包：`npm run build`（gerrit-mcp v1.1.0 + zmind-mcp v2.1.1，`tsc` 全过）
  - [x] 4.2 smoke runner 验证：gerrit `search_changes` HTTP 200（cookie 模式）+ zmind `list_projects` 1377 字节响应；RAR/WAF 等被动触发能力 banner 报告配置正确，待真实场景演练
  - [x] 4.3 在 `.learnings/v2-smoke-test-results.md` 记录此阶段的关键发现（双通道认证模式落地、Authorization+Cookie 同时存在、non-/a/ 路径）

### 阶段 P0+ — 凭据自动刷新（需求 2）

- [x] 5. **P0+-A: Playwright 核心刷新脚本** ⏱ 4-5h
  - [x] 5.1 新增 `scripts/refresh-auth.mjs`
    - 实现 `captureCookies({ baseUrl, user, pass, names, readyHint })` 函数
    - 实现主 `refresh()` 流程：拿 Gerrit cookie + 计算 authHeader + 拿 Confluence cookie + 写 mcp.json
    - 自检：用新凭据调一次 `/changes/?n=1`，200 通过；非 200 输出 status 与提示
    - 密码不落盘、不入日志
    - _Requirements: 2.3, 2.4, 2.5, 2.7, 2.8_
  - [x] 5.2 添加 mcp.json 深合并写入
    - 读现有 `~/.kiro/settings/mcp.json`（不存在则创建）
    - 仅覆盖 gerrit/confluence 两个 server 的指定 env 字段，其他配置保留
    - 写入前 backup 到 `~/.kiro/settings/mcp.json.bak.<timestamp>`
    - _Requirements: 2.5, 2.6_
  - [x] 5.3 失败路径
    - 浏览器登录失败 / SSO 跳转超时 / MFA 检测 → 退出码 != 0、输出原因、不动 mcp.json
    - _Requirements: 2.7_

- [x] 6. **P0+-B: 平台壳脚本** ⏱ 1-2h
  - [x] 6.1 新增 `scripts/refresh-auth.ps1`
    - PowerShell 5.1+ 兼容
    - `Read-Host -AsSecureString` 读密码
    - 调用 `node scripts/refresh-auth.mjs`，传 env `WHALE_USER` / `WHALE_PASSWORD`
    - 检查 Node、Playwright 安装，缺失时自动 `npm install`（除非 -NoSelfInstall）
    - _Requirements: 2.1, 2.2, 2.9_
  - [x] 6.2 新增 `scripts/refresh-auth.sh`
    - bash 4+
    - `read -s -p "Password: " PASS` 隐藏输入
    - 同样调 mjs，相同的 env 协议；支持 `--no-self-install` 跳过自动安装
    - _Requirements: 2.1, 2.2, 2.9_
  - [x] 6.3 添加 `npx playwright install chromium` 自动调用（仅首次）
    - `package.json` 的 `postinstall` 钩子自动跑（npm install 时一并安装 Chromium）
    - _Requirements: 2.3_

- [x] 7. **P0+-C: 文档与 onboarding** ⏱ 1h
  - [x] 7.1 新增 `steering/auth-refresh.md`
    - 何时刷新（401 错误、定期 1-2 周）、运行命令、Windows 执行策略说明
    - 非交互模式（CI / 定时任务）说明、退出码表、常见问题
    - _Requirements: 2.11_
  - [x] 7.2 在 `steering/onboarding.md` 中加入"首次配置 Gerrit/Confluence"段落
    - 引导新同事运行 `scripts/refresh-auth.{ps1,sh}`，并保留手动 F12 抓取 fallback
    - 凭据存储说明同步更新
    - _Requirements: 2.11_
  - [x] 7.3 README 加 v2 新章节"凭据管理"
    - 描述 session 模式的设计原理（Authorization + Cookie 同时存在）
    - 一键命令 + steering/auth-refresh.md 链接
    - _Requirements: 2.11_

- [x] 8. **P0+ 阶段验收点**
  - [x] 8.1 Playwright httpCredentials + cookie 抓取流程已验证可达 nginx 双层认证（独立测试脚本走完一遍 captureCookies + 自检 GET /changes/?n=1 → HTTP 200）
  - [ ] 8.2 cookie 过期场景模拟：手动清掉 cookie → Gerrit 工具 401 → 跑 `scripts/refresh-auth.*` → 工具恢复（待用户在干净机器跑正式 .ps1 流程）

### 阶段 P1 — 文档中心 + 本地知识库（需求 5、6）

- [x] 9. **P1-A: confluence-mcp-server 骨架** ⏱ 4-5h
  - [x] 9.1 创建 `mcp-servers/confluence-mcp-server/{package.json, tsconfig.json}`
    - 依赖与现有 server 对齐：`@modelcontextprotocol/sdk`、`zod`，dev: `tsx`、`typescript`、`@types/node`
    - _Requirements: 5.1_
  - [x] 9.2 实现 `src/auth.ts`：读取 `CONFLUENCE_BASE_URL` 与 `CONFLUENCE_COOKIE`，缺失抛 `config_error`
    - _Requirements: 5.6, 5.7_
  - [x] 9.3 实现 `src/http-client.ts`：fetch 包装器，每次自动加 Cookie 头，可配置 `CONFLUENCE_REQUEST_DELAY_MS`
    - _Requirements: 5.9_
  - [x] 9.4 实现 `src/html-strip.ts`：移除 `<script>`/`<style>`、解码常见实体、collapse 空白
    - _Requirements: 5.8_
  - [x] 9.5 实现 `src/index.ts`：注册 3 个工具 + stdio 启动
    - _Requirements: 5.1_

- [x] 10. **P1-B: confluence 工具** ⏱ 3h
  - [x] 10.1 实现 `tools/search.ts` (`search_confluence`)
    - CQL 自动包装、空间筛选、limit 上限 20
    - 解析 `results[]`、提取 snippet（HTML→text 后截断 320 字）
    - _Requirements: 5.2, 5.3_
  - [x] 10.2 实现 `tools/get-page.ts` (`get_page`)
    - 单页面拉取、HTML→text、截断 8000 字
    - _Requirements: 5.4_
  - [x] 10.3 实现 `tools/list-spaces.ts` (`list_spaces`)
    - 分页累加直到 `size < 100`
    - _Requirements: 5.5_

- [x] 11. **P1-C: knowledge-mcp-server 数据层** ⏱ 4-5h
  - [x] 11.1 创建 `mcp-servers/knowledge-mcp-server/{package.json, tsconfig.json}`
    - 新增依赖：`@xenova/transformers@^2.17`（ONNX 嵌入）；SQLite 用 Node 22.5+ 内置 `node:sqlite` 模块（无 native 编译）
    - _Requirements: 6.1_
  - [x] 11.2 实现 `src/db.ts`
    - 初始化 SQLite（路径默认 `./data/knowledge.db`，可由 `KNOWLEDGE_DB_PATH` 覆盖）
    - 创建 schema：`zmind_issues` / `gerrit_changes` / `confluence_pages` 三张主表 + 各自 FTS5 + 触发器 + `sync_state`
    - 提供 `migrate()` 函数与 `runInTransaction(db, fn)` 帮手，幂等
    - _Requirements: 6.2_
  - [x] 11.3 实现 `src/embedder.ts`
    - 单例加载 `Xenova/bge-small-zh-v1.5` ONNX
    - 提供 `embedTexts(texts: string[]): Promise<Float32Array[]>` 与 `embedOne(text)`
    - 控制线程数（`KNOWLEDGE_EMBEDDING_THREADS`）+ batch size + maxTextChars 截断
    - _Requirements: 6.3, 6.12, 6.14_
  - [x] 11.4 实现 `src/index-store.ts`
    - 进程内 lazy-loaded `Map<source, SourceIndex>`，每个 SourceIndex 含 `Float32Array matrix` + `meta`
    - `loadIndex(source)` / `invalidate(source?)` / `vectorTopK(...)`
    - _Requirements: 6.13_

- [x] 12. **P1-D: knowledge 同步工具** ⏱ 5-6h
  - [x] 12.1 实现 `src/sources/zmind-sync.ts`
    - 用 ZMIND_URL + ZMIND_API_KEY 调 `/issues.json` 拉 issues，分页 + watermark
    - upsert 到 `zmind_issues` 表
    - 提供 `syncZmind({ since?, limit?, statusId? })` 入口
    - _Requirements: 6.4_
  - [x] 12.2 实现 `src/sources/gerrit-sync.ts`
    - 用 v1.1 双通道认证（GERRIT_AUTH_HEADER+COOKIE 或 USERNAME+HTTP_PASSWORD）拉 `/changes/`
    - upsert 到 `gerrit_changes`，带 `_more_changes` 翻页
    - _Requirements: 6.5_
  - [x] 12.3 实现 `src/sources/confluence-sync.ts`
    - 用 CONFLUENCE_BASE_URL + CONFLUENCE_COOKIE 拉 spaces + pages
    - HTML→纯文本 入库；增量走 CQL `lastmodified > since`
    - _Requirements: 6.6_
  - [x] 12.4 注册 3 个 sync 工具
    - `sync_zmind` / `sync_gerrit` / `sync_confluence` 都写 sync_state 水位

- [x] 13. **P1-E: 嵌入与检索工具** ⏱ 4-5h
  - [x] 13.1 实现 `embed_pending(source, batch_size?)`
    - 查 `embedding IS NULL OR embedding_updated_at < updated` 的行
    - 批量 embed → 回写 `embedding BLOB` + `embedding_updated_at`
    - 完成后 `invalidate(source)`
    - _Requirements: 6.7_
  - [x] 13.2 实现 `src/search.ts` 三种模式
    - vector：加载 matrix → dot product → topK
    - fts：`SELECT id, bm25(<fts>) FROM <fts> WHERE <fts> MATCH ? ORDER BY ... LIMIT ?`
    - hybrid：vector(2*limit) + fts(2*limit) → merge by id → 按 max(score) 排序，标 match
    - _Requirements: 6.8, 6.9, 6.15_
  - [x] 13.3 实现 `search_local` 工具
    - source 取 `zmind|gerrit|confluence|all`，all 模式下并行单源检索后返回 `{ zmind, gerrit, confluence }`
    - _Requirements: 6.8, 6.10_
  - [x] 13.4 实现 `get_indexed(source, id)` 工具
    - 从对应主表读完整记录（不含 embedding）
    - _Requirements: 6.11_

- [x] 14. **P1 阶段验收点**
  - [x] 14.1 编译三个新 server 通过：confluence-mcp v1.0.0 + knowledge-mcp v1.0.0 + 现有 zmind/gerrit
  - [x] 14.2 跑 `sync_zmind({ limit: 10 })` + `embed_pending({source:"zmind", batch_size:10})`，本地索引 10 条 PR（小批量验证 BGE 模型加载 + 嵌入计算 + BLOB 存储全栈，5.6 秒）
  - [x] 14.3 跑 `search_local("Android", source="zmind", mode="hybrid", limit=3)`，0.0 秒返回 3 条命中（top cosine=0.527）
  - [ ] 14.4 跨源命中至少包括各源 1 条（仅在已 sync 各源后才能验，待用户大批量 sync 后跑）
  - [ ] 14.5 confluence-mcp 在权限 OK 的 cookie 下 search/get_page/list_spaces 三件套通过（**当前账号 winn.wei 在 Confluence 无 read 权限，HTTP 403；待权限开通后跑**）

### 阶段 P2 — AOSP 模块精搜 + 一键工作流（需求 7、8）

- [x] 15. **P2-A: AOSP chunker + indexer** ⏱ 5-7h
  - [x] 15.1 实现 `src/aosp/chunker.ts`
    - 按文件后缀分发 lang（Java / Kotlin / C/C++ / Python / 通用）
    - 边界识别：用正则识别 class / interface / enum / fun / def / function 边界（不上 tree-sitter，避免巨大 wasm 依赖）
    - 切块策略：边界优先，超长按 200 行硬切，每块 ≤ 2000 字符
    - `shouldIndexFile` / `shouldSkipDir` 黑名单过滤
    - _Requirements: 7.1_
  - [x] 15.2 实现 `src/aosp/module-map-loader.ts`
    - 解析 `steering/module-path-map.md` → `data/module-map.json`，按源文件 mtime 自动 invalidate
    - 提供 `resolveModulePaths(platform, moduleId)` → 返回路径前缀列表
    - 提供 `listModulesOfPlatform(platform)`
    - _Requirements: 7.3_
  - [x] 15.3 实现 `src/aosp/indexer.ts` + `src/aosp/embed-aosp.ts`
    - BFS 遍历 module 路径，跳过黑名单（.git/out/build、二进制、>5MB）
    - 用 chunker 切块，UNIQUE 约束去重 + content_hash 跳过未变 chunk
    - aosp_chunks 表 + FTS5 触发器（schema 已加到 db.ts）
    - 嵌入由独立 `embedAospPending(args)` 处理（与三源 embed_pending 解耦）
    - _Requirements: 7.1, 7.4_
  - [x] 15.4 注册 `index_aosp_module` / `clear_aosp_index` / `search_aosp` / `embed_aosp_pending` / `list_aosp_modules` 工具
    - `search_aosp` 走 hybrid 检索（aosp_chunks_fts + 向量矩阵），支持 platform / module / module_path 过滤
    - _Requirements: 7.2, 7.5, 7.6_

- [x] 16. **P2-B: analyze_issue 端到端工作流** ⏱ 3-4h
  - [x] 16.1 在 `mcp-servers/knowledge-mcp-server/src/` 新增 `analyze-issue.ts`
    - 编排：fetch_issue → ensure_workspace → extract_keywords → search_local(三源) → infer_modules → search_aosp → render_context_md
    - 关键词提取：标题去停用词 + 描述前 200 字 → 去重 token（中英文）
    - 平台推断：从 issue/project 名称匹配 D4/X5/STB 关键字
    - 模块推断：扫 search_local 命中里的 project / 路径片段，与 module-map 比对找最高频模块
    - _Requirements: 8.1-8.7_
  - [x] 16.2 在 knowledge-mcp 主入口注册 `analyze_issue`
    - 决策：把 analyze_issue 放 knowledge-mcp 而非 zmind-mcp（本质是基于本地知识库的综合分析）
    - 直接 import searchLocal / searchAosp / loadModuleMap，无需跨 server 通信
    - 拉 issue 用现成的 ZMIND_API_KEY env，独立运行
    - _Requirements: 8.1_
  - [x] 16.3 best-effort 错误处理
    - 任何子步骤失败 → 写入 context.md 的"已知问题"段，继续后续
    - 全程返回 errors 数组让调用方知情
    - _Requirements: 8.8_

- [ ] 17. **P2 阶段验收点**
  - [x] 17.1 编译通过 + 无 lint 错（chunker / indexer / search / embed-aosp / module-map-loader / analyze-issue / index）
  - [ ] 17.2 `index_aosp_module(platform="X5", module="tvsystemui", module_path="vendor/whale/...", repo_root="...")` 完成、入表
  - [ ] 17.3 `embed_aosp_pending({ batch_size: 200 })` 跑完一批，aosp_chunks_fts 与 vector 索引可用
  - [ ] 17.4 `search_aosp({ query: "xxx", platform: "X5", module: "tvsystemui" })` 命中精确（hybrid）
  - [ ] 17.5 `analyze_issue({ issue_id: <真实 PR>, include_aosp: true })` 输出完整 context.md
  - [ ] 17.6 用户人工抽查 5 条历史 PR 的输出可读性

### 阶段 P3 — 部署、文档与发布

- [x] 18. **P3-A: setup-v2 脚本** ⏱ 3-4h
  - [x] 18.1 `scripts/setup-v2.ps1`
    - 检查依赖：Node ≥ 22.5（knowledge-mcp 需要内置 `node:sqlite`）、unar/7z 可选警告
    - `npm install` scripts/ 下的 Playwright + Chromium
    - 调用 `scripts/refresh-auth.ps1` 拿凭据（可选）
    - 提示 `ZMIND_API_KEY` / `OPENGROK_*` 手填字段位置
    - _Requirements: 9.1_
  - [x] 18.2 `scripts/setup-v2.sh`
    - 同上 Linux/macOS 版本，含 brew/apt 解压器安装提示
    - _Requirements: 9.1_

- [x] 19. **P3-B: 文档与 POWER.md 升级** ⏱ 2-3h
  - [x] 19.1 更新 `POWER.md` mcpServers 列表为 5 个 server
    - 升级 zmind 到 v2.1.1、gerrit 到 v1.1.0；新增 confluence v1.0.0 / knowledge v1.0.0
    - 加 v2 凭据管理章节（双通道认证 + 独立账号 form login 说明）
    - _Requirements: 9.2_
  - [x] 19.2 更新 `README.md`（已经 v2 同步）
    - 加 v2 章节、setup-v2 引导、新 server 表
    - _Requirements: 9.3_
  - [x] 19.3 更新现有 steering 文件（需求 10）
    - `bug-analysis-workflow.md`：步骤 ①.5 加 search_local（v2 推荐 analyze_issue 一键模式）
    - `commit-message-workflow.md`：步骤 ② 加 search_local(source="gerrit") 找模板，步骤 ③ 加 search_local 找历史改过该模块的 commit
    - `pr-cr-workflow.md`：步骤 ② 加 search_local(source="all") 找历史相似
    - `local-code-guide.md`：搜索策略升级到 5 档
    - `onboarding.md`：v2 配置流程（已在 P0+ 完成）
    - _Requirements: 10.3, 10.4_
  - [x] 19.4 新增 `steering/knowledge-base-workflow.md`
    - 何时用、三种检索模式、四个数据源、所有工具用法（search_local / get_indexed / search_aosp / analyze_issue）
    - 全量 / 增量同步、AOSP 索引、性能预期、与其他工具协作
    - 故障排查表
    - _Requirements: 10.4_
  - [x] 19.5 更新 `agent/whaletv-dev.json`
    - description 升级到 v2，5 个 MCP
    - prompt 加 search_local 优先级（5 档：地图 → 本地索引 → git grep → 已知路径 → OpenGrok）
    - mcpServers 加 confluence-mcp + knowledge-mcp
    - tools 加 @confluence-mcp-server + @knowledge-mcp-server

- [x] 20. **P3-C: FEATURE_REQUESTS 收尾** ⏱ 30min
  - [x] 20.1 在 `.learnings/FEATURE_REQUESTS.md` 把本规划登记为 FR-002 至 FR-009
    - FR-002: Gerrit 双层认证修复 ✓
    - FR-003: 凭据自动刷新脚本 ✓
    - FR-004: 附件解压 RAR5 + WAF 重试 ✓
    - FR-005: confluence-mcp-server ✓
    - FR-006: knowledge-mcp-server（向量 + FTS5）✓
    - FR-007: AOSP 模块级精搜 ✓
    - FR-008: analyze_issue 端到端工作流 ✓
    - FR-009: setup-v2 部署脚本 ✓
    - _Requirements: 9.5_

- [ ] 21. **P3-D: 发布与回归**
  - [ ] 21.1 各 MCP server 跑全量 build（已编译验证 ✓）
  - [ ] 21.2 拉一个新同事在干净机器上跑 `setup-v2.ps1`，记录耗时与卡点
  - [ ] 21.3 对 v1 老用户提供"配置兼容"说明：保留 GERRIT_USERNAME 仍可用（v1.1 双通道 fallback）
  - [ ] 21.4 npm publish 各包：
    - `@kk-irving/gerrit-mcp-server` v1.0.0 → **v1.1.0**
    - `@kk-irving/zmind-mcp-server` v2.0.0 → **v2.1.1**（v2.1.0 publish 后发现 bin path 含 `./` 被 npm strip，立即 v2.1.1 修复重发）
    - `@kk-irving/confluence-mcp-server` **v1.0.0**（首发）
    - `@kk-irving/knowledge-mcp-server` **v1.0.1**（首发 v1.0.0 + 立即 v1.0.1 修复 sync watermark/query/scope 三个 bug，见 ERR-002/003/007）
  - [ ] 21.5 升级 POWER.md version 字段、git tag `v2.0.0`

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "name": "P0 紧急修复",
      "tasks": ["1", "2", "3", "4"],
      "depends_on": []
    },
    {
      "wave": 2,
      "name": "P0+ 凭据自动化",
      "tasks": ["5", "6", "7", "8"],
      "depends_on": [1]
    },
    {
      "wave": 3,
      "name": "P1-Conf 文档中心 MCP",
      "tasks": ["9", "10"],
      "depends_on": [2]
    },
    {
      "wave": 4,
      "name": "P1-Knowledge 知识库 MCP",
      "tasks": ["11", "12", "13", "14"],
      "depends_on": [3]
    },
    {
      "wave": 5,
      "name": "P2 AOSP 索引 + 工作流",
      "tasks": ["15", "16", "17"],
      "depends_on": [4]
    },
    {
      "wave": 6,
      "name": "P3 部署与发布",
      "tasks": ["18", "19", "20", "21"],
      "depends_on": [5]
    }
  ]
}
```

```
P0-A (Gerrit 双认证) ────┐
                          ├──> P0+ (凭据刷新脚本) ──> P1-A/B (confluence)
P0-B (附件解压) ─────────┤
P0-C (WAF 重试) ─────────┘
                                                  ┌──> P1-C/D (knowledge 同步)
                                                  │
P1-A (confluence) ────────────────────────────────┤
                                                  │
                                                  └──> P1-E (检索) ──> P2-B (analyze_issue)
                                                                ▲
                                                                │
                                                  P2-A (AOSP indexer) ────┘
```

## Notes

- 任务编号 `<阶段>.<编号>` 与 requirements.md 的需求 1-10 通过 `_Requirements: x.y_` 标记关联
- 每阶段完成后建议在 `.learnings/LEARNINGS.md` 写一段总结，记录踩坑与方案
- 建议按 P0 → P0+ → P1 → P2 → P3 顺序执行，但 P1 内部 confluence 与 knowledge 可并行
- 对 v1 老用户保持兼容：保留 `GERRIT_USERNAME` / `GERRIT_HTTP_PASSWORD` 模式继续可用，新模式优先

## 总投入估算

| 阶段 | 估时 | 价值 |
|---|---|---|
| P0 | 7-9h | 立即解锁 v1.0.0 卡住的能力 |
| P0+ | 6-8h | 运维痛点根治（cookie 不再手抓） |
| P1 | 20-24h | 跨源知识检索秒级化（最大能力跃升） |
| P2 | 8-11h | 端到端工作流（用户体验跃升） |
| P3 | 5-7h | 部署体验、文档收尾 |
| **合计** | **46-59h** | 约 1-2 周专注投入 |
