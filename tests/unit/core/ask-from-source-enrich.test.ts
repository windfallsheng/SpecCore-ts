/**
 * v8.3.301+: from-source 端名自动映射回归基线
 *
 * 覆盖 resolvePlatformFromInput 纯函数：
 *   - 英文端名最长命中（防短名子串误伤）
 *   - 中文端描述/工程名兜底命中
 *   - 无端名静默返回 null
 * 与 enrichFromSourceCommand 的异步装配（mock loadProjectConfig）。
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

import { resolvePlatformFromInput, enrichFromSourceCommand } from '../../../src/core/ask-engine';

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
});
