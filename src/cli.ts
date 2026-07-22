import { program } from 'commander';
import { version } from '../package.json';
import { initCommand } from './commands/init';
import { importCommand } from './commands/import';
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
import { specCommand } from './commands/spec';
import { goalCommand } from './commands/goal';
import { bugfixCommand } from './commands/bugfix';
import { newTaskCommand } from './commands/new-task';
import { changeCommand } from './commands/change';
import { syncCommand } from './commands/sync';
import { patternCommand } from './commands/pattern';
import { rollbackCommand } from './commands/rollback';
import { handoverCommand } from './commands/handover';
import { retroCommand } from './commands/retro';
import { templateAddCommand } from './commands/template-add';
import { helpCommand } from './commands/help';
import { devCommand } from './commands/dev';
import { statusPanelCommand } from './commands/status-panel';
import { demoCommand } from './commands/demo';
import { welcomeCommand } from './commands/welcome';
import { word2specCommand } from './commands/word2spec';
// 全量层命令
import { iterationFromGlobalCommand } from './commands/iteration-from-global';
import { syncGlobalCommand } from './commands/sync-global';
import { globalStatusCommand } from './commands/global-status';
import { historyCommand } from './commands/history';
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
import { platformAddCommand } from './commands/platform-add';
import { indexUpdateCommand } from './commands/index-update';
// v4.6.0 迁移命令
import { migrateCommand } from './commands/migrate';
// v4.7.0 体验增强
import { completionCommand } from './commands/completion';
import { backupCommand } from './commands/backup';
// v4.8.0 高级功能

import { currentCommand } from './commands/current';
// v4.9.0 完善
import { updateCommand } from './commands/update';
// v5.3.0 新增
import { diffCommand } from './commands/diff';
import { traceCommand } from './commands/trace';
import { mergeCheck, rollbackTask, updateArchitecture } from './commands/merge-check';
import { opsCommand } from './commands/history';
import { trackerCommand } from './commands/tracker';
// v5.5.0 新增
import { deleteCommand } from './commands/delete';
// v5.6.0 新增
import { searchCommand } from './commands/search';
import { watchCommand } from './commands/watch';
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

// ================================================================
// 🔍 智能入口
// ================================================================
program
  .command('spec [input...]')
  .description('Smart entry: natural language intent recognition')
  .action((input: string[]) => specCommand(input.join(' '), {}));

// ================================================================
// 👋 引导与体验
// ================================================================
program
  .command('welcome')
  .alias('wc')
  .description('First-time setup guide (interactive)')
  .option('--force', 'Force re-initialization')
  .action(welcomeCommand);

program
  .command('status-panel')
  .alias('sp')
  .description('IDE-style status panel: phase + tasks + progress + next action')
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
  .command('status-panel')
  .alias('sp')
  .description('IDE-style status panel: phase + tasks + progress + next action')
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
  .command('dev')
  .alias('d')
  .description('Smart dev entry: auto-detect phase and suggest next step')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--force', 'Auto-execute the next step')
  .action(devCommand);

program
  .command('status-panel')
  .alias('sp')
  .description('IDE-style status panel: phase + tasks + progress + next action')
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
  .command('status-panel')
  .alias('sp')
  .description('IDE-style status panel: phase + tasks + progress + next action')
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
  .command('dev')
  .alias('d')
  .description('Smart dev entry: auto-detect phase and suggest next step')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--force', 'Auto-execute the next step')
  .action(devCommand);

program
  .command('demo')
  .alias('dm')
  .description('Quick experience demo (5 min)')
  .option('--project <key>', 'Demo project type: book, todo, blog', 'book')
  .option('--list', 'List available demo projects')
  .action(demoCommand);

// ================================================================
// 🏗️ 初始化与导入
// ================================================================
program
  .command('init')
  .alias('in')
  .description('Initialize SpecCore in current project')
  .option('--mode <mode>', 'Initialization mode: fresh or migration', 'fresh')
  .option('--force', 'Force overwrite existing configuration')
  .action(initCommand);

program
  .command('import')
  .alias('imp')
  .description('Import project into global layer (multi-project support)')
  .option('--source <source>', 'Source type: code, prd, prototype, all', 'all')
  .option('--path <path>', 'Project source path', './')
  .option('--url <url>', 'Prototype URL')
  .option('-i, --iteration <iteration>', 'Target iteration name')
  .option('--project <name>', 'Project name for global layer import')
  .option('--type <type>', 'Project type: backend, web, h5, miniapp', 'backend')
  .option('--scope <scope>', 'Selective import: all, core, api', 'all')
  .option('--ignore <packages>', 'Ignore specific packages (comma-separated)')
  .option('--update', 'Incremental sync mode')
  .option('--force', 'Force overwrite')
  .action(importCommand);

program
  .command('migrate')
  .alias('mg')
  .description('Migrate Shell v3.x config to CLI v4.x (v4.6)')
  .option('--dry-run', 'Preview migration, no changes')
  .option('--force', 'Skip confirmation')
  .action(migrateCommand);

// ================================================================
// 📋 期次管理
// ================================================================
const iterationCmd = program
  .command('iteration')
  .alias('it')
  .description('Iteration management commands');

iterationCmd
  .command('create')
  .alias('cr')
  .description('Create a new iteration')
  .option('-n, --name <name>', 'Iteration name (required)')
  .option('--from <date>', 'Start date', new Date().toISOString().split('T')[0])
  .option('--to <date>', 'End date')
  .action(iterationCreateCommand);

iterationCmd
  .command('split')
  .alias('sp')
  .description('Split requirements into tasks')
  .option('-f, --file <file>', 'Requirement file path', 'REQUIREMENT.md')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--sections <sections>', 'Specific sections to split')
  .option('--target <target>', 'Merge into existing task')
  .option('-p, --platforms <platforms>', 'Comma-separated platforms (auto-detected if omitted)')
  .option('--dry-run', 'Preview without creating')
  .option('--strict', 'Review each section before creating tasks')
  .action(iterationSplitCommand);

// ================================================================
// 📝 任务管理
// ================================================================
const taskCmd = program
  .command('task')
  .alias('tk')
  .description('Task management commands');

taskCmd
  .command('new')
  .alias('add')
  .description('Create a new atomic task')
  .option('-n, --name <name>', 'Task name (required)')
  .option('-t, --type <type>', 'Task type: feature, bugfix, research, optimization, migration, document', 'feature')
  .option('--task-id <id>', 'Task ID (auto-generated if omitted)')
  .option('-d, --desc <desc>', 'Task description')
  .option('--file <file>', 'Requirement file path')
  .option('--sections <sections>', 'Sections to extract from file')
  .option('--backend-only', 'Create backend only')
  .option('--frontend-only', 'Create frontend only')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .action(taskNewCommand);

// 完整需求交付
program
  .command('goal')
  .alias('gl')
  .description('Complete requirement delivery (from requirement to code)')
  .option('-n, --name <name>', 'Feature name')
  .option('-d, --desc <desc>', 'Feature description')
  .option('-t, --type <type>', 'Task type', 'feature')
  .option('--task-id <id>', 'Task ID')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--backend-only', 'Backend only')
  .option('--frontend-only', 'Frontend only')
  .action(goalCommand);

// Bug 修复
program
  .command('bugfix')
  .alias('bf')
  .description('Quick bug fix: create fix task + impact analysis')
  .option('-n, --name <name>', 'Bug name')
  .option('-d, --desc <desc>', 'Bug description')
  .option('--task-id <id>', 'Task ID')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--affected-task <task>', 'Affected task for regression')
  .action(bugfixCommand);

// 技术调研
program
  .command('research')
  .alias('rs')
  .description('Technical research: evaluate solutions and compare options')
  .option('-n, --name <name>', 'Research topic')
// ================================================================
// ⚡ 执行与调度
// ================================================================
program
  .command('pr')
  .alias('mr')
  .description('Create Pull Request with task summary')
  .option('-t, --task <task>', 'Target task (auto-detect from branch if omitted)')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--base <branch>', 'Base branch', 'main')
  .option('--draft', 'Create as draft PR')
  .option('--title <title>', 'Custom PR title')
  .action(prCommand);

program
  .command('pr')
  .alias('mr')
  .description('Create Pull Request with task summary')
  .option('-t, --task <task>', 'Target task (auto-detect from branch if omitted)')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--base <branch>', 'Base branch', 'main')
  .option('--draft', 'Create as draft PR')
  .option('--title <title>', 'Custom PR title')
  .action(prCommand);

program
  .command('plan')
  .alias('pl')
  .description('Generate execution plan based on task dependencies')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('-t, --team <count>', 'Team member count', '3')
  .option('-a, --assign <members>', 'Assign to specific members (comma-separated)')
  .option('--req <req>')
    .option('--task <task>', 'Analyze specific task')
  .option('--type <type>', 'Filter by task type')
  .option('--priority <priority>', 'Filter by priority')
  .option('--mode <mode>', 'Plan mode: auto, claim, parallel', 'auto')
  .option('--dry-run', 'Preview without saving')
  .action(planCommand);

program
  .command('execute')
  .alias('ex')
  .description('Execute tasks based on filters')
  .option('--all', 'Execute all pending tasks')
  .option('-a, --assignee <assignee>', 'Filter by assignee')
  .option('-t, --task <task>', 'Execute specific task')
  .option('--type <type>', 'Filter by task type')
  .option('--priority <priority>', 'Filter by priority')
  .option('--status <status>', 'Filter by status')
  .option('--backend', 'Backend tasks only')
  .option('--frontend', 'Frontend tasks only')
  .option('--platform <platform>', 'Filter by frontend platform (web/h5/miniapp)')
  .option('--interactive', 'Interactive selection')
  .option('--dry-run', 'Preview execution plan')
  .option('--resume', 'Resume from last interruption')
  .option('--batch-size <n>', 'Batch size for context isolation (default 3)')
  .option('--parallel <count>', 'Parallel execution count', '1')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--force', 'Skip preview and execute directly')
  .option('--strict', 'Pre-flight check: review req/tech/test before code gen')
  .option('--base <branch>', 'Base branch for task branching (default: current)')
  .option('--skip <tasks>', 'Comma-separated task IDs to skip')
  .option('--only <tasks>', 'Comma-separated task IDs to execute exclusively (whitelist)')
  .option('--agent <tool>', 'External AI: copilot/claude/cursor/trae/qoder/windsurf/codebuddy')
  .option('--hotfix', 'Emergency fix: skip reverse sync (30min grace, 24h mandatory)')
  .action(executeCommand);

// ================================================================
// 🔄 变更管理
// ================================================================
program
  .command('change')
  .alias('ch')
  .description('Requirement change: update linked spec files automatically')
  .option('-t, --task <task>', 'Target task')
  .option('-r, --req <req>', 'Requirement ID')
  .option('-d, --desc <desc>', 'Change description (required)')
  .option('--global', 'Global layer change (CONSTITUTION.md)')
  .option('--requirement', 'Also update REQUIREMENT.md (iteration-level)')
  .option('--analysis', 'Also update ANALYSIS.md (tech plan)')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--dry-run', 'Preview impact without modifying')
  .option('--force', 'Skip preview and apply directly')
  .action(changeCommand);

program
  .command('sync')
  .alias('sy')
  .description('Reverse sync: detect code-spec differences and update')
  .option('-t, --task <task>', 'Target task')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--auto', 'Auto-apply sync without confirmation')
  .option('--dry-run', 'Preview differences without modifying')
  .option('--force', 'Skip preview')
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
  .option('--format <format>', 'Output format: text, json', 'text')
  .action(validateCommand);

// ================================================================
// 📊 进度与状态
// ================================================================
program
  .command('progress')
  .alias('pg')
  .description('Display project progress overview')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('-a, --assignee <assignee>', 'Filter by assignee')
  .option('--type <type>', 'Filter by task type')
  .option('--req <req>')
    .option('--task <task>', 'Show specific task progress')
  .option('--detail', 'Show detailed progress')
  .option('--platform <platform>', 'Filter by frontend platform (web/h5/miniapp)')
  .option('--format <format>', 'Output format: text, json, csv', 'text')
  .action(progressCommand);

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
  .command('archive')
  .alias('ar')
  .description('Archive completed tasks')
  .option('-t, --task <task>', 'Archive specific task')
  .option('--all', 'Archive all completed tasks')
  .option('-i, --iteration <iteration>', 'Archive entire iteration')
  .option('--list', 'List archived tasks')
  .option('--restore <task>', 'Restore archived task')
  .option('--force', 'Skip preview and archive directly')
  .action(archiveCommand);

program
  .command('handover')
  .alias('ho')
  .description('Generate handover documentation for current iteration')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('-o, --output <path>', 'Output file path')
  .option('--format <format>', 'Output format: md', 'md')
  .action(handoverCommand);

program
  .command('retro')
  .alias('rt')
  .description('Iteration retrospective: summarize experience and improvements')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('-o, --output <path>', 'Output file path')
  .action(retroCommand);

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
  .command('context')
  .alias('ctx')
  .description('Output task context for any AI tool (Copilot/Claude/GPT)')
  .option('-t, --task <task>', 'Target task')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .action(contextCommand);

program
  .command('constitution')
  .alias('cn')
  .description('Auto-detect tech stack and generate CONSTITUTION.md rules')
  .action(async () => { await buildConstitution(process.cwd()); });

program
  .command('context')
  .alias('ctx')
  .description('Output task context for any AI tool (Copilot/Claude/GPT)')
  .option('-t, --task <task>', 'Target task')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .action(contextCommand);

program
  .command('context')
  .alias('ctx')
  .description('Output task context for any AI tool (Copilot/Claude/GPT)')
  .option('-t, --task <task>', 'Target task')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .action(contextCommand);

program
  .command('constitution')
  .alias('cn')
  .description('Auto-detect tech stack and generate CONSTITUTION.md rules')
  .action(async () => { await buildConstitution(process.cwd()); });

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
  .command('report')
  .alias('rp')
  .description('Generate project report')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--format <format>', 'Output format: markdown, html, json', 'markdown')
  .option('-o, --output <path>', 'Output file path')
  .option('--team', 'Include team analysis')
  .option('--risk', 'Include risk analysis')
  .option('--trend', 'Include trend comparison')
  .action(reportCommand);

program
  .command('template-add')
  .alias('ta')
  .description('Add code generation template from existing code')
  .option('-n, --name <name>', 'Template name (required)')
  .option('-t, --type <type>', 'Template type: crud, auth, export, report', 'crud')
  .option('-f, --files <files>', 'Code file paths (comma-separated, required)')
  .option('-d, --desc <desc>', 'Template description')
  .action(templateAddCommand);

// ================================================================
// 📖 帮助
// ================================================================
program
  .command('help')
  .alias('h')
  .description('Display command help and search')
  .option('--command <command>', 'Show detailed help for specific command')
  .option('--search <keyword>', 'Search commands by keyword')
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
  .action(iterationFromGlobalCommand);

program
  .command('word2spec')
  .alias('w2s')
  .description('Convert Word (.docx/.doc) requirement docs to SpecCore Markdown')
  .option('-f, --file <path>', 'Source Word file path')
  .option('-i, --iteration <name>', 'Target iteration name (required)')
  .option('-p, --platform <name>', 'Platform identifier (e.g. 后台/Web/小程序)')
  .option('--files <files>', 'Batch: "path1.docx=平台1,path2.docx=平台2"')
  .action(word2specCommand);

program
  .command('sync-global')
  .alias('sg')
  .description('Bidirectional sync between iteration and global layer')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--direction <direction>', 'Sync direction: to_global, from_global', 'to_global')
  .option('--auto', 'Auto-apply without confirmation')
  .option('--dry-run', 'Preview changes without applying')
  .option('--force', 'Skip preview and execute')
  .action(syncGlobalCommand);

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
  .command('history')
  .alias('hs')
  .description('View requirement change history')
  .option('--req <id>', 'Requirement ID (e.g., REQ-001)')
  .action(historyCommand);

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
  .command('dashboard')
  .alias('db')
  .description('Generate visual dashboard (HTML + Chart.js)')
  .option('-o, --output <path>', 'Output file path', './speccore-dashboard.html')
  .action(dashboardCommand);

program
  .command('analyze')
  .alias('al')
  .description('Analyze requirements: completeness + code mapping + architecture impact → ANALYSIS.md')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('-o, --output <file>', 'Output filename', 'ANALYSIS.md')
  .option('--auto', 'Non-interactive mode: generate report directly')
  .option('-t, --task <task>', 'Per-task analysis: enriches TECH/TEST/REVIEW for one task')
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
  .action(renameCommand);

// ================================================================
// 🆕 v4.0.0 新增命令
// ================================================================
program
  .command('new-task')
  .alias('nt')
  .description('Create multi-platform task with --platforms support (v4.0)')
  .option('--name <name>', 'Task name (required)')
  .option('--type <type>', 'Task type: feature, bugfix, research, optimization, migration, document')
  .option('--desc <desc>', 'Task description')
  .option('--platforms <platforms>', 'Frontend platforms: web,h5,miniapp or "all"')
  .option('--backend-only', 'Create backend specs only')
  .option('--frontend-only', 'Create frontend specs only')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .action(newTaskCommand);

program
  .command('platform-add')
  .alias('padd')
  .description('Dynamically add a frontend platform type (v4.0)')
  .option('--name <name>', 'Platform identifier (required, e.g. tablet)')
  .option('--description <desc>', 'Platform display name')
  .option('--tech <tech>', 'Tech stack description')
  .option('--no-sync', 'Skip syncing to existing tasks')
  .action(platformAddCommand);

program
  .command('index-update')
  .alias('iu')
  .description('Scan requirements and rebuild GLOBAL/INDEX.md (v4.0)')
  .option('--dry-run', 'Preview mode, no actual changes')
  .action(indexUpdateCommand);

program
  .command('context')
  .alias('ctx')
  .description('View task context loading status and dependency chain (v4.0)')
  .option('--req <req>')
    .option('--task <task>', 'Target task (default: current task)')
  .action(contextCommand);

// ================================================================
// 快捷别名（顶层别名）
// ================================================================
// 为常用命令提供顶层快捷访问
program
  .command('rv')
  .description('[Alias] speccore validate')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('-t, --task <task>', 'Validate specific task')
  .option('--strict', 'Strict mode')
  .option('--fix', 'Auto-fix')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(validateCommand);

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
  .description('Complete a task: validate → archive → sync-global')
  .option('-t, --task <task>', 'Target task')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--skip-validate', 'Skip validation step')
  .option('--skip-sync', 'Skip global sync step')
  .action(doneCommand);

program
  .command('completion [shell]')
  .description('Generate shell completion script (bash/zsh)')
  .action(completionCommand);

program
  .command('backup')
  .alias('bk')
  .description('Create backup of current state (v4.7)')
  .option('--list', 'List existing backups')
  .option('--restore <name>', 'Restore from backup')
  .action(backupCommand);

// v4.8.0 高级功能
program
  .command('hooks')
  .description('Install Git hooks (pre-commit + pre-push)')

program
  .command('current')
  .alias('cr')
  .description('Show current branch task mapping (v4.8)')
  .option('--commit', 'Generate commit message')
  .option('--pr', 'Generate PR description')
  .action(currentCommand);

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
  .command('rollback')
  .alias('rb')
  .description('Rollback a task: revert branch + archive spec')
  .option('-t, --task <task>', 'Task to rollback')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--reason <reason>', 'Rollback reason')
  .action(async (options: any) => { const it = await require('../core/context').getDefaultIteration(options.iteration); if (it && options.task) await rollbackTask(options.task, it, options.reason); });

program
  .command('arch-update')
  .alias('au')
  .description('Auto-update ARCHITECTURE.md with new APIs/tables')
  .option('-i, --iteration <iteration>', 'Source iteration')
  .option('--apis <apis>', 'Comma-separated API paths')
  .option('--tables <tables>', 'Comma-separated table names')
  .action(async (options: any) => { const it = await require('../core/context').getDefaultIteration(options.iteration); if (it) await updateArchitecture(it, (options.apis || '').split(',').filter(Boolean), (options.tables || '').split(',').filter(Boolean)); });

program
  .command('merge-check')
  .alias('mc')
  .description('Predict merge conflicts across task branches')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .action(async (options: any) => { const { getDefaultIteration } = await import('./core/context'); const it = await getDefaultIteration(options.iteration); if (it) await mergeCheck(it); });

program
  .command('rollback')
  .alias('rb')
  .description('Rollback a task: revert branch + archive spec')
  .option('-t, --task <task>', 'Task to rollback')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--reason <reason>', 'Rollback reason')
  .action(async (options: any) => { const it = await require('../core/context').getDefaultIteration(options.iteration); if (it && options.task) await rollbackTask(options.task, it, options.reason); });

program
  .command('arch-update')
  .alias('au')
  .description('Auto-update ARCHITECTURE.md with new APIs/tables')
  .option('-i, --iteration <iteration>', 'Source iteration')
  .option('--apis <apis>', 'Comma-separated API paths')
  .option('--tables <tables>', 'Comma-separated table names')
  .action(async (options: any) => { const it = await require('../core/context').getDefaultIteration(options.iteration); if (it) await updateArchitecture(it, (options.apis || '').split(',').filter(Boolean), (options.tables || '').split(',').filter(Boolean)); });

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

// Parse arguments
program.parse();
