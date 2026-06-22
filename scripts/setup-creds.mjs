#!/usr/bin/env node
/**
 * setup-creds.mjs — 一次性把手填凭据写入 ~/.kiro/settings/mcp.json
 *
 * 设计目的：
 *   解决 Kiro IDE 安全限制（AI 不能直接写 workspace 外的文件）。AI 在 onboarding
 *   时可以让用户跑 `node scripts/setup-creds.mjs`，凭据通过环境变量传入，
 *   脚本本身不受 workspace 限制，可以写到 `~/.kiro/settings/mcp.json`。
 *
 * 处理的凭据（仅"手填一次永久"类）：
 *   - ZMIND_API_KEY        → zmind-mcp-server + knowledge-mcp-server
 *   - OPENGROK_USERNAME    → opengrok-mcp-server
 *   - OPENGROK_PASSWORD    → opengrok-mcp-server
 *
 * 不处理（由 refresh-auth.mjs 自动抓 cookie 维护）：
 *   - GERRIT_AUTH_HEADER / GERRIT_COOKIE
 *   - CONFLUENCE_COOKIE
 *
 * 兼容 Kiro Power 与本地两种安装方式：
 *   扫描所有以 server 名结尾的 key（含 power-<name>-<server> 前缀），全部更新。
 *   一个都没找到时，自动创建本地路径 + Power 路径双份。
 *
 * 调用方式：
 *   ZMIND_API_KEY=xxx OPENGROK_USERNAME=zeasnrd OPENGROK_PASSWORD=yyy \
 *     node scripts/setup-creds.mjs
 *
 * 退出码：
 *   0 = 成功
 *   1 = 没有任何凭据需要写（env 为空）
 *   3 = 文件读写失败
 */

import { mkdir, readFile, writeFile, copyFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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

async function main() {
  const zmindKey = process.env.ZMIND_API_KEY?.trim() || "";
  const ogUser = process.env.OPENGROK_USERNAME?.trim() || "";
  const ogPass = process.env.OPENGROK_PASSWORD ?? "";

  const tasks = [];
  if (zmindKey) {
    tasks.push({ baseKey: "zmind-mcp-server", env: { ZMIND_API_KEY: zmindKey } });
    // knowledge-mcp 复用 zmind 凭据做 sync_zmind
    tasks.push({ baseKey: "knowledge-mcp-server", env: { ZMIND_API_KEY: zmindKey } });
  }
  if (ogUser || ogPass) {
    const env = {};
    if (ogUser) env.OPENGROK_USERNAME = ogUser;
    if (ogPass) env.OPENGROK_PASSWORD = ogPass;
    tasks.push({ baseKey: "opengrok-mcp-server", env });
  }

  if (tasks.length === 0) {
    process.stderr.write(
      "[setup-creds] 没有需要写入的凭据。请设置以下任一环境变量后重试：\n" +
        "  ZMIND_API_KEY=<40 位十六进制>\n" +
        "  OPENGROK_USERNAME=<账号>\n" +
        "  OPENGROK_PASSWORD=<密码>\n",
    );
    process.exit(1);
  }

  let backupPath;
  try {
    backupPath = await backupMcpJson();
  } catch (e) {
    process.stderr.write(`[setup-creds] 备份 mcp.json 失败: ${e.message}\n`);
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
    process.exit(3);
  }

  process.stderr.write(`[setup-creds] ✓ 完成。已更新 ${MCP_JSON_PATH}\n`);
  for (const { baseKey, hits } of allHits) {
    process.stderr.write(`[setup-creds]   ${baseKey} → ${hits.join(", ")}\n`);
  }
  if (backupPath) process.stderr.write(`[setup-creds]   备份: ${backupPath}\n`);
  process.stderr.write(
    "[setup-creds] 重启 Kiro（或重连 MCP server）以加载新凭据。\n" +
      "[setup-creds] 接下来跑 scripts/refresh-auth.{ps1,sh} 抓 Gerrit + Confluence cookie。\n",
  );
}

main().catch((e) => {
  process.stderr.write(`[setup-creds] 未预期错误: ${e?.stack || e}\n`);
  process.exit(1);
});
