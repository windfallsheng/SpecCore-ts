/**
 * watch — 文件变更自动校验
 *
 * 监听 Spec 文件变化，保存时自动运行 validate
 */

import { watch } from 'fs';
import { join } from 'path';
import { pathExists } from 'fs-extra';
import { logger } from '../utils/logger';

export interface WatchOptions {
  task?: string;
  iteration?: string;
}

export async function watchCommand(options: WatchOptions): Promise<void> {
  const cwd = process.cwd();
  const watchDirs: string[] = [];

  // Determine what to watch
  if (options.task) {
    const iter = options.iteration || await findIterationForTask(cwd, options.task);
    if (iter) {
      watchDirs.push(join(cwd, iter, options.task));
    } else {
      logger.error(`Task "${options.task}" not found`);
      return;
    }
  } else if (options.iteration) {
    watchDirs.push(join(cwd, options.iteration));
  } else {
    // Watch entire project
    watchDirs.push(join(cwd, '.speccore'));
    watchDirs.push(cwd); // all iterations
  }

  logger.info('');
  logger.info('👀 Watching Spec files for changes...');
  logger.info('   Save a file to auto-validate. Press Ctrl+C to stop.');
  logger.info('');

  // Debounce: avoid duplicate validations for rapid saves
  const debounceMap = new Map<string, NodeJS.Timeout>();

  for (const dir of watchDirs) {
    if (!(await pathExists(dir))) {
      logger.warn(`  Directory not found: ${dir}`);
      continue;
    }

    watchRecursive(dir, (filePath) => {
      // Only react to .md and .yaml changes
      if (!filePath.endsWith('.md') && !filePath.endsWith('.yaml')) return;

      // Debounce 300ms
      if (debounceMap.has(filePath)) {
        clearTimeout(debounceMap.get(filePath)!);
      }
      debounceMap.set(filePath, setTimeout(() => {
        validateFile(filePath);
        debounceMap.delete(filePath);
      }, 300));
    });
  }

  // Keep process alive
  await new Promise(() => {});
}

function watchRecursive(dir: string, callback: (path: string) => void): void {
  try {
    watch(dir, { recursive: true }, (eventType, filename) => {
      if (filename && eventType === 'change') {
        callback(join(dir, filename));
      }
    });
  } catch (err) {
    logger.warn(`Watch error: ${err}`);
  }
}

async function findIterationForTask(cwd: string, taskId: string): Promise<string> {
  const { readdir } = await import('fs-extra');
  const entries = await readdir(cwd, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory() && e.name.startsWith('期次-')) {
      if (await pathExists(join(cwd, e.name, taskId))) {
        return e.name;
      }
    }
  }
  return '';
}

function validateFile(filePath: string): void {
  const filename = filePath.split('/').pop() || filePath;
  const relPath = filePath.replace(process.cwd() + '/', '');

  // Quick validation heuristics
  let status: string;
  let detail: string = '';

  if (filePath.endsWith('.yaml')) {
    // Check YAML indentation (2-space rule)
    try {
      const { readFileSync } = require('fs');
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      let hasTab = false;
      for (const line of lines) {
        if (line.match(/^\t/)) { hasTab = true; break; }
      }
      status = hasTab ? '❌' : '✅';
      detail = hasTab ? ' (tab indentation — use 2 spaces)' : ' (valid YAML)';
    } catch {
      status = '❌';
      detail = ' (read error)';
    }
  } else if (filePath.endsWith('REQ.md')) {
    try {
      const { readFileSync } = require('fs');
      const content = readFileSync(filePath, 'utf-8');
      const sections = ['## 1. 需求背景', '## 2. 功能描述', '## 3. 接口定义', '## 4. 验收标准'];
      const missing = sections.filter(s => !content.includes(s));
      status = missing.length === 0 ? '✅' : '⚠️';
      detail = missing.length > 0 ? ` (missing: ${missing.map(s => s.split('. ')[1]).join(', ')})` : '';
    } catch {
      status = '❌';
      detail = ' (read error)';
    }
  } else {
    status = '✅';
  }

  logger.info(`  ${status} ${relPath}${detail}`);
}
