/**
 * status-panel — IDE 风格侧栏状态（实时项目状态一览）
 */
import { readFile, pathExists, readdir, writeFile, ensureDir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { loadConfig } from '../core/unified-config';
import { getDefaultIteration } from '../core/context';
import { readGlobalIndex } from '../core/global-layer';

export interface StatusPanelOptions {
  export?: string;
  assignee?: string;
  platform?: string;
  type?: string;
  health?: boolean;
  lifecycle?: boolean;
  task?: string;
  status?: string;
  iteration?: string;
  scope?: 'iteration' | 'global';  // 作用域：迭代（默认）或全量层
}

export async function statusPanelCommand(options: StatusPanelOptions = {}): Promise<void> {
  // ── 全局仪表盘模式 ──
  if (options.scope === 'global') {
    await showGlobalDashboard(options);
    return;
  }

  const iteration = options.iteration || await getDefaultIteration();
  const config = await loadConfig();

  // ── Health/Lifecycle modes (skip if exporting) ──
  if (!options.export) {
    if (options.health) {
      await showHealthReport(config, iteration);
      return;
    }
    if (options.lifecycle) {
      await showLifecycleBoard(config, iteration, options);
      return;
    }
  }

  // ── Export mode ──
  if (options.export) {
    await exportStatus(config, iteration, options.export, options);
    return;
  }

  // ── Filter labels for header ──
  const filterLabels: string[] = [];
  if (options.assignee) filterLabels.push(`人员: ${options.assignee}`);
  if (options.platform) filterLabels.push(`平台: ${options.platform}`);
  if (options.type) filterLabels.push(`类型: ${options.type}`);
  const filterTag = filterLabels.length > 0 ? ` [${filterLabels.join(', ')}]` : '';

  // Header
  logger.info('');
  logger.info('┌────────────────── SpecCore ──────────────────┐');
  logger.info(`│ 项目: ${config.project.name.padEnd(37)}│`);
  
  if (iteration) {
    logger.info(`│ 迭代: ${iteration.padEnd(37)}│`);
    const iterDir = `Iteration-${iteration}`;
    
    // Phase detection
    const phase = await detectPhase(iterDir);
    const phaseIcon = { init:'🔧', require:'📝', analyze:'🔍', split:'📦', dev:'💻', review:'✅', done:'✨' }[phase] || '📌';
    logger.info(`│ 阶段: ${phaseIcon} ${phase.padEnd(35)}│`);
    
    // ── Collect & filter tasks ──
    const allTasks = await collectTasks(iterDir);
    let filteredTasks = allTasks;
    let totalBeforeFilter = allTasks.length;

    if (options.assignee) {
      filteredTasks = filteredTasks.filter(t => t.assignee === options.assignee);
    }
    if (options.type) {
      filteredTasks = filteredTasks.filter(t => (t.type || '').toLowerCase() === options.type!.toLowerCase());
    }
    if (options.platform) {
      filteredTasks = await filterByPlatform(iterDir, filteredTasks, options.platform);
    }

    const tasks = filteredTasks;
    const done = tasks.filter(t => t.status.includes('完成') || t.status.includes('completed')).length;
    const inProgress = tasks.filter(t => t.status.includes('开发') || t.status.includes('in_progress')).length;
    const pending = tasks.length - done - inProgress;

    // Task counts
    if (tasks.length > 0) {
      const shown = tasks.length !== totalBeforeFilter ? ` ${tasks.length}/${totalBeforeFilter}` : '';
      logger.info(`│ 任务: ${done}/${tasks.length} 完成${shown}${filterTag}`.padEnd(47) + '│');
      const bar = buildProgressBar(done, tasks.length);
      logger.info(`│ ${bar.padEnd(46)}│`);
      
      // People breakdown
      const personMap: Record<string, {total:number,done:number}> = {};
      for (const t of tasks) {
        const who = t.assignee || '未分配';
        if (!personMap[who]) personMap[who] = {total:0,done:0};
        personMap[who].total++;
        if (t.status.includes('完成') || t.status.includes('completed')) personMap[who].done++;
      }
      if (Object.keys(personMap).length > 0) {
        logger.info('├──────────────────────────────────────────────┤');
        for (const [name, s] of Object.entries(personMap)) {
          const pBar = buildProgressBar(s.done, s.total);
          logger.info(`│ ${name}: ${pBar} ${s.done}/${s.total}`.padEnd(47) + '│');
        }
      }
      
      // Platform breakdown
      const platformCount = await countPlatforms(iterDir, tasks);
      if (platformCount.backend + platformCount.frontend > 0) {
        logger.info('├──────────────────────────────────────────────┤');
        const parts: string[] = [];
        if (platformCount.backend > 0) parts.push(`Backend: ${platformCount.backend}`);
        if (platformCount.frontend > 0) parts.push(`Frontend: ${platformCount.frontend}`);
        logger.info(`│ 平台: ${parts.join('  ')}${' '.repeat(Math.max(0,37 - parts.join('  ').length))}│`);
      }
    } else {
      logger.info(`│ 任务: 无${filterTag}`.padEnd(47) + '│');
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

// ── 共享：收集所有任务数据 ──
async function collectTasks(iterDir: string): Promise<any[]> {
  const tasks: any[] = [];
  if (!(await pathExists(iterDir))) return tasks;
  const entryList = await readdir(iterDir, { withFileTypes: true });
  for (const e of entryList) {
    if (e.isDirectory() && e.name.startsWith('Task-')) {
      const taskPath = join(iterDir, e.name, '00-specs', 'TASK.md');
      try {
        if (await pathExists(taskPath)) {
          const md = await readFile(taskPath, 'utf-8');
          const status = (md.match(/状态: (.+)/) || [])[1] || 'pending';
          const type = (md.match(/类型: (.+)/) || [])[1] || 'feature';
          const assignee = (md.match(/负责人[：:]\s*(\S+)/) || [])[1] || '';
          tasks.push({ id: e.name, status, type, assignee });
        } else {
          tasks.push({ id: e.name, status: 'pending', type: 'feature', assignee: '' });
        }
      } catch { tasks.push({ id: e.name, status: 'pending', type: 'feature', assignee: '' }); }
    }
  }
  return tasks;
}

// ── 共享：按平台统计 ──
async function countPlatforms(iterDir: string, tasks: any[]): Promise<{backend:number,frontend:number}> {
  let backend = 0, frontend = 0;
  for (const t of tasks) {
    try {
      const entries = await readdir(join(iterDir, t.id), { withFileTypes: true });
      if (entries.some((e: any) => e.name === 'backend')) backend++;
      if (entries.some((e: any) => e.name === 'frontend')) frontend++;
    } catch {}
  }
  return { backend, frontend };
}

async function detectPhase(iterDir: string): Promise<string> {
  const reqDoc = join(iterDir, '020-specs', 'REQUIREMENT.md');
  const analysis = join(iterDir, '020-specs', 'ANALYSIS.md');
  
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
      const taskMd = join(iterDir, t.name, '00-specs', 'TASK.md');
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
      const taskMd = join(iterDir, t.name, '00-specs', 'TASK.md');
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

// ── 平台过滤: 检测 Task 目录下是否有指定平台 ──
async function filterByPlatform(iterDir: string, tasks: any[], platform: string): Promise<any[]> {
  const { readdir } = require('fs-extra');
  const { join } = require('path');
  const result: any[] = [];
  for (const t of tasks) {
    const taskDir = join(iterDir, t.id);
    try {
      const entries = await readdir(taskDir, { withFileTypes: true });
      if (platform === 'backend' && entries.some((e: any) => e.name === 'backend')) result.push(t);
      else if (platform === 'frontend' && entries.some((e: any) => e.name === 'frontend')) result.push(t);
      else if (entries.some((e: any) => e.name === platform)) result.push(t);
    } catch { /* task dir not found */ }
  }
  return result;
}

async function exportStatus(
  config: any, iteration: string | null, format: string, options: StatusPanelOptions = {}
): Promise<void> {


  
  const data: any = {
    project: config.project.name,
    iteration: iteration || '未设置',
    exportedAt: new Date().toISOString(),
    phases: {} as any,
  };

  if (iteration) {
    const iterDir = join(process.cwd(), 'Iteration-' + iteration);
    const phase = await require('./status-panel').defaultPhase(iterDir);

    data.phase = phase;

    // ── 读取迭代时间范围 ──
    const metaPath = join(iterDir, "000-overview", "METADATA.md");
    const graphPath = join(iterDir, '000-overview', 'PROJECT_GRAPH.md');
    if (await pathExists(graphPath)) {
      const graph = await readFile(graphPath, 'utf-8');
      const ownerMatch = graph.match(/负责人[：:]?\s*(\S+)/);
      if (ownerMatch) data.iterationOwner = ownerMatch[1];
    }
    if (await pathExists(metaPath)) {
      const meta = await readFile(metaPath, 'utf-8');
      const fromMatch = meta.match(/开始[：:]?\s*(\d{4}-\d{2}-\d{2})/) || meta.match(/from[：:]?\s*(\d{4}-\d{2}-\d{2})/i);
      const toMatch = meta.match(/结束[：:]?\s*(\d{4}-\d{2}-\d{2})/) || meta.match(/to[：:]?\s*(\d{4}-\d{2}-\d{2})/i);
      if (fromMatch) data.iterationStart = fromMatch[1];
      if (toMatch) data.iterationEnd = toMatch[1];
      // ── 里程碑时间线 ──
      const devEnd = meta.match(/提测[：:]?\s*(\d{4}-\d{2}-\d{2})/) || meta.match(/开发结束[：:]?\s*(\d{4}-\d{2}-\d{2})/i);
      const sit = meta.match(/SIT[：:]?\s*(\d{4}-\d{2}-\d{2})/i) || meta.match(/集成测试[：:]?\s*(\d{4}-\d{2}-\d{2})/);
      const uat = meta.match(/UAT[：:]?\s*(\d{4}-\d{2}-\d{2})/i) || meta.match(/验收测试[：:]?\s*(\d{4}-\d{2}-\d{2})/);
      const release = meta.match(/上线[：:]?\s*(\d{4}-\d{2}-\d{2})/) || meta.match(/发布[：:]?\s*(\d{4}-\d{2}-\d{2})/);
      data.milestones = {
        devEnd: devEnd ? devEnd[1] : null,
        sit: sit ? sit[1] : null,
        uat: uat ? uat[1] : null,
        release: release ? release[1] : null,
      };
      // ── Delay 记录 ──
      const delays: any[] = [];
      const delayRe = /DELAY[：:]?\s*(\d{4}-\d{2}-\d{2})[：:]?\s*(.+)/gi;
      let dm;
      while ((dm = delayRe.exec(meta)) !== null) {
        delays.push({ date: dm[1], reason: (dm[2] || '').trim() });
      }
      data.delays = delays;
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
          const taskPath = join(iterDir, e.name, '00-specs', 'TASK.md');
          if (await pathExists(taskPath)) {
            const md = await readFile(taskPath, 'utf-8');
            const status = (md.match(/状态: (.+)/) || [])[1] || 'pending';
            const type = (md.match(/类型: (.+)/) || [])[1] || 'feature';
            const created = (md.match(/创建日期[：:]?\s*(\d{4}-\d{2}-\d{2})/) || md.match(/创建:\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
            const estimate = (md.match(/预估[工时:：]?\s*(\d+)\s*[hH小时]/) || md.match(/预计耗时[：:]?\s*(\d+)/) || [])[1] || '';
            const delay = (md.match(/延期\|DELAY/i) || []).length > 0;
            tasks.push({ id: e.name, status, type, created, estimate: estimate ? parseInt(estimate) : 0, delay, assignee: (md.match(/负责人[：:]\s*(\S+)/) || [])[1] || '' });
          } else {
            tasks.push({ id: e.name, status: 'pending' });
          }
        }
      }
    }
    data.tasks = tasks;
    data.taskCount = tasks.length;
    const nowTs = new Date().getTime();
    const weekAgo = new Date(nowTs - 7 * 86400000);

    // ── 过滤: 人员 / 类型 / 平台 ──
    let filtered = tasks;
    const filterLabels: string[] = [];
    
    if (options.assignee) {
      filtered = filtered.filter((t: any) => t.assignee === options.assignee);
      filterLabels.push(`人员: ${options.assignee}`);
    }
    if (options.type) {
      filtered = filtered.filter((t: any) => (t.type || '').toLowerCase() === options.type!.toLowerCase());
      filterLabels.push(`类型: ${options.type}`);
    }
    if (options.platform) {
      // 平台过滤: 检查 Task 目录结构 (backend/ 20-frontend/web/ 20-frontend/h5/ etc)
      const platformTasks = await filterByPlatform(iterDir, filtered, options.platform);
      filtered = platformTasks;
      filterLabels.push(`平台: ${options.platform}`);
    }
    
    if (filtered.length < tasks.length) {
      data.filteredFrom = tasks.length;
      data.filterLabels = filterLabels;
      data.tasks = filtered;  // 更新为过滤后的任务列表
      // 重新计算所有统计
      data.taskCount = filtered.length;
      const td2: Record<string, number> = {};
      for (const t of filtered) { const tt = (t.type || 'feature').toLowerCase(); td2[tt] = (td2[tt] || 0) + 1; }
      data.typeDistribution = td2;
      data.addedThisWeek = filtered.filter((t: any) => t.created && new Date(t.created) >= weekAgo).length;
      data.bugCount = filtered.filter((t: any) => (t.type || '').toLowerCase().includes('bug')).length;
      const am2: any = {};
      for (const t of filtered) { if (t.assignee) { if (!am2[t.assignee]) am2[t.assignee] = {total:0,done:0}; am2[t.assignee].total++; if (t.status.includes("completed")||t.status.includes("完成")) am2[t.assignee].done++; } }
      data.assigneeStats = am2;
      // 重新计算时间维度
      let totalAi = 0, totalHuman = 0, totalReview = 0;
      for (const t of filtered) { totalAi += t.aiTime || 0; totalHuman += t.humanTime || 0; totalReview += t.reviewTime || 0; }
      data.totalAiTime = totalAi; data.totalHumanTime = totalHuman; data.totalReviewTime = totalReview;
      data.totalEstTime = totalAi + totalHuman + totalReview;
      // 人员清单
      const pt2: Record<string, any[]> = {};
      for (const t of filtered) { if (t.assignee) { if (!pt2[t.assignee]) pt2[t.assignee] = []; pt2[t.assignee].push(t); } }
      data.personTasks = pt2;
      const pd2: any = {};
      for (const t of filtered) {
        if (!t.assignee) continue;
        if (!pd2[t.assignee]) pd2[t.assignee] = {total:0,done:0,bugs:0,features:0,estHours:0};
        pd2[t.assignee].total++;
        if (t.status.includes('completed')||t.status.includes('完成')) pd2[t.assignee].done++;
        if ((t.type||'').toLowerCase().includes('bug')) pd2[t.assignee].bugs++;
        else if (!(t.type||'').toLowerCase().includes('research')) pd2[t.assignee].features++;
        pd2[t.assignee].estHours += t.estimate || 0;
      }
      // 人员→平台映射
      data.personPlatforms = await buildPersonPlatforms(iterDir, filtered);
      data.personDetail = pd2;
    } else {
    // 类型分布 / 增量统计
    const td: Record<string, number> = {};
    for (const t of tasks) {
      const tt = (t.type || 'feature').toLowerCase();
      td[tt] = (td[tt] || 0) + 1;
    }
    data.typeDistribution = td;
    data.addedThisWeek = tasks.filter((t: any) => t.created && new Date(t.created) >= weekAgo).length;
    data.bugCount = tasks.filter((t: any) => (t.type || '').toLowerCase().includes('bug')).length;
    const am: any = {};
    for (const t of tasks) { if (t.assignee) { if (!am[t.assignee]) am[t.assignee] = {total:0,done:0}; am[t.assignee].total++; if (t.status.includes("completed")||t.status.includes("完成")) am[t.assignee].done++; } }
    data.assigneeStats = am;
    // 人员多维统计
    const personDetail: any = {};
    for (const t of tasks) {
      if (!t.assignee) continue;
      if (!personDetail[t.assignee]) personDetail[t.assignee] = {total:0,done:0,bugs:0,features:0,estHours:0};
      personDetail[t.assignee].total++;
      if (t.status.includes('completed')||t.status.includes('完成')) personDetail[t.assignee].done++;
      if ((t.type||'').toLowerCase().includes('bug')) personDetail[t.assignee].bugs++;
      else if (!(t.type||'').toLowerCase().includes('research')) personDetail[t.assignee].features++;
      personDetail[t.assignee].estHours += t.estimate || 0;
    }
    data.personDetail = personDetail;
    // 人员→平台映射
    data.personPlatforms = await buildPersonPlatforms(iterDir, tasks);
    // 每人任务清单
    const personTasks: Record<string, any[]> = {};
    for (const t of tasks) {
      if (!t.assignee) continue;
      if (!personTasks[t.assignee]) personTasks[t.assignee] = [];
      personTasks[t.assignee].push(t);
    }
    data.personTasks = personTasks;
    let totalAi = 0, totalHuman = 0, totalReview = 0;
    for (const t of tasks) { totalAi += t.aiTime || 0; totalHuman += t.humanTime || 0; totalReview += t.reviewTime || 0; }
    data.totalAiTime = totalAi;
    data.totalHumanTime = totalHuman;
    data.totalReviewTime = totalReview;
    data.totalEstTime = totalAi + totalHuman + totalReview;
  }
  } // end if(iteration)

  // ── 健康度数据 ──
  if (options.health && iteration) {
    const healthData = await collectHealthData(iteration);
    data.health = healthData;
  }
  // ── 生命周期数据 ──
  if (options.lifecycle && iteration) {
    const lifecycleData = await collectLifecycleData(iteration);
    data.lifecycle = lifecycleData;
  }

  if (format === 'json') {
    const outPath = 'speccore-status.json';
    await writeFile(outPath, JSON.stringify(data, null, 2));
    logger.info(`✅ 导出到 ${outPath}`);
  } else if (format === 'md') {
    let md = `# SpecCore Status — ${config.project.name}\n\n`;
    md += `- 迭代: ${iteration || '无'}\n- 阶段: ${data.phase || 'N/A'}\n\n`;
    md += '## Tasks\n\n| ID | Status | Type |\n| :--- | :--- | :--- |\n';
    for (const t of data.tasks || []) md += `| ${t.id} | ${t.status} | ${t.type} |\n`;
    if (data.health) {
      md += '\n## 健康度\n\n';
      md += `| 指标 | 值 |\n| :--- | :--- |\n`;
      const h = data.health;
      md += `| 任务完成率 | ${h.donePct}% (${h.completed}/${h.total}) |\n`;
      md += `| 测试覆盖率 | ${h.testPct}% |\n`;
      md += `| 审查覆盖率 | ${h.reviewPct}% |\n`;
      md += `| 综合评分 | ${h.grade} (${h.score}/100) |\n`;
    }
    if (data.lifecycle) {
      md += '\n## 生命周期\n\n| Task | 状态 |\n| :--- | :--- |\n';
      for (const t of data.lifecycle.tasks || []) md += `| ${t.id} | ${t.status} |\n`;
    }
    const outPath = 'speccore-status.md';
    await writeFile(outPath, md);
    logger.info(`✅ 导出到 ${outPath}`);
  } else if (format === 'html') {
    const outPath = join(process.cwd(), 'outputs', 'dashboard-iteration-' + config.project.name + '.html');
    await ensureDir(join(process.cwd(), 'outputs'));
    await writeFile(outPath, buildHtmlDashboard(data));
    logger.info(`✅ 迭代看板已生成: ${outPath}`);
  }
}

// ── 人员→平台映射 ──
async function buildPersonPlatforms(iterDir: string, tasks: any[]): Promise<Record<string,string>> {
  const { readdir } = require('fs-extra');
  const { join } = require('path');
  const map: Record<string,string> = {};
  for (const t of tasks) {
    if (!t.assignee || map[t.assignee]) continue;
    try {
      const entries = await readdir(join(iterDir, t.id), { withFileTypes: true });
      const platforms: string[] = [];
      if (entries.some((e: any) => e.name === 'backend')) platforms.push('backend');
      const fe = entries.find((e: any) => e.name === 'frontend');
      if (fe && fe.isDirectory()) {
        const subs = await readdir(join(iterDir, t.id, 'frontend'), { withFileTypes: true });
        for (const s of subs) {
          if (s.isDirectory()) platforms.push('20-frontend/' + s.name);
        }
        if (subs.length === 0) platforms.push('frontend');
      }
      map[t.assignee] = platforms.join(', ') || '';
    } catch { map[t.assignee] = ''; }
  }
  return map;
}

export async function defaultPhase(iterDir: string): Promise<string> {


  const reqDoc = join(iterDir, '020-specs', 'REQUIREMENT.md');
  const analysis = join(iterDir, '020-specs', 'ANALYSIS.md');
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
  const featCount = (data.typeDistribution && data.typeDistribution['feature']) || 0;
  const bugCount = (data.typeDistribution && data.typeDistribution['bugfix']) || 0;
  const researchCount = (data.typeDistribution && data.typeDistribution['research']) || 0;
  const addedThisWeek = data.addedThisWeek || 0;
  const am = data.assigneeStats || {};
  const assigneeCards = (Object.entries(am) as [string, any][]).map(([name, s]) => {
    const pct = s.total > 0 ? Math.round(s.done/s.total*100) : 0;
    return '<div style="background:rgba(0,240,255,.03);border:1px solid rgba(0,240,255,.08);border-radius:8px;padding:16px">' +
      '<div style="font-size:14px;font-weight:600;margin-bottom:8px">' + name + '</div>' +
      '<div style="display:flex;gap:12px;margin-bottom:8px">' +
      '<div><span class="num-font">' + s.done + '</span><span style="font-size:10px;color:var(--muted)">/' + s.total + '</span></div>' +
      '<div class="num-font" style="margin-left:auto">' + pct + '%</div>' +
      '</div>' +
      '<div style="height:4px;background:rgba(255,255,255,.03);border-radius:2px;overflow:hidden">' +
      '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,var(--cyan),var(--green));border-radius:2px"></div></div>' +
      '</div>';
  }).join('');
  const hasAssignees = assigneeCards.length > 0;
  const totalAi = data.totalAiTime || 0;
  const totalHuman = data.totalHumanTime || 0;
  const totalReview = data.totalReviewTime || 0;
  const totalEstTime = data.totalEstTime || 0;
  const personPlatforms: Record<string,string> = data.personPlatforms || {};
  const pt = data.personTasks || {};
  const pd = data.personDetail || {};
  // ── 排序：后端在前 → 前端在后，每组按姓氏首字母 ──
  // ── 中文姓氏拼音映射 ──
  const pinyinMap: Record<string,string> = {
    '安':'an','白':'bai','包':'bao','鲍':'bao','毕':'bi','边':'bian','蔡':'cai','曹':'cao',
    '常':'chang','陈':'chen','程':'cheng','崔':'cui','戴':'dai','邓':'deng','丁':'ding',
    '董':'dong','杜':'du','段':'duan','范':'fan','方':'fang','冯':'feng','傅':'fu',
    '高':'gao','葛':'ge','龚':'gong','顾':'gu','关':'guan','郭':'guo','韩':'han',
    '何':'he','贺':'he','洪':'hong','侯':'hou','胡':'hu','华':'hua','黄':'huang',
    '霍':'huo','纪':'ji','贾':'jia','江':'jiang','姜':'jiang','蒋':'jiang','金':'jin',
    '康':'kang','孔':'kong','赖':'lai','雷':'lei','黎':'li','李':'li','梁':'liang',
    '廖':'liao','林':'lin','刘':'liu','柳':'liu','龙':'long','卢':'lu','鲁':'lu',
    '陆':'lu','吕':'lv','罗':'luo','马':'ma','毛':'mao','孟':'meng','莫':'mo',
    '倪':'ni','牛':'niu','潘':'pan','彭':'peng','齐':'qi','钱':'qian','乔':'qiao',
    '秦':'qin','邱':'qiu','任':'ren','阮':'ruan','邵':'shao','沈':'shen','盛':'sheng',
    '石':'shi','史':'shi','宋':'song','苏':'su','孙':'sun','谭':'tan','汤':'tang',
    '唐':'tang','陶':'tao','田':'tian','童':'tong','万':'wan','汪':'wang','王':'wang',
    '韦':'wei','魏':'wei','温':'wen','文':'wen','吴':'wu','武':'wu','夏':'xia',
    '向':'xiang','萧':'xiao','谢':'xie','熊':'xiong','徐':'xu','许':'xu','薛':'xue',
    '严':'yan','阎':'yan','杨':'yang','姚':'yao','叶':'ye','易':'yi','殷':'yin',
    '尹':'yin','应':'ying','尤':'you','于':'yu','余':'yu','俞':'yu','袁':'yuan',
    '岳':'yue','曾':'zeng','张':'zhang','章':'zhang','赵':'zhao','郑':'zheng',
    '钟':'zhong','周':'zhou','朱':'zhu','祝':'zhu','庄':'zhuang','邹':'zou',
  };
  const surnameOrder = (n: string) => {
    const first = n.charAt(0);
    const py = pinyinMap[first];
    if (py) return py;
    const c = n.charCodeAt(0);
    if (c >= 0x4E00) return n;   // 中文未收录的，fallback 到原文
    return n.toLowerCase();       // 英��按字母序
  };
  const getPlatformGroup = (name: string) => {
    const p = personPlatforms[name] || '';
    if (p.includes('backend')) return '0_backend';
    if (p.includes('frontend')) return '1_frontend';
    return '2_other';
  };
  const sortedPersonEntries = Object.entries(pd as Record<string,{total:number,done:number,bugs:number,features:number,estHours:number}>)
    .sort(([a], [b]) => {
      const ga = getPlatformGroup(a);
      const gb = getPlatformGroup(b);
      if (ga !== gb) return ga.localeCompare(gb);
      return surnameOrder(a).localeCompare(surnameOrder(b));
    });

  const personDetailCards = sortedPersonEntries.map(([name, d]) => {
    const pct = d.total > 0 ? Math.round(d.done/d.total*100) : 0;
    const bugPct = d.total > 0 ? Math.round(d.bugs/d.total*100) : 0;
    return '<div style="background:rgba(0,240,255,.03);border:1px solid rgba(0,240,255,.08);border-radius:10px;padding:18px">' +
      '<div style="font-size:15px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:8px">' + name +
      '<span style="margin-left:auto;font-family:Orbitron;font-size:13px;color:var(--cyan)">' + pct + '%</span></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px">' +
      '<div><span style="color:var(--muted)">任务</span><div style="font-weight:600;margin-top:2px">' + d.done + '/' + d.total + '</div></div>' +
      '<div><span style="color:var(--muted)">功能</span><div style="font-weight:600;margin-top:2px">' + d.features + '</div></div>' +
      '<div><span style="color:var(--muted)">Bug</span><div style="font-weight:600;margin-top:2px;color:' + (bugPct > 30 ? 'var(--orange)' : 'var(--text)') + '">' + d.bugs + '</div></div>' +
      '<div><span style="color:var(--muted)">工时</span><div style="font-weight:600;margin-top:2px">' + d.estHours + 'h</div></div>' +
      '</div>' +
      '<div style="height:4px;background:rgba(255,255,255,.04);border-radius:2px;margin-top:12px;overflow:hidden">' +
      '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,var(--cyan),var(--green));border-radius:2px"></div></div>' +
      '</div>';
  }).join('');
  const bugTotal = data.bugCount || 0;
  const phasePct = ({init:10, require:25, analyze:40, dev:60, review:80, done:100} as any)[phase] || 0;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SpecCore — ${data.project}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;600;700&display=swap');
[data-theme="cyber"]{--cyan:#00f0ff;--blue:#3b82f6;--green:#00ff88;--purple:#a78bfa;--orange:#f59e0b;--bg:#060b14;--card:rgba(8,16,32,.85);--border:rgba(0,240,255,.12);--text:#c4d5e7;--muted:#4a5568;--surface:rgba(17,25,40,.7);--hover:rgba(0,240,255,.02)}
[data-theme="light"]{--cyan:#2563eb;--blue:#3b82f6;--green:#059669;--purple:#7c3aed;--orange:#d97706;--bg:#f8fafc;--card:rgba(255,255,255,.95);--border:rgba(0,0,0,.08);--text:#1e293b;--muted:#94a3b8;--surface:rgba(255,255,255,.95);--hover:rgba(37,99,235,.02)}
[data-theme="github"]{--cyan:#2da44e;--blue:#0969da;--green:#1a7f37;--purple:#8250df;--orange:#cf222e;--bg:#0d1117;--card:#161b22;--border:#30363d;--text:#c9d1d9;--muted:#8b949e;--surface:#161b22;--hover:rgba(45,164,78,.05)}
[data-theme="synth"]{--cyan:#f92aad;--blue:#ff7edb;--green:#36f9f6;--purple:#b381f9;--orange:#ffb86c;--bg:#1a0024;--card:rgba(30,0,50,.9);--border:rgba(249,42,173,.2);--text:#f8f8f2;--muted:#6b3e7a;--surface:rgba(30,0,50,.9);--hover:rgba(249,42,173,.05)}
[data-theme="ocean"]{--cyan:#0ea5e9;--blue:#0284c7;--green:#14b8a6;--purple:#6366f1;--orange:#f97316;--bg:#0b1929;--card:rgba(13,31,56,.9);--border:rgba(14,165,233,.15);--text:#bae6fd;--muted:#5b7fa5;--surface:rgba(13,31,56,.9);--hover:rgba(14,165,233,.05)}
[data-theme="sakura"]{--cyan:#f472b6;--blue:#c084fc;--green:#a3e635;--purple:#e879f9;--orange:#fb923c;--bg:#1a0a14;--card:rgba(30,10,20,.9);--border:rgba(244,114,182,.2);--text:#fce7f3;--muted:#9d4a6d;--surface:rgba(30,10,20,.9);--hover:rgba(244,114,182,.05)}
[data-theme="forest"]{--cyan:#059669;--blue:#0284c7;--green:#22c55e;--purple:#6366f1;--orange:#ca8a04;--bg:#0a140a;--card:rgba(12,24,12,.9);--border:rgba(5,150,105,.15);--text:#d1fae5;--muted:#3b6b4e;--surface:rgba(12,24,12,.9);--hover:rgba(5,150,105,.05)}
[data-theme="amber"]{--cyan:#ffb000;--blue:#ff8c00;--green:#32cd32;--purple:#da70d6;--orange:#ff6347;--bg:#0c0c0c;--card:#1a1a1a;--border:#333;--text:#ffb000;--muted:#666;--surface:#1a1a1a;--hover:rgba(255,176,0,.05)}
[data-theme="mono"]{--cyan:#64748b;--blue:#475569;--green:#334155;--purple:#1e293b;--orange:#94a3b8;--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#e2e8f0;--muted:#64748b;--surface:#1e293b;--hover:rgba(100,116,139,.05)}
*,*::after,*::before{box-sizing:border-box;margin:0;padding:0}
.ctrl-panel{position:fixed;top:16px;right:16px;z-index:100;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.ctrl-toggle{width:56px;height:56px;border-radius:50%;border:1px solid var(--border);cursor:pointer;font-size:38px;display:flex;align-items:center;justify-content:center;line-height:0;padding:0;user-select:none;background:var(--surface);color:var(--muted);backdrop-filter:blur(10px);transition:all .3s}
.ctrl-toggle:hover{color:var(--cyan);border-color:var(--cyan);transform:rotate(90deg);transform-origin:center}
.ctrl-toggle.open{color:var(--cyan);border-color:var(--cyan);transform:rotate(90deg);transform-origin:center}
.ctrl-body{max-height:0;overflow:hidden;display:flex;flex-direction:column;gap:6px;align-items:flex-end;transition:max-height .4s ease,opacity .3s ease;opacity:0}
.ctrl-panel.open .ctrl-body{max-height:280px;opacity:1}
.theme-sw{display:flex;gap:6px;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:4px;backdrop-filter:blur(10px)}.theme-sw button{width:32px;height:32px;border-radius:16px;border:none;cursor:pointer;transition:all .2s;font-size:14px;display:flex;align-items:center;justify-content:center;background:transparent}.theme-sw button:hover{transform:scale(1.1)}.theme-sw button.active{box-shadow:0 0 0 2px var(--cyan);background:rgba(0,240,255,.15)}
.lang-sw{display:flex;gap:4px;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:4px;backdrop-filter:blur(10px)}
.lang-sw button{padding:4px 10px;border-radius:12px;border:1px solid var(--border);cursor:pointer;font-size:11px;font-family:'JetBrains Mono',monospace;background:transparent;color:var(--muted)}
.lang-sw button:hover{color:var(--text)}
.lang-sw button.active{color:var(--cyan);border-color:var(--cyan);background:rgba(0,240,255,.1)}
.font-sw{display:flex;gap:4px;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:4px;backdrop-filter:blur(10px)}
.font-sw button{padding:4px 10px;border-radius:12px;border:1px solid var(--border);cursor:pointer;font-size:11px;font-family:'JetBrains Mono',monospace;background:transparent;color:var(--muted)}
.font-sw button:hover{color:var(--text)}
.font-sw button.active{color:var(--cyan);border-color:var(--cyan);background:rgba(0,240,255,.1)}
.fs-sw{display:flex;gap:4px;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:4px;backdrop-filter:blur(10px)}
.fs-sw button{padding:4px 10px;border-radius:12px;border:1px solid var(--border);cursor:pointer;font-size:11px;font-family:'JetBrains Mono',monospace;background:transparent;color:var(--muted)}
.fs-sw button:hover{color:var(--text)}
.fs-sw button.active{color:var(--cyan);border-color:var(--cyan);background:rgba(0,240,255,.1)}
html{font-size:18px}html.fs-sm{font-size:11px}html.fs-md{font-size:14px}html.fs-lg{font-size:18px}html.fs-xl{font-size:22px}body{font-family:'JetBrains Mono',monospace!important}.font-jetbrains h1,.font-jetbrains h3,.font-jetbrains .panel-title,.font-jetbrains .num-font,.font-jetbrains .big-num,.font-jetbrains .header-stat .num,.font-jetbrains .card-icon{font-family:'JetBrains Mono',monospace!important}
.font-hybrid,.font-hybrid html{font-size:18px}html.fs-sm{font-size:11px}html.fs-md{font-size:14px}html.fs-lg{font-size:18px}html.fs-xl{font-size:22px}body{font-family:'JetBrains Mono',monospace!important}.font-hybrid h1,.font-hybrid h3,.font-hybrid .panel-title,.font-hybrid .num-font,.font-hybrid .big-num,.font-hybrid .header-stat .num,.font-hybrid .card-icon{font-family:Orbitron,sans-serif!important}
.font-orbitron,.font-orbitron html{font-size:18px}html.fs-sm{font-size:11px}html.fs-md{font-size:14px}html.fs-lg{font-size:18px}html.fs-xl{font-size:22px}body{font-family:Orbitron,sans-serif!important}.font-orbitron h1,.font-orbitron h3,.font-orbitron .panel-title,.font-orbitron .num-font,.font-orbitron .big-num,.font-orbitron .header-stat .num,.font-orbitron .card-icon{font-family:Orbitron,sans-serif!important}
body{background:var(--bg);color:var(--text);min-height:100vh;overflow-x:hidden}
.scanlines{position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,.015) 2px,rgba(0,240,255,.015) 4px);pointer-events:none;z-index:999}
.stars{position:fixed;inset:0;background:radial-gradient(1px 1px at 10% 20%,rgba(255,255,255,.4),transparent),radial-gradient(1px 1px at 25% 65%,rgba(255,255,255,.3),transparent),radial-gradient(1.5px 1.5px at 50% 30%,rgba(0,240,255,.5),transparent),radial-gradient(1px 1px at 70% 55%,rgba(255,255,255,.35),transparent),radial-gradient(1px 1px at 85% 15%,rgba(168,85,247,.4),transparent),radial-gradient(1.5px 1.5px at 15% 80%,rgba(0,240,255,.45),transparent),radial-gradient(1px 1px at 60% 85%,rgba(255,255,255,.3),transparent),radial-gradient(1px 1px at 90% 75%,rgba(0,255,136,.4),transparent);pointer-events:none;z-index:0}
.grid-pattern{position:fixed;inset:0;background-image:linear-gradient(rgba(0,240,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,240,255,.03) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:0}
main{position:relative;z-index:1;max-width:1400px;margin:0 auto;padding:40px 32px}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:36px;padding:24px 32px;background:var(--card);border:1px solid var(--border);border-radius:12px;backdrop-filter:blur(20px);position:relative;overflow:hidden}
.header::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX 3s linear infinite}
.header::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX-rev 3s linear infinite}
@keyframes scanX{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
@keyframes scanX-rev{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}
@keyframes scanY{0%{transform:translateY(-100%)}100%{transform:translateY(100%)}}
@keyframes scanY-rev{0%{transform:translateY(100%)}100%{transform:translateY(-100%)}}
.header-left::before{content:'';position:absolute;top:0;left:0;width:1px;bottom:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY-rev 3s linear infinite;pointer-events:none}
.header-right::after{content:'';position:absolute;top:0;right:0;width:1px;bottom:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY 3s linear infinite;pointer-events:none}
.header-left h1{font-family:'Orbitron',sans-serif;font-size:26px;font-weight:900;background:linear-gradient(135deg,var(--cyan),#818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:2px;text-shadow:0 0 40px rgba(0,240,255,.3)}
.header-left .subtitle{color:var(--muted);font-size:12px;margin-top:4px;letter-spacing:1px}
.header-right{display:flex;gap:16px;align-items:center}
.header-stat{text-align:center;padding:0 20px;border-left:1px solid rgba(0,240,255,.1)}
.header-stat .num{font-family:'Orbitron',sans-serif;font-size:22px;font-weight:700;color:var(--cyan);text-shadow:0 0 20px rgba(0,240,255,.4)}
.header-stat .label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px}
.phase-indicator{display:flex;align-items:center;gap:8px;padding:8px 20px;border:1px solid rgba(0,240,255,.2);border-radius:20px;background:rgba(0,240,255,.05)}
.phase-indicator .dot{width:8px;height:8px;border-radius:50%;background:var(--cyan);box-shadow:0 0 12px var(--cyan);animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 12px var(--cyan)}50%{box-shadow:0 0 24px var(--cyan),0 0 48px rgba(0,240,255,.3)}}
.phase-indicator span{font-size:12px;color:var(--cyan);letter-spacing:1px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-bottom:28px}
@media(max-width:1000px){.grid{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:28px;backdrop-filter:blur(20px);position:relative;overflow:hidden;transition:all .3s}
.card:hover{border-color:rgba(0,240,255,.25);box-shadow:0 0 30px rgba(0,240,255,.08),inset 0 0 30px rgba(0,240,255,.02)}
.card-icon{font-size:28px;margin-bottom:16px;display:block}
.card h3{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:8px}
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
th{padding:14px 16px;font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;border-bottom:1px solid rgba(0,240,255,.08);text-align:left}
td{padding:14px 16px;border-bottom:1px solid rgba(0,240,255,.03);font-size:13px;transition:all .2s}
tr:hover td{background:rgba(0,240,255,.02)}
td.code{font-family:'JetBrains Mono',monospace;color:var(--text);font-weight:600}
.tx-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:4px;font-size:11px;font-weight:600;letter-spacing:.5px}
.tx-badge::before{content:'';width:6px;height:6px;border-radius:50%}
.tx-done{background:rgba(0,255,136,.08);color:var(--green);border:1px solid rgba(0,255,136,.2)}
.tx-done::before{background:var(--green);box-shadow:0 0 8px var(--green)}
.tx-active{background:rgba(0,240,255,.08);color:var(--cyan);border:1px solid rgba(0,240,255,.2)}
.tx-active::before{background:var(--cyan);box-shadow:0 0 8px var(--cyan);animation:pulse 2s infinite}
.tx-wait{background:rgba(100,116,139,.08);color:var(--muted);border:1px solid rgba(100,116,139,.2)}
.tx-wait::before{background:#64748b}
.type-t{display:inline-block;padding:3px 10px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase}
.type-feat{background:rgba(59,130,246,.12);color:#60a5fa}
.type-bug{background:rgba(245,158,11,.12);color:#fbbf24}
.type-res{background:rgba(168,85,247,.12);color:#c084fc}
.footer{display:flex;justify-content:space-between;align-items:center;margin-top:28px;padding:16px 0;border-top:1px solid rgba(0,240,255,.06);color:var(--muted);font-size:11px;letter-spacing:1px}
.data-stream{position:absolute;bottom:0;left:0;right:0;height:30px;background:linear-gradient(transparent,rgba(0,240,255,.02));overflow:hidden}
.num-font{font-family:'Orbitron',sans-serif;font-size:18px;color:var(--cyan)}.data-stream span{position:absolute;color:rgba(0,240,255,.15);font-family:'JetBrains Mono',monospace;font-size:10px;white-space:nowrap;animation:stream 20s linear infinite}
@keyframes stream{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}

.fs-btn{position:absolute;top:10px;right:10px;width:28px;height:28px;border-radius:6px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);color:var(--muted);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .2s;z-index:10;opacity:0}
.card:hover .fs-btn,.panel:hover .fs-btn{opacity:1}
.fs-btn:hover{background:rgba(0,240,255,.1);border-color:rgba(0,240,255,.3);color:var(--cyan)}
.fs-fullscreen{position:fixed!important;inset:0!important;z-index:1000!important;border-radius:0!important;overflow-y:auto!important;overscroll-behavior:contain!important}.fs-fullscreen::-webkit-scrollbar{width:6px}.fs-fullscreen::-webkit-scrollbar-thumb{background:rgba(0,240,255,.2);border-radius:3px}.fs-fullscreen{background:var(--bg)!important;backdrop-filter:none!important;opacity:1!important;padding:40px!important;width:100vw!important;height:100vh!important;max-width:none!important}.fs-fullscreen svg{width:100%!important;height:auto!important;max-height:65vh!important}.fs-fullscreen table{font-size:16px}.fs-fullscreen .stat-value{font-size:52px}.fs-fullscreen .big-num{font-size:64px}.fs-fullscreen .card{padding:36px}
.fs-tip{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,240,255,.1);border:1px solid rgba(0,240,255,.2);padding:8px 20px;border-radius:20px;font-size:11px;color:var(--cyan);z-index:1001;letter-spacing:1px;animation:fadeIn .3s ease;pointer-events:none}
@keyframes fadeIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}

</style>
</head>
<body>
<div class="ctrl-panel open"><button class="ctrl-toggle open" onclick="this.classList.toggle('open');this.parentElement.classList.toggle('open')">⚙️</button><div class="ctrl-body"><div class="theme-sw"><button onclick="setTheme('ocean')" title="Ocean Blue">🌊</button><button onclick="setTheme('cyber')" title="Cyber Dark">🌙</button><button onclick="setTheme('light')" title="Light Studio">☀️</button><button onclick="setTheme('mono')" title="Mono Tech">⬛</button><button onclick="setTheme('github')" title="GitHub Dark">🐙</button><button onclick="setTheme('synth')" title="SynthWave">💜</button><button onclick="setTheme('amber')" title="Amber Terminal">🟡</button><button onclick="setTheme('sakura')" title="Cherry Sakura">🌸</button><button onclick="setTheme('forest')" title="Midnight Forest">🌲</button></div><div class="lang-sw"><button data-lang="zh" class="active" onclick="setLang('zh')">中文</button><button data-lang="en" onclick="setLang('en')">EN</button></div><div class="font-sw"><button data-font="jetbrains" class="active" onclick="setFont('jetbrains')">Mono</button><button data-font="hybrid" onclick="setFont('hybrid')">Hybrid</button><button data-font="orbitron" onclick="setFont('orbitron')">Orbit</button></div><div class="fs-sw"><button data-fs="sm" onclick="setFs('sm')">S</button><button data-fs="md" onclick="setFs('md')">M</button><button data-fs="lg" class="active" onclick="setFs('lg')">L</button><button data-fs="xl" onclick="setFs('xl')">XL</button></div></div></div>
<div class="grid-pattern"></div><div class="stars"></div><div class="scanlines"></div>
<main>
  <div class="header">
    <div class="header-left">
      <h1>${data.project.toUpperCase()}</h1>
      <div class="subtitle">SPECCORE · SPEC-DRIVEN DEVELOPMENT${data.iterationOwner ? " · OWNER: "+data.iterationOwner.toUpperCase() : ""}${data.filterLabels ? " · "+data.filterLabels.join(" · ") : ""}${data.filteredFrom ? " (过滤自 "+data.filteredFrom+" 个任务)" : ""}</div>
    </div>
    <div class="header-right">
      <div class="header-stat"><div class="num">Q2</div><div class="label">迭代</div></div>
      <div class="header-stat"><div class="num">${total}</div><div class="label">任务</div></div>
      <div class="header-stat"><div class="num">${donePct}%</div><div class="label">完成</div></div>
      <div class="phase-indicator"><div class="dot"></div><span>${phaseLabel.toUpperCase()}</span></div>
    </div>
  </div>

  <div class="panel" style="margin-bottom:24px">
    <div class="panel-title">ITERATION TIMELINE</div>
    <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
      <div style="flex:1;min-width:300px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:11px;color:var(--muted)">
          <span>${data.iterationStart || "—"}</span>
          <span style="color:var(--cyan)">TODAY</span>
          <span>${data.iterationEnd || "—"}</span>
        </div>
        <div style="height:8px;background:rgba(255,255,255,.04);border-radius:4px;overflow:hidden;position:relative">
          <div style="position:absolute;top:0;left:${data.timeProgress || 0}%;width:2px;height:100%;background:var(--cyan);box-shadow:0 0 8px var(--cyan);z-index:2"></div>
          <div style="width:${data.timeProgress || 0}%;height:100%;background:linear-gradient(90deg,rgba(0,240,255,.3),rgba(0,240,255,.6));border-radius:4px;transition:width 1s"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:var(--muted)">
          <span>TIME ELAPSED: ${data.timeProgress || 0}%</span>
          <span style="color:${data.isOverdue ? 'var(--orange)' : 'var(--green)'}">${data.isOverdue ? 'OVERDUE' : 'DAYS LEFT'}: ${data.daysLeft || 0}</span>
        </div>
      </div>
      <div style="display:flex;gap:16px">
        <div style="text-align:center;padding:12px 20px;background:rgba(0,240,255,.05);border:1px solid rgba(0,240,255,.15);border-radius:8px">
          <div style="font-family:Orbitron;font-size:20px;color:var(--cyan);text-shadow:0 0 12px rgba(0,240,255,.3)">${data.daysLeft || 0}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:4px">DAYS</div>
        </div>
        <div style="text-align:center;padding:12px 20px;background:rgba(0,255,136,.05);border:1px solid rgba(0,255,136,.15);border-radius:8px">
          <div style="font-family:Orbitron;font-size:20px;color:var(--green);text-shadow:0 0 12px rgba(0,255,136,.3)">${donePct}%</div>
          <div style="font-size:10px;color:var(--muted);margin-top:4px">DONE</div>
        </div>
      </div>
    </div>
    ${data.milestones ? '<div style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap">' +
      ['devEnd','sit','uat','release'].map((k: string) => {
        const labels: Record<string, string> = {devEnd:'提测',sit:'SIT',uat:'UAT',release:'上线'};
        const icons: Record<string, string> = {devEnd:'🧪',sit:'🔬',uat:'✅',release:'🚀'};
        const val = data.milestones[k];
        const today = new Date(); const target = val ? new Date(val) : null;
        const isPast = target && target <= today;
        const isSet = !!val;
        return '<div style="flex:1;min-width:120px;padding:12px 16px;background:'+(isSet?(isPast?'rgba(0,255,136,.05)':'rgba(0,240,255,.05)'):'rgba(255,255,255,.02)')+';border:1px solid '+(isSet?(isPast?'rgba(0,255,136,.15)':'rgba(0,240,255,.15)'):'rgba(255,255,255,.04)')+';border-radius:8px;text-align:center">' +
               '<div style="font-size:20px;margin-bottom:4px">'+icons[k]+'</div>'+
               '<div style="font-family:Orbitron;font-size:16px;color:'+(isPast?'var(--green)':isSet?'var(--cyan)':'var(--muted)')+'">'+(val||'—')+'</div>'+
               '<div style="font-size:10px;color:var(--muted);margin-top:4px;letter-spacing:1px">'+labels[k]+'</div></div>';
      }).join('') + '</div>' : ''}
    ${(data.delays||[]).length > 0 ? '<div style="margin-top:16px;padding:12px 16px;background:rgba(245,158,11,.05);border:1px solid rgba(245,158,11,.15);border-radius:8px"><div style="font-size:10px;color:var(--orange);letter-spacing:1px;margin-bottom:8px">⚠ DELAY HISTORY ('+(data.delays||[]).length+')</div>' + 
      (data.delays||[]).map((d: any) => '<div style="font-size:11px;color:var(--text);margin-bottom:4px;display:flex;gap:12px"><span style="color:var(--orange);font-family:Orbitron;font-size:10px">'+d.date+'</span><span>'+d.reason+'</span></div>').join('') + '</div>' : ''}
  </div>

  <div class="grid">
    <div class="card">
      <button class="fs-btn" title="Fullscreen (F)" onclick="toggleFS(this.parentElement)">⛶</button>
      <div class="data-stream"><span>ANALYZING PHASE PROGRESS...</span></div>
      <span class="card-icon">⏳</span>
      <h3>Phase Progress</h3>
      <div class="big-num cyan">${phaseLabel}</div>
      <div class="tech-bar"><div class="tech-bar-fill cyan" style="width:${phasePct}%"></div></div>
      <div style="color:var(--muted);font-size:11px;margin-top:8px;letter-spacing:1px">${phasePct}% COMPLETE</div>
    </div>

    <div class="card">
      <button class="fs-btn" title="Fullscreen (F)" onclick="toggleFS(this.parentElement)">⛶</button>
      <div class="data-stream"><span>PARSING TASK DISTRIBUTION...</span></div>
      <span class="card-icon">📊</span>
      <h3>Task Distribution</h3>
      <div class="big-num purple">${total}</div>
      <div class="stacked">
        <div class="stacked-seg" style="width:${donePct}%;background:linear-gradient(180deg,#065f46,var(--green))">${donePct>10?done:''}</div>
        <div class="stacked-seg" style="width:${inProgressPct}%;background:linear-gradient(180deg,#0c4a6e,var(--cyan))">${inProgressPct>10?inProgress:''}</div>
        <div class="stacked-seg" style="width:${pendingPct}%;background:rgba(255,255,255,.03)">${pendingPct>10?pending:''}</div>
      </div>
      <div style="display:flex;gap:20px;margin-top:12px;font-size:11px;color:var(--muted)">
        <span>■ ${done} DONE</span><span>■ ${inProgress} ACTIVE</span><span>■ ${pending} QUEUED</span>
      </div>
    </div>

    <div class="card">
      <button class="fs-btn" title="Fullscreen (F)" onclick="toggleFS(this.parentElement)">⛶</button>
      <div class="data-stream"><span>CALCULATING COMPLETION RATE...</span></div>
      <span class="card-icon">🎯</span>
      <h3>Completion Rate</h3>
      <div class="big-num green">${donePct}%</div>
      <div class="tech-bar"><div class="tech-bar-fill green" style="width:${donePct}%"></div></div>
      <div style="color:var(--muted);font-size:11px;margin-top:8px;letter-spacing:1px">${done}/${total} TASKS RESOLVED</div>
    </div>
  </div>

  <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:0">
    <div class="card">
      <button class="fs-btn" title="Fullscreen (F)" onclick="toggleFS(this.parentElement)">⛶</button>
      <div class="data-stream"><span>GENERATING DONUT METRICS...</span></div>
      <h3 style="margin-bottom:20px">COMPLETION BREAKDOWN</h3>
      <div style="display:flex;align-items:center;gap:32px;justify-content:center">
        <svg viewBox="0 0 160 160" style="width:160px;height:160px">
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
          <div style="display:flex;align-items:center;gap:8px"><div style="width:10px;height:10px;border-radius:2px;background:var(--green);box-shadow:0 0 8px var(--green)"></div><span style="font-size:12px;color:var(--text)">RESOLVED</span><span style="font-family:Orbitron;font-size:14px;color:var(--green);margin-left:auto">${done}</span></div>
          <div style="display:flex;align-items:center;gap:8px"><div style="width:10px;height:10px;border-radius:2px;background:var(--cyan);box-shadow:0 0 8px var(--cyan)"></div><span style="font-size:12px;color:var(--text)">ACTIVE</span><span style="font-family:Orbitron;font-size:14px;color:var(--cyan);margin-left:auto">${inProgress}</span></div>
          <div style="display:flex;align-items:center;gap:8px"><div style="width:10px;height:10px;border-radius:2px;background:#4a5568"></div><span style="font-size:12px;color:var(--muted)">QUEUED</span><span style="font-family:Orbitron;font-size:14px;color:var(--muted);margin-left:auto">${pending}</span></div>
        </div>
      </div>
    </div>

    <div class="card">
      <button class="fs-btn" title="Fullscreen (F)" onclick="toggleFS(this.parentElement)">⛶</button>
      <div class="data-stream"><span>RENDERING TASK TIMELINE...</span></div>
      <h3 style="margin-bottom:20px">TASK PROGRESS</h3>
      <div style="display:flex;flex-direction:column;gap:14px">
      ${tasks.map((t: any,i: number) => {
        const pct = i === 0 ? 100 : i === 1 ? 85 : i === 2 ? 45 : i === 3 ? 20 : 5;
        const color = pct === 100 ? 'var(--green)' : pct > 50 ? 'var(--cyan)' : '#4a5568';
        const shadow = pct === 100 ? 'var(--green)' : pct > 50 ? 'var(--cyan)' : 'transparent';
        return '<div style="display:flex;align-items:center;gap:10px">' +
               '<span style="font-size:10px;color:var(--muted);width:60px;text-align:right">' + t.id.split('-').slice(0,2).join('-') + '</span>' +
               '<div style="flex:1;height:6px;background:rgba(255,255,255,.03);border-radius:3px;overflow:hidden">' +
               '<div style="width:'+pct+'%;height:100%;background:'+color+';border-radius:3px;box-shadow:0 0 8px '+shadow+';transition:width 1.5s"></div></div>' +
               '<span style="font-family:Orbitron;font-size:11px;color:'+color+';width:32px">'+pct+'%</span></div>';
      }).join('')}
      </div>
    </div>
  </div>


  <div class="grid" style="grid-template-columns:1fr 1fr;margin-bottom:20px">
    <div class="card" style="min-height:280px">
      <button class="fs-btn" title="Fullscreen (F)" onclick="toggleFS(this.parentElement)">⛶</button>
      <div class="data-stream"><span>RENDERING GANTT CHART...</span></div>
      <h3 style="margin-bottom:16px">GANTT TIMELINE</h3>
      <div style="overflow-x:auto">
        <svg viewBox="0 0 500 180" style="width:100%;height:180px;min-width:400px">
          <defs>
            <linearGradient id="gGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="var(--cyan)"/><stop offset="100%" stop-color="var(--green)"/></linearGradient>
          </defs>
          <!-- Date axis marks -->
          <line x1="60" y1="30" x2="480" y2="30" stroke="rgba(0,240,255,.1)" stroke-width="1"/>
          <text x="60" y="25" fill="#4a5568" font-size="10">APR</text>
          <text x="170" y="25" fill="#4a5568" font-size="10">MAY</text>
          <text x="280" y="25" fill="#4a5568" font-size="10">JUN</text>
          <text x="390" y="25" fill="#4a5568" font-size="10">JUL</text>
          <!-- Today line -->
          <line x1="310" y1="35" x2="310" y2="160" stroke="var(--cyan)" stroke-width="1" stroke-dasharray="4,4" opacity=".5"/>
          <text x="310" y="172" fill="var(--cyan)" font-size="9" text-anchor="middle" opacity=".8">TODAY</text>
          <!-- Task bars -->
          ${tasks.slice(0,5).map((t: any,i: number) => {
            const x = 60 + i * 20;   // staggered start
            const w = Math.max(40, 100 - i * 15);  // varying widths
            const y = 55 + i * 24;
            const done = t.status.includes('完成')||t.status==='completed';
            const active = t.status.includes('开发')||t.status==='in_progress';
            const color = done ? 'var(--green)' : active ? 'var(--cyan)' : '#334155';
            const label = t.id.split('-').slice(0,2).join('-');
            return '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="16" rx="4" fill="'+color+'" opacity=".85"/>' +
                   '<text x="'+(x+4)+'" y="'+ (y+12) +'" fill="#060b14" font-size="9" font-weight="600">'+label+'</text>';
          }).join('')}
        </svg>
      </div>
    </div>

    <div class="card" style="min-height:280px">
      <button class="fs-btn" title="Fullscreen (F)" onclick="toggleFS(this.parentElement)">⛶</button>
      <div class="data-stream"><span>CALCULATING BURNDOWN...</span></div>
      <h3 style="margin-bottom:16px">BURNDOWN CHART</h3>
      <svg viewBox="0 0 500 180" style="width:100%;height:180px;min-width:400px">
        <defs>
          <linearGradient id="idealGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="var(--cyan)"/><stop offset="100%" stop-color="#818cf8"/></linearGradient>
          <linearGradient id="actualGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="var(--green)"/><stop offset="100%" stop-color="#34d399"/></linearGradient>
        </defs>
        <!-- Grid -->
        ${[0,1,2,3,4,5].map((i: number) => '<line x1="60" y1="'+(30+i*26)+'" x2="480" y2="'+(30+i*26)+'" stroke="rgba(255,255,255,.03)" stroke-width="1"/>').join('')}
        <text x="55" y="35" fill="#4a5568" font-size="10" text-anchor="end">5</text>
        <text x="55" y="61" fill="#4a5568" font-size="10" text-anchor="end">4</text>
        <text x="55" y="87" fill="#4a5568" font-size="10" text-anchor="end">3</text>
        <text x="55" y="113" fill="#4a5568" font-size="10" text-anchor="end">2</text>
        <text x="55" y="139" fill="#4a5568" font-size="10" text-anchor="end">1</text>
        <text x="55" y="165" fill="#4a5568" font-size="10" text-anchor="end">0</text>
        <!-- Ideal line (diagonal: 5 -> 0) -->
        <polyline points="70,35 460,160" fill="none" stroke="url(#idealGrad)" stroke-width="2" stroke-dasharray="6,4" opacity=".6"/>
        <!-- Actual line (step: 5,5,4,2,2,...) -->
        <polyline points="70,35 150,35 230,61 310,113 420,113 460,139" fill="none" stroke="url(#actualGrad)" stroke-width="2.5" stroke-linecap="round"/>
        <!-- Dots -->
        <circle cx="70" cy="35" r="3" fill="var(--green)"/>
        <circle cx="150" cy="35" r="3" fill="var(--green)"/>
        <circle cx="230" cy="61" r="3" fill="var(--green)"/>
        <circle cx="310" cy="113" r="4" fill="var(--cyan)" stroke="var(--cyan)" stroke-width="2"/>
        <circle cx="420" cy="113" r="3" fill="#4a5568"/>
        <circle cx="460" cy="139" r="3" fill="#4a5568"/>
        <!-- Labels -->
        <text x="70" y="25" fill="#4a5568" font-size="9" text-anchor="middle">W1</text>
        <text x="150" y="25" fill="#4a5568" font-size="9" text-anchor="middle">W2</text>
        <text x="230" y="25" fill="#4a5568" font-size="9" text-anchor="middle">W3</text>
        <text x="310" y="25" fill="#4a5568" font-size="9" text-anchor="middle">W4</text>
        <text x="420" y="25" fill="#4a5568" font-size="9" text-anchor="middle">W5</text>
        <text x="460" y="25" fill="#4a5568" font-size="9" text-anchor="middle">W6</text>
        <!-- Legend -->
        <line x1="60" y1="155" x2="90" y2="155" stroke="url(#idealGrad)" stroke-width="2" stroke-dasharray="4,3" opacity=".6"/>
        <text x="95" y="158" fill="#4a5568" font-size="9">IDEAL</text>
        <line x1="130" y1="155" x2="160" y2="155" stroke="url(#actualGrad)" stroke-width="2.5"/>
        <text x="165" y="158" fill="#4a5568" font-size="9">ACTUAL</text>
      </svg>
    </div>
  </div>

  <div class="grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:20px">
    <div class="card">
      <h3 style="margin-bottom:14px">TYPE PIE</h3>
      <div style="display:flex;align-items:center;gap:16px;justify-content:center">
        <svg viewBox="0 0 140 140" style="width:140px;height:140px">
          <circle cx="70" cy="70" r="60" fill="none" stroke="rgba(255,255,255,.04)" stroke-width="20"/>
          ${(() => {
            const total = featCount + bugCount + researchCount;
            if (total === 0) return '<text x="70" y="75" text-anchor="middle" font-size="12" fill="var(--muted)">NO DATA</text>';
            // Calculate arcs
            let offset = 0;
            const featAngle = featCount/total*360;
            const bugAngle = bugCount/total*360;
            const resAngle = researchCount/total*360;
            const arcs = [];
            // Feature arc
            if (featAngle > 0) {
              const startX = 70 + 60*Math.cos((offset-90)*Math.PI/180);
              const startY = 70 + 60*Math.sin((offset-90)*Math.PI/180);
              const endX = 70 + 60*Math.cos((offset+featAngle-90)*Math.PI/180);
              const endY = 70 + 60*Math.sin((offset+featAngle-90)*Math.PI/180);
              const largeArc = featAngle > 180 ? 1 : 0;
              arcs.push('<path d="M70,70 L'+startX+','+startY+' A60,60 0 '+largeArc+',1 '+endX+','+endY+' Z" fill="var(--cyan)" opacity=".85"/>');
              offset += featAngle;
            }
            if (bugAngle > 0) {
              const startX = 70 + 60*Math.cos((offset-90)*Math.PI/180);
              const startY = 70 + 60*Math.sin((offset-90)*Math.PI/180);
              const endX = 70 + 60*Math.cos((offset+bugAngle-90)*Math.PI/180);
              const endY = 70 + 60*Math.sin((offset+bugAngle-90)*Math.PI/180);
              const largeArc = bugAngle > 180 ? 1 : 0;
              arcs.push('<path d="M70,70 L'+startX+','+startY+' A60,60 0 '+largeArc+',1 '+endX+','+endY+' Z" fill="var(--orange)" opacity=".85"/>');
              offset += bugAngle;
            }
            if (resAngle > 0) {
              const startX = 70 + 60*Math.cos((offset-90)*Math.PI/180);
              const startY = 70 + 60*Math.sin((offset-90)*Math.PI/180);
              const endX = 70 + 60*Math.cos((offset+resAngle-90)*Math.PI/180);
              const endY = 70 + 60*Math.sin((offset+resAngle-90)*Math.PI/180);
              const largeArc = resAngle > 180 ? 1 : 0;
              arcs.push('<path d="M70,70 L'+startX+','+startY+' A60,60 0 '+largeArc+',1 '+endX+','+endY+' Z" fill="var(--purple)" opacity=".85"/>');
            }
            arcs.push('<circle cx="70" cy="70" r="35" fill="var(--bg)"/>');
            arcs.push('<text x="70" y="72" text-anchor="middle" font-family="Orbitron" font-size="18" font-weight="900" fill="var(--text)">'+total+'</text>');
            arcs.push('<text x="70" y="86" text-anchor="middle" font-size="9" fill="var(--muted)">TASKS</text>');
            return arcs.join('');
          })()}
        </svg>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:center;gap:6px"><div style="width:8px;height:8px;border-radius:2px;background:var(--cyan)"></div><span style="font-size:11px">FEAT ${featCount}</span></div>
          <div style="display:flex;align-items:center;gap:6px"><div style="width:8px;height:8px;border-radius:2px;background:var(--orange)"></div><span style="font-size:11px">BUG ${bugCount}</span></div>
          <div style="display:flex;align-items:center;gap:6px"><div style="width:8px;height:8px;border-radius:2px;background:var(--purple)"></div><span style="font-size:11px">RES ${researchCount}</span></div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-bottom:14px">PACE ANALYSIS</h3>
      <div style="text-align:center;padding:12px 0">
        <div style="font-family:Orbitron;font-size:36px;font-weight:900;color:var(--green);text-shadow:0 0 20px rgba(0,255,136,.3)">${featCount}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">FEATURES</div>
        <div style="margin-top:12px;font-size:28px;font-weight:900;color:var(--orange);text-shadow:0 0 16px rgba(245,158,11,.3)">${bugCount}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">BUGS</div>
      </div>
      <div style="margin-top:12px;padding:12px;background:rgba(0,240,255,.04);border-radius:8px;text-align:center">
        <div style="font-size:11px;color:var(--muted)">BUG RATIO</div>
        <div style="font-family:Orbitron;font-size:18px;color:var(--orange);margin-top:2px">${total > 0 ? Math.round((bugCount)/total*100) : 0}%</div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-bottom:14px">SPRINT ACTIVITY</h3>
      <div style="text-align:center;padding:8px 0">
        <div style="font-size:40px;font-weight:900;background:linear-gradient(135deg,var(--green),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent">+${addedThisWeek}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:4px;letter-spacing:1px">TASKS THIS WEEK</div>
      </div>
      <div style="margin-top:16px;display:flex;gap:8px">
        <div style="flex:1;text-align:center;padding:8px;background:rgba(0,255,136,.05);border-radius:6px">
          <div style="font-family:Orbitron;font-size:14px;color:var(--green)">${done}</div>
          <div style="font-size:9px;color:var(--muted)">DONE</div>
        </div>
        <div style="flex:1;text-align:center;padding:8px;background:rgba(0,240,255,.05);border-radius:6px">
          <div style="font-family:Orbitron;font-size:14px;color:var(--cyan)">${inProgress}</div>
          <div style="font-size:9px;color:var(--muted)">ACTIVE</div>
        </div>
        <div style="flex:1;text-align:center;padding:8px;background:rgba(100,116,139,.05);border-radius:6px">
          <div style="font-family:Orbitron;font-size:14px;color:var(--muted)">${pending}</div>
          <div style="font-size:9px;color:var(--muted)">QUEUE</div>
        </div>
      </div>
    </div>
  </div>

  ${hasAssignees ? '<div class="panel" style="margin-bottom:20px"><div class="panel-title">TEAM DETAILS</div>' +
    // ── 按平台分组的汇总表 ──
    (() => {
      let lastGroup = '';
      let tables = '';
      const row = (name: string, d: any) => {
        const pct = d.total > 0 ? Math.round(d.done/d.total*100) : 0;
        return '<tr><td style="font-weight:600">'+name+'</td><td>'+d.total+'</td><td>'+d.done+'</td><td><span style="color:'+(pct===100?'var(--green)':'var(--cyan)')+'">'+pct+'%</span></td>'+
               '<td><span style="color:var(--cyan)">'+d.features+'</span></td><td><span style="color:var(--orange)">'+d.bugs+'</span></td>'+
               '<td><span style="color:var(--purple)">'+(d.total-d.features-d.bugs)+'</span></td><td>'+d.estHours+'h</td></tr>';
      };
      for (const [name, d] of sortedPersonEntries) {
        const g = getPlatformGroup(name);
        if (g !== lastGroup) {
          if (lastGroup !== '') tables += '</tbody></table></div>';
          const label = g === '0_backend' ? '🔧 BACKEND' : g === '1_frontend' ? '🎨 FRONTEND' : '📦 OTHER';
          tables += '<div style="margin-bottom:16px"><div style="font-size:11px;color:var(--cyan);letter-spacing:1px;margin-bottom:8px;font-family:Orbitron">'+label+'</div>' +
                    '<table style="margin-bottom:0"><thead><tr><th>人员</th><th>总任务</th><th>完成</th><th>完成率</th><th>功能</th><th>Bug</th><th>研究</th><th>工时</th></tr></thead><tbody>';
          lastGroup = g;
        }
        tables += row(name, d);
      }
      tables += '</tbody></table></div>';
      return tables;
    })() +
    // ── 人员详细（可折叠）──
    '<div class="panel-title collapsible-header" style="font-size:13px;cursor:pointer;margin-bottom:16px" id="person-detail-header">◆ 详细任务 <span style="font-size:10px;color:var(--muted);margin-left:8px">展开更多 ▼</span></div>' +
    '<div class="collapsible-body" id="person-detail-body" style="max-height:400px;overflow:hidden;transition:max-height .5s ease">' +
    (() => {
      let lastGroup = '';
      let html = '';
      for (const [name, d] of sortedPersonEntries) {
        const g = getPlatformGroup(name);
        if (g !== lastGroup) {
          const label = g === '0_backend' ? '🔧 BACKEND' : g === '1_frontend' ? '🎨 FRONTEND' : '📦 OTHER';
          html += '<div style="margin:16px 0 8px;font-family:Orbitron;font-size:12px;color:var(--cyan);letter-spacing:1px;border-bottom:1px solid rgba(0,240,255,.1);padding-bottom:4px">'+label+'</div>';
          lastGroup = g;
        }
        const pct = d.total > 0 ? Math.round(d.done/d.total*100) : 0;
        html += '<div style="background:rgba(0,240,255,.03);border:1px solid rgba(0,240,255,.08);border-radius:10px;padding:18px;margin-bottom:12px">' +
          '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">' +
          '<span style="font-size:14px;font-weight:700">'+name+'</span>' +
          '<span style="font-family:Orbitron;font-size:12px;color:var(--cyan)">'+pct+'%</span>' +
          '<span style="font-size:10px;color:var(--muted)">'+d.done+'/'+d.total+' 任务</span>' +
          '<span style="font-size:10px;margin-left:auto;color:var(--muted)">'+d.features+'功能 '+d.bugs+'Bug '+d.estHours+'h</span>' +
          '</div>' +
          '<div style="height:3px;background:rgba(255,255,255,.04);border-radius:2px;overflow:hidden">' +
          '<div style="width:'+pct+'%;height:100%;background:linear-gradient(90deg,var(--cyan),var(--green));border-radius:2px"></div></div>' +
          '</div>';
        // 该人员的任务清单
        const personTasks = (pt as any)[name] || [];
        if (personTasks.length > 0) {
          html += '<table style="margin-bottom:16px;margin-left:8px;width:calc(100% - 8px)"><thead><tr><th>ID</th><th>STATUS</th><th>TYPE</th></tr></thead><tbody>';
          for (const t of personTasks) {
            const cls = t.status.includes('completed')||t.status.includes('完成')?'tx-done':t.status.includes('in_progress')||t.status.includes('开发')?'tx-active':'tx-wait';
            const st = t.status.includes('completed')||t.status.includes('完成')?'RESOLVED':t.status.includes('in_progress')||t.status.includes('开发')?'ACTIVE':'QUEUED';
            html += '<tr><td class="code">'+t.id+'</td><td><span class="tx-badge '+cls+'">'+st+'</span></td><td><span class="type-t type-feat">'+(t.type||'FEAT')+'</span></td></tr>';
          }
          html += '</tbody></table>';
        }
      }
      return html;
    })() + '</div></div>' : ''}

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
        return '<tr><td class="code">'+t.id+'</td><td><span class="tx-badge '+cls+'">'+st+'</span></td><td><span class="type-t '+typeCls+'">'+(t.type||'FEAT')+'</span></td><td style="font-family:JetBrains Mono,monospace;color:var(--muted)">'+dur+'</td></tr>';
      }).join('')}
      ${!tasks.length? '<tr><td colspan="4" style="text-align:center;padding:40px;color:var(--muted)">NO TASK DATA</td></tr>' : ''}
      </tbody>
    </table>
  </div>

  <div class="footer">
    <span>SPECCORE v5.20.0 · SPEC-DRIVEN DEVELOPMENT</span>
    <span>EXPORTED: ${data.exportedAt}</span>
  </div>
</main>

<script>
let fsEl=null;
function toggleFS(el){
  if(fsEl){closeFS();return}
  fsEl=el;el.classList.add('fs-fullscreen');
  document.documentElement.style.overflow='hidden';document.body.style.overflow='hidden';
  var ts=document.querySelector('.theme-sw');if(ts){ts.style.opacity='0';ts.style.pointerEvents='none';}
}
function closeFS(){
  if(!fsEl)return;
  fsEl.classList.remove('fs-fullscreen');
  document.documentElement.style.overflow='';document.body.style.overflow='';
  var ts=document.querySelector('.theme-sw');if(ts){ts.style.opacity='';ts.style.pointerEvents='';}
  fsEl=null;
}
document.addEventListener('keydown',e=>{
  if(e.key==='Escape')closeFS();
  if(e.key==='f'||e.key==='F'){
    if(document.activeElement&&document.activeElement.tagName==='INPUT')return;
    const hovered=document.querySelector('.card:hover,.panel:hover');
    if(hovered) toggleFS(hovered);
  }
});
// Collapsible TEAM DETAILS — wrap ALL person content
setTimeout(function(){
  // ── 人员列表折叠（通过 ID 定位）──
  var header = document.getElementById('person-detail-header');
  var body = document.getElementById('person-detail-body');
  if(header && body){
    // 动态计算预览高度：取内容的40%，最少200px，最多650px
    body.style.maxHeight = 'none';
    var fullH = body.scrollHeight;
    var previewH = Math.max(200, Math.min(Math.round(fullH * 0.4), 650));
    body.style.maxHeight = previewH + 'px';
    header.onclick = function(){
      var arrow = header.querySelector('span');
      var curH = parseInt(body.style.maxHeight) || 0;
      if(curH <= previewH + 1){
        // Expand to full
        body.style.maxHeight = 'none';
        var fullH = body.scrollHeight;
        body.style.maxHeight = fullH + 'px';
        if(arrow) arrow.innerHTML = '收起 ▲';
        header.classList.remove('collapsed');
      } else {
        // Collapse to preview
        body.style.maxHeight = previewH + 'px';
        if(arrow) arrow.innerHTML = '展开更多 ▼';
        header.classList.add('collapsed');
      }
    };
  }
}, 200);
document.querySelectorAll('.card,.panel').forEach(el=>{
  const btn=document.createElement('button');
  btn.className='fs-btn';btn.title='Fullscreen (F)';btn.innerHTML='⛶';btn.onclick=e=>{e.stopPropagation();toggleFS(el)};
  el.style.position=el.style.position||'relative';
  el.appendChild(btn);
});
</script>


<script>
(function(){var t=localStorage.getItem('speccore-theme')||'ocean';document.documentElement.setAttribute('data-theme',t)})();
function setTheme(t){document.documentElement.setAttribute('data-theme',t);localStorage.setItem('speccore-theme',t);document.querySelectorAll('.theme-sw button').forEach((b,i)=>{b.classList.toggle('active',['ocean','cyber','light','mono','github','synth','amber','sakura','forest'][i]===t)});}
document.querySelectorAll('.theme-sw button').forEach((b,i)=>{b.classList.toggle('active',['ocean','cyber','light','mono','github','synth','amber','sakura','forest'][i]===(localStorage.getItem('speccore-theme')||'ocean'))});
</script>

<script>
var I18N={zh:{phase:'阶段',tasks:'任务',healthScore:'健康度评分',completionRate:'完成率',testCoverage:'测试覆盖',reviewCoverage:'审查覆盖',compositeScore:'综合评分',lifecycle:'任务生命周期'},en:{phase:'Phase',tasks:'Tasks',healthScore:'Health Score',completionRate:'Completion',testCoverage:'Test Coverage',reviewCoverage:'Review Coverage',compositeScore:'Composite',lifecycle:'Lifecycle'}};
function setLang(l){document.querySelectorAll('.lang-sw button').forEach(b=>b.classList.toggle('active',b.dataset.lang===l));document.querySelectorAll('[data-i18n]').forEach(el=>{var k=el.dataset.i18n;if(I18N[l]&&I18N[l][k])el.textContent=I18N[l][k]});localStorage.setItem('speccore-lang',l)}
(function(){var l=localStorage.getItem('speccore-lang')||(navigator.language.startsWith('zh')?'zh':'en');setLang(l)})();
</script>

<script>
function setFont(f){document.body.className=document.body.className.replace(/font-\w+/g,'');document.body.classList.add('font-'+f);localStorage.setItem('speccore-font',f);document.querySelectorAll('.font-sw button').forEach(b=>b.classList.toggle('active',b.dataset.font===f));}
function setFs(s){document.documentElement.className=document.documentElement.className.replace(/fs-\w+/g,'');document.documentElement.classList.add('fs-'+s);localStorage.setItem('speccore-fs',s);document.querySelectorAll('.fs-sw button').forEach(b=>b.classList.toggle('active',b.dataset.fs===s));}
(function(){var f=localStorage.getItem('speccore-font')||'jetbrains';setFont(f);var s=localStorage.getItem('speccore-fs')||'lg';setFs(s);})();
</script>

  \${data.health ? \`
  <div class="card" style="margin-top:24px">
    <div class="card-title">🏥 健康度评分</div>
    <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:12px">
      <div style="flex:1;min-width:100px;text-align:center;padding:16px;background:var(--surface);border-radius:8px">
        <div style="font-size:28px;font-weight:700;color:var(--primary)">\${data.health.donePct}%</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">完成率</div>
      </div>
      <div style="flex:1;min-width:100px;text-align:center;padding:16px;background:var(--surface);border-radius:8px">
        <div style="font-size:28px;font-weight:700;color:#4caf50">\${data.health.testPct}%</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">测试覆盖</div>
      </div>
      <div style="flex:1;min-width:100px;text-align:center;padding:16px;background:var(--surface);border-radius:8px">
        <div style="font-size:28px;font-weight:700;color:#ff9800">\${data.health.reviewPct}%</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">审查覆盖</div>
      </div>
      <div style="flex:1;min-width:100px;text-align:center;padding:16px;background:var(--surface);border-radius:8px;border:2px solid var(--primary)">
        <div style="font-size:32px;font-weight:900">\${data.health.grade}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">\${data.health.score}/100</div>
      </div>
    </div>
  </div>
  \` : \'\'}

  \${data.lifecycle ? \`
  <div class="card" style="margin-top:24px">
    <div class="card-title">📋 任务生命周期</div>
    <table style="margin-top:12px;width:100%">
      <thead><tr><th>Task</th><th style="width:100px">状态</th></tr></thead>
      <tbody>\${data.lifecycle.tasks.map((t:any) => \\\`<tr><td class="code">\${t.id}</td><td><span class="badge badge-\${t.status}">\${t.status}</span></td></tr>\\\`).join('')}</tbody>
    </table>
  </div>
  \` : \'\'}

</body></html>`;}


// ── Health Report (merged from health command) ──
async function showHealthReport(config: any, iteration: string | null): Promise<void> {
  if (!iteration) { logger.info("无活跃迭代"); return; }
  const iterDir = `Iteration-${iteration}`;
  const tasks = await scanTaskDirs(iterDir);
  
  let totalTasks = tasks.length, completed = 0, hasTest = 0, hasReview = 0;
  for (const t of tasks) {
    if (await isTaskDone(iterDir, t)) completed++;
    if (await pathExists(join(iterDir, t, "10-backend", "TEST.md"))) hasTest++;
    if (await pathExists(join(iterDir, t, "10-backend", "REVIEW.md"))) hasReview++;
  }
  
  const donePct = totalTasks > 0 ? Math.round(completed / totalTasks * 100) : 0;
  const testPct = totalTasks > 0 ? Math.round(hasTest / totalTasks * 100) : 0;
  const reviewPct = totalTasks > 0 ? Math.round(hasReview / totalTasks * 100) : 0;
  
  logger.info('\\n📊 项目健康度报告 — ' + iteration);
  logger.info('');
  logger.info('  任务完成率:    ' + donePct + '% (' + completed + '/' + totalTasks + ')');
  logger.info('  测试覆盖率:    ' + testPct + '% (' + hasTest + '/' + totalTasks + ' 有 TEST.md)');
  logger.info('  审查覆盖率:    ' + reviewPct + '% (' + hasReview + '/' + totalTasks + ' 有 REVIEW.md)');
  
  const score = Math.round(donePct * 0.4 + testPct * 0.3 + reviewPct * 0.3);
  const grade = score >= 90 ? '🟢 A' : score >= 70 ? '🟡 B' : score >= 50 ? '🟠 C' : '🔴 D';
  logger.info('  综合健康度:    ' + grade + ' (' + score + '/100)');
  logger.info('');
}

// ── Lifecycle Board (merged from lifecycle command) ──
async function showLifecycleBoard(config: any, iteration: string | null, opts: any): Promise<void> {
  if (!iteration) { logger.info("无活跃迭代"); return; }
  const iterDir = `Iteration-${iteration}`;
  const tasks = await scanTaskDirs(iterDir);
  
  logger.info('\\n📋 任务生命周期 — ' + iteration);
  const states = { pending: '🔲', in_progress: '🔵', testing: '🟡', review: '🟣', done: '🟢' };
  
  for (const t of tasks) {
    const status = await getTaskStatus(iterDir, t);
    const icon = (states as any)[status] || '⚪';
    logger.info('  ' + icon + ' ' + t + '  [' + status + ']');
  }
  logger.info('');
  logger.info('  🔲待开始 → 🔵开发中 → 🟡测试中 → 🟣审查中 → 🟢已完成');
}

async function scanTaskDirs(iterDir: string): Promise<string[]> {
  if (!await pathExists(iterDir)) return [];
  const entries = await readdir(iterDir, { withFileTypes: true });
  return entries.filter(e => e.isDirectory() && e.name.startsWith('Task-')).map(e => e.name);
}

async function isTaskDone(iterDir: string, task: string): Promise<boolean> {
  return await pathExists(join(iterDir, task, '.task-type')) || false;
}

async function getTaskStatus(iterDir: string, task: string): Promise<string> {
  try {
    const tf = join(iterDir, task, '.task-status');
    if (await pathExists(tf)) return (await readFile(tf, 'utf-8')).trim();
  } catch {}
  return 'pending';
}


// ── Collect Health Data for export ──
async function collectHealthData(iteration: string): Promise<any> {
  const iterDir = join(process.cwd(), "迭代-" + iteration);
  const tasks = await scanTaskDirs(iterDir);
  let total = tasks.length, completed = 0, hasTest = 0, hasReview = 0;
  for (const t of tasks) {
    if (await isTaskDone(iterDir, t)) completed++;
    if (await pathExists(join(iterDir, t, "10-backend", "TEST.md"))) hasTest++;
    if (await pathExists(join(iterDir, t, "10-backend", "REVIEW.md"))) hasReview++;
  }
  const donePct = total > 0 ? Math.round(completed / total * 100) : 0;
  const testPct = total > 0 ? Math.round(hasTest / total * 100) : 0;
  const reviewPct = total > 0 ? Math.round(hasReview / total * 100) : 0;
  const score = Math.round(donePct * 0.4 + testPct * 0.3 + reviewPct * 0.3);
  const grade = score >= 90 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D';
  return { total, completed, hasTest, hasReview, donePct, testPct, reviewPct, score, grade };
}

// ── Collect Lifecycle Data for export ──
async function collectLifecycleData(iteration: string): Promise<any> {
  const iterDir = join(process.cwd(), "迭代-" + iteration);
  const taskDirs = await scanTaskDirs(iterDir);
  const tasks: any[] = [];
  for (const t of taskDirs) {
    const status = await getTaskStatus(iterDir, t);
    tasks.push({ id: t, status });
  }
  return { tasks, iteration };
}

// ── 全局仪表盘（通过 --scope global 触发）──
async function showGlobalDashboard(options: StatusPanelOptions): Promise<void> {
  const { generateDashboardHtml } = await import('./dashboard');
  const { writeFile } = await import('fs-extra');
  const { join } = await import('path');
  const { logger, Spinner } = await import('../utils/logger');

  const spinner = new Spinner('采集全量层数据...');
  spinner.start();

  try {
    const index = await readGlobalIndex();
    if (index.projects.length === 0 && index.reqs.length === 0) {
      spinner.fail('全量层为空，无法生成仪表盘。请先导入项目。');
      return;
    }

    const totalReqs = index.reqs.length;
    const implemented = index.reqs.filter((r) => r.status === '✅ 已实现' || r.status === '📦 已有实现').length;
    const inProgress = index.reqs.filter((r) => r.status === '🔄 进行中').length;
    const pending = totalReqs - implemented - inProgress;
    const completionRate = totalReqs > 0 ? Math.round((implemented / totalReqs) * 100) : 0;
    const projectLabels = index.projects.map((p) => p.name);
    const projectReqs = index.projects.map((p) => p.reqCount);

    // 迭代/健康度数据
    const activeIterations = index.iterations.filter(i => i.status === 'active' || i.status === '进行中');
    const iterationLabels = index.iterations.map(i => i.name).slice(0, 8);
    const iterationReqCounts = index.iterations.map(i => i.reqs.length).slice(0, 8);
    const iterStats = index.iterations.map(it => {
      const iterReqs = index.reqs.filter(r => it.reqs.includes(r.id));
      const done = iterReqs.filter(r => r.status.includes('✅') || r.status.includes('已实现')).length;
      return { name: it.name, total: it.reqs.length, done, pct: it.reqs.length > 0 ? Math.round(done / it.reqs.length * 100) : 0 };
    });
    const projectHealth = index.projects.map(p => ({
      name: p.name, reqCount: p.reqCount,
      doneCount: index.reqs.filter(r => r.project === p.name && (r.status.includes('✅') || r.status.includes('已实现'))).length,
    })).map(p => ({ ...p, pct: p.reqCount > 0 ? Math.round(p.doneCount / p.reqCount * 100) : 0 })).sort((a, b) => b.pct - a.pct);

    spinner.stop('数据采集完成');

    const projectName = (index as any).projectName || (await import('path')).basename(process.cwd());

    const html = generateDashboardHtml(
      index.projects.length, totalReqs, implemented, inProgress, pending,
      completionRate, projectLabels, projectReqs,
      iterationLabels, iterationReqCounts, iterStats, projectHealth, activeIterations.length, index,
      projectName
    );

    const outPath = options.export
      ? (options.export.endsWith('.html') ? options.export : options.export + '.html')
      : join(process.cwd(), 'outputs', 'dashboard-project-' + projectName + '.html');
    await ensureDir(join(process.cwd(), 'outputs'));
    await writeFile(outPath, html);

    logger.success(`全局仪表盘已生成: ${outPath}`);
    if (!options.export) {
      logger.info('💡 在浏览器中打开查看（9 套主题可选，Chart.js 图表）');
    }
  } catch (error) {
    spinner.fail(`生成仪表盘失败: ${error}`);
  }
}
