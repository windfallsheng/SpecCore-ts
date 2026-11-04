/**
 * v8.3.390 回归基线：多端同名子任务不得共用一个分支
 *
 * 背景：v8.3.337 起子任务 ID 不拼端名（Task-{模块名}），同模块多端子任务 ID 相同。
 * createTaskBranch 的「已存在分支复用」判定仅凭 taskId 精确匹配，导致第二端任务
 * 被误判为第一端重跑、直接复用第一端分支——多端任务开发在同一个分支上。
 *
 * 修复锁定：
 *   1. 复用判定精确到 taskDir（同 ID 不同目录不算同一任务）
 *   2. 分支重名时优先拼端名区分（确定性、可读），hash4 仅兜底
 *   3. 旧 mapping（无 taskDir）在严格模式下不命中——宁建新分支不误复用
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { findBranchByTaskId, createTaskBranch, snapshotUncommittedChanges } from '../../../src/core/git-integration';

const TEST_DIR = join(process.cwd(), 'tests', '.tmp', 'git-branch-reuse-test');
const TASK_ID = 'Task-admin-web-01-yudingguanli';
const BOOKING_DIR = join(TEST_DIR, 'booking-service', TASK_ID);
const ADMIN_DIR = join(TEST_DIR, 'admin-web', TASK_ID);

function writeMapping(entries: Record<string, unknown>): void {
  writeFileSync(join(TEST_DIR, '.speccore', '.git-mapping.json'), JSON.stringify(entries, null, 2));
}

function initGitRepo(): void {
  execSync('git init -q', { cwd: TEST_DIR, stdio: 'pipe' });
  execSync('git config user.email "test@speccore.dev"', { cwd: TEST_DIR, stdio: 'pipe' });
  execSync('git config user.name "Speccore Test"', { cwd: TEST_DIR, stdio: 'pipe' });
  // 隔离 .speccore 工具元数据（mapping 等）——真实项目或忽略或显式版本化，
  // 测试仓库忽略以避免快照提交把 mapping 文件误判为业务变更
  writeFileSync(join(TEST_DIR, '.gitignore'), '.speccore/\n');
  writeFileSync(join(TEST_DIR, '.gitkeep'), '');
  execSync('git add .gitignore .gitkeep', { cwd: TEST_DIR, stdio: 'pipe' });
  execSync('git commit -q -m "init"', { cwd: TEST_DIR, stdio: 'pipe' });
}

describe('findBranchByTaskId — 复用判定严格模式（taskDir 维度）', () => {
  let origCwd: string;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(join(TEST_DIR, '.speccore'), { recursive: true });
    origCwd = process.cwd();
    process.chdir(TEST_DIR);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('宽松模式（不传 taskDir）：同 taskId 精确命中', () => {
    writeMapping({
      'feature/Task-admin-web-01-yudingguanli': {
        taskId: TASK_ID,
        taskName: '预订管理 — booking-service',
        createdAt: '2026-11-04T00:00:00.000Z',
        taskDir: BOOKING_DIR,
      },
    });
    expect(findBranchByTaskId(TASK_ID, TEST_DIR)).toBe('feature/Task-admin-web-01-yudingguanli');
  });

  it('严格模式：同 taskId 同 taskDir 命中（重跑复用）', () => {
    writeMapping({
      'feature/Task-admin-web-01-yudingguanli': {
        taskId: TASK_ID,
        taskName: '预订管理 — booking-service',
        createdAt: '2026-11-04T00:00:00.000Z',
        taskDir: BOOKING_DIR,
      },
    });
    expect(findBranchByTaskId(TASK_ID, TEST_DIR, BOOKING_DIR)).toBe('feature/Task-admin-web-01-yudingguanli');
  });

  it('严格模式：同 taskId 不同 taskDir 不命中（多端同名子任务不复用彼此分支）', () => {
    writeMapping({
      'feature/Task-admin-web-01-yudingguanli': {
        taskId: TASK_ID,
        taskName: '预订管理 — booking-service',
        createdAt: '2026-11-04T00:00:00.000Z',
        taskDir: BOOKING_DIR,
      },
    });
    expect(findBranchByTaskId(TASK_ID, TEST_DIR, ADMIN_DIR)).toBeNull();
  });

  it('严格模式：旧 mapping 条目（无 taskDir）不命中——宁建新分支不误复用', () => {
    writeMapping({
      'feature/Task-admin-web-01-yudingguanli': {
        taskId: TASK_ID,
        taskName: '预订管理 — booking-service',
        createdAt: '2026-11-04T00:00:00.000Z',
      },
    });
    expect(findBranchByTaskId(TASK_ID, TEST_DIR, BOOKING_DIR)).toBeNull();
    // 宽松模式仍可命中（依赖查找语义不变）
    expect(findBranchByTaskId(TASK_ID, TEST_DIR)).toBe('feature/Task-admin-web-01-yudingguanli');
  });
});

describe('createTaskBranch — 多端同名子任务分支区分', () => {
  let origCwd: string;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(join(TEST_DIR, '.speccore'), { recursive: true });
    initGitRepo();
    origCwd = process.cwd();
    process.chdir(TEST_DIR);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('同 ID 不同端子任务：第二端拼端名建独立分支，不复用第一端分支', () => {
    const first = createTaskBranch(TASK_ID, '预订管理 — booking-service', undefined, undefined, BOOKING_DIR, 'feature', TEST_DIR, 'booking-service');
    expect(first).toBe(`feature/${TASK_ID}`);

    const second = createTaskBranch(TASK_ID, '预订管理 — admin-web', undefined, undefined, ADMIN_DIR, 'feature', TEST_DIR, 'admin-web');
    expect(second).toBe(`feature/${TASK_ID}-admin-web`);
    expect(second).not.toBe(first);

    // 两个分支在 git 中真实存在
    const branches = execSync('git branch', { cwd: TEST_DIR, encoding: 'utf-8' });
    expect(branches).toContain(`feature/${TASK_ID}`);
    expect(branches).toContain(`feature/${TASK_ID}-admin-web`);
  });

  it('同 ID 同 taskDir（重跑）：复用既有分支，不新建', () => {
    const first = createTaskBranch(TASK_ID, '预订管理 — booking-service', undefined, undefined, BOOKING_DIR, 'feature', TEST_DIR, 'booking-service');
    const again = createTaskBranch(TASK_ID, '预订管理 — booking-service', undefined, undefined, BOOKING_DIR, 'feature', TEST_DIR, 'booking-service');
    expect(again).toBe(first);
    // mapping 不被重复条目污染
    const mappingRaw = existsSync(join(TEST_DIR, '.speccore', '.git-mapping.json'));
    expect(mappingRaw).toBe(true);
  });
});

describe('snapshotUncommittedChanges — 切换分支前的快照保护', () => {
  let origCwd: string;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(join(TEST_DIR, '.speccore'), { recursive: true });
    initGitRepo();
    origCwd = process.cwd();
    process.chdir(TEST_DIR);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('当前分支是任务分支且有无提交变更 → 快照提交到原分支', () => {
    createTaskBranch(TASK_ID, '预订管理 — booking-service', undefined, undefined, BOOKING_DIR, 'feature', TEST_DIR, 'booking-service');
    writeFileSync(join(TEST_DIR, 'generated-code.ts'), 'export const x = 1;\n');

    expect(snapshotUncommittedChanges(TEST_DIR)).toBe(true);

    const log = execSync('git log --oneline -1', { cwd: TEST_DIR, encoding: 'utf-8' });
    expect(log).toContain('快照提交未提交变更');
    // 快照后工作区干净
    const status = execSync('git status --porcelain', { cwd: TEST_DIR, encoding: 'utf-8' }).trim();
    expect(status).toBe('');
  });

  it('当前分支不是任务分支（base 分支）→ 不碰用户 WIP', () => {
    writeFileSync(join(TEST_DIR, 'user-wip.ts'), 'export const wip = 1;\n');

    expect(snapshotUncommittedChanges(TEST_DIR)).toBe(false);

    // 无新提交产生，WIP 原样保留
    const log = execSync('git log --oneline -1', { cwd: TEST_DIR, encoding: 'utf-8' });
    expect(log).toContain('init');
    const status = execSync('git status --porcelain', { cwd: TEST_DIR, encoding: 'utf-8' }).trim();
    expect(status).toContain('user-wip.ts');
  });

  it('任务分支上无未提交变更 → 不提交', () => {
    createTaskBranch(TASK_ID, '预订管理 — booking-service', undefined, undefined, BOOKING_DIR, 'feature', TEST_DIR, 'booking-service');
    expect(snapshotUncommittedChanges(TEST_DIR)).toBe(false);
    const log = execSync('git log --oneline -1', { cwd: TEST_DIR, encoding: 'utf-8' });
    expect(log).toContain('init');
  });
});
