/**
 * API 契约测试 — 类型定义
 *
 * API_CONTRACT.yaml 结构：
 *   name: 用户服务 API 契约测试
 *   baseUrl: http://localhost:3000
 *   headers:
 *     Content-Type: application/json
 *   endpoints:
 *     - name: 登录
 *       path: /api/auth/login
 *       method: POST
 *       request:
 *         body:
 *           phone: "13800138000"
 *           password: "123456"
 *       assertions:
 *         - type: status
 *           expect: 200
 *         - type: jsonPath
 *           path: $.data.token
 *           expect: exists
 */

export interface ApiContractSpec {
  name: string;
  baseUrl: string;
  headers?: Record<string, string>;
  endpoints: ApiEndpoint[];
}

export interface ApiEndpoint {
  name: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  request?: {
    query?: Record<string, string>;
    body?: unknown;
    headers?: Record<string, string>;
  };
  assertions: ApiAssertion[];
}

export type AssertionType =
  | 'status'      // HTTP 状态码
  | 'jsonPath'    // JSON 路径断言
  | 'header'      // Response Header 断言
  | 'body'        // 响应体包含/匹配
  | 'schema';     // JSON Schema 校验（预留）

export type ExpectOperator =
  | 'equals'      // 严格相等
  | 'notEquals'   // 不相等
  | 'contains'    // 包含
  | 'exists'      // 存在（非 null/undefined）
  | 'gt'          // 大于
  | 'gte'         // 大于等于
  | 'lt'          // 小于
  | 'lte'         // 小于等于
  | 'regex'       // 正则匹配
  | 'startsWith'  // 开头匹配
  | 'endsWith';   // 结尾匹配

export interface ApiAssertion {
  type: AssertionType;
  expect: ExpectOperator;
  path?: string;      // jsonPath 或 header name
  value?: unknown;    // 期望的值
  message?: string;   // 自定义失败消息
}

// ── 测试结果 ──

export interface ApiTestResult {
  endpointName: string;
  path: string;
  method: string;
  passed: boolean;
  duration: number;
  statusCode?: number;
  responseBody?: unknown;
  responseHeaders?: Record<string, string>;
  assertionResults: AssertionResult[];
  error?: string;
}

export interface AssertionResult {
  assertion: string;
  passed: boolean;
  actual?: unknown;
  expected?: unknown;
  message?: string;
}

export interface ApiVerifyReport {
  specName: string;
  baseUrl: string;
  timestamp: string;
  results: ApiTestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    duration: number;
  };
}

// ── 执行选项 ──

export interface ApiVerifyOptions {
  timeout?: number;
  retry?: number;
  verbose?: boolean;
}
