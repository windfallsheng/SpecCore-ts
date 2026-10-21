/**
 * unit-staffing 通配语义测试（v8.3.339+）
 * 覆盖：normalizeWildcard 归一 / isWildcard 判定 / matchDirection 恒命中 /
 * parseStaffingTable 解析归一 / deriveOwnerCandidates 防唯一误判
 */
import { describe, it, expect } from 'vitest';
import {
  matchDirection,
  WILDCARD,
  normalizeWildcard,
  isWildcard,
  parseStaffingTable,
  deriveOwnerCandidates,
} from '../../../src/core/unit-staffing';

describe('通配语义（v8.3.339+: 岗位/方向 * = 全部）', () => {
  it('normalizeWildcard 归一：通配词整体归一为 [WILDCARD]', () => {
    expect(normalizeWildcard(['*'])).toEqual(['*']);
    expect(normalizeWildcard(['all'])).toEqual(['*']);
    expect(normalizeWildcard(['ALL'])).toEqual(['*']);
    expect(normalizeWildcard(['全部'])).toEqual(['*']);
    expect(normalizeWildcard(['所有'])).toEqual(['*']);
    expect(normalizeWildcard(['不限'])).toEqual(['*']);
    expect(normalizeWildcard(['全栈'])).toEqual(['*']);
    expect(normalizeWildcard(['全端'])).toEqual(['*']);
    expect(normalizeWildcard(['web', '全部'])).toEqual(['*']);
    expect(normalizeWildcard(['web', '后端'])).toEqual(['web', '后端']);
    expect(normalizeWildcard([])).toEqual([]);
  });

  it('isWildcard 只认归一后的 [WILDCARD]', () => {
    expect(isWildcard(['*'])).toBe(true);
    expect(isWildcard(['web'])).toBe(false);
    expect(isWildcard([])).toBe(false);
    expect(isWildcard(['*', 'web'])).toBe(false);
  });

  it('matchDirection 通配恒命中', () => {
    expect(matchDirection('booking-service', WILDCARD)).toBe(true);
    expect(matchDirection('admin-web', WILDCARD)).toBe(true);
    expect(matchDirection('miniapp', WILDCARD)).toBe(true);
  });

  it('parseStaffingTable 解析时归一 roles/directions 通配', () => {
    const members = parseStaffingTable([
      '| 成员 | 岗位 | 平台方向 | 投入比例 |',
      '| :--- | :--- | :--- | :--- |',
      '| 张三 | 全栈 | * | 80% |',
      '| 李四 | web | all | 70% |',
      '| 王五 | web, 后端 | 后台 | 60% |',
    ].join('\n'));
    expect(members[0].roles).toEqual(['*']);
    expect(members[0].directions).toEqual(['*']);
    expect(members[1].roles).toEqual(['web']);
    expect(members[1].directions).toEqual(['*']);
    expect(members[2].roles).toEqual(['web', '后端']);
    expect(members[2].directions).toEqual(['后台']);
  });

  it('deriveOwnerCandidates 通配成员不参与「唯一」判定（防唯一误判）', () => {
    const staffing = [
      { name: '全栈甲', directions: ['*'], capacity: 50 },
      { name: '张三', directions: ['后台'], capacity: 80 },
    ];
    const decls = deriveOwnerCandidates(['booking-service', 'h5-mobile'], staffing);
    expect(decls).toHaveLength(1);
    expect(decls[0]).toEqual({ platform: 'booking-service', name: '张三', status: 'pending' });
  });

  it('deriveOwnerCandidates 只有通配成员 → 全部不推导（报缺不脑补）', () => {
    const staffing = [{ name: '全栈甲', directions: ['全部'], capacity: 50 }];
    expect(deriveOwnerCandidates(['booking-service', 'h5-mobile'], staffing)).toEqual([]);
  });
});
