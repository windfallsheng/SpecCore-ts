import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { fixImageRefs, extractLocalImages } from '../../../src/commands/doc2spec';
import { rebaseImageRefs } from '../../../src/commands/spec2doc';
import { imgTagsToMarkdown } from '../../../src/utils/markdown-image';

// ═══════════════════════════════════════════════════════════
// 文档转换图片路径修复（v8.3.331）
// bug：pandoc 输出 <img src="<相对cwd完整路径>">，修正正则只匹配 ](media/
// 完全失配——md 里留下相对 cwd 的错路径（从 MD 文件位置解析必裂）；
// Windows 上 join 产出反斜杠，md 图片路径带 \（Markdown 转义符，必裂）。
// ═══════════════════════════════════════════════════════════
describe('fixImageRefs - doc2spec 图片路径修正（v8.3.331）', () => {
  const mdDir = join('Iteration-001-test', '010-requirements', 'converted');
  const imageDir = join('Iteration-001-test', '010-requirements', 'assets', 'extracted');

  it('pandoc HTML img 完整路径（相对 cwd）→ 相对 MD 文件的正斜杠路径', () => {
    const content = `<figure>\n<img src="Iteration-001-test/010-requirements/assets/extracted/media/rId9.png" style="width:1in" alt="图" />\n</figure>`;
    const out = fixImageRefs(content, mdDir, imageDir);
    expect(out).toContain('src="../assets/extracted/media/rId9.png"');
    expect(out).not.toContain('src="Iteration-001-test');
  });

  it('pandoc markdown 形态 ](完整路径) → 相对路径', () => {
    const content = '![图](Iteration-001-test/010-requirements/assets/extracted/media/rId9.png)';
    const out = fixImageRefs(content, mdDir, imageDir);
    expect(out).toContain('](../assets/extracted/media/rId9.png)');
  });

  it('Windows 反斜杠形态（pandoc src 带 \）→ 统一归一化正斜杠', () => {
    const content =
      '<img src="Iteration-001-test\\010-requirements\\assets\\extracted\\media\\rId9.png" alt="图" />';
    const out = fixImageRefs(content, mdDir, imageDir);
    expect(out).toContain('src="../assets/extracted/media/rId9.png"');
    expect(out).not.toContain('\\');
  });

  it('旧版简写 media/xxx → relAssets/media/xxx', () => {
    const content = '![图](media/rId9.png)';
    const out = fixImageRefs(content, mdDir, imageDir);
    expect(out).toContain('](../assets/extracted/media/rId9.png)');
  });

  it('外链 / 锚点 / data URI 不动', () => {
    const content = '![a](https://x.com/a.png)\n![b](#anchor)\n![c](data:image/png;base64,xxx)';
    const out = fixImageRefs(content, mdDir, imageDir);
    expect(out).toContain('](https://x.com/a.png)');
    expect(out).toContain('](#anchor)');
    expect(out).toContain('](data:image/png;base64,xxx)');
  });
});

describe('rebaseImageRefs - spec2doc 多文件合并路径 rebase（v8.3.331）', () => {
  it('相对源文件的图片路径 rebase 到 cwd 基准', () => {
    const fromDir = join('Iteration-001-test', '010-requirements', 'converted');
    const toDir = '.'; // pandoc 解析基准 = cwd
    const content = '![图](../assets/extracted/media/rId9.png)\n<img src="../assets/extracted/media/x.png" alt="x" />';
    const out = rebaseImageRefs(content, fromDir, toDir);
    // ../assets/extracted = Iteration-001-test/010-requirements/assets/extracted
    // 从 cwd 出发的相对路径
    expect(out).toContain('](Iteration-001-test/010-requirements/assets/extracted/media/rId9.png)');
    expect(out).toContain('src="Iteration-001-test/010-requirements/assets/extracted/media/x.png"');
    expect(out).not.toContain('\\');
  });

  it('外链 / 绝对路径 / 锚点不动', () => {
    const content = '![a](https://x.com/a.png)\n![b](/abs/p.png)\n![c](#anchor)';
    const out = rebaseImageRefs(content, 'src', '.speccore');
    expect(out).toContain('](https://x.com/a.png)');
    expect(out).toContain('](/abs/p.png)');
    expect(out).toContain('](#anchor)');
  });
});

describe('imgTagsToMarkdown - HTML img → markdown 语法（v8.3.331）', () => {
  it('独立 <img> 标签 → ![alt](src)，丢弃 style 属性', () => {
    const content = '<img src="a/b.png" style="width:0.14in;height:0.14in" alt="图1" />';
    expect(imgTagsToMarkdown(content)).toBe('![图1](a/b.png)');
  });

  it('属性顺序颠倒（alt 在前）也能转换', () => {
    const content = '<img alt="图2" src="c/d.png" />';
    expect(imgTagsToMarkdown(content)).toBe('![图2](c/d.png)');
  });

  it('<figure> 包裹：图片转 markdown + 图注剥 p 标签保留文本', () => {
    const content =
      '<figure>\n<img src="a/b.png" style="width:1in" alt="图" />\n<figcaption aria-hidden="true"><p>测试图</p></figcaption>\n</figure>';
    const out = imgTagsToMarkdown(content);
    expect(out).toContain('![图](a/b.png)');
    expect(out).toContain('测试图');
    expect(out).not.toContain('<figure');
    expect(out).not.toContain('<figcaption');
    expect(out).not.toContain('<p>');
  });

  it('行内 img 不破坏周围文本', () => {
    const content = '文字前<img src="x.png" alt="内联" />文字后';
    expect(imgTagsToMarkdown(content)).toBe('文字前![内联](x.png)文字后');
  });
});

// ═══════════════════════════════════════════════════════════
// .md 导入本地图片提取（v8.3.386，BUG-1 修复）
// bug：.md 直接导入只做 fixImageRefs（仅处理 pandoc media/ 形态），
// 原始相对路径（./xxx.png）原样保留 → converted 引用断链、图片 0 张。
// ═══════════════════════════════════════════════════════════
describe('extractLocalImages - .md 导入本地图片提取（v8.3.386）', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'spec-extract-img-'));
  const srcDir = join(tmpRoot, 'prd-src');
  const imageDir = join(tmpRoot, 'Iteration-001-img', '010-requirements', 'assets', 'extracted');
  const mdDir = join(tmpRoot, 'Iteration-001-img', '010-requirements', 'converted');

  beforeAll(() => {
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(imageDir, { recursive: true });
    mkdirSync(mdDir, { recursive: true });
    writeFileSync(join(srcDir, 'order-list.png'), 'fake-png');
    writeFileSync(join(srcDir, 'logo.png'), 'fake-png');
    writeFileSync(join(srcDir, 'detail.png'), 'fake-png');
    writeFileSync(join(imageDir, 'logo.png'), 'existing-png');
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('本地相对路径图片复制到 extracted 且引用改写为相对 converted/ 路径', async () => {
    const content = '![订单列表](./order-list.png)\n正文内容';
    const r = await extractLocalImages(content, srcDir, imageDir, mdDir);
    expect(r.extracted).toBe(1);
    expect(r.content).toContain('assets/extracted/order-list.png');
    expect(existsSync(join(imageDir, 'order-list.png'))).toBe(true);
  });

  it('HTML <img> 形态同样提取', async () => {
    const content = '<img src="./detail.png" alt="详情" />';
    const r = await extractLocalImages(content, srcDir, imageDir, mdDir);
    expect(r.extracted).toBe(1);
    expect(r.content).toContain('src="../assets/extracted/detail.png"');
  });

  it('重名文件加 -2 序号防覆盖', async () => {
    const r = await extractLocalImages('![logo](./logo.png)', srcDir, imageDir, mdDir);
    expect(r.extracted).toBe(1);
    expect(r.content).toContain('logo-2.png');
    expect(existsSync(join(imageDir, 'logo-2.png'))).toBe(true);
  });

  it('外链 / 锚点 / 不存在的本地文件不动', async () => {
    const content = '![a](https://x.com/a.png)\n![b](#anchor)\n![c](./gone.png)';
    const r = await extractLocalImages(content, srcDir, imageDir, mdDir);
    expect(r.extracted).toBe(0);
    expect(r.content).toContain('](https://x.com/a.png)');
    expect(r.content).toContain('](#anchor)');
    expect(r.content).toContain('](./gone.png)');
  });
});
