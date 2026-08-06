import { join } from 'path';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { readProjectGraph, topologicalSort, scanTasks, TaskState } from '../core/state';
import { FileTransaction } from '../core/transaction';
import { savePlan, listPlans, getPlan, deletePlan, cancelPlan, ExecutionPlan } from '../core/plan-store';
import { createInterface } from 'readline';

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
}

export async function planCommand(options: PlanOptions): Promise<void> {
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
    const planPath = join(`Iteration-${iteration}`, '00-迭代总览', 'PLAN.md');
    const tx = new FileTransaction();
    tx.write(planPath, formatPlanMarkdown(plan, iteration));
    await tx.commit();

    spinner.stop(`Saved: ${saved.id.slice(0, 12)} | ${taskIds.length} tasks, ${plan.length} phases`);
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
  const plans = await listPlans(undefined, 20);
  if (plans.length === 0) { logger.info('No plans yet.'); return; }

  logger.info(`\nPlans (${plans.length}):\n`);
  for (const p of plans) {
    const src = { manual: 'manual', auto: 'auto', schedule: 'sched' }[p.source];
    const icon = p.status === 'completed' ? '✅' : p.status === 'cancelled' ? '🚫' : '⏳';
    logger.info(`  ${icon} ${p.id.slice(0, 12)}  ${p.name}  [${src}]`);
    logger.info(`     iter: ${p.iteration}  tasks: ${p.tasks.length}  batch: ${p.batchSize}  status: ${p.status}`);
    logger.info(`     created: ${new Date(p.createdAt).toLocaleString()}`);
    if (p.executedAt) logger.info(`     done: ${new Date(p.executedAt).toLocaleString()}`);
    logger.info('');
  }
  logger.info('speccore plan --show <id>  |  --cancel <id>  |  --delete <id>');
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

// Helpers
interface PlanEntry { phase: number; tasks: string[]; assignees: string[]; estimatedDuration: number; }

function generatePlan(tasks: TaskState[], teamSize: number, mode: string): PlanEntry[] {
  if (mode === 'claim') return [{ phase: 1, tasks: tasks.map(t => t.id), assignees: [], estimatedDuration: tasks.length * 2 }];
  const phases: PlanEntry[] = [];
  const pc = Math.min(teamSize, tasks.length);
  for (let i = 0; i < tasks.length; i += pc) {
    phases.push({ phase: phases.length + 1, tasks: tasks.slice(i, i + pc).map(t => t.id), assignees: tasks.slice(i, i + pc).map(t => t.assignee || 'TBD'), estimatedDuration: 2 });
  }
  return phases;
}

function printPlan(plan: PlanEntry[], iteration: string): void {
  logger.info(`\nPlan: ${iteration}\n`);
  for (const phase of plan) {
    logger.info(`Phase ${phase.phase}:`);
    for (let i = 0; i < phase.tasks.length; i++) logger.info(`  ${phase.tasks[i]} -> ${phase.assignees[i] || 'TBD'}`);
    logger.info('');
  }
}

function formatPlanMarkdown(plan: PlanEntry[], iteration: string): string {
  const lines = [`# Plan - ${iteration}`, '', `> ${new Date().toISOString()}`, ''];
  for (const phase of plan) {
    lines.push(`## Phase ${phase.phase}`, '', '| Task | Assignee | Est. |', '| :--- | :--- | :--- |');
    for (let i = 0; i < phase.tasks.length; i++) lines.push(`| ${phase.tasks[i]} | ${phase.assignees[i] || 'TBD'} | 2h |`);
    lines.push('');
  }
  return lines.join('\n');
}
