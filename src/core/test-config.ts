/**
 * test-config — 测试场景配置加载与管理
 *
 * 支持 verify --config 读取测试场景 YAML 配置文件。
 * 实现测试配置与环境配置的双层分离。
 *
 * v8.3.60+
 * v8.3.122+: 支持两种配置格式自动识别：
 *   - TestConfig 格式（tests/routes 结构，用于批量页面测试）
 *   - VERIFY_SPEC 格式（scenarios/actions 结构，用于精细 UI 交互测试）
 */
import { readFile, pathExists } from 'fs-extra';
import { logger } from '../utils/logger';
import * as yaml from 'js-yaml';
import type { AuthConfig, AuthCredentials } from './ui-verify/types';

export interface TestConfigTarget {
  url?: string;
  base_url?: string;
  router_file?: string;
}

export interface TestCase {
  name: string;
  type: 'smoke' | 'visual' | 'api';
  routes?: string[];
  scenarios?: string[];
  threshold?: 'strict' | 'normal' | 'loose';
  devices?: string[];
  browsers?: string[];
}

export interface VisualModelConfig {
  provider: 'qwen-vl' | 'openai' | 'anthropic' | 'local';
  model?: string;
  apiKey?: string;
  endpoint?: string;
  timeout?: number;
}

export interface TestConfig {
  name?: string;
  target?: TestConfigTarget;
  endpoints?: Record<string, string>;
  tests: TestCase[];
  visual_model?: VisualModelConfig;
  output?: string;
  /** 测试登录配置（v8.3.215+）：冒烟/视觉测试执行前自动登录 */
  auth?: AuthConfig;
}

/** 解析测试配置 YAML（v8.3.122+: 使用标准 js-yaml 解析器） */
function parseTestYaml(content: string): Record<string, unknown> {
  return yaml.load(content) as Record<string, unknown> || {};
}

/** 从 VERIFY_SPEC 格式的 scenario 中提取导航 URL */
function extractRoutesFromScenarios(scenarios: any[]): string[] {
  const routes: string[] = [];
  for (const sc of scenarios) {
    if (sc && Array.isArray(sc.actions)) {
      for (const action of sc.actions) {
        if (action && action.type === 'navigate' && typeof action.value === 'string') {
          routes.push(action.value);
          break; // 每个 scenario 只取第一个 navigate
        }
      }
    }
  }
  return routes.length > 0 ? routes : ['/'];
}

/** 将 VERIFY_SPEC 格式转换为 TestConfig 格式 */
function convertVerifySpecToTestConfig(parsed: Record<string, unknown>): TestConfig {
  const config: TestConfig = { tests: [] };

  if (parsed.name) config.name = String(parsed.name);
  if (parsed.url) {
    config.target = { url: String(parsed.url) };
  }

  const scenarios = Array.isArray(parsed.scenarios) ? parsed.scenarios : [];

  // 每个 scenario 转换为一个 smoke 测试用例
  for (const sc of scenarios) {
    if (!sc || typeof sc !== 'object') continue;
    const s = sc as any;
    const routes: string[] = [];
    if (Array.isArray(s.actions)) {
      for (const action of s.actions) {
        if (action && action.type === 'navigate' && typeof action.value === 'string') {
          routes.push(action.value);
          break;
        }
      }
    }
    const testCase: TestCase = {
      name: String(s.name || 'unnamed'),
      type: 'smoke',
      routes: routes.length > 0 ? routes : ['/'],
    };
    config.tests.push(testCase);
  }

  return config;
}

/** 加载测试场景配置文件（v8.3.122+: 自动识别两种格式） */
export async function loadTestConfig(filePath: string): Promise<TestConfig | null> {
  if (!(await pathExists(filePath))) {
    logger.warn(`⚠️ 测试配置文件不存在: ${filePath}`);
    return null;
  }

  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = parseTestYaml(raw) as Record<string, unknown>;

    // v8.3.122+: 自动识别 VERIFY_SPEC 格式（scenarios/actions 结构）
    if (Array.isArray(parsed.scenarios) && !Array.isArray(parsed.tests)) {
      logger.info(`   🔀 检测到 VERIFY_SPEC 格式，自动转换为 TestConfig`);
      return convertVerifySpecToTestConfig(parsed);
    }

    const config: TestConfig = {
      tests: [],
    };

    if (parsed.name) config.name = String(parsed.name);

    if (parsed.target && typeof parsed.target === 'object') {
      const t = parsed.target as any;
      config.target = {
        url: t.url as string | undefined,
        base_url: t.base_url as string | undefined,
        router_file: t.router_file as string | undefined,
      };
    }

    if (parsed.endpoints && typeof parsed.endpoints === 'object') {
      config.endpoints = parsed.endpoints as Record<string, string>;
    }

    if (Array.isArray(parsed.tests)) {
      for (const tc of parsed.tests) {
        if (tc && typeof tc === 'object') {
          const t = tc as any;
          const testCase: TestCase = {
            name: String(t.name || 'unnamed'),
            type: (t.type as TestCase['type']) || 'smoke',
          };
          if (Array.isArray(t.routes)) testCase.routes = t.routes.map(String);
          if (Array.isArray(t.scenarios)) testCase.scenarios = t.scenarios.map(String);
          if (t.threshold) testCase.threshold = t.threshold as TestCase['threshold'];
          if (Array.isArray(t.devices)) testCase.devices = t.devices.map(String);
          if (Array.isArray(t.browsers)) testCase.browsers = t.browsers.map(String);
          config.tests.push(testCase);
        }
      }
    }

    if (parsed.visual_model && typeof parsed.visual_model === 'object') {
      config.visual_model = parsed.visual_model as VisualModelConfig;
    }

    if (parsed.output) config.output = String(parsed.output);

    // v8.3.215+: 解析测试登录配置 auth
    if (parsed.auth && typeof parsed.auth === 'object') {
      config.auth = parseAuthConfig(parsed.auth as Record<string, unknown>);
    }

    return config;
  } catch (e: any) {
    logger.warn(`⚠️ 测试配置文件解析失败: ${filePath} — ${e.message}`);
    return null;
  }
}

/** 解析 auth 配置对象（v8.3.215+），供测试配置与环境配置复用 */
export function parseAuthConfig(raw: Record<string, unknown>): AuthConfig {
  const credentials: AuthCredentials = {};
  if (raw.credentials && typeof raw.credentials === 'object') {
    const c = raw.credentials as Record<string, unknown>;
    if (c.username !== undefined) credentials.username = String(c.username);
    if (c.password !== undefined) credentials.password = String(c.password);
    if (c.username_env !== undefined) credentials.username_env = String(c.username_env);
    if (c.password_env !== undefined) credentials.password_env = String(c.password_env);
  }

  return {
    login_url: raw.login_url !== undefined ? String(raw.login_url) : undefined,
    username_selector: raw.username_selector !== undefined ? String(raw.username_selector) : '',
    password_selector: raw.password_selector !== undefined ? String(raw.password_selector) : '',
    submit_selector: raw.submit_selector !== undefined ? String(raw.submit_selector) : '',
    success_url_contains: raw.success_url_contains !== undefined ? String(raw.success_url_contains) : undefined,
    success_selector: raw.success_selector !== undefined ? String(raw.success_selector) : undefined,
    wait_after_login: raw.wait_after_login !== undefined ? Number(raw.wait_after_login) : undefined,
    credentials,
  };
}

/**
 * 解析登录凭据：环境变量优先，明文兜底（v8.3.215+）
 *
 * 若配置了 username_env/password_env，从 process.env 读取；
 * 否则回退到明文的 username/password。
 */
export function resolveAuthCredentials(
  auth: AuthConfig | undefined
): { username: string; password: string } | null {
  if (!auth) return null;

  const username = auth.credentials.username_env
    ? process.env[auth.credentials.username_env] || ''
    : auth.credentials.username || '';
  const password = auth.credentials.password_env
    ? process.env[auth.credentials.password_env] || ''
    : auth.credentials.password || '';

  if (!username || !password) return null;
  return { username, password };
}

/**
 * 冒烟登录账号装配结果（v8.3.216+）
 *
 * 用于「开发完成、即将冒烟」的时间点，把 auth 配置解析成明确的账号/密码，
 * 并生成「改了什么 / 缺什么」的清单告知用户（自动模式同样可见）。
 */
export interface AuthResolutionInfo {
  /** 最终账号名（可能为空=未确定） */
  username: string;
  /** 最终密码（可能为空=未确定） */
  password: string;
  /** 账号名来源说明 */
  usernameSource: string;
  /** 密码来源说明 */
  passwordSource: string;
  /** 账号密码是否都已就绪（可执行登录） */
  ready: boolean;
  /** 需要用户注意/处理的项 */
  warnings: string[];
}

/**
 * 描述冒烟登录账号的装配结果（v8.3.216+）
 *
 * 解析优先级：
 *   - 账号：username_env 环境变量 > username 明文 > 需求文档「测试账号」章节提取 > 未配置
 *   - 密码：password_env 环境变量 > password 明文 > 未配置
 *
 * 不写回配置文件（密码不进 git），只在冒烟前做内存装配 + 透明告知。
 */
export function describeAuthResolution(auth: AuthConfig, testAccountHint?: string): AuthResolutionInfo {
  const warnings: string[] = [];

  // ── 账号名 ──
  let username = '';
  let usernameSource = '';
  if (auth.credentials.username_env) {
    username = process.env[auth.credentials.username_env] || '';
    usernameSource = `环境变量 ${auth.credentials.username_env}${username ? '' : '（未设置）'}`;
  } else if (auth.credentials.username) {
    username = auth.credentials.username;
    usernameSource = '配置明文';
  }
  if (!username && testAccountHint) {
    username = testAccountHint;
    usernameSource = '需求文档「测试账号」章节';
  }
  if (!username) {
    usernameSource = '未配置';
    warnings.push('账号名未配置（credentials.username / username_env，或需求文档「测试账号」章节）');
  }

  // ── 密码 ──
  let password = '';
  let passwordSource = '';
  if (auth.credentials.password_env) {
    password = process.env[auth.credentials.password_env] || '';
    passwordSource = `环境变量 ${auth.credentials.password_env}${password ? '' : '（未设置）'}`;
    if (!password) {
      warnings.push(`密码环境变量 ${auth.credentials.password_env} 未设置，请 export ${auth.credentials.password_env}=<初始密码>`);
    }
  } else if (auth.credentials.password) {
    password = auth.credentials.password;
    passwordSource = '配置明文';
  } else {
    passwordSource = '未配置';
    warnings.push('密码未配置（credentials.password / password_env）');
  }

  return {
    username,
    password,
    usernameSource,
    passwordSource,
    ready: !!username && !!password,
    warnings,
  };
}

/** 合并环境配置中的测试参数 */
export function mergeTestConfigWithEnv(
  testConfig: TestConfig,
  envConfig?: {
    tests?: {
      base_urls?: Record<string, string>;
      visual_model?: VisualModelConfig;
      auth?: AuthConfig;
    };
  }
): TestConfig {
  if (!envConfig?.tests) return testConfig;

  const merged: TestConfig = { ...testConfig, tests: [...testConfig.tests] };

  // 合并 endpoints
  if (envConfig.tests.base_urls) {
    merged.endpoints = { ...envConfig.tests.base_urls, ...testConfig.endpoints };
  }

  // 合并 visual_model（测试配置优先级更高）
  if (envConfig.tests.visual_model && !testConfig.visual_model) {
    merged.visual_model = envConfig.tests.visual_model;
  }

  // 合并 auth（测试配置优先级更高）
  if (envConfig.tests.auth && !testConfig.auth) {
    merged.auth = envConfig.tests.auth;
  }

  return merged;
}
