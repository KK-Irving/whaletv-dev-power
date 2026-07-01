#!/usr/bin/env node
/**
 * gerrit-show — 显示 Gerrit change 的 diff / 文件列表（v3）
 *
 * 从 SoT (~/.ai/whaletv.yaml) 读凭据，通过 Gerrit REST API 拿：
 *   - commit message + unified diff（默认）
 *   - 只文件列表（-s / --files-only）
 *   - change metadata（-m / --meta）
 *
 * 用法：
 *   gerrit-show 12345                     显示 change 12345 的完整 diff
 *   gerrit-show 12345 -s                  只显示文件列表
 *   gerrit-show 12345 -m                  显示 metadata（subject / owner / branch / status）
 *   gerrit-show I1234567abcdef            按 Change-Id 查（不是 change number）
 *   gerrit-show 12345 --revision 3        指定 revision（默认 current）
 *   gerrit-show --help
 *
 * 输出：
 *   - 默认：commit message + unified diff（可直接管道到 patch / view）
 *   - -s：文件列表（一行一个，含状态 A/M/D + 路径）
 *   - -m：JSON metadata
 *
 * 优点（相对 `git show`）：
 *   - 无需本地 git clone
 *   - 通过 Gerrit REST API 直接拿，与 Gerrit 服务器状态一致
 *   - 快速查任意 change（含未合入 / 已 abandoned）
 *
 * 参考：agentengineeringframework/common/tools/bin/gerrit-show
 */

import fs from 'node:fs';
import { readSoT, getByPath, SOT_PATH } from './whaletv-credentials.mjs';

// ===== 复用 gerrit-api.mjs 的辅助函数 =====

function loadGerritConfig() {
  const { data } = readSoT();
  return {
    url: (getByPath(data, 'gerrit.url') || 'https://whale-gerrit.zeasn.com').replace(/\/+$/, ''),
    authHeader: getByPath(data, 'gerrit.auth_header') || '',
    cookie: getByPath(data, 'gerrit.cookie') || '',
    username: getByPath(data, 'gerrit.username') || '',
    password: getByPath(data, 'gerrit.http_password') || '',
    timeoutMs: 30_000,
  };
}

function decideAuthMode(cfg) {
  if (cfg.authHeader && cfg.cookie) return 'session';
  if (cfg.username && cfg.password) return 'basic';
  return 'missing';
}

function injectAuthPrefix(path, mode) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (mode === 'session') {
    if (normalized === '/a') return '/';
    if (normalized.startsWith('/a/')) return normalized.slice(2);
    return normalized;
  }
  if (normalized === '/a' || normalized.startsWith('/a/')) return normalized;
  return `/a${normalized}`;
}

function buildHeaders(cfg, mode, extra = {}) {
  const headers = { Accept: 'application/json', ...extra };
  if (mode === 'session') {
    headers.Authorization = cfg.authHeader;
    headers.Cookie = cfg.cookie;
  } else {
    const encoded = Buffer.from(`${cfg.username}:${cfg.password}`, 'utf8').toString('base64');
    headers.Authorization = `Basic ${encoded}`;
  }
  return headers;
}

function stripXssiPrefix(text) {
  const XSSI = ")]}'";
  if (text.startsWith(XSSI)) return text.slice(XSSI.length).replace(/^\s+/, '');
  return text;
}

async function gerritGet(cfg, mode, path, opts = {}) {
  const apiPath = injectAuthPrefix(path, mode);
  const url = cfg.url + apiPath;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(cfg, mode, opts.extraHeaders),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') exitError(`请求超时 (${cfg.timeoutMs}ms): ${url}`);
    exitError(`网络错误：${e.message} (url=${url})`);
  }
  clearTimeout(timer);

  const rawText = await res.text();

  if (!res.ok) {
    let hint = '';
    if (res.status === 401) {
      hint = mode === 'session'
        ? '\n  cookie 已过期。请运行 scripts/refresh-auth.{ps1,sh} 抓新 cookie。'
        : '\n  用户名或密码错。';
    } else if (res.status === 404) {
      hint = `\n  Change 不存在（url=${url}）。检查 change-id 是否正确。`;
    }
    exitError(`HTTP ${res.status} ${res.statusText}${hint}\n  ${rawText.slice(0, 500)}`);
  }

  return { rawText, headers: res.headers };
}

// ===== 参数解析 =====

function exitError(msg, code = 1) {
  process.stderr.write(`gerrit-show: error: ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = {
    changeId: null,
    revision: 'current',
    mode: 'diff', // diff | files | meta
    help: false,
    debug: false,
  };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '-h' || a === '--help') args.help = true;
    else if (a === '-s' || a === '--files-only') args.mode = 'files';
    else if (a === '-m' || a === '--meta') args.mode = 'meta';
    else if (a === '--revision') args.revision = rest[++i] || 'current';
    else if (a === '--debug') args.debug = true;
    else if (a.startsWith('-')) exitError(`未知参数：${a}`, 2);
    else if (args.changeId === null) args.changeId = a;
    else exitError(`多余的位置参数：${a}`, 2);
  }
  return args;
}

function printUsage() {
  console.log(`gerrit-show — Gerrit change diff / metadata 快速查看

SoT: ${SOT_PATH}

用法：
  gerrit-show <change-id>                 显示完整 diff（commit message + unified diff）
  gerrit-show <change-id> -s              只文件列表
  gerrit-show <change-id> -m              JSON metadata（subject / owner / branch / status）
  gerrit-show <change-id> --revision <n>  指定 revision 编号（默认 current）

<change-id> 可以是：
  - Change 数字 ID（如 12345，最简单）
  - Change-Id 字符串（如 I1234567abcdef...，40 hex）
  - project~branch~Change-Id（三元组，含项目/分支歧义时用）

参数：
  -s, --files-only         只显示文件列表（含 A/M/D 状态 + 路径）
  -m, --meta               显示 JSON metadata
  --revision <ref>         指定 revision（默认 current）
  --debug                  stderr 打印请求详情
  -h, --help               显示帮助

示例：
  gerrit-show 12345 | less              分页查看完整 diff
  gerrit-show 12345 -s                  快速看改了哪些文件
  gerrit-show 12345 -m | jq .subject   拿 change 标题

优点：
  - 无需本地 git clone；Gerrit REST 直接拿
  - 对任何 change 都能看（未合入 / abandoned / draft 都行）
  - 输出可直接管道到 less / patch / diff2html

退出码：
  0 = 成功
  1 = HTTP 错误 / 网络错误 / 认证失败 / change 不存在
  2 = 参数错误
`);
}

// ===== 输出格式化 =====

function decodePatchBase64(base64) {
  // Gerrit /revisions/*/patch 返回 base64 编码的 mbox 格式
  return Buffer.from(base64.replace(/\s+/g, ''), 'base64').toString('utf8');
}

function formatFilesList(filesJson) {
  // filesJson 是 { path: { status?, lines_inserted?, lines_deleted?, ... } }
  // status 缺省 = M
  const lines = [];
  for (const [path, info] of Object.entries(filesJson)) {
    if (path === '/COMMIT_MSG') continue; // 排除虚拟 commit msg 文件
    const status = info.status || 'M';
    const ins = info.lines_inserted || 0;
    const del = info.lines_deleted || 0;
    const diff = (ins || del) ? ` (+${ins}/-${del})` : '';
    lines.push(`${status}\t${path}${diff}`);
  }
  return lines.sort().join('\n');
}

// ===== 主流程 =====

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printUsage();
    process.exit(0);
  }
  if (!args.changeId) {
    exitError('缺少 <change-id> 参数。用 --help 查看用法。', 2);
  }

  const cfg = loadGerritConfig();
  const mode = decideAuthMode(cfg);
  if (mode === 'missing') {
    process.stderr.write(
      `gerrit-show: error: SoT 中缺少 Gerrit 凭据。\n` +
      `  SoT: ${SOT_PATH}\n` +
      `  跑 scripts/refresh-auth.{ps1,sh} 抓 session cookie，或 whaletv-credentials set 手动填入。\n`,
    );
    process.exit(1);
  }

  const encodedId = encodeURIComponent(args.changeId);

  if (args.mode === 'meta') {
    const { rawText } = await gerritGet(cfg, mode, `/changes/${encodedId}/detail`, {
      debug: args.debug,
    });
    const stripped = stripXssiPrefix(rawText);
    try {
      const parsed = JSON.parse(stripped);
      process.stdout.write(JSON.stringify(parsed, null, 2) + '\n');
    } catch {
      process.stdout.write(stripped + '\n');
    }
    return;
  }

  if (args.mode === 'files') {
    const { rawText } = await gerritGet(cfg, mode, `/changes/${encodedId}/revisions/${args.revision}/files`);
    const stripped = stripXssiPrefix(rawText);
    let parsed;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      exitError('响应不是 JSON');
    }
    const formatted = formatFilesList(parsed);
    if (formatted) process.stdout.write(formatted + '\n');
    return;
  }

  // 默认 mode: diff — 拿完整 patch（base64 mbox 格式）
  // Gerrit patch endpoint 返回 base64 编码的完整 mbox（含 commit message + diff）
  const { rawText, headers } = await gerritGet(cfg, mode, `/changes/${encodedId}/revisions/${args.revision}/patch`);

  // 该 endpoint 不使用 XSSI 前缀（不是 JSON），但 Gerrit 有些版本仍会加，兜底剥离
  const stripped = stripXssiPrefix(rawText);

  // 判断是否 base64 编码（依据 header 或者内容）
  const encoding = headers.get('X-FYI-Content-Encoding') || '';
  let patchText;
  if (encoding === 'base64' || /^[A-Za-z0-9+/=\s]+$/.test(stripped.slice(0, 200))) {
    try {
      patchText = decodePatchBase64(stripped);
    } catch {
      patchText = stripped; // 万一 decode 失败，原样输出
    }
  } else {
    patchText = stripped;
  }

  process.stdout.write(patchText);
  if (!patchText.endsWith('\n')) process.stdout.write('\n');
}

main().catch(e => {
  exitError(`未预期错误：${e.stack || e.message || e}`);
});
