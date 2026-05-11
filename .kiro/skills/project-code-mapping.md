---
inclusion: auto
---

# Skill: 项目-代码库匹配

## 目的

将 Zmind 项目（project identifier）与本地 AOSP 代码库路径进行匹配，使 AI 在处理 Issue 时能自动定位到正确的代码目录。

## Zmind 项目地址格式

Zmind 项目的浏览器链接格式为：
```
https://zmind.whaletv.com/projects/<project_identifier>
```

示例：
- https://zmind.whaletv.com/projects/cultraview-dvb-amlogic-t950d4-2k-1g
- https://zmind.whaletv.com/projects/stm-amlogic-t962d4-4k-1-5gb

## 工作流程

### 步骤 1：获取用户项目列表

当需要确定代码库位置时，调用 `list_projects` 获取当前用户可见的所有项目列表。

### 步骤 2：展示项目列表

将项目列表展示给用户，格式：
```
你在 Zmind 上的项目列表：
1. [cultraview-dvb-amlogic-t950d4-2k-1g] CultraView DVB Amlogic T950D4 2K 1G
2. [stm-amlogic-t962d4-4k-1-5gb] STM Amlogic T962D4 4K 1.5GB
3. ...

请告诉我：
- 你当前工作的项目是哪个？
- 对应的本地代码库路径是什么？（如 ~/cvte_code/amlogic/）
```

### 步骤 3：用户提供映射规则

用户会提供项目与代码路径的对应关系，AI 需要记住这个映射。

### 步骤 4：后续自动匹配

当处理 Issue 时，从 Issue 的 `project` 字段获取 project identifier，根据映射规则自动切换到对应的代码库路径。

## 匹配规则模板

用户提供映射后，按以下格式记录：

| Zmind Project Identifier | 本地代码路径 | 说明 |
|--------------------------|-------------|------|
| （用户提供） | （用户提供） | （用户提供） |

## 关键约束

- 不要假设项目和代码路径的对应关系，必须由用户明确指定
- 如果 Issue 所属项目没有对应的代码路径映射，提示用户提供
- 一个 Zmind 项目可能对应多个代码库子目录
- 代码路径可能是 AOSP 源码根目录，也可能是某个子模块目录

## 触发时机

- 首次使用 Power 时，由 onboarding 引导流程的步骤 ② 触发
- 处理 Issue 时发现项目未映射，提示用户补充
- 用户主动要求"补充配置"或"添加项目映射"时
