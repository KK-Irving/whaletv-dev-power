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
