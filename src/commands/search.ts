/**
 * search — 跨 Spec 文件搜索
 */

import { pathExists, readFile, readdir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { t } from '../i18n/t';

export interface SearchOptions {
  query: string;
  task?: string;
  iteration?: string;
}

interface SearchResult {
  file: string;
  line: number;
  content: string;
}

export async function searchCommand(options: SearchOptions): Promise<void> {
  if (!options.query) {
    logger.error('Usage: speccore search <keyword> [--task=<id>] [--iteration=<name>]');
    return;
  }

  const cwd = process.cwd();
  const keyword = options.query.toLowerCase();
  const results: SearchResult[] = [];

  // 1. Search in task files
  if (options.task || options.iteration) {
    await searchInIterationOrTask(cwd, keyword, results, options);
  } else {
    // Search everything
    await searchInDir(join(cwd, '.speccore'), keyword, results);
    await searchAllIterations(cwd, keyword, results);
  }

  // 2. Output
  logger.info('');
  logger.info(t('cmd.search.result', '🔍 搜索: "{query}" — {count} 个匹配', { query: options.query, count: results.length }));
  logger.info('');

  if (results.length === 0) {
    logger.info('  ' + t('cmd.search.no_match', '暂无匹配结果。'));
    return;
  }

  for (const r of results.slice(0, 30)) {
    const snippet = r.content.length > 80 ? r.content.slice(0, 80) + '...' : r.content;
    logger.info(`  ${r.file}:${r.line}  ${snippet}`);
  }

  if (results.length > 30) {
    logger.info(`  ... 还有 ${results.length - 30} 个结果（超过显示上限）`);
  }
}

async function searchAllIterations(cwd: string, keyword: string, results: SearchResult[]): Promise<void> {
  const entries = await readdir(cwd, { withFileTypes: true });
  const iterations = entries.filter((e) => e.isDirectory() && e.name.startsWith('期次-'));

  for (const iter of iterations) {
    await searchInDir(join(cwd, iter.name), keyword, results);
  }
}

async function searchInIterationOrTask(cwd: string, keyword: string, results: SearchResult[], options: SearchOptions): Promise<void> {
  if (options.task) {
    const entries = await readdir(cwd, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && e.name.startsWith('期次-')) {
        const taskDir = join(cwd, e.name, options.task);
        if (await pathExists(taskDir)) {
          await searchInDir(taskDir, keyword, results);
        }
      }
    }
  } else if (options.iteration) {
    await searchInDir(join(cwd, options.iteration), keyword, results);
  }
}

async function searchInDir(dir: string, keyword: string, results: SearchResult[]): Promise<void> {
  if (!(await pathExists(dir))) return;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const fullPath = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'trash' || e.name === 'archived') continue;
      await searchInDir(fullPath, keyword, results);
    } else if (e.name.endsWith('.md') || e.name.endsWith('.yaml') || e.name.endsWith('.json')) {
      try {
        const content = await readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(keyword)) {
            results.push({
              file: fullPath.replace(process.cwd() + '/', ''),
              line: i + 1,
              content: lines[i].trim(),
            });
          }
        }
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== "ENOENT") logger.warn(`Search skip: encoding error in ${fullPath}`);
      }
    }
  }
}
