import { join } from 'path';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, detectCurrentAssignee } from '../core/context';
import { readProjectGraph, topologicalSort, scanTasks, TaskState } from '../core/state';
import { FileTransaction } from '../core/transaction';
import { savePlan, listPlans, getPlan, deletePlan, ExecutionPlan } from '../core/plan-store';
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
  task?: string;
  type?: string;
  priority?: string;
  mode?: string;
  dryRun?: boolean;
  interactive?: boolean;
  // 历史查看
  list?: boolean;
  show?: string;
  delete?: string;
}

export async function planCommand(options: PlanOptions): Promise<void> {
  // ── 历史模式 ──
  if (options.list) {
    await showPlanHistory();
    return;
  }
  if (options.show) {
    await showPlanDetail(options.show);
    return;
  }
  if (options.delete) {
    await removePlan(options.delete);
    return;
  }

  // ── 创建模式 ──
  const spinner = new Spinner('Generating execution plan');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('No active iteration found.');
      return;
    }

    const graph = await readProjectGraph(iteration);
    const tasks = graph.tasks.length > 0 ? graph.tasks : await scanTasks(iteration);
    if (tasks.length === 0) { spinner.fail('No tasks found'); return; }

    let filteredTasks = tasks;
    if (options.type) filteredTasks = filteredTasks.filter(t => t.type === options.type);
    if (options.priority) filteredTasks = filteredTasks.filter(t => t.priority === options.priority);
    if (options.task) filteredTasks = filteredTasks.filter(t => t.id === options.task);

    const sortedTasks = topologicalSort(filteredTasks);
    const plan = generatePlan(sortedTasks, parseInt(options.team || '1', 10), options.mode || 'auto');

    if (options.dryRun) {
      spinner.stop('Dry run');
      printPlan(plan, iteration);
      return;
    }

    const taskIds = sortedTasks.map(t => t.id);

    // ── Interactive mode ──
    if (options.interactive) {
      spinner.stop('执行计划预览');
      logger.info('');
      printPlan(plan, iteration);
      logger.info(`\n共 ${taskIds.length} 个任务，${plan.length} 个阶段`);
      logger.info('💡 [y] 确认  [a] 调整后保存  [q] 取消');

      const answer = await promptUser('\n确认？');
      if (answer === 'q') { logger.info('已取消'); return; }
      if (answer === 'a') {
        const batchStr = await promptUser('每批数量 (默认3): ');
        logger.info('已调整，重新运行 speccore plan --interactive 或直接确认');
        if (batchStr) await saveToStore(iteration, taskIds, parseInt(batchStr, 10), options, 'manual');
      }
    }

    // 保存到 plan-store
    await saveToStore(iteration, taskIds, 3, options, 'manual');

    // 保存到文件
    const planPath = join(`期次-${iteration}`, '00-期次总览', 'PLAN.md');
    const tx = new FileTransaction();
    tx.write(planPath, formatPlanMarkdown(plan, iteration));
    await tx.commit();

    spinner.stop(`✅ 已保存: ${taskIds.length} 个任务, ${plan.length} 阶段`);
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
    name: `Plan-${iteration}-${new Date().toISOString().slice(0, 10)}`,
    iteration,
    tasks: taskIds,
    batchSize,
    source,
    filters: {
      assignee: options.assign,
      type: options.type,
      priority: options.priority,
    },
  });
}

// ── 历史查看 ──
async function showPlanHistory(): Promise<void> {
  const plans = await listPlans(undefined, 20);
  if (plans.length === 0) { logger.info('暂无计划'); return; }

  logger.info(`\n📋 共 ${plans.length} 个计划:\n`);
  for (const p of plans) {
    const src = { manual: '🙋 手动', auto: '🤖 自动', schedule: '⏰ 调度' }[p.source];
    const done = p.executedAt ? '✅' : '⏳';
    logger.info(`  ${done} ${p.id.slice(0, 12)}  ${p.name}  [${src}]`);
    logger.info(`     期次: ${p.iteration}  任务: ${p.tasks.length}  分批: ${p.batchSize}`);
    logger.info(`     创建: ${new Date(p.createdAt).toLocaleString()}`);
    if (p.executedAt) logger.info(`     执行: ${new Date(p.executedAt).toLocaleString()} → ${p.result || '完成'}`);
    logger.info('');
  }
  logger.info('���� speccore plan --show <id> 查看详情');
}

async function showPlanDetail(id: string): Promise<void> {
  const p = await getPlan(id);
  if (!p) { logger.error('未找到计划'); return; }

  logger.info(`\n📋 ${p.name}`);
  logger.info(`   ID:      ${p.id}`);
  logger.info(`   来源:    ${p.source === 'manual' ? '手动' : p.source === 'auto' ? '自动' : '调度'}`);
  logger.info(`   期次:    ${p.iteration}`);
  logger.info(`   分批:    ${p.batchSize} 个/批`);
  logger.info(`   创建:    ${new Date(p.createdAt).toLocaleString()}`);
  if (p.executedAt) logger.info(`   执行:    ${new Date(p.executedAt).toLocaleString()}`);
  logger.info(`\n   任务列表 (${p.tasks.length}):`);
  for (let i = 0; i < p.tasks.length; i += p.batchSize) {
    const batch = p.tasks.slice(i, i + p.batchSize);
    logger.info(`   第${Math.floor(i / p.batchSize) + 1}批: ${batch.join(', ')}`);
  }
  if (Object.values(p.filters).some(Boolean)) {
    logger.info(`\n   筛选: ${JSON.stringify(p.filters)}`);
  }
  logger.info('');
}

async function removePlan(id: string): Promise<void> {
  const ok = await deletePlan(id);
  logger.info(ok ? '✅ 已删除' : '❌ 未找到');
}

// ── Helpers (unchanged) ──
interface PlanEntry { phase: number; tasks: string[]; assignees: string[]; estimatedDuration: number; }

function generatePlan(tasks: TaskState[], teamSize: number, mode: string): PlanEntry[] {
  if (mode === 'claim') {
    return [{ phase: 1, tasks: tasks.map(t => t.id), assignees: [], estimatedDuration: tasks.length * 2 }];
  }
  const phases: PlanEntry[] = [];
  const pc = Math.min(teamSize, tasks.length);
  for (let i = 0; i < tasks.length; i += pc) {
    const pts = tasks.slice(i, i + pc);
    phases.push({ phase: phases.length + 1, tasks: pts.map(t => t.id), assignees: pts.map(t => t.assignee || 'TBD'), estimatedDuration: 2 });
  }
  return phases;
}

function printPlan(plan: PlanEntry[], iteration: string): void {
  logger.info(`\n执行计划: ${iteration}\n`);
  for (const phase of plan) {
    logger.info(`阶段 ${phase.phase}:`);
    for (let i = 0; i < phase.tasks.length; i++) logger.info(`  ${phase.tasks[i]} -> ${phase.assignees[i] || 'TBD'}`);
    logger.info(`  预计: ${phase.estimatedDuration}h\n`);
  }
}

function formatPlanMarkdown(plan: PlanEntry[], iteration: string): string {
  const lines = [`# 执行计划 - ${iteration}`, '', `> 生成时间: ${new Date().toISOString()}`, ''];
  for (const phase of plan) {
    lines.push(`## 阶段 ${phase.phase}`, '', '| 任务 | 负责人 | 预计耗时 |', '| :--- | :--- | :--- |');
    for (let i = 0; i < phase.tasks.length; i++) lines.push(`| ${phase.tasks[i]} | ${phase.assignees[i] || 'TBD'} | 2h |`);
    lines.push('');
  }
  return lines.join('\n');
}
