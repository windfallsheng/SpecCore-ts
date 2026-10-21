/**
 * filterTasksByModule — execute --module 多值模糊过滤测试（v8.3.339+）
 * 覆盖：逗号分隔多值（任一命中）、单元名/模块目录名/任务名三面模糊匹配、空规格原样返回
 */
import { describe, it, expect } from 'vitest';
import { filterTasksByModule } from '../../../src/core/state';

interface T { id: string; name?: string; feature?: string }

describe('filterTasksByModule（v8.3.339+: --module 多值模糊）', () => {
  const tasks: T[] = [
    { id: 'admin-web-01-yudingguanli', name: '预订管理', feature: 'admin-web-01-yudingguanli' },
    { id: 'h5-mobile-02-dingdanguanli', name: '订单管理', feature: 'h5-mobile-02-dingdanguanli' },
    { id: 'Task-003-zhifu', name: '支付', feature: '支付模块' },
  ];

  it('逗号分隔多值：任一命中即保留（模块目录名匹配）', () => {
    const r = filterTasksByModule(tasks, 'yudingguanli,dingdanguanli');
    expect(r.map((t) => t.id)).toEqual(['admin-web-01-yudingguanli', 'h5-mobile-02-dingdanguanli']);
  });

  it('中文逗号与空格容错', () => {
    const r = filterTasksByModule(tasks, '支付， 不存在');
    expect(r.map((t) => t.id)).toEqual(['Task-003-zhifu']);
  });

  it('匹配面覆盖单元名（feature）与任务名（name）', () => {
    expect(filterTasksByModule(tasks, '支付模块').map((t) => t.id)).toEqual(['Task-003-zhifu']);
    expect(filterTasksByModule(tasks, '订单').map((t) => t.id)).toEqual(['h5-mobile-02-dingdanguanli']);
  });

  it('空规格/全空白原样返回', () => {
    expect(filterTasksByModule(tasks, undefined)).toEqual(tasks);
    expect(filterTasksByModule(tasks, '')).toEqual(tasks);
    expect(filterTasksByModule(tasks, ' , ')).toEqual(tasks);
  });

  it('无命中返回空数组', () => {
    expect(filterTasksByModule(tasks, 'bucunzai')).toEqual([]);
  });
});
