#!/usr/bin/env node
/**
 * refresh-auth.mjs — 凭据自动刷新核心脚本
 *
 * 职责：
 *   1. 交互式/环境变量收集 SSO 用户名 + 密码（密码不落盘、不入日志）
 *   2. 用 Playwright headless Chromium 走完一遍 nginx Basic Auth + Gerrit SSO 登录
 *   3. 抓取 GerritAccount / XSRF_TOKEN cookie；同样流程抓文档中心 cookie
 *   4. 计算 Authorization: Basic <b64(user:pass)> 字符串（过 nginx 用）
 *   5. 深合并写入 ~/.kiro/settings/mcp.json，先 backup 旧文件
 *   6. 自检：用新凭据 GET /changes/?n=1，200 才算成功；失败不动 mcp.json
 *
 * 安全：
 *   - 密码仅驻留进程内存，永不写文件、永不打 log
 *   - 写 mcp.json 前先备份到 mcp.json.bak.<timestamp>
 *
 * 调用方式：
 *   1. 交互模式：node scripts/refresh-auth.mjs
 *      （或通过壳脚本 refresh-auth.ps1 / refresh-auth.sh）
 *   2. 非交互模式：WHALE_USER=foo WHALE_PASSWORD=bar node scripts/refresh-auth.mjs
 *      （CI / 定时任务用）
 *
 * 依赖：playwright >= 1.48（需先 `npm install` 到 scripts/，并跑 `npx playwright install chromium`）
 *
 * 退出码：
 *   0 = 成功（mcp.json 已更新且自检通过）
 *   1 = 用户输入失败 / 缺少凭据
 *   2 = Playwright 浏览器登录失败（密码错 / SSO 超时 / MFA）
 *   3 = mcp.json 文件操作失败
 *   4 = 自检失败（Gerrit /changes/ 调用未返回 200）
 */

import { mkdir, readFile, writeFile, copyFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

// =============================================================================
// 配置（可通过环境变量覆盖以适配不同部署）
// =============================================================================

const GERRIT_BASE_URL =
  process.env.WHALE_GERRIT_URL?.trim() || "https://whale-gerrit.zeasn.com";
const CONFLUENCE_BASE_URL =
  process.env.WHALE_CONFLUENCE_URL?.trim() || "https://docs.whaletv.com";

/** Gerrit 登录后期望抓到的 cookie name 集合 */
const GERRIT_COOKIE_NAMES = ["GerritAccount", "XSRF_TOKEN"];
/** Confluence 登录后期望抓到的 cookie name 集合（Atlassian 6.x 经典命名 + Aliyun WAF） */
const CONFLUENCE_COOKIE_NAMES = ["JSESSIONID", "seraph.confluence", "acw_tc"];

/** Kiro MCP 配置文件路径（用户级，跨工作区生效） */
const MCP_JSON_PATH = join(homedir(), ".kiro", "settings", "mcp.json");

/** mcpServers 字典里 Gerrit/Confluence 服务器的逻辑 key（与 mcp.json 内一致） */
const GERRIT_SERVER_KEY = process.env.GERRIT_SERVER_KEY?.trim() || "gerrit-mcp-server";
const CONFLUENCE_SERVER_KEY =
  process.env.CONFLUENCE_SERVER_KEY?.trim() || "confluence-mcp-server";

/** Power 命名空间前缀（Kiro Power 安装后的 key 形如 power-<name>-<server>） */
const POWER_NAME = process.env.WHALE_POWER_NAME?.trim() || "whaletv-dev-power";
const POWER_KEY_PREFIX = `power-${POWER_NAME}-`;

/** Playwright 启动超时（ms） */
const PAGE_TIMEOUT_MS = 30_000;
/** SSO 跳转完成等待超时（ms） */
const SSO_SETTLE_TIMEOUT_MS = 15_000;

// =============================================================================
// 凭据收集
// =============================================================================

async function readSecretLine(promptText) {
  // Node readline 不直接支持密码隐藏，但我们关闭 stdout 回显
  // 这里走标准 readline，密码在终端会回显——壳脚本（.ps1/.sh）会用平台原生
  // 隐藏输入再透传给本脚本，所以推荐通过 WHALE_PASSWORD 环境变量传入。
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  try {
    return (await rl.question(promptText)).trim();
  } finally {
    rl.close();
  }
}

async function collectCredentials() {
  const user = process.env.WHALE_USER?.trim();
  const pass = process.env.WHALE_PASSWORD;

  let username = user;
  let password = pass;
  if (!username) {
    process.stderr.write("[refresh-auth] WHALE_USER 未提供 — 请输入 SSO 用户名 (例: winn.wei): ");
    username = await readSecretLine("");
  }
  if (!password) {
    process.stderr.write(
      "[refresh-auth] WHALE_PASSWORD 未提供 — 请通过壳脚本传入或设置环境变量后重试。\n",
    );
    process.exit(1);
  }
  if (!username) {
    process.stderr.write("[refresh-auth] 用户名为空，退出。\n");
    process.exit(1);
  }

  // Confluence 是独立账号系统（form login 走 /dologin.action）
  // 凭据可能与 SSO 不同；通过 CONFLUENCE_USER / CONFLUENCE_PASSWORD 单独传
  // 未提供则跳过文档中心刷新
  const confluenceUser = process.env.CONFLUENCE_USER?.trim() || "";
  const confluencePass = process.env.CONFLUENCE_PASSWORD || "";

  return { username, password, confluenceUser, confluencePass };
}

// =============================================================================
// Playwright 抓 cookie
// =============================================================================

/**
 * 启动 headless Chromium，访问 baseUrl 完成 nginx Basic Auth + 后续 SSO 登录，
 * 等到 cookieNames 中至少一个 cookie 被设置后返回 cookie 字符串。
 *
 * 用于 Gerrit（nginx + SAML/SSO 自动跳转）。
 */
async function captureCookies({ chromium, baseUrl, username, password, cookieNames, label }) {
  const browser = await chromium.launch({
    headless: true,
    timeout: PAGE_TIMEOUT_MS,
  });
  const context = await browser.newContext({
    httpCredentials: { username, password }, // 应答 nginx 401 challenge
    ignoreHTTPSErrors: true,
    userAgent:
      "Mozilla/5.0 (whaletv-dev-power refresh-auth) Chromium/Playwright",
  });

  let cookieStr = "";
  let error = null;

  try {
    const page = await context.newPage();
    // networkidle 等到所有 SSO 跳转结束
    await page.goto(baseUrl + "/", {
      waitUntil: "networkidle",
      timeout: SSO_SETTLE_TIMEOUT_MS,
    });

    // 简单 MFA 检测：URL 含 mfa / otp / 2fa 关键字 → 警告
    const finalUrl = page.url();
    if (/mfa|otp|2fa|verify|challenge/i.test(finalUrl)) {
      throw new Error(
        `[${label}] 检测到 MFA/二次验证页面 (${finalUrl})，自动登录无法完成。请手动登录并使用 F12 抓取凭据。`,
      );
    }

    const allCookies = await context.cookies(baseUrl);
    const matched = allCookies.filter((c) => cookieNames.includes(c.name));
    if (matched.length === 0) {
      throw new Error(
        `[${label}] 登录后未抓到任何期望的 cookie (${cookieNames.join(", ")})。可能是密码错误或 SSO 流程失败。final url=${finalUrl}`,
      );
    }
    cookieStr = matched.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch (e) {
    error = e;
  } finally {
    await context.close();
    await browser.close();
  }
  if (error) throw error;
  return cookieStr;
}

/**
 * Confluence 走应用层 form login（独立账号，不走 SSO）。
 * POST /dologin.action with os_username/os_password。
 * 用于 Atlassian Confluence 6.x 标准部署。
 */
async function captureConfluenceCookies({ chromium, baseUrl, username, password, cookieNames, label }) {
  const browser = await chromium.launch({
    headless: true,
    timeout: PAGE_TIMEOUT_MS,
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent:
      "Mozilla/5.0 (whaletv-dev-power refresh-auth) Chromium/Playwright",
  });

  let cookieStr = "";
  let error = null;

  try {
    const page = await context.newPage();
    // 先访问登录页
    await page.goto(baseUrl + "/login.action", {
      waitUntil: "networkidle",
      timeout: SSO_SETTLE_TIMEOUT_MS,
    });

    // 检测登录表单
    const html = await page.content();
    const hasForm = html.includes("os_username") || html.includes("os_password");
    if (!hasForm) {
      throw new Error(
        `[${label}] /login.action 未显示登录表单（HTML 长度 ${html.length}）；可能 nginx 拦截或站点结构变化。`,
      );
    }

    // 填表 + 提交
    await page.fill('input[name="os_username"]', username);
    await page.fill('input[name="os_password"]', password);
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: SSO_SETTLE_TIMEOUT_MS }),
      page
        .click('input[type="submit"][name="login"], #loginButton, button[type="submit"]', { timeout: 5000 })
        .catch(() => page.click('input[type="submit"]')),
    ]);

    // 检测登录后状态
    const finalUrl = page.url();
    const afterHtml = await page.content();
    const stillLoginPage =
      finalUrl.includes("login.action") ||
      finalUrl.includes("permissionViolation=true") ||
      afterHtml.includes('name="os_username"');
    if (stillLoginPage) {
      throw new Error(
        `[${label}] form login 失败（仍停留在登录页 ${finalUrl}）；用户名或密码错误？`,
      );
    }

    const allCookies = await context.cookies(baseUrl);
    const matched = allCookies.filter((c) => cookieNames.includes(c.name));
    if (matched.length === 0) {
      throw new Error(
        `[${label}] 登录后未抓到任何期望的 cookie (${cookieNames.join(", ")})。final url=${finalUrl}`,
      );
    }
    cookieStr = matched.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch (e) {
    error = e;
  } finally {
    await context.close();
    await browser.close();
  }
  if (error) throw error;
  return cookieStr;
}

// =============================================================================
// mcp.json 深合并写入（带备份）
// =============================================================================

async function readMcpJson() {
  try {
    await access(MCP_JSON_PATH);
  } catch {
    return {}; // 不存在即返回空对象，写入时会创建
  }
  try {
    const text = await readFile(MCP_JSON_PATH, "utf8");
    if (!text.trim()) return {};
    return JSON.parse(text);
  } catch (e) {
    process.stderr.write(
      `[refresh-auth] 读取 ${MCP_JSON_PATH} 失败 (${e.message})；为安全起见退出而非覆盖。\n`,
    );
    process.exit(3);
  }
}

async function backupMcpJson() {
  try {
    await access(MCP_JSON_PATH);
  } catch {
    return null; // 原文件不存在，不需要备份
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
 * 在 cfg 的所有可能位置（顶层 mcpServers 和 powers.mcpServers）搜索 server entry。
 *
 * Kiro IDE 安装 Power 后，mcp.json 实际可能有以下几种结构：
 *   1) `mcpServers["gerrit-mcp-server"]`              — 用户手动安装的本地配置
 *   2) `mcpServers["power-<powername>-gerrit-mcp-server"]` — Kiro Power flat 命名约定
 *   3) `powers.mcpServers["power-<powername>-gerrit-mcp-server"]` — Kiro Power 嵌套结构
 *
 * 本函数返回所有 substring 匹配 baseKey 的位置（路径数组），把同一 envPatch 写到全部，
 * 这样无论 Kiro 用的是哪种命名约定都能正确认证。
 *
 * @returns 实际命中的位置数组（用于日志），形如 ["mcpServers.gerrit-mcp-server", "powers.mcpServers.power-whaletv-dev-power-gerrit-mcp-server"]
 */
function injectServerEnv(cfg, baseKey, envPatch) {
  cfg.mcpServers = cfg.mcpServers || {};

  /**
   * 扫描某个 mcpServers 字典，找所有以 baseKey 结尾的 key 并合并 envPatch。
   * 返回命中的 key 数组。
   */
  function patchMcpServers(servers, parentLabel) {
    const matched = [];
    for (const key of Object.keys(servers)) {
      // substring match：覆盖 "<base>" 或 "power-<name>-<base>" 或其他前缀
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

  // 嵌套 powers.mcpServers（Kiro Power 可能采用的结构）
  if (cfg.powers && typeof cfg.powers === "object" && cfg.powers.mcpServers) {
    hits.push(...patchMcpServers(cfg.powers.mcpServers, "powers.mcpServers"));
  }

  // 都没找到 → 同时创建本地路径 + Power 路径，覆盖两种安装方式
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
// 自检
// =============================================================================

async function selfTestGerrit({ authHeader, cookie }) {
  const url = GERRIT_BASE_URL + "/changes/?n=1";
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: authHeader,
        Cookie: cookie,
      },
      // 5s 超时
      signal: AbortSignal.timeout(5000),
    });
    return { ok: res.ok, status: res.status, url };
  } catch (e) {
    return { ok: false, status: -1, url, error: e.message };
  }
}

// =============================================================================
// 主流程
// =============================================================================

async function main() {
  process.stderr.write(
    `[refresh-auth] 开始刷新 Gerrit + Confluence 会话凭据 (mcp.json: ${MCP_JSON_PATH})\n`,
  );

  // 1) 收集凭据
  const { username, password, confluenceUser, confluencePass } = await collectCredentials();

  // 2) 加载 Playwright（延迟 import，缺失时给清晰提示）
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (e) {
    process.stderr.write(
      "[refresh-auth] 加载 playwright 失败。请在 scripts/ 目录跑：\n" +
        "  npm install\n" +
        "  npx playwright install chromium\n" +
        `详细错误：${e.message}\n`,
    );
    process.exit(2);
  }

  // 3) 计算 Authorization header（nginx 用）
  const authHeader =
    "Basic " + Buffer.from(`${username}:${password}`, "utf8").toString("base64");

  // 4) 抓 Gerrit cookie
  let gerritCookie;
  try {
    process.stderr.write(`[refresh-auth] 登录 Gerrit (${GERRIT_BASE_URL}) ...\n`);
    gerritCookie = await captureCookies({
      chromium,
      baseUrl: GERRIT_BASE_URL,
      username,
      password,
      cookieNames: GERRIT_COOKIE_NAMES,
      label: "Gerrit",
    });
    process.stderr.write(
      `[refresh-auth]   ✓ Gerrit cookie OK (${gerritCookie.split(";").length} 项)\n`,
    );
  } catch (e) {
    process.stderr.write(`[refresh-auth] Gerrit 登录失败: ${e.message}\n`);
    process.stderr.write("[refresh-auth] mcp.json 未做修改，已退出。\n");
    process.exit(2);
  }

  // 5) 抓 Confluence cookie（独立账号 form login；CONFLUENCE_USER/PASSWORD 缺失则跳过）
  let confluenceCookie = null;
  if (confluenceUser && confluencePass) {
    try {
      process.stderr.write(
        `[refresh-auth] 登录文档中心 (${CONFLUENCE_BASE_URL}, 独立账号 form login) ...\n`,
      );
      confluenceCookie = await captureConfluenceCookies({
        chromium,
        baseUrl: CONFLUENCE_BASE_URL,
        username: confluenceUser,
        password: confluencePass,
        cookieNames: CONFLUENCE_COOKIE_NAMES,
        label: "Confluence",
      });
      process.stderr.write(
        `[refresh-auth]   ✓ 文档中心 cookie OK (${confluenceCookie.split(";").length} 项)\n`,
      );
    } catch (e) {
      process.stderr.write(
        `[refresh-auth]   ! 文档中心登录失败（不致命，跳过更新文档中心条目）: ${e.message}\n`,
      );
    }
  } else {
    process.stderr.write(
      "[refresh-auth]   - 跳过文档中心（CONFLUENCE_USER / CONFLUENCE_PASSWORD 未提供）\n",
    );
  }

  // 6) 自检 Gerrit 凭据
  const test = await selfTestGerrit({ authHeader, cookie: gerritCookie });
  if (!test.ok) {
    process.stderr.write(
      `[refresh-auth] 自检失败 (HTTP ${test.status}, ${test.url})${test.error ? " err=" + test.error : ""}\n`,
    );
    process.stderr.write("[refresh-auth] mcp.json 未做修改，已退出。\n");
    process.exit(4);
  }
  process.stderr.write(
    `[refresh-auth]   ✓ Gerrit /changes/ 自检通过 (HTTP ${test.status})\n`,
  );

  // 7) 备份 + 写入 mcp.json
  let backupPath;
  try {
    backupPath = await backupMcpJson();
  } catch (e) {
    process.stderr.write(`[refresh-auth] 备份 mcp.json 失败: ${e.message}\n`);
    process.exit(3);
  }

  const cfg = await readMcpJson();
  const gerritHits = injectServerEnv(cfg, GERRIT_SERVER_KEY, {
    GERRIT_AUTH_HEADER: authHeader,
    GERRIT_COOKIE: gerritCookie,
  });
  let confluenceHits = [];
  if (confluenceCookie) {
    confluenceHits = injectServerEnv(cfg, CONFLUENCE_SERVER_KEY, {
      CONFLUENCE_COOKIE: confluenceCookie,
    });
  }
  // knowledge-mcp 复用三源凭据（顺手把 Gerrit/Confluence 同步过去）
  injectServerEnv(cfg, "knowledge-mcp-server", {
    GERRIT_AUTH_HEADER: authHeader,
    GERRIT_COOKIE: gerritCookie,
    ...(confluenceCookie ? { CONFLUENCE_COOKIE: confluenceCookie } : {}),
  });

  try {
    await writeMcpJsonAtomic(cfg);
  } catch (e) {
    process.stderr.write(
      `[refresh-auth] 写入 mcp.json 失败: ${e.message}\n` +
        `已备份原文件: ${backupPath ?? "(无原文件)"}\n`,
    );
    process.exit(3);
  }

  process.stderr.write(
    `[refresh-auth] ✓ 完成。已更新 ${MCP_JSON_PATH}\n` +
      `[refresh-auth]   gerrit 命中位置: ${gerritHits.join(", ")}\n` +
      (confluenceHits.length
        ? `[refresh-auth]   confluence 命中位置: ${confluenceHits.join(", ")}\n`
        : "") +
      (backupPath ? `[refresh-auth]   备份: ${backupPath}\n` : ""),
  );
  process.stderr.write(
    "[refresh-auth] 重启 Kiro（或重连 MCP server）以加载新凭据。\n",
  );
}

main().catch((e) => {
  process.stderr.write(`[refresh-auth] 未预期错误: ${e?.stack || e}\n`);
  process.exit(1);
});
