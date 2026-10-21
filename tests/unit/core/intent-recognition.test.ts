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
  // ── 补子任务意图（v8.3.311+：不得再被宽词误路由为新建模块任务）──
  { input: '新建一个子任务', expect: 'task_append', note: '补端子任务（曾误判 task new）', minConf: 85 },
  { input: '给 Task-021 补一个 h5 端', expect: 'task_append', note: '补端原话', minConf: 85 },
  { input: '在 Task-021 下新建一个子任务', expect: 'task_append', note: '任务下新建子任务' },
  { input: '子任务少了一个端，需要补个端', expect: 'task_append', note: '补端描述句' },
  { input: '加个子任务', expect: 'task_append', note: '加子任务口语（曾与 change 的「加」竞争）' },
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

  it('补子任务语料提取 Task 编号（--into 路由参数）', async () => {
    const results = await recognizeIntent('给 Task-021 补一个 h5 端');
    const best = results[0];
    expect(best.intent).toBe('task_append');
    expect(best.extractedParams?.task).toBe('Task-021');
  });
});

// ── v8.3.301+: 源码反推口语变体（global from-source 路由）──
// 不带「反推/逆向」字眼的反推口语，应命中 global 命令且 extractedParams.fromCode=true
const FROM_SOURCE_CASES: string[] = [
  '根据 booking-service 端生成需求文档',
  '按端生成需求',
  '从代码生成需求文档',
  '生成需求文档',
  '需求文档反推',
  '代码生成需求',
  '按模块反推需求',
  '根据代码生成需求',
  '反推文档',
  '从工程生成需求',
  '源码反推',
  '反推需求',
];

describe('from-source 反推路由（v8.3.301+）', () => {
  for (const input of FROM_SOURCE_CASES) {
    it(`${input} → global_analyze + fromCode`, async () => {
      const results = await recognizeIntent(input);
      const best = results[0];
      expect(
        best.intent,
        `前3: ${results.slice(0, 3).map(r => `${r.intent}:${r.confidence}`).join(' / ')}`,
      ).toBe('global_analyze');
      expect(best.extractedParams?.fromCode, `extractedParams: ${JSON.stringify(best.extractedParams)}`).toBe('true');
    });
  }
});

// ── v8.3.318+: 一段文档内容切分（unitize --content 路由）──
describe('内容切分参数提取（v8.3.318+）', () => {
  it('「把这段内容切分成功能单元：## 1.…」→ split-units + content/title', async () => {
    const input = '把这段内容切分成功能单元：# 消息中心\n## 1. 通知列表\n用户可以查看通知列表，支持筛选和分页。';
    const results = await recognizeIntent(input);
    const best = results[0];
    expect(best.intent).toBe('split-units');
    expect(best.extractedParams?.content).toContain('## 1. 通知列表');
    expect(best.extractedParams?.title).toBe('消息中心');
  });

  it('带 .md 路径时内容模式不抢（file 优先）', async () => {
    const input = '把这段内容切分成功能单元，文档 docs/新需求.md 如下：# 消息中心\n## 1. 通知列表';
    const results = await recognizeIntent(input);
    const best = results[0];
    expect(best.extractedParams?.file).toBe('docs/新需求.md');
    expect(best.extractedParams?.content).toBeUndefined();
  });

  it('无信号词+内容时不算内容切分（防误提取）', async () => {
    const input = '把这个需求文档切分成功能单元，包含登录注册功能';
    const results = await recognizeIntent(input);
    const best = results[0];
    expect(best?.intent).toBe('split-units');
    expect(best?.extractedParams?.content).toBeUndefined();
  });
});

// ── v8.3.337+: 「按标准文档转换/调整」→ doc2spec + normalize（默认关闭，明说才开）──
describe('按标准文档转换的 normalize 参数提取（v8.3.337+）', () => {
  it('「按标准文档转换 admin-web.docx」→ doc2spec + file + normalize', async () => {
    const results = await recognizeIntent('按标准文档转换 admin-web.docx');
    const best = results[0];
    expect(
      best.intent,
      `前3: ${results.slice(0, 3).map(r => `${r.intent}:${r.confidence}`).join(' / ')}`,
    ).toBe('doc2spec');
    expect(best.extractedParams?.file).toBe('admin-web.docx');
    expect(best.extractedParams?.normalize).toBe('true');
  });

  it('「转换文档并按标准文档调整」→ doc2spec + normalize', async () => {
    const results = await recognizeIntent('把这份需求文档转换一下，并按标准文档调整标题');
    const best = results[0];
    expect(best.intent).toBe('doc2spec');
    expect(best.extractedParams?.normalize).toBe('true');
  });

  it('「按标准文档转换某个需求文档」→ doc2spec + normalize（无文件名也要开）', async () => {
    const results = await recognizeIntent('按标准文档转换某个需求文档');
    const best = results[0];
    expect(best.intent).toBe('doc2spec');
    expect(best.extractedParams?.normalize).toBe('true');
  });

  it('普通「转换文档」不带标准文档字眼 → doc2spec 但 normalize 不开（默认关闭）', async () => {
    const results = await recognizeIntent('把这个 Word 文档转换一下');
    const best = results[0];
    expect(best.intent).toBe('doc2spec');
    expect(best.extractedParams?.normalize).toBeUndefined();
  });
});
