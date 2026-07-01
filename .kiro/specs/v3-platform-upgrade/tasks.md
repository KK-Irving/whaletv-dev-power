# Implementation Tasks

> 中文标题：任务清单：whaletv-dev-power v3 架构级完善与治理化升级

按优先级 P0 → P3 排列。每个任务包含前置条件、验收标准、涉及文件。任务粒度控制在 ≤ 半天工作量内。

## 图例

- 🔴 **P0**：bug 级 / 阻塞级，必须立即修
- 🟠 **P1**：高优先级 / 大幅提升体验
- 🟡 **P2**：中优先级 / 治理与扩展
- ⚪ **P3**：长期演进 / 仅规划

---

## 🔴 P0：修复 Hook 格式（需求 1）✅ 已完成

### Task 1.1：归档旧的 safety-hooks.json ✅

- [x] 创建 `.learnings/archive/` 目录
- [x] 把 `hooks/safety-hooks.json` 拷贝到 `.learnings/archive/safety-hooks-v2-legacy.json`
- [x] 删除原 `hooks/safety-hooks.json`（拆分后独立 JSON 文件替代）

**涉及文件**：`hooks/safety-hooks.json`, `.learnings/archive/safety-hooks-v2-legacy.json`

**验收标准**：`hooks/` 目录下不再有 `safety-hooks.json`；`.learnings/archive/` 下有归档文件。

---

### Task 1.2：创建 7 份符合 Kiro schema 的 hook JSON 文件 ✅

- [x] 创建 `hooks/block-sudo.json`（拦截 `sudo` 命令）
- [x] 创建 `hooks/block-mp-push.json`（拦截 push 到 `*_mp` 分支）
- [x] 创建 `hooks/block-root-search.json`（拦截 find/grep 根目录/家目录搜索）
- [x] 创建 `hooks/block-tmp-write.json`（拦截写入 `/tmp/`）
- [x] 创建 `hooks/block-out-search.json`（拦截搜索 `out/` 和 `prebuilts/`）
- [x] 创建 `hooks/block-git-add-all.json`（拦截 `git add .` / `-A` / `--all` / `*`）
- [x] 创建 `hooks/block-bulk-copy-out.json`（拦截大范围 rsync/cp 到 out/prebuilts）

**Schema 模板**（每个文件）：

```json
{
  "name": "<hook 名称>",
  "version": "1.0.0",
  "description": "<一句话描述>",
  "when": {
    "type": "preToolUse",
    "toolTypes": ["shell"]
  },
  "then": {
    "type": "askAgent",
    "prompt": "<中文 prompt：检测什么 + 必须停止 + 替代方案 + 教育性说明>"
  }
}
```

**验收标准**：7 个 JSON 文件都符合 Kiro schema，Kiro 加载后能识别（可用 Kiro 内置的 hook 面板验证）。

---

### Task 1.3：更新 POWER.md 的 Hook 章节 ✅

- [x] 在 POWER.md 中定位 Hook 相关章节
- [x] 更新为列出 7 个独立 hook JSON 文件 + 触发场景表格
- [x] 移除对旧 `safety-hooks.json` 汇总文件的引用

---

### Task 1.4：更新 steering/safety-rules.md 的第二层 Hook 章节 ✅

- [x] 定位 `steering/safety-rules.md` 的"第二层：Hook 拦截"章节
- [x] 替换自定义字段（pattern / action / reason / alternative）的描述
- [x] 改为列出每个 hook 文件路径 + `then.prompt` 摘要
- [x] 保留三层防护的整体框架描述

---

### Task 1.5：更新 README.md 的 Hook 章节 ✅

- [x] 定位 README 中的 hook 相关章节
- [x] 更新为新格式描述
- [x] 说明"这些 hook 是 Kiro 官方 schema，会被自动加载"

---

## 🟠 P1：一键部署脚本（需求 2）✅ 已完成

### Task 2.1：设计 `scripts/deploy.mjs` 骨架 ✅

- [x] 创建 `scripts/deploy.mjs`
- [x] 实现 `parseArgs()`：`--workspace <path>` / `--dry-run` / `--skip-hooks` / `--skip-steering` / `--skip-skills` / `--no-path`
- [x] 实现 `printUsage()` 打印帮助
- [x] 实现 `checkEnv()`：Node ≥ 22.5 检查
- [x] 实现 `isKiroRunning()`：Windows tasklist / Unix pgrep

---

### Task 2.2：实现资源部署逻辑 ✅

- [x] 实现 `backupTarget(kiroDir)`：拷贝 `.kiro/` 到 `.kiro/backup-<ts>/`
- [x] 实现 `cleanupOldBackups(kiroDir)`：保留最近 3 个
- [x] 实现 `deploySteering(src, dst, dryRun)`：把 `steering/*.md` 复制到 `dst/steering/`
- [x] 实现 `deployHooks(src, dst, dryRun)`：把 `hooks/*.json` 复制到 `dst/hooks/`
- [x] 实现 `deploySkills(src, dst, dryRun)`：把 workspace 的 `.kiro/skills/*` 复制到 `dst/skills/`
- [x] 实现 `printSummary(counts)`：打印 [OK]/[SKIP]/[FAIL] 统计
- [x] 附加：hook 部署前 schema 验证（拒绝写入不合规 JSON）

---

### Task 2.3：实现 PATH 管理 ✅

- [x] 实现 `updatePathUnix(binDir)`：写 marker block 到 `~/.zshrc` / `~/.bashrc`
- [x] 实现 `updatePathWindows(binDir)`：更新 HKCU\Environment\Path
- [x] 实现迁移检测：如果旧 PATH 条目 ≠ 当前 binDir，打印提示

---

### Task 2.4：集成 Kiro IDE 锁检测 ✅

- [x] 在部署开始前调 `isKiroRunning()`
- [x] 若检测到 Kiro 运行，打印明确警告并 exit 1
- [x] 若检测过程失败（如 tasklist 不存在），降级为 warning 但继续（--dry-run 模式可跳过）

---

### Task 2.5：更新 README.md 引导用户使用 deploy.mjs ✅

- [x] 在 README.md 的"安装"章节补充 deploy.mjs 用法（Step 2）
- [x] 展示 `node scripts/deploy.mjs` 与 `node scripts/deploy.mjs --workspace <path>` 两种典型用法
- [x] 说明 backup / dry-run / 迁移检测 / schema 校验 / --skip-* 机制
- [x] 新增 Step 3：v3 单一真源凭据管理章节（含 init/migrate/check/list/get/set）

---

## 🟠 P1：单一凭据源与凭据 CLI（需求 3）

### Task 3.1：设计并实现 `~/.ai/whaletv.yaml` schema ✅

- [x] 在 `.kiro/specs/v3-platform-upgrade/design.md` 中定义完整 schema
- [x] 创建 `templates/whaletv.yaml.tmpl` 作为参考模板

---

### Task 3.2：实现 `scripts/whaletv-credentials.mjs` ✅

- [x] 创建 `scripts/whaletv-credentials.mjs`
- [x] 实现简单 YAML parser（避免第三方依赖，只支持 flat + 两层嵌套）
- [x] 实现 `get <key>`：输出纯值到 stdout
- [x] 实现 `check`：验证必需字段，缺失时到 stderr + exit 1
- [x] 实现 `set <key> <value>`：更新单个字段（保留其他 + 备份）
- [x] 实现 `list`：列出所有已配置的键（不输出值）
- [x] 实现 `path`：打印 SoT 文件绝对路径
- [x] 实现 `init`：交互创建 SoT
- [x] 实现 `migrate`：从 mcp.json 一次性迁移（兼容 Kiro Power namespace 前缀）
- [x] Linux/macOS 写入后 chmod 0600
- [x] 写入前备份为 `~/.ai/whaletv.yaml.bak.<ts>`（保留最近 3 个）
- [x] 拒绝三层嵌套（schema 强约束）
- [x] Round-trip 测试通过（18/18 assertion pass）

---

### Task 3.3：在 `bin/` 目录提供跨平台包装器 ✅

- [x] 创建 `bin/whaletv-credentials`（Node ESM 直调，支持 realpath 让 symlink 也可用）
- [x] 创建 `bin/whaletv-credentials.cmd`（Windows 包装）
- [x] 两种包装器都能正确 forward 参数（Windows 已验证）

---

### Task 3.4：MCP servers 集成 SoT 读取（向后兼容）✅

**实现方式**：每个 server 的 `src/` 下加自包含 `sot-loader.ts`（无跨包依赖，含极简 YAML parser 与 env 映射表），`index.ts` 首行 side-effect import。**env 优先**：空字符串或未设置才被 SoT 值填充，保证老用户 mcp.json 里的现有 env 完全兼容。

- [x] `zmind-mcp-server/src/{sot-loader.ts, index.ts}` + rebuild dist（tsc 无错）
- [x] `opengrok-mcp-server/src/{sot-loader.ts, index.ts}` + rebuild dist
- [x] `gerrit-mcp-server/src/{sot-loader.ts, index.ts}` + rebuild dist
- [x] `confluence-mcp-server/src/{sot-loader.ts, index.ts}` + rebuild dist
- [x] `knowledge-mcp-server/src/{sot-loader.ts, index.ts}` + rebuild dist（sot-loader 必须在 config.ts 之前 import，因为 config.ts module load 时就会读 env）
- [x] 加载成功时 stderr 打印 `[sot-loader] 从 <path> 注入 X 个环境变量：<list>`（作为启动 banner）
- [x] 集成测试：4 个 server 均成功从 SoT 注入 10 个环境变量（knowledge 因 ONNX 加载较慢单独手工验证 dist/sot-loader.js 存在且 6150 bytes 与其他一致）

**关键设计**：
- 空 SoT 或不存在时静默跳过（不 throw、不阻塞启动）
- env 已有非空值 → SoT 不覆盖（Kiro Power namespace 前缀的 env 也能正常工作）
- 5 份 sot-loader.ts 内容完全相同（6150 bytes），未来改动同步 5 份即可

---

### Task 3.5：迁移 `scripts/setup-creds.mjs` 到写 SoT ✅

- [x] 重构 `scripts/whaletv-credentials.mjs`：core 函数 export（readSoT / writeSoT / setByPath 等），CLI 仅在直接运行时执行
- [x] `setup-creds.mjs` 通过 `import` 直接调用 SoT core，避免 spawn 子进程
- [x] 默认写 SoT；`--legacy-mcp-json` 显式启用 mcp.json 双写
- [x] mcp.json 双写失败不阻塞（SoT 已写成功即返回 0）
- [x] 集成测试：16/16 通过（含幂等性、双写、边界情况）

---

### Task 3.6：迁移 `scripts/refresh-auth.mjs` 到写 SoT ✅

- [x] `refresh-auth.mjs` import SoT core，Playwright 抓完 cookie + 自检通过后先写 SoT
- [x] mcp.json 双写策略：**mcp.json 已存在时自动启用双写**（渐进式迁移），`--sot-only` 关闭，`--legacy-mcp-json` 强制启用
- [x] 双写失败不阻塞（SoT 已写成功即返回 0，只 warn 双写失败）

---

### Task 3.7：更新 `steering/onboarding.md` 反映新流程 ✅

- [x] 头部改为 v3 版本号 + 新增"v3 单一凭据源架构"说明章节
- [x] 简化关键约束描述（v3 起 Kiro Power namespace 兼容问题消失，改为在 sot-loader 内部处理）
- [x] 引导流程重新组织：**部署 → 收集 → 抓 cookie → 验证** 四步，其中收集环节提供三种方式（交互式 `init` / 环境变量 `setup-creds` / v2 迁移 `migrate`）
- [x] 凭据存储位置章节：v3 主路径 SoT + v2 兼容路径 mcp.json 分开列出
- [x] 后续补充配置：改用 `whaletv-credentials set/get/check/list` 命令

---

## 🟠 P1：Steering/Skill 分工重整（需求 4）✅ 已完成

### Task 4.1：抽取 critical-rules / conventions / execution-rules ✅

- [x] 创建 `steering/critical-rules.md`（~130 行，MUST NOT 硬约束 + 强制 GATE 场景清单，每条对应 hook）
- [x] 创建 `steering/conventions.md`（~120 行，SHOULD-level 建议：代码搜索 5 档 / 通信优先级 / Issue 识别符 / 图表标准 / commit 五段式 / SoT 兼容）
- [x] 创建 `steering/execution-rules.md`（~90 行，术语定义 + skill 触发机制 + steering inclusion 模式 + 凭据管理约定 + 报告约定）
- [x] 参考 AEF 风格：每条硬约束都对应真实事故 + 对应 hook；三份文件互相不重复

---

### Task 4.2：迁移 workflow steering 到 skill 结构 ✅

用一次性迁移脚本 `.scratch/migrate-workflows-to-skills.mjs`（跑完删除）把 10 份 workflow 一次性迁移，**原文正文保留不改**、只加定制的 skill YAML front-matter：

- [x] `.kiro/skills/whaletv-onboarding/SKILL.md`（从 `steering/onboarding.md`）
- [x] `.kiro/skills/whaletv-auth-refresh/SKILL.md`
- [x] `.kiro/skills/whaletv-pr-cr/SKILL.md`
- [x] `.kiro/skills/whaletv-cherry-pick/SKILL.md`
- [x] `.kiro/skills/whaletv-bug-analysis/SKILL.md`
- [x] `.kiro/skills/whaletv-gerrit/SKILL.md`
- [x] `.kiro/skills/whaletv-code-review/SKILL.md`
- [x] `.kiro/skills/whaletv-commit-message/SKILL.md`
- [x] `.kiro/skills/whaletv-knowledge-base/SKILL.md`
- [x] `.kiro/skills/whaletv-local-code/SKILL.md`
- [x] 每个 SKILL.md 有 YAML front-matter（`name` + `description`）
- [x] description 明确 TRIGGERS + When to Use + When NOT to Use，语义化引导 Kiro 触发

---

### Task 4.3：清理旧 steering 目录 ✅

- [x] 迁移脚本删除了 10 份原 workflow steering（无需手工删）
- [x] 保留 `steering/module-path-map.md`（工具数据）
- [x] 保留 `steering/safety-rules.md`（三层防护体系描述 + 7 个 hook 索引）
- [x] 创建 `steering/MIGRATED-TO-SKILLS.md` 索引（v2 → v3 迁移表 + 迁移原则 + 老用户升级路径）
- [x] `steering/` 最终 6 份：`critical-rules.md` + `conventions.md` + `execution-rules.md` + `module-path-map.md` + `safety-rules.md` + `MIGRATED-TO-SKILLS.md`

---

### Task 4.4：清理 `.kiro/skills/` 中的旧文件 ✅

用一次性脚本 `.scratch/finalize-old-skills.mjs`（跑完删除）：

- [x] **归档 3 个**（内容已被 MCP server 直接覆盖，无需保留独立 skill）：
  - `gerrit-integration.md` → `.learnings/archive/skill-gerrit-integration-v2-legacy.md`（v3 用 gerrit-mcp-server + whaletv-gerrit skill）
  - `opengrok-integration.md` → 同（v3 用 opengrok-mcp-server + whaletv-local-code skill）
  - `internal-docs.md` → 同（v3 用 confluence-mcp-server + whaletv-knowledge-base skill）
- [x] **升级 6 个到子目录结构 + skill YAML front-matter**：
  - `code-review.md` → `whaletv-code-selfaudit/SKILL.md`（重命名，与 whaletv-code-review 语义分离：前者 pre-commit 自审、后者 post-push 三态处理）
  - `brainstorming.md` → `brainstorming/SKILL.md`
  - `find-skill.md` → `find-skill/SKILL.md`
  - `project-code-mapping.md` → `project-code-mapping/SKILL.md`
  - `self-improving.md` → `self-improving/SKILL.md`
  - `skill-creator.md` → `skill-creator/SKILL.md`
- [x] `.kiro/skills/` 最终 16 个子目录（10 whaletv-* + 6 通用），全部标准子目录格式，无散落 md 文件

---

### Task 4.5：更新 POWER.md 反映新结构 ✅

- [x] 头部改 v2 → v3，description 强调架构级升级（SoT + description-driven skills + Kiro 官方 hook + 一键部署）
- [x] 新增 "v3 核心升级" 章节列出 4 项新能力（hook 修复 / SoT / deploy.mjs / skill 重构）
- [x] "v2 已有能力" 章节保留（Gerrit 双通道 / RAR5 / WAF / knowledge-mcp / auth-refresh）
- [x] "首次使用" 改为 v3 三步（deploy → credentials init → refresh-auth）
- [x] "Available Steering Files" 改为 v3 精简 5 份（critical / conventions / execution / module-path-map / safety-rules）
- [x] 新增 "Available Skills" 章节展示 16 个 skill（10 whaletv-* + 6 通用），说明 description-driven 触发

---

### Task 4.6：更新 deploy.mjs 反映新目录结构 ✅

deploy.mjs 从 v3 Task 2.x 建立时就已支持 skill 子目录结构（`copyDirRecursive` 函数），本 task 无需追加改动。**dry-run 端到端验证结果**：Steering 6 · Hooks 7 · Skills 16（合计 29 项成功，0 项失败）。

- [x] `deploySkills` 遍历 `.kiro/skills/` 下的每个子目录，用 `copyDirRecursive` 递归复制
- [x] `deployHooks` 部署前 schema 校验（校验 name/version/when/then + then.type ∈ {askAgent, runCommand}）
- [x] `deploySteering` 复制所有 .md（自动包含 MIGRATED-TO-SKILLS.md 索引）
- [x] dry-run 输出显示所有资源均识别到并预备复制

---

## 🟡 P2：执行报告生成与治理层（需求 5）✅ 已完成

### Task 5.1：定义 report-fact-v1 schema ✅

- [x] Kiro 安全策略拒绝直接写 `$schema: https://...` 的 JSON schema file → 改用 TypeScript 类型定义（既是文档又是 runtime 验证）
- [x] 创建 `mcp-servers/knowledge-mcp-server/src/tools/report-schema.ts`
- [x] 定义 `ReportFactV1` 接口 + 枚举常量导出（`SCENARIO_VALUES` / `SYMPTOM_TYPES` (13) / `ROOT_CAUSE_CATEGORIES` (14) / `PHASE_STATUS_VALUES` / `FINAL_STATUS_VALUES` 等）
- [x] `validateReportFact(fact)` runtime 校验（零依赖）
- [x] `computeQualitySignals(phases)` 从 phases 自动推导 metrics

---

### Task 5.2：实现 `generate_report` MCP 工具 ✅

- [x] 创建 `mcp-servers/knowledge-mcp-server/src/tools/generate-report.ts`
- [x] 参数：scenario / task_identifier / skill_name / business_summary / phases / artifacts? / final_status? / hook_metrics? / output_dir? / started_at?
- [x] 自动推断 `final_status`（若不显式传）：aborted / gate_blocked / partial / completed
- [x] 自动计算 `quality_signals`（phase_metrics + gate_metrics + tool_call_count）
- [x] 校验失败仍落盘（validation_errors 返回，供人工排查）
- [x] 落盘到 `<output_dir>/{task_identifier}/{report_id}-report-fact-v1.json` 与 `.html`
- [x] 在 `src/index.ts` 注册为 `generate_report` MCP 工具（含 zod schema）

---

### Task 5.3：HTML 模板与渲染逻辑 ✅

- [x] 创建 `mcp-servers/knowledge-mcp-server/src/tools/report-template.ts`
- [x] 自包含单 HTML 文件（内嵌 CSS + JS，**零外部依赖**：无 `<link>` 无 CDN `<script src>`）
- [x] `<script type="application/json" id="report-json">` 嵌入 fact，安全转义 `</script>`
- [x] JS 通用 KV 渲染 + 特殊字段标签：status 状态色 / risk level 色 / symptom_type / root_cause_category / gate / hook
- [x] 响应式 metrics grid、phase card 时间线、artifacts 分类展示、原始 JSON 折叠展开
- [x] 端到端测试通过（HTML 结构、内嵌 JSON、无外部依赖均验证）

---

### Task 5.4：实现 `upload_report` MCP 工具 ✅

- [x] 创建 `mcp-servers/knowledge-mcp-server/src/tools/upload-report.ts`
- [x] **不引入 `@aws-sdk/client-s3` 依赖**（避免几百 MB 依赖膨胀）——**自实现 minimal S3 PutObject + AWS SigV4**（Node 内置 `crypto`）
- [x] 从 SoT `s3_issue_analysis` 段读凭据（含自包含 YAML parser，含 BOM 剥离）
- [x] ISO 周计算（正确处理年末跨年）
- [x] 路径：`s3://{bucket}/issueAnalysis/{year}/w{week:02d}/{report_id}-report-v1.html`
- [x] 支持 `year` / `week` / `bucket_override` 参数覆盖
- [x] 完整错误处理（缺凭据 / 网络错误 / HTTP 非 2xx / 文件不存在）
- [x] 在 `src/index.ts` 注册为 `upload_report` MCP 工具

---

### Task 5.5：在 skill 中集成报告生成 completion rule ✅

- [x] `whaletv-bug-analysis/SKILL.md` 追加 "Completion Rule（v3 治理层）" 章节：调 `generate_report` 参数示例 + 枚举必填规则 + Issue 状态感知（已解决/已关闭跳过、已分析要 GATE 确认）
- [x] `whaletv-pr-cr/SKILL.md` 追加 "Completion Rule" 章节：9 phase 完整对应 + `final_status` 推断规则 + artifacts 4 种类型 + 不阻塞工作流约束

---

### Task 5.6：Rebuild knowledge-mcp-server ✅

- [x] `package.json` 版本 v1.0.2 → **v1.1.0**（新增 2 个工具）
- [x] description 更新："v1.1.0 adds generate_report / upload_report (governance layer, SigV4 zero-dep S3 upload)"
- [x] `index.ts` server version 也升到 v1.1.0，启动 banner 提示新工具
- [x] `npm run build` 通过，dist 就绪：`generate-report.js` (4.6KB) + `report-schema.js` (7.5KB) + `report-template.js` (15KB) + `upload-report.js` (9.4KB)
- [x] 端到端集成测试通过（31/31）
- [ ] （可选）npm publish 到 @kk-irving 命名空间 — v3 发布时统一做

---

## 🟡 P2：跨终端 CLI 工具（需求 6）✅ 已完成

### Task 6.1：实现 `bin/gerrit-show` ✅

- [x] 创建 `scripts/gerrit-show.mjs`（Node.js ESM，通过 whaletv-credentials 读 SoT）
- [x] 支持 `<change-id>`（默认 diff）/ `-s`（files）/ `-m`（meta metadata）/ `--revision <n>`
- [x] GET `/changes/<id>/detail`、`/revisions/*/files`、`/revisions/*/patch`（base64 decode）
- [x] 输出到 stdout，可管道到 less / patch / jq
- [x] 支持 3 种 change-id 格式（数字 / Change-Id / project~branch~Change-Id）
- [x] 创建 `bin/gerrit-show` + `.cmd`

---

### Task 6.2：实现 `bin/gerrit-api` ✅

- [x] 创建 `scripts/gerrit-api.mjs`
- [x] 通用 REST 客户端：`<path> [-d <json>] [-X METHOD] [--debug]`
- [x] 支持 `-d @file.json` 从文件读 body
- [x] 按认证模式自动决定 /a/ 前缀（session 走 non-/a/、basic 走 /a/）
- [x] 剥离 XSSI 前缀 `)]}'`
- [x] 支持 GET/POST/PUT/DELETE，pretty-print JSON 输出
- [x] 401 时给出针对性诊断（session mode 建议 refresh-auth）
- [x] 创建 `bin/gerrit-api` + `.cmd`
- [x] **31/31 pure function 单元测试通过**（参数解析、SoT 读取、认证决策、URL 注入、错误诊断）

---

### Task 6.3：deploy.mjs 部署 bin ✅

deploy.mjs 从 v3 Task 2.x 建立时就自动通过 PATH 管理 `<repo>/bin/`，本 task 无需追加改动。

- [x] deploy.mjs 的 PATH 管理已把 `<repo>/bin/` 加入用户 PATH（marker block 幂等 + 迁移检测）
- [x] `bin/` 已含 5 个包装器：`whaletv-credentials` / `.cmd` + `gerrit-api` / `.cmd` + `gerrit-show` / `.cmd`

---

### Task 6.4：README 新增 CLI 工具章节 ✅

- [x] README.md 新增 `## CLI 工具（跨终端，v3 新增）` 章节
- [x] 3 个工具（whaletv-credentials / gerrit-api / gerrit-show）分节展示用法 + 示例 + 特性
- [x] 每个工具列出完整命令 + 典型 use case（如 `whaletv-credentials check && echo OK`、`gerrit-show 12345 -m | jq -r .subject`）

---

## 🟡 P2：Prerequisites 与 README 完善（需求 7）✅ 已完成

### Task 7.1：README Prerequisites 章节 ✅

- [x] "前置条件" 章节大幅扩展：**必需依赖表格**（Kiro / Node ≥ 22.5 / 网络 / 磁盘 5GB）+ **可选依赖表格**（unar / 7z / unrar / pdftotext / tshark，含 Windows/Linux/macOS 各自安装命令）
- [x] 明确"无 sudo，不修改系统"，安装范围只在 `~/.kiro/` / `~/.ai/` / 仓库目录内

---

### Task 7.2：README Troubleshooting 章节 ✅

- [x] 新增独立 `## Troubleshooting（常见问题）` 章节，覆盖 6 大类：
  1. **部署与环境**：Node 版本 / Kiro 运行检测 / SoT 权限 / PowerShell ExecutionPolicy
  2. **MCP Server 启动**：manual 测试 npx / mcp.json 语法检查 / SoT loader 未生效诊断
  3. **认证**：Gerrit 401 / Confluence 302/403 / auth_mode=missing 分别对症
  4. **Kiro Power namespace**：v3 sot-loader 天然兼容
  5. **Zmind & 附件**：WAF 限速降烈度 / RAR 解压三档降级
  6. **Knowledge MCP**：模型下载慢用镜像 / node:sqlite 需要 22.5 / AOSP 索引磁盘管理
  7. **CLI 工具**：PATH 未生效 / 缺凭据 / 网络诊断

---

### Task 7.3：v2 → v3 迁移路径章节 ✅

- [x] Prerequisites 章节之后紧跟 **v2 → v3 迁移路径** 小节
- [x] 4 步命令展示（`git pull` → `deploy.mjs` → `credentials migrate` → `check` → 重启 Kiro）
- [x] 详细的**变化清单表格**（Hook / 凭据 / Workflow / Steering / 部署 / CLI / MCP 7 个维度前后对比）
- [x] 提供**回滚路径**（`.kiro.backup-<ts>/` 有 v2 快照，v3 不删 mcp.json）

---

### Task 7.4：POWER.md 版本号与摘要更新 ✅（合并到 Task 4.5 完成）

- [x] POWER.md 顶部版本号 v2 → v3
- [x] "v3 核心升级" 章节列出 4 项主要变化（hook 修复 / SoT / deploy.mjs / skill 重构）
- [x] "v2 已有能力" 章节保留（Gerrit 双通道 / RAR5 / WAF / knowledge-mcp）

---

## 🟡 P2：Codebase 分类知识（需求 8）✅ 已完成

### Task 8.1：确认 WhaleTV 架构分类方式 ✅

- [x] 分析 `steering/module-path-map.md` 现有内容，识别已隐含的 taxonomy 信息（三平台业务代码位置不同、客户定制机制不同、ODM 命名不同、kernel 版本差异）
- [x] 与 AEF `codebase_diff_map.md` 的 Category A/B 分类做对照
- [x] 结论：WhaleTV **不是按"是否 Hook 架构"分类**（三平台都是 Hook 架构 + 少量 AOSP 直改），而是**按平台/芯片方案/产品线**分类（D4 / X5 / STB）
- [x] 因此 taxonomy 的合理定位是"平台差异速查表"，与 module-path-map 互补：taxonomy = "决定用哪种策略"、module-path-map = "决定搜到哪个具体路径前缀"

---

### Task 8.2：创建 `steering/codebase-taxonomy.md` ✅

- [x] 创建 `steering/codebase-taxonomy.md`（`inclusion: auto`，跟 module-path-map 同级别加载）
- [x] **目的与定位** 章节：明确跟 module-path-map / local-code-guide skill 的分工
- [x] **三平台分类矩阵**：D4 / X5 / STB × 10 个维度（OpenGrok 项目名、业务代码根、Framework Hook 位置、客户定制机制、ODM 命名、customer 顶层、common 顶层、SDK/kernel 版本等）
- [x] **架构模式识别**：三平台共性（都是 Hook 架构）+ 差异（业务代码根命名 `zeasn/` vs `whale/`）
- [x] **搜索策略决策树**：从"拿到 issue"到"限定 git grep 路径"的完整决策链
- [x] **客户定制机制细节**：D4（每客户独立子目录）/ X5（统一 customer/）/ STB（无 customer 子目录，靠 git branch 隔离）
- [x] **Patch / Cherry-Pick 策略差异**：跨客户改动、跨平台改动的应对
- [x] **与 skill / MCP 工具的联动表**：明确 whaletv-local-code / whaletv-bug-analysis / whaletv-pr-cr / whaletv-cherry-pick / analyze_issue / search_aosp 各自如何用本表
- [x] **与 AEF codebase_diff_map.md 的对照**：说明为什么 WhaleTV 不套用 Category A/B 分类
- [x] **待补充 TODO**：留 5 项 v3.1 团队可以后续 verify 补充的字段（kernel 版本清单、AOSP 主版本等）

---

## ⚪ P3：Zmind Hub 架构调研（需求 9）✅ 已完成

### Task 9.1：撰写 Zmind Hub 设计文档 ✅

- [x] 创建 `.kiro/specs/v3-platform-upgrade/zmind-hub-design.md`
- [x] **问题背景**：v3 现状痛点（分散 API Key / WAF 限速 / 附件 URL 需 key / 无中心化统计）
- [x] **参考 AEF Zmind Hub 生产验证的架构**：本地 stdio 保写 + remote http hub 独占 `get_issue`
- [x] **组件划分图**：清晰列出本地 whale-zmind 与 remote whale-zmind-hub 各自的工具集
- [x] **分阶段迁移策略**：A（用起 _meta.email）→ B（v3.1 部署 hub MVP）→ C（v3.2 附件 URL 签名）→ D（v4 全 hub 化）
- [x] **mcp.json + SoT 配置模板** + **sot-loader 改动预览**
- [x] **Trade-offs 表**：4 种方案对比（含"完全不引入 Hub"）
- [x] **触发升级信号**：明确 5 种情况下才启动 v3.1 hub 项目
- [x] **不做的理由（现在）**：v3 SoT + generate_report 已经解决大部分痛点；AEF hub 已有，可以等对方开放
- [x] **与 AEF 团队协作路径**：联合部署 / 代码贡献 / API 联邦

---

## v3 发布 Checklist

### 代码质量

- [ ] 所有新增脚本能通过 `node --check` 语法检查
- [ ] 所有 MCP server 重新 build，dist/ 无 error
- [ ] `.gitignore` 更新（排除 backup 目录、SoT 备份文件）

### 集成测试

- [ ] `node scripts/deploy.mjs` 在干净环境上一次成功
- [ ] Kiro 加载后能识别所有 7 个 hook
- [ ] MCP server 从 SoT 读凭据正常启动
- [ ] MCP server 从 env 回退启动正常
- [ ] CLI 工具 `gerrit-show <id>` 在终端可用
- [ ] `generate_report` + `upload_report` 端到端成功

### 文档

- [ ] POWER.md 反映 v3 状态
- [ ] README.md 有 Prerequisites / Troubleshooting / 迁移路径
- [ ] 所有 SKILL.md 有 YAML front-matter

### 发布

- [ ] git commit + tag `v3.0.0`
- [ ] npm publish（knowledge-mcp-server 版本 bump 到 v1.1.0）
- [ ] 团队通知模板准备好
