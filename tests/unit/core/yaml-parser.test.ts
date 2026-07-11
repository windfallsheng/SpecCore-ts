/**
 * YAML 解析器测试
 * 测试 parseYamlFile、validateApiContract、extractEndpoints、yamlToJson
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

// 纯函数测试 — 不依赖文件系统
import { validateApiContract, extractEndpoints, yamlToJson } from '@/core/yaml-parser';

// ============================================================
// validateApiContract 测试
// ============================================================
describe('YAML Parser — validateApiContract', () => {
  it('should pass for valid API contract', () => {
    const data = {
      api: { path: '/api/v1/users', method: 'POST' },
      request: { body: {} },
      response: { status: 200 },
    };
    const errors = validateApiContract(data);
    expect(errors).toHaveLength(0);
  });

  it('should detect missing api section', () => {
    const data = {
      request: { body: {} },
      response: { status: 200 },
    };
    const errors = validateApiContract(data);
    expect(errors).toContain('Missing "api" section');
  });

  it('should detect missing api.path', () => {
    const data = {
      api: { method: 'POST' },
      request: {},
      response: {},
    };
    const errors = validateApiContract(data);
    expect(errors).toContain('Missing API path');
  });

  it('should detect missing api.method', () => {
    const data = {
      api: { path: '/api/v1/users' },
      request: {},
      response: {},
    };
    const errors = validateApiContract(data);
    expect(errors).toContain('Missing API method');
  });

  it('should detect missing request section', () => {
    const data = {
      api: { path: '/api/v1/users', method: 'POST' },
      response: {},
    };
    const errors = validateApiContract(data);
    expect(errors).toContain('Missing "request" section');
  });

  it('should detect missing response section', () => {
    const data = {
      api: { path: '/api/v1/users', method: 'POST' },
      request: {},
    };
    const errors = validateApiContract(data);
    expect(errors).toContain('Missing "response" section');
  });

  it('should return error for empty data', () => {
    const errors = validateApiContract(null);
    expect(errors).toContain('Empty YAML data');
  });

  it('should return error for undefined', () => {
    const errors = validateApiContract(undefined);
    expect(errors).toContain('Empty YAML data');
  });

  it('should collect all errors', () => {
    const data = {}; // 没有任何必需字段
    const errors = validateApiContract(data);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================
// extractEndpoints 测试
// ============================================================
describe('YAML Parser — extractEndpoints', () => {
  it('should extract endpoints from valid data', () => {
    const data = {
      api: { path: '/api/v1/users', method: 'POST' },
    };
    const endpoints = extractEndpoints(data);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).toEqual({ path: '/api/v1/users', method: 'POST' });
  });

  it('should default method to GET when not specified', () => {
    const data = {
      api: { path: '/api/v1/users' },
    };
    const endpoints = extractEndpoints(data);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].method).toBe('GET');
  });

  it('should handle missing path', () => {
    const data = {
      api: { method: 'POST' },
    };
    const endpoints = extractEndpoints(data);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].path).toBe('');
  });

  it('should return empty array for missing api', () => {
    const endpoints = extractEndpoints({});
    expect(endpoints).toHaveLength(0);
  });

  it('should return empty array for null', () => {
    const endpoints = extractEndpoints(null);
    expect(endpoints).toHaveLength(0);
  });

  it('should return empty array for undefined', () => {
    const endpoints = extractEndpoints(undefined);
    expect(endpoints).toHaveLength(0);
  });
});

// ============================================================
// yamlToJson 测试
// ============================================================
describe('YAML Parser — yamlToJson', () => {
  it('should convert object to JSON string', () => {
    const data = { api: { path: '/users', method: 'GET' } };
    const json = yamlToJson(data);
    expect(typeof json).toBe('string');
    const parsed = JSON.parse(json);
    expect(parsed.api.path).toBe('/users');
  });

  it('should pretty-print with 2 spaces', () => {
    const data = { a: 1 };
    const json = yamlToJson(data);
    expect(json).toContain('\n  ');
  });

  it('should handle empty object', () => {
    const json = yamlToJson({});
    expect(json).toBe('{}');
  });

  it('should handle arrays', () => {
    const data = { items: [1, 2, 3] };
    const json = yamlToJson(data);
    const parsed = JSON.parse(json);
    expect(parsed.items).toEqual([1, 2, 3]);
  });
});

// ============================================================
// parseYamlFile 集成测试（需要临时文件）
// ============================================================
const TEST_DIR = join(process.cwd(), 'tests', '.tmp', 'yaml-test');

describe('YAML Parser — parseYamlFile (integration)', () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should parse valid YAML file', async () => {
    const { parseYamlFile } = await import('@/core/yaml-parser');
    const yamlPath = join(TEST_DIR, 'test.yaml');
    writeFileSync(yamlPath, 'name: test\nversion: "1.0"');

    const result = await parseYamlFile(yamlPath);
    expect(result.success).toBe(true);
    if (result.data) {
      expect(result.data.name).toBe('test');
      expect(result.data.version).toBe('1.0');
    }
  });

  it('should return error for missing file', async () => {
    const { parseYamlFile } = await import('@/core/yaml-parser');
    const result = await parseYamlFile(join(TEST_DIR, 'missing.yaml'));
    expect(result.success).toBe(false);
    expect(result.error).toBe('File not found');
  });

  it('should parse YAML with nested objects', async () => {
    const { parseYamlFile } = await import('@/core/yaml-parser');
    const yamlPath = join(TEST_DIR, 'nested.yaml');
    writeFileSync(yamlPath, [
      'api:',
      '  path: /api/v1/users',
      '  method: POST',
      'request:',
      '  body:',
      '    type: object',
    ].join('\n'));

    const result = await parseYamlFile(yamlPath);
    expect(result.success).toBe(true);
    if (result.data) {
      expect(result.data.api.path).toBe('/api/v1/users');
      expect(result.data.api.method).toBe('POST');
    }
  });
});
