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
            tasks.push({ id: e.name, status, type });
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
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:linear-gradient(135deg,#0a0e14 0%,#111827 30%,#0f1729 60%,#0a0e14 100%);color:#e2e8f0;min-height:100vh;padding:40px 32px}
.bg-mesh{position:fixed;top:0;left:0;width:100%;height:100%;background:radial-gradient(ellipse 800px 600px at 20% 30%,rgba(56,189,248,.06),transparent),radial-gradient(ellipse 600px 500px at 80% 70%,rgba(168,85,247,.05),transparent),radial-gradient(ellipse 500px 400px at 50% 20%,rgba(34,197,94,.04),transparent);pointer-events:none;z-index:0}
main{position:relative;z-index:1;max-width:1200px;margin:0 auto}
.topbar{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px;flex-wrap:wrap;gap:16px}
.topbar-left h1{font-size:28px;font-weight:800;background:linear-gradient(135deg,#38bdf8,#818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:-.5px}
.topbar-left .meta{color:#94a3b8;font-size:14px;margin-top:6px;display:flex;gap:16px;flex-wrap:wrap}
.topbar-left .meta span{display:flex;align-items:center;gap:6px}
.topbar-right{display:flex;gap:8px;flex-wrap:wrap}
.phase-badge{padding:8px 16px;border-radius:20px;font-size:13px;font-weight:600;background:linear-gradient(135deg,rgba(56,189,248,.15),rgba(129,140,248,.15));border:1px solid rgba(56,189,248,.3);color:#38bdf8;backdrop-filter:blur(10px)}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-bottom:28px}
.stat-card{background:rgba(17,25,40,.7);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:24px;backdrop-filter:blur(12px);transition:all .3s ease;position:relative;overflow:hidden}
.stat-card::after{content:'';position:absolute;top:-40px;right:-40px;width:120px;height:120px;border-radius:50%;opacity:.08;transition:all .4s ease}
.stat-card:hover{transform:translateY(-2px);border-color:rgba(56,189,248,.2);box-shadow:0 20px 40px rgba(0,0,0,.3)}
.stat-card:hover::after{opacity:.15;transform:scale(1.1)}
.stat-icon{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:14px}
.stat-card h3{font-size:12px;font-weight:500;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px}
.stat-value{font-size:36px;font-weight:800;letter-spacing:-1px;line-height:1}
.stat-detail{font-size:13px;color:#64748b;margin-top:8px}
.progress-bar{height:6px;background:rgba(255,255,255,.06);border-radius:3px;margin-top:14px;overflow:hidden}
.progress-fill{height:100%;border-radius:3px;transition:width 1s ease-out}
.progress-fill.blue{background:linear-gradient(90deg,#38bdf8,#818cf8)}
.progress-fill.green{background:linear-gradient(90deg,#22c55e,#10b981)}
.progress-fill.purple{background:linear-gradient(90deg,#a855f7,#c084fc)}
.ring-container{display:flex;align-items:center;gap:20px;margin-top:10px}
.ring-svg{transform:rotate(-90deg)}
.ring-bg{fill:none;stroke:rgba(255,255,255,.06);stroke-width:6}
.ring-fg{fill:none;stroke:url(#ringGrad);stroke-width:6;stroke-linecap:round;transition:stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1)}
.ring-text{font-size:28px;font-weight:800;fill:#e2e8f0}
.task-bar-wrap{margin-top:14px}
.task-bar{display:flex;height:32px;border-radius:8px;overflow:hidden;gap:3px}
.task-bar-seg{display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;transition:all .3s}
.legend{display:flex;gap:18px;margin-top:10px;flex-wrap:wrap}
.legend-item{display:flex;align-items:center;gap:6px;font-size:12px;color:#94a3b8}
.legend-dot{width:10px;height:10px;border-radius:50%}
.section-title{font-size:16px;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:10px}
.section-title::before{content:'';width:4px;height:20px;background:linear-gradient(180deg,#38bdf8,#818cf8);border-radius:2px}
.table-wrap{background:rgba(17,25,40,.7);border:1px solid rgba(255,255,255,.06);border-radius:16px;overflow:hidden;backdrop-filter:blur(12px)}
table{width:100%;border-collapse:collapse}
th{padding:14px 20px;font-size:12px;font-weight:500;color:#64748b;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid rgba(255,255,255,.06);text-align:left}
td{padding:14px 20px;border-bottom:1px solid rgba(255,255,255,.03);font-size:14px;transition:background .2s}
tr:hover td{background:rgba(56,189,248,.03)}
tr:last-child td{border-bottom:none}
.badge{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:20px;font-size:12px;font-weight:600}
.badge.done{background:rgba(34,197,94,.12);color:#22c55e}
.badge.progress{background:rgba(56,189,248,.12);color:#38bdf8}
.badge.pending{background:rgba(100,116,139,.12);color:#94a3b8}
.badge::before{content:'';width:6px;height:6px;border-radius:50%}
.badge.done::before{background:#22c55e}
.badge.progress::before{background:#38bdf8}
.badge.pending::before{background:#94a3b8}
.type-tag{padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.type-feature{background:rgba(129,140,248,.12);color:#a5b4fc}
.type-bugfix{background:rgba(251,146,60,.12);color:#fb923c}
.type-research{background:rgba(168,85,247,.12);color:#c084fc}
.phase-steps{display:flex;gap:4px;margin-top:14px}
.phase-dot{flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,.06)}
.phase-dot.active{background:#38bdf8}
.phase-dot.done{background:#22c55e}
.footer-bar{display:flex;justify-content:space-between;align-items:center;margin-top:32px;padding:16px 0;border-top:1px solid rgba(255,255,255,.04);flex-wrap:wrap;gap:12px}
.footer-bar span{color:#475569;font-size:12px}
.footer-links{display:flex;gap:16px;font-size:12px}
.footer-links a{color:#64748b;text-decoration:none;transition:color .2s}
.footer-links a:hover{color:#38bdf8}
@media(max-width:768px){body{padding:24px 16px}.topbar{flex-direction:column}.stat-value{font-size:28px}.table-wrap{overflow-x:auto}}
</style>
</head>
<body>
<div class="bg-mesh"></div>
<main>
  <div class="topbar">
    <div class="topbar-left">
      <h1>${data.project}</h1>
      <div class="meta">
        <span>📅 ${data.iteration || '未设置期次'}</span>
        <span>🕐 ${data.exportedAt.split('T')[0]}</span>
        <span>🔖 v5.20.0</span>
      </div>
    </div>
    <div class="topbar-right">
      <span class="phase-badge">📍 ${phaseLabel}</span>
    </div>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-icon" style="background:rgba(56,189,248,.12);color:#38bdf8">⏳</div>
      <h3>阶段进度</h3>
      <div class="stat-value">${phaseLabel}</div>
      <div class="progress-bar"><div class="progress-fill blue" style="width:${phasePct}%"></div></div>
      <div class="phase-steps">
        <div class="phase-dot ${phasePct>=20?'done':'active'}"></div><div class="phase-dot ${phasePct>=40?'done':phasePct>=20?'active':''}"></div>
        <div class="phase-dot ${phasePct>=60?'done':phasePct>=40?'active':''}"></div><div class="phase-dot ${phasePct>=80?'done':phasePct>=60?'active':''}"></div>
        <div class="phase-dot ${phasePct>=100?'done':phasePct>=80?'active':''}"></div>
      </div>
      <div class="stat-detail">${phasePct}% 完成</div>
    </div>

    <div class="stat-card">
      <div class="stat-icon" style="background:rgba(168,85,247,.12);color:#a855f7">📋</div>
      <h3>任务总览</h3>
      <div class="stat-value">${total}</div>
      <div class="task-bar-wrap">
        <div class="task-bar">
          ${donePct>0 ? '<div class="task-bar-seg" style="width:'+donePct+'%;background:linear-gradient(90deg,#22c55e,#10b981)">'+done+'</div>' : ''}
          ${inProgressPct>0 ? '<div class="task-bar-seg" style="width:'+inProgressPct+'%;background:linear-gradient(90deg,#38bdf8,#818cf8)">'+inProgress+'</div>' : ''}
          ${pendingPct>0 ? '<div class="task-bar-seg" style="width:'+pendingPct+'%;background:rgba(255,255,255,.05)">'+pending+'</div>' : ''}
        </div>
      </div>
      <div class="legend">
        <div class="legend-item"><div class="legend-dot" style="background:#22c55e"></div>完成 ${done}</div>
        <div class="legend-item"><div class="legend-dot" style="background:#38bdf8"></div>进行中 ${inProgress}</div>
        <div class="legend-item"><div class="legend-dot" style="background:rgba(255,255,255,.2)"></div>待开始 ${pending}</div>
      </div>
    </div>

    <div class="stat-card">
      <div class="stat-icon" style="background:rgba(34,197,94,.12);color:#22c55e">🎯</div>
      <h3>完成率</h3>
      <div class="ring-container">
        <svg class="ring-svg" width="90" height="90" viewBox="0 0 90 90">
          <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#22c55e"/><stop offset="100%" stop-color="#10b981"/></linearGradient></defs>
          <circle class="ring-bg" cx="45" cy="45" r="38"/>
          <circle class="ring-fg" cx="45" cy="45" r="38" stroke-dasharray="238.76" stroke-dashoffset="${238.76-(238.76*donePct/100)}"/>
          <text class="ring-text" x="45" y="45" text-anchor="middle" dominant-baseline="central" transform="rotate(90,45,45)">${donePct}%</text>
        </svg>
        <div class="stat-detail">${done}/${total} 任务已完成</div>
      </div>
    </div>
  </div>

  <div class="table-wrap">
    <div class="section-title" style="padding:20px 20px 0">任务列表</div>
    <table>
      <thead><tr><th>任务 ID</th><th>状态</th><th>类型</th></tr></thead>
      <tbody>
      ${tasks.map((t: any) => {
        const cls = t.status.includes('完成') || t.status === 'completed' ? 'done' : 
                    t.status.includes('开发') || t.status === 'in_progress' ? 'progress' : 'pending';
        const typeCls = (t.type||'').includes('bug') ? 'type-bugfix' : (t.type||'').includes('research') ? 'type-research' : 'type-feature';
        return '<tr><td style="font-weight:600;color:#e2e8f0">' + t.id + '</td><td><span class="badge ' + cls + '">' + t.status + '</span></td><td><span class="type-tag ' + typeCls + '">' + (t.type||'feature') + '</span></td></tr>';
      }).join('')}
      ${tasks.length === 0 ? '<tr><td colspan="3" style="text-align:center;padding:40px;color:#475569">暂无任务数据</td></tr>' : ''}
      </tbody>
    </table>
  </div>

  <div class="footer-bar">
    <span>SpecCore v5.20.0 · 规范驱动开发 · ${data.exportedAt}</span>
    <div class="footer-links">
      <a href="#">文档</a><a href="#">反馈</a>
    </div>
  </div>
</main>
<script>
document.querySelectorAll('.progress-fill,.ring-fg').forEach(el=>{el.style.animation='none';el.offsetHeight;el.style.animation=''})
</script>
</body></html>`;
}
