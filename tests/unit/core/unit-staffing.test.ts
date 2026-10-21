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
  parseStaffingTable,
  mergeStaffing,
  matchDirection,
  WILDCARD,
  normalizeWildcard,
  isWildcard,
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

describe('loadStaffing 两级合并（v8.3.319+: 全局 TEAM.md 基座 + 迭代 STAFFING.md 差异）', () => {
  const teamTable = (rows: string[]) => [
    '# 团队与 Git 映射',
    '| 成员 | Git 用户名 | 角色 | 技术栈 | 负责模块 | 平台方向 | 投入比例 |',
    '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
    ...rows,
  ].join('\n');

  function setupGlobalTeam(content: string) {
    mkdirSync(join(tmp, '.speccore', 'PROJECT'), { recursive: true });
    writeFileSync(join(tmp, '.speccore', 'PROJECT', 'TEAM.md'), content);
  }

  it('全局基座 + 迭代无 STAFFING.md → 纯全局名册（已建迭代即时继承）', () => {
    setupGlobalTeam(teamTable([
      '| 张三 | zs | 后端 | Node.js | 订单 | 后台 | 80% |',
      '| 李四 | ls | 前端 | React | 订单 | Web, APP | 70% |',
    ]));
    const members = loadStaffing(iterDir);
    // v8.3.337+: toMatchObject 容忍新增字段（gitUser/roles/initials）
    expect(members).toMatchObject([
      { name: '张三', directions: ['后台'], capacity: 80, status: 'active' },
      { name: '李四', directions: ['Web', 'APP'], capacity: 70, status: 'active' },
    ]);
  });

  it('迭代同名整体覆盖、独有成员追加、未列基座成员保留', () => {
    setupGlobalTeam(teamTable([
      '| 张三 | zs | 后端 | Node.js | 订单 | 后台 | 80% |',
      '| 李四 | ls | 前端 | React | 订单 | Web | 70% |',
    ]));
    writeFileSync(join(iterDir, 'STAFFING.md'), [
      '| 成员 | 平台方向 | 投入比例 |',
      '| :--- | :--- | :--- |',
      '| 李四 | 小程序 | 100% |',
      '| 王五 | APP | 60% |',
    ].join('\n'));
    expect(loadStaffing(iterDir)).toMatchObject([
      { name: '张三', directions: ['后台'], capacity: 80, status: 'active' },
      { name: '李四', directions: ['小程序'], capacity: 100, status: 'active' },
      { name: '王五', directions: ['APP'], capacity: 60 },
    ]);
  });

  it('迭代方向留空 + 比例 0% → 覆盖为空方向（本迭代不参与该成员分配）', () => {
    setupGlobalTeam(teamTable([
      '| 张三 | zs | 后端 | Node.js | 订单 | 后台 | 80% |',
    ]));
    writeFileSync(join(iterDir, 'STAFFING.md'), [
      '| 成员 | 平台方向 | 投入比例 |',
      '| :--- | :--- | :--- |',
      '| 张三 | | 0% |',
    ].join('\n'));
    expect(loadStaffing(iterDir)).toMatchObject([
      { name: '张三', directions: [], capacity: 0, status: 'active' },
    ]);
  });

  it('旧版 TEAM.md 无「平台方向」列 → 基座不可用，回退仅迭代级（兼容）', () => {
    setupGlobalTeam([
      '# 团队与 Git 映射',
      '| 成员 | Git 用户名 | 角色 | 技术栈 | 负责模块 |',
      '| :--- | :--- | :--- | :--- | :--- |',
      '| 张三 | zs | 后端 | Node.js | 订单 |',
    ].join('\n'));
    writeFileSync(join(iterDir, 'STAFFING.md'), [
      '| 成员 | 平台方向 | 投入比例 |',
      '| :--- | :--- | :--- |',
      '| 李四 | Web | 70% |',
    ].join('\n'));
    expect(loadStaffing(iterDir)).toMatchObject([
      { name: '李四', directions: ['Web'], capacity: 70 },
    ]);
  });
});

describe('parseStaffingTable / mergeStaffing', () => {
  it('按表头定位列，兼容列序差异（TEAM.md 多列 vs STAFFING.md 三列）', () => {
    const team = parseStaffingTable([
      '| 成员 | Git 用户名 | 角色 | 技术栈 | 负责模块 | 平台方向 | 投入比例 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
      '| 张三 | zs | 后端 | Node.js | 订单 | 后台，Web | 80% |',
    ].join('\n'));
    expect(team).toMatchObject([{ name: '张三', directions: ['后台', 'Web'], capacity: 80 }]);

    const staffing = parseStaffingTable([
      '| 成员 | 平台方向 | 投入比例 |',
      '| :--- | :--- | :--- |',
      '| 李四 | 小程序、APP | 70% |',
    ].join('\n'));
    expect(staffing).toMatchObject([{ name: '李四', directions: ['小程序', 'APP'], capacity: 70 }]);
  });

  it('mergeStaffing 空基座/空覆盖快捷路径', () => {
    const g = [{ name: '张三', directions: ['后台'], capacity: 80 }];
    const i = [{ name: '李四', directions: ['Web'], capacity: 70 }];
    expect(mergeStaffing([], i)).toEqual(i);
    expect(mergeStaffing(g, [])).toEqual(g);
    expect(mergeStaffing(g, i)).toEqual([
      { name: '张三', directions: ['后台'], capacity: 80 },
      { name: '李四', directions: ['Web'], capacity: 70 },
    ]);
  });
});

describe('成员状态（v8.3.321+: 出项目成员不参与自动填充）', () => {
  const teamTableWithStatus = (rows: string[]) => [
    '# 团队与 Git 映射',
    '| 成员 | Git 用户名 | 角色 | 技术栈 | 负责模块 | 平台方向 | 投入比例 | 状态 |',
    '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
    ...rows,
  ].join('\n');

  function setupGlobalTeam(content: string) {
    mkdirSync(join(tmp, '.speccore', 'PROJECT'), { recursive: true });
    writeFileSync(join(tmp, '.speccore', 'PROJECT', 'TEAM.md'), content);
  }

  it('全局「出项目」成员被剔除，只返回在职成员', () => {
    setupGlobalTeam(teamTableWithStatus([
      '| 张三 | zs | 后端 | Node.js | 订单 | admin | 80% | 在职 |',
      '| 李四 | ls | 前端 | React | 订单 | h5 | 70% | 出项目 |',
      '| 赵六 | zl | 前端 | Vue | 活动 | miniapp | 60% | |',
    ]));
    expect(loadStaffing(iterDir)).toMatchObject([
      { name: '张三', directions: ['admin'], capacity: 80, status: 'active' },
      { name: '赵六', directions: ['miniapp'], capacity: 60, status: 'active' },
    ]);
  });

  it('迭代写「在职」可复活出项目成员（状态也是可覆盖差异）', () => {
    setupGlobalTeam(teamTableWithStatus([
      '| 李四 | ls | 前端 | React | 订单 | h5 | 70% | 出项目 |',
    ]));
    writeFileSync(join(iterDir, 'STAFFING.md'), [
      '| 成员 | 平台方向 | 投入比例 | 状态 |',
      '| :--- | :--- | :--- | :--- |',
      '| 李四 | h5 | 100% | 在职 |',
    ].join('\n'));
    expect(loadStaffing(iterDir)).toMatchObject([
      { name: '李四', directions: ['h5'], capacity: 100, status: 'active' },
    ]);
  });

  it('迭代写「出项目」可局部停用在职成员', () => {
    setupGlobalTeam(teamTableWithStatus([
      '| 张三 | zs | 后端 | Node.js | 订单 | admin | 80% | 在职 |',
      '| 李四 | ls | 前端 | React | 订单 | h5 | 70% | 在职 |',
    ]));
    writeFileSync(join(iterDir, 'STAFFING.md'), [
      '| 成员 | 平台方向 | 投入比例 | 状态 |',
      '| :--- | :--- | :--- | :--- |',
      '| 张三 | admin | 80% | 出项目 |',
    ].join('\n'));
    expect(loadStaffing(iterDir)).toMatchObject([
      { name: '李四', directions: ['h5'], capacity: 70, status: 'active' },
    ]);
  });

  it('旧表无「状态」列 → 全员在职（兼容不变）', () => {
    setupGlobalTeam([
      '# 团队与 Git 映射',
      '| 成员 | Git 用户名 | 角色 | 技术栈 | 负责模块 | 平台方向 | 投入比例 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
      '| 张三 | zs | 后端 | Node.js | 订单 | admin | 80% |',
    ].join('\n'));
    expect(loadStaffing(iterDir)).toMatchObject([
      { name: '张三', directions: ['admin'], capacity: 80, status: 'active' },
    ]);
  });

  it('方向唯一成员出项目 → 候选推导跳过（不脑补）', () => {
    setupGlobalTeam(teamTableWithStatus([
      '| 张三 | zs | 后端 | Node.js | 订单 | admin | 80% | 出项目 |',
    ]));
    const staffing = loadStaffing(iterDir);
    expect(staffing).toEqual([]);
    expect(deriveOwnerCandidates(['admin'], staffing)).toEqual([]);
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

// ── v8.3.337+: 成员模型扩展（岗位/在项目口径/分支代号/Git 用户名）──
describe('成员模型扩展（v8.3.337+: 岗位/在项目/分支代号）', () => {
  it('parseStaffingTable 解析岗位/在项目/分支代号列', () => {
    const team = parseStaffingTable([
      '| 成员 | Git 用户名 | 岗位 | 技术栈 | 负责模块 | 平台方向 | 投入比例 | 在项目 | 分支代号 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
      '| 张三 | zs | web, 后端 | Node.js | 订单 | 后台 | 80% | 是 | zs |',
      '| 李四 | lisi | 测试 | Go | 支付 | backend-api | 70% | 否 | |',
    ].join('\n'));
    expect(team[0]).toMatchObject({
      name: '张三', gitUser: 'zs', roles: ['web', '后端'], initials: 'zs',
      directions: ['后台'], capacity: 80, status: 'active',
    });
    expect(team[1].status).toBe('inactive');
    expect(team[1].initials).toBeUndefined();
  });

  it('旧表「状态」列仍兼容（在职/出项目 → active/inactive）', () => {
    const staffing = parseStaffingTable([
      '| 成员 | 平台方向 | 投入比例 | 状态 |',
      '| :--- | :--- | :--- | :--- |',
      '| 王五 | APP | 60% | 在职 |',
      '| 赵六 | APP | 50% | 出项目 |',
    ].join('\n'));
    expect(staffing[0].status).toBe('active');
    expect(staffing[1].status).toBe('inactive');
  });

  it('mergeStaffing 空不覆盖：旧迭代 STAFFING 无新列时继承基座岗位/代号', () => {
    const g = [{
      name: '张三', directions: ['后台'], capacity: 80,
      status: 'active' as const, roles: ['后端'], gitUser: 'zs', initials: 'zs',
    }];
    const i = [{
      name: '张三', directions: ['后台'], capacity: 90,
      status: undefined, roles: [] as string[],
    }];
    const merged = mergeStaffing(g, i);
    expect(merged[0]).toMatchObject({
      capacity: 90,       // 比例整体覆盖
      status: 'active',   // 状态空不覆盖（继承基座）
      roles: ['后端'],    // 岗位空不覆盖（继承基座）
      gitUser: 'zs',
      initials: 'zs',
    });
  });
});

// ── v8.3.339+: 通配语义（* / all / 全部 / 全栈 = 全部）──
describe('通配语义（v8.3.339+: 岗位/方向 * = 全部）', () => {
  it('normalizeWildcard 归一：通配词整体归一为 [WILDCARD]', () => {
    expect(normalizeWildcard(['*'])).toEqual(['*']);
    expect(normalizeWildcard(['all'])).toEqual(['*']);
    expect(normalizeWildcard(['全部'])).toEqual(['*']);
    expect(normalizeWildcard(['全栈'])).toEqual(['*']);
    expect(normalizeWildcard(['全端'])).toEqual(['*']);
    expect(normalizeWildcard(['web', '全部'])).toEqual(['*']);   // 与具体值并列以通配为准
    expect(normalizeWildcard(['web', '后端'])).toEqual(['web', '后端']); // 无通配原样返回
  });

  it('isWildcard 只认归一后的 [WILDCARD]', () => {
    expect(isWildcard(['*'])).toBe(true);
    expect(isWildcard(['web'])).toBe(false);
    expect(isWildcard([])).toBe(false);
    expect(isWildcard(['*', 'web'])).toBe(false);
  });

  it('matchDirection 通配恒命中', () => {
    expect(matchDirection('booking-service', WILDCARD)).toBe(true);
    expect(matchDirection('admin-web', WILDCARD)).toBe(true);
  });

  it('parseStaffingTable 解析时归一 roles/directions 通配', () => {
    const members = parseStaffingTable([
      '| 成员 | 岗位 | 平台方向 | 投入比例 |',
      '| :--- | :--- | :--- | :--- |',
      '| 张三 | 全栈 | * | 80% |',
      '| 李四 | web | all | 70% |',
    ].join('\n'));
    expect(members[0].roles).toEqual(['*']);
    expect(members[0].directions).toEqual(['*']);
    expect(members[1].roles).toEqual(['web']);
    expect(members[1].directions).toEqual(['*']);
  });

  it('deriveOwnerCandidates 通配成员不参与「唯一」判定（防唯一误判）', () => {
    const staffing = [
      { name: '全栈甲', directions: ['*'], capacity: 50 },
      { name: '张三', directions: ['后台'], capacity: 80 },
    ];
    // booking-service：张三唯一专向 → 候选；h5-mobile：仅全栈甲命中 → 不推导
    const decls = deriveOwnerCandidates(['booking-service', 'h5-mobile'], staffing);
    expect(decls).toHaveLength(1);
    expect(decls[0]).toEqual({ platform: 'booking-service', name: '张三', status: 'pending' });
  });

  it('deriveOwnerCandidates 只有通配成员 → 全部不推导（报缺不脑补）', () => {
    const staffing = [{ name: '全栈甲', directions: ['全部'], capacity: 50 }];
    expect(deriveOwnerCandidates(['booking-service', 'h5-mobile'], staffing)).toEqual([]);
  });
});
