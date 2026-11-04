import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeClarifiedDoc } from '../../../src/core/requirement-clarifier';

// ═══════════════════════════════════════════════════════════
// 澄清产物命名（v8.3.386，BUG-6 修复）
// bug：多功能单元文档级澄清时产物同名 SOURCE-clarified.md，后者覆盖前者，
// 旧文件仅时间戳备份。携带单元目录名 hint 后产物 {单元}-clarified.md 一一对应。
// ═══════════════════════════════════════════════════════════
const tmpRoot = mkdtempSync(join(tmpdir(), 'spec-clarify-name-'));
const iterDir = join(tmpRoot, 'Iteration-001-name');
const goldenDir = join(iterDir, '020-specs', 'requirements');

beforeAll(() => {
  mkdirSync(goldenDir, { recursive: true });
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('writeClarifiedDoc - 澄清产物命名（v8.3.386）', () => {
  it('通用源名 SOURCE.md + 单元 hint → {单元}-clarified.md', async () => {
    const p = await writeClarifiedDoc('# 澄清内容', iterDir, 'SOURCE.md', 'admin-web-01-yudingguanli');
    expect(p.endsWith('admin-web-01-yudingguanli-clarified.md')).toBe(true);
    expect(existsSync(join(goldenDir, 'admin-web-01-yudingguanli-clarified.md'))).toBe(true);
  });

  it('多单元各自澄清互不覆盖（第二个单元独立落盘）', async () => {
    await writeClarifiedDoc('# 单元A', iterDir, 'SOURCE.md', 'admin-web-02-dingdanliebiao');
    expect(existsSync(join(goldenDir, 'admin-web-01-yudingguanli-clarified.md'))).toBe(true);
    expect(existsSync(join(goldenDir, 'admin-web-02-dingdanliebiao-clarified.md'))).toBe(true);
  });

  it('无 unit hint 时保持旧行为（SOURCE-clarified.md）', async () => {
    const p = await writeClarifiedDoc('# 内容', iterDir, 'SOURCE.md');
    expect(p.endsWith('SOURCE-clarified.md')).toBe(true);
  });

  it('非通用源名（带语义）不受 hint 影响', async () => {
    const p = await writeClarifiedDoc('# 内容', iterDir, '订单管理.md', 'some-unit');
    expect(p.endsWith('订单管理-clarified.md')).toBe(true);
  });

  it('同名重写自动时间戳备份', async () => {
    await writeClarifiedDoc('# 第一版', iterDir, 'SOURCE.md', 'admin-web-03-beifen');
    await writeClarifiedDoc('# 第二版', iterDir, 'SOURCE.md', 'admin-web-03-beifen');
    const files = readdirSync(goldenDir).filter(f => f.includes('admin-web-03-beifen'));
    expect(files.length).toBeGreaterThanOrEqual(2); // 当前版本 + 时间戳备份
  });
});
