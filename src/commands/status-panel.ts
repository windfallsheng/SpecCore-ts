/**
 * status-panel — IDE 风格侧栏状态（实时项目状态一览）
 */
import { readFile, pathExists, readdir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { loadConfig } from '../core/unified-config';
import { getDefaultIteration } from '../core/context';
import { writeFile } from 'fs-extra';

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
