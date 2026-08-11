import { readFile, pathExists, readdir } from 'fs-extra';
import { join } from 'path';

export interface TaskState {
  id: string;
  name: string;
  type: string;
  status: 'pending' | 'in_progress' | 'completed' | 'archived';
  assignee: string;
  dependencies: string[];
  priority: 'high' | 'medium' | 'low';
  progress: number;
  startDate?: string;
  endDate?: string;
}

export interface IterationState {
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  tasks: TaskState[];
  completionRate: number;
}

export async function readProjectGraph(iteration: string): Promise<IterationState> {
  const { getIterationDir } = await import('./context');
  const iterationDir = await getIterationDir(iteration);
  const graphPath = join(iterationDir, '000-overview', 'PROJECT_GRAPH.md');
  
  if (!(await pathExists(graphPath))) {
    return {
      name: iteration,
      status: 'unknown',
      startDate: '',
      endDate: '',
      tasks: [],
      completionRate: 0
    };
  }
  
  const content = await readFile(graphPath, 'utf-8');
  return parseProjectGraph(content, iteration);
}

function parseProjectGraph(content: string, iterationName: string): IterationState {
  const state: IterationState = {
    name: iterationName,
    status: 'unknown',
    startDate: '',
    endDate: '',
    tasks: [],
    completionRate: 0
  };
  
  // Extract status from markdown
  const statusMatch = content.match(/迭代状态[:：]\s*(.+)/);
  if (statusMatch) {
    state.status = statusMatch[1].trim();
  }
  
  // Extract date range
  const dateMatch = content.match(/时间范围[:：]\s*(\d{4}-\d{2}-\d{2})\s*[~～]\s*(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    state.startDate = dateMatch[1];
    state.endDate = dateMatch[2];
  }
  
  // Parse tasks table
  const taskMatches = content.matchAll(/\|\s*(Task-\d+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(\d+)%?\s*\|\s*(\S+)\s*\|\s*([^|]+)\s*\|/g);
  for (const match of taskMatches) {
    state.tasks.push({
      id: match[1].trim(),
      name: match[2].trim(),
      type: match[3].trim(),
      progress: parseInt(match[4]) || 0,
      status: parseStatus(match[5].trim()),
      assignee: match[6].trim(),
      dependencies: [],
      priority: 'medium'
    });
  }
  
  // Calculate completion rate
  if (state.tasks.length > 0) {
    const completed = state.tasks.filter(t => t.status === 'completed').length;
    state.completionRate = Math.round((completed / state.tasks.length) * 100);
  }
  
  return state;
}

function parseStatus(status: string): TaskState['status'] {
  if (status.includes('已完成') || status.includes('completed')) return 'completed';
  if (status.includes('进行中') || status.includes('in_progress')) return 'in_progress';
  if (status.includes('已归档') || status.includes('archived')) return 'archived';
  return 'pending';
}

export async function scanTasks(iteration: string): Promise<TaskState[]> {
  const { pathExists, readdir } = await import('fs-extra');
  const { join } = await import('path');
  const { getIterationDir } = await import('./context');
  
  const iterationDir = await getIterationDir(iteration);
  if (!(await pathExists(iterationDir))) {
    return [];
  }
  
  // 优先从 030-tasks/ 扫描（split 创建的标准位置），兼容旧布局（迭代根目录）
  const tasksDir = join(iterationDir, '030-tasks');
  const scanRoot = (await pathExists(tasksDir)) ? tasksDir : iterationDir;
  
  const entries = await readdir(scanRoot, { withFileTypes: true });
  const tasks: TaskState[] = [];
  
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('Task-')) {
      const taskId = entry.name;
      const taskPath = join(scanRoot, taskId);
      
      // 读取元信息（.meta/ 优先，兼容旧 .task-type）
      let type = 'feature';
      let status: TaskState['status'] = 'pending';
      let assignee = '';
      let priority: TaskState['priority'] = 'medium';
      
      const metaDir = join(taskPath, '.meta');
      if (await pathExists(metaDir)) {
        const typePath = join(metaDir, 'type');
        if (await pathExists(typePath)) type = (await readFile(typePath, 'utf-8')).trim();
        const statusPath = join(metaDir, 'status');
        if (await pathExists(statusPath)) status = parseStatus((await readFile(statusPath, 'utf-8')).trim());
        const ownerPath = join(metaDir, 'owner');
        if (await pathExists(ownerPath)) assignee = (await readFile(ownerPath, 'utf-8')).trim();
      } else {
        // 兼容旧布局
        const typePath = join(taskPath, '.task-type');
        if (await pathExists(typePath)) type = (await readFile(typePath, 'utf-8')).trim();
      }
      
      // 从 TASK.md 读取名称和补充信息
      let name = taskId;
      const taskMdPath = join(taskPath, '00-specs', 'TASK.md');
      if (await pathExists(taskMdPath)) {
        const taskMd = await readFile(taskMdPath, 'utf-8');
        const nameMatch = taskMd.match(/#\s+(.+)/);
        if (nameMatch) name = nameMatch[1].trim();
        // 从 TASK.md 表格中提取优先级和负责人
        const prioMatch = taskMd.match(/优先级[:\s]*.*(high|medium|low|高|中|低)/i);
        if (prioMatch) {
          const p = prioMatch[1].toLowerCase();
          if (p.includes('high') || p.includes('高')) priority = 'high';
          else if (p.includes('low') || p.includes('低')) priority = 'low';
        }
        const ownerMatch = taskMd.match(/负责人[:\s]*([^\n|]+)/);
        if (ownerMatch && !assignee) assignee = ownerMatch[1].trim();
      }
      
      tasks.push({
        id: taskId,
        name,
        type,
        status,
        assignee,
        dependencies: [],
        priority,
        progress: status === 'completed' ? 100 : 0
      });
    }
  }
  
  return tasks;
}

export function calculateCompletionRate(tasks: TaskState[]): number {
  if (tasks.length === 0) return 0;
  const completed = tasks.filter(t => t.status === 'completed').length;
  return Math.round((completed / tasks.length) * 100);
}

export function buildDependencyGraph(tasks: TaskState[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const task of tasks) {
    graph.set(task.id, task.dependencies);
  }
  return graph;
}

export function topologicalSort(tasks: TaskState[]): TaskState[] {
  const graph = buildDependencyGraph(tasks);
  const visited = new Set<string>();
  const result: TaskState[] = [];
  
  function visit(taskId: string) {
    if (visited.has(taskId)) return;
    visited.add(taskId);
    
    const deps = graph.get(taskId) || [];
    for (const dep of deps) {
      visit(dep);
    }
    
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      result.push(task);
    }
  }
  
  for (const task of tasks) {
    visit(task.id);
  }
  
  return result;
}
