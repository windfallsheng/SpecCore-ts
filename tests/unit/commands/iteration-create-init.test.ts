/**
 * 迭代创建初始化：成员信息 + Git 配置快照（v8.3.337+）
 *
 * 背景：迭代创建时自动从全局 TEAM.md 带出成员快照行写入 STAFFING.md、
 * 从全局 PROJECT.yaml git 段带出默认分支/分支格式快照写入 PROJECT_GRAPH.md，
 * 全自动执行等无人值守场景读迭代级文件即有具体配置。
 * 基座缺失/空表/值含表格破坏字符时静默降级（空表 / 继承全局配置占位符）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initCommand } from '@/commands/init';
import { iterationCreateCommand } from '@/commands/iteration/create';
import { loadStaffing } from '../../../src/core/unit-staffing';

const TEST_ROOT = mkdtempSync(join(tmpdir(), 'iter-create-init-'));
const origCwd = process.cwd();

// 基座成员表（TEAM.md 9 列，含在项目=否的成员与分支代号）
const TEAM_CONTENT = `# TEAM.md
| 成员 | Git 用户名 | 岗位 | 技术栈 | 负责模块 | 平台方向 | 投入比例 | 在项目 | 分支代号 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 张三 | zhangsan | 后端 | Java | 订单模块 | backend-api | 100% | 是 | zs |
| 赵六 | zhaoliu | 后端 | Go | 推送 | backend-api | 0% | 否 | zl |
`;

function findIterationDir(name: string): string {
  const matched = readdirSync(TEST_ROOT).filter((d) => d.endsWith(`-${name}`));
  if (matched.length !== 1) throw new Error(`期望恰好一个 -${name} 迭代目录，实际: ${matched.join(', ')}`);
  return join(TEST_ROOT, matched[0]);
}

beforeAll(async () => {
  try {
    process.chdir(TEST_ROOT);
    await initCommand({ interactive: false });
  } finally {
    process.chdir(origCwd);
  }
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('迭代创建初始化（v8.3.337+）', () => {
  it('基座有成员 → STAFFING.md 预填快照行（岗位/方向/比例/在项目照抄）', async () => {
    writeFileSync(join(TEST_ROOT, '.speccore', 'PROJECT', 'TEAM.md'), TEAM_CONTENT);
    try {
      process.chdir(TEST_ROOT);
      await iterationCreateCommand({ name: 'init-members' });
    } finally {
      process.chdir(origCwd);
    }
    const staffing = readFileSync(join(findIterationDir('init-members'), 'STAFFING.md'), 'utf-8');
    expect(staffing).toContain('| 张三 | 后端 | backend-api | 100% | 是 |');
    expect(staffing).toContain('| 赵六 | 后端 | backend-api | 0% | 否 |');
    // 说明段声明快照语义
    expect(staffing).toContain('创建时自动带出基座快照');
  });

  it('快照行与 loadStaffing 联动：迭代 STAFFING 解析出基座成员（在项目过滤生效）', async () => {
    const iterDir = findIterationDir('init-members');
    const members = loadStaffing(iterDir);
    const names = members.map((m) => m.name);
    expect(names).toContain('张三');
    // 赵六基座「否」= 不在项目，loadStaffing 剔除
    expect(names).not.toContain('赵六');
  });

  it('基座空表 → STAFFING.md 空表占位行（不阻塞迭代创建）', async () => {
    writeFileSync(join(TEST_ROOT, '.speccore', 'PROJECT', 'TEAM.md'),
      '# TEAM.md\n| 成员 | 岗位 | 平台方向 | 投入比例 | 在项目 |\n| :--- | :--- | :--- | :--- | :--- |\n');
    try {
      process.chdir(TEST_ROOT);
      await iterationCreateCommand({ name: 'init-empty' });
    } finally {
      process.chdir(origCwd);
    }
    const staffing = readFileSync(join(findIterationDir('init-empty'), 'STAFFING.md'), 'utf-8');
    expect(staffing).toContain('| | | | | |');
  });

  it('PROJECT.yaml git 段存在 → PROJECT_GRAPH.md 表格带出快照值', async () => {
    try {
      process.chdir(TEST_ROOT);
      await iterationCreateCommand({ name: 'init-git' });
    } finally {
      process.chdir(origCwd);
    }
    const graph = readFileSync(join(findIterationDir('init-git'), '000-overview', 'PROJECT_GRAPH.md'), 'utf-8');
    expect(graph).toContain('| 默认分支 | main |');
    expect(graph).toContain('| 分支格式 | {type}/{prefix}{taskId} |');
    expect(graph).toContain('任务级 .meta/git-config 又覆盖本处');
  });

  it('PROJECT.yaml git 段缺失 → 回落「继承全局配置」占位符', async () => {
    // 覆盖为无 git 段的最小 PROJECT.yaml（loadRawProjectConfig 不做结构校验，原样返回）
    writeFileSync(join(TEST_ROOT, '.speccore', 'PROJECT.yaml'),
      'schema_version: 1\nname: test\nplatforms: []\ncode_scope: []\n');
    try {
      process.chdir(TEST_ROOT);
      await iterationCreateCommand({ name: 'init-nogit' });
    } finally {
      process.chdir(origCwd);
    }
    const graph = readFileSync(join(findIterationDir('init-nogit'), '000-overview', 'PROJECT_GRAPH.md'), 'utf-8');
    expect(graph).toContain('| 默认分支 | 继承全局配置 |');
    expect(graph).toContain('| 分支格式 | 继承全局配置 |');
  });
});
