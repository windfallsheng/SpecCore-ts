/**
 * v8.3.301+: from-source 端名自动映射回归基线
 *
 * 覆盖 resolvePlatformFromInput 纯函数：
 *   - 英文端名最长命中（防短名子串误伤）
 *   - 中文端描述/工程名兜底命中
 *   - 无端名静默返回 null
 * 与 enrichFromSourceCommand 的异步装配（mock loadProjectConfig）。
 *
 * v8.3.381+: 类型词多端解析（resolvePlatformsFromInput）——
 *   「所有前端项目」→ 全部 frontend 端（不再漏配 --src 把后端一起反推）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const configState = vi.hoisted(() => ({ platforms: [] as any[] }));

vi.mock('../../../src/core/unified-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/unified-config')>();
  return {
    ...actual,
    loadProjectConfig: vi.fn(async () => ({ platforms: configState.platforms })),
  };
});

import { resolvePlatformFromInput, resolvePlatformsFromInput, enrichFromSourceCommand, resolveGlobalSubCommand } from '../../../src/core/ask-engine';

const PLATFORMS = [
  { name: 'booking-service', type: 'backend', description: '预订订单服务', project_name: '会议预订后端', code_path: './packages/backend/booking-service', default_branch: 'main' },
  { name: 'admin-web', type: 'frontend', description: '食堂后台管理', project_name: '食堂管理后台', default_branch: 'main' },
  { name: 'h5-mobile', type: 'frontend', description: 'H5移动端', default_branch: 'main' },
] as any[];

describe('resolvePlatformFromInput 端名解析', () => {
  it('英文端名命中', () => {
    const hit = resolvePlatformFromInput('根据 booking-service 端生成需求文档', PLATFORMS);
    expect(hit?.name).toBe('booking-service');
  });

  it('英文端名最长命中优先（admin-web 优于 admin 子串场景）', () => {
    const hit = resolvePlatformFromInput('按 admin-web 端反推需求', PLATFORMS);
    expect(hit?.name).toBe('admin-web');
  });

  it('中文端描述兜底命中', () => {
    const hit = resolvePlatformFromInput('按食堂后台管理端生成需求', PLATFORMS);
    expect(hit?.name).toBe('admin-web');
  });

  it('中文工程名兜底命中', () => {
    const hit = resolvePlatformFromInput('从会议预订后端工程生成需求文档', PLATFORMS);
    expect(hit?.name).toBe('booking-service');
  });

  it('无端名返回 null', () => {
    expect(resolvePlatformFromInput('全局分析项目架构', PLATFORMS)).toBeNull();
    expect(resolvePlatformFromInput('生成需求文档', PLATFORMS)).toBeNull();
  });

  it('空端列表返回 null', () => {
    expect(resolvePlatformFromInput('根据 booking-service 端生成需求', [])).toBeNull();
  });
});

describe('resolveGlobalSubCommand 技术分析 vs 反推需求分流（v8.3.393+）', () => {
  it('中性「全局分析」句默认纯技术（analyze --no-product，不反推需求）', () => {
    expect(resolveGlobalSubCommand('全局分析所有工程的源码')).toBe('analyze --no-product');
    expect(resolveGlobalSubCommand('全局技术分析')).toBe('analyze --no-product');
    expect(resolveGlobalSubCommand('全局分析项目架构')).toBe('analyze --no-product');
    expect(resolveGlobalSubCommand('分析所有端的源码')).toBe('analyze --no-product');
  });

  it('反推词路由 from-source（反推需求文档）', () => {
    expect(resolveGlobalSubCommand('反推需求')).toBe('from-source');
    expect(resolveGlobalSubCommand('从源码反推需求')).toBe('from-source');
    expect(resolveGlobalSubCommand('全局分析所有工程并生成需求文档')).toBe('from-source');
  });

  it('显式要产品层/需求文档时保留 4a（analyze 不拼 --no-product）', () => {
    expect(resolveGlobalSubCommand('全局分析，包括产品层')).toBe('analyze');
    expect(resolveGlobalSubCommand('全局分析并生成产品文档')).toBe('analyze');
  });

  it('extractParams.fromCode 优先级最高（无论句义）', () => {
    expect(resolveGlobalSubCommand('全局技术分析', 'true')).toBe('from-source');
    expect(resolveGlobalSubCommand('分析所有工程', true)).toBe('from-source');
  });
});

describe('enrichFromSourceCommand 命令装配', () => {
  beforeEach(() => {
    configState.platforms = PLATFORMS;
  });

  it('端名命中且配了 code_path → 补 --src + --platform', async () => {
    const r = await enrichFromSourceCommand('根据 booking-service 端生成需求文档', 'speccore global from-source');
    expect(r.command).toBe('speccore global from-source --src "./packages/backend/booking-service" --platform "booking-service"');
    expect(r.note).toContain('booking-service');
  });

  it('端名命中但未配 code_path → 只补 --platform 并提示', async () => {
    const r = await enrichFromSourceCommand('按食堂后台管理端反推需求', 'speccore global from-source');
    expect(r.command).toBe('speccore global from-source --platform "admin-web"');
    expect(r.note).toContain('需手动 --src');
  });

  it('无端名 → 命令原样返回', async () => {
    const r = await enrichFromSourceCommand('从源码反推需求', 'speccore global from-source');
    expect(r.command).toBe('speccore global from-source');
    expect(r.note).toBeUndefined();
  });

  // v8.3.381: 类型词多端装配
  it('「所有前端项目」→ 只装配 frontend 端，不碰 backend', async () => {
    configState.platforms = [
      { name: 'booking-service', type: 'backend', description: '预订订单服务', code_path: './packages/backend/booking-service', default_branch: 'main' },
      { name: 'admin-web', type: 'frontend', description: '食堂后台管理', code_path: './packages/frontend/admin-web', default_branch: 'main' },
      { name: 'h5-mobile', type: 'frontend', description: 'H5移动端', code_path: './packages/frontend/h5-mobile', default_branch: 'main' },
    ];
    const r = await enrichFromSourceCommand('分析所有前端项目反推需求文档', 'speccore global from-source');
    expect(r.command).toBe('speccore global from-source --src "./packages/frontend/admin-web,./packages/frontend/h5-mobile" --platform "admin-web,h5-mobile"');
    expect(r.command).not.toContain('booking-service');
    expect(r.note).toContain('admin-web,h5-mobile');
  });

  it('「反推所有后端」→ 只装配 backend 端', async () => {
    const r = await enrichFromSourceCommand('反推所有后端工程的需求', 'speccore global from-source');
    expect(r.command).toBe('speccore global from-source --src "./packages/backend/booking-service" --platform "booking-service"');
    expect(r.command).not.toContain('admin-web');
  });

  it('「所有工程」全量词 → 全部端装配', async () => {
    const r = await enrichFromSourceCommand('反推所有工程的需求文档', 'speccore global from-source');
    expect(r.command).toBe('speccore global from-source --src "./packages/backend/booking-service" --platform "booking-service,admin-web,h5-mobile"');
  });
});

describe('resolvePlatformsFromInput 类型词多端解析', () => {
  it('类型词「前端」→ 全部 frontend 端', () => {
    const hit = resolvePlatformsFromInput('分析所有前端项目反推需求文档', PLATFORMS);
    expect(hit.map(p => p.name)).toEqual(['admin-web', 'h5-mobile']);
  });

  it('类型词「后端」→ 全部 backend 端', () => {
    const hit = resolvePlatformsFromInput('反推所有后端需求', PLATFORMS);
    expect(hit.map(p => p.name)).toEqual(['booking-service']);
  });

  it('精确单端命中优先于类型词（不扩成所有后端）', () => {
    const hit = resolvePlatformsFromInput('从会议预订后端工程生成需求文档', PLATFORMS);
    expect(hit.map(p => p.name)).toEqual(['booking-service']);
  });

  it('前后端同现 → 两类并集', () => {
    const hit = resolvePlatformsFromInput('反推前后端所有需求', PLATFORMS);
    expect(hit.map(p => p.name)).toEqual(['booking-service', 'admin-web', 'h5-mobile']);
  });

  it('全量词「所有工程」→ 全部端', () => {
    const hit = resolvePlatformsFromInput('反推所有工程的需求', PLATFORMS);
    expect(hit).toHaveLength(3);
  });

  it('无端名无类型词 → 空数组', () => {
    expect(resolvePlatformsFromInput('从源码反推需求', PLATFORMS)).toEqual([]);
    expect(resolvePlatformsFromInput('全局分析项目架构', [])).toEqual([]);
  });
});
