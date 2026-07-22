/**
 * status-panel — IDE 风格侧栏状态（实时项目状态一览）
 */
import { readFile, pathExists, readdir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { loadConfig } from '../core/unified-config';
import { getDefaultIteration } from '../core/context';

export async function statusPanelCommand(): Promise<void> {
  const iteration = await getDefaultIteration();
  const config = await loadConfig();

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
