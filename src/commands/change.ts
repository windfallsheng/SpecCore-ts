/**
 * change - 需求变更联动命令
 * 修改任务需求时，自动更新关联 Spec 文件
 */

import { logger, Spinner } from '../utils/logger';
import { registerRequirement } from '../core/requirement-tracker';
import { getDefaultIteration, getIterationDir } from '../core/context';
import { readFile, writeFile, pathExists, ensureDir } from 'fs-extra';
import { join } from 'path';
import { FileTransaction } from '../core/transaction';
import { scanTasks } from '../core/state';
import { resolveTask, resolveIteration, formatResolveResult } from '../core/resolver';
import { nextTaskId } from '../core/global-counters';
import { scanInbox, markProcessed, logInboxScan, buildClarifyPrompt, parseClarifyResponse, logClarifyResult, ensureInboxDir, logImpactReport, InboxFileEntry, ImpactReport, TaskImpact } from '../core/inbox';
import { warnIfIndexStale } from '../core/index-guard';

/**
 * 解析任务目录基础路径：优先 030-tasks/，兼容旧布局
 */
async function resolveTaskBase(iterDir: string): Promise<string> {
  const tasksDir = join(iterDir, '030-tasks');
  return (await pathExists(tasksDir)) ? tasksDir : iterDir;
}

/**
 * 从 CHANGELOG.md 提取最新版本号并递增
 */
async function nextVersion(changelogPath: string): Promise<string> {
  if (await pathExists(changelogPath)) {
    const content = await readFile(changelogPath, 'utf-8');
    const versions = content.match(/v(\d+\.\d+)/g);
    if (versions && versions.length > 0) {
      const last = versions[versions.length - 1].replace('v', '');
      const [major, minor] = last.split('.').map(Number);
      return `v${major}.${minor + 1}`;
    }
  }
  return 'v1.1';
}

/**
 * 检测意图：变更已有需求 vs 新增需求
 */
function detectIntent(desc: string): 'new' | 'change' {
  const lower = desc.replace(/\s+/g, '');
  if (/^(新增?|加|添|创建|增加|实现|做[一个]*)/.test(lower)) return 'new';
  return 'change';
}

/**
 * 全量影响分析：读取每个任务的 REQ/TECH/TASK/status，分类为直接/间接/无影响
 */
async function analyzeImpact(desc: string, iterDir: string, taskBase: string): Promise<ImpactReport> {
  const keywords = extractKeywords(desc);
  const { readdir: rd } = await import('fs-extra');

  // 读取依赖图
  const graphPath = join(iterDir, '000-overview', 'PROJECT_GRAPH.md');
  const graphContent = await pathExists(graphPath) ? await readFile(graphPath, 'utf-8') : '';

  // 收集所有任务详情
  let entries: any[] = [];
  try { entries = await rd(taskBase, { withFileTypes: true }); } catch { return { directTasks: [], indirectTasks: [], unaffectedTasks: [] }; }

  const allImpacts: TaskImpact[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('Task-')) continue;
    const taskId = entry.name;
    const taskDir = join(taskBase, taskId);

    // 读取任务状态
    let status = 'unknown';
    const statusPath1 = join(taskDir, '.task-status');
    const statusPath2 = join(taskDir, '.meta', 'status');
    if (await pathExists(statusPath1)) status = (await readFile(statusPath1, 'utf-8')).trim();
    else if (await pathExists(statusPath2)) status = (await readFile(statusPath2, 'utf-8')).trim();

    // 读取任务名称
    let name = taskId;
    const reqPath = join(taskDir, '00-specs', 'REQ.md');
    const legacyReqPath = join(taskDir, 'REQ.md');
    const actualReqPath = (await pathExists(reqPath)) ? reqPath : (await pathExists(legacyReqPath)) ? legacyReqPath : null;
    if (actualReqPath) {
      const reqContent = await readFile(actualReqPath, 'utf-8');
      const nameMatch = reqContent.match(/^#\s+(.+)$/m);
      if (nameMatch) name = nameMatch[1];
    }

    // 关键词匹配评分
    let score = 0;
    let matchedFiles: string[] = [];
    const filesToCheck = [
      { path: actualReqPath || '', label: 'REQ.md' },
      { path: join(taskDir, '00-specs', 'TECH.md'), label: 'TECH.md' },
      { path: join(taskDir, '00-specs', 'TASK.md'), label: 'TASK.md' },
    ];

    for (const fc of filesToCheck) {
      if (!fc.path || !await pathExists(fc.path)) continue;
      const content = await readFile(fc.path, 'utf-8');
      for (const kw of keywords) {
        if (content.includes(kw)) {
          score++;
          if (!matchedFiles.includes(fc.label)) matchedFiles.push(fc.label);
        }
      }
    }

    if (score > 0) {
      allImpacts.push({
        id: taskId,
        name,
        status,
        level: 'direct',
        reason: `关键词命中 ${score} 处 [${matchedFiles.join(', ')}]`,
        affectedFiles: matchedFiles,
        needReExecute: true,
        needRegression: false,
      });
    } else {
      allImpacts.push({
        id: taskId,
        name,
        status,
        level: 'none',
        reason: '',
        affectedFiles: [],
        needReExecute: false,
        needRegression: false,
      });
    }
  }

  // 依赖图分析：直接受影响任务的上下游 → 间接影响
  const directIds = new Set(allImpacts.filter(t => t.level === 'direct').map(t => t.id));
  const indirectIds = new Set<string>();

  for (const directId of directIds) {
    const deps = findDependentTasks(graphContent, directId);
    for (const dep of deps) {
      if (!directIds.has(dep)) {
        indirectIds.add(dep);
      }
    }
    // 反向查找：谁依赖了直接受影响的任务
    const reverseDeps = findReverseDependencies(graphContent, directId);
    for (const rd of reverseDeps) {
      if (!directIds.has(rd)) {
        indirectIds.add(rd);
      }
    }
  }

  // 分类结果
  const directTasks: TaskImpact[] = [];
  const indirectTasks: TaskImpact[] = [];
  const unaffectedTasks: TaskImpact[] = [];

  for (const t of allImpacts) {
    if (directIds.has(t.id)) {
      directTasks.push(t);
    } else if (indirectIds.has(t.id)) {
      // 补充间接影响原因
      const depReasons: string[] = [];
      for (const directId of directIds) {
        const deps = findDependentTasks(graphContent, directId);
        const rdeps = findReverseDependencies(graphContent, directId);
        if (deps.includes(t.id)) depReasons.push(`依赖 ${directId}`);
        if (rdeps.includes(t.id)) depReasons.push(`${directId} 依赖本任务`);
      }
      indirectTasks.push({
        ...t,
        level: 'indirect',
        reason: depReasons.join('; ') || '间接关联',
        needReExecute: false,
        needRegression: t.status === 'done',
      });
    } else {
      unaffectedTasks.push(t);
    }
  }

  return { directTasks, indirectTasks, unaffectedTasks };
}

/**
 * 反向查找依赖：找出哪些任务依赖了指定任务
 */
function findReverseDependencies(graphContent: string, taskId: string): string[] {
  const deps: string[] = [];
  // Mermaid 格式: A[Task-001] --> B[Task-002] 表示 Task-001 → Task-002
  const mermaidPattern = new RegExp(`\\[${taskId}\\]\\s*-->\\s*\\[(Task-\\d+)\\]`);
  const reverseMermaidPattern = new RegExp(`\\[(Task-\\d+)\\]\\s*-->\\s*\\[${taskId}\\]`);
  
  for (const line of graphContent.split('\n')) {
    // 正向：taskId 指向别人
    const m = line.match(mermaidPattern);
    if (m && m[1] !== taskId && !deps.includes(m[1])) deps.push(m[1]);
    // 反向：别人指向 taskId
    const rm = line.match(reverseMermaidPattern);
    if (rm && rm[1] !== taskId && !deps.includes(rm[1])) deps.push(rm[1]);
  }
  return deps;
}

/**
 * 构建任务详情（用于澄清 Prompt 上下文）
 */
async function buildTaskDetails(taskBase: string): Promise<{ id: string; name: string; reqSummary: string; techSummary: string; status: string; dependencies: string[] }[]> {
  const { readdir: rd } = await import('fs-extra');
  let entries: any[] = [];
  try { entries = await rd(taskBase, { withFileTypes: true }); } catch { return []; }

  const details: { id: string; name: string; reqSummary: string; techSummary: string; status: string; dependencies: string[] }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('Task-')) continue;
    const taskId = entry.name;
    const taskDir = join(taskBase, taskId);

    // 状态
    let status = 'unknown';
    const statusPath1 = join(taskDir, '.task-status');
    const statusPath2 = join(taskDir, '.meta', 'status');
    if (await pathExists(statusPath1)) status = (await readFile(statusPath1, 'utf-8')).trim();
    else if (await pathExists(statusPath2)) status = (await readFile(statusPath2, 'utf-8')).trim();

    // REQ 摘要（取前 300 字符）
    let reqSummary = '';
    const reqPath = join(taskDir, '00-specs', 'REQ.md');
    const legacyReqPath = join(taskDir, 'REQ.md');
    const actualReqPath = (await pathExists(reqPath)) ? reqPath : (await pathExists(legacyReqPath)) ? legacyReqPath : null;
    if (actualReqPath) {
      const content = await readFile(actualReqPath, 'utf-8');
      reqSummary = content.slice(0, 300).replace(/\n+/g, ' ').trim();
    }

    // TECH 摘要
    let techSummary = '';
    const techPath = join(taskDir, '00-specs', 'TECH.md');
    if (await pathExists(techPath)) {
      const content = await readFile(techPath, 'utf-8');
      techSummary = content.slice(0, 200).replace(/\n+/g, ' ').trim();
    }

    // 名称
    let name = taskId;
    if (reqSummary) {
      const nameMatch = reqSummary.match(/^#\s+(.+)/);
      if (nameMatch) name = nameMatch[1];
    }

    details.push({ id: taskId, name, reqSummary, techSummary, status, dependencies: [] });
  }

  // 从依赖图补充 dependencies
  return details;
}

/**
 * 提取关键词（2字以上的中文/英文词）
 */
function extractKeywords(desc: string): string[] {
  const normalized = normalizeDescription(desc);
  const chinese = normalized.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  const english = normalized.match(/[a-zA-Z]{2,}/g) || [];
  return [...new Set([...chinese, ...english])];
}

/**
 * 新增需求一站式处理：创建任务 → 追加需求 → 更新依赖图 → 引导分析
 * 澄清结果（需求分析）持久化到 REQ.md
 */
async function handleNewRequirement(desc: string, iteration: string, clarifyResult?: { structuredDesc?: string; keyPoints?: string[]; acceptanceCriteria?: string[] }): Promise<void> {
  const iterDir = await getIterationDir(iteration);
  const taskBase = await resolveTaskBase(iterDir);
  await ensureDir(taskBase);

  const { id: taskId } = await nextTaskId();
  const taskName = desc.replace(/^(新增?|加|创建|实现|做)/, '').replace(/[:：]/g, '').trim() || taskId;
  const taskDir = join(taskBase, taskId);
  const specsDir = join(taskDir, '00-specs');
  await ensureDir(specsDir);

  const now = new Date().toISOString().split('T')[0];
  const tx = new FileTransaction();

  // 构建结构化 REQ.md（澄清 = 需求分析，结果持久化）
  const structuredDesc = clarifyResult?.structuredDesc || desc;
  const keyPoints = clarifyResult?.keyPoints || [];
  const acceptanceCriteria = clarifyResult?.acceptanceCriteria || [];

  let reqContent = `# ${taskName}\n\n`;
  reqContent += `## 需求描述\n\n${structuredDesc}\n\n`;
  reqContent += `## 原始输入\n\n${desc}\n\n`;

  if (keyPoints.length > 0) {
    reqContent += `## 功能要点\n\n`;
    for (const p of keyPoints) {
      reqContent += `- ${p}\n`;
    }
    reqContent += '\n';
  }

  if (acceptanceCriteria.length > 0) {
    reqContent += `## 验收标准\n\n`;
    for (const c of acceptanceCriteria) {
      reqContent += `- [ ] ${c}\n`;
    }
    reqContent += '\n';
  } else {
    reqContent += `## 验收标准\n\n- [ ] 功能正常\n`;
  }

  reqContent += `## 分析记录\n\n- 分析时间: ${now}\n- 分析方式: ${clarifyResult ? 'AI 澄清' : '本地分析'}\n`;

  tx.write(join(specsDir, 'REQ.md'), reqContent);

  // 创建 CHANGELOG.md
  tx.write(join(specsDir, 'CHANGELOG.md'), `# 变更记录\n\n| 时间 | 版本 | 变更内容 | 变更人 |\n| :--- | :--- | :--- | :--- |\n| ${now} | v1.0 | 初始创建 | SpecCore |\n`);

  // 创建 TASK.md
  tx.write(join(specsDir, 'TASK.md'), `# ${taskName}\n\n- 状态: 待开发\n- 优先级: medium\n- 类型: feature\n\n## 变更履历\n\n| 时间 | 变更内容 | 变更人 |\n| :--- | :--- | :--- |\n| ${now} | 创建任务 | SpecCore |\n`);

  await tx.commit();

  // 追加到 REQUIREMENT.md
  const reqPath = join(iterDir, '020-specs', 'REQUIREMENT.md');
  if (await pathExists(reqPath)) {
    let content = await readFile(reqPath, 'utf-8');
    content += `\n\n## ${taskName}\n\n${desc}\n`;
    await writeFile(reqPath, content);
  }

  // 更新 PROJECT_GRAPH.md
  const graphPath = join(iterDir, '000-overview', 'PROJECT_GRAPH.md');
  if (await pathExists(graphPath)) {
    let content = await readFile(graphPath, 'utf-8');
    // 直接使用已生成的 taskId，避免重复计数 bug
    content += `| ${taskId} | ${taskName} | feature | pending |\n`;
    await writeFile(graphPath, content);
  }

  logger.info('');
  logger.success(`✅ 新任务已创建: ${taskId}`);
  logger.info(`   📄 ${taskId}/00-specs/REQ.md`);
  logger.info(`   📄 ${taskId}/00-specs/TASK.md`);
  logger.info('');
  logger.info('💡 下一步:');
  logger.info(`   speccore analyze --task=${taskId}     # 分析技术方案`);
  logger.info(`   speccore execute --task=${taskId} --force  # 执行任务`);
}

import { createInterface } from 'readline';
function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${question} `, answer => { rl.close(); resolve(answer.trim()); });
  });
}

export interface ChangeOptions {
  task?: string;
  desc?: string;
  input?: string;  // natural language input
  global?: boolean;
  iteration?: string;
  dryRun?: boolean;
  requirement?: boolean;
  analysis?: boolean;
  force?: boolean;
  interactive?: boolean;
  file?: string;         // --file 指定附件（逗号分隔多个）
  noInbox?: boolean;     // --no-inbox 跳过默认 inbox
  reprocess?: boolean;   // --reprocess 强制重新处理所有 inbox 文件
  prompt?: boolean;      // --prompt 输出澄清 Prompt 到 stdout
  response?: string;     // --response 接收 AI 澄清结果
}

export async function changeCommand(options: ChangeOptions): Promise<void> {
  // 命令前新鲜度检查
  await warnIfIndexStale(process.cwd(), 'change', options.iteration);

  // 自然语言输入 → 当作 desc 处理
  if (options.input && !options.desc) {
    options.desc = options.input;
  }

  if (!options.task && !options.global) {
    // ── 智能匹配 / 新增需求（含 inbox + 附件 + 澄清）──
    if (!options.desc && !options.file && options.noInbox) {
      logger.error('请提供变更描述或附件。用法: speccore change "描述" --file=xxx.md');
      return;
    }
  
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      logger.error('未找到活跃迭代。请先运行: speccore iteration create --name <名称>');
      return;
    }
  
    // ── 1. 加载附件 ──
    const allFiles: InboxFileEntry[] = [];
  
    // 1a. 扫描 inbox（默认启用）
    if (!options.noInbox) {
      await ensureInboxDir();
      const inboxResult = await scanInbox({ reprocess: options.reprocess });
      logInboxScan(inboxResult);
      const actionable = [...inboxResult.newFiles, ...inboxResult.modifiedFiles];
      allFiles.push(...actionable);
    }
  
    // 1b. 加载 --file 指定的文件
    if (options.file) {
      const { readFile: rf, stat: st } = await import('fs-extra');
      const filePaths = options.file.split(',').map(f => f.trim());
      for (const fp of filePaths) {
        const absPath = join(process.cwd(), fp);
        if (!await pathExists(absPath)) {
          logger.warn(`⚠️ 文件不存在: ${fp}`);
          continue;
        }
        const fileStat = await st(absPath);
        const name = fp.split('/').pop() || fp;
        const ext = name.split('.').pop()?.toLowerCase() || '';
        let type: InboxFileEntry['type'] = 'other';
        if (['md', 'txt', 'markdown', 'json', 'yaml', 'yml', 'csv'].includes(ext)) type = 'text';
        else if (['xlsx', 'xls'].includes(ext)) type = 'excel';
        else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) type = 'image';
  
        let content = '';
        if (type === 'text') {
          content = await rf(absPath, 'utf-8');
        } else if (type === 'excel') {
          try {
            const XLSX = require('xlsx');
            const wb = XLSX.readFile(absPath);
            const sheets: string[] = [];
            for (const sn of wb.SheetNames) {
              sheets.push(`## Sheet: ${sn}\n${XLSX.utils.sheet_to_csv(wb.Sheets[sn])}`);
            }
            content = sheets.join('\n\n');
          } catch { content = `[Excel 解析失败]`; }
        } else if (type === 'image') {
          content = `[图片文件: ${absPath}]`;
        } else {
          try { content = await rf(absPath, 'utf-8'); } catch { content = `[无法读取]`; }
        }
  
        allFiles.push({ name, path: absPath, size: fileStat.size, mtime: fileStat.mtime.toISOString(), type, content });
        logger.info(`   📎 ${name} (${fileStat.size > 1024 ? (fileStat.size / 1024).toFixed(1) + 'KB' : fileStat.size + 'B'})`);
      }
    }
  
    // ── 2. 构建澄清上下文 ──
    const desc = options.desc ? normalizeDescription(options.desc) : '';
    const iterDir = await getIterationDir(iteration);
    const taskBase = await resolveTaskBase(iterDir);
    const allTasks = await scanTasks(iteration);
    const taskDetails = await buildTaskDetails(taskBase);
  
    // ── 3. Prompt 模式：输出澄清 Prompt 到 stdout ──
    if (options.prompt) {
      const promptText = buildClarifyPrompt(desc || '(从附件分析需求)', allFiles, taskDetails);
      logger.info('[SPECCORE_PROMPT]');
      process.stdout.write(promptText);
      return;
    }
  
    // ── 4. Response 模式：解析 AI 澄清结果 ──
    let clarifiedIntent: 'new' | 'change' | undefined;
    let clarifiedDesc = desc;
    let clarifiedTasks: string[] = [];
  
    if (options.response) {
      const parsed = parseClarifyResponse(options.response);
      if (parsed) {
        clarifiedIntent = parsed.intent;
        clarifiedDesc = parsed.structuredDesc || desc;
        // 从 impactReport 中提取直接影响的任务 ID
        clarifiedTasks = parsed.impactReport?.directTasks?.map(t => t.id) || [];
        logClarifyResult(parsed);
      } else {
        logger.warn('⚠️ AI 澄清结果解析失败，使用本地分析');
      }
    }
  
    // ── 5. 本地意图检测（无 AI 澄清时） ──
    const intent = clarifiedIntent || detectIntent(desc || allFiles.map(f => f.content).join(' '));
  
    // ── 6. 新增需求 ──
    if (intent === 'new') {
      logger.info('🆕 检测到新增需求意图');
      const newDesc = clarifiedDesc || allFiles.map(f => f.name + ': ' + f.content.slice(0, 200)).join('\n');
      // 传递澄清结果给 handleNewRequirement，持久化到 REQ.md
      const parsed = options.response ? parseClarifyResponse(options.response) : null;
      const clarifyOutput = parsed ? { structuredDesc: parsed.structuredDesc, keyPoints: parsed.keyPoints, acceptanceCriteria: parsed.acceptanceCriteria } : undefined;
      await handleNewRequirement(newDesc, iteration, clarifyOutput);
      // 标记 inbox 文件已处理
      if (allFiles.length > 0) {
        await markProcessed(allFiles, 'new', []);
      }
      return;
    }
  
    // ── 7. 变更：全量影响分析 ──
    let impactReport: ImpactReport;
  
    if (clarifiedTasks.length > 0) {
      // 使用 AI 澄清结果中的匹配任务构造影响报告
      const directTasks: TaskImpact[] = clarifiedTasks.map(tid => {
        const task = allTasks.find(t => t.id === tid);
        return { id: tid, name: task?.name || tid, status: 'unknown', level: 'direct' as const, reason: 'AI 澄清匹配', affectedFiles: [], needReExecute: true, needRegression: false };
      }).filter(m => allTasks.some(t => t.id === m.id));
      impactReport = { directTasks, indirectTasks: [], unaffectedTasks: [] };
    } else {
      // 本地全量影响分析
      const matchDesc = desc || allFiles.map(f => f.content).join(' ');
      impactReport = await analyzeImpact(matchDesc, iterDir, taskBase);
    }
  
    const hasImpact = impactReport.directTasks.length > 0 || impactReport.indirectTasks.length > 0;
    if (!hasImpact) {
      logger.warn('未匹配到受影响任务。请指定 --task 或检查变更描述/附件。');
      logger.info('💡 如果是新增需求，请确保描述以"新增/加/创建"开头');
      return;
    }
  
    // 展示影响分析报告
    logImpactReport(impactReport);
    logger.info('');
  
    // 对所有直接影响任务应用变更
    const changeDesc = clarifiedDesc || desc;
    const affectedIds: string[] = [];
    for (const m of impactReport.directTasks) {
      const taskOpts = { ...options, task: m.id, desc: changeDesc };
      await applyTaskChange(taskOpts, iteration);
      affectedIds.push(m.id);
    }
  
    // 标记 inbox 文件已处理
    if (allFiles.length > 0) {
      await markProcessed(allFiles, 'change', affectedIds);
    }
  
    // ── 8. 持久化澄清结果：迭代级 CHANGE_SUMMARY.md ──
    await writeChangeSummary(iterDir, changeDesc, impactReport, affectedIds);
  
    logger.info('');
    logger.success(`✅ 变更已应用到 ${affectedIds.length} 个任务`);
    logger.info(`   📄 变更摘要: 020-specs/CHANGE_SUMMARY.md`);
    logger.info('');
    logger.info('💡 下一步:');
    logger.info(`   speccore execute --task=${affectedIds.join(',')} --force  # 重新执行`);
    return;
  }

  if (!options.desc) {
    logger.error('请提供变更描述。用法: speccore change "把手机号改成支持国际号码"');
    return;
  }

  // 规范化描述：口语 → 结构化
  const normalized = normalizeDescription(options.desc);
  if (normalized !== options.desc) {
    logger.info(`📝 描述已规范化: "${options.desc}" → "${normalized}"`);
    options.desc = normalized;
  }

  const spinner = new Spinner('正在分析变更影响...');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration && !options.global) {
      spinner.fail('未找到活跃迭代。请先运行: speccore iteration create --name <名称>');
      return;
    }

    // 短 Task ID 支持: 使用统一 resolver 解析
    if (options.task) {
      const taskResult = await resolveTask(options.task, iteration);
      if (taskResult.exact && taskResult.value) {
        if (taskResult.matchType !== 'exact') {
          const hint = formatResolveResult(taskResult, 'Task');
          if (hint) logger.info(hint);
        }
        options.task = taskResult.value.id;
      } else if (taskResult.candidates.length > 1) {
        logger.warn(taskResult.hint || '找到多个匹配任务，请指定更精确的名称');
        return;
      } else {
        logger.warn(taskResult.hint || `Task "${options.task}" 未找到`);
        return;
      }
    }

    if (options.dryRun) {
      await dryRunChange(options, iteration);
      spinner.stop('变更预览完成（--dry-run 模式，未实际修改）');
      return;
    }

    // ── Interactive: 预览影响范围 → 确认 ──
    if (options.interactive) {
      spinner.stop('变更影响分析');
      logger.info('');
      logger.info(`📋 变更内容: ${options.desc}`);
      if (options.task) logger.info(`📌 影响任务: ${options.task}`);
      if (options.global) logger.info('🌍 变更范围: 全局层');
      logger.info('');
      
      // Show files that would be affected
      await dryRunChange(options, iteration);
      logger.info('');
      
      const answer = await promptUser('确认执行变更？ [y/n/q]: ');
      if (answer?.toLowerCase() === 'q') { logger.info('已取消'); return; }
      if (answer?.toLowerCase() !== 'y') { logger.info('已取消，可修改后重试'); return; }
      spinner.start();
    }

    if (options.global) {
      await applyGlobalChange(options);
    } else {
      await applyTaskChange(options, iteration);

      // 任务级变更也记录到 CHANGE_SUMMARY.md
      if (options.task && iteration) {
        const iterDir = await getIterationDir(iteration);
        const taskImpact: TaskImpact = {
          id: options.task,
          name: options.task,
          status: 'changed',
          level: 'direct',
          reason: options.desc || '任务级变更',
          affectedFiles: ['REQ.md', 'CHANGELOG.md', 'TASK.md'],
          needReExecute: true,
          needRegression: false,
        };
        await writeChangeSummary(iterDir, options.desc || '任务级变更', { directTasks: [taskImpact], indirectTasks: [], unaffectedTasks: [] }, [options.task]);
      }
    }

    spinner.stop('需求变更已生效');
    logger.info('');
    if (options.task) {
      logger.info(`   📄 变更摘要: 020-specs/CHANGE_SUMMARY.md`);
    }
    logger.info('下一步:');
    logger.info('  1. 运行 speccore validate --task=' + (options.task || '') + ' 验证完整性');
    logger.info('  2. 检查受影响的下游任务是否需要回归');
    if (options.task) {
      logger.info(`  3. 重新执行变更任务: speccore execute --task=${options.task} --force`);
    }
  } catch (error) {
    spinner.fail(`变更失败: ${error}`);
    throw error;
  }
}

async function dryRunChange(options: ChangeOptions, iteration: string): Promise<void> {
  if (options.global) {
    logger.info('🔍 全局层变更影响分析：');
    logger.info('');
    logger.info('| 文件 | 影响描述 |');
    logger.info('| :--- | :--- |');
    logger.info('| .speccore/CONSTITUTION.md | 全局配置变更 |');
    logger.info('| 所有迭代的 TECH.md | 架构方案需同步 |');
    logger.info('');
    return;
  }

  logger.info(`🔍 ${options.task} 变更影响分析：`);
  logger.info('');
  logger.info(`变更描述: ${options.desc}`);

  if (iteration) {
    const iterDir = await getIterationDir(iteration);
    const taskBase = await resolveTaskBase(iterDir);
    const taskDir = join(taskBase, options.task || '');
    logger.info('| 文件 | 影响描述 |');
    logger.info('| :--- | :--- |');
    logger.info(`| ${options.task}/00-specs/REQ.md | 需求变更 |`);
    logger.info(`| ${options.task}/00-specs/TECH.md | 方案需调整 |`);
    logger.info(`| ${options.task}/00-specs/CHANGELOG.md | 变更记录追加 |`);
    logger.info(`| ${options.task}/_shared/API_CONTRACT.yaml | 接口契约可能需更新 |`);

    // 查找受影响的依赖任务
    if (await pathExists(taskDir)) {
      const graphPath = join(iterDir, '000-overview', 'PROJECT_GRAPH.md');
      if (await pathExists(graphPath)) {
        const content = await readFile(graphPath, 'utf-8');
        const deps = findDependentTasks(content, options.task || '');
        if (deps.length > 0) {
          logger.info('');
          logger.warn('🔗 受影响下游任务：');
          for (const dep of deps) {
            logger.info(`   ${dep} → 🔶 待回归`);
          }
        }
      }
    }
  }
}

async function applyTaskChange(options: ChangeOptions, iteration: string): Promise<void> {
  if (!options.task) {
    logger.error('请指定 --task');
    return;
  }

  const iterDir = await getIterationDir(iteration);
  const taskBase = await resolveTaskBase(iterDir);
  const taskDir = join(taskBase, options.task);
  if (!await pathExists(taskDir)) {
    logger.error(`任务目录不存在: ${taskDir}`);
    return;
  }

  const tx = new FileTransaction();
  const now = new Date().toISOString().split('T')[0];
  const ver = await nextVersion(join(taskDir, '00-specs', 'CHANGELOG.md'));

  // 更新 REQ.md（事务保护）
  const reqPath = join(taskDir, '00-specs', 'REQ.md');
  if (await pathExists(reqPath)) {
    let content = await readFile(reqPath, 'utf-8');
    const changeNote = `\n## 变更记录\n\n| ${now} | ${ver} | ${options.desc} | SpecCore |\n`;
    tx.write(reqPath, content + changeNote);
  }

  // 更新 CHANGELOG.md（事务保护）
  const changelogPath = join(taskDir, '00-specs', 'CHANGELOG.md');
  if (await pathExists(changelogPath)) {
    let content = await readFile(changelogPath, 'utf-8');
    const changeEntry = `| ${now} | ${ver} | ${options.desc} | SpecCore |\n`;
    const updated = content.replace(
      /(\| :--- \| :--- \| :--- \| :--- \|)/,
      `$1\n${changeEntry}`
    );
    tx.write(changelogPath, updated);
  } else {
    // 如果没有 CHANGELOG.md，创建一个
    tx.write(changelogPath, `# 变更记录\n\n| 时间 | 版本 | 变更内容 | 变更人 |\n| :--- | :--- | :--- | :--- |\n| ${now} | ${ver} | ${options.desc} | SpecCore |\n`);
  }

  // 更新 TASK.md 变更履历（事务保护）
  const taskMdPath = join(taskDir, '00-specs', 'TASK.md');
  if (await pathExists(taskMdPath)) {
    let content = await readFile(taskMdPath, 'utf-8');
    const changeEntry = `| ${now} | ${ver} | 需求变更: ${options.desc} | SpecCore |\n`;
    const updated = content.replace(
      /(\| :--- \| :--- \| :--- \| :--- \|)/,
      `$1\n${changeEntry}`
    );
    tx.write(taskMdPath, updated);
  }

  // 同步前端各平台 TASK.md（事务保护）
  const frontendDir = join(taskDir, '20-frontend');
  if (await pathExists(frontendDir)) {
    const { readdir: rd } = await import('fs-extra');
    const platformDirs = await rd(frontendDir, { withFileTypes: true });
    for (const pd of platformDirs) {
      if (pd.isDirectory()) {
        const ftaskPath = join(frontendDir, pd.name, 'TASK.md');
        if (await pathExists(ftaskPath)) {
          let content = await readFile(ftaskPath, 'utf-8');
          const changeEntry = `| ${now} | ${ver} | 需求变更: ${options.desc} | SpecCore |\n`;
          const updated = content.replace(
            /(\| :--- \| :--- \| :--- \| :--- \|)/,
            `$1\n${changeEntry}`
          );
          tx.write(ftaskPath, updated);
        }
      }
    }
  }

  // 更新任务状态为 needs-rework
  const metaStatusPath = join(taskDir, '.meta', 'status');
  if (await pathExists(metaStatusPath)) {
    const currentStatus = await readFile(metaStatusPath, 'utf-8');
    if (currentStatus.trim() === 'done') {
      tx.write(metaStatusPath, 'needs-rework');
      logger.info(`   📌 任务状态从 done 回退为 needs-rework`);
    }
  }

  // 提交事务 — 原子写入，失败回滚
  if (tx.length > 0) {
    await tx.commit();
    logger.info(`✅ 已更新 ${tx.length} 个文件（事务保护）`);
    logger.info(`   ${options.task}/00-specs/REQ.md`);
    logger.info(`   ${options.task}/00-specs/CHANGELOG.md`);
    logger.info(`   ${options.task}/00-specs/TASK.md`);

    // ── 联动更新上层文档（默认启用，--no-sync 禁用）──
    if (options.requirement !== false && options.task) {
      await syncToRequirement(iteration, options.task, options.desc!);
    }
    if (options.analysis !== false && options.task) {
      await syncToAnalysis(iteration, options.task, options.desc!);
    }
  }
}

async function applyGlobalChange(options: ChangeOptions): Promise<void> {
  const tx = new FileTransaction();

  // 更新 CONSTITUTION.md 的变更记录（事务保护）
  const constPath = join(process.cwd(), '.speccore', 'CONSTITUTION.md');
  if (await pathExists(constPath)) {
    let content = await readFile(constPath, 'utf-8');
    const now = new Date().toISOString().split('T')[0];
    content += `\n## 变更记录\n\n| ${now} | ${options.desc} | SpecCore |\n`;
    tx.write(constPath, content);
  }

  if (tx.length > 0) {
    await tx.commit();
    logger.info('✅ 已更新: .speccore/CONSTITUTION.md（事务保护）');
  }
}

function findDependentTasks(graphContent: string, taskName: string): string[] {
  const deps: string[] = [];
  const lines = graphContent.split('\n');
  for (const line of lines) {
    // 查找依赖关系：Task 行中包含对目标 Task 的引用
    if (line.includes(taskName) && !line.includes(`| ${taskName} |`)) {
      const match = line.match(/Task-\d+/g);
      if (match) {
        for (const t of match) {
          if (t !== taskName && !deps.includes(t)) {
            deps.push(t);
          }
        }
      }
    }
  }
  return deps;
}

/**
 * 规范化变更描述：口语 → 结构化
 * "加了个批量删除" → "新增接口: 批量删除"
 * "修登录bug" → "修复: 登录异常"
 * "改一下密码规则" → "修改: 密码规则"
 */
function normalizeDescription(desc: string): string {
  const lower = desc.replace(/\s+/g, '');

  // 新增类
  if (/^(加|新增?|添?加|创建|做了?)/.test(lower)) {
    const cleaned = lower.replace(/^(加|新增?|添加|创建|做了?)了?(个|一下)?/, '').replace(/[了啦啊]$/, '');
    return `新增${cleaned ? `: ${cleaned}` : ''}`;
  }
  // 修复类
  if (/^(修|fix|修复|改bug|解决)/.test(lower)) {
    const cleaned = lower.replace(/^(修|fix|修复|改bug|解决)了?(个|一下)?/, '').replace(/[了啦啊]$/, '');
    return `修复${cleaned ? `: ${cleaned}` : ''}`;
  }
  // 修改类
  if (/^(改|调整|修改|换成?|更新|升级)/.test(lower)) {
    const cleaned = lower.replace(/^(改|调整|修改|换成?|更新|升级)了?(个|一下)?/, '').replace(/[了啦啊]$/, '');
    return `修改${cleaned ? `: ${cleaned}` : ''}`;
  }
  // 删除/移除类
  if (/^(删|移除|去掉|干掉)/.test(lower)) {
    const cleaned = lower.replace(/^(删|移除|去掉|干掉)了?(个|一下)?/, '').replace(/[了啦啊]$/, '');
    return `删除${cleaned ? `: ${cleaned}` : ''}`;
  }

  // 无法识别，原样返回但去语气词
  return desc.replace(/[了啦啊呢嗯哦哈]$/, '').trim();
}

/**
 * 同步变更到 REQUIREMENT.md（迭代聚合需求文档）
 */
/**
 * 将澄清结果（需求分析）持久化到迭代级 CHANGE_SUMMARY.md
 */
async function writeChangeSummary(iterDir: string, changeDesc: string, impactReport: ImpactReport, affectedIds: string[]): Promise<void> {
  const summaryPath = join(iterDir, '020-specs', 'CHANGE_SUMMARY.md');
  const now = new Date().toISOString().split('T')[0];

  let content = '';
  if (await pathExists(summaryPath)) {
    content = await readFile(summaryPath, 'utf-8');
  } else {
    content = `# 变更摘要\n\n> 需求变更的分析记录，由 speccore change 自动生成\n\n`;
  }

  // 追加本次变更记录
  content += `\n---\n\n## ${now} — ${changeDesc}\n\n`;

  // 直接影响
  if (impactReport.directTasks.length > 0) {
    content += `### 🔴 直接影响（需修改 Spec + 重新执行）\n\n`;
    for (const t of impactReport.directTasks) {
      content += `- **${t.id}** ${t.name} — ${t.reason}\n`;
      if (t.affectedFiles.length > 0) {
        content += `  - 受影响文件: ${t.affectedFiles.join(', ')}\n`;
      }
    }
    content += '\n';
  }

  // 间接影响
  if (impactReport.indirectTasks.length > 0) {
    content += `### 🟡 间接影响（需回归验证）\n\n`;
    for (const t of impactReport.indirectTasks) {
      content += `- **${t.id}** ${t.name} — ${t.reason}\n`;
    }
    content += '\n';
  }

  // 无影响
  if (impactReport.unaffectedTasks.length > 0) {
    content += `### 🟢 无影响\n\n`;
    content += impactReport.unaffectedTasks.map(t => t.id).join(', ') + '\n\n';
  }

  content += `**已应用变更的任务**: ${affectedIds.join(', ')}\n`;

  await writeFile(summaryPath, content);
}

/**
 * 同步变更到 REQUIREMENT.md（迭代聚合需求文档）
 */
async function syncToRequirement(iteration: string, taskId: string, desc: string): Promise<void> {
  const iterDir = await getIterationDir(iteration);
  const reqPath = join(iterDir, '020-specs', 'REQUIREMENT.md');
  
  if (!(await pathExists(reqPath))) {
    logger.warn(`  ⚠️ REQUIREMENT.md 不存在，跳过同步`);
    return;
  }

  const content = await readFile(reqPath, 'utf-8');
  const now = new Date().toISOString().split('T')[0];
  const entry = `\n| ${now} | ${taskId}: ${desc} | 变更 |`;
  
  // 在变更履历部分追加，或在末尾追加
  const changelogMatch = content.match(/## 变更履历/);
  let updated = '';
  if (changelogMatch) {
    const idx = content.indexOf('## 变更履历');
    const nextSection = content.indexOf('\n## ', idx + 1);
    if (nextSection > 0) {
      updated = content.slice(0, nextSection) + entry + '\n' + content.slice(nextSection);
    } else {
      updated = content + entry + '\n';
    }
  } else {
    updated = content + '\n## 变更履历\n\n| 时间 | 内容 | 类型 |\n| :--- | :--- | :--- |' + entry + '\n';
  }
  
  await writeFile(reqPath, updated);
  logger.info(`   → 已同步到 REQUIREMENT.md`);
}

/**
 * 同步变更到 ANALYSIS.md（技术方案文档）
 */
async function syncToAnalysis(iteration: string, taskId: string, desc: string): Promise<void> {
  const iterDir = await getIterationDir(iteration);
  const analysisPath = join(iterDir, '020-specs', 'ANALYSIS.md');
  
  if (!(await pathExists(analysisPath))) {
    logger.warn(`  ⚠️ ANALYSIS.md 不存在，跳过同步。请先运行 speccore analyze`);
    return;
  }

  const content = await readFile(analysisPath, 'utf-8');
  const now = new Date().toISOString().split('T')[0];
  const entry = `| ${now} | ${taskId} | ${desc} |`;
  
  // 在技术方案末尾追加变更记录
  const marker = '可以开始拆分任务';
  const idx = content.lastIndexOf(marker);
  if (idx > 0) {
    const before = content.slice(0, idx + marker.length);
    const after = content.slice(idx + marker.length);
    
    if (after.includes('## 变更记录')) {
      const updated = before + after.replace(/## 变更记录[\s\S]*$/, 
        '## 变更记录\n\n| 时间 | 任务 | 变更内容 |\n| :--- | :--- | :--- |' + entry + '\n');
      await writeFile(analysisPath, updated);
    } else {
      const updated = before + '\n\n## 变更记录\n\n| 时间 | 任务 | 变更内容 |\n| :--- | :--- | :--- |' + entry + '\n' + after;
      await writeFile(analysisPath, updated);
    }
  } else {
    await writeFile(analysisPath, content + '\n\n## 变更记录\n\n| 时间 | 任务 | 变更内容 |\n| :--- | :--- | :--- |' + entry + '\n');
  }
  
  logger.info(`   → 已同步到 ANALYSIS.md`);
}
