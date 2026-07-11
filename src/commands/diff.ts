/**
 * diff — 对比两个期次或基线的差异
 */

import { pathExists, readdir, readFile } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';

export interface DiffOptions {
  source: string;
  target: string;
  format?: string;
}

interface DiffResult {
  added: string[];
  removed: string[];
  changed: Array<{ task: string; status: string }>;
}

export async function diffCommand(options: DiffOptions): Promise<void> {
  if (!options.source || !options.target) {
    logger.error('Usage: speccore diff --source=<a> --target=<b>');
    return;
  }

  logger.info(`Diff: ${options.source} → ${options.target}`);
  logger.info('');

  // Compare as iterations
  const srcExists = await pathExists(join(process.cwd(), options.source));
  const tgtExists = await pathExists(join(process.cwd(), options.target));

  if (srcExists && tgtExists) {
    await diffIterations(options.source, options.target);
    return;
  }

  // Compare as baselines
  await diffBaselines(options.source, options.target);
}

async function diffIterations(src: string, tgt: string): Promise<void> {
  const srcDir = join(process.cwd(), src);
  const tgtDir = join(process.cwd(), tgt);

  const srcTasks = await scanTasks(srcDir);
  const tgtTasks = await scanTasks(tgtDir);

  const added = tgtTasks.filter((t) => !srcTasks.includes(t));
  const removed = srcTasks.filter((t) => !tgtTasks.includes(t));

  logger.info('📊 Iteration Comparison:');
  logger.info('');
  logger.info(`  Source: ${src} (${srcTasks.length} tasks)`);
  logger.info(`  Target: ${tgt} (${tgtTasks.length} tasks)`);
  logger.info('');

  if (added.length > 0) {
    logger.info(`  ✅ Added (${added.length}):`);
    for (const t of added) logger.info(`     + ${t}`);
    logger.info('');
  }
  if (removed.length > 0) {
    logger.info(`  ❌ Removed (${removed.length}):`);
    for (const t of removed) logger.info(`     - ${t}`);
    logger.info('');
  }
  if (added.length === 0 && removed.length === 0) {
    logger.info('  No differences found.');
  }

  // Deep compare common tasks
  const common = srcTasks.filter((t) => !removed.includes(t) && !added.includes(t));
  for (const task of common.slice(0, 5)) {
    const srcTask = join(srcDir, task, 'backend', 'TASK.md');
    const tgtTask = join(tgtDir, task, 'backend', 'TASK.md');

    const srcExists = await pathExists(srcTask);
    const tgtExists = await pathExists(tgtTask);
    if (srcExists && tgtExists) {
      const sContent = await readFile(srcTask, 'utf-8');
      const tContent = await readFile(tgtTask, 'utf-8');
      const sStatus = extractStatus(sContent);
      const tStatus = extractStatus(tContent);
      if (sStatus !== tStatus) {
        logger.info(`  🔄 ${task}: ${sStatus} → ${tStatus}`);
      }
    }
  }
}

async function diffBaselines(src: string, tgt: string): Promise<void> {
  const baseDir = join(process.cwd(), '.speccore', 'GLOBAL', 'BASELINES');
  const srcPath = join(baseDir, src);
  const tgtPath = join(baseDir, tgt);

  if (!(await pathExists(srcPath)) || !(await pathExists(tgtPath))) {
    logger.error('Baseline not found. Available:');
    const { readdir: rd } = await import('fs-extra');
    if (await pathExists(baseDir)) {
      const entries = await rd(baseDir);
      for (const e of entries) logger.info(`  ${e}`);
    }
    return;
  }

  logger.info('📊 Baseline Comparison:');
  logger.info(`  ${src} ↔ ${tgt}`);
  // Simple line-by-line diff of INDEX snapshots
  const sIdx = join(srcPath, 'INDEX.md');
  const tIdx = join(tgtPath, 'INDEX.md');
  if (await pathExists(sIdx) && await pathExists(tIdx)) {
    const sLines = (await readFile(sIdx, 'utf-8')).split('\n');
    const tLines = (await readFile(tIdx, 'utf-8')).split('\n');
    const added = tLines.filter((l) => l.startsWith('| REQ-') && !sLines.includes(l));
    const removed = sLines.filter((l) => l.startsWith('| REQ-') && !tLines.includes(l));
    logger.info(`  Added: ${added.length}, Removed: ${removed.length}`);
  }
}

async function scanTasks(dir: string): Promise<string[]> {
  try {
    if (!(await pathExists(dir))) return [];
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && e.name.startsWith('Task-')).map((e) => e.name);
  } catch {
    return [];
  }
}

function extractStatus(md: string): string {
  const match = md.match(/状态:\s*(.+)/);
  return match ? match[1].trim() : 'unknown';
}
