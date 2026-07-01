/**
 * Report HTML 模板 —— 自包含单文件 HTML（内嵌 CSS + JS），无外部依赖
 *
 * 设计：
 *   - JSON 通过 <script type="application/json" id="report-json">...</script> 嵌入
 *   - JS 通用 KV 渲染器（对象递归展开、数组列表、字符串直显）
 *   - 特殊字段用不同颜色标签：gate、symptom_type、root_cause_category、hook_metrics
 *   - 无外部依赖：无 <link>、无 CDN、无 <script src=>
 *
 * generate_report 工具用 renderReportHtml(fact) 得到完整 HTML 字符串。
 */

import type { ReportFactV1 } from "./report-schema.js";

/**
 * 把 JSON 嵌入到 <script type="application/json"> 里安全 —— 只需转义 `</script>`。
 * 其他 HTML 特殊字符（<、>、&）在 JSON script 标签内不需要转义（浏览器按 raw 处理直到遇到 </script>）。
 */
function embedJsonSafe(json: string): string {
  return json.replace(/<\/script/gi, "<\\/script");
}

export function renderReportHtml(fact: ReportFactV1): string {
  const jsonString = JSON.stringify(fact, null, 2);
  const safeJson = embedJsonSafe(jsonString);
  const title = `WhaleTV Skill Report — ${fact.business_summary?.title ?? fact.report_id}`;
  const titleSafe = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${titleSafe}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    margin: 0; padding: 0; background: #f7f8fa; color: #1c1e21; line-height: 1.6;
  }
  header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #fff; padding: 24px 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }
  header h1 { margin: 0 0 8px 0; font-size: 24px; }
  header .meta { opacity: 0.9; font-size: 13px; }
  header .meta code { background: rgba(255,255,255,0.15); padding: 2px 6px; border-radius: 3px; }
  main { max-width: 1200px; margin: 0 auto; padding: 24px 32px; }
  section {
    background: #fff; margin-bottom: 20px; padding: 20px 24px; border-radius: 6px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  }
  section h2 { margin: 0 0 16px 0; font-size: 18px; color: #1c1e21;
    border-bottom: 2px solid #e4e6eb; padding-bottom: 8px; }
  section h3 { font-size: 15px; margin: 16px 0 8px 0; color: #333; }
  .kv-row { display: flex; padding: 6px 0; border-bottom: 1px solid #f0f0f0; }
  .kv-row:last-child { border-bottom: none; }
  .kv-key { flex: 0 0 200px; color: #666; font-weight: 500; font-size: 13px; }
  .kv-val { flex: 1; word-break: break-word; }
  .kv-val code { background: #f0f2f5; padding: 2px 6px; border-radius: 3px; font-size: 12px; font-family: "Consolas", monospace; }
  ul { padding-left: 20px; margin: 4px 0; }
  li { margin: 4px 0; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 12px; margin-right: 4px; margin-bottom: 4px; }
  .tag-status-completed { background: #d4edda; color: #155724; }
  .tag-status-skipped { background: #e2e3e5; color: #383d41; }
  .tag-status-aborted { background: #f8d7da; color: #721c24; }
  .tag-status-gate_blocked { background: #fff3cd; color: #856404; }
  .tag-status-partial { background: #fff3cd; color: #856404; }
  .tag-status-failed { background: #f8d7da; color: #721c24; }
  .tag-risk-low { background: #d1ecf1; color: #0c5460; }
  .tag-risk-medium { background: #fff3cd; color: #856404; }
  .tag-risk-high { background: #f8d7da; color: #721c24; }
  .tag-risk-critical { background: #b71c1c; color: #fff; }
  .tag-symptom, .tag-cause { background: #e3f2fd; color: #1565c0; }
  .tag-gate { background: #fff3cd; color: #856404; }
  .tag-hook { background: #fce4ec; color: #ad1457; }
  .phase-card { border-left: 4px solid #667eea; padding: 12px 16px; margin: 12px 0; background: #fafbfc; border-radius: 0 4px 4px 0; }
  .phase-card.status-skipped { border-left-color: #adb5bd; opacity: 0.7; }
  .phase-card.status-aborted { border-left-color: #dc3545; }
  .phase-card.status-gate_blocked { border-left-color: #ffc107; }
  .phase-title { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .phase-title strong { font-size: 15px; }
  .phase-summary { color: #333; margin-bottom: 8px; font-size: 14px; }
  .phase-details { font-size: 13px; color: #555; }
  .phase-details .sub { margin-left: 0; margin-top: 6px; }
  .phase-details .sub-label { font-weight: 500; color: #666; margin-right: 6px; }
  details { margin: 8px 0; }
  summary { cursor: pointer; color: #667eea; font-size: 13px; }
  pre {
    background: #263238; color: #eeffff; padding: 14px; border-radius: 4px;
    overflow-x: auto; font-size: 12px; line-height: 1.5;
    font-family: "Consolas", "Monaco", "Menlo", monospace;
  }
  .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .metric-card { background: #f0f2f5; padding: 12px 16px; border-radius: 4px; text-align: center; }
  .metric-value { font-size: 24px; font-weight: 600; color: #1c1e21; }
  .metric-label { font-size: 12px; color: #666; margin-top: 4px; }
  footer { text-align: center; padding: 20px; color: #999; font-size: 12px; }
  .artifact-item { padding: 8px 12px; background: #f0f2f5; border-radius: 4px; margin: 6px 0; font-size: 13px; }
  .artifact-item a { color: #1a73e8; text-decoration: none; }
  .artifact-item a:hover { text-decoration: underline; }
</style>
</head>
<body>

<header>
  <h1>${titleSafe}</h1>
  <div class="meta">
    <code id="report-id"></code>
    &nbsp;·&nbsp;
    <span id="generated-at"></span>
    &nbsp;·&nbsp;
    Scenario: <code id="scenario"></code>
  </div>
</header>

<main>
  <section id="business-section">
    <h2>业务总结</h2>
    <div id="business-content"></div>
  </section>

  <section id="workflow-section">
    <h2>执行过程</h2>
    <div id="workflow-content"></div>
  </section>

  <section id="metrics-section">
    <h2>质量指标</h2>
    <div id="metrics-content"></div>
  </section>

  <section id="artifacts-section" style="display:none">
    <h2>关联产出</h2>
    <div id="artifacts-content"></div>
  </section>

  <section>
    <h2>原始数据（fact JSON）</h2>
    <details>
      <summary>展开查看 JSON</summary>
      <pre id="raw-json"></pre>
    </details>
  </section>
</main>

<footer>
  WhaleTV Developer Power · Report Fact v1 · 生成时间 <span id="footer-time"></span>
</footer>

<script type="application/json" id="report-json">${safeJson}</script>

<script>
'use strict';

// ==== 通用工具 ====

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function el(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  return wrap.firstElementChild;
}

// ==== 主渲染 ====

const fact = JSON.parse(document.getElementById('report-json').textContent);

document.getElementById('report-id').textContent = fact.report_id ?? '';
document.getElementById('scenario').textContent = fact.meta?.scenario ?? '';
document.getElementById('generated-at').textContent = fact.meta?.generated_at ?? '';
document.getElementById('footer-time').textContent = fact.meta?.generated_at ?? '';
document.getElementById('raw-json').textContent = JSON.stringify(fact, null, 2);

// ==== business_summary 渲染 ====

function renderBusiness() {
  const bs = fact.business_summary ?? {};
  const container = document.getElementById('business-content');

  const rows = [];
  rows.push(kvRow('标题', esc(bs.title ?? '')));
  rows.push(kvRow('结论', esc(bs.conclusion ?? '')));

  // details
  if (bs.details && Object.keys(bs.details).length > 0) {
    const detailsHtml = Object.entries(bs.details).map(([k, v]) => {
      let valHtml = esc(v);
      if (k === 'symptom_type' && v) valHtml = '<span class="tag tag-symptom">' + esc(v) + '</span>';
      else if (k === 'root_cause_category' && v) valHtml = '<span class="tag tag-cause">' + esc(v) + '</span>';
      else if (k === 'issue_status') valHtml = '<code>' + esc(v) + '</code>';
      else if (typeof v === 'object') valHtml = '<pre>' + esc(JSON.stringify(v, null, 2)) + '</pre>';
      return kvRow(esc(k), valHtml);
    }).join('');
    rows.push('<h3>业务详情</h3>' + detailsHtml);
  }

  // risks
  if (Array.isArray(bs.risks) && bs.risks.length > 0) {
    const riskList = bs.risks.map(r => {
      const tag = '<span class="tag tag-risk-' + esc(r.level) + '">' + esc(r.level) + '</span>';
      let text = tag + ' ' + esc(r.description);
      if (r.mitigation) text += '<div class="phase-details">缓解：' + esc(r.mitigation) + '</div>';
      return '<li>' + text + '</li>';
    }).join('');
    rows.push('<h3>识别到的风险</h3><ul>' + riskList + '</ul>');
  }

  container.innerHTML = rows.join('');
}

function kvRow(key, valHtml) {
  return '<div class="kv-row"><div class="kv-key">' + key + '</div><div class="kv-val">' + valHtml + '</div></div>';
}

// ==== workflow_execution 渲染 ====

function renderWorkflow() {
  const we = fact.workflow_execution ?? {};
  const container = document.getElementById('workflow-content');

  const meta = [];
  if (we.skill_name) meta.push(kvRow('Skill', '<code>' + esc(we.skill_name) + '</code>'));
  if (we.final_status) {
    meta.push(kvRow('最终状态',
      '<span class="tag tag-status-' + esc(we.final_status) + '">' + esc(we.final_status) + '</span>'));
  }
  if (we.duration_seconds !== undefined) meta.push(kvRow('总耗时', esc(we.duration_seconds) + ' 秒'));
  if (we.started_at) meta.push(kvRow('开始', esc(we.started_at)));
  if (we.ended_at) meta.push(kvRow('结束', esc(we.ended_at)));

  const phases = Array.isArray(we.phases) ? we.phases : [];
  const phaseHtml = phases.map(renderPhase).join('');

  container.innerHTML = meta.join('') + '<h3>阶段（' + phases.length + '）</h3>' + phaseHtml;
}

function renderPhase(p) {
  const status = p.status ?? 'completed';
  let html = '<div class="phase-card status-' + esc(status) + '">';
  html += '<div class="phase-title"><strong>' + esc(p.phase_id ?? '') + '. ' + esc(p.name ?? '') + '</strong>';
  html += '<span class="tag tag-status-' + esc(status) + '">' + esc(status) + '</span>';
  if (p.gate) html += '<span class="tag tag-gate">GATE ' + (p.gate.passed ? '✓' : '⏸') + '</span>';
  html += '</div>';
  html += '<div class="phase-summary">' + esc(p.summary ?? '') + '</div>';

  const details = [];

  if (p.outputs && Object.keys(p.outputs).length > 0) {
    details.push('<div class="sub"><span class="sub-label">Outputs:</span><pre>' + esc(JSON.stringify(p.outputs, null, 2)) + '</pre></div>');
  }
  if (Array.isArray(p.rules_hit) && p.rules_hit.length > 0) {
    details.push('<div class="sub"><span class="sub-label">Rules 命中:</span>' +
      p.rules_hit.map(r => '<code>' + esc(r) + '</code>').join(' ') + '</div>');
  }
  if (Array.isArray(p.tools) && p.tools.length > 0) {
    const tools = p.tools.map(t => {
      let s = '<code>' + esc(t.name) + '</code>';
      if (t.call_count) s += ' ×' + esc(t.call_count);
      if (t.success === false) s += ' ⚠';
      return s;
    }).join(', ');
    details.push('<div class="sub"><span class="sub-label">Tools:</span>' + tools + '</div>');
  }
  if (Array.isArray(p.knowledge_used) && p.knowledge_used.length > 0) {
    details.push('<div class="sub"><span class="sub-label">Knowledge:</span>' +
      p.knowledge_used.map(k => '<code>' + esc(k) + '</code>').join(', ') + '</div>');
  }
  if (p.gate) {
    details.push('<div class="sub"><span class="sub-label">Gate:</span>等待 ' + esc(p.gate.waiting_for ?? '') + '</div>');
  }
  if (Array.isArray(p.risks) && p.risks.length > 0) {
    details.push('<div class="sub"><span class="sub-label">风险:</span>' + p.risks.map(esc).join(', ') + '</div>');
  }

  if (details.length > 0) {
    html += '<div class="phase-details">' + details.join('') + '</div>';
  }
  html += '</div>';
  return html;
}

// ==== quality_signals 渲染 ====

function renderMetrics() {
  const qs = fact.quality_signals ?? {};
  const container = document.getElementById('metrics-content');

  const cards = [];

  if (qs.phase_metrics) {
    cards.push(metricCard('总阶段', qs.phase_metrics.total_phases ?? 0));
    cards.push(metricCard('完成', qs.phase_metrics.completed_phases ?? 0));
    if (qs.phase_metrics.skipped_phases) cards.push(metricCard('跳过', qs.phase_metrics.skipped_phases));
    if (qs.phase_metrics.aborted_phases) cards.push(metricCard('中止', qs.phase_metrics.aborted_phases));
  }
  if (qs.gate_metrics && qs.gate_metrics.total_gates) {
    cards.push(metricCard('GATE 总数', qs.gate_metrics.total_gates));
    cards.push(metricCard('GATE 通过', qs.gate_metrics.gates_passed ?? 0));
    if (qs.gate_metrics.gates_blocked) cards.push(metricCard('GATE 阻塞', qs.gate_metrics.gates_blocked));
  }
  if (qs.tool_call_count !== undefined) {
    cards.push(metricCard('工具调用', qs.tool_call_count));
  }
  if (qs.hook_metrics) {
    if (qs.hook_metrics.hooks_triggered) cards.push(metricCard('Hook 触发', qs.hook_metrics.hooks_triggered));
    if (qs.hook_metrics.hooks_blocked) cards.push(metricCard('Hook 拦截', qs.hook_metrics.hooks_blocked));
  }

  let html = '<div class="metrics-grid">' + cards.join('') + '</div>';

  if (Array.isArray(qs.hook_metrics?.hook_names) && qs.hook_metrics.hook_names.length > 0) {
    html += '<h3>触发的 Hook</h3><div>' +
      qs.hook_metrics.hook_names.map(n => '<span class="tag tag-hook">' + esc(n) + '</span>').join(' ') +
      '</div>';
  }

  container.innerHTML = html;
}

function metricCard(label, value) {
  return '<div class="metric-card"><div class="metric-value">' + esc(value) + '</div><div class="metric-label">' + esc(label) + '</div></div>';
}

// ==== artifacts 渲染 ====

function renderArtifacts() {
  if (!Array.isArray(fact.artifacts) || fact.artifacts.length === 0) return;
  document.getElementById('artifacts-section').style.display = '';
  const container = document.getElementById('artifacts-content');
  container.innerHTML = fact.artifacts.map(a => {
    const label = a.label ?? a.type;
    let val = esc(a.value);
    if (a.type === 'gerrit_change_url' || a.type === 'zmind_issue_url') {
      val = '<a href="' + esc(a.value) + '" target="_blank" rel="noopener">' + esc(a.value) + '</a>';
    } else if (a.type === 'commit_hash' || a.type === 'attachment_path' || a.type === 'modified_file') {
      val = '<code>' + esc(a.value) + '</code>';
    }
    return '<div class="artifact-item"><strong>' + esc(label) + ':</strong> ' + val + '</div>';
  }).join('');
}

// ==== 执行 ====

renderBusiness();
renderWorkflow();
renderMetrics();
renderArtifacts();
</script>

</body>
</html>
`;
}
