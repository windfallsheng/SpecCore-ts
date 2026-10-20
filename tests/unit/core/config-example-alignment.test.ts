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
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { detectConfigDiff, DEFAULT_CONFIG, DEFAULT_PROJECT_CONFIG } from '../../../src/core/unified-config';

const ROOT = join(__dirname, '..', '..', '..');
const TEMPLATE_PATH = join(ROOT, 'templates', 'speccore-yml-example.yml');
const EXAMPLES_PATH = join(ROOT, '.speccore', 'examples', 'config', 'SPECCORE-YML-EXAMPLE.yml');
const EXAMPLES_DIR = join(ROOT, '.speccore', 'examples');

/** 解析 YAML 并剥离注释（示例文件含大量教学注释） */
function loadYaml(path: string): Record<string, unknown> {
  const stripped = readFileSync(path, 'utf-8').replace(/^#.*$/gm, '');
  return yaml.load(stripped) as Record<string, unknown>;
}

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

  it('PROJECT-EXAMPLE.yaml 逐字段对齐 DEFAULT_PROJECT_CONFIG（无缺无多）', () => {
    const parsed = loadYaml(join(EXAMPLES_DIR, 'config', 'PROJECT-EXAMPLE.yaml'));
    const diff = detectConfigDiff(parsed, DEFAULT_PROJECT_CONFIG as unknown);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.structureChanged).toEqual([]);
  });

  it('TEMPLATE 复制类示例落地副本与 templates 源同源一致', () => {
    const pairs: Array<[string, string]> = [
      ['ci/github-actions.yml', 'ci/github-actions.yml'],
      ['config/DEPLOY-EXAMPLE.yaml', 'deploy-examples.yaml'],
      ['config/VERIFY-EXAMPLE.yaml', 'verify-spec-example.yaml'],
      ['config/API-DESIGN-EXAMPLE.md', 'api-design-example.md'],
      ['config/DATABASE-EXAMPLE.md', 'database-example.md'],
      ['config/SECURITY-EXAMPLE.md', 'security-example.md'],
    ];
    for (const [rel, tpl] of pairs) {
      const a = readFileSync(join(EXAMPLES_DIR, rel));
      const b = readFileSync(join(ROOT, 'templates', tpl));
      expect(a.equals(b), `${rel} 与 templates/${tpl} 不一致（落地副本落后或漂移）`).toBe(true);
    }
  });

  it('TEAM/STAFFING 人员示例存在（init 产物不可缺失）', () => {
    expect(existsSync(join(EXAMPLES_DIR, 'config', 'TEAM-EXAMPLE.md')), 'TEAM-EXAMPLE.md 缺失').toBe(true);
    expect(existsSync(join(EXAMPLES_DIR, 'config', 'STAFFING-EXAMPLE.md')), 'STAFFING-EXAMPLE.md 缺失').toBe(true);
  });

  it('CI 模板中的 speccore 子命令均为现行 CLI 命令', () => {
    const ciTpl = readFileSync(join(ROOT, 'templates', 'ci', 'github-actions.yml'), 'utf-8');
    const used = [...ciTpl.matchAll(/speccore[ \t]+([a-z-]+)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    // CLI 现行命令注册表（cli.ts 的 .command 名称 + 常用别名）
    const cliSrc = readFileSync(join(ROOT, 'src', 'cli.ts'), 'utf-8');
    const registered = new Set(
      [...cliSrc.matchAll(/\.command\('([a-z-]+)'\)/g)].map((m) => m[1])
    );
    for (const cmd of used) {
      expect(registered.has(cmd), `CI 模板引用了未注册命令: speccore ${cmd}`).toBe(true);
    }
  });
});
