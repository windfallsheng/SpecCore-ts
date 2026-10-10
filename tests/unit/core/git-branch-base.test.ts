/**
 * resolveTaskBaseBranch 优先级回归基线（v8.3.304+）
 *
 * 背景：execute 拉分支此前只走 loadGitConfig（CONSTITUTION/任务级 git-config），
 * PROJECT.yaml 的 git.default_base 与 branch_types[].source 从未参与判定，
 * 用户在主配置里声明 source 不生效。本测试锁定解析链优先级：
 *   任务级 git-config > 迭代级 PROJECT_GRAPH > PROJECT.yaml source > default_base > 回退
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs-extra';
import { join } from 'path';

vi.mock('../../../src/core/unified-config', () => ({
  loadRawProjectConfig: vi.fn(),
}));

import { resolveTaskBaseBranch } from '../../../src/core/git-integration';
import { loadRawProjectConfig } from '../../../src/core/unified-config';

const mockLoadProjectConfig = loadRawProjectConfig as unknown as ReturnType<typeof vi.fn>;

const TEST_ITERATION = '999-branch-base-test';
const TEST_TASK_DIR = join('.speccore', 'local', 'test-task-branch-base');

function cleanup() {
  if (existsSync(`Iteration-${TEST_ITERATION}`)) rmSync(`Iteration-${TEST_ITERATION}`, { recursive: true, force: true });
  if (existsSync(TEST_TASK_DIR)) rmSync(TEST_TASK_DIR, { recursive: true, force: true });
}

describe('resolveTaskBaseBranch 优先级链', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('任务级 .meta/git-config「源分支」最高优先级', async () => {
    mkdirSync(join(TEST_TASK_DIR, '.meta'), { recursive: true });
    writeFileSync(join(TEST_TASK_DIR, '.meta', 'git-config'), '分支类型: feature\n源分支: task-local-branch\n');
    mockLoadProjectConfig.mockResolvedValue({ git: { default_base: 'main', branch_types: { feature: { source: 'develop' } } } });
    const r = await resolveTaskBaseBranch('feature', TEST_ITERATION, TEST_TASK_DIR);
    expect(r).toBe('task-local-branch');
  });

  it('迭代级 PROJECT_GRAPH「默认分支」次高', async () => {
    mkdirSync(`Iteration-${TEST_ITERATION}/000-overview`, { recursive: true });
    writeFileSync(
      join(`Iteration-${TEST_ITERATION}`, '000-overview', 'PROJECT_GRAPH.md'),
      '| 配置项 | 值 |\n| :--- | :--- |\n| 默认分支 | iter-develop |',
    );
    mockLoadProjectConfig.mockResolvedValue({ git: { default_base: 'main', branch_types: { feature: { source: 'develop' } } } });
    const r = await resolveTaskBaseBranch('feature', TEST_ITERATION);
    expect(r).toBe('iter-develop');
  });

  it('PROJECT.yaml branch_types[{taskType}].source 优先于 default_base', async () => {
    mockLoadProjectConfig.mockResolvedValue({ git: { default_base: 'main', branch_types: { feature: { source: 'develop' } } } });
    const r = await resolveTaskBaseBranch('feature', TEST_ITERATION);
    expect(r).toBe('develop');
  });

  it('branch_types 无 source 时回退 PROJECT.yaml git.default_base', async () => {
    // 注意：原始文件读取不 merge 默认值，「release 无显式 source」不应被预置表劫持
    mockLoadProjectConfig.mockResolvedValue({ git: { default_base: 'trunk', branch_types: { feature: { source: 'develop' } } } });
    const r = await resolveTaskBaseBranch('release', TEST_ITERATION);
    expect(r).toBe('trunk');
  });

  it('无 taskType 时同样走 default_base（不回退 source 匹配）', async () => {
    mockLoadProjectConfig.mockResolvedValue({ git: { default_base: 'trunk', branch_types: { feature: { source: 'develop' } } } });
    const r = await resolveTaskBaseBranch(undefined, TEST_ITERATION);
    expect(r).toBe('trunk');
  });

  it('配置全缺时回退 git 检测（本仓库有 main 分支）', async () => {
    mockLoadProjectConfig.mockResolvedValue(null);
    const r = await resolveTaskBaseBranch('feature', TEST_ITERATION);
    // 回退链：CONSTITUTION「默认分支」→ DEFAULT 'main' → git remote HEAD → 本地分支
    expect(typeof r).toBe('string');
  });
});
