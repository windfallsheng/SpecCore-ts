/**
 * 项目根定位回归测试 — v8.3.305
 *
 * 锁定：在项目任意深层子目录执行时，.speccore/ 资产（配置/宪法/迭代目录/上下文）
 * 的路径解析统一锚定到项目根（向上查找 .speccore/），修复「子目录执行找不到
 * 项目信息/端列表」的问题。
 *
 * 测试策略：构造临时夹具项目根（含 .speccore/CONSTITUTION.md），chdir 到其
 * 深层子目录（模拟 AI/用户在子目录执行 CLI），验证各路径解析仍命中项目根资产。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getProjectRoot, getIterationDir } from '@/utils/task-utils';
import { loadGitConfig } from '@/core/git-integration';

const FIXTURE_ROOT = join(process.cwd(), 'tests', '.tmp', 'subdir-resolution-test');

/** 在夹具根下构造 SpecCore 项目骨架 */
function buildFixtureProject(): void {
  mkdirSync(join(FIXTURE_ROOT, '.speccore'), { recursive: true });
  writeFileSync(
    join(FIXTURE_ROOT, '.speccore', 'CONSTITUTION.md'),
    [
      '## 项目信息',
      '- 默认分支: develop',
      '- 任务分支: feature/{Task-ID}',
    ].join('\n'),
  );
  mkdirSync(join(FIXTURE_ROOT, 'Iteration-001-test'), { recursive: true });
}

/** 进入夹具项目的深层子目录（模拟在任务子目录执行 CLI） */
function chdirToDeepSubdir(): string {
  const deepDir = join(FIXTURE_ROOT, 'Iteration-001-test', '030-tasks', 'Task-1', 'backend');
  mkdirSync(deepDir, { recursive: true });
  const origCwd = process.cwd();
  process.chdir(deepDir);
  return origCwd;
}

describe('项目根定位（v8.3.305 子目录执行修复）', () => {
  beforeEach(() => {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
    buildFixtureProject();
  });

  afterEach(() => {
    const cwd = process.cwd();
    if (cwd.startsWith(FIXTURE_ROOT)) process.chdir(join(process.cwd(), '..', '..', '..', '..', '..', '..'));
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  });

  it('深层子目录下 getProjectRoot 返回夹具项目根', () => {
    const origCwd = chdirToDeepSubdir();
    try {
      expect(getProjectRoot()).toBe(FIXTURE_ROOT);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('深层子目录下 getIterationDir 锚定项目根', () => {
    const origCwd = chdirToDeepSubdir();
    try {
      expect(getIterationDir('Iteration-001-test')).toBe(
        join(FIXTURE_ROOT, 'Iteration-001-test'),
      );
    } finally {
      process.chdir(origCwd);
    }
  });

  it('深层子目录下 loadGitConfig 读到项目根 CONSTITUTION（默认分支 develop）', () => {
    const origCwd = chdirToDeepSubdir();
    try {
      const config = loadGitConfig();
      expect(config.defaultBranch).toBe('develop');
      // v8.3.306: 「任务分支: feature/」的 feature 是类型段，写入 branchType 而非 branchPrefix
      expect(config.branchType).toBe('feature');
      expect(config.branchPrefix).toBe('');
    } finally {
      process.chdir(origCwd);
    }
  });
});
