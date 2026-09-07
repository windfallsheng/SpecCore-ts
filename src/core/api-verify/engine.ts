/**
 * API 契约测试 — 执行引擎
 *
 * 发送 HTTP 请求并执行断言校验
 */

import { logger } from '../../utils/logger';
import type {
  ApiContractSpec,
  ApiEndpoint,
  ApiAssertion,
  ApiTestResult,
  AssertionResult,
  ApiVerifyReport,
  ApiVerifyOptions,
} from './types';

// ─────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────

export async function runApiContractTest(
  spec: ApiContractSpec,
  options: ApiVerifyOptions = {}
): Promise<ApiVerifyReport> {
  const timeout = options.timeout || 10000;
  const results: ApiTestResult[] = [];
  const startTime = Date.now();

  logger.info(`🌐 API 契约测试: ${spec.name}`);
  logger.info(`   Base URL: ${spec.baseUrl}`);
  logger.info(`   端点数量: ${spec.endpoints.length}`);
  logger.info('');

  for (const endpoint of spec.endpoints) {
    const result = await testEndpoint(spec.baseUrl, endpoint, spec.headers || {}, timeout);
    results.push(result);

    const icon = result.passed ? '✅' : '❌';
    logger.info(
      `   ${icon} ${endpoint.method} ${endpoint.path} (${result.duration}ms)` +
      `${result.error ? ` — ${result.error}` : ''}`
    );

    if (!result.passed && result.assertionResults.length > 0) {
      for (const ar of result.assertionResults) {
        if (!ar.passed) {
          logger.info(`      ❌ ${ar.assertion}: ${ar.message || '断言失败'}`);
        }
      }
    }
  }

  const duration = Date.now() - startTime;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  logger.info('');
  logger.info(`   总计: ${results.length} 端点 | ✅ ${passed} 通过 | ❌ ${failed} 失败 | ⏱️ ${duration}ms`);

  return {
    specName: spec.name,
    baseUrl: spec.baseUrl,
    timestamp: new Date().toISOString(),
    results,
    summary: { total: results.length, passed, failed, duration },
  };
}

// ─────────────────────────────────────────
// 单个端点测试
// ─────────────────────────────────────────

async function testEndpoint(
  baseUrl: string,
  endpoint: ApiEndpoint,
  globalHeaders: Record<string, string>,
  timeout: number
): Promise<ApiTestResult> {
  const url = buildUrl(baseUrl, endpoint.path, endpoint.request?.query);
  const headers = { ...globalHeaders, ...endpoint.request?.headers };
  const startTime = Date.now();

  let statusCode: number | undefined;
  let responseBody: unknown;
  let responseHeaders: Record<string, string> = {};
  let error: string | undefined;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: endpoint.method,
      headers: buildFetchHeaders(headers),
      body: endpoint.request?.body ? JSON.stringify(endpoint.request.body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timer);

    statusCode = response.status;
    responseHeaders = Object.fromEntries(response.headers.entries());

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }
    } else {
      responseBody = await response.text();
    }
  } catch (e: any) {
    error = e.name === 'AbortError' ? `请求超时 (${timeout}ms)` : e.message;
  }

  const duration = Date.now() - startTime;

  // 执行断言
  const assertionResults: AssertionResult[] = [];
  for (const assertion of endpoint.assertions) {
    const ar = runAssertion(assertion, { statusCode, responseBody, responseHeaders });
    assertionResults.push(ar);
  }

  const allPassed = assertionResults.length > 0 ? assertionResults.every((a) => a.passed) : !error;

  return {
    endpointName: endpoint.name,
    path: endpoint.path,
    method: endpoint.method,
    passed: allPassed,
    duration,
    statusCode,
    responseBody,
    responseHeaders,
    assertionResults,
    error,
  };
}

// ─────────────────────────────────────────
// 断言执行
// ─────────────────────────────────────────

function runAssertion(
  assertion: ApiAssertion,
  context: { statusCode?: number; responseBody?: unknown; responseHeaders?: Record<string, string> }
): AssertionResult {
  const { type, expect, path, value, message } = assertion;

  let actual: unknown;

  switch (type) {
    case 'status':
      actual = context.statusCode;
      break;
    case 'header':
      actual = path ? context.responseHeaders?.[path.toLowerCase()] : undefined;
      break;
    case 'jsonPath':
      actual = path ? getJsonPath(context.responseBody, path) : undefined;
      break;
    case 'body':
      actual = typeof context.responseBody === 'string'
        ? context.responseBody
        : JSON.stringify(context.responseBody);
      break;
    default:
      return { assertion: `${type}: ${path || ''}`, passed: false, message: `未知断言类型: ${type}` };
  }

  const passed = evaluateExpect(actual, expect, value);

  return {
    assertion: `${type}${path ? `(${path})` : ''} ${expect}${value !== undefined ? ` ${JSON.stringify(value)}` : ''}`,
    passed,
    actual,
    expected: value,
    message: passed ? undefined : (message || `期望 ${expect}${value !== undefined ? ` ${JSON.stringify(value)}` : ''}，实际 ${JSON.stringify(actual)}`),
  };
}

// ─────────────────────────────────────────
// 期望值评估
// ─────────────────────────────────────────

function evaluateExpect(actual: unknown, expect: string, value?: unknown): boolean {
  switch (expect) {
    case 'equals':
      return actual === value;
    case 'notEquals':
      return actual !== value;
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'contains':
      if (typeof actual === 'string' && typeof value === 'string') return actual.includes(value);
      if (Array.isArray(actual) && value !== undefined) return actual.includes(value);
      if (typeof actual === 'object' && actual !== null && typeof value === 'string') {
        return JSON.stringify(actual).includes(value);
      }
      return false;
    case 'gt':
      return typeof actual === 'number' && typeof value === 'number' && actual > value;
    case 'gte':
      return typeof actual === 'number' && typeof value === 'number' && actual >= value;
    case 'lt':
      return typeof actual === 'number' && typeof value === 'number' && actual < value;
    case 'lte':
      return typeof actual === 'number' && typeof value === 'number' && actual <= value;
    case 'regex':
      if (typeof actual !== 'string' || typeof value !== 'string') return false;
      try {
        return new RegExp(value).test(actual);
      } catch {
        return false;
      }
    case 'startsWith':
      return typeof actual === 'string' && typeof value === 'string' && actual.startsWith(value);
    case 'endsWith':
      return typeof actual === 'string' && typeof value === 'string' && actual.endsWith(value);
    default:
      return false;
  }
}

// ─────────────────────────────────────────
// JSON Path 解析（简化版）
// ─────────────────────────────────────────

function getJsonPath(obj: unknown, path: string): unknown {
  if (!path.startsWith('$.')) return undefined;
  const keys = path.slice(2).split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

// ─────────────────────────────────────────
// URL 构建
// ─────────────────────────────────────────

function buildUrl(base: string, path: string, query?: Record<string, string>): string {
  const url = new URL(path, base);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

function buildFetchHeaders(headers: Record<string, string>): Record<string, string> {
  // fetch 要求 HeadersInit 是 Record<string, string>
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined && v !== null) {
      result[k] = String(v);
    }
  }
  return result;
}
