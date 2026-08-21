/**
 * graph-semantic — LLM 增强的图谱语义查询
 * v7.0.0+: 让图谱查询从"关键词匹配"升级为"语义理解"
 *
 * 核心能力：
 * 1. 查询词语义扩展 —— "订单相关" → 扩展为 ["order", "booking", "purchase", "交易", "下单", "订单号"]
 * 2. 候选结果语义排序 —— LLM 理解查询意图后，对匹配结果重新排序
 * 3. 零 Token 回退 —— LLM 不可用时，降级到本地规则扩展
 */

import { logger } from '../utils/logger';
import type { GraphEntity } from './knowledge-graph';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface SemanticExpansion {
  /** 原始查询词 */
  original: string;
  /** LLM 理解的查询意图 */
  intent: string;
  /** 扩展后的关键词列表（含同义词、相关概念） */
  keywords: string[];
  /** 业务域推断 */
  domain?: string;
  /** 查询类型推断 */
  queryType: 'code' | 'requirement' | 'task' | 'architecture' | 'mixed';
}

export interface RankedCandidate {
  entity: GraphEntity;
  /** 本地匹配得分 */
  localScore: number;
  /** LLM 语义得分 (0-100) */
  semanticScore: number;
  /** 综合得分 */
  finalScore: number;
  /** LLM 给出的匹配理由 */
  reason?: string;
}

// ═══════════════════════════════════════════════════════════
// 查询语义扩展
// ═══════════════════════════════════════════════════════════

/**
 * 语义扩展查询词
 * 优先使用 LLM，降级到本地规则
 */
export async function expandQuerySemantically(
  question: string,
  options?: { useLlm?: boolean },
): Promise<SemanticExpansion> {
  const useLlm = options?.useLlm !== false;

  // 尝试 LLM 扩展
  if (useLlm) {
    try {
      const llmResult = await expandWithLLM(question);
      if (llmResult) return llmResult;
    } catch (e) {
      logger.debug('LLM 语义扩展失败，降级到本地规则:', e);
    }
  }

  // 降级到本地规则扩展
  return expandWithRules(question);
}

/**
 * 使用 LLM 进行语义扩展
 */
async function expandWithLLM(question: string): Promise<SemanticExpansion | null> {
  const prompt = buildExpansionPrompt(question);
  const response = await callLLM(prompt);
  if (!response) return null;

  try {
    const parsed = parseLlmJson(response);
    if (!parsed || !Array.isArray(parsed.keywords)) return null;

    return {
      original: question,
      intent: parsed.intent || '通用查询',
      keywords: parsed.keywords as string[],
      domain: parsed.domain,
      queryType: parsed.queryType || 'mixed',
    };
  } catch {
    return null;
  }
}

/**
 * 使用本地规则进行语义扩展（零 Token）
 */
function expandWithRules(question: string): SemanticExpansion {
  const lower = question.toLowerCase();
  const keywords: string[] = [];

  // 1. 提取原始词
  const rawWords = lower
    .replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);
  keywords.push(...rawWords);

  // 2. 业务域同义词扩展
  const DOMAIN_SYNONYMS: Record<string, string[]> = {
    // 订单/交易域
    '订单': ['order', 'booking', 'purchase', 'trade', 'transaction', '下单', '订单号', '订单状态', '订单管理'],
    'order': ['订单', 'booking', 'purchase', 'trade', 'transaction', '下单'],
    '交易': ['transaction', 'trade', 'order', '支付', 'purchase'],
    '支付': ['payment', 'pay', 'checkout', 'transaction', '订单付款'],
    // 用户域
    '用户': ['user', 'account', 'member', 'customer', 'profile', '用户管理', '用户信息'],
    'user': ['用户', 'account', 'member', 'customer', 'profile'],
    '认证': ['auth', 'authentication', 'login', 'oauth', 'jwt', 'token', '登录', '鉴权'],
    'auth': ['认证', 'authentication', 'login', 'oauth', 'jwt', 'token', '鉴权'],
    '登录': ['login', 'signin', 'auth', 'authenticate', '认证', '登入'],
    // 内容域
    '内容': ['content', 'article', 'post', 'document', 'media', '素材'],
    'content': ['内容', 'article', 'post', 'document', 'media'],
    // 消息/通知域
    '消息': ['message', 'notification', 'notice', 'push', 'sms', 'email', '通知'],
    'notification': ['消息', 'notification', 'notice', 'push', '通知'],
    // 数据域
    '数据': ['data', 'database', 'model', 'entity', 'schema', '表', '字段'],
    'data': ['数据', 'database', 'model', 'entity', 'schema'],
    // 搜索域
    '搜索': ['search', 'query', 'filter', 'find', 'lookup', '检索', '查询'],
    'search': ['搜索', 'query', 'filter', 'find', 'lookup', '检索'],
    // 配置域
    '配置': ['config', 'configuration', 'settings', 'options', 'env', '环境变量'],
    'config': ['配置', 'configuration', 'settings', 'options', 'env'],
    // 监控域
    '监控': ['monitor', 'observability', 'metrics', 'alert', 'log', '监控', '告警'],
    'monitor': ['监控', 'observability', 'metrics', 'alert', 'log', '告警'],
    // 安全域
    '安全': ['security', 'safe', 'protect', 'encrypt', 'permission', '安全', '权限'],
    'security': ['安全', 'safe', 'protect', 'encrypt', 'permission', '权限'],
    // 性能域
    '性能': ['performance', 'optimize', 'cache', 'speed', 'latency', '性能', '优化'],
    'performance': ['性能', 'optimize', 'cache', 'speed', 'latency', '优化'],
    // 测试域
    '测试': ['test', 'testing', 'spec', 'e2e', 'unit', 'integration', '测试', '用例'],
    'test': ['测试', 'testing', 'spec', 'e2e', 'unit', 'integration'],
    // 部署域
    '部署': ['deploy', 'deployment', 'release', 'ci/cd', 'pipeline', '部署', '发布'],
    'deploy': ['部署', 'deployment', 'release', 'ci/cd', 'pipeline', '发布'],
  };

  for (const [key, syns] of Object.entries(DOMAIN_SYNONYMS)) {
    if (lower.includes(key)) {
      for (const syn of syns) {
        if (!keywords.includes(syn)) keywords.push(syn);
      }
    }
  }

  // 3. 推断查询类型
  let queryType: SemanticExpansion['queryType'] = 'mixed';
  if (/\b(code|代码|文件|类|函数|方法|源码|实现)\b/.test(lower)) queryType = 'code';
  else if (/\b(需求|requirement|feature|功能|用户故事|story)\b/.test(lower)) queryType = 'requirement';
  else if (/\b(任务|task|todo|计划|拆分)\b/.test(lower)) queryType = 'task';
  else if (/\b(架构|architecture|设计|结构|拓扑|服务|模块关系)\b/.test(lower)) queryType = 'architecture';

  // 4. 推断业务域
  let domain: string | undefined;
  for (const [key] of Object.entries(DOMAIN_SYNONYMS)) {
    if (lower.includes(key)) {
      domain = key;
      break;
    }
  }

  return {
    original: question,
    intent: `查询与 "${question}" 相关的实体`,
    keywords: [...new Set(keywords)],
    domain,
    queryType,
  };
}

/**
 * 构建语义扩展 Prompt
 */
function buildExpansionPrompt(question: string): string {
  return `你是代码知识图谱的语义查询助手。用户的查询可能包含口语化表达、模糊概念或业务术语。

任务：分析用户查询，输出结构化的语义扩展结果。

用户查询: "${question}"

要求：
1. 理解用户的真实意图（他们在找什么？）
2. 提取查询中的核心概念
3. 为每个核心概念生成同义词和相关术语（中英文都要）
4. 推断查询类型（code/requirement/task/architecture/mixed）
5. 推断业务域（如订单、用户、支付、内容等）

输出 JSON 格式（不要解释，只返回 JSON）：
{
  "intent": "用户的真实意图描述",
  "keywords": ["原始词", "同义词1", "同义词2", "相关术语1", "英文术语1", "英文术语2"],
  "domain": "业务域名称",
  "queryType": "code|requirement|task|architecture|mixed"
}`;
}

// ═══════════════════════════════════════════════════════════
// 候选结果语义排序
// ═══════════════════════════════════════════════════════════

/**
 * 使用 LLM 对候选结果做语义排序
 */
export async function semanticRank(
  question: string,
  candidates: { entity: GraphEntity; localScore: number }[],
  options?: { topK?: number; useLlm?: boolean },
): Promise<RankedCandidate[]> {
  const topK = options?.topK || 20;
  const useLlm = options?.useLlm !== false;

  // 取本地得分最高的候选
  const topCandidates = candidates
    .sort((a, b) => b.localScore - a.localScore)
    .slice(0, topK);

  if (topCandidates.length === 0) return [];

  // 尝试 LLM 排序
  if (useLlm && topCandidates.length > 1) {
    try {
      const ranked = await rankWithLLM(question, topCandidates);
      if (ranked) return ranked;
    } catch (e) {
      logger.debug('LLM 语义排序失败，使用本地得分:', e);
    }
  }

  // 降级：使用本地得分作为最终得分
  return topCandidates.map(c => ({
    entity: c.entity,
    localScore: c.localScore,
    semanticScore: 0,
    finalScore: c.localScore,
  }));
}

/**
 * LLM 语义排序
 */
async function rankWithLLM(
  question: string,
  candidates: { entity: GraphEntity; localScore: number }[],
): Promise<RankedCandidate[] | null> {
  const prompt = buildRankingPrompt(question, candidates);
  const response = await callLLM(prompt);
  if (!response) return null;

  try {
    const parsed = parseLlmJson(response);
    if (!parsed || !Array.isArray(parsed.ranking)) return null;

    const rankingMap = new Map<string, { score: number; reason: string }>();
    for (const item of parsed.ranking) {
      if (item.id && typeof item.score === 'number') {
        rankingMap.set(item.id, { score: item.score, reason: item.reason || '' });
      }
    }

    return candidates.map(c => {
      const llmResult = rankingMap.get(c.entity.id);
      const semanticScore = llmResult?.score || 0;
      // 综合得分 = 本地得分 * 0.4 + LLM 语义得分 * 0.6
      const finalScore = c.localScore * 0.4 + semanticScore * 0.6;

      return {
        entity: c.entity,
        localScore: c.localScore,
        semanticScore,
        finalScore,
        reason: llmResult?.reason,
      };
    }).sort((a, b) => b.finalScore - a.finalScore);
  } catch {
    return null;
  }
}

/**
 * 构建排序 Prompt
 */
function buildRankingPrompt(
  question: string,
  candidates: { entity: GraphEntity; localScore: number }[],
): string {
  const candidateList = candidates.map((c, i) => {
    const e = c.entity;
    const info = [
      `ID: ${e.id}`,
      `类型: ${e.type}`,
      `标题: ${e.title}`,
      e.description ? `描述: ${e.description.slice(0, 100)}` : '',
      e.semanticTags?.length ? `语义标签: ${e.semanticTags.join(', ')}` : '',
      e.businessRole ? `业务角色: ${e.businessRole}` : '',
      e.file ? `文件: ${e.file}` : '',
    ].filter(Boolean).join('\n   ');
    return `${i + 1}. ${info}`;
  }).join('\n\n');

  return `你是代码知识图谱的语义匹配助手。

用户查询: "${question}"

以下是从知识图谱中初步匹配的候选实体（按本地关键词匹配得分排序）：

${candidateList}

任务：判断每个候选实体与用户查询的语义相关性。

评分标准（0-100）：
- 90-100: 完全匹配，直接回答用户问题
- 70-89: 高度相关，包含用户需要的核心信息
- 50-69: 部分相关，需要进一步探索
- 30-49: 弱相关，可能有关联但不直接
- 0-29: 不相关

输出 JSON 格式（不要解释，只返回 JSON）：
{
  "reasoning": "简短的整体分析",
  "ranking": [
    { "id": "实体ID", "score": 85, "reason": "为什么相关/不相关" },
    ...
  ]
}`;
}

// ═══════════════════════════════════════════════════════════
// LLM 调用（复用 ask-llm 逻辑）
// ═══════════════════════════════════════════════════════════

async function callLLM(prompt: string): Promise<string | null> {
  // 优先使用环境变量配置的 LLM
  const endpoint = process.env.SPECCORE_LLM_ENDPOINT;
  const apiKey = process.env.SPECCORE_LLM_KEY || process.env.OPENAI_API_KEY;

  if (endpoint && apiKey) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: process.env.SPECCORE_LLM_MODEL || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a helpful assistant. Always respond with valid JSON only.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 2000,
        }),
        signal: AbortSignal.timeout(15000), // 15s 超时
      });
      if (!res.ok) {
        logger.debug(`LLM API 错误: ${res.status} ${res.statusText}`);
        return null;
      }
      const data: any = await res.json();
      return data?.choices?.[0]?.message?.content || null;
    } catch (e: any) {
      if (e.name === 'AbortError') {
        logger.debug('LLM 请求超时(15s)，降级到本地规则');
      } else {
        logger.debug(`LLM 请求失败: ${e.message}`);
      }
      // fallthrough
    }
  }

  // 尝试本地 Ollama
  try {
    const res = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:7b',
        prompt,
        stream: false,
        format: 'json',
        options: { temperature: 0.1, num_predict: 2000 },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data: any = await res.json();
      return data?.response || null;
    }
  } catch {}

  return null;
}

/**
 * 解析 LLM 返回的 JSON
 */
function parseLlmJson(text: string): any {
  try {
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
