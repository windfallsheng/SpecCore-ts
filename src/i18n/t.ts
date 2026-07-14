/**
 * t() — i18n 翻译辅助函数
 * 用法: t('key', '中文后备', { param: '值' })
 * 默认: 英文模式返回翻译，中文模式/无翻译返回后备文本
 */
import { i18n } from './index';

export function t(key: string, fallback: string, params?: Record<string, string | number>): string {
  const translated = i18n.t(key, params);
  // 如果翻译结果等于 key（未找到翻译），使用后备文本
  if (translated === key) return params ? replaceParams(fallback, params) : fallback;
  return translated;
}

function replaceParams(text: string, params: Record<string, string | number>): string {
  let result = text;
  for (const [k, v] of Object.entries(params)) {
    result = result.replace(`{${k}}`, String(v));
  }
  return result;
}
