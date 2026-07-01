# Feature Requests

用户请求的新功能和改进建议。

---

## FR-001 模块路径地图（Module Path Map）

**状态**: ✅ 第一档已完成（D4 平台）— 2026-06-02
**优先级**: 高（直接服务 PR/CR、Bug 分析、CP 三大核心工作流）

### 背景与痛点

当前 power 主要面向 Android 源码场景，11 套代码库每套都是 100GB+ 量级。AI 分析问题时在缺乏先验路径信息的情况下，倾向于：
- 大范围 `git grep` / OpenGrok 全量 `search_code`
- 命中大量噪音结果，需要二次过滤
- 单次定位耗时 + 等待时间长

`local-code-guide.md` 现有的目录映射粒度过粗（只有 frameworks/ packages/ vendor/ hardware/ 五条），无法精确到子模块（TvSettings、LiveTv、TvScanConfig、PQ、CEC、Tuner 这一层）。

### 核心想法

预先建立 **"项目/模块名 → 代码路径"** 索引层，AI 拿到问题时**先查地图缩小范围**，再用 git grep / OpenGrok 限定路径搜索，避免大范围 grep。

### 设计决策（用户确认）

- **按 OpenGrok 项目维度划分**（不按 ODM）—— 同平台不同 ODM 的目录差异基本可忽略
- 一级维度：OpenGrok 项目（如 `d4_code` / `x5_code` / `stb16_code` / ...）
- 二级维度：AOSP 一级目录（frameworks/、packages/、vendor/、hardware/、device/、kernel/）
- 三级维度：业务子模块（TvSettings、LiveTv、Tuner、PQ、CEC、SystemUI、...）

### GitNexus 评估结论

参考项目：https://github.com/abhigyanpatwari/GitNexus

| 维度 | 评估 |
|------|------|
| 理念 | ✅ "Precomputed Relational Intelligence" 与本需求高度一致 |
| MCP 架构 | ✅ stdio MCP 可与现有三个 server 并排接入 |
| 多 repo 支持 | ✅ 全局 registry，匹配 11 套代码库场景 |
| 工具能力 | ✅ context / impact / detect_changes 直接服务 PR/CR、Bug、CP |
| **License** | 🚨 **PolyForm Noncommercial 1.0.0 — 商业禁用，WhaleTV 接入需先与 akonlabs.com 谈商业 license** |
| AOSP 完整性 | ⚠️ 不解析 .aidl / .bp / .mk / HIDL / overlay XML；C/C++ 的 Imports/Named Bindings 为空 |
| 跨语言调用链 | ⚠️ Java→JNI→C++、Framework→AIDL→Service 跨进程调用建不出边 |
| Repo 多仓 | ⚠️ AOSP 是 repo 工程（100+ 子 git 仓库），适配麻烦 |
| 索引规模 | ⚠️ 100GB+ 首次索引耗时数小时，需调 embedding cap 与文件大小上限 |

**结论**：GitNexus 的**理念正确**，但**直接接入不现实**（License 一票否决）。可作为思路参考，不作为依赖。

### 三档落地路径

#### 🟢 第一档：模块路径地图（当前选定）

**产出**：`steering/module-path-map.md`，按平台 × AOSP 一级目录 × 子模块三层组织。

**生成方式**：
1. 通过 OpenGrok REST API 拉取项目列表（`/api/v1/configuration` 或 `/api/v1/projects`）
2. 对每个项目，用 `search_path` + 路径前缀采样，发现 frameworks/ packages/ vendor/ 等一级目录
3. 对每个一级目录，进一步采样发现关键子模块（按 TvSettings、LiveTv、Tuner、PQ、CEC 等关键词反查）
4. 结构化输出到 `module-path-map.md`，按 platform → category → module 三层

**消费方式**：
- 自动加载（与 `local-code-guide.md` 同级，inclusion: auto）
- 在 bug-analysis-workflow / pr-cr-workflow 的"代码定位"步骤前先查地图
- 命中模块名后，将路径前缀作为 `git grep` / `search_code` 的 `--` 限定符或 `path:` 过滤条件

**优势**：零外部依赖、零 license 风险、立即生效、是后续档位的前置基础。

#### 🟡 第二档：OpenGrok 模块感知层（视情况启用）

在 `opengrok-mcp-server` 上加两个工具：
- `list_modules(project)` — 列出项目下的模块清单（来自第一档地图）
- `search_in_module(module_name, query, project)` — 自动转换成 `path:<prefix>` 限定的 OpenGrok 搜索

**前提条件**：第一档已上线，且实际使用反馈"还需要更精细"。

#### 🔴 第三档：自研轻量代码图谱（最后兜底）

仅在前两档都不够时考虑：
- Tree-sitter 解析 Java/Kotlin（先不上 C/C++）
- SQLite 落地（不上 KuzuDB，量级不合适）
- 仅建 `CLASS_DEFINED_IN`、`METHOD_CALLS`、`CLASS_EXTENDS` 三类边
- 增量索引绑 git hook

**或者**重新评估 GitNexus 的商业 license 报价。

### 数据采集方案

用户已同意提供 OpenGrok 凭据用于一次性采样，凭据传递方式：
- **A 方案**（推荐）：环境变量 `OPENGROK_USERNAME` / `OPENGROK_PASSWORD`，AI 从环境变量读
- **B 方案**：chat 直传，AI 立即使用不持久化
- **C 方案**：AI 给脚本，用户本地运行，回传非凭据结果

**安全约束**：
- `.gitignore` 已新增 `.scratch/` 排除项，临时脚本和采样原始数据写入此目录
- `module-path-map.md` 最终成果不含任何凭据
- 采样脚本不得将凭据 echo 到 stdout 或写入 git 追踪的文件

### 验收标准

第一档完成的标志：
- [x] `module-path-map.md` 覆盖 OpenGrok 上至少 3 个主要平台（d4_code / x5_code / stb16_code）— **D4 / X5 / STB 三个主要平台均已完成（2026-06-02）**
- [x] 每个平台至少枚举 5 个常见业务模块（TvSettings 类）的精确路径前缀 — D4 / X5 / STB 都已枚举 ~25-30 个子模块
- [x] 在 bug-analysis-workflow.md 中加入"先查 module-path-map"的步骤指引 — 已加在步骤 ⑤
- [x] 在 pr-cr-workflow.md 中加入"先查 module-path-map"的步骤指引 — 已加在步骤 ③
- [ ] AI 在测试 case（如"分析下 #xxx，TvScanConfig 异常"）中能直接命中地图，不需要全量 grep — 待实战验证

### 三平台关键差异（已记入 module-path-map.md）

| 维度 | D4 | X5 | STB |
|------|-----|-----|-----|
| 业务代码根 | `vendor/zeasn/` | `vendor/whale/` | `vendor/whale/` |
| Customer 顶层 | 11 个 am30/at30 | 6 个 br30/bs30 | **无**（结构不同） |
| ODM 命名 | calla/redi/soddy/t982 系列 | anemone/dahlia/daisy/dryas/calla_wv4 | pascal/qurra/raman/ramancas/ross |
| ODM 数 | 8 | 12 | 6 |
| Kernel | 顶级 `kernel/` (5.x) | `common/common14-5.15/` | `common/common16-6.12/` |
| TEE | 无独立工程 | 无独立工程 | **完整 `trusty/`** |
| TvSystemUI | ❌ | ✅ | ✅ |
| MediaQuality HAL | ❌ | ❌ | ✅ |
| Thread (IoT) HAL | ❌ | ❌ | ✅ |
| 新 service（Permission/Credentials/Flags） | ❌ | ✅ | ✅+ |
| AppFunctions/Foldables/Supervision | ❌ | ❌ | ✅ |
| 总目录采样 | 631 | 632 | 695 |

---


## FR-002 ~ FR-009: v2 平台升级（按 .kiro/specs/v2-platform-upgrade）

**状态**: ✅ **P0 / P0+ / P1 / P2 / P3 全部完成**（2026-06-11）；smoke test 19/19 通过；待 npm publish 上线
**优先级**: 高（P0 解锁 v1.0.0 卡顿能力，P1+ 引入跨源知识库）
**Spec**: [`.kiro/specs/v2-platform-upgrade/`](../.kiro/specs/v2-platform-upgrade/)
**Smoke 报告**: [`.learnings/v2-smoke-test-results.md`](v2-smoke-test-results.md)

### 阶段进度

| 阶段 | 范围 | 状态 |
|------|------|------|
| **P0-A** | Gerrit 双层认证修复（gerrit-mcp v1.1.0） | ✅ 代码完成 + smoke 通 |
| **P0-B** | 附件解压增强（RAR5 三档降级 + 0 字节防御 + extract_ok 缓存） | ✅ 代码完成 |
| **P0-C** | Aliyun WAF 重试 + 进程级速率/并发门（zmind-mcp v2.1.1） | ✅ 代码完成 |
| **P0+** | Playwright 凭据自动刷新脚本（refresh-auth.{ps1,sh,mjs}），含 Gerrit SSO + Confluence form login 双账号 | ✅ 代码完成 + smoke 通 |
| **P1-Conf** | confluence-mcp-server v1.0.0 | ✅ 代码完成 + 3/3 工具通 |
| **P1-Knowledge** | knowledge-mcp-server v1.0.2（向量+FTS5 hybrid 检索；v1.0.1 修复 sync 3 bug；v1.0.2 加 Confluence searchv3 fallback） | ✅ 代码完成 + sync/embed/search/fallback 全通 |
| **P2** | AOSP 模块级精搜 + analyze_issue 一键工作流 | ✅ 代码完成 + 编译通过 |
| **P3** | POWER.md / README.md / steering 升级 + setup-v2 部署脚本 | ✅ 完成（2026-06-11） |

### FR-002: Gerrit 双层认证支持

**问题**: v1.0.0 走 `/a/` 路径 + 单 Basic Auth 头，过不了公司 nginx + Gerrit 双层认证（401）。

**方案**: 双通道认证模式
- **session 模式（首选）**: `GERRIT_AUTH_HEADER` (raw "Basic xxx" 过 nginx) + `GERRIT_COOKIE` (raw "GerritAccount=...; XSRF_TOKEN=..." 过 Gerrit)，走 non-/a/ 路径
- **basic 模式（备选）**: `GERRIT_USERNAME` + `GERRIT_HTTP_PASSWORD`，走 /a/ 路径
- 基于 HTTP 协议允许 1 Authorization + 1 Cookie 头同时存在的事实

**实施**: `mcp-servers/gerrit-mcp-server/src/auth.ts` + `http-client.ts` 双通道决策表，错误信息按当前模式给出针对性诊断。

**验收标准**:
- [x] auth.ts 决策表实现 (`session` | `basic` | `missing`)
- [x] http-client.ts 路径前缀按模式切换、headers 按模式构造
- [x] 401 错误信息按当前模式分支给出诊断（cookie 过期 vs HTTP_PASSWORD 错）
- [x] 启动 banner 输出 auth_mode 标识（不输出凭据值）
- [x] 14 个工具对外契约 100% 兼容
- [x] 编译通过、零 lint 错
- [ ] **真实凭据 smoke test**（query_change / search_changes / get_unresolved_threads 等核心工具调用 200 通过）

### FR-003: 凭据自动刷新脚本（P0+）

**问题**: cookie 过期（1-4 周）需要用户手动 F12 复制，痛点高。

**方案**: `scripts/refresh-auth.{ps1,sh,mjs}` 用 Playwright headless 自动登录，提取 cookie + 计算 Authorization，写入 `~/.kiro/settings/mcp.json`，自检通过才完成。

**状态**: 待开始

### FR-004: 附件解压能力增强

**问题**:
1. RAR5（WinRAR 5.x 客户/QA 常用）解压不了
2. 旧 p7zip 处理 RAR5 会返回成功状态码但产生 0 字节占位文件，下游分析"日志为空"
3. 没有缓存机制，重复解压

**方案**:
- 三档降级：unar（RAR5 原生）→ unrar → 7z
- `hasUsefulContent(dir)`: 0 字节防御（验证至少有 1 个非 0 字节文件）
- `<archive>.extracted_ok` stamp: 缓存解压结果，归档变化时失效
- `flattenSingleDirWrap()`: 单 wrap 子目录自动展平
- magic bytes 识别 RAR/7z（`Rar!` / `7z\xBC\xAF`）+ xz delegate 给 tar
- 失败不阻塞：仅记入 failed_extractions，继续处理后续附件

**实施**: `mcp-servers/zmind-mcp-server/src/attachment-handler.ts` 新增 `extractRarOrSevenz` / `hasUsefulContent` / `flattenSingleDirWrap` / `runProcess` / `summarizeDir`。

**验收标准**:
- [x] 三档降级实现
- [x] 0 字节防御实现
- [x] extracted_ok stamp 缓存逻辑
- [x] wrap 目录自动展平
- [x] magic bytes 识别 RAR/7z/xz
- [x] 编译通过、零 lint 错
- [ ] 真实 .rar 测试（RAR5 + RAR3 各一个）

### FR-005: Aliyun WAF 限速应对

**问题**: 公司 Zmind 部署在 Aliyun WAF 后，单连接突发请求 5+ 时返回 403/429/502/503，导致整个 PR 下载中断。

**方案**:
- `zmindFetch()` 包装：触发码 `[403, 429, 502, 503]` 时重试
- 退避 = `0.8s × attempt`，最多 5 次
- retry 时强制 `Connection: close` 头，让服务器关闭连接，下一次请求落到新连接（避开 per-connection 计数）
- 进程级速率门 `ZMIND_HTTP_MIN_INTERVAL`（毫秒，默认 0=禁用）
- 进程级并发门 `ZMIND_FETCH_CONCURRENCY`（默认 2）

**实施**: `mcp-servers/zmind-mcp-server/src/http-client.ts` 新建，所有出站 fetch（attachment-handler + index 的 redmineGet/Put/Post + download_attachment）替换为 `zmindFetch`。

**验收标准**:
- [x] WAF 重试包装实现（4 个状态码 × 5 次 attempts × 线性退避）
- [x] Connection: close 强制 fresh connection 行为
- [x] 进程级速率门（promise chain 串行化避免并发跳过）
- [x] 进程级并发门（semaphore + waiters 队列）
- [x] 启动 banner 输出 HTTP client 配置摘要
- [x] 编译通过、零 lint 错
- [ ] 真实 WAF 限速场景测试（连续 6+ 个附件下载触发 403 后能恢复）

### FR-006: 文档中心（Confluence）MCP（P1）

**目标**: `confluence-mcp-server` v1.0.0，3 个工具（search / get_page / list_spaces），CQL 搜索 + cookie 认证。

**状态**: 待开始

### FR-007: 本地知识库（向量+FTS5 hybrid）（P1）

**目标**: `knowledge-mcp-server` v1.0.1，三源（zmind / gerrit / confluence）同步 + BGE-small-zh ONNX 嵌入 + SQLite BLOB 存向量 + FTS5 全文 + hybrid 跨源检索。

**状态**: 待开始

### FR-008: AOSP 模块级精搜 + analyze_issue 工作流（P2）

**目标**: 在 knowledge-mcp 上加 `index_aosp_module` / `search_aosp` 利用 module-path-map 做模块级精搜；zmind-mcp 加 `analyze_issue` 一键串起 workspace 创建 + 三源检索 + AOSP 检索 + context.md 渲染。

**状态**: 待开始

### FR-009: setup-v2 部署脚本（P3）

**目标**: `scripts/setup-v2.{ps1,sh}` 一键依赖检查 + Playwright 安装 + 凭据刷新 + 嵌入模型下载 + 5 个 MCP server 注入。

**状态**: 待开始

---
