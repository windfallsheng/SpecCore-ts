/**
 * ask-llm — LLM 增强意图引擎
 * 将 18 条命令知识库 + 4 种工作流注入 prompt，让 LLM 理解并输出结构化结果
 * 规则引擎为 fallback，LLM 优先
 */

import { logger } from '../utils/logger';
import { COMMAND_KB, WORKFLOWS, classifyMode, AskResult, PipelinePlan } from './ask-engine';

// ============================================================
// Prompt 构建
// ============================================================

function buildSystemPrompt(): string {
  const cmdList = COMMAND_KB.map(c =>
    `- **${c.name}** (${c.aliases.join('/')}): ${c.description}\n  用法: \`${c.usage}\`\n  触发词: ${c.triggers.slice(0,4).join(', ')}`
  ).join('\n');

  const workflowList = Object.entries(WORKFLOWS).map(([name, steps]) =>
    `### ${name}\n${steps.map(s => `${s.order}. speccore ${s.command} ${s.args} — ${s.explanation}`).join('\n')}`
  ).join('\n\n');

  return `你是 SpecCore CLI 的 AI 助手。你了解以下命令和工作流，可以根据用户的自然语言输入，返回结构化的 JSON 响应。

## 可用命令
${cmdList}

## 预定义工作流
${workflowList}

## 你的任务
根据用户输入，判断模式并返回 JSON。不要解释，只返回 JSON。

### 输出格式
{
  "mode": "explain|guide|match|pipeline",
  "summary": "简短摘要",
  "detail": "详细解释（Markdown）",
  "commands": ["匹配的命令名"],
  "pipeline": null 或 {
    "steps": [{"order": 1, "command": "命令", "args": "参数", "explanation": "说明", "dependsOn": null}]
  }
}

### 模式说明
- explain: 用户问某个命令的用法 → 返回该命令的详细说明
- guide: 用户问怎么做/步骤 → 匹配最合适的工作流
- match: 用户描述想做某事 → 匹配单个最合适的命令
- pipeline: 用户描述多步骤操作（含时间/批次/顺序） → 返回多步执行计划

### 参数提取规则
- 时间: "晚8点" → "--at 20:00", "明早8点" → "--at 08:00"
- 批次: "3个一批" → "--batch-size 3", "分5批" → "--batch-size 5"
- 迭代: 如果有提到 Q1/Q2/Q3 等 → "--iteration Q1"
- 任务: 如果提到任务名/ID → "--task <id>"`;
}

function buildUserPrompt(input: string): string {
  return `用户输入: "${input}"\n\n请分析并返回 JSON:`;
}

// ============================================================
// LLM 调用
// ============================================================

interface LlmResponse {
  mode: string;
  summary: string;
  detail: string;
  commands: string[];
  pipeline?: PipelinePlan | null;
}

/**
 * 尝试用 LLM 解析意图
 * 成功返回结构化结果，失败返回 null（降级到规则引擎）
 */
export async function askWithLlm(input: string): Promise<AskResult | null> {
  try {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(input);

    // 使用 WorkBuddy 内置 LLM（通过子进程调用当前 AI）
    const response = await callLlm(systemPrompt, userPrompt);
    if (!response) return null;

    const parsed = parseLlmResponse(response);
    if (!parsed) return null;

    // 验证 commands 是否在 KB 中
    const validCommands = parsed.commands.filter(c =>
      COMMAND_KB.some(kb => kb.name === c || kb.aliases.includes(c))
    );

    return {
      mode: (parsed.mode || 'match') as AskResult['mode'],
      summary: parsed.summary,
      detail: parsed.detail,
      commands: validCommands.length > 0 ? validCommands : [],
      pipeline: parsed.pipeline || undefined,
    };
  } catch (e: any) {
    logger.warn(`LLM 增强失败，降级到规则引擎: ${e.message}`);
    return null;
  }
}

/**
 * 调用 LLM
 * 优先使用环境变量 SPECCORE_LLM_ENDPOINT，否则尝试 OpenAI 兼容接口
 */
async function callLlm(systemPrompt: string, userPrompt: string): Promise<string | null> {
  // 方案1: OpenAI 兼容接口
  const endpoint = process.env.SPECCORE_LLM_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
  const apiKey = process.env.SPECCORE_LLM_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    // 本地无 API Key → 尝试用 WorkBuddy 的 LLM（通过文件通信）
    return callViaWorkBuddy(systemPrompt, userPrompt);
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.SPECCORE_LLM_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      }),
    });
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch {
    return callViaWorkBuddy(systemPrompt, userPrompt);
  }
}

/**
 * 通过 WorkBuddy 的 LLM 通信
 * 写入 prompt 到临时文件，WorkBuddy 的 AI 助手读取并返回
 */
async function callViaWorkBuddy(systemPrompt: string, userPrompt: string): Promise<string | null> {
  // 在 WorkBuddy 环境中，当前 AI 直接处理
  // 使用一个标记来检测是否能直接回答
  const combined = `${systemPrompt}\n\n${userPrompt}`;
  
  try {
    // 尝试通过 HTTP 调用（如果有本地 LLM 服务）
    const localRes = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:7b',
        prompt: combined,
        stream: false,
        options: { temperature: 0.1, num_predict: 500 },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (localRes.ok) {
      const data: any = await localRes.json();
      return data?.response || null;
    }
  } catch {}

  return null;
}

/**
 * 解析 LLM 返回的 JSON
 */
function parseLlmResponse(text: string): LlmResponse | null {
  try {
    // 尝试直接解析
    return JSON.parse(text);
  } catch {
    // 尝试提取 JSON 块
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
  }
  return null;
}
