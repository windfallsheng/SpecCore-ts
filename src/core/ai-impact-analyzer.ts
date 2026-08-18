/**
 * ai-impact-analyzer — AI 影响分析器（v6.73.0）
 *
 * 分层 AI + 知识图谱联动的变更影响分析引擎：
 * 1. 检索层（零 LLM 成本）: unifiedSearch 语义检索 + 知识图谱查询
 * 2. 推理层（1 次 LLM 调用）: 将检索结果送入 LLM，输出结构化影响分析
 * 3. 生成层（合并到同 1 次 LLM 调用）: 生成 CHANGE_TODO / 代码变更清单
 *
 * 降级策略：LLM 不可用时，回退到基于规则的分级（语义相关度阈值）
 */

import { join } from 'path';
import { pathExists, readFile } from 'fs-extra';
import { logger } from '../utils/logger';
import { unifiedSearch, UnifiedResult } from './unified-retrieval';
import { loadKnowledgeGraph, KnowledgeGraph, GraphEntity, GraphRelation } from './knowledge-graph';
import { ChangeCategory } from './change-parser';

// ── 类型定义 ──

/** 语义检索后的任务匹配结果 */
export interface TaskSemanticMatch {
  taskId: string;
  taskName: string;
  status: string;
  score: number;           // 语义相关度 0-1
  matchedContext: string;  // 匹配的上下文片段
  files: string[];         // 匹配到的文件
}

/** 代码级影响 */
export interface CodeImpact {
  file: string;
  currentImplementation: string;
  suggestedChange: string;
  reason: string;
  platform?: string;
}

/** 全局层影响 */
export interface GlobalImpact {
  artifact: string;
  reason: string;
  suggestedAction: string;
}

/** 跨迭代影响 */
export interface CrossIterationImpact {
  iteration: string;
  taskId: string;
  reason: string;
  severity: 'warning' | 'critical';
}

/** AI 影响分析结果 */
export interface AiImpactAnalysis {
  thinking: string;
  taskImpacts: {
    direct: TaskSemanticMatch[];
    indirect: TaskSemanticMatch[];
    unaffected: TaskSemanticMatch[];
  };
  codeImpacts: CodeImpact[];
  globalImpacts: GlobalImpact[];
  crossIterationImpacts: CrossIterationImpact[];
  executionPlan: {
    steps: string[];
    regressionTests: string[];
    globalRefreshSuggestions: string[];
  };
}

/** 检索上下文 */
export interface RetrievalContext {
  documentChunks: { source: string; content: string; score: number }[];
  codeSlices: { file: string; content: string; score: number }[];
  kgEntities: GraphEntity[];
  kgRelations: GraphRelation[];
}

// ── 1. 检索层（零 LLM 成本）──

/**
 * 语义检索：替代关键词匹配，使用 unifiedSearch 做真正的语义检索
 */
export async function semanticImpactAnalysis(
  desc: string,
  iteration: string,
  options: { withCode?: boolean } = {}
): Promise<{ docResult: UnifiedResult; codeResult: UnifiedResult | null }> {
  const cwd = process.cwd();

  // 1. 文档语义检索（迭代级）
  const docResult = await unifiedSearch(cwd, {
    query: desc,
    iteration,
  });

  // 2. 代码语义检索（如果 withCode）
  let codeResult: UnifiedResult | null = null;
  if (options.withCode) {
    codeResult = await unifiedSearch(cwd, {
      query: desc,
      iteration,
      sourceScope: 'code',
    });
  }

  logger.debug(`语义检索: 文档 ${docResult.stats.docChunksFound} chunks, 代码 ${codeResult?.stats.codeSlicesFound || 0} slices`);

  return { docResult, codeResult };
}

/**
 * 知识图谱查询：获取变更相关的实体和关联关系
 */
export async function analyzeWithKnowledgeGraph(
  desc: string,
  iteration: string,
  matchedTaskIds: string[]
): Promise<{ entities: GraphEntity[]; relations: GraphRelation[] }> {
  const graph = await loadKnowledgeGraph(process.cwd());
  if (!graph) {
    logger.debug('知识图谱未构建，跳过图谱分析');
    return { entities: [], relations: [] };
  }

  const entities: GraphEntity[] = [];
  const relations: GraphRelation[] = [];
  const seen = new Set<string>();

  // 1. 找到与匹配任务相关的实体
  for (const taskId of matchedTaskIds) {
    const entity = graph.entities[taskId];
    if (!entity || seen.has(taskId)) continue;

    entities.push(entity);
    seen.add(taskId);

    // 2. 获取 1-hop 邻居关系
    for (const rel of graph.relations) {
      if (rel.from === taskId || rel.to === taskId) {
        relations.push(rel);

        // 3. 获取关联实体
        const otherId = rel.from === taskId ? rel.to : rel.from;
        if (!seen.has(otherId) && graph.entities[otherId]) {
          entities.push(graph.entities[otherId]);
          seen.add(otherId);
        }
      }
    }
  }

  logger.debug(`知识图谱: ${entities.length} 实体, ${relations.length} 关系`);

  return { entities, relations };
}

/**
 * 按任务分组，计算语义相关度
 */
export function groupByTask(
  docResult: UnifiedResult,
  allTasks: { id: string; name: string; status: string }[]
): TaskSemanticMatch[] {
  const taskMap = new Map<string, TaskSemanticMatch>();

  for (const chunk of docResult.documentChunks) {
    // 从 chunk.filePath 提取任务 ID
    const taskIdMatch = chunk.filePath.match(/(Task-\d+)/);
    if (!taskIdMatch) continue;

    const taskId = taskIdMatch[1];
    const taskInfo = allTasks.find(t => t.id === taskId);

    if (!taskMap.has(taskId)) {
      taskMap.set(taskId, {
        taskId,
        taskName: taskInfo?.name || taskId,
        status: taskInfo?.status || 'unknown',
        score: chunk.relevanceScore || 0,
        matchedContext: chunk.content.slice(0, 200),
        files: [chunk.filePath],
      });
    } else {
      const existing = taskMap.get(taskId)!;
      existing.score = Math.max(existing.score, chunk.relevanceScore || 0);
      if (!existing.files.includes(chunk.filePath)) {
        existing.files.push(chunk.filePath);
      }
    }
  }

  // 按相关度排序
  return Array.from(taskMap.values()).sort((a, b) => b.score - a.score);
}

/**
 * 基于相关度阈值分类任务影响级别
 * 降级策略：LLM 不可用时使用
 */
export function classifyByThreshold(
  matches: TaskSemanticMatch[],
  graphContent: string
): { direct: TaskSemanticMatch[]; indirect: TaskSemanticMatch[]; unaffected: TaskSemanticMatch[] } {
  const direct: TaskSemanticMatch[] = [];
  const indirect: TaskSemanticMatch[] = [];

  for (const match of matches) {
    if (match.score >= 0.75) {
      direct.push(match);
    } else if (match.score >= 0.40) {
      indirect.push(match);
    }
  }

  const affectedIds = new Set([...direct.map(d => d.taskId), ...indirect.map(i => i.taskId)]);
  const unaffected = matches.filter(m => !affectedIds.has(m.taskId));

  return { direct, indirect, unaffected };
}

// ── 2. 推理层 + 生成层（LLM 1 次调用）──

/**
 * AI 影响分析主入口
 * 合并检索 → LLM 推理 → 生成实施计划 为一次调用
 *
 * 降级：LLM 不可用时返回基于阈值的分类结果
 */
export async function aiImpactAnalysis(
  desc: string,
  category: ChangeCategory,
  iteration: string,
  allTasks: { id: string; name: string; status: string }[],
  options: { withCode?: boolean; useLlm?: boolean } = {}
): Promise<AiImpactAnalysis> {
  const cwd = process.cwd();

  // Step 1: 语义检索
  const { docResult, codeResult } = await semanticImpactAnalysis(desc, iteration, options);

  // Step 2: 按任务分组
  const taskMatches = groupByTask(docResult, allTasks);

  // Step 3: 知识图谱查询
  const topTaskIds = taskMatches.slice(0, 8).map(m => m.taskId);
  const kgResult = await analyzeWithKnowledgeGraph(desc, iteration, topTaskIds);

  // Step 4: LLM 分析（如果启用且可用）
  if (options.useLlm !== false) {
    try {
      const llmResult = await callLlmForImpactAnalysis(desc, category, taskMatches, codeResult, kgResult);
      if (llmResult) {
        return llmResult;
      }
    } catch (e: any) {
      logger.warn(`LLM 分析失败，降级到规则引擎: ${e.message}`);
    }
  }

  // 降级：基于阈值的规则分类
  logger.info('🔄 使用规则引擎进行影响分析（语义检索 + 阈值分级）');
  const classified = classifyByThreshold(taskMatches, '');

  return {
    thinking: '基于语义检索相关度阈值分类（LLM 不可用时的降级策略）',
    taskImpacts: classified,
    codeImpacts: [],
    globalImpacts: inferGlobalImpacts(category),
    crossIterationImpacts: [],
    executionPlan: {
      steps: [`基于规则分析: ${classified.direct.length} 个直接受影响任务需更新`, `${classified.indirect.length} 个间接影响任务需回归验证`],
      regressionTests: classified.indirect.map(i => `验证 ${i.taskId} 是否受影响`),
      globalRefreshSuggestions: inferGlobalImpacts(category).map(g => g.suggestedAction),
    },
  };
}

/**
 * 调用 LLM 进行影响分析和实施计划生成
 */
async function callLlmForImpactAnalysis(
  desc: string,
  category: ChangeCategory,
  taskMatches: TaskSemanticMatch[],
  codeResult: UnifiedResult | null,
  kgResult: { entities: GraphEntity[]; relations: GraphRelation[] }
): Promise<AiImpactAnalysis | null> {
  const prompt = buildImpactAnalysisPrompt(desc, category, taskMatches, codeResult, kgResult);

  const response = await callLlm(prompt);
  if (!response) return null;

  return parseImpactAnalysisResponse(response);
}

/**
 * 构建影响分析 Prompt
 */
function buildImpactAnalysisPrompt(
  desc: string,
  category: ChangeCategory,
  taskMatches: TaskSemanticMatch[],
  codeResult: UnifiedResult | null,
  kgResult: { entities: GraphEntity[]; relations: GraphRelation[] }
): string {
  const sections: string[] = [];

  sections.push('你是一位资深软件架构师，正在分析一个需求变更的影响范围。');
  sections.push('');

  // 变更描述
  sections.push('## 变更描述');
  sections.push(desc);
  sections.push('');

  // 意图分类
  sections.push('## 意图分类');
  sections.push(`- 类别: ${category}`);
  sections.push('');

  // 语义检索到的相关任务
  sections.push('## 检索到的相关任务（按相关度排序）');
  for (const m of taskMatches.slice(0, 10)) {
    sections.push(`- ${m.taskId} [相关度 ${(m.score * 100).toFixed(0)}%] — ${m.taskName} [状态: ${m.status}]`);
    sections.push(`  匹配上下文: ${m.matchedContext.slice(0, 100)}`);
  }
  sections.push('');

  // 代码检索结果
  if (codeResult && codeResult.codeSlices.length > 0) {
    sections.push('## 检索到的相关代码');
    for (const slice of codeResult.codeSlices.slice(0, 8)) {
      sections.push(`- ${slice.filePath}`);
      sections.push(`  \`\`\`${slice.body.slice(0, 200)}\`\`\``);
    }
    sections.push('');
  }

  // 知识图谱关联
  if (kgResult.entities.length > 0) {
    sections.push('## 知识图谱关联');
    for (const rel of kgResult.relations.slice(0, 10)) {
      const from = kgResult.entities.find(e => e.id === rel.from);
      const to = kgResult.entities.find(e => e.id === rel.to);
      sections.push(`- ${from?.title || rel.from} --[${rel.type}]--> ${to?.title || rel.to}`);
    }
    sections.push('');
  }

  // 输出要求
  sections.push('## 你的任务');
  sections.push('请分析这个变更的影响范围，输出 JSON 格式。注意：');
  sections.push('1. 只输出 JSON，不要其他内容');
  sections.push('2. 基于证据判断，confidence 必须合理');
  sections.push('3. 如果信息不足，标注 "insufficient_data"');
  sections.push('4. 代码级影响需给出具体文件名和变更建议');
  sections.push('');
  sections.push('```json');
  sections.push('{');
  sections.push('  "thinking": "你的推理过程（中文）",');
  sections.push('  "taskImpacts": {');
  sections.push('    "direct": [{ "taskId": "Task-001", "taskName": "名称", "score": 0.92, "reason": "为什么直接影响", "files": ["REQ.md"] }],');
  sections.push('    "indirect": [{ "taskId": "Task-005", "taskName": "名称", "score": 0.45, "reason": "为什么间接影响" }],');
  sections.push('    "unaffected": []');
  sections.push('  },');
  sections.push('  "codeImpacts": [');
  sections.push('    { "file": "User.java", "currentImplementation": "phone: String(11)", "suggestedChange": "phone: String(20); countryCode: String(5)", "reason": "字段长度需要扩展" }');
  sections.push('  ],');
  sections.push('  "globalImpacts": [');
  sections.push('    { "artifact": "API_CONTRACT.yaml", "reason": "phone 字段格式定义需更新", "suggestedAction": "运行 speccore analyze --global --withCode" }');
  sections.push('  ],');
  sections.push('  "crossIterationImpacts": [],');
  sections.push('  "executionPlan": {');
  sections.push('    "steps": ["更新 Task-001 的 REQ.md", "修改 User.java 字段定义"],');
  sections.push('    "regressionTests": ["验证 Task-005 注册流程"],');
  sections.push('    "globalRefreshSuggestions": ["刷新 API_CONTRACT.yaml"]');
  sections.push('  }');
  sections.push('}');
  sections.push('```');

  return sections.join('\n');
}

// ── LLM 调用 ──

/**
 * 调用 LLM
 * 复制自 ask-llm.ts 的 callLlm，适配本模块的 prompt 格式
 */
async function callLlm(userPrompt: string): Promise<string | null> {
  const systemPrompt = '你是 SpecCore CLI 的资深架构师助手，擅长分析软件变更的影响范围。请基于提供的检索结果和知识图谱，给出精确的影响分析。只输出 JSON，不要解释。';

  // 方案1: OpenAI 兼容接口
  const endpoint = process.env.SPECCORE_LLM_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
  const apiKey = process.env.SPECCORE_LLM_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    logger.debug('未配置 LLM API Key，跳过 LLM 分析');
    return null;
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
        temperature: 0.2,
        max_tokens: 3000,
      }),
    });

    if (!res.ok) {
      logger.debug(`LLM API 返回错误: ${res.status}`);
      return null;
    }

    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (e: any) {
    logger.debug(`LLM 调用失败: ${e.message}`);
    return null;
  }
}

/**
 * 解析 LLM 返回的影响分析 JSON
 */
function parseImpactAnalysisResponse(response: string): AiImpactAnalysis | null {
  try {
    // 尝试直接解析
    const parsed = JSON.parse(response);
    return normalizeAnalysisResult(parsed);
  } catch {
    // 尝试提取 JSON 块
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        return normalizeAnalysisResult(parsed);
      } catch {}
    }
  }
  return null;
}

/**
 * 规范化分析结果（处理 LLM 可能的不一致输出）
 */
function normalizeAnalysisResult(parsed: any): AiImpactAnalysis {
  return {
    thinking: String(parsed.thinking || 'AI 推理过程未提供'),
    taskImpacts: {
      direct: (parsed.taskImpacts?.direct || []).map((t: any) => ({
        taskId: String(t.taskId || t.id || ''),
        taskName: String(t.taskName || t.name || ''),
        status: String(t.status || 'unknown'),
        score: Number(t.score || 0.8),
        matchedContext: String(t.reason || ''),
        files: Array.isArray(t.files) ? t.files : [],
      })),
      indirect: (parsed.taskImpacts?.indirect || []).map((t: any) => ({
        taskId: String(t.taskId || t.id || ''),
        taskName: String(t.taskName || t.name || ''),
        status: String(t.status || 'unknown'),
        score: Number(t.score || 0.5),
        matchedContext: String(t.reason || ''),
        files: Array.isArray(t.files) ? t.files : [],
      })),
      unaffected: (parsed.taskImpacts?.unaffected || []).map((t: any) => ({
        taskId: String(t.taskId || t.id || ''),
        taskName: String(t.taskName || t.name || ''),
        status: String(t.status || 'unknown'),
        score: Number(t.score || 0),
        matchedContext: '',
        files: [],
      })),
    },
    codeImpacts: (parsed.codeImpacts || []).map((c: any) => ({
      file: String(c.file || ''),
      currentImplementation: String(c.currentImplementation || c.current || ''),
      suggestedChange: String(c.suggestedChange || c.suggested || ''),
      reason: String(c.reason || ''),
      platform: c.platform ? String(c.platform) : undefined,
    })),
    globalImpacts: (parsed.globalImpacts || []).map((g: any) => ({
      artifact: String(g.artifact || ''),
      reason: String(g.reason || ''),
      suggestedAction: String(g.suggestedAction || g.action || ''),
    })),
    crossIterationImpacts: (parsed.crossIterationImpacts || []).map((c: any) => ({
      iteration: String(c.iteration || ''),
      taskId: String(c.taskId || ''),
      reason: String(c.reason || ''),
      severity: (c.severity === 'critical' ? 'critical' : 'warning') as 'warning' | 'critical',
    })),
    executionPlan: {
      steps: Array.isArray(parsed.executionPlan?.steps) ? parsed.executionPlan.steps.map(String) : [],
      regressionTests: Array.isArray(parsed.executionPlan?.regressionTests) ? parsed.executionPlan.regressionTests.map(String) : [],
      globalRefreshSuggestions: Array.isArray(parsed.executionPlan?.globalRefreshSuggestions) ? parsed.executionPlan.globalRefreshSuggestions.map(String) : [],
    },
  };
}

// ── 辅助函数 ──

/**
 * 根据变更类别推断全局层影响（规则层，零成本）
 */
function inferGlobalImpacts(category: ChangeCategory): GlobalImpact[] {
  const impacts: GlobalImpact[] = [];

  switch (category) {
    case 'field-change':
      impacts.push({
        artifact: 'API_CONTRACT.yaml',
        reason: '字段类型/长度/格式变更需同步到接口契约',
        suggestedAction: '运行 speccore analyze --global --withCode',
      });
      impacts.push({
        artifact: 'CONSISTENCY_CHECK.md',
        reason: '前后端字段定义需保持一致',
        suggestedAction: '运行 speccore analyze --global --focus consistency',
      });
      break;
    case 'api-change':
      impacts.push({
        artifact: 'API_CONTRACT.yaml',
        reason: '接口 URL/参数/返回值变更',
        suggestedAction: '运行 speccore analyze --global --withCode',
      });
      impacts.push({
        artifact: 'FUNCTION_MAP.md',
        reason: '接口列表变更',
        suggestedAction: '运行 speccore analyze --global',
      });
      break;
    case 'flow-change':
      impacts.push({
        artifact: '各端 TECH.md',
        reason: '流程顺序变更可能影响多端',
        suggestedAction: '检查各端 TECH.md 中的流程描述',
      });
      break;
    case 'ui-change':
      impacts.push({
        artifact: 'COMPONENT_TREE.md',
        reason: 'UI 组件变更',
        suggestedAction: '更新前端组件树文档',
      });
      break;
    case 'logic-change':
      impacts.push({
        artifact: '各端 TEST.md',
        reason: '业务逻辑变更需同步测试用例',
        suggestedAction: '检查各端测试文档',
      });
      break;
    case 'config-change':
      impacts.push({
        artifact: 'ARCHITECTURE.md',
        reason: '配置项变更需记录到架构文档',
        suggestedAction: '更新架构配置说明',
      });
      break;
    case 'feature':
      impacts.push({
        artifact: 'FUNCTION_MAP.md',
        reason: '新增功能单元',
        suggestedAction: '追加新功能单元到 FUNCTION_MAP',
      });
      impacts.push({
        artifact: 'REQUIREMENT.md',
        reason: '新增需求章节',
        suggestedAction: '追加需求描述到 REQUIREMENT.md',
      });
      break;
  }

  return impacts;
}

/**
 * 生成 CHANGE_TODO.md 内容
 */
export function generateChangeTodo(
  changeDesc: string,
  category: ChangeCategory,
  analysis: AiImpactAnalysis,
  changeId?: string
): string {
  const lines: string[] = [];
  const now = new Date().toISOString().split('T')[0];

  lines.push(`# 变更实施清单: ${changeId || 'Change-XXX'}`);
  lines.push('');
  lines.push('## 变更描述');
  lines.push(changeDesc);
  lines.push('');
  lines.push('## 意图分类');
  lines.push(`- 类型: ${analysis.taskImpacts.direct.length > 0 ? 'change' : 'new'}`);
  lines.push(`- 类别: ${category}`);
  lines.push('');

  // 影响分析
  if (analysis.taskImpacts.direct.length > 0) {
    lines.push(`## 直接影响任务（${analysis.taskImpacts.direct.length} 个）`);
    lines.push('');
    lines.push('| 任务 | 相关度 | 需要更新 | 代码需改 | 优先级 |');
    lines.push('| :--- | :--- | :--- | :--- | :--- |');
    for (const t of analysis.taskImpacts.direct) {
      const hasCode = analysis.codeImpacts.some(c => c.file.includes(t.taskId));
      lines.push(`| ${t.taskId} ${t.taskName} | ${(t.score * 100).toFixed(0)}% | 是 | ${hasCode ? '是' : '否'} | P0 |`);
    }
    lines.push('');
  }

  if (analysis.taskImpacts.indirect.length > 0) {
    lines.push(`## 间接影响任务（${analysis.taskImpacts.indirect.length} 个）`);
    lines.push('');
    lines.push('| 任务 | 相关度 | 需要更新 | 代码需改 | 优先级 |');
    lines.push('| :--- | :--- | :--- | :--- | :--- |');
    for (const t of analysis.taskImpacts.indirect) {
      lines.push(`| ${t.taskId} ${t.taskName} | ${(t.score * 100).toFixed(0)}% | 检查 | 否 | P1 |`);
    }
    lines.push('');
  }

  // 全局层刷新项
  if (analysis.globalImpacts.length > 0) {
    lines.push('## 全局层刷新项');
    lines.push('');
    for (const g of analysis.globalImpacts) {
      lines.push(`- [ ] \`${g.artifact}\` — ${g.reason}`);
      lines.push(`  - 建议: ${g.suggestedAction}`);
    }
    lines.push('');
  }

  // 代码级变更项
  if (analysis.codeImpacts.length > 0) {
    lines.push('## 代码级变更项');
    lines.push('');
    lines.push('| 文件 | 当前实现 | AI 建议变更 | 优先级 |');
    lines.push('| :--- | :--- | :--- | :--- |');
    for (const c of analysis.codeImpacts) {
      lines.push(`| \`${c.file}\` | ${c.currentImplementation.slice(0, 40)} | ${c.suggestedChange.slice(0, 60)} | P0 |`);
    }
    lines.push('');
  }

  // 回归验证项
  if (analysis.executionPlan.regressionTests.length > 0) {
    lines.push('## 回归验证项');
    lines.push('');
    for (const test of analysis.executionPlan.regressionTests) {
      lines.push(`- [ ] ${test}`);
    }
    lines.push('');
  }

  // 实施步骤
  if (analysis.executionPlan.steps.length > 0) {
    lines.push('## 实施步骤');
    lines.push('');
    for (let i = 0; i < analysis.executionPlan.steps.length; i++) {
      lines.push(`${i + 1}. ${analysis.executionPlan.steps[i]}`);
    }
    lines.push('');
  }

  lines.push(`---\n*生成时间: ${now} by SpecCore AI Impact Analyzer v6.73.0*`);

  return lines.join('\n');
}
