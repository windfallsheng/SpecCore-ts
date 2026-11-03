/**
 * v8.3.368: 时间戳坟头排除规则回归测试
 *
 * safeWrite 归档机制上线前的旧版「平铺改名」备份（如 CODE_INDEX-20260923065735.md）
 * 会污染 INDEX.md / TOC / RAG 索引；isTombstoneFile 负责判定并排除。
 */
import { describe, it, expect } from 'vitest';
import { isTombstoneFile } from '../../../src/core/reindex-engine';

describe('isTombstoneFile — 时间戳坟头判定', () => {
  it('识别 14 位时间戳坟头（旧版 safeWrite 平铺备份）', () => {
    expect(isTombstoneFile('CODE_INDEX-20260923065735.md')).toBe(true);
    expect(isTombstoneFile('TECH_STACK-20261103051435.md')).toBe(true);
    expect(isTombstoneFile('REQUIREMENT-20260923065837.md')).toBe(true);
  });

  it('放行正本与普通文档', () => {
    expect(isTombstoneFile('CODE_INDEX.md')).toBe(false);
    expect(isTombstoneFile('TECH_STACK.md')).toBe(false);
    expect(isTombstoneFile('REQUIREMENT.md')).toBe(false);
    expect(isTombstoneFile('ARCHITECTURE.md')).toBe(false);
    expect(isTombstoneFile('01-common.md')).toBe(false);
  });

  it('放行非 .md 后缀与短数字串', () => {
    expect(isTombstoneFile('CODE_INDEX-20260923065735.txt')).toBe(false);
    expect(isTombstoneFile('v2026-001.md')).toBe(false);
    expect(isTombstoneFile('20261103.md')).toBe(false);
  });
});
