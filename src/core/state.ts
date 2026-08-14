import { readFile, pathExists, readdir, stat } from 'fs-extra';
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
  /** 所属端（子任务级别） */
  platform?: string;
  /** 父任务 ID（子任务才有） */
  parentTaskId?: string;
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

/** 排除的目录名前缀（不是端目录） */
const NON_PLATFORM_DIRS = new Set(['.', '_', '9', '.meta', '_shared', '99-artifacts', '00-specs']);

/** 判断某个目录是否为端子任务目录（含 TASK.md 且不是特殊目录） */
async function isPlatformDir(dirPath: string): Promise<boolean> {
  const taskMd = join(dirPath, 'TASK.md');
  return await pathExists(taskMd);
}

export async function scanTasks(iteration: string): Promise<TaskState[]> {
  const { pathExists, readdir, stat } = await import('fs-extra');
  const { join } = await import('path');
  const { getIterationDir } = await import('./context');
  
  const iterationDir = await getIterationDir(iteration);
  if (!(await pathExists(iterationDir))) {
    return [];
  }
  
  // 优先从 030-tasks/ 扫描（split 创建的标准位置），兼容旧布局（迭代根目录）
  const tasksDir = join(iterationDir, '030-tasks');
  const scanRoot = (await pathExists(tasksDir)) ? tasksDir : iterationDir;
  
  const tasks: TaskState[] = [];
  
  // 递归扫描: 支持 030-tasks/Task-XXX/ 和 030-tasks/{type}/Task-XXX/ 两种布局
  const taskDirs: { taskId: string; taskPath: string }[] = [];
  const rootEntries = await readdir(scanRoot, { withFileTypes: true });
  
  for (const entry of rootEntries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('Task-')) {
      taskDirs.push({ taskId: entry.name, taskPath: join(scanRoot, entry.name) });
    } else if (!entry.name.startsWith('.') && !entry.name.startsWith('0')) {
      // 可能是类型子目录（feature/bugfix/refactor/research）
      const typeDir = join(scanRoot, entry.name);
      const typeEntries = await readdir(typeDir, { withFileTypes: true }).catch(() => []);
      for (const te of typeEntries) {
        if (te.isDirectory() && te.name.startsWith('Task-')) {
          taskDirs.push({ taskId: te.name, taskPath: join(typeDir, te.name) });
        }
      }
    }
  }
  
  for (const { taskId, taskPath } of taskDirs) {
    // 读取父任务元信息
    let type = 'feature';
    let parentStatus: TaskState['status'] = 'pending';
    let parentAssignee = '';
    let priority: TaskState['priority'] = 'medium';
    
    const metaDir = join(taskPath, '.meta');
    if (await pathExists(metaDir)) {
      const typePath = join(metaDir, 'type');
      if (await pathExists(typePath)) type = (await readFile(typePath, 'utf-8')).trim();
      const statusPath = join(metaDir, 'status');
      if (await pathExists(statusPath)) parentStatus = parseStatus((await readFile(statusPath, 'utf-8')).trim());
      const ownerPath = join(metaDir, 'owner');
      if (await pathExists(ownerPath)) parentAssignee = (await readFile(ownerPath, 'utf-8')).trim();
    } else {
      const typePath = join(taskPath, '.task-type');
      if (await pathExists(typePath)) type = (await readFile(typePath, 'utf-8')).trim();
    }
    
    // 从 _shared/ 或 00-specs/ 读取父任务名称
    let name = taskId;
    const sharedTaskMd = join(taskPath, '_shared', 'TASK.md');
    const oldTaskMd = join(taskPath, '00-specs', 'TASK.md');
    const taskMdPath = (await pathExists(sharedTaskMd)) ? sharedTaskMd :
                       (await pathExists(oldTaskMd)) ? oldTaskMd : null;
    if (taskMdPath) {
      const taskMd = await readFile(taskMdPath, 'utf-8');
      const nameMatch = taskMd.match(/#\s+(.+)/);
      if (nameMatch) name = nameMatch[1].trim();
      const prioMatch = taskMd.match(/优先级[:\s]*(high|medium|low|高|中|低)/i);
      if (prioMatch) {
        const p = prioMatch[1].toLowerCase();
        if (p.includes('high') || p.includes('高')) priority = 'high';
        else if (p.includes('low') || p.includes('低')) priority = 'low';
      }
      const ownerMatch = taskMd.match(/负责人[:\s]*([^\n|]+)/);
      if (ownerMatch && !parentAssignee) parentAssignee = ownerMatch[1].trim();
    }
    
    // 扫描各端子任务目录（新结构: {platform}/TASK.md）
    let hasSubTasks = false;
    const subTasks: TaskState[] = [];
    const dirEntries = await readdir(taskPath, { withFileTypes: true }).catch(() => []);
    
    for (const de of dirEntries) {
      if (!de.isDirectory()) continue;
      if (NON_PLATFORM_DIRS.has(de.name)) continue;
      if (de.name.startsWith('.') || de.name.startsWith('0')) continue;
      
      const platformDirPath = join(taskPath, de.name);
      if (await isPlatformDir(platformDirPath)) {
        hasSubTasks = true;
        const platform = de.name;
        const subTaskMd = await readFile(join(platformDirPath, 'TASK.md'), 'utf-8');
        
        // 提取子任务负责人、状态、子任务 ID
        let subAssignee = parentAssignee;
        const subOwnerMatch = subTaskMd.match(/\*\*负责人\*\*[:\s]*([^\n]+)/);
        if (subOwnerMatch) subAssignee = subOwnerMatch[1].trim();
        
        let subStatus: TaskState['status'] = 'pending';
        const subStatusMatch = subTaskMd.match(/\*\*状态\*\*[:\s]*(.+)/);
        if (subStatusMatch) {
          const raw = subStatusMatch[1].trim();
          if (raw.includes('已完成') || raw.includes('completed')) subStatus = 'completed';
          else if (raw.includes('进行中') || raw.includes('in_progress')) subStatus = 'in_progress';
        }
        
        // 提取子任务 ID
        let subTaskId = `${taskId}-${platform}`;
        const subIdMatch = subTaskMd.match(/子任务 ID\*\*[:\s]*`(Task-[^`]+)`/);
        if (subIdMatch) subTaskId = subIdMatch[1];
        
        // 提取子任务名称
        let subName = `${name} - ${platform}`;
        const subNameMatch = subTaskMd.match(/#\s+(.+)/);
        if (subNameMatch) subName = subNameMatch[1].trim();
        
        subTasks.push({
          id: subTaskId,
          name: subName,
          type,
          status: subStatus,
          assignee: subAssignee,
          dependencies: [],
          priority,
          progress: subStatus === 'completed' ? 100 : 0,
          platform,
          parentTaskId: taskId,
        });
      }
    }
    
    if (hasSubTasks && subTasks.length > 0) {
      // 新结构: 展开为各端子任务
      tasks.push(...subTasks);
    } else {
      // 旧结构或无子任务的父任务
      tasks.push({
        id: taskId,
        name,
        type,
        status: parentStatus,
        assignee: parentAssignee,
        dependencies: [],
        priority,
        progress: parentStatus === 'completed' ? 100 : 0
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
