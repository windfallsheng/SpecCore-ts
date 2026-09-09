/**
 * vision-engine — 视觉模型调用引擎（v8.3.94+）
 *
 * 用于 specs 图片理解：读取 PNG/JPG 等位图，调用视觉模型生成文本描述，
 * 将描述注入 AI prompt，让 AI"看懂"设计稿截图。
 *
 * 支持 provider: qwen-vl | openai | anthropic | local
 * 默认关闭，需在 .speccore.yml settings.vision 中启用。
 */
import { readFile, pathExists, stat } from 'fs-extra';
import { join, extname } from 'path';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface VisionModelConfig {
  enabled: boolean;
  provider: 'qwen-vl' | 'openai' | 'anthropic' | 'local';
  model?: string;
  apiKey?: string;
  endpoint?: string;
  timeout?: number;
  maxImagesPerPrompt?: number;
  imageMaxSizeKb?: number;
}

export interface ImageDescriptionResult {
  success: boolean;
  description: string;
  error?: string;
}

// ═══════════════════════════════════════════════════════════
// 配置读取（带缓存）
// ═══════════════════════════════════════════════════════════

let visionConfigCache: { cwd: string; config?: VisionModelConfig } | null = null;

/**
 * 从 .speccore.yml 读取视觉模型配置
 * 优先 settings.vision，回退到 quality_gates.verify_ui.visual_model
 */
export async function loadVisionConfig(cwd: string): Promise<VisionModelConfig | undefined> {
  if (visionConfigCache && visionConfigCache.cwd === cwd) {
    return visionConfigCache.config;
  }

  const configPath = join(cwd, '.speccore.yml');
  try {
    if (!await pathExists(configPath)) {
      visionConfigCache = { cwd, config: undefined };
      return undefined;
    }
    const raw = await readFile(configPath, 'utf-8');
    // 简易 YAML 解析（只读需要的字段）
    const parsed = parseVisionYaml(raw);

    // 优先 settings.vision
    const vision = parsed.settings?.vision;
    if (vision?.enabled) {
      const cfg: VisionModelConfig = {
        provider: vision.provider || 'qwen-vl',
        model: vision.model,
        apiKey: vision.apiKey,
        endpoint: vision.endpoint,
        timeout: vision.timeout ?? 60000,
        maxImagesPerPrompt: vision.maxImagesPerPrompt ?? 10,
        imageMaxSizeKb: vision.imageMaxSizeKb ?? 2048,
        enabled: true,
      };
      visionConfigCache = { cwd, config: cfg };
      return cfg;
    }

    // 回退到 quality_gates.verify_ui.visual_model
    const vm = parsed.quality_gates?.verify_ui?.visual_model;
    if (vm) {
      const cfg: VisionModelConfig = {
        provider: vm.provider || 'qwen-vl',
        model: vm.model,
        apiKey: vm.apiKey,
        endpoint: vm.endpoint,
        timeout: vm.timeout ?? 60000,
        maxImagesPerPrompt: 10,
        imageMaxSizeKb: 2048,
        enabled: true,
      };
      visionConfigCache = { cwd, config: cfg };
      return cfg;
    }
  } catch (e) {
    logger.debug?.(`读取视觉模型配置失败: ${e}`);
  }

  visionConfigCache = { cwd, config: undefined };
  return undefined;
}

/** 简易 YAML 解析（只提取 vision 相关字段） */
function parseVisionYaml(yaml: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = yaml.split(/\r?\n/);
  const stack: { obj: any; indent: number }[] = [{ obj: result, indent: -1 }];

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    // 回退到合适的层级
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    if (trimmed.startsWith('- ')) {
      const val = trimmed.slice(2).trim();
      if (!Array.isArray(parent)) continue;
      parent.push(val);
    } else if (trimmed.includes(':')) {
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.slice(0, colonIdx).trim();
      let val = trimmed.slice(colonIdx + 1).trim();
      // 去掉引号
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (val === '' || val === '~' || val === 'null') {
        // 可能是对象或数组，先创建空对象
        parent[key] = {};
        stack.push({ obj: parent[key], indent });
      } else {
        parent[key] = val;
      }
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════
// 图片描述核心函数
// ═══════════════════════════════════════════════════════════

/**
 * 调用视觉模型获取图片的文本描述
 */
export async function describeImage(
  imagePath: string,
  config: VisionModelConfig,
): Promise<ImageDescriptionResult> {
  // 1. 检查文件存在和大小
  try {
    if (!await pathExists(imagePath)) {
      return { success: false, description: '', error: '文件不存在' };
    }
    const st = await stat(imagePath);
    const sizeKb = st.size / 1024;
    const maxSize = config.imageMaxSizeKb ?? 2048;
    if (sizeKb > maxSize) {
      return {
        success: false,
        description: '',
        error: `图片过大 (${sizeKb.toFixed(0)} KB > ${maxSize} KB 限制)`,
      };
    }
  } catch (e) {
    return { success: false, description: '', error: `文件检查失败: ${e}` };
  }

  // 2. 读取并编码为 base64
  let base64: string;
  let mediaType: string;
  try {
    const buf = await readFile(imagePath);
    base64 = buf.toString('base64');
    mediaType = inferMediaType(imagePath);
  } catch (e) {
    return { success: false, description: '', error: `读取图片失败: ${e}` };
  }

  // 3. 根据 provider 调用不同 API
  const timeout = config.timeout ?? 60000;
  const prompt = '请详细描述这张图片的内容，包括：界面布局、元素位置、颜色、文字内容、交互元素等。用中文回答。';

  try {
    switch (config.provider) {
      case 'qwen-vl':
        return await callQwenVl(base64, mediaType, prompt, config, timeout);
      case 'openai':
        return await callOpenAiVision(base64, mediaType, prompt, config, timeout);
      case 'anthropic':
        return await callAnthropicVision(base64, mediaType, prompt, config, timeout);
      case 'local':
        return await callLocalVision(base64, mediaType, prompt, config, timeout);
      default:
        return { success: false, description: '', error: `不支持的视觉模型提供商: ${config.provider}` };
    }
  } catch (e: any) {
    return { success: false, description: '', error: `API 调用失败: ${e.message || e}` };
  }
}

/** 推断图片 MIME 类型 */
function inferMediaType(imagePath: string): string {
  const ext = extname(imagePath).toLowerCase();
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
  };
  return map[ext] || 'image/png';
}

// ═══════════════════════════════════════════════════════════
// Provider 实现
// ═══════════════════════════════════════════════════════════

/** 调用通义千问 VL (OpenAI 兼容格式) */
async function callQwenVl(
  base64: string,
  mediaType: string,
  prompt: string,
  config: VisionModelConfig,
  timeout: number,
): Promise<ImageDescriptionResult> {
  const apiKey = config.apiKey || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
  if (!apiKey) {
    return { success: false, description: '', error: '缺少 API Key（请设置 DASHSCOPE_API_KEY 或 qwen-vl 配置中的 apiKey）' };
  }

  const endpoint = config.endpoint || 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  const model = config.model || 'qwen-vl-plus';

  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
        ],
      },
    ],
    max_tokens: 1024,
  };

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  }, timeout);

  const data = await response.json() as any;
  if (!response.ok) {
    return { success: false, description: '', error: `qwen-vl API 错误: ${data.error?.message || JSON.stringify(data)}` };
  }

  const description = data.choices?.[0]?.message?.content || '';
  return { success: true, description };
}

/** 调用 OpenAI GPT-4V / GPT-4o */
async function callOpenAiVision(
  base64: string,
  mediaType: string,
  prompt: string,
  config: VisionModelConfig,
  timeout: number,
): Promise<ImageDescriptionResult> {
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { success: false, description: '', error: '缺少 API Key（请设置 OPENAI_API_KEY 或 openai 配置中的 apiKey）' };
  }

  const endpoint = config.endpoint || 'https://api.openai.com/v1/chat/completions';
  const model = config.model || 'gpt-4o';

  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
        ],
      },
    ],
    max_tokens: 1024,
  };

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  }, timeout);

  const data = await response.json() as any;
  if (!response.ok) {
    return { success: false, description: '', error: `OpenAI API 错误: ${data.error?.message || JSON.stringify(data)}` };
  }

  const description = data.choices?.[0]?.message?.content || '';
  return { success: true, description };
}

/** 调用 Anthropic Claude 3 */
async function callAnthropicVision(
  base64: string,
  mediaType: string,
  prompt: string,
  config: VisionModelConfig,
  timeout: number,
): Promise<ImageDescriptionResult> {
  const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { success: false, description: '', error: '缺少 API Key（请设置 ANTHROPIC_API_KEY 或 anthropic 配置中的 apiKey）' };
  }

  const endpoint = config.endpoint || 'https://api.anthropic.com/v1/messages';
  const model = config.model || 'claude-3-sonnet-20240229';

  const body = {
    model,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64,
            },
          },
        ],
      },
    ],
  };

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  }, timeout);

  const data = await response.json() as any;
  if (!response.ok) {
    return { success: false, description: '', error: `Anthropic API 错误: ${data.error?.message || JSON.stringify(data)}` };
  }

  const description = data.content?.[0]?.text || '';
  return { success: true, description };
}

/** 调用本地视觉模型（Ollama / LM Studio 等 OpenAI 兼容端点） */
async function callLocalVision(
  base64: string,
  mediaType: string,
  prompt: string,
  config: VisionModelConfig,
  timeout: number,
): Promise<ImageDescriptionResult> {
  const endpoint = config.endpoint || 'http://localhost:11434/v1/chat/completions';
  const model = config.model || 'llava';

  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
        ],
      },
    ],
    max_tokens: 1024,
  };

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, timeout);

  const data = await response.json() as any;
  if (!response.ok) {
    return { success: false, description: '', error: `本地模型 API 错误: ${data.error?.message || JSON.stringify(data)}` };
  }

  const description = data.choices?.[0]?.message?.content || '';
  return { success: true, description };
}

// ═══════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════

/** 带超时的 fetch */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** 检查视觉模型是否启用 */
export function isVisionEnabled(config?: VisionModelConfig): boolean {
  return !!config && config.enabled === true;
}
