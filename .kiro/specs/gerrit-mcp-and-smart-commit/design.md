# Design Document

## Overview

本特性新增两大独立但互相耦合的能力，使 WhaleTV 开发者从 Zmind 分析到 Gerrit 推送的全链路完全 MCP 化、智能化：

1. **Gerrit MCP Server**：位于 `mcp-servers/gerrit-mcp-server/` 的独立 MCP 服务器，通过 stdio 与 Kiro 通信，向 Kiro 暴露 12 个 Gerrit REST API 工具（4 个读 + 8 个写），覆盖 Change/Branch/Comment 查询、Cherry-Pick、推送 `refs/for/<target>`、评论、Reviewer/Label 管理。它的目的是替代当前 PR/CR 工作流中对外部 `gerritpush` shell 命令的依赖，并让 cherry-pick 由 Gerrit 服务端执行（避免本地 git 操作的复杂性）。

2. **智能 Commit Message 生成器**：由新增 Steering File `commit-message-workflow.md` 描述行为契约（**不是独立服务**，而是 AI 在 Steering 指导下的能力）。输入是 `git diff --staged` + 当前 Zmind Issue 详情 + Branch_Detector 识别出的目标推送分支，输出是符合团队规范的完整五段式 commit message。

两大模块在端到端工作流中协同：Zmind 分析 → Gerrit 检索 → 本地代码定位 → 修改 → diff 确认 → `git add -p` → Commit Message 生成 → 用户确认 → Gerrit 推送 → 用户验证。本设计同时要求更新 4 个现有 Steering File、`POWER.md`、`mcp.json` 和 hooks 配置，使新能力与现有安全约束、人工确认机制无缝集成。

### 设计决策摘要

| 决策 | 选择 | 理由 |
|------|------|------|
| Gerrit 写操作位置 | 独立 MCP Server，stdio 传输 | 与 zmind/opengrok 一致，便于发布和复用 |
| 推送实现方式 | spawn `git push` 子进程（不是纯 REST） | Gerrit 推送依赖 git 协议（push options 解析、Change-Id hook），REST 无法替代 |
| Cherry-Pick 实现方式 | 调用 Gerrit `revisions/cherrypick` REST | 避免本地 fetch+rebase+push 的复杂性，由 Gerrit 服务端处理冲突探测 |
| Commit Message Generator | Steering File 驱动（无独立服务） | 它是 AI 行为契约而非可执行代码；与现有 Steering 体系一致 |
| Branch_Detector | Steering File 描述策略 + 调用现有工具实现 | 多级降级中前 3 级仅需本地命令，无需新写专用工具 |
| 错误处理 | 结构化错误对象（`error_type` + `message` + `http_status`） | 让 AI 能据此分类汇报，而非黑盒异常 |

## Architecture

### 整体架构

```mermaid
graph TB
    Developer[Developer]
    Kiro[Kiro CLI / IDE]

    subgraph "whaletv-dev-power Power"
        Steering["Steering Files<br/>(pr-cr / gerrit / cherry-pick /<br/>commit-message / safety-rules)"]
        Hooks["hooks/safety-hooks.json"]

        subgraph "MCP Servers"
            Zmind["zmind-mcp-server<br/>(15 tools)"]
            OpenGrok["opengrok-mcp-server<br/>(4 tools)"]
            Gerrit["gerrit-mcp-server<br/>(12 tools, 新增)"]
        end
    end

    subgraph "External Services"
        ZmindAPI["Zmind REST API<br/>(zmind.whaletv.com)"]
        GerritAPI["Gerrit REST API<br/>(whale-gerrit.zeasn.com)"]
        OpenGrokAPI["OpenGrok REST API"]
        GitRepo["Local Git Repo<br/>(git push child process)"]
    end

    Developer --> Kiro
    Kiro -->|loads| Steering
    Kiro -->|preToolUse hooks| Hooks
    Kiro -->|stdio MCP| Zmind
    Kiro -->|stdio MCP| OpenGrok
    Kiro -->|stdio MCP| Gerrit

    Zmind --> ZmindAPI
    OpenGrok --> OpenGrokAPI
    Gerrit -->|HTTPS Basic Auth| GerritAPI
    Gerrit -->|spawn| GitRepo
```

### 端到端工作流

```mermaid
flowchart TD
    Start([Developer 触发]) --> Step1["① 分析 Zmind Issue<br/>get_issue + 附件分类"]
    Step1 --> Step2["② Gerrit 检索<br/>search_changes / get_change_comments"]
    Step2 --> Step3["③ 本地代码定位<br/>git grep → OpenGrok 降级"]
    Step3 --> Step4["④ 修改代码"]
    Step4 --> Step5["⑤ git diff 展示"]
    Step5 --> Confirm1{👤 Developer<br/>确认 diff?}
    Confirm1 -->|否| Step4
    Confirm1 -->|是| Step6["⑥ git add -p<br/>(hunk 级精确暂存)"]
    Step6 --> Step7["⑦ Commit_Message_Generator<br/>生成五段式 commit message"]
    Step7 --> Confirm2{👤 Developer<br/>确认 commit msg?}
    Confirm2 -->|否| Step7
    Confirm2 -->|是| Step8["⑧ Branch_Detector 识别<br/>目标推送分支"]
    Step8 --> Confirm3{👤 Developer<br/>确认目标分支?}
    Confirm3 -->|否, MP 分支| Stop([终止/手动处理])
    Confirm3 -->|是| Step9["⑨ Gerrit_Push_Tool<br/>push_to_gerrit"]
    Step9 --> Step10["⑩ Developer 验证修复<br/>+ 更新 Zmind 评论"]
    Step10 --> End([完成])
```

### MCP Server 内部结构

```mermaid
graph LR
    subgraph "gerrit-mcp-server"
        Index[src/index.ts<br/>入口 + 工具注册]
        Auth[auth.ts<br/>Basic Auth 编码]
        HTTP[http-client.ts<br/>统一 fetch + XSSI + 超时]
        Errors[errors.ts<br/>结构化错误]
        Types[types.ts<br/>共用类型]

        subgraph "tools/"
            Query[query.ts]
            CherryPick[cherry-pick.ts]
            Push[push.ts]
            Comment[comment.ts]
            Reviewer[reviewer.ts]
        end

        Index --> Query & CherryPick & Push & Comment & Reviewer
        Query & CherryPick & Comment & Reviewer --> HTTP
        Push -.git push spawn.-> SubProc[child_process.spawn]
        HTTP --> Auth
        HTTP --> Errors
        HTTP --> Types
    end
```

## 项目目录结构

### 新增目录树

```
mcp-servers/gerrit-mcp-server/
├── package.json
├── tsconfig.json
├── package-lock.json (npm install 后生成)
└── src/
    ├── index.ts              # MCP server 入口 + 工具注册
    ├── auth.ts               # Basic Auth 编码 + 配置校验
    ├── http-client.ts        # fetch 封装 + XSSI 前缀剥离 + 超时控制 + /a/ 注入
    ├── errors.ts             # StructuredError 类 + HTTP 状态映射
    ├── types.ts              # 公共 TypeScript 类型定义
    └── tools/
        ├── query.ts          # query_change / list_branches / get_change_comments / search_changes
        ├── cherry-pick.ts    # cherry_pick_change（含三态判别）
        ├── push.ts           # push_to_gerrit（spawn git push + MP 拒绝 + URL 解析）
        ├── comment.ts        # add_review_comment / reply_inline_comment / mark_comment_resolved
        └── reviewer.ts       # add_reviewer / remove_reviewer / set_review_label
```

### 新增 Steering File

```
steering/
└── commit-message-workflow.md  # 新增：描述 Commit_Message_Generator 与 Branch_Detector 行为契约
```

### 现有文件更新清单

| 文件 | 更新内容 |
|------|---------|
| `POWER.md` | keywords 扩充 + MCP 服务器表格新增行 + 环境变量表新增 3 行 + mcp.json 示例新增条目 + 工具列表小节新增 12 工具 + 配置验证小节新增 Gerrit curl |
| `mcp.json` | 新增 `gerrit-mcp-server` 配置块（command/args/env/disabled/autoApprove） |
| `steering/pr-cr-workflow.md` | 步骤 ⑥ Commit Message 生成方式改为调用 Commit_Message_Generator；步骤 ⑦ 推送方式从 `gerritpush` 替换为 Gerrit_Push_Tool；步骤 ⑧ 评论操作替换为 Gerrit_Comment_Tool |
| `steering/gerrit-workflow.md` | 步骤 ① 推送命令替换；步骤 ② 评论查询替换为 `get_change_comments`；步骤 ③ 评论回复/resolved 替换为 Gerrit_Comment_Tool |
| `steering/cherry-pick-workflow.md` | 步骤 ② 替换为 `search_changes`；步骤 ③ 替换为 `list_branches`；步骤 ⑤ 替换为 `cherry_pick_change` |
| `hooks/safety-hooks.json` | **保持不变**（保留 `block-git-add-all` 与潜在的 `git push` shell 拦截规则；MCP 工具调用走 Steering 层确认，不需要 Hook 拦截） |

## Components and Interfaces

本特性涉及三大类组件：① Gerrit MCP Server 内部模块（运行时代码）；② Commit_Message_Generator（Steering 描述的 AI 行为契约）；③ Branch_Detector（同上）。下面按组件分别给出接口定义。

### Gerrit MCP Server 设计

#### 技术栈与依赖

与 zmind-mcp-server / opengrok-mcp-server 完全一致的版本锁定：

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@modelcontextprotocol/sdk` | `1.12.1` | MCP SDK，提供 `McpServer` + `StdioServerTransport` |
| `zod` | `3.24.4` | 工具入参 schema 校验 |
| `typescript` | `5.8.3` (devDep) | 编译 |
| `tsx` | `4.19.4` (devDep) | dev 模式运行 |
| `@types/node` | `24.0.3` (devDep) | Node.js 类型 |

`package.json` 关键字段：

```json
{
  "name": "@kk-irving/gerrit-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "bin": { "gerrit-mcp-server": "./dist/index.js" },
  "files": ["dist"],
  "scripts": {
    "start": "tsx src/index.ts",
    "build": "tsc",
    "prepublishOnly": "npm run build"
  }
}
```

`tsconfig.json` 沿用 zmind-mcp-server 的配置（target ES2022、module NodeNext、outDir `./dist`、strict 但 noImplicitAny 关闭）。`src/index.ts` 首行 `#!/usr/bin/env node` shebang 由 `tsc` 编译保留到 `dist/index.js`。

#### 模块划分

按职责拆分文件，避免把所有工具堆在 `index.ts`：

| 文件 | 职责 | 不含 |
|------|------|------|
| `src/index.ts` | 创建 `McpServer` 实例、注册全部 12 个工具、`StdioServerTransport.connect()` | HTTP 调用细节、参数 schema |
| `src/auth.ts` | 读取 `GERRIT_URL/USERNAME/HTTP_PASSWORD/TIMEOUT_MS` 环境变量、生成 Basic Auth 头、配置校验函数 `requireGerritConfig()` | HTTP 调用 |
| `src/http-client.ts` | `gerritGet/Post/Put/Delete` 统一封装：注入 `/a/` 前缀、Basic Auth、AbortController 超时、剥离 `)]}'` XSSI 防护前缀、JSON 解析、HTTP 错误映射 | 工具入参 schema |
| `src/errors.ts` | `StructuredError` 类、HTTP 状态码到 `error_type` 的映射、`toMcpResponse(err)` 工具 | 业务逻辑 |
| `src/types.ts` | `GerritChange / GerritBranch / GerritComment / CherryPickResult / PushResult / StructuredError` 等公共类型 | 业务逻辑 |
| `src/tools/query.ts` | 4 个读工具的实现 + zod schema | HTTP 客户端实现 |
| `src/tools/cherry-pick.ts` | `cherry_pick_change` + 三态判别 | git 子进程调用 |
| `src/tools/push.ts` | `push_to_gerrit` + spawn git push + stderr 解析 + MP 拒绝 | Gerrit REST 调用（push 只走 git 协议） |
| `src/tools/comment.ts` | 3 个评论工具 | Reviewer 操作 |
| `src/tools/reviewer.ts` | 3 个 Reviewer/Label 工具 | 评论操作 |

#### 环境变量与配置

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `GERRIT_URL` | ✅ | 无 | Gerrit 服务的完整 HTTPS URL，如 `https://whale-gerrit.zeasn.com` |
| `GERRIT_USERNAME` | ✅ | 无 | Gerrit 用户名 |
| `GERRIT_HTTP_PASSWORD` | ✅ | 无 | Gerrit Settings → HTTP Credentials 生成的 Token（**不是登录密码**） |
| `GERRIT_TIMEOUT_MS` | ❌ | `30000` | 单次 HTTP 请求超时（毫秒），任意正整数即生效 |

**关键约束（来自 Req 2.6）**：缺少必需变量时，Server **进程仍能启动**并完成 MCP 握手，仅在工具调用时返回错误（不在启动时崩溃），目的是让 Kiro 能正确加载 Server 并向 Developer 显示错误而非整个 Power 加载失败。

#### HTTP 客户端核心

```typescript
// src/http-client.ts (核心片段)
import { requireGerritConfig, basicAuthHeader } from "./auth.js";
import { StructuredError, mapHttpStatus } from "./errors.js";

const XSSI_PREFIX = ")]}'";

export interface GerritResponse<T> {
  data: T;
  status: number;
}

async function gerritFetch(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<unknown> {
  const cfg = requireGerritConfig(); // 缺失环境变量时抛 StructuredError(error_type=config_error)
  // 自动注入 /a/ 前缀（认证端点约定）
  const apiPath = path.startsWith("/a/") ? path : "/a" + (path.startsWith("/") ? path : "/" + path);
  const url = new URL(apiPath, cfg.url).toString();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Authorization": basicAuthHeader(cfg.username, cfg.password),
        "Content-Type": body ? "application/json" : "application/json",
        "Accept": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const rawText = await res.text();
    const stripped = rawText.startsWith(XSSI_PREFIX)
      ? rawText.slice(XSSI_PREFIX.length).trimStart()
      : rawText;

    if (!res.ok) {
      throw new StructuredError({
        error_type: mapHttpStatus(res.status),
        message: buildHttpErrorMessage(res.status, stripped),
        http_status: res.status,
      });
    }

    return stripped.length > 0 ? JSON.parse(stripped) : null;
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new StructuredError({
        error_type: "request_timeout",
        message: `Gerrit 请求超时 (${cfg.timeoutMs}ms): ${url}`,
      });
    }
    if (err instanceof StructuredError) throw err;
    // DNS / TCP 错误
    throw new StructuredError({
      error_type: "network_error",
      message: `网络错误: ${err.message} (GERRIT_URL=${cfg.url})`,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export const gerritGet = (p: string) => gerritFetch("GET", p);
export const gerritPost = (p: string, b: unknown) => gerritFetch("POST", p, b);
export const gerritPut = (p: string, b: unknown) => gerritFetch("PUT", p, b);
export const gerritDelete = (p: string) => gerritFetch("DELETE", p);
```

#### 错误处理统一策略

所有从 MCP 工具返回的错误必须是结构化对象 `{ error_type, message, http_status }`，禁止抛未捕获异常到 MCP 客户端。

```typescript
// src/errors.ts
export type GerritErrorType =
  | "auth_failed"        // HTTP 401
  | "permission_denied"  // HTTP 403
  | "not_found"          // HTTP 404
  | "conflict"           // HTTP 409（业务侧再细分 conflict / skipped_already_merged）
  | "gerrit_server_error" // HTTP 5xx
  | "request_timeout"
  | "network_error"      // DNS / TCP
  | "config_error"       // 环境变量缺失
  | "internal_error";    // 兜底

export class StructuredError extends Error {
  error_type: GerritErrorType;
  http_status?: number;
  constructor(opts: { error_type: GerritErrorType; message: string; http_status?: number }) {
    super(opts.message);
    this.error_type = opts.error_type;
    this.http_status = opts.http_status;
  }
}

export function mapHttpStatus(status: number): GerritErrorType {
  if (status === 401) return "auth_failed";
  if (status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status >= 500) return "gerrit_server_error";
  return "internal_error";
}

// 工具调用入口的统一兜底包装
export async function withErrorHandling<T>(fn: () => Promise<T>) {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(await fn(), null, 2) }] };
  } catch (err: any) {
    const se = err instanceof StructuredError
      ? err
      : new StructuredError({ error_type: "internal_error", message: err.message ?? String(err) });
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          error_type: se.error_type,
          message: se.message,
          http_status: se.http_status ?? null,
        }, null, 2),
      }],
      isError: true,
    };
  }
}
```

每个工具的实现都通过 `withErrorHandling` 包装。

#### 12 个工具的接口定义

| 工具名 | 类别 | 关键参数（zod） | Gerrit REST endpoint | 返回结构（成功） |
|--------|------|-----------------|----------------------|------------------|
| `query_change` | 读 | `change_id: string` | `GET /changes/{id}?o=CURRENT_REVISION&o=DETAILED_LABELS` | `GerritChange` |
| `list_branches` | 读 | `project: string`, `pattern?: string` | `GET /projects/{project}/branches/` | `GerritBranch[]` |
| `get_change_comments` | 读 | `change_id: string` | `GET /changes/{id}/comments` | `GerritComment[]`（按时间升序） |
| `search_changes` | 读 | `query: string`, `limit?: 25 (max 100)` | `GET /changes/?q={query}&n={limit}` | `GerritChange[]` |
| `cherry_pick_change` | 写 | `change_id: string`, `target_branch: string`, `message?: string` | `POST /changes/{id}/revisions/current/cherrypick` | `CherryPickResult`（三态） |
| `push_to_gerrit` | 写 | `cwd: string`, `target_branch: string`, `reviewers?: string[]`, `wip?: boolean`, `topic?: string` | spawn `git push` | `PushResult` |
| `add_review_comment` | 写 | `change_id`, `message`, `patch_set?: number` | `POST /changes/{id}/revisions/{rev}/review` | `{ comment_id, created }` |
| `reply_inline_comment` | 写 | `change_id`, `parent_comment_id`, `message`, `unresolved: boolean` | `POST /changes/{id}/revisions/{rev}/review`（含 `comments` + `in_reply_to`） | `{ comment_id, created }` |
| `mark_comment_resolved` | 写 | `change_id`, `comment_id` | `PUT /changes/{id}/revisions/{rev}/comments/{cid}`（设 `unresolved: false`） | `{ ok: true }` |
| `add_reviewer` | 写 | `change_id`, `reviewer: string` | `POST /changes/{id}/reviewers` | `{ account_id, confirmed: true }` |
| `remove_reviewer` | 写 | `change_id`, `reviewer: string` | `DELETE /changes/{id}/reviewers/{account-id}` | `{ ok: true }` |
| `set_review_label` | 写 | `change_id`, `label: string`, `value: -2..+2` | `POST /changes/{id}/revisions/current/review`（含 `labels`） | `{ ok: true, label, value }` |

**zod schema 示例**（`set_review_label`）：

```typescript
{
  change_id: z.string().describe("Change-Id 字符串、Change Number 或 project~branch~changeId 三元组"),
  label: z.string().describe("标签名，如 Code-Review、Verified"),
  value: z.number().int().min(-2).max(2).describe("标签值，整数 -2 至 +2"),
}
```

#### Cherry-Pick 三态判别逻辑

Gerrit 的 `POST /changes/{id}/revisions/current/cherrypick` 返回值不直接区分"已合入"和"代码冲突"，需要根据 HTTP 状态码 + 响应文本判别：

```typescript
// src/tools/cherry-pick.ts (核心片段)
export async function cherryPickChange(args: {
  change_id: string;
  target_branch: string;
  message?: string;
}): Promise<CherryPickResult> {
  try {
    const result = await gerritPost(
      `/changes/${encodeURIComponent(args.change_id)}/revisions/current/cherrypick`,
      {
        destination: args.target_branch,
        message: args.message, // undefined 时 Gerrit 自动沿用源 commit message
        allow_conflicts: false,
      }
    ) as GerritChangeInfo;
    return {
      status: "success",
      change_id: result.change_id,
      change_number: result._number,
      web_url: buildChangeWebUrl(result),
    };
  } catch (err) {
    if (err instanceof StructuredError && err.http_status === 409) {
      const msg = err.message.toLowerCase();
      // Gerrit 409 文本中含 "already exists" 或 "no changes" 表示已存在等效提交
      if (/(already exists|no changes were made|nothing to cherry pick)/.test(msg)) {
        return { status: "skipped_already_merged", reason: err.message };
      }
      // 否则视为代码冲突，尝试解析冲突文件
      return {
        status: "conflict",
        conflicting_files: parseConflictingFiles(err.message),
      };
    }
    if (err instanceof StructuredError && err.http_status === 404) {
      // 不返回结构化 status 对象，按 Req 4.5 抛错
      throw new StructuredError({
        error_type: "not_found",
        message: `目标分支不存在或权限不足: ${args.target_branch}`,
        http_status: 404,
      });
    }
    throw err;
  }
}

// 解析 Gerrit 冲突响应文本中的文件列表
// 形如: "Cherry pick failed because of merge conflict\nfoo.java\nbar.xml"
function parseConflictingFiles(text: string): string[] {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  return lines.filter(l => /\.[a-z0-9]+$/i.test(l) && !/^cherry/i.test(l));
}
```

**status 取值集合**：`{ "success", "skipped_already_merged", "conflict", "error" }`（其中 `"error"` 是 `withErrorHandling` 兜底产生的，`status` 字段不出现在结构化错误中，但工具层面对调用方而言这是第四种可能结局）。

#### push_to_gerrit 实现

`git push` 必须走 git 协议（不能用 REST 替代），因此用 `child_process.spawn` 调用本地 git：

```typescript
// src/tools/push.ts (核心片段)
import { spawn } from "node:child_process";

const MP_BRANCH_PATTERN = /_mp$/i; // 不区分大小写

export async function pushToGerrit(args: {
  cwd: string;
  target_branch: string;
  reviewers?: string[];
  wip?: boolean;
  topic?: string;
}): Promise<PushResult> {
  // ① MP 分支硬拒绝（Req 5.6）
  if (MP_BRANCH_PATTERN.test(args.target_branch)) {
    return {
      ok: false,
      error_type: "mp_branch_push_blocked",
      message:
        `目标分支 ${args.target_branch} 匹配 MP 分支模式（*_mp）。` +
        `MP 分支推送必须由 Developer 在 Steering 工作流中显式确认后通过其他流程完成，不接受自动推送。`,
    };
  }

  // ② 解析 push options
  const pushOpts: string[] = [];
  if (args.reviewers?.length) pushOpts.push(...args.reviewers.map(r => `r=${r}`));
  if (args.wip) pushOpts.push("wip");
  if (args.topic) pushOpts.push(`topic=${args.topic}`);
  const optSuffix = pushOpts.length ? `%${pushOpts.join(",")}` : "";

  // ③ 选择 remote（默认 gerrit，回退 origin）
  const remote = await detectGerritRemote(args.cwd);

  // ④ 执行 git push
  const refSpec = `HEAD:refs/for/${args.target_branch}${optSuffix}`;
  const { stdout, stderr, code } = await spawnGit(args.cwd, ["push", remote, refSpec]);

  if (code !== 0) {
    return {
      ok: false,
      error_type: "git_push_failed",
      message: `git push 失败 (exit ${code}): ${sanitizeStderr(stderr)}`,
      exit_code: code,
      stderr: sanitizeStderr(stderr),
    };
  }

  // ⑤ 从 stderr 解析 Gerrit Change URL
  const url = parseGerritChangeUrl(stderr);
  return url
    ? { ok: true, change_url: url, raw_stderr: sanitizeStderr(stderr) }
    : { ok: true, change_url_unavailable: true, raw_stderr: sanitizeStderr(stderr) };
}

// Gerrit push 输出形如:
//   remote: New Changes:
//   remote:   https://gerrit.example.com/c/project/+/12345 [WIP] subject
function parseGerritChangeUrl(stderr: string): string | null {
  const m = stderr.match(/https?:\/\/[^\s]+\/c\/[^\s]+\/\+\/\d+/);
  return m ? m[0] : null;
}

// 剥离 stderr 中可能嵌入的 Basic Auth 凭据（如 https://user:pass@host/...）
function sanitizeStderr(s: string): string {
  return s.replace(/https?:\/\/[^@\s]+:[^@\s]+@/g, (m) => m.replace(/:[^@\s]+@/, ":***@"));
}
```

#### Comment 工具：Robot vs Review Comments 选型

Gerrit 区分 Review Comments（人类评审）和 Robot Comments（自动化工具留言）。本特性的 `add_review_comment / reply_inline_comment / mark_comment_resolved` 全部使用 **Review Comments API**，理由：

1. AI 在 Gerrit 上代表 Developer 发声，不应被标记为机器人
2. Robot Comments 在 Gerrit UI 中的展示和处理流程不同（不参与 unresolved 计数），不符合 Req 6 的语义
3. 允许 Developer 后续手工编辑回复（Robot Comments 在多数 Gerrit 版本中是只读的）

**revision API 路径选择**：
- 添加评论：`POST /changes/{id}/revisions/{rev}/review`，body 含 `message` 和/或 `comments` map
- 标记 resolved：通过 `PUT /changes/{id}/revisions/{rev}/comments/{cid}` 直接修改单条 comment 的 `unresolved` 字段（避免一次性发送整轮 review）
- `{rev}` 取值默认 `current`（当前 patch set），调用方可通过 `patch_set` 参数覆盖

### Commit Message Generator 设计

**重要**：Commit_Message_Generator 不是一个独立服务/MCP 工具，而是 **AI 在 Steering File `commit-message-workflow.md` 指导下的能力**。它的"实现"是 Steering File 中的行为契约 + AI 调用现有工具（git diff、Zmind get_issue、Branch_Detector）的组合。

#### 输入数据结构

```typescript
// 概念性类型，仅用于设计文档说明 AI 应在心中维护的输入模型
interface CommitMessageInput {
  // 来自 git diff --staged 的输出
  diff: {
    files: Array<{ path: string; status: "added" | "modified" | "deleted" }>;
    hunks: Array<{ file: string; lines_added: number; lines_removed: number }>;
    raw: string; // 原始 unified diff 文本
  };
  // 来自 Zmind get_issue 的输出
  issue: {
    id: number;
    subject: string;
    description: string;
    tracker: { name: "Bug" | "Feature" | "Task" | string };
    target_version?: { name: string }; // ← 版本号唯一可信来源
    journals: Array<{ user: string; created_on: string; notes: string }>;
    attachments: Array<{ filename: string; content_url: string }>;
  };
  // 来自 Branch_Detector 的输出
  branch: {
    local_name: string;
    upstream?: string;       // git rev-parse @{upstream}
    target_push_branch: string; // Branch_Detector 最终识别结果
    detection_source: BranchDetectionSource;
  };
  // 可选：Developer 在会话中显式指定的版本号
  developer_overrides?: {
    version?: string;
    type?: "bugfix" | "feature" | "refactor" | "hotfix";
  };
}
```

#### 字段生成算法

| 字段 | 生成规则 | 关键约束 |
|------|----------|----------|
| `[what]` | 列举 `diff.files` 中的文件路径 + 从 `diff.raw` 提取被修改的函数/类名 + 行数概要 | 必须包含至少一个被修改的标识符（函数/类/常量名） |
| `[why]` | 综合 `issue.subject`、`issue.description`、`issue.journals` 中最近的现象描述 + 附件分析中的异常摘要 | 必须说明问题现象或需求背景，不少于一句话 |
| `[how]` | 用一句话概括 diff 体现的技术方案（如"在 X 类中新增空指针校验"） | 不超过 50 字 |
| `[test]` | 优先从 `issue.description` 或 `journals` 中提取"复现/验证"段；若无，基于 diff 推断手动验证步骤 | 必须有非空内容 |
| `[impact]` | 从 `diff.files` 路径推断模块/子系统（如 `frameworks/base/services/` → `System Services`） | 列出至少一个模块名 |

#### 元数据补全规则

| 字段 | 规则 | 失败行为 |
|------|------|----------|
| 版本号 | **严格优先级**：① `issue.target_version.name` → ② `developer_overrides.version` → ③ 询问 Developer。一旦前一级有值，**忽略后续级**（不接受 Developer 在 ① 已有值时的覆盖） | 三级都没有时询问，禁止从分支名等推断 |
| 类型 | `tracker.name == "Bug"` → `bugfix`；`tracker.name == "Feature"` → `feature`；其他 → 询问 Developer | 不允许默认 `bugfix` |
| Zmind#ID | 直接取 `issue.id`（数字） | 无 issue 上下文时拒绝生成 |
| 简述 | 基于 diff 核心修改 + Issue subject，长度 ≤ 50 字符，动词开头（修复/新增/重构等） | 超长时截断并提醒 Developer |

**版本号优先级判断流程**：

```mermaid
flowchart TD
    Start([生成版本号]) --> CheckTarget{issue.target_version<br/>有值?}
    CheckTarget -->|是| UseTarget[使用 target_version<br/>不接受覆盖]
    CheckTarget -->|否| CheckOverride{Developer<br/>显式指定?}
    CheckOverride -->|是| UseOverride[使用 developer_overrides.version]
    CheckOverride -->|否| Ask[询问 Developer]
    Ask --> Wait{Developer<br/>回复非空?}
    Wait -->|是| UseAnswer[使用 Developer 回答]
    Wait -->|否| Reject[拒绝生成 commit message]
    UseTarget --> Done([完成])
    UseOverride --> Done
    UseAnswer --> Done
```

#### format / parse 函数契约

为支持后续工具从已存在的 commit 中重新提取字段，设计两个对偶函数：

```typescript
interface CommitMessageFields {
  version: string;        // 如 "5.0.10"
  type: "bugfix" | "feature" | "refactor" | "hotfix";
  zmind_id: number;       // 如 334001
  subject: string;        // 如 "修复扫频后频道列表为空"
  what: string;
  why: string;
  how: string;
  test: string;
  impact: string;
}

// 渲染为最终 commit message 文本（首行 + 五段式）
function format(m: CommitMessageFields): string {
  return [
    `[${m.version}][${m.type}][whaletv][Zmind#${m.zmind_id}]${m.subject}`,
    `[what]${m.what}`,
    `[why]${m.why}`,
    `[how]${m.how}`,
    `[test]${m.test}`,
    `[impact]${m.impact}`,
  ].join("\n"); // 五段之间不插入空行
}

// 从 commit message 文本反向解析为字段对象
function parse(text: string): CommitMessageFields {
  // ① 拆分首行与正文
  const lines = text.split(/\r?\n/);
  // ② 首行正则: [ver][type][whaletv][Zmind#id]subject
  const firstLine = lines[0];
  const m = firstLine.match(/^\[([^\]]+)\]\[(bugfix|feature|refactor|hotfix)\]\[whaletv\]\[Zmind#(\d+)\](.+)$/);
  if (!m) throw new Error("Invalid commit message header");
  // ③ 正文按 [what] / [why] / [how] / [test] / [impact] 起始的行分段
  const body = lines.slice(1);
  const fields = extractFields(body); // 实现：扫描每行开头的 [tag]，归属到对应字段
  return {
    version: m[1],
    type: m[2] as any,
    zmind_id: parseInt(m[3], 10),
    subject: m[4],
    ...fields,
  };
}
```

**契约约束**：对任意合法的 `CommitMessageFields` 对象 `m`（字段非空、首行长度 ≤ 100、subject 不含 `]` 字符），有 `parse(format(m)) ≡ m`（结构等价）。

**说明**：`format/parse` 函数的实现位置——它们不属于 Gerrit MCP Server，也不是独立的 npm 包。最自然的归宿是作为 `commit-message-workflow.md` 中提供给 AI 的伪代码描述（AI 在执行时心算实现），或作为后续可选的小工具脚本。本设计不强制其代码实现，但 Steering File 必须明确表达 round-trip 约束。

#### Steering File 章节大纲

`steering/commit-message-workflow.md`（新增）包含以下章节：

| 章节 | 内容要点 |
|------|----------|
| 触发场景 | "生成 commit message"、PR/CR 工作流步骤 ⑥ 自动激活 |
| 前置条件 | git working tree 已 `git add -p`、当前会话已关联 Zmind Issue |
| 输入数据收集 | 调用 `git diff --staged`、`get_issue`、Branch_Detector |
| Branch_Detector 五级降级策略 | 详见下一节 |
| 字段生成算法（what/why/how/test/impact） | 详见上文表格 |
| 元数据补全规则（版本号 / 类型 / Zmind#ID / 简述） | 详见上文表格 + 优先级流程图 |
| format / parse 契约 | round-trip 约束、首行 ≤ 100 字符约束 |
| 用户确认点 | 展示完整 commit message → 等待确认 |
| 错误恢复 | 缺 Issue / 缺版本号 / 字段为空时的处理 |
| 端到端工作流 10 步入口 | 在本文件首尾位置定义全链路顺序 |
| 与 Zmind 附件分析的衔接 | 自动下载日志 / 询问压缩包-图片-视频 |

### Branch_Detector 设计

#### 五级降级策略

Branch_Detector 不是一个独立工具，而是 Steering File 中描述的 AI 行为流程。AI 按以下顺序尝试每一级，只要某一级返回非空分支名，就停止后续尝试。

```mermaid
flowchart TD
    Start([开始识别目标分支]) --> L1["① git rev-parse --abbrev-ref @{upstream}"]
    L1 -->|成功+非空| Found[识别成功<br/>记录 source=upstream]
    L1 -->|失败/空| L2["② git config branch.&lt;current&gt;.merge"]
    L2 -->|成功+非空| Found2[识别成功<br/>记录 source=git_config]
    L2 -->|失败/空| L3["③ 读取 .gitreview defaultbranch"]
    L3 -->|成功+非空| Found3[识别成功<br/>记录 source=gitreview]
    L3 -->|失败/空| L4["④ 通过 query_change<br/>反查最近 commit 的 Change-Id"]
    L4 -->|成功+非空| Found4[识别成功<br/>记录 source=gerrit_change_id]
    L4 -->|失败/空| L5["⑤ 询问 Developer"]
    L5 -->|Developer 回复非空| FoundAsk[识别成功<br/>记录 source=developer_input]
    L5 -->|Developer 不回复或回复空| Reject[拒绝继续<br/>不自动填充]

    Found --> CheckMP{匹配 *_mp ?}
    Found2 --> CheckMP
    Found3 --> CheckMP
    Found4 --> CheckMP
    FoundAsk --> CheckMP
    CheckMP -->|是| WarnMP[展示时附加<br/>⚠️ MP 分支警告]
    CheckMP -->|否| ShowDev[展示给 Developer]
    WarnMP --> ShowDev
    ShowDev --> WaitConfirm{Developer 确认?}
    WaitConfirm -->|是| Done([返回分支名 + source])
    WaitConfirm -->|否| Reject
```

#### 各级判定条件与命令

| 级别 | 命令 | 成功判定 | 失败判定 |
|------|------|----------|----------|
| ① | `git rev-parse --abbrev-ref @{upstream}` | 退出码 0 且 stdout 非空，提取 `<remote>/<branch>` 中的 `<branch>` 部分 | 退出码非 0 或 stdout 为空（如未设上游） |
| ② | `git config branch.$(git rev-parse --abbrev-ref HEAD).merge` | 退出码 0 且 stdout 非空，提取 `refs/heads/<branch>` 中的 `<branch>` | 退出码非 0 或 stdout 为空 |
| ③ | 读取 `<repo_root>/.gitreview` | 文件存在且包含 `defaultbranch=<name>` | 文件不存在或无该字段 |
| ④ | `git log -1 --pretty=%B` 提取 `Change-Id:` → `query_change` 工具调用 | Gerrit 返回 200 且 `branch` 字段非空 | git 提取失败或 query_change 报错 |
| ⑤ | 在对话中询问 Developer | Developer 回复非空字符串 | Developer 不回复或回复空 |

**关键约束**：
- ① 至 ③ 级**完全不依赖网络**（仅本地 git 命令和文件读取），即使 Gerrit 不可达也能完成识别
- 仅 ④ 级需要 Gerrit MCP 工具调用
- ⑤ 级（询问）后，Developer 的回答经过 ② 至 ⑤ 的展示与确认环节（不直接绕过）

#### MP 分支识别正则

```typescript
const MP_BRANCH_PATTERN = /_mp$/i; // 不区分大小写后缀匹配
const isMpBranch = (target: string) => MP_BRANCH_PATTERN.test(target);
```

**对称性约束**：`MP_BRANCH_PATTERN.test(target)` 等价于 `target.toLowerCase().endsWith("_mp")`。在 push.ts 与 Steering File 中使用同一正则避免行为分歧。

## 端到端工作流集成

### 现有 Steering File 更新点

| 文件 | 章节 | 原内容 | 新内容 |
|------|------|--------|--------|
| `pr-cr-workflow.md` | 步骤 ⑥ | "AI 动作: 按以下格式规范生成 Commit Message" | "AI 动作: 调用 Commit_Message_Generator（详见 commit-message-workflow.md），输入 git diff + Zmind Issue + Branch_Detector 结果" |
| `pr-cr-workflow.md` | 步骤 ⑦ | "git commit && gerritpush" | "AI 动作: 先调用 Branch_Detector 识别目标分支并请 Developer 确认，再调用 Gerrit_Push_Tool 的 push_to_gerrit；不再使用外部 gerritpush 命令" |
| `pr-cr-workflow.md` | 步骤 ⑧ | "在 Gerrit 上回复评论 → 标记 resolved"（语言层面） | "AI 动作: 调用 Gerrit_Comment_Tool 的 reply_inline_comment（含 unresolved=false 即同时回复并 resolve）或 mark_comment_resolved" |
| `gerrit-workflow.md` | 步骤 ① | "使用 gerritpush 命令推送代码到 Gerrit" | "通过 Branch_Detector 识别目标分支后调用 Gerrit_Push_Tool 的 push_to_gerrit；不再使用 gerritpush" |
| `gerrit-workflow.md` | 步骤 ② | "轮询等待 Gerrit-AI 评论"（机制不变） | "调用 Gerrit_Query_Tool 的 get_change_comments 进行轮询；保持 15 秒间隔最多 3 次的现有约束" |
| `gerrit-workflow.md` | 步骤 ③ | "在 Gerrit 上回复"（语言层面） | "调用 Gerrit_Comment_Tool 的 reply_inline_comment 与 mark_comment_resolved" |
| `cherry-pick-workflow.md` | 步骤 ② | "使用 Gerrit 搜索查询" | "调用 Gerrit_Query_Tool 的 search_changes 工具" |
| `cherry-pick-workflow.md` | 步骤 ③ | "通过 Gerrit API 查询每个 project 的分支列表" | "调用 Gerrit_Query_Tool 的 list_branches 工具，pattern 参数设为 `_mp`" |
| `cherry-pick-workflow.md` | 步骤 ⑤ | "通过 Gerrit API 逐个执行 Cherry-Pick" | "调用 Gerrit_Cherry_Pick_Tool 的 cherry_pick_change 工具，根据返回的 status 字段（success / skipped_already_merged / conflict）分类汇报" |

**保留的安全约束**（更新后必须不削弱）：
- 所有 👤 用户确认点（diff 确认、push 确认、CP 计划确认）
- `git add -p` hunk 级精确暂存约束
- MP 分支双重确认约束（Branch_Detector 识别为 MP 分支时附加警告 + 可选地由 Steering 直接拒绝自动推送）
- 版本号必须由 Issue 或 Developer 提供（不得推断）

### 端到端 10 步流程图

```mermaid
flowchart LR
    A["① 分析 Zmind<br/>get_issue +<br/>附件分类"] --> B["② Gerrit 检索<br/>search_changes"]
    B --> C["③ 本地代码<br/>git grep →<br/>OpenGrok 降级"]
    C --> D["④ 修改代码"]
    D --> E["⑤ git diff<br/>(👤 确认)"]
    E --> F["⑥ git add -p"]
    F --> G["⑦ Commit_Message_<br/>Generator"]
    G --> H["⑧ 👤 确认<br/>commit msg"]
    H --> I["⑨ Gerrit_Push_Tool<br/>push_to_gerrit"]
    I --> J["⑩ Developer 验证<br/>+ 更新 Zmind"]
```

## 安全机制设计

### 三层安全在新模块上的应用

```mermaid
flowchart TD
    AI[AI 准备执行写操作] --> L1{第一层<br/>规则约束}
    L1 -->|MP 分支自动推送 / git add -A| Reject1[Steering 拒绝<br/>展示原因]
    L1 -->|通过| L2{第二层<br/>Hook 拦截}
    L2 -->|git push / git add -A 等 shell 命令| Reject2[Hook 阻断<br/>展示替代]
    L2 -->|MCP 工具调用| Skip[Hook 不拦截<br/>走 Steering 确认]
    L2 -->|通过| L3{第三层<br/>人工确认}
    L3 -->|push / set Code-Review +1/+2 / cherry-pick / commit msg| WaitUser[等待 Developer<br/>明确确认]
    L3 -->|读操作 / 添加 reviewer / 评论文本| Pass[直接执行]
    WaitUser -->|确认| Pass
    WaitUser -->|拒绝| Reject3[终止操作]
    Pass --> Done([执行写操作])
```

### 写操作授权矩阵

| 操作 | 第一层（规则） | 第二层（Hook） | 第三层（人工确认） |
|------|----------------|----------------|---------------------|
| `query_change` / `list_branches` / `get_change_comments` / `search_changes` | 无 | 不拦截 | 不需要 |
| `add_review_comment` / `reply_inline_comment` / `mark_comment_resolved` | 无（评论文本由 Developer 决定，AI 仅执行） | 不拦截 | **建议**确认（评论内容可见） |
| `add_reviewer` / `remove_reviewer` | 无 | 不拦截 | 不需要 |
| `set_review_label`（值 = 0） | 无 | 不拦截 | 不需要 |
| `set_review_label`（值 ∈ {-2, -1, +1, +2}） | 无 | 不拦截 | **必需**确认（向 Developer 展示标签值和目标 Change） |
| `cherry_pick_change` | 无 | 不拦截 | **必需**确认完整 CP 计划；MP 目标加显著警告 |
| `push_to_gerrit`（非 MP 分支） | 无 | 不拦截 MCP 工具，但拦截 shell `git push` | **必需**确认 commit msg 全文 + 目标分支 + Branch_Detector 来源 + Reviewer 列表 |
| `push_to_gerrit`（MP 分支） | **第一层拒绝**（push.ts 直接返回 `mp_branch_push_blocked` 错误） | 同上 | （拒绝后不进入确认） |
| Commit Message 生成 | 缺 Issue / 缺版本号时拒绝生成 | 不涉及 | **必需**展示完整 commit msg 等待确认 |

### hooks/safety-hooks.json 现状保留

| 决策 | 说明 |
|------|------|
| **保留**所有现有规则 | `block-sudo` / `block-root-search` / `block-tmp-write` / `block-out-search` / `block-git-add-all` / `block-bulk-copy-out` 全部不变 |
| **不新增** Hook 拦截 MCP 工具调用 | MCP 工具是结构化 RPC，不是 shell 命令；Hook 设计是匹配 shell 命令模式 |
| **建议**未来增加 `block-git-push-direct` | 拦截直接执行 `git push <remote> refs/for/...` 的 shell 命令（防止 Developer 或 AI 绕开 Gerrit_Push_Tool）；本特性范围内不强制实现，留作后续优化 |

## POWER.md 与 mcp.json 配置变更

### keywords 数组扩充

```json
{
  "keywords": [
    "whaletv", "zmind", "gerrit", "opengrok",
    "cherry-pick", "pr", "cr", "android",
    "项目管理", "代码搜索",
    "gerrit-mcp", "commit-message"
  ]
}
```

### MCP 服务器表格新增行

| 服务器 | 工具数 | 功能 |
|--------|--------|------|
| zmind-mcp-server | 15 | （现有） |
| opengrok-mcp-server | 4 | （现有） |
| **gerrit-mcp-server** | **12** | **Change/Branch/Comment 查询、Cherry-Pick、Gerrit 推送、评论操作、Reviewer/Label 管理（含读 4 + 写 8）** |

### 环境变量表格新增 3 行

| 变量名 | 用途 | 必需 | 默认值 |
|--------|------|------|--------|
| `GERRIT_URL` | Gerrit 服务地址（完整 HTTPS URL） | ✅ 是 | 无 |
| `GERRIT_USERNAME` | Gerrit 用户名 | ✅ 是 | 无 |
| `GERRIT_HTTP_PASSWORD` | Gerrit HTTP Password（在 Settings → HTTP Credentials 生成的 Token） | ✅ 是 | 无 |
| `GERRIT_TIMEOUT_MS` | 单次 HTTP 请求超时（毫秒） | ❌ 否 | 30000 |

### mcp.json 新增配置块

```json
{
  "mcpServers": {
    "gerrit-mcp-server": {
      "command": "npx",
      "args": ["-y", "@kk-irving/gerrit-mcp-server@latest"],
      "env": {
        "GERRIT_URL": "",
        "GERRIT_USERNAME": "",
        "GERRIT_HTTP_PASSWORD": "",
        "GERRIT_TIMEOUT_MS": "30000"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### POWER.md "Gerrit MCP Server 工具列表"小节

```markdown
## Gerrit MCP Server 工具列表

读操作（4 个）：
- `query_change` — 查询 Gerrit Change 详情
- `list_branches` — 列出 project 的分支（支持 pattern 过滤）
- `get_change_comments` — 获取 Change 的全部评论（按时间升序）
- `search_changes` — 按 Gerrit search syntax 搜索 Change

写操作（8 个）：
- `cherry_pick_change` — 服务端 Cherry-Pick（区分 success / skipped_already_merged / conflict）
- `push_to_gerrit` — 推送到 refs/for/<target>（替代 gerritpush；MP 分支硬拒绝）
- `add_review_comment` — 添加 review 级评论
- `reply_inline_comment` — 回复 inline 评论（可同时 mark resolved）
- `mark_comment_resolved` — 单纯将评论标记为 resolved
- `add_reviewer` — 添加 Reviewer
- `remove_reviewer` — 移除 Reviewer
- `set_review_label` — 设置 Code-Review / Verified 等标签（-2 至 +2）
```

### 配置验证命令新增

```bash
# 验证 Gerrit 连接（应返回 200）
curl -s -o /dev/null -w "%{http_code}" \
  -u "$GERRIT_USERNAME:$GERRIT_HTTP_PASSWORD" \
  "$GERRIT_URL/a/accounts/self"
```

## Data Models

本节给出特性涉及的核心 TypeScript 类型定义，覆盖 Gerrit MCP Server 工具的入参/出参以及 Commit_Message_Generator / Branch_Detector 的概念性数据模型。

```typescript
// src/types.ts

export interface GerritChange {
  id: string;                    // project~branch~Change-Id 三元组
  change_id: string;             // 仅 Change-Id (Ixxxxxxx)
  number: number;                // _number
  subject: string;
  status: "NEW" | "MERGED" | "ABANDONED";
  project: string;
  branch: string;
  topic?: string;
  owner: { name: string; email?: string };
  current_revision: string;
  current_patch_set: number;
  zmind_issue_ids: number[];     // 从 commit message 中提取的 Zmind#ID
  web_url: string;
}

export interface GerritBranch {
  ref: string;                   // 如 "refs/heads/os10_mp"
  revision: string;              // HEAD commit hash
  name: string;                  // 如 "os10_mp"（去掉 refs/heads/ 前缀）
}

export interface GerritComment {
  id: string;
  author: { name: string; email?: string };
  created: string;               // ISO 8601
  message: string;
  unresolved: boolean;
  // inline comments only
  path?: string;
  line?: number;
  patch_set?: number;
  in_reply_to?: string;
}

export type CherryPickStatus =
  | "success"
  | "skipped_already_merged"
  | "conflict";

export type CherryPickResult =
  | {
      status: "success";
      change_id: string;
      change_number: number;
      web_url: string;
    }
  | {
      status: "skipped_already_merged";
      reason: string;
    }
  | {
      status: "conflict";
      conflicting_files: string[];
    };

export type PushResult =
  | { ok: true; change_url: string; raw_stderr: string }
  | { ok: true; change_url_unavailable: true; raw_stderr: string }
  | {
      ok: false;
      error_type: "mp_branch_push_blocked" | "git_push_failed";
      message: string;
      exit_code?: number;
      stderr?: string;
    };

export interface CommitMessageFields {
  version: string;
  type: "bugfix" | "feature" | "refactor" | "hotfix";
  zmind_id: number;
  subject: string;
  what: string;
  why: string;
  how: string;
  test: string;
  impact: string;
}

export type BranchDetectionSource =
  | "upstream"            // git rev-parse @{upstream}
  | "git_config"          // git config branch.<X>.merge
  | "gitreview"           // .gitreview defaultbranch
  | "gerrit_change_id"    // query_change 反查
  | "developer_input";    // 询问 Developer

export interface BranchDetectionResult {
  target_branch: string;
  source: BranchDetectionSource;
  is_mp_branch: boolean;
}

export interface StructuredErrorPayload {
  error_type:
    | "auth_failed"
    | "permission_denied"
    | "not_found"
    | "conflict"
    | "gerrit_server_error"
    | "request_timeout"
    | "network_error"
    | "config_error"
    | "internal_error";
  message: string;
  http_status?: number;
}
```



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

本特性的属性测试覆盖范围已经过取舍：Gerrit MCP Server 中**对外部 REST API 的薄包装**部分（如 `query_change` 是否返回正确结构）由集成测试覆盖；本节聚焦在**纯函数级逻辑**、**状态机不变量**、**字符串处理 round-trip** 与**安全约束对称性**——这些场景对输入变化敏感、能从 100+ 次随机迭代中获益。所有属性都来自 prework 分析中标记为 `PROPERTY` 的可测条目。

### Property 1: Basic Auth 头格式与可逆性

*For any* 非空字符串对 (username, password)（包含 ASCII / Unicode / 包含 `:` 字符的边界情况），`basicAuthHeader(username, password)` 必须返回字符串以 `"Basic "` 前缀开头，且其后的 Base64 段解码后等价于 `username + ":" + password`。

**Validates: Requirements 2.4**

### Property 2: /a/ 前缀注入幂等性

*For any* 输入 `path` 字符串，`http-client` 拼接出的最终 URL 路径必须以 `/a/` 开头，且当输入已含 `/a/` 前缀时输出不出现 `//a//a/` 等重复前缀。

**Validates: Requirements 2.5**

### Property 3: XSSI 前缀剥离 round-trip

*For any* 合法 JSON 对象 `obj`，将 `JSON.stringify(obj)` 任意拼接 0 个或 1 个 `)]}'` 前缀（含 `)]}'\n`、`)]}'  ` 等空白变体）后，`stripXssi + JSON.parse` 的结果必须等价于 `obj`。

**Validates: Requirements 2.7**

### Property 4: GERRIT_TIMEOUT_MS 解析逻辑

*For any* 字符串输入 `s`（含数字字符串、负数、零、浮点、空字符串、非数字、超大数），`parseTimeoutMs(s)` 的返回值必须满足：若 `s` 表示一个正整数（即 `Number.isInteger(parseInt(s, 10)) && parseInt(s, 10) > 0 && /^\d+$/.test(s.trim())`），则返回 `parseInt(s, 10)`；否则返回默认值 `30000`。

**Validates: Requirements 2.8**

### Property 5: 错误消息保留原始输入标识符

*For any* 失败的工具调用，若调用方传入了某个外部标识符（如 `change_id`、`target_branch`、`comment_id`、`reviewer`），且失败原因来自 Gerrit HTTP 错误响应或本地校验失败，则返回的 `StructuredError.message` 必须包含该原始标识符的字符串子串（不被工具改写或丢失）。

**Validates: Requirements 3.5, 4.5, 6.6**

### Property 6: list_branches 无匹配返回空数组

*For any* `pattern` 字符串（包括随机生成的、几乎一定不匹配的字符串如长 UUID），`list_branches({ project, pattern })` 在 Gerrit 返回空集时必须返回 `[]` 而非抛出异常或返回 `null`。

**Validates: Requirements 3.6**

### Property 7: get_change_comments 时间升序

*For any* 来自 Gerrit 的评论数组（任意时间戳乱序），`get_change_comments` 排序后输出数组中相邻元素满足 `output[i].created <= output[i+1].created`。

**Validates: Requirements 3.7**

### Property 8: Cherry-Pick 409 文本分类正确性

*For any* HTTP 409 响应文本 `text`，`cherry_pick_change` 的分类逻辑必须满足：若 `text` 含特定"已合入"关键短语（`already exists` / `no changes were made` / `nothing to cherry pick`，不区分大小写），则返回 `status: "skipped_already_merged"`；否则返回 `status: "conflict"`。同一文本输入下分类结果是确定性的（不随调用次数变化）。

**Validates: Requirements 4.3, 4.4**

### Property 9: push 命令构造一致性

*For any* 合法的 push 参数 `(remote, target_branch, reviewers, wip, topic)`，传给 `child_process.spawn` 的 git 参数列表必须满足：① 第一个参数为 `"push"`；② 第二个参数为传入的 `remote`；③ 第三个参数等于 `"HEAD:refs/for/" + target_branch + optionSuffix`，其中 `optionSuffix` 包含且仅包含传入的 reviewer 列表（每个 email 各一次，以 `r=` 前缀）、wip 时含 `wip`、topic 时含 `topic=<topic>`，且各 option 之间用 `,` 分隔、整体以 `%` 起始（仅当至少一个 option 时）。

**Validates: Requirements 5.2, 5.3, 5.4, 5.5**

### Property 10: MP 分支拒绝对称性

*For any* 字符串 `target_branch`，`push_to_gerrit` 的 MP 分支拒绝判定必须满足：`MP_BRANCH_PATTERN.test(target_branch)` 等价于 `target_branch.toLowerCase().endsWith("_mp")`，且当且仅当该判定为 `true` 时，工具返回 `error_type: "mp_branch_push_blocked"`，从不调用 `git push` 子进程。

**Validates: Requirements 5.6**

### Property 11: parseGerritChangeUrl 提取一致性

*For any* 字符串 `stderr`（含或不含 Gerrit Change URL），`parseGerritChangeUrl(stderr)` 必须满足：若 `stderr` 包含至少一个匹配 `https?://[^/\s]+/c/[^/\s]+/\+/\d+` 模式的子串，则返回第一个匹配；否则返回 `null`。返回值若非 null 必须本身就是一个合法的 URL（可被 `new URL()` 构造）。

**Validates: Requirements 5.7**

### Property 12: 评论文本空白校验

*For any* 字符串 `message`，`add_review_comment` 与 `reply_inline_comment` 的输入校验必须满足：当 `message.trim().length === 0` 时一律返回错误（`error_type` 在内部错误枚举内）；当 `message.trim().length > 0` 时进入正常处理路径。

**Validates: Requirements 6.5**

### Property 13: set_review_label 值范围校验

*For any* 整数 `value`，`set_review_label` 必须满足：当 `value < -2 || value > 2` 时被 zod schema 在 MCP 入参层拒绝；当 `-2 <= value <= 2` 时通过校验进入业务执行。

**Validates: Requirements 7.5**

### Property 14: 结构化错误封装与 error_type 枚举

*For any* 工具调用，无论失败来源（HTTP 状态码、网络错误、超时、配置错误、未预期的 JS 异常如 `throw "string"` / `throw null` / 嵌套 Promise reject），返回值要么是成功的 MCP 响应，要么是结构化错误对象，且该错误对象的 `error_type` 字段必须 ∈ `{auth_failed, permission_denied, not_found, conflict, gerrit_server_error, request_timeout, network_error, config_error, internal_error}`。任何情况下均不会有未捕获异常向 MCP 客户端暴露。

**Validates: Requirements 5.8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8**

### Property 15: format 输出结构约束

*For any* 合法的 `CommitMessageFields` 对象 `m`（subject 长度受控以保证首行 ≤ 100 字符），`format(m)` 输出的字符串必须满足：① 第一行匹配正则 `/^\[[^\]]+\]\[(bugfix|feature|refactor|hotfix)\]\[whaletv\]\[Zmind#\d+\].+$/`；② 第一行长度 ≤ 100 字符；③ 后续 5 行依次以 `[what]`、`[why]`、`[how]`、`[test]`、`[impact]` 开头（顺序固定）；④ 五段之间不出现空行。

**Validates: Requirements 9.3, 9.10**

### Property 16: parse(format(m)) round-trip

*For any* 合法的 `CommitMessageFields` 对象 `m`（所有字段非空、subject 不含 `]` 字符、subject 长度受控以保证首行 ≤ 100），`parse(format(m))` 必须等价于 `m`（所有 9 个字段值完全相同）。

**Validates: Requirements 9.11**

### Property 17: 版本号严格优先级

*For any* 输入元组 `(target_version, developer_override)`（每个元素为 `string | undefined | ""`），版本号选择函数必须满足：① 当 `target_version` 非空（非 `undefined` 且 `trim().length > 0`）时返回 `target_version` 且**忽略** `developer_override` 即使后者也非空；② 仅当 `target_version` 为空且 `developer_override` 非空时返回 `developer_override`；③ 两者都为空时返回 sentinel 值 `ASK_DEVELOPER`（不返回任何来自分支名、commit 历史等其他来源的值）。

**Validates: Requirements 10.1, 10.2**

### Property 18: 类型字段推断映射

*For any* 字符串 `tracker_name`，类型推断函数必须满足：当 `tracker_name === "Bug"` 时返回 `"bugfix"`；当 `tracker_name === "Feature"` 时返回 `"feature"`；其他任意输入（含空、`"Task"`、Unicode、随机字符串）时返回 sentinel 值 `ASK_DEVELOPER`，从不返回 `"refactor"` 或 `"hotfix"` 作为默认值。

**Validates: Requirements 10.3**

### Property 19: 简述长度上限

*For any* 由 `Commit_Message_Generator` 生成的 `subject` 字符串，必须满足 `subject.length <= 50`（即使原始信息更长，生成器必须截断）。

**Validates: Requirements 10.5**

### Property 20: Branch_Detector 优先级与全失败语义

*For any* 五元组 `(L1, L2, L3, L4, L5)`，其中每个 `Li` 是该级识别的输出（`{ ok: true, branch: string } | { ok: false }`），Branch_Detector 的最终输出必须满足：① 返回结果来自第一个 `Li.ok === true` 的级别（即跳过后续所有级别）；② 当 `L1..L5` 全部 `ok: false` 时（即 Developer 在 ⑤ 级也未提供分支名），输出必须为 sentinel 状态 `ASK_DEVELOPER` 而非任何具体分支名（永不自动填充推测值）。

**Validates: Requirements 11.1, 11.2, 11.4**

### Property 21: CherryPickResult.status 枚举值域

*For any* `cherry_pick_change` 的成功返回（即未抛 `StructuredError`），返回对象的 `status` 字段必须 ∈ `{"success", "skipped_already_merged", "conflict"}`，永不返回该集合外的值。注意：HTTP 404（目标分支不存在）走 `throw StructuredError` 路径，不在该枚举内。

**Validates: Requirements 4.2, 4.3, 4.4**



## Error Handling

### 错误分类与处理矩阵

| 错误来源 | error_type | http_status | 用户可见信息 | 恢复建议 |
|----------|-----------|-------------|--------------|----------|
| 缺失 GERRIT_URL/USERNAME/HTTP_PASSWORD | `config_error` | (无) | "环境变量 X 未配置" | 在 `~/.kiro/settings/mcp.json` 的 env 字段配置变量 |
| HTTP 401 | `auth_failed` | 401 | "Gerrit 认证失败，请检查 GERRIT_USERNAME 和 GERRIT_HTTP_PASSWORD" | 重新生成 HTTP Password |
| HTTP 403 | `permission_denied` | 403 | "当前用户对该资源无操作权限" + 资源标识 | 联系项目管理员或 PROJECT OWNER |
| HTTP 404 | `not_found` | 404 | "资源不存在" + Change-Id/分支名 | 校对输入标识符 |
| HTTP 409 (cherry-pick) | `conflict`（细分为 `skipped_already_merged` / `conflict` 两类业务结果） | 409 | 细分文本 | 已合入：跳过；冲突：人工 cherry-pick |
| HTTP 5xx | `gerrit_server_error` | 5xx | HTTP 状态 + Gerrit 响应体前 500 字符 | 稍后重试或联系 Gerrit 管理员 |
| 请求超时 | `request_timeout` | (无) | "Gerrit 请求超时 (Xms): URL" | 增大 GERRIT_TIMEOUT_MS 或检查网络 |
| DNS / TCP 错误 | `network_error` | (无) | 原始错误描述 + GERRIT_URL 配置值 | 检查 VPN / 服务器可达性 |
| `git push` 子进程非零退出 | `git_push_failed` | (无) | exit code + 完整 stderr（已剥离 Basic Auth 凭据） | 按 stderr 提示修复 |
| MP 分支推送 | `mp_branch_push_blocked` | (无) | MP 分支警告文本 | Steering 工作流中显式确认后通过其他流程 |
| 工具内部未预期异常 | `internal_error` | (无) | 原始错误 message | 报告 bug |

### 错误对象格式

所有错误一律返回：

```json
{
  "error_type": "auth_failed",
  "message": "Gerrit 认证失败 (HTTP 401): 请检查 GERRIT_USERNAME 和 GERRIT_HTTP_PASSWORD",
  "http_status": 401
}
```

通过 `withErrorHandling` 包装函数（见前文）保证：① 任何异常都被转换为该结构；② `isError: true` 标记给 MCP 客户端；③ 不向客户端泄露异常调用栈。

### Cherry-Pick 三态错误处理

Cherry-Pick 是唯一在 HTTP 409 时**不返回错误**而是返回**结构化业务结果**的工具：

```mermaid
flowchart TD
    Call[cherry_pick_change 调用] --> HTTP{HTTP Status}
    HTTP -->|201/200| OK[status: success]
    HTTP -->|409| Parse{响应文本含<br/>'already exists' 等?}
    Parse -->|是| Skip[status: skipped_already_merged]
    Parse -->|否| Conflict[status: conflict<br/>conflicting_files: [...]]
    HTTP -->|404| Throw[throw StructuredError<br/>error_type: not_found]
    HTTP -->|其他错误| ThrowOther[throw StructuredError]
    OK --> Return[正常返回结构化结果]
    Skip --> Return
    Conflict --> Return
```

### 安全相关的错误处理

| 场景 | 行为 |
|------|------|
| stderr 中嵌入 Basic Auth 凭据（如 push 失败时输出 `https://user:token@host/...`） | 通过 `sanitizeStderr` 将 `:token@` 部分替换为 `:***@` |
| 错误消息中嵌入 GERRIT_HTTP_PASSWORD | 在 `requireGerritConfig` 校验失败的 message 中**只引用变量名**，不出现变量值 |
| Gerrit 响应体含敏感字段 | 截断到前 500 字符，不全文返回到 MCP 响应 |

## Testing Strategy

### 测试分层

| 层级 | 工具 | 覆盖范围 | 目标 |
|------|------|----------|------|
| **属性测试 (PBT)** | fast-check (TypeScript) | 21 个 Correctness Properties | 100+ 迭代覆盖输入空间 |
| **单元测试** | Vitest | 字段映射 / 错误传播 / 边界条件 / 单输入特定行为 | 快速回归 |
| **集成测试** | Vitest + 真实 Gerrit 测试环境 | 12 个工具的端到端调用 | 验证 REST API 契约 |
| **冒烟测试** | shell 脚本 | 项目结构、构建产物、配置文件 | CI 启动时检查 |
| **Steering Review** | 人工审阅 | Commit_Message_Generator / Branch_Detector 工作流 | 端到端走通 |

### 单元测试 (Vitest)

聚焦于：
- 字段映射：`GerritChangeInfo (Gerrit 原始 JSON) → GerritChange (我们的类型)`
- 边界条件：评论文本空字符串 / 全空白 / 单字符；reviewer 列表为空 / 单个 / 多个
- 错误传播：mock fetch 返回各 HTTP 状态码，验证 `error_type` 映射
- Cherry-Pick 三态：mock 三种 409 响应文本变体 + 1 种成功响应

### 属性测试 (fast-check)

**库选型**：使用 `fast-check`（TypeScript 生态中的 PBT 标准库），不自实现 PBT 框架。

**配置约束**：
- 每个属性测试最少 100 次迭代（fast-check 默认 100，保留默认）
- 每个测试在文件首行注释中标注：

```typescript
// Feature: gerrit-mcp-and-smart-commit, Property 16: parse(format(m)) round-trip
import fc from "fast-check";
import { format, parse } from "../src/commit-message.js";

test("Property 16: parse(format(m)) ≡ m", () => {
  fc.assert(
    fc.property(
      fc.record({
        version: fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes("]")),
        type: fc.constantFrom("bugfix", "feature", "refactor", "hotfix"),
        zmind_id: fc.integer({ min: 1, max: 999999 }),
        subject: fc.string({ minLength: 1, maxLength: 30 }).filter(s => !s.includes("]") && !s.includes("\n")),
        what: fc.string({ minLength: 1, maxLength: 200 }).filter(s => !s.includes("\n")),
        why: fc.string({ minLength: 1, maxLength: 200 }).filter(s => !s.includes("\n")),
        how: fc.string({ minLength: 1, maxLength: 200 }).filter(s => !s.includes("\n")),
        test: fc.string({ minLength: 1, maxLength: 200 }).filter(s => !s.includes("\n")),
        impact: fc.string({ minLength: 1, maxLength: 200 }).filter(s => !s.includes("\n")),
      }),
      (m) => {
        expect(parse(format(m))).toEqual(m);
      }
    ),
    { numRuns: 100 }
  );
});
```

每个 Property 1..21 都按上述模板实现一个 fast-check 测试。

### 集成测试

**前置条件**：CI 环境配置 `GERRIT_URL`、`GERRIT_USERNAME`、`GERRIT_HTTP_PASSWORD` 指向 Gerrit 测试环境（或 staging 环境）。

**测试用例集**（每个工具 1-2 个真实调用）：

| 工具 | 集成测试 |
|------|----------|
| `query_change` | 调用一个已知 Change-Id，验证字段映射 |
| `list_branches` | 调用一个已知 project 的 `_mp` pattern，验证至少返回一个 |
| `get_change_comments` | 调用一个有评论的 Change，验证排序 |
| `search_changes` | 调用 `status:merged limit:5`，验证返回非空 |
| `cherry_pick_change` | 在测试 project 上 cherry-pick 一个临时 Change，验证 status: success |
| `push_to_gerrit` | 在测试仓库 push 一个 dummy commit，验证 change_url 解析 |
| `add_review_comment` | 添加测试评论，验证 comment_id 返回 |
| `reply_inline_comment` | 回复一个已知 inline comment，验证 in_reply_to 字段 |
| `mark_comment_resolved` | 标记一个测试评论为 resolved |
| `add_reviewer` / `remove_reviewer` | 在测试 Change 上添加 / 移除一个测试账号 |
| `set_review_label` | 设置 Code-Review +1 在测试 Change 上 |

### 冒烟测试

```bash
# 项目结构
test -f mcp-servers/gerrit-mcp-server/package.json
test -f mcp-servers/gerrit-mcp-server/tsconfig.json
test -f mcp-servers/gerrit-mcp-server/src/index.ts

# 构建产物
cd mcp-servers/gerrit-mcp-server && npm run build
test -f dist/index.js
head -1 dist/index.js | grep -q "#!/usr/bin/env node"

# package.json 字段
node -e "const p = require('./package.json'); if (p.name !== '@kk-irving/gerrit-mcp-server') process.exit(1);"
```

### Steering File 审阅

`commit-message-workflow.md` 与更新后的 `pr-cr-workflow.md`、`gerrit-workflow.md`、`cherry-pick-workflow.md` 必须由 Power 维护者人工走通一次端到端工作流，确认：
- 每一步触发条件清晰
- 用户确认点不可被 AI 跳过
- MP 分支双重确认机制生效
- Branch_Detector 五级降级在不同场景下都能终止

## 性能、安全、依赖

### 性能

| 项目 | 设计 |
|------|------|
| 单次 HTTP 请求超时 | 默认 30000ms（可通过 `GERRIT_TIMEOUT_MS` 调整） |
| `git push` 子进程超时 | 60000ms（push 涉及网络上传，比 REST 调用更慢） |
| 并发限制 | 当前不引入并发控制（每次 MCP 工具调用是单次 HTTP），未来若引入批量工具再加 `p-limit` |
| 响应体大小 | Gerrit 响应可能很大（如 search_changes 含 100 个 Change），不做客户端流式处理；超大响应通过 `limit` 参数限制 |
| 启动延迟 | `tsx src/index.ts` 启动 ~1s，与 zmind/opengrok 一致 |

### 安全

| 风险 | 缓解 |
|------|------|
| API Key/Password 泄露到日志 | `console.error` 输出仅引用环境变量名，不输出值；Basic Auth 头不打印 |
| URL 中嵌入 Basic Auth 凭据被 stderr 回显 | `sanitizeStderr` 将 `https://user:token@host` 中的 token 替换为 `***` |
| stderr 中含敏感信息 | 仅返回前 1000 字符，且经过 sanitize |
| AI 自动执行写操作 | 三层防护：Steering 规则 + Hook 拦截 shell 命令 + 必需的人工确认 |
| 误推 MP 分支 | `push_to_gerrit` 第一层硬拒绝 + Branch_Detector 第二层警告 + 人工确认第三层 |
| Robot Comments vs Review Comments 选错 | 设计文档明确选 Review Comments，避免在 Gerrit UI 中以机器人身份留言 |
| `withErrorHandling` 兜底失败 | 异常被转为 `internal_error` 返回，不向客户端暴露调用栈 |

### 依赖清单

与 zmind-mcp-server 完全一致的版本锁定（确保所有 MCP Server 共享同一 SDK 版本，避免协议不兼容）：

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.12.1",
    "zod": "3.24.4"
  },
  "devDependencies": {
    "@types/node": "24.0.3",
    "tsx": "4.19.4",
    "typescript": "5.8.3"
  }
}
```

**测试依赖（dev only）**：

```json
{
  "devDependencies": {
    "vitest": "^1.6.0",
    "fast-check": "^3.19.0"
  }
}
```

**关键决策**：
- 不引入 axios / got 等 HTTP 库，使用 Node.js 内置 `fetch`（Node 18+ 原生支持）
- 不引入 commander / yargs 等 CLI 库，stdio MCP 不需要 argv 解析
- 不引入 dotenv，环境变量由 Kiro 通过 mcp.json 的 env 字段注入
- 不引入 simple-git 等 git 包装库，使用 `child_process.spawn` 直接调用系统 git（避免引入间接依赖、保留对 git 输出的完全控制）

## 设计完成检查清单

| 章节 | 完成 |
|------|------|
| Overview（含设计决策摘要） | ✅ |
| Architecture（含 Mermaid 整体架构图、端到端工作流图、MCP Server 内部结构图） | ✅ |
| 项目目录结构（含新增文件树 + 现有文件更新清单） | ✅ |
| Gerrit MCP Server 设计（技术栈/模块/环境变量/HTTP 客户端/错误处理/12 工具/三态/spawn/Comment 选型） | ✅ |
| Commit Message Generator 设计（输入数据/字段算法/元数据规则/format-parse/Steering 大纲） | ✅ |
| Branch_Detector 设计（五级策略含 Mermaid 流程图 + MP 正则） | ✅ |
| 端到端工作流集成（Steering 更新点 + 10 步流程图） | ✅ |
| 安全机制设计（三层防护图 + 授权矩阵 + Hooks 现状） | ✅ |
| POWER.md 与 mcp.json 配置变更 | ✅ |
| 数据模型（TypeScript 类型定义） | ✅ |
| Correctness Properties（21 个属性，全部含 Validates 引用） | ✅ |
| Error Handling（错误分类矩阵 + 三态流程图 + 安全错误处理） | ✅ |
| Testing Strategy（PBT + 单元 + 集成 + 冒烟 + Steering Review） | ✅ |
| 性能、安全、依赖 | ✅ |
