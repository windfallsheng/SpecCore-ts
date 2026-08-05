/**
 * dev — 智能开发入口（Web 模式）
 * TTY → 终端框线，非 TTY → HTML 页面
 */
import { pathExists, readdir } from 'fs-extra';
import { join } from 'path';
import { execSync } from 'child_process';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';

interface DevOptions {
  iteration?: string; force?: boolean; auto?: boolean; from?: string; to?: string;
  web?: boolean; output?: string;
}

export async function devCommand(options: DevOptions): Promise<void> {
  // 非 TTY → HTML 预览
  if (!process.stdout.isTTY) {
    const html = await renderDevHtml(options);
    const outPath = options.output || join(process.cwd(), 'speccore-dev.html');
    await require('fs-extra').writeFile(outPath, html);
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

// ── autoPipeline (保留原有逻辑) ──
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

  // Detect phases
  const isInit = await pathExists('.speccore');
  const phases = [
    { name: '初始化',   key: 'init',    done: !!isInit,      icon: '🏗️', cmd: 'init' },
    { name: '导入需求', key: 'doc',     done: false,          icon: '📝', cmd: 'doc2spec' },
    { name: '分析需求', key: 'analyze', done: false,          icon: '🧠', cmd: 'analyze' },
    { name: '拆分任务', key: 'split',   done: false,          icon: '📦', cmd: 'split' },
    { name: '执行开发', key: 'execute', done: false,          icon: '⚡', cmd: 'execute' },
    { name: '提交 PR',  key: 'pr',      done: false,          icon: '🔀', cmd: 'pr' },
    { name: '归档收尾', key: 'done',    done: false,          icon: '✅', cmd: 'done' },
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

  // Current phase: first not done
  const currentIdx = phases.findIndex(p => !p.done);
  const current = currentIdx >= 0 ? phases[currentIdx] : phases[phases.length - 1];

  const flowHtml = phases.map((p, i) => {
    const isCurrent = i === currentIdx;
    const cls = p.done ? 'done' : isCurrent ? 'current' : 'pending';
    return `<div class="phase ${cls}"><span class="phase-icon">${p.icon}</span><span class="phase-name">${p.name}</span>${i < phases.length-1 ? '<span class="phase-arrow">→</span>' : ''}</div>`;
  }).join('');

  const nextCmd = current ? `speccore ${current.cmd}${iterName ? ' --iteration=' + iterName : ''}` : 'speccore dashboard';
  const nextDesc = current ? phases.find(p => p.key === current.key)!.name : '项目已完成';

  return `<!DOCTYPE html><html lang="zh-CN" data-theme="ocean"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>SpecCore Dev · Pipeline</title><style>@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;600;700&display=swap');[data-theme="ocean"]{--cyan:#0ea5e9;--bg:#0b1929;--card:rgba(13,31,56,.95);--border:rgba(14,165,233,.15);--text:#bae6fd;--muted:#5b7fa5;--green:#14b8a6;--orange:#f97316;--purple:#6366f1}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'JetBrains Mono',monospace;background:var(--bg);color:var(--text);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.scanlines{position:fixed;inset:0;pointer-events:none;z-index:99;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,.01) 2px,rgba(0,240,255,.01) 4px)}.card{max-width:640px;width:100%;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:36px;position:relative;overflow:hidden}.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX 3s linear infinite}.card::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX-rev 3s linear infinite}@keyframes scanX{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}@keyframes scanX-rev{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}@keyframes scanY{0%{transform:translateY(-100%)}100%{transform:translateY(100%)}}@keyframes scanY-rev{0%{transform:translateY(100%)}100%{transform:translateY(-100%)}}.vline{position:absolute;top:0;width:1px;bottom:0;pointer-events:none}.vline.l{left:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY-rev 3s linear infinite}.vline.r{right:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY 3s linear infinite}h1{font-family:'Orbitron',sans-serif;font-size:28px;font-weight:900;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:2px}.sub{color:var(--muted);font-size:12px;margin:8px 0 24px}.flow{display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin:16px 0}.phase{display:flex;align-items:center;gap:4px;padding:6px 10px;border-radius:8px;font-size:10px}.phase.done{background:rgba(20,184,166,.08);color:var(--green)}.phase.current{background:rgba(14,165,233,.12);color:var(--cyan);border:1px solid rgba(14,165,233,.3)}.phase.pending{background:rgba(255,255,255,.02);color:var(--muted)}.phase-arrow{color:var(--muted);font-size:12px}.section{margin:20px 0;padding:16px;background:rgba(14,165,233,.03);border:1px solid rgba(14,165,233,.08);border-radius:10px}.section-title{font-size:11px;font-weight:700;color:var(--cyan);text-transform:uppercase;letter-spacing:2px;margin-bottom:10px}.next-cmd{display:block;padding:12px 16px;background:rgba(14,165,233,.1);border:1px solid rgba(14,165,233,.2);border-radius:8px;color:var(--cyan);font-weight:600;margin-top:8px;cursor:pointer;transition:all .2s}.next-cmd:hover{background:rgba(14,165,233,.2)}.footer{text-align:center;color:var(--muted);font-size:10px;margin-top:24px;padding-top:16px;border-top:1px solid rgba(255,255,255,.04)}</style></head><body><div class="scanlines"></div><div class="card"><div class="vline l"></div><div class="vline r"></div><h1>SPECCORE DEV</h1><div class="sub">智能级联 · 自动推进 · v${version}${iterName?' · '+iterName:''}</div><div class="section"><div class="section-title">🔄 Pipeline 状态</div><div class="flow">${flowHtml}</div></div><div class="section"><div class="section-title">📌 下一步: ${nextDesc}</div><div class="next-cmd">$ ${nextCmd}</div></div><div class="footer">由 SpecCore 驱动 v${version} | ${now}</div></div></body></html>`;
}