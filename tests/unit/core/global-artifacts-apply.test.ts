/**
 * v8.3.369: global-artifacts AI 接力闭环 —— 回填引擎单元测试。
 * 覆盖 mergeSectionIntoText（标题定位替换）与 fillYamlDescriptions（YAML description 回填）。
 */
import { describe, it, expect } from 'vitest';
import { mergeSectionIntoText, fillYamlDescriptions } from '../../../src/core/global-artifacts';

describe('mergeSectionIntoText 标题定位替换', () => {
  const doc = [
    '# 系统架构',
    '> 自动生成 | 2026-11-03',
    '',
    '## 端拓扑',
    '',
    '| 端 | 文件数 |',
    '| :--- | :--- |',
    '| `a` | 10 |',
    '',
    '## 架构描述（宿主 AI 补充）',
    '',
    '_AI 填写：系统分层_',
    '',
    '### 系统分层',
    '',
    '_AI 填写：分层职责_',
  ].join('\n');

  it('替换目标节内容到下一个同级标题前', () => {
    const merged = mergeSectionIntoText(doc, '### 系统分层', '- CLI 层\n- Core 层');
    expect(merged).not.toBeNull();
    expect(merged!).toContain('### 系统分层\n\n- CLI 层\n- Core 层');
    expect(merged!).not.toContain('_AI 填写：分层职责_');
  });

  it('节内容与下一标题间保留空行（Markdown 规范）', () => {
    // 目标节是文档末尾：末尾不应追加多余空行
    const merged = mergeSectionIntoText(doc, '### 系统分层', '新内容');
    expect(merged!.endsWith('新内容'));
    expect(merged!.split('新内容').length).toBe(2);
  });

  it('上一级标题不吞噬目标节内容', () => {
    const merged = mergeSectionIntoText(doc, '### 系统分层', '新内容');
    // 目标节是文档末尾，替换后不得残留旧占位
    expect(merged!).not.toContain('_AI 填写：分层职责_');
    // 其他节内容不受影响
    expect(merged!).toContain('## 端拓扑');
    expect(merged!).toContain('| `a` | 10 |');
  });

  it('标题未命中返回 null', () => {
    expect(mergeSectionIntoText(doc, '## 不存在的节', 'x')).toBeNull();
  });
});

describe('fillYamlDescriptions YAML description 回填', () => {
  const yaml = [
    '# 全局 API 契约',
    'generated_at: 2026-11-03',
    'endpoints:',
    '  "spec-core":',
    '    - method: GET',
    '      path: /api/health',
    '      description: _AI 填写',
    '    - method: POST',
    '      path: /api/tasks',
    '      description: _AI 填写',
  ].join('\n');

  it('按 "METHOD path" 键匹配并替换', () => {
    const r = fillYamlDescriptions(yaml, {
      'GET /api/health': '健康检查',
      'POST /api/tasks': '创建任务',
    });
    expect(r.filled).toBe(2);
    expect(r.unmatched).toEqual([]);
    expect(r.text).toContain('description: "健康检查"');
    expect(r.text).toContain('description: "创建任务"');
    expect(r.text).not.toContain('_AI 填写');
  });

  it('只匹配部分键时返回未匹配清单', () => {
    const r = fillYamlDescriptions(yaml, {
      'GET /api/health': '健康检查',
      'DELETE /api/nope': '不存在的接口',
    });
    expect(r.filled).toBe(1);
    expect(r.unmatched).toEqual(['DELETE /api/nope']);
    expect(r.text).toContain('description: _AI 填写'); // 未匹配的保持占位
  });

  it('按 path 键兜底匹配', () => {
    const r = fillYamlDescriptions(yaml, { '/api/health': '健康检查（仅路径）' });
    expect(r.filled).toBe(1);
    expect(r.text).toContain('description: "健康检查（仅路径）"');
  });
});
