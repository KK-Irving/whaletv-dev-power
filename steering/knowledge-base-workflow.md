---
inclusion: auto
---

# 本地知识库工作流（knowledge-mcp v1.0.2）

## 何时用

每当 AI 需要找"以前有没有人遇到过类似问题 / 这个错误是不是某个 commit 引入的 / 哪里有相关设计文档"时，**先用 `search_local` 走本地索引**（毫秒级），命中后再决定要不要打 live API。

典型触发场景：
- Bug 分析（`bug-analysis-workflow`）→ 先 `search_local("xxx 异常 偶现")` 找类似 PR
- PR/CR 处理（`pr-cr-workflow`）→ 先 `search_local("子系统 关键词")` 找历史改动
- Commit Message 生成（`commit-message-workflow`）→ 先 `search_gerrit("xxx 模块 fix")` 找模板
- 找设计文档 → `search_local(source="confluence")`
- 跨源综合 → `search_local(source="all")` 一次拿三源 Top-K

## 三种检索模式（hybrid 是默认推荐）

| mode | 适用 | 性能 |
|---|---|---|
| `hybrid`（**默认**） | 通用；vector 找语义近似 + FTS5 找精确关键词，合并去重 | ~ 几十 ms ~ 500ms |
| `vector` | 同义改述、跨语言、概念相似（如"画面卡顿"vs"画面闪烁"） | 同上 |
| `fts` | 精确错误字符串、API 名、错误码（如 `0x80004005`、`SIGSEGV`） | < 50ms |

未明确需求时**直接用 `hybrid`**。

## 数据源（source 参数）

| source | 含义 | 内容 |
|---|---|---|
| `zmind` | Zmind PR/Bug 历史 | 标题 + 描述 + 项目 + 状态 + 时间 |
| `gerrit` | Gerrit changes | subject + commit_message + project + branch + owner |
| `confluence` | 文档中心页面 | title + body_text（HTML 转纯文本） |
| `all`（**默认**） | 三源跨源融合 | 并行召回 + 各源 Top-K 返回 |
| `aosp` | AOSP 代码 chunks | 仅 `search_aosp` 工具支持，按平台/模块过滤 |

## 工具用法

### 1. 检索：`search_local`

```jsonc
search_local(
  query: "蓝牙连接异常 偶现",
  source: "all",          // 跨源默认；可指定 zmind/gerrit/confluence
  mode: "hybrid",         // 默认；vector | fts | hybrid
  limit: 5                // 每源 Top-K，默认 5，上限 20
)
```

返回结构：
```jsonc
{
  source: "all", query: "...", mode: "hybrid",
  zmind: [
    { id, source, title, url, snippet, score, match: "vector"|"fts"|"both", status, project, updated }
  ],
  gerrit: [...],
  confluence: [...]
}
```

### 2. 拉详情：`get_indexed`

```jsonc
get_indexed(source: "zmind", id: 339183)  // 返回完整字段（不含向量）
```

用于 `search_local` 命中后取完整正文（snippet 是 320 字截断）。

### 3. AOSP 模块级精搜：`search_aosp`

```jsonc
search_aosp(
  query: "wifi 设置入口",
  platform: "X5",          // D4 | X5 | STB（必填配 module 时）
  module: "tvsystemui",    // 与 module-path-map 一致
  mode: "hybrid",
  limit: 5
)
```

`platform` + `module` 自动从 `module-path-map.md` 翻译成路径前缀过滤搜索域。

### 4. 端到端：`analyze_issue`（推荐）

替代手工 search_* 串接：

```jsonc
analyze_issue(
  issue_id: 334001,
  workspace_root: "<cwd>",  // 默认当前工作目录
  include_aosp: true,        // 是否启用 AOSP 精搜
  platform: "X5",            // 强制指定，否则从 issue 推断
  per_source_limit: 3
)
```

执行：拉 Zmind → 准备 `.workspace/issue-<id>/` → 提取关键词 → 三源 hybrid 检索 → 平台/模块推断 → AOSP 精搜（可选）→ 渲染 `analysis-context.md`。返回 JSON 汇总 + errors 数组。

## 同步与索引维护

### 全量初始化（首次部署）

```
sync_zmind({ limit: 5000 })          # 拉 Zmind issue（limit=0 / -1 = 不限，拉到 API 返回空）
sync_gerrit({ limit: 5000 })         # 拉 Gerrit changes，默认 query=(owner:self OR reviewer:self) -age:365d
sync_confluence({ space: "RDCenter", limit: 2000 })  # 文档中心

embed_pending({ source: "zmind", batch_size: 200 })       # 多次跑直到 total_pending=0
embed_pending({ source: "gerrit", batch_size: 200 })
embed_pending({ source: "confluence", batch_size: 200 })
```

首次 `embed_pending` 会自动下载 BGE-small-zh ONNX 模型（~80MB 到 `./data/models/`），约 1-3 分钟。后续启动秒级。

> **进度反馈**（v1.0.1+）：所有 sync 工具会输出 stderr 进度，如 `[gerrit-sync] page offset=0, got=200, total=200`，长 sync 不再静默。

### 增量同步（cookie/key 仍有效时）

```
sync_zmind()                     # 不传 since 时用上次 last_full_sync 水位增量拉
sync_gerrit()                    # default scope (owner:self OR reviewer:self) 始终生效
sync_confluence()                # auto 模式：REST 优先，REST 403 时自动切 searchv3 fallback
sync_confluence({mode:"html"})   # 强制 searchv3 fallback（用于账号无 REST batch 权限的场景）
embed_pending(source=...)        # 处理新增的 stale 行
```

**sync_confluence 三档模式**（v1.0.2+）：
- `auto`（默认）：先 REST（`/rest/api/content/search`），403 时自动降级到 searchv3
- `rest`：强制 REST，403 就报错
- `html`：跳过 REST 直接 searchv3（`/rest/searchv3/1.0/cqlSearch` + 自动 fallback 到 `/dosearchsite.action`）；适合已知 REST 403 的账号
- 环境变量 `KNOWLEDGE_CONFLUENCE_SYNC_MODE=html` 全局强制

建议每日跑一次（手动或定时任务）。

> **watermark 行为**（v1.0.1+）：watermark 用"已拉取的最大 updated"而非"sync 开始时间"，避免 sync 期间新数据漏拉。
> **default scope**（v1.0.1+）：sync_gerrit 默认 query 中的 `(owner:self OR reviewer:self)` 在增量同步时**始终保留**，不会因 since 参数让其退化为 `after:"..."` 拉所有人 changes。
> **拉所有数据**：`limit: 0` 或 `limit: -1` = 不限，循环到 API 返回空。

### AOSP 索引（可选，需要本地 repo）

```
list_aosp_modules({ platform: "X5" })       # 看 module-path-map 登记的模块名

index_aosp_module({                          # 索引一个模块
  platform: "X5",
  module: "tvsystemui",
  module_path: "vendor/whale/tv/...",        # 相对 repo_root
  repo_root: "/work/aosp/x5"
})

embed_aosp_pending({ batch_size: 200, platform: "X5", module: "tvsystemui" })
```

清理重建：

```
clear_aosp_index({ platform: "X5", module: "tvsystemui" })
# 然后重新 index_aosp_module + embed_aosp_pending
```

## 性能预期

| 规模 | 索引体积 | 嵌入时间 | search_local 响应 |
|---|---|---|---|
| 1k 行 | ~10 MB | ~ 1 分钟 | < 50 ms |
| 10k 行 | ~100 MB | ~ 10 分钟 | < 200 ms |
| 50k 行 | ~500 MB | ~ 50 分钟 | < 500 ms |
| AOSP 单模块（10k chunks） | ~100 MB | ~ 10 分钟 | < 200 ms |

数据库默认在 `./data/knowledge.db`（`KNOWLEDGE_DB_PATH` 可覆盖）。

## 与其他工具的协作

```
Bug 分析 (bug-analysis-workflow):
  analyze_issue ── 一键端到端
   或
  search_local("symptoms") → get_indexed → ... → 调 zmind-mcp.prepare_issue_workspace 拿附件

PR/CR 处理 (pr-cr-workflow):
  search_local("module + issue", source="all") → 结合命中分析改动 → 推送 Gerrit

Commit Message (commit-message-workflow):
  search_gerrit("module fix", limit=3) → 参考历史 commit message 风格

代码定位 (local-code-guide):
  module-path-map → search_local(source="gerrit") 找哪些 commit 改过该模块 → search_aosp 看具体代码
```

## 故障排查

| 现象 | 排查 |
|---|---|
| `embed_pending` 慢/卡住 | 首次下模型；中国大陆设 `HF_ENDPOINT=https://hf-mirror.com` |
| `search_local` 返回空 | 先确认 `embed_pending` 跑过；`mode=fts` 是否过严，换 `hybrid` |
| `search_local` 跨源某源失败 | 工具返回 `<source>_error` 字段，看具体错误（多半是凭据或网络） |
| `sync_gerrit` 401 | cookie 过期，跑 `scripts/refresh-auth` |
| `sync_gerrit` 0 命中（v1.0.0） | 已知 bug，升级到 v1.0.1+（修复 default query 解析 + 增量丢失 scope） |
| `sync_zmind` / `sync_confluence` 第二次起 0 命中（v1.0.0） | 已知 bug（watermark ISO 格式），升级到 v1.0.1+ |
| `sync_confluence` 302 → /login.action | cookie 过期，跑 `scripts/refresh-auth` |
| `sync_confluence` 403 "Not permitted to use confluence" | v1.0.2 起 auto 模式会自动切 `/rest/searchv3/1.0/cqlSearch` fallback（权限门槛更低，通常能拿到全量数据）。若还失败：强制 `mode:"html"` 或 `KNOWLEDGE_CONFLUENCE_SYNC_MODE=html`；仍失败则账号 view 权限也缺，找运维加 |
| AOSP `index_aosp_module` 慢 | 一个模块 ~ 几千 chunks 几分钟正常；用 `clear_aosp_index` 重置 |
| `node:sqlite not found` | Node 版本 < 22.5.0，升级 |
