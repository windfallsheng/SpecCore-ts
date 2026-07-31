import { join } from 'path';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, detectCurrentAssignee } from '../core/context';
import { readProjectGraph, topologicalSort, scanTasks, TaskState } from '../core/state';
import { FileTransaction } from '../core/transaction';
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
}

export async function planCommand(options: PlanOptions): Promise<void> {
  const spinner = new Spinner('Generating execution plan');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('No active iteration found. Please specify --iteration or create one first.');
      return;
    }

    // Read project graph
    const graph = await readProjectGraph(iteration);
    const tasks = graph.tasks.length > 0 ? graph.tasks : await scanTasks(iteration);

    if (tasks.length === 0) {
      spinner.fail('No tasks found in iteration');
      return;
    }

    // Apply filters
    let filteredTasks = tasks;
    if (options.type) {
      filteredTasks = filteredTasks.filter(t => t.type === options.type);
    }
    if (options.priority) {
      filteredTasks = filteredTasks.filter(t => t.priority === options.priority);
    }
    if (options.task) {
      filteredTasks = filteredTasks.filter(t => t.id === options.task);
    }

    // Sort by dependencies
    const sortedTasks = topologicalSort(filteredTasks);

    // Calculate team assignments
    const teamSize = parseInt(options.team || '3', 10);
    const assignees = options.assign ? options.assign.split(',') : [];
    
    if (assignees.length > 0) {
      // Assign tasks to specified members
      let index = 0;
      for (const task of sortedTasks) {
        task.assignee = assignees[index % assignees.length].trim();
        index++;
      }
    }

    // Generate plan
    const plan = generatePlan(sortedTasks, teamSize, options.mode || 'auto');

    if (options.dryRun) {
      spinner.stop('Dry run complete');
      printPlan(plan, iteration);
      return;
    }

    // ── Interactive mode: preview → confirm → save ──
    if (options.interactive) {
      spinner.stop('执行计划预览');
      logger.info('');
      printPlan(plan, iteration);
      logger.info('');
      logger.info('💡 [y] 确认保存  [n] 调整后再确认  [q] 取消');
      const answer = await promptUser('确认保存？');
      if (answer?.toLowerCase() === 'q') {
        logger.info('已取消');
        return;
      }
      if (answer?.toLowerCase() === 'n') {
        logger.info('请手动调整 PROJECT_GRAPH.md 后重新运行 speccore plan --interactive');
        return;
      }
    }

    // Save plan to file with transaction
    const planPath = join(`期次-${iteration}`, '00-期次总览', 'PLAN.md');
    const tx = new FileTransaction();
    tx.write(planPath, formatPlanMarkdown(plan, iteration));
    await tx.commit();

    spinner.stop(`Execution plan generated: ${planPath} (事务保护)`);
    printPlan(plan, iteration);
  } catch (error) {
    spinner.fail(`Plan generation failed: ${error}`);
    throw error;
  }
}

interface PlanEntry {
  phase: number;
  tasks: string[];
  assignees: string[];
  estimatedDuration: number;
}

function generatePlan(tasks: TaskState[], teamSize: number, mode: string): PlanEntry[] {
  const phases: PlanEntry[] = [];
  
  if (mode === 'claim') {
    // Generate claimable list
    return [{
      phase: 1,
      tasks: tasks.map(t => t.id),
      assignees: [],
      estimatedDuration: tasks.length * 2
    }];
  }

  // Simple parallel scheduling
  const parallelCount = Math.min(teamSize, tasks.length);
  let currentPhase = 1;
  let index = 0;

  while (index < tasks.length) {
    const phaseTasks = tasks.slice(index, index + parallelCount);
    phases.push({
      phase: currentPhase,
      tasks: phaseTasks.map(t => t.id),
      assignees: phaseTasks.map(t => t.assignee || 'TBD'),
      estimatedDuration: 2
    });
    index += parallelCount;
    currentPhase++;
  }

  return phases;
}

function printPlan(plan: PlanEntry[], iteration: string): void {
  logger.info('');
  logger.info(`Execution Plan for: ${iteration}`);
  logger.info('');

  for (const phase of plan) {
    logger.info(`Phase ${phase.phase}:`);
    for (let i = 0; i < phase.tasks.length; i++) {
      logger.info(`  ${phase.tasks[i]} -> ${phase.assignees[i] || 'TBD'}`);
    }
    logger.info(`  Estimated: ${phase.estimatedDuration}h`);
    logger.info('');
  }
}

function formatPlanMarkdown(plan: PlanEntry[], iteration: string): string {
  const lines: string[] = [];
  lines.push(`# 执行计划 - ${iteration}`);
  lines.push('');
  lines.push(`> 生成时间: ${new Date().toISOString()}`);
  lines.push('');

  for (const phase of plan) {
    lines.push(`## 阶段 ${phase.phase}`);
    lines.push('');
    lines.push('| 任务 | 负责人 | 预计耗时 |');
    lines.push('| :--- | :--- | :--- |');
    for (let i = 0; i < phase.tasks.length; i++) {
      lines.push(`| ${phase.tasks[i]} | ${phase.assignees[i] || 'TBD'} | 2h |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
