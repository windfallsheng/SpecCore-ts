import { program } from 'commander';
import { version } from '../package.json';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { initCommand } from './commands/init';
import { validateCommand } from './commands/validate';
import { archiveCommand } from './commands/archive';
import { progressCommand } from './commands/progress';
import { statusCommand } from './commands/status';
import { healthCommand } from './commands/health';
import { reportCommand } from './commands/report';
import { configCommand } from './commands/config';
import { iterationCreateCommand } from './commands/iteration/create';
import { iterationSplitCommand } from './commands/iteration/split';
import { taskNewCommand } from './commands/task/new';
import { planCommand } from './commands/plan';
import { executeCommand } from './commands/execute';
// 新增命令
import { askCommand } from './commands/ask';
import { changeCommand } from './commands/change';
import { syncCommand } from './commands/sync';
import { opsCommand } from './commands/history';
import { patternCommand } from './commands/pattern';
import { rollbackCommand } from './commands/rollback';
import { handoverCommand } from './commands/handover';
import { helpCommand } from './commands/help';
import { devCommand } from './commands/dev';
import { welcomeCommand } from './commands/welcome';
import { statusPanelCommand } from './commands/status-panel';
import { doc2specCommand } from './commands/doc2spec';
// 全量层命令
import { iterationFromGlobalCommand } from './commands/iteration-from-global';
import { syncGlobalCommand } from './commands/sync-global';
import { globalStatusCommand } from './commands/global-status';
// P0/P1/P2 新增命令
import { impactCommand } from './commands/impact';
import { baselineCommand } from './commands/baseline';
import { dashboardCommand } from './commands/dashboard';
import { auditCommand } from './commands/audit';
import { analyzeCommand } from './commands/analyze';
import { lifecycleCommand } from './commands/lifecycle';
import { prCommand } from './commands/pr';
import { buildConstitution } from './core/constitution-builder';
import { contextCommand } from './commands/context-output';
import { doneCommand } from './commands/done';
// rename 命令
import { renameCommand } from './commands/rename';
// v4.0.0 新增命令
// v4.6.0 迁移命令
// v4.7.0 体验增强
import { completionCommand } from './commands/completion';
// v4.8.0 高级功能

// v4.9.0 完善
import { updateCommand } from './commands/update';
// v5.3.0 新增
import { diffCommand } from './commands/diff';
import { traceCommand } from './commands/trace';
import { mergeCheck, rollbackTask, updateArchitecture } from './commands/merge-check';
import { trackerCommand } from './commands/tracker';
// v5.5.0 新增
import { deleteCommand } from './commands/delete';
// v5.6.0 新增
import { searchCommand } from './commands/search';
import { watchCommand } from './commands/watch';
// v5.21.0 任务调度
import {
  scheduleCreateCommand,
  scheduleListCommand,
  scheduleDetailCommand,
  scheduleCancelCommand,
  scheduleDeleteCommand,
  scheduleDaemonCommand,
} from './commands/schedule';
import { i18n } from './i18n';

program
  .name('speccore')
  .description('SpecCore - Code by Spec, Not by Vibe.')
  .version(version, '-v, --version', 'Display current version')
  .option('--lang <locale>', 'Language: zh-CN (default) or en-US', 'zh-CN')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.lang && (opts.lang === 'zh-CN' || opts.lang === 'en-US')) {
      i18n.setLocale(opts.lang);
    }
  });

// ── 模式检测：简洁版(默认) vs 全量版 ──
function readMode(): 'simple' | 'full' {
  try {
    const p = join(process.cwd(), '.speccore', 'config', 'mode.json');
    if (existsSync(p)) {
      const data = JSON.parse(readFileSync(p, 'utf-8'));
      return data.mode === 'full' ? 'full' : 'simple';
    }
  } catch { /* ignore */ }
  return 'simple';
}

const MODE = readMode();

/** 简洁模式下在 help 中显示的命令 */
const SIMPLE_COMMANDS = new Set([
  'ask', 'init', 'doc2spec', 'analyze', 'split', 'execute',
  'pr', 'done', 'status-panel', 'dev',
  'iteration', 'task', 'plan', 'ops', 'change', 'validate', 'rename',
  ]);

/** 简洁模式下过滤 help 命令列表 */
function filterCommands(commands: readonly import('commander').Command[]): import('commander').Command[] {
  if (MODE === 'full') return [...commands];
  return [...commands].filter(c => SIMPLE_COMMANDS.has(c.name()));
}

program.configureHelp({
  visibleCommands: (cmd) => filterCommands(cmd.commands),
});
program
  .command('ask [input...]')
  .description('Natural language intent recognition (previously "spec")')
  .action((input: string[]) => askCommand(input.join(' '), {}));

// ================================================================
// 👋 引导与体验
// ================================================================

program
  .command('status-panel')
  .alias('sp')
  .description('IDE-style status panel: phase + tasks + progress + next action')
  .option('--export <format>', 'Export: json | md | html')
  .option("--assignee <name>", "导出指定人员的统计")
  .option("--platform <platform>", "导出指定平台: backend | frontend | web | h5 | miniapp")
  .option("--type <type>", "导出指定类型: feature | bugfix | research")
  .action(statusPanelCommand);

program
  .command('open')
  .alias('opn')
  .description('Open task files in editor')
  .option('-t, --task <task>', 'Task to open')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .action(async (options: any) => {
    const { getDefaultIteration } = await import('./core/context');
    const it = await getDefaultIteration(options.iteration);
    if (!it) return;
    const fs = require('fs');
    const iterDir = `期次-${it}`;
    const entries = fs.readdirSync(iterDir, { withFileTypes: true });
    const task = entries.find((e: any) => e.isDirectory() && e.name.startsWith(options.task || ''));
    if (task) {
      const { logger } = require('./utils/logger');
      logger.info(`\n📂 ${task.name}:`);
      const files = ['REQ.md', 'TECH.md', 'TASK.md', 'TEST.md', 'API_CONTRACT.yaml'];
      for (const f of files) {
        const path = require('path').join(iterDir, task.name, f.startsWith('API') ? '_shared' : 'backend', f);
        if (fs.existsSync(path)) logger.info(`  ${path}`);
      }
    }
  });

program
program
  .command('dev')
  .alias('d')
  .description('智能级联：--auto 全自动流水线，--from/--to 指定起止阶段')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--force', 'Auto-execute without confirmation')
  .option('--auto', '全自动流水线：init→doc2spec→analyze→split→plan→execute→pr→done')
  .option('--from <phase>', '从指定阶段开始（init/doc2spec/analyze/split/plan/execute/pr/done）')
  .option('--to <phase>', '到指定阶段结束（init/doc2spec/analyze/split/plan/execute/pr/done）')
  .action(devCommand);

program

// ================================================================
// 🏗️ 初始化与导入
// ================================================================
program
  .command('init')
  .alias('in')
  .description('初始化 SpecCore（17命令/51全量，--interactive 引导式）')
  .option('--mode <mode>', 'Initialization mode: fresh or migration', 'fresh')
  .option('--full', 'Full mode: all 51 commands (default: simple)')
  .option('--force', 'Force overwrite existing configuration')
  .option('--interactive', 'Interactive guided setup: mode → confirm → init')
  .option('--auto', '全自动流水线：无人干预级联执行全部阶段')
  .option('--from <phase>', '从指定阶段开始（init/analyze/split/plan/execute/pr/done）')
  .action(initCommand);

// ================================================================
// 📋 期次管理
// ================================================================
const iterationCmd = program
  .command('iteration')
  .alias('it')
  .description('Iteration management commands');

iterationCmd

iterationCmd
  .command('split')
  .alias('sp')
  .description('拆分需求为独立Task：预览→逐一确认/一键创建')
  .option('-f, --file <file>', 'Requirement file path', 'REQUIREMENT.md')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--sections <sections>', 'Specific sections to split')
  .option('--target <target>', 'Merge into existing task')
  .option('-p, --platforms <platforms>', 'Comma-separated platforms (auto-detected if omitted)')
  .option('--dry-run', 'Preview without creating')
  .option('--interactive', 'Preview → adjust → confirm before creating')
  .option('--strict', 'Review each section before creating tasks')
  .option('--scheduled', '夜间调度：只执行标记为 queue 的任务')
  .option('--verify', '生成代码后自动检查 TEST/REVIEW/DEPLOY → 最多3轮自动修复')
  .action(iterationSplitCommand);

// ================================================================
// 📝 任务管理
// ================================================================
const taskCmd = program
  .command('task')
  .alias('tk')
  .description('Task management commands');

taskCmd

// 完整需求交付
program

// Bug 修复
// 技术调研
program

program
  .command('pr')
  .alias('mr')
  .description('创建 Pull Request：提交预览+文件选择+交互确认')
  .option('-t, --task <task>', 'Target task (auto-detect from branch if omitted)')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--base <branch>', 'Base branch', 'main')
  .option('--draft', 'Create as draft PR')
  .option('--interactive', '分步：预览变更 → 选文件 → commit → 推送 → 创建PR')
  .option('--title <title>', 'Custom PR title')
  .action(prCommand);

program
  .command('plan')
  .alias('pl')
  .description('生成执行计划+管理历史：创建/交互/列表/详情/取消/删除')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('-t, --team <count>', 'Team member count', '3')
  .option('-a, --assign <members>', 'Assign to specific members (comma-separated)')
  .option('--type <type>', 'Filter by task type')
  .option('--priority <priority>', 'Filter by priority')
  .option('--mode <mode>', 'Plan mode: auto, claim, parallel', 'auto')
  .option('--dry-run', 'Preview without saving')
  .option('--interactive', 'Preview → adjust → confirm before saving')
  .option('--list', 'Show plan history')
  .option('--show <id>', 'Show plan detail')
  .option('--delete <id>', 'Delete a plan')
  .option('--cancel <id>', 'Cancel a plan (keep record)')
  .action(planCommand);

program
  .command('execute')
  .alias('ex')
  .description('执行开发任务：依赖排序+分批+交互引导+计划联动')
  .option('--all', 'Execute all pending tasks')
  .option('-a, --assignee <assignee>', 'Filter by assignee')
  .option('-t, --task <task>', 'Execute specific task')
  .option('--type <type>', 'Filter by task type')
  .option('--priority <priority>', 'Filter by priority')
  .option('--status <status>', 'Filter by status')
  .option('--backend', 'Backend tasks only')
  .option('--frontend', 'Frontend tasks only')
  .option('--platform <platform>', 'Filter by frontend platform (web/h5/miniapp)')
  .option('--plan <id>', 'Execute a saved plan (from speccore plan --list)')
  .option('--interactive', 'Interactive selection')
  .option('--dry-run', 'Preview execution plan')
  .option('--resume', 'Resume from last interruption')
  .option('--batch-size <n>', 'Batch size for context isolation (default 3)')
  .option('--parallel <count>', 'Parallel execution count', '1')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--force', 'Skip preview and execute directly')
  .option('--auto', '全自动流水线：无人干预级联执行全部阶段')
  .option('--from <phase>', '从指定阶段开始（init/analyze/split/plan/execute/pr/done）')
  .option('--strict', 'Pre-flight check: review req/tech/test before code gen')
  .option('--scheduled', '夜间调度：只执行标记为 queue 的任务')
  .option('--verify', '生成代码后自动检查 TEST/REVIEW/DEPLOY → 最多3轮自动修复')
  .option('--base <branch>', 'Base branch for task branching (default: current)')
  .option('--skip <tasks>', 'Comma-separated task IDs to skip')
  .option('--only <tasks>', 'Comma-separated task IDs to execute exclusively (whitelist)')
  .option('--agent <tool>', 'External AI: copilot/claude/cursor/trae/qoder/windsurf/codebuddy')
  .option('--hotfix', 'Emergency fix: skip reverse sync (30min grace, 24h mandatory)')
  .action(executeCommand);

// ================================================================
// 任务调度（已通过 WorkBuddy Automation 实现）
// ================================================================

// ================================================================
// 🔄 变更管理
// ================================================================
program
  .command('change')
  .alias('ch')
  .description('需求变更：联动更新所有关联 Spec → 支持口语')
  .option('-t, --task <task>', 'Target task')
  .option('-r, --req <req>', 'Requirement ID')
  .option('-d, --desc <desc>', 'Change description')
  .option('--input <text>', '自然语言输入（口语化描述）')
  .option('--global', 'Global layer change (CONSTITUTION.md)')
  .option('--requirement', 'Also update REQUIREMENT.md')
  .option('--analysis', 'Also update ANALYSIS.md')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--dry-run', 'Preview impact without modifying')
  .option('--force', 'Skip preview and apply directly')
  .option('--auto', '全自动流水线：无人干预级联执行全部阶段')
  .option('--from <phase>', '从指定阶段开始（init/analyze/split/plan/execute/pr/done）')
  .option('--interactive', 'Interactive: preview → adjust → confirm → apply')
  .action(changeCommand);

program
  .command('sync')
  .alias('sy')
  .description('双向同步：代码↔Spec，--global 同步到全局层')
  .option('-t, --task <task>', 'Target task')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--auto', 'Auto-apply sync without confirmation')
  .option('--dry-run', 'Preview differences without modifying')
  .option('--force', 'Skip preview')
  .option('--auto', '全自动流水线：无人干预级联执行全部阶段')
  .option('--from <phase>', '从指定阶段开始（init/analyze/split/plan/execute/pr/done）')
  .option('--detect', 'Detect code-spec discrepancies (read-only, no changes)')
  .action(syncCommand);

// ================================================================
// ✅ 审查与验证
// ================================================================
program
  .command('validate')
  .alias('vl')
  .description('Validate Spec compliance and integrity')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('-t, --task <task>', 'Validate specific task')
  .option('--type <type>', 'Filter by task type')
  .option('--fix', 'Auto-fix issues where possible')
  .option('--strict', 'Strict validation mode')
  .option('--scheduled', '夜间调度：只执行标记为 queue 的任务')
  .option('--verify', '生成代码后自动检查 TEST/REVIEW/DEPLOY → 最多3轮自动修复')
  .option('--format <format>', 'Output format: text, json', 'text')
  .action(validateCommand);

// ================================================================
// 📊 进度与状态
// ================================================================
program

program
  .command('status')
  .alias('st')
  .description('Display current project status')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('-a, --assignee <assignee>', 'Filter by assignee')
  .option('--type <type>', 'Filter by task type')
  .action(statusCommand);

program
  .command('health')
  .alias('hl')
  .description('Generate project health report')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--format <format>', 'Output format: text, json', 'text')
  .option('--trend', 'Include trend comparison')
  .action(healthCommand);

// ================================================================
// 📦 归档与交接
// ================================================================
program

program
  .command('handover')
  .alias('ho')
  .description('Generate handover documentation for current iteration')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('-o, --output <path>', 'Output file path')
  .option('--format <format>', 'Output format: md', 'md')
  .action(handoverCommand);

program

// ================================================================
// ⚙️ 配置与工具
// ================================================================
program
  .command('context')
  .alias('ctx')
  .description('Output task context for any AI tool (Copilot/Claude/GPT)')
  .option('-t, --task <task>', 'Target task')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .action(contextCommand);

program

program
  .command('constitution')
  .alias('cn')
  .description('Auto-detect tech stack and generate CONSTITUTION.md rules')
  .action(async () => { await buildConstitution(process.cwd()); });

program

program

program

program
  .command('config')
  .alias('cf')
  .description('Manage SpecCore configuration and code rules')
  .option('--get <key>', 'Get configuration value')
  .option('--set <key=value>', 'Set configuration value (SETTINGS.md)')
  .option('-r, --rule <name>', 'Target spec-rule (CONSTITUTION.md)')
  .option('-t, --tech <target>', 'Target tech-stack (TECH_STACK.md): backend | frontend')
  .option('--reset', 'Reset to default configuration')
  .action(configCommand);

program

program

// ================================================================
// 📖 帮助
// ================================================================
program
  .command('help')
  .alias('h')
  .description('Display command help and search')
  .option('--command <command>', 'Show detailed help for specific command')
  .option('--search <keyword>', 'Search commands by keyword')
  .option('--examples', 'Show complete scenario examples')
  .action(helpCommand);

// ================================================================
// 🌐 全量层命令
// ================================================================
program
  .command('iteration-from-global')
  .alias('ifg')
  .description('Generate iteration from global layer requirements')
  .option('--reqs <reqs>', 'Requirement IDs (comma-separated, required)')
  .option('--name <name>', 'Iteration name (required)')
  .option('--force', 'Force overwrite existing iteration')
  .option('--auto', '全自动流水线：无人干预级联执行全部阶段')
  .option('--from <phase>', '从指定阶段开始（init/analyze/split/plan/execute/pr/done）')
  .action(iterationFromGlobalCommand);

program
  .command('doc2spec')
  .alias('d2s')
  .description('导入 PRD 文档 → SpecCore Markdown（支持 Word/PDF/MD/HTML/PPTX）')
  .option('-f, --file <path>', '源文件路径')
  .option('--iter <name>', '目标期次（必填）')
  .option('-p, --platform <name>', '平台标识（backend / frontend-web / frontend-h5）')
  .option('--files <files>', '批量: "a.docx=平台1,b.pdf=平台2"')
  .action(doc2specCommand);

// ================================================================
// 📦 模式保存
// ================================================================
program
  .command('pattern')
  .alias('p')
  .description('Save current task as reusable pattern template')
  .option('-n, --name <name>', 'Pattern name')
  .option('-t, --task <task>', 'Source task ID')
  .option('-c, --content <content>', 'Manual content')
  .option('-f, --file <file>', 'Read from file path')
  .option('-d, --desc <desc>', 'Pattern description')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--force', 'Overwrite existing pattern')
  .option('--auto', '全自动流水线：无人干预级联执行全部阶段')
  .option('--from <phase>', '从指定阶段开始（init/analyze/split/plan/execute/pr/done）')
  .action(patternCommand);

// ================================================================
// 🔙 回滚
// ================================================================
program
  .command('rollback')
  .alias('rb')
  .description('Restore Spec files from .bak backups')
  .option('-t, --task <task>', 'Target task')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--list', 'List backups only, do not restore')
  .option('--confirm', 'Confirm restore (required to execute)')
  .action(rollbackCommand);

program
  .command('global-status')
  .alias('gs')
  .description('View global layer status: all projects, requirements, architecture')
  .option('--project <name>', 'Filter by project name')
  .action(globalStatusCommand);

program
  .command('ops')
  .alias('op')
  .description('View operation history (command log)')
  .action(opsCommand);

program

// ================================================================
// 🔗 P0/P1/P2 新增命令
// ================================================================
program
  .command('impact')
  .alias('if')
  .description('Intelligent impact analysis: analyze upstream/downstream effects of changes')
  .option('--req <id>', 'Requirement ID (e.g., REQ-001)')
  .option('--task <id>', 'Task ID (e.g., Task-001)')
  .option('--depth <n>', 'Trace depth (default: 3)', '3')
  .option('--output <format>', 'Output format: report, graph', 'report')
  .action(impactCommand);

program
  .command('baseline')
  .alias('bl')
  .description('Version baseline: create snapshots, compare, list, and rollback')
  .option('--name <name>', 'Baseline name')
  .option('--list', 'List all baselines')
  .option('--compare <name>', 'Compare current state with baseline')
  .option('--restore <name>', 'Restore to baseline')
  .option('--req <id>', 'Requirement ID for rollback')
  .action(baselineCommand);

program
  .command('analyze')
  .alias('al')
  .description('统一分析: 需求文档 + 源码目录 → 按范围(全局/期次/任务)生成分析报告，--audit 审计模式')
  .option('-I, --iteration <iteration>', '目标期次 (scope=iteration|task 时必填)')
  .option('-t, --task <task-id>', '任务 ID (--scope task 快捷方式)')
  .option('--scope <scope>', '输出范围: global(全局文档) | iteration(期次, 默认) | task(任务)')
  .option('--src, --source <dirs>', '源码目录 (逗号分隔: --src backend/src,frontend/src)')
  .option('--req, --requirements <files>', '需求文档 (逗号分隔: --req docs/a.md,docs/b.md)')
  .option('-o, --output <file>', '输出文件名 (覆盖默认)')
  .option('--depth <depth>', '分析深度: quick | normal(默认) | deep')
  .option('--auto', '非交互: 直接生成报告 (默认)')
  .option('--ask', '交互: AI 提问 → 回答 → 优化')
  .action(analyzeCommand);

program
  .command('audit')
  .alias('ad')
  .description('AI-powered audit: detect duplicates, ambiguity, and orphaned requirements')
  .option('--fix', 'Auto-fix fixable issues')
  .option('--detail', 'Show detailed analysis')
  .action(auditCommand);

// 重命名
program
  .command('rename')
  .alias('rn')
  .description('Rename iteration or task, auto-update all references')
  .option('--target <name>', 'Current name (required for single rename)')
  .option('--new-name <name>', 'New name (required for single rename)')
  .option('--batch', 'Batch rename mode')
  .option('--pattern <pattern>', 'Batch pattern to match')
  .option('--replacement <replacement>', 'Batch replacement string')
  .option('--force', 'Skip preview and execute')
  .option('--auto', '全自动流水线：无人干预级联执行全部阶段')
  .option('--from <phase>', '从指定阶段开始（init/analyze/split/plan/execute/pr/done）')
  .action(renameCommand);

// ================================================================
// 🆕 v4.0.0 新增命令
// ================================================================
program
  .description('快捷创建 Task（同 task new）')
  .option('-n, --name <name>', 'Task name (required)')
  .option('-t, --type <type>', 'Task type', 'feature')
  .option('-d, --desc <desc>', 'Task description')
  .option('--platforms <platforms>', 'Frontend platforms: web,h5,miniapp')
  .option('--backend-only', 'Create backend only')
  .option('--frontend-only', 'Create frontend only')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--batch <tasks>', '批量：换行分隔的多个任务描述')
  .option('--batch-file <path>', '从 Excel/CSV 文件批量导入')
  .option('--interactive', 'Preview → edit → confirm → create')
  .option('--schedule <mode>', '调度模式：night / now', 'now')
  .action(taskNewCommand);

program

program

// ================================================================
// 快捷别名（顶层别名）
// ================================================================
// 为常用命令提供顶层快捷访问
program

// v4.7.0 体验增强命令
program
program
  .command('lifecycle')
  .alias('lc')
  .description('Task lifecycle: pending → dev → test → review → done')
  .option('-t, --task <task>', 'Target task')
  .option('-s, --status <status>', 'Set status: pending/testing/review/done')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--check', 'Check TEST.md/REVIEW.md progress')
  .option('--all', 'Show all tasks kanban board')
  .action(lifecycleCommand);

program
  .command('done')
  .alias('dn')
  .description('收尾归档：校验→同步→审计，--all 批量归档，--interactive 预览确认')
  .option('--task <task>', 'Target task (comma-separated for batch)')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--all', 'Auto-archive all completed tasks in iteration')
  .option('--skip-validate', 'Skip validation step')
  .option('--skip-sync', 'Skip global sync step')
  .option('--interactive', 'Interactive: preview archive → confirm → complete')
  .action(doneCommand);

program
  .command('completion [shell]')
  .alias('cmp')
  .description('Generate shell completion script (bash/zsh)')
  .action(completionCommand);

// v4.8.0 高级功能
program

// v4.9.0 完善
program
  .command('update')
  .alias('up')
  .description('Update task attributes (v4.9)')
  .option('-t, --task <id>', 'Task ID (e.g. Task-001)')
  .option('--status <status>', 'Status: pending/in_progress/completed/blocked')
  .option('--priority <priority>', 'Priority: high/medium/low')
  .option('--assignee <name>', 'Assignee name')
  .option('--type <type>', 'Task type')
  .option('-i, --iteration <name>', 'Target iteration')
  .option('--force', 'Skip confirmation')
  .option('--auto', '全自动流水线：无人干预级联执行全部阶段')
  .option('--from <phase>', '从指定阶段开始（init/analyze/split/plan/execute/pr/done）')
  .action(updateCommand);

// v5.3.0 新增命令
program
  .command('diff')
  .alias('df')
  .description('Compare two iterations or baselines (v5.3)')
  .requiredOption('--source <name>', 'Source iteration/baseline')
  .requiredOption('--target <name>', 'Target iteration/baseline')
  .action(diffCommand);

program
  .command('tracker')
  .alias('tr')
  .description('View global requirement change tracker')
  .action(trackerCommand);

program
  .command('merge-check')
  .alias('mc')
  .description('Predict merge conflicts across task branches')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .action(async (options: any) => { const { getDefaultIteration } = await import('./core/context'); const it = await getDefaultIteration(options.iteration); if (it) await mergeCheck(it); });

program

program
  .command('arch-update')
  .alias('au')
  .description('Auto-update ARCHITECTURE.md with new APIs/tables')
  .option('-i, --iteration <iteration>', 'Source iteration')
  .option('--apis <apis>', 'Comma-separated API paths')
  .option('--tables <tables>', 'Comma-separated table names')
  .action(async (options: any) => { const it = await require('../core/context').getDefaultIteration(options.iteration); if (it) await updateArchitecture(it, (options.apis || '').split(',').filter(Boolean), (options.tables || '').split(',').filter(Boolean)); });

program

program

program

program
  .command('trace')
  .alias('tr')
  .description('Show REQ → Task → Code trace chain (v5.3)')
  .option('--req <id>', 'Trace from requirement ID')
  .option('--task <id>', 'Trace from task ID')
  .option('--full', 'Full project trace')
  .action(traceCommand);

// v5.5.0 新增命令
program
  .command('delete')
  .alias('dl')
  .description('Delete a task or iteration (moves to trash + cleans references) (v5.5)')
  .option('--task <id>', 'Task ID to delete')
  .option('--iteration <name>', 'Iteration name to delete')
  .option('--force', 'Skip confirmation prompt')
  .option('--auto', '全自动流水线：无人干预级联执行全部阶段')
  .option('--from <phase>', '从指定阶段开始（init/analyze/split/plan/execute/pr/done）')
  .action(deleteCommand);

// v5.6.0 新增命令
program
  .command('search <query>')
  .alias('sh')
  .description('Search across all Spec files for a keyword (v5.6)')
  .option('--task <id>', 'Limit search to a task')
  .option('--iteration <name>', 'Limit search to an iteration')
  .action((query: string, opts: any) => searchCommand({ ...opts, query }));

program
  .command('watch')
  .alias('wch')
  .description('Watch Spec files and auto-validate on save (v5.6)')
  .option('--task <id>', 'Watch a specific task')
  .option('--iteration <name>', 'Watch a specific iteration')
  .action(watchCommand);

// ── 调度任务管理 ──
const scheduleCmd = program
  .command('schedule')
  .alias('sc')
  .description('定时调度：指定时间自动执行+筛选条件+守护进程');

scheduleCmd
  .command('create')
  .description('创建定时调度任务')
  .option('--task <task>', '指定 Task ID')
  .option('--all', '批量执行所有任务')
  .option('-i, --iteration <iteration>', '目标期次')
  .option('--at <datetime>', '执行时间: "YYYY-MM-DD HH:mm:ss"')
  .option('-n, --name <name>', '任务名称')
  .option('--plan <id>', '执行已保存的计划')
  .option('--batch-size <n>', '分批数量 (默认 3)')
  .option('--parallel <n>', '并行数量 (默认 1)')
  .option('-a, --assignee <name>', '指定人员')
  .option('--type <type>', '任务类型: feature|bugfix')
  .option('--priority <level>', '优先级: low|medium|high|critical')
  .option('--status <status>', '按状态筛选')
  .option('--platform <platform>', '平台: web|h5|miniapp')
  .option('--backend', '仅后端')
  .option('--frontend', '仅前端')
  .action(scheduleCreateCommand);

scheduleCmd
  .command('list')
  .description('查看调度队列（含守护进程状态）')
  .option('--status <status>', '按状态筛选: pending|running|completed|failed|cancelled')
  .action(scheduleListCommand);

scheduleCmd
  .command('cancel')
  .description('取消调度任务')
  .option('--id <id>', '调度任务 ID')
  .action(scheduleCancelCommand);

scheduleCmd
  .command('detail')
  .description('查看调度详情（含执行参数）')
  .option('--id <id>', '调度任务 ID')
  .action(scheduleDetailCommand);

scheduleCmd
  .command('delete')
  .description('删除调度记录')
  .option('--id <id>', '调度任务 ID')
  .action(scheduleDeleteCommand);

scheduleCmd
  .command('daemon')
  .description('守护进程管理 [start|stop|restart|status]')
  .argument('[action]', 'start | stop | restart | status', 'status')
  .option('--foreground', '前台运行守护进程')
  .action((action: string, options: any) => {
    return scheduleDaemonCommand({ action, foreground: options.foreground });
  });

program
  .command('welcome')
  .alias('wc')
  .description('显示欢迎面板（同 speccore 无参数）')
  .action(welcomeCommand);

// Parse arguments
// ── 帮助分层：核心命令前置 ──
program.addHelpText('beforeAll', `
┌──────────────────────────────────────────────────────────────┐
│  🧠 = 协作式（支持 --interactive）  ⚡ = 单次执行              │
│  init → iteration create → doc2spec → analyze → split       │
│  → plan → execute → pr → done                               │
├──────────────────────────────────────────────────────────────┤
│  📥 资产接入                                                  │
│  🚀 init          ⚡ 初始化项目                                │
│  📅 iteration     ⚡ 期次管理                                  │
│  📝 doc2spec      ⚡ 导入需求文档                               │
│  📦 task new      ⚡ 创建任务（支持批量/调度）                    │
├──────────────────────────────────────────────────────────────┤
│  🤝 协作决策                                                  │
│  🔍 analyze       🧠 需求分析+代码审查（--ask）                  │
│  📊 split         🧠 拆分为Task（--interactive）               │
│  📋 plan          🧠 执行计划（--interactive）                  │
├──────────────────────────────────────────────────────────────┤
│  🚀 执行交付                                                  │
│  💻 execute       ⚡ 自动排序+分批执行                          │
│  🔀 pr            🧠 创建PR（--interactive）                   │
│  ✅ done          🧠 收尾归档（--interactive）                  │
│  🔄 change        🧠 需求变更（--interactive）                  │
├──────────────────────────────────────────────────────────────┤
│  📊 治理 + 调度                                               │
│  ✅ validate      ⚡ 合规校验                                  │
│  ⏰ schedule      ⚡ 定时调度（create/list/daemon）              │
│  🗑  rename       ⚡ 重命名 Task/期次                           │
├──────────────────────────────────────────────────────────────┤
│  💡 智能入口                                                  │
│  speccore             自适应面板（检测阶段 → 提示下一步）          │
│  speccore ask "..."   自然语言意图识别                          │
|  speccore dev         智能级联：自动检测并执行下一步               │
│  speccore status-panel  可视化看板                              │
└──────────────────────────────────────────────────────────────┘
`);

program.addHelpText('afterAll', `
💡 完整文档: https://github.com/windfallsheng/SpecCore-ts
`);

// ── Adaptive welcome panel (no args) ──
if (process.argv.length <= 2) {
  const { existsSync, readdirSync, readFileSync } = require('fs');
  const { join } = require('path');
  const { logger } = require('./utils/logger');
  const pkg = require('../../package.json');

  let phase = 'init', iteration = '', total = 0, done2 = 0;
  let nextCmd = 'speccore init', nextDesc = '初始化 SpecCore 项目';

  if (existsSync('.speccore')) {
    try {
      const items = readdirSync('.');
      const idirs = items.filter((d: string) => d.startsWith('期次-')).sort();
      if (idirs.length > 0) {
        iteration = idirs[0].slice(3);
        const base = idirs[0];
        const req = join(base, '00-需求文档', 'REQUIREMENT.md');
        const ana = join(base, '00-需求文档', 'ANALYSIS.md');
        if (!existsSync(req)) {
          phase = 'require'; nextCmd = 'speccore doc2spec --iteration ' + iteration; nextDesc = '导入需求文档';
        } else if (!existsSync(ana)) {
          phase = 'analyze'; nextCmd = 'speccore analyze --iteration=' + iteration; nextDesc = '需求分析';
        } else {
          const tds = readdirSync(base).filter((d: string) => d.startsWith('Task-'));
          if (tds.length === 0) {
            phase = 'split'; nextCmd = 'speccore iteration split --iteration=' + iteration; nextDesc = '拆分任务';
          } else {
            total = tds.length;
            for (const td of tds) {
              const tm = join(base, td, 'backend', 'TASK.md');
              if (existsSync(tm) && readFileSync(tm, 'utf-8').includes('已完成')) done2++;
            }
            if (done2 < total) {
              phase = 'dev'; nextCmd = 'speccore execute --task=' + tds[done2] + ' --force'; nextDesc = '执行开发 (' + (done2 + 1) + '/' + total + ')';
            } else {
              phase = 'done'; nextCmd = 'speccore pr'; nextDesc = '创建 PR 提交代码';
            }
          }
        }
      }
    } catch {}
  }

  const icons: Record<string, string> = { init: '🚀', require: '📝', analyze: '🔍', split: '📦', dev: '💻', done: '✨' };
  const names: Record<string, string> = { init: '未初始化', require: '待导入需求', analyze: '待分析', split: '待拆分', dev: '开发中', done: '已完成' };

  logger.info('');
  logger.info('┌──────────────────────────────────────────┐');
  logger.info('│    SpecCore · v' + pkg.version + ' · 68 commands              │');
  logger.info('├──────────────────────────────────────────┤');
  if (iteration) logger.info('│  期次: ' + iteration.padEnd(33) + '│');
  logger.info('│  状态: ' + icons[phase] + ' ' + (names[phase] || phase).padEnd(33) + '│');
  if (total > 0) {
    const pct = Math.round(done2 / total * 100);
    const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
    const taskLine = '│  任务: ' + done2 + '/' + total + ' ' + bar + ' ' + pct + '%';
    logger.info(taskLine.padEnd(46) + '│');
  }
  logger.info('│                                          │');
  logger.info('│  👉 下一步: ' + nextCmd.padEnd(33) + '│');
  logger.info('│     ' + nextDesc.padEnd(41) + '│');
  logger.info('│                                          │');
  logger.info('│  💡 speccore --help   查看全部命令        │');
  logger.info('│  📊 speccore status-panel  状态面板       │');
  logger.info('└──────────────────────────────────────────┘');
  logger.info('');
  process.exit(0);
}

// ── Natural language intent (e.g. speccore "帮我分析需求") ──
program.exitOverride().configureOutput({ outputError: () => {} });
try {
  program.parse();
} catch (err: any) {
  const input = (process.argv.slice(2)).filter((a: string) => !a.startsWith('-')).join(' ');
  if (input) {
    askCommand(input, {}).then(() => process.exit(0));
  } else {
    process.exit(1);
  }
}
