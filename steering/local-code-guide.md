# 本地源码操作指南

## 触发场景

当 AI 需要搜索、读取或修改源码时激活此指南。适用于 Bug 分析、PR/CR 处理、代码定位等所有涉及源码操作的场景。

## 前置条件

- 用户已在源码根目录或子模块目录下启动 Kiro CLI
- 当前工作目录包含 `.repo` 或典型子目录（frameworks/、packages/）

## 核心原则

**优先使用本地文件系统操作源码**，而非仅依赖 OpenGrok 远程搜索。本地操作速度更快、上下文更完整。分析 Bug 或处理 PR 时，直接读取本地源码文件获取完整上下文（类的完整实现、调用链上下游），而非仅依赖搜索结果片段。

## Workspace 限制（重要）

Kiro 只能操作**当前 workspace 目录内**的文件。如果源码目录不在 workspace 中，`git grep`、文件读取等操作会失败。

**判断方式**：当用户请求分析 Issue 时，根据 Issue 所属项目的代码映射，检查对应路径是否在当前 workspace 内。

**IF 目标代码路径不在当前 workspace 内**：

提示用户：
```
⚠️ 当前 workspace 不包含该项目的源码目录。

Issue 所属项目: [项目名]
对应代码路径: [映射的路径]
当前 workspace: [当前目录]

请将源码目录添加到 workspace：
→ File → Add Folder to Workspace → 选择 [映射的路径]

添加完成后回复"已添加"，我将继续使用本地代码分析。
或回复"跳过"，我将使用 OpenGrok 远程搜索（公版代码，可能与实际项目有差异）。
```

**用户回复"已添加"或确认后**：重新尝试本地代码搜索操作。
**用户回复"跳过"**：降级到 OpenGrok 远程搜索，在报告中标注"定位方式：OpenGrok"。

**不要**尝试自动执行 workspace 操作——这是 IDE 层面的限制，AI 无法通过命令行或工具调用完成。

**推荐的使用方式**：
- Windows（Samba 映射）：在 Kiro 中直接打开映射盘符路径（如 `W:\code\950_stm\amlogic`）
- Linux（远程服务器）：在源码目录下启动 `kiro`（如 `cd ~/cvte_code/amlogic && kiro`）

## 搜索策略优先级

### ① git grep 精确搜索（最高优先级，~0.4s）

**首选方式**。在当前代码库内精确搜索类名、方法名、字符串常量等。

### ② 读取已知路径文件（中等优先级，即时）

当已知文件路径时，直接读取文件获取完整上下文。

### ③ OpenGrok 远程搜索（最低优先级）

仅在以下情况使用：
- 本地 git grep 未返回结果
- 需要跨代码库搜索（当前目录外的其他代码库）
- 需要搜索符号定义位置

使用 OpenGrok 时，在报告中标注"定位方式：OpenGrok"。

## 为什么 git grep 优于 ripgrep

| 对比项 | git grep | ripgrep |
|--------|----------|---------|
| 大型代码库搜索耗时 | ~0.4s | ~40s |
| 搜索范围 | 仅 git 跟踪的文件 | 全量扫描所有文件 |
| 自动排除 | out/、prebuilts/ 等未跟踪目录 | 需手动配置排除规则 |
| 结果精确度 | 高（排除未跟踪文件） | 可能包含编译产物等噪音 |

**原因总结**：
- 大型代码库 100GB+，ripgrep 全量扫描需 ~40s
- git grep 仅搜索 git 跟踪的文件，自动排除 out/、prebuilts/ 等目录，~0.4s 完成
- git grep 天然排除未跟踪文件，结果更精确

## git grep 用法示例

```bash
# 搜索类名定义
git grep -n "class TvScanConfig" -- "*.java"

# 搜索方法调用（Java 和 Kotlin）
git grep -n "updateIssueStatus" -- "*.java" "*.kt"

# 搜索字符串常量（Java 和 XML）
git grep -rn "TV_COUNTRY" -- "*.java" "*.xml"
```

**参数说明**：
- `-n`：显示行号
- `-r`：递归搜索（在子模块中也搜索）
- `-- "*.java"`：限定搜索文件类型，提高精度和速度

## 操作前状态确认

在执行任何代码修改前，**必须**先确认工作区状态：

```bash
git status    # 确认工作区状态（是否有未提交的修改）
git branch    # 确认当前分支（避免在错误分支上操作）
```

IF 当前分支不是预期的工作分支，THEN 提示用户确认是否需要切换分支后再继续。

## 典型目录结构

```
~/cvte_code/amlogic/              # 源码根目录
├── frameworks/
│   ├── base/                     # Android Framework 核心
│   │   ├── core/java/            # 核心 Java API
│   │   ├── services/             # System Services
│   │   └── packages/             # Framework 内置包
│   └── av/                       # 多媒体框架
├── packages/
│   ├── apps/                     # 系统应用
│   │   ├── TvSettings/           # TV 设置
│   │   ├── LiveTv/               # 直播电视
│   │   └── ...
│   └── services/                 # 系统服务包
├── vendor/
│   └── amlogic/                  # Amlogic 厂商定制
│       ├── common/
│       └── ...
├── hardware/
│   └── amlogic/                  # HAL 层
├── kernel/                       # 内核源码
└── device/
    └── amlogic/                  # 设备配置
```

根据模块名快速定位子目录：
- Framework 相关 → `frameworks/base/`
- 系统应用 → `packages/apps/`
- 厂商定制 → `vendor/amlogic/`
- HAL 层 → `hardware/amlogic/`
- 内核 → `kernel/`
- 设备配置 → `device/amlogic/`

## 跨代码库操作指南

WhaleTV 共有 11 套代码库。当需要操作非当前工作目录的代码库时：

1. **不假设**所有 11 套代码库都在当前目录下
2. **提示用户**切换到目标代码库目录，或指定目标路径
3. **明确告知**用户当前操作仅限于当前工作目录所在的代码库

示例提示：
> 当前工作目录为 `~/cvte_code/amlogic/`，需要操作的代码位于其他代码库。请切换到目标代码库目录，或提供目标代码库的完整路径。

## 非源码目录检测

IF 当前目录不包含以下标志之一：
- `.repo` 目录
- 典型子目录（`frameworks/`、`packages/`、`vendor/`、`device/`）

THEN 提示用户：
> ⚠️ 当前目录可能不是源码目录，git grep 等本地搜索可能无法正常工作。建议切换到源码根目录：
> ```bash
> cd ~/cvte_code/amlogic
> ```

## 错误恢复

| 场景 | 处理方式 |
|------|---------|
| git grep 无结果 | 降级到 OpenGrok `search_code` 或 `search_symbol` 搜索 |
| 文件路径不存在 | 使用 git grep 重新搜索文件位置 |
| 不在 git 仓库中 | 提示用户切换到源码目录 |
| 搜索结果过多 | 添加文件类型限定（`-- "*.java"`）或更精确的关键词 |
| 搜索策略不够高效 | 记录到 `.learnings/LEARNINGS.md`（分类 `best_practice`），后续优化搜索策略 |


## 进化集成

- 当搜索策略失败或效率低时，记录到 `.learnings/LEARNINGS.md`
- 当发现新的高效搜索技巧时，更新本文件的搜索策略
- IF 遇到本指南未覆盖的源码操作场景，THEN 通过 find-skill 检查是否需要扩展本指南
