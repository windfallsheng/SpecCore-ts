"use strict";
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
const research_1 = require("./commands/research");
const change_1 = require("./commands/change");
const sync_1 = require("./commands/sync");
const handover_1 = require("./commands/handover");
const retro_1 = require("./commands/retro");
const template_add_1 = require("./commands/template-add");
const help_1 = require("./commands/help");
const demo_1 = require("./commands/demo");
const welcome_1 = require("./commands/welcome");
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
// rename 命令
const rename_1 = require("./commands/rename");
commander_1.program
    .name('speccore')
    .description('SpecCore - Code by Spec, Not by Vibe.')
    .version(package_json_1.version, '-v, --version', 'Display current version');
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
    .option('--iteration <iteration>', 'Target iteration name')
    .option('--project <name>', 'Project name for global layer import')
    .option('--type <type>', 'Project type: backend, web, h5, miniapp', 'backend')
    .option('--force', 'Force overwrite')
    .action(import_1.importCommand);
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
    .option('-f, --file <file>', 'Requirement file path', '00-需求文档/REQUIREMENT.md')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--sections <sections>', 'Specific sections to split')
    .option('--target <target>', 'Merge into existing task')
    .option('--dry-run', 'Preview without creating')
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
    .option('--id <id>', 'Task ID (auto-generated if omitted)')
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
    .option('--id <id>', 'Task ID')
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
    .option('--id <id>', 'Task ID')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--affected-task <task>', 'Affected task for regression')
    .action(bugfix_1.bugfixCommand);
// 技术调研
commander_1.program
    .command('research')
    .alias('rs')
    .description('Technical research: evaluate solutions and compare options')
    .option('-n, --name <name>', 'Research topic')
    .option('-d, --desc <desc>', 'Research description')
    .option('-t, --topic <topic>', 'Research topic (alias for --name)')
    .option('--options <options>', 'Comparison options (comma-separated)')
    .option('--id <id>', 'Task ID')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .action(research_1.researchCommand);
// ================================================================
// ⚡ 执行与调度
// ================================================================
commander_1.program
    .command('plan')
    .alias('pl')
    .description('Generate execution plan based on task dependencies')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('-t, --team <count>', 'Team member count', '3')
    .option('-a, --assign <members>', 'Assign to specific members (comma-separated)')
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
    .option('--interactive', 'Interactive selection')
    .option('--dry-run', 'Preview execution plan')
    .option('--resume', 'Resume from last interruption')
    .option('--parallel <count>', 'Parallel execution count', '1')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--force', 'Skip preview and execute directly')
    .action(execute_1.executeCommand);
// ================================================================
// 🔄 变更管理
// ================================================================
commander_1.program
    .command('change')
    .alias('ch')
    .description('Requirement change: update linked spec files automatically')
    .option('-t, --task <task>', 'Target task')
    .option('-d, --desc <desc>', 'Change description (required)')
    .option('--global', 'Global layer change (CONSTITUTION.md)')
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
    .option('--task <task>', 'Show specific task progress')
    .option('--detail', 'Show detailed progress')
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
    .command('config')
    .alias('cf')
    .description('Manage SpecCore configuration')
    .option('--get <key>', 'Get configuration value')
    .option('--set <key=value>', 'Set configuration value')
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
    .command('sync-global')
    .alias('sg')
    .description('Bidirectional sync between iteration and global layer')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--direction <direction>', 'Sync direction: to_global, from_global', 'to_global')
    .option('--auto', 'Auto-apply without confirmation')
    .option('--dry-run', 'Preview changes without applying')
    .option('--force', 'Skip preview and execute')
    .action(sync_global_1.syncGlobalCommand);
commander_1.program
    .command('global-status')
    .alias('gs')
    .description('View global layer status: all projects, requirements, architecture')
    .option('--project <name>', 'Filter by project name')
    .action(global_status_1.globalStatusCommand);
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
// 快捷别名（顶层别名）
// ================================================================
// 为常用命令提供顶层快捷访问
commander_1.program
    .command('nt')
    .description('[Alias] speccore task new')
    .option('-n, --name <name>', 'Task name')
    .option('-t, --type <type>', 'Task type', 'feature')
    .option('-d, --desc <desc>', 'Task description')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .action(new_1.taskNewCommand);
commander_1.program
    .command('rv')
    .description('[Alias] speccore validate')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('-t, --task <task>', 'Validate specific task')
    .option('--strict', 'Strict mode')
    .option('--fix', 'Auto-fix')
    .action(validate_1.validateCommand);
// Parse arguments
commander_1.program.parse();
//# sourceMappingURL=cli.js.map