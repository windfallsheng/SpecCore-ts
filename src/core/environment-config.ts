/**
 * environment-config — 环境配置加载与管理
 *
 * 支持 .speccore/environments/*.yaml 文件夹化管理。
 * 环境配置可覆盖 PROJECT.yaml 中的 deploy/build 参数。
 *
 * v8.3.60+
 */
import { readFile, pathExists } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import type { DeployEnvConfig } from './unified-config';

export interface EnvironmentPlatformConfig {
  /** 构建命令（覆盖 PROJECT.yaml 中的配置） */
  build_cmd?: string;
  /** 部署配置（覆盖 PROJECT.yaml 中的 deploy） */
  deploy?: DeployEnvConfig;
  /** Git 目标分支（覆盖环境全局 branch，pipeline 时使用） */
  branch?: string;
}

export interface EnvironmentConfig {
  /** 环境标识名 */
  env: string;
  /** 该环境对应的 Git 分支（pipeline 合并目标分支） */
  branch?: string;
  /** 全局默认值 */
  defaults?: {
    build_cmd?: string;
  };
  /** 按端覆盖配置 */
  platforms: Record<string, EnvironmentPlatformConfig>;
  /** 测试相关配置（与 verify --config 联动） */
  tests?: {
    /** 各端的基础 URL（部署后测试使用） */
    base_urls?: Record<string, string>;
    /** 各端本地测试 URL（pre-deploy 测试使用，如 http://localhost:3000） */
    local_urls?: Record<string, string>;
    /** 视觉模型配置 */
    visual_model?: {
      provider: 'qwen-vl' | 'openai' | 'anthropic' | 'local';
      model?: string;
      apiKey?: string;
      endpoint?: string;
      timeout?: number;
    };
  };
  /** Pipeline 测试配置（v8.3.60+） */
  pipeline?: {
    /** 是否启用 pipeline 内置测试 */
    test?: {
      enabled?: boolean;
      /** 测试类型: build-check / smoke / visual / api / all */
      type?: 'build-check' | 'smoke' | 'visual' | 'api' | 'all';
      /** 测试时机: pre-deploy(部署前,默认) / post-deploy(部署后) / both(前后都测) */
      stage?: 'pre-deploy' | 'post-deploy' | 'both';
      /** 测试场景配置文件路径 */
      config?: string;
      /** 测试失败是否阻断部署（默认 true） */
      fail_on_error?: boolean;
      /** 测试失败时是否触发 AI 自动修复（默认 true） */
      auto_fix?: boolean;
      /** 自动修复最大重试次数 */
      max_retries?: number;
    };
  };
}

const ENV_DIR = join('.speccore', 'environments');

/** 解析 YAML（复用统一配置中的解析逻辑） */
function parseEnvYaml(content: string): Record<string, unknown> {
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

/** 加载指定路径的环境配置文件 */
export async function loadEnvironmentConfig(filePath: string): Promise<EnvironmentConfig | null> {
  if (!(await pathExists(filePath))) {
    return null;
  }

  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = parseEnvYaml(raw) as Record<string, unknown>;

    const config: EnvironmentConfig = {
      env: (parsed.env as string) || 'unknown',
      branch: (parsed.branch as string) || undefined,
      platforms: {},
    };

    if (parsed.defaults && typeof parsed.defaults === 'object') {
      config.defaults = {
        build_cmd: (parsed.defaults as any).build_cmd as string | undefined,
      };
    }

    if (parsed.platforms && typeof parsed.platforms === 'object') {
      for (const [name, pcfg] of Object.entries(parsed.platforms as any)) {
        const platformConfig: EnvironmentPlatformConfig = {};
        if (pcfg && typeof pcfg === 'object') {
          const pc = pcfg as any;
          if (pc.build_cmd) platformConfig.build_cmd = String(pc.build_cmd);
          if (pc.branch) platformConfig.branch = String(pc.branch);
          if (pc.deploy && typeof pc.deploy === 'object') {
            platformConfig.deploy = pc.deploy as DeployEnvConfig;
          }
        }
        config.platforms[name] = platformConfig;
      }
    }

    if (parsed.tests && typeof parsed.tests === 'object') {
      const t = parsed.tests as any;
      config.tests = {};
      if (t.base_urls && typeof t.base_urls === 'object') {
        config.tests.base_urls = t.base_urls as Record<string, string>;
      }
      // v8.3.98+: pre-deploy 测试使用本地 URL
      if (t.local_urls && typeof t.local_urls === 'object') {
        config.tests.local_urls = t.local_urls as Record<string, string>;
      }
      if (t.visual_model && typeof t.visual_model === 'object') {
        config.tests.visual_model = t.visual_model as any;
      }
    }

    // 解析 pipeline 测试配置
    if (parsed.pipeline && typeof parsed.pipeline === 'object') {
      const p = parsed.pipeline as any;
      config.pipeline = {};
      if (p.test && typeof p.test === 'object') {
        const pt = p.test;
        config.pipeline.test = {
          enabled: pt.enabled === true || pt.enabled === 'true',
          type: (pt.type as 'build-check' | 'smoke' | 'visual' | 'api' | 'all') || 'build-check',
          stage: (pt.stage as 'pre-deploy' | 'post-deploy' | 'both') || 'pre-deploy',
          config: pt.config as string | undefined,
          fail_on_error: pt.fail_on_error !== false && pt.fail_on_error !== 'false',
          auto_fix: pt.auto_fix !== false && pt.auto_fix !== 'false',
          max_retries: typeof pt.max_retries === 'number' ? pt.max_retries : undefined,
        };
      }
    }

    return config;
  } catch (e: any) {
    logger.warn(`⚠️ 环境配置文件解析失败: ${filePath} — ${e.message}`);
    return null;
  }
}

/** 按环境名解析配置文件路径 */
export async function resolveEnvironmentConfig(envName: string): Promise<{ config: EnvironmentConfig | null; path: string }> {
  const envPath = join(ENV_DIR, `${envName}.yaml`);
  const config = await loadEnvironmentConfig(envPath);
  return { config, path: envPath };
}

/** 按环境名或文件路径加载（自动识别） */
export async function loadEnvironmentByNameOrPath(input?: string): Promise<EnvironmentConfig | null> {
  if (!input) return null;

  // 若包含路径分隔符，视为文件路径
  if (input.includes('/') || input.includes('\\') || input.endsWith('.yaml') || input.endsWith('.yml')) {
    return loadEnvironmentConfig(input);
  }

  // 否则视为环境名
  const { config } = await resolveEnvironmentConfig(input);
  if (!config) {
    logger.warn(`⚠️ 未找到环境配置: .speccore/environments/${input}.yaml`);
  }
  return config;
}
