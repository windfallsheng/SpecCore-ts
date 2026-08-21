/**
 * update — 项目升级命令
 * 只增量更新工具命令文件 + 配置模板，不覆盖用户数据
 */
import { writeFile, pathExists, readFile, readdir, ensureDir } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../utils/logger';
import { version as CURRENT_VERSION } from '../../package.json';
import { safeWriteWithBackup, safeCopyDirWithBackup, _updateConflicts, generateSettingsContent, generateAIRulesContent, TOOL_COMMANDS, initAgentsDir, initRulesDir, initCommandsDir, initSkillsDir, initHooksDir, syncAgentsMd } from './init';

// ── 当前版本的命令列表统一从 init.ts 导入（单一事实来源）──
// 避免 init.ts 与 update.ts 的命令列表不一致导致清理误删
const ALL_COMMANDS = TOOL_COMMANDS;

// ── 旧命令文件名（需要清理的）──
const LEGACY_NAMES = new Set(['spec-status', 'spec-status-panel', 'spec-global-status']);

export async function updateCommand(options: { force?: boolean; tool?: string }): Promise<void> {
  const projectRoot = process.cwd();

  // 解析工具过滤（含 trae-cn）
  const allTools = ['.claude', '.codebuddy', '.cursor', '.trae', '.trae-cn', '.windsurf'];
  const toolFilter = options.tool ? options.tool.split(',').map(t => t.trim()) : null;
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

  // 始终执行更新和清理，不再因版本相同跳过（确保旧格式文件、废弃命令等被清理）
  const spinner = new Spinner(isSameVersion ? `刷新 v${CURRENT_VERSION} 命令文件...` : `升级 v${oldVersion} → v${CURRENT_VERSION}...`);
  spinner.start();
  if (!isSameVersion) {
    logger.info(`  📦 从 v${oldVersion} 升级到 v${CURRENT_VERSION}...`);
  } else {
    logger.info(`  🔄 刷新 v${CURRENT_VERSION} 命令文件 + 清理旧格式残留...`);
  }

  logger.info(`  🎯 目标工具: ${tools.map(t => t.replace('.', '')).join(', ') || '无'}`);

  _updateConflicts.length = 0; // 清空冲突追踪

  // ── 1. 清理旧版命令文件（按工具目录）──

  for (const tool of tools) {
    const toolCommandsDir = join(projectRoot, tool, 'commands');
    if (await pathExists(toolCommandsDir)) {
      for (const legacy of LEGACY_NAMES) {
        const lp = join(toolCommandsDir, legacy + '.md');
        if (await pathExists(lp)) {
          await require('fs-extra').remove(lp);
        }
      }
    }
  }

  // Qoder 旧版清理（spec/ 子目录 + 旧命令文件）
  const qoderCommandsDir = join(projectRoot, '.qoder', 'commands');
  if (await pathExists(qoderCommandsDir)) {
    const oldSpecDir = join(projectRoot, '.qoder', 'commands', 'spec');
    if (await pathExists(oldSpecDir)) {
      await require('fs-extra').remove(oldSpecDir);
    }
    for (const f of await readdir(qoderCommandsDir)) {
      // 清理旧版 spec: 前缀文件（已改用 spec- 前缀，跨平台安全）
      if (f.startsWith('spec:') && f.endsWith('.md')) {
        await require('fs-extra').remove(join(qoderCommandsDir, f));
        continue;
      }
      // 清理废弃命令文件（spec: 和 spec- 前缀都检查）
      const baseName = f.replace('.md', '').replace(/^spec[:.-]/, '');
      if (LEGACY_NAMES.has('spec-' + baseName) || LEGACY_NAMES.has('spec:' + baseName)) {
        await require('fs-extra').remove(join(qoderCommandsDir, f));
      }
    }
  }

  // ── 2. 更新版本号 + 确保新目录存在 ──
  await ensureDir(join(speccoreDir, 'local'));
  await ensureDir(join(speccoreDir, 'local', 'locks'));
  await ensureDir(join(speccoreDir, 'local', 'notifications'));
  await ensureDir(join(speccoreDir, 'code-graph'));
  await writeFile(verFile, JSON.stringify({ version: CURRENT_VERSION, updatedAt: new Date().toISOString() }, null, 2));

  // ── 3. 检查升级提示（CONSTITUTION 模板变化等）──
  const { checkUpgradeHints } = await import('./init');
  await checkUpgradeHints(projectRoot, speccoreDir);

  // ── 4. 更新 .agents/skills/ + AGENTS.md + 工具命令 + 清理残留 ──
  const { createToolIntegrations, cleanupStaleFiles } = await import('./init');

  // 4a. 更新所有 AI 工具的命令文件
  await createToolIntegrations(projectRoot, options.tool);

  // 4b. 更新 .agents/skills/（直接覆盖，不备份）
  const skillsSrc = join(__dirname, '..', '..', '.agents', 'skills');
  const skillsDest = join(projectRoot, '.agents', 'skills');
  if (await pathExists(skillsSrc)) {
    const { copy } = require('fs-extra');
    await copy(skillsSrc, skillsDest, { overwrite: true });
  }

  // 4c. 更新 AGENTS.md / CLAUDE.md
  try {
    const agentsSrc = join(__dirname, '..', '..', 'AGENTS.md');
    if (await pathExists(agentsSrc)) {
      const newAgents = await readFile(agentsSrc, 'utf-8');
      await safeWriteWithBackup(join(projectRoot, 'AGENTS.md'), newAgents);
      await safeWriteWithBackup(join(projectRoot, 'CLAUDE.md'), '<!-- 规则请参考 AGENTS.md -->\n\n@AGENTS.md\n');
    }
  } catch {}

  // 4c-2. 更新 SETTINGS.md（用户可能自定义，旧文件重命名时间戳提示迁移）
  //       AI-RULES.md 是纯生成物（AI 参考手册），直接覆盖
  try {
    await safeWriteWithBackup(join(speccoreDir, 'SETTINGS.md'), generateSettingsContent());
    await writeFile(join(speccoreDir, 'AI-RULES.md'), generateAIRulesContent());
  } catch {}

  // 4d. 清理旧版本残留的命令文件和 Skill 目录
  const skillNames = (await require('fs-extra').readdir(skillsSrc)).filter((f: string) => !f.startsWith('.'));
  await cleanupStaleFiles(projectRoot, ALL_COMMANDS, skillNames);

  // v6.97.0+ 修复：update 时补充创建规范数据库目录（之前只在 init 中创建）
  await initAgentsDir(projectRoot);
  await initRulesDir(projectRoot);
  await initCommandsDir(projectRoot);
  await initSkillsDir(projectRoot);
  await initHooksDir(projectRoot);

  // v6.98.0+: 同步 AGENTS.md — 将 .speccore/ 规范数据库投影到 AGENTS.md
  await syncAgentsMd(projectRoot);

  const verLabel = isSameVersion ? `v${CURRENT_VERSION}` : `v${oldVersion} → v${CURRENT_VERSION}`;
  spinner.stop(`升级完成: ${verLabel}`);
  logger.info('');
  logger.info('━'.repeat(50));
  logger.info(`🔄 SpecCore ${isSameVersion ? '命令文件已强制更新' : '升级完成'}`);
  logger.info('');
  logger.info('  📦 以下文件已同步到最新版本:');
  logger.info('     ✅ .agents/skills/ — Skill 全量更新');
  logger.info('     ✅ AGENTS.md — 项目规则');
  logger.info('     ✅ SETTINGS.md — 框架配置');
  logger.info('     ✅ AI-RULES.md — AI 参考手册');
  logger.info('     ✅ .speccore/AGENTS/ — 角色定义规范库');
  logger.info('     ✅ .speccore/RULES/ — 编码规范库');
  logger.info('     ✅ .speccore/COMMANDS/ — 命令模板库');
  logger.info('     ✅ .speccore/SKILLS/ — 可复用技能库');
  logger.info('     ✅ .speccore/HOOKS/ — 生命周期钩子库');
  logger.info('');
  // 冲突文件汇总
  if (_updateConflicts.length > 0) {
    logger.info(`  ⚠️  ${_updateConflicts.length} 个文件有内容冲突，旧版已重命名为时间戳格式`);
    for (const { file, backup } of _updateConflicts) {
      const rel = file.replace(projectRoot + '/', '');
      const backupRel = backup.replace(projectRoot + '/', '');
      logger.info(`     📄 ${rel}`);
      logger.info(`        对比: diff ${rel} ${backupRel}`);
    }
    logger.info('');
    logger.info('  💡 请对比时间戳文件，合并自定义内容后删除');
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

  // ── 6. CONSTITUTION.md 格式升级检查 ──
  try {
    const { checkUpgradeHints } = await import('./init');
    await checkUpgradeHints(projectRoot, speccoreDir);
  } catch {
    // 检查失败不影响主流程
  }
}
