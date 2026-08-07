/**
 * help — 命令帮助中心
 * 支持：全览 / 单个命令详解 / 关键词搜索 / 场景示例
 */

import { logger } from '../utils/logger';
import { isAiContext, detectHostAi } from '../core/ask-host-ai';
import { getAllCommandMappings, getCommandMapping } from '../core/intent-recognition';

export interface HelpOptions {
  command?: string;
  search?: string;
  examples?: boolean;
}

export async function helpCommand(options: HelpOptions): Promise<void> {
  // 非 TTY → HTML 页面
  if (isAiContext() || !process.stdout.isTTY) {
    await helpHtml(options);
    return;
  }

  if (options.command) {
    await showCommandDetail(options.command);
    return;
  }

  if (options.search) {
    await searchCommands(options.search);
    return;
  }

  if (options.examples) {
    showExamples();
    return;
  }

  showAllCommands();
}

// ============================================================
// 核心命令参数详解（按简洁模式 19 个命令）
// ============================================================
const COMMAND_PARAMS: Record<string, { desc: string; params: { flag: string; meaning: string }[]; examples: string[] }> = {
  init: {
    desc: '初始化 SpecCore 项目',
    params: [
      { flag: '--full', meaning: '全量模式（79+ 命令），默认简洁模式' },
    ],
    examples: ['speccore init', 'speccore init --full'],
  },
  'status-panel': {
    desc: '项目状态看板 → 已合并到 dashboard',
    params: [
      { flag: '--scope global', meaning: '全量视图（所有项目+迭代）' },
      { flag: '--scope iteration', meaning: '当前迭代视图' },
      { flag: '--export <path>', meaning: '导出 HTML 文件' },
    ],
    examples: [
      'speccore dashboard',
      'speccore dashboard --scope global',
      'speccore dashboard --scope global --export=html',
      'speccore dashboard --export=demo.html',
    ],
  },
  'iteration create': {
    desc: '创建新迭代',
    params: [
      { flag: '-n, --name <name>', meaning: '迭代名称，如 Q1 / Sprint-3' },
      { flag: '--from <date>', meaning: '开始日期 YYYY-MM-DD' },
      { flag: '--to <date>', meaning: '结束日期 YYYY-MM-DD' },
      { flag: '--owner <name>', meaning: '迭代负责人' },
    ],
    examples: ['speccore iteration create -n Q1 --from=2026-04-01 --to=2026-06-30 --owner=赵六'],
  },
  'iteration split': {
    desc: '需求拆分为原子 Task',
    params: [
      { flag: '-i, --iteration <id>', meaning: '目标迭代' },
      { flag: '--interactive', meaning: '预览后逐一确认' },
    ],
    examples: ['speccore iteration split -i Q1', 'speccore iteration split -i Q1 --interactive'],
  },
  'task new': {
    desc: '手动创建 Task',
    params: [
      { flag: '-n, --name <name>', meaning: 'Task 名称（必填）' },
      { flag: '-t, --type <type>', meaning: '类型：feature | bugfix | research | optimization' },
      { flag: '-d, --desc <desc>', meaning: '详细描述' },
      { flag: '--platforms <p1,p2>', meaning: '前端平台：web,h5,miniapp' },
      { flag: '--backend-only', meaning: '只创建后端' },
      { flag: '--frontend-only', meaning: '只创建前端' },
      { flag: '-i, --iteration <id>', meaning: '目标迭代' },
    ],
    examples: [
      'speccore task new -n 用户登录 -t feature',
      'speccore task new -n 修复支付bug -t bugfix --backend-only',
      'speccore task new -n 首页重构 --platforms=web,h5',
    ],
  },
  import: {
    desc: '从存量项目导入（源码 / Excel / CSV）',
    params: [
      { flag: '--project <name>', meaning: '项目名（必填）' },
      { flag: '--path <path>', meaning: '源码路径或文件路径' },
      { flag: '--type <type>', meaning: '项目类型：backend | frontend（必填）' },
      { flag: '--force', meaning: '强制覆盖已有项目' },
      { flag: '--update', meaning: '增量追加' },
      { flag: '--interactive', meaning: '预览扫描结果后确认' },
      { flag: '--scope <scope>', meaning: '扫描范围：all | core | api' },
    ],
    examples: [
      'speccore import --project=user-svc --path=./src --type=backend',
      'speccore import --project=bugs --path=bugs.xlsx',
      'speccore import --project=req --path=requirements.csv',
      'speccore import --project=user-svc --path=./src --type=backend --interactive',
    ],
  },
  doc2spec: {
    desc: '将 Word/PDF/MD 文档转换为 SpecCore 需求',
    params: [
      { flag: '-f, --file <path>', meaning: '文档路径' },
      { flag: '-p, --platform <p>', meaning: '平台：backend | frontend | web | h5 | miniapp' },
      { flag: '-i, --iteration <id>', meaning: '目标迭代' },
    ],
    examples: [
      'speccore doc2spec -f PRD.docx -p backend -i Q1',
      'speccore doc2spec -f requirements.md -p frontend -i Q1',
    ],
  },
  analyze: {
    desc: 'AI 需求分析（全局 / 逐任务）',
    params: [
      { flag: '-i, --iteration <id>', meaning: '目标迭代' },
      { flag: '-t, --task <id>', meaning: '指定 Task ID' },
      { flag: '--auto', meaning: '自动模式（跳过交互提问）' },
      { flag: '--interactive', meaning: '交互问答模式' },
    ],
    examples: [
      'speccore analyze -i Q1',
      'speccore analyze -t Task-001 -i Q1 --auto',
    ],
  },
  plan: {
    desc: '生成执行计划 / 调度方案',
    params: [
      { flag: '-i, --iteration <id>', meaning: '目标迭代' },
      { flag: '--interactive', meaning: '预览调度方案后确认' },
      { flag: '--team <n>', meaning: '团队人数（控制并行度）' },
      { flag: '--strategy <name>', meaning: '调度策略：priority | dependency | balanced' },
    ],
    examples: ['speccore plan -i Q1', 'speccore plan -i Q1 --team=3'],
  },
  execute: {
    desc: 'AI 执行开发任务',
    params: [
      { flag: '-t, --task <id>', meaning: '指定 Task' },
      { flag: '--all', meaning: '执行所有待处理任务' },
      { flag: '--force', meaning: '跳过预览直接执行' },
      { flag: '--verify', meaning: '执行后自动检查 TEST/REVIEW/DEPLOY，最多 3 轮自动修复' },
      { flag: '--dry-run', meaning: '只预览不执行' },
      { flag: '--strict', meaning: '前置检查 req/tech/test 后生成代码' },
      { flag: '--interactive', meaning: '交互选择执行任务' },
      { flag: '--scheduled', meaning: '只执行标记为夜间队列的任务' },
      { flag: '--resume', meaning: '从上次中断处恢复' },
      { flag: '--skip <ids>', meaning: '跳过指定 Task ID(逗号分隔)' },
      { flag: '--only <ids>', meaning: '只执行指定 Task ID' },
      { flag: '-i, --iteration <id>', meaning: '目标迭代' },
    ],
    examples: [
      'speccore execute -t Task-001 --force',
      'speccore execute -t Task-001 --force --verify',
      'speccore execute --all --scheduled',
      'speccore execute -t Task-001 --dry-run',
    ],
  },
  pr: {
    desc: '推送代码 + 创建 Pull Request',
    params: [
      { flag: '-t, --task <id>', meaning: '关联的 Task' },
      { flag: '--interactive', meaning: '分步：选文件 → commit → 推送 → 创建 PR' },
      { flag: '--draft', meaning: '创建草稿 PR' },
      { flag: '--title <title>', meaning: '自定义 PR 标题' },
      { flag: '--base <branch>', meaning: '目标分支（默认 main）' },
      { flag: '-i, --iteration <id>', meaning: '目���迭代' },
    ],
    examples: [
      'speccore pr -t Task-001',
      'speccore pr -t Task-001 --interactive --draft',
    ],
  },
  done: {
    desc: '完成任务归档 + 自进化规则',
    params: [
      { flag: '-t, --task <id>', meaning: '指定 Task' },
      { flag: '--all', meaning: '归档所有已完成 Task' },
      { flag: '--interactive', meaning: '预览归档结果后确认' },
      { flag: '--skip-validate', meaning: '跳过合规验证' },
      { flag: '-i, --iteration <id>', meaning: '目标迭代' },
    ],
    examples: ['speccore done --task=Task-001', 'speccore done --all'],
  },
  bugfix: {
    desc: 'Bug 修复（单条 / 批量 / 文件导入）',
    params: [
      { flag: '-n, --name <name>', meaning: 'Bug 名称' },
      { flag: '-d, --desc <desc>', meaning: '详细描述' },
      { flag: '--batch <bugs>', meaning: '批量导入（换行分隔）' },
      { flag: '--batch-file <path>', meaning: '从 .xlsx / .csv 文件批量导入' },
      { flag: '--schedule <mode>', meaning: '调度：night（夜间执行）| now（立即）' },
      { flag: '--interactive', meaning: '预览 → 编辑 → 确认 → 创建' },
      { flag: '-i, --iteration <id>', meaning: '目标迭代' },
    ],
    examples: [
      'speccore bugfix -n "登录超时" -d "token过期未刷新"',
      'speccore bugfix --batch-file=bugs.xlsx --schedule=night --interactive',
    ],
  },
  change: {
    desc: '需求变更：自然语言输入（口语化）',
    params: [
      { flag: '-t, --task <id>', meaning: '受影响 Task' },
      { flag: '--desc <desc>', meaning: '变更描述（口语化）' },
      { flag: '--input <text>', meaning: '自然语言输入' },
      { flag: '--interactive', meaning: '预览影响范围 → 调整 → 确认' },
      { flag: '--dry-run', meaning: '只预览不影响' },
      { flag: '--global', meaning: '全局层变更（CONSTITUTION.md）' },
    ],
    examples: [
      'speccore change "把手机号改成支持国际号码" -t Task-001',
      'speccore change -t Task-001 --interactive',
    ],
  },
  dev: {
    desc: '智能检测当前阶段 + 全自动级联流水线',
    params: [
      { flag: '--auto', meaning: '全自动：级联执行 init→import→analyze→split→plan→execute→pr→done' },
      { flag: '--from <phase>', meaning: '从指定阶段开始：init|import|analyze|split|plan|execute|pr|done' },
      { flag: '-i, --iteration <id>', meaning: '目标迭代' },
    ],
    examples: [
      'speccore dev',
      'speccore dev --auto',
      'speccore dev --auto --from=split',
    ],
  },
  validate: {
    desc: 'Spec 合规检查',
    params: [
      { flag: '-i, --iteration <id>', meaning: '目标迭代' },
      { flag: '--all', meaning: '检查全部' },
    ],
    examples: ['speccore validate -i Q1', 'speccore validate --all'],
  },
  rename: {
    desc: '重命名任务 / 迭代 / 文件',
    params: [
      { flag: '--task <id>', meaning: '任务 ID' },
      { flag: '--name <new-name>', meaning: '新名称' },
    ],
    examples: ['speccore rename --task=Task-001 --name=用户模块重构'],
  },
  ops: {
    desc: '查看操作历史',
    params: [],
    examples: ['speccore ops'],
  },
  ask: {
    desc: '自然语言智能入口：说人话，自动匹配命令',
    params: [
      { flag: '<任意自然语言>', meaning: '口语化描述你的需求' },
    ],
    examples: [
      'speccore ask "帮我创建一个登录功能"',
      'speccore ask "查看项目进度"',
      'speccore ask "把登录改成验证码登录"',
      'speccore ask "修复支付回调超时的问题"',
    ],
  },
};

// ============================================================
// 展示
// ============================================================

function showAllCommands(): void {
  logger.info('📖 SpecCore 命令帮助 — 简洁模式（19 个命令）');
  logger.info('');

  const categories: Record<string, string[]> = {
    '🏗️ 初始化': ['init', 'import', 'doc2spec'],
    '📋 迭代与任务': ['iteration create', 'iteration split', 'task new', 'rename'],
    '🔍 分析与计划': ['analyze', 'plan'],
    '⚡ 执行与审查': ['execute', 'pr', 'done'],
    '🐛 变更与修复': ['change', 'bugfix'],
    '📊 状态与查询': ['status-panel', 'validate', 'ops'],
    '🤖 智能入口': ['ask', 'dev'],
  };

  for (const [cat, cmds] of Object.entries(categories)) {
    logger.info('');
    logger.info(`${cat}:`);
    for (const c of cmds) {
      const info = COMMAND_PARAMS[c] || { desc: '' };
      logger.info(`  speccore ${c.padEnd(20)} ${info.desc}`);
    }
  }

  logger.info('');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info('💡 speccore help --command=execute     查看命令详解 + 示例');
  logger.info('💡 speccore help --search=导入         搜索相关命令');
  logger.info('💡 speccore help --examples           查看完整场景示例');
  logger.info('💡 speccore ask "创建登录功能"         自然语言智能入口');
  logger.info('💡 speccore <命令> --help             查看 CLI 原生帮助');
}

function showExamples(): void {
  logger.info('📖 SpecCore 完整场景示例');
  logger.info('');

  const scenes = [
    {
      title: '一、从零开始',
      code: `speccore init                              # 初始化
speccore iteration create -n Q1 --from=2026-04-01 --to=2026-06-30 --owner=赵六
speccore doc2spec -f PRD.docx -p backend -i Q1  # 导入需求文档`,
    },
    {
      title: '二、存量项目导入',
      code: `speccore import --project=user-svc --path=./src --type=backend     # 源码导入
speccore import --project=bugs --path=bugs.xlsx                         # Excel 导入
speccore import --project=user-svc --path=./src --type=backend --interactive  # 交互确认`,
    },
    {
      title: '三、分析 + 拆分',
      code: `speccore analyze -i Q1                    # 需求分析
speccore iteration split -i Q1              # 拆分为 Task
speccore plan -i Q1                         # 生成执行计划`,
    },
    {
      title: '四、开发 + 提 PR',
      code: `speccore execute -t Task-001 --force --verify   # AI 开发 + 自动验证
speccore pr --task=Task-001                                # 推送 + 创建 PR
speccore done --task=Task-001                              # 完成归档`,
    },
    {
      title: '五、变更 + Bug',
      code: `speccore change "把手机号改成国际格式" -t Task-001    # 口语化变更
speccore bugfix --batch-file=bugs.xlsx --schedule=night --interactive  # 批量 Bug`,
    },
    {
      title: '六、全自动流水线',
      code: `speccore dev --auto                        # 一键跑完所有阶段
speccore dev --auto --from=split             # 从拆分开始自动化`,
    },
    {
      title: '七、查看进度',
      code: `speccore status-panel                    # 终端面板
speccore status-panel --export=html         # 导出 HTML 仪表盘
speccore status-panel --assignee=张三        # 只看某人`,
    },
  ];

  for (const s of scenes) {
    logger.info('');
    logger.info(`📌 ${s.title}`);
    logger.info(s.code);
  }
  logger.info('');
}

async function showCommandDetail(cmd: string): Promise<void> {
  const info = COMMAND_PARAMS[cmd];
  if (!info) {
    const all = getAllCommandMappings();
    const matched = all.filter(m => m.id.includes(cmd) || m.triggers.some(t => t.includes(cmd)));
    if (matched.length > 0) {
      logger.info(`🔍 找到 ${matched.length} 个匹配:`);
      for (const m of matched) {
        logger.info(`  speccore ${m.id}: ${m.description}`);
      }
      return;
    }
    logger.warn(`未找到 "${cmd}"。输入 speccore help 查看所有命令。`);
    return;
  }

  logger.info(`📖 speccore ${cmd}`);
  logger.info('');
  logger.info(`功能: ${info.desc}`);
  logger.info('');

  if (info.params.length > 0) {
    logger.info('参数:');
    for (const p of info.params) {
      logger.info(`  ${p.flag.padEnd(30)} ${p.meaning}`);
    }
    logger.info('');
  }

  if (info.examples.length > 0) {
    logger.info('示例:');
    for (const e of info.examples) {
      logger.info(`  $ ${e}`);
    }
    logger.info('');
  }
}

async function searchCommands(keyword: string): Promise<void> {
  const results: { cmd: string; info: typeof COMMAND_PARAMS[string] }[] = [];
  for (const [cmd, info] of Object.entries(COMMAND_PARAMS)) {
    if (cmd.includes(keyword) || info.desc.includes(keyword) || 
        info.params.some(p => p.meaning.includes(keyword)) ||
        info.examples.some(e => e.includes(keyword))) {
      results.push({ cmd, info });
    }
  }

  if (results.length === 0) {
    // 也尝试从 intent mappings 搜索
    const all = getAllCommandMappings();
    const matched = all.filter(m => m.id.includes(keyword) || m.description.includes(keyword));
    if (matched.length > 0) {
      logger.info(`🔍 找到 ${matched.length} 个匹配:`);
      for (const m of matched) logger.info(`  speccore ${m.id}: ${m.description}`);
      return;
    }
    logger.warn(`未找到匹配 "${keyword}"。`);
    logger.info('💡 试试: speccore help --examples  查看场景示例');
    return;
  }

  logger.info(`🔍 搜索 "${keyword}": ${results.length} 个结果`);
  logger.info('');
  for (const { cmd, info } of results) {
    logger.info(`  speccore ${cmd.padEnd(20)} ${info.desc}`);
  }
  logger.info('');
  logger.info('💡 speccore help --command=<命令> 查看详细参数');
}

// ============================================================
// AI 模式 HTML 输出
// ============================================================
async function helpHtml(options: HelpOptions): Promise<void> {
  const version = require('../../package.json').version;
  const now = new Date().toISOString().split('T')[0];
  let title = 'SpecCore 命令参考';
  let body = '';

  if (options.command) {
    const info = COMMAND_PARAMS[options.command];
    title = `${options.command} 命令详解`;
    body = info ? `<div class="cmd-detail"><div class="cmd-desc">${info.desc}</div>${info.params.length ? `<div class="param-list">${info.params.map(p=>`<div class="param"><span class="param-flag">${p.flag}</span><span class="param-meaning">${p.meaning}</span></div>`).join('')}</div>` : ''}${info.examples.length ? `<div class="example-list"><div class="section-label">示例</div>${info.examples.map(e=>`<code>$ ${e}</code>`).join('')}</div>` : ''}</div>` : `<p>未找到命令 "${options.command}"</p>`;
  } else {
    const categories: Record<string, string[]> = {
      '🧠 AI 入口': ['ask', 'welcome'],
      '🏗️ 初始化': ['init'],
      '📋 迭代与任务': ['iteration', 'task', 'rename'],
      '📝 文档转换': ['doc2spec', 'spec2doc'],
      '🔍 分析与计划': ['analyze', 'plan', 'split'],
      '⚡ 执行与交付': ['execute', 'pr', 'done'],
      '🔄 同步与变更': ['change', 'sync', 'ops'],
      '📊 查看与验证': ['dashboard', 'validate', 'track', 'search'],
      '🤖 智能操作': ['dev'],
    };
    body = Object.entries(categories).map(([cat, cmds]) => 
      `<div class="cat"><div class="cat-title">${cat}</div><div class="cat-cmds">${cmds.map(c => `<span class="cmd-pill">speccore ${c}</span>`).join('')}</div></div>`
    ).join('');
  }

  const html = `<!DOCTYPE html><html lang="zh-CN" data-theme="ocean"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>SpecCore Help</title><style>@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;600;700&display=swap');[data-theme="ocean"]{--cyan:#0ea5e9;--bg:#0b1929;--card:rgba(13,31,56,.95);--border:rgba(14,165,233,.15);--text:#bae6fd;--muted:#5b7fa5;--green:#14b8a6;--orange:#f97316;--purple:#6366f1}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'JetBrains Mono',monospace;background:var(--bg);color:var(--text);min-height:100vh;padding:40px 20px}.scanlines{position:fixed;inset:0;pointer-events:none;z-index:99;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,.01) 2px,rgba(0,240,255,.01) 4px)}.card{max-width:720px;margin:0 auto;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:36px;position:relative;overflow:hidden}.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX 3s linear infinite}.card::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX-rev 3s linear infinite}@keyframes scanX{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}@keyframes scanX-rev{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}@keyframes scanY{0%{transform:translateY(-100%)}100%{transform:translateY(100%)}}@keyframes scanY-rev{0%{transform:translateY(100%)}100%{transform:translateY(-100%)}}.vline{position:absolute;top:0;width:1px;bottom:0;pointer-events:none}.vline.l{left:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY-rev 3s linear infinite}.vline.r{right:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY 3s linear infinite}h1{font-family:'Orbitron',sans-serif;font-size:24px;font-weight:900;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:2px;margin-bottom:4px}.sub{color:var(--muted);font-size:11px;margin-bottom:20px}.cat{margin:12px 0;padding:12px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.04);border-radius:10px}.cat-title{font-size:10px;font-weight:700;color:var(--cyan);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}.cat-cmds{display:flex;flex-wrap:wrap;gap:6px}.cmd-pill{padding:3px 10px;border-radius:4px;font-size:10px;background:rgba(14,165,233,.1);color:var(--cyan);border:1px solid rgba(14,165,233,.15)}.cmd-detail{padding:8px 0}.cmd-desc{font-size:13px;margin-bottom:16px}.param-list{margin:12px 0}.param{display:flex;gap:12px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.03)}.param-flag{color:var(--green);font-size:11px;min-width:160px}.param-meaning{color:var(--muted);font-size:11px}.example-list{margin:12px 0}.section-label{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}code{display:block;background:rgba(14,165,233,.1);padding:4px 10px;border-radius:4px;color:var(--cyan);font-size:11px;margin:4px 0}.footer{text-align:center;color:var(--muted);font-size:10px;margin-top:24px;padding-top:16px;border-top:1px solid rgba(255,255,255,.04)}</style></head><body><div class="scanlines"></div><div class="card"><div class="vline l"></div><div class="vline r"></div><h1>SPECCORE HELP</h1><div class="sub">${title} · v${version}</div>${body}<div class="footer">由 SpecCore 驱动 v${version} · ${now}</div></div></body></html>`;

  const { writeFile } = require('fs-extra');
  const { join } = require('path');
  if (isAiContext()) { process.stdout.write(html); return; }
  const outPath = join(process.cwd(), 'speccore-help.html');
  await writeFile(outPath, html);
  logger.info(`✅ 已生成: ${outPath}`);
}
