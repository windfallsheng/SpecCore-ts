/**
 * help — 命令帮助中心
 * 支持：全览 / 单个命令详解 / 关键词搜索 / 场景示例
 */

import { logger } from '../utils/logger';
import { isAiContext, detectHostAi } from '../core/ask-host-ai';
import { getAllCommandMappings, getCommandMapping } from '../core/intent-recognition';
import { CORE_COMMANDS } from '../core/command-visibility';

export interface HelpOptions {
  command?: string;
  search?: string;
  examples?: boolean;
  all?: boolean;
}

export async function helpCommand(options: HelpOptions, program?: import('commander').Command): Promise<void> {
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

  if (options.all) {
    showAllCommandsFull(program);
    return;
  }

  showAllCommands();
}

// ============================================================
// 核心命令参数详解
// ============================================================
const COMMAND_PARAMS: Record<string, { desc: string; params: { flag: string; meaning: string }[]; examples: string[] }> = {
  init: {
    desc: '初始化 SpecCore 项目',
    params: [],
    examples: ['speccore init', 'speccore init --interactive'],
  },
  'req-doc': {
    desc: '需求文档化：口语化需求 → PRD 级文档',
    params: [
      { flag: '--from <file>', meaning: '从文件读取原始需求' },
      { flag: '--to <iteration>', meaning: '目标迭代' },
    ],
    examples: ['speccore req-doc "用户能用手机号登录" --to Q1'],
  },
  taskify: {
    desc: '拆功能单元 → 开发任务（同 iteration taskify）',
    params: [
      { flag: '-i, --iteration <iteration>', meaning: '目标迭代' },
      { flag: '--modules <modules>', meaning: '只重建指定模块' },
    ],
    examples: ['speccore taskify -i Q1'],
  },
  verify: {
    desc: '代码验证：编译 + Lint + 单测 + UI 冒烟（质量门禁）',
    params: [
      { flag: '--ui', meaning: '启用 UI 验证（冒烟 + 视觉检查）' },
      { flag: '--smoke-only', meaning: '仅执行冒烟测试' },
    ],
    examples: ['speccore verify', 'speccore verify --ui'],
  },
  pipeline: {
    desc: '流水线：合并分支 → 构建 → 部署（环境驱动）',
    params: [
      { flag: '-e, --env <env>', meaning: '目标环境（默认 staging）' },
      { flag: '-p, --platforms <list>', meaning: '逗号分隔端列表' },
    ],
    examples: ['speccore pipeline --env staging'],
  },
  spec2doc: {
    desc: 'Spec MD → Word/PDF/HTML/PPTX 导出',
    params: [
      { flag: '-i, --iteration <name>', meaning: '目标迭代' },
      { flag: '--format <format>', meaning: 'docx | pdf | html | pptx' },
    ],
    examples: ['speccore spec2doc -i Q1 --format docx'],
  },
  status: {
    desc: '项目状态面板（迭代/全局）',
    params: [
      { flag: '-i, --iteration <iteration>', meaning: '目标迭代' },
      { flag: '--scope <scope>', meaning: 'iteration | global' },
    ],
    examples: ['speccore status'],
  },
  about: {
    desc: '版本信息 & 升级内容 & 文档链接',
    params: [],
    examples: ['speccore about'],
  },
  help: {
    desc: '命令帮助与搜索（--all 全量清单）',
    params: [
      { flag: '--command <command>', meaning: '查看单命令详解' },
      { flag: '--search <keyword>', meaning: '关键词搜索命令' },
      { flag: '--all', meaning: '显示全部命令（含低频/运维）' },
    ],
    examples: ['speccore help', 'speccore help --all'],
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
  'iteration taskify': {
    desc: '需求拆分为开发任务（任务化，别名 taskify）',
    params: [
      { flag: '-i, --iteration <id>', meaning: '目标迭代' },
      { flag: '--interactive', meaning: '预览后逐一确认' },
      { flag: '--modules <names>', meaning: '只重建指定模块（v8.3.275+）：旧任务自动备份 .backup-*，其余保留' },
    ],
    examples: ['speccore iteration taskify -i Q1', 'speccore iteration taskify -i Q1 --interactive', 'speccore iteration taskify -i Q1 --modules "购物车"'],
  },
  unitize: {
    desc: '切分需求文档为功能单元（原 doc2spec --split；v8.3.271+ 目录名 ASCII 化）',
    params: [
      { flag: '-f, --file <path>', meaning: '需求文档路径（.md 直接切；.docx/.pdf 先 doc2spec 转换）' },
      { flag: '--files "a.md=端1,b.md"', meaning: '多文档批量切分，可指定端' },
      { flag: '-c, --content <text>', meaning: '一段文档内容直接切分（自动落盘 converted/，配合 --title 定文档名）' },
      { flag: '--on-duplicate <mode>', meaning: '同名单元三选一（v8.3.275+）：ask/skip/overwrite（备份可回滚）/rename/abort' },
      { flag: '--translate-en <mode>', meaning: '标题英译：auto（默认，LLM+拼音兜底）/ off / host（接力模式）' },
    ],
    examples: ['speccore unitize -f PRD.md -i Q1', 'speccore unitize -f PRD.md -i Q1 --on-duplicate overwrite'],
  },
  'task new': {
    desc: '手动创建 Task',
    params: [
      { flag: '-n, --name <name>', meaning: 'Task 名称（必填）' },
      { flag: '-t, --type <type>', meaning: '类型：feature | bugfix | research | refactor | docs 等（默认 feature）' },
      { flag: '-d, --desc <desc>', meaning: '详细描述' },
      { flag: '--platforms <p1,p2>', meaning: '指定平台列表，逗号分隔（如 <端名1>,<端名2>）' },
      { flag: '--backend-only', meaning: '只创建后端端（自动识别项目中的后端端名）' },
      { flag: '--frontend-only', meaning: '只创建前端端（自动识别项目中的前端端名）' },
      { flag: '-i, --iteration <id>', meaning: '目标迭代' },
    ],
    examples: [
      'speccore task new -n 用户登录 -t feature',
      'speccore task new -n 修复支付bug -t bugfix --platforms=<后端端名>',
      'speccore task new -n 首页重构 --platforms=<端名1>,<端名2>',
    ],
  },
  'global from-source': {
    desc: '从存量源码反推需求文档（两跳 IR→UR + 验证环，原 import 命令已移除，v8.3.260+）',
    params: [
      { flag: '--src <dirs>', meaning: '源码目录（逗号分隔多端，如 <端1/src>,<端2/src>）' },
      { flag: '--depth <depth>', meaning: '分析深度：quick | normal(默认) | deep' },
      { flag: '--platform <platform>', meaning: '指定端' },
      { flag: '--verify', meaning: '验证环：校验 UR 溯源锚点与 IR 清单一致性，不重跑反推' },
    ],
    examples: [
      'speccore global from-source --src ./src',
      'speccore global from-source --src <端1/src>,<端2/src>',
      'speccore global from-source --src <端1/src>,<端2/src> --verify',
    ],
  },
  doc2spec: {
    desc: '将 Word/PDF/MD 文档转换为 SpecCore 需求，或智能分类 sources/ 文档',
    params: [
      { flag: '-f, --file <path>', meaning: '文档路径' },
      { flag: '-p, --platform <p>', meaning: '平台：<端名>（工程标识，如 CONSTITUTION.md 端列表中的端名）' },
      { flag: '--iter <name>', meaning: '目标迭代（必填）' },
      { flag: '--classify', meaning: 'AI 智能分类 sources/ 文档 → staging/' },
      { flag: '--normalize', meaning: '按 SpecCore 标准标题体系重写标题（AI 语义调整，默认关闭；调整前版本快照 backup/）' },
    ],
    examples: [
      'speccore doc2spec -f PRD.docx -p <端名> --iter Q1',
      'speccore doc2spec --classify --prompt --iter Q1     # 智能分类',
      'speccore doc2spec --classify --response <json> --iter Q1',
    ],
  },
  analyze: {
    desc: '统一分析：需求文档 + 源码 + 多端合成（--full）',
    params: [
      { flag: '-I, --iteration <id>', meaning: '目标迭代' },
      { flag: '--req <files>', meaning: '指定需求文档（逗号分隔）' },
      { flag: '--src <dirs>', meaning: '指定源码目录（逗号分隔）' },
      { flag: '--auto', meaning: '自动模式（跳过交互提问）' },
      { flag: '--interactive', meaning: '交互问答模式' },
      { flag: '--full', meaning: '全自动三阶段合成（原 synthesize）：逐端→跨端→功能单元' },
      { flag: '--phase <n>', meaning: '单阶段合成: 1=逐端, 2=跨端, 3=功能单元' },
      { flag: '--feature <module>', meaning: '局部分析单个功能模块' },
      { flag: '--unit <ids>', meaning: '指定功能单元分析（如 M-01,M-03）' },
    ],
    examples: [
      'speccore analyze -I Q1',
      'speccore analyze --full -I Q2',
      'speccore analyze --phase 1 -I Q2',
      'speccore analyze --feature 支付模块',
    ],
  },
  plan: {
    desc: '生成执行计划',
    params: [
      { flag: '-i, --iteration <id>', meaning: '目标迭代' },
      { flag: '--team <n>', meaning: '团队人数（控制并行度）' },
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
      { flag: '--resume', meaning: '从上次中断处恢复' },
      { flag: '--skip <ids>', meaning: '跳过指定 Task ID(逗号分隔)' },
      { flag: '--only <ids>', meaning: '只执行指定 Task ID' },
      { flag: '-i, --iteration <id>', meaning: '目标迭代' },
    ],
    examples: [
      'speccore execute -t Task-001 --force',
      'speccore execute -t Task-001 --force --verify',
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
      { flag: '-i, --iteration <id>', meaning: '目标迭代' },
    ],
    examples: [
      'speccore pr -t Task-001',
      'speccore pr -t Task-001 --interactive --draft',
    ],
  },
  done: {
    desc: '一键收尾：校验→归档→复盘→同步全局（内部调用 archive/retro/sync --global）',
    params: [
      { flag: '--task <id>', meaning: '指定 Task（逗号分隔批量）' },
      { flag: '--all', meaning: '归档所有已完成 Task' },
      { flag: '--interactive', meaning: '预览归档结果后确认' },
      { flag: '--skip-validate', meaning: '跳过合规验证' },
      { flag: '-i, --iteration <id>', meaning: '目标迭代' },
    ],
    examples: ['speccore done --task=Task-001', 'speccore done --all'],
  },
  bugfix: {
    desc: 'Bug 修复任务（v8.3.257: 无独立 bugfix 命令，用 task new -t bugfix）',
    params: [
      { flag: '-n, --name <name>', meaning: 'Bug 名称' },
      { flag: '-d, --desc <desc>', meaning: '详细描述' },
      { flag: '--batch <tasks>', meaning: '批量创建（换行分隔）' },
      { flag: '--batch-file <path>', meaning: '从 .xlsx / .csv 文件批量导入' },
      { flag: '--interactive', meaning: '预览 → 编辑 → 确认 → 创建' },
      { flag: '-i, --iteration <id>', meaning: '目标迭代' },
    ],
    examples: [
      'speccore task new -t bugfix -n "登录超时" -d "token过期未刷新"',
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
  next: {
    desc: '检测当前迭代进度，提示下一步操作（只指引，不执行）',
    params: [
      { flag: '-i, --iteration <id>', meaning: '目标迭代' },
    ],
    examples: [
      'speccore next',
      'speccore next -i Q2',
    ],
  },
  run: {
    desc: '端到端全自动流水线：无参智能续跑（检测断点自动续）+ 位置参数语法糖（preset 直呼/单阶段快捷/阶段范围/一句话需求）+ 命名流水线 + 起止点 + 三闸口',
    params: [
      { flag: '（无参）', meaning: '智能续跑：检测 9 个里程碑断点，从第一个未完成阶段继续（全完成时指路收尾；断点处软停 exit 10 由宿主 AI 询问用户）' },
      { flag: '<preset名>', meaning: 'preset 直呼：full/import/spec/develop/deliver/deploy/docs/analyze（优先于阶段别名）' },
      { flag: '<阶段/别名>', meaning: '单阶段快捷：从该阶段续跑至部署验证（如 run smoke、run split）' },
      { flag: '<from> to <to> / <from>..<to>', meaning: '阶段范围（别名: split→split-units, smoke→verify, deploy→pipeline, code→execute, tasks→taskify, ship→pr, archive→done, docs→spec2doc, import→doc2spec, req→req-doc；首 token 命中而末 token 不命中时报错不静默降级）' },
      { flag: '<一句话需求>', meaning: '其他多词输入视为需求，从需求出发全流程' },
      { flag: '--demand <text>', meaning: '逃生舱：显式声明是需求（需求文本恰为 preset/阶段保留字时）' },
      { flag: '--auto', meaning: '全自动（run 默认即全自动）' },
      { flag: '--preset <name>', meaning: '预设流水线（与位置参数 preset 直呼等价）' },
      { flag: '--from <phase>', meaning: '从指定阶段开始：req-doc|doc2spec|split-units|analyze|validate|taskify|plan|execute|verify|pipeline|pr|done|spec2doc' },
      { flag: '--to <phase>', meaning: '到指定阶段结束' },
      { flag: '--demo', meaning: '演示模式（放宽闸口 A/B，保留 C）' },
    ],
    examples: [
      'speccore run',
      'speccore run develop',
      'speccore run smoke',
      'speccore run split to execute',
      'speccore run split..execute',
      'speccore run "做用户积分功能"',
      'speccore run --from split-units --to execute',
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
  prompts: {
    desc: '提示词库：预置模板 + 自定义提示词，搜索/分类/CRUD/复制',
    params: [
      { flag: '--web', meaning: '在浏览器中打开' },
      { flag: '-o, --output <path>', meaning: '输出路径' },
    ],
    examples: [
      'speccore prompts',
      'speccore pt',
      'speccore prompts --web',
    ],
  },
  reindex: {
    desc: '全量重建所有层级索引 + 知识图谱 + 衰减检测',
    params: [
      { flag: '--check', meaning: '只检查一致性，不修复' },
      { flag: '-i, --iteration <iteration>', meaning: '指定迭代' },
    ],
    examples: [
      'speccore reindex',
      'speccore reindex --check',
    ],
  },
  dashboard: {
    desc: '项目仪表盘（HTML 全量视图）：迭代状态+进度+健康度；终端轻量查看用 next/status',
    params: [
      { flag: '--scope global', meaning: '全量视图（所有项目+迭代）' },
      { flag: '--export <path>', meaning: '导出 HTML' },
    ],
    examples: ['speccore dashboard', 'speccore dashboard --scope global'],
  },
  progress: {
    desc: '迭代进度（终端轻量）：任务完成率+各阶段统计；全量可视化见 dashboard',
    params: [
      { flag: '-i, --iteration <iteration>', meaning: '目标迭代' },
    ],
    examples: ['speccore progress', 'speccore progress -i Q1'],
  },
  archive: {
    desc: '归档任务（done 的原子步骤）：移至 archive/ 或恢复；一键收尾用 done',
    params: [
      { flag: '-t, --task <id>', meaning: '指定 Task' },
    ],
    examples: ['speccore archive -t Task-001'],
  },
  retro: {
    desc: '任务回顾（done 的原子步骤）：生成复盘报告（RETRO.md+HTML）；一键收尾用 done',
    params: [
      { flag: '-t, --task <id>', meaning: '指定 Task' },
    ],
    examples: ['speccore retro -t Task-001'],
  },
};

// ============================================================
// 全量命令视图（--all）
// 含被 help 面板隐藏的低频/运维/内部编排命令——隐藏 ≠ 删除，
// ask 引擎意图词典、run 流水线编排、内部逻辑调用仍直接可用。
// ============================================================
function showAllCommandsFull(program?: import('commander').Command): void {
  logger.info('📖 SpecCore 全部命令');
  logger.info('');
  const all = [...(program?.commands ?? [])].sort((a, b) => a.name().localeCompare(b.name()));
  const visible = all.filter((c) => CORE_COMMANDS.has(c.name()));
  const hidden = all.filter((c) => !CORE_COMMANDS.has(c.name()));
  const render = (title: string, cmds: typeof all): void => {
    logger.info(title);
    for (const c of cmds) {
      const desc = (c.description() || '').split('\n')[0];
      logger.info(`  ${c.name().padEnd(22)} ${desc}`);
    }
    logger.info('');
  };
  render('⭐ 核心命令（help 面板展示）', visible);
  render('🔧 更多命令（低频/运维/内部编排，ask 说人话仍可触发）', hidden);
  logger.info('💡 speccore help --command=<命令> 查看详细参数');
}

// ============================================================
// 展示
// ============================================================

function showAllCommands(): void {
  logger.info('📖 SpecCore 命令帮助');
  logger.info('');

  const categories: Record<string, string[]> = {
    '🏗️ 初始化与导入': ['init', 'doc2spec', 'req-doc'],
    '📋 迭代与任务': ['iteration create', 'iteration taskify', 'taskify', 'task new'],
    '🔍 分析与计划': ['analyze', 'plan'],
    '🔪 切分与导出': ['unitize', 'spec2doc'],
    '⚡ 执行与交付': ['execute', 'verify', 'pipeline', 'pr', 'done'],
    '💡 智能入口': ['ask', 'run', 'next', 'dashboard', 'status', 'about', 'help'],
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
speccore iteration create -n Q1 --from=analyze --to=execute --owner=赵六
speccore doc2spec -f PRD.docx -p <端名> --iter Q1  # 导入需求文档`,
    },
    {
      title: '二、存量项目反推',
      code: `speccore global from-source --src <端1/src>,<端2/src>   # 从存量源码反推需求
speccore global analyze --layer 1-4                   # 全局层四层分析`,
    },
    {
      title: '三、分析 + 拆分',
      code: `speccore analyze -I Q1                    # 需求分析
speccore iteration taskify -i Q1              # 拆分为 Task
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
      code: `speccore change "把手机号改成国际格式" -t Task-001    # 口语化变更`,
    },
    {
      title: '六、全自动流水线',
      code: `speccore run                             # 一键跑完所有阶段
speccore run --from taskify               # 从拆分开始自动化
speccore next                             # 只提示下一步，不执行`,
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
    body = info ? `<div class="cmd-detail"><div class="cmd-desc">${info.desc}</div>${info.params.length ? `<div class="param-list"><div class="section-label">参数说明</div>${info.params.map(p=>`<div class="param"><span class="param-flag">${p.flag}</span><span class="param-meaning">${p.meaning}</span></div>`).join('')}</div>` : ''}${info.examples.length ? `<div class="example-list"><div class="section-label">使用示例</div>${info.examples.map(e=>`<code>$ ${e}</code>`).join('')}</div>` : ''}</div>` : `<p>未找到命令 "${options.command}"</p>`;
  } else {
    // 首页：结构化展示，不只是罗列命令
    const introSection = `
      <div class="intro-card">
        <div class="intro-title">🎯 SpecCore — SDD 开发方法论 CLI 工具</div>
        <div class="intro-text">SpecCore 采用 <strong>Specification-Driven Development（规格驱动开发）</strong>方法论，通过标准化流程和 AI 辅助，实现从需求到交付的自动化流水线。</div>
        <div class="highlight-box">
          <div class="highlight-icon">💡</div>
          <div class="highlight-content">
            <div class="highlight-title">核心原则</div>
            <ul class="highlight-list">
              <li><strong>规格先行</strong>：先写规格文档，再执行代码</li>
              <li><strong>AI 协同</strong>：自然语言交互，智能意图识别</li>
              <li><strong>迭代管理</strong>：任务拆分、计划、执行、审查闭环</li>
              <li><strong>多端适配</strong>：后端 / Web / H5 / 小程序全栈支持</li>
            </ul>
          </div>
        </div>
      </div>
    `;

    const quickStartSection = `
      <div class="quick-start">
        <div class="section-header">
          <span class="header-icon">⚡</span>
          <span class="header-title">快速开始</span>
        </div>
        <div class="step-row">
          <div class="step-item">
            <div class="step-num">1</div>
            <div class="step-text"><strong>初始化项目</strong><br><code>speccore init</code></div>
          </div>
          <div class="step-arrow">→</div>
          <div class="step-item">
            <div class="step-num">2</div>
            <div class="step-text"><strong>创建迭代</strong><br><code>iteration create -n Q1</code></div>
          </div>
          <div class="step-arrow">→</div>
          <div class="step-item">
            <div class="step-num">3</div>
            <div class="step-text"><strong>导入需求</strong><br><code>doc2spec -f PRD.docx</code></div>
          </div>
          <div class="step-arrow">→</div>
          <div class="step-item">
            <div class="step-num">4</div>
            <div class="step-text"><strong>AI 分析</strong><br><code>analyze -i Q1</code></div>
          </div>
        </div>
      </div>
    `;

    // v8.3.191+: 常用命令（10 个高频，覆盖 90% 场景）——突出展示，弱化完整命令数
    const CORE_COMMANDS = ['run', 'ask', 'doc2spec', 'analyze', 'taskify', 'execute', 'pr', 'spec2doc', 'status', 'next'];
    const coreCommandsSection = `
      <div class="core-commands">
        <div class="section-header">
          <span class="header-icon">⭐</span>
          <span class="header-title">常用命令（10 个，覆盖 90% 场景）</span>
        </div>
        <div class="cat-cmds">${CORE_COMMANDS.map(c => `<span class="cmd-pill">speccore ${c}</span>`).join('')}</div>
        <div class="core-hint">记不住命令？直接说人话：<code>speccore ask "我想..."</code></div>
      </div>
    `;

    const categories: Record<string, { cmds: string[]; icon: string; desc: string }> = {
      '🧠 AI 智能入口': { 
        cmds: ['ask', 'welcome'],
        icon: '🤖',
        desc: '自然语言交互，自动匹配意图'
      },
      '🏗️ 项目初始化': { 
        cmds: ['init'],
        icon: '🚀',
        desc: '搭建 SpecCore 目录结构和配置'
      },
      '📋 迭代与任务管理': { 
        cmds: ['iteration', 'task', 'rename'],
        icon: '📊',
        desc: '创建迭代、拆分任务、重命名'
      },
      '📝 文档转换与合成': { 
        cmds: ['doc2spec', 'unitize', 'spec2doc', 'analyze'],
        icon: '📄',
        desc: 'Word/PDF/MD → 规格文档、需求切分功能单元，多端需求合成（analyze --full）'
      },
      '🔍 分析与计划': { 
        cmds: ['analyze', 'global', 'plan', 'taskify'],
        icon: '🔬',
        desc: 'AI 需求分析、全局层分析、生成执行计划、任务拆分'
      },
      '⚡ 执行与交付': { 
        cmds: ['execute', 'pr', 'done'],
        icon: '⚙️',
        desc: '自动执行任务、代码审查、标记完成'
      },
      '🔄 同步与变更管理': { 
        cmds: ['change', 'sync', 'retro'],
        icon: '🔄',
        desc: '需求变更追踪、任务回顾'
      },
      '📊 查看与验证': { 
        cmds: ['dashboard', 'validate', 'search', 'reindex'],
        icon: '📈',
        desc: '进度看板、代码验证、索引重建'
      },
      '🛠️ 智能开发助手': { 
        cmds: ['run', 'next'],
        icon: '🛠️',
        desc: '无参智能续跑 + 语法糖（run develop / run smoke / run split to execute）+ 下一步指引'
      },
      '🔧 维护与升级': {
        cmds: ['update', 'doctor', 'config'],
        icon: '🔧',
        desc: '项目升级、健康检查、配置管理'
      },
    };

    const catBody = Object.entries(categories).map(([cat, { cmds, icon, desc }]) => 
      `<div class="cat">
        <div class="cat-header">
          <span class="cat-icon">${icon}</span>
          <div class="cat-info">
            <div class="cat-title">${cat}</div>
            <div class="cat-desc">${desc}</div>
          </div>
        </div>
        <div class="cat-cmds">${cmds.map(c => `<span class="cmd-pill">speccore ${c}</span>`).join('')}</div>
      </div>`
    ).join('');

    const tipsSection = `
      <div class="tips-section">
        <div class="section-header">
          <span class="header-icon">💡</span>
          <span class="header-title">使用技巧</span>
        </div>
        <div class="tip-grid">
          <div class="tip-card">
            <div class="tip-icon">🎯</div>
            <div class="tip-content">
              <div class="tip-title">优先使用 ask</div>
              <div class="tip-text">不确定用哪个命令？直接说人话：<br><code>speccore ask "我想创建一个登录功能"</code></div>
            </div>
          </div>
          <div class="tip-card">
            <div class="tip-icon">🔍</div>
            <div class="tip-content">
              <div class="tip-title">搜索命令</div>
              <div class="tip-text">忘记命令名？用搜索：<br><code>speccore help --search=导入</code></div>
            </div>
          </div>
          <div class="tip-card">
            <div class="tip-icon">📖</div>
            <div class="tip-content">
              <div class="tip-title">查看详细参数</div>
              <div class="tip-text">了解命令用法：<br><code>speccore help --command=execute</code></div>
            </div>
          </div>
          <div class="tip-card">
            <div class="tip-icon">🌐</div>
            <div class="tip-content">
              <div class="tip-title">HTML 帮助页</div>
              <div class="tip-text">在浏览器中查看：<br><code>speccore help > outputs/speccore-help.html</code></div>
            </div>
          </div>
        </div>
      </div>
    `;

    const paramsSection = `
      <div class="params-section">
        <div class="section-header">
          <span class="header-icon">📋</span>
          <span class="header-title">核心参数速查</span>
        </div>
        <div class="param-table">
          <div class="param-row header-row">
            <div class="param-col flag">参数</div>
            <div class="param-col meaning">含义</div>
            <div class="param-col example">示例</div>
          </div>
          <div class="param-row">
            <div class="param-col flag"><code>-i, -I</code></div>
            <div class="param-col meaning">迭代短名（不带 Iteration- 前缀）</div>
            <div class="param-col example"><code>-i Q1</code> / <code>-I my-project</code></div>
          </div>
          <div class="param-row">
            <div class="param-col flag"><code>-t</code></div>
            <div class="param-col meaning">任务 ID（Task-001 / Task-002 ...）</div>
            <div class="param-col example"><code>-t Task-001</code></div>
          </div>
          <div class="param-row">
            <div class="param-col flag"><code>-n</code></div>
            <div class="param-col meaning">名称（迭代名/任务名/项目名）</div>
            <div class="param-col example"><code>-n Q1</code> / <code>-n 用户登录</code></div>
          </div>
          <div class="param-row">
            <div class="param-col flag"><code>--prompt</code></div>
            <div class="param-col meaning">AI 交互模式（需要宿主 AI）</div>
            <div class="param-col example"><code>analyze --prompt</code></div>
          </div>
          <div class="param-row">
            <div class="param-col flag"><code>--auto</code></div>
            <div class="param-col meaning">自动模式（跳过交互确认）</div>
            <div class="param-col example"><code>execute --auto</code></div>
          </div>
          <div class="param-row">
            <div class="param-col flag"><code>--platforms</code></div>
            <div class="param-col meaning">多端平台（逗号分隔：web,h5,miniapp）</div>
            <div class="param-col example"><code>--platforms=web,h5</code></div>
          </div>
          <div class="param-row">
            <div class="param-col flag"><code>--type</code></div>
            <div class="param-col meaning">任务类型（feature/bugfix/refactor/research）</div>
            <div class="param-col example"><code>--type feature</code></div>
          </div>
          <div class="param-row">
            <div class="param-col flag"><code>--force</code></div>
            <div class="param-col meaning">强制覆盖（init/update/import）</div>
            <div class="param-col example"><code>init --force</code></div>
          </div>
        </div>
      </div>
    `;

    const allCatHeader = `
      <div class="section-header" style="margin-top:24px">
        <span class="header-icon">📚</span>
        <span class="header-title">完整命令分类（进阶/低频，按需查看）</span>
      </div>
    `;
    body = introSection + quickStartSection + coreCommandsSection + allCatHeader + catBody + paramsSection + tipsSection;
  }

  const html = `<!DOCTYPE html><html lang="zh-CN" data-theme="ocean"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>SpecCore Help</title><style>@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;600;700&display=swap');[data-theme="ocean"]{--cyan:#0ea5e9;--bg:#0b1929;--card:rgba(13,31,56,.95);--border:rgba(14,165,233,.15);--text:#bae6fd;--muted:#5b7fa5;--green:#14b8a6;--orange:#f97316;--purple:#6366f1}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'JetBrains Mono',monospace;background:var(--bg);color:var(--text);min-height:100vh;padding:40px 20px}.scanlines{position:fixed;inset:0;pointer-events:none;z-index:99;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,.01) 2px,rgba(0,240,255,.01) 4px)}.card{max-width:960px;margin:0 auto;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:36px;position:relative;overflow:hidden}.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX 3s linear infinite}.card::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX-rev 3s linear infinite}@keyframes scanX{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}@keyframes scanX-rev{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}@keyframes scanY{0%{transform:translateY(-100%)}100%{transform:translateY(100%)}}@keyframes scanY-rev{0%{transform:translateY(100%)}100%{transform:translateY(-100%)}}.vline{position:absolute;top:0;width:1px;bottom:0;pointer-events:none}.vline.l{left:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY-rev 3s linear infinite}.vline.r{right:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY 3s linear infinite}h1{font-family:'Orbitron',sans-serif;font-size:24px;font-weight:900;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:2px;margin-bottom:4px;animation:titleGlow 3s ease-in-out infinite}.sub{color:var(--muted);font-size:11px;margin-bottom:24px}.intro-card{padding:20px;margin-bottom:20px;background:linear-gradient(135deg,rgba(14,165,233,.08),rgba(99,102,241,.08));border:1px solid rgba(14,165,233,.2);border-radius:12px}.intro-title{font-size:16px;font-weight:700;color:var(--cyan);margin-bottom:12px}.intro-text{font-size:13px;line-height:1.6;color:var(--text);margin-bottom:16px}.highlight-box{display:flex;gap:16px;padding:16px;background:rgba(20,184,166,.08);border:1px solid rgba(20,184,166,.2);border-radius:10px}.highlight-icon{font-size:32px}.highlight-content{flex:1}.highlight-title{font-size:12px;font-weight:700;color:var(--green);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px}.highlight-list{list-style:none;padding:0;margin:0}.highlight-list li{font-size:12px;color:var(--text);padding:4px 0;line-height:1.5}.highlight-list strong{color:var(--cyan)}.quick-start{padding:20px;margin:20px 0;background:rgba(249,115,22,.05);border:1px solid rgba(249,115,22,.15);border-radius:12px}.section-header{display:flex;align-items:center;gap:8px;margin-bottom:16px}.header-icon{font-size:20px}.header-title{font-size:14px;font-weight:700;color:var(--orange);text-transform:uppercase;letter-spacing:1px}.step-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:center}.step-item{display:flex;gap:12px;padding:12px 16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;min-width:180px}.step-num{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--orange),#ea580c);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#fff;flex-shrink:0}.step-text{font-size:12px;line-height:1.5}.step-text code{display:inline-block;margin-top:4px;padding:2px 8px;background:rgba(249,115,22,.1);border-radius:4px;color:var(--orange);font-size:11px}.step-arrow{color:var(--muted);font-size:20px;font-weight:700}.cat{margin:16px 0;padding:16px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.04);border-radius:12px;transition:all .3s}.cat:hover{border-color:rgba(14,165,233,.3);background:rgba(14,165,233,.03)}.cat-header{display:flex;align-items:center;gap:12px;margin-bottom:12px}.cat-icon{font-size:24px}.cat-info{flex:1}.cat-title{font-size:13px;font-weight:700;color:var(--cyan);margin-bottom:2px}.cat-desc{font-size:11px;color:var(--muted)}.cat-cmds{display:flex;flex-wrap:wrap;gap:8px}.cmd-pill{padding:4px 12px;border-radius:6px;font-size:11px;background:rgba(14,165,233,.08);color:var(--cyan);border:1px solid rgba(14,165,233,.15);transition:all .2s;cursor:pointer}.core-commands{padding:16px;border:1px solid var(--border);border-radius:12px;background:rgba(14,165,233,.04)}.core-commands .cmd-pill{font-size:12px;padding:6px 14px;background:rgba(20,184,166,.12);color:var(--green);border-color:rgba(20,184,166,.3)}.core-hint{margin-top:12px;font-size:12px;color:var(--muted)}.cmd-pill:hover{background:rgba(14,165,233,.15);border-color:rgba(14,165,233,.3);transform:translateY(-1px)}.cmd-detail{padding:8px 0}.cmd-desc{font-size:14px;margin-bottom:16px;color:var(--text);line-height:1.6}.param-list{margin:16px 0}.param{display:flex;gap:16px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.03)}.param-flag{color:var(--green);font-size:12px;min-width:180px;font-weight:600}.param-meaning{color:var(--muted);font-size:12px;line-height:1.5}.example-list{margin:16px 0}.section-label{font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}.tips-section{padding:20px;margin:20px 0;background:rgba(99,102,241,.05);border:1px solid rgba(99,102,241,.15);border-radius:12px}.tip-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:16px}.tip-card{padding:14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;display:flex;gap:12px;transition:all .3s}.tip-card:hover{border-color:rgba(99,102,241,.3);background:rgba(99,102,241,.05);transform:translateY(-2px)}.tip-icon{font-size:24px;flex-shrink:0}.tip-content{flex:1}.tip-title{font-size:12px;font-weight:700;color:var(--purple);margin-bottom:4px}.tip-text{font-size:11px;color:var(--muted);line-height:1.5}.tip-text code{display:inline-block;margin-top:4px;padding:2px 6px;background:rgba(99,102,241,.1);border-radius:4px;color:var(--purple);font-size:10px}code{display:block;background:rgba(14,165,233,.08);padding:6px 12px;border-radius:6px;color:var(--cyan);font-size:12px;margin:6px 0;transition:all .2s}code:hover{background:rgba(14,165,233,.12)}.params-section{padding:20px;margin:20px 0;background:rgba(14,165,233,.05);border:1px solid rgba(14,165,233,.15);border-radius:12px}.param-table{margin-top:16px}.param-row{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.03);align-items:center}.header-row{border-bottom:2px solid rgba(14,165,233,.3);font-weight:700}.param-col{flex:1;font-size:12px;line-height:1.5}.param-col.flag{min-width:120px;color:var(--green);font-weight:600}.param-col.meaning{flex:2;color:var(--text)}.param-col.example{flex:1.5;color:var(--muted)}.param-col code{display:inline-block;padding:2px 8px;background:rgba(14,165,233,.08);border-radius:4px;font-size:11px;margin:0}.footer{text-align:center;color:var(--muted);font-size:10px;margin-top:24px;padding-top:16px;border-top:1px solid rgba(255,255,255,.04)}.card-bg{position:absolute;inset:0;pointer-events:none;z-index:0;background:radial-gradient(ellipse at 30% 10%,rgba(14,165,233,.25) 0%,transparent 70%);animation:cardGlow 3s ease-in-out infinite;transform-origin:top center}@keyframes cardGlow{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.6)}}@keyframes titleGlow{0%,100%{filter:drop-shadow(0 0 20px rgba(14,165,233,.4)) drop-shadow(0 0 60px rgba(14,165,233,.15))}50%{filter:drop-shadow(0 0 30px rgba(14,165,233,.7)) drop-shadow(0 0 80px rgba(14,165,233,.3))}</style></head><body><div class="scanlines"></div><div class="card"><div class="card-bg"></div><div class="vline l"></div><div class="vline r"></div><h1>SPECCORE HELP</h1><div class="sub">${title} · v${version}</div>${body}<div class="footer">由 SpecCore 驱动 v${version} · ${now}</div></div></body></html>`;

  const { writeFile, ensureDir } = require('fs-extra');
  const { join } = require('path');
  const outPath = join(process.cwd(), 'outputs', 'speccore-help.html');
  await ensureDir(join(process.cwd(), 'outputs'));
  await writeFile(outPath, html);
  process.stdout.write(`✅ 页面已生成: file://${outPath}\n`);
  process.stdout.write(`[SPECCORE_HELP: ${outPath}]\n`);
}
