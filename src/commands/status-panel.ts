/**
 * status-panel — IDE 风格侧栏状态（实时项目状态一览）
 */
import { readFile, pathExists, readdir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { loadConfig } from '../core/unified-config';
import { getDefaultIteration } from '../core/context';
import { writeFile, pathExists, readdir, readFile } from 'fs-extra';
import { join } from 'path';

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
  const { join } = require('path');
  const { pathExists, readdir, readFile } = require('fs-extra');
  
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
  const { pathExists } = require('fs-extra');
  const { join } = require('path');
  const reqDoc = join(iterDir, '00-需求文档', 'REQUIREMENT.md');
  const analysis = join(iterDir, '00-需求文档', 'ANALYSIS.md');
  if (!(await pathExists(reqDoc))) return 'init';
  if (!(await pathExists(analysis))) return 'require';
  const tasks = await require('fs-extra').readdir(iterDir, { withFileTypes: true });
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
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SpecCore Dashboard — ${data.project}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1419; color: #e7e9ea; padding: 24px; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.header h1 { font-size: 24px; color: #1d9bf0; }
.header .time { color: #71767b; font-size: 14px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px; }
.card { background: #16181c; border: 1px solid #2f3336; border-radius: 12px; padding: 20px; }
.card h3 { font-size: 13px; color: #71767b; text-transform: uppercase; margin-bottom: 8px; }
.card .value { font-size: 32px; font-weight: 700; }
.card .sub { font-size: 13px; color: #71767b; margin-top: 4px; }
.bar { height: 8px; background: #2f3336; border-radius: 4px; margin-top: 12px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; transition: width .5s; }
.bar-fill.blue { background: #1d9bf0; }
.bar-fill.green { background: #00ba7c; }
.bar-fill.yellow { background: #ffd400; }
.bar-fill.red { background: #f4212e; }
.chart-row { display: flex; gap: 8px; height: 40px; margin-top: 12px; border-radius: 6px; overflow: hidden; }
.chart-seg { display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; }
table { width: 100%; border-collapse: collapse; background: #16181c; border-radius: 12px; overflow: hidden; margin-top: 24px; }
th { text-align: left; padding: 12px 16px; font-size: 13px; color: #71767b; border-bottom: 1px solid #2f3336; }
td { padding: 10px 16px; border-bottom: 1px solid #1d1f23; font-size: 14px; }
.status { padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
.status.done { background: #00ba7c20; color: #00ba7c; }
.status.progress { background: #1d9bf020; color: #1d9bf0; }
.status.pending { background: #71767b20; color: #71767b; }
.footer { text-align: center; color: #71767b; font-size: 12px; margin-top: 24px; }
</style>
</head>
<body>
<div class="header">
  <h1>📊 ${data.project}</h1>
  <span class="time">期次: ${data.iteration} | ${data.exportedAt.split('T')[0]}</span>
</div>

<div class="grid">
  <div class="card">
    <h3>当前阶段</h3>
    <div class="value">${phaseLabel}</div>
    <div class="bar"><div class="bar-fill blue" style="width:${phasePct}%"></div></div>
    <div class="sub">进度 ${phasePct}%</div>
  </div>

  <div class="card">
    <h3>任务总数</h3>
    <div class="value">${total}</div>
    <div class="sub">${done} 完成 · ${inProgress} 进行中 · ${pending} 待开始</div>
    <div class="chart-row">
      <div class="chart-seg" style="width:${donePct}%;background:#00ba7c">${donePct > 8 ? donePct+'%' : ''}</div>
      <div class="chart-seg" style="width:${inProgressPct}%;background:#1d9bf0">${inProgressPct > 8 ? inProgressPct+'%' : ''}</div>
      <div class="chart-seg" style="width:${pendingPct}%;background:#2f3336">${pendingPct > 8 ? pendingPct+'%' : ''}</div>
    </div>
  </div>

  <div class="card">
    <h3>完成率</h3>
    <div class="value" style="color:#00ba7c">${donePct}%</div>
    <div class="bar"><div class="bar-fill green" style="width:${donePct}%"></div></div>
  </div>
</div>

<table>
  <thead><tr><th>ID</th><th>状态</th><th>类型</th></tr></thead>
  <tbody>
  ${tasks.map((t: any) => {
    const cls = t.status.includes('完成') || t.status === 'completed' ? 'done' : 
                t.status.includes('开发') || t.status === 'in_progress' ? 'progress' : 'pending';
    return '<tr><td>' + t.id + '</td><td><span class="status ' + cls + '">' + t.status + '</span></td><td>' + t.type + '</td></tr>';
  }).join('')}
  ${tasks.length === 0 ? '<tr><td colspan="3" style="text-align:center;color:#71767b">暂无任务</td></tr>' : ''}
  </tbody>
</table>

<div class="footer">Generated by SpecCore v5.20.0 | ${data.exportedAt}</div>
</body>
</html>`;
}
