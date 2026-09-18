/**
 * plan-graph — 计划阶段 CLI 算图模块
 *
 * 核心原则：CLI 做确定性计算（依赖图、拓扑排序、关键路径），
 * AI 只做判断（优先级冲突、资源冲突、风险）。
 */
import { TaskState } from './state';

export interface Batch {
  batch: number;
  tasks: string[];
}

export interface Conflict {
  type: 'resource' | 'dependency' | 'priority';
  description: string;
  involved: string[];
}

export interface PlanGraph {
  tasks: TaskMeta[];
  batches: Batch[];
  criticalPath: string[];
  totalDuration: number;
  conflicts: Conflict[];
  platformCoverage: Record<string, number>;
}

export interface TaskMeta {
  id: string;
  name: string;
  depends_on: string[];
  platforms: string[];
  estimated_hours: number;
  priority: string;
  assignee: string;
  status: string;
}

/**
 * 从 TaskState 提取元数据（只取计划需要的字段）
 */
function extractMeta(t: TaskState): TaskMeta {
  return {
    id: t.id,
    name: t.name,
    depends_on: t.dependencies || [],
    platforms: t.platform ? [t.platform] : [],
    estimated_hours: t.estimatedHours || 0,
    priority: t.priority,
    assignee: t.assignee || '未分配',
    status: t.status,
  };
}

/**
 * 构建依赖图并计算执行批次（拓扑排序分层）
 */
export function computeBatches(tasks: TaskState[]): Batch[] {
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // 初始化
  for (const t of tasks) {
    graph.set(t.id, t.dependencies || []);
    inDegree.set(t.id, (t.dependencies || []).length);
  }

  const batches: Batch[] = [];
  let remaining = new Set(tasks.map(t => t.id));

  while (remaining.size > 0) {
    // 找出入度为 0 的任务（无未完成的依赖）
    const currentBatch: string[] = [];
    for (const taskId of remaining) {
      if ((inDegree.get(taskId) || 0) === 0) {
        currentBatch.push(taskId);
      }
    }

    if (currentBatch.length === 0) {
      // 有环，剩余任务组成一批
      batches.push({ batch: batches.length + 1, tasks: Array.from(remaining) });
      break;
    }

    batches.push({ batch: batches.length + 1, tasks: currentBatch });

    // 移除已处理的任务，更新入度
    for (const taskId of currentBatch) {
      remaining.delete(taskId);
      for (const [id, deps] of graph) {
        if (deps.includes(taskId)) {
          inDegree.set(id, (inDegree.get(id) || 0) - 1);
        }
      }
    }
  }

  return batches;
}

/**
 * 计算关键路径（耗时最长的依赖链）
 */
export function findCriticalPath(tasks: TaskState[], batches: Batch[]): string[] {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const dp = new Map<string, { duration: number; path: string[] }>();

  function calc(taskId: string): { duration: number; path: string[] } {
    if (dp.has(taskId)) return dp.get(taskId)!;

    const task = taskMap.get(taskId);
    const hours = task?.estimatedHours || 0;
    const deps = task?.dependencies || [];

    if (deps.length === 0) {
      const result = { duration: hours, path: [taskId] };
      dp.set(taskId, result);
      return result;
    }

    let maxDep = { duration: 0, path: [] as string[] };
    for (const dep of deps) {
      const depResult = calc(dep);
      if (depResult.duration > maxDep.duration) {
        maxDep = depResult;
      }
    }

    const result = {
      duration: maxDep.duration + hours,
      path: [...maxDep.path, taskId],
    };
    dp.set(taskId, result);
    return result;
  }

  let best = { duration: 0, path: [] as string[] };
  for (const t of tasks) {
    const result = calc(t.id);
    if (result.duration > best.duration) {
      best = result;
    }
  }

  return best.path;
}

/**
 * 检测资源冲突（同一人在同一批次有多个任务）
 */
export function detectResourceConflicts(tasks: TaskState[], batches: Batch[]): Conflict[] {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const conflicts: Conflict[] = [];

  for (const batch of batches) {
    const assigneeMap = new Map<string, string[]>();
    for (const taskId of batch.tasks) {
      const task = taskMap.get(taskId);
      if (!task || !task.assignee) continue;
      const list = assigneeMap.get(task.assignee) || [];
      list.push(taskId);
      assigneeMap.set(task.assignee, list);
    }

    for (const [assignee, taskIds] of assigneeMap) {
      if (taskIds.length > 1) {
        conflicts.push({
          type: 'resource',
          description: `${assignee} 在批次 ${batch.batch} 中同时负责 ${taskIds.length} 个任务`,
          involved: taskIds,
        });
      }
    }
  }

  return conflicts;
}

/**
 * 计算端覆盖统计
 */
export function calculatePlatformCoverage(tasks: TaskState[]): Record<string, number> {
  const coverage: Record<string, number> = {};
  for (const t of tasks) {
    if (t.platform) {
      coverage[t.platform] = (coverage[t.platform] || 0) + 1;
    }
  }
  return coverage;
}

/**
 * 构建完整的计划图（CLI 算图结果）
 */
export function buildPlanGraph(tasks: TaskState[]): PlanGraph {
  const batches = computeBatches(tasks);
  const criticalPath = findCriticalPath(tasks, batches);
  const conflicts = detectResourceConflicts(tasks, batches);
  const platformCoverage = calculatePlatformCoverage(tasks);

  const totalDuration = criticalPath.reduce((sum, id) => {
    const t = tasks.find(task => task.id === id);
    return sum + (t?.estimatedHours || 0);
  }, 0);

  return {
    tasks: tasks.map(extractMeta),
    batches,
    criticalPath,
    totalDuration,
    conflicts,
    platformCoverage,
  };
}

/**
 * 生成结构化 JSON（给 AI 的输入）
 */
export function generatePlanJson(graph: PlanGraph): string {
  return JSON.stringify({
    iteration: graph.tasks.length > 0 ? '当前迭代' : '',
    summary: {
      total_tasks: graph.tasks.length,
      total_batches: graph.batches.length,
      total_duration_hours: graph.totalDuration,
      critical_path: graph.criticalPath,
    },
    tasks: graph.tasks,
    batches: graph.batches,
    conflicts: graph.conflicts,
    platform_coverage: graph.platformCoverage,
  }, null, 2);
}

/**
 * 构建 AI 决策 Prompt（基于 CLI 算好的图）
 */
export function buildPlanDecisionPrompt(json: string): string {
  return `# 任务: 制定开发计划\n\n` +
    `## 输入数据（CLI 自动计算）\n\n` +
    `以下数据由 CLI 从任务目录扫描并计算得出：\n\n` +
    `\`\`\`json
${json}
\`\`\`

` +
    `## 需要你判断的问题\n\n` +
    `1. **优先级冲突**：同一批次内是否有高优先级任务应该提前？\n` +
    `2. **资源冲突**：是否有人员同时负责多个任务需要调整？\n` +
    `3. **风险识别**：关键路径上的任务是否有延期风险？\n` +
    `4. **批次优化**：是否有任务可以合并或拆分以优化工期？\n` +
    `5. **依赖合理性**：是否有循环依赖或缺失依赖需要修复？\n\n` +
    `## 输出要求\n\n` +
    `1. 生成分批次执行计划（Mermaid 甘特图或表格）\n` +
    `2. 标注关键路径上的任务\n` +
    `3. 列出所有冲突和建议的解决方案\n` +
    `4. 使用 [DOC:PLAN] 标记输出\n\n` +
    `## 注意\n\n` +
    `- 不要重新计算依赖关系（CLI 已经算好）\n` +
    `- 不要重新估算工时（使用输入数据中的值）\n` +
    `- 只做判断和决策，不做计算\n`;
}
