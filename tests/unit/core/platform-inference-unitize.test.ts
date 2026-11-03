/**
 * platform-inference v8.3.362+ 切分后端分析（方案 A）单测
 * 覆盖：空声明自动回写 / 单端超集检测不覆盖 / 前四层无果 pending / AI 确认回写全字段
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  analyzeUnitPlatformsAfterUnitize,
  persistConfirmedUnitMatrix,
} from '../../../src/core/platform-inference';

const ALL = ['booking-service', 'admin-web', 'h5-mobile'];

const EMPTY_MATRIX = '# t - 端覆盖矩阵\n\nfeature: t\ntype: feature\nplatforms:\n  []\nclarify: needed\nowners: []\ndependencies: []\napis: []\n';

function makeUnit(featuresDir: string, name: string, matrix: string, source: string): string {
  const dir = join(featuresDir, name);
  mkdirSync(join(dir, '.meta'), { recursive: true });
  writeFileSync(join(dir, '_matrix.md'), matrix, 'utf-8');
  writeFileSync(join(dir, 'SOURCE.md'), source, 'utf-8');
  return dir;
}

describe('platform-inference 切分后端分析（v8.3.362）', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'pi-unitize-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('声明为空时六层推断自动回写 _matrix', async () => {
    const featuresDir = join(root, 'features');
    makeUnit(featuresDir, 'unit-01', EMPTY_MATRIX, '# 订单履约\n\n提供订单创建接口，操作数据表 order。');
    const r = await analyzeUnitPlatformsAfterUnitize(featuresDir, ['unit-01'], ALL);
    expect(r.autoWritten.length).toBe(1);
    expect(r.autoWritten[0].platforms).toEqual(['booking-service']);
    expect(r.autoWritten[0].source).toBe('keyword');
    const content = readFileSync(join(featuresDir, 'unit-01', '_matrix.md'), 'utf-8');
    expect(content).toContain('- booking-service');
    expect(r.pending.length).toBe(0);
  });

  it('已声明单端且检出额外端 → expandCandidates，不覆盖声明', async () => {
    const featuresDir = join(root, 'features');
    const matrix = EMPTY_MATRIX.replace('platforms:\n  []', 'platforms:\n  - admin-web');
    makeUnit(featuresDir, 'unit-02', matrix, '# 用户数据同步\n\n提供用户服务接口，操作数据表 user，定时任务刷新缓存。');
    const r = await analyzeUnitPlatformsAfterUnitize(featuresDir, ['unit-02'], ALL);
    expect(r.autoWritten.length).toBe(0);
    expect(r.expandCandidates.length).toBe(1);
    expect(r.expandCandidates[0].extra).toEqual(['booking-service']);
    const content = readFileSync(join(featuresDir, 'unit-02', '_matrix.md'), 'utf-8');
    expect(content).toContain('- admin-web');
    expect(content).not.toContain('booking-service');
  });

  it('前四层无果 → pending + AI 判断 prompt', async () => {
    const featuresDir = join(root, 'features');
    makeUnit(featuresDir, 'unit-03', EMPTY_MATRIX, '# 神秘功能\n\n一段没有任何端特征的需求描述。');
    const r = await analyzeUnitPlatformsAfterUnitize(featuresDir, ['unit-03'], ALL);
    expect(r.autoWritten.length).toBe(0);
    expect(r.pending.length).toBe(1);
    expect(r.pending[0].aiPrompt).toContain('请判断功能单元');
    expect(r.pending[0].aiPrompt).toContain('booking-service');
  });

  it('persistConfirmedUnitMatrix 回写 platforms + dependencies + apis', async () => {
    const featuresDir = join(root, 'features');
    const dir = makeUnit(featuresDir, 'unit-04', EMPTY_MATRIX, '# x\n\ny');
    const ok = await persistConfirmedUnitMatrix(dir, ['admin-web', 'booking-service'], ['unit-01'], ['POST /api/orders']);
    expect(ok).toBe(true);
    const content = readFileSync(join(dir, '_matrix.md'), 'utf-8');
    expect(content).toContain('- admin-web');
    expect(content).toContain('- booking-service');
    expect(content).toContain('dependencies:\n  - unit-01');
    expect(content).toContain('apis:\n  - POST /api/orders');
  });
});
