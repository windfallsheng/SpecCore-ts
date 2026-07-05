import { readFile, pathExists } from 'fs-extra';
import { join } from 'path';
import { glob } from 'glob';

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
  const graphPath = join(`期次-${iteration}`, '00-期次总览', 'PROJECT_GRAPH.md');
  
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
  const statusMatch = content.match(/期次状态[:：]\s*(.+)/);
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
  
  const iterationDir = `期次-${iteration}`;
  if (!(await pathExists(iterationDir))) {
    return [];
  }
  
  const entries = await readdir(iterationDir, { withFileTypes: true });
  const tasks: TaskState[] = [];
  
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('Task-')) {
      const taskId = entry.name;
      const taskPath = join(iterationDir, taskId);
      
      // Try to read task type
      let type = 'feature';
      const typePath = join(taskPath, '.task-type');
      if (await pathExists(typePath)) {
        const typeContent = await readFile(typePath, 'utf-8');
        type = typeContent.trim();
      }
      
      // Try to read task name from TASK.md
      let name = taskId;
      const taskMdPath = join(taskPath, 'backend', 'TASK.md');
      if (await pathExists(taskMdPath)) {
        const taskMd = await readFile(taskMdPath, 'utf-8');
        const nameMatch = taskMd.match(/#\s+(.+)/);
        if (nameMatch) {
          name = nameMatch[1].trim();
        }
      }
      
      tasks.push({
        id: taskId,
        name,
        type,
        status: 'pending',
        assignee: '',
        dependencies: [],
        priority: 'medium',
        progress: 0
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
