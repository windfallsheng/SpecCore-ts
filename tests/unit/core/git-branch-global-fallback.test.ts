/**
 * Git 分支命名全局兜底（v8.3.336）
 *
 * 背景：全自动执行（execute --all / 无人值守流水线）创建任务分支时，
 * 迭代可能没来得及配置（PROJECT_GRAPH 缺失 / 未 taskify 无子任务 git-config），
 * 此前分支命名直接掉到硬编码默认 {type}/{prefix}{taskId}，用户的命名规范失效。
 *
 * 本次修复：全局 PROJECT.yaml git 段新增 branch_format 模板 + branch_types
 * prefix/suffix 兜底消费——迭代/子任务未配置时从这里取。
 *
 * 优先级链保持不变：子任务 .meta/git-config > 迭代 PROJECT_GRAPH.md >
 * 全局 PROJECT.yaml > CONSTITUTION 回退 > 硬编码默认。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadGitConfig, composeBranchName } from '../../../src/core/git-integration';

const TEST_DIR = join(process.cwd(), 'tests', '.tmp', 'git-branch-global-fallback');

function setupProjectYaml(gitYaml: string): void {
  mkdirSync(join(TEST_DIR, '.speccore'), { recursive: true });
  writeFileSync(join(TEST_DIR, '.speccore', 'PROJECT.yaml'), gitYaml);
}

const BASE_YAML = `schema_version: 1
project:
  name: test
platforms: []
git:
`;

describe('loadGitConfig — 全局 PROJECT.yaml 分支命名兜底（v8.3.336）', () => {
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

  it('branch_format 全局兜底：迭代/子任务未配置时读回模板', () => {
    setupProjectYaml(`${BASE_YAML}  default_base: main
  branch_format: "{type}/{prefix}{taskId}-{name}"
`);
    const cfg = loadGitConfig(); // 无迭代、无子任务 → 纯全局兜底
    expect(cfg.branchFormat).toBe('{type}/{prefix}{taskId}-{name}');
    const name = composeBranchName(cfg, 'feature', 'Task-001', '用户管理');
    expect(name).toBe('feature/Task-001-用户管理');
  });

  it('branch_types prefix/suffix 全局兜底：按任务分支类型查表注入', () => {
    setupProjectYaml(`${BASE_YAML}  default_base: main
  branch_types:
    feature:
      prefix: api-
      suffix: -urgent
      source: develop
    bugfix:
      source: develop
`);
    const cfg = loadGitConfig(undefined, undefined, 'feature');
    expect(cfg.taskPrefix).toBe('api-');
    expect(cfg.taskSuffix).toBe('-urgent');
    const name = composeBranchName(cfg, 'feature', 'Task-001', '');
    expect(name).toBe('feature/api-Task-001-urgent');
  });

  it('未配 prefix/suffix 的类型不受影响，走默认拼接', () => {
    setupProjectYaml(`${BASE_YAML}  default_base: main
  branch_types:
    feature:
      prefix: api-
      source: develop
    bugfix:
      source: develop
`);
    const cfg = loadGitConfig(undefined, undefined, 'bugfix');
    expect(cfg.taskPrefix).toBeUndefined();
    expect(cfg.taskSuffix).toBeUndefined();
    expect(composeBranchName(cfg, 'bugfix', 'Task-002', '')).toBe('bugfix/Task-002');
  });

  it('不传 branchType 时不查表（无任务类型上下文的安全路径）', () => {
    setupProjectYaml(`${BASE_YAML}  default_base: main
  branch_types:
    feature:
      prefix: api-
      source: develop
`);
    const cfg = loadGitConfig(); // 无 branchType → 不注入 prefix
    expect(cfg.taskPrefix).toBeUndefined();
  });

  it('子任务 git-config 仍覆盖全局兜底（优先级链不变）', () => {
    setupProjectYaml(`${BASE_YAML}  default_base: main
  branch_format: "{type}/{prefix}{taskId}-{name}"
  branch_types:
    feature:
      prefix: api-
      suffix: -urgent
      source: develop
`);
    const taskDir = join(TEST_DIR, '030-tasks', 'feature', 'Task-001', 'h5', 'Task-001');
    mkdirSync(join(taskDir, '.meta'), { recursive: true });
    writeFileSync(
      join(taskDir, '.meta', 'git-config'),
      '# 子任务级 Git 配置\n分支格式: {type}/{prefix}{taskId}\n前缀: web-\n后缀: _review\n源分支: main\n',
    );
    const cfg = loadGitConfig(undefined, taskDir, 'feature');
    // 子任务级覆盖：format 覆盖全局模板，prefix/suffix 覆盖全局查表值
    expect(cfg.branchFormat).toBe('{type}/{prefix}{taskId}');
    expect(cfg.taskPrefix).toBe('web-');
    expect(cfg.taskSuffix).toBe('_review');
    expect(composeBranchName(cfg, 'feature', 'Task-001', '')).toBe('feature/web-Task-001_review');
  });
});
