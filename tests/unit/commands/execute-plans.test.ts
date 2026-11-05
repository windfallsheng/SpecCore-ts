import { describe, it, expect } from 'vitest';
import { mergePlanTasks } from '../../../src/commands/execute';
import type { ExecutionPlan } from '../../../src/core/plan-store';
import type { TaskState } from '../../../src/core/state';

function plan(id: string, tasks: string[]): ExecutionPlan {
  return {
    id, name: `Plan-${id}`, iteration: 'Iteration-001-x', tasks, batchSize: 3,
    source: 'manual', filters: {}, createdAt: new Date().toISOString(),
    executedAt: null, result: null, status: 'active',
  };
}

function task(id: string, status: TaskState['status'] = 'todo'): TaskState {
  return { id, name: id, status, type: 'feature', priority: 'medium', dependencies: [] } as TaskState;
}

describe('mergePlanTasks 多计划合并（v8.3.397+）', () => {
  it('多计划按顺序拼接合并，重复任务保留首次位置', () => {
    const plans = [plan('p1', ['A', 'B', 'C']), plan('p2', ['B', 'D'])];
    const all = [task('A'), task('B'), task('C'), task('D')];
    const merged = mergePlanTasks(plans, all);
    expect(merged.map(t => t.id)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('跳过已完成与已归档任务（计划复用幂等）', () => {
    const plans = [plan('p1', ['A', 'B', 'C'])];
    const all = [task('A'), task('B', 'completed'), task('C', 'archived')];
    const merged = mergePlanTasks(plans, all);
    expect(merged.map(t => t.id)).toEqual(['A']);
  });

  it('计划中已不存在的任务被忽略', () => {
    const plans = [plan('p1', ['A', 'Ghost'])];
    const all = [task('A')];
    const merged = mergePlanTasks(plans, all);
    expect(merged.map(t => t.id)).toEqual(['A']);
  });

  it('全部任务已完成时返回空（无需执行）', () => {
    const plans = [plan('p1', ['A', 'B'])];
    const all = [task('A', 'completed'), task('B', 'completed')];
    expect(mergePlanTasks(plans, all)).toEqual([]);
  });
});
