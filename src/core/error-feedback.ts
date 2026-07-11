/**
 * Error Feedback — Zod 错误翻译为用户友好提示
 *
 * 将 Zod 校验错误翻译为可操作的中文描述
 */

import { z } from 'zod';

export interface FriendlyError {
  field: string;
  message: string;
  suggestion?: string;
}

/**
 * 将 ZodError 翻译为友好提示列表
 */
export function translateZodError(error: any, context?: string): FriendlyError[] {
  const results: FriendlyError[] = [];

  if (!error?.issues) return results;

  for (const issue of error.issues) {
    const path = (issue.path || []).join('.') || '(root)';
    const fieldName = context ? `${context}.${path}` : path;
    const issueCode = (issue.code || '').toString();
    const issueMsg = issue.message || '';
    const expected = issue.expected || '';
    const minimum = (issue as any).minimum;
    const maximum = (issue as any).maximum;

    let message = '';
    let suggestion = '';

    if (issueCode.includes('invalid_type')) {
      message = `"${fieldName}" 类型错误或缺失`;
      suggestion = `期望类型：${expected || '非空值'}`;
    } else if (issueCode.includes('invalid_value') || issueCode.includes('invalid_enum')) {
      message = `"${fieldName}" 取值不合法`;
      suggestion = '请使用允许的枚举值';
    } else if (issueCode.includes('invalid_string') || issueCode.includes('invalid_format')) {
      message = `"${fieldName}" 格式不正确`;
      suggestion = issueMsg;
    } else if (issueCode.includes('too_small')) {
      message = `"${fieldName}" 值过小`;
      suggestion = `最小值应为 ${minimum ?? '?'}`;
    } else if (issueCode.includes('too_big')) {
      message = `"${fieldName}" 值过大`;
      suggestion = `最大值应为 ${maximum ?? '?'}`;
    } else if (issueCode.includes('unrecognized_keys')) {
      message = `"${fieldName}" 包含未识别的字段`;
      suggestion = '请移除多余字段';
    } else {
      message = `${fieldName}: ${issueMsg || issueCode}`;
    }

    results.push({ field: fieldName, message, suggestion: suggestion || undefined });
  }

  return results;
}

/**
 * 格式化友好错误为可读文本
 */
export function formatFriendlyErrors(errors: FriendlyError[]): string {
  const lines: string[] = [];
  lines.push('❌ 数据校验失败：');

  for (const e of errors) {
    lines.push(`   ${e.message}`);
    if (e.suggestion) {
      lines.push(`   💡 ${e.suggestion}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * 安全验证包装：捕获 ZodError 并输出友好提示
 */
export function safeValidate<T>(schema: z.ZodSchema<T>, data: unknown, label?: string): { success: true; data: T } | { success: false; errors: FriendlyError[] } {
  const result = schema.safeParse(data);
  if (result.success) {
    return result;
  }
  return {
    success: false,
    errors: translateZodError(result.error, label),
  };
}
