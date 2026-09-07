/**
 * test-config — 测试场景配置加载与管理
 *
 * 支持 verify --config 读取测试场景 YAML 配置文件。
 * 实现测试配置与环境配置的双层分离。
 *
 * v8.3.60+
 */
import { readFile, pathExists } from 'fs-extra';
import { logger } from '../utils/logger';

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

/** 解析测试配置 YAML */
function parseTestYaml(content: string): Record<string, unknown> {
  const result: any = {};
  const lines = content.split('\n');
  let stack: { obj: any; indent: number }[] = [{ obj: result, indent: -1 }];

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const trimmed = line.trim();
    const parent = stack[stack.length - 1].obj;

    if (trimmed.startsWith('- ')) {
      const value = trimmed.slice(2).trim();
      if (!Array.isArray(parent)) continue;
      if (value.includes(':')) {
        const obj: any = {};
        const [k, ...rest] = value.split(':');
        const v = rest.join(':').trim();
        if (v) obj[k.trim()] = autoType(v);
        parent.push(obj);
        stack.push({ obj, indent });
      } else {
        parent.push(autoType(value));
      }
    } else if (trimmed.endsWith(':')) {
      const key = trimmed.slice(0, -1).trim();
      if (Array.isArray(parent)) {
        const last = parent[parent.length - 1];
        if (last && typeof last === 'object' && !Array.isArray(last)) {
          last[key] = {};
          stack.push({ obj: last[key], indent });
        }
      } else {
        if (!parent[key]) parent[key] = {};
        stack.push({ obj: parent[key], indent });
      }
    } else if (trimmed.includes(':')) {
      const [k, ...rest] = trimmed.split(':');
      const v = rest.join(':').trim();
      if (Array.isArray(parent)) {
        const last = parent[parent.length - 1];
        if (last && typeof last === 'object') {
          last[k.trim()] = autoType(v);
        }
      } else {
        parent[k.trim()] = autoType(v);
      }
    }
  }

  return result;
}

function autoType(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
  return v;
}

/** 加载测试场景配置文件 */
export async function loadTestConfig(filePath: string): Promise<TestConfig | null> {
  if (!(await pathExists(filePath))) {
    logger.warn(`⚠️ 测试配置文件不存在: ${filePath}`);
    return null;
  }

  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = parseTestYaml(raw) as Record<string, unknown>;

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
