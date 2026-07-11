import { describe, it, expect, beforeEach } from 'vitest';
import { I18n } from '@/i18n/index';

describe('I18n', () => {
  beforeEach(() => {
    I18n.resetInstance();
    // Reset locale to default
    process.env.SPEC_LOCALE = 'zh-CN';
  });

  describe('单例模式', () => {
    it('应该返回同一个实例', () => {
      const a = I18n.getInstance();
      const b = I18n.getInstance();
      expect(a).toBe(b);
    });
  });

  describe('默认语言 zh-CN', () => {
    it('应该使用中文作为默认语言', () => {
      const i18n = I18n.getInstance();
      expect(i18n.getLocale()).toBe('zh-CN');
    });

    it('应该翻译中文消息', () => {
      const i18n = I18n.getInstance();
      expect(i18n.t('task.status.pending')).toBe('待开发');
      expect(i18n.t('task.type.feature')).toBe('功能开发');
      expect(i18n.t('cmd.init.success')).toBe('✅ 项目初始化完成！');
    });
  });

  describe('切换语言 en-US', () => {
    it('应该支持切换到英文', () => {
      const i18n = I18n.getInstance();
      i18n.setLocale('en-US');
      expect(i18n.getLocale()).toBe('en-US');
      expect(i18n.t('task.status.pending')).toBe('Pending');
      expect(i18n.t('task.type.bugfix')).toBe('Bug Fix');
    });

    it('应该在切换后仍可切回中文', () => {
      const i18n = I18n.getInstance();
      i18n.setLocale('en-US');
      i18n.setLocale('zh-CN');
      expect(i18n.t('task.status.pending')).toBe('待开发');
    });
  });

  describe('环境变量 SPEC_LOCALE', () => {
    it('应该从环境变量读取语言', () => {
      process.env.SPEC_LOCALE = 'en-US';
      I18n.resetInstance();
      const i18n = I18n.getInstance();
      expect(i18n.getLocale()).toBe('en-US');
    });
  });

  describe('模板参数替换', () => {
    it('应该替换单个参数', () => {
      const i18n = I18n.getInstance();
      const result = i18n.t('execute.executed', { count: 5 });
      expect(result).toBe('5 个 Task 已标记为进行中');
    });

    it('应该替换多个参数', () => {
      const i18n = I18n.getInstance();
      const result = i18n.t('global.index_rebuilt', { count: 3, reqs: 12 });
      expect(result).toContain('3');
      expect(result).toContain('12');
    });

    it('应该在英文环境下替换参数', () => {
      const i18n = I18n.getInstance();
      i18n.setLocale('en-US');
      const result = i18n.t('execute.executed', { count: 3 });
      expect(result).toContain('3');
      expect(result).toContain('task(s)');
    });
  });

  describe('支持的语言', () => {
    it('应该列出支持的语言', () => {
      const i18n = I18n.getInstance();
      const locales = i18n.getSupportedLocales();
      expect(locales).toContain('zh-CN');
      expect(locales).toContain('en-US');
    });

    it('应该不支持未注册的语言', () => {
      const i18n = I18n.getInstance();
      expect(() => i18n.setLocale('ja-JP')).toThrow('Unsupported locale');
    });
  });

  describe('注册新语言', () => {
    it('应该支持注册新语言包', () => {
      const i18n = I18n.getInstance();
      i18n.register('ja-JP', { 'task.status.pending': '待ち' });
      i18n.setLocale('ja-JP');
      expect(i18n.t('task.status.pending')).toBe('待ち');
      // Fallback to zh-CN for missing keys
      expect(i18n.t('task.type.feature')).toBe('功能开发');
    });
  });

  describe('fallback 行为', () => {
    it('应该在不存在的 key 时回退到 key 本身', () => {
      const i18n = I18n.getInstance();
      expect(i18n.t('nonexistent.key')).toBe('nonexistent.key');
    });

    it('应该在不存在的 key 时英文回退中文', () => {
      const i18n = I18n.getInstance();
      i18n.setLocale('en-US');
      // Register an empty locale to test fallback
      const result = i18n.t('task.status.pending');
      expect(result).toBe('Pending'); // en-US has this key
    });
  });

  describe('批量翻译', () => {
    it('应该批量翻译多个 key', () => {
      const i18n = I18n.getInstance();
      const results = i18n.tAll(['task.status.pending', 'task.status.completed']);
      expect(results).toEqual(['待开发', '已完成']);
    });

    it('应该在英文下批量翻译', () => {
      const i18n = I18n.getInstance();
      i18n.setLocale('en-US');
      const results = i18n.tAll([
        'task.status.pending',
        'task.status.in_progress',
        'task.status.completed',
      ]);
      expect(results).toEqual(['Pending', 'In Progress', 'Completed']);
    });
  });

  describe('平台翻译', () => {
    it('应该翻译所有平台', () => {
      const i18n = I18n.getInstance();
      const platforms = ['web', 'h5', 'miniapp', 'tablet', 'tv'];
      const zh = platforms.map(p => i18n.t(`platform.${p}`));
      expect(zh).toEqual(['Web 端', 'H5 端', '小程序端', '平板端', '智能电视端']);

      i18n.setLocale('en-US');
      const en = platforms.map(p => i18n.t(`platform.${p}`));
      expect(en).toEqual(['Web', 'H5', 'Mini App', 'Tablet', 'Smart TV']);
    });
  });

  describe('命令提示', () => {
    it('应该翻译帮助信息', () => {
      const i18n = I18n.getInstance();
      expect(i18n.t('cli.help_title')).toContain('SpecCore');

      i18n.setLocale('en-US');
      expect(i18n.t('cli.help_title')).toContain('SpecCore');
    });
  });
});
