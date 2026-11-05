import { describe, it, expect } from 'vitest';
import { extractPlanTaskIds } from '../../../src/commands/plan';

describe('extractPlanTaskIds 计划内容任务提取（v8.3.398+）', () => {
  const known = ['Task-001', 'Task-002', 'Task-003-booking-service'];

  it('从 Markdown 计划提取已知任务 ID，保持出现顺序', () => {
    const content = [
      '## Phase 1',
      '- Task-002 用户模块',
      '- Task-001 订单模块',
      '',
      '| Task-003-booking-service | 预订服务 |',
    ].join('\n');
    expect(extractPlanTaskIds(content, known)).toEqual(['Task-002', 'Task-001', 'Task-003-booking-service']);
  });

  it('忽略计划中不存在于任务清单的 ID（防止瞎编任务）', () => {
    const content = 'Task-001、Task-999、Task-002';
    expect(extractPlanTaskIds(content, known)).toEqual(['Task-001', 'Task-002']);
  });

  it('重复出现的任务 ID 去重保留首次', () => {
    const content = 'Task-001 → Task-002 → Task-001';
    expect(extractPlanTaskIds(content, known)).toEqual(['Task-001', 'Task-002']);
  });

  it('计划中无任何任务 ID 时返回空（CLI 将拒绝登记执行库）', () => {
    const content = '## 计划\n\n先做数据库，再做接口。\n';
    expect(extractPlanTaskIds(content, known)).toEqual([]);
  });

  it('计划为空内容或纯空白时返回空', () => {
    expect(extractPlanTaskIds('', known)).toEqual([]);
    expect(extractPlanTaskIds('   \n  ', known)).toEqual([]);
  });
});
