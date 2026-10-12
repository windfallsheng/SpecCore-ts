/**
 * refresh-scheduler.ts — 知识底座统一刷新调度
 *
 * 收拢三类刷新对象（RAG 索引 / 知识图谱 / 代码索引）到统一入口，
 * 提供 stale 判定（过期才刷）+ force（强制全量）+ 按 scope 分文件。
 *
 * 刷新对象：
 *   RAG 索引    — task→rag-index.json / iteration→rag-index-{iter}.json / global→rag-index-global.json
 *   知识图谱    — knowledge-graph.json（比较 generated 时间 vs 迭代文件 mtime）
 *   代码索引    — .speccore/cache/code-structure.json（mtime 精确判断）
 *
 * 调用时机：分析/变更/检索关键命令前、sync 后；可独立作为 hook 入口。
 *
 * v8.3.184+
 */

import { join } from 'path';
import { pathExists } from 'fs-extra';
import { logger } from '../utils/logger';
import { getProjectRoot } from '../utils/task-utils';
import {
  checkRagIndexFreshness,
  refreshRagIndex,
  indexDirectoryDocuments,
} from './rag-engine';
import {
  refreshKnowledgeGraph,
  isGraphStale,
} from './knowledge-graph';
import {
  buildCodeIndex,
  isIndexStale,
  resolveIterationScope,
} from './code-scanner';

export interface RefreshTargets {
  rag?: boolean;
  graph?: boolean;
  codeIndex?: boolean;
}

export interface RefreshOptions {
  cwd?: string;
  iteration?: string;
  scope?: 'global' | 'iteration' | 'task';
  taskId?: string;
  targets?: RefreshTargets; // 缺省全刷
  force?: boolean;          // 强制全量（忽略 stale 判断）
  silent?: boolean;         // 静默（不输出 info 日志）
}

export interface RefreshReport {
  rag: { refreshed: boolean; changes: number };
  graph: { refreshed: boolean; wasStale: boolean };
  codeIndex: { refreshed: boolean; files: number };
  totalRefreshed: number;
}

/**
 * 统一刷新知识底座（RAG + 知识图谱 + 代码索引）
 * 返回每类的刷新状态，供调用方决定后续动作。
 */
export async function refreshKnowledgeBase(options: RefreshOptions = {}): Promise<RefreshReport> {
  const cwd = options.cwd || process.cwd();
  const targets = options.targets || { rag: true, graph: true, codeIndex: true };
  const silent = options.silent === true;
  const info = (msg: string) => { if (!silent) logger.info(msg); };

  const report: RefreshReport = {
    rag: { refreshed: false, changes: 0 },
    graph: { refreshed: false, wasStale: false },
    codeIndex: { refreshed: false, files: 0 },
    totalRefreshed: 0,
  };

  // ── 1. RAG 索引（按 scope 分文件）──
  if (targets.rag) {
    try {
      const r = await refreshRagByScope(cwd, options);
      report.rag = r;
      if (r.refreshed) report.totalRefreshed++;
    } catch (e) {
      logger.debug('RAG 索引刷新失败（非关键）:', e);
    }
  }

  // ── 2. 知识图谱 ──
  if (targets.graph) {
    try {
      const stale = options.force ? true : await isGraphStale(cwd, options.iteration);
      if (stale || options.force) {
        info('   🔄 刷新知识图谱...');
        await refreshKnowledgeGraph(cwd, options.iteration);
        report.graph = { refreshed: true, wasStale: stale };
        report.totalRefreshed++;
        info('   ✅ 知识图谱已刷新');
      } else {
        report.graph = { refreshed: false, wasStale: false };
      }
    } catch (e) {
      logger.debug('知识图谱刷新失败（非关键）:', e);
    }
  }

  // ── 3. 代码索引 ──
  if (targets.codeIndex) {
    try {
      const codeIndexScope = await resolveIterationScope(options.iteration);
      const stale = options.force ? true : await isIndexStale(codeIndexScope);
      if (stale || options.force) {
        info('   🔄 刷新代码索引...');
        const files = await buildCodeIndex(codeIndexScope, true);
        report.codeIndex = { refreshed: true, files };
        report.totalRefreshed++;
        info('   ✅ 代码索引已刷新');
      } else {
        report.codeIndex = { refreshed: false, files: 0 };
      }
    } catch (e) {
      logger.debug('代码索引刷新失败（非关键）:', e);
    }
  }

  return report;
}

/** RAG 按 scope 分文件刷新（复用 runAnalysis 的既有策略） */
async function refreshRagByScope(
  cwd: string,
  options: RefreshOptions,
): Promise<{ refreshed: boolean; changes: number }> {
  const { iteration, scope, taskId } = options;

  if (scope === 'task' && taskId && iteration) {
    const taskDir = join(getProjectRoot(), `Iteration-${iteration}`, '030-tasks', taskId);
    if (await pathExists(taskDir)) {
      const { staleFiles, newFiles } = await checkRagIndexFreshness(cwd);
      await refreshRagIndex(cwd, taskDir, iteration);
      return { refreshed: true, changes: staleFiles.length + newFiles.length };
    }
  } else if (scope === 'iteration' && iteration) {
    const specsDir = join(getProjectRoot(), `Iteration-${iteration}`, '020-specs');
    const reqDir = join(getProjectRoot(), `Iteration-${iteration}`, '010-requirements');
    const dirs: string[] = [];
    if (await pathExists(specsDir)) dirs.push(specsDir);
    if (await pathExists(reqDir)) dirs.push(reqDir);
    if (dirs.length > 0) {
      const ragScope = `${iteration}_iteration_all`;
      const fileName = `rag-index-${iteration}.json`;
      await indexDirectoryDocuments(cwd, dirs, ragScope, fileName);
      return { refreshed: true, changes: dirs.length };
    }
  } else if (scope === 'global') {
    const globalDir = join(cwd, '.speccore', 'GLOBAL');
    const fallbackDir = join(cwd, '.speccore');
    const targetDir = await pathExists(globalDir) ? globalDir : fallbackDir;
    const dirs: string[] = [targetDir];
    const rulesDir = join(cwd, '.speccore', 'RULES');
    const skillsDir = join(cwd, '.speccore', 'SKILLS');
    const patternsDir = join(cwd, '.speccore', 'PATTERNS');
    if (await pathExists(rulesDir)) dirs.push(rulesDir);
    if (await pathExists(skillsDir)) dirs.push(skillsDir);
    if (await pathExists(patternsDir)) dirs.push(patternsDir);
    await indexDirectoryDocuments(cwd, dirs, 'GLOBAL_all_global_all', 'rag-index-global.json');
    return { refreshed: true, changes: dirs.length };
  }

  return { refreshed: false, changes: 0 };
}
