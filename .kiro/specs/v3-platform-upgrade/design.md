# Design Document

> 中文标题：设计文档：whaletv-dev-power v3 架构级完善与治理化升级

## Overview

本设计文档承接 `requirements.md` 的 9 项需求，按优先级 P0 → P3 描述具体的技术方案与实现要点。设计原则：

1. **向后兼容**：现有用户的 `mcp.json` / `~/.kiro/settings/mcp.json` 不需要改动即可继续工作；SoT 是新增的**可选**路径。
2. **幂等**：所有部署脚本、CLI 工具、hook 生成都是幂等的，重复运行不产生副作用。
3. **模块解耦**：新增能力（deploy / 凭据 CLI / 报告生成）不与现有 MCP 工具耦合，可以独立发布。
4. **借鉴不照搬**：AEF 的成熟设计模式落地为本项目的**具体实现**，不做架构层的大迁移（比如不切 Python）。

---

## 需求 1（P0）：修复 Hook 格式

### 现状

`hooks/safety-hooks.json` 是一个自定义汇总文件：

```json
{
  "hooks": [
    { "id": "block-sudo", "eventType": "preToolUse", "toolTypes": "shell",
      "pattern": "^sudo\\s", "action": "block", "reason": "...", "alternative": "..." }
  ]
}
```

这个 schema **Kiro 完全不识别**。Kiro 官方要求每个 hook 是单独的 JSON 文件，schema 为：

```json
{
  "name": "Block Sudo",
  "version": "1.0.0",
  "when": { "type": "preToolUse", "toolTypes": ["shell"] },
  "then": { "type": "askAgent", "prompt": "..." }
}
```

### 设计方案

#### 1.1 拆分文件映射

现有 7 条规则拆成 7 个独立 JSON 文件：

| 现有 id | 新文件名 | 触发场景（保留原语义） |
|---|---|---|
| block-sudo | `hooks/block-sudo.json` | 命令包含 `sudo` |
| block-mp-push | （新增）`hooks/block-mp-push.json` | git push 到 `*_mp` 分支 |
| block-root-search | `hooks/block-root-search.json` | find/grep 在 `/` 或 `~/` |
| block-tmp-write | `hooks/block-tmp-write.json` | 重定向到 `/tmp/` |
| block-out-search | `hooks/block-out-search.json` | 搜索 `out/` / `prebuilts/` |
| block-git-add-all | `hooks/block-git-add-all.json` | `git add . / -A / --all / *` |
| block-bulk-copy-out | `hooks/block-bulk-copy-out.json` | `rsync` / `cp -r` 复制 `out/` / `prebuilts/` |

其中 `block-mp-push` 是从 steering safety-rules.md 里的规则补进来的（原 `safety-hooks.json` 没有，是遗漏）。

#### 1.2 Hook prompt 模板

参照 AEF 的成熟设计，每个 hook prompt 遵循以下结构：

```
Check the command about to be executed: if it contains <pattern-description>,
you MUST stop immediately. <reason>.

Correct approach: <alternative>.

If detected, explain to the user why the operation was blocked and request
explicit permission before proceeding.
```

用中文写（本项目主语言）。关键要点：
- 不用 regex 硬拦（Kiro hook 是靠 AI 判断，不是 regex 引擎）
- 明确"你必须停止"（MUST）而不是"建议"（SHOULD）
- 提供替代方案，让 AI 能直接建议给用户
- 说明为什么这个操作被拦截（教育效果）

#### 1.3 归档旧文件

`hooks/safety-hooks.json` **不删除**，改名为 `.learnings/archive/safety-hooks-v2-legacy.json` 保留一份用于历史参考。这样 v3 迁移过程中如果用户还在跑 v2，可以对照。

#### 1.4 文档同步更新

- `POWER.md` 的"三层安全防护"章节列出新的 hook 清单
- `steering/safety-rules.md` 第二层 Hook 拦截章节改为引用 hook JSON 文件路径，而不是描述自定义字段

---

## 需求 2（P1）：一键部署脚本 `deploy.mjs`

### 设计方案

#### 2.1 脚本结构

```
scripts/deploy.mjs
├── parseArgs()              // 解析 CLI 参数
├── checkEnv()               // Node ≥ 22.5 检查
├── detectTargets()          // 决定用户级 / workspace 级
├── backupTarget()           // 备份现有 .kiro/ 内容
├── deploySteering()         // steering/*.md → .kiro/steering/
├── deployHooks()            // hooks/*.json → .kiro/hooks/
├── deploySkills()           // .kiro/skills/*.md → target/.kiro/skills/
├── updatePath()             // 更新 PATH（含 bin/）
├── reportSummary()          // 打印 [OK]/[SKIP]/[FAIL] 统计
└── main()
```

#### 2.2 参数设计

```bash
node scripts/deploy.mjs                        # 部署到 ~/.kiro/
node scripts/deploy.mjs --workspace <path>     # 部署到 <path>/.kiro/
node scripts/deploy.mjs --dry-run              # 仅打印动作，不写
node scripts/deploy.mjs --skip-hooks           # 跳过 hook 部署
node scripts/deploy.mjs --skip-steering        # 跳过 steering 部署
node scripts/deploy.mjs --skip-skills          # 跳过 skill 部署
node scripts/deploy.mjs --no-path              # 不修改 PATH
```

#### 2.3 备份策略（借鉴 AEF）

每次部署前：
1. 检查目标目录是否存在
2. 若存在，拷贝到 `.kiro/backup-<yyyyMMdd-HHmmss>/`
3. 部署完成后扫描 backup 目录，仅保留最近 3 个（按时间戳排序删除旧的）

#### 2.4 Kiro IDE 锁检测

参照 AEF `init.py` 的 `is_kiro_running()` 逻辑：

- Windows: `tasklist /FI "IMAGENAME eq Kiro.exe"` 检查输出
- Linux/macOS: `pgrep -f kiro`

如果检测到 Kiro 在运行，弹出明确警告并 exit 1（不做部署）。

#### 2.5 PATH 管理（借鉴 AEF）

复用 AEF 的 marker block 机制：

- Linux/macOS：在 `~/.zshrc` 或 `~/.bashrc` 中管理一段：

```bash
# >>> whaletv-dev-power (managed by scripts/deploy.mjs) >>>
export PATH="<repo>/bin:$PATH"
# <<< whaletv-dev-power <<<
```

- Windows：读取 `HKCU\Environment\Path`，检测所有以 `whaletv-dev-power\bin` 结尾的条目，去重、更新到当前 repo。

- 迁移检测：如果旧 marker block 的路径 ≠ 当前路径，打印"框架已迁移，旧位置为 X（可清理）"。

#### 2.6 幂等实现

- 覆盖式部署（每次都 overwrite，不做 diff 检查）——简单可靠
- 但备份保留最近 3 个（避免磁盘膨胀）
- `--dry-run` 模式仅打印动作，方便 CI/自查

#### 2.7 错误处理

每个部署阶段独立 try/catch，累计 error 计数。最终 exit code = min(errors, 1)。

---

## 需求 3（P1）：单一凭据源与凭据 CLI

### 设计方案

#### 3.1 SoT 文件 schema

`~/.ai/whaletv.yaml`：

```yaml
# WhaleTV Developer Power - 单一凭据源
# 由 scripts/setup-creds.mjs 或 scripts/refresh-auth.mjs 自动写入
# 也可手动编辑；权限须为 0600（Linux/macOS）

# Zmind (Redmine)
zmind:
  api_key: <40 位十六进制>
  url: https://zmind.whaletv.com  # 可选，默认值

# OpenGrok
opengrok:
  username: <共享账号>
  password: <共享密码>
  url: https://opengrok.zeasn.com
  project: <可选默认项目>

# Gerrit
gerrit:
  # 模式 A（session，推荐）
  auth_header: "Basic <base64>"
  cookie: "GerritAccount=...; XSRF_TOKEN=..."
  # 模式 B（basic，备用）
  username: <可选>
  http_password: <可选>
  url: https://whale-gerrit.zeasn.com

# Confluence（独立账号）
confluence:
  username: <首字母可能大写，独立账号>
  password: <独立密码>
  cookie: "JSESSIONID=...; seraph.confluence=..."
  base_url: https://docs.whaletv.com

# S3 上传（可选，供 report-upload 用）
s3_issue_analysis:
  access_key_id: <>
  secret_access_key: <>
  region: <>
  bucket: <>

# 元数据
_meta:
  email: <用户工作邮箱>  # 供 Zmind Hub 未来做归因
  updated_at: <ISO-8601>
  version: 1
```

#### 3.2 CLI 工具设计

`scripts/whaletv-credentials.mjs`：

```javascript
// 用法：
//   whaletv-credentials get <key>       # 如 zmind.api_key / gerrit.auth_header
//   whaletv-credentials check           # 验证所有必需字段
//   whaletv-credentials set <key> <val> # 更新单个字段
//   whaletv-credentials list            # 列出所有已配置的键（不输出值）
//   whaletv-credentials path            # 打印 SoT 文件绝对路径

// 实现要点：
//   - Node.js 22+ 内置 YAML 解析：用 fs.readFileSync + 自己写简单 parser
//     （不用第三方依赖，避免部署复杂性；YAML 只支持 flat 与两层嵌套即可）
//   - get 时输出纯值到 stdout，不加换行符
//   - check 缺失字段列表打印到 stderr，exit 1
//   - set 前必备份 `~/.ai/whaletv.yaml.bak.<ts>`
//   - Linux/macOS chmod 0600
```

#### 3.3 bin 目录结构

```
bin/
├── whaletv-credentials           # bash shebang: exec node scripts/whaletv-credentials.mjs
├── whaletv-credentials.cmd       # Windows: node "%~dp0..\scripts\whaletv-credentials.mjs" %*
├── gerrit-show                   # bash
├── gerrit-show.cmd               # Windows
├── gerrit-api                    # bash
└── gerrit-api.cmd                # Windows
```

#### 3.4 MCP server 集成

每个 MCP server 在 `src/index.ts` 启动阶段：

```typescript
// 伪代码
async function loadCredentials() {
  // 1. 优先尝试从 SoT 读
  const sotPath = process.env.WHALETV_SOT || `${os.homedir()}/.ai/whaletv.yaml`;
  if (fs.existsSync(sotPath)) {
    try {
      const sot = parseYaml(fs.readFileSync(sotPath, 'utf-8'));
      return {
        zmind_api_key: sot.zmind?.api_key || process.env.ZMIND_API_KEY,
        gerrit_auth_header: sot.gerrit?.auth_header || process.env.GERRIT_AUTH_HEADER,
        // ...
      };
    } catch (e) {
      console.error(`[warn] Failed to parse SoT ${sotPath}: ${e.message}, falling back to env`);
    }
  }
  // 2. 回退到 env
  return {
    zmind_api_key: process.env.ZMIND_API_KEY,
    // ...
  };
}
```

这样即使用户完全没建 SoT，v3 也能像 v2 那样跑。

#### 3.5 refresh-auth 与 setup-creds 迁移

- `scripts/setup-creds.mjs`：改为写 SoT 而不是遍历 mcp.json（简化 40+ 行的 substring 匹配逻辑）
- `scripts/refresh-auth.mjs`：同上，抓到 cookie 后直接更新 SoT 的 `gerrit.cookie` / `confluence.cookie` 字段
- **旧的 mcp.json 写入代码保留为 fallback**：如果用户完全没建 SoT 且从 mcp.json 里发现遗留 env，一次性迁移一份到 SoT（migrate-once 行为）

#### 3.6 onboarding.md 更新

引导流程从"env 分散写入"改为"一次填写 SoT"，明显减少 onboarding 步骤数量（从 6 步简化到 3 步）。

---

## 需求 4（P1）：Steering/Skill 分工重整

### 设计方案

#### 4.1 目标目录结构

```
steering/                        # 短、always-inclusion
├── critical-rules.md            # ≤200 行 — 血泪教训（MUST NOT）
├── conventions.md               # ≤200 行 — SHOULD 级建议
├── execution-rules.md           # ≤100 行 — 术语与元规则
├── module-path-map.md           # 保留 auto-inclusion（工具用）
└── safety-rules.md              # 保留 auto-inclusion（引用 hooks）

.kiro/skills/                    # description-driven trigger
├── whaletv-onboarding/SKILL.md
├── whaletv-auth-refresh/SKILL.md
├── whaletv-pr-cr/SKILL.md
├── whaletv-cherry-pick/SKILL.md
├── whaletv-bug-analysis/SKILL.md
├── whaletv-gerrit-workflow/SKILL.md
├── whaletv-code-review/SKILL.md
├── whaletv-commit-message/SKILL.md
├── whaletv-knowledge-base/SKILL.md
└── whaletv-local-code/SKILL.md
```

#### 4.2 抽取原则

- **MUST NOT / MUST** 硬约束 → 抽到 `critical-rules.md`
- **SHOULD** 建议 → 抽到 `conventions.md`
- **术语** → 抽到 `execution-rules.md`
- **工作流步骤 + IF/THEN 决策 + 具体模板** → 保留在 SKILL.md 内

#### 4.3 SKILL.md YAML front-matter 规范

```markdown
---
name: whaletv-pr-cr
description: |
  处理 Zmind PR/CR 的端到端工作流。TRIGGERS: "处理 PR", "分析 CR",
  "帮我看看 PR #12345", "把这个 CR 修了", 或任何包含 PR/CR + Zmind ID
  的请求。这是处理 PR/CR 类 Issue 的主要 skill，其他 skill（如
  whaletv-bug-analysis）主要处理不带明确 PR/CR 标签的 Bug。使用本
  skill 时先加载 whaletv-commit-message + whaletv-code-review 做辅助。
---

# WhaleTV PR/CR 处理

## When to Use

- 用户说 "处理 PR xxx" / "分析 CR xxx" / "帮我处理下这个 CR" ...
- 用户给出 Zmind Issue ID 且期望完整闭环

## When NOT to Use

- 用户只想看看 Issue（用 zmind-mcp get_issue 即可，不加载本 skill）
- 用户只想做 Cherry-Pick（用 whaletv-cherry-pick）
- 用户只需要生成 Commit Message（用 whaletv-commit-message）

## Workflow Steps

（保留现有 pr-cr-workflow.md 的详细步骤）
```

#### 4.4 重叠内容清理

- `steering/gerrit-workflow.md` 中"处理 gerrit-ai 评论"部分 → 移除，仅在 `whaletv-code-review` skill 内保留
- `steering/pr-cr-workflow.md` 中的详细步骤 → 迁移到 `whaletv-pr-cr/SKILL.md`
- `steering/commit-message-workflow.md` 保留完整 Property 契约（这是核心资产）→ 迁移到 `whaletv-commit-message/SKILL.md`
- `.kiro/skills/code-review.md`、`.kiro/skills/gerrit-integration.md`、`.kiro/skills/opengrok-integration.md`、`.kiro/skills/internal-docs.md`、`.kiro/skills/brainstorming.md`、`.kiro/skills/find-skill.md`、`.kiro/skills/project-code-mapping.md`、`.kiro/skills/self-improving.md`、`.kiro/skills/skill-creator.md` 逐一评估：
  - 若已被新 skill 覆盖 → 归档到 `.learnings/archive/`
  - 若独立有价值 → 保留并升级为 SKILL.md 结构

#### 4.5 迁移风险

- **用户已经习惯了 `steering/pr-cr-workflow.md` 直接可见**——v3 迁移到 skill 后 workspace 里看不到那份文件了，可能造成"我以前的 workflow 呢"的困惑
- **对策**：在 `steering/` 下保留 `MIGRATED-TO-SKILLS.md`，列出 v2 → v3 的 workflow 文件映射；README 中也做说明

---

## 需求 5（P2）：执行报告生成与治理层

### 设计方案

#### 5.1 Schema 定义

`mcp-servers/knowledge-mcp-server/schemas/report-fact-v1.schema.json`：

（详细 schema 借鉴 AEF 的 `report-fact-v1.schema.json`，字段结构完全对齐）

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Report Fact v1",
  "type": "object",
  "required": ["report_id", "meta", "business_summary", "workflow_execution"],
  "properties": {
    "report_id": { "type": "string", "pattern": "^[a-z0-9-]+-[A-Z0-9-]+$" },
    "meta": {
      "type": "object",
      "properties": {
        "generated_at": { "type": "string", "format": "date-time" },
        "scenario": { "type": "string" },
        "workflow_type": { "type": "string", "enum": ["issue-analysis", "pr-cr", "cherry-pick", "commit-message", "bug-analysis"] },
        "user_email": { "type": "string" }
      }
    },
    "business_summary": {
      "type": "object",
      "properties": {
        "details": {
          "type": "object",
          "properties": {
            "issue_id": { "type": "string" },
            "issue_status": { "type": "string" },
            "symptom_type": { "enum": [ /* 13 值 */ ] },
            "root_cause_category": { "enum": [ /* 14 值 */ ] }
          }
        },
        "conclusion": { "type": "string" }
      }
    },
    "workflow_execution": {
      "type": "object",
      "properties": {
        "phases": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "summary": { "type": "string" },
              "outputs": { "type": "object" },
              "gate": { "type": "object" },
              "rules_hit": { "type": "array" },
              "tools_used": { "type": "array" },
              "knowledge_used": { "type": "array" }
            }
          }
        }
      }
    },
    "quality_signals": {
      "type": "object",
      "properties": {
        "phases_completed": { "type": "integer" },
        "phases_skipped": { "type": "integer" },
        "gates_passed": { "type": "integer" },
        "hooks_triggered": { "type": "integer" }
      }
    }
  }
}
```

#### 5.2 工具接口

```typescript
// mcp-servers/knowledge-mcp-server/src/tools/generate-report.ts
generate_report(input: {
  issue_id: string;
  workflow_type: string;
  phases: PhaseData[];        // AI 收集的每个 phase 的原始数据
  business_summary?: object;
  output_dir?: string;         // 默认 "report-output/{issue_id}/"
}) → {
  report_id: string;
  json_path: string;
  html_path: string;
  s3_hint: string;             // 提示用户可以调 upload_report
}

// mcp-servers/knowledge-mcp-server/src/tools/upload-report.ts
upload_report(input: {
  report_path: string;         // 本地 HTML 路径
  year?: number;               // 默认当前 UTC 年
  week?: number;               // 默认当前 ISO 周
}) → {
  s3_uri: string;
  bucket: string;
  key: string;
}
```

#### 5.3 HTML 模板设计

单文件、CSS + JS 内联。使用 `<script type="application/json" id="report-json">{}</script>` 承载数据，JS 通用 KV 渲染器：

- 值类型自动识别：string → 直显；object → 递归展开；array → 列表；enum → tag 样式
- 特殊字段识别（可选）：`gate`、`symptom_type`、`root_cause_category` 用不同颜色标签
- 无外部资源依赖（无 CDN、无 fetch）

#### 5.4 S3 上传

- 使用 `@aws-sdk/client-s3`（Node.js 22+ 原生支持）
- 凭据从 `~/.ai/whaletv.yaml` 的 `s3_issue_analysis` 段读取
- 支持 `--profile` 参数走本地 AWS profile

#### 5.5 触发点集成

- `whaletv-bug-analysis/SKILL.md` 与 `whaletv-pr-cr/SKILL.md` 的最后一步（completion rule）改为：
  1. 调 `generate_report`
  2. 提示用户是否 `upload_report`

参照 AEF 的做法：**报告生成是无条件的**（即使 workflow 中途终止也生成，reflecting whatever was completed）。

---

## 需求 6（P2）：跨终端 CLI 工具

### 设计方案

#### 6.1 `gerrit-show` 实现

```javascript
// bin/gerrit-show（Node.js 脚本，shebang: #!/usr/bin/env node）
// 用法：
//   gerrit-show <change-id>          # 完整 diff + commit message
//   gerrit-show <change-id> -s       # 仅文件列表
//   gerrit-show <change-id> --full   # 完整 unified diff

// 实现：
//   1. 读 SoT 拿 gerrit 凭据
//   2. GET /changes/<id>/detail?o=CURRENT_REVISION&o=CURRENT_COMMIT
//   3. GET /changes/<id>/revisions/current/patch?zip=false （返回 base64 unified diff）
//   4. Base64 decode + 输出到 stdout
```

#### 6.2 `gerrit-api` 实现

```javascript
// bin/gerrit-api（通用 REST 客户端）
// 用法：
//   gerrit-api "/changes/?q=owner:xxx+status:open&n=20"
//   gerrit-api "/changes/<id>/revisions/current/review" -d '{"message":"LGTM"}'

// 实现：
//   1. 读 SoT
//   2. 拼路径（自动加 /a/ 前缀或不加，取决于 auth mode）
//   3. GET/POST + 剥离 )]}' XSSI 前缀
//   4. 输出 JSON 到 stdout（含 pretty-print）
```

#### 6.3 Windows `.cmd` 包装器

```cmd
@echo off
node "%~dp0..\scripts\whaletv-credentials.mjs" %*
```

（每个 CLI 工具都有一份 `.cmd` 包装器）

#### 6.4 PATH 集成

`deploy.mjs` 部署完成后自动更新 PATH（见需求 2）。

---

## 需求 7（P2）：Prerequisites 与 README

设计上无技术难点，主要是文档更新。见 requirements.md 的验收标准列表。

---

## 需求 8（P2，条件性）：Codebase 分类

### 设计方案

在实施前先与用户对话确认：

```
问用户：
1. WhaleTV 的代码库（如 d4_code / stm_code / x5_code / stb_code 等）是否
   存在类似 AEF Category A / B 的架构分类（有些用 Hook 架构，有些直接改 AOSP）？
2. 如果存在，能否提供每个 codebase 的分类信息？
```

若用户确认：在 `steering/codebase-taxonomy.md` 里按 AEF `codebase_diff_map.md` 的格式写。
若用户否认：跳过本需求。

---

## 需求 9（P3）：Zmind Hub 调研

### 设计方案

产出文档 `.kiro/specs/v3-platform-upgrade/zmind-hub-design.md`，不实施。

文档结构参考 AEF README 里的 "Why two Zmind servers?" 章节 + AEF `whale-zmind-mcp-server`（本地 stdio） / hub（远程 streamable-http）的双注册模式。

关键内容：
- 迁移触发条件（团队 >30 人 / WAF 每周 5 次 403 / 附件 URL 泄露事件）
- Hub 架构图
- 缓存 TTL 策略（默认 5-10 分钟，可配）
- HMAC 签名附件 URL 生成/验证逻辑
- Rate limit 与 stats 端点设计
- Roll-out 计划（灰度、observability）

---

## 实施顺序与依赖

```
P0 需求 1（hook 格式）
    └─ 独立，无依赖，立即可做

P1 需求 2（deploy.mjs）
    └─ 部分依赖需求 1（部署新格式 hook）

P1 需求 3（SoT + 凭据 CLI）
    └─ 部分依赖需求 6（bin 目录复用）

P1 需求 4（steering/skill 重整）
    └─ 部分依赖需求 2（deploy.mjs 需要知道新目录结构）

P2 需求 5（执行报告）
    └─ 依赖需求 3（S3 凭据从 SoT 读）

P2 需求 6（CLI 工具）
    └─ 依赖需求 3（凭据 CLI）

P2 需求 7（README）
    └─ 依赖需求 1-6 全部完成

P2 需求 8（codebase-taxonomy）
    └─ 独立，可并行

P3 需求 9（Zmind Hub 调研）
    └─ 独立，不实施
```

推荐实施顺序：**1 → 2 → 3 → 4 → 6 → 5 → 7 → 8 → 9**。

其中：
- **1**（P0）**必须先做**
- **2 / 3 / 4 / 6**（P1 + P2 CLI）可以并行，但推荐 2 先做（提供部署基础设施）
- **5 / 7 / 8**（P2 治理与文档）可以在 P1 全部完成后再做
- **9**（P3）随时可写调研文档，不阻塞任何东西

---

## 风险与缓解

| 风险 | 缓解措施 |
|---|---|
| 用户已有 mcp.json 配置，迁移到 SoT 时出错 | migrate-once 逻辑：首次运行 deploy.mjs 时自动把 mcp.json env 迁移到 SoT，保留 mcp.json 作为 fallback |
| 现有用户被 breaking-change 影响 | MCP servers 保持向后兼容（env 回退），只在**新装**时优先用 SoT |
| Hook 拆分后规则数量变多，用户感觉噪音大 | Hook prompt 精炼、只在真正需要时触发；提供 `--skip-hooks` 部署选项 |
| Skill 迁移导致用户找不到熟悉的 workflow 文件 | 保留 `steering/MIGRATED-TO-SKILLS.md` 索引；README 明确说明 |
| 报告生成对性能有影响 | 报告生成设为可选（skill completion rule 提示 AI，但不强制）；HTML 模板轻量 |
| Playwright 自动登录在报告生成场景不需要，但依赖已装 | 无影响，Playwright 只在 refresh-auth 场景启动 |
