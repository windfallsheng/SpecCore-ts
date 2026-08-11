/**
 * ask-config — Ask 引擎统一配置管理
 *
 * 读取优先级：环境变量 > .speccore/config/ask.json > 内置默认值
 * 支持用户通过配置文件持久化偏好，也支持命令行临时覆盖（--rules）
 */

import { pathExists, readJson, writeJson, ensureDir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface AskConfig {
  routing: {
    mode: 'hybrid' | 'local-only' | 'ai-first';
    /** 高分阈值：≥此值本地引擎直接执行，不打扰AI */
    highThreshold: number;
    /** 低分阈值：<此值直接交给AI，本地只负责提取参数 */
    lowThreshold: number;
    /** 本地引擎没把握时是否自动调用宿主AI */
    autoHostAi: boolean;
    /** 是否启用意图缓存 */
    cacheEnabled: boolean;
    /** 缓存固化阈值：命中次数超过此值视为高频意图 */
    cacheMinHits: number;
  };
  rules: {
    /** 等价于命令行 --rules：强制所有 ask 走宿主AI */
    forceHostAi: boolean;
  };
  llmProviders: LlmProviderConfig[];
}

export interface LlmProviderConfig {
  name: string;
  enabled: boolean;
  /** provider 类型：openai / ollama / custom */
  type: 'openai' | 'ollama' | 'custom';
  /** API endpoint（OpenAI兼容格式或Ollama本地地址） */
  endpoint?: string;
  /** 模型名称 */
  model?: string;
  /** API Key（优先读取环境变量 SPECCORE_LLM_KEY） */
  apiKey?: string;
  /** 优先级：数字越小越优先 */
  priority: number;
}

// ═══════════════════════════════════════════════════════════
// 内置默认值
// ═══════════════════════════════════════════════════════════

export const DEFAULT_ASK_CONFIG: AskConfig = {
  routing: {
    mode: 'hybrid',
    highThreshold: 70,
    lowThreshold: 45,
    autoHostAi: true,
    cacheEnabled: true,
    cacheMinHits: 3,
  },
  rules: {
    forceHostAi: false,
  },
  llmProviders: [
    {
      name: 'ollama-local',
      enabled: false,
      type: 'ollama',
      endpoint: 'http://localhost:11434',
      model: 'qwen2.5:7b',
      priority: 1,
    },
    {
      name: 'openai-compatible',
      enabled: false,
      type: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini',
      priority: 2,
    },
  ],
};

const CONFIG_PATH = '.speccore/config/ask.json';

// ═══════════════════════════════════════════════════════════
// 配置读写
// ═══════════════════════════════════════════════════════════

let cachedConfig: AskConfig | null = null;
let configLoadTime = 0;
const CONFIG_TTL = 5000; // 5秒内复用缓存

/**
 * 加载 Ask 引擎配置（带缓存）
 */
export async function loadAskConfig(): Promise<AskConfig> {
  const now = Date.now();
  if (cachedConfig && now - configLoadTime < CONFIG_TTL) {
    return cachedConfig;
  }

  let fileConfig: Partial<AskConfig> = {};

  if (await pathExists(CONFIG_PATH)) {
    try {
      fileConfig = (await readJson(CONFIG_PATH)) as Partial<AskConfig>;
    } catch (e: any) {
      logger.warn(`ask-config 读取失败，使用默认值: ${e.message}`);
    }
  }

  // 环境变量覆盖
  const envOverrides = loadEnvOverrides();

  cachedConfig = deepMerge(DEFAULT_ASK_CONFIG, fileConfig, envOverrides);
  configLoadTime = now;
  return cachedConfig;
}

/**
 * 保存 Ask 引擎配置
 */
export async function saveAskConfig(config: AskConfig): Promise<void> {
  await ensureDir('.speccore/config');
  await writeJson(CONFIG_PATH, config, { spaces: 2 });
  cachedConfig = config;
  configLoadTime = Date.now();
}

/**
 * 检查配置是否存在
 */
export async function hasAskConfig(): Promise<boolean> {
  return pathExists(CONFIG_PATH);
}

// ═══════════════════════════════════════════════════════════
// 环境变量覆盖
// ═══════════════════════════════════════════════════════════

function loadEnvOverrides(): Partial<AskConfig> {
  const overrides: Partial<AskConfig> = {};

  if (process.env.SPECCORE_ASK_HIGH_THRESHOLD) {
    const n = parseInt(process.env.SPECCORE_ASK_HIGH_THRESHOLD, 10);
    if (!isNaN(n)) {
      overrides.routing = { ...(overrides.routing || {}), highThreshold: n } as any;
    }
  }
  if (process.env.SPECCORE_ASK_LOW_THRESHOLD) {
    const n = parseInt(process.env.SPECCORE_ASK_LOW_THRESHOLD, 10);
    if (!isNaN(n)) {
      overrides.routing = { ...(overrides.routing || {}), lowThreshold: n } as any;
    }
  }

  if (process.env.SPECCORE_ASK_AUTO_HOST_AI) {
    overrides.routing = {
      ...(overrides.routing || {}),
      autoHostAi: process.env.SPECCORE_ASK_AUTO_HOST_AI === 'true',
    } as any;
  }

  if (process.env.SPECCORE_ASK_CACHE_ENABLED) {
    overrides.routing = {
      ...(overrides.routing || {}),
      cacheEnabled: process.env.SPECCORE_ASK_CACHE_ENABLED === 'true',
    } as any;
  }

  return overrides;
}

// ═══════════════════════════════════════════════════════════
// 深度合并
// ═══════════════════════════════════════════════════════════

function deepMerge<T>(base: T, ...sources: Partial<T>[]): T {
  const result = { ...base };
  for (const source of sources) {
    for (const key of Object.keys(source) as (keyof T)[]) {
      const val = source[key];
      if (val !== undefined && val !== null) {
        if (typeof val === 'object' && !Array.isArray(val) && typeof result[key] === 'object') {
          result[key] = deepMerge(result[key] as any, val as any) as any;
        } else {
          result[key] = val as any;
        }
      }
    }
  }
  return result;
}
