/**
 * Usage Analytics — 使用模式分析
 * v6.96.0: 记录命令使用频率、任务完成时间，输出使用报告
 */
import { join } from 'path';
import { writeFile, readFile, pathExists, ensureDir } from 'fs-extra';
import { getCurrentUser } from './user-context';

const ANALYTICS_DIR = '.speccore/local/analytics';
const EVENT_LOG = 'events.jsonl';

export type EventType = 'command' | 'task_start' | 'task_complete' | 'task_fail' | 'iteration_create' | 'spec_generate';

export interface AnalyticsEvent {
  type: EventType;
  timestamp: string;
  user: string;
  command?: string;
  task?: string;
  iteration?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface UsageReport {
  generatedAt: string;
  user: string;
  periodDays: number;
  totalCommands: number;
  commandFrequency: Record<string, number>;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  avgTaskDurationMin: number;
  activeIterations: string[];
  recommendations: string[];
}

async function getAnalyticsPath(cwd: string): Promise<string> {
  return join(cwd, ANALYTICS_DIR, EVENT_LOG);
}

/**
 * 记录事件
 */
export async function recordEvent(cwd: string, event: Omit<AnalyticsEvent, 'timestamp' | 'user'>): Promise<void> {
  const dir = join(cwd, ANALYTICS_DIR);
  await ensureDir(dir);

  const fullEvent: AnalyticsEvent = {
    ...event,
    timestamp: new Date().toISOString(),
    user: getCurrentUser(),
  };

  const logPath = await getAnalyticsPath(cwd);
  const line = JSON.stringify(fullEvent) + '\n';
  await writeFile(logPath, line, { flag: 'a' });
}

/**
 * 记录命令执行
 */
export async function recordCommand(cwd: string, command: string, durationMs?: number): Promise<void> {
  await recordEvent(cwd, { type: 'command', command, durationMs });
}

/**
 * 加载所有事件
 */
async function loadEvents(cwd: string, maxAgeDays = 30): Promise<AnalyticsEvent[]> {
  const logPath = await getAnalyticsPath(cwd);
  if (!(await pathExists(logPath))) return [];

  const content = await readFile(logPath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  const events: AnalyticsEvent[] = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line) as AnalyticsEvent;
      if (new Date(e.timestamp).getTime() >= cutoff) {
        events.push(e);
      }
    } catch { /* 忽略损坏行 */ }
  }

  return events;
}

/**
 * 生成使用报告
 */
export async function generateUsageReport(cwd: string, periodDays = 14): Promise<UsageReport> {
  const events = await loadEvents(cwd, periodDays);

  const commands = events.filter(e => e.type === 'command');
  const commandFrequency: Record<string, number> = {};
  for (const c of commands) {
    const cmd = c.command || 'unknown';
    commandFrequency[cmd] = (commandFrequency[cmd] || 0) + 1;
  }

  const taskStarts = events.filter(e => e.type === 'task_start');
  const taskCompletes = events.filter(e => e.type === 'task_complete');
  const taskFails = events.filter(e => e.type === 'task_fail');

  // 计算平均任务耗时
  let totalDuration = 0;
  let durationCount = 0;
  for (const tc of taskCompletes) {
    if (tc.durationMs && tc.durationMs > 0) {
      totalDuration += tc.durationMs;
      durationCount++;
    }
  }
  const avgTaskDurationMin = durationCount > 0
    ? Math.round((totalDuration / durationCount / 60000) * 10) / 10
    : 0;

  const activeIterations = [...new Set(events.map(e => e.iteration).filter(Boolean))] as string[];

  // 生成推荐
  const recommendations: string[] = [];

  if (taskCompletes.length === 0 && taskStarts.length > 0) {
    recommendations.push('有进行中的任务但未记录完成，建议检查任务状态追踪');
  }

  if (!commandFrequency['code-index'] && !commandFrequency['ci']) {
    recommendations.push('建议运行 speccore code-index --graph 构建代码知识图谱');
  }

  if ((commandFrequency['execute'] || 0) > 10 && (commandFrequency['doctor'] || 0) === 0) {
    recommendations.push('执行频率较高，建议定期运行 speccore doctor 检查项目健康度');
  }

  if (taskFails.length > taskCompletes.length * 0.3) {
    recommendations.push('任务失败率较高，建议运行 speccore analyze 重新评估需求');
  }

  if (activeIterations.length > 3) {
    recommendations.push('活跃迭代较多，建议归档已完成的迭代');
  }

  if (recommendations.length === 0) {
    recommendations.push('使用模式健康，继续保持！');
  }

  return {
    generatedAt: new Date().toISOString(),
    user: getCurrentUser(),
    periodDays,
    totalCommands: commands.length,
    commandFrequency,
    totalTasks: taskStarts.length,
    completedTasks: taskCompletes.length,
    failedTasks: taskFails.length,
    avgTaskDurationMin,
    activeIterations,
    recommendations,
  };
}

/**
 * 格式化报告为可读文本
 */
export function formatUsageReport(report: UsageReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`📊 使用模式报告（近 ${report.periodDays} 天）`);
  lines.push('');
  lines.push(`操作者: ${report.user}`);
  lines.push(`总命令数: ${report.totalCommands}`);
  lines.push(`任务完成: ${report.completedTasks} / ${report.totalTasks}（失败 ${report.failedTasks}）`);
  if (report.avgTaskDurationMin > 0) {
    lines.push(`平均任务耗时: ${report.avgTaskDurationMin} 分钟`);
  }
  lines.push('');

  const topCommands = Object.entries(report.commandFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  if (topCommands.length > 0) {
    lines.push('🔥 高频命令:');
    for (const [cmd, count] of topCommands) {
      lines.push(`   ${cmd}: ${count} 次`);
    }
    lines.push('');
  }

  if (report.activeIterations.length > 0) {
    lines.push('📁 活跃迭代:');
    for (const iter of report.activeIterations) {
      lines.push(`   ${iter}`);
    }
    lines.push('');
  }

  lines.push('💡 智能推荐:');
  for (const rec of report.recommendations) {
    lines.push(`   • ${rec}`);
  }
  lines.push('');

  return lines.join('\n');
}
