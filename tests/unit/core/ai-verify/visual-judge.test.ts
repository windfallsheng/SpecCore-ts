/**
 * visual-judge 单元测试（v8.3.350+）
 *
 * 覆盖：待判定场景筛选 / 截图缺失与模型失败降级 / 业务断言回写 / results.json 落盘。
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { AiVerifyPlan, AiVerifyResult, AiVerifyResults } from '../../../../src/core/ai-verify/types';

// 模拟视觉模型客户端（避免真实网络调用）
vi.mock('../../../../src/core/ui-verify/visual-model-client', () => ({
  callVisualModel: vi.fn(async (_config: unknown, opts: { customPrompt?: string }) => ({
    passed: true,
    analysis: opts.customPrompt ? '截图可见预期文案，判定通过' : 'UI 质量扫描通过',
    issues: [],
  })),
  isVisualModelAvailable: vi.fn(async () => true),
}));

import { findPendingJudgements, judgeScenario, runAiJudge } from '../../../../src/core/ai-verify/visual-judge';
import { callVisualModel } from '../../../../src/core/ui-verify/visual-model-client';

const callVisualModelMock = callVisualModel as ReturnType<typeof vi.fn>;
const basePlan: AiVerifyPlan = {
  version: '1.0',
  env: 'staging',
  iteration: 'Iteration-001-demo',
  generatedAt: '2026-09-28T00:00:00.000Z',
  accountsPath: '/x/accounts.yaml',
  scenarios: [
    {
      id: '订单管理__h5__0',
      unit: '订单管理',
      platform: 'h5',
      entry: 'https://staging.example.com/h5',
      steps: ['打开入口地址'],
      expected: ['页面出现订单列表', '顶部显示登录用户昵称'],
      title: '订单管理：交互流程',
    },
  ],
  skipped: [],
  outDir: '/tmp/x',
};

let root: string;
let outDir: string;
let resultsPath: string;

function makeResults(overrides: Partial<AiVerifyResult> = {}): AiVerifyResults {
  return {
    version: '1.0',
    env: 'staging',
    executedAt: '2026-09-28T00:00:00.000Z',
    results: [
      {
        scenarioId: '订单管理__h5__0',
        unit: '订单管理',
        platform: 'h5',
        passed: false,
        judged: false,
        executor: 'playwright-mcp',
        reason: '已截图，待视觉判定',
        screenshots: ['screenshots/step-1.png'],
        ...overrides,
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  callVisualModelMock.mockResolvedValue({ passed: true, analysis: '截图可见预期文案，判定通过', issues: [] });
});

describe('findPendingJudgements', () => {
  it('judged 不为 true 且有截图 → 选中', () => {
    const pending = findPendingJudgements(makeResults());
    expect(pending.length).toBe(1);
    expect(pending[0].result.scenarioId).toBe('订单管理__h5__0');
    expect(pending[0].screenshotPaths).toEqual(['screenshots/step-1.png']);
  });

  it('judged:true → 排除；无截图 → 排除', () => {
    expect(findPendingJudgements(makeResults({ judged: true })).length).toBe(0);
    expect(findPendingJudgements(makeResults({ screenshots: [] })).length).toBe(0);
    expect(findPendingJudgements(makeResults({ screenshots: undefined })).length).toBe(0);
  });
});

describe('judgeScenario', () => {
  let result: AiVerifyResult;

  beforeEach(() => {
    result = makeResults().results[0];
    root = mkdtempSync(join(tmpdir(), 'speccore-judge-'));
    outDir = join(root, 'out');
    mkdirSync(join(outDir, 'screenshots'), { recursive: true });
    writeFileSync(join(outDir, 'screenshots', 'step-1.png'), Buffer.from('fake-png'));
    basePlan.outDir = outDir;
  });

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('业务断言通过 → 回写 executor=visual-judge / judged=true / passed', async () => {
    await judgeScenario(result, ['screenshots/step-1.png'], outDir, basePlan, { provider: 'qwen-vl' });
    expect(result.executor).toBe('visual-judge');
    expect(result.judged).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.reason).toContain('判定通过');
    // 使用自定义业务断言 prompt（预期结果注入）
    const callArgs = callVisualModelMock.mock.calls[0] as any[];
    expect(callArgs[1].customPrompt).toContain('页面出现订单列表');
    expect(callArgs[1].customPrompt).toContain('顶部显示登录用户昵称');
  });

  it('截图文件缺失 → 判定失败且不调用模型', async () => {
    await judgeScenario(result, ['screenshots/missing.png'], outDir, basePlan, { provider: 'qwen-vl' });
    expect(result.executor).toBe('visual-judge');
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('截图文件缺失');
    expect(callVisualModelMock).not.toHaveBeenCalled();
  });

  it('视觉模型调用失败 → 判定失败并记录错误', async () => {
    callVisualModelMock.mockRejectedValue(new Error('DashScope API 错误 (401)'));
    await judgeScenario(result, ['screenshots/step-1.png'], outDir, basePlan, { provider: 'qwen-vl' });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('视觉模型调用失败');
  });

  it('视觉模型判定不通过 → passed=false 且理由取自分析', async () => {
    callVisualModelMock.mockResolvedValue({ passed: false, analysis: '截图缺少预期订单列表', issues: [] });
    await judgeScenario(result, ['screenshots/step-1.png'], outDir, basePlan, { provider: 'qwen-vl' });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('截图缺少预期订单列表');
  });
});

describe('runAiJudge', () => {
  it('无待判定场景 → 返回 0 且不调用视觉模型', async () => {
    root = mkdtempSync(join(tmpdir(), 'speccore-judge-'));
    resultsPath = join(root, 'results.json');
    writeFileSync(resultsPath, JSON.stringify(makeResults({ judged: true })), 'utf-8');
    const count = await runAiJudge(resultsPath, basePlan, { provider: 'qwen-vl' });
    expect(count).toBe(0);
    expect(callVisualModelMock).not.toHaveBeenCalled();
    rmSync(root, { recursive: true, force: true });
  });

  it('待判定场景 → 判定并回写 results.json（executor 改写为 visual-judge）', async () => {
    root = mkdtempSync(join(tmpdir(), 'speccore-judge-'));
    outDir = join(root, 'out');
    mkdirSync(join(outDir, 'screenshots'), { recursive: true });
    writeFileSync(join(outDir, 'screenshots', 'step-1.png'), Buffer.from('fake-png'));
    resultsPath = join(outDir, 'results.json');
    writeFileSync(resultsPath, JSON.stringify(makeResults()), 'utf-8');
    basePlan.outDir = outDir;

    const count = await runAiJudge(resultsPath, basePlan, { provider: 'qwen-vl' });
    expect(count).toBe(1);
    const rewritten = JSON.parse(readFileSync(resultsPath, 'utf-8')) as AiVerifyResults;
    expect(rewritten.results[0].executor).toBe('visual-judge');
    expect(rewritten.results[0].judged).toBe(true);
    expect(rewritten.results[0].passed).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('视觉模型不可用 → 抛错', async () => {
    const { isVisualModelAvailable } = await import('../../../../src/core/ui-verify/visual-model-client');
    (isVisualModelAvailable as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    root = mkdtempSync(join(tmpdir(), 'speccore-judge-'));
    resultsPath = join(root, 'results.json');
    writeFileSync(resultsPath, JSON.stringify(makeResults()), 'utf-8');
    await expect(runAiJudge(resultsPath, basePlan, { provider: 'qwen-vl' })).rejects.toThrow('视觉模型不可用');
    expect(existsSync(resultsPath)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});
