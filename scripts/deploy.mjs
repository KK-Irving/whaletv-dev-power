#!/usr/bin/env node
/**
 * whaletv-dev-power v3 deploy.mjs
 *
 * 把 workspace 内的 steering / hooks / .kiro/skills 部署到目标 .kiro/ 目录，
 * 并把 bin/ 加入 PATH。跨 Windows/Linux/macOS，幂等，支持备份 + 迁移检测。
 *
 * 用法：
 *   node scripts/deploy.mjs                        # 部署到 ~/.kiro/
 *   node scripts/deploy.mjs --workspace <path>     # 部署到 <path>/.kiro/
 *   node scripts/deploy.mjs --dry-run              # 仅打印动作，不写
 *   node scripts/deploy.mjs --skip-hooks           # 跳过 hook 部署
 *   node scripts/deploy.mjs --skip-steering        # 跳过 steering 部署
 *   node scripts/deploy.mjs --skip-skills          # 跳过 skill 部署
 *   node scripts/deploy.mjs --no-path              # 不修改 PATH
 *   node scripts/deploy.mjs --help                 # 显示帮助
 *
 * 参考：agentengineeringframework/scripts/init.py 的 PATH 管理与幂等设计。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ===== 常量 =====

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const RC_MARKER_BEGIN = '# >>> whaletv-dev-power (managed by scripts/deploy.mjs) >>>';
const RC_MARKER_END = '# <<< whaletv-dev-power <<<';
// Windows PATH 迁移检测用（POSIX 上通过 marker block 直接管理，无需 suffix 匹配）
const BIN_SUFFIX_WIN = '\\bin';
const MAX_BACKUPS = 3;
const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 5;

// ===== 输出工具 =====

const isWindows = process.platform === 'win32';
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

let ERRORS = 0;
let counts = { steering: { ok: 0, fail: 0, skip: 0 }, hooks: { ok: 0, fail: 0, skip: 0 }, skills: { ok: 0, fail: 0, skip: 0 } };

function printOk(msg) { console.log(`  ${colors.green}[OK]${colors.reset} ${msg}`); }
function printFail(msg) { ERRORS++; console.log(`  ${colors.red}[FAIL]${colors.reset} ${msg}`); }
function printWarn(msg) { console.log(`  ${colors.yellow}[WARN]${colors.reset} ${msg}`); }
function printSkip(msg) { console.log(`  ${colors.gray}[SKIP]${colors.reset} ${msg}`); }
function printStep(title) { console.log(`\n${colors.cyan}${title}${colors.reset}\n`); }
function printInfo(msg) { console.log(`  ${msg}`); }

// ===== 参数解析 =====

function parseArgs(argv) {
  const args = {
    workspace: null,
    dryRun: false,
    skipHooks: false,
    skipSteering: false,
    skipSkills: false,
    noPath: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--workspace':
        args.workspace = argv[++i];
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--skip-hooks':
        args.skipHooks = true;
        break;
      case '--skip-steering':
        args.skipSteering = true;
        break;
      case '--skip-skills':
        args.skipSkills = true;
        break;
      case '--no-path':
        args.noPath = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        if (arg.startsWith('--workspace=')) {
          args.workspace = arg.split('=', 2)[1];
        } else {
          console.error(`unknown argument: ${arg}`);
          process.exit(2);
        }
    }
  }
  return args;
}

function printUsage() {
  console.log(`
whaletv-dev-power v3 deploy.mjs

用法：
  node scripts/deploy.mjs                        部署到 ~/.kiro/（默认，用户级）
  node scripts/deploy.mjs --workspace <path>     部署到 <path>/.kiro/（workspace 级）
  node scripts/deploy.mjs --dry-run              仅打印动作，不实际写入
  node scripts/deploy.mjs --skip-hooks           跳过 hook 部署
  node scripts/deploy.mjs --skip-steering        跳过 steering 部署
  node scripts/deploy.mjs --skip-skills          跳过 skill 部署
  node scripts/deploy.mjs --no-path              不修改 PATH

被部署的资源：
  steering/*.md   -> <target>/steering/
  hooks/*.json    -> <target>/hooks/
  .kiro/skills/** -> <target>/skills/
  bin/            -> $PATH（首次部署时追加）

安全保障：
  - 部署前把目标 <target> 备份到 <target>/../.kiro.backup-<ts>/，保留最近 ${MAX_BACKUPS} 份
  - 检测 Kiro IDE 是否在运行；运行时拒绝部署
  - 幂等：重复运行不产生副作用（PATH 使用 marker block 管理）
  - --dry-run 支持先看动作再决定是否执行
`);
}

// ===== 环境检查 =====

function checkNodeVersion() {
  const version = process.versions.node;
  const [major, minor] = version.split('.').map(Number);
  if (major < MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor < MIN_NODE_MINOR)) {
    printFail(`Node.js ${version} 太旧（需要 ≥ ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.0；knowledge-mcp 用 node:sqlite 内置模块）`);
    console.log(`       请升级 Node：`);
    console.log(`       - Windows: winget upgrade OpenJS.NodeJS`);
    console.log(`       - macOS:   brew upgrade node`);
    console.log(`       - Linux:   参见 https://nodejs.org/`);
    return false;
  }
  printOk(`Node.js ${version}`);
  return true;
}

function isKiroRunning() {
  try {
    if (isWindows) {
      const out = execSync('tasklist /FI "IMAGENAME eq Kiro.exe"', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      return /Kiro\.exe/i.test(out);
    } else {
      const r = spawnSync('pgrep', ['-f', 'kiro'], { stdio: ['ignore', 'pipe', 'ignore'] });
      return r.status === 0;
    }
  } catch {
    return false; // 检测工具本身不可用，宽容处理
  }
}

// ===== 备份 =====

function backupTarget(kiroDir, dryRun) {
  if (!fs.existsSync(kiroDir)) return null;
  const parent = path.dirname(kiroDir);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = path.join(parent, `.kiro.backup-${ts}`);
  if (dryRun) {
    printInfo(`[dry-run] 将备份 ${kiroDir} -> ${backupPath}`);
    return backupPath;
  }
  try {
    fs.cpSync(kiroDir, backupPath, { recursive: true });
    printOk(`已备份到 ${backupPath}`);
    return backupPath;
  } catch (e) {
    printWarn(`备份失败（继续部署）：${e.message}`);
    return null;
  }
}

function cleanupOldBackups(kiroDir, dryRun) {
  const parent = path.dirname(kiroDir);
  if (!fs.existsSync(parent)) return;
  const backups = fs.readdirSync(parent)
    .filter(n => n.startsWith('.kiro.backup-'))
    .map(n => ({ name: n, full: path.join(parent, n), stat: fs.statSync(path.join(parent, n)) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  if (backups.length <= MAX_BACKUPS) return;
  const toRemove = backups.slice(MAX_BACKUPS);
  for (const b of toRemove) {
    if (dryRun) {
      printInfo(`[dry-run] 将删除旧备份 ${b.full}`);
    } else {
      try {
        fs.rmSync(b.full, { recursive: true, force: true });
        printSkip(`已删除旧备份 ${b.name}`);
      } catch (e) {
        printWarn(`删除旧备份 ${b.name} 失败：${e.message}`);
      }
    }
  }
}

// ===== 部署 =====

function ensureDir(dir, dryRun) {
  if (dryRun) return;
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dst, dryRun, category) {
  if (!fs.existsSync(src)) {
    printSkip(`${path.basename(src)}（源文件不存在）`);
    counts[category].skip++;
    return;
  }
  if (dryRun) {
    printInfo(`[dry-run] ${src} -> ${dst}`);
    counts[category].ok++;
    return;
  }
  try {
    ensureDir(path.dirname(dst), false);
    // Windows 上如果 Kiro 锁着目标文件会 EPERM/EBUSY
    fs.copyFileSync(src, dst);
    printOk(`${path.basename(dst)}`);
    counts[category].ok++;
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES') {
      printFail(`${path.basename(dst)}（文件被锁定，请先关闭 Kiro IDE）`);
    } else {
      printFail(`${path.basename(dst)}（${e.message}）`);
    }
    counts[category].fail++;
  }
}

function copyDirRecursive(src, dst, dryRun, category) {
  if (!fs.existsSync(src)) {
    printSkip(`${path.basename(src)}/（源目录不存在）`);
    counts[category].skip++;
    return;
  }
  if (dryRun) {
    printInfo(`[dry-run] ${src}/ -> ${dst}/（递归）`);
    counts[category].ok++;
    return;
  }
  try {
    ensureDir(dst, false);
    // 移除目标已存在的同名内容（覆盖式）
    if (fs.existsSync(dst) && fs.statSync(dst).isDirectory()) {
      // 保留 dst 目录本身，只清空里面（避免误删父目录）
      for (const child of fs.readdirSync(dst)) {
        fs.rmSync(path.join(dst, child), { recursive: true, force: true });
      }
    }
    fs.cpSync(src, dst, { recursive: true });
    printOk(`${path.basename(dst)}/`);
    counts[category].ok++;
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES') {
      printFail(`${path.basename(dst)}/（文件被锁定，请先关闭 Kiro IDE）`);
    } else {
      printFail(`${path.basename(dst)}/（${e.message}）`);
    }
    counts[category].fail++;
  }
}

function deploySteering(kiroDir, dryRun) {
  printStep('部署 Steering');
  const srcDir = path.join(REPO_ROOT, 'steering');
  const dstDir = path.join(kiroDir, 'steering');
  if (!fs.existsSync(srcDir)) {
    printWarn(`steering/ 源目录不存在：${srcDir}`);
    return;
  }
  ensureDir(dstDir, dryRun);
  for (const f of fs.readdirSync(srcDir)) {
    if (!f.endsWith('.md')) continue;
    copyFile(path.join(srcDir, f), path.join(dstDir, f), dryRun, 'steering');
  }
}

function deployHooks(kiroDir, dryRun) {
  printStep('部署 Hooks');
  const srcDir = path.join(REPO_ROOT, 'hooks');
  const dstDir = path.join(kiroDir, 'hooks');
  if (!fs.existsSync(srcDir)) {
    printWarn(`hooks/ 源目录不存在：${srcDir}`);
    return;
  }
  ensureDir(dstDir, dryRun);
  for (const f of fs.readdirSync(srcDir)) {
    if (!f.endsWith('.json')) continue;
    // 验证符合 Kiro schema 再部署
    try {
      const content = JSON.parse(fs.readFileSync(path.join(srcDir, f), 'utf8'));
      if (!content.name || !content.version || !content.when || !content.then) {
        printFail(`${f}（缺少必需字段 name/version/when/then，不符合 Kiro schema，跳过部署）`);
        counts.hooks.fail++;
        continue;
      }
      if (!['askAgent', 'runCommand'].includes(content.then?.type)) {
        printFail(`${f}（then.type 必须为 askAgent 或 runCommand，跳过部署）`);
        counts.hooks.fail++;
        continue;
      }
    } catch (e) {
      printFail(`${f}（JSON 语法错误：${e.message}）`);
      counts.hooks.fail++;
      continue;
    }
    copyFile(path.join(srcDir, f), path.join(dstDir, f), dryRun, 'hooks');
  }
}

function deploySkills(kiroDir, dryRun) {
  printStep('部署 Skills');
  const srcDir = path.join(REPO_ROOT, '.kiro', 'skills');
  const dstDir = path.join(kiroDir, 'skills');
  if (!fs.existsSync(srcDir)) {
    printWarn(`.kiro/skills/ 源目录不存在：${srcDir}`);
    return;
  }
  ensureDir(dstDir, dryRun);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      copyFile(path.join(srcDir, entry.name), path.join(dstDir, entry.name), dryRun, 'skills');
    } else if (entry.isDirectory()) {
      copyDirRecursive(path.join(srcDir, entry.name), path.join(dstDir, entry.name), dryRun, 'skills');
    }
  }
}

// ===== PATH 管理 =====

function buildRcBlock(binDir) {
  return `\n${RC_MARKER_BEGIN}\n# 由 scripts/deploy.mjs 管理，每次运行会重写。\n# 迁移仓库位置后重跑 deploy.mjs 会自动更新。\nexport PATH="${binDir}:$PATH"\n${RC_MARKER_END}\n`;
}

function updatePathUnix(binDir, dryRun) {
  const home = os.homedir();
  const candidates = ['.zshrc', '.bashrc', '.profile'].map(n => path.join(home, n));
  let rcFile = candidates.find(f => fs.existsSync(f));
  if (!rcFile) rcFile = candidates[candidates.length - 1]; // 都不存在则用 .profile

  const escBegin = RC_MARKER_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escEnd = RC_MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const managedBlockRe = new RegExp(`\\n*${escBegin}[\\s\\S]*?${escEnd}\\n*`, 'g');

  const original = fs.existsSync(rcFile) ? fs.readFileSync(rcFile, 'utf8') : '';

  // 探测旧的 binDir（供迁移提示）
  let oldBinDir = null;
  const managed = original.match(new RegExp(`${escBegin}[\\s\\S]*?${escEnd}`, ''));
  if (managed) {
    const m = managed[0].match(/export PATH="([^"]+)"/);
    if (m) {
      const value = m[1];
      const pathParts = value.split(':');
      const firstPart = pathParts[0];
      if (firstPart && firstPart !== binDir) oldBinDir = firstPart;
    }
  }

  const newBlock = buildRcBlock(binDir);
  const cleaned = original.replace(managedBlockRe, '\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  const newContent = (cleaned ? cleaned + '\n' : '') + newBlock;

  if (newContent === original) {
    printOk(`PATH 已在 ${rcFile}（无变化）`);
    return;
  }
  if (dryRun) {
    printInfo(`[dry-run] 更新 ${rcFile}（写入 marker block 指向 ${binDir}）`);
    return;
  }
  fs.writeFileSync(rcFile, newContent, 'utf8');
  if (oldBinDir) {
    printOk(`${rcFile}：已从 ${oldBinDir} 迁移到 ${binDir}`);
    printInfo(`  之前的 bin 目录：${oldBinDir}（如已不再需要，可自行清理）`);
  } else {
    printOk(`${rcFile}：已添加 PATH 条目 -> ${binDir}`);
  }
  printInfo(`  重启终端使 PATH 生效，或手动执行：source ${rcFile}`);
}

function updatePathWindows(binDir, dryRun) {
  // 通过 PowerShell 读写 HKCU:Environment Path
  const psGet = `[Environment]::GetEnvironmentVariable('Path','User')`;
  let userPath = '';
  try {
    userPath = execSync(`powershell -NoProfile -Command "${psGet}"`, { encoding: 'utf8' }).trim();
  } catch (e) {
    printWarn(`读取 HKCU Path 失败：${e.message}`);
    return;
  }
  const parts = userPath ? userPath.split(';').filter(Boolean) : [];
  const suffixLower = BIN_SUFFIX_WIN.toLowerCase();
  const binDirNorm = path.normalize(binDir).toLowerCase();

  const newParts = [];
  let oldEntry = null;
  let seenCurrent = false;
  for (const entry of parts) {
    const norm = path.normalize(entry).toLowerCase();
    if (norm.endsWith(suffixLower) && (norm.includes('whaletv-dev-power') || norm === binDirNorm)) {
      // 属于本项目的旧 bin 条目
      if (norm === binDirNorm && !seenCurrent) {
        newParts.push(entry);
        seenCurrent = true;
      } else if (!oldEntry) {
        oldEntry = entry;
      }
    } else {
      newParts.push(entry);
    }
  }
  if (!seenCurrent) newParts.unshift(binDir);

  const newPath = newParts.join(';');
  if (newPath === userPath) {
    printOk(`PATH 已在 HKCU（无变化）`);
    return;
  }
  if (dryRun) {
    printInfo(`[dry-run] 更新 HKCU Path，包含 ${binDir}`);
    return;
  }
  try {
    // PowerShell 需要转义
    const escaped = newPath.replace(/'/g, "''");
    execSync(`powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path','${escaped}','User')"`, { stdio: ['ignore', 'ignore', 'inherit'] });
    if (oldEntry) {
      printOk(`HKCU Path：已从 ${oldEntry} 迁移到 ${binDir}`);
      printInfo(`  之前的 bin 目录：${oldEntry}（如已不再需要，可自行清理）`);
    } else {
      printOk(`HKCU Path：已添加 -> ${binDir}`);
    }
    printInfo(`  重启终端使 PATH 生效（或用新终端会话）`);
  } catch (e) {
    printFail(`写入 HKCU Path 失败：${e.message}`);
  }
}

function updatePath(dryRun) {
  printStep('配置 PATH');
  const binDir = path.join(REPO_ROOT, 'bin');
  if (!fs.existsSync(binDir)) {
    printSkip(`bin/ 目录不存在，跳过 PATH 配置`);
    return;
  }
  printInfo(`目标：${binDir}`);
  if (isWindows) updatePathWindows(binDir, dryRun);
  else updatePathUnix(binDir, dryRun);
}

// ===== 汇总 =====

function printSummary() {
  console.log('');
  console.log('======================================');
  const total = counts.steering.ok + counts.hooks.ok + counts.skills.ok;
  const failed = counts.steering.fail + counts.hooks.fail + counts.skills.fail;
  console.log(`  部署完成：Steering ${counts.steering.ok} · Hooks ${counts.hooks.ok} · Skills ${counts.skills.ok}（合计 ${total} 项成功，${failed} 项失败）`);
  if (ERRORS > 0) console.log(`  ${colors.red}⚠️  有 ${ERRORS} 个错误${colors.reset}`);
  console.log('======================================');
  console.log('');
  console.log('  下一步：');
  console.log('    1. 重启终端使 PATH 生效');
  console.log('    2. 启动 Kiro IDE，即可使用 skill/steering/hook');
  console.log('    3. 首次使用请先配置凭据：node scripts/setup-creds.mjs（或 scripts/refresh-auth.*）');
  console.log('');
}

// ===== 主流程 =====

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  console.log('');
  console.log('======================================');
  console.log('  whaletv-dev-power v3 deploy');
  console.log('======================================');
  console.log('');
  console.log(`  仓库位置：${REPO_ROOT}`);

  // 目标目录判定
  const kiroDir = args.workspace
    ? path.resolve(args.workspace, '.kiro')
    : path.join(os.homedir(), '.kiro');
  console.log(`  部署目标：${kiroDir}${args.workspace ? ' (workspace 级)' : ' (用户级)'}`);
  if (args.dryRun) console.log(`  ${colors.yellow}[dry-run] 仅打印动作，不实际写入${colors.reset}`);
  console.log('');

  // 环境检查
  printStep('[1/6] 环境检查');
  if (!checkNodeVersion()) process.exit(1);
  if (isKiroRunning()) {
    if (args.dryRun) {
      printWarn('检测到 Kiro IDE 正在运行（dry-run 模式忽略此检查）');
    } else {
      console.log('');
      printFail('检测到 Kiro IDE 正在运行');
      console.log('       配置文件可能被锁定，请先关闭 Kiro IDE 再重试。');
      console.log('       （若确认 Kiro 未运行，可能是进程残留，请检查任务管理器）');
      console.log('       如需绕过此检查（不推荐）：先跑 --dry-run 检查计划，确认后关闭 Kiro 再实际部署。');
      process.exit(1);
    }
  } else {
    printOk('Kiro IDE 未运行');
  }

  // 备份
  printStep('[2/6] 备份现有 .kiro/');
  backupTarget(kiroDir, args.dryRun);
  cleanupOldBackups(kiroDir, args.dryRun);

  // 部署
  console.log('');
  console.log(colors.cyan + '[3/6] 部署资源' + colors.reset);
  if (!args.skipSteering) deploySteering(kiroDir, args.dryRun);
  else printStep('部署 Steering (--skip-steering)');
  if (!args.skipHooks) deployHooks(kiroDir, args.dryRun);
  else printStep('部署 Hooks (--skip-hooks)');
  if (!args.skipSkills) deploySkills(kiroDir, args.dryRun);
  else printStep('部署 Skills (--skip-skills)');

  // PATH
  console.log('');
  console.log(colors.cyan + '[4/6] 配置 PATH' + colors.reset);
  if (!args.noPath) updatePath(args.dryRun);
  else printSkip('--no-path 已跳过 PATH 配置');

  // 提示
  console.log('');
  console.log(colors.cyan + '[5/6] 后续步骤提示' + colors.reset);
  printInfo('凭据管理：');
  printInfo('  - 首次配置：node scripts/setup-creds.mjs');
  printInfo('  - Cookie 过期刷新：scripts/refresh-auth.ps1 (Windows) / bash scripts/refresh-auth.sh (Linux/macOS)');
  printInfo('  - 单一真源（v3 新增）：~/.ai/whaletv.yaml');
  printInfo('  - 读取凭据：whaletv-credentials get <key>');

  // 汇总
  console.log('');
  console.log(colors.cyan + '[6/6] 汇总' + colors.reset);
  printSummary();

  process.exit(ERRORS > 0 ? 1 : 0);
}

main();
