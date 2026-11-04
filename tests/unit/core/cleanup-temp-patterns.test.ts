/**
 * 临时文件识别模式回归基线（v8.3.383+）
 *
 * isTempFile 判定文件是否属于「临时文件」——analyze/execute/taskify 收尾自动清理
 * 与 speccore cleanup 均依赖此判定。v8.3.383 扩展 .tmp-/.temp- 前缀模式，
 * 覆盖宿主 AI 接力时在项目根自创的中转文件（.temp-iter-req-xxx.md 等），
 * 并锁定「正常文件不误杀」边界。
 */

import { describe, it, expect } from 'vitest';
import { isTempFile } from '../../../src/commands/cleanup';

describe('isTempFile 临时文件识别', () => {
  it('v8.3.383+: 宿主 AI 接力中转文件命中（.temp-iter-req-xxx.md 等）', () => {
    expect(isTempFile('.temp-iter-req-014-analysis.md')).toBe(true);
    expect(isTempFile('.temp-iter-req-request.json')).toBe(true);
    expect(isTempFile('.temp-iter-req')).toBe(true);
    expect(isTempFile('.temp-analyze-outline.md')).toBe(true);
  });

  it('v8.3.383+: .tmp- 前缀散落文件命中', () => {
    expect(isTempFile('.tmp-export.md')).toBe(true);
    expect(isTempFile('.tmp-merge-014.md')).toBe(true);
  });

  it('既有 .tmp_ 前缀模式不回归', () => {
    expect(isTempFile('.tmp_export.md')).toBe(true);
    expect(isTempFile('.tmp_export_single.md')).toBe(true);
    expect(isTempFile('.tmp_something')).toBe(true);
  });

  it('正常文件不误杀', () => {
    expect(isTempFile('TECH.md')).toBe(false);
    expect(isTempFile('REQUIREMENT.md')).toBe(false);
    expect(isTempFile('temp-notes.md')).toBe(false); // 无前导点，用户文档
    expect(isTempFile('temperature-data.json')).toBe(false);
    expect(isTempFile('.speccore.yml')).toBe(false);
    expect(isTempFile('.gitignore')).toBe(false);
    expect(isTempFile('package.json')).toBe(false);
  });

  it('目录名不误杀（仅文件名参与判定）', () => {
    expect(isTempFile('.temp')).toBe(false); // 目录名，非临时文件命名
    expect(isTempFile('.tmp')).toBe(false);
  });
});
