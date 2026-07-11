import zhCN from '../locales/zh-CN.json';
import enUS from '../locales/en-US.json';

type LocaleRecord = Record<string, string>;
type LocaleMap = Record<string, LocaleRecord>;

/**
 * 国际化管理器
 *
 * 支持：
 * - 中英双语（zh-CN 默认，en-US 扩展）
 * - 环境变量 SPEC_LOCALE 切换语言
 * - 模板参数替换 {key}
 * - 动态注册新语言包
 */
export class I18n {
  private static instance: I18n;
  private messages: LocaleMap = {
    'zh-CN': zhCN as LocaleRecord,
    'en-US': enUS as LocaleRecord,
  };
  private locale: string;

  private constructor() {
    this.locale = process.env.SPEC_LOCALE || 'zh-CN';
  }

  /** 获取单例 */
  static getInstance(): I18n {
    if (!I18n.instance) {
      I18n.instance = new I18n();
    }
    return I18n.instance;
  }

  /** 切换语言 */
  setLocale(locale: string): void {
    if (this.messages[locale]) {
      this.locale = locale;
    } else {
      throw new Error(`Unsupported locale: ${locale}. Available: ${Object.keys(this.messages).join(', ')}`);
    }
  }

  /** 获取当前语言 */
  getLocale(): string {
    return this.locale;
  }

  /** 获取支持的语言列表 */
  getSupportedLocales(): string[] {
    return Object.keys(this.messages);
  }

  /**
   * 翻译指定 key
   * @param key 翻译键（如 'task.status.pending'）
   * @param params 模板参数（如 { count: 5 }）
   */
  t(key: string, params?: Record<string, string | number>): string {
    const messages = this.messages[this.locale];
    let msg = messages?.[key] || this.messages['zh-CN']?.[key] || key;

    if (params) {
      for (const [k, v] of Object.entries(params)) {
        msg = msg.replace(`{${k}}`, String(v));
      }
    }

    return msg;
  }

  /**
   * 注册新的语言/覆盖已有的语言
   */
  register(locale: string, messages: LocaleRecord): void {
    this.messages[locale] = { ...this.messages[locale], ...messages };
  }

  /**
   * 翻译批量 key
   */
  tAll(keys: string[], params?: Record<string, string | number>): string[] {
    return keys.map(k => this.t(k, params));
  }

  /**
   * 重置单例（仅测试用）
   */
  static resetInstance(): void {
    I18n.instance = undefined as unknown as I18n;
  }
}

/** 便捷导出：全局单例翻译函数 */
export function t(key: string, params?: Record<string, string | number>): string {
  return I18n.getInstance().t(key, params);
}
