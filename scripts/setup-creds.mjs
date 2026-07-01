#!/usr/bin/env node
/**
 * setup-creds.mjs — v3: 把手填凭据写入 SoT (~/.ai/whaletv.yaml)，并可选双写 mcp.json
 *
 * v3 变化：
 *   - 默认写 SoT（~/.ai/whaletv.yaml），MCP server 通过 sot-loader 读取
 *   - 加 `--legacy-mcp-json` 开关：同时双写 mcp.json（供还没升 v3 dist 的老用户）
 *   - 加 `--sot-only` 开关：只写 SoT，不动 mcp.json（新用户干净模式，默认行为）
 *
 * 处理的凭据（仅"手填一次永久"类）：
 *   - ZMIND_API_KEY   → zmind.api_key
 *   - OPENGROK_USERNAME / OPENGROK_PASSWORD → opengrok.username / opengrok.password
 *
 * 不处理（由 refresh-auth.mjs 自动抓 cookie 维护）：
 *   - gerrit.auth_header / gerrit.cookie
 *   - confluence.cookie
 *
 * 调用方式：
 *   # v3 默认（写 SoT）
 *   ZMIND_API_KEY=xxx OPENGROK_USERNAME=zeasnrd OPENGROK_PASSWORD=yyy \
 *     node scripts/setup-creds.mjs
 *
 *   # 兼容模式（同时写 mcp.json）
 *   ZMIND_API_KEY=xxx node scripts/setup-creds.mjs --legacy-mcp-json
 *
 * 退出码：
 *   0 = 成功
 *   1 = 没有任何凭据需要写（env 为空）
 *   3 = 文件读写失败
 */

import { mkdir, readFile, writeFile, copyFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readSoT, writeSoT, setByPath, SOT_PATH } from "./whaletv-credentials.mjs";

const MCP_JSON_PATH = join(homedir(), ".kiro", "settings", "mcp.json");
const POWER_NAME = process.env.WHALE_POWER_NAME?.trim() || "whaletv-dev-power";
const POWER_KEY_PREFIX = `power-${POWER_NAME}-`;

async function readMcpJson() {
  try {
    await access(MCP_JSON_PATH);
  } catch {
    return {};
  }
  try {
    const text = await readFile(MCP_JSON_PATH, "utf8");
    if (!text.trim()) return {};
    return JSON.parse(text);
  } catch (e) {
    process.stderr.write(
      `[setup-creds] 读取 ${MCP_JSON_PATH} 失败 (${e.message})；为安全起见退出而非覆盖。\n`,
    );
    process.exit(3);
  }
}

async function backupMcpJson() {
  try {
    await access(MCP_JSON_PATH);
  } catch {
    return null;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${MCP_JSON_PATH}.bak.${stamp}`;
  await copyFile(MCP_JSON_PATH, backup);
  return backup;
}

async function writeMcpJsonAtomic(cfg) {
  await mkdir(dirname(MCP_JSON_PATH), { recursive: true });
  const text = JSON.stringify(cfg, null, 2) + "\n";
  await writeFile(MCP_JSON_PATH, text, "utf8");
}

/**
 * 与 refresh-auth.mjs 完全相同的双写逻辑。
 * 见 scripts/refresh-auth.mjs 的 injectServerEnv 注释。
 */
function injectServerEnv(cfg, baseKey, envPatch) {
  cfg.mcpServers = cfg.mcpServers || {};

  function patchMcpServers(servers, parentLabel) {
    const matched = [];
    for (const key of Object.keys(servers)) {
      if (key === baseKey || key.endsWith(`-${baseKey}`) || key.endsWith(baseKey)) {
        servers[key] = servers[key] || {};
        servers[key].env = { ...(servers[key].env || {}), ...envPatch };
        matched.push(`${parentLabel}.${key}`);
      }
    }
    return matched;
  }

  const hits = [];
  hits.push(...patchMcpServers(cfg.mcpServers, "mcpServers"));
  if (cfg.powers && typeof cfg.powers === "object" && cfg.powers.mcpServers) {
    hits.push(...patchMcpServers(cfg.powers.mcpServers, "powers.mcpServers"));
  }

  if (hits.length === 0) {
    const localKey = baseKey;
    const powerKey = `${POWER_KEY_PREFIX}${baseKey}`;
    cfg.mcpServers[localKey] = cfg.mcpServers[localKey] || {};
    cfg.mcpServers[localKey].env = {
      ...(cfg.mcpServers[localKey].env || {}),
      ...envPatch,
    };
    cfg.mcpServers[powerKey] = cfg.mcpServers[powerKey] || {};
    cfg.mcpServers[powerKey].env = {
      ...(cfg.mcpServers[powerKey].env || {}),
      ...envPatch,
    };
    hits.push(`mcpServers.${localKey}`, `mcpServers.${powerKey}`);
  }

  return hits;
}

// =============================================================================
// v3: SoT 写入
// =============================================================================

/**
 * 把收集到的凭据写入 SoT (~/.ai/whaletv.yaml)。
 * 返回实际写入的键名列表（用于日志）。
 */
function writeToSot({ zmindKey, ogUser, ogPass }) {
  const { data, order } = readSoT();
  const written = [];

  if (zmindKey) {
    setByPath(data, order, "zmind.api_key", zmindKey);
    written.push("zmind.api_key");
    // zmind.url 缺省时填默认
    if (!data.zmind?.url) {
      setByPath(data, order, "zmind.url", "https://zmind.whaletv.com");
      written.push("zmind.url (默认)");
    }
  }
  if (ogUser) {
    setByPath(data, order, "opengrok.username", ogUser);
    written.push("opengrok.username");
  }
  if (ogPass) {
    setByPath(data, order, "opengrok.password", ogPass);
    written.push("opengrok.password");
  }
  if ((ogUser || ogPass) && !data.opengrok?.url) {
    setByPath(data, order, "opengrok.url", "https://opengrok.zeasn.com");
    written.push("opengrok.url (默认)");
  }

  // 更新元数据
  setByPath(data, order, "_meta.updated_at", new Date().toISOString());
  if (!data._meta || (typeof data._meta === "object" && !data._meta.version)) {
    setByPath(data, order, "_meta.version", "1");
  }

  writeSoT(data, order);
  return written;
}

// =============================================================================
// 主流程
// =============================================================================

function parseFlags() {
  const args = process.argv.slice(2);
  return {
    legacyMcpJson: args.includes("--legacy-mcp-json"),
    sotOnly: args.includes("--sot-only"), // 显式声明，默认行为其实也是 sot-only
  };
}

async function main() {
  const zmindKey = process.env.ZMIND_API_KEY?.trim() || "";
  const ogUser = process.env.OPENGROK_USERNAME?.trim() || "";
  const ogPass = process.env.OPENGROK_PASSWORD ?? "";
  const flags = parseFlags();

  if (!zmindKey && !ogUser && !ogPass) {
    process.stderr.write(
      "[setup-creds] 没有需要写入的凭据。请设置以下任一环境变量后重试：\n" +
        "  ZMIND_API_KEY=<40 位十六进制>\n" +
        "  OPENGROK_USERNAME=<账号>\n" +
        "  OPENGROK_PASSWORD=<密码>\n" +
        "\n" +
        "或者交互式创建 SoT：node scripts/whaletv-credentials.mjs init\n",
    );
    process.exit(1);
  }

  // === 步骤 1：写 SoT（v3 主路径）===
  let written = [];
  try {
    written = writeToSot({ zmindKey, ogUser, ogPass });
  } catch (e) {
    process.stderr.write(`[setup-creds] 写 SoT 失败: ${e.message}\n`);
    process.exit(3);
  }

  process.stderr.write(`[setup-creds] ✓ SoT 已更新 ${SOT_PATH}\n`);
  for (const k of written) {
    process.stderr.write(`[setup-creds]   ${k}\n`);
  }

  // === 步骤 2（可选）：双写 mcp.json（兼容模式）===
  if (flags.legacyMcpJson) {
    process.stderr.write(
      "[setup-creds] --legacy-mcp-json 已启用，同时写 mcp.json...\n",
    );

    const tasks = [];
    if (zmindKey) {
      tasks.push({ baseKey: "zmind-mcp-server", env: { ZMIND_API_KEY: zmindKey } });
      tasks.push({ baseKey: "knowledge-mcp-server", env: { ZMIND_API_KEY: zmindKey } });
    }
    if (ogUser || ogPass) {
      const env = {};
      if (ogUser) env.OPENGROK_USERNAME = ogUser;
      if (ogPass) env.OPENGROK_PASSWORD = ogPass;
      tasks.push({ baseKey: "opengrok-mcp-server", env });
    }

    let backupPath;
    try {
      backupPath = await backupMcpJson();
    } catch (e) {
      process.stderr.write(`[setup-creds] 备份 mcp.json 失败: ${e.message}\n`);
      process.stderr.write("[setup-creds] SoT 已写入，mcp.json 未变，可用 SoT 继续。\n");
      process.exit(3);
    }

    const cfg = await readMcpJson();
    const allHits = [];
    for (const t of tasks) {
      const hits = injectServerEnv(cfg, t.baseKey, t.env);
      allHits.push({ baseKey: t.baseKey, hits });
    }

    try {
      await writeMcpJsonAtomic(cfg);
    } catch (e) {
      process.stderr.write(
        `[setup-creds] 写入 mcp.json 失败: ${e.message}\n` +
          `已备份原文件: ${backupPath ?? "(无原文件)"}\n`,
      );
      process.stderr.write("[setup-creds] SoT 已写入，可继续；mcp.json 双写失败不阻塞。\n");
      process.exit(3);
    }

    process.stderr.write(`[setup-creds] ✓ mcp.json 已更新 ${MCP_JSON_PATH}\n`);
    for (const { baseKey, hits } of allHits) {
      process.stderr.write(`[setup-creds]   ${baseKey} → ${hits.join(", ")}\n`);
    }
    if (backupPath) process.stderr.write(`[setup-creds]   备份: ${backupPath}\n`);
  }

  // === 步骤 3：后续提示 ===
  process.stderr.write(
    "\n" +
      "[setup-creds] 下一步：\n" +
      "[setup-creds]   1. 抓 Gerrit + Confluence session cookie：\n" +
      "[setup-creds]      PowerShell -ExecutionPolicy Bypass -File scripts\\refresh-auth.ps1  (Windows)\n" +
      "[setup-creds]      bash scripts/refresh-auth.sh                                          (Linux/macOS)\n" +
      "[setup-creds]   2. 校验：node scripts/whaletv-credentials.mjs check\n" +
      "[setup-creds]   3. 重启 Kiro（Reload Window）以加载新凭据\n",
  );
}

main().catch((e) => {
  process.stderr.write(`[setup-creds] 未预期错误: ${e?.stack || e}\n`);
  process.exit(1);
});
