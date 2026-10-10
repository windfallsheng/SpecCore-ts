/**
 * 示例配置与 DEFAULT_CONFIG 对齐回归基线（v8.3.303+）
 *
 * 背景：examples 里的示例配置曾落后于当前版本（缺 logging/tools/settings.pipeline
 * 等新字段，又残留 project/tech_stack/tests 等已迁移/废弃段），用户照着改没有参考
 * 对象。本测试双向锁定：
 *   - added 为空   → 示例不缺失 DEFAULT_CONFIG 任何字段（新字段未收录即失败）
 *   - removed 为空 → 示例不残留 DEFAULT_CONFIG 之外的过时段（废弃段复活即失败）
 * 未来 DEFAULT_CONFIG 增减字段时，本测试提醒同步 templates/ 与 .speccore/examples/。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { detectConfigDiff, DEFAULT_CONFIG } from '../../../src/core/unified-config';

const ROOT = join(__dirname, '..', '..', '..');
const TEMPLATE_PATH = join(ROOT, 'templates', 'speccore-yml-example.yml');
const EXAMPLES_PATH = join(ROOT, '.speccore', 'examples', 'config', 'SPECCORE-YML-EXAMPLE.yml');

describe('示例配置与 DEFAULT_CONFIG 对齐', () => {
  it('templates/speccore-yml-example.yml 逐字段对齐（无缺无多）', () => {
    const parsed = yaml.load(readFileSync(TEMPLATE_PATH, 'utf-8')) as Record<string, unknown>;
    const diff = detectConfigDiff(parsed, DEFAULT_CONFIG);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.structureChanged).toEqual([]);
  });

  it('.speccore/examples/config/SPECCORE-YML-EXAMPLE.yml 与 templates 同源一致', () => {
    const a = readFileSync(TEMPLATE_PATH);
    const b = readFileSync(EXAMPLES_PATH);
    expect(a.equals(b)).toBe(true);
  });
});
