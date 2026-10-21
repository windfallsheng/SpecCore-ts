/**
 * 配置升级——已知废弃字段豁免回归基线（v8.3.303+）
 *
 * 背景：v8.3.197 以 block_level 取代 quality_gates.compile，旧项目升级时 compile 判
 * removed → 人工确认截停 → 新增字段（verify_ui.devices/browsers 等）永远补不上。
 * filterLegacyRemoved 豁免已知废弃/迁移字段；deleteNestedKey 升级后清理旧键。
 */

import { describe, it, expect } from 'vitest';
import {
  filterLegacyRemoved,
  deleteNestedKey,
  LEGACY_DROP_PATHS,
} from '../../../src/core/unified-config';

describe('filterLegacyRemoved 废弃字段豁免', () => {
  it('已知废弃嵌套字段（quality_gates.compile）不触发截停', () => {
    const diff = {
      added: ['quality_gates.verify_ui.devices'],
      removed: ['quality_gates.compile'],
      typeChanged: [],
      enumChanged: [],
      structureChanged: [],
    };
    const filtered = filterLegacyRemoved(diff);
    expect(filtered.removed).toEqual([]);
    expect(filtered.added).toEqual(['quality_gates.verify_ui.devices']);
  });

  it('旧版顶层字段（platforms/git 等）豁免，未知字段仍保留', () => {
    const diff = {
      added: [],
      removed: ['platforms', 'tech_stack', 'unknown_custom_field'],
      typeChanged: [],
      enumChanged: [],
      structureChanged: [],
    };
    const filtered = filterLegacyRemoved(diff);
    expect(filtered.removed).toEqual(['unknown_custom_field']);
  });

  it('LEGACY_DROP_PATHS 收录 quality_gates.compile', () => {
    expect(LEGACY_DROP_PATHS.has('quality_gates.compile')).toBe(true);
  });
});

describe('deleteNestedKey 嵌套键清理', () => {
  it('删除多层嵌套键', () => {
    const obj = { quality_gates: { compile: '仅编译阻塞', verify_ui: { enabled: false } } };
    deleteNestedKey(obj, 'quality_gates.compile');
    expect(obj).toEqual({ quality_gates: { verify_ui: { enabled: false } } });
  });

  it('路径不存在时静默跳过，不抛错', () => {
    const obj = { quality_gates: { verify_ui: { enabled: false } } };
    expect(() => deleteNestedKey(obj, 'quality_gates.compile')).not.toThrow();
    expect(() => deleteNestedKey(obj, 'nonexistent.path.key')).not.toThrow();
    expect(obj).toEqual({ quality_gates: { verify_ui: { enabled: false } } });
  });
});

// ── v8.3.337+: 开放式字典子树豁免（branch_types prefix/suffix 误判 removed 修复）──
import { detectConfigDiff, DEFAULT_PROJECT_CONFIG } from '../../../src/core/unified-config';

describe('detectConfigDiff 开放式字典子树豁免（v8.3.337+）', () => {
  it('branch_types.feature 自定义 prefix/suffix 不再判 removed（此前截停升级死循环）', () => {
    const current = {
      git: {
        default_base: 'main',
        branch_types: {
          feature: { prefix: 'api-', suffix: '-urgent', source: 'develop' },
        },
      },
    };
    const diff = detectConfigDiff(current, DEFAULT_PROJECT_CONFIG as unknown);
    const removedInBranchTypes = diff.removed.filter(p => p.includes('branch_types'));
    expect(removedInBranchTypes).toEqual([]);
  });

  it('branch_types 自定义类型名（开放式键）仍豁免 removed', () => {
    const current = {
      git: {
        default_base: 'main',
        branch_types: {
          experiment: { prefix: 'exp-', source: 'develop' },
        },
      },
    };
    const diff = detectConfigDiff(current, DEFAULT_PROJECT_CONFIG as unknown);
    const removedInBranchTypes = diff.removed.filter(p => p.includes('branch_types'));
    expect(removedInBranchTypes).toEqual([]);
  });

  it('git 段真正废弃的未知字段仍判 removed（豁免不泛滥）', () => {
    const current = {
      git: {
        default_base: 'main',
        obsolete_field: 'should-be-removed',
      },
    };
    const diff = detectConfigDiff(current, DEFAULT_PROJECT_CONFIG as unknown);
    expect(diff.removed).toContain('git.obsolete_field');
  });

  it('DEFAULT_PROJECT_CONFIG 收录 branch_format 默认值（老项目升级自动带出）', () => {
    expect((DEFAULT_PROJECT_CONFIG.git as { branch_format?: string }).branch_format).toBe('{type}/{prefix}{taskId}');
    // 与 GitConfig 硬编码默认一致 → 补全后行为零变化
    const noBranchFormat = { git: { default_base: 'main' } };
    const diff = detectConfigDiff(noBranchFormat, DEFAULT_PROJECT_CONFIG as unknown);
    expect(diff.added).toContain('git.branch_format');
  });
});
