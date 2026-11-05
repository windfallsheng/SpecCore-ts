import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { cleanupByType } from '../../../src/commands/cleanup';

describe('cleanup 自动清理安全边界（v8.3.397+）', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'speccore-cleanup-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeOld(p: string): void {
    const old = new Date('2020-01-01T00:00:00Z');
    utimesSync(p, old, old);
  }

  it('迭代目录内的 .bak 与日期戳文件不被 execute 收尾清理触碰', async () => {
    const iterBak = join(root, 'Iteration-001-test', 'TASK.md.bak');
    const iterTs = join(root, 'Iteration-001-test', 'report-20250901000000.md');
    mkdirSync(join(root, 'Iteration-001-test'), { recursive: true });
    writeFileSync(iterBak, 'backup content');
    writeFileSync(iterTs, 'user document');
    makeOld(iterBak);
    makeOld(iterTs);

    // execute 收尾：types bakFiles, days 0
    await cleanupByType({ cwd: root, types: ['bakFiles'], days: 0, silent: true });
    // taskify 收尾：types timestampBackups, days 7
    await cleanupByType({ cwd: root, types: ['timestampBackups'], days: 7, silent: true });

    expect(existsSync(iterBak)).toBe(true);
    expect(existsSync(iterTs)).toBe(true);
  });

  it('项目根目录下的 .bak 与日期戳文件仍正常清理', async () => {
    const rootBak = join(root, 'root-file.bak');
    const rootTs = join(root, 'old-snapshot-20250901000000.json');
    writeFileSync(rootBak, 'x');
    writeFileSync(rootTs, 'y');
    makeOld(rootBak);
    makeOld(rootTs);

    await cleanupByType({ cwd: root, types: ['bakFiles', 'timestampBackups'], days: 7, silent: true });

    expect(existsSync(rootBak)).toBe(false);
    expect(existsSync(rootTs)).toBe(false);
  });

  it('.speccore 知识资产目录（GLOBAL 等）不参与清理扫描', async () => {
    const globalTmp = join(root, '.speccore', 'GLOBAL', '.tmp-stray.md');
    const rulesBak = join(root, '.speccore', 'RULES', 'api-design.md.bak');
    mkdirSync(join(root, '.speccore', 'GLOBAL'), { recursive: true });
    mkdirSync(join(root, '.speccore', 'RULES'), { recursive: true });
    writeFileSync(globalTmp, 'x');
    writeFileSync(rulesBak, 'y');
    makeOld(rulesBak);

    await cleanupByType({ cwd: root, types: ['tempFiles', 'bakFiles'], days: 0, silent: true });

    expect(existsSync(globalTmp)).toBe(true);
    expect(existsSync(rulesBak)).toBe(true);
  });

  it('.speccore/cache 临时区域仍被清理（staleCacheFiles 不受影响）', async () => {
    const stale = join(root, '.speccore', 'cache', 'last-analysis-snapshot.json');
    mkdirSync(join(root, '.speccore', 'cache'), { recursive: true });
    writeFileSync(stale, '{}');
    makeOld(stale);

    await cleanupByType({ cwd: root, types: ['staleCacheFiles'], days: 7, silent: true });

    expect(existsSync(stale)).toBe(false);
  });

  it('.speccore/cache/iterations 下的迭代缓存目录不被迭代跳过规则误伤', async () => {
    // 缓存目录名带 Iteration-001 前缀，但位于 .speccore 下，应正常参与扫描
    const cacheTmp = join(root, '.speccore', 'cache', 'iterations', 'Iteration-001-test', '.tmp-junk.md');
    mkdirSync(join(root, '.speccore', 'cache', 'iterations', 'Iteration-001-test'), { recursive: true });
    writeFileSync(cacheTmp, 'x');

    await cleanupByType({ cwd: root, types: ['tempFiles'], days: 0, silent: true });

    expect(existsSync(cacheTmp)).toBe(false);
  });
});
