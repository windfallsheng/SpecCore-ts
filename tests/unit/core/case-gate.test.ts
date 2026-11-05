import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFileSync } from 'fs';
import {
  extractTestCaseIds,
  buildCaseReviewSheet,
  parseCaseReview,
  formatCaseMatrix,
  writeCaseReviewReport,
  readVerdictsFromReport,
} from '../../../src/core/case-gate';

describe('extractTestCaseIds 用例编号提取（v8.3.399+）', () => {
  it('从标题锚点提取 TC-XXX（analyze 新约定），保持出现顺序', () => {
    const testMd = [
      '# 测试方案',
      '',
      '### [TC-002] 边界值校验',
      '正文...',
      '',
      '### [TC-001] 正常路径',
      '正文...',
      '',
      '## 附录',
      '### TC-003 异常路径',
    ].join('\n');
    expect(extractTestCaseIds(testMd)).toEqual(['TC-002', 'TC-001', 'TC-003']);
  });

  it('标题锚点去重保留首次', () => {
    const testMd = '### [TC-001] A\n\n### [TC-001] A 重复\n\n### [TC-002] B';
    expect(extractTestCaseIds(testMd)).toEqual(['TC-001', 'TC-002']);
  });

  it('无标题锚点时回退全文 TC-NNN 匹配（旧文档兜底）', () => {
    const testMd = '# 测试方案\n\n用例 TC-101 与 TC-102 需人工核对。';
    expect(extractTestCaseIds(testMd)).toEqual(['TC-101', 'TC-102']);
  });

  it('无任何编号时返回空（CLI 跳过核对闸）', () => {
    expect(extractTestCaseIds('# 测试方案\n\n纯文字描述，无编号。')).toEqual([]);
  });
});

describe('parseCaseReview 答卷判卷（v8.3.399+）', () => {
  const tcs = ['TC-001', 'TC-002', 'TC-003'];

  it('解析 emoji 判定答卷，过滤未知编号', () => {
    const answer = [
      'TC-001 | ✅ | src/service.ts:42 校验逻辑',
      'TC-002 | ❌ | 未找到超时重试实现',
      'TC-003 | ⚠️ | 仅覆盖正常路径',
      'TC-999 | ✅ | 瞎编的用例应被过滤',
    ].join('\n');
    const { verdicts, missing } = parseCaseReview(answer, tcs);
    expect(verdicts).toEqual([
      { id: 'TC-001', status: 'pass', evidence: 'src/service.ts:42 校验逻辑' },
      { id: 'TC-002', status: 'fail', evidence: '未找到超时重试实现' },
      { id: 'TC-003', status: 'partial', evidence: '仅覆盖正常路径' },
    ]);
    expect(missing).toEqual([]);
  });

  it('解析英文判定（pass/fail/partial，大小写不敏感）', () => {
    const answer = ['TC-001 | pass | a', 'TC-002 | FAIL | b', 'TC-003 | Partial | c'].join('\n');
    const { verdicts } = parseCaseReview(answer, tcs);
    expect(verdicts.map(v => v.status)).toEqual(['pass', 'fail', 'partial']);
  });

  it('漏卷用例计入 missing 清单（CLI 按 ❌ 计入）', () => {
    const answer = 'TC-001 | ✅ | 只有一条';
    const { verdicts, missing } = parseCaseReview(answer, tcs);
    expect(verdicts).toHaveLength(1);
    expect(missing).toEqual(['TC-002', 'TC-003']);
  });

  it('重复行去重保留首次', () => {
    const answer = ['TC-001 | ✅ | 首次', 'TC-001 | ❌ | 重复行'].join('\n');
    const { verdicts } = parseCaseReview(answer, tcs);
    expect(verdicts).toEqual([{ id: 'TC-001', status: 'pass', evidence: '首次' }]);
  });
});

describe('出卷 / 报告 / 矩阵（v8.3.399+）', () => {
  it('buildCaseReviewSheet 包含全部用例编号与回传格式示例', () => {
    const sheet = buildCaseReviewSheet('Task-001', ['TC-001', 'TC-002'], '### [TC-001] A', '/src');
    expect(sheet).toContain('Task-001');
    expect(sheet).toContain('TC-001');
    expect(sheet).toContain('TC-002');
    expect(sheet).toContain('### [TC-001] A');
    expect(sheet).toContain('TC-001 | ✅');
  });

  it('writeCaseReviewReport 落盘后 readVerdictsFromReport 可完整回读（幂等闭环）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'case-gate-'));
    const tcs = ['TC-001', 'TC-002', 'TC-003'];
    const verdicts = [
      { id: 'TC-001', status: 'pass' as const, evidence: 'a.ts:1' },
      { id: 'TC-002', status: 'fail' as const, evidence: '缺失' },
      { id: 'TC-003', status: 'partial' as const, evidence: '仅正常路径' },
    ];
    await writeCaseReviewReport(dir, 'Task-001', tcs, verdicts);
    const report = readFileSync(join(dir, 'TEST_REVIEW.md'), 'utf-8');
    const back = readVerdictsFromReport(report, tcs);
    expect(back).toEqual(verdicts);
  });

  it('readVerdictsFromReport 覆盖不全时返回 null（调用方重新核对）', () => {
    const report = [
      '# 用例核对报告 — Task-001',
      '',
      '| 用例 | 判定 | 证据 |',
      '|:---|:---|:---|',
      '| TC-001 | ✅ 通过 | a.ts:1 |',
    ].join('\n');
    expect(readVerdictsFromReport(report, ['TC-001', 'TC-002'])).toBeNull();
  });

  it('formatCaseMatrix 输出每条用例一行（判定 + 证据）', () => {
    const matrix = formatCaseMatrix([
      { id: 'TC-001', status: 'pass', evidence: 'a.ts:1' },
      { id: 'TC-002', status: 'fail', evidence: '未找到实现' },
    ]);
    expect(matrix).toContain('TC-001');
    expect(matrix).toContain('✅ 通过');
    expect(matrix).toContain('TC-002');
    expect(matrix).toContain('❌ 未实现');
  });
});
