/**
 * 分支名与子任务 ID 一致性回归基线（v8.3.306）
 *
 * 背景：CONSTITUTION「任务分支: feature/{Task-ID}」中的 feature 是**分支类型段**，
 * 但旧版解析端把它误存为 branchPrefix，taskify 又将其固化进子任务 git-config
 * 「分支前缀: feature」，execute 拼接时 {type} 与 {prefix} 重复，产出
 * `feature/feature-Task-033-21-h5`——与子任务 ID（Task-033-21-h5）不一致。
 *
 * 本测试锁定两层修复：
 *   1. 解析端：标准类型名写入 branchType，自定义值（兼容保留）仍入 branchPrefix
 *   2. 拼接端：branchPrefix 与类型段相同（存量 git-config 固化值）时去重跳过
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadGitConfig, composeBranchName, GitConfig } from '@/core/git-integration';

const TEST_DIR = join(process.cwd(), 'tests', '.tmp', 'git-branch-name-test');

function setupConstitution(content: string): void {
  mkdirSync(join(TEST_DIR, '.speccore'), { recursive: true });
  writeFileSync(join(TEST_DIR, '.speccore', 'CONSTITUTION.md'), content);
}

function baseGitConfig(): GitConfig {
  return {
    defaultBranch: 'main',
    branchType: 'feature',
    branchPrefix: '',
    branchFormat: '{type}/{prefix}{taskId}',
    autoPull: false,
    remoteName: 'origin',
    protectedBranches: ['main', 'master'],
    mergeDependencies: 'auto',
    mergeWhitelist: [],
    mergeBlacklist: [],
  };
}

describe('loadGitConfig — 「任务分支: X/{Task-ID}」类型段语义矫正', () => {
  let origCwd: string;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    origCwd = process.cwd();
    process.chdir(TEST_DIR);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('标准类型名 feature → 写入 branchType，不再污染 branchPrefix', () => {
    setupConstitution('# 项目宪法\n\n## Git 分支策略\n- 任务分支: feature/{Task-ID}\n');
    const cfg = loadGitConfig();
    expect(cfg.branchType).toBe('feature');
    expect(cfg.branchPrefix).toBe('');
  });

  it('标准类型名 hotfix → 写入 branchType', () => {
    setupConstitution('# 项目宪法\n\n## Git 分支策略\n- 任务分支: hotfix/{Task-ID}\n');
    const cfg = loadGitConfig();
    expect(cfg.branchType).toBe('hotfix');
    expect(cfg.branchPrefix).toBe('');
  });

  it('自定义值 dev（兼容保留）→ 仍入 branchPrefix', () => {
    setupConstitution('# 项目宪法\n\n## Git 分支策略\n- 任务分支: dev/{Task-ID}\n');
    const cfg = loadGitConfig();
    expect(cfg.branchPrefix).toBe('dev');
  });
});

describe('composeBranchName — 分支名主体 = taskId（与子任务 ID 一致）', () => {
  const TASK_ID = 'Task-033-21-h5';

  it('存量 git-config 固化 branchPrefix=feature 时去重，输出 feature/Task-033-21-h5', () => {
    const cfg = baseGitConfig();
    cfg.branchPrefix = 'feature'; // 旧版 taskify 从 CONSTITUTION 误解析后固化的值
    const name = composeBranchName(cfg, 'feature', TASK_ID, '2.1-用户管理-h5');
    expect(name).toBe(`feature/${TASK_ID}`);
    expect(name).not.toContain('feature/feature');
  });

  it('默认配置（无任何前缀）→ {type}/{taskId}', () => {
    const cfg = baseGitConfig();
    const name = composeBranchName(cfg, 'feature', TASK_ID, '');
    expect(name).toBe(`feature/${TASK_ID}`);
  });

  it('自定义 branchPrefix=api-（≠类型段）→ 保留前缀 feature/api-Task-033-21-h5', () => {
    const cfg = baseGitConfig();
    cfg.branchPrefix = 'api-';
    const name = composeBranchName(cfg, 'feature', TASK_ID, '');
    expect(name).toBe(`feature/api-${TASK_ID}`);
  });

  it('taskPrefix/taskSuffix 路径不受影响 → hotfix/api-Task-001-urgent', () => {
    const cfg = baseGitConfig();
    cfg.taskPrefix = 'api-';
    cfg.taskSuffix = '-urgent';
    const name = composeBranchName(cfg, 'hotfix', 'Task-001', '');
    expect(name).toBe('hotfix/api-Task-001-urgent');
  });

  it('v8.3.340+: 新式子任务 ID（模块目录名）作分支主体，不拼端名', () => {
    // 子任务 ID = Task-{模块名}（generateSubtaskId），多端同名分处不同端目录，
    // 分支名主体 = 子任务 ID，端名不再拼入；重名时由 createTaskBranch 拼 -hash4 兜底
    const cfg = baseGitConfig();
    const moduleSubtaskId = 'Task-admin-web-01-yudingguanli';
    const name = composeBranchName(cfg, 'feature', moduleSubtaskId, '');
    expect(name).toBe(`feature/${moduleSubtaskId}`);
    expect(name).not.toMatch(/-h5-mobile$|-booking-service$|-admin-web$/);
  });
});

describe('端到端：CONSTITUTION + 存量 git-config → loadGitConfig → composeBranchName', () => {
  const TASK_ID = 'Task-033-21-h5';
  let origCwd: string;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    origCwd = process.cwd();
    process.chdir(TEST_DIR);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('旧版固化「分支前缀: feature」的存量任务仍产出与子任务 ID 一致的分支名', () => {
    // 项目宪法：任务分支类型段 feature
    setupConstitution('# 项目宪法\n\n## Git 分支策略\n- 任务分支: feature/{Task-ID}\n');
    // 存量子任务 git-config（旧版 taskify 固化的错误值）
    const taskDir = join(TEST_DIR, '030-tasks', 'feature', TASK_ID, 'h5', TASK_ID);
    mkdirSync(join(taskDir, '.meta'), { recursive: true });
    writeFileSync(
      join(taskDir, '.meta', 'git-config'),
      '# 子任务级 Git 配置（h5）\n源分支: main\n分支前缀: feature\n分支格式: {type}/{prefix}{taskId}\n远程名称: origin\n',
    );

    const cfg = loadGitConfig(undefined, taskDir);
    // 存量值仍被读出（兼容），但拼接端去重
    expect(cfg.branchPrefix).toBe('feature');
    const name = composeBranchName(cfg, 'feature', TASK_ID, '2.1 用户管理 — h5'.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-'));
    expect(name).toBe(`feature/${TASK_ID}`);
  });
});
