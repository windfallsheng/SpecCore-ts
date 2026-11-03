/**
 * v8.3.370: stripLeadingFrontmatter 回归测试。
 * 背景：宿主 AI 按澄清剧本回传 [CLARIFY:...] 块时自带 source/status frontmatter，
 * CLI 落盘统一追加系统头，不剥离则产出双 frontmatter 文件。
 */
import { describe, it, expect } from 'vitest';
import { stripLeadingFrontmatter } from '../../../src/core/requirement-clarifier';

describe('stripLeadingFrontmatter 剥离回传内容自带 frontmatter', () => {
  const withFm = [
    '---',
    'source: "010-requirements/converted/foo.md"',
    'status: "clarified"',
    '---',
    '',
    '# 澄清后的专业 PRD',
    '',
    '## 术语表',
    '',
    '| 术语 | 定义 |',
    '| :--- | :--- |',
    '| 变更需求 | 修改已有功能 |',
  ].join('\n');

  it('剥离 --- 包裹的 frontmatter，保留正文', () => {
    const body = stripLeadingFrontmatter(withFm);
    expect(body).not.toContain('source:');
    expect(body).not.toContain('status:');
    expect(body).toContain('# 澄清后的专业 PRD');
    expect(body.startsWith('# 澄清后的专业 PRD')).toBe(true);
  });

  it('无 frontmatter 的内容原样返回', () => {
    const plain = '# 标题\n\n正文内容';
    expect(stripLeadingFrontmatter(plain)).toBe(plain);
  });

  it('无闭合 --- 的内容原样返回（不误伤正文分隔线）', () => {
    const onlyOneDash = '---\n这是一条分隔线之后的内容';
    expect(stripLeadingFrontmatter(onlyOneDash)).toBe(onlyOneDash);
  });

  it('剥离后与 buildClarifiedHeader 拼接不产生双 frontmatter', async () => {
    const { buildClarifiedHeader } = await import('../../../src/core/requirement-clarifier');
    const final = buildClarifiedHeader('foo/overview/CLARIFY.md') + stripLeadingFrontmatter(withFm);
    // 恰一个 frontmatter 块：文件以 --- 开头，第二个 --- 之后不再出现第三次 ---
    const matches = final.match(/^---/gm) || [];
    expect(matches.length).toBe(2);
  });
});
