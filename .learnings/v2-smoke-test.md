# whaletv-dev-power v2 Smoke Test 操作手册

> 在发布 v2 之前的最后一道验收关。按本手册逐项跑通后再做 P3（部署脚本 + npm publish）。

## 测试环境前置

- **Windows 10/11** 或 **Linux/macOS**（推荐两种平台都跑一遍）
- **Node.js ≥ 22.5.0**（knowledge-mcp 用 `node:sqlite` 内置模块，22.5 才有）
- **网络**：能访问 `whale-gerrit.zeasn.com` / `zmind.whaletv.com` / `docs.whaletv.com`
- **磁盘**：≥ 5 GB（含模型 + 索引数据库 + AOSP 源码可选）
- **可选**：unar / 7z（RAR5 解压验收）；AOSP 工作树（P2 索引验收）

## 本地调试模式启动 MCP Server

仓库根的 `mcp.json` 模板用 `npx @kk-irving/...@latest`，但 confluence-mcp 与 knowledge-mcp **尚未 npm publish**。smoke test 期间用**本地 dist 路径**启动，发布后再切回 npx。

把 `~/.kiro/settings/mcp.json` 中的 server 条目改成：

```jsonc
{
  "mcpServers": {
    "gerrit-mcp-server": {
      "command": "node",
      "args": ["E:/POWERS/whaletv-dev-power/mcp-servers/gerrit-mcp-server/dist/index.js"],
      "env": { ... }
    },
    "zmind-mcp-server": {
      "command": "node",
      "args": ["E:/POWERS/whaletv-dev-power/mcp-servers/zmind-mcp-server/dist/index.js"],
      "env": { ... }
    },
    "confluence-mcp-server": {
      "command": "node",
      "args": ["E:/POWERS/whaletv-dev-power/mcp-servers/confluence-mcp-server/dist/index.js"],
      "env": { ... }
    },
    "knowledge-mcp-server": {
      "command": "node",
      "args": ["E:/POWERS/whaletv-dev-power/mcp-servers/knowledge-mcp-server/dist/index.js"],
      "env": { ... }
    }
  }
}
```

重启 Kiro 让 MCP server 用新二进制启动。

---

## 第一步：跑凭据自动刷新脚本（P0+ 验收）

### 命令

```powershell
# Windows
PowerShell -ExecutionPolicy Bypass -File scripts\refresh-auth.ps1
```

```bash
# Linux / macOS
bash scripts/refresh-auth.sh
```

### 预期

1. 提示输入 SSO 用户名（输入 `winn.wei`）
2. 提示输入 SSO 密码（输入时不回显）
3. stderr 出现：
   ```
   [refresh-auth] 开始刷新 Gerrit + Confluence 会话凭据 (mcp.json: ...)
   [refresh-auth] 登录 Gerrit (https://whale-gerrit.zeasn.com) ...
   [refresh-auth]   ✓ Gerrit cookie OK (X 项)
   [refresh-auth] 登录文档中心 (https://docs.whaletv.com) ...
   [refresh-auth]   ✓ 文档中心 cookie OK (X 项)
   [refresh-auth]   ✓ Gerrit /changes/ 自检通过 (HTTP 200)
   [refresh-auth] ✓ 完成。已更新 ~/.kiro/settings/mcp.json
   ```
4. `~/.kiro/settings/mcp.json` 备份为 `*.bak.<timestamp>`，新文件含：
   - `mcpServers.gerrit-mcp-server.env.GERRIT_AUTH_HEADER` = `"Basic ..."`
   - `mcpServers.gerrit-mcp-server.env.GERRIT_COOKIE` = `"GerritAccount=...; XSRF_TOKEN=..."`
   - `mcpServers.confluence-mcp-server.env.CONFLUENCE_COOKIE` = `"JSESSIONID=...; ..."`

### 失败排查

| 退出码 | 含义 | 处理 |
|---|---|---|
| 1 | 用户输入失败 | 重新跑并完整输入 |
| 2 | 浏览器登录失败 | 检查 stderr：密码错 / SSO 超时 / MFA 检测 |
| 3 | mcp.json 写入失败 | 检查 `~/.kiro/settings/` 权限，原文件已备份 |
| 4 | 自检失败 | 检查 GERRIT_URL；浏览器手动登录确认账户能 200 |

---

## 第二步：Gerrit 双通道认证 smoke test（P0-A 验收）

重启 Kiro 让 gerrit-mcp v1.1.0 加载新 env。

### 测试 1: 启动 banner

打开 Kiro 的 MCP 输出窗口，应看到：
```
[gerrit-mcp-server v1.1.0 REST] started (auth_mode=session), awaiting MCP requests on stdio
```

`auth_mode=session` 表示 P0+ 脚本写入的凭据被识别。
- IF `auth_mode=basic` → 说明 cookie 没写入，但 USERNAME+HTTP_PASSWORD 在 fallback；不影响功能但失去 P0-A 升级目的
- IF `auth_mode=missing` → 说明所有凭据都没配；回到第一步

### 测试 2: 调用核心 5 读工具

让 Kiro 执行（自然语言）：

```
用 search_changes 工具查询最近 3 个 owner=winn.wei 的 change
```

预期：返回 3 条 JSON 命中，含 _number / project / subject / status。

```
用 query_change 工具查询 change_id 为 <最新 PR 的 Change-Id>
```

预期：返回完整 change 详情，含 owner、当前 patch set、Zmind#ID。

```
用 list_branches 工具列出 amlogic_kernel 项目的所有分支
```

预期：返回分支数组。

```
用 get_change_comments 工具获取该 change 的全部评论
```

预期：返回 comments 数组，含 uuid。

```
用 get_unresolved_threads 工具找出该 change 未解决的 thread
```

预期：返回 unresolved thread 列表，每条含 root_uuid。

### 失败排查

| 错误 | 排查 |
|---|---|
| `auth_failed` (401) + `cookie 已过期` | 跑 `scripts/refresh-auth.*` 重新抓 |
| `auth_failed` (401) + `HTTP_PASSWORD 错误` | 当前是 basic 模式；登录密码错或 HTTP Cred 错 |
| `network_error` | 检查 GERRIT_URL，VPN，DNS |
| `request_timeout` | 调大 GERRIT_TIMEOUT_MS |

---

## 第三步：Zmind 解压增强 + WAF 重试 smoke test（P0-B / P0-C 验收）

### 测试 1: 启动 banner

```
[zmind-mcp-server v2.1.1] started — RAR5 ready, WAF retry on (min_interval=0ms, concurrency=2, waf_retry_codes=[403,429,502,503], waf_retry_max_attempts=5)
```

### 测试 2: 准备 issue workspace（普通附件）

让 Kiro 执行：
```
用 prepare_issue_workspace 准备 issue <一个有附件的 PR ID> 的工作目录
```

预期：
- 在 cwd 下创建 `.workspace/issue-<id>/`
- 含 `attachments/` 子目录，附件已下载
- 含 `extracted/` 子目录，zip / tar.gz 已自动解压
- 写入 `README.md` 索引附件清单
- 返回 JSON 含每个附件的 kind / hint

### 测试 3: RAR5 解压（如能找到 .rar 附件）

找一个含 .rar 的 PR（QA 上传的 log 包多见 RAR5）：

```
用 prepare_issue_workspace 准备 issue <含 RAR 附件的 PR ID> 的工作目录
```

预期：
- attachments/<file>.rar 落盘成功
- extracted/<stem>/ 含解压结果（**至少 1 个非 0 字节文件**）
- attachments/<file>.rar.extracted_ok stamp 文件存在
- 返回 JSON 中该附件的 hint 包含 "RAR/7z 已自动解压"

如果系统没装 unar / 7z，预期：
- hint 提示 "本机未检测到 unar / 7z..."
- 不阻塞其他附件处理
- 整个工具调用仍返回 200

### 测试 4: WAF 重试（构造场景）

连续快速触发多个 download_attachment 调用：

```
用 prepare_issue_workspace 准备 5 个不同的大附件 PR（连续）
```

预期：
- 即使中间触发 WAF 403/429，也会自动 retry（每次新连接）
- 最终所有附件下载成功（除非 5 次都失败）
- 失败的附件会进 `failed_attachments` 列表，**不阻塞其他附件**

观察 stderr 是否有重试日志（虽然代码没显式打 log，但能从耗时变化看出）。

### 失败排查

| 现象 | 处理 |
|---|---|
| RAR 解压全失败 | 检查 unar/7z 是否在 PATH；Windows: `choco install unar 7zip`；Linux: `apt install unar p7zip-full`；macOS: `brew install unar p7zip` |
| 解压成功但 0 字节 | 这是 v2.1 修复的旧 p7zip RAR5 bug；如果还出现，检查解压器版本 |
| WAF 403 不恢复 | 排查是否真的 WAF 触发还是其他 403（权限）；后者无法 retry |

---

## 第四步：Confluence 文档中心 smoke test（P1-A/B 验收）

### 测试 1: 启动 banner

```
[confluence-mcp-server v1.0.0] started (cookie_set, base=https://docs.whaletv.com, delay=150ms)
```

`cookie_set` 表示 P0+ 脚本已写入 cookie。

### 测试 2: list_spaces

```
用 list_spaces 列出全部 Confluence 空间
```

预期：返回 spaces 数组，每条含 key / name；total ≥ 5（公司常见配置）。

### 测试 3: search_confluence

```
用 search_confluence 在所有空间搜索 "TvSettings"，返回 5 条
```

预期：5 条命中页面，含 id / title / url / snippet（HTML 已转纯文本）/ space。

### 测试 4: get_page

```
用 get_page 取上一步任一命中的 page_id 的完整内容
```

预期：返回 title / url / space / version / updated / body_text（≤ 8000 字）/ body_truncated。

### 失败排查

| 现象 | 处理 |
|---|---|
| `auth_failed` + `302 → /login.action` | cookie 过期；跑 `scripts/refresh-auth.*` 重新抓 |
| `not_found` | page_id 错或权限不够 |
| 返回空白或 HTML 残留 | 报告给我，可能是 stripHtml 边界情况 |

---

## 第五步：Knowledge 知识库 smoke test（P1-C/D/E 验收）

### 测试 1: 启动 banner

```
[knowledge-mcp-server v1.0.1] started — db=./data/knowledge.db, model=Xenova/bge-small-zh-v1.5 (dim=512, threads=2)
```

### 测试 2: sync_zmind 小批量

```
用 sync_zmind 拉取 100 条最新 Zmind issue
```

预期：返回 `{ source: "zmind", fetched: 100, upserted: 100, watermark: "2026-..." }`，本地 `./data/knowledge.db` 文件出现，约几 MB。

### 测试 3: sync_gerrit 小批量

```
用 sync_gerrit 拉取最近 100 条 changes
```

预期：fetched=100。

### 测试 4: sync_confluence 单空间

```
用 sync_confluence 同步 TVENG 空间最多 100 页
```

预期：fetched ≥ 1。

### 测试 5: embed_pending（首次会下模型）

```
用 embed_pending 处理 zmind source 200 条
```

**首次启动会下载 BGE-small-zh-v1.5 ONNX 模型（~80MB）到 ./data/models/，需要 1-3 分钟**。耐心等。

预期：返回 `{ source: "zmind", embedded: 100, total_pending: 100 }`（视上一步 sync 数）。

后续 `embed_pending` 调用瞬间完成（模型已加载）。

```
用 embed_pending 处理 gerrit source 200 条
用 embed_pending 处理 confluence source 200 条
```

### 测试 6: search_local 三模式

```
用 search_local 在 zmind source 上搜索 "tvsettings 闪退"，hybrid 模式，返回 5 条
```

预期：5 条命中，每条带 score / match (vector|fts|both) / snippet / status / project / updated。响应时间 < 500ms。

```
用 search_local 跨源搜索 "蓝牙连接异常"，all 模式，每源 3 条
```

预期：返回 `{ zmind: [...], gerrit: [...], confluence: [...] }`，每源 0-3 条。

### 测试 7: get_indexed

```
用 get_indexed 取 zmind id=<上一步任一命中的 id> 的完整数据
```

预期：返回完整 issue 字段（不含 embedding）。

### 失败排查

| 现象 | 处理 |
|---|---|
| 模型下载失败 / 超时 | 设环境变量 `PLAYWRIGHT_DOWNLOAD_HOST` 镜像；或手动下到 ./data/models/ |
| sync_gerrit 401 | 跟 gerrit smoke test 一样，跑刷新脚本 |
| search_local 太慢 | 看索引行数；> 10w 行后第一次加载 matrix 慢，后续快 |

---

## 第六步：AOSP 模块级精搜 smoke test（P2-A 验收）

> 这一步**需要 AOSP 工作树**才能跑。如果你机器上有 D4/X5/STB 的 repo 工作树，按下面跑；否则跳过这一步。

### 测试 1: list_aosp_modules

```
用 list_aosp_modules 列出 X5 平台的全部模块
```

预期：返回 X5 平台 module-path-map 中登记的所有模块（来自 `steering/module-path-map.md`）。

### 测试 2: index_aosp_module

```
用 index_aosp_module 索引 X5 平台 tvsystemui 模块（module_path=vendor/whale/...，repo_root=<你的 X5 repo 根>）
```

预期：返回 `{ files_scanned, files_indexed, chunks_inserted, ... }`，chunks_inserted 通常几百到几千。

### 测试 3: embed_aosp_pending

```
用 embed_aosp_pending 处理 X5 tvsystemui 模块 200 条
```

预期：embedded=200，remaining 减少。可分批多次跑直到 remaining=0。

### 测试 4: search_aosp

```
用 search_aosp 在 X5 tvsystemui 上搜索 "wifi 设置入口"，hybrid，返回 5 条
```

预期：5 条命中，含 file_path / line_start-line_end / symbol_kind / symbol_name / snippet。

### 测试 5: clear_aosp_index

```
用 clear_aosp_index 清空 X5 tvsystemui 索引
```

预期：返回 `{ cleared: <number>, scope: "platform=X5, module=tvsystemui" }`。

---

## 第七步：analyze_issue 端到端工作流（P2-B 验收）

### 测试 1: 不带 AOSP

```
用 analyze_issue 分析 issue <一个真实 PR ID>，include_aosp=false
```

预期：
- 在 cwd 下生成 `.workspace/issue-<id>/analysis-context.md`
- 返回 JSON 含：issue 概要 / keywords / inferred_platform / inferred_modules / similar (zmind/gerrit/confluence) / aosp_hits=空 / context_md_path / errors=空
- analysis-context.md 结构化展示三源命中 + 推荐动作

### 测试 2: 含 AOSP（前置条件：先跑 P2-A 索引完模块）

```
用 analyze_issue 分析 issue <带平台/模块特征的 PR ID>，include_aosp=true，platform=X5
```

预期：
- 同上，加上 aosp_hits 数组（命中代码片段）
- analysis-context.md 多一段 "## AOSP 代码（模块级精搜）"

### 测试 3: best-effort 失败处理

故意把某些 env 清掉（如 GERRIT_AUTH_HEADER），让 search_local 部分失败：

```
用 analyze_issue 分析 issue <PR>
```

预期：
- 工具不抛异常
- errors 数组含 `{ stage: "search_local", message: "..." }`
- analysis-context.md 末尾有 "## 已知问题（运行期错误）" 段
- 其他步骤（拉 issue / 关键词 / 写 context）仍完成

---

## 验收 checklist 汇总

跑完上面所有步骤后，在此打勾：

### P0
- [ ] gerrit-mcp v1.1.0 启动 banner 显示 `auth_mode=session`
- [ ] search_changes / query_change / list_branches / get_change_comments / get_unresolved_threads 全部 200
- [ ] zmind-mcp v2.1.1 启动 banner 显示 RAR5 ready + WAF retry on
- [ ] prepare_issue_workspace 普通附件下载 + 解压成功
- [ ] prepare_issue_workspace RAR5 附件解压成功（或本机无 unar/7z 时正确降级）
- [ ] 多附件连续下载触发 WAF 时能恢复

### P0+
- [ ] refresh-auth.ps1 / .sh 一条命令 < 60s 完成
- [ ] mcp.json 自动备份 + 写入 GERRIT_AUTH_HEADER + GERRIT_COOKIE + CONFLUENCE_COOKIE
- [ ] 自检通过（自检失败时不动 mcp.json）

### P1
- [ ] confluence-mcp v1.0.0：list_spaces / search_confluence / get_page 三件套通过
- [ ] knowledge-mcp v1.0.1：sync_zmind / sync_gerrit / sync_confluence 各跑一批
- [ ] embed_pending 三源各跑完 200 条
- [ ] search_local hybrid 模式跨源命中，响应 < 500ms

### P2
- [ ] list_aosp_modules 列出 X5 模块（如有 module-path-map.md）
- [ ] index_aosp_module 一个真实模块完成
- [ ] embed_aosp_pending 跑完该模块
- [ ] search_aosp 命中精确
- [ ] analyze_issue 输出完整 context.md（不带 / 带 AOSP 各跑一次）

---

## 测试反馈

跑完后请把以下信息回复，便于决定是否进 P3：

1. 哪些测试通过 / 失败
2. 失败的具体错误信息
3. 实际响应时间（特别是 search_local 与 analyze_issue）
4. 跑的环境信息（OS / Node 版本 / 是否装了 unar/7z）
