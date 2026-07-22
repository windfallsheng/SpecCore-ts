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
// 新增命令
const spec_1 = require("./commands/spec");
const status_panel_1 = require("./commands/status-panel");
const welcome_1 = require("./commands/welcome");
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
// ── Custom human-readable help for `speccore` (no args) ──
commander_1.program
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
    commander_1.program.help();
});
commander_1.program.parse();
//# sourceMappingURL=cli.js.map