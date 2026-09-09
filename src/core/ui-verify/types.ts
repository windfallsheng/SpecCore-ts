/**
 * UI 验证类型定义
 *
 * VERIFY_SPEC.yaml 结构定义
 */

export interface VerifySpec {
  name: string;
  platform: string;
  url: string;
  baseUrl?: string;
  scenarios: Scenario[];
}

export interface Scenario {
  name: string;
  description?: string;
  actions: Action[];
  assertions: Assertion[];
}

export type ActionType = 'fill' | 'click' | 'select' | 'check' | 'uncheck' | 'hover' | 'focus' | 'blur' | 'press' | 'wait' | 'navigate' | 'screenshot' | 'cookie' | 'localStorage' | 'script' | 'scroll' | 'upload' | 'iframe' | 'waitForRequest' | 'waitForResponse' | 'drag';

export interface Action {
  type: ActionType;
  selector?: string;
  value?: string;
  key?: string;
  delay?: number;
  waitFor?: string;
  timeout?: number;
  // v8.3.95+: cookie 操作专用字段
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  // v8.3.95+: drag 目标选择器
  toSelector?: string;
}

export type AssertionType = 'visible' | 'hidden' | 'text' | 'value' | 'url' | 'count' | 'attribute' | 'style' | 'visual';

export interface Assertion {
  type: AssertionType;
  selector?: string;
  description?: string;
  contains?: string;
  equals?: string;
  count?: number;
  attribute?: string;
  style?: string;
  value?: string;
  threshold?: 'strict' | 'normal' | 'loose';
}

export interface SmokeResult {
  scenarioName: string;
  passed: boolean;
  duration: number;
  steps: StepResult[];
  screenshot?: string;
}

export interface StepResult {
  action: Action;
  passed: boolean;
  error?: string;
  duration: number;
}

export interface VisualResult {
  scenarioName: string;
  passed: boolean;
  baselinePath?: string;
  currentPath: string;
  diffPath?: string;
  analysis: string;
  issues: VisualIssue[];
}

export interface VisualIssue {
  severity: 'error' | 'warning' | 'info';
  description: string;
  region?: string | { x: number; y: number; width: number; height: number };
}

export interface UIVerifyReport {
  taskId: string;
  timestamp: string;
  platform: string;
  url: string;
  smokeEnabled: boolean;
  visualEnabled: boolean;
  smokeResults: SmokeResult[];
  visualResults: VisualResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    duration: number;
  };
}

export interface UIVerifyOptions {
  smokeTest: boolean;
  visualCheck: boolean;
  devices?: string[];
  browsers?: string[];
  updateBaseline?: boolean;
  threshold?: 'strict' | 'normal' | 'loose';
  /** 有头模式：显示浏览器窗口（调试用，默认 false） */
  headed?: boolean;
  /** 视觉模型配置：可传字符串简写或完整配置对象 */
  visualModel?: string | {
    provider: 'qwen-vl' | 'openai' | 'anthropic' | 'local';
    model?: string;
    apiKey?: string;
    endpoint?: string;
    timeout?: number;
  };
  timeout?: number;
}
