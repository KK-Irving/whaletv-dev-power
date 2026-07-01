#!/usr/bin/env node
/**
 * gerrit-api — Gerrit REST API 通用客户端 CLI（v3）
 *
 * 从 SoT (~/.ai/whaletv.yaml) 读凭据，支持双通道认证：
 *   - session 模式（首选，公司部署走 nginx + Gerrit 双层）：gerrit.auth_header + gerrit.cookie
 *   - basic 模式（备选，无 nginx）：gerrit.username + gerrit.http_password
 *
 * 用法：
 *   gerrit-api "/changes/?q=owner:xxx+status:open&n=5"
 *   gerrit-api "/changes/<id>/detail"
 *   gerrit-api "/changes/<id>/revisions/current/review" -d '{"message":"LGTM"}'
 *   gerrit-api "/changes/<id>/revisions/current/review" -d @body.json
 *   gerrit-api "/changes/<id>/reviewers/<email>" --method DELETE
 *   gerrit-api --help
 *
 * 输出：
 *   - 成功：pretty-printed JSON 到 stdout
 *   - 失败：human-readable 错误到 stderr + exit code 1
 *
 * 特性：
 *   - 自动 XSSI 前缀 `)]}'` 剥离
 *   - 按认证模式自动决定 /a/ 前缀（session 走 non-/a/、basic 走 /a/）
 *   - 401 时给出针对性诊断（cookie 过期 → 建议跑 refresh-auth）
 *   - 空响应体（204 等）输出空字符串到 stdout
 *
 * 参考：agentengineeringframework/common/tools/bin/gerrit-api
 */

import fs from 'node:fs';
import { readSoT, getByPath, SOT_PATH } from './whaletv-credentials.mjs';

// ===== 配置读取 =====

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

// ===== 路径 & headers =====

function injectAuthPrefix(path, mode) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (mode === 'session') {
    // session 走 non-/a/，如果传入含 /a/ 就剥掉
    if (normalized === '/a') return '/';
    if (normalized.startsWith('/a/')) return normalized.slice(2);
    return normalized;
  }
  // basic：注入 /a/
  if (normalized === '/a' || normalized.startsWith('/a/')) return normalized;
  return `/a${normalized}`;
}

function buildHeaders(cfg, mode) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
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

// ===== 参数解析 =====

function parseArgs(argv) {
  const args = {
    path: null,
    method: null, // 未指定时按有无 -d 自动决定 GET/POST
    body: null,
    help: false,
    debug: false,
  };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '-h' || a === '--help') {
      args.help = true;
    } else if (a === '-d' || a === '--data') {
      const val = rest[++i];
      if (val === undefined) exitError('缺少 -d 参数值', 2);
      if (val.startsWith('@')) {
        // @file.json
        const file = val.slice(1);
        try {
          args.body = fs.readFileSync(file, 'utf8');
        } catch (e) {
          exitError(`读取 body 文件失败：${e.message}`, 2);
        }
      } else {
        args.body = val;
      }
    } else if (a === '-X' || a === '--method') {
      args.method = (rest[++i] || '').toUpperCase();
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(args.method)) {
        exitError(`不支持的 method: ${args.method}`, 2);
      }
    } else if (a === '--debug') {
      args.debug = true;
    } else if (a.startsWith('-')) {
      exitError(`未知参数：${a}`, 2);
    } else if (args.path === null) {
      args.path = a;
    } else {
      exitError(`多余的位置参数：${a}`, 2);
    }
  }
  return args;
}

function exitError(msg, code = 1) {
  process.stderr.write(`gerrit-api: error: ${msg}\n`);
  process.exit(code);
}

function printUsage() {
  console.log(`gerrit-api — Gerrit REST API 通用客户端

SoT: ${SOT_PATH}

用法：
  gerrit-api <path>                       GET（默认）
  gerrit-api <path> -d '<json>'           POST（含 -d 时默认）
  gerrit-api <path> -d @file.json         从文件读 body
  gerrit-api <path> -X PUT -d '<json>'    显式 PUT
  gerrit-api <path> -X DELETE             DELETE

参数：
  -d, --data <json|@file>    请求体（JSON 字符串或 @文件）
  -X, --method <M>           HTTP method（GET / POST / PUT / DELETE）
  --debug                    打印请求详情到 stderr
  -h, --help                 显示帮助

示例：
  gerrit-api "/changes/?q=owner:winn.wei+status:open&n=5"
  gerrit-api "/changes/123/detail"
  gerrit-api "/changes/123/revisions/current/review" -d '{"message":"LGTM"}'
  gerrit-api "/changes/123/reviewers" -d '{"reviewer":"alice@example.com"}'
  gerrit-api "/changes/123/reviewers/alice@example.com" -X DELETE

认证：
  优先 session 模式（gerrit.auth_header + gerrit.cookie），过公司 nginx 双层认证
  备选 basic 模式（gerrit.username + gerrit.http_password），直连 Gerrit
  cookie 过期时跑 scripts/refresh-auth.{ps1,sh} 抓新 cookie

退出码：
  0 = 成功
  1 = HTTP 错误 / 网络错误 / 超时 / 凭据无效
  2 = 参数错误
`);
}

// ===== 主流程 =====

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printUsage();
    process.exit(0);
  }
  if (!args.path) {
    exitError('缺少 <path> 参数。用 --help 查看用法。', 2);
  }

  const cfg = loadGerritConfig();
  const mode = decideAuthMode(cfg);
  if (mode === 'missing') {
    process.stderr.write(
      `gerrit-api: error: SoT 中缺少 Gerrit 凭据。\n` +
      `  SoT: ${SOT_PATH}\n` +
      `  需要以下任一组：\n` +
      `    - gerrit.auth_header + gerrit.cookie（session 模式，推荐）\n` +
      `    - gerrit.username + gerrit.http_password（basic 模式）\n` +
      `  跑 scripts/refresh-auth.{ps1,sh} 抓 session cookie，或 whaletv-credentials set 手动填入。\n`,
    );
    process.exit(1);
  }

  const apiPath = injectAuthPrefix(args.path, mode);
  const url = cfg.url + apiPath;
  const method = args.method || (args.body !== null ? 'POST' : 'GET');
  const headers = buildHeaders(cfg, mode);

  if (args.debug) {
    process.stderr.write(`[debug] mode=${mode}\n`);
    process.stderr.write(`[debug] ${method} ${url}\n`);
    process.stderr.write(`[debug] headers: ${JSON.stringify(Object.keys(headers))}\n`);
    if (args.body) process.stderr.write(`[debug] body: ${args.body.slice(0, 200)}${args.body.length > 200 ? '...' : ''}\n`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: args.body !== null ? args.body : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      exitError(`请求超时 (${cfg.timeoutMs}ms): ${url}`);
    }
    exitError(`网络错误：${e.message} (url=${url})`);
  }
  clearTimeout(timer);

  const rawText = await res.text();
  const body = stripXssiPrefix(rawText);

  if (!res.ok) {
    let hint = '';
    if (res.status === 401) {
      hint = mode === 'session'
        ? '\n  cookie 已过期。请运行 scripts/refresh-auth.{ps1,sh} 抓新 cookie。'
        : '\n  用户名或密码错。检查 whaletv-credentials get gerrit.username / gerrit.http_password。';
    } else if (res.status === 403) {
      hint = '\n  当前用户对该资源无权限（或需要额外的 Gerrit ACL）。';
    } else if (res.status === 404) {
      hint = '\n  路径不存在。检查 change-id / project 名字大小写。';
    }
    process.stderr.write(
      `gerrit-api: HTTP ${res.status} ${res.statusText}${hint}\n` +
      `  ${body.slice(0, 500)}${body.length > 500 ? '...' : ''}\n`,
    );
    process.exit(1);
  }

  if (!body) {
    // 空响应（如 204 DELETE 成功）
    return;
  }

  // 尝试 JSON 化输出；否则原样输出
  try {
    const parsed = JSON.parse(body);
    process.stdout.write(JSON.stringify(parsed, null, 2) + '\n');
  } catch {
    process.stdout.write(body + '\n');
  }
}

main().catch(e => {
  exitError(`未预期错误：${e.stack || e.message || e}`);
});
