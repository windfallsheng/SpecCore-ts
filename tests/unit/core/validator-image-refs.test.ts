import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { validateContent } from '../../../src/core/doc-validator';

// 回归：v8.3.332 图片引用校验补 HTML <img> 形态 + Windows 反斜杠归一化
// 背景：doc2spec 旧产物/手写文档可能含 HTML img 标签或反斜杠路径，此前 checkImages 漏检/误报

const tmpRoot = mkdtempSync(join(tmpdir(), 'spec-validator-img-'));
const iterDir = join(tmpRoot, 'Iteration-001-img');
const outputDir = join(iterDir, '010-requirements', 'converted');
const extractedDir = join(iterDir, '010-requirements', 'assets', 'extracted', 'media');

beforeAll(() => {
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(extractedDir, { recursive: true });
  writeFileSync(join(extractedDir, 'rId9.png'), 'fake-png');
  writeFileSync(join(outputDir, 'local.png'), 'fake-png');
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

async function imageIssues(content: string): Promise<string[]> {
  const report = await validateContent(content, outputDir, iterDir);
  return report.issues
    .filter(i => i.category === 'image')
    .map(i => i.description);
}

describe('Validator — 图片引用校验（HTML img 形态）', () => {
  it('HTML <img> 引用的图片存在时不报错（修复前漏检）', async () => {
    const issues = await imageIssues('<img src="local.png" alt="图" />');
    expect(issues).toHaveLength(0);
  });

  it('HTML <img> 引用缺失图片时报错（修复前完全漏检）', async () => {
    const issues = await imageIssues('<img src="missing.png" alt="缺失" />');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain('missing.png');
  });

  it('HTML <img> src 在 alt 之后也能提取', async () => {
    const issues = await imageIssues('<img alt="缺失" src="missing.png" />');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain('missing.png');
  });
});

describe('Validator — 图片引用校验（反斜杠归一化）', () => {
  it('markdown 语法 + 反斜杠路径能命中 extracted 目录（修复前 basename 拆分失效误报）', async () => {
    const issues = await imageIssues('![图](..\\assets\\extracted\\media\\rId9.png)');
    expect(issues).toHaveLength(0);
  });

  it('markdown 语法 + 反斜杠缺失图片仍报错且路径已归一化', async () => {
    const issues = await imageIssues('![图](..\\assets\\extracted\\media\\gone.png)');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain('gone.png');
    expect(issues[0]).not.toContain('\\');
  });
});
