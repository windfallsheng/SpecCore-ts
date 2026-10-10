/**
 * unitize 默认发现——端级需求文档判定回归基线（v8.3.303+）
 *
 * matchPlatformDoc 锁定三条规则：
 *   1. 新命名 {端名}.md（与源文档同名）命中端名；
 *   2. 旧命名 {端名}requirements.md（v8.3.223~302）兼容命中，不迁移；
 *   3. 总纲 REQUIREMENT.md 与无端文档（PRD 全量等）不命中——自动发现天然排除。
 */

import { describe, it, expect } from 'vitest';
import { matchPlatformDoc } from '../../../src/commands/unitize';

const PLATFORMS = new Set(['admin-web', 'h5-mobile', 'booking-service']);

describe('matchPlatformDoc 端级文档判定', () => {
  it('新命名 {端名}.md 命中对应端名', () => {
    expect(matchPlatformDoc('admin-web.md', PLATFORMS)).toEqual({ matched: true, platform: 'admin-web' });
    expect(matchPlatformDoc('h5-mobile.md', PLATFORMS)).toEqual({ matched: true, platform: 'h5-mobile' });
  });

  it('旧命名 {端名}requirements.md 兼容命中（历史项目不迁移）', () => {
    expect(matchPlatformDoc('admin-webrequirements.md', PLATFORMS)).toEqual({ matched: true, platform: 'admin-web' });
    expect(matchPlatformDoc('booking-servicerequirements.md', PLATFORMS)).toEqual({ matched: true, platform: 'booking-service' });
  });

  it('总纲与无端文档不命中（自动发现排除）', () => {
    expect(matchPlatformDoc('REQUIREMENT.md', PLATFORMS).matched).toBe(false);
    expect(matchPlatformDoc('metting-system-prd.md', PLATFORMS).matched).toBe(false);
    expect(matchPlatformDoc('overview.md', PLATFORMS).matched).toBe(false);
    expect(matchPlatformDoc('prd-requirements.md', PLATFORMS).matched).toBe(false);
  });

  it('端名单无 requirements 别名时不误伤', () => {
    // 有端名恰以 requirements 结尾的极端场景下仍按精确端名命中
    const special = new Set(['api-requirements', 'admin-web']);
    expect(matchPlatformDoc('api-requirements.md', special)).toEqual({ matched: true, platform: 'api-requirements' });
    expect(matchPlatformDoc('api-requirementsrequirements.md', special)).toEqual({ matched: true, platform: 'api-requirements' });
  });
});
