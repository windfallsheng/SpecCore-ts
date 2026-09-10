import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolvePlatform, fuzzyMatchPlatform, parseGlobalPlatforms } from '../../../src/core/platform-registry';

const TEST_CWD = join(process.cwd(), 'tests', '.tmp', 'platform-registry-test');

describe('platform-registry - 端注册表与模糊匹配', () => {
  beforeEach(() => {
    rmSync(TEST_CWD, { recursive: true, force: true });
    mkdirSync(join(TEST_CWD, '.speccore'), { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_CWD, { recursive: true, force: true });
  });

  describe('fuzzyMatchPlatform', () => {
    it('应该精确匹配端名', () => {
      const platforms = ['admin', 'h5', 'backend'];
      const result = fuzzyMatchPlatform('admin', platforms);
      expect(result).toEqual({ matched: 'admin', exact: true });
    });

    it('应该前缀匹配端名', () => {
      const platforms = ['admin', 'h5', 'backend'];
      const result = fuzzyMatchPlatform('adm', platforms);
      expect(result).toEqual({ matched: 'admin', exact: false });
    });

    it('应该包含匹配端名', () => {
      const platforms = ['miniapp', 'h5', 'backend'];
      const result = fuzzyMatchPlatform('mini', platforms);
      expect(result).toEqual({ matched: 'miniapp', exact: false });
    });

    it('无匹配时应该返回 null', () => {
      const platforms = ['admin', 'h5', 'backend'];
      const result = fuzzyMatchPlatform('xyz', platforms);
      expect(result).toBeNull();
    });
  });

  describe('resolvePlatform', () => {
    it('应该解析有效端名', async () => {
      writeFileSync(join(TEST_CWD, '.speccore', 'CONSTITUTION.md'), [
        '| 工程 | 对应端 |',
        '| :--- | :--- |',
        '| backend | backend |',
        '| web-app | admin, h5 |',
      ].join('\n'));
      const result = await resolvePlatform('adm', TEST_CWD);
      expect(result.resolved).toBe('admin');
      expect(result.exact).toBe(false);
    });

    it('无效端名应该返回错误并列出可用端', async () => {
      writeFileSync(join(TEST_CWD, '.speccore', 'CONSTITUTION.md'), [
        '| 工程 | 对应端 |',
        '| :--- | :--- |',
        '| backend | backend |',
        '| web-app | admin, h5 |',
      ].join('\n'));
      const result = await resolvePlatform('xyz', TEST_CWD);
      expect(result.resolved).toBeNull();
      expect(result.error).toContain('admin');
      expect(result.error).toContain('h5');
      expect(result.error).toContain('backend');
    });

    it('无全局端配置时应直接返回输入', async () => {
      // 不创建 CONSTITUTION.md
      const result = await resolvePlatform('anything', TEST_CWD);
      expect(result.resolved).toBe('anything');
      expect(result.exact).toBe(true);
    });
  });

  describe('parseGlobalPlatforms', () => {
    it('应该从 CONSTITUTION.md 解析端列表', async () => {
      writeFileSync(join(TEST_CWD, '.speccore', 'CONSTITUTION.md'), [
        '| 工程 | 对应端 |',
        '| :--- | :--- |',
        '| backend | backend |',
        '| web-app | admin, h5 |',
      ].join('\n'));
      const platforms = await parseGlobalPlatforms(TEST_CWD);
      expect(platforms).toContain('backend');
      expect(platforms).toContain('admin');
      expect(platforms).toContain('h5');
    });
  });
});
