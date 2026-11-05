import { describe, it, expect } from 'vitest';
import { groupTasksByFeature } from '../../../src/core/state';
import type { TaskState } from '../../../src/core/state';

function task(id: string, opts: Partial<TaskState> = {}): TaskState {
  return {
    id, name: id, type: 'feature', status: 'pending', assignee: 'TBD',
    dependencies: [], priority: 'medium', progress: 0,
    ...opts,
  };
}

describe('groupTasksByFeature 两级拓扑（v8.3.397+）', () => {
  it('按 feature 归模块，模块内按依赖拓扑排序', () => {
    const tasks = [
      task('pay-B', { feature: '支付', dependencies: ['pay-A'] }),
      task('pay-A', { feature: '支付' }),
      task('ord-A', { feature: '订单' }),
    ];
    const groups = groupTasksByFeature(tasks);
    const pay = groups.find(g => g.feature === '支付')!;
    // 模块内拓扑：pay-A（被依赖）在前
    expect(pay.tasks.map(t => t.id)).toEqual(['pay-A', 'pay-B']);
    expect(groups.map(g => g.feature)).toContain('订单');
  });

  it('跨模块任务依赖聚合为模块间依赖，模块级拓扑排序', () => {
    const tasks = [
      task('pay-A', { feature: '支付', dependencies: ['ord-A'] }),
      task('ord-A', { feature: '订单' }),
    ];
    const groups = groupTasksByFeature(tasks);
    const pay = groups.find(g => g.feature === '支付')!;
    const ord = groups.find(g => g.feature === '订单')!;
    expect(pay.groupDeps).toEqual(['订单']);
    expect(ord.groupDeps).toEqual([]);
    // 模块级拓扑：订单（被依赖）排在支付前
    expect(groups.map(g => g.feature)).toEqual(['订单', '支付']);
  });

  it('无 feature 的任务按 parentTaskId 归组，再兜底未归类', () => {
    const tasks = [
      task('sub-A', { parentTaskId: 'Task-支付模块' }),
      task('sub-B', { parentTaskId: 'Task-支付模块' }),
      task('orphan', {}),
    ];
    const groups = groupTasksByFeature(tasks);
    expect(groups.map(g => g.feature)).toContain('Task-支付模块');
    expect(groups.map(g => g.feature)).toContain('未归类');
  });

  it('模块循环依赖不丢组（兜底追加）', () => {
    const tasks = [
      task('pay-A', { feature: '支付', dependencies: ['ord-A'] }),
      task('ord-A', { feature: '订单', dependencies: ['pay-A'] }),
    ];
    const groups = groupTasksByFeature(tasks);
    expect(groups.map(g => g.feature).sort()).toEqual(['支付', '订单']);
    expect(groups.length).toBe(2);
  });
});
