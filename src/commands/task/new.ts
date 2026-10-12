import { ensureDir, writeFile, pathExists, readFile, readdir } from 'fs-extra';
import { join, basename } from 'path';
import { logger, Spinner } from '../../utils/logger';
import { getDefaultIteration, updateContext, getIterationDir } from '../../core/context';
import { nextTaskId, toSlug } from '../../core/global-counters';
import { parsePlatformList } from '../../core/spec-paths';
import { extractExcelBugs, extractExcelTextOnly, type ExcelBugRow } from '../../core/excel-extract';
import { callLlm, resolveAiProviders, parseTranslationResponse } from '../../core/ask-llm';
import { loadConfigWithMeta } from '../../core/unified-config';

export interface TaskNewOptions {
  name?: string;
  topic?: string;
  type?: string;
  id?: string;
  desc?: string;
  file?: string;
  sections?: string;
  backendOnly?: boolean;
  frontendOnly?: boolean;
  platforms?: string;
  iteration?: string;
  batch?: string;
  batchFile?: string;
  interactive?: boolean;
  feature?: string;      // --feature: 关联功能模块（影响 bugfix 分支 base）
  module?: string;       // Excel 表「模块」列解析出的功能模块（优先于 --feature）
  priority?: string;     // Excel 表「优先级」列
  severity?: string;     // Excel 表「严重度」列
  bugId?: string;        // Bug 唯一编号（Excel「Bug 编号」列；留空则导入时自动生成 YYYYMMDD-XXXX）
  reporter?: string;     // 提出人（Excel「提出人」列，区别于负责人=处理人）
  owner?: string;        // 负责人（Excel「负责人」列，作为任务处理人写入 .meta/owner）
  images?: { ext: string; buffer: Buffer }[];  // Excel 内嵌图片（bug 截图，随任务落盘）
  autoExecute?: boolean; // --auto-execute: 创建后自动 analyze→execute 修复
  translateEn?: string;        // --translate-en: auto(默认) | host | off（批量导入任务名英译）
  translateResponse?: string;  // --translate-response: 接收宿主 AI 英译 JSON（配合宿主接力续跑）
  into?: string;          // --into: 补端模式——往已有任务补端子任务（Task-NNN）
  platform?: string;      // --platform: 补端模式指定端名（CONSTITUTION 端列表，与 --into 配合）
  skipGate?: boolean;     // --skip-gate: 跳过上游端级规格门禁（有风险：执行会拿空需求瞎编）
}

export async function taskNewCommand(options: TaskNewOptions): Promise<void> {
  // ── 补端模式（v8.3.311+）：--into 指向已有任务，往其目录补一个端子任务 ──
  if (options.into) {
    await appendPlatformToTask(options);
    return;
  }

  // ── 批量模式 ──
  if (options.batch || options.batchFile) {
    await batchCreateTasks(options);
    return;
  }

  if (!options.name) {
    logger.error('Task name is required. Use --name <name>');
    return;
  }

  await createSingleTask(options);
}

/**
 * v8.3.288+: 导出标准 Bug 导入模板（xlsx）
 * 列头与 excel-extract 的 COLUMN_HINTS 对齐，用户按此填写即可被批量导入正确解析：
 *   Bug 标题（必填）→ 任务名；Bug 描述（必填）→ REQ.md 主体；
 *   涉及端（必填，「所有端」或逗号分隔端名）→ 端子任务集；
 *   所属模块（建议）→ .meta/feature（执行筛选/项目统计锚点）；
 *   优先级/严重度/负责人/发现环境可选；截图直接内嵌 Excel 单元格。
 */
export async function taskTemplateCommand(options: { output?: string }): Promise<void> {
  let ExcelJS: any;
  try {
    ExcelJS = require('exceljs');
  } catch {
    logger.error('exceljs 未安装，无法生成模板（请重新 npm install）');
    return;
  }

  const wb = new ExcelJS.Workbook();
  // Sheet1 保持纯净（仅表头），导入解析只读首个 Sheet，示例与说明放 Sheet2 避免污染
  const ws = wb.addWorksheet('bug-import');
  ws.columns = [
    { header: 'Bug 编号', key: 'bugId', width: 16 },
    { header: 'Bug 标题', key: 'title', width: 32 },
    { header: 'Bug 描述', key: 'desc', width: 48 },
    { header: '所属模块', key: 'module', width: 16 },
    { header: '涉及端', key: 'platforms', width: 16 },
    { header: '优先级', key: 'priority', width: 10 },
    { header: '严重度', key: 'severity', width: 10 },
    { header: '提出人', key: 'reporter', width: 12 },
    { header: '负责人', key: 'owner', width: 12 },
    { header: '发现环境', key: 'env', width: 14 },
  ];

  // 表头样式（金黄色浅底 + 深字，醒目但不刺眼）
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell: any) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD966' } };
    cell.font = { bold: true, color: { argb: 'FF1F2937' } };
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];  // 冻结表头行

  // Sheet2：填写说明 + 示例（不影响导入）
  const guide = wb.addWorksheet('说明');
  guide.columns = [
    { header: '列名', key: 'col', width: 14 },
    { header: '必填', key: 'req', width: 8 },
    { header: '说明', key: 'note', width: 56 },
    { header: '示例', key: 'example', width: 32 },
  ];
  const guideRows = [
    ['Bug 编号', '否', '留空则导入时自动生成（YYYYMMDD-4位随机，同批次唯一）；也可自行填写追踪号', '20260928-4821'],
    ['Bug 标题', '是', '一句话描述缺陷，将作为任务名', '支付回调异常导致订单状态不同步'],
    ['Bug 描述', '是', '现象/复现步骤/期望行为，写入任务 REQ.md 主体', '现象：支付成功后回调延迟…\n复现：大额订单偶现…\n期望：10s 内同步'],
    ['所属模块', '建议', '功能单元名，作为执行筛选与项目统计锚点（.meta/feature ）', '支付模块'],
    ['涉及端', '是', '「所有端」= 项目全部端；或逗号分隔端名（api,web）', '所有 端'],
    ['优先级', '可选', 'P0-P3（P0 最高）', 'P1'],
    ['严重度', '可选', 'S0-S3（S0 致命）', 'S1'],
    ['提出人', '可选', '缺陷提出人（测试/用户），写入 REQ.md 属性表；区别于「负责人」=处理人', '小王(测试)'],
    ['负责人', '可选', '任务处理人', '张三'],
    ['发现环境', '可选', '缺陷发现的环境/版本，供 AI 判断影响范围', '测试环境'],
    ['截图', '可选', '直接粘贴到行内单元格，导入时自动落盘到任务 assets/screenshots/', '(内嵌图片)'],
  ];
  for (const r of guideRows) guide.addRow({ col: r[0], req: r[1], note: r[2], example: r[3] });
  guide.getRow(1).eachCell((cell: any) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD966' } };
    cell.font = { bold: true, color: { argb: 'FF1F2937' } };
  });

  const outPath = options.output && !options.output.endsWith('.xlsx') && !options.output.endsWith('.xls')
    ? options.output + '.xlsx'
    : options.output || 'bug-import-template.xlsx';
  await wb.xlsx.writeFile(outPath);
  logger.success(`✅ Bug 导入模板已生成: ${outPath}`);
  logger.info('   📋 使用方式: 填写「bug-import」Sheet 后执行 speccore task new --batch-file ' + outPath + ' --type bugfix');
  logger.info('   🖼️  截图可直接粘贴进 Excel（导入时自动落盘到任务 assets/screenshots/）');
}

/** v8.3.288+: 生成 Bug 唯一编号（YYYYMMDD-4位随机），同批次内去重 */
function generateBugId(used: Set<string>): string {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  for (let i = 0; i < 30; i++) {
    const rand = String(Math.floor(1000 + Math.random() * 9000));
    const id = `${ymd}-${rand}`;
    if (!used.has(id)) { used.add(id); return id; }
  }
  const fallback = `${ymd}-${String(Date.now() % 100000).padStart(5, '0')}`;
  used.add(fallback);
  return fallback;
}

/**
 * v8.3.289+: 批量英译任务标题 → 目录 slug（与 unitize/taskify 英译链路对齐）。
 * 一次 LLM 调用翻译全部标题；宿主 AI 优先（无直连 LLM 且宿主模式时输出清单 + exitCode 10 接力），
 * 自配 LLM 兜底（providers 池 → 环境变量 → 本地 Ollama），失败回退拼音（返回空映射，由 toSlug 兜底）。
 * 返回 null 表示已中断接力，调用方须立即返回，等待 --translate-response 续跑。
 */
async function translateTaskTopics(
  titles: string[],
  mode: string,
  translateResponse?: string
): Promise<Map<string, string> | null> {
  const result = new Map<string, string>();

  // 宿主 AI 接力响应：解析英译 JSON（键=序号 1~N，与清单编号一致；兼容中文标题键）
  if (translateResponse) {
    const parsed = parseTranslationResponse(translateResponse, titles);
    let valid = 0;
    for (const [zh, en] of parsed) {
      if (/^[a-z0-9][a-z0-9-]{0,39}$/i.test(en)) {
        result.set(zh, en.toLowerCase());
        valid++;
      }
    }
    if (valid > 0) {
      logger.info(`📝 已接收宿主 AI 英译 ${valid} 条任务名 slug`);
      return result;
    }
    logger.warn('--translate-response 未解析出有效翻译（键须为序号或中文标题），后续按拼音兜底');
  }

  if (mode === 'off') {
    logger.info('--translate-en off：任务目录名直接拼音兜底');
    return result;
  }

  const providers = await resolveAiProviders('taskify');
  const llmAvailable = providers.length > 0 || !!process.env.SPECCORE_LLM_KEY || !!process.env.OPENAI_API_KEY;

  if (!llmAvailable) {
    // 宿主 AI 优先：显式 --translate-en host / ai.provider=host / auto_host_ai 均视为宿主模式；
    // 已携带 --translate-response 时不再接力（响应无效说明宿主已参与，防接力死循环）
    let hostPreferred = mode === 'host';
    if (!hostPreferred) {
      try {
        const { config } = await loadConfigWithMeta();
        hostPreferred = config.settings?.ai?.provider === 'host' || config.ask?.routing?.auto_host_ai === true;
      } catch { /* 配置读取失败按非宿主处理 */ }
    }
    if (hostPreferred && !translateResponse) {
      logger.info('');
      logger.info('[SPECCORE_PROMPT]');
      logger.info('当前环境未配置 LLM（无 providers 池/环境变量）。请将以下 Bug 标题翻译为英文 kebab-case 目录名（小写字母/数字/连字符，2~5 词，禁用拼音），然后执行续跑：');
      logger.info(`  speccore task new --batch-file <文件> --type bugfix --translate-response '<JSON>'`);
      logger.info('');
      logger.info('标题清单（序号即响应 JSON 的键，按序号一一对应，勿改名重排）:');
      for (const [i, t] of titles.entries()) {
        logger.info(`  ${i + 1}. ${t}`);
      }
      logger.info('');
      logger.info('响应 JSON 格式（键=序号，值=英文 slug）:');
      logger.info(JSON.stringify(Object.fromEntries(titles.map((t, i) => [String(i + 1), `task-${i + 1}`])), null, 2));
      process.exitCode = 10;
      return null;
    }
    if (titles.length > 0) {
      logger.warn(`⚙️  未配置 LLM，${titles.length} 个任务名英译降级拼音`);
      logger.info('   💡 拿英文名两条路：① 配置 SPECCORE_LLM_KEY 后重导  ② --translate-en host 由宿主 AI 翻译接力');
    }
    return result;
  }

  // 自配 LLM 兜底：一次批量调用翻译全部标题
  const numbered = titles.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const response = await callLlm(
    '你是软件需求术语翻译专家。将中文 Bug 标题翻译为简洁的英文 kebab-case 目录名：小写字母/数字/连字符，2~5 个单词，禁用拼音。',
    `将下列标题逐一翻译为英文 slug（kebab-case），严格只输出 JSON 对象：{"1":"booking-order-status-not-synced",...}\n\n${numbered}`,
    providers,
    500
  );
  if (response) {
    for (const [zh, en] of parseTranslationResponse(response, titles)) {
      if (/^[a-z0-9][a-z0-9-]{0,39}$/i.test(en)) {
        result.set(zh, en.toLowerCase());
      }
    }
  }
  return result;
}

/** 批量创建 Task */
async function batchCreateTasks(options: TaskNewOptions): Promise<void> {
  interface TaskItem { name: string; desc: string; images: { ext: string; buffer: Buffer }[]; priority?: string; severity?: string; module?: string; platforms?: string; bugId?: string; reporter?: string; owner?: string }
  const items: TaskItem[] = [];
  // v8.3.288+: Bug 编号去重集（Excel 已有编号 + 自动生成编号共用，保批次内唯一）
  const usedBugIds = new Set<string>();

  if (options.batchFile) {
    if (!await pathExists(options.batchFile)) {
      logger.error('文件不存在: ' + options.batchFile);
      return;
    }
    const ext = options.batchFile.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
      // v8.3.207+: 优先 exceljs（含内嵌图片 + 优先级/严重度/模块列），fallback xlsx 纯文本
      const bugs = await extractExcelBugs(options.batchFile);
      if (bugs) {
        for (const b of bugs) {
          // v8.3.288+: 消费标题/描述/涉及端列——标题作任务名、描述作主体，
          // 不再整行文本拼接；端列决定该任务的端子任务集
          const fallbackDesc = b.cells.join(' — ');
          const desc = b.desc || fallbackDesc;
          // v8.3.288+: Bug 编号——Excel 已有则沿用（去重），留空自动生成 YYYYMMDD-XXXX
          const bugId = b.bugId || generateBugId(usedBugIds);
          if (b.bugId) {
            if (usedBugIds.has(b.bugId)) logger.warn(`⚠️  Bug 编号重复: ${b.bugId}（第 ${b.rowIndex + 1} 行），沿用但建议检查`);
            usedBugIds.add(b.bugId);
          }
          items.push({
            name: (b.title || fallbackDesc).slice(0, 60),
            desc,
            images: b.images.map(i => ({ ext: i.ext, buffer: i.buffer })),
            priority: b.priority,
            severity: b.severity,
            module: b.module,
            platforms: b.platforms,
            bugId,
            reporter: b.reporter,
            owner: b.owner,
          });
        }
        const imgCount = bugs.reduce((s, b) => s + b.images.length, 0);
        logger.info(`📊 从 Excel 导入 ${bugs.length} 个 bug${imgCount > 0 ? `（含 ${imgCount} 张截图）` : ''}: ${options.batchFile}`);
      } else {
        const rows = await extractExcelTextOnly(options.batchFile);
        if (rows) {
          for (const r of rows) items.push({ name: r.slice(0, 60), desc: r, images: [] });
          logger.info('📊 从 Excel 导入（纯文本，exceljs 未安装）: ' + options.batchFile);
        } else {
          logger.error('Excel 解析失败: ' + options.batchFile);
          return;
        }
      }
    } else {
      const text = await readFile(options.batchFile, 'utf-8');
      for (const line of text.split('\n').filter(b => b.trim())) {
        items.push({ name: line.trim().slice(0, 60), desc: line.trim(), images: [] });
      }
      logger.info('📄 从文件导入: ' + options.batchFile);
    }
  } else if (options.batch) {
    for (const line of options.batch.split('\n').filter(b => b.trim())) {
      items.push({ name: line.trim().slice(0, 60), desc: line.trim(), images: [] });
    }
  }

  if (items.length === 0) {
    logger.error('未找到有效的任务描述');
    return;
  }

  // v8.3.289+: 批量英译任务名——一次 LLM 调用翻译全部标题为目录 slug；
  // 宿主 AI 优先（无 LLM 且宿主模式时接力），自配 LLM 兜底，失败回退拼音
  const translateTitles = items.map(i => i.name);
  const topicMap = await translateTaskTopics(translateTitles, options.translateEn || 'auto', options.translateResponse);
  if (topicMap === null) return; // 宿主接力：已输出翻译清单 + exitCode 10，等待 --translate-response 续跑

  // 交互确认
  if (options.interactive) {
    logger.info(`\n📋 共 ${items.length} 个任务:\n`);
    for (let i = 0; i < items.length; i++) {
      const meta = [items[i].bugId ? `#${items[i].bugId}` : '', items[i].priority ? `P${items[i].priority}` : '', items[i].severity ? `S${items[i].severity}` : '', items[i].module ? `模块:${items[i].module}` : ''].filter(Boolean).join(' ');
      logger.info(`  ${i + 1}. ${items[i].name}${items[i].images.length > 0 ? ` 🖼️x${items[i].images.length}` : ''}${meta ? `  [${meta}]` : ''}`);
    }
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer: string = await new Promise(resolve => rl.question('\n确认创建？[y/N] ', resolve));
    rl.close();
    if (answer.toLowerCase() !== 'y') {
      logger.info('已取消');
      return;
    }
  }

  const type = options.type || 'bugfix';
  let created = 0;

  for (const item of items) {
    try {
      const translatedTopic = topicMap.get(item.name);
      await createSingleTask({
        ...options,
        name: item.name,
        desc: item.desc,
        type,
        images: item.images,
        priority: item.priority,
        severity: item.severity,
        module: item.module,
        platforms: item.platforms || options.platforms,
        bugId: item.bugId,
        reporter: item.reporter,
        owner: item.owner,
        // v8.3.289+: 英译 slug 作为任务目录后缀（nextTaskId 消费 topic）；
        // 无翻译条目不覆盖用户显式 --topic（保持既有行为）
        ...(translatedTopic ? { topic: translatedTopic } : {}),
      });
      created++;
    } catch (e: any) {
      logger.error(`创建失败 "${item.name.slice(0, 30)}": ${e.message}`);
    }
  }

  logger.info(`\n✅ 创建完成: ${created}/${items.length} 个任务`);
}

/** 创建单个 Task */
async function createSingleTask(options: TaskNewOptions): Promise<void> {
  const spinner = new Spinner(`Creating task: ${options.name}`);
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('No active iteration found. Please specify --iteration or create one first.');
      return;
    }

    const iterationDir = await getIterationDir(iteration);
    
    // Determine task ID (使用 --topic 英文主题词，fallback 到 --name)
    // v8.3.77+: 修复只传 topic 导致 name 被忽略的问题
    // 始终递增计数器，即使手动指定 --id 也如此，避免后续自动编号冲突
    const { id: counterId } = await nextTaskId(options.name, options.topic);
    const taskId = options.id
      ? options.id.replace(/^Task-/, '')
      : counterId.replace(/^Task-/, '');
    const taskType = options.type || 'feature';
    // counterId 已含 slug（nextTaskId 返回 Task-NNN-slug），直接用
    const taskDir = join(iterationDir, '030-tasks', taskType, `Task-${taskId}`);

    if (await pathExists(taskDir)) {
      spinner.fail(`Task already exists: Task-${taskId}`);
      return;
    }

    // Create directories — 三级嵌套目录结构
    const today = new Date().toISOString().split('T')[0];
    const status = 'todo';
    await ensureDir(join(taskDir, '.meta'));
    await ensureDir(join(taskDir, '00-specs'));
    await ensureDir(join(taskDir, '_shared'));  // 共享契约（API_CONTRACT.yaml 等）

    // 创建子任务目录（新结构: {端名}/Task-{taskId}-{端}/，v6.49.2+ 平铺架构）
    // v8.3.288+: 子任务目录名带端后缀，避免多端同名目录导致 scanTasks/topologicalSort 按 id 去重
    // v8.3.145+: 使用项目实际端名（工程标识），不再硬编码 api/web
    const isResearch = taskType === 'research';
    // research 类型无端子目录，其余类型按项目端列表建端子目录
    const needsPlatforms = !isResearch;
    let projectPlatforms = await parsePlatformList();
    if (projectPlatforms.length === 0) {
      projectPlatforms = ['api', 'web'];// fallback
    }

    // 根据参数过滤要创建的端
    let platformsToCreate = projectPlatforms;
    if (options.platforms) {
      const specified = options.platforms.split(',').map(p => p.trim()).filter(Boolean);
      // v8.3.288+: Excel 端列「所有端」别名 → 项目全部端
      platformsToCreate = specified.some(p => /^(所有端|全部端|所有平台|全部平台|all)$/i.test(p))
        ? projectPlatforms
        : projectPlatforms.filter(p => specified.includes(p));
    } else if (options.backendOnly) {
      platformsToCreate = projectPlatforms.filter(p =>
        /service|api|server|backend|后台/i.test(p)
      );
    } else if (options.frontendOnly) {
      platformsToCreate = projectPlatforms.filter(p =>
        /web|h5|miniapp|app|frontend|前端|ios|android|admin/i.test(p)
      );
    }

    if (needsPlatforms && !isResearch) {
      for (const platform of platformsToCreate) {
        const subtaskDir = join(taskDir, platform, `Task-${taskId}-${platform}`);
        await ensureDir(join(subtaskDir, '.meta'));
        await writeFile(join(subtaskDir, '.meta', 'type'), options.type || 'feature');
        await writeFile(join(subtaskDir, '.meta', 'status'), status);
        await writeFile(join(subtaskDir, '.meta', 'owner'), options.owner || '未分配');
        await writeFile(join(subtaskDir, '.meta', 'created-at'), today);
      }
    }

    // Write task meta
    await ensureDir(join(taskDir, '.meta'));
    await writeFile(join(taskDir, '.meta', 'type'), options.type || 'feature');
    await writeFile(join(taskDir, '.meta', 'status'), status);
    await writeFile(join(taskDir, '.meta', 'owner'), options.owner || '未分配');
    await writeFile(join(taskDir, '.meta', 'created-at'), today);
    // 功能单元标识（v6.49.4+）：Excel 模块列 > --feature > 任务名称
    await writeFile(join(taskDir, '.meta', 'feature'), options.module || options.feature || options.name || '未分类');
    // v8.3.209+: 优先级 / 严重度（Excel 表解析，可选）
    if (options.priority) await writeFile(join(taskDir, '.meta', 'priority'), options.priority);
    if (options.severity) await writeFile(join(taskDir, '.meta', 'severity'), options.severity);
    // v8.3.288+: Bug 编号 / 提出人（Excel 表解析，编号留空时批量导入已自动生成）
    if (options.bugId) await writeFile(join(taskDir, '.meta', 'bug-id'), options.bugId);
    if (options.reporter) await writeFile(join(taskDir, '.meta', 'reporter'), options.reporter);

    // Generate task content
    const taskContent = await generateTaskContent(options);

    // v8.3.207+: 落盘 Excel 内嵌图片 + REQ.md 引用（bug 截图进任务上下文）
    let reqContent = taskContent.req;
    if (options.images && options.images.length > 0) {
      const shotsDir = join(taskDir, 'assets', 'screenshots');
      await ensureDir(shotsDir);
      const refs: string[] = [];
      for (let i = 0; i < options.images.length; i++) {
        const img = options.images[i];
        const fn = `bug-${String(i + 1).padStart(2, '0')}.${img.ext}`;
        await writeFile(join(shotsDir, fn), img.buffer);
        refs.push(`![缺陷截图${i + 1}](../assets/screenshots/${fn})`);
      }
      reqContent += `\n\n## 缺陷截图\n\n${refs.join('\n\n')}\n`;
    }

    // Write core specs to 00-specs/
    await writeFile(join(taskDir, '00-specs', 'REQ.md'), reqContent);
    await writeFile(join(taskDir, '00-specs', 'TECH.md'), taskContent.tech);
    await writeFile(join(taskDir, '00-specs', 'CHANGELOG.md'), `# ${options.name} - 变更记录\n\n| 时间 | 版本 | 变更内容 | 变更人 |\n| :--- | :--- | :--- | :--- |\n| ${today} | v1.0 | 初始创建 | CLI |\n`);

    // Write per-platform TASK.md + 执行产出文档（新结构: {端名}/Task-{taskId}-{端}/）
    // v8.3.145+: 使用项目实际端名，不再硬编码 api/web
    if (needsPlatforms && !isResearch) {
      for (const platform of platformsToCreate) {
        const sub = join(taskDir, platform, `Task-${taskId}-${platform}`);
        await writeFile(join(sub, 'TASK.md'), taskContent.task);
        // 只有前端端才写 README.md（根据端名特征判断）
        const isFrontend = /web|h5|miniapp|app|frontend|前端|ios|android|admin/i.test(platform);
        if (isFrontend) {
          await writeFile(join(sub, 'README.md'), `# ${options.name}\n\n${platform} 端实现目录。\n`);
        }
      }
    }

    // Pre-create issues tracker
    await writeFile(join(taskDir, '.issues.md'), `# ${options.name} - 问题追踪\n\n> 执行过程中发现的问题记录于此。\n\n`);

    // Update context
    await updateContext({
      currentTask: `Task-${taskId}`,
      currentIteration: iteration,
      lastUpdated: new Date().toISOString()
    });

    spinner.stop(`Task created: Task-${taskId} - ${options.name}`);

    // v8.3.207+: --auto-execute 创建后自动 execute 修复（bug 无人值守）
    if (options.autoExecute) {
      const { execSync } = await import('child_process');
      logger.info(`🚀 [auto-execute] 自动修复 Task-${taskId}...`);
      logger.info(`   🔄 00-specs/ 由宿主 AI 填充（任务层 analyze 已废弃）`);
      logger.info(`   ⚡ execute --force`);
      try { execSync(`speccore execute --task=Task-${taskId} --force -i ${iteration}`, { stdio: 'inherit' }); } catch (e: any) { logger.warn(`   ⚠️ execute 失败: ${e.message}`); }
      logger.success('✅ [auto-execute] 自动修复完成');
    }
  } catch (error) {
    spinner.fail(`Failed to create task: ${error}`);
    throw error;
  }
}

/**
 * v8.3.311+: 补端模式 — 往已有任务补一个端子任务（--into Task-NNN --platform 端名）。
 *
 * 上游门禁：020-specs/{功能单元}/{端}/ 必须先有非骨架端级规格（TECH/TEST/UI_SPEC ≥200 字符），
 * 否则拦截并提示先补上游分析（speccore analyze --platform），防止执行拿空需求瞎编（AGENTS.md 禁令）。
 * 上游达标后，子任务 TASK.md 由端级规格提炼生成（非空模板），并同步任务 CHANGELOG 与当前任务上下文。
 */
async function appendPlatformToTask(options: TaskNewOptions): Promise<void> {
  const iteration = await getDefaultIteration(options.iteration);
  if (!iteration) {
    logger.error('No active iteration found. Please specify --iteration or create one first.');
    return;
  }
  const iterationDir = await getIterationDir(iteration);
  const taskId = (options.into || '').replace(/^Task-/, '').trim();
  if (!taskId) {
    logger.error('--into 需要任务编号（如 Task-021 或 021）');
    return;
  }
  const platform = (options.platform || '').trim();
  if (!platform) {
    logger.error('--platform 需要端名（CONSTITUTION.md 端列表中的工程标识，禁止 api/web 等简写）');
    return;
  }

  // 端名合法性：必须是项目端列表成员
  const projectPlatforms = await parsePlatformList();
  if (projectPlatforms.length > 0 && !projectPlatforms.includes(platform)) {
    logger.error(`端「${platform}」不在项目端列表（CONSTITUTION.md）: ${projectPlatforms.join(', ')}`);
    return;
  }

  // 1. 定位宿主任务（支持 030-tasks/Task-XXX 与 030-tasks/{type}/Task-XXX 两种布局；
  //    兼容 v8.3.309 前历史残片名 Task-NNN-NN——--into Task-NNN 前缀命中即可）
  const tasksRoot = join(iterationDir, '030-tasks');
  let hostDir = '';
  let hostType = 'feature';
  try {
    const collect = async (base: string): Promise<string> => {
      const exact = join(base, `Task-${taskId}`);
      if (await pathExists(exact)) return exact;
      // 前缀匹配：Task-033-21 这类带后缀的历史任务目录
      const entries = await readdir(base);
      const hit = entries.find((n: string) => n.startsWith(`Task-${taskId}-`));
      return hit ? join(base, hit) : '';
    };
    const rootEntries = await readdir(tasksRoot, { withFileTypes: true });
    for (const e of rootEntries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('Task-')) {
        const found = await collect(tasksRoot);
        if (found) { hostDir = found; break; }
      } else if (!e.name.startsWith('.') && !e.name.startsWith('0')) {
        const found = await collect(join(tasksRoot, e.name));
        if (found) { hostDir = found; hostType = e.name; break; }
      }
    }
  } catch { /* 扫描失败走报错 */ }
  if (!hostDir) {
    logger.error(`未找到任务 Task-${taskId}（030-tasks/ 下）；--into 必须指向已有任务`);
    return;
  }
  // 前缀命中时归一化：宿主目录实际名（Task-033-21）为准，子任务目录沿用全名（Task-033-21-miniapp）
  const hostName = basename(hostDir);

  // 2. 子任务已存在检查
  const subtaskDir = join(hostDir, platform, `${hostName}-${platform}`);
  if (await pathExists(subtaskDir)) {
    logger.warn(`   ⏭️  子任务已存在，跳过: ${platform}/${hostName}-${platform}`);
    return;
  }

  // 3. 上游门禁：020-specs/{功能单元}/{端}/ 端级规格（与 taskify 端裁剪同一标准）
  let feature = '';
  try {
    const featFile = join(hostDir, '.meta', 'feature');
    if (await pathExists(featFile)) feature = (await readFile(featFile, 'utf-8')).trim();
  } catch { /* feature 读取失败留空，门禁按空处理 */ }
  const upstream = await checkUpstreamPlatformSpec(join(iterationDir, '020-specs'), feature, platform);
  if (!upstream.found && !options.skipGate) {
    logger.error(`⛔ 上游门禁未通过：020-specs/ 下没有「${feature || '该功能单元'}」的 ${platform} 端级规格`);
    logger.info(`   📖 根因：任务层规格唯一合法来源是上游分析产物，缺端硬建子任务只会拿到空模板，`);
    logger.info(`      执行时按 AGENTS.md 禁令「禁止拿空需求瞎编代码」，无法开工。`);
    logger.info('');
    logger.info(`   ✅ 正确两步：`);
    logger.info(`      ① 补上游端级分析: speccore analyze -I ${iteration} --platform ${platform}`);
    logger.info(`      ② 补端子任务: speccore task new --into ${hostName} --platform ${platform}`);
    logger.info(`   ⚠️  确认上游确无此端（本任务不涉及该端）可 --skip-gate 强制建（子任务规格将标注「上游待补」）`);
    return;
  }

  // 4. 创建子任务（.meta + TASK.md 由上游规格提炼，不落空模板）
  const today = new Date().toISOString().split('T')[0];
  await ensureDir(join(subtaskDir, '.meta'));
  await writeFile(join(subtaskDir, '.meta', 'type'), hostType);
  await writeFile(join(subtaskDir, '.meta', 'status'), 'todo');
  await writeFile(join(subtaskDir, '.meta', 'owner'), options.owner || '未分配');
  await writeFile(join(subtaskDir, '.meta', 'created-at'), today);
  if (feature) await writeFile(join(subtaskDir, '.meta', 'feature'), feature);
  await writeFile(join(subtaskDir, 'TASK.md'), await buildAppendedSubtaskTask(hostName, platform, feature, upstream));

  // 5. 任务级 CHANGELOG 追加补端记录（无则新建）
  try {
    const changelog = join(hostDir, '00-specs', 'CHANGELOG.md');
    const line = `| ${today} | v1.1 | 补端: 新增 ${platform} 端子任务（上游规格 ${upstream.found ? '已达标' : '缺失（--skip-gate 强制）'}） | CLI |\n`;
    if (await pathExists(changelog)) {
      const content = await readFile(changelog, 'utf-8');
      await writeFile(changelog, content + line);
    } else {
      await ensureDir(join(hostDir, '00-specs'));
      await writeFile(changelog, `# ${hostName} - 变更记录\n\n| 时间 | 版本 | 变更内容 | 变更人 |\n| :--- | :--- | :--- | :--- |\n${line}`);
    }
  } catch { /* CHANGELOG 追加失败不阻断 */ }

  // 6. 上下文更新
  await updateContext({
    currentTask: hostName,
    currentIteration: iteration,
    lastUpdated: new Date().toISOString(),
  });

  logger.success(`✅ 补端完成: ${hostName}/${platform}/${hostName}-${platform}/`);
  logger.info(`   📖 子任务 TASK.md 由上游端级规格提炼${upstream.found ? '' : '（上游待补，执行前须先补 020-specs）'}`);
  logger.info(`   ⏭️  后续: speccore execute -t ${hostName} 执行该端子任务`);
}

/**
 * 上游端级规格检查（与 taskify 端裁剪判定同一标准：
 * 非骨架且 ≥200 字符的 TECH/TEST/UI_SPEC 才算涉及端）。
 */
async function checkUpstreamPlatformSpec(
  specsDir: string,
  feature: string,
  platform: string
): Promise<{ found: boolean; sources: string[] }> {
  if (!(await pathExists(specsDir))) return { found: false, sources: [] };
  const candidates: string[] = [];
  try {
    const entries = await readdir(specsDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'overview') continue;
      // 功能单元名匹配：精确命中或相互包含（.meta/feature 可能存中文名或 slug 目录名）
      if (e.name === feature || (feature && (e.name.includes(feature) || feature.includes(e.name)))) {
        candidates.push(join(specsDir, e.name));
      }
    }
  } catch { /* 扫描失败按未找到处理 */ }

  const sources: string[] = [];
  for (const dir of candidates) {
    const platformDir = join(dir, platform);
    if (!(await pathExists(platformDir))) continue;
    for (const f of ['TECH.md', 'TEST.md', 'UI_SPEC.md']) {
      const fp = join(platformDir, f);
      if (!(await pathExists(fp))) continue;
      try {
        const content = await readFile(fp, 'utf-8');
        if (!content.includes('SPEC-SKELETON') && content.trim().length >= 200) {
          sources.push(f);
        }
      } catch { /* 读失败忽略 */ }
    }
    if (sources.length > 0) break;
  }
  return { found: sources.length > 0, sources };
}

/**
 * 补端子任务 TASK.md：任务信息 + 上游端级规格要点摘录（标题 + 关键片段），
 * 绝不落空模板——上游缺失（--skip-gate）时明确标注「上游待补」并列出补救命令。
 * hostName 为宿主任务目录实际名（含 Task- 前缀，如 Task-033-21）。
 */
async function buildAppendedSubtaskTask(
  hostName: string,
  platform: string,
  feature: string,
  upstream: { found: boolean; sources: string[] }
): Promise<string> {
  const today = new Date().toISOString().split('T')[0];
  const lines = [
    `# ${hostName}-${platform}（补端子任务）`,
    '',
    '## 任务信息',
    `- 宿主任务: ${hostName}`,
    `- 端: ${platform}`,
    `- 功能单元: ${feature || '（未关联）'}`,
    `- 状态: 🔲 待开发`,
    `- 创建时间: ${today}`,
    `- 创建方式: task new --into（补端模式）`,
    '',
  ];
  if (!upstream.found) {
    lines.push(
      '## ⚠️ 上游规格待补',
      '',
      `> 本子任务经 --skip-gate 强制创建，020-specs/ 下尚无 ${platform} 端级规格。`,
      '> 执行前必须先补齐上游，否则拿空需求瞎编代码（AGENTS.md 禁令）。',
      '',
      '```',
      `speccore analyze -I <迭代名> --platform ${platform}   # 补上游端级分析`,
      '```',
      '',
    );
  }
  lines.push(
    '## 上游规格要点',
    '',
  );
  // 从上游端级规格提炼标题与首段（与 execute 阅读清单同源）
  const specsDir = join(await getIterationDir(await getDefaultIteration() || ''), '020-specs');
  let extracted = false;
  try {
    if (await pathExists(specsDir)) {
      const entries = await readdir(specsDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'overview') continue;
        if (feature && e.name !== feature && !e.name.includes(feature) && !feature.includes(e.name)) continue;
        const platformDir = join(specsDir, e.name, platform);
        if (!(await pathExists(platformDir))) continue;
        for (const f of ['TECH.md', 'UI_SPEC.md', 'TEST.md']) {
          const fp = join(platformDir, f);
          if (!(await pathExists(fp))) continue;
          const content = await readFile(fp, 'utf-8');
          if (content.includes('SPEC-SKELETON') || content.trim().length < 200) continue;
          // 摘录标题行 + 前 8 个非空内容行（保结构不保全文，全文见上游文档）
          const trimmed = content.trim().split('\n').filter(l => l.trim());
          lines.push(`### 来自 020-specs/${e.name}/${platform}/${f}`, '');
          const headings = trimmed.filter(l => /^#{1,3}\s/.test(l)).slice(0, 8);
          for (const h of headings) lines.push(`- ${h.replace(/^#{1,3}\s+/, '')}`);
          lines.push('', `> 📖 完整规格: 020-specs/${e.name}/${platform}/${f}`, '');
          extracted = true;
          break;
        }
        if (extracted) break;
      }
    }
  } catch { /* 提炼失败不阻断 */ }
  if (!extracted) {
    lines.push(upstream.found ? '（未能自动提炼，请直接阅读 020-specs 对应端级规格）' : '（上游规格缺失，执行前必须先补 analyze）');
  }
  lines.push(
    '',
    '## 交付物',
    '',
    '| 产出物 | 状态 | 路径 |',
    '| :--- | :--- | :--- |',
    '| TASK.md | ✅ | ./TASK.md |',
    `| 规格引用 | ${upstream.found ? '✅' : '⏳'} | 020-specs/${feature || '{单元}'}/${platform}/ |`,
    '',
    '## 执行说明',
    '',
    `- 执行: speccore execute -t ${hostName}（调度全部端子任务，本端为其一）`,
    '- 本子任务规格以上游 020-specs 端级文档为准，此处仅摘要索引',
    '',
  );
  return lines.join('\n');
}

async function findNextTaskId(iterationDir: string): Promise<string> {
  const { readdir } = await import('fs-extra');
  
  const entries = await readdir(iterationDir, { withFileTypes: true });
  const taskDirs = entries
    .filter(e => e.isDirectory() && e.name.startsWith('Task-'))
    .map(e => parseInt(e.name.replace('Task-', '')))
    .filter(n => !isNaN(n));
  
  const maxId = Math.max(0, ...taskDirs);
  return String(maxId + 1).padStart(3, '0');
}

async function generateTaskContent(options: TaskNewOptions): Promise<{ req: string; tech: string; task: string }> {
  const name = options.name || 'New Task';
  const desc = options.desc || '';
  const type = options.type || 'feature';
  const priority = options.priority || 'medium';
  // v8.3.288+: 任务性质标明所属功能模块/涉及端（供执行筛选与项目统计精确消费）
  const module = options.module || options.feature || '未分类';
  const platformsLabel = options.platforms || '全部端';
  const severity = options.severity || '';
  const bugId = options.bugId || '';
  const reporter = options.reporter || '';

  const req = buildReqByType(type, name, desc, { module, platformsLabel, priority, severity, bugId, reporter });

  const tech = `# ${name} - 技术方案

## 1. 方案概述

## 2. 接口设计

### 2.1 API 定义

### 2.2 请求/响应格式

## 3. 数据模型

## 4. 核心逻辑

### 4.1 流程图

### 4.2 伪代码

## 5. 测试策略

### 5.1 单元测试

### 5.2 集成测试

## 6. 风险与应对
`;

  const task = `# ${name}

## 任务信息
- 类型: ${type}
- 状态: 🔲 待开发
- 优先级: ${priority}${severity ? `\n- 严重度: ${severity}` : ''}${bugId ? `\n- Bug 编号: ${bugId}` : ''}${reporter ? `\n- 提出人: ${reporter}` : ''}
- 所属模块: ${module}
- 涉及端: ${platformsLabel}
- 预计耗时: 2h
- 创建时间: ${new Date().toISOString().split('T')[0]}

## 变更履历
| 时间 | 变更内容 | 变更人 |
| :--- | :--- | :--- |
| ${new Date().toISOString().split('T')[0]} | 创建任务 | CLI |

## 产出物
| 产出物 | 状态 | 路径 |
| :--- | :--- | :--- |
| REQ.md | ✅ | ./REQ.md |
| TECH.md | ✅ | ./TECH.md |
| TASK.md | ✅ | ./TASK.md |
| API_CONTRACT.yaml | ⏳ | ./_shared/API_CONTRACT.yaml |

## 依赖关系
| 依赖任务 | 依赖原因 | 状态 |
| :--- | :--- | :--- |
| | | |

## 阻塞关系
| 被阻塞任务 | 阻塞原因 | 状态 |
| :--- | :--- | :--- |
| | | |
`;

  return { req, tech, task };
}

/** v8.3.210+: 按任务类型差异化 REQ 结构（差异下沉到文档模板，交互不变） */
function buildReqByType(
  type: string, name: string, desc: string,
  meta?: { module?: string; platformsLabel?: string; priority?: string; severity?: string; bugId?: string; reporter?: string },
): string {
  const t = (type || 'feature').toLowerCase();
  // v8.3.288+: bugfix 头部属性表——任务性质文档直接标明模块/端/优先级/严重度/编号/提出人
  const bugfixMeta = meta
    ? `| 属性 | 值 |\n| :--- | :--- |\n| 类型 | bugfix |${meta.bugId ? `\n| Bug 编号 | ${meta.bugId} |` : ''}${meta.reporter ? `\n| 提出人 | ${meta.reporter} |` : ''}\n| 所属模块 | ${meta.module || '未分类'} |\n| 涉及端 | ${meta.platformsLabel || '全部端'} |\n| 优先级 | ${meta.priority || 'medium'} |${meta.severity ? `\n| 严重度 | ${meta.severity} |` : ''}\n\n`
    : '';
  const templates: Record<string, string> = {
    feature: `# ${name}\n\n## 需求描述\n\n${desc}\n\n## 验收标准\n\n- [ ] AC-1: \n- [ ] AC-2: \n- [ ] AC-3: \n\n## 输入/输出\n\n### 输入\n\n### 输出\n\n## 业务规则\n\n## 错误处理\n`,
    bugfix: `# ${name}\n\n${bugfixMeta}## 缺陷描述\n\n${desc}\n\n## 复现步骤\n\n1. \n2. \n3. \n\n## 预期行为\n\n## 实际行为\n\n## 影响范围\n\n- 影响端/模块：\n- 影响程度：\n\n## 修复验收\n\n- [ ] 复现步骤可稳定复现\n- [ ] 修复后不再复现\n- [ ] 无回归\n`,
    refactor: `# ${name}\n\n## 重构目标\n\n${desc}\n\n## 现状问题\n\n- \n\n## 重构方案要点\n\n- \n\n## 重构边界\n\n> ⚠️ 仅重构内部实现，不改变外部行为/接口\n\n## 验收标准\n\n- [ ] 行为不变（原测试全过）\n- [ ] 代码结构改善\n`,
    test: `# ${name}\n\n## 测试范围\n\n${desc}\n\n## 覆盖目标\n\n- [ ] 功能路径\n- [ ] 边界条件\n- [ ] 异常处理\n\n## 测试环境\n\n## 交付物\n\n- 测试用例 + 结果\n`,
    security: `# ${name}\n\n## 安全风险描述\n\n${desc}\n\n## 攻击面\n\n- \n\n## 修复目标\n\n- \n\n## 验收标准\n\n- [ ] 漏洞已修复\n- [ ] 无新暴露面\n`,
    performance: `# ${name}\n\n## 性能指标\n\n${desc}\n\n## 当前基线\n\n- \n\n## 优化目标\n\n- \n\n## 验收标准\n\n- [ ] 达到目标指标\n- [ ] 无功能回归\n`,
    docs: `# ${name}\n\n## 文档范围\n\n${desc}\n\n## 目标受众\n\n## 交付物\n\n- \n`,
    review: `# ${name}\n\n## 审查范围\n\n${desc}\n\n## 审查要点\n\n- [ ] 正确性\n- [ ] 完整性\n- [ ] 一致性\n- [ ] 安全性\n\n## 审查结论\n`,
    research: `# ${name}\n\n## 调研目标\n\n${desc}\n\n## 待验证假设\n\n- \n\n## 调研结论\n\n## 建议\n`,
    deploy: `# ${name}\n\n## 部署范围\n\n${desc}\n\n## 部署步骤\n\n- \n\n## 回滚方案\n\n## 验收标准\n\n- [ ] 部署成功且可回滚\n`,
  };
  // 未知类型回退 feature 模板
  return templates[t] || templates.feature;
}
