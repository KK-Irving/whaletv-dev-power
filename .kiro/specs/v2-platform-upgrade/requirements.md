# Requirements Document

> 中文标题：需求文档：whaletv-dev-power v2 平台升级

## Introduction

本规划是 `whaletv-dev-power` Power 在 v1.x 投入团队使用一段时间后，结合实际使用反馈与公司内部已部署系统的工程实践经验，整理出的一轮平台级升级。目标是在保持现有 14 个 Gerrit / 2 个 OpenGrok / 8 个 Zmind 工具的基础上，补齐三个一直被反馈卡顿的能力短板：

1. **Gerrit REST 通道在双层认证（nginx + Gerrit）网关下无法稳定调用**——v1.0.0 的 REST 改造已完成代码但未能上线。
2. **没有本地知识库**——每次需要查"以前有没有人遇到过类似 PR / 这个错误是不是 commit 引入的 / 哪里有相关设计文档"都要走 live API + 慢速全文 grep。
3. **附件处理不完整**——`.rar`（尤其客户/QA 常用的 WinRAR 5）和 Aliyun WAF 限速场景没有应对。

同时引入两个全新的能力域：

- **文档中心（Confluence）集成**——Power 内当前没有任何方式访问公司知识库的设计/历史经验。
- **本地向量 + 全文混合检索**——把历史 PR / Gerrit commit / Confluence page 索引到本地，让"在巨大数据集里找类似问题"从分钟级变成秒级。

整体定位仍然是 Kiro Power 工具包形态（不是 Web 应用），所有新增能力都暴露为 MCP 工具，沿用 stdio / 单进程 / npx 启动的轻量部署模型。

## Glossary

- **双层认证**: 公司 Gerrit 部署架构——nginx 反向代理用 SSO 登录密码做 HTTP Basic 校验，Gerrit 内部再用 HTTP Credentials 或登录会话 cookie 做二次校验
- **Auth Header 通道**: HTTP 请求的 `Authorization` 头，承载 nginx 层的 Basic Auth
- **Cookie 通道**: HTTP 请求的 `Cookie` 头，承载 Gerrit 层的 session 凭据
- **Non-/a/ 路径**: Gerrit REST API 的非鉴权前缀路径（如 `/changes/...`），相对鉴权前缀路径 `/a/changes/...`
- **XSSI 防护前缀**: Gerrit JSON 响应体首行的 `)]}'` 安全标记，调用方需剥离
- **会话凭据**: 用户在浏览器登录后由服务端写入的 cookie（如 `GerritAccount`、`XSRF_TOKEN`、`JSESSIONID`、`seraph.confluence`、`acw_tc`），生命周期通常 1-4 周
- **WAF**: Web Application Firewall——公司部分系统（Zmind / 文档中心）部署在 Aliyun WAF 后，对单连接突发请求会限速或返回 403/429
- **本地索引**: SQLite 文件 + FTS5 全文索引 + BLOB 列存储的密集向量
- **嵌入模型**: 将文本转为定长向量的小型预训练模型，本规划使用 BGE-small-zh 系列（中文友好、512 token、~80MB ONNX）
- **Hybrid 检索**: 向量语义检索结果与 FTS5 关键词检索结果合并去重排序
- **跨源融合**: 同一查询在多个本地索引（Zmind PR / Gerrit / Confluence / AOSP）并行执行后归并 Top-K
- **Issue Workspace**: 单个 PR/Bug 处理时在仓库根下创建的隔离工作目录（`.workspace/issue-<id>/`），存放附件、解压结果、分析记录
- **MP 分支**: Maintenance Patch 分支，即 release 分支（`os10_mp`、`os10_3_mp` 等）
- **AOSP**: Android Open Source Project 源码

## Requirements

### 需求 1：Gerrit 双层认证通道支持（P0）

**用户故事：** 作为开发者，我希望 Gerrit MCP 工具在公司双层认证网关下也能稳定工作，以便在 Kiro 内直接执行 query / comment / cherry-pick 等操作而不再 401。

#### 验收标准

1. THE Gerrit_MCP_Server SHALL 支持两种凭据配置模式：会话凭据模式（`GERRIT_AUTH_HEADER` + `GERRIT_COOKIE`）和直连 HTTP Credentials 模式（`GERRIT_USERNAME` + `GERRIT_HTTP_PASSWORD`）
2. WHEN 同时设置了 `GERRIT_AUTH_HEADER` 和 `GERRIT_COOKIE` 时，THE Gerrit_MCP_Server SHALL 优先使用会话凭据模式，所有 REST 请求路径不注入 `/a/` 前缀，并在请求头中同时携带 `Authorization` 和 `Cookie` 两个头部
3. WHEN 仅设置了 `GERRIT_USERNAME` 和 `GERRIT_HTTP_PASSWORD` 时，THE Gerrit_MCP_Server SHALL 使用直连模式，请求路径自动注入 `/a/` 前缀，并在请求头中携带由 username + password 计算的 HTTP Basic Auth 头
4. IF 两种凭据都未完整配置（即两种模式所需的环境变量集合都至少缺一项），THEN THE Gerrit_MCP_Server SHALL 在工具调用时返回 `config_error` 类型的结构化错误，错误信息须明确列出当前缺失的所有环境变量名以及两种可选模式各自的所需变量
5. THE Gerrit_MCP_Server SHALL 在所有 REST 响应处理路径上剥离 `)]}'` XSSI 防护前缀（含其后的连续空白），剥离逻辑须为幂等（不以该前缀开头的响应保持原样）
6. WHEN HTTP 响应状态码为 401 时，THE Gerrit_MCP_Server SHALL 在错误信息中明确提示：会话凭据模式下首要可能原因是 cookie 过期，需要重新抓取；直连模式下首要可能原因是 HTTP_PASSWORD 错误
7. THE Gerrit_MCP_Server SHALL 保留 v1.0.0 已实现的全部 14 个 REST 工具的对外契约（工具名、参数、返回 schema 不变）
8. THE Gerrit_MCP_Server SHALL 升级版本号到 1.1.0 以反映认证通道扩展

### 需求 2：会话凭据自动获取脚本（P0+）

**用户故事：** 作为开发者，我不希望每隔几周手动 F12 抓 cookie，而希望提供一个命令一键刷新会话凭据并自动写入配置。

#### 验收标准

1. THE Power SHALL 提供独立可执行脚本 `scripts/refresh-gerrit-auth`（同时提供 PowerShell 和 Bash 版本以支持 Windows 与 Linux/macOS）
2. WHEN 用户运行该脚本时，THE 脚本 SHALL 通过交互式 prompt 收集用户名和 SSO 登录密码（密码输入须隐藏回显，且不写入任何磁盘文件）
3. THE 脚本 SHALL 使用 headless 浏览器（Playwright 或 Puppeteer）自动完成以下流程：访问 `https://whale-gerrit.zeasn.com`、应答 nginx 的 HTTP Basic Auth challenge（使用收集到的 SSO 凭据）、等待 Gerrit 后续 SAML/SSO 自动登录跳转完成、捕获 `GerritAccount` 与 `XSRF_TOKEN` cookie
4. THE 脚本 SHALL 同时计算 `Authorization: Basic <base64(user:password)>` 字符串作为 nginx 通道凭据
5. THE 脚本 SHALL 将获取到的两项凭据写入用户级 MCP 配置文件 `~/.kiro/settings/mcp.json` 中 `mcpServers.<gerrit-server-name>.env` 字段下的 `GERRIT_AUTH_HEADER` 和 `GERRIT_COOKIE`，写入时须保留文件中其他既有字段不变
6. IF 脚本检测到目标 MCP 配置文件不存在或 `gerrit-mcp-server` 条目不存在，THEN THE 脚本 SHALL 创建该条目并使用规范的默认结构（`command`、`args`、`disabled: false`、`autoApprove: []`）
7. IF 浏览器自动登录失败（例如密码错误、网络不可达、SSO 跳转超时、检测到 MFA 提示），THEN THE 脚本 SHALL 输出失败原因并不修改任何配置文件
8. THE 脚本 SHALL 在成功完成后输出新凭据的有效性自检结果：用新凭据调用一次 `/changes/?n=1` REST 接口，能 200 返回则视为通过；否则提示用户排查
9. THE 脚本 SHALL 支持非交互模式（环境变量 `WHALE_USER` 和 `WHALE_PASSWORD` 提供凭据），便于在 CI 或定时任务中调用
10. THE 脚本 SHALL 同时支持刷新文档中心（Confluence）的 cookie 凭据，行为对称（同一次登录会话顺带取 `JSESSIONID` 等 cookie 写入 `confluence-mcp-server` 的 env）
11. THE Power SHALL 在 README 与 onboarding steering 中提供脚本的使用说明，包括首次配置、cookie 过期识别（401 错误链接到刷新命令）、Windows 上的 PowerShell 执行策略说明

### 需求 3：附件解压能力增强（P0）

**用户故事：** 作为开发者，我希望工具能正确解压客户/QA 上传的所有压缩格式（包括 WinRAR 5），不再因为 RAR5 或 0 字节占位文件导致分析中断。

#### 验收标准

1. THE Zmind_MCP_Server SHALL 在解压 `.rar` 文件时按以下优先级尝试三种解压器：1）`unar`（首选，原生支持 RAR5）；2）`unrar` 或 `rarfile` 库；3）`7z` 命令
2. WHEN 任一解压器返回成功状态码且目标目录中包含至少一个非空文件时，THE Zmind_MCP_Server SHALL 视为解压成功并停止尝试后续解压器
3. WHEN 一个解压器声称成功但目标目录所有文件都是 0 字节时，THE Zmind_MCP_Server SHALL 视为解压失败、清空目标目录、并降级到下一个解压器
4. THE Zmind_MCP_Server SHALL 在解压成功后写入 `<archive>.extracted_ok` 标记文件到归档同级目录，下次再下载该归档命中缓存时若标记存在则跳过重新解压
5. WHEN 重新下载替换了归档文件内容（即归档体积或 etag 变化）时，THE Zmind_MCP_Server SHALL 删除旧的 `.extracted_ok` 标记并强制重新解压
6. THE Zmind_MCP_Server SHALL 支持以下完整压缩格式集合：`.zip`、`.tar`、`.tar.gz`、`.tgz`、`.tar.bz2`、`.tar.xz`、`.gz`、`.rar`、`.7z`
7. THE Zmind_MCP_Server SHALL 在解压目标目录顶层只有 1 个子目录、0 个文件时自动展平该 wrap 目录（将子目录内容上提至顶层），但展平失败不视为解压失败
8. IF 系统未安装任何可用的 RAR 解压器（unar/unrar/7z 全部不在 PATH 中），THEN THE Zmind_MCP_Server SHALL 在 `download_attachment` 返回值中明确标记该 RAR 文件为 `failed_extractions` 并附原因说明，但不阻塞其他附件的下载与解压
9. THE Zmind_MCP_Server SHALL 在 README 与 onboarding 中说明各解压器的安装命令（Windows `choco install unar 7zip`、Linux `apt install unar p7zip-full`、macOS `brew install unar p7zip`）

### 需求 4：Aliyun WAF 限速应对（P0）

**用户故事：** 作为开发者，我希望工具在公司 WAF 限速触发时能自动恢复，而不是把整次分析操作打断。

#### 验收标准

1. WHEN Zmind 附件下载请求返回状态码 403、429、502、503 之一时，THE Zmind_MCP_Server SHALL 视为 WAF 限速并启动重试流程
2. THE Zmind_MCP_Server SHALL 在限速重试时**新建一个全新的 HTTP 客户端连接**（不复用进程级 keep-alive 连接池），以绕过单连接突发计数限制
3. THE Zmind_MCP_Server SHALL 使用线性退避策略，第 N 次重试前等待 `0.8 * N` 秒（N 从 1 开始），最多重试 4 次（合计 5 次尝试）
4. IF 5 次尝试全部失败，THEN THE Zmind_MCP_Server SHALL 将该附件标记为 `failed` 并继续处理后续附件（不抛异常导致整个 PR 下载中断）
5. THE Zmind_MCP_Server SHALL 在每次进程级别启动时建立一个共享的 HTTP 客户端实例，所有非限速重试场景的请求都通过该实例发出（连接池复用）
6. THE Zmind_MCP_Server SHALL 提供进程级请求最小间隔配置 `ZMIND_HTTP_MIN_INTERVAL`（毫秒，默认 0=禁用），配置为正数时所有出站 Zmind 请求至少间隔该时长
7. THE Zmind_MCP_Server SHALL 提供进程级并发上限配置 `ZMIND_FETCH_CONCURRENCY`（默认 2），同一时刻最多该数量的 Zmind 附件下载请求并发

### 需求 5：文档中心（Confluence）MCP 服务器（P1）

**用户故事：** 作为开发者，我希望能在 Kiro 中直接搜索公司文档中心的设计文档/技术规格/历史经验，以便不用切换浏览器找资料。

#### 验收标准

1. THE Power SHALL 包含名为 `confluence-mcp-server` 的新 MCP 服务器，使用 TypeScript 实现，stdio 传输
2. THE Confluence_MCP_Server SHALL 提供 `search_confluence` 工具，接受查询字符串（必填）、空间标识（可选）、返回数量（默认 5，上限 20）参数，返回命中页面列表（含 id、标题、URL、内容片段、空间名）
3. THE Confluence_MCP_Server SHALL 在查询字符串包含 CQL 关键字（AND/OR/NOT/space/type/title/text 等）时直接作为 CQL 透传；否则自动包装为 `text ~ "<query>"` 形式
4. THE Confluence_MCP_Server SHALL 提供 `get_page` 工具，接受页面 ID 参数，返回完整页面（标题、空间、版本、HTML 转纯文本后的正文，正文截断至 8000 字符）
5. THE Confluence_MCP_Server SHALL 提供 `list_spaces` 工具，返回所有 global 类型空间的 key 与 name 列表
6. THE Confluence_MCP_Server SHALL 通过 `CONFLUENCE_BASE_URL`（如 `https://docs.whaletv.com`）和 `CONFLUENCE_COOKIE`（完整 Cookie 头部值）两个环境变量获取配置
7. IF `CONFLUENCE_BASE_URL` 或 `CONFLUENCE_COOKIE` 未配置或为空，THEN THE Confluence_MCP_Server SHALL 在工具调用时返回 `config_error` 错误并指明缺失变量
8. THE Confluence_MCP_Server SHALL 在 HTML 转纯文本时移除 `<script>` 与 `<style>` 标签的全部内容，并解码常见 HTML 实体（`&nbsp;` `&amp;` `&lt;` `&gt;` `&quot;` `&#39;`）
9. THE Confluence_MCP_Server SHALL 在所有页面下载/搜索请求中加入可配置的请求间延迟（`CONFLUENCE_REQUEST_DELAY_MS`，默认 150），降低被 Aliyun WAF 限速的概率
10. THE Confluence_MCP_Server SHALL 与需求 2 的 cookie 自动刷新脚本对接，由该脚本统一写入凭据

### 需求 6：本地知识库（向量 + FTS5 混合检索）（P1）

**用户故事：** 作为开发者，我希望能秒级在历史几万条 PR / commit / 文档里找到与当前问题最相关的内容，以便复用前人经验、识别相同症状的修复提交。

#### 验收标准

1. THE Power SHALL 包含名为 `knowledge-mcp-server` 的新 MCP 服务器，使用 TypeScript 实现，stdio 传输，依赖 `better-sqlite3`、`@xenova/transformers`（ONNX 嵌入模型 runtime）
2. THE Knowledge_MCP_Server SHALL 维护一个本地 SQLite 文件 `data/knowledge.db`（路径可由 `KNOWLEDGE_DB_PATH` 覆盖），库内为每个数据源（zmind / gerrit / confluence）建立独立表，每张表至少含：主键 ID、标题、正文、状态/版本元数据、`embedding BLOB`（float32 序列化）、`embedding_updated_at TEXT`、对应 `<table>_fts` FTS5 虚拟表
3. THE Knowledge_MCP_Server SHALL 使用 `Xenova/bge-small-zh-v1.5` 或同等中文 BGE-small ONNX 模型作为统一嵌入器，向量维度 512，所有源共享同一模型
4. THE Knowledge_MCP_Server SHALL 提供 `sync_zmind(since?, limit?)` 工具，分页拉取 Zmind issues（`status_id=*`，按更新时间倒序），写入本地 zmind 表并维护 `last_full_sync` / `last_incremental_sync` 水位
5. THE Knowledge_MCP_Server SHALL 提供 `sync_gerrit(query?, since?, limit?)` 工具，使用需求 1 修好的 REST 通道分页拉取 Gerrit changes（含 commit_message + 文件列表），写入本地 gerrit 表
6. THE Knowledge_MCP_Server SHALL 提供 `sync_confluence(space?, since?, limit?)` 工具，分页拉取指定空间页面（或所有 global 空间），写入本地 confluence 表
7. THE Knowledge_MCP_Server SHALL 提供 `embed_pending(source, batch_size?)` 工具，按 `embedding IS NULL OR embedding_updated_at < updated` 条件批量计算嵌入并回写
8. THE Knowledge_MCP_Server SHALL 提供 `search_local(query, source?, mode?, limit?)` 工具：source 取值 `zmind|gerrit|confluence|all`（默认 `all`）；mode 取值 `vector|fts|hybrid`（默认 `hybrid`）；limit 默认 5、上限 20；返回每个源各自的 Top-K 命中（含 id、source、score、title、snippet、url、meta）
9. THE Knowledge_MCP_Server SHALL 在 `mode=hybrid` 时分别执行向量检索与 FTS5 检索，按 `score = max(vector_score, fts_score_normalized)` 合并去重
10. THE Knowledge_MCP_Server SHALL 在 `source=all` 时为每个源单独跑检索后并行返回（不做跨源排序，让 LLM 自行权衡），格式 `{ "zmind": [...], "gerrit": [...], "confluence": [...] }`
11. THE Knowledge_MCP_Server SHALL 提供 `get_indexed(source, id)` 工具，返回本地索引中的完整记录（不再调远程 API），用于 `search_local` 命中后取详情
12. THE Knowledge_MCP_Server SHALL 在嵌入计算时启用进程内缓存的 ONNX session，避免每次调用都重新加载模型；模型文件首次启动时自动下载到 `data/models/` 并缓存
13. WHEN 索引规模超过 50000 行后，THE Knowledge_MCP_Server SHALL 在 `search_local` 路径上使用预加载的 numpy/Float32Array 矩阵做点积，单次查询响应时间须低于 500ms（在普通 SSD + 8GB RAM 笔记本上）
14. THE Knowledge_MCP_Server SHALL 提供 `KNOWLEDGE_EMBEDDING_THREADS` 环境变量控制 ONNX runtime 线程数（默认 `min(CPU 数, 4)`），避免在低配机器上耗尽资源
15. THE Knowledge_MCP_Server SHALL 在 `search_local` 命中结果的 meta 中标注命中通道（`match: "vector" | "fts" | "both"`），便于调试

### 需求 7：AOSP 模块级精搜（P2）

**用户故事：** 作为开发者，我希望在已知问题模块（通过 module-path-map 定位的 D4/X5/STB 子模块）后，工具能在该模块范围内做语义精搜，而不是每次去 OpenGrok 全库找关键词。

#### 验收标准

1. THE Knowledge_MCP_Server SHALL 提供 `index_aosp_module(platform, module_path, repo_root)` 工具，按文件粒度切 chunk（每个 chunk ≤2000 字符，按函数/类边界优先切，落不到边界时按行切），写入新的 `aosp_chunks` 表（字段：platform、module_path、file_path、line_start、line_end、content、embedding、embedding_updated_at）
2. THE Knowledge_MCP_Server SHALL 提供 `search_aosp(query, platform?, module?, limit?)` 工具，支持按 platform（D4/X5/STB）和 module 筛选搜索域，返回命中 chunk（含相对路径、行号区间、content snippet、score）
3. THE Knowledge_MCP_Server SHALL 在 `search_aosp` 中读取并尊重 `steering/module-path-map.md` 中的模块定义（通过解析或预提取的索引文件），module 参数支持模块 ID（如 `tvsystemui`、`asplayer`）
4. THE Knowledge_MCP_Server SHALL 在 `index_aosp_module` 中跳过以下文件类型：`.git/*`、`out/*`、`build/*`、二进制文件（通过文件头检测）、单文件 >5MB 的源码
5. THE Knowledge_MCP_Server SHALL 提供 `clear_aosp_index(platform?, module?)` 工具，按粒度清理已索引的 chunks（用于源码大改后重建）
6. THE Knowledge_MCP_Server SHALL 在 README 中明确标注 AOSP 索引为可选能力，磁盘占用预估（每 GB 源码约 200-400MB 索引）

### 需求 8：跨工具端到端 PR 处理工作流（P2）

**用户故事：** 作为开发者，我希望有一个高层工具能一键串起"建工作区→拉 PR 详情+附件→在三源知识库找类似问题→在 AOSP 找模块代码→生成分析报告"，以便不用每次手动调用 7-8 个工具。

#### 验收标准

1. THE Power SHALL 在 zmind-mcp-server 中提供新工具 `analyze_issue(issue_id, include_aosp?: boolean)`，链式执行以下步骤并返回汇总结果
2. THE 工具 SHALL 第 1 步调用 `prepare_issue_workspace(issue_id)` 创建工作区
3. THE 工具 SHALL 第 2 步获取 issue 详情与全部附件、自动解压所有压缩包
4. THE 工具 SHALL 第 3 步从 issue 标题与描述中提取查询关键词（取标题去停用词的前 8 个 token + 描述前 200 字符），调用 `search_local(source="all")` 在三源知识库找类似条目，返回每源 Top-3
5. WHEN `include_aosp` 为 true 且步骤 4 命中条目暗示了具体模块时，THE 工具 SHALL 第 5 步调用 `search_aosp(module=<推断模块>)` 找相关代码 chunk，返回 Top-3
6. THE 工具 SHALL 第 6 步将以上所有信息汇总写入工作区 `analysis-context.md`，结构化输出包含：issue 概要、附件清单（含解压结果）、三源 Top-K 命中表（含跳转 URL）、AOSP 命中代码片段（如有）、suggested next steps（标准三段：复现验证 / 历史修复对比 / 模块改动建议）
7. THE 工具 SHALL 返回 JSON：`{ workspace_path, issue, attachment_summary, similar: { zmind, gerrit, confluence }, aosp_hits, context_md_path }`
8. THE 工具 SHALL 在任何子步骤失败时记录失败原因到 `analysis-context.md` 的"已知问题"段并继续后续步骤（best-effort 模式）

### 需求 9：跨平台部署与 onboarding 升级

**用户故事：** 作为开发者，我希望从 v1 升级到 v2 后，配置流程依然清晰，不需要手动改一堆文件。

#### 验收标准

1. THE Power SHALL 在仓库根新增 `scripts/setup-v2.ps1`（Windows）和 `scripts/setup-v2.sh`（Linux/macOS），实现以下步骤的自动化：1）检查 Node.js / Python / 7z / unar 等系统依赖；2）安装 Playwright 浏览器（用于需求 2）；3）调用需求 2 的凭据刷新脚本完成 Gerrit + Confluence 配置；4）下载嵌入模型；5）注入所有 4 个 MCP server 到 `~/.kiro/settings/mcp.json`
2. THE POWER.md 中的 mcpServers 列表 SHALL 更新到 4 个：`zmind-mcp-server`、`opengrok-mcp-server`、`gerrit-mcp-server`（v1.1.0）、`confluence-mcp-server`（v1.0.0）、`knowledge-mcp-server`（v1.0.0）
3. THE README SHALL 增加 v2 升级章节，列出从 v1.x 升级时的破坏性变更（如有）和迁移步骤
4. THE Power SHALL 在 `steering/onboarding.md` 中加入新工具的常见用例（含 `analyze_issue` 一键处理流的示例）
5. THE Power SHALL 在 `.learnings/FEATURE_REQUESTS.md` 中将本规划登记为 FR-002 至 FR-009 并初始为 in-progress 状态

### 需求 10：现有工具与 Steering 的兼容与升级

**用户故事：** 作为既有 v1 用户，我希望升级后我现有的工作流（cherry-pick / pr-cr 处理 / commit-message 生成）依然能用，且能受益于新的本地索引。

#### 验收标准

1. THE Gerrit_MCP_Server v1.1.0 SHALL 保持 v1.0.0 全部 14 个工具的对外契约 100% 兼容（工具名、参数 schema、返回 JSON shape 不变）
2. THE Zmind_MCP_Server v2.x SHALL 保持 v2.0.0 已发布工具的契约不变，仅新增 `analyze_issue` 工具
3. THE Steering 文件 SHALL 在以下文件中加入"先查本地索引"的优先策略标注：`bug-analysis-workflow.md`（在症状定位前调用 `search_local`）、`commit-message-workflow.md`（构造前置上下文时调用 `search_gerrit`）、`pr-cr-workflow.md`（评估改动影响前调用 `search_local(source="all")`）、`local-code-guide.md`（搜索策略升级到 5 档：模块地图 → 本地索引 → git grep → 已知路径 → OpenGrok）
4. THE Power SHALL 在 `bug-analysis-workflow.md` 与 `pr-cr-workflow.md` 中新增"使用 analyze_issue 一键处理"的章节
