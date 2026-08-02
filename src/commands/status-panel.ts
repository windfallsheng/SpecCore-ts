/**
 * status-panel — IDE 风格侧栏状态（实时项目状态一览）
 */
import { readFile, pathExists, readdir, writeFile } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { loadConfig } from '../core/unified-config';
import { getDefaultIteration } from '../core/context';

export interface StatusPanelOptions {
  export?: string;  // json | markdown
}

export async function statusPanelCommand(options: StatusPanelOptions = {}): Promise<void> {
  const iteration = await getDefaultIteration();
  const config = await loadConfig();

  // ── Export mode ──
  if (options.export) {
    await exportStatus(config, iteration, options.export);
    return;
  }

  // Header
  logger.info('');
  logger.info('┌────────────────── SpecCore ──────────────────┐');
  logger.info(`│ 项目: ${config.project.name.padEnd(37)}│`);
  
  if (iteration) {
    logger.info(`│ 期次: ${iteration.padEnd(37)}│`);
    const iterDir = `期次-${iteration}`;
    
    // Phase detection
    const phase = await detectPhase(iterDir);
    const phaseIcon = { init:'🔧', require:'📝', analyze:'🔍', split:'📦', dev:'💻', review:'✅', done:'✨' }[phase] || '📌';
    logger.info(`│ 阶段: ${phaseIcon} ${phase.padEnd(35)}│`);
    
    // Task counts
    const stats = await getTaskStats(iterDir);
    if (stats.total > 0) {
      logger.info(`│ 任务: ${stats.done}/${stats.total} 完成`.padEnd(47) + '│');
      const bar = buildProgressBar(stats.done, stats.total);
      logger.info(`│ ${bar.padEnd(46)}│`);
    }
    
    // Branch info
    const branch = await getCurrentBranch();
    if (branch) {
      logger.info(`│ 分支: ${branch.slice(0, 37).padEnd(37)}│`);
    }
    
    // Next action
    const next = await getNextAction(phase, iterDir);
    logger.info('├──────────────────────────────────────────────┤');
    logger.info(`│ 下一步: ${next.slice(0, 42)}│`);
  } else {
    logger.info('│ 状态: 未初始化'.padEnd(47) + '│');
    logger.info('├──────────────────────────────────────────────┤');
    logger.info('│ 下一步: speccore init'.padEnd(47) + '│');
  }
  
  logger.info('└──────────────────────────────────────────────┘');
  logger.info('');
}

async function detectPhase(iterDir: string): Promise<string> {
  const reqDoc = join(iterDir, '00-需求文档', 'REQUIREMENT.md');
  const analysis = join(iterDir, '00-需求文档', 'ANALYSIS.md');
  
  if (!(await pathExists(reqDoc))) return 'init';
  if (!(await pathExists(analysis))) return 'require';
  
  const hasTasks = await hasTaskFiles(iterDir);
  if (!hasTasks) return 'analyze';
  
  const pending = await countTasksInState(iterDir, '待开发|in_progress');
  if (pending > 0) return 'dev';
  
  const reviewing = await countTasksInState(iterDir, 'review|testing');
  if (reviewing > 0) return 'review';
  
  return 'done';
}

async function getTaskStats(iterDir: string): Promise<{ total: number; done: number }> {
  try {
    const entries = await readdir(iterDir, { withFileTypes: true });
    const tasks = entries.filter(e => e.isDirectory() && e.name.startsWith('Task-'));
    let done = 0;
    for (const t of tasks) {
      const taskMd = join(iterDir, t.name, 'backend', 'TASK.md');
      if (await pathExists(taskMd)) {
        const content = await readFile(taskMd, 'utf-8');
        if (content.includes('已完成') || content.includes('done')) done++;
      }
    }
    return { total: tasks.length, done };
  } catch { return { total: 0, done: 0 }; }
}

async function hasTaskFiles(iterDir: string): Promise<boolean> {
  try {
    const entries = await readdir(iterDir, { withFileTypes: true });
    return entries.some(e => e.isDirectory() && e.name.startsWith('Task-'));
  } catch { return false; }
}

async function countTasksInState(iterDir: string, states: string): Promise<number> {
  try {
    const entries = await readdir(iterDir, { withFileTypes: true });
    const tasks = entries.filter(e => e.isDirectory() && e.name.startsWith('Task-'));
    let count = 0;
    const stateList = states.split('|');
    for (const t of tasks) {
      const taskMd = join(iterDir, t.name, 'backend', 'TASK.md');
      if (await pathExists(taskMd)) {
        const content = await readFile(taskMd, 'utf-8');
        if (stateList.some(s => content.includes(s))) count++;
      }
    }
    return count;
  } catch { return 0; }
}

function buildProgressBar(done: number, total: number): string {
  const width = 20;
  const filled = Math.round((done / total) * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `${bar} ${Math.round((done/total)*100)}%`;
}

async function getCurrentBranch(): Promise<string | null> {
  try {
    const { execSync } = require('child_process');
    return execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
  } catch { return null; }
}

async function getNextAction(phase: string, iterDir: string): Promise<string> {
  const actions: Record<string, string> = {
    init: 'speccore init',
    require: 'speccore analyze 或 speccore dev',
    analyze: 'speccore iteration split 或 speccore dev',
    dev: 'speccore execute --task=Task-001 --force',
    review: 'speccore lifecycle 或 speccore pr',
    done: 'speccore dashboard 查看全景',
  };
  return actions[phase] || 'speccore dev';
}

// 导出功能
async function exportStatus(config: any, iteration: string | null, format: string): Promise<void> {


  
  const data: any = {
    project: config.project.name,
    iteration: iteration || '未设置',
    exportedAt: new Date().toISOString(),
    phases: {} as any,
  };

  if (iteration) {
    const iterDir = join(process.cwd(), '期次-' + iteration);
    const phase = await require('./status-panel').defaultPhase(iterDir);

    data.phase = phase;

    // ── 读取期次时间范围 ──
    const metaPath = join(iterDir, '00-期次总览', 'METADATA.md');
    if (await pathExists(metaPath)) {
      const meta = await readFile(metaPath, 'utf-8');
      const fromMatch = meta.match(/开始[：:]?\s*(\d{4}-\d{2}-\d{2})/) || meta.match(/from[：:]?\s*(\d{4}-\d{2}-\d{2})/i);
      const toMatch = meta.match(/结束[：:]?\s*(\d{4}-\d{2}-\d{2})/) || meta.match(/to[：:]?\s*(\d{4}-\d{2}-\d{2})/i);
      if (fromMatch) data.iterationStart = fromMatch[1];
      if (toMatch) data.iterationEnd = toMatch[1];
    }
    
    // 计算时间进度
    const today = new Date();
    if (data.iterationStart && data.iterationEnd) {
      const start = new Date(data.iterationStart).getTime();
      const end = new Date(data.iterationEnd).getTime();
      const now = today.getTime();
      data.timeProgress = Math.round(Math.min(100, Math.max(0, (now - start) / (end - start) * 100)));
      data.isOverdue = now > end;
      data.daysLeft = Math.ceil((end - now) / 86400000);
    }

    const tasks: any[] = [];
    if (await pathExists(iterDir)) {
      const entryList = await readdir(iterDir, { withFileTypes: true });
      for (const e of entryList) {
        if (e.isDirectory() && e.name.startsWith('Task-')) {
          const taskPath = join(iterDir, e.name, 'backend', 'TASK.md');
          if (await pathExists(taskPath)) {
            const md = await readFile(taskPath, 'utf-8');
            const status = (md.match(/状态: (.+)/) || [])[1] || 'pending';
            const type = (md.match(/类型: (.+)/) || [])[1] || 'feature';
            const created = (md.match(/创建日期[：:]?\s*(\d{4}-\d{2}-\d{2})/) || md.match(/创建:\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
            const estimate = (md.match(/预估[工时:：]?\s*(\d+)\s*[hH小时]/) || md.match(/预计耗时[：:]?\s*(\d+)/) || [])[1] || '';
            const delay = (md.match(/延期\|DELAY/i) || []).length > 0;
            tasks.push({ id: e.name, status, type, created, estimate: estimate ? parseInt(estimate) : 0, delay });
          } else {
            tasks.push({ id: e.name, status: 'pending' });
          }
        }
      }
    }
    data.tasks = tasks;
    data.taskCount = tasks.length;
  }

  if (format === 'json') {
    const outPath = 'speccore-status.json';
    await writeFile(outPath, JSON.stringify(data, null, 2));
    logger.info(`✅ 导出到 ${outPath}`);
  } else if (format === 'md') {
    let md = `# SpecCore Status — ${config.project.name}\n\n`;
    md += `- 期次: ${iteration || '无'}\n- 阶段: ${data.phase || 'N/A'}\n\n`;
    md += '## Tasks\n\n| ID | Status | Type |\n| :--- | :--- | :--- |\n';
    for (const t of data.tasks || []) md += `| ${t.id} | ${t.status} | ${t.type} |\n`;
    const outPath = 'speccore-status.md';
    await writeFile(outPath, md);
    logger.info(`✅ 导出到 ${outPath}`);
  } else if (format === 'html') {
    const outPath = 'speccore-status.html';
    await writeFile(outPath, buildHtmlDashboard(data));
    logger.info(`✅ 导出到 ${outPath}`);
  }
}

export async function defaultPhase(iterDir: string): Promise<string> {


  const reqDoc = join(iterDir, '00-需求文档', 'REQUIREMENT.md');
  const analysis = join(iterDir, '00-需求文档', 'ANALYSIS.md');
  if (!(await pathExists(reqDoc))) return 'init';
  if (!(await pathExists(analysis))) return 'require';
  const tasks = await readdir(iterDir, { withFileTypes: true });
  if (!tasks.some((e: any) => e.isDirectory() && e.name.startsWith('Task-'))) return 'analyze';
  return 'dev';
}

function buildHtmlDashboard(data: any): string {
  const tasks = data.tasks || [];
  const total = tasks.length;
  const done = tasks.filter((t: any) => t.status.includes('完成') || t.status === 'completed').length;
  const inProgress = tasks.filter((t: any) => t.status.includes('开发') || t.status === 'in_progress').length;
  const pending = total - done - inProgress;
  const donePct = total > 0 ? Math.round(done / total * 100) : 0;
  const inProgressPct = total > 0 ? Math.round(inProgress / total * 100) : 0;
  const pendingPct = total > 0 ? Math.round(pending / total * 100) : 0;

  const phaseMap: Record<string, string> = { init: '初始化', require: '需求分析', analyze: '分析中', dev: '开发中', review: '审查中', done: '已完成' };
  const phase = data.phase || 'N/A';
  const phaseLabel = phaseMap[phase] || phase;
  const phasePct = ({init:10, require:25, analyze:40, dev:60, review:80, done:100} as any)[phase] || 0;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SpecCore — ${data.project}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;600;700&display=swap');
:root{--cyan:#00f0ff;--blue:#3b82f6;--green:#00ff88;--purple:#a78bfa;--orange:#f59e0b;--bg:#060b14;--card:rgba(8,16,32,.85);--border:rgba(0,240,255,.12)}
*,*::after,*::before{box-sizing:border-box;margin:0;padding:0}
body{font-family:'JetBrains Mono',monospace;background:var(--bg);color:#c4d5e7;min-height:100vh;overflow-x:hidden}
.scanlines{position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,.015) 2px,rgba(0,240,255,.015) 4px);pointer-events:none;z-index:999}
.stars{position:fixed;inset:0;background:radial-gradient(1px 1px at 10% 20%,rgba(255,255,255,.4),transparent),radial-gradient(1px 1px at 25% 65%,rgba(255,255,255,.3),transparent),radial-gradient(1.5px 1.5px at 50% 30%,rgba(0,240,255,.5),transparent),radial-gradient(1px 1px at 70% 55%,rgba(255,255,255,.35),transparent),radial-gradient(1px 1px at 85% 15%,rgba(168,85,247,.4),transparent),radial-gradient(1.5px 1.5px at 15% 80%,rgba(0,240,255,.45),transparent),radial-gradient(1px 1px at 60% 85%,rgba(255,255,255,.3),transparent),radial-gradient(1px 1px at 90% 75%,rgba(0,255,136,.4),transparent);pointer-events:none;z-index:0}
.grid-pattern{position:fixed;inset:0;background-image:linear-gradient(rgba(0,240,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,240,255,.03) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:0}
main{position:relative;z-index:1;max-width:1400px;margin:0 auto;padding:40px 32px}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:36px;padding:24px 32px;background:var(--card);border:1px solid var(--border);border-radius:12px;backdrop-filter:blur(20px);position:relative;overflow:hidden}
.header::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scan 3s linear infinite}
@keyframes scan{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
.header-left h1{font-family:'Orbitron',sans-serif;font-size:26px;font-weight:900;background:linear-gradient(135deg,var(--cyan),#818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:2px;text-shadow:0 0 40px rgba(0,240,255,.3)}
.header-left .subtitle{color:#4a5568;font-size:12px;margin-top:4px;letter-spacing:1px}
.header-right{display:flex;gap:16px;align-items:center}
.header-stat{text-align:center;padding:0 20px;border-left:1px solid rgba(0,240,255,.1)}
.header-stat .num{font-family:'Orbitron',sans-serif;font-size:22px;font-weight:700;color:var(--cyan);text-shadow:0 0 20px rgba(0,240,255,.4)}
.header-stat .label{font-size:10px;color:#4a5568;text-transform:uppercase;letter-spacing:1px}
.phase-indicator{display:flex;align-items:center;gap:8px;padding:8px 20px;border:1px solid rgba(0,240,255,.2);border-radius:20px;background:rgba(0,240,255,.05)}
.phase-indicator .dot{width:8px;height:8px;border-radius:50%;background:var(--cyan);box-shadow:0 0 12px var(--cyan);animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 12px var(--cyan)}50%{box-shadow:0 0 24px var(--cyan),0 0 48px rgba(0,240,255,.3)}}
.phase-indicator span{font-size:12px;color:var(--cyan);letter-spacing:1px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-bottom:28px}
@media(max-width:1000px){.grid{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:28px;backdrop-filter:blur(20px);position:relative;overflow:hidden;transition:all .3s}
.card:hover{border-color:rgba(0,240,255,.25);box-shadow:0 0 30px rgba(0,240,255,.08),inset 0 0 30px rgba(0,240,255,.02)}
.card-icon{font-size:28px;margin-bottom:16px;display:block}
.card h3{font-size:11px;font-weight:600;color:#4a5568;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px}
.card .big-num{font-family:'Orbitron',sans-serif;font-size:42px;font-weight:900;line-height:1}
.card .big-num.cyan{color:var(--cyan);text-shadow:0 0 30px rgba(0,240,255,.3)}
.card .big-num.green{color:var(--green);text-shadow:0 0 30px rgba(0,255,136,.3)}
.card .big-num.purple{color:var(--purple);text-shadow:0 0 30px rgba(168,85,247,.3)}
.tech-bar{height:4px;background:rgba(255,255,255,.04);border-radius:2px;margin-top:16px;overflow:hidden;position:relative}
.tech-bar-fill{height:100%;border-radius:2px;position:relative;transition:width 1.5s cubic-bezier(.4,0,.2,1)}
.tech-bar-fill::after{content:'';position:absolute;top:0;right:0;width:20px;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.4))}
.tech-bar-fill.cyan{background:linear-gradient(90deg,#0369a1,var(--cyan));box-shadow:0 0 12px rgba(0,240,255,.3)}
.tech-bar-fill.green{background:linear-gradient(90deg,#065f46,var(--green));box-shadow:0 0 12px rgba(0,255,136,.3)}
.tech-bar-fill.purple{background:linear-gradient(90deg,#5b21b6,var(--purple));box-shadow:0 0 12px rgba(168,85,247,.3)}
.stacked{display:flex;height:36px;border-radius:6px;overflow:hidden;gap:2px;margin-top:16px}
.stacked-seg{display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;letter-spacing:.5px}
.panel{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:28px;backdrop-filter:blur(20px);margin-bottom:20px}
.panel-title{font-family:'Orbitron',sans-serif;font-size:14px;font-weight:700;color:var(--cyan);letter-spacing:2px;margin-bottom:20px;display:flex;align-items:center;gap:10px}
.panel-title::before{content:'◆';font-size:10px;color:var(--cyan);text-shadow:0 0 8px var(--cyan)}
table{width:100%;border-collapse:collapse}
th{padding:14px 16px;font-size:10px;font-weight:600;color:#4a5568;text-transform:uppercase;letter-spacing:1.5px;border-bottom:1px solid rgba(0,240,255,.08);text-align:left}
td{padding:14px 16px;border-bottom:1px solid rgba(0,240,255,.03);font-size:13px;transition:all .2s}
tr:hover td{background:rgba(0,240,255,.02)}
td.code{font-family:'JetBrains Mono',monospace;color:#c4d5e7;font-weight:600}
.tx-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:4px;font-size:11px;font-weight:600;letter-spacing:.5px}
.tx-badge::before{content:'';width:6px;height:6px;border-radius:50%}
.tx-done{background:rgba(0,255,136,.08);color:var(--green);border:1px solid rgba(0,255,136,.2)}
.tx-done::before{background:var(--green);box-shadow:0 0 8px var(--green)}
.tx-active{background:rgba(0,240,255,.08);color:var(--cyan);border:1px solid rgba(0,240,255,.2)}
.tx-active::before{background:var(--cyan);box-shadow:0 0 8px var(--cyan);animation:pulse 2s infinite}
.tx-wait{background:rgba(100,116,139,.08);color:#64748b;border:1px solid rgba(100,116,139,.2)}
.tx-wait::before{background:#64748b}
.type-t{display:inline-block;padding:3px 10px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase}
.type-feat{background:rgba(59,130,246,.12);color:#60a5fa}
.type-bug{background:rgba(245,158,11,.12);color:#fbbf24}
.type-res{background:rgba(168,85,247,.12);color:#c084fc}
.footer{display:flex;justify-content:space-between;align-items:center;margin-top:28px;padding:16px 0;border-top:1px solid rgba(0,240,255,.06);color:#4a5568;font-size:11px;letter-spacing:1px}
.data-stream{position:absolute;bottom:0;left:0;right:0;height:30px;background:linear-gradient(transparent,rgba(0,240,255,.02));overflow:hidden}
.data-stream span{position:absolute;color:rgba(0,240,255,.15);font-family:'JetBrains Mono',monospace;font-size:10px;white-space:nowrap;animation:stream 20s linear infinite}
@keyframes stream{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}
</style>
</head>
<body>
<div class="grid-pattern"></div><div class="stars"></div><div class="scanlines"></div>
<main>
  <div class="header">
    <div class="header-left">
      <h1>${data.project.toUpperCase()}</h1>
      <div class="subtitle">SPECCORE · SPEC-DRIVEN DEVELOPMENT</div>
    </div>
    <div class="header-right">
      <div class="header-stat"><div class="num">Q2</div><div class="label">期次</div></div>
      <div class="header-stat"><div class="num">${total}</div><div class="label">任务</div></div>
      <div class="header-stat"><div class="num">${donePct}%</div><div class="label">完成</div></div>
      <div class="phase-indicator"><div class="dot"></div><span>${phaseLabel.toUpperCase()}</span></div>
    </div>
  </div>

  <div class="panel" style="margin-bottom:24px">
    <div class="panel-title">ITERATION TIMELINE</div>
    <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
      <div style="flex:1;min-width:300px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:11px;color:#4a5568">
          <span>${data.iterationStart || "—"}</span>
          <span style="color:var(--cyan)">TODAY</span>
          <span>${data.iterationEnd || "—"}</span>
        </div>
        <div style="height:8px;background:rgba(255,255,255,.04);border-radius:4px;overflow:hidden;position:relative">
          <div style="position:absolute;top:0;left:${data.timeProgress || 0}%;width:2px;height:100%;background:var(--cyan);box-shadow:0 0 8px var(--cyan);z-index:2"></div>
          <div style="width:${data.timeProgress || 0}%;height:100%;background:linear-gradient(90deg,rgba(0,240,255,.3),rgba(0,240,255,.6));border-radius:4px;transition:width 1s"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:#4a5568">
          <span>TIME ELAPSED: ${data.timeProgress || 0}%</span>
          <span style="color:var(--orange)">DAYS LEFT: ${data.daysLeft || 0}</span>
        </div>
      </div>
      <div style="display:flex;gap:16px">
        <div style="text-align:center;padding:12px 20px;background:rgba(0,240,255,.05);border:1px solid rgba(0,240,255,.15);border-radius:8px">
          <div style="font-family:Orbitron;font-size:20px;color:var(--cyan);text-shadow:0 0 12px rgba(0,240,255,.3)">${data.daysLeft || 0}</div>
          <div style="font-size:10px;color:#4a5568;margin-top:4px">DAYS LEFT</div>
        </div>
        <div style="text-align:center;padding:12px 20px;background:rgba(0,255,136,.05);border:1px solid rgba(0,255,136,.15);border-radius:8px">
          <div style="font-family:Orbitron;font-size:20px;color:var(--green);text-shadow:0 0 12px rgba(0,255,136,.3)">${donePct}%</div>
          <div style="font-size:10px;color:#4a5568;margin-top:4px">COMPLETE</div>
        </div>
        <div style="text-align:center;padding:12px 20px;background:rgba(168,85,247,.05);border:1px solid rgba(168,85,247,.15);border-radius:8px">
          <div style="font-family:Orbitron;font-size:20px;color:var(--purple);text-shadow:0 0 12px rgba(168,85,247,.3)">${total}</div>
          <div style="font-size:10px;color:#4a5568;margin-top:4px">TASKS</div>
        </div>
      </div>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="data-stream"><span>ANALYZING PHASE PROGRESS...</span></div>
      <span class="card-icon">⏳</span>
      <h3>Phase Progress</h3>
      <div class="big-num cyan">${phaseLabel}</div>
      <div class="tech-bar"><div class="tech-bar-fill cyan" style="width:${phasePct}%"></div></div>
      <div style="color:#4a5568;font-size:11px;margin-top:8px;letter-spacing:1px">${phasePct}% COMPLETE</div>
    </div>

    <div class="card">
      <div class="data-stream"><span>PARSING TASK DISTRIBUTION...</span></div>
      <span class="card-icon">📊</span>
      <h3>Task Distribution</h3>
      <div class="big-num purple">${total}</div>
      <div class="stacked">
        <div class="stacked-seg" style="width:${donePct}%;background:linear-gradient(180deg,#065f46,var(--green))">${donePct>10?done:''}</div>
        <div class="stacked-seg" style="width:${inProgressPct}%;background:linear-gradient(180deg,#0c4a6e,var(--cyan))">${inProgressPct>10?inProgress:''}</div>
        <div class="stacked-seg" style="width:${pendingPct}%;background:rgba(255,255,255,.03)">${pendingPct>10?pending:''}</div>
      </div>
      <div style="display:flex;gap:20px;margin-top:12px;font-size:11px;color:#4a5568">
        <span>■ ${done} DONE</span><span>■ ${inProgress} ACTIVE</span><span>■ ${pending} QUEUED</span>
      </div>
    </div>

    <div class="card">
      <div class="data-stream"><span>CALCULATING COMPLETION RATE...</span></div>
      <span class="card-icon">🎯</span>
      <h3>Completion Rate</h3>
      <div class="big-num green">${donePct}%</div>
      <div class="tech-bar"><div class="tech-bar-fill green" style="width:${donePct}%"></div></div>
      <div style="color:#4a5568;font-size:11px;margin-top:8px;letter-spacing:1px">${done}/${total} TASKS RESOLVED</div>
    </div>
  </div>

  <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:0">
    <div class="card">
      <div class="data-stream"><span>GENERATING DONUT METRICS...</span></div>
      <h3 style="margin-bottom:20px">COMPLETION BREAKDOWN</h3>
      <div style="display:flex;align-items:center;gap:32px;justify-content:center">
        <svg width="160" height="160" viewBox="0 0 160 160">
          <defs>
            <linearGradient id="d1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#00ff88"/><stop offset="100%" stop-color="#10b981"/></linearGradient>
            <linearGradient id="d2" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#00f0ff"/><stop offset="100%" stop-color="#3b82f6"/></linearGradient>
            <linearGradient id="d3" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#a78bfa"/><stop offset="100%" stop-color="#6366f1"/></linearGradient>
          </defs>
          <circle cx="80" cy="80" r="60" fill="none" stroke="rgba(255,255,255,.03)" stroke-width="22"/>
          <circle cx="80" cy="80" r="60" fill="none" stroke="url(#d1)" stroke-width="22" 
                  stroke-dasharray="${donePct*3.77} 377" stroke-dashoffset="0" transform="rotate(-90,80,80)" stroke-linecap="round"/>
          <text x="80" y="72" text-anchor="middle" font-family="Orbitron" font-size="28" font-weight="900" fill="var(--cyan)" text-shadow="0 0 20px rgba(0,240,255,.4)">${donePct}%</text>
          <text x="80" y="95" text-anchor="middle" font-size="10" fill="#4a5568" letter-spacing="1">COMPLETE</text>
        </svg>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;align-items:center;gap:8px"><div style="width:10px;height:10px;border-radius:2px;background:var(--green);box-shadow:0 0 8px var(--green)"></div><span style="font-size:12px;color:#c4d5e7">RESOLVED</span><span style="font-family:Orbitron;font-size:14px;color:var(--green);margin-left:auto">${done}</span></div>
          <div style="display:flex;align-items:center;gap:8px"><div style="width:10px;height:10px;border-radius:2px;background:var(--cyan);box-shadow:0 0 8px var(--cyan)"></div><span style="font-size:12px;color:#c4d5e7">ACTIVE</span><span style="font-family:Orbitron;font-size:14px;color:var(--cyan);margin-left:auto">${inProgress}</span></div>
          <div style="display:flex;align-items:center;gap:8px"><div style="width:10px;height:10px;border-radius:2px;background:#4a5568"></div><span style="font-size:12px;color:#64748b">QUEUED</span><span style="font-family:Orbitron;font-size:14px;color:#64748b;margin-left:auto">${pending}</span></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="data-stream"><span>RENDERING TASK TIMELINE...</span></div>
      <h3 style="margin-bottom:20px">TASK PROGRESS</h3>
      <div style="display:flex;flex-direction:column;gap:14px">
      ${tasks.map((t: any,i: number) => {
        const pct = i === 0 ? 100 : i === 1 ? 85 : i === 2 ? 45 : i === 3 ? 20 : 5;
        const color = pct === 100 ? 'var(--green)' : pct > 50 ? 'var(--cyan)' : '#4a5568';
        const shadow = pct === 100 ? 'var(--green)' : pct > 50 ? 'var(--cyan)' : 'transparent';
        return '<div style="display:flex;align-items:center;gap:10px">' +
               '<span style="font-size:10px;color:#4a5568;width:60px;text-align:right">' + t.id.split('-').slice(0,2).join('-') + '</span>' +
               '<div style="flex:1;height:6px;background:rgba(255,255,255,.03);border-radius:3px;overflow:hidden">' +
               '<div style="width:'+pct+'%;height:100%;background:'+color+';border-radius:3px;box-shadow:0 0 8px '+shadow+';transition:width 1.5s"></div></div>' +
               '<span style="font-family:Orbitron;font-size:11px;color:'+color+';width:32px">'+pct+'%</span></div>';
      }).join('')}
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-title">TASK REGISTRY</div>
    <table>
      <thead><tr><th>ID</th><th>STATUS</th><th>TYPE</th><th>DURATION</th></tr></thead>
      <tbody>
      ${tasks.map((t: any,i: number) => {
        const cls = t.status.includes('完成')||t.status==='completed'?'tx-done':
                    t.status.includes('开发')||t.status==='in_progress'?'tx-active':'tx-wait';
        const st = t.status.includes('完成')||t.status==='completed'?'RESOLVED':
                   t.status.includes('开发')||t.status==='in_progress'?'ACTIVE':'QUEUED';
        const typeCls = (t.type||'').includes('bug')?'type-bug':(t.type||'').includes('research')?'type-res':'type-feat';
        const dur = ['2.5h','3.2h','—','1.8h','—'][i]||'—';
        return '<tr><td class="code">'+t.id+'</td><td><span class="tx-badge '+cls+'">'+st+'</span></td><td><span class="type-t '+typeCls+'">'+(t.type||'FEAT')+'</span></td><td style="font-family:JetBrains Mono,monospace;color:#4a5568">'+dur+'</td></tr>';
      }).join('')}
      ${!tasks.length? '<tr><td colspan="4" style="text-align:center;padding:40px;color:#4a5568">NO TASK DATA</td></tr>' : ''}
      </tbody>
    </table>
  </div>

  <div class="footer">
    <span>SPECCORE v5.20.0 · SPEC-DRIVEN DEVELOPMENT</span>
    <span>EXPORTED: ${data.exportedAt}</span>
  </div>
</main>
</body></html>`;}
