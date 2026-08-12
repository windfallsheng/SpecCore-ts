/**
 * update — 项目升级命令
 * 只增量更新工具命令文件 + 配置模板，不覆盖用户数据
 */
import { writeFile, pathExists, readFile, readdir, ensureDir } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../utils/logger';
import { safeWriteWithOld, safeCopyDirWithOld, _updateConflicts } from './init';

const CURRENT_VERSION = require('../../package.json').version;

// ── 当前版本的命令列表 ──
const ALL_COMMANDS: [string, string, string][] = [
  ['spec-ask', 'AI万能入口', 'speccore ask --web "${1:查看进度}"'],
  ['spec-welcome', '项目名片', 'speccore welcome --web'],
  ['spec-dashboard', '全局仪表盘', 'speccore dashboard --scope global --web'],
  ['spec-init', '初始化项目', 'speccore init'],
  ['spec-doc2spec', '导入需求文档', 'speccore doc2spec -f ${1:PRD.docx} --iter ${2:Q1}'],
  ['spec-analyze', 'AI需求分析', 'speccore analyze -I ${1:Q1}'],
  ['spec-split', '智能拆分任务', 'speccore iteration split -i ${1:Q1} --interactive'],
  ['spec-execute', '执行开发任务', 'speccore execute -t ${1:Task-001} --force'],
  ['spec-plan', '生成执行计划', 'speccore plan -I ${1:Q1}'],
  ['spec-pr', '创建PR', 'speccore pr --task=${1:Task-001}'],
  ['spec-done', '完成任务归档', 'speccore done --task=${1:Task-001}'],
  ['spec-spec2doc', '导出文档', 'speccore spec2doc -i ${1:Q1} -o ${2:需求.docx}'],
  ['spec-dev', '智能级联', 'speccore dev --auto --web'],
  ['spec-change', '需求变更', 'speccore change "${1:变更描述}" --task=${2:Task-001}'],
  ['spec-validate', '合规验证', 'speccore validate --iteration=${1:Q1}'],
  ['spec-search', '全文搜索', 'speccore search "${1:关键词}"'],
  ['spec-track', '全链路追踪', 'speccore track --req=${1:REQ-001}'],
  ['spec-sync', '双向同步', 'speccore sync --global'],
  ['spec-rename', '重命名', 'speccore rename --iteration ${1:Q1} ${2:Q2}'],
  ['spec-create-iteration', '创建迭代', 'speccore iteration create -n ${1:Q2} --owner=${2:张三}'],
  ['spec-retro', '任务回顾报告', 'speccore retro --task ${1:Task-001}'],
  ['spec-context', '查看/切换上下文', 'speccore context --set --iteration ${1:Q1}'],
  ['spec-ops', '操作历史', 'speccore ops'],
];

// ── 旧命令文件名（需要清理的）──
const LEGACY_NAMES = new Set(['spec-status', 'spec-status-panel', 'spec-global-status']);

export async function updateCommand(options: { force?: boolean; tool?: string }): Promise<void> {
  const projectRoot = process.cwd();

  // 解析工具过滤
  const toolFilter = options.tool ? options.tool.split(',').map(t => t.trim()) : null;
  const allTools = ['.claude', '.codebuddy', '.cursor', '.trae', '.windsurf'];
  const tools = toolFilter
    ? allTools.filter(t => toolFilter.some(f => t.includes(f)))
    : allTools;

  // 检查是否已初始化
  const speccoreDir = join(projectRoot, '.speccore');
  if (!(await pathExists(speccoreDir))) {
    logger.warn('⚠️  项目未初始化，请先运行: speccore init');
    return;
  }

  // 读取当前版本
  const verFile = join(speccoreDir, 'local', 'version.json');
  let oldVersion = 'unknown';
  if (await pathExists(verFile)) {
    try { oldVersion = JSON.parse(await readFile(verFile, 'utf-8')).version; } catch {}
  }

  const isSameVersion = oldVersion === CURRENT_VERSION;
  if (isSameVersion && !options.force) {
    logger.info('');
    logger.info(`✅ 已是最新版本 v${CURRENT_VERSION}，无需升级`);
    logger.info('');
    logger.info('💡 如需强制更新所有命令文件: speccore init --update --force');
    logger.info('');
    return;
  }

  const spinner = new Spinner(isSameVersion ? '强制更新命令文件...' : `升级 v${oldVersion} → v${CURRENT_VERSION}...`);
  spinner.start();
  if (!isSameVersion) {
    logger.info(`  📦 从 v${oldVersion} 升级到 v${CURRENT_VERSION}...`);
  } else {
    logger.info(`  🔄 强制更新 v${CURRENT_VERSION} 命令文件...`);
  }

  logger.info(`  🎯 目标工具: ${tools.map(t => t.replace('.', '')).join(', ') || '无'}`);

  let added = 0, updated = 0, cleaned = 0;
  const addedFiles: string[] = [];
  const updatedFiles: string[] = [];
  const cleanedFiles: string[] = [];
  _updateConflicts.length = 0; // 清空冲突追踪

  // ── 1. 更新工具目录命令文件 ──
  const qoderDir = join(projectRoot, '.qoder', 'commands', 'spec');

  for (const tool of tools) {
    const toolCommandsDir = join(projectRoot, tool, 'commands');
    for (const [name, desc, cmd] of ALL_COMMANDS) {
      const p = join(toolCommandsDir, name + '.md');
      const content = `---\nname: ${name}\ndescription: ${desc}\n---\n${cmd}`;
      if (await pathExists(p)) {
        const existing = await readFile(p, 'utf-8');
        if (existing.trim() !== content.trim()) {
          await safeWriteWithOld(p, content);
          updated++;
          updatedFiles.push(`${tool}/commands/${name}.md`);
        }
      } else {
        await ensureDir(toolCommandsDir);
        await writeFile(p, content);
        added++;
        addedFiles.push(`${tool}/commands/${name}.md`);
      }
    }
    // 清理旧文件
    for (const legacy of LEGACY_NAMES) {
      const lp = join(toolCommandsDir, legacy + '.md');
      if (await pathExists(lp)) { await require('fs-extra').remove(lp); cleaned++; cleanedFiles.push(`${tool}/commands/${legacy}.md`); }
    }
  }

  // Qoder 特殊处理
  if (await pathExists(join(projectRoot, '.qoder'))) {
    for (const [name, desc, cmd] of ALL_COMMANDS) {
      const shortName = name.replace('spec-', '');
      const p = join(qoderDir, shortName + '.md');
      const content = `${cmd}`;
      if (await pathExists(p)) {
        const existing = await readFile(p, 'utf-8');
        if (existing.trim() !== content.trim()) {
          await safeWriteWithOld(p, content);
          updated++;
          updatedFiles.push(`qoder/spec/${shortName}.md`);
        }
      } else {
        await ensureDir(qoderDir);
        await writeFile(p, content);
        added++;
        addedFiles.push(`qoder/spec/${shortName}.md`);
      }
    }
    // 清理旧 Qoder 文件
    if (await pathExists(qoderDir)) {
      for (const f of await readdir(qoderDir)) {
        if (LEGACY_NAMES.has(f.replace('.md', ''))) {
          await require('fs-extra').remove(join(qoderDir, f));
          cleaned++;
          cleanedFiles.push(`qoder/spec/${f}`);
        }
      }
    }
  }

  // ── 2. 更新版本号 ──
  await ensureDir(join(speccoreDir, 'local'));
  await writeFile(verFile, JSON.stringify({ version: CURRENT_VERSION, updatedAt: new Date().toISOString() }, null, 2));

  // ── 3. 检查升级提示（CONSTITUTION 模板变化等）──
  const { checkUpgradeHints } = await import('./init');
  await checkUpgradeHints(projectRoot, speccoreDir);

  // ── 4. 更新 .agents/skills/ + AGENTS.md + 工具命令 + 清理残留 ──
  const { createToolIntegrations, cleanupStaleFiles } = await import('./init');

  // 4a. 更新所有 AI 工具的命令文件
  await createToolIntegrations(projectRoot, options.tool);

  // 4b. 更新 .agents/skills/（含 references/）— 有差异的文件旧版重命名为 *-old
  const skillsSrc = join(__dirname, '..', '..', '.agents', 'skills');
  const skillsDest = join(projectRoot, '.agents', 'skills');
  if (await pathExists(skillsSrc)) {
    await safeCopyDirWithOld(skillsSrc, skillsDest);
  }

  // 4c. 更新 AGENTS.md / CLAUDE.md — 有差异时旧版重命名为 *-old
  try {
    const agentsSrc = join(__dirname, '..', '..', 'AGENTS.md');
    if (await pathExists(agentsSrc)) {
      const newAgents = await readFile(agentsSrc, 'utf-8');
      await safeWriteWithOld(join(projectRoot, 'AGENTS.md'), newAgents);
      await safeWriteWithOld(join(projectRoot, 'CLAUDE.md'), '<!-- 规则请参考 AGENTS.md -->\n\n@AGENTS.md\n');
    }
  } catch {}

  // 4d. 清理旧版本残留的命令文件和 Skill 目录
  const skillNames = (await require('fs-extra').readdir(skillsSrc)).filter((f: string) => !f.startsWith('.'));
  await cleanupStaleFiles(projectRoot, ALL_COMMANDS, skillNames);

  const verLabel = isSameVersion ? `v${CURRENT_VERSION}` : `v${oldVersion} → v${CURRENT_VERSION}`;
  spinner.stop(`升级完成: ${verLabel}`);
  logger.info('');
  logger.info('━'.repeat(50));
  logger.info(`🔄 SpecCore ${isSameVersion ? '命令文件已强制更新' : '升级完成'}`);
  logger.info('');
  if (addedFiles.length > 0) {
    logger.info(`  ✨ 新增 ${added} 个命令:`);
    for (const f of addedFiles) logger.info(`     + ${f}`);
    logger.info('');
  }
  if (updatedFiles.length > 0) {
    logger.info(`  🔄 更新 ${updated} 个命令:`);
    for (const f of updatedFiles.slice(0, 8)) logger.info(`     ~ ${f}`);
    if (updatedFiles.length > 8) logger.info(`     ... 共 ${updatedFiles.length} 个文件`);
    logger.info('');
  }
  if (cleanedFiles.length > 0) {
    logger.info(`  🗑  清理 ${cleaned} 个旧文件:`);
    for (const f of cleanedFiles) logger.info(`     - ${f}`);
    logger.info('');
  }
  if (added === 0 && updated === 0 && cleaned === 0) {
    logger.info('  所有命令文件内容未变化');
    logger.info('');
  }
  // 冲突文件汇总
  if (_updateConflicts.length > 0) {
    logger.info(`  ⚠️  ${_updateConflicts.length} 个文件有内容冲突，旧版已保存为 *-old`);
    for (const f of _updateConflicts) {
      const rel = f.replace(projectRoot + '/', '');
      const oldRel = rel.replace(/\.(md|json|txt|yaml)$/, '-old.$1');
      logger.info(`     📄 ${rel}`);
      logger.info(`        对比: diff ${rel} ${oldRel}`);
    }
    logger.info('');
    logger.info('  💡 请对比 *-old 文件，合并自定义内容后删除 *-old');
  } else {
    logger.info('  ✨ 无内容冲突，所有文件平滑升级');
  }
  logger.info('');
  logger.info('  🛡️  CONSTITUTION.md / context.json 等用户数据保持不变');
  logger.info('');
  logger.info('━'.repeat(50));
  logger.info('');

  // ── 5. 自动迁移任务目录（如果存在旧结构）──
  try {
    const { migrateTasks } = await import('./migrate');
    const entries = await require('fs-extra').readdir(projectRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('Iteration-')) {
        const iterDir = join(projectRoot, entry.name);
        const hasOldTasks = (await require('fs-extra').readdir(iterDir)).some((f: string) => f.match(/^Task-\d+$/));
        if (hasOldTasks) {
          logger.info('🔄 检测到旧版任务目录结构，开始自动迁移...');
          logger.info('');
          await migrateTasks(projectRoot, entry.name, { dryRun: false, force: false });
          break; // 只处理第一个有旧任务的迭代
        }
      }
    }
  } catch (err) {
    // 迁移失败不影响主流程
    logger.warn(`⚠️  自动迁移跳过: ${err}`);
  }
}
