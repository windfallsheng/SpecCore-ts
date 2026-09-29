/**
 * 意图识别引擎回归基线（v8.3.287+）
 *
 * 直接测试真实 recognizeIntent 引擎（不再用本地模拟函数），
 * 固化口语语料：误判原话 + 虚词隔断 + 宽 trigger 抢分 + 锚点让位等场景。
 *
 * v8.3.287 配套机制：
 *   - 虚词归一化（「一下/一个/帮我」剥离后词组 trigger 恢复连续命中）
 *   - 名词锚点共现表（迭代/项目/任务/功能/文档锚点 + 反向让位）
 *   - 宽触发词降权（≤2 字 20→12）
 *   - 迭代工作意图集统一 +15 上下文加成
 *   - 同 command 候选去重
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock 上下文层：activeIteration 可切换，避免测试环境 context.json 状态干扰
const state = vi.hoisted(() => ({ activeIteration: '' }));

vi.mock('../../../src/core/context', () => ({
  loadContext: vi.fn(async () => ({
    currentIteration: state.activeIteration,
    currentTask: '',
    lastUpdated: '',
  })),
  detectActiveIteration: vi.fn(async () => state.activeIteration),
}));

import { recognizeIntent } from '../../../src/core/intent-recognition';

interface CorpusCase {
  input: string;
  expect: string;
  note: string;
  minConf?: number; // 最低置信度断言（high 场景默认 85，其余默认 40）
}

// 核心语料：两种迭代模式下意图都不应变（上下文 +15 是全局平移）
// minConf 语义：修复目标句要求 high（≥85 免确认直接执行）；常规语料 medium 即可
// （40-85 弹确认是 ask 引擎的设计行为，不是 bug）
const COMMON_CASES: CorpusCase[] = [
  // ── 误判原话（v8.3.286 修复，287 加固回归）──
  { input: '新建一个迭代，主要做会议系统的初次功能建设', expect: 'iteration_create', note: '误判原话1（曾判 execute）', minConf: 85 },
  { input: 'speccore iteration create 创建一个新迭代，主题是会议系统的初次功能建设', expect: 'iteration_create', note: '误判原话2（曾判 task new）', minConf: 85 },
  // ── 虚词隔断修复 ──
  { input: '导入一下文档', expect: 'doc2spec', note: '「一下」隔断「导入文档」', minConf: 85 },
  { input: '拆分一下任务', expect: 'split', note: '「一下」隔断「拆分任务」', minConf: 85 },
  { input: '分析一下需求', expect: 'analyze', note: '「一下」隔断「分析需求」', minConf: 85 },
  { input: '切一下需求文档', expect: 'split-units', note: '「一下」隔断「切需求」' },
  { input: '帮我新建一个迭代做会员体系', expect: 'iteration_create', note: '客气词+量词双隔断', minConf: 85 },
  { input: '创建一个任务', expect: 'new_task', note: '「一个」隔断「创建任务」，归一化恢复', minConf: 85 },
  { input: '把这份需求整理成 PRD', expect: 'req_doc', note: '量词「一份」剥离后触发' },
  // ── 宽 trigger 抢分修复 ──
  { input: '做一个支付模块', expect: 'create', note: '曾被执行层的「做」抢走', minConf: 85 },
  { input: '创建一个用户登录功能', expect: 'create', note: '通用创建不受锚点误伤', minConf: 85 },
  { input: '新建任务，做一个支付模块', expect: 'new_task', note: 'XX任务短语让位后多端任务优先', minConf: 85 },
  // ── 锚点让位保护 ──
  { input: '创建登录迭代的功能模块', expect: 'create', note: '迭代作定语不触发迭代锚点', minConf: 85 },
  { input: '创建一个项目计划', expect: 'create', note: '项目作定语不触发项目锚点', minConf: 85 },
  { input: '新建项目', expect: 'init', note: '项目宾语锚点夺回' },
  { input: '创建一个项目', expect: 'init', note: '项目宾语锚点夺回（带量词）' },
  { input: '创建sprint 2026-Q4', expect: 'iteration_create', note: 'sprint 说法', minConf: 85 },
  { input: '开一个新的迭代做会员体系', expect: 'iteration_create', note: '开新迭代口语', minConf: 85 },
  // ── 常规意图回归 ──
  { input: '执行当前迭代的任务', expect: 'execute', note: '执行任务' },
  { input: '帮我分析一下当前迭代的需求', expect: 'analyze', note: '分析需求' },
  { input: '用 speccore 拆分本迭代的任务', expect: 'split', note: '拆分任务' },
  { input: '检查一下这个需求有什么遗漏', expect: 'review', note: '检查需求' },
  { input: '全局分析项目架构', expect: 'global_analyze', note: '全局分析（不进迭代上下文加成）' },
  { input: '回滚到上一个版本', expect: 'baseline', note: '基线回滚' },
];

// 仅在活跃迭代模式下有意义的语料（无迭代时 execute/query_progress 会 -20 降权）
const ACTIVE_ITERATION_CASES: CorpusCase[] = [
  { input: '汇总一下进度', expect: 'query_progress', note: '进度查询', minConf: 40 },
  { input: '看看进度', expect: 'query_progress', note: '进度查看', minConf: 40 },
];

async function runCase({ input, expect: expectedIntent, note, minConf }: CorpusCase, withIteration: boolean) {
  state.activeIteration = withIteration ? 'Iteration-013-meeting-system' : '';
  const results = await recognizeIntent(input);
  const best = results[0];
  const threshold = minConf ?? 40; // 默认 medium 线（40-85 弹确认是设计行为）
  const context = withIteration ? '有活跃迭代' : '无活跃迭代';
  return { input, expectedIntent, note, best, threshold, context, results };
}

for (const withIteration of [false, true]) {
  describe(`recognizeIntent 回归（${withIteration ? '有' : '无'}活跃迭代）`, () => {
    for (const c of COMMON_CASES) {
      it(`${c.input} → ${c.expect}（${c.note}）`, async () => {
        const { best, threshold } = await runCase(c, withIteration);
        expect(best.intent, `期望 ${c.expect}，实得 ${best.intent}(${best.confidence}%)，前3: ${(await recognizeIntent(c.input)).slice(0, 3).map(r => `${r.intent}:${r.confidence}`).join(' / ')}`).toBe(c.expect);
        expect(best.confidence).toBeGreaterThanOrEqual(threshold);
      });
    }
  });
}

describe('recognizeIntent 回归（仅活跃迭代）', () => {
  for (const c of ACTIVE_ITERATION_CASES) {
    it(`${c.input} → ${c.expect}（${c.note}）`, async () => {
      const { best, threshold } = await runCase(c, true);
      expect(best.intent).toBe(c.expect);
      expect(best.confidence).toBeGreaterThanOrEqual(threshold);
    });
  }
});

describe('recognizeIntent 去重与排序', () => {
  beforeEach(() => {
    state.activeIteration = '';
  });

  it('同 (intent, command) 对只保留一个候选（analyze 双映射真重复）', async () => {
    const results = await recognizeIntent('分析一下需求');
    const analyzeCandidates = results.filter(
      (r) => r.intent === 'analyze' && r.command === 'analyze'
    );
    expect(analyzeCandidates.length).toBeLessThanOrEqual(1);
  });

  it('不同意图共享命令名时必须共存（create 不吞掉 new_task）', async () => {
    const results = await recognizeIntent('新建任务，做一个支付模块');
    const intents = results.map((r) => r.intent);
    expect(intents).toContain('new_task');
    expect(intents).toContain('create');
  });

  it('结果按置信度降序排列', async () => {
    const results = await recognizeIntent('新建一个迭代，主要做会议系统的初次功能建设');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].confidence).toBeGreaterThanOrEqual(results[i].confidence);
    }
  });
});
