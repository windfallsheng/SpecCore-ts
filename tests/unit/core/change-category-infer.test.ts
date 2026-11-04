import { describe, it, expect } from 'vitest';
import { inferCategoryFromDescription } from '../../../src/core/change-parser';

// ═══════════════════════════════════════════════════════════
// 变更/新增意图分类（v8.3.386，BUG-4 修复）
// bug：「加一个消息通知功能」被判 unknown 走变更路径——新增类正则
// /^(新增|增加|添加|创建|实现|做一个|开发)/ 缺需求文档 6.2 节规定的「加」前缀。
// ═══════════════════════════════════════════════════════════
describe('inferCategoryFromDescription - 新增/变更意图分类（v8.3.386）', () => {
  it('「加一个消息通知功能」判新增（修复前 unknown）', () => {
    const r = inferCategoryFromDescription('加一个消息通知功能');
    expect(r.type).toBe('new');
    expect(r.category).toBe('feature');
  });

  it('「加一个小程序端」判新增渠道端', () => {
    const r = inferCategoryFromDescription('加一个小程序端');
    expect(r.type).toBe('new');
    expect(r.category).toBe('endpoint');
  });

  it('「加一个对接微信支付的接口」判新增集成', () => {
    const r = inferCategoryFromDescription('加一个对接微信支付的接口');
    expect(r.type).toBe('new');
    expect(r.category).toBe('integration');
  });

  it('原有新增前缀仍正常（新增/创建/实现）', () => {
    expect(inferCategoryFromDescription('新增用户管理功能').type).toBe('new');
    expect(inferCategoryFromDescription('创建订单模块').type).toBe('new');
    expect(inferCategoryFromDescription('实现积分兑换').type).toBe('new');
  });

  it('变更类不受影响', () => {
    const r = inferCategoryFromDescription('把登录页按钮改成红色');
    expect(r.type).toBe('change');
  });
});
