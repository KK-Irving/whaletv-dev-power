# 设计文档：whaletv-dev-power v2 平台升级

## Overview

v2 升级在保持 stdio + npx + TypeScript 单进程部署模型不变的前提下，引入两个全新 MCP 服务器（confluence、knowledge），扩展 gerrit-mcp-server 与 zmind-mcp-server 的能力，并新增一组运维脚本（凭据自动刷新、一键升级安装）。

整体落地按四个阶段推进，每阶段独立验收：

| 阶段 | 范围 | 关键产出 | 用户感知 |
|---|---|---|---|
| **P0** | 双层认证修复、附件解压增强、WAF 重试、凭据刷新脚本 | 现有工具全部可用 | 立即解锁 v1.0.0 卡住的能力 |
| **P1** | confluence-mcp-server、knowledge-mcp-server（含三源同步与 hybrid 检索） | 两个新 MCP server，本地知识库 | 跨源历史检索秒级响应 |
| **P2** | AOSP 模块级精搜、analyze_issue 一键工作流 | 新工具 + steering 升级 | 工作流端到端串通 |
| **P3** | 部署脚本、onboarding、文档与发布 | setup-v2.* 脚本、POWER.md/README 升级 | 全员可平滑升级 |

## Architecture

整体架构沿用 v1.x 的"多 MCP server + Kiro 客户端 + 共享 steering"模型，在数据层与运维层做加法：

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Kiro 客户端（IDE + CLI）                         │
└────────────────┬────────────────────────────────────────────────────┘
                 │ stdio JSON-RPC
   ┌─────────────┼──────────────┬──────────────┬──────────────┐
   ▼             ▼              ▼              ▼              ▼
┌─────────┐ ┌─────────┐  ┌──────────────┐ ┌──────────┐ ┌────────────┐
│ zmind   │ │ gerrit  │  │ opengrok     │ │confluence│ │ knowledge  │
│  v2.1   │ │  v1.1   │  │   (不变)     │ │  v1.0    │ │   v1.0     │
└────┬────┘ └────┬────┘  └──────┬───────┘ └────┬─────┘ └──────┬─────┘
     │           │              │              │              │
     │ REST      │ REST(双通道) │ HTTP API    │ REST(cookie) │ 本地 SQLite
     │ X-Redmine │ Auth+Cookie  │              │              │ + 嵌入模型
     │           │              │              │              │
     ▼           ▼              ▼              ▼              ▼
  Zmind     Gerrit         OpenGrok       文档中心     data/knowledge.db
            (nginx + 内核)   (内网直连)     (Aliyun WAF)   + ONNX cache

[运维脚本 scripts/]
  refresh-auth.{ps1,sh,mjs} → Playwright 抓 cookie → 写 ~/.kiro/settings/mcp.json
  setup-v2.{ps1,sh}         → 一键依赖 + 凭据 + 模型下载

[Steering 工作流]
  bug-analysis / commit-message / pr-cr / cherry-pick / local-code-guide
  + auth-refresh（新）+ knowledge-base-workflow（新）
```

数据流的核心变化：
- **v1.x**：每个 MCP 工具都是 live API 直调
- **v2**：knowledge-mcp-server 接管"历史数据"检索，其他 server 只处理实时操作（live API 仍走原路径，但优先级降到第二档）
- **跨 server 协作**：analyze_issue 工具（位于 zmind-mcp-server）通过 import 共用核心库直接调 knowledge-mcp 的内部函数，避免子进程通信开销

## Components and Interfaces

### 仓库结构（v2 终态）
├── POWER.md                          # 升级 mcpServers 列表到 5 个
├── README.md                         # v2 章节与升级指南
├── mcp.json                          # 模板，包含全部 5 个 server 条目
├── agent/
│   └── whaletv-dev.json              # prompt 增加 search_local 优先级
├── mcp-servers/
│   ├── gerrit-mcp-server/            # v1.0.0 → v1.1.0
│   │   └── src/
│   │       ├── auth.ts               # ★改：双通道凭据
│   │       ├── http-client.ts        # ★改：headers + path 双模式
│   │       └── tools/                # 14 个工具不动
│   ├── opengrok-mcp-server/          # 不变
│   ├── zmind-mcp-server/             # v2.0.0 → v2.1.x（v2.1.0 实现，v2.1.1 修复 bin path）
│   │   └── src/
│   │       ├── attachment-handler.ts # ★改：RAR5 + 0 字节占位防御
│   │       ├── http-client.ts        # ★新增：WAF 重试 + 共享 client
│   │       └── index.ts              # 注册 prepare_issue_workspace 等 16 个工具
│   ├── confluence-mcp-server/        # ★新增 v1.0.0（P1）
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── auth.ts               # cookie 凭据
│   │       ├── http-client.ts
│   │       ├── html-strip.ts
│   │       └── tools/
│   │           ├── search.ts
│   │           ├── get-page.ts
│   │           └── list-spaces.ts
│   └── knowledge-mcp-server/         # ★新增 v1.0.0（P1+P2）
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── db.ts                 # better-sqlite3 + schema
│           ├── embedder.ts           # @xenova/transformers ONNX runtime
│           ├── index-store.ts        # 进程内 Float32Array 矩阵 + lazy load
│           ├── search.ts             # vector / fts / hybrid 三模式
│           ├── sources/
│           │   ├── zmind-sync.ts
│           │   ├── gerrit-sync.ts
│           │   └── confluence-sync.ts
│           ├── aosp/                 # P2
│           │   ├── chunker.ts
│           │   ├── module-map-loader.ts
│           │   └── indexer.ts
│           └── index.ts              # 注册 sync_* / embed_* / search_* / get_indexed
├── scripts/                          # ★新增（P0+ / P3）
│   ├── refresh-auth.ps1              # Windows 凭据刷新
│   ├── refresh-auth.sh               # Linux/macOS 凭据刷新
│   ├── refresh-auth.mjs              # Playwright 实现核心
│   ├── setup-v2.ps1                  # Windows 一键升级
│   └── setup-v2.sh                   # Linux/macOS 一键升级
├── steering/                          # 部分文件升级
│   ├── bug-analysis-workflow.md      # ★改：先查 search_local
│   ├── commit-message-workflow.md    # ★改：先查 search_gerrit
│   ├── pr-cr-workflow.md             # ★改：使用 analyze_issue
│   ├── local-code-guide.md           # ★改：5 档搜索策略
│   ├── onboarding.md                 # ★改：v2 配置流程
│   ├── knowledge-base-workflow.md    # ★新增：本地索引使用规范
│   └── auth-refresh.md               # ★新增：凭据刷新指引
├── .kiro/specs/v2-platform-upgrade/  # 本规划
└── .learnings/
    └── FEATURE_REQUESTS.md           # 加 FR-002~FR-009
```

### 核心模块设计

### 模块 A：Gerrit 双通道认证（需求 1）

#### 数据模型
```typescript
// auth.ts
export interface GerritConfig {
  url: string;
  // 模式 A：会话凭据（首选，能过 nginx + Gerrit）
  authHeader: string;   // raw "Basic xxx" or "Bearer xxx"
  cookie: string;       // raw "GerritAccount=...; XSRF_TOKEN=..."
  // 模式 B：HTTP Credentials（直连，无 nginx 部署用）
  username: string;
  password: string;
  timeoutMs: number;
}

export type AuthMode = "session" | "basic" | "missing";
```

#### 凭据决策表
| `GERRIT_AUTH_HEADER` | `GERRIT_COOKIE` | `GERRIT_USERNAME` | `GERRIT_HTTP_PASSWORD` | 模式 |
|---|---|---|---|---|
| ✓ | ✓ | * | * | session（优先） |
| × | × | ✓ | ✓ | basic |
| 其他不完整组合 | | | | missing → 抛 config_error |

#### 请求构造规则
| 模式 | 路径前缀 | Authorization | Cookie |
|---|---|---|---|
| session | non-/a/（如 `/changes/123`） | raw `authHeader` 直接透传 | raw `cookie` 直接透传 |
| basic | `/a/` 强制注入（如 `/a/changes/123`） | `Basic <b64(user:pass)>` | 不带 |

#### 错误信息升级
```typescript
// errors.ts buildHttpErrorMessage
if (status === 401) {
  if (mode === "session") {
    return "Gerrit 401: cookie 已过期，运行 scripts/refresh-auth 重新抓取";
  }
  return "Gerrit 401: HTTP Credentials 错误，检查 GERRIT_USERNAME 与 GERRIT_HTTP_PASSWORD";
}
```

### 模块 B：会话凭据自动刷新脚本（需求 2）

#### 流程图
```
用户运行 scripts/refresh-auth
        │
        ▼
读取 username（环境变量 WHALE_USER 或 prompt）
        │
        ▼
读取 SSO 密码（环境变量 WHALE_PASSWORD 或 prompt -Secure）
        │
        ▼
启动 Playwright Chromium（headless=true）
   设置 httpCredentials={user, pass}（应答 nginx Basic Auth）
        │
        ▼
goto https://whale-gerrit.zeasn.com/
   等待 <body>.dashboard 或 <link rel="canonical"> 等就绪标志
        │
        ▼
context.cookies('https://whale-gerrit.zeasn.com')
   过滤 name in {"GerritAccount", "XSRF_TOKEN"}
        │
        ▼
计算 authHeader = "Basic " + base64(user:pass)
计算 cookieStr  = "GerritAccount=...; XSRF_TOKEN=..."
        │
        ▼
（可选）同样流程对 https://docs.whaletv.com 拿 confluence cookie
        │
        ▼
读取 ~/.kiro/settings/mcp.json，深合并写入：
  mcpServers["…gerrit-mcp-server"].env.GERRIT_AUTH_HEADER
  mcpServers["…gerrit-mcp-server"].env.GERRIT_COOKIE
  mcpServers["…confluence-mcp-server"].env.CONFLUENCE_COOKIE
        │
        ▼
自检：用新凭据 fetch '/changes/?n=1' → 200 即通过
        │
        ▼
打印结果，退出（密码从未落盘）
```

#### 实现选型
- **Playwright** > Puppeteer：原因是 Playwright 的 `httpCredentials` API 简洁、跨浏览器、安装单条命令（`npx playwright install chromium`）
- **Node.js 子进程而非 Python**：与现有 Power 全 TS 技术栈一致，避免引入 Python 运行时
- **薄壳脚本（.ps1/.sh）→ 调用 .mjs**：壳负责 Windows PowerShell 与 Bash 平台差异（密码隐藏输入、路径展开），核心流程用 Node 单文件 `refresh-auth.mjs`

#### 关键代码骨架
```javascript
// scripts/refresh-auth.mjs
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

async function captureCookies({ baseUrl, user, pass, names, readyHint }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    httpCredentials: { username: user, password: pass },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 });
  if (readyHint) await page.waitForSelector(readyHint, { timeout: 10000 });
  const all = await context.cookies(baseUrl);
  await browser.close();
  return all
    .filter((c) => names.includes(c.name))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

async function refresh({ user, pass, mcpJsonPath, gerritKey, confluenceKey }) {
  const gerritCookie = await captureCookies({
    baseUrl: "https://whale-gerrit.zeasn.com",
    user, pass,
    names: ["GerritAccount", "XSRF_TOKEN"],
  });
  const authHeader = "Basic " + Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
  const confluenceCookie = await captureCookies({
    baseUrl: "https://docs.whaletv.com",
    user, pass,
    names: ["JSESSIONID", "seraph.confluence", "acw_tc"],
  });

  const cfg = JSON.parse(await readFile(mcpJsonPath, "utf8").catch(() => "{}"));
  cfg.mcpServers ??= {};
  cfg.mcpServers[gerritKey] ??= {};
  cfg.mcpServers[gerritKey].env ??= {};
  cfg.mcpServers[gerritKey].env.GERRIT_AUTH_HEADER = authHeader;
  cfg.mcpServers[gerritKey].env.GERRIT_COOKIE = gerritCookie;
  if (confluenceCookie) {
    cfg.mcpServers[confluenceKey] ??= {};
    cfg.mcpServers[confluenceKey].env ??= {};
    cfg.mcpServers[confluenceKey].env.CONFLUENCE_COOKIE = confluenceCookie;
  }
  await mkdir(dirname(mcpJsonPath), { recursive: true });
  await writeFile(mcpJsonPath, JSON.stringify(cfg, null, 2), "utf8");

  // 自检
  const test = await fetch("https://whale-gerrit.zeasn.com/changes/?n=1", {
    headers: { Authorization: authHeader, Cookie: gerritCookie, Accept: "application/json" },
  });
  return { ok: test.ok, status: test.status };
}
```

### 模块 C：附件解压增强（需求 3）

#### 解压器降级链
```
.rar 文件
  │
  ├─ 1. unar -quiet -force-overwrite -o <dst> <archive>
  │     ├─ 检查 dst 内非空文件 → 成功 ✓
  │     └─ 全 0 字节 → 失败，清空 dst，下一档
  │
  ├─ 2. node-rar / rarfile 库（如果安装）
  │     ├─ 抛异常 → 下一档
  │     └─ 解出非空 → 成功 ✓
  │
  └─ 3. 7z x -y -o<dst> <archive>
        ├─ exit != 0 → 失败
        └─ exit 0 → 检查非空文件
```

#### 0 字节防御
```typescript
function hasUsefulContent(dir: string): boolean {
  for (const p of walk(dir)) {
    if (statSync(p).size > 0 && statSync(p).isFile()) return true;
  }
  return false;
}
```

#### 缓存与失效
- 解压成功 → `touch <archive>.extracted_ok`
- 下次下载发现 etag/size 变化 → `unlink .extracted_ok` 强制重解
- 命中 stamp 则跳过

### 模块 D：WAF 重试（需求 4）

#### 重试包装器
```typescript
async function getWithWafRetry(url: string, headers: Record<string, string>, attempts = 5): Promise<Response> {
  const RETRY_CODES = new Set([403, 429, 502, 503]);
  let lastResp: Response | undefined;
  for (let i = 0; i < attempts; i++) {
    const client = i === 0 ? sharedClient() : freshClient();
    lastResp = await client.fetch(url, { headers });
    if (!RETRY_CODES.has(lastResp.status)) return lastResp;
    await sleep(800 * (i + 1));
  }
  return lastResp!;
}
```

`freshClient()` 关键：每次 new 一个 `https.Agent({ keepAlive: false })` 配合的 fetch 实例，确保不复用连接池中被 WAF 标记的连接。

### 模块 E：confluence-mcp-server（需求 5）

#### REST 调用契约
| 操作 | URL Pattern | 关键参数 | 返回处理 |
|---|---|---|---|
| 搜索 | `GET /rest/api/content/search` | `cql`, `limit`, `expand=body.view,space` | 解 `results[]`，HTML→纯文本 |
| 取页 | `GET /rest/api/content/<id>` | `expand=body.view,space,version` | 解全文，截断 8000 字 |
| 列空间 | `GET /rest/api/space?type=global` | `start`, `limit=100` | 分页累加直到 `size < 100` |

CQL 自动包装：
```typescript
function buildCql(q: string, space?: string): string {
  const looksLikeCql = /\b(AND|OR|NOT|space|type|title|text)\s*[~=:]/.test(q);
  let cql = looksLikeCql ? q : `text ~ "${q.replace(/"/g, '\\"')}"`;
  if (space) cql += ` AND space.key = "${space}"`;
  return cql + " AND type = page";
}
```

### 模块 F：knowledge-mcp-server（需求 6+7）

#### 数据库 Schema
```sql
-- 三源主表（结构相似，仅举 zmind 例）
CREATE TABLE IF NOT EXISTS zmind_issues (
  id INTEGER PRIMARY KEY,
  tracker TEXT, subject TEXT, description TEXT, status TEXT,
  assigned_to TEXT, project_id INTEGER,
  created_on TEXT, updated_on TEXT,
  embedding BLOB, embedding_updated_at TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS zmind_issues_fts USING fts5(
  subject, description, content='zmind_issues', content_rowid='id',
  tokenize='unicode61'
);
-- 触发器同步 FTS
CREATE TRIGGER zmind_issues_ai AFTER INSERT ON zmind_issues BEGIN
  INSERT INTO zmind_issues_fts(rowid, subject, description)
  VALUES (new.id, new.subject, new.description);
END;
-- ... 类似 _au / _ad

CREATE TABLE IF NOT EXISTS sync_state (
  source TEXT, key TEXT, value TEXT,
  PRIMARY KEY (source, key)
);

-- AOSP chunks（P2）
CREATE TABLE IF NOT EXISTS aosp_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT, module_path TEXT, file_path TEXT,
  line_start INTEGER, line_end INTEGER, content TEXT,
  embedding BLOB, embedding_updated_at TEXT
);
CREATE INDEX idx_aosp_platform_module ON aosp_chunks(platform, module_path);
```

#### 嵌入流程
```typescript
import { pipeline } from "@xenova/transformers";
const embedder = await pipeline("feature-extraction", "Xenova/bge-small-zh-v1.5");

async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const out = await embedder(texts, { pooling: "mean", normalize: true });
  // out.dims = [N, 512]
  const N = out.dims[0], D = out.dims[1];
  const flat = out.data;
  const result: Float32Array[] = [];
  for (let i = 0; i < N; i++) {
    result.push(new Float32Array(flat.buffer, flat.byteOffset + i * D * 4, D).slice());
  }
  return result;
}
```

#### Hybrid 检索算法
```
输入 query, source, mode, limit
  │
  ├─ mode == "vector":
  │     vec = embed([query])[0]
  │     M = loadIndex(source).matrix  // [N, 512] Float32Array
  │     scores = M · vec               // 手写 SIMD-friendly 循环
  │     return topK(scores, limit) → 标 match="vector"
  │
  ├─ mode == "fts":
  │     rows = db.exec("SELECT id, bm25(<fts>) AS s FROM <fts> WHERE <fts> MATCH ? ORDER BY s LIMIT ?", [query, limit])
  │     return rows → 标 match="fts"
  │
  └─ mode == "hybrid":
        vecHits = vector(limit*2)
        ftsHits = fts(limit*2)
        merge by id, keep max(score)
        normalize 各通道分到 [0,1]
        return top by combined score → 标 match="vector"|"fts"|"both"
```

#### 文件矩阵 lazy 加载
```typescript
interface SourceIndex {
  ids: number[];
  matrix: Float32Array;  // 长度 = N * 512
  meta: Record<number, RowMeta>;
}

const _cache = new Map<string, SourceIndex>();

function loadIndex(source: string): SourceIndex {
  if (_cache.has(source)) return _cache.get(source)!;
  const rows = db.prepare(`SELECT id, embedding, ... FROM ${tableOf(source)} WHERE embedding IS NOT NULL`).all();
  const matrix = new Float32Array(rows.length * 512);
  const ids: number[] = [], meta: Record<number, RowMeta> = {};
  rows.forEach((r, i) => {
    ids.push(r.id);
    meta[r.id] = { /* extracted fields */ };
    new Float32Array(matrix.buffer, i * 512 * 4, 512).set(new Float32Array(r.embedding.buffer));
  });
  _cache.set(source, { ids, matrix, meta });
  return _cache.get(source)!;
}
```

任何 sync_/embed_ 工具调用完触发 `_cache.delete(source)` 让下次 search 重建。

### 模块 G：AOSP 模块级精搜（需求 7，P2）

#### chunking 规则
```typescript
function chunkFile(path: string, content: string, MAX = 2000): Chunk[] {
  const lang = guessLang(path);  // .java/.cpp/.kt/.py
  // 优先按函数/类边界切（用 tree-sitter-* 或简单正则识别）
  const boundaries = findBoundaries(lang, content);  // [{ kind: "method", line: 120, name: "onCreate" }, ...]
  const chunks: Chunk[] = [];
  let buf: string[] = [], bufStart = 1, bufLen = 0;
  for (let line = 0; line < content.split("\n").length; line++) {
    // 按行累计；若达到边界 + bufLen > MAX/2 则切片；超 MAX 强切
    // ...
  }
  return chunks;
}
```

#### module-path-map 集成
预提取一份 `data/module-map.json`（首次启动时由 `module-path-map.md` 转换）：
```json
{
  "platforms": {
    "D4": { "modules": { "tvsystemui": ["packages/apps/TvSystemUI", ...], ... } },
    "X5": { ... },
    "STB": { ... }
  }
}
```

`search_aosp(platform="X5", module="tvsystemui")` 自动转化为 `WHERE platform = 'X5' AND module_path IN (...)`。

### 模块 H：analyze_issue 一键工作流（需求 8，P2）

```typescript
async function analyzeIssue({ issueId, includeAosp }: AnalyzeArgs): Promise<AnalyzeResult> {
  const ws = await prepareIssueWorkspace(issueId);  // 已有
  const issue = await getIssueWithAttachments(issueId);
  const downloaded = await downloadAndExtractAll(issue, ws);
  const keywords = extractKeywords(issue.subject + " " + (issue.description || "").slice(0, 200));
  const similar = await searchLocal({ query: keywords, source: "all", limit: 3 });
  let aospHits: AospHit[] = [];
  if (includeAosp) {
    const inferredModule = inferModuleFromHits(similar);  // 看 gerrit/zmind 命中提到的文件路径
    if (inferredModule) {
      aospHits = await searchAosp({ query: keywords, ...inferredModule, limit: 3 });
    }
  }
  const ctx = renderContextMd({ issue, downloaded, similar, aospHits });
  await writeFile(join(ws, "analysis-context.md"), ctx);
  return { workspace_path: ws, issue, attachment_summary: downloaded, similar, aosp_hits: aospHits, context_md_path: join(ws, "analysis-context.md") };
}
```

每一步用 try/catch 包，失败信息写到 `ctx` 的"已知问题"段。

### 技术决策清单

### 嵌入模型选择
| 选项 | 优点 | 缺点 | 选 |
|---|---|---|---|
| BGE-small-zh-v1.5 ONNX | 中文优、80MB、512 dim、Apache-2.0 | 长文本截断 512 token | ✓ |
| BGE-large-zh | 精度高 | 1.3GB、慢 | × |
| 多语言 multilingual-e5-small | 跨语支持 | 中文略弱 | × |
| OpenAI text-embedding-3-small | API、易接 | 联网、成本、合规问题 | × |

### 向量存储
| 选项 | 优点 | 缺点 | 选 |
|---|---|---|---|
| SQLite BLOB + numpy/Float32Array | 单文件、无运维、对小规模数据足够 | 全表 dot product，>10w 慢 | ✓（v2 数据规模够用） |
| sqlite-vec / sqlite-vss | 内置 ANN | 需要编译扩展、Windows 麻烦 | × |
| FAISS | 真正快 | 大依赖、Python 生态 | × |
| Milvus / Qdrant | 工业级 | 需要单独部署 | × |

### 浏览器自动化
| 选项 | 优点 | 缺点 | 选 |
|---|---|---|---|
| Playwright | API 简洁、httpCredentials 内建、跨浏览器 | 首次下载 ~150MB chromium | ✓ |
| Puppeteer | 老牌 | API 略冗长、SPA 等待略弱 | × |
| 直接用 fetch + cookie 解析 | 无依赖 | 不能处理 SAML 跳转 | × |

## Data Models

### Gerrit 配置（auth.ts）

```typescript
export interface GerritConfig {
  url: string;                  // 必填
  authHeader: string;           // 模式 A：raw "Basic xxx"，过 nginx
  cookie: string;               // 模式 A：raw "GerritAccount=...; XSRF_TOKEN=..."，过 Gerrit
  username: string;             // 模式 B
  password: string;             // 模式 B
  timeoutMs: number;            // 默认 30000
}
export type AuthMode = "session" | "basic" | "missing";
```

### Confluence 配置（auth.ts）

```typescript
export interface ConfluenceConfig {
  url: string;                          // 必填，如 https://docs.whaletv.com
  cookie: string;                       // 必填，浏览器登录抓
  requestDelayMs: number;               // 默认 150，控制 WAF 限速
  timeoutMs: number;                    // 默认 30000
}
```

### Knowledge SQLite Schema

```sql
-- ============ 公共：同步水位 ============
CREATE TABLE IF NOT EXISTS sync_state (
  source TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (source, key)
);

-- ============ Zmind issues ============
CREATE TABLE IF NOT EXISTS zmind_issues (
  id INTEGER PRIMARY KEY,
  tracker TEXT, subject TEXT, description TEXT, status TEXT,
  assigned_to TEXT, project_id INTEGER,
  created_on TEXT, updated_on TEXT,
  embedding BLOB,                      -- float32 × 512 序列化
  embedding_updated_at TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS zmind_issues_fts USING fts5(
  subject, description,
  content='zmind_issues', content_rowid='id',
  tokenize='unicode61'
);
-- 配套触发器：_ai / _au / _ad 同步 FTS

-- ============ Gerrit changes ============
CREATE TABLE IF NOT EXISTS gerrit_changes (
  change_id TEXT PRIMARY KEY,
  number INTEGER, project TEXT, branch TEXT,
  subject TEXT, commit_message TEXT, owner_name TEXT,
  status TEXT, created TEXT, updated TEXT,
  embedding BLOB, embedding_updated_at TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS gerrit_changes_fts USING fts5(
  subject, commit_message,
  content='gerrit_changes', content_rowid='rowid',
  tokenize='unicode61'
);

-- ============ Confluence pages ============
CREATE TABLE IF NOT EXISTS confluence_pages (
  id TEXT PRIMARY KEY,
  space_key TEXT, title TEXT, body_text TEXT, body_html TEXT,
  version INTEGER, webui TEXT,
  created TEXT, updated TEXT,
  embedding BLOB, embedding_updated_at TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS confluence_pages_fts USING fts5(
  title, body_text,
  content='confluence_pages', content_rowid='rowid',
  tokenize='unicode61'
);

-- ============ AOSP chunks（P2） ============
CREATE TABLE IF NOT EXISTS aosp_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,              -- D4 / X5 / STB
  module_path TEXT NOT NULL,           -- 来自 module-path-map
  file_path TEXT NOT NULL,
  line_start INTEGER, line_end INTEGER,
  content TEXT,
  embedding BLOB, embedding_updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_aosp_pm ON aosp_chunks(platform, module_path);
CREATE VIRTUAL TABLE IF NOT EXISTS aosp_chunks_fts USING fts5(
  content,
  content='aosp_chunks', content_rowid='id',
  tokenize='unicode61'
);
```

### MCP 工具签名（关键工具）

```typescript
// gerrit-mcp v1.1.0（既有 14 个工具签名不变，仅增强行为）

// confluence-mcp v1.0.0
search_confluence(query: string, space?: string, limit: number = 5): SearchResult
get_page(page_id: string): PageDetail
list_spaces(): Space[]

// knowledge-mcp v1.0.0
sync_zmind(opts: { since?: string, limit?: number }): SyncStats
sync_gerrit(opts: { query?: string, since?: string, limit?: number }): SyncStats
sync_confluence(opts: { space?: string, since?: string, limit?: number }): SyncStats
embed_pending(source: "zmind"|"gerrit"|"confluence"|"aosp", batchSize?: number): { embedded: number }
search_local(query: string, source: "zmind"|"gerrit"|"confluence"|"all" = "all",
             mode: "vector"|"fts"|"hybrid" = "hybrid", limit: number = 5): MultiSourceResult
get_indexed(source: string, id: string): IndexedRecord

// knowledge-mcp P2
index_aosp_module(opts: { platform: "D4"|"X5"|"STB", modulePath: string, repoRoot: string }): { chunks: number }
search_aosp(query: string, platform?: string, module?: string, limit: number = 5): AospHit[]
clear_aosp_index(opts: { platform?: string, module?: string }): { cleared: number }

// knowledge-mcp v1.0.0 端到端工作流（实际归入 knowledge-mcp，依赖三源 sync + AOSP 索引）
analyze_issue(issue_id: number, include_aosp?: boolean): AnalyzeResult
```

## Correctness Properties

### Property 1: 凭据双通道幂等性
注入 `/a/` 前缀的逻辑必须在所有可能的输入路径下幂等（已含前缀的路径不再次注入），由 `injectAuthPrefix` 单元测试覆盖。
**Validates: Requirements 1.2, 1.3**

### Property 2: XSSI 剥离幂等性
剥离 `)]}'` 前缀只对真正以该前缀开头的响应生效，其他响应保持原样不破坏前导空白。
**Validates: Requirements 1.5**

### Property 3: 配置缺失检测原子性
`requireGerritConfig()` 必须一次性检查所有必需变量并在错误信息中列全；不允许"先检查 url 再检查 username"导致部分错误信息丢失。
**Validates: Requirements 1.4, 5.7**

### Property 4: 解压结果非空保证
解压器返回成功状态码后必须验证目标目录至少有 1 个非 0 字节文件，否则视为失败。
**Validates: Requirements 3.2, 3.3**

### Property 5: WAF 重试隔离性
限速重试必须使用全新连接，不能复用进程级 client 的连接池。
**Validates: Requirements 4.2**

### Property 6: 凭据写入原子性
`refresh-auth` 写 mcp.json 时必须先 backup 再写，且要保留所有未涉及的 mcpServers 与顶层字段。
**Validates: Requirements 2.5, 2.6**

### Property 7: 嵌入索引一致性
`embed_pending` 完成后必须 invalidate 内存中对应 source 的索引矩阵；下一次 search_local 必须重新加载。
**Validates: Requirements 6.7, 6.13**

### Property 8: 跨源融合无遗漏
`search_local(source="all")` 必须为每个源独立执行检索，单源失败不应阻塞其他源（best-effort）。
**Validates: Requirements 6.10, 8.8**

## Error Handling

| 错误来源 | 错误码 | 触发条件 | 用户可见信息 | 用户处理动作 |
|---|---|---|---|---|
| Gerrit 配置缺失 | `config_error` | 两种凭据模式都不完整 | 列出两组所需变量 | 运行 `scripts/refresh-auth` |
| Gerrit 401 (session) | `unauthenticated` | cookie 过期 | "cookie 已过期，运行 refresh-auth" | 同上 |
| Gerrit 401 (basic) | `unauthenticated` | password 错误 | "HTTP_PASSWORD 错误" | 检查 mcp.json |
| Gerrit 网络超时 | `request_timeout` | AbortController 触发 | URL + timeout_ms | 检查 VPN/网络 |
| Zmind WAF 限速 | （重试 5 次仍失败） | 全部 attempts 返回 [403,429,502,503] | "WAF 限速，请稍后重试" | 等几分钟 |
| Confluence cookie 过期 | `unauthenticated` | 401/302 到登录页 | 同 Gerrit | refresh-auth |
| 解压全失败 | `extraction_failed` | 三档降级都失败 | 原因清单（unar/rarfile/7z 各自返回） | 装解压器 |
| 嵌入模型加载失败 | `internal_error` | ONNX 模型损坏 / 网络下载失败 | "模型加载失败" + 路径 | 删 `data/models/` 重下 |
| SQLite 数据库锁 | `internal_error` | sync 与 search 并发写读 | "数据库忙" | 重试 |

所有错误一律走 `StructuredError` 类，message 必须可直接展示给用户。

## Testing Strategy

| 层级 | 范围 | 工具 |
|---|---|---|
| 单元测试 | `injectAuthPrefix` / `stripXssiPrefix` / `buildCql` / `chunkFile` / `mergeHybrid` | Vitest（直接 import 函数） |
| 集成测试 | 各 MCP server 的 stdio 启动 + 工具调用 mock fetch | Vitest + Mock Service Worker |
| Smoke 测试 | 真实凭据下跑 14 + 3 + 7 + 8 个工具至少一次 | 自写 `scripts/smoke-test.mjs` |
| 性能基准 | search_local 在 10K / 50K / 100K 行下的响应时间 | benchmark 脚本，输出 P50/P95/P99 |
| 端到端 | analyze_issue 对真实 PR 的输出可读性 | 人工抽样 5 条 PR |
| 部署测试 | 干净 Windows / macOS / Linux 上跑 setup-v2 | 测试机轮转 |

测试不强制 100% 覆盖，但以下路径必须有测试：
- 双层认证决策表（session / basic / missing）
- WAF 重试退避序列
- mcp.json 深合并写入（保留其他字段）
- 跨源融合的 best-effort 失败处理

## 兼容性与回滚

- **gerrit-mcp v1.0 → v1.1** 是纯加法（增加 env 变量、增加路径模式分支），没有破坏既有契约；老用户配 `GERRIT_USERNAME` + `GERRIT_HTTP_PASSWORD` 模式继续可用
- **zmind-mcp v2.0 → v2.1** 仅增加 `analyze_issue` 工具与 WAF 重试包装，既有工具行为不变
- **新 MCP server**（confluence、knowledge）默认 `disabled: false` 但若环境变量缺失会在工具调用时报 config_error，不影响其他工具
- **回滚**：把 `mcp.json` 中两个新 server 设 `disabled: true` 即恢复 v1.x 体验

## 验收一览

| 阶段 | 关键指标 | 验收方式 |
|---|---|---|
| P0 完成 | 14 个 Gerrit 工具在 winn.wei 账号下全部成功调用一次 | 跑端到端 smoke test 脚本 |
| P0+ 完成 | `scripts/refresh-auth` 在干净 Windows 上一条命令拿到 cookie 并自检通过 | 在测试机重装后跑 |
| P1 完成 | `search_local("xxx 偶现死机", source="all", limit=5)` 在 ≥1 万条索引上返回 < 500ms | benchmark 脚本 |
| P2 完成 | `analyze_issue(<某真实 PR id>)` 输出 `analysis-context.md` 含三源命中 + AOSP 命中 | 人工抽样验证 |
| P3 完成 | 新同事在干净机器上跑 `setup-v2.ps1` < 5 分钟全部就绪 | 拉一个新同事实测 |
