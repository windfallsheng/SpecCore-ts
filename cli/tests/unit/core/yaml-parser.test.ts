import { describe, it, expect } from 'vitest';
import { YamlParser } from '@/core/yaml-parser';

describe('YamlParser', () => {
  describe('parse — 基础值', () => {
    it('应该解析字符串值', () => {
      const result = YamlParser.parse('name: spec-core');
      expect(result.name).toBe('spec-core');
    });

    it('应该解析数字值', () => {
      const result = YamlParser.parse('port: 8080');
      expect(result.port).toBe(8080);
    });

    it('应该解析布尔值', () => {
      const result = YamlParser.parse('enabled: true\ndisabled: false');
      expect(result.enabled).toBe(true);
      expect(result.disabled).toBe(false);
    });

    it('应该跳过注释', () => {
      const result = YamlParser.parse('# comment\nname: hello\n# another');
      expect(result.name).toBe('hello');
    });

    it('应该解析浮点数', () => {
      const result = YamlParser.parse('version: 3.14');
      expect(result.version).toBe(3.14);
    });

    it('应该解析带引号的值', () => {
      const result = YamlParser.parse('name: "hello world"');
      expect(result.name).toBe('hello world');
    });
  });

  describe('parse — 嵌套对象', () => {
    it('应该解析简单嵌套', () => {
      const yaml = 'server:\n  host: localhost\n  port: 3000';
      const result = YamlParser.parse(yaml);
      expect(result.server).toEqual({ host: 'localhost', port: 3000 });
    });

    it('应该解析多层值', () => {
      const yaml = 'version: 1.0\nserver:\n  host: 0.0.0.0\n  debug: true';
      const result = YamlParser.parse(yaml);
      expect(result.version).toBe(1);
      expect(result.server).toEqual({ host: '0.0.0.0', debug: true });
    });
  });

  describe('parse — 列表', () => {
    it('应该解析简单列表', () => {
      const yaml = 'items:\n  - apple\n  - banana';
      const result = YamlParser.parse(yaml);
      expect(result.items).toEqual(['apple', 'banana']);
    });

    it('应该处理空行', () => {
      const yaml = 'key: value\n\nanother: test';
      const result = YamlParser.parse(yaml);
      expect(result.key).toBe('value');
      expect(result.another).toBe('test');
    });
  });

  describe('parse — platforms.yaml 实际场景', () => {
    it('应该解析 platform 配置', () => {
      const yaml = `platforms:
  web:
    name: Web端
    default: true
    enabled: true
  h5:
    name: H5端
    default: true`;
      const result = YamlParser.parse(yaml);
      expect(result.platforms).toBeDefined();
      // The platforms key holds a nested object
      expect(typeof result.platforms).toBe('object');
    });
  });
});
