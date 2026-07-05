/**
 * global-status - 查看全量层状态命令
 * 基于 GLOBAL/INDEX.md 展示所有项目、需求、技术架构的状态
 */

import { logger, Spinner, formatTable } from '../utils/logger';
import { readGlobalIndex } from '../core/global-layer';

export interface GlobalStatusOptions {
  project?: string;
}

export async function globalStatusCommand(options: GlobalStatusOptions): Promise<void> {
  const spinner = new Spinner('读取全量层数据...');
  spinner.start();

  try {
    const index = await readGlobalIndex();
    spinner.stop();

    // 空状态检查
    if (index.projects.length === 0) {
      logger.info('');
      logger.info('📊 全量层状态');
      logger.info('');
      logger.info('全量层为空，尚未导入任何项目。');
      logger.info('');
      logger.info('📋 开始使用:');
      logger.info('   speccore import --project=XXX --path=./XXX --type=backend');
      return;
    }

    if (options.project) {
      await showProjectDetail(options.project, index);
    } else {
      await showGlobalOverview(index);
    }
  } catch (error) {
    spinner.fail(`读取全量层失败: ${error}`);
    throw error;
  }
}

/**
 * 全量总览
 */
async function showGlobalOverview(index: Awaited<ReturnType<typeof readGlobalIndex>>): Promise<void> {
  logger.info('');
  logger.info('📊 全量层状态');
  logger.info('');

  // 项目总览表
  logger.info('┌─────────────────────────────────────────────────────────────┐');
  logger.info('│                      项目总览                                │');
  logger.info('├──────────────┬──────────┬────────┬────────┬──────┬──────┬────┤');
  logger.info('│ 项目名称     │ 类型     │ 需求数 │✅ 已实现│🔄 进行│🔲 待开│📦 已有│');
  logger.info('├──────────────┼──────────┼────────┼────────┼──────┼──────┼────┤');

  for (const proj of index.projects) {
    const hasExisting = proj.type === 'backend' ? 0 : 0;
    const implemented = proj.implemented || 0;
    const inProgress = proj.inProgress || 0;
    const pending = proj.pending || 0;
    const existing = hasExisting || 0;
    logger.info(`│ ${pad(proj.name, 12)} │ ${pad(proj.type, 8)} │ ${pad(String(proj.reqCount), 6)} │ ${pad(String(implemented), 6)} │ ${pad(String(inProgress), 4)} │ ${pad(String(pending), 4)} │ ${pad(String(existing), 2)} │`);
  }

  // 合计行
  const totalReqs = index.projects.reduce((s, p) => s + p.reqCount, 0);
  const totalDone = index.projects.reduce((s, p) => s + (p.implemented || 0), 0);
  const totalProgress = index.projects.reduce((s, p) => s + (p.inProgress || 0), 0);
  const totalPending = index.projects.reduce((s, p) => s + (p.pending || 0), 0);
  logger.info('├──────────────┼──────────┼────────┼────────┼──────┼──────┼────┤');
  logger.info(`│ 合计         │ ${index.projects.length} 个项目 │ ${pad(String(totalReqs), 6)} │ ${pad(String(totalDone), 6)} │ ${pad(String(totalProgress), 4)} │ ${pad(String(totalPending), 4)} │ 0  │`);
  logger.info('└──────────────┴──────────┴────────┴────────┴──────┴──────┴────┘');

  // 需求总览
  logger.info('');
  logger.info('📋 需求总览:');
  if (index.reqs.length === 0) {
    logger.info('   暂无需求');
  } else {
    for (const req of index.reqs.slice(0, 15)) {
      const iterInfo = req.iteration ? ` ${req.iteration} / ${req.task}` : ' -';
      logger.info(`   ${req.id} | ${pad(req.name, 16)} | ${pad(req.project, 14)} | ${req.status} |${iterInfo}`);
    }
    if (index.reqs.length > 15) {
      logger.info(`   ...（共 ${index.reqs.length} 条，仅显示前 15 条）`);
    }
  }

  // 期次关联
  if (index.iterations.length > 0) {
    logger.info('');
    logger.info('🔗 期次关联:');
    for (const iter of index.iterations) {
      logger.info(`   ${iter.name} | ${iter.reqs.length} 个需求 | ${iter.status} | 创建: ${iter.createdAt}`);
    }
  }

  logger.info('');
  logger.info(`全量层版本: ${index.version}`);
  logger.info('');
  if (index.projects.length > 0) {
    logger.info('📋 聚焦: speccore global-status --project=<项目名> 查看项目详情');
  }
}

/**
 * 指定项目详情
 */
async function showProjectDetail(
  projectName: string,
  index: Awaited<ReturnType<typeof readGlobalIndex>>
): Promise<void> {
  const proj = index.projects.find((p) => p.name === projectName);
  if (!proj) {
    logger.error(`项目 "${projectName}" 不在全量层中。`);
    logger.info('运行 speccore global-status 查看所有项目。');
    return;
  }

  const projectReqs = index.reqs.filter((r) => r.project === projectName);

  logger.info('');
  logger.info(`📊 全量层状态 —— ${projectName}`);
  logger.info('');
  logger.info(`项目信息:`);
  logger.info(`   类型: ${proj.type}`);
  logger.info(`   需求数: ${proj.reqCount}`);
  logger.info(`   最后导入: ${proj.lastImport}`);

  logger.info('');
  logger.info(`需求清单（${projectReqs.length} 条）:`);
  for (const req of projectReqs) {
    const iterInfo = req.iteration ? `${req.iteration} / ${req.task}` : '-';
    logger.info(`   ${req.id} | ${pad(req.name, 16)} | ${req.status} | ${iterInfo}`);
  }

  logger.info('');
  logger.info(`📁 需求文件: GLOBAL/PROJECTS/${projectName}/REQUIREMENT.md`);
  logger.info(`📋 元数据文件: GLOBAL/PROJECTS/${projectName}/METADATA.md`);
}

/**
 * 简单字符串填充（中文兼容）
 */
function pad(str: string, width: number): string {
  const len = [...str].length;
  if (len >= width) return str;
  return str + ' '.repeat(width - len);
}
