/**
 * prompt-builder 解析纯函数切片测试（v8.3.341+）
 *
 * 覆盖：extractInfoGaps（INFO_GAP 提取与去重）、parseAiResponse（AI 响应 JSON 解析）。
 * 二者是 AI 接力协议的关键解析器，此前无直接测试。
 */
import { describe, it, expect } from 'vitest';
import { extractInfoGaps, parseAiResponse } from '../../../src/core/prompt-builder';

describe('prompt-builder 解析纯函数（v8.3.341+ 切片测试）', () => {
  describe('extractInfoGaps', () => {
    it('提取全部 INFO_GAP 并去重', () => {
      const res = '[INFO_GAP: 缺少接口定义]\n[INFO_GAP: 缺少接口定义]\n[INFO_GAP:  需要数据库表结构 ]';
      expect(extractInfoGaps(res)).toEqual(['缺少接口定义', '需要数据库表结构']);
    });

    it('无 INFO_GAP 返回空数组', () => {
      expect(extractInfoGaps('正常响应无缺口')).toEqual([]);
    });

    it('缺口内容两侧空白被修剪', () => {
      expect(extractInfoGaps('[INFO_GAP:  前后有空格  ]')).toEqual(['前后有空格']);
    });
  });

  describe('parseAiResponse', () => {
    it('解析标准 files JSON', () => {
      const res = '```json\n{"files": [{"path": "a.ts", "content": "const a = 1;"}]}\n```';
      const parsed = parseAiResponse(res);
      expect(parsed).not.toBeNull();
      expect(parsed!.files).toHaveLength(1);
      expect(parsed!.files[0]).toEqual({ path: 'a.ts', content: 'const a = 1;' });
      expect(parsed!.infoGaps).toBeUndefined();
    });

    it('JSON 与 INFO_GAP 共存时两者都返回', () => {
      const res = '[INFO_GAP: 缺少环境名]\n{"files": [{"path": "b.ts", "content": "x"}]}';
      const parsed = parseAiResponse(res);
      expect(parsed!.files).toHaveLength(1);
      expect(parsed!.infoGaps).toEqual(['缺少环境名']);
    });

    it('无 JSON 但有 INFO_GAP → 空文件列表 + gaps', () => {
      const parsed = parseAiResponse('无法生成代码 [INFO_GAP: 缺少登录态说明]');
      expect(parsed).not.toBeNull();
      expect(parsed!.files).toEqual([]);
      expect(parsed!.infoGaps).toEqual(['缺少登录态说明']);
    });

    it('无 JSON 且无 INFO_GAP → null', () => {
      expect(parseAiResponse('纯文本无结构')).toBeNull();
    });

    it('JSON 缺 files 字段 → null', () => {
      expect(parseAiResponse('{"other": 1}')).toBeNull();
    });
  });
});
