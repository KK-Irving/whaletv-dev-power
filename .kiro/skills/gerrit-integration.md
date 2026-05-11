---
inclusion: auto
---

# Skill: Gerrit 集成

## 目的

定义与 WhaleTV Gerrit 系统的交互规范，支持代码提交查询、Cherry-Pick、评论处理等操作。

## Gerrit 服务信息

- **地址**: https://whale-gerrit.zeasn.com/
- **API 基础路径**: https://whale-gerrit.zeasn.com/a/
- **认证方式**: HTTP Basic Auth（用户名 + HTTP 密码）或通过 .gitcookies

## 常用 Gerrit API

### 查询 Change

```bash
# 按 Issue ID 搜索关联的 Change
curl -s "https://whale-gerrit.zeasn.com/a/changes/?q=message:<issue_id>+status:merged"

# 查询某个 Change 的详情
curl -s "https://whale-gerrit.zeasn.com/a/changes/<change_id>/detail"

# 查询某个 project 的分支列表
curl -s "https://whale-gerrit.zeasn.com/a/projects/<project>/branches/"
```

### Cherry-Pick

```bash
# 通过 API 执行 Cherry-Pick
curl -X POST "https://whale-gerrit.zeasn.com/a/changes/<change_id>/revisions/current/cherrypick" \
  -H "Content-Type: application/json" \
  -d '{"destination": "<target_branch>"}'
```

### 评论操作

```bash
# 获取 Change 的评论
curl -s "https://whale-gerrit.zeasn.com/a/changes/<change_id>/comments"

# 回复评论
curl -X POST "https://whale-gerrit.zeasn.com/a/changes/<change_id>/revisions/current/review" \
  -H "Content-Type: application/json" \
  -d '{"comments": {"<file>": [{"id": "<comment_id>", "message": "回复内容"}]}}'
```

## 本地推送命令

WhaleTV 使用自定义的 `gerritpush` 命令推送代码：

```bash
# 标准推送（自动添加 Reviewer）
gerritpush

# 推送到指定分支
git push origin HEAD:refs/for/<branch_name>
```

## Gerrit Change 链接格式

```
https://whale-gerrit.zeasn.com/c/<project>/+/<change_number>
```

示例：
```
https://whale-gerrit.zeasn.com/c/frameworks/base/+/123456
```

## 与 Zmind 的关联

- Zmind Issue 的评论中通常包含 Gerrit Change 链接
- Commit Message 中包含 `Zmind#<issue_id>` 用于关联
- Cherry-Pick 完成后需要在 Zmind Issue 中添加 CP 结果评论

## 关键约束

- 所有 push 操作必须经过用户确认（安全规则第三层）
- MP 分支（`*_mp`）的 push 需要额外确认
- Gerrit API 调用失败时停止后续操作，等待用户指示
- 不要在代码中硬编码 Gerrit 认证信息

## 待确认事项

使用前需要用户确认：
1. Gerrit HTTP 密码是否已配置（通过 .gitcookies 或 ~/.netrc）
2. `gerritpush` 命令是否可用
3. 默认的 Reviewer 列表
