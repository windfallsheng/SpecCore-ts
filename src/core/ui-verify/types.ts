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
  /** v8.3.294+: 失败场景页面的实际 data-testid 清单（DOM 扫描，供 selector 自愈提示） */
  domTestIds?: string[];
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
    /** v8.3.352+: 跳过的检查项数（契约缺失/账号未就绪/URL 无法确定等，与 failed 区分统计） */
    skipped?: number;
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

/**
 * 测试登录凭据（v8.3.215+）
 *
 * 支持两种来源（环境变量优先，明文兜底）：
 *   - username_env / password_env：从环境变量读取（推荐，密码不落库）
 *   - username / password：明文（仅用于非敏感的内网默认账号）
 */
export interface AuthCredentials {
  username?: string;
  password?: string;
  username_env?: string;
  password_env?: string;
}

/**
 * 测试登录配置（v8.3.215+）
 *
 * 冒烟测试执行前的自动登录流程：导航到登录页 → 填入账号密码 → 提交 → 等待登录成功。
 * 登录成功后 cookie/localStorage 保留在同一浏览器 context 内，后续所有场景共享登录态。
 */
export interface AuthConfig {
  /** 登录页 URL（相对路径或绝对 URL；相对路径基于 baseUrl 解析） */
  login_url?: string;
  /** 用户名输入框选择器 */
  username_selector: string;
  /** 密码输入框选择器 */
  password_selector: string;
  /** 登录提交按钮选择器 */
  submit_selector: string;
  /** 登录成功判定：URL 包含此片段 */
  success_url_contains?: string;
  /** 登录成功判定：等待此元素出现 */
  success_selector?: string;
  /** 登录后额外等待（毫秒） */
  wait_after_login?: number;
  /** 登录凭据 */
  credentials: AuthCredentials;
  /**
   * 登录二次验证（v8.3.354+）：账号密码提交后未达成功判定时，按此块自动填码再提交。
   * 适合固定码/可绕过场景的 selector 自动化；真实动态码应走 AI 验证线（verify --ai）。
   */
  verification?: AuthVerificationConfig;
}

/**
 * 登录二次验证配置：验证码输入框 + 码来源（code_env 优先于 fixed_code）+ 提交按钮。
 * 只落取码通道（环境变量名）不落码本身——真实码值从环境变量/密钥管理读取。
 */
export interface AuthVerificationConfig {
  /** 验证码类型：sms/totp/graphic/email（报告展示与日志提示用） */
  type?: string;
  /** 验证码输入框选择器 */
  code_selector: string;
  /** 验证码提交按钮选择器（缺省复用 submit_selector） */
  code_submit_selector?: string;
  /** 验证码来源环境变量名（如 SIT_SMS_CODE；优先于 fixed_code，适合「动态码落环境变量」） */
  code_env?: string;
  /** 固定验证码（测试环境「可绕过」场景：后端固定校验码，如 888888） */
  fixed_code?: string;
  /** 等待验证码输入框出现的超时（毫秒，默认 10000；同时用作首次成功判定的短超时） */
  code_timeout?: number;
}
