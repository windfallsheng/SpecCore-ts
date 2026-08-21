import { program } from 'commander';
import { version } from '../package.json';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { initCommand } from './commands/init';
import { validateCommand } from './commands/validate';
import { verifyCommand } from './commands/verify';
import { archiveCommand } from './commands/archive';
import { progressCommand } from './commands/progress';
import { reportCommand } from './commands/report';
import { configCommand } from './commands/config';
import { iterationCreateCommand } from './commands/iteration/create';
import { iterationSplitCommand } from './commands/iteration/split';
import { iterationListCommand } from './commands/iteration/list';
import { taskNewCommand } from './commands/task/new';
import { taskListCommand } from './commands/task/list';
import { planCommand } from './commands/plan';
import { executeCommand } from './commands/execute';
// 新增命令
import { askCommand } from './commands/ask';
import { aboutCommand } from './commands/about';
import { doctorCommand } from './commands/doctor';
import { registerNotifyCommand } from './commands/notify';
import { registerRecommendCommand } from './commands/recommend';
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
import { knowledgeCommand, knowledgeExplainCommand, knowledgePathCommand, knowledgeQueryCommand } from './commands/knowledge';
import { graphQueryCommand, graphEntityCommand, graphRelatedCommand, graphStatsCommand, graphPathCommand, graphRenderCommand } from './commands/graph';
import { doc2specCommand } from './commands/doc2spec';
import { spec2docCommand } from './commands/spec2doc';
import { registerCodeIndexCommand } from './commands/code-index';
import { registerRagIndexCommand } from './commands/rag-index';
import { registerRefreshCommand } from './commands/refresh';
// 全量层命令
import { iterationFromGlobalCommand } from './commands/iteration-from-global';
import { syncGlobalCommand } from './commands/sync-global';
// P0/P1/P2 新增命令
import { impactCommand } from './commands/impact';
import { baselineCommand } from './commands/baseline';
import { auditCommand } from './commands/audit';
import { analyzeCommand } from './commands/analyze';
import { clarifyCommand } from './commands/clarify';
import { prCommand } from './commands/pr';
import { buildConstitution } from './core/constitution-builder';
import { contextCommand } from './commands/context-output';
import { doneCommand } from './commands/done';
// rename 命令
import { renameCommand } from './commands/rename';
import { retroCommand } from './commands/retro';
import { reindexCommand } from './commands/reindex';
import { updateCommand } from './commands/update';
import { migrateCommand } from './commands/migrate';
// v4.6.0 迁移命令
// v4.7.0 体验增强
import { completionCommand } from './commands/completion';
// v4.8.0 高级功能

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
import { promptsCommand } from './commands/prompts';
// v5.21.0 任务调度
import { HELP_PANEL } from './core/help-panel';
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

program
  .command('ask [input...]')
  .description('Natural language intent recognition (previously "spec")')
  .option('--explicit', '显式 speccore 调用（来自 /spec-ask Skill），跳过意图域确认')
  .action((input: string[], options: any) => askCommand(input.join(' '), options));

program
  .command('doctor')
  .alias('dr')
  .description('🏥 项目健康度诊断：检查配置完整性、图谱时效性、迭代健康度')
  .option('--fix', '自动修复可修复的问题')
  .action(doctorCommand);

program
  .command('about')
  .description('版本信息 & 升级内容 & 有用的链接')
  .action(aboutCommand);

// ================================================================
// 👋 引导与体验
// ================================================================

program
  .command('dashboard')
  .alias('db')
  .description('项目仪表盘：迭代状态+进度+健康度（--scope global 全量视图）')
  .option('--export <format>', 'Export: json | md | html')
  .option("--assignee <name>", "导出指定人员的统计")
  .option("--platform <platform>", "导出指定平台: backend | frontend | web | h5 | miniapp")
  .option("--type <type>", "导出指定类型: feature | bugfix | research")
  .option('--health', '项目健康度报告')
  .option('--lifecycle', '任务生命周期看板（等效 lifecycle --all）')
  .option('--scope <scope>', '视图: iteration(默认/当前迭代) | global(全量)', 'iteration')
  .action(statusPanelCommand);

program
  .command('status-panel')
  .alias('sp')
  .description('→ dashboard（同一命令）')
  .action((opts: any) => statusPanelCommand(opts));

program
  .command('knowledge')
  .alias('kg')
  .description('知识图谱可视化：交互式图谱 + 衰减检测 + RAG 上下文预览')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--export <path>', 'Export HTML to custom path')
  .action(knowledgeCommand);

program
  .command('knowledge-explain <node>')
  .alias('kg-explain')
  .description('解释代码知识图谱中的节点及其连接')
  .action(knowledgeExplainCommand);

program
  .command('knowledge-path <from> <to>')
  .alias('kg-path')
  .description('查找代码图谱中两个节点之间的最短路径')
  .action(knowledgePathCommand);

program
  .command('knowledge-query <question>')
  .alias('kg-query')
  .description('自然语言查询代码知识图谱')
  .action(knowledgeQueryCommand);

// v7.0.0+: 统一图谱查询命令（融合知识图谱 + 代码图谱）
const graphCmd = program
  .command('graph')
  .alias('g')
  .description('统一图谱查询：融合知识图谱 + 代码图谱');

graphCmd
  .command('query <question>')
  .alias('q')
  .description('自然语言查询两种图谱（默认启用 LLM 语义增强）')
  .option('-t, --type <type>', '查询范围: all | knowledge | code', 'all')
  .option('-l, --limit <n>', '最多返回结果数', '10')
  .option('--smart', '启用 LLM 语义增强（默认开启）', true)
  .option('--fast', '快速模式，跳过 LLM 语义增强')
  .action((question: string, opts: any) => graphQueryCommand(question, {
    type: opts.type,
    limit: parseInt(opts.limit, 10),
    smart: opts.fast ? false : opts.smart !== false,
  }));

graphCmd
  .command('entity <id>')
  .alias('e')
  .description('查询特定实体详情')
  .option('-t, --type <type>', '查询范围: all | knowledge | code', 'all')
  .action((id: string, opts: any) => graphEntityCommand(id, { type: opts.type }));

graphCmd
  .command('related <id>')
  .alias('r')
  .description('查询实体的关联实体（一阶邻居）')
  .action((id: string) => graphRelatedCommand(id, {}));

graphCmd
  .command('path <from> <to>')
  .alias('p')
  .description('查找两实体间的最短路径')
  .option('-t, --type <type>', '查询范围: all | knowledge | code', 'all')
  .action((from: string, to: string, opts: any) => graphPathCommand(from, to, { type: opts.type }));

graphCmd
  .command('stats')
  .alias('s')
  .description('输出两种图谱的统计信息')
  .option('-t, --type <type>', '统计范围: all | knowledge | code', 'all')
  .action((opts: any) => graphStatsCommand({ type: opts.type }));

// v7.0.0+: Mermaid 图表渲染
graphCmd
  .command('render [file]')
  .alias('r')
  .description('渲染 Mermaid 图表为 HTML（支持 .mmd 文件或从 Markdown 提取）')
  .option('--all', '批量渲染 diagrams/ 目录下所有 .mmd')
  .option('--extract', '从 Markdown 文件提取 Mermaid 代码块')
  .option('-o, --output <dir>', '输出目录')
  .action((file: string | undefined, opts: any) => graphRenderCommand(file, {
    all: opts.all,
    extract: opts.extract,
    output: opts.output,
  }));

program
  .command('dev')
  .alias('d')
  .description('智能级联：--auto 全自动流水线，--from/--to 指定起止阶段')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--force', 'Auto-execute without confirmation')
  .option('--auto', '全自动流水线：init→doc2spec→analyze→split→plan→execute→pr→done→spec2doc')
  .option('--auto-steps <steps>', '指定连续步骤自动执行（如 analyze,split,execute）')
  .option('--from <phase>', '从指定阶段开始（init/doc2spec/analyze/split/plan/execute/pr/done/spec2doc）')
  .option('--to <phase>', '到指定阶段结束（init/doc2spec/analyze/split/plan/execute/pr/done/spec2doc）')
  .option('--web', '强制输出 HTML 页面')
  .option('--lang <lang>', 'en 英文 / zh 中文（默认中文）')
  .action(devCommand);

program
  .command('synthesize')
  .alias('syn')
  .description('→ analyze --full（同一命令，向后兼容别名）')
  .option('-I, --iteration <iteration>', '目标迭代')
  .option('--with-code', '结合源码检查需求冲突')
  .option('--prompt', '输出结构化 Prompt 到 stdout（Skill 协作模式）')
  .option('--apply <content>', '接收 AI 合成结果写入文件（配合 --prompt）')
  .option('--full', '全自动三阶段：逐端分析 → 跨端综合 → 功能单元需求合成')
  .option('--phase <n>', '单阶段执行: 1=逐端分析, 2=跨端综合, 3=功能单元合成')
  .option('--apply-phase <n>', '配合 --apply 使用，指定写入哪个阶段的结果')
  .action((opts: any) => {
    // 向后兼容：synthesize 自动转为 analyze --full
    analyzeCommand({ ...opts, full: true });
  });

program
  .command('prompts')
  .alias('pt')
  .description('提示词库：预置模板 + 自定义提示词，搜索/分类/CRUD/复制')
  .option('--web', '在浏览器中打开')
  .option('-o, --output <path>', '输出路径')
  .action(promptsCommand);

program

// ================================================================
// 🏗️ 初始化与导入
// ================================================================
program
  .command('init')
  .alias('in')
  .description('初始化 SpecCore（--interactive 引导式）')
  .option('--mode <mode>', 'Initialization mode: fresh or migration', 'fresh')
  .option('--force', 'Force overwrite existing configuration')
  .option('--interactive', 'Interactive guided setup: mode → confirm → init')
  .option('--auto', '全自动流水线：无人干预级联执行全部阶段')
  .option('--from <phase>', '从指定阶段开始（init/analyze/split/plan/execute/pr/done）')
  .option('--update', '增量升级项目命令文件（不重置配置）')
  .option('--tools <tools>', '指定工具（逗号分隔，默认全部）: cursor | trae | trae-cn | windsurf | claude | codebuddy | qoder')
  .action(initCommand);

// ================================================================
// 🔄 迁移命令
// ================================================================
program
  .command('migrate')
  .alias('mg')
  .description('项目内容迁移：任务目录、规格文件等')
  .option('--type <type>', '迁移类型: tasks | specs | all (默认: all)')
  .option('-i, --iteration <iteration>', '指定迭代（默认所有）')
  .option('--dry-run', '预览模式，不执行实际迁移')
  .option('--force', '强制覆盖已存在的目标')
  .action(migrateCommand);

// ================================================================
// 📋 迭代管理
// ================================================================
const iterationCmd = program
  .command('iteration')
  .alias('it')
  .description('迭代创建/拆分/列表');

iterationCmd
  .command('create')
  .alias('c')
  .description('创建新迭代')
  .option('-n, --name <name>', '迭代名称（必填）')
  .option('--topic <topic>', '英文主题词（如 meeting-system）')
  .option('--from <phase>', '从指定阶段开始')
  .option('--to <phase>', '到指定阶段结束')
  .option('--owner <name>', '负责人')
  .action(iterationCreateCommand);

iterationCmd
  .command('split')
  .alias('sp')
  .description('拆分需求为独立Task：预览→逐一确认/一键创建')
  .option('-f, --file <file>', 'Requirement file path', 'REQUIREMENT.md')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--sections <sections>', 'Specific sections to split')
  .option('--target <target>', 'Merge into existing task')
  .option('-p, --platforms <platforms>', 'Comma-separated platforms (auto-detected if omitted)')
  .option('--modules <modules>', 'Comma-separated module names to split (e.g. "购物车,订单")')
  .option('--dry-run', 'Preview without creating')
  .option('--interactive', 'Preview → adjust → confirm before creating')
  .option('--strict', 'Review each section before creating tasks')
  .option('--scheduled', '夜间调度：只执行标记为 queue 的任务')
  .option('--verify', '生成代码后自动检查 TEST/REVIEW/DEPLOY → 最多3轮自动修复')
  .option('--prompt', '输出结构化 Prompt 到 stdout（Skill 协作模式）')
  .option('--response <response>', '接收 AI 拆分结果创建 Task（配合 --prompt）')
  .option('--force', '已有任务时强制覆盖')
  .option('--prune', '清理与当前 FUNCTION_MAP.md 不匹配的旧任务（移动到 archive）')
  .option('--ignore-specs-update', '跳过 020-specs/ 变更检测')
  .option('--dev-guide', '生成任务级 DEV_GUIDE.md 开发者实现指南')
  .option('-g, --granularity <level>', '拆分粒度: macro(粗) | module(中,默认) | atomic(细)')
  .action(iterationSplitCommand);

iterationCmd
  .command('list')
  .alias('ls')
  .description('列出所有迭代')
  .action(iterationListCommand);

// ================================================================
// 📝 任务管理
// ================================================================
const taskCmd = program
  .command('task')
  .alias('tk')
  .description('任务管理：创建/列表/状态');

taskCmd
  .command('new')
  .alias('n')
  .description('创建新任务')
  .option('-n, --name <name>', '任务名称（必填）')
  .option('--topic <topic>', '英文主题词（如 user-login）')
  .option('-t, --type <type>', '任务类型: feature|bugfix|research|review|test|docs|refactor|deploy|security|performance', 'feature')
  .option('-d, --desc <desc>', '任务描述')
  .option('--platforms <platforms>', '前端平台: web,h5,miniapp')
  .option('--backend-only', '仅后端')
  .option('--frontend-only', '仅前端')
  .option('-i, --iteration <iteration>', '目标迭代')
  .option('--batch <tasks>', '批量创建')
  .option('--batch-file <path>', '从文件批量导入')
  .option('--interactive', '交互式创建')
  .option('--id <id>', '手动指定任务 ID（如 Task-005），计数器仍会递增')
  .option('--schedule <mode>', '调度模式: night|now', 'now')
  .action(taskNewCommand);

taskCmd
  .command('list')
  .alias('ls')
  .description('列出当前迭代的所有任务')
  .option('-i, --iteration <iteration>', '目标迭代')
  .action(taskListCommand);

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
    .option("--prompt", "输出 PR 描述 Prompt 到 stdout（Skill 协作模式）")
  .option("--response <response>", "接收 AI 生成的 PR 描述")
  .action(prCommand);

program
  .command('plan')
  .alias('pl')
  .description('生成执行计划+管理历史：创建/交互/列表/详情/取消/删除')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--topic <topic>', '英文主题词（如 meeting-system）')
  .option('-t, --team <count>', 'Team member count', '3')
  .option('-a, --assign <members>', 'Assign to specific members (comma-separated)')
  .option('--type <type>', 'Filter by task type')
  .option('--priority <priority>', 'Filter by priority')
  .option('--mode <mode>', 'Plan mode: auto, claim, parallel', 'auto')
  .option('--dry-run', 'Preview without saving')
  .option('--interactive', 'Preview → adjust → confirm before saving')
  .option('--select', '列出所有任务供多选具体要执行哪些')
  .option('--list', 'Show plan history')
  .option('--show <id>', 'Show plan detail')
  .option('--delete <id>', 'Delete a plan')
  .option('--cancel <id>', 'Cancel a plan (keep record)')
  .option('--prompt', '输出结构化 Prompt 到 stdout（Skill 协作模式）')
  .option('--response <response>', '接收 AI 计划写入 plan.json（配合 --prompt）')
  .option('--html', '生成 speccore-plan.html 可视化页面')
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
  .option('--prompt', '输出结构化 Prompt 到 stdout，等待宿主 AI 生成代码（Skill 协作模式）')
  .option('--response <response>', '接收宿主 AI 返回的代码内容并写入文件（配合 --prompt 使用）')
  .option('--list-pending', '列出待执行任务清单（拓扑排序 + 批次分组，JSON 格式）')
  .option('--ignore-upstream-update', '跳过上游 020-specs/ 变更检测')
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
  .description('需求变更：联动更新所有关联 Spec → 支持口语 (v6.73.0+ AI 驱动)')
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
  // v6.73.0+ 变更驱动工作流 v2
  .option('--file <file>', '指定变更需求文件（逗号分隔多个）')
  .option('--dir <dir>', '指定变更需求目录（批量处理）')
  .option('--inbox', '读取默认变更收件箱 .speccore/changes/pending/')
  .option('--new', '显式指定为新增需求（默认自动检测）')
  .option('--with-code', '启用代码级影响分析（需要代码索引）')
  .option('--keep', '保留原始文件（不移动/不删除）')
  .option('--delete-after-process', '处理后删除原始文件（默认归档）')
  .option('--batch-size <n>', '批量处理数量', '1')
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
  .option('--global', '迭代 ↔ 全量层双向同步（原 sync-global）')
  .option('--direction <dir>', '配合 --global: to_global | from_global', 'to_global')
  .option('--detect', 'Detect code-spec discrepancies (read-only, no changes)')
  .action(async (opts: any) => {
    if (opts.global) {
      // --global: 委托给 syncGlobalCommand
      return syncGlobalCommand({
        iteration: opts.iteration,
        direction: opts.direction || 'to_global',
        auto: opts.auto,
        dryRun: opts.dryRun,
        force: opts.force,
      });
    }
    return syncCommand(opts);
  });

// ================================================================
// ✅ 审查与验证
// ================================================================
program
  .command('validate')
  .alias('vl')
  .description('合规验证：检查 Spec 完整性与一致性')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('-t, --task <task>', 'Validate specific task')
  .option('--type <type>', 'Filter by task type')
  .option('--fix', 'Auto-fix issues where possible')
  .option('--strict', 'Strict validation mode')
  .option('--scheduled', '夜间调度：只执行标记为 queue 的任务')
  .option('--verify', '生成代码后自动检查 TEST/REVIEW/DEPLOY → 最多3轮自动修复')
  .option('--format <format>', 'Output format: text, json', 'text')
  .action(validateCommand);

program
  .command('verify')
  .alias('vf')
  .description('代码验证：编译检查 + Lint + 单元测试（执行后质量门禁）')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('-t, --task <task>', 'Verify specific task')
  .option('--type <type>', 'Check type: compile, lint, test, all', 'all')
  .option('--path <path>', 'Code path to verify')
  .option('--timeout <ms>', 'Check timeout in ms', '120000')
  .action(verifyCommand);

// 源码索引
registerCodeIndexCommand(program);

// RAG 索引管理
registerRagIndexCommand(program);

// 统一刷新所有检索层
registerRefreshCommand(program);

// v6.95.0+: 通知管理
registerNotifyCommand(program);

// v6.96.0+: 智能推荐
registerRecommendCommand(program);

// 全量索引重建与一致性检查
program
  .command('reindex')
  .description('全量索引重建与一致性检查（扫描全局/迭代/代码三层）')
  .option('--check', '只检查一致性，不修复')
  .option('-i, --iteration <iteration>', '指定迭代（默认当前迭代）')
  .action(reindexCommand);

// ================================================================
// 📊 进度与状态
// ================================================================
program

program
  .command('status')
  .alias('st')
  .description('项目状态 → status-panel（同一入口）')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('-a, --assignee <assignee>', 'Filter by assignee')
  .action(statusPanelCommand);

program
  .command('health')
  .alias('hl')
  .description('项目健康度 → status-panel --health')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .action((opts: any) => statusPanelCommand({ ...opts, health: true }));

program
  .command('progress')
  .alias('pg')
  .description('查看迭代进度：任务完成率 + 各阶段统计')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('-a, --assignee <assignee>', 'Filter by assignee')
  .option('-t, --type <type>', 'Filter by task type')
  .option('--detail', 'Show per-task detail')
  .option('--format <format>', 'Output format: text, json', 'text')
  .action(progressCommand);

program
  .command('report')
  .alias('rp')
  .description('生成项目报告：团队/风险/趋势分析')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--format <format>', 'Output format: md, html, pdf', 'md')
  .option('-o, --output <path>', 'Output file path')
  .option('--team', 'Include team performance report')
  .option('--risk', 'Include risk analysis')
  .option('--trend', 'Include trend analysis')
  .action(reportCommand);

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
  .command('archive')
  .alias('ar')
  .description('归档任务：移至 archive/ 或从归档恢复')
  .option('-t, --task <task>', 'Target task')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--all', 'Archive all completed tasks')
  .option('--list', 'List archived tasks')
  .option('--restore <task>', 'Restore from archive')
  .option('--force', 'Skip confirmation')
  .action(archiveCommand);

// ================================================================
// ⚙️ 配置与工具
// ================================================================
program
  .command('context')
  .alias('ctx')
  .description('查看上下文 / 快速切换迭代 (--set)')
  .option('-t, --task <task>', 'Target task')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--set', 'Set current iteration (e.g. --set --iteration Q3)')
  .action(contextCommand);

program
  .command('update')
  .alias('up')
  .description('升级项目文件和命令（增量更新，不破坏数据）')
  .option('-f, --force', '强制刷新所有命令文件')
  .option('--arch', '更新 ARCHITECTURE.md（原 arch-update）')
  .option('-i, --iteration <iteration>', '配合 --arch: 源迭代')
  .option('--apis <apis>', '配合 --arch: 逗号分隔 API 路径')
  .option('--tables <tables>', '配合 --arch: 逗号分隔表名')
  .action(async (opts: any) => {
    if (opts.arch) {
      // --arch: 委托给 arch-update 逻辑
      const it = await require('../core/context').getDefaultIteration(opts.iteration);
      if (it) await updateArchitecture(it, (opts.apis || '').split(',').filter(Boolean), (opts.tables || '').split(',').filter(Boolean));
      return;
    }
    return updateCommand(opts);
  });

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
  .action(iterationFromGlobalCommand);

program
  .command('doc2spec')
  .alias('d2s')
  .description('导入 PRD/文档 → SpecCore MD（双路验证：AI + Pandoc）')
  .option('-f, --file <path>', '源文件路径')
  .option('--iter <name>', '目标迭代（必填）')
  .option('-p, --platform <name>', '平台标识（backend / frontend-web / frontend-h5）')
  .option('--task <task>', '导入到指定 Task 目录')
  .option('--files <files>', '批量: "a.docx=平台1,b.pdf=平台2"')
  .option('--no-ai', '纯 pandoc 机械转换（终端快速模式）')
    .option("--prompt", "输出验证 Prompt 到 stdout（Skill 协作模式）")
  .option("--response <response>", "接收 AI 修正内容写入文件")
  .option("--classify", "AI 智能分类 sources/ 文档 → staging/（按类型提取）")
  .action(doc2specCommand);

program
  .command('spec2doc')
  .alias('s2d')
  .description('SpecCore MD → Word/PDF/HTML/PPTX 导出')
  .option('-i, --iteration <name>', '目标迭代')
  .option('-t, --task <task>', '导出指定任务文档')
  .option('-f, --file <path>', '直接导出指定 .md 文件（相对/绝对路径）')
  .option('--format <format>', '输出格式: docx|pdf|html|pptx', 'docx')
  .option('-o, --output <path>', '输出文件路径')
  .option('--all', '导出迭代全部文档（合并）')
  .option('--no-ai', '纯 pandoc 导出（终端快速模式）')
    .option("--prompt", "输出文档审计 Prompt 到 stdout（Skill 协作模式）")
  .option("--apply <content>", "接收 AI 优化文档写入文件")
  .action(spec2docCommand);

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
  .option('--confidence <confidence>', 'Confidence level: EXTRACTED | INFERRED (v6.91.0+)')
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
  .description('→ dashboard --scope global')
  .action(() => statusPanelCommand({ scope: 'global' }));

program
  .command('sync-global')
  .alias('syg')
  .description('→ sync --global（同一命令，向后兼容别名）')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('-d, --direction <dir>', 'Sync direction: to_global | from_global', 'to_global')
  .option('--auto', 'Auto-apply without confirmation')
  .option('--dry-run', 'Preview without modifying')
  .option('--force', 'Skip confirmation')
  .action((opts: any) => syncGlobalCommand(opts));

program
  .command('ops')
  .alias('op')
  .description('操作历史：查看命令执行日志')
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
  .description('统一分析: 需求文档 + 源码目录 → 按范围(全局/迭代/任务)生成分析报告，--audit 审计模式')
  .option('-I, --iteration <iteration>', '目标迭代 (scope=iteration|task 时必填)')
  .option('-t, --task <task-id>', '任务 ID (--scope task 快捷方式)')
  .option('--type <type>', '任务类型: feature|bugfix|refactor|research|review|test|docs|deploy|security|performance', 'feature')
  .option('--scope <scope>', '输出范围: global(全局文档) | iteration(迭代, 默认) | task(任务)')
  .option('--src, --source <dirs>', '源码目录 (逗号分隔: --src backend/src,20-frontend/src)')
  .option('--req, --requirements <files>', '需求文档 (逗号分隔: --req docs/a.md,docs/b.md)')
  .option('-o, --output <file>', '输出文件名 (覆盖默认)')
  .option('--depth <depth>', '分析深度: quick | normal(默认) | deep')
  .option('--auto', '非交互: 生成结构化分析 Prompt，由 AI 执行分析 (默认)')
  .option('--interactive', '交互: AI 提问 → 回答 → 优化')
  .option('--prompt', '输出结构化 Prompt 到 stdout（Skill 协作模式）')
  .option('--with-code', '结合 CONSTITUTION.md 配置的工程源码一起分析')
  .option('--no-source', '不读取源码内容（默认会读）')
  .option('--source-scope <dirs>', '指定源码扫描目录（逗号分隔，如 src/commands,src/core）')
  .option('--supplement', '补充模式：追加未覆盖的源码到现有报告（不重新生成）')
  .option('--feature <name>', '局部分析：只分析指定功能模块（010-requirements/features/{name}/）')
  .option('--doc <path>', '局部分析：类型文档（如 bugs/login-timeout, refactors/db-pool）')
  .option('--platform <platform>', '指定端分析：只分析指定端的需求（如 admin / h5 / app / miniapp）')
  .option('--apply <content>', '接收 AI 分析结果写入 ANALYSIS.md（配合 --prompt）')
  .option('--audit-fix', '读取 QUALITY_AUDIT.md 并生成修复指令（配合 --prompt，最多 2 轮）')
  .option('--sync', '任务分析后局部回写 020-specs/（只更新受影响的功能模块，不全覆盖）')
  .option('--full', '全自动三阶段合成：逐端分析 → 跨端综合 → 功能单元需求合成（原 synthesize）')
  .option('--phase <n>', '单阶段合成执行: 1=逐端分析, 2=跨端综合, 3=功能单元合成')
  .option('--apply-phase <n>', '配合 --apply 使用，指定写入哪个阶段的合成结果')
  .option('--streaming', 'v6.74.0+: 启用流式全局分析（Phase 0→6，后端优先，实时关联调整）')
  .option('--streaming-phase <phase>', '流式分析指定阶段: phase0-scan|phase1-backend|phase2-global-update|phase3-frontend|phase4-cross-check|phase5-vertical-check|phase6-final-audit')
  .option('--incremental', 'v6.75.0+: 增量分析模式（基于上次分析，只分析变更/遗漏）')
  .option('--reanalyze', 'v6.75.0+: 重新分析（同 --incremental，检查遗漏+更新）')
  .option('--add-platform <platform>', 'v6.75.0+: 新增端分析（单独分析新端，更新全局文档）')
  .option('--context-guard', 'v6.75.0+: 启用上下文爆炸防护（预估大小+智能分段）')
  .option('--estimate-only', 'v6.75.0+: 只输出上下文预估报告，不执行分析')
  .option('--module <name>', 'v6.76.0+: 功能模块级全局分析（更新全局层+各端文档，区别于 --feature 局部分析）')
  .option('--clarify', 'v6.76.0+: 检测到非专业需求文档时，先进入澄清流程整理为 PRD')
  .option('--dev-guide', 'v6.76.0+: 生成 DEV_GUIDE.md 开发者实现指南')
  .option('--skip-clarify', 'v6.80.0+: 跳过需求澄清阶段（默认会先做需求质量检测和澄清）')
  .option('--layer <n>', 'v7.2.0+: 全局分析指定层级: 1=索引扫描, 2=跨端关联, 3=模块深入, 4=全局汇总')
  .option('--deep <doc>', 'v7.2.0+: 全局分析时对指定文档进行深度分析（如 ARCHITECTURE.md），只生成该文档')
  .option('--iterative', 'v7.2.0+: 迭代式补全模式 — 先输出大纲，确认后再逐节深入（配合 --deep 使用）')
  .action(analyzeCommand);

// v6.76.0+: 需求专业化命令
program
  .command('clarify')
  .alias('cl')
  .description('需求专业化：将口语化/非专业需求整理为 PRD 级文档')
  .argument('[input]', '需求描述（口语化）')
  .option('--from <file>', '从文件读取原始需求')
  .option('--to <iteration>', '目标迭代（决定写入位置）')
  .option('--prompt', '输出整理 Prompt 到 stdout（Skill 协作模式）')
  .option('--apply <content>', '接收 AI 整理结果写入文件（配合 --prompt）')
  .option('--check <file>', '检测指定文件的专业度，不整理')
  .option('--force', '强制整理（即使文档已足够专业）')
  .action((input: string | undefined, opts: any) => {
    clarifyCommand({ ...opts, input });
  });

program
  .command('audit')
  .alias('ad')
  .description('AI-powered audit: detect duplicates, ambiguity, and orphaned requirements')
  .option('--fix', 'Auto-fix fixable issues')
  .option('--detail', 'Show detailed analysis')
  .option('--specs', 'Audit 020-specs/ quality: enum consistency, API path alignment, coverage gaps')
  .option('-I, --iteration <name>', 'Target iteration for --specs audit')
  .action(auditCommand);

// 重命名
program
  .command('rename')
  .alias('rn')
  .description('重命名迭代/任务，自动更新所有关联引用')
  .option('--target <name>', 'Current name (required for single rename)')
  .option('--new-name <name>', 'New name (required for single rename)')
  .option('--batch', 'Batch rename mode')
  .option('--pattern <pattern>', 'Batch pattern to match')
  .option('--replacement <replacement>', 'Batch replacement string')
  .option('--force', 'Skip preview and execute')
  .action(renameCommand);

program
  .command('retro')
  .alias('rt')
  .description('任务回顾：生成复盘报告（RETRO.md + HTML）')
  .option('--task <id>', '任务 ID')
  .option('--tasks <ids>', '批量任务（逗号分隔）')
  .option('--all', '当前迭代所有任务')
  .option('--owner <name>', '按责任人筛选')
  .option('--type <type>', '按类型筛选: feature|bugfix|research|review|test|docs|refactor')
  .option('--iteration <name>', '迭代名称')
  .action(retroCommand);

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
  .description('任务生命周期 → status-panel --lifecycle')
  .option('-t, --task <task>', 'Target task')
  .option('-s, --status <status>', 'Set status: pending/testing/review/done')
  .option('-i, --iteration <iteration>', 'Target iteration')
  .option('--check', 'Check TEST.md/REVIEW.md progress')
  .action((opts: any) => statusPanelCommand({ ...opts, lifecycle: true }));

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
    .option("--prompt", "输出验收总结 Prompt 到 stdout（Skill 协作模式）")
  .option("--response <response>", "接收 AI 验收总结")
  .action(doneCommand);

program
  .command('completion [shell]')
  .alias('cmp')
  .description('Generate shell completion script (bash/zsh)')
  .action(completionCommand);

// v4.8.0 高级功能
program

// v5.27 新增命令: speccore update (项目升级)
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
  .description('→ track（同一命令，向后兼容别名）')
  .action(() => trackerCommand());

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
  .description('→ update --arch（同一命令，向后兼容别名）')
  .option('-i, --iteration <iteration>', 'Source iteration')
  .option('--apis <apis>', 'Comma-separated API paths')
  .option('--tables <tables>', 'Comma-separated table names')
  .action(async (options: any) => { const it = await require('../core/context').getDefaultIteration(options.iteration); if (it) await updateArchitecture(it, (options.apis || '').split(',').filter(Boolean), (options.tables || '').split(',').filter(Boolean)); });

program

program

program

program
  .command('trace')
  .description('→ track（同一命令，向后兼容别名）')
  .option('--req <id>', 'Trace from requirement ID')
  .option('--task <id>', 'Trace from task ID')
  .option('--full', 'Full project trace')
  .action((opts: any) => traceCommand(opts));

// v5.25 — 统一追踪入口
program
  .command('track')
  .alias('trk')
  .description('REQ→Task→Code 全链路追踪')
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
  .description('全文搜索：跨所有 Spec 文件关键词检索')
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

// ⚠️ schedule 命令已由 WorkBuddy Automations 替代
// 保留命令注册但标记为废弃，不再注册子命令
program
  .command('schedule')
  .alias('sc')
  .description('[已废弃] 定时调度已由 WorkBuddy Automations 替代')
  .action(() => {
    console.warn('⚠️  schedule 命令已废弃，定时调度功能由 WorkBuddy Automations 替代');
    console.log('   参考: https://github.com/windfallsheng/SpecCore-ts');
  });

program
  .command('welcome')
  .alias('wc')
  .description('显示欢迎面板（同 speccore 无参数）')
  .option('--web', '强制输出 HTML 页面')
  .action(welcomeCommand);

// Parse arguments
// ── 帮助分层：核心命令前置 ──
program.addHelpText('beforeAll', HELP_PANEL);

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
      const idirs = items.filter((d: string) => d.startsWith('Iteration-')).sort();
      if (idirs.length > 0) {
        iteration = idirs[0].slice(3);
        const base = idirs[0];
        const req = join(base, '020-specs', 'global', 'REQUIREMENT.md');
        const reqFallback = join(base, '020-specs', 'REQUIREMENT.md');
        const ana = join(base, '020-specs', 'global', 'ANALYSIS.md');
        const anaFallback = join(base, '020-specs', 'ANALYSIS.md');
        if (!existsSync(req) && !existsSync(reqFallback)) {
          phase = 'require'; nextCmd = 'speccore doc2spec --iteration ' + iteration; nextDesc = '导入需求文档';
        } else if (!existsSync(ana) && !existsSync(anaFallback)) {
          phase = 'analyze'; nextCmd = 'speccore analyze --iteration=' + iteration; nextDesc = '需求分析';
        } else {
          const tds = readdirSync(base).filter((d: string) => d.startsWith('Task-'));
          if (tds.length === 0) {
            phase = 'split'; nextCmd = 'speccore iteration split --iteration=' + iteration; nextDesc = '拆分任务';
          } else {
            total = tds.length;
            for (const td of tds) {
              // 向后兼容: 检查 {端}/TASK.md → _shared/TASK.md → 00-specs/TASK.md
              const taskDirPath = join(base, td);
              let found = false;
              // 新结构: 扫描子目录中的 TASK.md
              try {
                const subdirs = readdirSync(taskDirPath).filter((d: string) =>
                  !d.startsWith('.') && !d.startsWith('_') && !d.startsWith('9') &&
                  existsSync(join(taskDirPath, d)) && 
                  require('fs').statSync(join(taskDirPath, d)).isDirectory()
                );
                for (const sd of subdirs) {
                  const subTask = join(taskDirPath, sd, 'TASK.md');
                  if (existsSync(subTask) && readFileSync(subTask, 'utf-8').includes('已完成')) {
                    found = true; break;
                  }
                }
              } catch {}
              // 旧结构回退
              if (!found) {
                const tm = join(base, td, '00-specs', 'TASK.md');
                if (existsSync(tm) && readFileSync(tm, 'utf-8').includes('已完成')) found = true;
              }
              if (found) done2++;
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
  logger.info('│    SpecCore · v' + pkg.version + ' · 59 commands              │');
  logger.info('├──────────────────────────────────────────┤');
  if (iteration) logger.info('│  迭代: ' + iteration.padEnd(33) + '│');
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
  logger.info('│  📊 speccore dashboard  仪表盘（迭代/全局）       │');
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
