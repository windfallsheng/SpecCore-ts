/**
 * update — 项目升级命令
 * 只增量更新工具命令文件 + 配置模板，不覆盖用户数据
 */
import { writeFile, pathExists, readFile, readdir, ensureDir } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../utils/logger';

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

export async function updateCommand(options: { force?: boolean }): Promise<void> {
  const projectRoot = process.cwd();
  const spinner = new Spinner('检测项目状态...');
  spinner.start();

  // 检查是否已初始化
  const speccoreDir = join(projectRoot, '.speccore');
  if (!(await pathExists(speccoreDir))) {
    spinner.fail('项目未初始化，请先运行 speccore init');
    return;
  }

  // 读取当前版本
  const verFile = join(speccoreDir, 'local', 'version.json');
  let oldVersion = 'unknown';
  if (await pathExists(verFile)) {
    try { oldVersion = JSON.parse(await readFile(verFile, 'utf-8')).version; } catch {}
  }

  if (oldVersion === CURRENT_VERSION && !options.force) {
    spinner.stop(`已是最新版本 v${CURRENT_VERSION}`);
    return;
  }

  logger.info(`  从 v${oldVersion} 升级到 v${CURRENT_VERSION}...`);

  let added = 0, updated = 0, cleaned = 0;
  const addedFiles: string[] = [];
  const updatedFiles: string[] = [];
  const cleanedFiles: string[] = [];

  // ── 1. 更新工具目录命令文件 ──
  const tools = ['.claude', '.codebuddy', '.cursor', '.trae', '.windsurf'];
  const qoderDir = join(projectRoot, '.qoder', 'commands', 'spec');

  for (const tool of tools) {
    const toolCommandsDir = join(projectRoot, tool, 'commands');
    for (const [name, desc, cmd] of ALL_COMMANDS) {
      const p = join(toolCommandsDir, name + '.md');
      const content = `---\nname: ${name}\ndescription: ${desc}\n---\n${cmd}`;
      if (await pathExists(p)) {
        const existing = await readFile(p, 'utf-8');
        if (existing.trim() !== content.trim()) {
          await writeFile(p, content);
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
          await writeFile(p, content);
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

  spinner.stop(`升级完成: v${oldVersion} → v${CURRENT_VERSION}`);
  logger.info('');
  if (addedFiles.length > 0) {
    logger.info(`  ✨ 新增 ${added} 个命令:`);
    for (const f of addedFiles) logger.info(`     + ${f}`);
  }
  if (updatedFiles.length > 0) {
    logger.info(`  🔄 更新 ${updated} 个命令:`);
    for (const f of updatedFiles.slice(0, 5)) logger.info(`     ~ ${f}`);
    if (updatedFiles.length > 5) logger.info(`     ... 等 ${updatedFiles.length} 个文件`);
  }
  if (cleanedFiles.length > 0) {
    logger.info(`  🗑  清理 ${cleaned} 个旧文件:`);
    for (const f of cleanedFiles) logger.info(`     - ${f}`);
  }
  if (added === 0 && updated === 0 && cleaned === 0) {
    logger.info('  所有命令文件已是最新，无需更新');
  }
  logger.info('');
  logger.info('配置文件和 INDEX.md 等用户数据保持不变 ✅');
}
