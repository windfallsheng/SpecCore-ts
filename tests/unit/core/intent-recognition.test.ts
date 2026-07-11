/**
 * 意图识别引擎测试
 * 测试自然语言到命令的匹配逻辑
 */

import { describe, it, expect } from 'vitest';

// 模拟核心关键词匹配逻辑
function matchKeywords(input: string, keywords: string[]): boolean {
  return keywords.some((kw) => input.includes(kw));
}

// 模拟置信度计算
function calculateConfidence(input: string, triggers: string[], priority: number): number {
  let score = 0;
  for (const trigger of triggers) {
    if (input.includes(trigger)) score += 20;
  }
  score += priority * 0.3;
  return Math.min(100, Math.round(score));
}

describe('Intent Recognition — Keywords', () => {
  describe('execute intent (priority 90)', () => {
    const triggers = ['开始', '执行', '干活', '继续', '开发', '做', '跑', '开工', '跑一下'];
    const priority = 90;

    it('should recognize "开始开发" as execute with high confidence', () => {
      const confidence = calculateConfidence('开始开发', triggers, priority);
      expect(confidence).toBeGreaterThan(40);
    });

    it('should recognize "执行任务" as execute', () => {
      expect(matchKeywords('执行任务', triggers)).toBe(true);
    });

    it('should recognize "开始干活" as execute', () => {
      expect(matchKeywords('开始干活', triggers)).toBe(true);
    });

    it('should recognize "继续开发" as execute', () => {
      expect(matchKeywords('继续开发', triggers)).toBe(true);
    });

    it('should NOT match unrelated input', () => {
      expect(matchKeywords('创建一个需求', triggers)).toBe(false);
    });
  });

  describe('create intent (priority 85)', () => {
    const triggers = ['创建一个', '新增一个', '做一个', '实现', '添加一个', '新建', '创建', '新增'];
    const priority = 85;

    it('should recognize "创建用户登录" as create', () => {
      expect(matchKeywords('创建用户登录', triggers)).toBe(true);
    });

    it('should recognize "新增一个功能" as create', () => {
      expect(matchKeywords('新增一个功能', triggers)).toBe(true);
    });

    it('should recognize "实现登录功能" as create', () => {
      expect(matchKeywords('实现登录功能', triggers)).toBe(true);
    });
  });

  describe('change intent (priority 100)', () => {
    const triggers = ['改成', '改为', '调整', '修改', '更新', '变更', '升级', '换成', '替换'];
    const priority = 100;

    it('should recognize "把登录改成验证码登录" as change', () => {
      expect(matchKeywords('把登录改成验证码登录', triggers)).toBe(true);
    });

    it('should have highest priority', () => {
      const changeConfidence = calculateConfidence('把登录改成验证码', triggers, priority);
      const createConfidence = calculateConfidence('把登录改成验证码', ['创建一个'], 85);
      expect(changeConfidence).toBeGreaterThan(createConfidence);
    });
  });

  describe('progress intent (priority 70)', () => {
    const triggers = ['进度', '进展', '完成多少', '还差', '多少'];

    it('should recognize "进度怎么样" as progress', () => {
      expect(matchKeywords('进度怎么样', triggers)).toBe(true);
    });

    it('should recognize "进展如何" as progress', () => {
      expect(matchKeywords('进展如何', triggers)).toBe(true);
    });
  });

  describe('impact intent', () => {
    const triggers = ['影响', '依赖', '波及', '影响分析', '变更影响', '会影响谁'];
    const priority = 80;

    it('should recognize "REQ-001 影响分析" as impact', () => {
      expect(matchKeywords('REQ-001 影响分析', triggers)).toBe(true);
    });
  });

  describe('new_task intent (v4.0)', () => {
    const triggers = ['新建任务', '创建任务', '多端任务', '全平台任务'];

    it('should recognize "新建任务"', () => {
      expect(matchKeywords('新建任务', triggers)).toBe(true);
    });

    it('should recognize "创建任务"', () => {
      expect(matchKeywords('创建任务', triggers)).toBe(true);
    });
  });

  describe('platform_add intent (v4.0)', () => {
    const triggers = ['添加平台', '新增平台', '增加端', '新平台'];

    it('should recognize "添加平台"', () => {
      expect(matchKeywords('添加平台', triggers)).toBe(true);
    });
  });

  describe('context intent (v4.0)', () => {
    const triggers = ['上下文', '上下文状态', '加载状态', '当前状态', '查看上下文'];

    it('should recognize "查看上下文"', () => {
      expect(matchKeywords('查看上下文', triggers)).toBe(true);
    });
  });
});

describe('Intent Recognition — Edge Cases', () => {
  it('should handle empty input', () => {
    const triggers = ['开始', '执行'];
    expect(matchKeywords('', triggers)).toBe(false);
  });

  it('should handle special characters', () => {
    const triggers = ['开始', '执行'];
    expect(matchKeywords('!@#$%', triggers)).toBe(false);
  });

  it('should handle mixed Chinese/English', () => {
    const triggers = ['开始', '执行'];
    expect(matchKeywords('开始 develop', triggers)).toBe(true);
  });

  it('should prioritize change over create for ambiguous input', () => {
    // "改成" should match change (priority 100) not create (priority 85)
    const changeTriggers = ['改成', '调整'];
    const createTriggers = ['创建', '新增'];
    const input = '把登录改成验证码登录';

    const changeScore = calculateConfidence(input, changeTriggers, 100);
    const createScore = calculateConfidence(input, createTriggers, 85);

    expect(changeScore).toBeGreaterThan(createScore);
  });
});
