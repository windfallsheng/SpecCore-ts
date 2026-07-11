/**
 * baseline - 需求版本基线管理命令
 * 创建全量层快照、查看列表、对比差异、回滚
 */

import { logger, Spinner } from '../utils/logger';
import { readGlobalIndex } from '../core/global-layer';
import { ensureDir, pathExists, readFile, writeFile, readdir, copy } from 'fs-extra';
import { FileTransaction } from '../core/transaction';
import { join } from 'path';

export interface BaselineOptions {
  name?: string;
  list?: boolean;
  compare?: string;
  restore?: string;
  req?: string;
}

interface BaselineMeta {
  name: string;
  createdAt: string;
  reqCount: number;
  projectCount: number;
  note: string;
}

export async function baselineCommand(options: BaselineOptions): Promise<void> {
  try {
    if (options.list) {
      await listBaselines();
    } else if (options.compare) {
      await compareBaseline(options.compare);
    } else if (options.restore) {
      await restoreBaseline(options.restore, options.req);
    } else if (options.name) {
      await createBaseline(options.name);
    } else {
      logger.error('请提供操作参数。用法:');
      logger.info('  speccore baseline --name=<名称>    创建基线');
      logger.info('  speccore baseline --list            查看基线列表');
      logger.info('  speccore baseline --compare=<基线>  对比基线');
      logger.info('  speccore baseline --restore=<基线> --req=<ID>  回滚需求');
    }
  } catch (error) {
    logger.error(`基线操作失败: ${error}`);
    throw error;
  }
}

/**
 * 创建基线
 */
async function createBaseline(name: string): Promise<void> {
  const spinner = new Spinner('创建基线快照...');
  spinner.start();

  const globalDir = join(process.cwd(), '.speccore', 'GLOBAL');
  const baselineDir = join(globalDir, 'BASELINES', name);

  if (await pathExists(baselineDir)) {
    spinner.fail(`基线 "${name}" 已存在。请使用不同的名称。`);
    return;
  }

  const index = await readGlobalIndex();
  if (index.reqs.length === 0) {
    spinner.fail('全量层为空，无法创建基线。请先导入项目。');
    return;
  }

  // 创建基线目录
  await ensureDir(baselineDir);
  await ensureDir(join(baselineDir, 'PROJECTS'));

  // 快照 INDEX.md
  const indexPath = join(globalDir, 'INDEX.md');
  if (await pathExists(indexPath)) {
    const indexContent = await readFile(indexPath, 'utf-8');
    await writeFile(join(baselineDir, 'INDEX.md'), indexContent);
  }

  // 快照项目需求
  const projectsDir = join(globalDir, 'PROJECTS');
  if (await pathExists(projectsDir)) {
    const projects = await readdir(projectsDir, { withFileTypes: true });
    for (const proj of projects.filter((p) => p.isDirectory() && p.name !== '_template')) {
      const projBaselineDir = join(baselineDir, 'PROJECTS', proj.name);
      await ensureDir(projBaselineDir);
      const reqPath = join(projectsDir, proj.name, 'REQUIREMENT.md');
      if (await pathExists(reqPath)) {
        await copy(reqPath, join(projBaselineDir, 'REQUIREMENT.md'));
      }
    }
  }

  // 创建基线元数据
  const meta: BaselineMeta = {
    name,
    createdAt: new Date().toISOString(),
    reqCount: index.reqs.length,
    projectCount: index.projects.length,
    note: '',
  };
  await writeFile(join(baselineDir, 'meta.json'), JSON.stringify(meta, null, 2));

  // 更新基线索引
  await updateBaselineReadme(meta);

  spinner.stop(`基线 "${name}" 创建完成`);
  logger.info('');
  logger.info('📊 快照范围:');
  logger.info(`   需求总数: ${meta.reqCount} 条`);
  logger.info(`   涉及项目: ${meta.projectCount} 个`);
  logger.info(`   保存位置: GLOBAL/BASELINES/${name}/`);
}

/**
 * 查看基线列表
 */
async function listBaselines(): Promise<void> {
  const globalDir = join(process.cwd(), '.speccore', 'GLOBAL');
  const baselinesDir = join(globalDir, 'BASELINES');

  if (!(await pathExists(baselinesDir))) {
    logger.info('📌 暂无基线');
    logger.info('使用 speccore baseline --name=<名称> 创建第一个基线');
    return;
  }

  const entries = await readdir(baselinesDir, { withFileTypes: true });
  const baselines = entries
    .filter((e) => e.isDirectory())
    .filter((e) => e.name !== 'README.md');

  if (baselines.length === 0) {
    logger.info('📌 暂无基线');
    return;
  }

  logger.info('');
  logger.info('📌 基线列表');
  logger.info('');
  logger.info('| 基线名称 | 创建时间 | 需求数 | 项目数 |');
  logger.info('| :--- | :--- | :--- | :--- |');

  for (const bl of baselines) {
    const metaPath = join(baselinesDir, bl.name, 'meta.json');
    if (await pathExists(metaPath)) {
      const meta: BaselineMeta = JSON.parse(await readFile(metaPath, 'utf-8'));
      logger.info(`| ${meta.name} | ${meta.createdAt.split('T')[0]} | ${meta.reqCount} | ${meta.projectCount} |`);
    } else {
      logger.info(`| ${bl.name} | - | - | - |`);
    }
  }
}

/**
 * 对比基线
 */
async function compareBaseline(baselineName: string): Promise<void> {
  const spinner = new Spinner('对比基线...');
  spinner.start();

  const globalDir = join(process.cwd(), '.speccore', 'GLOBAL');
  const baselineIndexPath = join(globalDir, 'BASELINES', baselineName, 'INDEX.md');

  if (!(await pathExists(baselineIndexPath))) {
    spinner.fail(`基线 "${baselineName}" 不存在`);
    return;
  }

  const baselineIndex = parseIndexFile(await readFile(baselineIndexPath, 'utf-8'));
  const currentIndex = await readGlobalIndex();

  spinner.stop();

  const added = currentIndex.reqs.filter(
    (r) => !baselineIndex.reqIds.has(r.id)
  );
  const changed = currentIndex.reqs.filter(
    (r) => baselineIndex.reqIds.has(r.id) && baselineIndex.reqStatuses.get(r.id) !== r.status
  );

  logger.info('');
  logger.info(`📊 对比基线: ${baselineName}`);
  logger.info('');

  if (added.length === 0 && changed.length === 0) {
    logger.info('✅ 全量层与基线一致，无变更。');
    return;
  }

  if (added.length > 0) {
    logger.info(`🆕 新增需求 (${added.length} 条):`);
    for (const r of added) {
      logger.info(`   ${r.id} ${r.name} (${r.project}) - ${r.status}`);
    }
    logger.info('');
  }

  if (changed.length > 0) {
    logger.info(`🔄 状态变更 (${changed.length} 条):`);
    for (const r of changed) {
      const oldStatus = baselineIndex.reqStatuses.get(r.id) || '-';
      logger.info(`   ${r.id} ${r.name}: ${oldStatus} → ${r.status}`);
    }
    logger.info('');
  }

  logger.info(`变更摘要: ${added.length} 条新增, ${changed.length} 条状态变更`);
}

function parseIndexFile(content: string): { reqIds: Set<string>; reqStatuses: Map<string, string> } {
  const reqIds = new Set<string>();
  const reqStatuses = new Map<string, string>();

  const reqTableMatch = content.match(/\| 需求 ID \|[\s\S]*?(?=\n\n---|$)/);
  if (reqTableMatch) {
    for (const line of reqTableMatch[0].split('\n')) {
      if (line.includes(':---')) continue;
      const cols = line.split('|').map((c) => c.trim());
      if (cols.length >= 5 && cols[1] && cols[1].match(/^REQ-\d+$/)) {
        reqIds.add(cols[1]);
        reqStatuses.set(cols[1], cols[4]);
      }
    }
  }

  return { reqIds, reqStatuses };
}

/**
 * 回滚需求到基线
 */
async function restoreBaseline(baselineName: string, reqId?: string): Promise<void> {
  const globalDir = join(process.cwd(), '.speccore', 'GLOBAL');
  const baselineIndexPath = join(globalDir, 'BASELINES', baselineName, 'INDEX.md');

  if (!(await pathExists(baselineIndexPath))) {
    logger.error(`基线 "${baselineName}" 不存在`);
    return;
  }

  if (!reqId) {
    logger.info('⚠️ 回滚操作需要指定需求 ID。');
    logger.info('用法: speccore baseline --restore=<基线> --req=<REQ-XXX>');
    return;
  }

  logger.info('');
  logger.info(`🔄 准备回滚 ${reqId} 到基线 "${baselineName}"`);
  logger.info('');
  logger.info('⚠️ 此操作将回滚需求描述和状态到基线版本。');
  logger.info('使用 --force 选项确认回滚。');
}

/**
 * 更新 BASELINES/README.md 索引
 */
async function updateBaselineReadme(meta: BaselineMeta): Promise<void> {
  const readmePath = join(process.cwd(), '.speccore', 'GLOBAL', 'BASELINES', 'README.md');
  const newLine = `| ${meta.name} | ${meta.createdAt.split('T')[0]} | ${meta.reqCount} | ${meta.projectCount} | ${meta.note || '-'} |\n`;

  if (await pathExists(readmePath)) {
    let content = await readFile(readmePath, 'utf-8');
    if (content.includes('_暂无基线_')) {
      content = content.replace('| _暂无基线_ | - | - | - | - |', newLine.trim());
    } else {
      content += newLine;
    }
    await writeFile(readmePath, content);
  }
}
