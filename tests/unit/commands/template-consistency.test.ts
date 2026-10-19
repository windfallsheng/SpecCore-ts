/**
 * 模板族一致性机器锁（v8.3.324）
 *
 * 背景：CONSTITUTION.md / TEAM.md / STAFFING.md 的「主模板」与 .speccore/examples/
 * 下的「示例」是多份独立字符串，历史上靠人肉同步，新语义（如状态列、决策式技术栈）
 * 容易漏同步某一份。本测试将关键语义锚点集中登记，任何一份模板缺锚点立即红。
 *
 * 约定：新增「全模板族都要有的语义」时，在此处锚点清单登记 + 改模板，测试保证同步。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initCommand, generateExampleConfigs } from '@/commands/init';
import { iterationCreateCommand } from '@/commands/iteration/create';

const TEST_ROOT = mkdtempSync(join(tmpdir(), 'template-consistency-'));

// ── 关键语义锚点（新增语义时在此登记）──────────────────────────────
// CONSTITUTION 主模板 ↔ CONSTITUTION-EXAMPLE 必须共享：
const CONSTITUTION_ANCHORS = [
  '机器事实源', // v8.3.322/323: Git/项目信息收敛指针（PROJECT.yaml 为机器事实源）
  '已选定', // v8.3.324: 技术栈决策式（每端一行写已选定，不是选项菜单）
  '决策式', // v8.3.324: 同上的语义标记
  '分段规则', // v8.3.324: 异常码分段（给 AI 生成能力，非枚举示例）
  '回退', // 收敛模式：CONSTITUTION 为 AI 契约/兼容回退
];
// TEAM.md 主模板 ↔ TEAM-EXAMPLE 必须共享：
const TEAM_ANCHORS = ['状态', '在职', '出项目', '全员名册'];
// 迭代 STAFFING.md 主模板 ↔ STAFFING-EXAMPLE 必须共享：
const STAFFING_ANCHORS = ['状态', '在职', '出项目', '只写差异'];

beforeAll(async () => {
  const origCwd = process.cwd();
  try {
    process.chdir(TEST_ROOT);
    await initCommand({ interactive: false });
    await generateExampleConfigs(TEST_ROOT);
    await iterationCreateCommand({ name: 't' });
  } finally {
    process.chdir(origCwd);
  }
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

function readOrFail(p: string): string {
  return readFileSync(p, 'utf-8');
}

function findIterationDir(root: string): string {
  // init 自带示例迭代（Iteration-sample），本测试创建的迭代按序号命名（Iteration-001-t）
  const dirs = readdirSync(root).filter((d) => /^Iteration-\d+-t$/.test(d));
  if (dirs.length !== 1) throw new Error(`期望恰好一个测试迭代目录，实际: ${dirs.join(', ')}`);
  return join(root, dirs[0]);
}

describe('模板族一致性机器锁（v8.3.324）', () => {
  it('CONSTITUTION 主模板与 CONSTITUTION-EXAMPLE 共享语义锚点', () => {
    const main = readOrFail(join(TEST_ROOT, '.speccore', 'CONSTITUTION.md'));
    const example = readOrFail(
      join(TEST_ROOT, '.speccore', 'examples', 'config', 'CONSTITUTION-EXAMPLE.md'),
    );
    for (const anchor of CONSTITUTION_ANCHORS) {
      expect(main, `CONSTITUTION 主模板缺锚点「${anchor}」`).toContain(anchor);
      expect(example, `CONSTITUTION-EXAMPLE 缺锚点「${anchor}」`).toContain(anchor);
    }
  });

  it('TEAM.md 主模板与 TEAM-EXAMPLE 共享「状态」列语义', () => {
    const main = readOrFail(join(TEST_ROOT, '.speccore', 'PROJECT', 'TEAM.md'));
    const example = readOrFail(
      join(TEST_ROOT, '.speccore', 'examples', 'config', 'TEAM-EXAMPLE.md'),
    );
    for (const anchor of TEAM_ANCHORS) {
      expect(main, `TEAM.md 主模板缺锚点「${anchor}」`).toContain(anchor);
      expect(example, `TEAM-EXAMPLE 缺锚点「${anchor}」`).toContain(anchor);
    }
    // 列头必须一致（7 列含状态），保证用户可照抄
    expect(main).toContain('| 状态 |');
    expect(example).toContain('| 状态 |');
  });

  it('迭代 STAFFING.md 主模板与 STAFFING-EXAMPLE 共享「状态」列语义', () => {
    const iterDir = findIterationDir(TEST_ROOT);
    const main = readOrFail(join(iterDir, 'STAFFING.md'));
    const example = readOrFail(
      join(TEST_ROOT, '.speccore', 'examples', 'config', 'STAFFING-EXAMPLE.md'),
    );
    for (const anchor of STAFFING_ANCHORS) {
      expect(main, `STAFFING.md 主模板缺锚点「${anchor}」`).toContain(anchor);
      expect(example, `STAFFING-EXAMPLE 缺锚点「${anchor}」`).toContain(anchor);
    }
    expect(main).toContain('| 状态 |');
    expect(example).toContain('| 状态 |');
  });

  it('examples README 目录清单包含全部新增示例', () => {
    const readme = readOrFail(join(TEST_ROOT, '.speccore', 'examples', 'README.md'));
    expect(readme).toContain('TEAM-EXAMPLE.md');
    expect(readme).toContain('STAFFING-EXAMPLE.md');
  });
});
