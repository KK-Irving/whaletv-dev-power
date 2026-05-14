# Implementation Plan: WhaleTV Developer Power

## Overview

This implementation plan builds the `whaletv-dev-power` Kiro Power in 5 modules: project skeleton & POWER.md, Zmind MCP Server (14 tools), OpenGrok MCP Server (2 tools), Steering workflow files (6 files), and safety mechanism (hooks). Each module is designed as an incremental step that builds on the previous, with Modules 2 and 3 parallelizable after Module 1 is complete.

## Tasks

- [x] 1. Module 1: Project skeleton & POWER.md
  - [x] 1.1 Create directory structure and configuration files
    - Create the full project directory tree: `mcp-servers/zmind-mcp-server/src/`, `mcp-servers/opengrok-mcp-server/src/`, `steering/`, `hooks/`
    - Create `mcp-servers/zmind-mcp-server/package.json` with fixed dependencies: `@modelcontextprotocol/sdk@1.12.1`, `zod@3.24.4`, dev deps `tsx@4.19.4`, `typescript@5.8.3`, `@types/node@24.0.3`
    - Create `mcp-servers/zmind-mcp-server/tsconfig.json` targeting ES2022, module NodeNext
    - Create `mcp-servers/opengrok-mcp-server/package.json` with same fixed dependencies
    - Create `mcp-servers/opengrok-mcp-server/tsconfig.json` targeting ES2022, module NodeNext
    - _Requirements: 1.1, 1.2, 1.3, 11.4, 11.5_

  - [x] 1.2 Create POWER.md with full metadata and documentation
    - Write POWER.md with YAML frontmatter: name (`whaletv-dev-power`), displayName (`WhaleTV Developer Power`), version (`1.0.0`), description (≤80 chars), keywords list (whaletv, aosp, zmind, gerrit, opengrok, cherry-pick, pr, cr, android, 项目管理, 代码搜索), mcpServers array (zmind-mcp-server and opengrok-mcp-server with paths, commands, env vars)
    - Include environment variable configuration section as a table (ZMIND_API_KEY, ZMIND_URL, OPENGROK_URL, OPENGROK_PROJECT) with name, purpose, required flag, default, format example
    - Include system requirements section (Ubuntu 20.04+, Node.js 18+, remote Linux CLI)
    - Include recommended usage section (launch Kiro CLI in AOSP source root or submodule directory)
    - Include configuration verification method (curl commands to test Zmind and OpenGrok connectivity)
    - Include troubleshooting steps for missing environment variables
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 10.7, 11.1, 11.2, 11.3, 11.6_

- [x] 2. Checkpoint - Verify Module 1 structure
  - Ensure all configuration files are valid JSON/YAML, directory structure matches design, and POWER.md contains all required fields. Ask the user if questions arise.

- [x] 3. Module 2: Zmind MCP Server (14 tools)
  - [x] 3.1 Implement Zmind MCP Server core infrastructure
    - In `mcp-servers/zmind-mcp-server/src/index.ts`, implement:
    - Environment variable reading: `ZMIND_URL` (default `https://zmind.whaletv.com`), `ZMIND_API_KEY` (required)
    - `validateConfig()` function that throws error with specific variable name if `ZMIND_API_KEY` is empty/undefined
    - HTTP helper functions: `redmineGet(path, params?)`, `redminePut(path, body)`, `redminePost(path, body)` — all with error handling that catches non-success status codes and returns formatted error messages including HTTP status code and API error description
    - McpServer instantiation with name "zmind-mcp-server", version "1.0.0"
    - StdioServerTransport connection and main() entry point
    - _Requirements: 2.9, 2.10, 2.11_

  - [x] 3.2 Implement query tools (get_issue, my_issues, search_issues)
    - `get_issue`: accepts `issue_id` (number), calls `/issues/{id}.json` with `include=journals,attachments,relations,children`, formats and returns subject, status, priority, assignee, project, tracker, done_ratio, description, comments history, attachments list, relations, children, and allowed status transitions
    - `my_issues`: accepts optional `status` (enum: "open"|"closed"|"*", default "open") and `limit` (number, default 25, max 100), calls `/issues.json` with `assigned_to_id=me`, returns list sorted by updated_on descending
    - `search_issues`: accepts `query` (required string), optional `project`, `status`, `tracker_id`, `assigned_to_id`, `limit` (default 10, max 100), performs search and returns matching issues
    - All tools use zod for parameter validation
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Implement write tools (update_issue, create_issue, add_comment, create_time_entry)
    - `update_issue`: accepts `issue_id` (required number), optional `status_id`, `assigned_to_id`, `priority_id`, `done_ratio` (0-100), `notes`; validates at least one optional field is provided (returns error if none); calls PUT `/issues/{id}.json`
    - `create_issue`: accepts `project_id` (required string|number), `subject` (required string), optional `description`, `tracker_id`, `priority_id`, `assigned_to_id`, `parent_issue_id`, `fixed_version_id`; calls POST `/issues.json`; returns new issue ID and details
    - `add_comment`: accepts `issue_id` (required number), `comment` (required string), optional `private` (boolean); calls PUT `/issues/{id}.json` with notes
    - `create_time_entry`: accepts `issue_id` (required number), `hours` (required positive number), optional `activity_id`, `spent_on` (YYYY-MM-DD format, default today), `comments`; calls POST `/time_entries.json`
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 2.12_

  - [x] 3.4 Implement auxiliary query tools and additional tools
    - `list_projects`: accepts optional `limit`, calls GET `/projects.json`, returns project list
    - `get_versions`: accepts `project_id` (string), calls GET `/projects/{id}/versions.json`, returns version list
    - `get_project_members`: accepts `project_id` (string), calls GET `/projects/{id}/memberships.json`, returns members with roles
    - `get_issue_statuses`: no params, calls GET `/issue_statuses.json`, returns all statuses with IDs
    - `get_trackers`: no params, calls GET `/trackers.json`, returns all tracker types with IDs
    - `get_priorities`: no params, calls GET `/enumerations/issue_priorities.json`, returns all priorities with IDs
    - `get_time_activities`: no params, calls GET `/enumerations/time_entry_activities.json`, returns activity types
    - _Requirements: 2.8_

  - [ ]* 3.5 Write unit tests for Zmind MCP Server
    - Test `validateConfig()` throws correct error when ZMIND_API_KEY is missing
    - Test `redmineGet` error handling for HTTP 401, 403, 404, 500 responses (mock fetch)
    - Test `update_issue` rejects calls with no optional fields provided
    - Test parameter validation via zod schemas (invalid types, out-of-range values)
    - _Requirements: 2.9, 2.11, 2.12_

- [x] 4. Module 3: OpenGrok MCP Server (2 tools)
  - [x] 4.1 Implement OpenGrok MCP Server with search_code and search_symbol tools
    - In `mcp-servers/opengrok-mcp-server/src/index.ts`, implement:
    - Environment variable reading: `OPENGROK_URL` (required), `OPENGROK_PROJECT` (optional)
    - `validateConfig()` function that throws error if `OPENGROK_URL` is empty/undefined
    - `opengrokSearch(type: "full"|"def", query, maxResults)` helper with 15-second AbortController timeout, connection error detection (ECONNREFUSED/ENOTFOUND), and empty result handling
    - `formatResults(data, type)` function that formats results with file path, line number, and context (3 lines before/after)
    - `search_code` tool: accepts `query` (string, 1-200 chars) and optional `max_results` (number, default 20, max 100), performs full-text search
    - `search_symbol` tool: accepts `symbol` (string, 1-200 chars) and optional `max_results` (number, default 20, max 100), searches symbol definitions
    - McpServer instantiation with name "opengrok", version "1.0.0", StdioServerTransport connection
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [ ]* 4.2 Write unit tests for OpenGrok MCP Server
    - Test `validateConfig()` throws correct error when OPENGROK_URL is missing
    - Test 15-second timeout handling (mock delayed response)
    - Test connection refused error message includes service URL
    - Test empty search results return clear "no matches" message
    - Test query length validation (empty string rejected, >200 chars rejected)
    - _Requirements: 3.4, 3.6, 3.8, 3.9_

- [x] 5. Checkpoint - Verify MCP Servers
  - Ensure both MCP servers compile without errors (`npx tsc --noEmit` in each server directory). Ensure all tests pass. Ask the user if questions arise.

- [x] 6. Module 4: Steering workflow files
  - [x] 6.1 Create PR/CR workflow steering file
    - Create `steering/pr-cr-workflow.md` defining the 9-step workflow: 获取 Issue → 分析问题 → 定位代码 → 修改代码 → 展示 diff 并等待用户确认 → 精确暂存 (git add -p) → 生成 Commit Message → 等待用户确认后推送 Gerrit → 处理 Gerrit-AI 评论 → 更新 Zmind
    - Define Commit Message format: `[版本号][类型][whaletv][Zmind#ID]简述` with types limited to bugfix|feature|refactor|hotfix, followed by [what], [why], [how], [test], [impact] fields
    - Include mandatory user confirmation points after diff display and before push
    - Require `git add -p` for hunk-level staging
    - Define error handling: report failure step and error, wait for user instruction
    - Define "处理 Gerrit-AI 评论" step: read each comment, judge adoption, reply, mark resolved
    - Define "更新 Zmind" step: add comment with modification summary and Gerrit Change link
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [x] 6.2 Create Cherry-Pick workflow steering file
    - Create `steering/cherry-pick-workflow.md` defining the full CP flow: get Issue/Change info → search merged Changes on master → discover MP branches per project → display CP plan table → user confirmation → batch execute CP → categorized result report → update Zmind comment
    - Define CP plan table format (source Change, source project, target branches)
    - Define result categories: ✅ success (with new Change link), ⏭️ skip (equivalent commit exists), ❌ conflict (list conflict files)
    - Define MP branch discovery: query Gerrit API for branches with `_mp` suffix
    - Define error handling: stop on Gerrit API failure, report completed/pending items
    - Define Zmind update: add_comment with CP summary table
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 6.3 Create Bug analysis workflow steering file
    - Create `steering/bug-analysis-workflow.md` defining the analysis flow: get Issue details → identify log attachments → download and parse logs → extract exception info → locate code locally → output structured report
    - Define log file identification rules: filenames containing log/logcat/trace/tombstone, extensions .log/.txt/.gz/.zip
    - Define log parsing targets: exception stacks (Exception/Error + call chain), events within 5 seconds of exception, error keywords appearing 2+ times
    - Define fallback: if no log attachments, use Issue description text; if no exceptions found, list last 20 lines
    - Define code location strategy: git grep first, then OpenGrok search_symbol as fallback
    - Define report format: 现象, 关键 Log (≤30 lines), 根因定位 (file:line), 修复建议 (≤3 items)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [x] 6.4 Create Gerrit workflow steering file
    - Create `steering/gerrit-workflow.md` defining: push with gerritpush command + auto-add Reviewers → poll for Gerrit-AI comments (max 3 times, 15s interval) → if no comments after 3 polls notify user and end → analyze each comment (adopt: fix + reply + resolve; reject: reply reason + resolve)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 6.5 Create local code guide steering file
    - Create `steering/local-code-guide.md` defining:
    - Priority order: ① git grep → ② read known path files → ③ OpenGrok remote search
    - Explain why git grep > ripgrep for AOSP (0.4s vs 40s, auto-excludes untracked files)
    - Provide git grep usage examples for class names, method calls, string constants
    - Require `git status` and `git branch` check before code modifications
    - Define typical AOSP directory structure (~/cvte_code/amlogic/ with frameworks/, packages/, vendor/, etc.)
    - Guide cross-repo operations: prompt user to switch directory, don't assume all 11 repos in current dir
    - Define non-source-directory detection: check for .repo or typical AOSP subdirs, suggest switching if absent
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.8, 10.9_

  - [x] 6.6 Create safety rules steering file
    - Create `steering/safety-rules.md` defining the three-layer safety system:
    - Layer 1 (Rule constraints): MP branch no auto-push, git add must use -p, target version must be user-specified
    - Layer 2 (Hook interception): reference hooks/safety-hooks.json rules (sudo, root search, /tmp write, out/prebuilts search)
    - Layer 3 (Human confirmation): multiple solutions → user chooses, any git push → user confirms, cross-repo → user specifies scope
    - Define interception message format: ⚠️ with blocked command, reason, and recommended alternative
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6, 7.7_

- [x] 7. Checkpoint - Verify Steering files
  - Ensure all 6 steering files exist in steering/ directory, each contains structured workflow steps, confirmation points, and error handling. Ask the user if questions arise.

- [x] 8. Module 5: Safety mechanism (hooks)
  - [x] 8.1 Create safety hooks configuration file
    - Create `hooks/safety-hooks.json` with the hook rules array containing 4 rules:
    - `block-sudo`: pattern `^sudo\\s`, blocks sudo commands, alternative "use current user permissions"
    - `block-root-search`: pattern `(find|grep)\\s+(/|~/)`, blocks root/home directory searches, alternative "specify concrete subdirectory"
    - `block-tmp-write`: pattern `>\\s*/tmp/|>>/tmp/`, blocks /tmp writes, alternative "use ~/tmp"
    - `block-out-search`: pattern `(find|grep|ls\\s+-R)\\s+.*(out/|prebuilts/)`, blocks out/prebuilts searches, alternative "use git grep or specify src subdirectory"
    - Each rule includes: id, name, eventType ("preToolUse"), toolTypes ("shell"), pattern, action ("block"), reason, alternative
    - _Requirements: 7.3, 7.5, 7.6_

- [x] 9. Final checkpoint - Ensure all files are complete
  - Verify the complete project structure matches the design: POWER.md, 2 MCP server directories with package.json + tsconfig.json + src/index.ts each, 6 steering files, 1 hooks file. Ensure all tests pass. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Module 1 is the foundation; Modules 2 and 3 (tasks 3.x and 4.x) are independent and can be executed in parallel
- Module 4 (steering files) depends on Modules 2 and 3 being complete (references tool names)
- Module 5 (hooks) depends on Module 4 (safety-rules.md references hooks file)
- All code is TypeScript using @modelcontextprotocol/sdk with stdio transport
- Property tests are not applicable for this project (no Correctness Properties requiring PBT; the design's correctness properties are validated through unit tests and integration tests)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["3.1", "4.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.2"] },
    { "id": 4, "tasks": ["3.4"] },
    { "id": 5, "tasks": ["3.5"] },
    { "id": 6, "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5", "6.6"] },
    { "id": 7, "tasks": ["8.1"] }
  ]
}
```
