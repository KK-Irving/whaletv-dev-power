#!/usr/bin/env node
/**
 * whaletv-credentials — 单一凭据源（SoT）读写 CLI + module
 *
 * SoT 位置：~/.ai/whaletv.yaml
 * Schema：见 templates/whaletv.yaml.tmpl 与 .kiro/specs/v3-platform-upgrade/design.md
 *
 * 命令：
 *   whaletv-credentials get <dotted.key>          输出纯值到 stdout（无回车前缀）
 *   whaletv-credentials set <dotted.key> <value>  更新单个字段（备份 + chmod 0600）
 *   whaletv-credentials check                     校验必需字段（不完整时 exit 1）
 *   whaletv-credentials list                      列出所有已配置键（不含值）
 *   whaletv-credentials path                      打印 SoT 文件绝对路径
 *   whaletv-credentials init                      交互创建 SoT（若已存在则拒绝）
 *   whaletv-credentials migrate                   从 mcp.json 一次性迁移到 SoT
 *
 * 也可作为 module 使用（setup-creds.mjs / refresh-auth.mjs 通过 import 复用）：
 *   import { readSoT, writeSoT, setByPath, SOT_PATH } from './whaletv-credentials.mjs';
 *
 * 设计原则：
 *   - 零第三方依赖（不引 js-yaml 是刻意的，避免让 SoT 读取依赖 npm install）
 *   - 只支持 flat + 两层嵌套（zmind.api_key / gerrit.cookie / s3_issue_analysis.bucket）
 *   - 不支持复杂 YAML 特性（block scalars、锚点、多行字符串、注释保留）
 *     → 因此对 SoT 的手编辑有约束：值不含冒号/引号时可裸写，否则用双引号
 *   - 密码/token 允许含任意 ASCII 字符，通过双引号 + JSON.parse 兼容转义
 *
 * 参考：agentengineeringframework/common/tools/bin/ai-credentials 的设计
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

// ===== 常量 =====

const SOT_DIR = path.join(os.homedir(), '.ai');
const SOT_PATH = path.join(SOT_DIR, 'whaletv.yaml');
const MAX_BACKUPS = 3;

const REQUIRED_KEYS_FOR_CHECK = [
  'zmind.api_key',
  'opengrok.username',
  'opengrok.password',
];

// 至少要有其中一组（Gerrit session 模式 OR basic 模式）
const GERRIT_MODE_A = ['gerrit.auth_header', 'gerrit.cookie'];
const GERRIT_MODE_B = ['gerrit.username', 'gerrit.http_password'];

// 可选字段（缺失不算错，只提示）
const OPTIONAL_KEYS = [
  'confluence.cookie',
  'confluence.username',
  'confluence.password',
  '_meta.email',
];

// ===== YAML 极简读写（仅支持本 SoT schema）=====

/**
 * 解析 flat + 两层嵌套 YAML。返回 { data, order }：
 *   data — 嵌套对象（如 { zmind: { api_key: 'xxx' } }）
 *   order — 顶层键的原序（用于 write 时保序）
 *
 * 支持格式：
 *   # 注释行（丢弃，写入时不保留）
 *   key: value                       — flat scalar
 *   key: "value with : special"     — 带引号（内容用 JSON.parse 解析转义）
 *   key:                             — 嵌套开始
 *     child: value                   — 缩进（2 空格）
 *
 * 不支持：多行 scalar、锚点/别名、复杂类型、注释保留、三层以上嵌套
 */
function parseYaml(text) {
  // 剥离 UTF-8 BOM（Windows 上一些工具如 PowerShell Set-Content -Encoding UTF8 会加 BOM）
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  const data = {};
  const order = [];
  let currentTopKey = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // 剥离行尾注释（简单实现：不在引号内的第一个 # 之后）
    let line = stripInlineComment(raw);
    if (!line.trim()) continue;
    if (line.trim().startsWith('#')) continue;

    // 缩进探测
    const indent = line.match(/^(\s*)/)[0].length;
    const stripped = line.slice(indent);

    if (indent === 0) {
      // 顶层键
      const m = stripped.match(/^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const rest = m[2];
      if (!(key in data)) order.push(key);
      if (rest === '' || rest === '~' || rest === 'null') {
        // 后续可能是嵌套
        data[key] = data[key] || {};
        currentTopKey = key;
      } else {
        data[key] = parseScalar(rest);
        currentTopKey = null; // 顶层是 scalar，不进入嵌套
      }
    } else if (indent === 2 && currentTopKey !== null) {
      const m = stripped.match(/^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const rest = m[2];
      if (typeof data[currentTopKey] !== 'object') {
        data[currentTopKey] = {};
      }
      data[currentTopKey][key] = parseScalar(rest);
    }
    // 更深的缩进忽略（schema 不支持）
  }

  return { data, order };
}

/**
 * 剥离行内 # 注释（非常简单，只在非引号区起效）
 */
function stripInlineComment(line) {
  let inSingle = false, inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble) {
      // 允许 # 前必须是空白（否则可能是值的一部分）
      if (i > 0 && /\s/.test(line[i - 1])) return line.slice(0, i).replace(/\s+$/, '');
    }
  }
  return line;
}

function parseScalar(raw) {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '~' || trimmed === 'null') return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  // 数字（严格）
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  // 双引号字符串：用 JSON.parse 处理转义
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fallback：直接剥引号
      return trimmed.slice(1, -1);
    }
  }
  // 单引号：直接剥引号（YAML 语义：不解释转义，但我们简化）
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  // 占位符如 <YOUR_ZMIND_API_KEY> —— 视为未设置
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return '';
  return trimmed;
}

/**
 * 把值序列化成 YAML scalar。策略：
 *   - 空/undefined/null → 空
 *   - boolean/number → 直接输出
 *   - 字符串：如果含冒号/井号/开头字符敏感 → 用双引号 + JSON.stringify 转义
 *              否则裸写
 */
function serializeScalar(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  // 需要引号的情况
  const needQuote = /[:#'"\\]/.test(s)
    || /^\s|\s$/.test(s)
    || /^[!&*|>%@`]|^-\s|^\?\s|^:\s/.test(s)
    || s.length === 0;
  if (needQuote) return JSON.stringify(s);
  return s;
}

function writeYaml(data, order) {
  const lines = [];
  lines.push('# whaletv-dev-power 单一凭据源（Single Source of Truth）');
  lines.push('# 位置：~/.ai/whaletv.yaml');
  lines.push('# 权限：0600（Linux/macOS）');
  lines.push('# 读取：whaletv-credentials get <dotted.key>');
  lines.push('# 由 scripts/whaletv-credentials.mjs 管理，手动编辑请保持双层嵌套结构');
  lines.push('');

  // 保序遍历：先按 order 数组，再补漏
  const seen = new Set();
  const walk = (topKey) => {
    if (seen.has(topKey)) return;
    seen.add(topKey);
    const val = data[topKey];
    if (val === null || val === undefined) return;
    if (typeof val === 'object' && !Array.isArray(val)) {
      lines.push(`${topKey}:`);
      for (const [k, v] of Object.entries(val)) {
        const rendered = serializeScalar(v);
        if (rendered === '') {
          lines.push(`  ${k}: ""`);
        } else {
          lines.push(`  ${k}: ${rendered}`);
        }
      }
      lines.push('');
    } else {
      const rendered = serializeScalar(val);
      if (rendered === '') {
        lines.push(`${topKey}: ""`);
      } else {
        lines.push(`${topKey}: ${rendered}`);
      }
    }
  };

  for (const k of order) walk(k);
  // 补 order 里没有但 data 里有的
  for (const k of Object.keys(data)) walk(k);

  return lines.join('\n') + '\n';
}

// ===== SoT 读写 =====

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readSoT() {
  if (!fs.existsSync(SOT_PATH)) return { data: {}, order: [] };
  try {
    const text = fs.readFileSync(SOT_PATH, 'utf8');
    return parseYaml(text);
  } catch (e) {
    console.error(`error: 读取 SoT 失败 ${SOT_PATH}: ${e.message}`);
    process.exit(1);
  }
}

function backupSoT() {
  if (!fs.existsSync(SOT_PATH)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const bak = `${SOT_PATH}.bak.${ts}`;
  try {
    fs.copyFileSync(SOT_PATH, bak);
    cleanupOldBackups();
    return bak;
  } catch (e) {
    console.error(`warn: 备份失败（继续写入）：${e.message}`);
    return null;
  }
}

function cleanupOldBackups() {
  if (!fs.existsSync(SOT_DIR)) return;
  const baseName = path.basename(SOT_PATH);
  const backups = fs.readdirSync(SOT_DIR)
    .filter(n => n.startsWith(`${baseName}.bak.`))
    .map(n => ({ name: n, full: path.join(SOT_DIR, n), stat: fs.statSync(path.join(SOT_DIR, n)) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  const toRemove = backups.slice(MAX_BACKUPS);
  for (const b of toRemove) {
    try { fs.unlinkSync(b.full); } catch { /* ignore */ }
  }
}

function writeSoT(data, order) {
  ensureDir(SOT_DIR);
  backupSoT();
  const content = writeYaml(data, order);
  fs.writeFileSync(SOT_PATH, content, 'utf8');
  if (process.platform !== 'win32') {
    try { fs.chmodSync(SOT_PATH, 0o600); } catch { /* ignore chmod errors on WSL/Cygwin */ }
  }
}

// ===== 点表示法访问 =====

function getByPath(data, dottedKey) {
  const parts = dottedKey.split('.');
  let cur = data;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function setByPath(data, order, dottedKey, value) {
  const parts = dottedKey.split('.');
  if (parts.length > 2) {
    console.error(`error: 仅支持两层嵌套（如 zmind.api_key），拒绝：${dottedKey}`);
    process.exit(2);
  }
  const topKey = parts[0];
  if (!(topKey in data)) order.push(topKey);
  if (parts.length === 1) {
    data[topKey] = value;
  } else {
    if (typeof data[topKey] !== 'object' || data[topKey] === null || Array.isArray(data[topKey])) {
      data[topKey] = {};
    }
    data[topKey][parts[1]] = value;
  }
}

function listAllKeys(data) {
  const keys = [];
  for (const [topKey, val] of Object.entries(data)) {
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      for (const child of Object.keys(val)) {
        keys.push(`${topKey}.${child}`);
      }
    } else {
      keys.push(topKey);
    }
  }
  return keys.sort();
}

// ===== 命令实现 =====

function cmdGet(dottedKey) {
  if (!dottedKey) {
    console.error('usage: whaletv-credentials get <dotted.key>');
    process.exit(2);
  }
  const { data } = readSoT();
  const val = getByPath(data, dottedKey);
  if (val === undefined || val === null || val === '') {
    // 保持与 AEF ai-credentials 语义一致：缺失时 stdout 空 + exit 1
    process.exit(1);
  }
  process.stdout.write(String(val));
}

function cmdSet(dottedKey, value) {
  if (!dottedKey || value === undefined) {
    console.error('usage: whaletv-credentials set <dotted.key> <value>');
    process.exit(2);
  }
  const { data, order } = readSoT();
  setByPath(data, order, dottedKey, value);
  writeSoT(data, order);
  console.log(`✓ set ${dottedKey}`);
}

function cmdCheck() {
  const { data } = readSoT();
  const missing = [];
  const warnings = [];

  if (!fs.existsSync(SOT_PATH)) {
    console.error(`error: SoT 文件不存在 ${SOT_PATH}`);
    console.error('       跑：whaletv-credentials init');
    process.exit(1);
  }

  for (const key of REQUIRED_KEYS_FOR_CHECK) {
    const v = getByPath(data, key);
    if (v === undefined || v === null || v === '') missing.push(key);
  }

  const modeAOk = GERRIT_MODE_A.every(k => {
    const v = getByPath(data, k);
    return v !== undefined && v !== null && v !== '';
  });
  const modeBOk = GERRIT_MODE_B.every(k => {
    const v = getByPath(data, k);
    return v !== undefined && v !== null && v !== '';
  });
  if (!modeAOk && !modeBOk) {
    missing.push('gerrit.[auth_header+cookie] OR gerrit.[username+http_password]');
  }

  for (const key of OPTIONAL_KEYS) {
    const v = getByPath(data, key);
    if (v === undefined || v === null || v === '') warnings.push(key);
  }

  console.log(`SoT 路径：${SOT_PATH}`);
  console.log('');
  if (missing.length === 0) {
    console.log('✓ 所有必需字段已配置');
  } else {
    console.error(`✗ 缺失必需字段（${missing.length} 项）：`);
    for (const k of missing) console.error(`  - ${k}`);
  }
  if (warnings.length > 0) {
    console.log('');
    console.log(`⚠ 未配置的可选字段（${warnings.length} 项，缺失不影响主流程）：`);
    for (const k of warnings) console.log(`  - ${k}`);
  }
  process.exit(missing.length > 0 ? 1 : 0);
}

function cmdList() {
  const { data } = readSoT();
  const keys = listAllKeys(data);
  if (keys.length === 0) {
    console.log('（SoT 空，或所有字段均为空值）');
    return;
  }
  console.log(`SoT 路径：${SOT_PATH}`);
  console.log('');
  console.log('已配置键：');
  for (const k of keys) {
    const v = getByPath(data, k);
    const hasValue = v !== undefined && v !== null && v !== '';
    console.log(`  ${hasValue ? '✓' : '✗'} ${k}`);
  }
}

function cmdPath() {
  process.stdout.write(SOT_PATH);
}

async function cmdInit() {
  if (fs.existsSync(SOT_PATH)) {
    console.error(`error: SoT 已存在 ${SOT_PATH}`);
    console.error('       如需重建，请先备份并删除该文件（会自动 rotate 到 .bak.<ts>）');
    process.exit(1);
  }

  console.log('');
  console.log('════════════════════════════════════════════');
  console.log('  whaletv-credentials init');
  console.log('════════════════════════════════════════════');
  console.log('');
  console.log('将交互收集 4 套凭据并写入 ~/.ai/whaletv.yaml');
  console.log('（任何字段可按 Enter 跳过，后续用 set 补齐）');
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(res => rl.question(q, ans => res(ans.trim())));

  const zmindKey = await ask('  Zmind API Key (40 位十六进制): ');
  const ogUser = await ask('  OpenGrok 用户名: ');
  const ogPass = await ask('  OpenGrok 密码: ');
  console.log('');
  console.log('  Gerrit 凭据：session 模式（Playwright 抓的 cookie）优先，也可填 basic');
  console.log('  推荐后续跑 scripts/refresh-auth.{ps1,sh} 自动抓 session；这里先跳过即可');
  const gerritUser = await ask('  Gerrit 用户名 (可选，basic 模式用): ');
  const gerritHttpPass = await ask('  Gerrit HTTP Password (可选，basic 模式用): ');
  console.log('');
  const conflUser = await ask('  Confluence 用户名 (可选): ');
  const conflPass = await ask('  Confluence 密码 (可选): ');
  console.log('');
  const email = await ask('  你的工作邮箱 (可选，供 Zmind Hub rate-limit 归因用): ');

  rl.close();

  const data = {
    zmind: {
      api_key: zmindKey || '',
      url: 'https://zmind.whaletv.com',
    },
    opengrok: {
      username: ogUser || '',
      password: ogPass || '',
      url: 'https://opengrok.zeasn.com',
    },
    gerrit: {
      auth_header: '',
      cookie: '',
      username: gerritUser || '',
      http_password: gerritHttpPass || '',
      url: 'https://whale-gerrit.zeasn.com',
    },
    confluence: {
      username: conflUser || '',
      password: conflPass || '',
      cookie: '',
      base_url: 'https://docs.whaletv.com',
    },
    _meta: {
      email: email || '',
      updated_at: new Date().toISOString(),
      version: 1,
    },
  };
  const order = ['zmind', 'opengrok', 'gerrit', 'confluence', '_meta'];

  writeSoT(data, order);
  console.log('');
  console.log(`✓ 已创建 ${SOT_PATH}`);
  if (process.platform !== 'win32') console.log('  （已 chmod 0600）');
  console.log('');
  console.log('下一步：');
  console.log('  - 跑 refresh-auth 抓 Gerrit + Confluence session cookie：');
  console.log('    PowerShell -ExecutionPolicy Bypass -File scripts\\refresh-auth.ps1  (Windows)');
  console.log('    bash scripts/refresh-auth.sh                                          (Linux/macOS)');
  console.log('  - 或用 set 单独补：whaletv-credentials set gerrit.auth_header "Basic ..."');
  console.log('  - 校验：whaletv-credentials check');
}

function cmdMigrate() {
  // 从 mcp.json 迁移，兼容 Kiro Power namespace 前缀
  const kiroMcpPath = path.join(os.homedir(), '.kiro', 'settings', 'mcp.json');
  if (!fs.existsSync(kiroMcpPath)) {
    console.error(`error: 未找到 mcp.json (${kiroMcpPath})`);
    console.error('       没有可迁移的凭据，请直接跑 whaletv-credentials init');
    process.exit(1);
  }
  if (fs.existsSync(SOT_PATH)) {
    console.error(`error: SoT 已存在 ${SOT_PATH}，不覆盖`);
    console.error('       手动删除或备份 SoT 后重跑，或用 set 命令逐项更新');
    process.exit(1);
  }

  let mcpConfig;
  try {
    mcpConfig = JSON.parse(fs.readFileSync(kiroMcpPath, 'utf8'));
  } catch (e) {
    console.error(`error: 解析 mcp.json 失败：${e.message}`);
    process.exit(1);
  }

  // 兼容 Kiro Power namespace 前缀：扫所有以 <server-name> 结尾的 key
  const servers = mcpConfig.mcpServers || {};
  const findByServerSuffix = (suffix) => {
    for (const [key, val] of Object.entries(servers)) {
      if (key === suffix || key.endsWith(`-${suffix}`)) return val;
    }
    return null;
  };

  const zmindEnv = (findByServerSuffix('zmind-mcp-server') || {}).env || {};
  const ogEnv = (findByServerSuffix('opengrok-mcp-server') || {}).env || {};
  const gerritEnv = (findByServerSuffix('gerrit-mcp-server') || {}).env || {};
  const conflEnv = (findByServerSuffix('confluence-mcp-server') || {}).env || {};

  const data = {
    zmind: {
      api_key: zmindEnv.ZMIND_API_KEY || '',
      url: zmindEnv.ZMIND_URL || 'https://zmind.whaletv.com',
    },
    opengrok: {
      username: ogEnv.OPENGROK_USERNAME || '',
      password: ogEnv.OPENGROK_PASSWORD || '',
      url: ogEnv.OPENGROK_URL || 'https://opengrok.zeasn.com',
      project: ogEnv.OPENGROK_PROJECT || '',
    },
    gerrit: {
      auth_header: gerritEnv.GERRIT_AUTH_HEADER || '',
      cookie: gerritEnv.GERRIT_COOKIE || '',
      username: gerritEnv.GERRIT_USERNAME || '',
      http_password: gerritEnv.GERRIT_HTTP_PASSWORD || '',
      url: gerritEnv.GERRIT_URL || 'https://whale-gerrit.zeasn.com',
    },
    confluence: {
      username: '',
      password: '',
      cookie: conflEnv.CONFLUENCE_COOKIE || '',
      base_url: conflEnv.CONFLUENCE_BASE_URL || 'https://docs.whaletv.com',
    },
    _meta: {
      email: '',
      updated_at: new Date().toISOString(),
      version: 1,
      migrated_from: 'mcp.json',
    },
  };
  const order = ['zmind', 'opengrok', 'gerrit', 'confluence', '_meta'];

  writeSoT(data, order);
  console.log(`✓ 已从 ${kiroMcpPath} 迁移到 ${SOT_PATH}`);
  console.log('');
  console.log('运行 whaletv-credentials check 校验字段完整性');
  console.log('注意：Confluence username/password 未从 mcp.json 迁移（未存），需 refresh-auth 时补');
}

// ===== 入口 =====

function printUsage() {
  console.log(`whaletv-credentials — 单一凭据源 CLI

SoT 位置：${SOT_PATH}

用法：
  whaletv-credentials get <dotted.key>          输出纯值（缺失时 exit 1）
  whaletv-credentials set <dotted.key> <value>  设置单个字段
  whaletv-credentials check                     校验必需字段
  whaletv-credentials list                      列出已配置键（不含值）
  whaletv-credentials path                      打印 SoT 文件路径
  whaletv-credentials init                      交互创建 SoT
  whaletv-credentials migrate                   从 ~/.kiro/settings/mcp.json 一次迁入

支持的键（点表示法，仅两层嵌套）：
  zmind.api_key             zmind.url
  opengrok.username         opengrok.password        opengrok.url        opengrok.project
  gerrit.auth_header        gerrit.cookie            gerrit.username     gerrit.http_password    gerrit.url
  confluence.username       confluence.password      confluence.cookie   confluence.base_url
  s3_issue_analysis.access_key_id   s3_issue_analysis.secret_access_key   s3_issue_analysis.region   s3_issue_analysis.bucket
  _meta.email               _meta.updated_at

示例：
  whaletv-credentials get zmind.api_key
  whaletv-credentials set gerrit.cookie "GerritAccount=...; XSRF_TOKEN=..."
  whaletv-credentials check
`);
}

async function main() {
  const [, , cmd, ...rest] = process.argv;

  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    printUsage();
    process.exit(0);
  }

  switch (cmd) {
    case 'get':
      cmdGet(rest[0]);
      break;
    case 'set':
      cmdSet(rest[0], rest.slice(1).join(' '));
      break;
    case 'check':
      cmdCheck();
      break;
    case 'list':
      cmdList();
      break;
    case 'path':
      cmdPath();
      break;
    case 'init':
      await cmdInit();
      break;
    case 'migrate':
      cmdMigrate();
      break;
    default:
      console.error(`error: 未知命令 ${cmd}`);
      console.error('       跑 whaletv-credentials --help 查看用法');
      process.exit(2);
  }
}

// 仅在直接被 node 运行时执行 CLI；被其他模块 import 时跳过 main()
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().catch(e => {
    console.error(`unexpected error: ${e.message}`);
    process.exit(1);
  });
}

// ===== 作为 module 导出（供 setup-creds.mjs / refresh-auth.mjs 复用）=====

export {
  SOT_PATH,
  readSoT,
  writeSoT,
  getByPath,
  setByPath,
  listAllKeys,
  parseYaml,
  writeYaml,
  parseScalar,
  serializeScalar,
};
