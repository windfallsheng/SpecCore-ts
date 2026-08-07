import { join } from 'path';
import { writeFile, ensureDir, readdir, stat } from 'fs-extra';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { readProjectGraph, topologicalSort, scanTasks, TaskState } from '../core/state';
import { FileTransaction } from '../core/transaction';
import { savePlan, listPlans, getPlan, deletePlan, cancelPlan, ExecutionPlan } from '../core/plan-store';
import { createInterface } from 'readline';
import { buildPrompt, formatPrompt } from '../core/prompt-builder';

function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${question} `, answer => { rl.close(); resolve(answer.trim()); });
  });
}

export interface PlanOptions {
  iteration?: string;
  team?: string;
  assign?: string;
  type?: string;
  priority?: string;
  mode?: string;
  dryRun?: boolean;
  interactive?: boolean;
  list?: boolean;
  show?: string;
  delete?: string;
  cancel?: string;
  prompt?: boolean;    // --prompt
  response?: string;   // --response: 接收 AI 计划写入 plan.json
}

export async function planCommand(options: PlanOptions): Promise<void> {
  // ── Prompt 模式 ──
  if (options.prompt) {
    const iter = options.iteration || await getDefaultIteration();
    const prompt = await buildPrompt('plan', { iteration: iter });
    process.stdout.write(formatPrompt(prompt));
    process.exitCode = 10;
    return;
  }

  // ── Response 模式 ──
  if (options.response) {
    if (!options.iteration) { logger.error('--response 需要 --iteration'); return; }
    const planDir = join('Iteration-' + options.iteration, '.speccore');
    await ensureDir(planDir);
    await writeFile(join(planDir, 'plan.json'), options.response);
    logger.success('✅ plan.json 已写入');
    return;
  }
  if (options.list) { await showPlanHistory(); return; }
  if (options.show) { await showPlanDetail(options.show); return; }
  if (options.delete) { await removePlan(options.delete); return; }
  if (options.cancel) { await doCancelPlan(options.cancel); return; }

  const spinner = new Spinner('Generating execution plan');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) { spinner.fail('No active iteration found.'); return; }

    const graph = await readProjectGraph(iteration);
    const tasks = graph.tasks.length > 0 ? graph.tasks : await scanTasks(iteration);
    if (tasks.length === 0) { spinner.fail('No tasks found'); return; }

    let filteredTasks = tasks;
    if (options.type) filteredTasks = filteredTasks.filter(t => t.type === options.type);
    if (options.priority) filteredTasks = filteredTasks.filter(t => t.priority === options.priority);

    const sortedTasks = topologicalSort(filteredTasks);
    const plan = generatePlan(sortedTasks, parseInt(options.team || '1', 10), options.mode || 'auto');
    const taskIds = sortedTasks.map(t => t.id);

    if (options.dryRun) { spinner.stop('Dry run'); printPlan(plan, iteration); return; }

    if (options.interactive) {
      spinner.stop('执行计划预览');
      logger.info('');
      printPlan(plan, iteration);
      logger.info(`共 ${taskIds.length} 个任务，${plan.length} 个阶段`);
      const answer = await promptUser('\n[y] 确认保存  [q] 取消: ');
      if (answer !== 'y') { logger.info('已取消'); return; }
    }

    const saved = await saveToStore(iteration, taskIds, 3, options, 'manual');

    // 写入带时间戳的计划文件（多版本） + 最新的 PLAN.md
    const planDir = join(`Iteration-${iteration}`, '000-overview');
    const ts = new Date().toISOString().replace(/T/, '-').replace(/:/g, '').slice(0, 17); // 2026-08-07-2125
    const versionedPath = join(planDir, `PLAN-${ts}.md`);
    const latestPath = join(planDir, 'PLAN.md');
    const tx = new FileTransaction();
    tx.write(versionedPath, formatPlanMarkdown(plan, iteration));
    tx.write(latestPath, formatPlanMarkdown(plan, iteration)); // 最新版覆盖
    await tx.commit();

    spinner.stop(`Saved: PLAN-${ts}.md | ${taskIds.length} tasks, ${plan.length} phases`);
    printPlan(plan, iteration);
  } catch (error) {
    spinner.fail(`Failed: ${error}`);
    throw error;
  }
}

async function saveToStore(
  iteration: string, taskIds: string[], batchSize: number,
  options: PlanOptions, source: ExecutionPlan['source']
): Promise<ExecutionPlan> {
  return savePlan({
    name: `Plan-${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    iteration, tasks: taskIds, batchSize, source,
    filters: { assignee: options.assign, type: options.type, priority: options.priority },
  });
}

async function showPlanHistory(): Promise<void> {
  // 1. 从磁盘读取所有 PLAN-*.md 文件，按时间倒序
  const plans: { file: string; time: Date; size: number }[] = [];
  try {
    const iter = await getDefaultIteration();
    if (iter) {
      const planDir = join(`Iteration-${iter}`, '000-overview');
      const files = await readdir(planDir);
      for (const f of files) {
        const m = f.match(/^PLAN-(\d{4}-\d{2}-\d{2}-\d{4})\.md$/);
        if (m) {
          const st = await stat(join(planDir, f));
          plans.push({ file: f, time: st.mtime, size: st.size });
        }
      }
      // 按时间倒序：最新的在最前面
      plans.sort((a, b) => b.time.getTime() - a.time.getTime());
    }
  } catch {}

  // 2. 从 store 读取
  const storePlans = await listPlans(undefined, 20);

  if (plans.length === 0 && storePlans.length === 0) { logger.info('No plan files yet.'); return; }

  // 展示磁盘文件（倒序）
  if (plans.length > 0) {
    const iter = await getDefaultIteration();
    logger.info(`\n📋 计划文件 · Iteration-${iter}/000-overview/ (${plans.length}):\n`);
    for (const p of plans) {
      const isLatest = p.file === 'PLAN.md' ? ' 📌 最新' : '';
      logger.info(`  📄 ${p.file}  ${formatFileSize(p.size)}  ${p.time.toLocaleString()}${isLatest}`);
    }
    logger.info(`\n  💡 PLAN.md = 最新版本（可直接打开）`);
    logger.info(`  ⚙️  历史版本按时间倒序排列\n`);
  }

  // 展示 store 记录
  if (storePlans.length > 0) {
    logger.info(`📊 执行记录 (${storePlans.length}):\n`);
    for (const p of storePlans) {
      const src = { manual: 'manual', auto: 'auto', schedule: 'sched' }[p.source];
      const icon = p.status === 'completed' ? '✅' : p.status === 'cancelled' ? '🚫' : '⏳';
      logger.info(`  ${icon} ${p.id.slice(0, 12)}  [${src}]  ${p.status}`);
    }
  }

  logger.info('\nspeccore plan --show <id>  |  --cancel <id>  |  --delete <id>');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function showPlanDetail(id: string): Promise<void> {
  const p = await getPlan(id);
  if (!p) { logger.error('Not found'); return; }

  logger.info(`\n${p.name}`);
  logger.info(`  ID:       ${p.id}`);
  logger.info(`  Source:   ${p.source}  |  Status: ${p.status}`);
  logger.info(`  Iter:     ${p.iteration}  |  Batch: ${p.batchSize}`);
  logger.info(`  Created:  ${new Date(p.createdAt).toLocaleString()}`);
  if (p.executedAt) logger.info(`  Done:     ${new Date(p.executedAt).toLocaleString()}`);
  logger.info(`\n  Tasks (${p.tasks.length}):`);
  for (let i = 0; i < p.tasks.length; i += p.batchSize) {
    logger.info(`    batch ${Math.floor(i / p.batchSize) + 1}: ${p.tasks.slice(i, i + p.batchSize).join(', ')}`);
  }
  logger.info('');
}

async function removePlan(id: string): Promise<void> {
  const ok = await deletePlan(id);
  logger.info(ok ? 'Deleted.' : 'Not found.');
}

async function doCancelPlan(id: string): Promise<void> {
  const ok = await cancelPlan(id);
  logger.info(ok ? 'Cancelled (status retained).' : 'Not found.');
}

// ── Helpers ──
interface TaskPlan {
  id: string; name: string; type: string; priority: string;
  branch: string; dependencies: string[]; status: string;
  assignee: string; progress: number; estimatedHours: number;
}
interface PlanEntry { phase: number; tasks: TaskPlan[]; }

function generatePlan(tasks: TaskState[], teamSize: number, mode: string): PlanEntry[] {
  if (mode === 'claim') {
    return [{ phase: 1, tasks: tasks.map(t => buildTaskPlan(t)) }];
  }
  const phases: PlanEntry[] = [];
  const pc = Math.min(teamSize || 3, tasks.length);
  for (let i = 0; i < tasks.length; i += pc) {
    phases.push({
      phase: phases.length + 1,
      tasks: tasks.slice(i, i + pc).map(t => buildTaskPlan(t)),
    });
  }
  return phases;
}

function buildTaskPlan(t: TaskState): TaskPlan {
  return {
    id: t.id,
    name: t.name,
    type: t.type || 'feature',
    priority: t.priority || 'medium',
    branch: `feature/${t.id}-${sanitizeBranchName(t.name)}`,
    dependencies: t.dependencies || [],
    status: t.status || 'pending',
    assignee: t.assignee || 'TBD',
    progress: t.progress || 0,
    estimatedHours: t.type === 'bugfix' ? 1 : 2,
  };
}

function sanitizeBranchName(name: string): string {
  return name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

function printPlan(plan: PlanEntry[], iteration: string): void {
  const allTasks = plan.flatMap(p => p.tasks);
  logger.info(`\n📋 Plan: ${iteration}  (${allTasks.length} tasks, ${plan.length} phases)\n`);
  for (const phase of plan) {
    logger.info(`Phase ${phase.phase}:`);
    for (const t of phase.tasks) {
      const st = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⏳';
      logger.info(`  ${st} ${t.id}  ${t.name}  [${t.type}] → ${t.branch}`);
    }
    logger.info('');
  }
}

function formatPlanMarkdown(plan: PlanEntry[], iteration: string): string {
  const allTasks = plan.flatMap(p => p.tasks);
  const totalHours = allTasks.reduce((s, t) => s + t.estimatedHours, 0);
  const ts = new Date().toISOString();

  const lines: string[] = [];
  lines.push(`# 📋 Plan — ${iteration}`);
  lines.push('');
  lines.push(`> **生成时间**: ${ts}`);
  lines.push(`> **状态**: ⏳ active`);
  lines.push(`> **任务数**: ${allTasks.length}  ·  **阶段数**: ${plan.length}  ·  **预估**: ${totalHours}h`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── 执行步骤 ──
  lines.push('## 🗂️ 执行步骤');
  lines.push('');
  for (const phase of plan) {
    lines.push(`### Phase ${phase.phase}`);
    lines.push('');
    lines.push('| # | Task | Type | Priority | Branch | Deps | Assignee | Est. | Status |');
    lines.push('|:-:|:---|:---|:---|:---|:---|:---|:---:|:---|');
    for (const t of phase.tasks) {
      const st = t.status === 'completed' ? '✅ done' : t.status === 'in_progress' ? '🔄 running' : '⏳ pending';
      const deps = t.dependencies.length > 0 ? t.dependencies.join(', ') : '—';
      const prio = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🟢';
      lines.push(`| ${phase.phase} | ${t.id} | ${t.type} | ${prio} | \`${t.branch}\` | ${deps} | ${t.assignee} | ${t.estimatedHours}h | ${st} |`);
    }
    lines.push('');
  }

  // ── 任务详情 ──
  lines.push('---');
  lines.push('');
  lines.push('## 📝 任务详情');
  lines.push('');
  for (const t of allTasks) {
    lines.push(`### ${t.id}: ${t.name}`);
    lines.push('');
    lines.push('| 属性 | 值 |');
    lines.push('|:---|:---|');
    lines.push(`| 类型 | ${t.type} |`);
    lines.push(`| 优先级 | ${t.priority} |`);
    lines.push(`| 分支 | \`${t.branch}\` |`);
    lines.push(`| 状态 | ${t.status} |`);
    lines.push(`| 进度 | ${t.progress}% |`);
    lines.push(`| 负责人 | ${t.assignee} |`);
    lines.push(`| 预估 | ${t.estimatedHours}h |`);
    lines.push(`| 依赖 | ${t.dependencies.length > 0 ? t.dependencies.join(', ') : '无'} |`);
    lines.push('');
  }

  // ── 依赖拓扑 ──
  const hasDeps = allTasks.some(t => t.dependencies.length > 0);
  if (hasDeps) {
    lines.push('---');
    lines.push('');
    lines.push('## 🔗 依赖关系');
    lines.push('');
    lines.push('```');
    for (const t of allTasks) {
      if (t.dependencies.length > 0) {
        for (const d of t.dependencies) {
          lines.push(`  ${d} ──▶ ${t.id}`);
        }
      } else {
        lines.push(`  ${t.id} (无依赖)`);
      }
    }
    lines.push('```');
    lines.push('');
  }

  // ── 执行记录 ──
  lines.push('---');
  lines.push('');
  lines.push('## 📊 执行记录');
  lines.push('');
  lines.push('| 时间 | 事件 | 详情 |');
  lines.push('|:---|:---|:---|');
  lines.push(`| ${new Date().toLocaleString()} | 📋 计划生成 | ${allTasks.length} tasks, ${plan.length} phases |`);
  lines.push('');
  lines.push('> 后续执行记录将追加到此处。');
  lines.push('');

  return lines.join('\n');
}
