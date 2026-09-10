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

    return config;
  } catch (e: any) {
    logger.warn(`⚠️ 测试配置文件解析失败: ${filePath} — ${e.message}`);
    return null;
  }
}

/** 合并环境配置中的测试参数 */
export function mergeTestConfigWithEnv(
  testConfig: TestConfig,
  envConfig?: { tests?: { base_urls?: Record<string, string>; visual_model?: VisualModelConfig } }
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

  return merged;
}
