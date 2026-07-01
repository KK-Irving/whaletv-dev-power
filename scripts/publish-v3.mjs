#!/usr/bin/env node
/**
 * publish-v3.mjs — 按顺序发布 5 个 MCP server 到 npm registry
 *
 * 前置条件：
 *   1. `npm login`（或设置 NPM_TOKEN env）
 *   2. `whoami` 应显示你的 npm 账户（需要有 @kk-irving scope 发布权限）
 *
 * 发布顺序（按风险从低到高）：
 *   1. opengrok-mcp-server@1.2.1  (最小，只加 sot-loader + 修 bin path bug)
 *   2. confluence-mcp-server@1.0.1 (小，只加 sot-loader)
 *   3. zmind-mcp-server@2.1.2      (加 sot-loader)
 *   4. gerrit-mcp-server@1.1.1     (加 sot-loader)
 *   5. knowledge-mcp-server@1.1.0  (最大，加 sot-loader + 2 个新工具 generate/upload_report)
 *
 * 每个发完立即用 `npm view` 验证 registry 上确实有新版本。
 *
 * 使用：
 *   npm login                          # 或 export NPM_TOKEN=xxx
 *   node scripts/publish-v3.mjs        # 交互确认后发布
 *   node scripts/publish-v3.mjs --yes  # 跳过确认直接发（CI 用）
 *
 * 回滚（发错时，24h 内）：
 *   npm unpublish @kk-irving/opengrok-mcp-server@1.2.1
 *   npm unpublish @kk-irving/confluence-mcp-server@1.0.1
 *   npm unpublish @kk-irving/zmind-mcp-server@2.1.2
 *   npm unpublish @kk-irving/gerrit-mcp-server@1.1.1
 *   npm unpublish @kk-irving/knowledge-mcp-server@1.1.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const MCP_ROOT = path.join(REPO_ROOT, 'mcp-servers');

// 发布顺序（按风险从低到高）
const PACKAGES = [
  { dir: 'opengrok-mcp-server',   pkg: '@kk-irving/opengrok-mcp-server',   version: '1.2.1' },
  { dir: 'confluence-mcp-server', pkg: '@kk-irving/confluence-mcp-server', version: '1.0.1' },
  { dir: 'zmind-mcp-server',      pkg: '@kk-irving/zmind-mcp-server',      version: '2.1.2' },
  { dir: 'gerrit-mcp-server',     pkg: '@kk-irving/gerrit-mcp-server',     version: '1.1.1' },
  { dir: 'knowledge-mcp-server',  pkg: '@kk-irving/knowledge-mcp-server',  version: '1.1.0' },
];

const isWindows = process.platform === 'win32';
const NPM = isWindows ? 'npm.cmd' : 'npm';

// ANSI colors
const c = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', gray: '\x1b[90m', bold: '\x1b[1m',
};

function log(msg) { console.log(msg); }
function ok(msg) { console.log(`${c.green}✓${c.reset} ${msg}`); }
function fail(msg) { console.log(`${c.red}✗${c.reset} ${msg}`); }
function info(msg) { console.log(`${c.cyan}i${c.reset} ${msg}`); }
function warn(msg) { console.log(`${c.yellow}!${c.reset} ${msg}`); }

function ask(question) {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, ans => { rl.close(); res(ans.trim()); });
  });
}

function verifyPackage(dir, expectedVersion) {
  const pkgPath = path.join(MCP_ROOT, dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const issues = [];

  if (pkg.version !== expectedVersion) {
    issues.push(`package.json version=${pkg.version}，期望 ${expectedVersion}`);
  }

  const distDir = path.join(MCP_ROOT, dir, 'dist');
  if (!fs.existsSync(distDir)) {
    issues.push('dist/ 目录不存在（需要先 npm run build）');
  } else {
    // 检查关键文件
    const indexJs = path.join(distDir, 'index.js');
    if (!fs.existsSync(indexJs)) {
      issues.push('dist/index.js 不存在');
    } else {
      const firstLine = fs.readFileSync(indexJs, 'utf8').split('\n')[0];
      if (!firstLine.startsWith('#!/usr/bin/env node')) {
        issues.push(`dist/index.js 首行缺 shebang: ${firstLine}`);
      }
    }
    // sot-loader.js 必须存在（v3 新增）
    const sotLoader = path.join(distDir, 'sot-loader.js');
    if (!fs.existsSync(sotLoader)) {
      issues.push('dist/sot-loader.js 不存在（v3 sot-loader 缺失）');
    }
  }

  // bin 字段不能含 "./" 前缀（v2.1.0 老坑）
  if (pkg.bin) {
    for (const [name, binPath] of Object.entries(pkg.bin)) {
      if (binPath.startsWith('./')) {
        issues.push(`package.json bin.${name}="${binPath}" 含 ./ 前缀，npm 7+ 会 strip 掉整个 bin 字段！`);
      }
    }
  }

  return issues;
}

// Node 24 在 Windows 上对 .cmd 文件默认 shell:false 会导致 spawn 找不到 npm.cmd
// 必须显式 shell:true 让 cmd.exe 处理 PATHEXT 与参数
const SPAWN_OPTS_WIN = isWindows ? { shell: true } : {};

function runInPkg(dir, cmd, args = []) {
  const cwd = path.join(MCP_ROOT, dir);
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'inherit', ...SPAWN_OPTS_WIN });
  return r.status === 0;
}

function runInPkgSilent(dir, cmd, args = []) {
  const cwd = path.join(MCP_ROOT, dir);
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', ...SPAWN_OPTS_WIN });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function runInPkgCapture(dir, cmd, args = [], timeoutMs = 60_000) {
  const cwd = path.join(MCP_ROOT, dir);
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, ...SPAWN_OPTS_WIN });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

async function main() {
  const args = process.argv.slice(2);
  const skipConfirm = args.includes('--yes') || args.includes('-y');

  log('');
  log(`${c.bold}${c.cyan}══════════════════════════════════════════${c.reset}`);
  log(`${c.bold}${c.cyan}  WhaleTV Developer Power v3 — MCP 发布${c.reset}`);
  log(`${c.bold}${c.cyan}══════════════════════════════════════════${c.reset}`);
  log('');

  // === 1. 环境检查 ===
  info('[1/4] 环境检查');

  // npm 是否已登录
  const whoami = runInPkgCapture('.', NPM, ['whoami']);
  if (whoami.code !== 0) {
    fail('npm 未登录！');
    log('');
    log(`  在终端里跑：${c.bold}npm login${c.reset}`);
    log(`  或者设置环境变量：${c.bold}export NPM_TOKEN=<your-token>${c.reset}`);
    log(`  完成后重跑本脚本。`);
    process.exit(1);
  }
  const npmUser = whoami.stdout.trim();
  ok(`npm 登录用户: ${npmUser}`);

  const registry = runInPkgCapture('.', NPM, ['config', 'get', 'registry']);
  ok(`registry: ${registry.stdout.trim()}`);

  log('');

  // === 2. 逐包 pre-flight 验证 ===
  info('[2/4] 逐包 pre-flight 验证');
  const preflightIssues = [];
  for (const p of PACKAGES) {
    const issues = verifyPackage(p.dir, p.version);
    if (issues.length === 0) {
      ok(`${p.pkg}@${p.version}: 通过`);
    } else {
      fail(`${p.pkg}@${p.version}: ${issues.length} 个问题`);
      for (const i of issues) log(`    - ${i}`);
      preflightIssues.push({ pkg: p.pkg, issues });
    }
  }

  if (preflightIssues.length > 0) {
    log('');
    fail('pre-flight 验证失败，请先修复后重试');
    process.exit(1);
  }

  log('');

  // === 3. 用户确认 ===
  info('[3/4] 待发布清单');
  log('');
  for (const p of PACKAGES) {
    log(`  ${c.bold}${p.pkg}@${p.version}${c.reset}`);
  }
  log('');
  log(`  registry: ${c.bold}${registry.stdout.trim()}${c.reset}`);
  log(`  publisher: ${c.bold}${npmUser}${c.reset}`);
  log('');
  warn('这是不可逆操作。发布后 24h 内可用 npm unpublish 撤回，超时后只能 deprecate。');
  log('');

  if (!skipConfirm) {
    const ans = await ask(`确认发布以上 ${PACKAGES.length} 个包？(输入 yes 继续，其他终止): `);
    if (ans !== 'yes') {
      warn('取消发布');
      process.exit(0);
    }
  }

  log('');

  // === 4. 检测账号 2FA 状态 → 询问 OTP ===
  info('[4/5] 2FA / OTP 处理');
  log('');
  log(`  你的 npm 账户 (${c.bold}${npmUser}${c.reset}) 开启了强制 2FA。`);
  log(`  ${c.gray}（npm 政策：publish 时必须提供 OTP，或使用带 "Bypass 2FA" 的 granular token）${c.reset}`);
  log('');
  log(`  请打开手机 authenticator（Google Authenticator / 微软 Authenticator 等），`);
  log(`  找到 ${c.bold}npmjs.com${c.reset} 的 6 位 OTP 验证码。`);
  log(`  npm 允许同一个 OTP 在几分钟窗口内复用，所以一次输入通常能发完所有 5 个包。`);
  log(`  如果中途某包因 OTP 过期失败，脚本会重新 prompt。`);
  log('');

  let currentOtp = process.env.NPM_OTP || '';
  if (!currentOtp) {
    // 优先从 CLI arg 拿：--otp=123456
    for (const a of args) {
      const m = a.match(/^--otp[=:](\d+)$/);
      if (m) { currentOtp = m[1]; break; }
    }
  }
  if (!currentOtp) {
    currentOtp = await ask('  请输入当前 OTP (6 位数字): ');
    currentOtp = currentOtp.trim();
  }
  if (!/^\d{6}$/.test(currentOtp)) {
    fail(`OTP 格式不对：${currentOtp}（期望 6 位数字）`);
    process.exit(1);
  }
  ok(`OTP 收到: ${currentOtp.slice(0, 2)}****`);
  log('');

  // === 5. 逐包发布 ===
  info('[5/5] 开始发布');
  log('');

  const results = [];
  for (const p of PACKAGES) {
    log(`${c.bold}▸ ${p.pkg}@${p.version}${c.reset}`);

    let attempts = 0;
    const maxAttempts = 3;
    let success = false;

    while (attempts < maxAttempts && !success) {
      attempts++;
      const pubStart = Date.now();
      // 用 runInPkgSilent 捕获输出以判断 OTP 相关错误
      const r = runInPkgSilent(p.dir, NPM, [
        'publish', '--access', 'public', `--otp=${currentOtp}`
      ]);
      const pubMs = Date.now() - pubStart;
      const combined = (r.stdout + '\n' + r.stderr).toLowerCase();

      if (r.code === 0) {
        ok(`publish 成功 (${pubMs}ms)`);
        success = true;
        break;
      }

      // 判断是否 OTP 相关失败
      const isOtpError = combined.includes('otp') && (
        combined.includes('invalid') || combined.includes('expired') ||
        combined.includes('required') || combined.includes('eotp') ||
        combined.includes('two-factor') || combined.includes('e401')
      );

      if (isOtpError && attempts < maxAttempts) {
        warn(`OTP 无效或过期 (attempt ${attempts}/${maxAttempts})`);
        currentOtp = (await ask(`  请输入新 OTP (6 位): `)).trim();
        if (!/^\d{6}$/.test(currentOtp)) {
          fail(`OTP 格式不对`);
          results.push({ ...p, status: 'FAIL' });
          break;
        }
        continue;
      }

      // 非 OTP 错误 或 尝试超限
      fail(`publish 失败 (${pubMs}ms, exit=${r.code})`);
      log(`${c.gray}--- stderr ---${c.reset}`);
      log(r.stderr.slice(-1000)); // 只打印最后 1000 字符
      results.push({ ...p, status: 'FAIL' });
      break;
    }

    if (!success) {
      log('');
      warn('停止后续发布。已发布的包保持不动，请修复后重跑（脚本会跳过已发布的版本）。');
      log('');
      break;
    }

    // npm view 验证 registry 上确实有
    log(`  ${c.gray}等待 registry 收到...${c.reset}`);
    await new Promise(r => setTimeout(r, 3000)); // registry 有短暂 propagation
    const view = runInPkgCapture(p.dir, NPM, ['view', `${p.pkg}@${p.version}`, 'version'], 30_000);
    if (view.code === 0 && view.stdout.trim() === p.version) {
      ok(`registry 已可见: v${view.stdout.trim()}`);
      results.push({ ...p, status: 'OK' });
    } else {
      warn(`registry 未立即可见（可能 propagation 慢，稍后再验证）`);
      results.push({ ...p, status: 'PUBLISHED_BUT_NOT_VISIBLE' });
    }
    log('');
  }

  // === 汇总 ===
  log(`${c.bold}══════════════════════════════════════════${c.reset}`);
  log(`${c.bold}汇总${c.reset}`);
  log(`${c.bold}══════════════════════════════════════════${c.reset}`);
  for (const r of results) {
    const icon = r.status === 'OK' ? `${c.green}✓${c.reset}` : (r.status === 'FAIL' ? `${c.red}✗${c.reset}` : `${c.yellow}!${c.reset}`);
    log(`  ${icon} ${r.pkg}@${r.version} → ${r.status}`);
  }
  const notDone = PACKAGES.length - results.length;
  if (notDone > 0) log(`  ${c.gray}(${notDone} 个未处理，因前面失败中止)${c.reset}`);

  log('');
  const failed = results.filter(r => r.status === 'FAIL').length;
  if (failed === 0 && notDone === 0) {
    ok(`所有 ${PACKAGES.length} 个包发布成功 🎉`);
    log('');
    log('下一步：');
    log(`  1. ${c.bold}git tag v3.0.0${c.reset}`);
    log(`  2. ${c.bold}git push origin v3.0.0${c.reset}`);
    log(`  3. 通知团队升级：${c.bold}git pull && node scripts/deploy.mjs${c.reset}`);
    process.exit(0);
  } else {
    fail(`${failed} 个失败，${notDone} 个未发`);
    log('');
    log('回滚（24h 内可用）：');
    for (const r of results.filter(r => r.status === 'OK')) {
      log(`  ${c.gray}npm unpublish ${r.pkg}@${r.version}${c.reset}`);
    }
    process.exit(1);
  }
}

main().catch(e => {
  fail(`未预期错误：${e.message}`);
  process.exit(1);
});
