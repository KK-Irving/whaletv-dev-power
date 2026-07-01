---
archived_at: 2026-07-01T08:26:30.637Z
archived_reason: v3 起统一用 confluence-mcp-server（3 工具） + skill whaletv-knowledge-base 的 search_local(source="confluence")
original_path: .kiro/skills/internal-docs.md
---

---
inclusion: auto
---

# Skill: 内部文档查询（Confluence）

## 目的

通过 Confluence REST API 搜索和获取 WhaleTV 内部技术文档，在分析问题时自动查找相关的已知问题、解决方案和设计规范。

## 文档系统信息

- **地址**: https://docs.whaletv.com/
- **平台**: Atlassian Confluence 6.9.0（运行在 Apache Tomcat 8.0.51 上）
- **认证方式**: HTTP Basic Auth

## 用户需提供的配置

| 配置项 | UI 显示 | 说明 |
|--------|---------|------|
| Confluence 用户名 | 用户名 | 公司账号（注意大小写） |
| Confluence 密码 | 密码 | 公司密码 |

> 注意：用户名区分大小写（如 `Winn.Wei` 而非 `winn.wei`）

## 连接验证

```bash
# PowerShell
$cred = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("<用户名>:<密码>"))
$headers = @{ Authorization = "Basic $cred" }
Invoke-WebRequest -Uri "https://docs.whaletv.com/rest/api/content?limit=1" -Headers $headers -UseBasicParsing
```

预期返回 JSON 格式的内容列表。如果返回 401 说明认证失败。

## API 调用方式

所有请求需要携带 Basic Auth 头：
```
Authorization: Basic <base64(用户名:密码)>
```

## 搜索内容（核心功能）

### CQL 搜索

```
GET /rest/api/content/search?cql=text~"<关键词>"&limit=5
```

### 返回数据结构

```json
{
  "results": [
    {
      "id": "4587596",
      "type": "page",
      "status": "current",
      "title": "Pinpoint 分布式监控使用教程",
      "_expandable": {
        "container": "/rest/api/space/RDCenter",
        "body": "",
        "space": "/rest/api/space/RDCenter"
      },
      "_links": {
        "self": "https://docs.whaletv.com/rest/api/content/4587596",
        "webui": "/pages/viewpage.action?pageId=4587596"
      }
    }
  ],
  "start": 0,
  "limit": 3,
  "size": 3,
  "_links": {
    "base": "https://docs.whaletv.com",
    "next": "/rest/api/content/search?limit=3&start=3&cql=text~%22OTA%22"
  }
}
```

### 结果类型

- `"type": "page"` — 文档页面
- `"type": "attachment"` — 附件文件（PDF、Excel 等）

### 获取页面正文

```
GET /rest/api/content/<page_id>?expand=body.view
```

## 搜索策略

### 场景 1：Bug 分析时查文档

搜索关键词策略：
- 异常类名（如 `text~"NullPointerException TvScanConfig"`）
- 模块名 + "已知问题"（如 `text~"DTV 已知问题"`）
- 错误码（如 `text~"ERROR_CODE_1234"`）

### 场景 2：PR/CR 处理时查规范

搜索关键词策略：
- 模块名 + "设计文档"（如 `text~"TvInput 设计文档"`）
- 接口名 + "规范"（如 `text~"ScanManager 接口规范"`）

### 场景 3：用户主动查询

用户直接要求查文档时：
```
用户: "查一下文档里有没有关于 OTA 升级的说明"
AI: 搜索 CQL: text~"OTA 升级"
```

## 结果展示格式

### 查到相关文档时

```
📄 找到相关内部文档：

1. Pinpoint 分布式监控使用教程
   链接: https://docs.whaletv.com/pages/viewpage.action?pageId=4587596
   空间: RDCenter

2. OTA检查流程优化.pdf [附件]
   链接: https://docs.whaletv.com/pages/viewpage.action?pageId=82973869

建议参考以上文档中的相关内容。
```

### 未查到时

```
📄 内部文档中未找到与 "关键词" 相关的内容。
```

## 链接构造规则

- 页面链接: `https://docs.whaletv.com/pages/viewpage.action?pageId=<id>`
- 附件链接: 使用返回的 `_links.webui` 字段拼接 base URL
- 完整 URL: `https://docs.whaletv.com` + `_links.webui`

## 关键约束

- 不要在输出中暴露 Confluence 密码
- 搜索结果最多展示 5 条最相关的
- 优先展示 `type: "page"` 的结果，附件次之
- 如果认证失败，提示用户检查用户名密码（注意大小写）
- 文档查询是辅助手段，不阻塞主工作流
- 返回的标题可能包含 UTF-8 编码的中文，需正确解码显示
