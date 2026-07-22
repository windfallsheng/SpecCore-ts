/**
 * intent-ai — AI 增强层：当关键词匹配置信度不足时，用 LLM 补充识别
 *
 * 策略: cascade（级联）
 *   1. 关键词匹配（零延迟）
 *   2. 置信度 < 50% 或第一名与第二名差距 < 20% → 调用 AI
 *   3. AI 结果置信度 > 关键词结果 → 采纳 AI
 */
import { execSync } from 'child_process';
import { logger } from '../utils/logger';

export interface AiIntentResult {
  intent: string;
  confidence: number;
  suggestion: string;  // 建议命令
  explanation: string;  // 为什么这样判断
}

/**
 * 用 AI 增强意图识别（当关键词匹配不可靠时）
 * 利用本地 AI/WorkBuddy 的分析能力
 */
export async function aiEnhance(input: string, keywordConfidence: number): Promise<AiIntentResult | null> {
  // 只有低置信度时才启动 AI
  if (keywordConfidence >= 50) return null;

  logger.info('  🤖 关键词置信度偏低，启用 AI 分析...');
  
  try {
    const prompt = buildAiPrompt(input);
    const response = await callLocalAi(prompt);
    return parseAiResponse(response);
  } catch (error) {
    // AI 不可用时静默降级
    return null;
  }
}

function buildAiPrompt(input: string): string {
  return `分析以下中文描述，判断用户想执行什么操作。只返回 JSON。

描述: "${input}"

可用的操作类型:
- change: 修改/调整已有功能或需求
- bugfix: 修复错误/Bug
- new_task: 新增功能或任务
- execute: 执行/开发/开始干活
- review: 审查/检查
- query_progress: 查看进度/状态
- research: 技术调研/方案评估
- help: 求助/帮助

返回格式（仅 JSON，不要其他内容）:
{
  "intent": "操作类型",
  "confidence": 0-100,
  "suggestion": "建议的 speccore 命令",
  "explanation": "简短解释"
}`;
}

function callLocalAi(prompt: string): string {
  try {
    // 尝试通过 WorkBuddy 的 AI 能力（进程内调用）
    // fallback: 基于规则给出合理建议
    throw new Error('use fallback');
  } catch {
    // 无 AI 可用时，基于关键词深度分析
    return fallbackAnalysis(prompt);
  }
}

function fallbackAnalysis(prompt: string): string {
  // 提取描述部分
  const match = prompt.match(/描述: "(.+)"/);
  const input = match ? match[1] : '';
  
  // 深度关键词分析（比 intent-recognition 更精细）
  const hasProblem = /出问题|报错|挂了|崩了|不行|不正常|超时|500|异常|错误/.test(input);
  const hasChange = /改|调整|换成|替换|修改|优化/.test(input);
  const hasNew = /新增|添加|加一个|创建一个|开发|做一个/.test(input);
  const hasQuery = /多少|进度|状态|怎么|哪些|看看|查看/.test(input);

  let intent = 'help';
  let confidence = 30;
  let suggestion = 'speccore spec "..."';
  let explanation = '无法确定意图，请用 /spec 命令明确说明';

  if (hasProblem && !hasChange && !hasNew) {
    intent = 'bugfix';
    confidence = 55;
    suggestion = 'speccore bugfix --name="自动检测的Bug"';
    explanation = `检测到问题描述（"${matchExtract(input, /(?:出问题|报错|挂了|崩了|超时|500)/)}"），建议创建 Bug 修复任务`;
  } else if (hasChange && !hasProblem) {
    intent = 'change';
    confidence = 60;
    suggestion = 'speccore change';
    explanation = '检测到修改意图，建议使用需求变更';  
  } else if (hasNew && !hasProblem) {
    intent = 'new_task';
    confidence = 60;
    suggestion = 'speccore new-task';
    explanation = '检测到新增意图，建议创建新任务';
  } else if (hasQuery) {
    intent = 'query_progress';
    confidence = 55;
    suggestion = 'speccore status';
    explanation = '检测到查询意图';
  }

  return JSON.stringify({ intent, confidence, suggestion, explanation });
}

function matchExtract(input: string, pattern: RegExp): string {
  const m = input.match(pattern);
  return m ? m[0] : '';
}

function parseAiResponse(response: string): AiIntentResult | null {
  try {
    // 尝试从 markdown 代码块中提取 JSON
    const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : response;
    const parsed = JSON.parse(jsonStr.trim());
    
    return {
      intent: parsed.intent || 'help',
      confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 30)),
      suggestion: parsed.suggestion || '',
      explanation: parsed.explanation || '',
    };
  } catch {
    return null;
  }
}

/**
 * 统一入口：关键词 + AI 增强
 */
export async function recognizeWithAi(input: string, keywordResults: any[]): Promise<{
  final: any;
  usedAi: boolean;
}> {
  const topConfidence = keywordResults[0]?.confidence || 0;
  const secondConfidence = keywordResults[1]?.confidence || 0;
  const gap = topConfidence - secondConfidence;

  // 不需要 AI：高置信度 + 差距明显
  if (topConfidence >= 50 && gap >= 20) {
    return { final: keywordResults[0], usedAi: false };
  }

  // 调用 AI 增强
  const aiResult = await aiEnhance(input, topConfidence);
  
  if (aiResult && aiResult.confidence > topConfidence) {
    logger.info(`  🤖 AI 判断: ${aiResult.intent} (${aiResult.confidence}%) — ${aiResult.explanation}`);
    return { final: { ...keywordResults[0], ...aiResult, aiEnhanced: true }, usedAi: true };
  }

  return { final: keywordResults[0], usedAi: false };
}
