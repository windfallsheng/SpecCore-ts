/**
 * units — 功能单元管理
 *
 * 管理 010-requirements/features/ 下的功能单元：
 * - 列出、查看、调整功能单元
 * - 交互式合并、拆分、重命名
 * - 查看变更履历
 */
import { logger } from '../utils/logger';
import { pathExists, readFile, readdir, writeFile, ensureDir, remove } from 'fs-extra';
import { join, basename } from 'path';
import { loadConfig } from '../core/unified-config';

interface UnitsOptions {
  iter?: string;
  list?: boolean;
  edit?: string | boolean;
  delete?: string;
  merge?: string;
}

export async function unitsCommand(options: UnitsOptions): Promise<void> {
  const iter = options.iter || '';

  if (!iter) {
    logger.error('请指定迭代: speccore units --iter=<迭代>');
    return;
  }

  const iterDir = `Iteration-${iter.replace(/^Iteration-/, '')}`;
  const featuresDir = join(iterDir, '010-requirements', 'features');

  if (!(await pathExists(featuresDir))) {
    logger.warn(`未找到功能单元目录: ${featuresDir}`);
    logger.info('请先运行: speccore doc2spec --file PRD.docx --split --iter=<迭代>');
    return;
  }

  // ── 列出功能单元 ──
  if (options.list || (!options.edit && !options.delete && !options.merge)) {
    await listUnits(featuresDir);
    return;
  }

  // ── 编辑功能单元 ──
  if (options.edit) {
    const unitName = typeof options.edit === 'string' ? options.edit : '';
    if (unitName) {
      await editUnit(featuresDir, unitName);
    } else {
      await interactiveEdit(featuresDir);
    }
    return;
  }

  // ── 删除功能单元 ──
  if (options.delete) {
    await deleteUnit(featuresDir, options.delete);
    return;
  }

  // ── 合并功能单元 ──
  if (options.merge) {
    const names = options.merge.split(',').map(s => s.trim());
    if (names.length < 2) {
      logger.error('合并需要至少两个单元: --merge="单元A,单元B"');
      return;
    }
    await mergeUnits(featuresDir, names);
    return;
  }
}

/**
 * 列出所有功能单元
 */
async function listUnits(featuresDir: string): Promise<void> {
  const entries = await readdir(featuresDir, { withFileTypes: true });
  const units = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'INDEX.md');

  if (units.length === 0) {
    logger.info('暂无功能单元');
    return;
  }

  logger.info(`📦 功能单元 (${units.length}个):`);
  logger.info('');
  logger.info('┌────┬────────────────────────────┬──────────┬────────────────────────────┐');
  logger.info('│ 序号 │ 功能单元                  │ 状态     │ 来源                       │');
  logger.info('├────┼────────────────────────────┼──────────┼────────────────────────────┤');

  for (let i = 0; i < units.length; i++) {
    const unitDir = join(featuresDir, units[i].name);
    const meta = await readUnitMeta(unitDir);
    const status = meta.status || 'unknown';
    const source = meta.source_file || meta.origin || 'unknown';
    const displayName = units[i].name;
    logger.info(`│ ${String(i + 1).padStart(2)}  │ ${displayName.padEnd(26)} │ ${status.padEnd(8)} │ ${source.padEnd(26)} │`);
  }

  logger.info('└────┴────────────────────────────┴──────────┴────────────────────────────┘');
  logger.info('');
  logger.info('操作: speccore units --edit [单元名]');
  logger.info('      speccore units --merge "单元A,单元B"');
  logger.info('      speccore units --delete <单元名>');
}

/**
 * 读取单元元信息
 */
async function readUnitMeta(unitDir: string): Promise<Record<string, string>> {
  const metaPath = join(unitDir, '.meta', 'source');
  if (!(await pathExists(metaPath))) {
    return {};
  }
  const content = await readFile(metaPath, 'utf-8');
  const meta: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      meta[match[1]] = match[2].trim();
    }
  }
  return meta;
}

/**
 * 编辑单个功能单元（显示内容摘要）
 */
async function editUnit(featuresDir: string, unitName: string): Promise<void> {
  const unitDir = join(featuresDir, unitName);
  if (!(await pathExists(unitDir))) {
    logger.error(`功能单元不存在: ${unitName}`);
    return;
  }

  const readmePath = join(unitDir, 'README.md');
  if (!(await pathExists(readmePath))) {
    logger.error(`单元内容不存在: ${readmePath}`);
    return;
  }

  const content = await readFile(readmePath, 'utf-8');
  const lines = content.split('\n');
  const title = lines[0].replace(/^#\s*/, '');

  logger.info(`📄 ${unitName}`);
  logger.info(`   标题: ${title}`);
  logger.info(`   行数: ${lines.length}`);
  logger.info(`   路径: ${readmePath}`);
  logger.info('');

  // 显示前 10 行预览
  const preview = lines.slice(0, 10).join('\n');
  logger.info('内容预览:');
  logger.info(preview);
  if (lines.length > 10) {
    logger.info(`... (${lines.length - 10} 行省略)`);
  }
}

/**
 * 交互式编辑（菜单模式）
 */
async function interactiveEdit(featuresDir: string): Promise<void> {
  await listUnits(featuresDir);
}

/**
 * 删除功能单元
 */
async function deleteUnit(featuresDir: string, unitName: string): Promise<void> {
  const unitDir = join(featuresDir, unitName);
  if (!(await pathExists(unitDir))) {
    logger.error(`功能单元不存在: ${unitName}`);
    return;
  }

  // 备份：移动到 .trash/
  const trashDir = join(featuresDir, '.trash');
  await ensureDir(trashDir);
  const trashPath = join(trashDir, `${unitName}-${Date.now()}`);

  // 记录删除前的快照和变更
  await createVersionSnapshot(unitDir);
  await appendChangelog(unitDir, {
    version: 'v-deleted',
    type: 'delete',
    description: `删除并备份到 .trash/${basename(trashPath)}`,
    timestamp: new Date().toISOString(),
  });

  // 简单重命名作为删除（实际项目中可用 fs-extra 的 move）
  // 这里用 copy + remove 模拟
  const fs = require('fs-extra');
  await fs.copy(unitDir, trashPath);
  await remove(unitDir);

  logger.success(`已删除功能单元: ${unitName}`);
  logger.info(`   备份位置: ${trashPath}`);

  // 更新 INDEX.md
  await updateFeaturesIndex(featuresDir);
}

/**
 * 合并功能单元
 */
async function mergeUnits(featuresDir: string, names: string[]): Promise<void> {
  // 验证所有单元存在
  for (const name of names) {
    const unitDir = join(featuresDir, name);
    if (!(await pathExists(unitDir))) {
      logger.error(`功能单元不存在: ${name}`);
      return;
    }
  }

  // 合并内容
  const mergedName = `${names[0]}-merged`;
  const mergedDir = join(featuresDir, mergedName);
  await ensureDir(mergedDir);
  await ensureDir(join(mergedDir, '.meta'));

  let mergedContent = `# 合并单元: ${names.join(' + ')}\n\n`;
  mergedContent += `> 合并时间: ${new Date().toISOString().split('T')[0]}\n`;
  mergedContent += `> 来源单元: ${names.join(', ')}\n\n`;
  mergedContent += '---\n\n';

  for (const name of names) {
    const readmePath = join(featuresDir, name, 'README.md');
    const content = await readFile(readmePath, 'utf-8');
    mergedContent += `## ${name}\n\n${content}\n\n`;
  }

  await writeFile(join(mergedDir, 'README.md'), mergedContent);

  // 记录合并操作
  const adjustmentMeta = `---\noperation: merge\nsource_units: ${names.join(', ')}\nmerged_name: ${mergedName}\ntime: ${new Date().toISOString()}\n---\n`;
  await writeFile(join(mergedDir, '.meta', 'adjustment'), adjustmentMeta);

  // 标记原单元为 deprecated，并记录变更
  for (const name of names) {
    const unitDir = join(featuresDir, name);
    await createVersionSnapshot(unitDir);
    await appendChangelog(unitDir, {
      version: 'v-deprecated',
      type: 'merge',
      description: `合并到 ${mergedName}`,
      timestamp: new Date().toISOString(),
    });
    const metaPath = join(unitDir, '.meta', 'source');
    if (await pathExists(metaPath)) {
      let meta = await readFile(metaPath, 'utf-8');
      meta = meta.replace(/status:\s*\w+/, 'status: deprecated');
      await writeFile(metaPath, meta);
    }
  }

  // 记录合并后单元的创建
  await appendChangelog(mergedDir, {
    version: 'v1',
    type: 'merge',
    description: `由 ${names.join(', ')} 合并而成`,
    timestamp: new Date().toISOString(),
  });

  logger.success(`已合并功能单元: ${names.join(' + ')} → ${mergedName}`);

  // 更新 INDEX.md
  await updateFeaturesIndex(featuresDir);
}

/**
 * 更新 features/INDEX.md
 */
async function updateFeaturesIndex(featuresDir: string): Promise<void> {
  const entries = await readdir(featuresDir, { withFileTypes: true });
  const units = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'INDEX.md');

  let index = '# 功能单元索引\n\n> 自动更新\n\n';
  index += '| 功能单元 | 状态 | 来源 |\n';
  index += '| :--- | :--- | :--- |\n';

  for (const unit of units) {
    const meta = await readUnitMeta(join(featuresDir, unit.name));
    const status = meta.status || 'unknown';
    const source = meta.source_file || meta.origin || 'unknown';
    index += `| ${unit.name} | ${status} | ${source} |\n`;
  }

  await writeFile(join(featuresDir, 'INDEX.md'), index);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 变更追踪
// ═══════════════════════════════════════════════════════════════════════════════

interface ChangeInfo {
  version: string;
  type: 'create' | 'update' | 'merge' | 'split' | 'delete';
  description: string;
  timestamp: string;
}

/**
 * 创建版本快照（备份当前 README.md 到 .meta/versions/）
 */
async function createVersionSnapshot(unitDir: string): Promise<void> {
  const readmePath = join(unitDir, 'README.md');
  if (!(await pathExists(readmePath))) return;

  const versionsDir = join(unitDir, '.meta', 'versions');
  await ensureDir(versionsDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const snapshotPath = join(versionsDir, `v-${timestamp}.md`);

  const content = await readFile(readmePath, 'utf-8');
  await writeFile(snapshotPath, content);
}

/**
 * 追加变更记录到 CHANGELOG.md
 */
async function appendChangelog(unitDir: string, change: ChangeInfo): Promise<void> {
  const changelogPath = join(unitDir, 'CHANGELOG.md');
  let content = '';

  if (await pathExists(changelogPath)) {
    content = await readFile(changelogPath, 'utf-8');
  } else {
    content = `# ${basename(unitDir)} - 变更履历\n\n`;
  }

  const entry = `## ${change.version} - ${change.timestamp.split('T')[0]}\n`;
  const typeLabel = { create: '新增', update: '更新', merge: '合并', split: '拆分', delete: '删除' }[change.type];
  content += `${entry}**类型**: ${typeLabel}\n**说明**: ${change.description}\n\n`;

  await writeFile(changelogPath, content);
}
