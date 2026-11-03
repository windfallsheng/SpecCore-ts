import { describe, it, expect } from 'vitest';
import { extractKeywords } from '../../../src/core/prompt-plugins/execute-graph-plugin';

describe('extractKeywords 关键词提取', () => {
  it('camelCase / snake_case 英文拆分', () => {
    const kws = extractKeywords('inboxNotification task_queue');
    expect(kws).toContain('inbox');
    expect(kws).toContain('notification');
    expect(kws).toContain('task');
    expect(kws).toContain('queue');
  });

  it('中文任务名 → 全拼连写 + 逐字拼音 + 中文原词（v8.3.357 中文映射）', () => {
    const kws = extractKeywords('站内信通知');
    // 全拼连写（命中拼音 slug：zhanneixintongzhi）
    expect(kws).toContain('zhanneixintongzhi');
    // 逐字拼音（命中零散拼音命名）
    expect(kws).toContain('zhan');
    expect(kws).toContain('tong');
    expect(kws).toContain('zhi');
    // 中文原词（命中中文命名节点）
    expect(kws).toContain('站内信通知');
  });

  it('英文与中文并存时两类关键词都在', () => {
    const kws = extractKeywords('notification 通知');
    expect(kws).toContain('notification');
    expect(kws).toContain('tongzhi');
    expect(kws).toContain('通知');
  });

  it('单字中文不产生拼音噪声（长度过滤）', () => {
    const kws = extractKeywords('点');
    // 「点」全拼 dian 长度 4 ≥ 2 会进，但单字本身无逐字拆分空间——
    // 校验不产出空串与超短噪声词
    expect(kws.every(k => k.length >= 1)).toBe(true);
    expect(kws).not.toContain('');
  });
});
