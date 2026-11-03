/**
 * result-parser 单元测试（v8.3.350+）
 *
 * 覆盖：results.json 结构校验 / 场景对齐缺失检测 / 摘要统计 / HTML 报告落盘。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseAiVerifyResults,
  findMissingScenarios,
  buildReportContext,
  summarizeResults,
  generateAiVerifyReport,
} from '../../../../src/core/ai-verify/result-parser';
import type { AiVerifyPlan, AiVerifyResults } from '../../../../src/core/ai-verify/types';

let tmp: string;
let plan: AiVerifyPlan;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'speccore-report-'));
  plan = {
    version: '1.0',
    env: 'staging',
    iteration: 'Iteration-001-demo',
    generatedAt: new Date().toISOString(),
    accountsPath: join(tmp, 'accounts.yaml'),
    outDir: tmp,
    scenarios: [
      {
        id: 'a__h5__0',
        group: 'modules',
        unit: 'a',
        platform: 'h5',
        entry: 'https://staging.example.com/h5',
        account: 'staging.user',
        steps: ['打开入口'],
        expected: ['页面渲染'],
        title: '场景一',
      },
      { id: 'a__h5__1', group: 'modules', unit: 'a', platform: 'h5', entry: 'https://staging.example.com/h5', steps: [], expected: [], title: '场景二' },
      { id: 'b__h5__0', group: 'modules', unit: 'b', platform: 'h5', entry: 'https://staging.example.com/h5', steps: [], expected: [], title: '场景三' },
    ],
    skipped: [{ unit: 'c', platform: 'miniapp', reason: '环境未配置该端测试地址' }],
    // 空 groups 模拟旧剧本（无分层信息 → 报告回退按端分组渲染）
    groups: [],
  };
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('parseAiVerifyResults', () => {
  it('valid json with results array returns parsed object', async () => {
    const p = join(tmp, 'results.json');
    writeFileSync(p, JSON.stringify({ version: '1.0', env: 'staging', executedAt: 'x', results: [] }));
    const r = await parseAiVerifyResults(p);
    expect(r).not.toBeNull();
    expect(r?.results).toEqual([]);
  });

  it('missing file / bad json / missing results array all return null', async () => {
    expect(await parseAiVerifyResults(join(tmp, 'none.json'))).toBeNull();
    const bad = join(tmp, 'bad.json');
    writeFileSync(bad, '{bad json');
    expect(await parseAiVerifyResults(bad)).toBeNull();
    const noResults = join(tmp, 'no-results.json');
    writeFileSync(noResults, JSON.stringify({ version: '1.0' }));
    expect(await parseAiVerifyResults(noResults)).toBeNull();
  });
});

describe('findMissingScenarios / summarizeResults', () => {
  it('should detect scenarios absent from results', () => {
    const results: AiVerifyResults = {
      version: '1.0',
      env: 'staging',
      executedAt: 'x',
      results: [
        { scenarioId: 'a__h5__0', unit: 'a', platform: 'h5', passed: true, reason: '页面正常' },
      ],
    };
    expect(findMissingScenarios(plan, results)).toEqual(['a__h5__1', 'b__h5__0']);
  });

  it('should summarize pass/fail/skip/notRun counts', () => {
    const results: AiVerifyResults = {
      version: '1.0',
      env: 'staging',
      executedAt: 'x',
      results: [
        { scenarioId: 'a__h5__0', unit: 'a', platform: 'h5', passed: false, reason: '元素缺失' },
        { scenarioId: 'a__h5__1', unit: 'a', platform: 'h5', passed: false, skipped: true, reason: '验证码无法自动化' },
        { scenarioId: 'b__h5__0', unit: 'b', platform: 'h5', passed: true, reason: 'ok' },
      ],
    };
    const ctx = buildReportContext(plan, results);
    expect(summarizeResults(ctx)).toEqual({ total: 3, passed: 1, failed: 1, skipped: 1, notRun: 0 });
  });

  it('should count missing scenarios as notRun', () => {
    const results: AiVerifyResults = {
      version: '1.0',
      env: 'staging',
      executedAt: 'x',
      results: [
        { scenarioId: 'a__h5__0', unit: 'a', platform: 'h5', passed: true, reason: 'ok' },
      ],
    };
    expect(summarizeResults(buildReportContext(plan, results)).notRun).toBe(2);
  });
});

describe('generateAiVerifyReport', () => {
  it('should write report.html with summary, badges, skip notes and screenshots', async () => {
    const results: AiVerifyResults = {
      version: '1.0',
      env: 'staging',
      executedAt: new Date().toISOString(),
      results: [
        { scenarioId: 'a__h5__0', unit: 'a', platform: 'h5', passed: false, reason: '预期元素「订单号」未出现', screenshots: ['screenshots/a0.png'] },
        { scenarioId: 'a__h5__1', unit: 'a', platform: 'h5', passed: false, skipped: true, reason: '验证码无法自动化' },
      ],
    };
    const reportPath = await generateAiVerifyReport(buildReportContext(plan, results));
    expect(reportPath).toBe(join(tmp, 'report.html'));
    expect(existsSync(reportPath)).toBe(true);

    const html = readFileSync(reportPath, 'utf-8');
    expect(html).toContain('AI 浏览器验证报告');
    expect(html).toContain('环境: staging');
    // 总览统计
    expect(html).toContain('总场景');
    expect(html).toContain('通过');
    expect(html).toContain('失败');
    expect(html).toContain('未执行');
    // 场景卡片与判定理由
    expect(html).toContain('场景一');
    expect(html).toContain('预期元素「订单号」未出现');
    // 截图注入
    expect(html).toContain('screenshots/a0.png');
    // 生成期跳过项
    expect(html).toContain('生成期跳过项');
    expect(html).toContain('环境未配置该端测试地址');
  });

  it('v8.3.351+：剧本含 groups 时报告按层渲染（公共能力层在前，关闭层标注）', async () => {
    const commonScenario = {
      id: 'common__h5__0',
      group: 'common' as const,
      unit: 'common',
      platform: 'h5',
      entry: 'https://staging.example.com/h5',
      steps: ['打开入口'],
      expected: ['页面可访问'],
      title: '公共能力：入口可达性检查（h5）',
    };
    const layeredPlan: AiVerifyPlan = {
      ...plan,
      scenarios: [
        commonScenario,
        ...plan.scenarios.map((s) => ({ ...s, group: 'modules' as const })),
      ],
      groups: [
        { id: 'common', label: '公共能力层', enabled: true, scenarios: [commonScenario], note: '先于模块层执行' },
        { id: 'modules', label: '模块层', enabled: true, scenarios: plan.scenarios.map((s) => ({ ...s, group: 'modules' as const })), note: '逐单元推进' },
      ],
    };
    const results: AiVerifyResults = {
      version: '1.0',
      env: 'staging',
      executedAt: new Date().toISOString(),
      results: [
        { scenarioId: 'common__h5__0', unit: 'common', platform: 'h5', passed: true, reason: '入口正常' },
        { scenarioId: 'a__h5__0', unit: 'a', platform: 'h5', passed: true, reason: 'ok' },
      ],
    };
    const reportPath = await generateAiVerifyReport(buildReportContext(layeredPlan, results));
    const html = readFileSync(reportPath, 'utf-8');
    // 层头与顺序
    expect(html).toContain('公共能力层');
    expect(html).toContain('模块层');
    expect(html.indexOf('公共能力层')).toBeLessThan(html.indexOf('模块层'));
    // 层说明
    expect(html).toContain('先于模块层执行');
    // 公共层场景卡片
    expect(html).toContain('公共能力：入口可达性检查（h5）');
  });

  it('v8.3.351+：关闭层标注「已关闭」，无场景层显示提示', async () => {
    const layeredPlan: AiVerifyPlan = {
      ...plan,
      groups: [
        { id: 'common', label: '公共能力层', enabled: false, scenarios: [] },
        { id: 'modules', label: '模块层', enabled: true, scenarios: plan.scenarios.map((s) => ({ ...s, group: 'modules' as const })) },
      ],
    };
    const results: AiVerifyResults = {
      version: '1.0',
      env: 'staging',
      executedAt: new Date().toISOString(),
      results: [{ scenarioId: 'a__h5__0', unit: 'a', platform: 'h5', passed: true, reason: 'ok' }],
    };
    const reportPath = await generateAiVerifyReport(buildReportContext(layeredPlan, results));
    const html = readFileSync(reportPath, 'utf-8');
    expect(html).toContain('公共能力层（⏭️ 已关闭）');
    expect(html).toContain('（本层无场景）');
  });
});
