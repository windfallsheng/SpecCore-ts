/**
 * AI 友好输出 — 将 HTML 页面转为结构化 Markdown，供 AI 读懂后展示
 */
export function htmlToAiMarkdown(html: string): string {
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace('SpecCore ', '') : '';

  const headings = [...html.matchAll(/<(h[12])[^>]*>([^<]+)<\/\1>/gi)];
  const items = [...html.matchAll(/<li>([^<]+)<\/li>/gi)];

  const lines: string[] = ['# SpecCore ' + title, ''];

  for (const [, , text] of headings) {
    lines.push('## ' + text.replace(/&[a-z]+;/g, ' ').trim());
  }

  if (items.length > 0) {
    lines.push('');
    for (const [, text] of items.slice(0, 20)) {
      const clean = text.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, '').trim();
      if (clean && clean.length > 1) lines.push('- ' + clean);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('> AI 请基于以上结构化信息，按此模板格式回答用户问题。');

  return lines.join('\n');
}
