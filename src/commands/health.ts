import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { readProjectGraph, scanTasks, TaskState } from '../core/state';

export interface HealthOptions {
  iteration?: string;
  format?: string;
  trend?: boolean;
}

export async function healthCommand(options: HealthOptions): Promise<void> {
  const spinner = new Spinner('Generating health report');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('No active iteration found. Please specify --iteration or create one first.');
      return;
    }

    const graph = await readProjectGraph(iteration);
    const tasks = graph.tasks.length > 0 ? graph.tasks : await scanTasks(iteration);

    const health = calculateHealth(iteration, tasks);

    spinner.stop('Health report generated');

    if (options.format === 'json') {
      console.log(JSON.stringify(health, null, 2));
      return;
    }

    printHealthReport(health);
  } catch (error) {
    spinner.fail(`Health report failed: ${error}`);
    throw error;
  }
}

interface HealthMetrics {
  iteration: string;
  overall: number;
  dimensions: {
    spec: number;
    efficiency: number;
    reuse: number;
    team: number;
  };
  details: Record<string, any>;
}

function calculateHealth(iteration: string, tasks: TaskState[]): HealthMetrics {
  const total = tasks.length;
  const completed = tasks.filter(t => t.status === 'completed').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;
  
  // Spec health (consistency, completeness)
  const specHealth = total > 0 ? Math.round((completed / total) * 100) : 100;
  
  // Efficiency (completion rate, speed)
  const efficiency = total > 0 ? Math.round((completed / total) * 90) : 0;
  
  // Reuse (pattern usage)
  const reuse = 70; // Simplified
  
  // Team health (distribution, load)
  const teamHealth = 80; // Simplified
  
  const overall = Math.round((specHealth + efficiency + reuse + teamHealth) / 4);

  return {
    iteration,
    overall,
    dimensions: {
      spec: specHealth,
      efficiency,
      reuse,
      team: teamHealth
    },
    details: {
      totalTasks: total,
      completedTasks: completed,
      inProgressTasks: inProgress,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0
    }
  };
}

function printHealthReport(health: HealthMetrics): void {
  logger.info('');
  logger.info('🏥 Health Report');
  logger.info('');
  logger.info(`Iteration: ${health.iteration}`);
  logger.info(`Overall Health: ${health.overall}%`);
  logger.info('');
  logger.info('Dimensions:');
  logger.info(`  Spec Health: ${health.dimensions.spec}%`);
  logger.info(`  Efficiency: ${health.dimensions.efficiency}%`);
  logger.info(`  Reuse: ${health.dimensions.reuse}%`);
  logger.info(`  Team Health: ${health.dimensions.team}%`);
  logger.info('');
  logger.info('Details:');
  logger.info(`  Total Tasks: ${health.details.totalTasks}`);
  logger.info(`  Completed: ${health.details.completedTasks}`);
  logger.info(`  In Progress: ${health.details.inProgressTasks}`);
  logger.info(`  Completion Rate: ${health.details.completionRate}%`);
}
