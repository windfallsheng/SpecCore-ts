import { describe, it, expect } from 'vitest';
import { buildTitleOutline, parseTitleRenames, applyTitleRenames } from '../../../src/commands/doc2spec';

// ═══════════════════════════════════════════════════════════
// AI 标题规范化（v8.3.335）
// 转换后按 SpecCore 标准标题体系重写标题：
// AI 只产「标题映射」，CLI 确定性回写——正文一字不动、行数不变，
// 未匹配映射的章节原样保留，绝不静默丢章节。
// ═══════════════════════════════════════════════════════════

describe('buildTitleOutline - 标题大纲提取', () => {
  it('只提取标题行，保留原层级', () => {
    const content = '# 会议系统需求\n\n正文第一段\n## 一、文档概述\n正文\n### 1.1 产品定位\n定位内容';
    expect(buildTitleOutline(content)).toBe(
      '# 会议系统需求\n## 一、文档概述\n### 1.1 产品定位'
    );
  });

  it('正文中带 # 的非标题行（如代码片段）也会被提取——大纲仅供 AI 参照', () => {
    const content = '## 章节\n```\n# 这是代码\n```\n';
    expect(buildTitleOutline(content)).toContain('# 这是代码');
  });
});

describe('parseTitleRenames - AI 返回 JSON 解析', () => {
  it('纯净 JSON 解析成功', () => {
    const parsed = parseTitleRenames(
      '{"renames":[{"from":"文档概述","to":"## 文档概述"}],"docTitle":"会议系统需求"}'
    );
    expect(parsed).toEqual({
      renames: [{ from: '文档概述', to: '## 文档概述' }],
      docTitle: '会议系统需求',
    });
  });

  it('markdown 代码围栏包裹可解析', () => {
    const parsed = parseTitleRenames(
      '```json\n{"renames":[{"from":"概述","to":"## 文档概述"}]}\n```'
    );
    expect(parsed?.renames).toHaveLength(1);
    expect(parsed?.docTitle).toBe('');
  });

  it('无效 JSON / 空 renames 返回 null', () => {
    expect(parseTitleRenames('抱歉我无法处理')).toBeNull();
    expect(parseTitleRenames('{"renames":[],"docTitle":"x"}')).toBeNull();
    expect(parseTitleRenames('')).toBeNull();
  });
});

describe('applyTitleRenames - 确定性回写', () => {
  it('H2/H3 标题按映射重写，正文一字不动', () => {
    const content =
      '# 老标题\n\n前言正文\n## 一、背景介绍\n背景内容\n### 1.1 项目背景\n细节';
    const out = applyTitleRenames(
      content,
      [
        { from: '背景介绍', to: '## 项目背景' },
        { from: '项目背景', to: '### 目标用户' },
      ],
      '新标题'
    );
    expect(out.content).toContain('# 新标题');
    expect(out.content).toContain('## 项目背景');
    expect(out.content).toContain('### 目标用户');
    expect(out.content).toContain('前言正文');
    expect(out.content).toContain('背景内容');
    expect(out.content).toContain('细节');
    expect(out.applied).toBe(3);
    expect(out.skipped).toEqual([]);
  });

  it('from 带编号 / 不带编号都能匹配（strip 编号前缀容忍）', () => {
    const content = '## 三、会议室管理\n内容';
    const out = applyTitleRenames(content, [{ from: '3.1 会议室管理', to: '## 功能模块一：会议室管理' }], '');
    expect(out.content).toContain('## 功能模块一：会议室管理');
    expect(out.applied).toBe(1);
  });

  it('同名标题按出现顺序一一对应（多模块各自的「验收标准」）', () => {
    const content = '## 功能A\n### 验收标准\nA标准\n## 功能B\n### 验收标准\nB标准';
    const out = applyTitleRenames(
      content,
      [
        { from: '验收标准', to: '### A 验收标准' },
        { from: '验收标准', to: '### B 验收标准' },
      ],
      ''
    );
    expect(out.content).toContain('### A 验收标准\nA标准');
    expect(out.content).toContain('### B 验收标准\nB标准');
    expect(out.applied).toBe(2);
    expect(out.skipped).toEqual([]);
  });

  it('未匹配的 from 记入 skipped，对应章节原样保留', () => {
    const content = '## 一、概述\n内容';
    const out = applyTitleRenames(
      content,
      [
        { from: '概述', to: '## 文档概述' },
        { from: 'AI 幻觉的标题', to: '## 不应出现' },
      ],
      ''
    );
    expect(out.content).toContain('## 文档概述');
    expect(out.content).not.toContain('不应出现');
    expect(out.skipped).toEqual(['AI 幻觉的标题']);
    expect(out.applied).toBe(1);
  });

  it('to 不带 # 前缀时沿用原层级兜底', () => {
    const content = '### 3.1 用户场景\n内容';
    const out = applyTitleRenames(content, [{ from: '用户场景', to: '用户场景描述' }], '');
    expect(out.content).toContain('### 用户场景描述');
  });

  it('docTitle 为空时 H1 保持原样', () => {
    const content = '# 原标题\n## 章节';
    const out = applyTitleRenames(content, [{ from: '章节', to: '## 新章节' }], '');
    expect(out.content).toContain('# 原标题');
    expect(out.content).toContain('## 新章节');
  });

  it('标题行数不变（只换文字不增删行，天然防丢章节）', () => {
    const content = '# 标题\n\n## 一\n内容\n## 二\n内容\n### 2.1\n内容';
    const before = content.split('\n').length;
    const out = applyTitleRenames(
      content,
      [
        { from: '一', to: '## 文档概述' },
        { from: '二', to: '## 功能模块一：预订管理' },
        { from: '2.1', to: '### 用户场景' },
      ],
      '新文档标题'
    );
    expect(out.content.split('\n').length).toBe(before);
  });
});
