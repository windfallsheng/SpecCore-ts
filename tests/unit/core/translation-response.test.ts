/**
 * 批量英译响应解析回归基线（v8.3.289+）
 *
 * parseTranslationResponse 从 doc2spec.ts 提升为共享工具后，unitize 单元标题
 * 与 task new 批量导入任务名两条链路共用，此处锁定双键兼容与逐行兜底行为。
 */

import { describe, it, expect } from 'vitest';
import { parseTranslationResponse } from '../../../src/core/ask-llm';

const TITLES = ['预订管理', '扫码签到', '会议室资源规则'];

describe('parseTranslationResponse', () => {
  it('序号键 JSON：按清单序号一一对应映射回标题', () => {
    const pairs = parseTranslationResponse(
      '{"1":"booking-management","2":"qr-check-in","3":"meeting-room-rules"}',
      TITLES
    );
    expect(pairs).toEqual([
      ['预订管理', 'booking-management'],
      ['扫码签到', 'qr-check-in'],
      ['会议室资源规则', 'meeting-room-rules'],
    ]);
  });

  it('中文标题键 JSON：直接以标题为键匹配（兼容旧格式）', () => {
    const pairs = parseTranslationResponse(
      '{"预订管理":"booking-management","扫码签到":"qr-check-in"}',
      TITLES
    );
    expect(pairs).toEqual([
      ['预订管理', 'booking-management'],
      ['扫码签到', 'qr-check-in'],
    ]);
  });

  it('LLM 输出带前后缀文本：提取首个 JSON 对象', () => {
    const pairs = parseTranslationResponse(
      '好的，翻译结果如下：\n```json\n{"1":"booking-management"}\n```\n希望有帮助',
      TITLES
    );
    expect(pairs).toEqual([['预订管理', 'booking-management']]);
  });

  it('逐行正则兜底：支持序号键与中文冒号', () => {
    const pairs = parseTranslationResponse('1：booking-management\n2: qr-check-in', TITLES);
    expect(pairs).toEqual([
      ['预订管理', 'booking-management'],
      ['扫码签到', 'qr-check-in'],
    ]);
  });

  it('v8.3.309 单标题裸 slug：无 JSON 包装直接输出 kebab-case 时映射（宿主 AI 单单元常见）', () => {
    const pairs = parseTranslationResponse('inbox-notification', ['站内信通知']);
    expect(pairs).toEqual([['站内信通知', 'inbox-notification']]);
  });

  it('v8.3.309 单标题裸 slug：带引号/前缀文本也能提取', () => {
    const pairs = parseTranslationResponse('好的，翻译为：`booking-management`', ['预订管理']);
    expect(pairs).toEqual([]);
    const pairs2 = parseTranslationResponse('  "booking-management"  ', ['预订管理']);
    expect(pairs2).toEqual([['预订管理', 'booking-management']]);
  });

  it('v8.3.309 多标题裸 slug 行序映射：行数与清单一致时按行序一一对应', () => {
    const pairs = parseTranslationResponse(
      'booking-management\nqr-check-in\nmeeting-room-rules',
      TITLES
    );
    expect(pairs).toEqual([
      ['预订管理', 'booking-management'],
      ['扫码签到', 'qr-check-in'],
      ['会议室资源规则', 'meeting-room-rules'],
    ]);
  });

  it('v8.3.309 裸 slug 非法（含中文/行数不符）：安全返回空', () => {
    expect(parseTranslationResponse('预订管理', ['预订管理'])).toEqual([]);
    expect(parseTranslationResponse('booking-management\nqr-check-in', TITLES)).toEqual([]);
  });

  it('序号越界/无匹配标题：安全忽略', () => {
    const pairs = parseTranslationResponse('{"9":"out-of-range","unknown":"x"}', TITLES);
    expect(pairs).toEqual([]);
  });
});
