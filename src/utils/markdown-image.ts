/**
 * 图片 HTML → Markdown 语法转换（v8.3.331）
 *
 * 实测 pandoc 的 gfm reader 不解析 raw HTML <img> 标签——转 docx 时图片静默丢失，
 * 只有 markdown 语法 ![alt](src) 才会被嵌入。doc2spec 的 pandoc 输出是
 * <img src="..." style="..." alt="..." />（或 <figure> 包裹），需统一转为 markdown：
 *   - 独立/行内 <img> → ![alt](src)
 *   - <figure><img/><figcaption>xx</figcaption></figure> → ![alt](src) + 图注文本段落
 * 顺带丢弃 style 宽度属性（pandoc 写的 0.14in 会把 docx 里图片缩得极小，原尺寸更合理）。
 */

function imgTagToMd(tag: string): string {
  const src = /src="([^"]+)"/.exec(tag)?.[1] ?? '';
  const alt = /alt="([^"]*)"/.exec(tag)?.[1] ?? '';
  return `![${alt}](${src})`;
}

export function imgTagsToMarkdown(content: string): string {
  // <figure> 整体转换：图片转 markdown，图注剥 p 标签保留为文本段落
  content = content.replace(/<figure>\s*([\s\S]*?)\s*<\/figure>/g, (_m, inner: string) => {
    const img = /<img\b[^>]*\/?>/.exec(inner);
    const cap = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/.exec(inner);
    const parts: string[] = [];
    if (img) parts.push(imgTagToMd(img[0]));
    if (cap) parts.push(cap[1].replace(/<\/?p[^>]*>/g, '').trim());
    return parts.join('\n\n');
  });
  // 行内/独立 <img> 标签 → ![alt](src)
  return content.replace(/<img\b[^>]*\/?>/g, imgTagToMd);
}
