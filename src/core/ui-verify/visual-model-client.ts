/**
 * Visual Model Client — 视觉模型调用客户端
 *
 * 支持多提供商切换：
 * - qwen-vl: 阿里云 DashScope（默认）
 * - openai: OpenAI GPT-4o
 * - anthropic: Claude 3.5 Sonnet
 * - local: 本地模型（OpenAI 兼容格式）
 */

import { logger } from '../../utils/logger';

// ─────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────

export interface VisualModelConfig {
  provider: 'qwen-vl' | 'openai' | 'anthropic' | 'local';
  model?: string;
  apiKey?: string;
  endpoint?: string;
  timeout?: number;
}

export interface VisualModelResult {
  passed: boolean;
  analysis: string;
  issues: Array<{
    severity: 'error' | 'warning' | 'info';
    description: string;
    region?: string;
  }>;
}

// ─────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────

export async function callVisualModel(
  config: VisualModelConfig,
  options: {
    scenarioName: string;
    currentImageBase64: string;
    baselineImageBase64?: string;
    threshold: 'strict' | 'normal' | 'loose';
  }
): Promise<VisualModelResult> {
  const provider = config.provider || 'qwen-vl';

  switch (provider) {
    case 'qwen-vl':
      return callQwenVL(config, options);
    case 'openai':
      return callOpenAI(config, options);
    case 'anthropic':
      return callAnthropic(config, options);
    case 'local':
      return callLocalModel(config, options);
    default:
      throw new Error(`不支持的视觉模型提供商: ${provider}`);
  }
}

// ─────────────────────────────────────────
// Qwen-VL（阿里云 DashScope）
// ─────────────────────────────────────────

async function callQwenVL(
  config: VisualModelConfig,
  options: {
    scenarioName: string;
    currentImageBase64: string;
    baselineImageBase64?: string;
    threshold: 'strict' | 'normal' | 'loose';
  }
): Promise<VisualModelResult> {
  const apiKey = config.apiKey || process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，请在 .speccore.yml 或环境变量中设置');
  }

  const model = config.model || 'qwen-vl-max';
  const endpoint = config.endpoint || 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  const timeout = config.timeout || 60000;

  const prompt = buildPrompt(options.scenarioName, options.baselineImageBase64 ? 'compare' : 'single', options.threshold);

  const messages: any[] = [
    {
      role: 'system',
      content: '你是一个专业的 UI 视觉测试专家。请严格按照 JSON 格式输出分析结果。',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${options.currentImageBase64}` },
        },
      ],
    },
  ];

  // 如果有基准图，加入对比
  if (options.baselineImageBase64) {
    (messages[1].content as any[]).push({
      type: 'text',
      text: '上方第一张是基准图（预期效果），第二张是当前截图（待检测）。',
    });
    (messages[1].content as any[]).push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${options.baselineImageBase64}` },
    });
  }

  logger.info(`    🤖 调用 Qwen-VL: ${model}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 2000,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DashScope API 错误 (${response.status}): ${errorText}`);
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    return parseModelResponse(content, options.threshold);
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`Qwen-VL 请求超时 (${timeout}ms)`);
    }
    throw error;
  }
}

// ─────────────────────────────────────────
// OpenAI GPT-4o
// ─────────────────────────────────────────

async function callOpenAI(
  config: VisualModelConfig,
  options: {
    scenarioName: string;
    currentImageBase64: string;
    baselineImageBase64?: string;
    threshold: 'strict' | 'normal' | 'loose';
  }
): Promise<VisualModelResult> {
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('未配置 OPENAI_API_KEY，请在 .speccore.yml 或环境变量中设置');
  }

  const model = config.model || 'gpt-4o';
  const endpoint = config.endpoint || 'https://api.openai.com/v1/chat/completions';
  const timeout = config.timeout || 60000;

  const prompt = buildPrompt(options.scenarioName, options.baselineImageBase64 ? 'compare' : 'single', options.threshold);

  const content: any[] = [
    { type: 'text', text: prompt },
    {
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${options.currentImageBase64}` },
    },
  ];

  if (options.baselineImageBase64) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${options.baselineImageBase64}` },
    });
  }

  logger.info(`    🤖 调用 OpenAI: ${model}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content }],
        max_tokens: 2000,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API 错误 (${response.status}): ${errorText}`);
    }

    const data: any = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    return parseModelResponse(text, options.threshold);
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`OpenAI 请求超时 (${timeout}ms)`);
    }
    throw error;
  }
}

// ─────────────────────────────────────────
// Anthropic Claude
// ─────────────────────────────────────────

async function callAnthropic(
  config: VisualModelConfig,
  options: {
    scenarioName: string;
    currentImageBase64: string;
    baselineImageBase64?: string;
    threshold: 'strict' | 'normal' | 'loose';
  }
): Promise<VisualModelResult> {
  const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('未配置 ANTHROPIC_API_KEY，请在 .speccore.yml 或环境变量中设置');
  }

  const model = config.model || 'claude-3-5-sonnet-20241022';
  const endpoint = config.endpoint || 'https://api.anthropic.com/v1/messages';
  const timeout = config.timeout || 60000;

  const prompt = buildPrompt(options.scenarioName, options.baselineImageBase64 ? 'compare' : 'single', options.threshold);

  const content: any[] = [
    { type: 'text', text: prompt },
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: options.currentImageBase64,
      },
    },
  ];

  if (options.baselineImageBase64) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: options.baselineImageBase64,
      },
    });
  }

  logger.info(`    🤖 调用 Claude: ${model}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        messages: [{ role: 'user', content }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API 错误 (${response.status}): ${errorText}`);
    }

    const data: any = await response.json();
    const text = data.content?.[0]?.text || '';

    return parseModelResponse(text, options.threshold);
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`Claude 请求超时 (${timeout}ms)`);
    }
    throw error;
  }
}

// ─────────────────────────────────────────
// 本地模型（预留）
// ─────────────────────────────────────────

async function callLocalModel(
  config: VisualModelConfig,
  options: {
    scenarioName: string;
    currentImageBase64: string;
    baselineImageBase64?: string;
    threshold: 'strict' | 'normal' | 'loose';
  }
): Promise<VisualModelResult> {
  const endpoint = config.endpoint || 'http://localhost:8000/v1/chat/completions';
  const model = config.model || 'local-vision-model';
  const timeout = config.timeout || 120000;

  logger.info(`    🤖 调用本地模型: ${endpoint}`);

  const prompt = buildPrompt(options.scenarioName, options.baselineImageBase64 ? 'compare' : 'single', options.threshold);

  const messages: any[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${options.currentImageBase64}` },
        },
      ],
    },
  ];

  if (options.baselineImageBase64) {
    (messages[0].content as any[]).push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${options.baselineImageBase64}` },
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, max_tokens: 2000 }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`本地模型错误 (${response.status}): ${errorText}`);
    }

    const data: any = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    return parseModelResponse(text, options.threshold);
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`本地模型请求超时 (${timeout}ms)`);
    }
    throw error;
  }
}

// ─────────────────────────────────────────
// Prompt 构建
// ─────────────────────────────────────────

function buildPrompt(
  scenarioName: string,
  mode: 'single' | 'compare',
  threshold: 'strict' | 'normal' | 'loose'
): string {
  const strictness = threshold === 'strict'
    ? '非常严格：任何微小的视觉差异都应视为问题。'
    : threshold === 'normal'
      ? '正常标准：明显的布局偏移、元素缺失、颜色变化视为问题，微小像素差异可忽略。'
      : '宽松标准：只关注严重的视觉问题（如白屏、元素大面积缺失、明显崩坏）。';

  if (mode === 'compare') {
    return `请对比分析「${scenarioName}」的基准图和当前截图的视觉差异。

检测标准：${strictness}

请重点检查以下问题：
1. 布局偏移：元素位置是否发生明显变化
2. 元素缺失/新增：是否有元素消失或出现新元素
3. 颜色变化：背景色、文字色、按钮色是否改变
4. 文字变动：文案内容、字体大小是否变化
5. 图片加载：图片是否正常显示，有无裂图
6. 明显崩坏：CSS 样式是否失效，布局是否混乱

请严格按照以下 JSON 格式输出结果，不要输出其他内容：
{
  "passed": true/false,
  "analysis": "总体分析结论（中文，200字以内）",
  "issues": [
    {
      "severity": "critical/warning/info",
      "description": "问题描述（中文）",
      "region": "问题区域（如：顶部导航栏/登录表单）"
    }
  ]
}`;
  }

  return `请分析「${scenarioName}」的当前截图，进行通用 UI 质量扫描。

检测标准：${strictness}

请重点检查以下问题：
1. 白屏/灰屏：页面是否正常渲染
2. 布局崩坏：是否有明显的 CSS 失效、元素重叠、溢出
3. 文字问题：文字是否重叠、截断、乱码
4. 图片加载：图片是否正常显示，有无裂图图标
5. UI 异常：是否有明显的报错弹窗、空白区域、按钮不可点击
6. 响应式问题：在不同尺寸下是否有明显的适配问题

请严格按照以下 JSON 格式输出结果，不要输出其他内容：
{
  "passed": true/false,
  "analysis": "总体分析结论（中文，200字以内）",
  "issues": [
    {
      "severity": "critical/warning/info",
      "description": "问题描述（中文）",
      "region": "问题区域（如：顶部导航栏/登录表单）"
    }
  ]
}`;
}

// ─────────────────────────────────────────
// 响应解析
// ─────────────────────────────────────────

function parseModelResponse(text: string, threshold: string): VisualModelResult {
  // 尝试从文本中提取 JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // 没有 JSON，按纯文本处理
    return {
      passed: threshold !== 'strict',
      analysis: text.slice(0, 500),
      issues: [],
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      passed: parsed.passed ?? true,
      analysis: parsed.analysis || '未提供分析',
      issues: (parsed.issues || []).map((i: any) => ({
        severity: i.severity || 'info',
        description: i.description || '',
        region: i.region,
      })),
    };
  } catch {
    return {
      passed: threshold !== 'strict',
      analysis: text.slice(0, 500),
      issues: [],
    };
  }
}

// ─────────────────────────────────────────
// 配置可用性检查
// ─────────────────────────────────────────

export async function isVisualModelAvailable(config?: VisualModelConfig): Promise<boolean> {
  if (!config) return false;

  const envKeys: Record<string, string> = {
    'qwen-vl': 'DASHSCOPE_API_KEY',
    'openai': 'OPENAI_API_KEY',
    'anthropic': 'ANTHROPIC_API_KEY',
    'local': '',
  };

  if (config.apiKey) return true;
  if (config.provider === 'local') return true;

  const envKey = envKeys[config.provider];
  return envKey ? !!process.env[envKey] : false;
}
