"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const package_json_1 = require("../package.json");
const init_1 = require("./commands/init");
const import_1 = require("./commands/import");
const validate_1 = require("./commands/validate");
const archive_1 = require("./commands/archive");
const progress_1 = require("./commands/progress");
const status_1 = require("./commands/status");
const health_1 = require("./commands/health");
const report_1 = require("./commands/report");
const config_1 = require("./commands/config");
const create_1 = require("./commands/iteration/create");
const split_1 = require("./commands/iteration/split");
const new_1 = require("./commands/task/new");
const plan_1 = require("./commands/plan");
const execute_1 = require("./commands/execute");
// 新增命令
const spec_1 = require("./commands/spec");
const goal_1 = require("./commands/goal");
const bugfix_1 = require("./commands/bugfix");
const new_task_1 = require("./commands/new-task");
const change_1 = require("./commands/change");
const sync_1 = require("./commands/sync");
const pattern_1 = require("./commands/pattern");
const rollback_1 = require("./commands/rollback");
const handover_1 = require("./commands/handover");
const retro_1 = require("./commands/retro");
const template_add_1 = require("./commands/template-add");
const help_1 = require("./commands/help");
const dev_1 = require("./commands/dev");
const status_panel_1 = require("./commands/status-panel");
const demo_1 = require("./commands/demo");
const welcome_1 = require("./commands/welcome");
const word2spec_1 = require("./commands/word2spec");
// 全量层命令
const iteration_from_global_1 = require("./commands/iteration-from-global");
const sync_global_1 = require("./commands/sync-global");
const global_status_1 = require("./commands/global-status");
const history_1 = require("./commands/history");
// P0/P1/P2 新增命令
const impact_1 = require("./commands/impact");
const baseline_1 = require("./commands/baseline");
const dashboard_1 = require("./commands/dashboard");
const audit_1 = require("./commands/audit");
const analyze_1 = require("./commands/analyze");
const lifecycle_1 = require("./commands/lifecycle");
const pr_1 = require("./commands/pr");
const constitution_builder_1 = require("./core/constitution-builder");
const context_output_1 = require("./commands/context-output");
const done_1 = require("./commands/done");
// rename 命令
const rename_1 = require("./commands/rename");
// v4.0.0 新增命令
const platform_add_1 = require("./commands/platform-add");
const index_update_1 = require("./commands/index-update");
// v4.6.0 迁移命令
const migrate_1 = require("./commands/migrate");
// v4.7.0 体验增强
const completion_1 = require("./commands/completion");
const backup_1 = require("./commands/backup");
// v4.8.0 高级功能
const current_1 = require("./commands/current");
// v4.9.0 完善
const update_1 = require("./commands/update");
// v5.3.0 新增
const diff_1 = require("./commands/diff");
const trace_1 = require("./commands/trace");
const merge_check_1 = require("./commands/merge-check");
const history_2 = require("./commands/history");
const tracker_1 = require("./commands/tracker");
// v5.5.0 新增
const delete_1 = require("./commands/delete");
// v5.6.0 新增
const search_1 = require("./commands/search");
const watch_1 = require("./commands/watch");
const i18n_1 = require("./i18n");
commander_1.program
    .name('speccore')
    .description('SpecCore - Code by Spec, Not by Vibe.')
    .version(package_json_1.version, '-v, --version', 'Display current version')
    .option('--lang <locale>', 'Language: zh-CN (default) or en-US', 'zh-CN')
    .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.lang && (opts.lang === 'zh-CN' || opts.lang === 'en-US')) {
        i18n_1.i18n.setLocale(opts.lang);
    }
});
// ================================================================
// 🔍 智能入口
// ================================================================
commander_1.program
    .command('spec [input...]')
    .description('Smart entry: natural language intent recognition')
    .action((input) => (0, spec_1.specCommand)(input.join(' '), {}));
// ================================================================
// 👋 引导与体验
// ================================================================
commander_1.program
    .command('welcome')
    .alias('wc')
    .description('First-time setup guide (interactive)')
    .option('--force', 'Force re-initialization')
    .action(welcome_1.welcomeCommand);
commander_1.program
    .command('status-panel')
    .alias('sp')
    .description('IDE-style status panel: phase + tasks + progress + next action')
    .action(status_panel_1.statusPanelCommand);
commander_1.program
    .command('open')
    .alias('opn')
    .description('Open task files in editor')
    .option('-t, --task <task>', 'Task to open')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .action(async (options) => {
    const { getDefaultIteration } = await Promise.resolve().then(() => __importStar(require('./core/context')));
    const it = await getDefaultIteration(options.iteration);
    if (!it)
        return;
    const fs = require('fs');
    const iterDir = `期次-${it}`;
    const entries = fs.readdirSync(iterDir, { withFileTypes: true });
    const task = entries.find((e) => e.isDirectory() && e.name.startsWith(options.task || ''));
    if (task) {
        const { logger } = require('./utils/logger');
        logger.info(`\n📂 ${task.name}:`);
        const files = ['REQ.md', 'TECH.md', 'TASK.md', 'TEST.md', 'API_CONTRACT.yaml'];
        for (const f of files) {
            const path = require('path').join(iterDir, task.name, f.startsWith('API') ? '_shared' : 'backend', f);
            if (fs.existsSync(path))
                logger.info(`  ${path}`);
        }
    }
});
commander_1.program;
commander_1.program
    .command('dev')
    .alias('d')
    .description('Smart dev entry: auto-detect phase and suggest next step')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--force', 'Auto-execute the next step')
    .action(dev_1.devCommand);
commander_1.program;
commander_1.program;
commander_1.program
    .command('dev')
    .alias('d')
    .description('Smart dev entry: auto-detect phase and suggest next step')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--force', 'Auto-execute the next step')
    .action(dev_1.devCommand);
commander_1.program
    .command('demo')
    .alias('dm')
    .description('Quick experience demo (5 min)')
    .option('--project <key>', 'Demo project type: book, todo, blog', 'book')
    .option('--list', 'List available demo projects')
    .action(demo_1.demoCommand);
// ================================================================
// 🏗️ 初始化与导入
// ================================================================
commander_1.program
    .command('init')
    .alias('in')
    .description('Initialize SpecCore in current project')
    .option('--mode <mode>', 'Initialization mode: fresh or migration', 'fresh')
    .option('--force', 'Force overwrite existing configuration')
    .action(init_1.initCommand);
commander_1.program
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
    .action(import_1.importCommand);
commander_1.program
    .command('migrate')
    .alias('mg')
    .description('Migrate Shell v3.x config to CLI v4.x (v4.6)')
    .option('--dry-run', 'Preview migration, no changes')
    .option('--force', 'Skip confirmation')
    .action(migrate_1.migrateCommand);
// ================================================================
// 📋 期次管理
// ================================================================
const iterationCmd = commander_1.program
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
    .action(create_1.iterationCreateCommand);
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
    .action(split_1.iterationSplitCommand);
// ================================================================
// 📝 任务管理
// ================================================================
const taskCmd = commander_1.program
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
    .action(new_1.taskNewCommand);
// 完整需求交付
commander_1.program
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
    .action(goal_1.goalCommand);
// Bug 修复
commander_1.program
    .command('bugfix')
    .alias('bf')
    .description('Quick bug fix: create fix task + impact analysis')
    .option('-n, --name <name>', 'Bug name')
    .option('-d, --desc <desc>', 'Bug description')
    .option('--task-id <id>', 'Task ID')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--affected-task <task>', 'Affected task for regression')
    .action(bugfix_1.bugfixCommand);
// 技术调研
commander_1.program
    .command('research')
    .alias('rs')
    .description('Technical research: evaluate solutions and compare options')
    .option('-n, --name <name>', 'Research topic');
// ================================================================
// ⚡ 执行与调度
// ================================================================
commander_1.program
    .command('pr')
    .alias('mr')
    .description('Create Pull Request with task summary')
    .option('-t, --task <task>', 'Target task (auto-detect from branch if omitted)')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--base <branch>', 'Base branch', 'main')
    .option('--draft', 'Create as draft PR')
    .option('--title <title>', 'Custom PR title')
    .action(pr_1.prCommand);
commander_1.program
    .command('pr')
    .alias('mr')
    .description('Create Pull Request with task summary')
    .option('-t, --task <task>', 'Target task (auto-detect from branch if omitted)')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--base <branch>', 'Base branch', 'main')
    .option('--draft', 'Create as draft PR')
    .option('--title <title>', 'Custom PR title')
    .action(pr_1.prCommand);
commander_1.program
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
    .action(plan_1.planCommand);
commander_1.program
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
    .action(execute_1.executeCommand);
// ================================================================
// 🔄 变更管理
// ================================================================
commander_1.program
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
    .action(change_1.changeCommand);
commander_1.program
    .command('sync')
    .alias('sy')
    .description('Reverse sync: detect code-spec differences and update')
    .option('-t, --task <task>', 'Target task')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--auto', 'Auto-apply sync without confirmation')
    .option('--dry-run', 'Preview differences without modifying')
    .option('--force', 'Skip preview')
    .option('--detect', 'Detect code-spec discrepancies (read-only, no changes)')
    .action(sync_1.syncCommand);
// ================================================================
// ✅ 审查与验证
// ================================================================
commander_1.program
    .command('validate')
    .alias('vl')
    .description('Validate Spec compliance and integrity')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('-t, --task <task>', 'Validate specific task')
    .option('--type <type>', 'Filter by task type')
    .option('--fix', 'Auto-fix issues where possible')
    .option('--strict', 'Strict validation mode')
    .option('--format <format>', 'Output format: text, json', 'text')
    .action(validate_1.validateCommand);
// ================================================================
// 📊 进度与状态
// ================================================================
commander_1.program
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
    .action(progress_1.progressCommand);
commander_1.program
    .command('status')
    .alias('st')
    .description('Display current project status')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('-a, --assignee <assignee>', 'Filter by assignee')
    .option('--type <type>', 'Filter by task type')
    .action(status_1.statusCommand);
commander_1.program
    .command('health')
    .alias('hl')
    .description('Generate project health report')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--format <format>', 'Output format: text, json', 'text')
    .option('--trend', 'Include trend comparison')
    .action(health_1.healthCommand);
// ================================================================
// 📦 归档与交接
// ================================================================
commander_1.program
    .command('archive')
    .alias('ar')
    .description('Archive completed tasks')
    .option('-t, --task <task>', 'Archive specific task')
    .option('--all', 'Archive all completed tasks')
    .option('-i, --iteration <iteration>', 'Archive entire iteration')
    .option('--list', 'List archived tasks')
    .option('--restore <task>', 'Restore archived task')
    .option('--force', 'Skip preview and archive directly')
    .action(archive_1.archiveCommand);
commander_1.program
    .command('handover')
    .alias('ho')
    .description('Generate handover documentation for current iteration')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('-o, --output <path>', 'Output file path')
    .option('--format <format>', 'Output format: md', 'md')
    .action(handover_1.handoverCommand);
commander_1.program
    .command('retro')
    .alias('rt')
    .description('Iteration retrospective: summarize experience and improvements')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('-o, --output <path>', 'Output file path')
    .action(retro_1.retroCommand);
// ================================================================
// ⚙️ 配置与工具
// ================================================================
commander_1.program
    .command('context')
    .alias('ctx')
    .description('Output task context for any AI tool (Copilot/Claude/GPT)')
    .option('-t, --task <task>', 'Target task')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .action(context_output_1.contextCommand);
commander_1.program
    .command('context')
    .alias('ctx')
    .description('Output task context for any AI tool (Copilot/Claude/GPT)')
    .option('-t, --task <task>', 'Target task')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .action(context_output_1.contextCommand);
commander_1.program
    .command('constitution')
    .alias('cn')
    .description('Auto-detect tech stack and generate CONSTITUTION.md rules')
    .action(async () => { await (0, constitution_builder_1.buildConstitution)(process.cwd()); });
commander_1.program
    .command('context')
    .alias('ctx')
    .description('Output task context for any AI tool (Copilot/Claude/GPT)')
    .option('-t, --task <task>', 'Target task')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .action(context_output_1.contextCommand);
commander_1.program
    .command('context')
    .alias('ctx')
    .description('Output task context for any AI tool (Copilot/Claude/GPT)')
    .option('-t, --task <task>', 'Target task')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .action(context_output_1.contextCommand);
commander_1.program
    .command('constitution')
    .alias('cn')
    .description('Auto-detect tech stack and generate CONSTITUTION.md rules')
    .action(async () => { await (0, constitution_builder_1.buildConstitution)(process.cwd()); });
commander_1.program
    .command('config')
    .alias('cf')
    .description('Manage SpecCore configuration and code rules')
    .option('--get <key>', 'Get configuration value')
    .option('--set <key=value>', 'Set configuration value (SETTINGS.md)')
    .option('-r, --rule <name>', 'Target spec-rule (CONSTITUTION.md)')
    .option('-t, --tech <target>', 'Target tech-stack (TECH_STACK.md): backend | frontend')
    .option('--reset', 'Reset to default configuration')
    .action(config_1.configCommand);
commander_1.program
    .command('report')
    .alias('rp')
    .description('Generate project report')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--format <format>', 'Output format: markdown, html, json', 'markdown')
    .option('-o, --output <path>', 'Output file path')
    .option('--team', 'Include team analysis')
    .option('--risk', 'Include risk analysis')
    .option('--trend', 'Include trend comparison')
    .action(report_1.reportCommand);
commander_1.program
    .command('template-add')
    .alias('ta')
    .description('Add code generation template from existing code')
    .option('-n, --name <name>', 'Template name (required)')
    .option('-t, --type <type>', 'Template type: crud, auth, export, report', 'crud')
    .option('-f, --files <files>', 'Code file paths (comma-separated, required)')
    .option('-d, --desc <desc>', 'Template description')
    .action(template_add_1.templateAddCommand);
// ================================================================
// 📖 帮助
// ================================================================
commander_1.program
    .command('help')
    .alias('h')
    .description('Display command help and search')
    .option('--command <command>', 'Show detailed help for specific command')
    .option('--search <keyword>', 'Search commands by keyword')
    .action(help_1.helpCommand);
// ================================================================
// 🌐 全量层命令
// ================================================================
commander_1.program
    .command('iteration-from-global')
    .alias('ifg')
    .description('Generate iteration from global layer requirements')
    .option('--reqs <reqs>', 'Requirement IDs (comma-separated, required)')
    .option('--name <name>', 'Iteration name (required)')
    .option('--force', 'Force overwrite existing iteration')
    .action(iteration_from_global_1.iterationFromGlobalCommand);
commander_1.program
    .command('word2spec')
    .alias('w2s')
    .description('Convert Word (.docx/.doc) requirement docs to SpecCore Markdown')
    .option('-f, --file <path>', 'Source Word file path')
    .option('-i, --iteration <name>', 'Target iteration name (required)')
    .option('-p, --platform <name>', 'Platform identifier (e.g. 后台/Web/小程序)')
    .option('--files <files>', 'Batch: "path1.docx=平台1,path2.docx=平台2"')
    .action(word2spec_1.word2specCommand);
commander_1.program
    .command('sync-global')
    .alias('sg')
    .description('Bidirectional sync between iteration and global layer')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--direction <direction>', 'Sync direction: to_global, from_global', 'to_global')
    .option('--auto', 'Auto-apply without confirmation')
    .option('--dry-run', 'Preview changes without applying')
    .option('--force', 'Skip preview and execute')
    .action(sync_global_1.syncGlobalCommand);
// ================================================================
// 📦 模式保存
// ================================================================
commander_1.program
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
    .action(pattern_1.patternCommand);
// ================================================================
// 🔙 回滚
// ================================================================
commander_1.program
    .command('rollback')
    .alias('rb')
    .description('Restore Spec files from .bak backups')
    .option('-t, --task <task>', 'Target task')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--list', 'List backups only, do not restore')
    .option('--confirm', 'Confirm restore (required to execute)')
    .action(rollback_1.rollbackCommand);
commander_1.program
    .command('global-status')
    .alias('gs')
    .description('View global layer status: all projects, requirements, architecture')
    .option('--project <name>', 'Filter by project name')
    .action(global_status_1.globalStatusCommand);
commander_1.program
    .command('ops')
    .alias('op')
    .description('View operation history (command log)')
    .action(history_2.opsCommand);
commander_1.program
    .command('history')
    .alias('hs')
    .description('View requirement change history')
    .option('--req <id>', 'Requirement ID (e.g., REQ-001)')
    .action(history_1.historyCommand);
// ================================================================
// 🔗 P0/P1/P2 新增命令
// ================================================================
commander_1.program
    .command('impact')
    .alias('if')
    .description('Intelligent impact analysis: analyze upstream/downstream effects of changes')
    .option('--req <id>', 'Requirement ID (e.g., REQ-001)')
    .option('--task <id>', 'Task ID (e.g., Task-001)')
    .option('--depth <n>', 'Trace depth (default: 3)', '3')
    .option('--output <format>', 'Output format: report, graph', 'report')
    .action(impact_1.impactCommand);
commander_1.program
    .command('baseline')
    .alias('bl')
    .description('Version baseline: create snapshots, compare, list, and rollback')
    .option('--name <name>', 'Baseline name')
    .option('--list', 'List all baselines')
    .option('--compare <name>', 'Compare current state with baseline')
    .option('--restore <name>', 'Restore to baseline')
    .option('--req <id>', 'Requirement ID for rollback')
    .action(baseline_1.baselineCommand);
commander_1.program
    .command('dashboard')
    .alias('db')
    .description('Generate visual dashboard (HTML + Chart.js)')
    .option('-o, --output <path>', 'Output file path', './speccore-dashboard.html')
    .action(dashboard_1.dashboardCommand);
commander_1.program
    .command('analyze')
    .alias('al')
    .description('Analyze requirements: completeness + code mapping + architecture impact → ANALYSIS.md')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('-o, --output <file>', 'Output filename', 'ANALYSIS.md')
    .option('--auto', 'Non-interactive mode: generate report directly')
    .option('-t, --task <task>', 'Per-task analysis: enriches TECH/TEST/REVIEW for one task')
    .action(analyze_1.analyzeCommand);
commander_1.program
    .command('audit')
    .alias('ad')
    .description('AI-powered audit: detect duplicates, ambiguity, and orphaned requirements')
    .option('--fix', 'Auto-fix fixable issues')
    .option('--detail', 'Show detailed analysis')
    .action(audit_1.auditCommand);
// 重命名
commander_1.program
    .command('rename')
    .alias('rn')
    .description('Rename iteration or task, auto-update all references')
    .option('--target <name>', 'Current name (required for single rename)')
    .option('--new-name <name>', 'New name (required for single rename)')
    .option('--batch', 'Batch rename mode')
    .option('--pattern <pattern>', 'Batch pattern to match')
    .option('--replacement <replacement>', 'Batch replacement string')
    .option('--force', 'Skip preview and execute')
    .action(rename_1.renameCommand);
// ================================================================
// 🆕 v4.0.0 新增命令
// ================================================================
commander_1.program
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
    .action(new_task_1.newTaskCommand);
commander_1.program
    .command('platform-add')
    .alias('padd')
    .description('Dynamically add a frontend platform type (v4.0)')
    .option('--name <name>', 'Platform identifier (required, e.g. tablet)')
    .option('--description <desc>', 'Platform display name')
    .option('--tech <tech>', 'Tech stack description')
    .option('--no-sync', 'Skip syncing to existing tasks')
    .action(platform_add_1.platformAddCommand);
commander_1.program
    .command('index-update')
    .alias('iu')
    .description('Scan requirements and rebuild GLOBAL/INDEX.md (v4.0)')
    .option('--dry-run', 'Preview mode, no actual changes')
    .action(index_update_1.indexUpdateCommand);
commander_1.program
    .command('context')
    .alias('ctx')
    .description('View task context loading status and dependency chain (v4.0)')
    .option('--req <req>')
    .option('--task <task>', 'Target task (default: current task)')
    .action(context_output_1.contextCommand);
// ================================================================
// 快捷别名（顶层别名）
// ================================================================
// 为常用命令提供顶层快捷访问
commander_1.program
    .command('rv')
    .description('[Alias] speccore validate')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('-t, --task <task>', 'Validate specific task')
    .option('--strict', 'Strict mode')
    .option('--fix', 'Auto-fix')
    .option('--format <format>', 'Output format: text or json', 'text')
    .action(validate_1.validateCommand);
// v4.7.0 体验增强命令
commander_1.program;
commander_1.program
    .command('lifecycle')
    .alias('lc')
    .description('Task lifecycle: pending → dev → test → review → done')
    .option('-t, --task <task>', 'Target task')
    .option('-s, --status <status>', 'Set status: pending/testing/review/done')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--check', 'Check TEST.md/REVIEW.md progress')
    .option('--all', 'Show all tasks kanban board')
    .action(lifecycle_1.lifecycleCommand);
commander_1.program
    .command('done')
    .alias('dn')
    .description('Complete a task: validate → archive → sync-global')
    .option('-t, --task <task>', 'Target task')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--skip-validate', 'Skip validation step')
    .option('--skip-sync', 'Skip global sync step')
    .action(done_1.doneCommand);
commander_1.program
    .command('completion [shell]')
    .alias('cmp')
    .alias('cmp')
    .description('Generate shell completion script (bash/zsh)')
    .action(completion_1.completionCommand);
commander_1.program
    .command('backup')
    .alias('bk')
    .description('Create backup of current state (v4.7)')
    .option('--list', 'List existing backups')
    .option('--restore <name>', 'Restore from backup')
    .action(backup_1.backupCommand);
// v4.8.0 高级功能
commander_1.program
    .command('hooks')
    .description('Install Git hooks (pre-commit + pre-push)');
commander_1.program
    .command('current')
    .alias('cr')
    .description('Show current branch task mapping (v4.8)')
    .option('--commit', 'Generate commit message')
    .option('--pr', 'Generate PR description')
    .action(current_1.currentCommand);
// v4.9.0 完善
commander_1.program
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
    .action(update_1.updateCommand);
// v5.3.0 新增命令
commander_1.program
    .command('diff')
    .alias('df')
    .description('Compare two iterations or baselines (v5.3)')
    .requiredOption('--source <name>', 'Source iteration/baseline')
    .requiredOption('--target <name>', 'Target iteration/baseline')
    .action(diff_1.diffCommand);
commander_1.program
    .command('tracker')
    .alias('tr')
    .description('View global requirement change tracker')
    .action(tracker_1.trackerCommand);
commander_1.program
    .command('merge-check')
    .alias('mc')
    .description('Predict merge conflicts across task branches')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .action(async (options) => { const { getDefaultIteration } = await Promise.resolve().then(() => __importStar(require('./core/context'))); const it = await getDefaultIteration(options.iteration); if (it)
    await (0, merge_check_1.mergeCheck)(it); });
commander_1.program
    .command('rollback')
    .alias('rb')
    .description('Rollback a task: revert branch + archive spec')
    .option('-t, --task <task>', 'Task to rollback')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--reason <reason>', 'Rollback reason')
    .action(async (options) => { const it = await require('../core/context').getDefaultIteration(options.iteration); if (it && options.task)
    await (0, merge_check_1.rollbackTask)(options.task, it, options.reason); });
commander_1.program
    .command('arch-update')
    .alias('au')
    .description('Auto-update ARCHITECTURE.md with new APIs/tables')
    .option('-i, --iteration <iteration>', 'Source iteration')
    .option('--apis <apis>', 'Comma-separated API paths')
    .option('--tables <tables>', 'Comma-separated table names')
    .action(async (options) => { const it = await require('../core/context').getDefaultIteration(options.iteration); if (it)
    await (0, merge_check_1.updateArchitecture)(it, (options.apis || '').split(',').filter(Boolean), (options.tables || '').split(',').filter(Boolean)); });
commander_1.program
    .command('merge-check')
    .alias('mc')
    .description('Predict merge conflicts across task branches')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .action(async (options) => { const { getDefaultIteration } = await Promise.resolve().then(() => __importStar(require('./core/context'))); const it = await getDefaultIteration(options.iteration); if (it)
    await (0, merge_check_1.mergeCheck)(it); });
commander_1.program
    .command('rollback')
    .alias('rb')
    .description('Rollback a task: revert branch + archive spec')
    .option('-t, --task <task>', 'Task to rollback')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--reason <reason>', 'Rollback reason')
    .action(async (options) => { const it = await require('../core/context').getDefaultIteration(options.iteration); if (it && options.task)
    await (0, merge_check_1.rollbackTask)(options.task, it, options.reason); });
commander_1.program
    .command('arch-update')
    .alias('au')
    .description('Auto-update ARCHITECTURE.md with new APIs/tables')
    .option('-i, --iteration <iteration>', 'Source iteration')
    .option('--apis <apis>', 'Comma-separated API paths')
    .option('--tables <tables>', 'Comma-separated table names')
    .action(async (options) => { const it = await require('../core/context').getDefaultIteration(options.iteration); if (it)
    await (0, merge_check_1.updateArchitecture)(it, (options.apis || '').split(',').filter(Boolean), (options.tables || '').split(',').filter(Boolean)); });
commander_1.program
    .command('trace')
    .alias('tr')
    .description('Show REQ → Task → Code trace chain (v5.3)')
    .option('--req <id>', 'Trace from requirement ID')
    .option('--task <id>', 'Trace from task ID')
    .option('--full', 'Full project trace')
    .action(trace_1.traceCommand);
// v5.5.0 新增命令
commander_1.program
    .command('delete')
    .alias('dl')
    .description('Delete a task or iteration (moves to trash + cleans references) (v5.5)')
    .option('--task <id>', 'Task ID to delete')
    .option('--iteration <name>', 'Iteration name to delete')
    .option('--force', 'Skip confirmation prompt')
    .action(delete_1.deleteCommand);
// v5.6.0 新增命令
commander_1.program
    .command('search <query>')
    .alias('sh')
    .description('Search across all Spec files for a keyword (v5.6)')
    .option('--task <id>', 'Limit search to a task')
    .option('--iteration <name>', 'Limit search to an iteration')
    .action((query, opts) => (0, search_1.searchCommand)({ ...opts, query }));
commander_1.program
    .command('watch')
    .alias('wch')
    .description('Watch Spec files and auto-validate on save (v5.6)')
    .option('--task <id>', 'Watch a specific task')
    .option('--iteration <name>', 'Watch a specific iteration')
    .action(watch_1.watchCommand);
// Parse arguments
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
            const idirs = items.filter((d) => d.startsWith('期次-')).sort();
            if (idirs.length > 0) {
                iteration = idirs[0].slice(3);
                const base = idirs[0];
                const req = join(base, '00-需求文档', 'REQUIREMENT.md');
                const ana = join(base, '00-需求文档', 'ANALYSIS.md');
                if (!existsSync(req)) {
                    phase = 'require';
                    nextCmd = 'speccore word2spec -i ' + iteration;
                    nextDesc = '导入需求文档';
                }
                else if (!existsSync(ana)) {
                    phase = 'analyze';
                    nextCmd = 'speccore analyze --iteration=' + iteration;
                    nextDesc = '需求分析';
                }
                else {
                    const tds = readdirSync(base).filter((d) => d.startsWith('Task-'));
                    if (tds.length === 0) {
                        phase = 'split';
                        nextCmd = 'speccore iteration split --iteration=' + iteration;
                        nextDesc = '拆分任务';
                    }
                    else {
                        total = tds.length;
                        for (const td of tds) {
                            const tm = join(base, td, 'backend', 'TASK.md');
                            if (existsSync(tm) && readFileSync(tm, 'utf-8').includes('已完成'))
                                done2++;
                        }
                        if (done2 < total) {
                            phase = 'dev';
                            nextCmd = 'speccore execute --task=' + tds[done2] + ' --force';
                            nextDesc = '执行开发 (' + (done2 + 1) + '/' + total + ')';
                        }
                        else {
                            phase = 'done';
                            nextCmd = 'speccore pr';
                            nextDesc = '创建 PR 提交代码';
                        }
                    }
                }
            }
        }
        catch { }
    }
    const icons = { init: '🚀', require: '📝', analyze: '🔍', split: '📦', dev: '💻', done: '✨' };
    const names = { init: '未初始化', require: '待导入需求', analyze: '待分析', split: '待拆分', dev: '开发中', done: '已完成' };
    logger.info('');
    logger.info('┌──────────────────────────────────────────┐');
    logger.info('│    SpecCore · v' + pkg.version + ' · 68 commands              │');
    logger.info('├──────────────────────────────────────────┤');
    if (iteration)
        logger.info('│  期次: ' + iteration.padEnd(33) + '│');
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
commander_1.program.parse();
//# sourceMappingURL=cli.js.map