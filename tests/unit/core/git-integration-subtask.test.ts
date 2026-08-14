/**
 * 子任务级 Git 配置测试
 *
 * 测试三级回退：子任务 .meta/git-config > 迭代 PROJECT_GRAPH.md > 全局 CONSTITUTION.md > 默认值
 * 测试任务类型 → 分支类型映射
 * 测试分支名格式（含 {type}/{prefix}/{hash4} 变量）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  loadSubtaskGitConfig,
  loadGitConfig,
  TASK_TYPE_TO_BRANCH_TYPE,
  GitConfig,
} from '@/core/git-integration';

const TEST_DIR = join(process.cwd(), 'tests', '.tmp', 'git-subtask-test');

// ── Helpers ──

function setupTaskDir(taskDir: string, gitConfigContent?: string): void {
  mkdirSync(join(taskDir, '.meta'), { recursive: true });
  if (gitConfigContent) {
    writeFileSync(join(taskDir, '.meta', 'git-config'), gitConfigContent);
  }
}

function setupIteration(iterDir: string, graphContent: string): void {
  mkdirSync(join(iterDir, '000-overview'), { recursive: true });
  writeFileSync(join(iterDir, '000-overview', 'PROJECT_GRAPH.md'), graphContent);
}

function setupGlobal(constitutionContent: string): void {
  mkdirSync(join(TEST_DIR, '.speccore'), { recursive: true });
  writeFileSync(join(TEST_DIR, '.speccore', 'CONSTITUTION.md'), constitutionContent);
}

// ── Tests ──

describe('TASK_TYPE_TO_BRANCH_TYPE', () => {
  it('should map feature → feature', () => {
    expect(TASK_TYPE_TO_BRANCH_TYPE['feature']).toBe('feature');
  });

  it('should map bugfix → bugfix', () => {
    expect(TASK_TYPE_TO_BRANCH_TYPE['bugfix']).toBe('bugfix');
  });

  it('should map refactor → refactor', () => {
    expect(TASK_TYPE_TO_BRANCH_TYPE['refactor']).toBe('refactor');
  });

  it('should map research → research', () => {
    expect(TASK_TYPE_TO_BRANCH_TYPE['research']).toBe('research');
  });

  it('should return undefined for unknown types', () => {
    expect(TASK_TYPE_TO_BRANCH_TYPE['hotfix']).toBeUndefined();
  });
});

describe('loadSubtaskGitConfig', () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should return empty config when .meta/git-config does not exist', () => {
    const taskDir = join(TEST_DIR, 'Task-001');
    mkdirSync(join(taskDir, '.meta'), { recursive: true });

    const config = loadSubtaskGitConfig(taskDir);
    expect(config.branchPrefix).toBeUndefined();
    expect(config.defaultBranch).toBeUndefined();
    expect(config.branchFormat).toBeUndefined();
    expect(config.autoPull).toBeUndefined();
  });

  it('should read branchPrefix from .meta/git-config', () => {
    const taskDir = join(TEST_DIR, 'Task-001');
    setupTaskDir(taskDir, '分支前缀: 2060708\n');

    const config = loadSubtaskGitConfig(taskDir);
    expect(config.branchPrefix).toBe('2060708');
  });

  it('should read defaultBranch (源分支) from .meta/git-config', () => {
    const taskDir = join(TEST_DIR, 'Task-001');
    setupTaskDir(taskDir, '源分支: develop\n');

    const config = loadSubtaskGitConfig(taskDir);
    expect(config.defaultBranch).toBe('develop');
  });

  it('should read branchFormat from .meta/git-config', () => {
    const taskDir = join(TEST_DIR, 'Task-001');
    setupTaskDir(taskDir, '分支格式: {type}/{prefix}{name}-{hash4}\n');

    const config = loadSubtaskGitConfig(taskDir);
    expect(config.branchFormat).toBe('{type}/{prefix}{name}-{hash4}');
  });

  it('should read autoPull (true) from .meta/git-config', () => {
    const taskDir = join(TEST_DIR, 'Task-001');
    setupTaskDir(taskDir, '自动拉取: true\n');

    const config = loadSubtaskGitConfig(taskDir);
    expect(config.autoPull).toBe(true);
  });

  it('should read autoPull (开启) from .meta/git-config', () => {
    const taskDir = join(TEST_DIR, 'Task-001');
    setupTaskDir(taskDir, '自动拉取: 开启\n');

    const config = loadSubtaskGitConfig(taskDir);
    expect(config.autoPull).toBe(true);
  });

  it('should read all fields from .meta/git-config', () => {
    const taskDir = join(TEST_DIR, 'Task-001');
    setupTaskDir(taskDir, [
      '分支前缀: 2060708',
      '源分支: develop',
      '分支格式: {type}/{prefix}{name}-{hash4}',
      '自动拉取: true',
      '远程名称: upstream',
    ].join('\n'));

    const config = loadSubtaskGitConfig(taskDir);
    expect(config.branchPrefix).toBe('2060708');
    expect(config.defaultBranch).toBe('develop');
    expect(config.branchFormat).toBe('{type}/{prefix}{name}-{hash4}');
    expect(config.autoPull).toBe(true);
    expect(config.remoteName).toBe('upstream');
  });

  it('should handle Chinese colon separator', () => {
    const taskDir = join(TEST_DIR, 'Task-001');
    setupTaskDir(taskDir, '分支前缀：2060708\n源分支：develop\n');

    const config = loadSubtaskGitConfig(taskDir);
    expect(config.branchPrefix).toBe('2060708');
    expect(config.defaultBranch).toBe('develop');
  });
});

describe('loadGitConfig — defaults', () => {
  it('should return defaults when no config files exist', () => {
    // Without iteration or taskDir, should fall back to defaults
    const config = loadGitConfig();
    expect(config.defaultBranch).toBe('main');
    expect(config.branchType).toBe('feature');
    expect(config.branchPrefix).toBe('');
    expect(config.branchFormat).toBe('{type}/{prefix}{name}-{hash4}');
    expect(config.autoPull).toBe(false);
    expect(config.remoteName).toBe('origin');
    expect(config.protectedBranches).toEqual(['main', 'master']);
  });
});

describe('loadGitConfig — subtask-level override', () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should use subtask branchPrefix when set', () => {
    const taskDir = join(TEST_DIR, 'Task-001');
    setupTaskDir(taskDir, '分支前缀: 2060708\n');

    const config = loadGitConfig(undefined, taskDir);
    expect(config.branchPrefix).toBe('2060708');
  });

  it('should use subtask defaultBranch (源分支) when set', () => {
    const taskDir = join(TEST_DIR, 'Task-001');
    setupTaskDir(taskDir, '源分支: develop\n');

    const config = loadGitConfig(undefined, taskDir);
    expect(config.defaultBranch).toBe('develop');
  });

  it('should fall back to default when subtask has no git-config', () => {
    const taskDir = join(TEST_DIR, 'Task-001');
    setupTaskDir(taskDir); // no git-config file

    const config = loadGitConfig(undefined, taskDir);
    expect(config.branchPrefix).toBe('');
    expect(config.defaultBranch).toBe('main');
    expect(config.branchFormat).toBe('{type}/{prefix}{name}-{hash4}');
  });

  it('should allow partial override — subtask only sets branchPrefix, defaultBranch from default', () => {
    const taskDir = join(TEST_DIR, 'Task-001');
    setupTaskDir(taskDir, '分支前缀: 2060708\n');

    const config = loadGitConfig(undefined, taskDir);
    // branchPrefix from subtask
    expect(config.branchPrefix).toBe('2060708');
    // defaultBranch from defaults (no iteration/global set)
    expect(config.defaultBranch).toBe('main');
  });
});

describe('loadGitConfig — iteration-level override', () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should use iteration branchPrefix when subtask has none', () => {
    // Set up iteration-level config
    const iterDir = join(TEST_DIR, 'Iteration-test');
    setupIteration(iterDir, [
      '# 任务总览',
      '',
      '> 默认分支: develop',
      '> 分支前缀: ITER-PREFIX',
      '> 分支格式: {type}/{prefix}{name}-{hash4}',
      '> 自动拉取: true',
    ].join('\n'));

    // Change cwd so relative paths resolve correctly
    const origCwd = process.cwd();
    process.chdir(TEST_DIR);

    try {
      const config = loadGitConfig('test');
      expect(config.branchPrefix).toBe('ITER-PREFIX');
      expect(config.defaultBranch).toBe('develop');
      expect(config.autoPull).toBe(true);
    } finally {
      process.chdir(origCwd);
    }
  });
});

describe('loadGitConfig — three-level fallback', () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('subtask overrides iteration, iteration overrides global', () => {
    // Global
    setupGlobal([
      '# 技术宪法',
      '',
      '## Git 分支策略',
      '- 默认分支: main',
      '- 任务分支: feature/{Task-ID}',
      '- 保护分支: main, master',
    ].join('\n'));

    // Iteration
    const iterDir = join(TEST_DIR, 'Iteration-test');
    setupIteration(iterDir, [
      '# 任务总览',
      '',
      '> 默认分支: develop',
      '> 分支前缀: ITER-001',
    ].join('\n'));

    // Subtask
    const taskDir = join(iterDir, '030-tasks', 'feature', 'Task-001');
    setupTaskDir(taskDir, '分支前缀: 2060708\n源分支: release/1.0\n');

    const origCwd = process.cwd();
    process.chdir(TEST_DIR);

    try {
      const config = loadGitConfig('test', taskDir);

      // branchPrefix: subtask wins (2060708 > ITER-001 > feature)
      expect(config.branchPrefix).toBe('2060708');
      // defaultBranch: subtask wins (release/1.0 > develop > main)
      expect(config.defaultBranch).toBe('release/1.0');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('subtask partial override — inherits remaining fields from iteration', () => {
    // Iteration
    const iterDir = join(TEST_DIR, 'Iteration-test');
    setupIteration(iterDir, [
      '# 任务总览',
      '',
      '> 默认分支: develop',
      '> 分支前缀: ITER-001',
      '> 自动拉取: true',
    ].join('\n'));

    // Subtask — only sets branchPrefix
    const taskDir = join(iterDir, '030-tasks', 'feature', 'Task-002');
    setupTaskDir(taskDir, '分支前缀: SUB-002\n');

    const origCwd = process.cwd();
    process.chdir(TEST_DIR);

    try {
      const config = loadGitConfig('test', taskDir);

      // branchPrefix: subtask wins
      expect(config.branchPrefix).toBe('SUB-002');
      // defaultBranch: inherited from iteration
      expect(config.defaultBranch).toBe('develop');
      // autoPull: inherited from iteration
      expect(config.autoPull).toBe(true);
    } finally {
      process.chdir(origCwd);
    }
  });
});
