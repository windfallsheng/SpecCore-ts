import { describe, it, expect } from 'vitest';
import { groupPlanByFeature } from '../../../src/commands/plan';
import type { PlanEntry, TaskPlan } from '../../../src/commands/plan';

function tp(id: string, opts: Partial<TaskPlan> = {}): TaskPlan {
  return {
    id, name: id, type: 'feature', priority: 'medium', branch: `feature/${id}`,
    dependencies: [], status: 'pending', assignee: 'TBD', progress: 0, estimatedHours: 8,
    ...opts,
  };
}

describe('groupPlanByFeature 模块化计划剖面（v8.3.397+）', () => {
  it('按 feature 分组，phases 归并升序', () => {
    const plan: PlanEntry[] = [
      { phase: 1, tasks: [tp('pay-A', { feature: '支付' })] },
      { phase: 2, tasks: [tp('ord-A', { feature: '订单' }), tp('pay-B', { feature: '支付', dependencies: ['pay-A'] })] },
    ];
    const sections = groupPlanByFeature(plan);
    expect(sections.length).toBe(2);
    const pay = sections.find(s => s.feature === '支付')!;
    expect(pay.tasks.map(t => t.id)).toEqual(['pay-A', 'pay-B']);
    expect(pay.phases).toEqual([1, 2]);
  });

  it('跨模块任务依赖聚合为模块间依赖', () => {
    const plan: PlanEntry[] = [
      { phase: 1, tasks: [tp('ord-A', { feature: '订单' })] },
      { phase: 2, tasks: [tp('pay-A', { feature: '支付', dependencies: ['ord-A'] })] },
    ];
    const sections = groupPlanByFeature(plan);
    const pay = sections.find(s => s.feature === '支付')!;
    expect(pay.groupDeps).toEqual(['订单']);
  });

  it('无 feature 任务归入未归类', () => {
    const plan: PlanEntry[] = [{ phase: 1, tasks: [tp('orphan')] }];
    const sections = groupPlanByFeature(plan);
    expect(sections[0].feature).toBe('未归类');
  });
});
