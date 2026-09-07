/**
 * test-config 单元测试
 *
 * 覆盖测试场景配置加载与环境配置合并逻辑。
 */

import { describe, it, expect } from 'vitest';
import { mergeTestConfigWithEnv, type TestConfig, type VisualModelConfig } from '../../../src/core/test-config';

describe('test-config', () => {
  describe('mergeTestConfigWithEnv', () => {
    const baseTestConfig: TestConfig = {
      name: 'smoke-test',
      tests: [
        { name: '首页加载', type: 'smoke', routes: ['/'] },
        { name: '登录页视觉', type: 'visual', routes: ['/login'] },
      ],
      endpoints: {
        h5: 'http://localhost:3000',
      },
    };

    it('should return original config when envConfig has no tests', () => {
      const result = mergeTestConfigWithEnv(baseTestConfig, {});
      expect(result).toEqual(baseTestConfig);
    });

    it('should merge base_urls into endpoints', () => {
      const envConfig = {
        tests: {
          base_urls: {
            h5: 'https://staging.example.com/h5',
            admin: 'https://staging.example.com/admin',
          },
        },
      };

      const result = mergeTestConfigWithEnv(baseTestConfig, envConfig);

      // env 的 base_urls 应该作为默认值，测试配置的 endpoints 优先级更高
      expect(result.endpoints?.h5).toBe('http://localhost:3000');
      expect(result.endpoints?.admin).toBe('https://staging.example.com/admin');
    });

    it('should merge visual_model when test config has none', () => {
      const visualModel: VisualModelConfig = {
        provider: 'qwen-vl',
        model: 'qwen-vl-max',
        timeout: 60000,
      };

      const envConfig = {
        tests: {
          visual_model: visualModel,
        },
      };

      const result = mergeTestConfigWithEnv(baseTestConfig, envConfig);
      expect(result.visual_model).toEqual(visualModel);
    });

    it('should not override visual_model when test config already has one', () => {
      const testConfigWithVisual: TestConfig = {
        ...baseTestConfig,
        visual_model: {
          provider: 'openai',
          model: 'gpt-4o',
          timeout: 30000,
        },
      };

      const envConfig = {
        tests: {
          visual_model: {
            provider: 'qwen-vl' as const,
            model: 'qwen-vl-max',
            timeout: 60000,
          } satisfies VisualModelConfig,
        },
      };

      const result = mergeTestConfigWithEnv(testConfigWithVisual, envConfig);
      expect(result.visual_model?.provider).toBe('openai');
      expect(result.visual_model?.model).toBe('gpt-4o');
    });

    it('should handle empty envConfig', () => {
      const result = mergeTestConfigWithEnv(baseTestConfig, undefined);
      expect(result).toEqual(baseTestConfig);
    });

    it('should create a new object without mutating original', () => {
      const envConfig = {
        tests: {
          base_urls: { h5: 'https://test.example.com' },
        },
      };

      const result = mergeTestConfigWithEnv(baseTestConfig, envConfig);
      expect(result).not.toBe(baseTestConfig);
      expect(result.tests).not.toBe(baseTestConfig.tests);
    });
  });
});
