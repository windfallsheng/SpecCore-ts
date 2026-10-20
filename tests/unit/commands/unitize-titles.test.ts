/**
 * v8.3.334+: unitize 标题过滤——功能单元按指定标题切分
 *
 * 覆盖三层：
 *  1. filterUnitsByTitles（doc2spec）——归一化（去章节编号）双向包含匹配、未命中收集
 *  2. parseTitles（unitize）——逗号/顿号/竖线/分号多分隔符解析
 *  3. 意图识别（intent-recognition）——自然语言提取「文档+标题组」参数
 */
import { describe, it, expect, vi } from 'vitest';
import { filterUnitsByTitles } from '../../../src/commands/doc2spec';
import { parseTitles } from '../../../src/commands/unitize';

const state = vi.hoisted(() => ({ activeIteration: '' }));
vi.mock('../../../src/core/context', () => ({
  loadContext: vi.fn(async () => ({ currentIteration: state.activeIteration, currentTask: '', lastUpdated: '' })),
  detectActiveIteration: vi.fn(async () => state.activeIteration),
}));

import { recognizeIntent } from '../../../src/core/intent-recognition';

function unit(title: string) {
  return { title, level: 2, startLine: 0, endLine: 5, sourceSection: title, unitType: 'feature' as const };
}

describe('filterUnitsByTitles — 归一化包含匹配', () => {
  it('编号前缀归一化：「预订管理」命中「3.1 预订管理」「四、订单确认」', () => {
    const units = [unit('3.1 预订管理'), unit('四、订单确认'), unit('五、消息中心')];
    const { kept, dropped, unmatched } = filterUnitsByTitles(units, ['预订管理', '订单确认']);
    expect(kept.map(u => u.title)).toEqual(['3.1 预订管理', '四、订单确认']);
    expect(dropped).toEqual(['五、消息中心']);
    expect(unmatched).toEqual([]);
  });

  it('双向包含：「预订管理」命中「预订管理流程」（用户词含单元词）与「会议预订管理」（单元词含用户词）', () => {
    const units = [unit('预订管理流程'), unit('会议预订管理'), unit('签到'), unit('系统设置')];
    const { kept, unmatched } = filterUnitsByTitles(units, ['预订管理']);
    expect(kept.map(u => u.title)).toEqual(['预订管理流程', '会议预订管理']);
    expect(unmatched).toEqual([]);
  });

  it('未命中标题进入 unmatched（供 CLI 警告）', () => {
    const units = [unit('预订管理'), unit('签到')];
    const { kept, unmatched } = filterUnitsByTitles(units, ['预订管理', '不存在的章节']);
    expect(kept.length).toBe(1);
    expect(unmatched).toEqual(['不存在的章节']);
  });

  it('英文标题大小写不敏感：Booking 命中 booking-management', () => {
    const units = [unit('Booking Management'), unit('Check-In')];
    const { kept } = filterUnitsByTitles(units, ['booking']);
    expect(kept.map(u => u.title)).toEqual(['Booking Management']);
  });

  it('全空格标题不参与匹配（不误命中）', () => {
    const units = [unit('  '), unit('预订管理')];
    const { kept } = filterUnitsByTitles(units, ['预订管理']);
    expect(kept.map(u => u.title)).toEqual(['预订管理']);
  });
});

describe('parseTitles — 多分隔符解析', () => {
  it('逗号/顿号/竖线/分号/全角混用均可解析', () => {
    expect(parseTitles('预订管理,消息中心、签到|订单确认；扫码')).toEqual([
      '预订管理', '消息中心', '签到', '订单确认', '扫码',
    ]);
  });
  it('空白与空段自动剔除', () => {
    expect(parseTitles(' 预订管理 ， , 消息中心 ')).toEqual(['预订管理', '消息中心']);
  });
});

describe('意图识别 — unitize 标题过滤语料', () => {
  it('「切分 admin-web.md 里的预订管理、消息中心」→ titles', async () => {
    const results = await recognizeIntent('切分 admin-web.md 里的预订管理、消息中心');
    const best = results[0];
    expect(best.intent).toBe('split-units');
    expect(best.extractedParams?.file).toBe('admin-web.md');
    expect(best.extractedParams?.titles).toBe('预订管理,消息中心');
  });

  it('「只切 a.md 的订单确认和 b.md 的扫码签到」→ fileTitles 多文档各自标题', async () => {
    const results = await recognizeIntent('只切 a.md 的订单确认和 b.md 的扫码签到');
    const best = results[0];
    expect(best.intent).toBe('split-units');
    expect(best.extractedParams?.fileTitles).toBe('a.md:订单确认;b.md:扫码签到');
    expect(best.extractedParams?.files).toBe('a.md,b.md');
  });

  it('「切分 admin-web.md 和 h5-mobile.md」→ files 多文档无标题（不误提标题）', async () => {
    const results = await recognizeIntent('切分 admin-web.md 和 h5-mobile.md');
    const best = results[0];
    expect(best.intent).toBe('split-units');
    expect(best.extractedParams?.files).toBe('admin-web.md,h5-mobile.md');
    expect(best.extractedParams?.titles).toBeUndefined();
  });

  it('「切分 admin-web.md」→ 无 titles 无 files（不误提取）', async () => {
    const results = await recognizeIntent('切分 admin-web.md');
    const best = results[0];
    expect(best.intent).toBe('split-units');
    expect(best.extractedParams?.titles).toBeUndefined();
    expect(best.extractedParams?.files).toBeUndefined();
  });
});
