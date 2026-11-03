/**
 * scope-resolver 单元测试（v8.3.350+）
 *
 * 覆盖三种验证范围（all / deployed / modules）、端过滤与无部署清单报错。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  resolveScopeUnits,
  parsePlatformFilter,
  loadDeployManifest,
} from '../../../../src/core/ai-verify/scope-resolver';

let root: string;
let projectRoot: string;
let iterDir: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'speccore-scope-'));
  projectRoot = join(root, 'proj');
  iterDir = join(projectRoot, 'Iteration-001-demo');
  const specsDir = join(iterDir, '020-specs');
  // 功能单元目录（子目录=端目录）
  mkdirSync(join(specsDir, '订单管理', 'h5'), { recursive: true });
  mkdirSync(join(specsDir, '订单管理', 'admin-web'), { recursive: true });
  mkdirSync(join(specsDir, '用户管理', 'h5'), { recursive: true });
  mkdirSync(join(specsDir, '支付中心', 'miniapp'), { recursive: true });
  // 干扰项：overview 目录与非目录文件应被排除
  mkdirSync(join(specsDir, 'overview'), { recursive: true });
  writeFileSync(join(specsDir, 'NOTES.md'), '非目录文件');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('parsePlatformFilter', () => {
  it('should split comma/space separated platforms', () => {
    expect(parsePlatformFilter('h5,admin-web')).toEqual(['h5', 'admin-web']);
    expect(parsePlatformFilter('h5 admin-web')).toEqual(['h5', 'admin-web']);
    expect(parsePlatformFilter(undefined)).toEqual([]);
    expect(parsePlatformFilter('')).toEqual([]);
  });
});

describe('resolveScopeUnits', () => {
  it('scope=all 返回全部功能单元（排除 overview 与非目录文件）', async () => {
    const { units } = await resolveScopeUnits({ iterDir, scope: 'all', projectRoot });
    expect(units.map((u) => u.name).sort()).toEqual(['支付中心', '用户管理', '订单管理'].sort());
    const order = units.find((u) => u.name === '订单管理');
    expect(order?.platforms.sort()).toEqual(['admin-web', 'h5']);
  });

  it('scope=modules: 精确匹配指定单元，缺失单元进 warnings', async () => {
    const { units, warnings } = await resolveScopeUnits({
      iterDir,
      scope: 'modules:订单管理,不存在的单元',
      projectRoot,
    });
    expect(units.map((u) => u.name)).toEqual(['订单管理']);
    expect(warnings.some((w) => w.includes('不存在的单元'))).toBe(true);
  });

  it('scope=modules: 无参数时抛错', async () => {
    await expect(resolveScopeUnits({ iterDir, scope: 'modules:', projectRoot })).rejects.toThrow(/modules:/);
  });

  it('scope=deployed 按部署清单端名筛选单元', async () => {
    const localDir = join(projectRoot, '.speccore', 'local');
    mkdirSync(localDir, { recursive: true });
    writeFileSync(
      join(localDir, 'deploy-manifest.json'),
      JSON.stringify({
        env: 'staging',
        time: new Date().toISOString(),
        platforms: [{ name: 'h5', type: 'web' }],
      })
    );
    const { units } = await resolveScopeUnits({ iterDir, scope: 'deployed', projectRoot });
    // 含 h5 端目录的单元入选；支付中心（仅 miniapp）被排除
    expect(units.map((u) => u.name).sort()).toEqual(['用户管理', '订单管理'].sort());
  });

  it('scope=deployed 无清单时报错提示先部署', async () => {
    await expect(
      resolveScopeUnits({ iterDir, scope: 'deployed', projectRoot: join(root, 'no-manifest') })
    ).rejects.toThrow(/deploy/);
  });

  it('端过滤：仅保留指定端，无该端的单元被剔除', async () => {
    const { units } = await resolveScopeUnits({
      iterDir,
      scope: 'all',
      platformFilter: 'h5',
      projectRoot,
    });
    for (const u of units) expect(u.platforms).toEqual(['h5']);
    // 支付中心只有 miniapp → 过滤后消失
    expect(units.map((u) => u.name).sort()).toEqual(['用户管理', '订单管理'].sort());
  });
});

describe('loadDeployManifest', () => {
  it('should return null when manifest missing', async () => {
    expect(await loadDeployManifest(join(root, 'empty'))).toBeNull();
  });

  it('should return null when manifest structure invalid', async () => {
    const dir = join(root, 'bad-manifest', '.speccore', 'local');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'deploy-manifest.json'), JSON.stringify({ env: 'staging' }));
    expect(await loadDeployManifest(join(root, 'bad-manifest'))).toBeNull();
  });
});
