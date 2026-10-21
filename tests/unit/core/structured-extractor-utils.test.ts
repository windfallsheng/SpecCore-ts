/**
 * structured-extractor 纯函数切片测试（v8.3.341+）
 *
 * 覆盖：isTsOrJs（TS/JS 判定）、detectLanguage（扩展名→语言）、inferPlatform（路径→平台归属）。
 * 这三个函数此前无直接测试，本次随导出补充。
 */
import { describe, it, expect } from 'vitest';
import {
  isTsOrJs,
  detectLanguage,
  inferPlatform,
} from '../../../src/core/structured-extractor';

describe('structured-extractor 纯函数（v8.3.341+ 切片测试）', () => {
  describe('isTsOrJs', () => {
    it('TS/JS 系扩展名命中（含 mts/cts）', () => {
      expect(isTsOrJs('a.ts')).toBe(true);
      expect(isTsOrJs('a.tsx')).toBe(true);
      expect(isTsOrJs('a.js')).toBe(true);
      expect(isTsOrJs('a.jsx')).toBe(true);
      expect(isTsOrJs('a.mts')).toBe(true);
      expect(isTsOrJs('a.cts')).toBe(true);
      expect(isTsOrJs('SRC/Utils.TS')).toBe(true); // 大小写不敏感
    });

    it('非 TS/JS 扩展名不命中', () => {
      expect(isTsOrJs('a.java')).toBe(false);
      expect(isTsOrJs('a.py')).toBe(false);
      expect(isTsOrJs('a.go')).toBe(false);
      expect(isTsOrJs('a.md')).toBe(false);
    });
  });

  describe('detectLanguage', () => {
    it('按扩展名判定语言', () => {
      expect(detectLanguage('src/api.ts')).toBe('typescript');
      expect(detectLanguage('a.tsx')).toBe('typescript');
      expect(detectLanguage('OrderService.java')).toBe('java');
      expect(detectLanguage('app.py')).toBe('python');
      expect(detectLanguage('main.go')).toBe('go');
    });

    it('未知扩展名返回 unknown', () => {
      expect(detectLanguage('README.md')).toBe('unknown');
      expect(detectLanguage('a.rb')).toBe('unknown');
      expect(detectLanguage('Makefile')).toBe('unknown');
    });
  });

  describe('inferPlatform', () => {
    it('路径关键词 → 平台归属', () => {
      expect(inferPlatform('admin-web/src/App.tsx')).toBe('frontend');
      expect(inferPlatform('backend/api/user.ts')).toBe('backend');
      expect(inferPlatform('apps/mobile/index.tsx')).toBe('mobile');
      expect(inferPlatform('packages/cli/main.ts')).toBe('cli');
      expect(inferPlatform('packages/shared/utils.ts')).toBe('shared');
    });

    it('大小写不敏感 + 无关键词返回 unknown', () => {
      expect(inferPlatform('ADMIN/App.tsx')).toBe('frontend');
      expect(inferPlatform('random/whatever')).toBe('unknown');
    });
  });
});
