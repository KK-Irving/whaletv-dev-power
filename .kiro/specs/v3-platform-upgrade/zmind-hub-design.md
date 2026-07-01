# Zmind Hub 架构调研（v3.1+ 演进方向）

> **状态**：仅规划，v3.0 不实施。用作未来 v4 起点参考。
> **触发条件**：当团队规模 >30 人 或 Zmind WAF 限速反复触发 或 有中心化调用统计诉求。

## 1. 问题背景

### 1.1 现状（v3）痛点

v3 及之前的架构中，每个开发者的 `zmind-mcp-server` **直接用自己的 API Key 打 Zmind (Redmine)**：

- 每个 RD 一份 API Key，分散管理
- 每次 `get_issue` 都打 live API，5 分钟内同一 issue 可能被拉多次
- Aliyun WAF 按客户端 IP 限速；团队规模上升后触发 429/403 概率增加
- 附件下载**必须**带 `X-Redmine-API-Key`，链接分享后接收方也需要 key
- 中心化调用统计不可能（每个进程独立）

### 1.2 参考：AEF Zmind Hub 设计

`agentengineeringframework` 项目已在生产验证的 hub 架构：

```
本地 whale-zmind (stdio MCP)     ─┐
├─ my_issues                     ├─→ Zmind Redmine
├─ search_issues                 ┘
├─ update_issue, add_comment
├─ get_project_members
└─ ...（写操作 + 列表操作）

Remote whale-zmind-hub            ─→ (Hub 服务) ─→ Zmind Redmine
                                      ↓ 缓存
└─ get_issue（唯一入口）              ↓ 签名附件 URL
                                      ↓ per-user rate limit
                                      ↓ /stats top_callers
```

**关键设计**：
- Hub **独占 `get_issue`**：MCP 工具名不重叠，agent 无路由决策成本
- Hub 是 streamable-http（不是 stdio）：走标准 HTTPS，可以部署在公司 VPN 内的中心服务
- 请求头 `X-Hub-Client-Id: <user_email>` 用于归因
- Hub 内部持 **一份团队级 API Key**（不下发到用户端）
- 附件 URL **HMAC 签名**，客户端拿到后直接 GET（无需 API Key）
- 缓存策略：热 issue 5-10 分钟 TTL，写操作立即失效缓存
- Per-user rate limit：按 `X-Hub-Client-Id` 分桶（避免个人限速影响他人）

## 2. WhaleTV v3.1+ 演进方案

### 2.1 组件划分

```
┌───────────────────────────────────┐
│ whale-zmind (local stdio, 现有)    │
│  ├─ my_issues                     │
│  ├─ search_issues                 │
│  ├─ update_issue                  │
│  ├─ add_comment                   │
│  ├─ create_time_entry             │
│  ├─ list_projects                 │
│  ├─ get_project_members           │
│  ├─ get_versions                  │
│  ├─ get_priorities                │
│  ├─ get_issue_statuses            │
│  ├─ get_trackers                  │
│  ├─ prepare_issue_workspace       │  ← 附件路由，暂留本地（涉及本地文件系统）
│  └─ create_issue                  │
└───────────────────────────────────┘

┌───────────────────────────────────┐
│ whale-zmind-hub (remote http)     │
│  └─ get_issue                     │  ← 唯一进入 Hub 的工具
└───────────────────────────────────┘
              ↓ (Hub 内部)
┌───────────────────────────────────┐
│  Cache (Redis / in-memory)        │
│  ↓                                │
│  Rate limiter (per user)          │
│  ↓                                │
│  Attachment URL signer (HMAC)     │
│  ↓                                │
│  Zmind Redmine API                │
└───────────────────────────────────┘
```

### 2.2 迁移策略（分阶段）

**阶段 A（可以现在做）**：把 SoT 的 `_meta.email` 字段用起来
- 已在 v3 `whaletv-credentials init` 里收集
- Hub 上线后，`zmind-mcp-server` 添加 `X-Hub-Client-Id` header 支持
- 老用户不设 email 时不影响使用（走 IP-based rate limit）

**阶段 B（v3.1）**：部署 Hub MVP
- 一个内部服务：`https://zmind-hub.whaletv.zeasn.com`（假设）
- 实现 `/mcp/get_issue`（streamable-http endpoint）
- 内部持团队 API Key
- 简单内存缓存（5min TTL）
- Per-user rate limit（10 req/min per email）
- 无签名附件：先不改附件 URL，客户端拿到 `attachment.token` 后仍从 Zmind 直取

**阶段 C（v3.2）**：附件 URL 签名
- Hub 在 get_issue 响应里把 attachment URL 换成 `https://zmind-hub.../attach/<hmac-signed-token>`
- 客户端 GET 该 URL → Hub 用团队 API Key 代拉附件回传
- 附件 URL 分享给同事也能直接下载（HMAC 有 1h 有效期）

**阶段 D（v4）**：全 hub 化
- 逐步把 my_issues / search_issues 也搬到 hub（读密集）
- 写操作（update_issue / add_comment / create_time_entry）仍在本地（写要求实时）

### 2.3 mcp.json / SoT 配置模板

```json5
// mcp.json（用户端）
{
  "mcpServers": {
    "zmind-mcp-server": {
      "command": "npx",
      "args": ["-y", "@kk-irving/zmind-mcp-server@latest"]
      // env 由 sot-loader 从 SoT 注入
    },
    "zmind-hub": {
      "url": "https://zmind-hub.whaletv.zeasn.com/mcp",
      "headers": {
        // 由 sot-loader 从 SoT 注入 _meta.email
        "X-Hub-Client-Id": "<user@whaletv.com>"
      }
    }
  }
}
```

Hub 相关的 SoT 字段（新增）：

```yaml
# ~/.ai/whaletv.yaml
_meta:
  email: user@whaletv.com

zmind_hub:
  enabled: true
  url: https://zmind-hub.whaletv.zeasn.com
```

sot-loader 需要在 v3.1 加：
- `X-Hub-Client-Id` header 从 `_meta.email` 注入到 `zmind-hub` server 的 headers

### 2.4 sot-loader 改动预览

```typescript
// mcp-servers/*/src/sot-loader.ts 新增映射：
// _meta.email → ZMIND_HUB_CLIENT_ID env（zmind-mcp-server 用这个决定要不要走 hub）
```

## 3. Trade-offs 分析

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A. 完全不引入 Hub（保持 v3）** | 简单；无额外基础设施 | WAF 反复触发；无中心化统计；分散 API Key |
| **B. Hub 只做 get_issue 缓存** | MVP 快；核心痛点解决 | 只覆盖读密集场景；附件仍需 key |
| **C. Hub 全接管读操作** | 中心化归因；缓存收益最大化；附件 URL 签名 | 单点故障风险；需要高可用 Hub |
| **D. AEF 直接搬**（whale-zmind + whale-zmind-hub 并存） | 生产验证；架构成熟 | 有 AEF 依赖，短期难以脱离 AEF 团队 |

**推荐路径**：v3.1 走 **B → C** 渐进，避免一次性引入太多复杂性。**D** 是评估项，先看 AEF 团队是否愿意共享 hub 代码或开放 whitelist。

## 4. 实施前置条件

在启动 Hub 项目前，需要确认：

- [ ] 团队规模是否达到 30+（衡量：过去 30 天有多少个不同 IP 打 Zmind）
- [ ] WAF 触发频率（>1 次/周 → 值得做 hub）
- [ ] 内部 K8s / VPS 资源可申请
- [ ] 团队愿意共享一个 API Key（安全审查通过）
- [ ] Zmind DBA 是否有中心化审计需求

## 5. 与 AEF 团队协作

如果两个团队各自维护 hub 会重复投资。可以：

- **联合部署**：两团队共用一份 Hub，通过 `X-Hub-Client-Id` 域名区分（`user@whaletv.com` vs `user@zeasn.com`）
- **代码贡献**：把 AEF 的 whale-zmind-hub Python 实现开源到内部 GitLab，两团队都基于此维护
- **API 联邦**：各自 hub，通过统一的 Prometheus/Grafana 看盘做治理

## 6. 不做的理由（现在）

即使团队规模到位，短期不做 hub 也是合理的：

1. **v3 单一凭据源 SoT + generate_report 治理层**已经解决大部分痛点：
   - SoT 统一了凭据管理（不再散落 5 处）
   - `generate_report` + S3 上传做到"按周聚合分析" —— 中心化统计已实现（就不需要 hub 内建统计）
2. **WAF 应对 v2.1.1 已经足够**（三档降级 + 重试 + 进程级速率门），大多数场景够用
3. **Hub 本身是新的服务，运维成本 > 收益**（需要监控 / 报警 / 备份）
4. **AEF 团队已有成熟 hub**，等 AEF 愿意开放时直接接入更划算

## 7. 触发升级信号

以下任一发生 → 启动 v3.1 hub 项目：

- 30 天内 Zmind WAF 触发 ≥ 5 次团队级抱怨
- 团队规模 > 30 人 且 平均每人每天 `get_issue` > 20 次
- 出现"附件 URL 分享给同事对方打不开"高频抱怨
- 团队 leader 明确要求"按人聚合的 Zmind 使用统计"
- AEF 团队主动邀请接入他们的 hub
