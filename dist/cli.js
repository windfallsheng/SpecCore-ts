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
commander_1.program
    .name('speccore')
    .description('SpecCore CLI - Code by Spec, Not by Vibe.')
    .version(package_json_1.version, '-v, --version', 'Display current version');
// ==================== 初始化命令 ====================
commander_1.program
    .command('init')
    .description('Initialize SpecCore in current project')
    .option('--mode <mode>', 'Initialization mode: fresh or migration', 'fresh')
    .option('--force', 'Force overwrite existing configuration')
    .action(init_1.initCommand);
// ==================== 导入命令 ====================
commander_1.program
    .command('import')
    .description('Import existing project into SpecCore')
    .option('--source <source>', 'Source type: code, prd, prototype, all', 'all')
    .option('--path <path>', 'Source path', './')
    .option('--url <url>', 'Prototype URL')
    .option('--iteration <iteration>', 'Target iteration name')
    .action(import_1.importCommand);
// ==================== 期次命令 ====================
const iterationCmd = commander_1.program
    .command('iteration')
    .description('Iteration management commands');
iterationCmd
    .command('create')
    .description('Create a new iteration')
    .option('-n, --name <name>', 'Iteration name (required)')
    .option('--from <date>', 'Start date', new Date().toISOString().split('T')[0])
    .option('--to <date>', 'End date')
    .action(create_1.iterationCreateCommand);
iterationCmd
    .command('split')
    .description('Split requirements into tasks')
    .option('-f, --file <file>', 'Requirement file path', '00-需求文档/REQUIREMENT.md')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--sections <sections>', 'Specific sections to split')
    .option('--target <target>', 'Merge into existing task')
    .option('--dry-run', 'Preview without creating')
    .action(split_1.iterationSplitCommand);
// ==================== 任务命令 ====================
const taskCmd = commander_1.program
    .command('task')
    .description('Task management commands');
taskCmd
    .command('new')
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
// ==================== 调度命令 ====================
commander_1.program
    .command('plan')
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
// ==================== 执行命令 ====================
commander_1.program
    .command('execute')
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
// ==================== 验证命令 ====================
commander_1.program
    .command('validate')
    .description('Validate Spec compliance and integrity')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('-t, --task <task>', 'Validate specific task')
    .option('--type <type>', 'Filter by task type')
    .option('--fix', 'Auto-fix issues where possible')
    .option('--strict', 'Strict validation mode')
    .option('--format <format>', 'Output format: text, json', 'text')
    .action(validate_1.validateCommand);
// ==================== 归档命令 ====================
commander_1.program
    .command('archive')
    .description('Archive completed tasks')
    .option('-t, --task <task>', 'Archive specific task')
    .option('--all', 'Archive all completed tasks')
    .option('-i, --iteration <iteration>', 'Archive entire iteration')
    .option('--list', 'List archived tasks')
    .option('--restore <task>', 'Restore archived task')
    .option('--force', 'Skip preview and archive directly')
    .action(archive_1.archiveCommand);
// ==================== 进度命令 ====================
commander_1.program
    .command('progress')
    .description('Display project progress overview')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('-a, --assignee <assignee>', 'Filter by assignee')
    .option('--type <type>', 'Filter by task type')
    .option('--task <task>', 'Show specific task progress')
    .option('--detail', 'Show detailed progress')
    .option('--format <format>', 'Output format: text, json, csv', 'text')
    .action(progress_1.progressCommand);
// ==================== 状态命令 ====================
commander_1.program
    .command('status')
    .description('Display current project status')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('-a, --assignee <assignee>', 'Filter by assignee')
    .option('--type <type>', 'Filter by task type')
    .action(status_1.statusCommand);
// ==================== 健康度命令 ====================
commander_1.program
    .command('health')
    .description('Generate project health report')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--format <format>', 'Output format: text, json', 'text')
    .option('--trend', 'Include trend comparison')
    .action(health_1.healthCommand);
// ==================== 报告命令 ====================
commander_1.program
    .command('report')
    .description('Generate project report')
    .option('-i, --iteration <iteration>', 'Target iteration')
    .option('--format <format>', 'Output format: markdown, html, json', 'markdown')
    .option('-o, --output <path>', 'Output file path')
    .option('--team', 'Include team analysis')
    .option('--risk', 'Include risk analysis')
    .option('--trend', 'Include trend comparison')
    .action(report_1.reportCommand);
// ==================== 配置命令 ====================
commander_1.program
    .command('config')
    .description('Manage SpecCore configuration')
    .option('--get <key>', 'Get configuration value')
    .option('--set <key=value>', 'Set configuration value')
    .option('--reset', 'Reset to default configuration')
    .action(config_1.configCommand);
// Parse arguments
commander_1.program.parse();
//# sourceMappingURL=cli.js.map