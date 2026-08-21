/**
 * code-index — 源码索引命令
 *
 * 用法:
 *   speccore code-index              # 增量更新（只扫变化文件）
 *   speccore code-index --full       # 全量重新扫描
 *   speccore code-index --scope src/commands  # 指定目录
 *   speccore code-index --show       # 只显示当前索引，不更新
 */
import { Command } from 'commander';
import { join } from 'path';
import { readFile, pathExists } from 'fs-extra';
import { watch } from 'fs';
import { buildCodeIndex, loadFullIndex } from '../core/code-scanner';
import { generateMarkdownIndex } from '../core/code-index-markdown';
import { buildCodeKnowledgeGraph, buildCodeKnowledgeGraphIncremental } from '../core/code-graph';
import { logger, Spinner } from '../utils/logger';

export interface CodeIndexOptions {
  full?: boolean;
  scope?: string;
  show?: boolean;
  graph?: boolean;
  incremental?: boolean;
  watch?: boolean;
}

export async function codeIndexCommand(options: CodeIndexOptions): Promise<void> {
  const cachePath = join('.speccore', 'cache', 'code-structure.json');

  // --watch: 监视源码变化自动增量更新图谱（优先级最高）
  if (options.watch) {
    const scope = options.scope || 'src';
    logger.info(`👁️  启动图谱监视模式: ${scope}`);
    logger.info('   按 Ctrl+C 停止');

    // 首次构建（有 --graph 则构建图谱，否则构建代码索引）
    if (options.graph) {
      await buildCodeKnowledgeGraphIncremental({ scope });
    } else {
      await buildCodeIndex(scope, !options.full);
    }

    // 监视变化
    const watcher = watch(scope, { recursive: true }, async (_event, filename) => {
      if (filename && /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(filename)) {
        logger.info(`   📝 文件变化: ${filename}`);
        try {
          if (options.graph) {
            await buildCodeKnowledgeGraphIncremental({ scope });
          } else {
            await buildCodeIndex(scope, true);
          }
          logger.info('   ✅ 增量更新完成');
        } catch (e: any) {
          logger.error(`   ❌ 更新失败: ${e.message}`);
        }
      }
    });

    // 保持进程运行
    await new Promise(() => {});
    watcher.close();
    return;
  }

  // --graph: 构建代码知识图谱
  if (options.graph) {
    if (options.incremental) {
      await buildCodeKnowledgeGraphIncremental({
        scope: options.scope || 'src',
      });
    } else {
      await buildCodeKnowledgeGraph({
        scope: options.scope || 'src',
      });
    }
    return;
  }

  // --show: 只显示当前索引
  if (options.show) {
    if (!(await pathExists(cachePath))) {
      logger.info('索引不存在，请先运行 speccore code-index 生成索引');
      return;
    }
    const index = await loadFullIndex();
    if (!index) {
      logger.error('索引读取失败');
      return;
    }
    printIndexSummary(index);
    return;
  }

  const incremental = !options.full;
  const scope = options.scope;
  const mode = (incremental && await pathExists(cachePath)) ? '增量更新' : '全量扫描';

  const spinner = new Spinner(`${mode}索引`);
  spinner.start();

  try {

    const fileCount = await buildCodeIndex(scope, incremental);
    spinner.stop(`扫描完成: ${fileCount} 个文件`);

    // 加载完整索引生成 Markdown
    const index = await loadFullIndex();
    if (!index) {
      logger.error('索引生成失败');
      return;
    }

    const mdSpinner = new Spinner('生成 Markdown 索引...');
    mdSpinner.start();

    const generated = await generateMarkdownIndex(index);

    mdSpinner.stop(`Markdown 索引已生成`);

    // 输出摘要
    printIndexSummary(index);

    logger.info('');
    logger.info(`📄 生成文件:`);
    for (const f of generated) {
      logger.info(`   ${f}`);
    }
  } catch (err: any) {
    spinner.fail('索引生成失败');
    logger.error(err.message);
  }
}

function printIndexSummary(index: any): void {
  logger.info('');
  logger.info('═══ 代码索引摘要 ═══');
  logger.info(`  文件数: ${index.files.length}`);
  logger.info(`  更新时间: ${new Date(index.updatedAt).toLocaleString('zh-CN')}`);
  logger.info('');

  if (index.endpoints?.length > 0) {
    logger.info('  端识别:');
    for (const ep of index.endpoints) {
      logger.info(`    ${ep.name} (${ep.fileCount} 文件) — ${ep.techStack}`);
    }
    logger.info('');
  }

  if (index.modules?.length > 0) {
    logger.info(`  模块: ${index.modules.length} 个`);
    const top = index.modules.slice(0, 8);
    for (const mod of top) {
      logger.info(`    ${mod.name} (${mod.endpoint}, ${mod.fileCount} 文件)`);
    }
    if (index.modules.length > 8) {
      logger.info(`    ... 及其他 ${index.modules.length - 8} 个模块`);
    }
    logger.info('');
  }

  if (index.correlations?.length > 0) {
    logger.info('  变更联动规律:');
    for (const corr of index.correlations.slice(0, 5)) {
      logger.info(`    ${corr.pattern}`);
    }
    logger.info('');
  }

  if (index.gitStats) {
    logger.info(`  git 统计: 分析了 ${index.gitStats.analyzedCommits} / ${index.gitStats.totalCommits} 次提交`);
    logger.info('');
  }
}

export function registerCodeIndexCommand(program: Command): void {
  program
    .command('code-index')
    .alias('ci')
    .description('扫描源码生成代码索引（多端识别 + 模块分组 + git 联动）')
    .option('--full', '全量重新扫描（默认增量更新）')
    .option('--scope <dirs>', '指定扫描目录（逗号分隔）')
    .option('--graph', '构建代码知识图谱（graph.html + graph.json + GRAPH_REPORT.md）')
    .option('--incremental', '增量更新图谱（只扫变化文件，配合 --graph）')
    .option('--watch', '监视源码变化自动增量更新图谱（配合 --graph）')
    .option('--show', '只显示当前索引摘要，不更新')
    .addHelpText('after', `
\x1b[36m使用场景:\x1b[0m
  \x1b[33m首次使用\x1b[0m        speccore code-index --full
  \x1b[33m日常更新\x1b[0m        speccore code-index (增量，只扫变化文件)
  \x1b[33m查看摘要\x1b[0m        speccore code-index --show
  \x1b[33m构建图谱\x1b[0m        speccore code-index --graph
  \x1b[33m指定范围\x1b[0m        speccore code-index --scope src/commands,src/core

\x1b[36m索引价值:\x1b[0m
  • \x1b[32m多端识别\x1b[0m  自动检测 frontend/backend/mobile/cli/shared
  • \x1b[32m模块分组\x1b[0m  按目录分组，显示核心文件、导出接口、依赖关系
  • \x1b[32mgit 联动\x1b[0m  分析最近 100 次提交，找出高频共同变更的模块
  • \x1b[32m分析加速\x1b[0m  analyze 命令默认使用索引智能匹配相关文件（省 90% token）

\x1b[36m输出文件:\x1b[0m
  .speccore/cache/CODE_INDEX.md        总索引（端识别 + 模块概览 + git 联动）
  .speccore/cache/endpoints/<name>.md  各端详情（模块清单 + 导出 + 依赖）
  .speccore/cache/code-structure.json  JSON 索引（analyze 引擎使用）

\x1b[36m与 analyze 的关系:\x1b[0m
  • analyze 默认读源码（智能匹配，不是全量读）
  • 索引过期时 analyze 会自动重建（全量，1 小时缓存）
  • 手动 code-index 可以提前构建，避免 analyze 时等待
  • --no-source 跳过源码读取，--source-scope 指定扫描目录`)
    .action(codeIndexCommand);
}
