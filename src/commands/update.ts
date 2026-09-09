/**
 * update — 项目升级命令
 * 只增量更新工具命令文件 + 配置模板，不覆盖用户数据
 */
import { writeFile, pathExists, readFile, readdir, ensureDir, unlink } from 'fs-extra';
import { join, relative } from 'path';
import { execSync } from 'child_process';
import { createInterface } from 'readline';
import { logger, Spinner } from '../utils/logger';
import { version as CURRENT_VERSION } from '../../package.json';
import { safeWriteWithBackup, safeCopyDirWithBackup, _updateConflicts, generateAIRulesContent, TOOL_COMMANDS, initAgentsDir, initRulesDir, initCommandsDir, initSkillsDir, initHooksDir, syncAgentsMd, writeUpgradePage } from './init';
import {
  initConfig,
  initProjectConfig,
  loadConfigWithMeta,
  loadProjectConfigWithMeta,
  detectConfigDiff,
  requiresUserConfirmation,
  DEFAULT_CONFIG,
  DEFAULT_PROJECT_CONFIG,
  formatConfigDiff,
  CURRENT_SCHEMA_VERSION,
  upgradeConfig,
  upgradeProjectConfig,
} from '../core/unified-config';
import { initEnvironmentConfigs, initTestConfigs } from './update-env-configs';

// ── 当前版本的命令列表统一从 init.ts 导入（单一事实来源）──
// 避免 init.ts 与 update.ts 的命令列表不一致导致清理误删
const ALL_COMMANDS = TOOL_COMMANDS;

// ── 旧命令文件名（需要清理的）──
const LEGACY_NAMES = new Set(['spec-status', 'spec-status-panel', 'spec-global-status']);

/**
 * 检测并终止遗留的 speccore schedule daemon / watch 进程
 * v8.3.60+: schedule 和 watch 命令已移除，此函数用于清理旧版本残留的运行中进程
 */
function cleanupLegacyDaemons(): { killed: number; pids: number[] } {
  const result = { killed: 0, pids: [] as number[] };
  const isWin = process.platform === 'win32';

  try {
    // 查找进程
    let pids: number[] = [];
    if (isWin) {
      try {
        const output = execSync(
          'wmic process where "CommandLine like \'%speccore%schedule%\' or CommandLine like \'%speccore%daemon%\' or CommandLine like \'%speccore%watch%\'" get ProcessId,CommandLine /format:csv',
          { encoding: 'utf-8', windowsHide: true }
        );
        pids = output.split(/\r?\n/)
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('Node'))
          .map(line => {
            const parts = line.split(',');
            const pid = parseInt(parts[parts.length - 1], 10);
            return isNaN(pid) ? 0 : pid;
          })
          .filter(pid => pid > 0);
      } catch { /* wmic 可能不可用 */ }
    } else {
      try {
        const output = execSync(
          "ps aux | grep -iE 'speccore.*(schedule|daemon|watch)' | grep -v grep | awk '{print $2}'",
          { encoding: 'utf-8' }
        );
        pids = output.split(/\r?\n/)
          .map(s => parseInt(s.trim(), 10))
          .filter(n => !isNaN(n) && n > 0);
      } catch { /* 无进程 */ }
    }

    // 终止进程
    for (const pid of pids) {
      try {
        if (isWin) {
          execSync(`taskkill /PID ${pid} /F`, { windowsHide: true });
        } else {
          process.kill(pid, 'SIGTERM');
          // 给 500ms  gracefully shutdown，然后强制
          try {
            execSync(`sleep 0.5 && kill -0 ${pid} && kill -9 ${pid}`);
          } catch { /* 已经终止 */ }
        }
        result.killed++;
        result.pids.push(pid);
      } catch { /* 终止失败，继续 */ }
    }
  } catch { /* 整体失败不影响 update 流程 */ }

  return result;
}

// v8.3.97+: 交互式确认辅助函数
async function askConfirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>(resolve => rl.question(`${prompt} [y/N]: `, (ans: string) => { rl.close(); resolve(ans.trim()); }));
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

export async function updateCommand(options: { force?: boolean; tool?: string; yes?: boolean }): Promise<void> {
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

  // ── 前置清理：终止遗留守护进程（v8.3.60+ schedule/watch 已移除）──
  const daemonCleanup = cleanupLegacyDaemons();
  if (daemonCleanup.killed > 0) {
    logger.info(`  🛑 已终止 ${daemonCleanup.killed} 个遗留守护进程 (PID: ${daemonCleanup.pids.join(', ')})`);
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

  // ── 0. 清理废弃文件 ──
  // v8.3.25+: SETTINGS.md 已废弃，由 .speccore.yml 替代
  try {
    const settingsMd = join(speccoreDir, 'SETTINGS.md');
    if (await pathExists(settingsMd)) {
      await require('fs-extra').remove(settingsMd);
      logger.info('  🗑️  清理废弃文件: .speccore/SETTINGS.md');
    }
  } catch { /* 静默失败 */ }

  // v8.3.60+: schedule/watch 命令已移除，清理遗留数据文件
  try {
    const scheduleJson = join(speccoreDir, 'local', 'schedule.json');
    if (await pathExists(scheduleJson)) {
      await require('fs-extra').remove(scheduleJson);
      logger.info('  🗑️  清理废弃文件: .speccore/local/schedule.json');
    }
  } catch { /* 静默失败 */ }

  // v8.3.28+: 清理 templates/ 下旧版残留 skill 文件（已被 .agents/skills/ 替代）
  const legacyTemplateSkills = [
    join(projectRoot, 'templates', 'spec-ask.md'),
    join(projectRoot, 'templates', 'commands', 'spec-analyze.md'),
    join(projectRoot, 'templates', 'commands', 'spec-dev.md'),
    join(projectRoot, 'templates', 'commands', 'spec-execute.md'),
    join(projectRoot, 'templates', 'commands', 'spec-split.md'),
  ];
  for (const legacySkill of legacyTemplateSkills) {
    try {
      if (await pathExists(legacySkill)) {
        await require('fs-extra').remove(legacySkill);
        logger.info(`  🗑️  清理废弃模板: ${relative(projectRoot, legacySkill)}`);
      }
    } catch { /* 静默失败 */ }
  }

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

  // v8.3.62+: 同步写入 last-init-version.txt（checkUpgradeHints 读取此文件）
  const lastInitFile = join(speccoreDir, 'local', 'last-init-version.txt');
  await writeFile(lastInitFile, CURRENT_VERSION);

  // v8.3.62+: 重置 onboard 标记，确保升级后首次 ask 展示引导页
  try { await unlink(join(speccoreDir, 'local', '.ask-onboarded')); } catch {}

  // v8.3.62+: 生成升级欢迎页（与 init 保持一致）
  await writeUpgradePage(projectRoot, CURRENT_VERSION, speccoreDir);

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
  if (await pathExists(skillsSrc) && skillsSrc !== skillsDest) {
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

  // 4c-2. 全面升级检查（v8.3.25+）
  //        自动检查所有必要文件的升级问题
  const upgradeResult = await checkAllUpgradeIssues(projectRoot);

  // 4c-3. 更新 .speccore.yml（系统配置）
  //       如不存在则生成默认配置；如已存在则：
  //         - 纯新增字段 → 自动补全（安全，不覆盖用户数据）
  //         - 结构性变更 → 提示确认（需人工审核）
  //       AI-RULES.md 是纯生成物（AI 参考手册），直接覆盖
  try {
    const configPath = join(projectRoot, '.speccore.yml');
    if (!(await pathExists(configPath))) {
      await initConfig();
    } else {
      const { config, warnings } = await loadConfigWithMeta();
      const diff = detectConfigDiff(config, DEFAULT_CONFIG);
      const needsConfirm = requiresUserConfirmation(diff);
      const hasSchemaIssue = config.schema_version < CURRENT_SCHEMA_VERSION;
      const hasAddedOnly = diff.added.length > 0 && !needsConfirm;
      const hasChanges = hasAddedOnly || needsConfirm || warnings.length > 0 || hasSchemaIssue;

      if (hasChanges) {
        logger.info('');
        logger.info('📋 .speccore.yml 配置检查');

        if (hasAddedOnly) {
          // 纯新增字段：自动补全
          logger.info(`   📌 发现 ${diff.added.length} 个新增字段，自动补全中...`);
          for (const p of diff.added) logger.info(`      + ${p}`);
          try {
            await upgradeConfig();
            logger.info('   ✅ 已自动补全新增字段');
          } catch (e: any) {
            logger.warn(`   ⚠️  自动补全失败: ${e.message || e}`);
            logger.info('   请手动运行: speccore config --upgrade');
          }
        }

        if (needsConfirm) {
          logger.info('   ⚠️  检测到结构性变更，需要人工确认：');
          for (const line of formatConfigDiff(diff)) {
            if (!line.startsWith('📌')) logger.info(`      ${line}`);
          }
          // v8.3.97+: 交互式确认（--yes 跳过）
          const autoYes = options.yes || !process.stdin.isTTY;
          if (autoYes) {
            logger.info('   ⏭️  跳过交互确认（--yes 模式或非 TTY）');
            logger.info('   建议查看差异报告后再运行 speccore config --upgrade');
          } else {
            const confirmed = await askConfirm('   是否立即执行配置升级？');
            if (confirmed) {
              try {
                await upgradeConfig();
                logger.info('   ✅ 配置升级已完成');
              } catch (e: any) {
                logger.warn(`   ⚠️  升级失败: ${e.message || e}`);
                logger.info('   请手动运行: speccore config --upgrade');
              }
            } else {
              logger.info('   ⏭️  已跳过配置升级');
              logger.info('   稍后手动运行: speccore config --upgrade');
            }
          }
        }

        if (hasSchemaIssue && !hasAddedOnly && !needsConfirm) {
          logger.info(`   ⚠️  schema_version 过期: ${config.schema_version} < ${CURRENT_SCHEMA_VERSION}`);
          logger.info('   运行 speccore config --upgrade 可升级');
        }

        if (warnings.length > 0) {
          for (const w of warnings) logger.info(`   ${w}`);
        }

        logger.info('');
      }
    }
    await writeFile(join(speccoreDir, 'AI-RULES.md'), generateAIRulesContent());
  } catch {}

  // 4c-4. 更新 .speccore/PROJECT.yaml（项目配置）
  //       如不存在则生成默认配置；如已存在则：
  //         - 纯新增字段 → 自动补全
  //         - 结构性变更 → 提示确认
  try {
    const projectYamlPath = join(projectRoot, '.speccore', 'PROJECT.yaml');
    if (!(await pathExists(projectYamlPath))) {
      const projectName = require('path').basename(projectRoot);
      await initProjectConfig(projectName);
    } else {
      const { config, warnings } = await loadProjectConfigWithMeta();
      const diff = detectConfigDiff(config, DEFAULT_PROJECT_CONFIG);
      const needsConfirm = requiresUserConfirmation(diff);
      const hasAddedOnly = diff.added.length > 0 && !needsConfirm;
      const hasChanges = hasAddedOnly || needsConfirm || warnings.length > 0;

      if (hasChanges) {
        logger.info('');
        logger.info('📋 .speccore/PROJECT.yaml 配置检查');

        if (hasAddedOnly) {
          logger.info(`   📌 发现 ${diff.added.length} 个新增字段，自动补全中...`);
          for (const p of diff.added) logger.info(`      + ${p}`);
          try {
            await upgradeProjectConfig();
            logger.info('   ✅ 已自动补全新增字段');
          } catch (e: any) {
            logger.warn(`   ⚠️  自动补全失败: ${e.message || e}`);
            logger.info('   请手动运行: speccore config --upgrade --project');
          }
        }

        if (needsConfirm) {
          logger.info('   ⚠️  检测到结构性变更，需要人工确认：');
          for (const line of formatConfigDiff(diff)) {
            if (!line.startsWith('📌')) logger.info(`      ${line}`);
          }
          // v8.3.97+: 交互式确认（--yes 跳过）
          const autoYes = options.yes || !process.stdin.isTTY;
          if (autoYes) {
            logger.info('   ⏭️  跳过交互确认（--yes 模式或非 TTY）');
            logger.info('   建议查看差异报告后再运行 speccore config --upgrade --project');
          } else {
            const confirmed = await askConfirm('   是否立即执行配置升级？');
            if (confirmed) {
              try {
                await upgradeProjectConfig();
                logger.info('   ✅ 配置升级已完成');
              } catch (e: any) {
                logger.warn(`   ⚠️  升级失败: ${e.message || e}`);
                logger.info('   请手动运行: speccore config --upgrade --project');
              }
            } else {
              logger.info('   ⏭️  已跳过配置升级');
              logger.info('   稍后手动运行: speccore config --upgrade --project');
            }
          }
        }

        if (warnings.length > 0) {
          for (const w of warnings) logger.info(`   ${w}`);
        }

        logger.info('');
      }
    }
  } catch {}

  // v8.3.60+: 初始化/升级环境配置
  let envConfigCreated: string[] = [];
  try {
    envConfigCreated = await initEnvironmentConfigs(projectRoot);
  } catch {}

  // v8.3.60+: 初始化/升级测试配置
  let testConfigCreated: string[] = [];
  try {
    testConfigCreated = await initTestConfigs(projectRoot);
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

  // v8.3.41+: update 时补充创建用户自定义模板目录（之前只在 init 中创建）
  const templatesDir = join(projectRoot, '.speccore', 'templates');
  await ensureDir(join(templatesDir, 'global'));
  await ensureDir(join(templatesDir, 'iteration'));
  await ensureDir(join(templatesDir, 'task'));

  // v6.98.0+: 同步 AGENTS.md — 将 .speccore/ 规范数据库投影到 AGENTS.md
  // v8.3.46+: force 模式 — 重新生成手动区，不保留旧内容（用户自定义内容需手动备份）
  await syncAgentsMd(projectRoot, true);

  // v8.3.62+: 检查全局 CLI 是否需要更新（与 init 保持一致）
  try {
    const globalVer = execSync('speccore --version', { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' }).trim();
    if (globalVer !== CURRENT_VERSION) {
      logger.warn(`⚠️  全局 speccore CLI 版本: ${globalVer}，项目要求: ${CURRENT_VERSION}`);
      logger.warn(`   👉 请执行: npm update -g speccore`);
      logger.warn(`   否则 AI 运行的 analyze/split/plan 等命令会使用旧版本，导致结果异常`);
    }
  } catch { /* non-critical */ }

  const verLabel = isSameVersion ? `v${CURRENT_VERSION}` : `v${oldVersion} → v${CURRENT_VERSION}`;
  spinner.stop(`升级完成: ${verLabel}`);
  logger.info('');
  logger.info('━'.repeat(50));
  logger.info(`🔄 SpecCore ${isSameVersion ? '命令文件已强制更新' : '升级完成'}`);
  logger.info('');
  logger.info('  📦 以下文件已同步到最新版本:');
  logger.info('     ✅ .agents/skills/ — Skill 全量更新');
  logger.info('     ✅ AGENTS.md — 项目规则');
  logger.info('     ✅ .speccore.yml — 系统配置');
  logger.info('     ✅ .speccore/PROJECT.yaml — 项目配置');
  logger.info('     ✅ AI-RULES.md — AI 参考手册');
  logger.info('     ✅ .speccore/AGENTS/ — 角色定义规范库');
  logger.info('     ✅ .speccore/RULES/ — 编码规范库');
  logger.info('     ✅ .speccore/COMMANDS/ — 命令模板库');
  logger.info('     ✅ .speccore/SKILLS/ — 可复用技能库');
  logger.info('     ✅ .speccore/HOOKS/ — 生命周期钩子库');
  if (envConfigCreated.length > 0) {
    logger.info('     ✅ .speccore/environments/ — 环境配置');
    for (const f of envConfigCreated) {
      logger.info(`        + ${f}`);
    }
  }
  if (testConfigCreated.length > 0) {
    logger.info('     ✅ .speccore/tests/ — 测试配置');
    for (const f of testConfigCreated) {
      logger.info(`        + ${f}`);
    }
  }
  logger.info('');

  // 全面升级问题报告（过滤 update 自动修复的问题）
  // missing-dir / missing-file 由 update 流程自动创建，不在报告中重复提示
  const manualIssues = upgradeResult.issues.filter(
    i => i.type !== 'missing-dir' && i.type !== 'missing-file'
  );
  if (manualIssues.length > 0) {
    logger.info('━'.repeat(50));
    logger.info('');
    logger.info('  ⚠️  检测到以下升级问题，需要手动处理:');
    logger.info('');

    // 按文件分组展示
    const byFile = new Map<string, UpgradeIssue[]>();
    for (const issue of manualIssues) {
      const list = byFile.get(issue.file) || [];
      list.push(issue);
      byFile.set(issue.file, list);
    }

    for (const [file, issues] of byFile) {
      logger.info(`  📄 ${file}:`);
      for (const issue of issues) {
        logger.info(`     • ${issue.message}`);
        if (issue.suggestion) {
          logger.info(`       💡 ${issue.suggestion}`);
        }
      }
      logger.info('');
    }

    if (upgradeResult.reports.length > 0) {
      logger.info('  📝 详细报告见:');
      for (const report of upgradeResult.reports) {
        logger.info(`     ${report.path}`);
      }
      logger.info('');
    }

    logger.info('━'.repeat(50));
    logger.info('');
  }
  // 冲突文件汇总
  if (_updateConflicts.length > 0) {
    logger.info(`  ⚠️  ${_updateConflicts.length} 个文件有内容冲突，旧版已重命名为时间戳格式`);
    for (const { file, backup } of _updateConflicts) {
      const rel = relative(projectRoot, file);
      const backupRel = relative(projectRoot, backup);
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

}

// ── 全面升级检查（v8.3.25+）──
// speccore update 时自动检查所有必要文件的升级问题
interface UpgradeIssue {
  file: string;
  type: 'structural-diff' | 'missing-field' | 'missing-file' | 'missing-dir' | 'format-deprecated';
  message: string;
  suggestion?: string;
}

interface UpgradeCheckResult {
  hasIssues: boolean;
  issues: UpgradeIssue[];
  reports: Array<{ file: string; path: string }>;
}

async function checkAllUpgradeIssues(projectRoot: string): Promise<UpgradeCheckResult> {
  const result: UpgradeCheckResult = { hasIssues: false, issues: [], reports: [] };
  const speccoreDir = join(projectRoot, '.speccore');

  // ── 1. 系统配置 .speccore.yml ──
  try {
    const systemConfigPath = join(projectRoot, '.speccore.yml');
    if (await pathExists(systemConfigPath)) {
      const { config } = await loadConfigWithMeta();
      const diff = detectConfigDiff(config, DEFAULT_CONFIG);
      if (requiresUserConfirmation(diff)) {
        result.hasIssues = true;
        const lines = formatConfigDiff(diff);
        for (const line of lines) {
          result.issues.push({
            file: '.speccore.yml',
            type: 'structural-diff',
            message: line,
            suggestion: '运行: speccore config --upgrade',
          });
        }
        try {
          const reportPath = join(speccoreDir, 'config', 'upgrade-diff-system.md');
          await ensureDir(join(speccoreDir, 'config'));
          const reportLines = [
            '# .speccore.yml 升级差异报告',
            '',
            `生成时间: ${new Date().toLocaleString('zh-CN')}`,
            `当前 schema_version: ${config.schema_version}`,
            '',
            '## 检测到的变更',
            '',
            ...lines,
            '',
            '## 处理建议',
            '',
            '运行: speccore config --upgrade',
          ];
          await writeFile(reportPath, reportLines.join('\n'), 'utf-8');
          result.reports.push({ file: '.speccore.yml', path: reportPath });
        } catch { /* 静默失败 */ }
      }
    }
  } catch { /* 静默失败 */ }

  // ── 2. 项目配置 .speccore/PROJECT.yaml ──
  try {
    const projectConfigPath = join(speccoreDir, 'PROJECT.yaml');
    if (await pathExists(projectConfigPath)) {
      const { config } = await loadProjectConfigWithMeta();
      const diff = detectConfigDiff(config, DEFAULT_PROJECT_CONFIG);
      if (requiresUserConfirmation(diff)) {
        result.hasIssues = true;
        const lines = formatConfigDiff(diff);
        for (const line of lines) {
          result.issues.push({
            file: '.speccore/PROJECT.yaml',
            type: 'structural-diff',
            message: line,
            suggestion: '运行: speccore config --upgrade --project',
          });
        }
        try {
          const reportPath = join(speccoreDir, 'config', 'upgrade-diff-project.md');
          await ensureDir(join(speccoreDir, 'config'));
          const reportLines = [
            '# .speccore/PROJECT.yaml 升级差异报告',
            '',
            `生成时间: ${new Date().toLocaleString('zh-CN')}`,
            `当前 schema_version: ${config.schema_version}`,
            '',
            '## 检测到的变更',
            '',
            ...lines,
            '',
            '## 处理建议',
            '',
            '运行: speccore config --upgrade --project',
          ];
          await writeFile(reportPath, reportLines.join('\n'), 'utf-8');
          result.reports.push({ file: '.speccore/PROJECT.yaml', path: reportPath });
        } catch { /* 静默失败 */ }
      }
    }
  } catch { /* 静默失败 */ }

  // ── 3. context.json 格式检查 ──
  try {
    const contextPath = join(speccoreDir, 'local', 'context.json');
    if (await pathExists(contextPath)) {
      const ctx = JSON.parse(await readFile(contextPath, 'utf-8'));
      const expectedFields = ['currentIteration', 'history'];
      const missingFields = expectedFields.filter(f => !(f in ctx));
      if (missingFields.length > 0) {
        result.hasIssues = true;
        result.issues.push({
          file: '.speccore/local/context.json',
          type: 'missing-field',
          message: `缺少字段: ${missingFields.join(', ')}`,
          suggestion: '建议备份后重新初始化，或手动补充缺失字段',
        });
      }
    }
  } catch { /* 静默失败 */ }

  // ── 4. 规范数据库目录完整性检查 ──
  const requiredDbDirs = ['AGENTS', 'RULES', 'COMMANDS', 'SKILLS', 'HOOKS'];
  for (const dir of requiredDbDirs) {
    const dirPath = join(speccoreDir, dir);
    if (!(await pathExists(dirPath))) {
      result.hasIssues = true;
      result.issues.push({
        file: `.speccore/${dir}/`,
        type: 'missing-dir',
        message: `规范数据库目录缺失`,
        suggestion: '运行: speccore init --update 可自动创建',
      });
    }
  }

  // ── 5. AI-RULES.md 存在性检查 ──
  try {
    const aiRulesPath = join(speccoreDir, 'AI-RULES.md');
    if (!(await pathExists(aiRulesPath))) {
      result.hasIssues = true;
      result.issues.push({
        file: '.speccore/AI-RULES.md',
        type: 'missing-file',
        message: 'AI 参考手册缺失',
        suggestion: '运行: speccore init --update 可自动生成',
      });
    }
  } catch { /* 静默失败 */ }

  // ── 6. 迭代目录旧结构检测 ──
  try {
    const entries = await require('fs-extra').readdir(projectRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('Iteration-')) {
        const iterDir = join(projectRoot, entry.name);
        const files = await require('fs-extra').readdir(iterDir);
        if (files.some((f: string) => f.match(/^Task-\d+$/))) {
          result.hasIssues = true;
          result.issues.push({
            file: `${entry.name}/`,
            type: 'format-deprecated',
            message: '检测到旧版任务目录结构（Task-NNN 平铺）',
            suggestion: '运行: speccore migrate --iter ' + entry.name,
          });
          break;
        }
      }
    }
  } catch { /* 静默失败 */ }

  return result;
}
