/**
 * trace — REQ → Task → Code 追溯链展示
 *
 * 从需求 ID 出发，展示完整的开发追溯链路
 */

import { pathExists, readdir, readFile } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';

export interface TraceOptions {
  req?: string;
  task?: string;
  full?: boolean;
}

export async function traceCommand(options: TraceOptions): Promise<void> {
  if (options.req) {
    await traceFromReq(options.req);
  } else if (options.task) {
    await traceFromTask(options.task);
  } else if (options.full) {
    await traceFull();
  } else {
    logger.info('Usage:');
    logger.info('  speccore trace --req=REQ-001    # Trace from requirement');
    logger.info('  speccore trace --task=Task-001  # Trace from task');
    logger.info('  speccore trace --full           # Full project trace');
  }
}

async function traceFromReq(reqId: string): Promise<void> {
  logger.info('');
  logger.info(`🔗 Trace: ${reqId}`);
  logger.info('');

  // Find the requirement in INDEX.md
  const indexPath = join(process.cwd(), '.speccore', 'GLOBAL', 'INDEX.md');
  if (!(await pathExists(indexPath))) {
    logger.warn('INDEX.md not found. Run speccore refresh first.');
    return;
  }

  const index = (await readFile(indexPath, 'utf-8')).split('\n');
  const reqLine = index.find((l) => l.includes(reqId));
  if (!reqLine) {
    logger.warn(`Requirement ${reqId} not found in INDEX.md`);
    return;
  }

  printTraceTree(reqId, 0);

  // Search all iterations for tasks linked to this REQ
  const cwd = process.cwd();
  const entries = await readdir(cwd, { withFileTypes: true });
  const iterations = entries.filter((e) => e.isDirectory() && e.name.startsWith('Iteration-'));

  for (const iter of iterations) {
    const tasks = await scanTasks(join(cwd, iter.name));
    for (const task of tasks) {
      const reqPath = join(cwd, iter.name, task, '00-specs', 'REQ.md');
      if (await pathExists(reqPath)) {
        const content = await readFile(reqPath, 'utf-8');
        if (content.includes(reqId)) {
          logger.info(`  └── 📋 ${iter.name}/${task}`);
          printTaskDetails(join(cwd, iter.name, task), '      ');
        }
      }
    }
  }
}

async function traceFromTask(taskId: string): Promise<void> {
  const cwd = process.cwd();
  const entries = await readdir(cwd, { withFileTypes: true });
  const iterations = entries.filter((e) => e.isDirectory() && e.name.startsWith('Iteration-'));

  for (const iter of iterations) {
    const taskDir = join(cwd, iter.name, taskId);
    if (await pathExists(taskDir)) {
      logger.info('');
      logger.info(`🔗 Trace: ${taskId}`);
      logger.info(`  📦 Iteration: ${iter.name}`);
      logger.info('');
      printTraceTree(taskId, 0);
      printTaskDetails(taskDir, '  ');
      return;
    }
  }

  logger.warn(`Task ${taskId} not found`);
}

async function traceFull(): Promise<void> {
  const cwd = process.cwd();
  const indexPath = join(cwd, '.speccore', 'GLOBAL', 'INDEX.md');

  logger.info('');
  logger.info('🔗 Full Project Trace');

  if (await pathExists(indexPath)) {
    const index = (await readFile(indexPath, 'utf-8')).split('\n');
    const reqs = index.filter((l) => l.startsWith('| REQ-'));
    logger.info(`  📊 ${reqs.length} requirements registered`);

    const entries = await readdir(cwd, { withFileTypes: true });
    const iterations = entries.filter((e) => e.isDirectory() && e.name.startsWith('Iteration-'));
    let totalTasks = 0;

    for (const iter of iterations) {
      const tasks = await scanTasks(join(cwd, iter.name));
      totalTasks += tasks.length;
      logger.info(`  📦 ${iter.name}: ${tasks.length} tasks`);
      for (const task of tasks.slice(0, 3)) {
        logger.info(`     └── ${task}`);
      }
      if (tasks.length > 3) {
        logger.info(`     └── ... and ${tasks.length - 3} more`);
      }
    }
    logger.info(`  📋 Total: ${iterations.length} iterations, ${totalTasks} tasks`);
  }
}

async function scanTasks(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && e.name.startsWith('Task-')).map((e) => e.name);
  } catch {
    return [];
  }
}

function printTraceTree(node: string, depth: number): void {
  const indent = '  '.repeat(depth);
  logger.info(`${indent}├── 📝 ${node}`);
}

async function printTaskDetails(taskDir: string, indent: string): Promise<void> {
  // v8.3.121+: 端平铺结构扫描
  const EXCLUDE_DIRS = new Set(['00-specs', '_shared', '99-artifacts', '.meta']);
  try {
    const entries = await readdir(taskDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || EXCLUDE_DIRS.has(e.name)) continue;
      logger.info(`${indent}├── 🔧 ${e.name}:`);
      const platformPath = join(taskDir, e.name);
      const subEntries = await readdir(platformPath, { withFileTypes: true });
      for (const sub of subEntries) {
        if (!sub.isDirectory()) continue;
        const subtaskPath = join(platformPath, sub.name);
        // Show spec files
        for (const f of ['REQ.md', 'TECH.md', 'TASK.md']) {
          if (await pathExists(join(subtaskPath, f))) {
            logger.info(`${indent}│   ├── ${sub.name}/${f}`);
          }
        }
        // Show generated code
        for (const ext of ['.java', '.ts', '.vue', '.tsx']) {
          const codeFiles = await findFiles(subtaskPath, ext);
          for (const codeFile of codeFiles) {
            logger.info(`${indent}│   ├── 💻 ${sub.name}/${codeFile}`);
          }
        }
      }
    }
  } catch { /* 跳过 */ }
}

async function findFiles(dir: string, ext: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true, recursive: true });
    return entries.filter((e: import("fs-extra").Dirent) => e.isFile() && e.name.endsWith(ext)).map((e: any) => e.name);
  } catch {
    return [];
  }
}
