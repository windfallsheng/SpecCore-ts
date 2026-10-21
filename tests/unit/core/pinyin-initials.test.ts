/**
 * pinyin-initials 单元测试（v8.3.337+）
 *
 * 覆盖姓名 → 拼音首字母串（Git 分支后缀兜底）：
 * - 中文名逐字取拼音首字母（张三 → zs、张三丰 → zsf）
 * - 英文名取单词首字母小写（John → j）
 * - 混合名逐段处理（张三 John → zsj）
 * - 空串/纯符号 → 空串（不拼后缀）
 */
import { describe, it, expect } from 'vitest';
import { toPinyinInitials } from '../../../src/core/pinyin-initials';

describe('toPinyinInitials', () => {
  it('中文名逐字取拼音首字母', () => {
    expect(toPinyinInitials('张三')).toBe('zs');
    expect(toPinyinInitials('张三丰')).toBe('zsf');
  });

  it('英文名取单词首字母小写', () => {
    expect(toPinyinInitials('John')).toBe('j');
    expect(toPinyinInitials('Alice Wang')).toBe('aw');
  });

  it('混合名逐段处理', () => {
    expect(toPinyinInitials('张三 John')).toBe('zsj');
  });

  it('空串/纯符号返回空串', () => {
    expect(toPinyinInitials('')).toBe('');
    expect(toPinyinInitials('   ')).toBe('');
    expect(toPinyinInitials('---')).toBe('');
  });

  it('前后空白裁剪', () => {
    expect(toPinyinInitials('  李四  ')).toBe('ls');
  });
});
