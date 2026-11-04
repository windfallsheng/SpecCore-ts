/**
 * 迭代目录名模糊解析回归测试 — v8.3.388（BUG-11）
 *
 * 背景：run 命令此前直接拼 `Iteration-${iteration}`，用户传短名（无序号前缀，
 * 如 ding-dan-guan-li-xi-tong）时拼出不存在目录，基于 iterDir 的前置依赖检查
 * 读空路径全部失败，误报「阶段前置依赖未满足」，且 remedy 文案仍让用户用短名
 * 重试，自相矛盾。修复后 run 统一走 core/context.getIterationDir（精确/后缀
 * 匹配，找不到时回退拼接，向后兼容）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getIterationDir } from '@/core/context';

const FIXTURE_ROOT = join(process.cwd(), 'tests', '.tmp', 'iteration-dir-fuzzy-test');

/** 构造夹具项目根（含 .speccore/ 锚点 + 两个带序号前缀的迭代目录） */
function buildFixtureProject(): void {
  mkdirSync(join(FIXTURE_ROOT, '.speccore'), { recursive: true });
  writeFileSync(join(FIXTURE_ROOT, '.speccore', 'CONSTITUTION.md'), '## 项目信息\n');
  mkdirSync(join(FIXTURE_ROOT, 'Iteration-001-ding-dan-guan-li-xi-tong'), { recursive: true });
  mkdirSync(join(FIXTURE_ROOT, 'Iteration-002-hui-yi-xi-tong'), { recursive: true });
}

/** 在夹具根下执行回调（findProjectRoot 锚定夹具根），执行后恢复 cwd */
async function inFixture<T>(fn: () => Promise<T> | T): Promise<T> {
  const origCwd = process.cwd();
  process.chdir(FIXTURE_ROOT);
  try {
    return await fn();
  } finally {
    process.chdir(origCwd);
  }
}

describe('迭代目录名模糊解析（v8.3.388 BUG-11 修复）', () => {
  beforeEach(() => {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
    buildFixtureProject();
  });

  afterEach(() => {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  });

  it('短名（无序号前缀）后缀唯一匹配到真实目录（修复前 run 拼出不存在目录）', async () => {
    await inFixture(async () => {
      const dir = await getIterationDir('ding-dan-guan-li-xi-tong');
      expect(dir).toBe(join(FIXTURE_ROOT, 'Iteration-001-ding-dan-guan-li-xi-tong'));
    });
  });

  it('短名（无序号前缀）不与其它迭代混淆（唯一匹配约束）', async () => {
    await inFixture(async () => {
      const dir = await getIterationDir('hui-yi-xi-tong');
      expect(dir).toBe(join(FIXTURE_ROOT, 'Iteration-002-hui-yi-xi-tong'));
    });
  });

  it('完整短名（带序号前缀）精确匹配', async () => {
    await inFixture(async () => {
      const dir = await getIterationDir('001-ding-dan-guan-li-xi-tong');
      expect(dir).toBe(join(FIXTURE_ROOT, 'Iteration-001-ding-dan-guan-li-xi-tong'));
    });
  });

  it('Iteration- 前缀完整名精确匹配', async () => {
    await inFixture(async () => {
      const dir = await getIterationDir('Iteration-001-ding-dan-guan-li-xi-tong');
      expect(dir).toBe(join(FIXTURE_ROOT, 'Iteration-001-ding-dan-guan-li-xi-tong'));
    });
  });

  it('短名找不到时回退拼接（向后兼容，不抛错）', async () => {
    await inFixture(async () => {
      const dir = await getIterationDir('bu-cun-zai');
      expect(dir).toBe(join(FIXTURE_ROOT, 'Iteration-bu-cun-zai'));
    });
  });
});
