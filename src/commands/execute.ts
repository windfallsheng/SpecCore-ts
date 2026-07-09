import { pathExists, readdir, readFile, ensureDir } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner, ProgressBar } from '../utils/logger';
import { getDefaultIteration, getDefaultAssignee, updateContext, recordHistory } from '../core/context';
import { scanTasks, topologicalSort } from '../core/state';

export interface ExecuteOptions {
  all?: boolean;
  assignee?: string;
  task?: string;
  type?: string;
  priority?: string;
  status?: string;
  platform?: string;
  backend?: boolean;
  frontend?: boolean;
  interactive?: boolean;
  dryRun?: boolean;
  resume?: boolean;
  parallel?: string;
  iteration?: string;
  force?: boolean;
}

export async function executeCommand(options: ExecuteOptions): Promise<void> {
  const spinner = new Spinner('Preparing execution');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('No active iteration found. Please specify --iteration or create one first.');
      return;
    }

    const assignee = await getDefaultAssignee(options.assignee);
    
    // Scan tasks
    let tasks = await scanTasks(iteration);
    
    if (tasks.length === 0) {
      spinner.fail('No tasks found in iteration');
      return;
    }

    // Apply filters
    if (options.task) {
      tasks = tasks.filter(t => t.id === options.task);
    }
    if (options.type) {
      tasks = tasks.filter(t => t.type === options.type);
    }
    if (options.priority) {
      tasks = tasks.filter(t => t.priority === options.priority);
    }
    if (options.status) {
      tasks = tasks.filter(t => t.status === options.status);
    }
    if (options.assignee) {
      tasks = tasks.filter(t => t.assignee === options.assignee);
    }
    if (options.backend) {
      tasks = tasks.filter(t => t.id.includes('backend'));
    }
    if (options.frontend) {
      tasks = tasks.filter(t => t.id.includes('frontend'));
    }
    if (options.platform) {
      tasks = await filterByPlatform(tasks, iteration, options.platform);
    }

    if (tasks.length === 0) {
      spinner.fail('No tasks match the specified filters');
      return;
    }

    // Sort by dependencies
    const sortedTasks = topologicalSort(tasks);

    // Preview execution plan
    if (!options.force && !options.dryRun) {
      spinner.stop('Execution preview');
      printExecutionPreview(sortedTasks, iteration);
      
      // In real implementation, this would prompt for confirmation
      logger.info('Use --force to skip preview');
      return;
    }

    if (options.dryRun) {
      spinner.stop('Dry run complete');
      printExecutionPreview(sortedTasks, iteration);
      return;
    }

    // Execute tasks
    spinner.stop('Starting execution');
    const progressBar = new ProgressBar(sortedTasks.length);
    
    for (let i = 0; i < sortedTasks.length; i++) {
      const task = sortedTasks[i];
      logger.info(`Executing ${task.id}...`);
      
      // In real implementation, this would call AI or generate code
      // For now, just simulate execution
      await simulateTaskExecution(task, iteration);
      
      progressBar.update(i + 1);
    }

    // Update context
    await updateContext({
      currentTask: sortedTasks[sortedTasks.length - 1]?.id || '',
      currentIteration: iteration,
      lastUpdated: new Date().toISOString()
    });
    await recordHistory('execute', iteration, sortedTasks[sortedTasks.length - 1]?.id);

    logger.success('Execution complete!');
  } catch (error) {
    spinner.fail(`Execution failed: ${error}`);
    throw error;
  }
}

function printExecutionPreview(tasks: any[], iteration: string): void {
  logger.info('');
  logger.info('📋 Execution Preview');
  logger.info('');
  logger.info(`Iteration: ${iteration}`);
  logger.info(`Tasks to execute: ${tasks.length}`);
  logger.info('');
  
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const status = i === 0 ? '🔄' : '⏳';
    logger.info(`${status} ${task.id} - ${task.name}`);
  }
  
  logger.info('');
  logger.info('Estimated total duration: 3-5 minutes');
}

async function simulateTaskExecution(task: any, iteration: string): Promise<void> {
  // Simulate task execution
  // In real implementation, this would:
  // 1. Read task spec files
  // 2. Call AI to generate code
  // 3. Write generated code to files
  // 4. Update task status
  
  const taskDir = join(`期次-${iteration}`, task.id);
  
  // Check if task directory exists
  if (await pathExists(taskDir)) {
    // Update task status in TASK.md
    const taskMdPath = join(taskDir, 'backend', 'TASK.md');
    if (await pathExists(taskMdPath)) {
      const content = await readFile(taskMdPath, 'utf-8');
      const updated = content.replace('状态: 🔲 待开发', '状态: 🔄 进行中');
      await require('fs-extra').writeFile(taskMdPath, updated);
    }
  }
  
  // Simulate work time
  await new Promise(resolve => setTimeout(resolve, 100));
}

/**
 * 按前端平台过滤任务：检查是否存在 frontend/{platform}/ 目录
 */
async function filterByPlatform(tasks: any[], iteration: string, platform: string): Promise<any[]> {
  const filtered: any[] = [];
  const iterDir = join(process.cwd(), `期次-${iteration}`);

  for (const task of tasks) {
    const taskPath = join(iterDir, task.id);
    const platformDir = join(taskPath, 'frontend', platform);
    if (await pathExists(platformDir)) {
      filtered.push(task);
    }
  }

  return filtered;
}
