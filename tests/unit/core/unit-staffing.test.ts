/**
 * unit-staffing 单元测试（v8.3.302+）
 *
 * 覆盖负责人前置设计的核心逻辑：
 * - STAFFING.md 解析与方向匹配（大小写不敏感、双向包含）
 * - _matrix.md owners 段的解析 / 渲染 / 合并写回（confirmed 保留、pending 候选、报缺不脑补）
 * - 候选推导（方向唯一成员才确定）与 OWNERS.md 视图刷新
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadStaffing,
  matchDirection,
  parseOwnerDecls,
  renderOwnersBlock,
  deriveOwnerCandidates,
  updateMatrixOwners,
  resolveDeclaredOwner,
  renderOwnersView,
  refreshUnitOwnerViews,
} from '../../../src/core/unit-staffing';

let tmp: string;
let iterDir: string;
let featuresDir: string;
let specDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'unit-staffing-'));
  iterDir = join(tmp, 'Iteration-Q1');
  featuresDir = join(iterDir, '010-requirements', 'features');
  specDir = join(iterDir, '020-specs');
  mkdirSync(featuresDir, { recursive: true });
  mkdirSync(specDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('loadStaffing', () => {
  it('解析成员表格（含中文逗号/顿号分隔方向）', () => {
    writeFileSync(join(iterDir, 'STAFFING.md'), [
      '# 排期',
      '| 成员 | 平台方向 | 投入比例 |',
      '| :--- | :--- | :--- |',
      '| 张三 | 后台，Web | 80% |',
      '| 李四 | 小程序、APP | 70% |',
    ].join('\n'));
    const members = loadStaffing(iterDir);
    expect(members).toHaveLength(2);
    expect(members[0].name).toBe('张三');
    expect(members[0].directions).toEqual(['后台', 'Web']);
    expect(members[0].capacity).toBe(80);
  });

  it('STAFFING.md 缺失返回空数组（报缺不脑补）', () => {
    expect(loadStaffing(iterDir)).toEqual([]);
  });
});

describe('matchDirection', () => {
  it('大小写不敏感双向包含 + 类别词别名词边界', () => {
    expect(matchDirection('app', 'APP')).toBe(true);
    expect(matchDirection('admin-web', 'admin')).toBe(true);
    expect(matchDirection('booking-service', '后台')).toBe(true); // 别名 service 词边界命中
    expect(matchDirection('miniapp', 'APP')).toBe(false);          // app 不误匹配 miniapp
    expect(matchDirection('h5-mobile', '小程序')).toBe(false);
  });
});

describe('owners 段解析与渲染', () => {
  const matrix = [
    '# 预订管理 - 端覆盖矩阵',
    '',
    'feature: 预订管理',
    'type: feature',
    'platforms:',
    '  - booking-service',
    '  - h5-mobile',
    'clarify: needed',
    'owners:',
    '  - platform: booking-service',
    '    name: 张三',
    '    status: confirmed',
    '  - platform: h5-mobile',
    '    name: 李四',
    '    status: pending',
    'dependencies: []',
    'apis: []',
  ].join('\n');

  it('解析 owners 段（状态保留）', () => {
    const decls = parseOwnerDecls(matrix);
    expect(decls).toHaveLength(2);
    expect(decls[0]).toEqual({ platform: 'booking-service', name: '张三', status: 'confirmed' });
    expect(decls[1]).toEqual({ platform: 'h5-mobile', name: '李四', status: 'pending' });
  });

  it('无 owners 段返回空数组', () => {
    expect(parseOwnerDecls('# t\n\nfeature: x\nplatforms:\n  []\n')).toEqual([]);
  });

  it('renderOwnersBlock 空声明与三行式', () => {
    expect(renderOwnersBlock([])).toBe('owners:\n  []');
    const rendered = renderOwnersBlock([{ platform: 'app', name: '王五', status: 'confirmed' }]);
    expect(rendered).toContain('- platform: app');
    expect(rendered).toContain('name: 王五');
    expect(rendered).toContain('status: confirmed');
  });

  it('resolveDeclaredOwner 只认 confirmed', () => {
    expect(resolveDeclaredOwner(matrix, 'booking-service')).toBe('张三');
    expect(resolveDeclaredOwner(matrix, 'h5-mobile')).toBeUndefined(); // pending 未拍板
    expect(resolveDeclaredOwner(matrix, 'miniapp')).toBeUndefined();   // 未声明
  });
});

describe('deriveOwnerCandidates', () => {
  const staffing = [
    { name: '张三', directions: ['后台'], capacity: 80 },
    { name: '李四', directions: ['Web'], capacity: 70 },
    { name: '王五', directions: ['Web'], capacity: 60 },
  ];

  it('方向唯一成员 → pending 候选', () => {
    const decls = deriveOwnerCandidates(['booking-service', 'h5-mobile'], staffing);
    expect(decls).toHaveLength(1);
    expect(decls[0]).toEqual({ platform: 'booking-service', name: '张三', status: 'pending' });
  });

  it('方向多人 → 不推导（不脑补）', () => {
    expect(deriveOwnerCandidates(['h5-mobile'], staffing)).toEqual([]);
  });

  it('方向无人 → 不推导', () => {
    expect(deriveOwnerCandidates(['miniapp'], staffing)).toEqual([]);
  });
});

describe('updateMatrixOwners', () => {
  it('confirmed 保留、新候选写入 pending、端收敛', async () => {
    const matrixPath = join(featuresDir, 'unit-a', '_matrix.md');
    mkdirSync(join(featuresDir, 'unit-a'), { recursive: true });
    writeFileSync(matrixPath, [
      '# 单元A - 端覆盖矩阵', '',
      'feature: 单元A',
      'platforms:',
      '  - booking-service',
      '  - h5-mobile',
      'owners:',
      '  - platform: booking-service',
      '    name: 张三',
      '    status: confirmed',
      'dependencies: []',
    ].join('\n'));

    // 新候选：booking-service（已 confirmed，应跳过）+ h5-mobile（新 pending）
    const ok = await updateMatrixOwners(matrixPath, [
      { platform: 'booking-service', name: '李四', status: 'pending' },
      { platform: 'h5-mobile', name: '王五', status: 'pending' },
    ]);
    expect(ok).toBe(true);

    const decls = parseOwnerDecls(readFileSync(matrixPath, 'utf-8'));
    expect(decls).toEqual([
      { platform: 'booking-service', name: '张三', status: 'confirmed' },
      { platform: 'h5-mobile', name: '王五', status: 'pending' },
    ]);
  });

  it('无 owners 段的旧矩阵自动插入', async () => {
    const matrixPath = join(featuresDir, 'unit-b', '_matrix.md');
    mkdirSync(join(featuresDir, 'unit-b'), { recursive: true });
    writeFileSync(matrixPath, [
      '# 单元B - 端覆盖矩阵', '',
      'feature: 单元B',
      'platforms:',
      '  - app',
      'dependencies: []',
    ].join('\n'));

    await updateMatrixOwners(matrixPath, [{ platform: 'app', name: '赵六', status: 'pending' }]);
    const content = readFileSync(matrixPath, 'utf-8');
    expect(content).toContain('owners:');
    expect(parseOwnerDecls(content)).toEqual([{ platform: 'app', name: '赵六', status: 'pending' }]);
  });
});

describe('OWNERS.md 视图', () => {
  it('renderOwnersView 缺声明显示未登记', () => {
    const view = renderOwnersView('单元A', ['booking-service', 'h5-mobile'], [
      { platform: 'booking-service', name: '张三', status: 'confirmed' },
    ]);
    expect(view).toContain('| booking-service | 张三 | ✅ confirmed |');
    expect(view).toContain('未登记');
  });

  it('refreshUnitOwnerViews 落盘到 020-specs/{单元}/overview/OWNERS.md', async () => {
    mkdirSync(join(featuresDir, 'unit-c'), { recursive: true });
    writeFileSync(join(featuresDir, 'unit-c', '_matrix.md'), [
      '# 单元C - 端覆盖矩阵', '',
      'feature: 单元C',
      'platforms:',
      '  - admin-web',
      'owners:',
      '  - platform: admin-web',
      '    name: 李四',
      '    status: confirmed',
    ].join('\n'));

    const written = await refreshUnitOwnerViews(
      specDir, featuresDir, ['unit-c'], new Map([['unit-c', ['admin-web']]])
    );
    expect(written).toBe(1);
    const viewPath = join(specDir, 'unit-c', 'overview', 'OWNERS.md');
    expect(existsSync(viewPath)).toBe(true);
    expect(readFileSync(viewPath, 'utf-8')).toContain('| admin-web | 李四 | ✅ confirmed |');
  });
});
