/**
 * SoT (Single Source of Truth) loader — v3
 *
 * 启动时从 ~/.ai/whaletv.yaml 读取凭据，注入到 process.env。
 *
 * 优先级：现有 env（非空）> SoT 值。这样：
 *   - 老用户 mcp.json 里已填 env → SoT 静默不覆盖（向后兼容）
 *   - 新用户 env 是空字符串 → SoT 值填进来
 *   - SoT 不存在 → 静默跳过（回退到 env only）
 *
 * 该文件是 side-effect import：`import "./sot-loader.js";` 即可。
 *
 * 为保持每个 MCP server 无跨包依赖，此文件是**自包含**的（不引 whaletv-credentials CLI，
 * 也不引 yaml 第三方库）。如需修改 YAML 解析逻辑，请同步更新 scripts/whaletv-credentials.mjs。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const SOT_PATH = path.join(os.homedir(), ".ai", "whaletv.yaml");

/**
 * SoT 键 (dotted) → env 变量名 的映射表。
 * 只列出当前 5 个 MCP server 会读的字段；SoT 里其他字段（如 s3_issue_analysis）
 * 由对应工具在需要时自己读。
 */
const KEY_TO_ENV: Record<string, string> = {
  "zmind.api_key": "ZMIND_API_KEY",
  "zmind.url": "ZMIND_URL",
  "opengrok.username": "OPENGROK_USERNAME",
  "opengrok.password": "OPENGROK_PASSWORD",
  "opengrok.url": "OPENGROK_URL",
  "opengrok.project": "OPENGROK_PROJECT",
  "gerrit.auth_header": "GERRIT_AUTH_HEADER",
  "gerrit.cookie": "GERRIT_COOKIE",
  "gerrit.username": "GERRIT_USERNAME",
  "gerrit.http_password": "GERRIT_HTTP_PASSWORD",
  "gerrit.url": "GERRIT_URL",
  "confluence.cookie": "CONFLUENCE_COOKIE",
  "confluence.username": "CONFLUENCE_USERNAME",
  "confluence.password": "CONFLUENCE_PASSWORD",
  "confluence.base_url": "CONFLUENCE_BASE_URL",
};

/**
 * 极简 YAML 解析（同 scripts/whaletv-credentials.mjs 里的 parseYaml，
 * 只支持 flat + 两层嵌套）。
 */
function parseYaml(text: string): Record<string, string | Record<string, string>> {
  // 剥离 UTF-8 BOM（Windows 上一些工具如 PowerShell Set-Content -Encoding UTF8 会加 BOM）
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  const data: Record<string, string | Record<string, string>> = {};
  let currentTopKey: string | null = null;

  for (const raw of lines) {
    const line = stripInlineComment(raw);
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[0].length : 0;
    const stripped = line.slice(indent);

    if (indent === 0) {
      const m = stripped.match(/^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const rest = m[2];
      if (rest === "" || rest === "~" || rest === "null") {
        data[key] = {};
        currentTopKey = key;
      } else {
        data[key] = parseScalar(rest);
        currentTopKey = null;
      }
    } else if (indent === 2 && currentTopKey !== null) {
      const m = stripped.match(/^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const rest = m[2];
      const top = data[currentTopKey];
      if (typeof top === "object" && top !== null) {
        (top as Record<string, string>)[key] = parseScalar(rest);
      }
    }
  }
  return data;
}

function stripInlineComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "#" && !inSingle && !inDouble) {
      if (i > 0 && /\s/.test(line[i - 1])) return line.slice(0, i).replace(/\s+$/, "");
    }
  }
  return line;
}

function parseScalar(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "~" || trimmed === "null") return "";
  if (trimmed === "true" || trimmed === "false") return trimmed;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) return "";
  return trimmed;
}

function getByPath(
  data: Record<string, string | Record<string, string>>,
  dottedKey: string,
): string {
  const parts = dottedKey.split(".");
  if (parts.length === 1) {
    const v = data[parts[0]];
    return typeof v === "string" ? v : "";
  }
  if (parts.length === 2) {
    const top = data[parts[0]];
    if (typeof top === "object" && top !== null) {
      return (top as Record<string, string>)[parts[1]] ?? "";
    }
  }
  return "";
}

/**
 * 加载 SoT，注入到 process.env。
 * 静默失败：SoT 不存在 / YAML 语法错误时都不 throw，只在 stderr 打一行 debug。
 */
function loadSotEnv(): void {
  if (!fs.existsSync(SOT_PATH)) {
    // 无 SoT，静默跳过（老用户走原 mcp.json env 流程）
    return;
  }

  let data: Record<string, string | Record<string, string>>;
  try {
    const text = fs.readFileSync(SOT_PATH, "utf8");
    data = parseYaml(text);
  } catch (e) {
    process.stderr.write(
      `[sot-loader] 解析 ${SOT_PATH} 失败，跳过：${(e as Error).message}\n`,
    );
    return;
  }

  const injected: string[] = [];
  for (const [dottedKey, envName] of Object.entries(KEY_TO_ENV)) {
    const existing = process.env[envName];
    // 只在 env 未设置或为空字符串时才从 SoT 注入（env 优先）
    if (existing !== undefined && existing !== "") continue;
    const value = getByPath(data, dottedKey);
    if (value && value !== "") {
      process.env[envName] = value;
      injected.push(envName);
    }
  }

  if (injected.length > 0) {
    process.stderr.write(
      `[sot-loader] 从 ${SOT_PATH} 注入 ${injected.length} 个环境变量：${injected.join(", ")}\n`,
    );
  }
}

// 副作用 import：加载 SoT 到 env
loadSotEnv();

export { loadSotEnv };
