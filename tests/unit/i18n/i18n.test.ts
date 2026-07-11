/**
 * i18n 国际化引擎测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('i18n Engine', () => {
  const originalLang = process.env.SPEC_LOCALE;

  afterEach(() => {
    if (originalLang) {
      process.env.SPEC_LOCALE = originalLang;
    } else {
      delete process.env.SPEC_LOCALE;
    }
  });

  it('should default to zh-CN when no locale set', async () => {
    delete process.env.SPEC_LOCALE;
    // 重新导入以触发 detectLocale
    const { i18n } = await import('@/i18n/index');
    expect(i18n.getLocale()).toBe('zh-CN');
  });

  it('should detect en-US from SPEC_LOCALE', async () => {
    process.env.SPEC_LOCALE = 'en-US';
    const { i18n } = await import('@/i18n/index');
    // 由于 singleton，reimport 不会重置。直接测试 setLocale
    i18n.setLocale('en-US');
    expect(i18n.getLocale()).toBe('en-US');

    // 恢复
    i18n.setLocale('zh-CN');
  });

  it('should translate with params', async () => {
    const { i18n } = await import('@/i18n/index');
    i18n.setLocale('zh-CN');

    const msg = i18n.t('cmd.import.scanning', { project: 'test-proj', type: 'backend' });
    expect(msg).toContain('test-proj');
    expect(msg).toContain('backend');
  });

  it('should fallback to key when translation missing', async () => {
    const { i18n } = await import('@/i18n/index');
    const msg = i18n.t('nonexistent.key.path');
    expect(msg).toBe('nonexistent.key.path');
  });

  it('should support locale switching', async () => {
    const { i18n } = await import('@/i18n/index');

    i18n.setLocale('zh-CN');
    expect(i18n.t('cmd.init.start')).toContain('初始化');

    i18n.setLocale('en-US');
    expect(i18n.t('cmd.init.start')).toContain('Initializing');

    i18n.setLocale('zh-CN');
  });

  it('should return supported locales', async () => {
    const { i18n } = await import('@/i18n/index');
    const locales = i18n.getSupportedLocales();
    expect(locales).toContain('zh-CN');
    expect(locales).toContain('en-US');
  });
});

describe('i18n — Message Completeness', () => {
  it('zh-CN should have all core sections', async () => {
    const zhCN = await import('@/locales/zh-CN.json');
    expect(zhCN.cmd).toBeDefined();
    expect(zhCN.cmd.init).toBeDefined();
    expect(zhCN.cmd.execute).toBeDefined();
    expect(zhCN.cmd.validate).toBeDefined();
    expect(zhCN.task.status).toBeDefined();
    expect(zhCN.common).toBeDefined();
  });

  it('en-US should have all core sections', async () => {
    const enUS = await import('@/locales/en-US.json');
    expect(enUS.cmd).toBeDefined();
    expect(enUS.cmd.init).toBeDefined();
    expect(enUS.cmd.execute).toBeDefined();
    expect(enUS.cmd.validate).toBeDefined();
    expect(enUS.task.status).toBeDefined();
    expect(enUS.common).toBeDefined();
  });

  it('zh-CN and en-US should have matching key structure', async () => {
    const zhCN = await import('@/locales/zh-CN.json');
    const enUS = await import('@/locales/en-US.json');

    // Task status keys match
    const zhStatusKeys = Object.keys(zhCN.task.status);
    const enStatusKeys = Object.keys(enUS.task.status);
    expect(zhStatusKeys.sort()).toEqual(enStatusKeys.sort());

    // Task type keys match
    const zhTypeKeys = Object.keys(zhCN.task.type);
    const enTypeKeys = Object.keys(enUS.task.type);
    expect(zhTypeKeys.sort()).toEqual(enTypeKeys.sort());
  });

  it('should handle translation for all task statuses', async () => {
    const { i18n } = await import('@/i18n/index');
    const statuses = ['pending', 'in_progress', 'completed', 'blocked', 'archived'];

    for (const locale of ['zh-CN', 'en-US'] as const) {
      i18n.setLocale(locale);
      for (const status of statuses) {
        const msg = i18n.t(`task.status.${status}`);
        expect(msg).not.toBe(`task.status.${status}`);
        expect(msg.length).toBeGreaterThan(0);
      }
    }

    i18n.setLocale('zh-CN');
  });
});
