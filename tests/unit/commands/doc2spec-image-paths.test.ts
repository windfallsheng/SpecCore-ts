import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { fixImageRefs } from '../../../src/commands/doc2spec';
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
