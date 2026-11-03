/**
 * prompts 双通道回归基线（v8.3.350+）
 *
 * 修复历史：页面侧新建/编辑只写 localStorage，CLI 只读 .speccore/prompts/user/*.json，
 * 两条通道不打通；且页面生成读 process.cwd()，--project-dir / 联动场景读错目录。
 *
 * 验证：
 *   1. --import 落盘（数组 / { prompts } 包装 / 无效条目过滤 / 合并去重）；
 *   2. --export 导出 user 目录内容；
 *   3. generatePromptsPage 的 projectRoot 参数化（读指定目录而非 process.cwd()）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, pathExists, remove } from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  importUserPrompts,
  exportUserPrompts,
  generatePromptsPage,
} from '../../../src/commands/prompts';

let tmp: string;
let root: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'prompts-'));
  root = join(tmp, 'proj');
});

afterEach(async () => {
  await remove(tmp);
});

const USER_DIR = () => join(root, '.speccore', 'prompts', 'user');

describe('importUserPrompts 落盘', () => {
  it('数组 JSON 导入：落盘 custom-imported.json 并规范化（builtin=false + 参数提取）', async () => {
    const src = join(tmp, 'in.json');
    await writeFile(src, JSON.stringify([
      { id: 'a1', name: '周会汇报', category: 'custom', prompt: '总结 {迭代名} 进展' },
    ]));

    await importUserPrompts(src, root);

    const out = join(USER_DIR(), 'custom-imported.json');
    expect(await pathExists(out)).toBe(true);
    const items = JSON.parse(await readFile(out, 'utf-8'));
    expect(items).toHaveLength(1);
    expect(items[0].builtin).toBe(false);
    expect(items[0].params).toEqual([{ key: '迭代名', placeholder: '', required: false }]);
  });

  it('{ prompts: [...] } 包装格式同样导入', async () => {
    const src = join(tmp, 'wrapped.json');
    await writeFile(src, JSON.stringify({ prompts: [{ name: '代码审查', prompt: '审查 {任务ID}' }] }));

    await importUserPrompts(src, root);

    const items = JSON.parse(await readFile(join(USER_DIR(), 'custom-imported.json'), 'utf-8'));
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('代码审查');
  });

  it('无 id 条目：生成 prompt- + UUID v4 唯一 id，并自动补 createdAt（v8.3.350 修复同毫秒撞 id）', async () => {
    const src = join(tmp, 'noid.json');
    await writeFile(src, JSON.stringify([
      { name: '条目一', prompt: '内容一' },
      { name: '条目二', prompt: '内容二' },
    ]));

    await importUserPrompts(src, root);

    const items = JSON.parse(await readFile(join(USER_DIR(), 'custom-imported.json'), 'utf-8'));
    expect(items).toHaveLength(2);
    const uuidRe = /^prompt-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(items[0].id).toMatch(uuidRe);
    expect(items[1].id).toMatch(uuidRe);
    expect(items[0].id).not.toBe(items[1].id);
    expect(items[0].createdAt).toBeTruthy();
    expect(items[0].updatedAt).toBeTruthy();
  });

  it('无效条目被过滤，全无效时不落盘', async () => {
    const src = join(tmp, 'bad.json');
    await writeFile(src, JSON.stringify([
      { name: '缺 prompt 字段' },
      { prompt: '缺 name 字段' },
      { name: '', prompt: '空名' },
    ]));

    await importUserPrompts(src, root);

    expect(await pathExists(join(USER_DIR(), 'custom-imported.json'))).toBe(false);
  });

  it('文件不存在时报错且不落盘', async () => {
    await importUserPrompts(join(tmp, 'missing.json'), root);
    expect(await pathExists(USER_DIR())).toBe(false);
  });

  it('合并策略：同 id 以导入条目为准，不同 id 旧条目保留', async () => {
    const dir = USER_DIR();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'existing.json'), JSON.stringify([
      { id: 'keep', name: '旧条目保留', prompt: '旧内容' },
      { id: 'same', name: '旧版本', prompt: '旧内容' },
    ]));

    const src = join(tmp, 'in.json');
    await writeFile(src, JSON.stringify([
      { id: 'same', name: '新版本', prompt: '新内容' },
      { id: 'fresh', name: '新条目', prompt: '新内容' },
    ]));

    await importUserPrompts(src, root);

    const items = JSON.parse(await readFile(join(dir, 'custom-imported.json'), 'utf-8'));
    expect(items).toHaveLength(3);
    const same = items.find((p: any) => p.id === 'same');
    expect(same.name).toBe('新版本');
    expect(items.some((p: any) => p.id === 'keep')).toBe(true);
    expect(items.some((p: any) => p.id === 'fresh')).toBe(true);
  });
});

describe('exportUserPrompts 导出', () => {
  it('导出 user 目录内容为 JSON 文件', async () => {
    const dir = USER_DIR();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'a.json'), JSON.stringify([
      { id: 'x1', name: '导出一', prompt: '内容一', builtin: false },
    ]));

    const out = join(tmp, 'exported.json');
    await exportUserPrompts(out, root);

    expect(await pathExists(out)).toBe(true);
    const items = JSON.parse(await readFile(out, 'utf-8'));
    expect(items).toHaveLength(1);
    expect(items[0].builtin).toBe(false);
  });

  it('无自定义提示词时导出空数组', async () => {
    const out = join(tmp, 'empty.json');
    await exportUserPrompts(out, root);
    expect(JSON.parse(await readFile(out, 'utf-8'))).toEqual([]);
  });
});

describe('generatePromptsPage projectRoot 参数化', () => {
  it('读指定 projectRoot 的 presets/user，而非 process.cwd()', async () => {
    await mkdir(join(root, '.speccore', 'prompts', 'presets'), { recursive: true });
    await writeFile(join(root, '.speccore', 'prompts', 'presets', 'p.json'), JSON.stringify([
      { id: 'p1', name: '预置一', category: 'workflow', icon: '📖', description: 'd', prompt: 'p', params: [], builtin: true, sort: 1 },
    ]));

    const pagePath = await generatePromptsPage(undefined, root);

    expect(pagePath).toBe(join(root, 'outputs', 'speccore-prompts.html'));
    const html = await readFile(pagePath, 'utf-8');
    expect(html).toContain('预置一');
    // 落盘通道 UI：导出/导入按钮 + 持久化提示
    expect(html).toContain('exportToJson');
    expect(html).toContain('importFromJson');
    expect(html).toContain('speccore prompts --import');
    // 新建 id 用 genId（randomUUID + 降级兜底），不再 Date.now() 裸生成
    expect(html).toContain('editingId || genId()');
    expect(html).toContain('crypto.randomUUID');
  });
});
