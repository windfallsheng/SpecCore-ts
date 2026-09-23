/**
 * AI 交互轨迹记录器（飞行记录仪）
 *
 * 三段接力（CLI 发 Prompt → AI 生成 → --apply 落盘）的可观测性底座：
 * 每个环节都留下结构化物证，出问题时一查便知——
 *   1. prompt-out：发给 AI 的内容原文（含长度/模式/标记），回答「给 AI 的内容是什么」
 *   2. apply-in：AI 回传的原文（解析前，格式错误也留档），回答「AI 回了什么」
 *   3. apply-fail：回传了但没解析出内容，区分「AI 没给」与「给了但被解析丢弃」
 *   4. apply-done：落盘结果（文件清单、字节数），回答「写入有没有问题」
 *
 * 轨迹落盘 .speccore/local/ai-trace/{迭代}/{日期}.jsonl（一行一条），不进 git。
 * v8.3.252+
 */
import { appendFile, ensureDir } from 'fs-extra';
import { join } from 'path';
import { findProjectRoot } from './task-utils';

export type AiTraceEvent = 'prompt-out' | 'apply-in' | 'apply-fail' | 'apply-done';

const TRACE_ROOT = 'ai-trace';
/** 大字段单条上限（防止 prompt/回传原文撑爆磁盘） */
const MAX_FIELD_CHARS = 200_000;

function capField(v: unknown): unknown {
  if (typeof v === 'string' && v.length > MAX_FIELD_CHARS) {
    return { __truncated__: true, head: v.slice(0, MAX_FIELD_CHARS), tail: v.slice(-1000) };
  }
  return v;
}

export async function recordAiTrace(
  iter: string,
  event: AiTraceEvent,
  payload: Record<string, unknown>,
): Promise<string | null> {
  try {
    const root = await findProjectRoot();
    if (!root) return null;
    const dir = join(root, '.speccore', 'local', TRACE_ROOT, iter);
    await ensureDir(dir);
    const day = new Date().toISOString().slice(0, 10);
    const safePayload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) safePayload[k] = capField(v);
    const line = JSON.stringify({ ts: new Date().toISOString(), event, ...safePayload });
    const fp = join(dir, `${day}.jsonl`);
    await appendFile(fp, line + '\n', 'utf-8');
    return fp;
  } catch {
    return null;
  }
}
