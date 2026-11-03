import { describe, it, expect } from 'vitest';
import { buildBudgetedReqSection, REQ_BUDGET_CHARS } from '../../../src/core/ai-context-generator';
import { extractKeywords } from '../../../src/core/code-scanner';

// v8.3.366: 需求注入配额 + 关键词中英映射回归测试
describe('buildBudgetedReqSection（需求注入配额）', () => {
  it('总额未超预算：原样拼接，无截断', () => {
    const docs = ['## 来源: a.md\n\n需求 A 内容', '## 来源: b.md\n\n需求 B 内容'];
    const { section, truncated } = buildBudgetedReqSection(docs);
    expect(section).toBe(docs.join('\n\n---\n\n'));
    expect(truncated).toHaveLength(0);
  });

  it('总额超预算：截断并生成阅读清单', () => {
    const bigDoc = '## 来源: big.md\n\n' + 'x'.repeat(REQ_BUDGET_CHARS * 2);
    const { section, truncated } = buildBudgetedReqSection([bigDoc]);
    expect(truncated).toHaveLength(1);
    expect(truncated[0].source).toBe('big.md');
    expect(truncated[0].totalChars).toBe(bigDoc.length);
    expect(truncated[0].keptChars).toBeLessThan(bigDoc.length);
    expect(section).toContain('需求阅读清单');
    expect(section).toContain('已截断');
  });

  it('多文档超限：每文档有保底配额，多个截断条目', () => {
    const docs = Array.from({ length: 5 }, (_, i) =>
      `## 来源: doc${i}.md\n\n${'y'.repeat(REQ_BUDGET_CHARS)}`);
    const { truncated } = buildBudgetedReqSection(docs);
    expect(truncated.length).toBeGreaterThan(0);
    // 每文档保底 800 字符不会被截成残句
    for (const t of truncated) {
      expect(t.keptChars).toBeGreaterThanOrEqual(600);
    }
  });

  it('自定义 budget 生效', () => {
    const docs = ['## 来源: a.md\n\n' + 'z'.repeat(5000)];
    const { truncated } = buildBudgetedReqSection(docs, { budget: 1000 });
    expect(truncated).toHaveLength(1);
    expect(truncated[0].keptChars).toBeLessThanOrEqual(1000);
  });
});

describe('extractKeywords（中文→英文代码符号映射）', () => {
  it('「登录」映射到 login/auth 等英文符号', () => {
    const kws = extractKeywords('用户登录功能需求');
    const lower = kws.map(k => k.toLowerCase());
    expect(lower).toContain('login');
    expect(lower).toContain('auth');
  });

  it('「订单」映射到 order/purchase 等英文符号', () => {
    const kws = extractKeywords('订单创建与支付流程');
    const lower = kws.map(k => k.toLowerCase());
    expect(lower).toContain('order');
    expect(lower).toContain('payment');
  });

  it('「库存」映射到 stock/inventory', () => {
    const kws = extractKeywords('库存扣减与仓储预警');
    const lower = kws.map(k => k.toLowerCase());
    expect(lower).toContain('stock');
    expect(lower).toContain('inventory');
  });

  it('英文关键词保持原样且过滤停用词', () => {
    const kws = extractKeywords('the user login and the session');
    const lower = kws.map(k => k.toLowerCase());
    expect(lower).toContain('login');
    expect(lower).not.toContain('the');
    expect(lower).not.toContain('and');
  });
});
