import { describe, it, expect, vi } from 'vitest';

// mock 掉 LLM 依赖：无 providers 池 → 走规则降级路径（fallbackAnalysis）
vi.mock('../../../src/core/ask-llm', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/core/ask-llm')>();
  return { ...mod, resolveAiProviders: async () => [] };
});

import { aiEnhance, recognizeWithAi } from '../../../src/core/intent-ai';

describe('intent-ai 无 LLM 时的规则降级路径', () => {
  it('源码反推句降级识别为 global_reverse', async () => {
    const r = await aiEnhance('根据 booking-service 的代码生成需求文档', 30);
    expect(r).not.toBeNull();
    expect(r!.intent).toBe('global_reverse');
    expect(r!.suggestion).toContain('global from-source');
  });

  it('问题描述句降级识别为 bugfix', async () => {
    const r = await aiEnhance('订单接口报错了 500', 30);
    expect(r).not.toBeNull();
    expect(r!.intent).toBe('bugfix');
    expect(r!.suggestion).toContain('task new');
  });

  it('高置信度时不启动增强（直接返回 null）', async () => {
    const r = await aiEnhance('执行任务', 80);
    expect(r).toBeNull();
  });

  it('recognizeWithAi：关键词高置信且差距大时不调用 AI', async () => {
    const r = await recognizeWithAi('执行任务', [
      { confidence: 85 },
      { confidence: 40 },
    ]);
    expect(r.usedAi).toBe(false);
    expect(r.final.confidence).toBe(85);
  });

  it('recognizeWithAi：低置信时降级结果可被采纳', async () => {
    const r = await recognizeWithAi('根据源码生成需求', [
      { confidence: 40 },
      { confidence: 30 },
    ]);
    // 无 LLM 时降级规则分析：反推句置信度 58 > 关键词 40 → 采纳降级结果
    expect(r.usedAi).toBe(true);
    expect(r.final.intent).toBe('global_reverse');
  });
});
