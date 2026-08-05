/**
 * dev-llm — Dev Pipeline LLM 引导引擎
 * 理解用户对开发流程的选择/跳过/调整意图，返回结构化执行计划
 * 规则引擎为 fallback，LLM 优先
 */

import { logger } from '../utils/logger';

// ============================================================
// 类型定义
// ============================================================

export interface DevPhase {
  name: string;
  key: string;
  icon: string;
  cmd: string;
  done: boolean;
  description: string;
  args: string;
}

export interface DevPipelineState {
  iteration: string;
  phases: DevPhase[];
  currentIdx: number;
  currentPhase: DevPhase;
}

export interface DevActionResult {
  action: 'next' | 'skip-to' | 'start-from' | 'restart' | 'auto-all' | 'jump-to';
  targetPhase: string;
  commands: Array<{ order: number; command: string; args: string; explanation: string }>;
  summary: string;
}

// ============================================================
// 系统 Prompt — Dev Pipeline
// ============================================================

function buildDevSystemPrompt(state: DevPipelineState): string {
  const phaseList = state.phases.map((p, i) => {
    const marker = i === state.currentIdx ? '◀ 当前' : p.done ? '✅ 已完成' : '⏳ 待执行';
    return `  ${i+1}. ${p.icon} ${p.name} (speccore ${p.cmd}) — ${marker}`;
  }).join('\n');

  return `你是 SpecCore CLI 的 Pipeline 引导助手。当前项目状态:

## 期次
${state.iteration || '未设置'}

## Pipeline 阶段
${phaseList}

## 你的任务
分析用户意图，判断他们要做什么，返回 JSON:
{
  "action": "next|skip-to|start-from|restart|auto-all|jump-to",
  "targetPhase": "阶段 key (init/doc/analyze/split/execute/pr/done)",
  "commands": [{"order":1,"command":"命令","args":"参数","explanation":"说明"}],
  "summary": "简短摘要"
}

## Action 说明
- next: 执行当前下一步 → 返回 1 条命令
- skip-to: 跳过中间阶段 / 直接跳到某阶段
- start-from: 从指定阶段开始执行（含该阶段）
- restart: 全部重新开始
- auto-all: 一键自动执行所有未完成阶段
- jump-to: 跳转到特定阶段

## 参数规则
- 有期次时自动加 --iteration=${state.iteration}
- 用户说"跳过分析" → skip-to split
- 用户说"从拆分开始" → start-from split
- 用户说"直接做 PR" → jump-to pr
- 用户说"一键搞定" / "全部自动" → auto-all`;
}

function buildDevUserPrompt(input: string, state: DevPipelineState): string {
  const ctx = state.currentPhase
    ? `当前停在"${state.currentPhase.name}"阶段`
    : '项目未初始化';
  return `用户意图: "${input}"\n上下文: ${ctx}\n\n返回 JSON:`;
}

// ============================================================
// LLM 调用（复用 ask-llm 的三层策略）
// ============================================================

async function callDevLlm(systemPrompt: string, userPrompt: string): Promise<string | null> {
  // 策略1: OpenAI 兼容接口
  const endpoint = process.env.SPECCORE_LLM_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
  const apiKey = process.env.SPECCORE_LLM_KEY || process.env.OPENAI_API_KEY;

  if (apiKey) {
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
          max_tokens: 600,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: any = await res.json();
      return data?.choices?.[0]?.message?.content || null;
    } catch {
      // fall through to Ollama
    }
  }

  // 策略2: Ollama 本地
  try {
    const ollamaRes = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:7b',
        prompt: systemPrompt + '\n\n' + userPrompt,
        stream: false,
        options: { temperature: 0.1, num_predict: 400 },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (ollamaRes.ok) {
      const data: any = await ollamaRes.json();
      return data?.response || null;
    }
  } catch {}

  return null;
}

function parseDevResponse(text: string): DevActionResult | null {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
  }
  return null;
}

// ============================================================
// 规则引擎 Fallback
// ============================================================

export function devRuleEngine(state: DevPipelineState, userInput: string): DevActionResult {
  const lower = userInput.toLowerCase();
  const iterArg = state.iteration ? ` --iteration=${state.iteration}` : '';
  const cur = state.currentPhase;

  // next — 默认
  const nextAction: DevActionResult = {
    action: 'next',
    targetPhase: cur.key,
    commands: [{ order: 1, command: cur.cmd, args: iterArg, explanation: `执行「${cur.name}」阶段` }],
    summary: `开始执行 ${cur.name}`,
  };

  // auto-all
  if (/一键|全部|自动|auto|搞定|all/i.test(lower)) {
    const pending = state.phases.filter(p => !p.done);
    return {
      action: 'auto-all',
      targetPhase: 'auto',
      commands: pending.map((p, i) => ({
        order: i + 1,
        command: p.cmd,
        args: p.args || (iterArg || ''),
        explanation: p.description || p.name,
      })),
      summary: `一键执行全部 ${pending.length} 个未完成阶段`,
    };
  }

  // skip-to / jump-to
  for (const p of state.phases) {
    if (lower.includes(p.key) || lower.includes(p.name.toLowerCase())) {
      const isBefore = state.phases.findIndex(ph => ph.key === p.key) < state.currentIdx;
      if (isBefore) {
        // 已过的阶段，restart from there
        const fromIdx = state.phases.findIndex(ph => ph.key === p.key);
        const cmds = state.phases.slice(fromIdx).map((ph, i) => ({
          order: i + 1, command: ph.cmd, args: ph.args || (iterArg || ''), explanation: ph.description || ph.name,
        }));
        return { action: 'restart', targetPhase: p.key, commands: cmds, summary: `从「${p.name}」重新开始` };
      }
      return {
        action: 'jump-to', targetPhase: p.key,
        commands: [{ order: 1, command: p.cmd, args: p.args || (iterArg || ''), explanation: p.description || p.name }],
        summary: `直接跳转到「${p.name}」`,
      };
    }
  }

  // skip — 跳过当前
  if (/跳过|skip/i.test(lower) && state.currentIdx + 1 < state.phases.length) {
    const next = state.phases[state.currentIdx + 1];
    return {
      action: 'skip-to', targetPhase: next.key,
      commands: [{ order: 1, command: next.cmd, args: next.args || (iterArg || ''), explanation: next.description || next.name }],
      summary: `跳过「${cur.name}」→ ${next.name}`,
    };
  }

  return nextAction;
}

// ============================================================
// 统一入口
// ============================================================

export async function devAiGuide(state: DevPipelineState, userInput: string): Promise<DevActionResult> {
  // ── 第一层: LLM ──
  try {
    const systemPrompt = buildDevSystemPrompt(state);
    const userPrompt = buildDevUserPrompt(userInput, state);
    const raw = await callDevLlm(systemPrompt, userPrompt);
    if (raw) {
      const parsed = parseDevResponse(raw);
      if (parsed && parsed.commands.length > 0) {
        logger.info('🧠 AI 引导: ' + parsed.summary);
        return parsed;
      }
    }
  } catch (e: any) {
    logger.warn('LLM 引导降级: ' + (e.message || e));
  }

  // ── 第二层: 规则引擎 ──
  const result = devRuleEngine(state, userInput);
  logger.info('📐 规则引导: ' + result.summary);
  return result;
}
