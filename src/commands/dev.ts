/**
 * dev — 智能开发入口（AI 引导）
 * TTY → 终端框线，非 TTY → LLM 引导 HTML 页面
 */
import { pathExists, readdir, writeFile } from 'fs-extra';
import { join } from 'path';
import { execSync } from 'child_process';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { devAiGuide, DevPhase, DevPipelineState } from '../core/dev-llm';
import { tryHostAi } from '../core/ask-host-ai';

interface DevOptions {
  iteration?: string; force?: boolean; auto?: boolean; from?: string; to?: string;
  web?: boolean; output?: string;
}

export async function devCommand(options: DevOptions): Promise<void> {
  // 非 TTY → HTML 预览
  if (!process.stdout.isTTY) {
    const html = await renderDevHtml(options);
    const outPath = options.output || join(process.cwd(), 'speccore-dev.html');
    await writeFile(outPath, html);
    logger.info(`✅ 已生成: ${outPath}`);
    return;
  }

  // ── Auto-pipeline mode ──
  if (options.auto) { await autoPipeline(options); return; }

  // ── Single-step detect mode ──
  const iteration = await getDefaultIteration(options.iteration);
  if (!iteration) {
    logger.info('\n🔍 检测到项目尚未初始化');
    logger.info('下一步: speccore init');
    return;
  }

  const iterDir = `期次-${iteration}`;
  const legacyReq = join(iterDir, '00-需求文档', 'REQUIREMENT.md');
  const analysis = join(iterDir, '00-需求文档', 'ANALYSIS.md');

  if (!(await pathExists(legacyReq))) {
    showPhase('导入需求', ['speccore doc2spec -f PRD.docx -i ' + iteration]);
  } else if (!(await pathExists(analysis))) {
    showPhase('分析需求', ['speccore analyze --iteration=' + iteration]);
  } else {
    showPhase('拆分任务', ['speccore iteration split --iteration=' + iteration]);
  }
}

function showPhase(phase: string, cmds: string[]) {
  logger.info(`\n📍 当前阶段: ${phase}`);
  cmds.forEach(c => logger.info(`  → ${c}`));
}

async function autoPipeline(options: DevOptions): Promise<void> {
  const spinner = new Spinner('Auto-pipeline...');
  spinner.start();
  const iteration = await getDefaultIteration(options.iteration);
  if (!iteration) { execSync('speccore init', { stdio: 'inherit' }); return; }
  spinner.stop(`期次: ${iteration}`);
  const iterDir = `期次-${iteration}`;
  const reqDoc = join(iterDir, '00-需求文档', 'REQUIREMENT.md');
  const analysis = join(iterDir, '00-需求文档', 'ANALYSIS.md');
  if (!(await pathExists(reqDoc))) {
    execSync(`speccore doc2spec -f PRD.docx -i ${iteration} --no-ai`, { stdio: 'inherit' });
  } else if (!(await pathExists(analysis))) {
    execSync(`speccore analyze --iteration=${iteration}`, { stdio: 'inherit' });
  }
}

async function renderDevHtml(options: DevOptions): Promise<string> {
  const version = require('../../package.json').version;
  const iteration = await getDefaultIteration(options.iteration);
  const iterName = (!iteration || iteration.length < 2) ? '' : iteration;
  const iterDir = iterName ? `期次-${iterName}` : '';
  const now = new Date().toISOString().split('T')[0];

  const isInit = await pathExists('.speccore');
  const phases: DevPhase[] = [
    { name: '初始化',   key: 'init',    done: !!isInit,      icon: '🏗️', cmd: 'init',     description: '初始化 SpecCore 项目结构',        args: '' },
    { name: '导入需求', key: 'doc',     done: false,          icon: '📝', cmd: 'doc2spec', description: '导入 PRD 文档，AI 转换需求规格', args: '-f PRD.docx' + (iterName ? ' --iteration ' + iterName : '') },
    { name: '分析需求', key: 'analyze', done: false,          icon: '🧠', cmd: 'analyze',  description: 'AI 分析需求文档，生成审计报告', args: iterName ? '--iteration=' + iterName : '' },
    { name: '拆分任务', key: 'split',   done: false,          icon: '📦', cmd: 'split',    description: '将需求拆分为独立开发任务',         args: '-f REQUIREMENT.md' },
    { name: '执行开发', key: 'execute', done: false,          icon: '⚡', cmd: 'execute',  description: '按计划分批执行开发任务',           args: '--auto' },
    { name: '提交 PR',  key: 'pr',      done: false,          icon: '🔀', cmd: 'pr',       description: '代码提交后创建 Pull Request',       args: '--auto' },
    { name: '归档收尾', key: 'done',    done: false,          icon: '✅', cmd: 'done',     description: '校验、同步、审计，归档记录',       args: '--all' },
  ];

  if (iterDir) {
    const reqDoc = join(iterDir, '00-需求文档', 'REQUIREMENT.md');
    const analysis = join(iterDir, '00-需求文档', 'ANALYSIS.md');
    if (await pathExists(reqDoc)) phases[1].done = true;
    if (await pathExists(analysis)) phases[2].done = true;
    try {
      const entries = await readdir(iterDir, { withFileTypes: true });
      if (entries.filter(e => e.isDirectory() && e.name.startsWith('Task-')).length > 0) phases[3].done = true;
    } catch {}
  }

  const currentIdx = phases.findIndex(p => !p.done);
  const current = currentIdx >= 0 ? phases[currentIdx] : phases[phases.length - 1];

  // Build pipeline state for LLM
  const state: DevPipelineState = { iteration: iterName, phases, currentIdx, currentPhase: current };

  // ── 尝试宿主 AI 获取智能建议 ──
  let aiSuggestion = '';
  try {
    const hostResult = await tryHostAi('dev', 'pipeline-status', {
      iteration: iterName,
      currentPhase: current.name,
      currentPhaseKey: current.key,
      completedPhases: phases.filter(p => p.done).map(p => p.key),
      pendingPhases: phases.filter(p => !p.done).map(p => p.key),
    });
    if (hostResult?.summary) {
      aiSuggestion = hostResult.summary;
    }
  } catch {}

  // Phase flow HTML
  const flowHtml = phases.map((p, i) => {
    const isCurrent = i === currentIdx;
    const cls = p.done ? 'done' : isCurrent ? 'current' : 'pending';
    return `<div class="phase ${cls}"><span class="phase-icon">${p.icon}</span><span class="phase-name">${p.name}</span>${i < phases.length-1 ? '<span class="phase-arrow">→</span>' : ''}</div>`;
  }).join('');

  // Phase buttons for quick action
  const phaseButtons = phases.map(p => {
    if (p.done) return `<button class="phase-btn done" disabled>${p.icon} ${p.name} ✓</button>`;
    return `<button class="phase-btn" onclick="handleAction('jump-to','${p.key}')" title="跳转到${p.name}">${p.icon} ${p.name}</button>`;
  }).join('\n');

  // State data for JS
  const stateJson = JSON.stringify(state).replace(/"/g, '&quot;');

  return `<!DOCTYPE html><html lang="zh-CN" data-theme="ocean"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>SpecCore Dev · Pipeline</title><style>@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;600;700&display=swap');[data-theme="ocean"]{--cyan:#0ea5e9;--bg:#0b1929;--card:rgba(13,31,56,.95);--border:rgba(14,165,233,.15);--text:#bae6fd;--muted:#5b7fa5;--green:#14b8a6;--orange:#f97316;--purple:#6366f1}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'JetBrains Mono',monospace;background:var(--bg);color:var(--text);min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;gap:20px}.scanlines{position:fixed;inset:0;pointer-events:none;z-index:99;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,.01) 2px,rgba(0,240,255,.01) 4px)}.card{max-width:680px;width:100%;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:36px;position:relative;overflow:hidden}.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX 3s linear infinite}.card::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX-rev 3s linear infinite}@keyframes scanX{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}@keyframes scanX-rev{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}@keyframes scanY{0%{transform:translateY(-100%)}100%{transform:translateY(100%)}}@keyframes scanY-rev{0%{transform:translateY(100%)}100%{transform:translateY(-100%)}}.vline{position:absolute;top:0;width:1px;bottom:0;pointer-events:none}.vline.l{left:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY-rev 3s linear infinite}.vline.r{right:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY 3s linear infinite}h1{font-family:'Orbitron',sans-serif;font-size:22px;font-weight:900;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:2px;margin-bottom:4px}.subtitle{color:var(--muted);font-size:11px;margin-bottom:16px}.flow{display:flex;align-items:center;gap:0;margin:16px 0;flex-wrap:wrap;justify-content:center}.phase{display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:10px;font-size:12px;transition:all .3s;border:1px solid transparent}.phase.done{background:rgba(20,184,166,.1);border-color:rgba(20,184,166,.3);color:var(--green)}.phase.current{background:rgba(14,165,233,.15);border-color:rgba(14,165,233,.5);color:var(--cyan);box-shadow:0 0 16px rgba(14,165,233,.15);animation:glow 2s ease-in-out infinite}.phase.pending{background:rgba(255,255,255,.02);border-color:rgba(255,255,255,.05);color:var(--muted)}.phase-arrow{color:var(--muted);font-size:16px;margin:0 2px}@keyframes glow{0%,100%{box-shadow:0 0 16px rgba(14,165,233,.15)}50%{box-shadow:0 0 24px rgba(14,165,233,.3)}}.cur-section{padding:16px;background:rgba(14,165,233,.06);border:1px solid rgba(14,165,233,.15);border-radius:10px;margin:16px 0}.cur-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:8px}.cur-cmd{font-family:'JetBrains Mono',monospace;font-size:14px;color:var(--cyan);background:rgba(14,165,233,.08);padding:6px 12px;border-radius:6px;display:inline-block}.action-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.action-btns button,.phase-btn{padding:8px 16px;border-radius:8px;border:1px solid var(--border);background:var(--surface, rgba(255,255,255,.03));color:var(--text);cursor:pointer;font-size:11px;font-family:'JetBrains Mono',monospace;transition:all .2s}.action-btns button:hover,.phase-btn:hover{border-color:var(--cyan);color:var(--cyan);background:rgba(14,165,233,.08)}.action-btns button.primary{background:rgba(14,165,233,.12);border-color:rgba(14,165,233,.4);color:var(--cyan)}.action-btns button.danger{border-color:rgba(249,115,22,.3);color:var(--orange)}.action-btns button.danger:hover{border-color:var(--orange);background:rgba(249,115,22,.08)}.phase-btn{font-size:10px;padding:6px 10px}.phase-btn.done{opacity:.4;cursor:default}.input-row{display:flex;gap:8px;margin:16px 0}.input-row input{flex:1;padding:10px 14px;border-radius:10px;border:1px solid var(--border);background:rgba(255,255,255,.03);color:var(--text);font-size:12px;font-family:'JetBrains Mono',monospace;outline:none;transition:all .2s}.input-row input:focus{border-color:var(--cyan);box-shadow:0 0 12px rgba(14,165,233,.1)}.input-row button{padding:10px 16px;border-radius:10px;border:1px solid var(--cyan);background:rgba(14,165,233,.1);color:var(--cyan);cursor:pointer;font-size:12px;font-family:'JetBrains Mono',monospace;transition:all .2s}.input-row button:hover{background:rgba(14,165,233,.2)}.result-box{margin-top:16px;padding:16px;background:rgba(14,165,233,.04);border:1px solid rgba(14,165,233,.1);border-radius:10px;display:none}.result-box.show{display:block}.result-cmd{font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--green);background:rgba(20,184,166,.08);padding:6px 10px;border-radius:4px;margin:4px 0;display:inline-block}.result-summary{font-size:12px;color:var(--text);margin-bottom:8px}.quick-phase{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}.footer{text-align:center;color:var(--muted);font-size:10px;margin-top:8px}</style></head><body><div class="scanlines"></div>

<div class="card"><div class="vline l"></div><div class="vline r"></div>
<h1>SPECCORE DEV</h1>
<div class="subtitle">${iterName ? '期次: ' + iterName + ' · ' : ''}${phases.filter(p=>p.done).length}/${phases.length} 阶段完成 · Pipeline 引导${aiSuggestion ? '<br><span style="color:var(--cyan);font-size:10px">💡 ' + aiSuggestion + '</span>' : ''}</div>

<div class="flow">${flowHtml}</div>

<div class="cur-section">
  <div class="cur-label">📍 当前阶段</div>
  <div class="cur-cmd">${current.icon} ${current.name} → speccore ${current.cmd}${current.args ? ' ' + current.args : ''}</div>

  <div class="action-btns">
    <button class="primary" onclick="handleAction('next','${current.key}')">▶ 下一步</button>
    <button onclick="handleAction('auto-all','all')">⚡ 一键自动</button>
    <button onclick="handleAction('skip-to','${currentIdx+1 < phases.length ? phases[currentIdx+1].key : current.key}')">⏭ 跳过当前</button>
    <button class="danger" onclick="handleAction('restart','init')">🔄 重新开始</button>
  </div>
</div>

<div class="quick-phase">
  <div style="font-size:10px;color:var(--muted);margin-right:8px;">直接跳转:</div>
  ${phaseButtons}
</div>

<div class="input-row">
  <input id="userInput" type="text" placeholder="💬 或者直接说... 比如「从分析开始」「跳过导入直接拆分」" onkeydown="if(event.key==='Enter')handleCustom()">
  <button onclick="handleCustom()">发送</button>
</div>

<div class="result-box" id="resultBox">
  <div class="result-summary" id="resultSummary"></div>
  <div id="resultCmds"></div>
</div>
</div>

<div class="footer">由 SpecCore 驱动 v${version} | ${now}</div>

<script>
const STATE = ${stateJson};

function handleAction(action, target) {
  const result = devRules(action, target, STATE);
  showResult(result);
}

function handleCustom() {
  const input = document.getElementById('userInput').value.trim();
  if (!input) return;
  document.getElementById('userInput').value = '';
  document.getElementById('resultSummary').textContent = '🤔 分析中...';
  const box = document.getElementById('resultBox');
  box.classList.add('show');
  
  // Try LLM first (via devRules for now, but structured for future LLM call)
  const result = devRules('custom', '', STATE, input);
  showResult(result);
}

function showResult(result) {
  const box = document.getElementById('resultBox');
  box.classList.add('show');
  document.getElementById('resultSummary').textContent = '🧠 ' + result.summary;
  
  let cmdsHtml = '';
  result.commands.forEach(c => {
    cmdsHtml += '<div class="result-cmd">$ speccore ' + c.command + (c.args ? ' ' + c.args : '') + '</div>';
    cmdsHtml += '<div style="font-size:10px;color:var(--muted);margin:2px 0 8px 4px;">→ ' + c.explanation + '</div>';
  });
  document.getElementById('resultCmds').innerHTML = cmdsHtml;
}

// Rule-based dev guidance (LLM fallback)
function devRules(action, target, state, customInput) {
  const iterArg = state.iteration ? ' --iteration=' + state.iteration : '';
  const cur = state.currentPhase;
  const phases = state.phases;
  
  // Handle custom input
  if (action === 'custom' && customInput) {
    const lower = customInput.toLowerCase();
    
    // Check for specific phase targeting
    for (const p of phases) {
      if (lower.includes(p.key) || lower.includes(p.name)) {
        if (p.done) return { action:'restart', targetPhase:p.key, summary:'从「'+p.name+'」重新开始', commands:phases.slice(phases.indexOf(p)).filter(x=>!x.done).map((ph,i)=>({order:i+1,command:ph.cmd,args:ph.args||iterArg,explanation:ph.description}))};
        return { action:'jump-to', targetPhase:p.key, summary:'跳转到「'+p.name+'」', commands:[{order:1,command:p.cmd,args:p.args||iterArg,explanation:p.description}] };
      }
    }
    
    if (/一键|全部|自动|all/i.test(lower)) {
      const pending = phases.filter(p=>!p.done);
      return { action:'auto-all', targetPhase:'all', summary:'一键执行全部'+pending.length+'个阶段', commands:pending.map((p,i)=>({order:i+1,command:p.cmd,args:p.args||iterArg,explanation:p.description})) };
    }
    
    if (/跳过|skip/i.test(lower)) {
      const nextIdx = state.currentIdx + 1;
      if (nextIdx < phases.length) {
        const next = phases[nextIdx];
        return { action:'skip-to', targetPhase:next.key, summary:'跳过当前→'+next.name, commands:[{order:1,command:next.cmd,args:next.args||iterArg,explanation:next.description}] };
      }
    }
  }
  
  // Standard actions
  switch(action) {
    case 'auto-all': {
      const pending = phases.filter(p=>!p.done);
      return { action:'auto-all', targetPhase:'all', summary:'一键执行全部'+pending.length+'个阶段', commands:pending.map((p,i)=>({order:i+1,command:p.cmd,args:p.args||iterArg,explanation:p.description})) };
    }
    case 'next': return { action:'next', targetPhase:cur.key, summary:'执行下一步: '+cur.name, commands:[{order:1,command:cur.cmd,args:cur.args||iterArg,explanation:cur.description}] };
    case 'skip-to': {
      const next = phases.find(p=>p.key===target) || phases[state.currentIdx+1];
      if (!next) return { action:'next', targetPhase:cur.key, summary:'已是最后阶段', commands:[{order:1,command:'dashboard',args:'--scope global',explanation:'查看全局仪表盘'}] };
      return { action:'skip-to', targetPhase:next.key, summary:'跳过→'+next.name, commands:[{order:1,command:next.cmd,args:next.args||iterArg,explanation:next.description}] };
    }
    case 'jump-to': {
      const targetPhase = phases.find(p=>p.key===target);
      if (!targetPhase) return { action:'next', targetPhase:cur.key, summary:'未找到目标阶段', commands:[{order:1,command:cur.cmd,args:cur.args||iterArg,explanation:cur.description}] };
      if (targetPhase.done) return { action:'next', targetPhase:cur.key, summary:targetPhase.name+'已完成', commands:[{order:1,command:cur.cmd,args:cur.args||iterArg,explanation:cur.description}] };
      return { action:'jump-to', targetPhase:target, summary:'跳转到「'+targetPhase.name+'」', commands:[{order:1,command:targetPhase.cmd,args:targetPhase.args||iterArg,explanation:targetPhase.description}] };
    }
    case 'restart': {
      const fromIdx = phases.findIndex(p=>p.key===target);
      const fromList = phases.slice(Math.max(0, fromIdx)).filter(p=>!p.done || phases.indexOf(p)>=fromIdx);
      return { action:'restart', targetPhase:target, summary:'从「'+(phases[fromIdx]?phases[fromIdx].name:'头')+'」重新开始', commands:fromList.map((p,i)=>({order:i+1,command:p.cmd,args:p.args||iterArg,explanation:p.description})) };
    }
    default: return { action:'next', targetPhase:cur.key, summary:'执行: '+cur.name, commands:[{order:1,command:cur.cmd,args:cur.args||iterArg,explanation:cur.description}] };
  }
}
</script></body></html>`;
}
