/**
 * refresh — 统一刷新所有检索层
 *
 * 用法:
 *   speccore refresh              # 刷新所有检索层
 *   speccore refresh --code       # 只刷新代码索引
 *   speccore refresh --rag        # 只刷新文档 RAG
 *   speccore refresh --graph      # 只刷新知识图谱
 *   speccore refresh --task Task-001  # 指定任务
 */

import { Command } from 'commander';
import { join } from 'path';
import { pathExists } from 'fs-extra';
import { logger, Spinner } from '../utils/logger';
import { buildCodeIndex } from '../core/code-scanner';
import { refreshRagIndex, checkRagIndexFreshness, loadRagIndex } from '../core/rag-engine';
import { refreshKnowledgeGraph, loadKnowledgeGraph } from '../core/knowledge-graph';
import { getDefaultIteration } from '../core/context';

export interface RefreshOptions {
  code?: boolean;
  rag?: boolean;
  graph?: boolean;
  task?: string;
  iteration?: string;
}

export async function refreshCommand(options: RefreshOptions): Promise<void> {
  const cwd = process.cwd();

  // 如果没指定任何类型，默认刷新全部
  const refreshAll = !options.code && !options.rag && !options.graph;
  const refreshCode = refreshAll || options.code;
  const refreshRagFlag = refreshAll || options.rag;
  const refreshGraph = refreshAll || options.graph;

  // 确定任务和迭代
  let iteration = options.iteration || await getDefaultIteration(cwd);
  let taskDir = '';
  if (options.task && iteration) {
    taskDir = join(`Iteration-${iteration}`, '030-tasks', options.task);
  }

  logger.info('═══ 统一刷新检索层 ═══');
  logger.info(`  迭代: ${iteration || '未指定'}`);
  logger.info(`  任务: ${options.task || '自动推断'}`);
  logger.info(`  刷新项: ${[
    refreshCode ? '代码索引' : '',
    refreshRagFlag ? '文档RAG' : '',
    refreshGraph ? '知识图谱' : '',
  ].filter(Boolean).join(' + ')}`);
  logger.info('');

  const results: { name: string; status: 'success' | 'skip' | 'fail'; detail: string }[] = [];

  // ── 1. 刷新代码索引 ──
  if (refreshCode) {
    const spinner = new Spinner('刷新代码索引...');
    spinner.start();
    try {
      const fileCount = await buildCodeIndex(undefined, true);
      spinner.stop('代码索引刷新完成');
      results.push({ name: '代码索引', status: 'success', detail: `${fileCount} 个文件` });
    } catch (err: any) {
      spinner.fail('代码索引刷新失败');
      results.push({ name: '代码索引', status: 'fail', detail: err.message });
    }
  }

  // ── 2. 刷新文档 RAG ──
  if (refreshRagFlag) {
    const spinner = new Spinner('刷新文档 RAG...');
    spinner.start();
    try {
      if (taskDir && await pathExists(taskDir)) {
        const { staleFiles } = await checkRagIndexFreshness(cwd);
        await refreshRagIndex(cwd, taskDir, iteration);
        if (staleFiles.length > 0) {
          spinner.stop(`文档 RAG 增量刷新完成 (${staleFiles.length} 个文件更新)`);
          results.push({ name: '文档 RAG', status: 'success', detail: `${staleFiles.length} 个文件更新` });
        } else {
          spinner.stop('文档 RAG 已是最新');
          results.push({ name: '文档 RAG', status: 'skip', detail: '已是最新' });
        }
      } else {
        // 尝试从现有 RAG 索引推断任务目录
        const existingRag = await loadRagIndex(cwd);
        if (existingRag) {
          const scopeParts = existingRag.scope.split('_');
          if (scopeParts.length >= 2) {
            const inferredIter = scopeParts[0];
            const inferredTaskDir = scopeParts[1].replace(/_/g, '/');
            const fullTaskDir = join(cwd, `Iteration-${inferredIter}`, inferredTaskDir);
            if (await pathExists(fullTaskDir)) {
              const { staleFiles } = await checkRagIndexFreshness(cwd);
              await refreshRagIndex(cwd, fullTaskDir, inferredIter);
              if (staleFiles.length > 0) {
                spinner.stop(`文档 RAG 增量刷新完成 (${staleFiles.length} 个文件更新)`);
                results.push({ name: '文档 RAG', status: 'success', detail: `${staleFiles.length} 个文件更新` });
              } else {
                spinner.stop('文档 RAG 已是最新');
                results.push({ name: '文档 RAG', status: 'skip', detail: '已是最新' });
              }
            } else {
              spinner.stop('未找到任务目录，跳过 RAG 刷新');
              results.push({ name: '文档 RAG', status: 'skip', detail: '未找到任务目录' });
            }
          } else {
            spinner.stop('未找到任务目录，跳过 RAG 刷新');
            results.push({ name: '文档 RAG', status: 'skip', detail: '未找到任务目录' });
          }
        } else {
          spinner.stop('未找到 RAG 索引，跳过');
          results.push({ name: '文档 RAG', status: 'skip', detail: '无索引' });
        }
      }
    } catch (err: any) {
      spinner.fail('文档 RAG 刷新失败');
      results.push({ name: '文档 RAG', status: 'fail', detail: err.message });
    }
  }

  // ── 3. 刷新知识图谱 ──
  if (refreshGraph) {
    const spinner = new Spinner('刷新知识图谱...');
    spinner.start();
    try {
      const graph = await refreshKnowledgeGraph(cwd, iteration);
      if (graph) {
        spinner.stop('知识图谱刷新完成');
        results.push({
          name: '知识图谱',
          status: 'success',
          detail: `${Object.keys(graph.entities).length} 实体 / ${graph.relations.length} 关系`,
        });
      } else {
        spinner.stop('知识图谱无数据');
        results.push({ name: '知识图谱', status: 'skip', detail: '无数据' });
      }
    } catch (err: any) {
      spinner.fail('知识图谱刷新失败');
      results.push({ name: '知识图谱', status: 'fail', detail: err.message });
    }
  }

  // ── 汇总 ──
  logger.info('');
  logger.info('═══ 刷新结果 ═══');
  for (const r of results) {
    const icon = r.status === 'success' ? '✅' : r.status === 'skip' ? '⏭️' : '❌';
    logger.info(`  ${icon} ${r.name}: ${r.detail}`);
  }

  const successCount = results.filter(r => r.status === 'success').length;
  const failCount = results.filter(r => r.status === 'fail').length;

  logger.info('');
  if (failCount === 0) {
    logger.success(`✅ 全部刷新完成（${successCount} 项成功）`);
  } else {
    logger.warn(`⚠️ 刷新完成（${successCount} 成功, ${failCount} 失败）`);
  }
}

export function registerRefreshCommand(program: Command): void {
  program
    .command('refresh')
    .alias('rf')
    .description('统一刷新所有检索层（代码索引 + 文档 RAG + 知识图谱）')
    .option('--code', '只刷新代码索引')
    .option('--rag', '只刷新文档 RAG')
    .option('--graph', '只刷新知识图谱')
    .option('-t, --task <task>', '指定任务（如 Task-001）')
    .option('-i, --iteration <iteration>', '指定迭代（默认当前迭代）')
    .addHelpText('after', `
\x1b[36m使用场景:\x1b[0m
  \x1b[33m刷新全部\x1b[0m        speccore refresh
  \x1b[33m只刷代码\x1b[0m        speccore refresh --code
  \x1b[33m只刷文档\x1b[0m        speccore refresh --rag --task Task-001
  \x1b[33m只刷图谱\x1b[0m        speccore refresh --graph

\x1b[36m何时使用:\x1b[0m
  • 你手动修改了源码 → refresh --code
  • 你手动修改了 TECH.md/REQ.md → refresh --rag
  • 你添加了新任务/需求 → refresh --graph
  • 不确定改了什么 → refresh（全部刷新）

\x1b[36m各检索层说明:\x1b[0m
  • 代码索引: .speccore/cache/code-structure.json（findRelevantCode 使用）
  • 文档 RAG: .speccore/cache/rag-index.json（unifiedSearch 使用）
  • 知识图谱: .speccore/cache/knowledge-graph.json（任务关联链）`)
    .action(refreshCommand);
}
