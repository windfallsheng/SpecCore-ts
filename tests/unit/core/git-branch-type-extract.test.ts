/**
 * extractBranchTypeFromBranchName 单元测试（v8.3.341+）
 *
 * 背景：该纯函数从 pr.ts 提升至 git-integration 统一导出，
 * 是 PR 目标分支按类型区分（branch_types[{type}].pr_target）的前提。
 */
import { describe, it, expect } from 'vitest';
import { extractBranchTypeFromBranchName } from '../../../src/core/git-integration';

describe('extractBranchTypeFromBranchName（v8.3.341+）', () => {
  it('任务分支提取类型段', () => {
    expect(extractBranchTypeFromBranchName('feature/api-Task-001')).toBe('feature');
    expect(extractBranchTypeFromBranchName('bugfix/admin-web-01-yudingguanli-zs')).toBe('bugfix');
    expect(extractBranchTypeFromBranchName('hotfix/fix-payment')).toBe('hotfix');
  });

  it('非任务分支（无类型段）返回 undefined', () => {
    expect(extractBranchTypeFromBranchName('main')).toBeUndefined();
    expect(extractBranchTypeFromBranchName('develop')).toBeUndefined();
    expect(extractBranchTypeFromBranchName('release/1.2')).toBe('release'); // 带 / 仍是类型段
  });

  it('首尾空白被修剪', () => {
    expect(extractBranchTypeFromBranchName('  feature/xxx  ')).toBe('feature');
  });

  it('多段分支名只取第一段', () => {
    expect(extractBranchTypeFromBranchName('feature/login/support-a')).toBe('feature');
  });
});
