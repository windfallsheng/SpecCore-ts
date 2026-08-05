/**
 * ask-host-ai — 宿主 AI 层（WorkBuddy / TRAE / Qoder）
 * 通过文件协议与用户当前使用的 AI 工具通信
 * 
 * 协议:
 *   1. CLI 写入 ~/.speccore/.ai-request.json
 *   2. 宿主 AI 检测文件变更，读取后处理
 *   3. 宿主 AI 写入 ~/.speccore/.ai-response.json
 *   4. CLI 轮询读取响应（最多等待 15 秒）
 */

import { writeFile, readFile, pathExists, unlink } from 'fs-extra';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from '../utils/logger';

// ============================================================
// 协议定义
// ============================================================

interface AiRequest {
  id: string;
  type: 'ask' | 'dev' | 'welcome';
  input: string;
  context: Record<string, any>;
  timestamp: number;
}

interface AiResponse {
  id: string;
  result: any;
  error?: string;
  timestamp: number;
}

const REQUEST_FILE = join(homedir(), '.speccore', '.ai-request.json');
const RESPONSE_FILE = join(homedir(), '.speccore', '.ai-response.json');
const POLL_INTERVAL = 300;  // 300ms
const MAX_WAIT = 15000;      // 15s timeout

// ============================================================
// 宿主 AI 检测
// ============================================================

/**
 * 检测当前运行环境中的 AI 工具
 */
export type HostAiTool = 'workbuddy' | 'trae' | 'qoder' | 'none';

export function detectHostAi(): HostAiTool {
  // WorkBuddy: 检查会话文件
  if (process.env.WORKBUDDY_SESSION || process.env.CLAUDE_CODE_SESSION) {
    return 'workbuddy';
  }
  // TRAE
  if (process.env.TRAE_SESSION || process.env.TENCENT_AI_CODING) {
    return 'trae';
  }
  // Qoder: 检查 .qoder 目录
  const { pathExistsSync } = require('fs-extra');
  if (pathExistsSync(join(process.cwd(), '.qoder'))) {
    return 'qoder';
  }
  return 'none';
}

// ============================================================
// 文件协议通信
// ============================================================

/**
 * 通过文件协议发送请求给宿主 AI
 * 
 * 宿主 AI（WorkBuddy 等）需要设置文件监听:
 *   监控 ~/.speccore/.ai-request.json 的变更
 *   读取 → 用 AI 处理 → 写入 ~/.speccore/.ai-response.json
 */
export async function askHostAi(
  type: 'ask' | 'dev' | 'welcome',
  input: string,
  context: Record<string, any> = {}
): Promise<any | null> {
  const tool = detectHostAi();
  if (tool === 'none') return null;

  const id = `${type}-${Date.now()}`;
  const request: AiRequest = { id, type, input, context, timestamp: Date.now() };

  try {
    // 1. 清理旧文件
    try { await unlink(REQUEST_FILE); } catch {}
    try { await unlink(RESPONSE_FILE); } catch {}

    // 2. 写入请求
    await writeFile(REQUEST_FILE, JSON.stringify(request, null, 2));

    // 3. 轮询等待响应
    const startTime = Date.now();
    while (Date.now() - startTime < MAX_WAIT) {
      await sleep(POLL_INTERVAL);

      if (await pathExists(RESPONSE_FILE)) {
        const raw = await readFile(RESPONSE_FILE, 'utf-8');
        try {
          const response: AiResponse = JSON.parse(raw);
          if (response.id === id) {
            logger.info(`✅ ${tool.toUpperCase()} AI 响应成功`);
            // 清理
            try { await unlink(REQUEST_FILE); } catch {}
            try { await unlink(RESPONSE_FILE); } catch {}
            return response.result;
          }
        } catch {
          // JSON 可能还没写完，继续等待
        }
      }
    }

    logger.warn(`⏱ ${tool.toUpperCase()} AI 响应超时 (${MAX_WAIT}ms)`);
  } catch (e: any) {
    logger.warn(`${tool} AI 通信失败: ${e.message}`);
  }

  // 清理残留文件
  try { await unlink(REQUEST_FILE); } catch {}
  try { await unlink(RESPONSE_FILE); } catch {}

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// WorkBuddy 专有 — 利用当前对话上下文
// ============================================================

/**
 * WorkBuddy 环境下的特殊处理:
 * 通过 stdout 输出特殊标记，让 WorkBuddy agent 识别并响应
 * 
 * 标记格式: <<SPECCORE_ASK>>...<<END_SPECCORE_ASK>>
 * WorkBuddy agent 检测到后，用其 AI 能力处理并输出结果
 */
export function emitWorkBuddySignal(type: string, input: string, context: Record<string, any>): void {
  const payload = JSON.stringify({ type, input, context, timestamp: Date.now() });
  console.log(`\n<<SPECCORE_AI_REQUEST>>${payload}<<END_SPECCORE_AI_REQUEST>>\n`);
}

// ============================================================
// 统一入口
// ============================================================

export async function tryHostAi(
  type: 'ask' | 'dev' | 'welcome', 
  input: string, 
  context: Record<string, any> = {}
): Promise<any | null> {
  // 先检测
  const tool = detectHostAi();
  if (tool === 'none') return null;
  
  logger.info(`🤖 检测到 ${tool.toUpperCase()} 环境，尝试宿主 AI 增强...`);

  // WorkBuddy: 两种方式
  if (tool === 'workbuddy') {
    // 方式1: 文件协议（agent 需要配置监听）
    const fileResult = await askHostAi(type, input, context);
    if (fileResult) return fileResult;

    // 方式2: stdout 标记（agent 从输出流捕获）
    // 注: 仅在非 TTY 模式下有效（AI 调用模式）
    if (!process.stdout.isTTY) {
      emitWorkBuddySignal(type, input, context);
    }
  }

  // TRAE/Qoder: 仅文件协议
  if (tool === 'trae' || tool === 'qoder') {
    return askHostAi(type, input, context);
  }

  return null;
}
