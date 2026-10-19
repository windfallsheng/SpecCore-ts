/**
 * 配置序列化器一致性校验（机器锁）
 *
 * 背景：toYaml / toProjectYaml 是手写拼接序列化器。历史上多次发生
 * 「DEFAULT_CONFIG 新增字段，但序列化器漏写输出段」→ 升级器声称补全、
 * 写盘时被丢弃 → 假补全（vision / logging.enabled / block_level 等）。
 *
 * 本测试是机器锁：DEFAULT_CONFIG 与序列化器必须双向一致。
 * 任何人在 DEFAULT_CONFIG 加字段而没补序列化器输出段 → 测试当场红，
 * 把「人肉记忆」变成「构建期把关」，此类回归从此绝迹。
 *
 * 校验规则（宽容空集合）：
 * - expected 为 [] / {} 的键：允许序列化输出缺失或为空（toYaml 对空集合
 *   可能省略输出段，如 config_history: []），两者语义等价
 * - 其余键：parsed 必须存在且值与 expected 深比较相等
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG,
  DEFAULT_PROJECT_CONFIG,
  toYaml,
  toProjectYaml,
  parseYaml,
} from '@/core/unified-config';

/** 宽容深比较：expected 的每个键必须在 parsed 中语义等价 */
function expectDefaultsCovered(parsed: Record<string, unknown>, expected: Record<string, unknown>, path = ''): void {
  for (const key of Object.keys(expected)) {
    const expectedVal = (expected as any)[key];
    const parsedHasKey = Object.prototype.hasOwnProperty.call(parsed, key);
    const keyPath = path ? `${path}.${key}` : key;

    if (!parsedHasKey) {
      // 空集合允许缺失（序列化器省略输出段）
      const isEmptyCollection =
        (Array.isArray(expectedVal) && expectedVal.length === 0) ||
        (expectedVal !== null && typeof expectedVal === 'object' && Object.keys(expectedVal).length === 0);
      expect(isEmptyCollection, `键 ${keyPath} 缺失且默认值非空集合（序列化器漏写？）`).toBe(true);
      continue;
    }

    const parsedVal = (parsed as any)[key];

    if (Array.isArray(expectedVal)) {
      expect(Array.isArray(parsedVal), `键 ${keyPath} 应为数组（序列化器输出类型错？）`).toBe(true);
      expect(parsedVal).toEqual(expectedVal);
    } else if (expectedVal !== null && typeof expectedVal === 'object') {
      expect(typeof parsedVal === 'object' && parsedVal !== null, `键 ${keyPath} 应为对象`).toBe(true);
      expectDefaultsCovered(parsedVal as Record<string, unknown>, expectedVal as Record<string, unknown>, keyPath);
    } else {
      expect(parsedVal, `键 ${keyPath} 值不一致（默认值 ${JSON.stringify(expectedVal)} 未完整落盘？）`).toBe(expectedVal);
    }
  }
}

describe('config serializer consistency — .speccore.yml（机器锁）', () => {
  it('DEFAULT_CONFIG 每个键都必须完整落盘（toYaml → parseYaml 往返）', () => {
    const yamlText = toYaml(DEFAULT_CONFIG);
    const parsed = parseYaml(yamlText) as Record<string, unknown>;
    expectDefaultsCovered(parsed, DEFAULT_CONFIG as unknown as Record<string, unknown>);
  });

  it('schema_version 必须写盘且可回读', () => {
    const yamlText = toYaml(DEFAULT_CONFIG);
    const parsed = parseYaml(yamlText) as { schema_version: number };
    expect(parsed.schema_version).toBe(1);
  });

  it('嵌套三层的 verify_ui 配置必须完整落盘', () => {
    const yamlText = toYaml(DEFAULT_CONFIG);
    const parsed = parseYaml(yamlText) as any;
    expect(parsed.quality_gates.verify_ui).toEqual(DEFAULT_CONFIG.quality_gates.verify_ui);
    expect(parsed.quality_gates.verify_ui.devices).toEqual(['desktop']);
    expect(parsed.quality_gates.verify_ui.visual_model.model).toBe('qwen-vl-max');
  });
});

describe('config serializer consistency — PROJECT.yaml（机器锁）', () => {
  it('DEFAULT_PROJECT_CONFIG 每个键都必须完整落盘（toProjectYaml 往返）', () => {
    const yamlText = toProjectYaml(DEFAULT_PROJECT_CONFIG);
    const parsed = parseYaml(yamlText) as Record<string, unknown>;
    expectDefaultsCovered(parsed, DEFAULT_PROJECT_CONFIG as unknown as Record<string, unknown>);
  });
});
