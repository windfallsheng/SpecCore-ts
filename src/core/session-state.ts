/**
 * 会话状态持久化 — 协作式命令的断点续传
 */
import { ensureDir, readJson, writeJson, pathExists, remove } from 'fs-extra';
import { logger } from '../utils/logger';

const SESSION_PATH = '.speccore/local/sessions.json';

/** 单个命令的会话状态 */
export interface CommandSession {
  /** 命令名 */
  command: string;
  /** 会话 ID */
  sessionId: string;
  /** 迭代 */
  iteration: string;
  /** Task ID（如果有） */
  taskId?: string;
  /** 当前阶段 */
  phase: string;
  /** 用户已回答的选项 */
  answers: Record<string, string>;
  /** 创建时间 */
  createdAt: string;
  /** 最后更新时间 */
  updatedAt: string;
}

/** 全部会话存储 */
interface SessionStore {
  sessions: CommandSession[];
}

async function loadStore(): Promise<SessionStore> {
  if (!(await pathExists(SESSION_PATH))) return { sessions: [] };
  return readJson(SESSION_PATH);
}

async function saveStore(store: SessionStore): Promise<void> {
  await ensureDir('.speccore/local');
  await writeJson(SESSION_PATH, store, { spaces: 2 });
}

/** 保存一个命令的会话状态 */
export async function saveSession(session: Omit<CommandSession, 'createdAt' | 'updatedAt'>): Promise<void> {
  const store = await loadStore();
  const now = new Date().toISOString();
  const idx = store.sessions.findIndex(s => s.command === session.command && s.iteration === session.iteration);
  if (idx >= 0) {
    store.sessions[idx] = { ...store.sessions[idx], ...session, updatedAt: now };
  } else {
    store.sessions.push({ ...session, createdAt: now, updatedAt: now });
  }
  await saveStore(store);
}

/** 检测是否有未完成的会话 */
export async function checkPendingSession(command: string, iteration: string): Promise<CommandSession | null> {
  const store = await loadStore();
  const session = store.sessions.find(s => s.command === command && s.iteration === iteration);
  return session || null;
}

/** 完成/清除会话 */
export async function clearSession(command: string, iteration: string): Promise<void> {
  const store = await loadStore();
  store.sessions = store.sessions.filter(s => !(s.command === command && s.iteration === iteration));
  await saveStore(store);
}

/** 列出所有未完成的会话 */
export async function listPendingSessions(): Promise<CommandSession[]> {
  const store = await loadStore();
  return store.sessions;
}

/** 恢复交互 — 检测未完成会话并提示 */
export async function tryResume(
  command: string, 
  iteration: string
): Promise<{ resumed: boolean; answers?: Record<string, string> }> {
  const session = await checkPendingSession(command, iteration);
  if (!session) return { resumed: false };

  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(`${q} `, a => r(a.trim())));

  logger.info(`\n⚠️ 检测到未完成的 ${command} 会话 (${session.phase})`);
  const ans = await ask(`是否继续？ [y]恢复 [n]重新开始: `);
  rl.close();

  if (ans === 'y') {
    logger.info(`恢复 ${command} 会话...`);
    return { resumed: true, answers: session.answers };
  }
  
  await clearSession(command, iteration);
  return { resumed: false };
}
