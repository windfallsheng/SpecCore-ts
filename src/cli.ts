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

// ── Custom human-readable help for `speccore` (no args) ──
program
  .action(() => {
    const { logger } = require('./utils/logger');
    if (process.argv.length <= 2) {
      logger.info(`
┌──────────────────────────────────────────┐
│         SpecCore — Code by Spec          │
│         v5.17.1 · 68 commands            │
├──────────────────────────────────────────┤
│                                          │
│  🚀 新项目        speccore init           │
│  🤖 智能引导      speccore dev            │
│  📊 项目状态      speccore status-panel   │
│  💬 自然语言      speccore spec "..."     │
│                                          │
│  🔵 7 步核心流程:                         │
│  init → word2spec → analyze → split      │
│  → execute → pr → done                   │
│                                          │
│  💡 查全部命令    speccore --help         │
│  📖 场景指南      docs/场景实战.md        │
│                                          │
└──────────────────────────────────────────┘
`);
      return;
    }
    program.help();
  });

program.parse();
