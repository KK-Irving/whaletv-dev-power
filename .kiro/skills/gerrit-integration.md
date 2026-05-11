---
inclusion: auto
---

# Skill: Gerrit 集成

## 目的

通过 SSH 与 WhaleTV Gerrit 系统交互，实现提交记录查询、状态检查等操作。

## Gerrit 服务信息

- **地址**: https://whale-gerrit.zeasn.com/
- **SSH 端口**: 29418
- **版本**: Gerrit 3.6.0
- **查询方式**: SSH（`ssh -p 29418 <用户名>@whale-gerrit.zeasn.com gerrit query ...`）

## 用户需提供的配置

| 配置项 | UI 显示 | 说明 |
|--------|---------|------|
| Gerrit 用户名 | 用户名 | 登录 Gerrit 的用户名 |
| Gerrit HTTP 密码 | 密码 | Settings → HTTP Credentials 生成（用于 REST API 写操作） |

> SSH 认证依赖用户本机的 SSH 密钥（需已上传到 Gerrit Settings → SSH Keys）

## 连接验证

```bash
ssh -p 29418 <用户名>@whale-gerrit.zeasn.com gerrit version
# 预期返回: gerrit version 3.6.0
```

## 查询提交记录（核心功能）

### 按 Issue ID 查询

```bash
ssh -p 29418 <用户名>@whale-gerrit.zeasn.com gerrit query "#<issue_id>" --format=JSON
```

### 返回数据结构

每行一个 JSON 对象，最后一行是统计信息（含 `"type":"stats"` 字段，需过滤）。

有效记录字段：

```json
{
  "project": "public_antv_t/platform/frameworks/base",
  "branch": "cvte_os10_master",
  "id": "Ib5c79649f9591b8f53794840327dba625dba962a",
  "number": 107014,
  "subject": "[10.2.15][feature][whaletv][Zmind#332669]Add Egyptian Arabic translations",
  "status": "MERGED",
  "url": "http://whale-gerrit.zeasn.com/c/public_antv_t/platform/frameworks/base/+/107014",
  "owner": {
    "email": "clement.ren@zeasn.com",
    "username": "clement.ren"
  },
  "commitMessage": "[10.2.15][feature][whaletv][Zmind#332669]...\n\n[what]...\n[why]...\n[how]...\n[test]...\n[impact]...",
  "createdOn": 1774331433,
  "lastUpdated": 1774332273,
  "open": false,
  "cherryPickOfChange": 107041,
  "cherryPickOfPatchSet": 1
}
```

### 统计信息（最后一行，需过滤）

```json
{"type":"stats","rowCount":131,"runTimeMilliseconds":6943,"moreChanges":false}
```

### 数据处理规则

1. 逐行解析 JSON
2. 过滤掉含 `"type":"stats"` 的行
3. 过滤掉缺少 `project`、`branch`、`id`、`status` 字段的无效记录
4. 按 `project` 分组展示
5. `status` 可能的值：`MERGED`、`NEW`、`ABANDONED`
6. 如果 `subject` 包含 "Revert"（不区分大小写），标注为 REVERT
7. `createdOn` 和 `lastUpdated` 是 Unix 时间戳，需转换为可读日期

## 结果展示格式

### 单条记录

```
项目: public_antv_t/platform/frameworks/base
分支: cvte_os10_master
标题: [10.2.15][feature][whaletv][Zmind#332669]Add Egyptian Arabic translations
状态: MERGED
提交人: clement.ren
链接: http://whale-gerrit.zeasn.com/c/public_antv_t/platform/frameworks/base/+/107014
时间: 2026-05-21 15:31
```

### 多条记录（按项目分组）

```
📋 Gerrit 提交记录（共 X 条）

Project: public_antv_t/platform/frameworks/base
  ✅ [MERGED] Add Egyptian Arabic translations — cvte_os10_master
  ✅ [MERGED] Add Egyptian Arabic translations — topt_os10_master
  ✅ [MERGED] Add Egyptian Arabic translations — hikeen_os10_master

Project: android_apps/whale_os_app/whaleos10/language-overlay
  ✅ [MERGED] TV FRESH Overlay Translation Update — os10_dev
  ✅ [MERGED] TV LEVON Overlay Translation Update — os10_master
```

## Gerrit Change 链接格式

```
http://whale-gerrit.zeasn.com/c/<project>/+/<change_number>
```

## Gerrit 浏览器查询链接

按 Issue ID 查询所有相关 Change：
```
https://whale-gerrit.zeasn.com/q/%2523<issue_id>
```

## 本地推送命令

```bash
# 标准推送（自动添加 Reviewer）
gerritpush

# 手动推送
git push origin HEAD:refs/for/<branch_name>
```

## 与 Zmind 的关联

- Commit Message 中包含 `Zmind#<issue_id>` 用于关联
- 查询时使用 `#<issue_id>` 作为搜索关键词
- Cherry-Pick 完成后需要在 Zmind Issue 中添加 CP 结果评论
- `cherryPickOfChange` 字段标识该提交是从哪个 Change cherry-pick 来的

## 关键约束

- 所有 push 操作必须经过用户确认
- MP 分支（`*_mp`）的 push 需要额外确认
- Gerrit API 调用失败时停止后续操作，等待用户指示
- 不要在输出中暴露密码
- SSH 查询需要确保用户的 SSH 密钥已上传到 Gerrit
