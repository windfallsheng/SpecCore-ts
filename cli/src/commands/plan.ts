import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { FileTransaction } from '../core/transaction';

/** 任务调度项 */
interface PlanTask {
  id: string;
  assignee: string;
  estimatedHours: number;
  dependencies: string[];
}

/** 调度结果 */
export interface PlanResult {
  success: boolean;
  schedule: PlanTask[];
  ganttChart: string;
  errors: string[];
}

/**
 * 智能调度命令 — 为期次的 Task 生成执行方案。
 *
 * 调度策略：
 * 1. 读取所有 Task 的依赖关系
 * 2. 拓扑排序确定执行顺序
 * 3. 按执行人分配任务
 * 4. 生成 Gantt 文本图
 * 5. 写入 PROJECT_GRAPH.md（调度计划章节）
 * 6. 使用事务保护
 */
export async function planCommand(options: {
  projectRoot: string;
  iteration: string;
  teamSize?: number;
  dryRun?: boolean;
}): Promise<PlanResult> {
  const { projectRoot, iteration, dryRun = false } = options;
  const errors: string[] = [];
  const schedule: PlanTask[] = [];

  const iterDir = join(projectRoot, iteration);
  if (!existsSync(iterDir)) {
    return { success: false, schedule, ganttChart: '', errors: [`期次不存在: ${iteration}`] };
  }

  const { readdirSync } = require('fs');
  const tasks = readdirSync(iterDir)
    .filter((f: string) => f.startsWith('Task-'))
    .sort();

  if (tasks.length === 0) {
    return { success: true, schedule, ganttChart: '# 暂无 Task\n', errors: [] };
  }

  // 读取每个 Task 的元数据
  const taskMeta: Record<string, { name: string; deps: string[] }> = {};
  for (const t of tasks) {
    const taskMdPath = join(iterDir, t, 'backend', 'TASK.md');
    if (!existsSync(taskMdPath)) continue;

    const content = readFileSync(taskMdPath, 'utf-8');
    const nameMatch = content.match(/#\s*(.+)/);
    const depMatch = content.match(/依赖[：:]\s*(.+)/);
    const deps = depMatch
      ? depMatch[1].split(/[,，\s]+/).filter((d: string) => d.startsWith('Task-'))
      : [];

    taskMeta[t] = { name: nameMatch ? nameMatch[1].trim() : t, deps };
  }

  // 拓扑排序（Kahn's algorithm）
  const inDegree: Record<string, number> = {};
  const graph: Record<string, string[]> = {};
  for (const t of Object.keys(taskMeta)) {
    inDegree[t] = taskMeta[t].deps.length;
    for (const dep of taskMeta[t].deps) {
      if (!graph[dep]) graph[dep] = [];
      graph[dep].push(t);
    }
  }

  const queue = Object.keys(inDegree).filter(k => inDegree[k] === 0).sort();
  const order: typeof queue = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const neighbor of (graph[node] || [])) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) queue.push(neighbor);
    }
  }

  // 生成调度方案
  const teamSize = options.teamSize || 3;
  const assignees = Array.from({ length: teamSize }, (_, i) => `成员${i + 1}`);
  let hourAccumulators = assignees.map(() => 0);

  for (let i = 0; i < order.length; i++) {
    const taskName = order[i];
    const idx = i % teamSize;
    const hours = 4 + (i % 3) * 2; // 4/6/8 hours varied
    schedule.push({
      id: taskName,
      assignee: assignees[idx],
      estimatedHours: hours,
      dependencies: taskMeta[taskName]?.deps || [],
    });
    hourAccumulators[idx] += hours;
  }

  // 生成 Gantt 文本图
  const ganttLines = ['## 📊 调度甘特图', ''];
  for (const item of schedule) {
    const bar = '█'.repeat(item.estimatedHours / 2);
    const depStr = item.dependencies.length > 0
      ? ` (依赖: ${item.dependencies.join(', ')})`
      : '';
    ganttLines.push(`- ${item.id}: ${item.assignee} [${bar}] ${item.estimatedHours}h${depStr}`);
  }
  ganttLines.push('', '### 📋 汇总', '');
  for (let i = 0; i < teamSize; i++) {
    ganttLines.push(`- ${assignees[i]}: ${hourAccumulators[i]}h`);
  }

  const ganttChart = ganttLines.join('\n');

  // 写入 PROJECT_GRAPH.md
  if (!dryRun) {
    const tx = new FileTransaction();
    const pgPath = join(iterDir, '00-期次总览', 'PROJECT_GRAPH.md');
    let pgContent = '';

    if (existsSync(pgPath)) {
      pgContent = readFileSync(pgPath, 'utf-8');
      // 替换或追加调度计划
      const schedulePattern = /##\s*📊\s*调度甘特图[\s\S]*$/;
      if (schedulePattern.test(pgContent)) {
        pgContent = pgContent.replace(schedulePattern, ganttChart);
      } else {
        pgContent += '\n\n' + ganttChart;
      }
    } else {
      pgContent = `# ${iteration} 期次总览\n\n${ganttChart}`;
    }

    tx.write(pgPath, pgContent);

    try {
      await tx.commit();
    } catch (e) {
      errors.push(`事务失败: ${(e as Error).message}`);
      return { success: false, schedule, ganttChart, errors };
    }
  }

  return { success: true, schedule, ganttChart, errors };
}
