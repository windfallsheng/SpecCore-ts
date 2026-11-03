import { describe, it, expect } from 'vitest';
import { isSkeletonContent } from '../../../src/core/spec-skeleton';
import {
  validateClarifyCompleteness,
  parseOpenItems,
  autoResolveOpenItems,
} from '../../../src/core/requirement-clarifier';

describe('isSkeletonContent（v8.3.374 公共骨架判定）', () => {
  it('null/undefined/空字符串 → 骨架', () => {
    expect(isSkeletonContent(null)).toBe(true);
    expect(isSkeletonContent(undefined)).toBe(true);
    expect(isSkeletonContent('')).toBe(true);
  });

  it('含 SPEC-SKELETON 标记 → 骨架（无论字数）', () => {
    expect(isSkeletonContent('<!-- SPEC-SKELETON -->\n# 标题\n\n' + 'x'.repeat(200))).toBe(true);
  });

  it('< 100 字 → 骨架', () => {
    expect(isSkeletonContent('# 标题\n\n只有几行内容')).toBe(true);
  });

  it('>= 100 字且无标记 → 非骨架', () => {
    expect(isSkeletonContent('# 标题\n\n' + '这是一段足够长的内容。'.repeat(20))).toBe(false);
  });

  it('自定义阈值 200：150 字内容判为骨架', () => {
    const content = '这是一段内容。'.repeat(15); // ~90 字
    expect(isSkeletonContent(content, 200)).toBe(true);
  });
});

describe('validateClarifyCompleteness（v8.3.374 完整性校验）', () => {
  it('空内容 → 不通过', () => {
    const result = validateClarifyCompleteness('');
    expect(result.pass).toBe(false);
    expect(result.wordCountOk).toBe(false);
  });

  it('骨架内容 → 不通过', () => {
    const result = validateClarifyCompleteness('<!-- SPEC-SKELETON -->\n# 标题\n\n## 背景\n待补充');
    expect(result.pass).toBe(false);
  });

  it('字数不足 300 → 不通过', () => {
    const result = validateClarifyCompleteness('## 背景\n\n这是背景。\n\n## 验收标准\n\n- 测试通过');
    expect(result.pass).toBe(false);
    expect(result.wordCountOk).toBe(false);
  });

  it('字数 >= 300 且章节覆盖 >= 2/3 → 通过', () => {
    const content = `# 预订模块需求澄清

## 背景与目标

本模块实现酒店预订功能，目标是让用户能够在线完成房间预订、支付和取消操作。
预订流程需要支持多种房型选择、入住日期选择、人数选择等。

## 功能规格

### 用户故事
- 作为用户，我想搜索可用房间并按价格排序
- 作为用户，我想查看房间详情并预订
- 作为用户，我想在入住前24小时免费取消预订

### 业务规则
- 预订需支付全额房费
- 取消预订需在入住前24小时操作
- 同一用户同一时段只能预订一间房

## 验收标准

- [ ] 用户可以搜索并筛选可用房间
- [ ] 用户可以查看房间详情
- [ ] 用户可以完成预订并支付
- [ ] 用户可以在24小时内取消预订
`;
    const result = validateClarifyCompleteness(content);
    expect(result.pass).toBe(true);
    expect(result.wordCountOk).toBe(true);
    expect(result.wordCount).toBeGreaterThanOrEqual(300);
  });

  it('缺失 2 个必含章节 → 不通过', () => {
    // 只有「背景」，缺「功能规格/用户故事」和「验收标准」
    const content = `# 某模块

## 背景

这是背景描述，内容足够长以满足字数要求。这是背景描述，内容足够长以满足字数要求。
这是背景描述，内容足够长以满足字数要求。这是背景描述，内容足够长以满足字数要求。
这是背景描述，内容足够长以满足字数要求。

## 依赖与约束

- 依赖数据库
- 依赖缓存服务
`;
    const result = validateClarifyCompleteness(content);
    expect(result.pass).toBe(false);
    expect(result.missingSections.length).toBeGreaterThanOrEqual(2);
  });
});

describe('parseOpenItems + autoResolveOpenItems（v8.3.374 待确认项结构化）', () => {
  it('解析 [OPEN] 标记并识别推荐方案', () => {
    const content = `## 待确认项

- [OPEN] 支付方式选择？
  - 方案 A: 仅支持微信支付
  - 方案 B: 支持微信和支付宝（推荐）
  - 方案 C: 支持所有主流支付方式

- [OPEN] 退款策略？
  - 方案 A: 全额退款
  - 方案 B: 按比例退款
`;
    const items = parseOpenItems(content);
    expect(items.length).toBe(2);
    expect(items[0].question).toBe('支付方式选择？');
    expect(items[0].options.length).toBe(3);
    expect(items[0].recommendedIndex).toBe(1); // 方案 B 被标记为推荐
    expect(items[1].question).toBe('退款策略？');
    expect(items[1].recommendedIndex).toBe(-1); // 无推荐
  });

  it('autoResolve: 有推荐项自动选择，无推荐项保留 [OPEN]', () => {
    const content = `## 待确认项

- [OPEN] 支付方式选择？
  - 方案 A: 仅支持微信支付
  - 方案 B: 支持微信和支付宝（推荐）

- [OPEN] 退款策略？
  - 方案 A: 全额退款
  - 方案 B: 按比例退款
`;
    const result = autoResolveOpenItems(content);
    expect(result.resolvedCount).toBe(1);
    expect(result.pendingCount).toBe(1);
    expect(result.content).toContain('[RESOLVED:');
    expect(result.content).toContain('支持微信和支付宝');
    expect(result.content).toContain('[OPEN] 退款策略');
  });

  it('无 [OPEN] 项时原样返回', () => {
    const content = '## 正常需求文档\n\n- 功能 A\n- 功能 B\n';
    const result = autoResolveOpenItems(content);
    expect(result.content).toBe(content);
    expect(result.resolvedCount).toBe(0);
    expect(result.pendingCount).toBe(0);
  });
});
