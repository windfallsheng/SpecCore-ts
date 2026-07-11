/**
 * i18n 国际化引擎
 *
 * 根据 SPEC_LOCALE 环境变量切换语言，默认中文。
 * 使用方式:
 *   import { i18n } from '@/i18n';
 *   i18n.t('cmd.init.success')  // → "项目初始化完成！" 或 "Project initialized!"
 *   i18n.t('cmd.import.scanning', { project: 'user-service', type: 'backend' })
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/** 支持的语言 */
export type Locale = 'zh-CN' | 'en-US';

/** 消息字典类型 */
type Messages = Record<string, any>;

class I18nEngine {
  private locale: Locale;
  private messages: Record<Locale, Messages> = {
    'zh-CN': {},
    'en-US': {},
  };
  private fallback: Locale = 'zh-CN';

  constructor() {
    this.locale = this.detectLocale();
    this.loadAllMessages();
  }

  /**
   * 检测当前语言环境：
   * 1. 环境变量 SPEC_LOCALE
   * 2. 系统 LANG / LC_ALL
   * 3. 默认 zh-CN
   */
  private detectLocale(): Locale {
    // 1. SPEC_LOCALE 环境变量
    const specLocale = process.env.SPEC_LOCALE;
    if (specLocale === 'en-US' || specLocale === 'zh-CN') {
      return specLocale;
    }

    // 2. 系统语言环境
    const systemLang = process.env.LANG || process.env.LC_ALL || '';
    if (systemLang.toLowerCase().startsWith('en')) {
      return 'en-US';
    }

    // 3. 默认中文
    return 'zh-CN';
  }

  /**
   * 加载所有语言资源文件
   */
  private loadAllMessages(): void {
    const localesDir = join(__dirname, '..', 'locales');

    for (const locale of ['zh-CN', 'en-US'] as Locale[]) {
      const localePath = join(localesDir, `${locale}.json`);

      // 尝试多个路径（编译后和源码路径）
      const pathsToTry = [
        localePath,
        join(process.cwd(), 'src', 'locales', `${locale}.json`),
      ];

      for (const path of pathsToTry) {
        if (existsSync(path)) {
          try {
            this.messages[locale] = JSON.parse(readFileSync(path, 'utf-8'));
            break;
          } catch {
            // 文件损坏，使用空字典
          }
        }
      }
    }
  }

  /**
   * 翻译函数
   * @param key — 点号分隔的消息键名，如 'cmd.init.success'
   * @param params — 可选的模板参数，如 { count: 5 }
   */
  t(key: string, params?: Record<string, string | number>): string {
    // 从当前语言查找
    let msg = this.getNestedValue(this.messages[this.locale], key);

    // 降级到默认语言
    if (msg === undefined) {
      msg = this.getNestedValue(this.messages[this.fallback], key);
    }

    // 最终降级到 key 本身
    if (msg === undefined) {
      return key;
    }

    // 模板替换
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        msg = (msg as string).replace(`{${k}}`, String(v));
      }
    }

    return msg as string;
  }

  /**
   * 从嵌套对象中按路径获取值
   */
  private getNestedValue(obj: Messages, path: string): string | undefined {
    const keys = path.split('.');
    let current: any = obj;
    for (const key of keys) {
      if (current === undefined || current === null) return undefined;
      current = current[key];
    }
    return typeof current === 'string' ? current : undefined;
  }

  /**
   * 获取当前语言
   */
  getLocale(): Locale {
    return this.locale;
  }

  /**
   * 动态切换语言
   */
  setLocale(locale: Locale): void {
    this.locale = locale;
  }

  /**
   * 获取所有支持的语言
   */
  getSupportedLocales(): Locale[] {
    return ['zh-CN', 'en-US'];
  }
}

// 全局单例
export const i18n = new I18nEngine();
