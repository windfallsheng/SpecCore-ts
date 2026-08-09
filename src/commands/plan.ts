import { join } from 'path';
import { writeFile, ensureDir, readdir, stat } from 'fs-extra';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, getIterationDir } from '../core/context';
import { readProjectGraph, topologicalSort, scanTasks, TaskState } from '../core/state';
import { FileTransaction } from '../core/transaction';
import { savePlan, listPlans, getPlan, deletePlan, cancelPlan, ExecutionPlan } from '../core/plan-store';
import { createInterface } from 'readline';
import { buildPrompt, formatPrompt } from '../core/prompt-builder';
import { generatePlanHtml } from '../core/plan-html';
import { version } from '../../package.json';

function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${question} `, answer => { rl.close(); resolve(answer.trim()); });
  });
}

export interface PlanOptions {
  iteration?: string;
  topic?: string;   // AI 提取的主题词
  team?: string;
  assign?: string;
  type?: string;
  priority?: string;
  mode?: string;
  dryRun?: boolean;
  interactive?: boolean;
  select?: boolean;
  list?: boolean;
  show?: string;
  delete?: string;
  cancel?: string;
  prompt?: boolean;    // --prompt
  response?: string;   // --response: 接收 AI 计划写入 plan.json
  html?: boolean;      // --html: 生成 speccore-plan.html 可视化页面
}

export async function planCommand(options: PlanOptions): Promise<void> {
  // ── Prompt 模式 ──
  if (options.prompt) {
    const iter = options.iteration || await getDefaultIteration();
    const taskList = await scanTasks(iter);
    const taskNames = taskList.map(t => t.id.replace(/^Task-/, '')).join(',');
    const prompt = await buildPrompt('plan', { iteration: iter, task: taskNames || undefined });
    process.stdout.write(formatPrompt(prompt));
    process.exitCode = 10;
    return;
  }

  // ── Response 模式: AI 写入计划内容 ──
  if (options.response) {
    if (!options.iteration) { logger.error('--response 需要 --iteration'); return; }
    const iterDir = await getIterationDir(options.iteration);
    const planDir = join(iterDir, '000-overview', 'plans');
    await ensureDir(planDir);
    const ts = new Date().toISOString().replace(/T/, '-').replace(/:/g, '').slice(0, 17);
    const slug = options.topic || 'plan';
    const filename = `PLAN-${ts}-${slug}.md`;
    const versionedPath = join(planDir, filename);
    const latestPath = join(planDir, 'PLAN.md');
    const tx = new FileTransaction();
    tx.write(versionedPath, options.response);
    tx.write(latestPath, options.response);
    await tx.commit();
    logger.success(`✅ 计划已保存: ${filename}`);
    printPlanFromMarkdown(options.response, options.iteration);
    return;
  }
  if (options.list) { await showPlanHistory(); return; }
  if (options.show) { await showPlanDetail(options.show); return; }
  if (options.delete) { await removePlan(options.delete); return; }
  if (options.cancel) { await doCancelPlan(options.cancel); return; }

  const spinner = new Spinner('Generating execution plan');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) { spinner.fail('No active iteration found.'); return; }

    const graph = await readProjectGraph(iteration);
    const tasks = graph.tasks.length > 0 ? graph.tasks : await scanTasks(iteration);
    if (tasks.length === 0) { spinner.fail('No tasks found'); return; }

    let filteredTasks = tasks;
    if (options.type) filteredTasks = filteredTasks.filter(t => t.type === options.type);
    if (options.priority) filteredTasks = filteredTasks.filter(t => t.priority === options.priority);

    const sortedTasks = topologicalSort(filteredTasks);
    const plan = generatePlan(sortedTasks, parseInt(options.team || '1', 10), options.mode || 'auto');
    const taskIds = sortedTasks.map(t => t.id);

    if (options.dryRun) { 
      spinner.stop('Dry run'); 
      printPlan(plan, iteration);
      if (options.html) {
        await writeHtmlPlan(sortedTasks, iteration);
      }
      return; 
    }

    if (options.interactive) {
      spinner.stop('执行计划预览');
      logger.info('');
      printPlan(plan, iteration);
      logger.info(`共 ${taskIds.length} 个任务，${plan.length} 个阶段`);
      const answer = await promptUser('\n[y] 确认保存  [q] 取消: ');
      if (answer !== 'y') { logger.info('已取消'); return; }
    }

    // --select 模式：让用户多选具体要执行的任务
    if (options.select) {
      spinner.stop('计划预览');
      logger.info('');
      printPlan(plan, iteration);
      logger.info('');
      // 列出可选项
      const taskList = sortedTasks.filter(t => t.status !== 'completed');
      logger.info('📋 可执行的任务：');
      taskList.forEach((t, idx) => {
        const num = String(idx + 1).padStart(3, ' ');
        const st = t.status === 'in_progress' ? '🔄' : '⏳';
        logger.info(`  [${num}] ${st} ${t.id} - ${t.name.slice(0, 50)}`);
      });
      logger.info('');
      const answer = await promptUser(`选择任务编号（逗号分隔, all=全部, q=取消）: `);
      if (answer === 'q' || answer === '') { logger.info('已取消'); return; }
      let selectedTasks: typeof sortedTasks;
      if (answer === 'all') {
        selectedTasks = taskList;
      } else {
        const nums = answer.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
        selectedTasks = nums.map(n => taskList[n - 1]).filter(Boolean);
        if (selectedTasks.length === 0) { logger.error('未选中任何任务'); return; }
      }
      logger.success(`✅ 已选择 ${selectedTasks.length} 个任务`);
      selectedTasks.forEach(t => logger.info(`   - ${t.id}: ${t.name}`));
      // 输出选中的具体命令
      logger.info('');
      logger.info('🎯 将执行：');
      const cmdIds = selectedTasks.map(t => t.id);
      logger.info(`   speccore execute -I ${iteration} -t ${cmdIds.join(',')} --force`);
      logger.info(`   或分批:  speccore execute -I ${iteration} -t ${cmdIds[0]} --batch-size 3 --auto`);
      // 保存到 plan 时只包含选中的任务
      const _ = await saveToStore(iteration, cmdIds, 3, options, 'manual');
      const iterDir = await getIterationDir(iteration);
      logger.info(`   计划文件: ${iterDir}/000-overview/plans/PLAN.md`);
      // ── HTML 可视化输出 ──
      if (options.html) {
        const planDir = join(iterDir, '000-overview', 'plans');
        await writeHtmlPlan(selectedTasks, iteration, planDir);
      }
      return;
    }

    const saved = await saveToStore(iteration, taskIds, 3, options, 'manual');

    // 写入带时间戳 + AI 关键词的计划文件（多版本） + 最新的 PLAN.md
    const planDir = join(await getIterationDir(iteration), '000-overview', 'plans');
    const ts = new Date().toISOString().replace(/T/, '-').replace(/:/g, '').slice(0, 17);
    const slug = extractPlanSlug(sortedTasks);
    const filename = slug ? `PLAN-${ts}-${slug}.md` : `PLAN-${ts}.md`;
    const versionedPath = join(planDir, filename);
    const latestPath = join(planDir, 'PLAN.md');
    const tx = new FileTransaction();
    tx.write(versionedPath, formatPlanMarkdown(plan, iteration, sortedTasks));
    tx.write(latestPath, formatPlanMarkdown(plan, iteration, sortedTasks)); // 最新版覆盖
    await tx.commit();

    // ── HTML 可视化输出 ──
    if (options.html) {
      await writeHtmlPlan(sortedTasks, iteration, planDir);
    }

    spinner.stop(`Saved: ${filename} | ${taskIds.length} tasks, ${plan.length} phases`);
    printPlan(plan, iteration);
  } catch (error) {
    spinner.fail(`Failed: ${error}`);
    throw error;
  }
}

async function saveToStore(
  iteration: string, taskIds: string[], batchSize: number,
  options: PlanOptions, source: ExecutionPlan['source']
): Promise<ExecutionPlan> {
  return savePlan({
    name: `Plan-${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    iteration, tasks: taskIds, batchSize, source,
    filters: { assignee: options.assign, type: options.type, priority: options.priority },
  });
}

async function showPlanHistory(): Promise<void> {
  // 1. 从磁盘读取所有 PLAN-*.md 文件，按时间倒序
  const plans: { file: string; time: Date; size: number }[] = [];
  try {
    const iter = await getDefaultIteration();
    if (iter) {
      const planDir = join(await getIterationDir(iter), '000-overview', 'plans');
      let files: string[] = [];
      try { files = await readdir(planDir); } catch { files = []; }
      for (const f of files) {
        const m = f.match(/^PLAN-(\d{4}-\d{2}-\d{2}-\d{4})\.md$/);
        if (m) {
          const st = await stat(join(planDir, f));
          plans.push({ file: f, time: st.mtime, size: st.size });
        }
      }
      // 按时间倒序：最新的在最前面
      plans.sort((a, b) => b.time.getTime() - a.time.getTime());
    }
  } catch {}

  // 2. 从 store 读取
  const storePlans = await listPlans(undefined, 20);

  if (plans.length === 0 && storePlans.length === 0) { logger.info('No plan files yet.'); return; }

  // 展示磁盘文件（倒序）
  if (plans.length > 0) {
    const iter = await getDefaultIteration();
    logger.info(`\n📋 计划文件 · ${await getIterationDir(iter)}/000-overview/plans/ (${plans.length}):\n`);
    for (const p of plans) {
      const isLatest = p.file === 'PLAN.md' ? ' 📌 最新' : '';
      logger.info(`  📄 ${p.file}  ${formatFileSize(p.size)}  ${p.time.toLocaleString()}${isLatest}`);
    }
    logger.info(`\n  💡 PLAN.md = 最新版本（可直接打开）`);
    logger.info(`  ⚙️  历史版本按时间倒序排列\n`);
  }

  // 展示 store 记录
  if (storePlans.length > 0) {
    logger.info(`📊 执行记录 (${storePlans.length}):\n`);
    for (const p of storePlans) {
      const src = { manual: 'manual', auto: 'auto', schedule: 'sched' }[p.source];
      const icon = p.status === 'completed' ? '✅' : p.status === 'cancelled' ? '🚫' : '⏳';
      logger.info(`  ${icon} ${p.id.slice(0, 12)}  [${src}]  ${p.status}`);
    }
  }

  logger.info('\nspeccore plan --show <id>  |  --cancel <id>  |  --delete <id>');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function showPlanDetail(id: string): Promise<void> {
  const p = await getPlan(id);
  if (!p) { logger.error('Not found'); return; }

  logger.info(`\n${p.name}`);
  logger.info(`  ID:       ${p.id}`);
  logger.info(`  Source:   ${p.source}  |  Status: ${p.status}`);
  logger.info(`  Iter:     ${p.iteration}  |  Batch: ${p.batchSize}`);
  logger.info(`  Created:  ${new Date(p.createdAt).toLocaleString()}`);
  if (p.executedAt) logger.info(`  Done:     ${new Date(p.executedAt).toLocaleString()}`);
  logger.info(`\n  Tasks (${p.tasks.length}):`);
  for (let i = 0; i < p.tasks.length; i += p.batchSize) {
    logger.info(`    batch ${Math.floor(i / p.batchSize) + 1}: ${p.tasks.slice(i, i + p.batchSize).join(', ')}`);
  }
  logger.info('');
}

async function removePlan(id: string): Promise<void> {
  const ok = await deletePlan(id);
  logger.info(ok ? 'Deleted.' : 'Not found.');
}

async function doCancelPlan(id: string): Promise<void> {
  const ok = await cancelPlan(id);
  logger.info(ok ? 'Cancelled (status retained).' : 'Not found.');
}

// ── Helpers ──
interface TaskPlan {
  id: string; name: string; type: string; priority: string;
  branch: string; dependencies: string[]; status: string;
  assignee: string; progress: number; estimatedHours: number;
}
interface PlanEntry { phase: number; tasks: TaskPlan[]; }

function generatePlan(tasks: TaskState[], teamSize: number, mode: string): PlanEntry[] {
  if (mode === 'claim') {
    return [{ phase: 1, tasks: tasks.map(t => buildTaskPlan(t)) }];
  }
  const phases: PlanEntry[] = [];
  const pc = Math.min(teamSize || 3, tasks.length);
  for (let i = 0; i < tasks.length; i += pc) {
    phases.push({
      phase: phases.length + 1,
      tasks: tasks.slice(i, i + pc).map(t => buildTaskPlan(t)),
    });
  }
  return phases;
}

function buildTaskPlan(t: TaskState): TaskPlan {
  return {
    id: t.id,
    name: t.name,
    type: t.type || 'feature',
    priority: t.priority || 'medium',
    branch: `feature/${t.id}-${sanitizeBranchName(t.name)}`,
    dependencies: t.dependencies || [],
    status: t.status || 'pending',
    assignee: t.assignee || 'TBD',
    progress: t.progress || 0,
    estimatedHours: t.type === 'bugfix' ? 1 : 2,
  };
}

function sanitizeBranchName(name: string): string {
  return name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

/** 从 AI 生成的 Markdown 中提取并打印计划摘要 */
function printPlanFromMarkdown(md: string, iteration: string): void {
  const phaseMatch = md.match(/Phase \d+[:：].+/g) || md.match(/\*\*Phase/ig);
  const taskCount = (md.match(/Task-\d+/g) || []).length;
  const apiCount = (md.match(/\d+ API/g) || []).length;
  logger.info(`\n📋 计划摘要: ${iteration}  (${taskCount} 个任务${apiCount > 0 ? ', API分析' : ''})`);
  if (phaseMatch) {
    for (const line of phaseMatch.slice(0, 5)) {
      logger.info(`  ${line.replace(/\*\*/g, '').trim()}`);
    }
  }
  logger.info(`  → 完整版本: 000-overview/plans/PLAN-*.md`);
}

function printPlan(plan: PlanEntry[], iteration: string): void {
  const allTasks = plan.flatMap(p => p.tasks);
  logger.info(`\n📋 Plan: ${iteration}  (${allTasks.length} tasks, ${plan.length} phases)\n`);
  for (const phase of plan) {
    logger.info(`Phase ${phase.phase}:`);
    for (const t of phase.tasks) {
      const st = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⏳';
      logger.info(`  ${st} ${t.id}  ${t.name}  [${t.type}] → ${t.branch}`);
    }
    logger.info('');
  }
}

function formatPlanMarkdown(plan: PlanEntry[], iteration: string, allRawTasks?: TaskState[]): string {
  const allTasks = plan.flatMap(p => p.tasks);
  const totalHours = allTasks.reduce((s, t) => s + t.estimatedHours, 0);
  const ts = new Date().toISOString();
  const highRiskTasks = allTasks.filter(t => t.dependencies.length >= 2 || t.priority === 'high');

  const lines: string[] = [];
  lines.push(`# 📋 Plan — ${iteration}`);
  lines.push('');
  lines.push(`> **生成**: ${ts}  ·  **状态**: ⏳ active`);
  lines.push(`> **任务**: ${allTasks.length}  ·  **阶段**: ${plan.length}  ·  **预估**: ${totalHours}h`);
  lines.push('');

  // ── 1. 依赖拓扑 (Mermaid) ──
  const hasDeps = allTasks.some(t => t.dependencies.length > 0);
  if (hasDeps || allTasks.length > 1) {
    lines.push('---');
    lines.push('');
    lines.push('## 1. 依赖关系图');
    lines.push('');
    lines.push('```mermaid');
    lines.push('graph LR');
    for (const t of allTasks) {
      const label = t.name.length > 15 ? t.name.slice(0, 12) + '...' : t.name;
      if (t.dependencies.length > 0) {
        for (const d of t.dependencies) {
          lines.push(`  ${d}["${d}"] --> ${t.id}["${label}"]`);
        }
      } else {
        lines.push(`  ${t.id}["${label}"]`);
      }
    }
    // 标记风险任务
    for (const t of highRiskTasks) {
      lines.push(`  style ${t.id} fill:#f96,stroke:#333`);
    }
    lines.push('```');
    lines.push('');
  }

  // ── 2. 甘特图 (Mermaid) ──
  lines.push('---');
  lines.push('');
  lines.push('## 2. 执行甘特图');
  lines.push('');
  lines.push('```mermaid');
  lines.push('gantt');
  lines.push(`  title ${iteration} 执行计划`);
  lines.push('  dateFormat YYYY-MM-DD');
  lines.push('  axisFormat %m-%d');
  lines.push('');
  let dayOffset = 0;
  for (const phase of plan) {
    for (const t of phase.tasks) {
      const dur = t.estimatedHours <= 4 ? '1d' : t.estimatedHours <= 8 ? '2d' : '3d';
      const after = t.dependencies.length > 0 ? `after ${t.dependencies[0]}` : '';
      const day = dayOffset;
      lines.push(`  section Phase ${phase.phase}`);
      lines.push(`  ${t.id}: ${t.name.slice(0, 20)} :${after}${day}, ${dur}`);
    }
    dayOffset += 2;
  }
  lines.push('```');
  lines.push('');

  // ── 3. 执行概览 ──
  lines.push('---');
  lines.push('');
  lines.push('## 3. 执行概览');
  lines.push('');
  for (const phase of plan) {
    lines.push(`### Phase ${phase.phase}`);
    lines.push('');
    lines.push('| Task | Type | Priority | Branch | Deps | Assignee | Est. | Status |');
    lines.push('|:---|:---|:---|:---|:---|:---|:---:|:---|');
    for (const t of phase.tasks) {
      const st = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⏳';
      const deps = t.dependencies.length > 0 ? t.dependencies.join(', ') : '—';
      const prio = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🟢';
      lines.push(`| ${t.id} | ${t.type} | ${prio} | \`${t.branch}\` | ${deps} | ${t.assignee} | ${t.estimatedHours}h | ${st} |`);
    }
    lines.push('');
  }

  // ── 3.5 具体命令（供用户选择） ──
  lines.push('---');
  lines.push('');
  lines.push('## 📋 具体命令（反选步骤）');
  lines.push('');
  lines.push('每个任务的完整 CLI 命令。AI 可用 AskUserQuestion 多选哪些任务要执行。');
  lines.push('');
  lines.push('| # | Task | 命令 |');
  lines.push('|:--|:---|:---|');
  for (const t of allTasks) {
    if (t.status === 'completed') continue; // 已完成不列
    const cmd = `speccore execute -I ${iteration} -t ${t.id} --type ${t.type} --force`;
    lines.push(`| ${t.id.replace(/Task-/, '')} | ${t.name.slice(0, 40)} | \`${cmd}\` |`);
  }
  lines.push('');
  lines.push('**批量执行**：');
  lines.push('```bash');
  lines.push(`speccore execute -I ${iteration} --all --batch-size 5 --auto --force`);
  lines.push('```');
  lines.push('');

  // ── 4. 任务详情 ──
  lines.push('---');
  lines.push('');
  lines.push('## 4. 任务详情');
  lines.push('');
  for (const t of allTasks) {
    lines.push(`### ${t.id}: ${t.name}`);
    lines.push('');
    lines.push('| 属性 | 值 |');
    lines.push('|:---|:---|');
    lines.push(`| 类型 | ${t.type} |`);
    lines.push(`| 优先级 | ${t.priority} |`);
    lines.push(`| 分支 | \`${t.branch}\` |`);
    lines.push(`| 状态 | ${t.status} |`);
    lines.push(`| 负责人 | ${t.assignee} |`);
    lines.push(`| 预估 | ${t.estimatedHours}h |`);
    lines.push(`| 依赖 | ${t.dependencies.length > 0 ? t.dependencies.join(', ') : '无'} |`);
    lines.push('');
  }

  // ── 5. 风险评估 ──
  lines.push('---');
  lines.push('');
  lines.push('## 5. 风险评估');
  lines.push('');
  if (highRiskTasks.length > 0) {
    lines.push('| Task | 风险级别 | 风险说明 | 缓解措施 |');
    lines.push('|:---|:---|:---|:---|');
    for (const t of highRiskTasks) {
      const reasons: string[] = [];
      if (t.dependencies.length >= 2) reasons.push(`多依赖(${t.dependencies.length}个)`);
      if (t.priority === 'high') reasons.push('高优先级');
      const reason = reasons.join(', ');
      const mitigation = t.dependencies.length >= 2 ? '前置任务优先完成后再启动' : '提前评审方案，预留 buffer';
      lines.push(`| ${t.id} | ${t.priority === 'high' ? '🔴 高' : '🟡 中'} | ${reason} | ${mitigation} |`);
    }
  } else {
    lines.push('> ✅ 无明显高风险任务。');
  }
  lines.push('');

  // ── 5. 里程碑 ──
  lines.push('---');
  lines.push('');
  lines.push('## 6. 里程碑');
  lines.push('');
  lines.push('| 里程碑 | 触发条件 | 验收标准 | 预计完成 |');
  lines.push('|:---|:---|:---|:---|');
  for (const phase of plan) {
    const phaseTasks = phase.tasks.map(t => t.id).join(', ');
    lines.push(`| Phase ${phase.phase} 完成 | ${phaseTasks} 全部 done | 所有关联分支合并 / 测试通过 | TBD |`);
  }
  lines.push('');

  // ── 6. 回滚方案 ──
  lines.push('---');
  lines.push('');
  lines.push('## 7. 回滚方案');
  lines.push('');
  lines.push('- **触发条件**: 任一 Phase 中关键任务阻塞超过 4h 或 P0 问题未解决');
  lines.push('- **回滚步骤**:');
  lines.push('  1. 暂停当前 Phase 执行');
  lines.push('  2. 已合并分支 revert');
  lines.push('  3. 更新本计划状态为 `abandoned`');
  lines.push('  4. 生成新的修正计划');
  lines.push('- **责任人**: 迭代负责人 + 受影响任务 assignee');
  lines.push('');

  // ── 7. 执行记录 ──
  lines.push('---');
  lines.push('');
  lines.push('## 8. 执行记录');
  lines.push('');
  lines.push('| 时间 | 事件 | 详情 |');
  lines.push('|:---|:---|:---|');
  lines.push(`| ${new Date().toLocaleString()} | 📋 计划创建 | ${allTasks.length} tasks, ${plan.length} phases, ${totalHours}h |`);
  lines.push('');
  lines.push('> 执行过程中自动追加事件。');
  lines.push('');

  return lines.join('\n');
}

/**
 * 抽取任务数据写入 speccore-plan.html
 */
async function writeHtmlPlan(
  tasks: TaskState[],
  iteration: string,
  planDir?: string
): Promise<void> {
  const htmlData = tasks.map(t => ({
    id: t.id,
    name: t.name,
    priority: t.priority,
    status: t.status,
    owner: t.assignee || undefined,
    dependsOn: t.dependencies || [],
  }));
  const html = generatePlanHtml(htmlData, { version, iteration });

  // 写入 plans 目录，和 PLAN.md 放一起
  const htmlPath = planDir
    ? join(planDir, 'speccore-plan.html')
    : join(process.cwd(), 'speccore-plan.html');
  await writeFile(htmlPath, html, 'utf-8');
  logger.success(`✅ 计划可视化: ${htmlPath}`);
}

/**
 * 从任务名称中提取关键英文词，拼成计划文件名后缀
 * 例: [login, payment, refactor] → "login-payment-refactor"
 */
function extractPlanSlug(tasks: TaskState[]): string {
  if (tasks.length === 0) return '';

  // 提取所有任务名中的有效英文/拼音词
  const allWords = tasks.flatMap(t => {
    const name = (t.name || t.id).toLowerCase();
    // 提取纯英文词（≥3 字母）和中文转拼音的关键词
    const englishWords = name.match(/[a-z]{3,}/g) || [];
    // 从类型中提取
    const typeWords = (t.type || '').match(/[a-z]{3,}/g) || [];
    return [...englishWords, ...typeWords];
  });

  // 去重 + 按频率排序 + 取前 3 个
  const freq: Record<string, number> = {};
  for (const w of allWords) {
    // 过滤常见无意义词
    if (['the', 'and', 'for', 'new', 'all', 'from', 'with', 'test'].includes(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }
  const top = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);

  // 如果英文词不够，用任务类型补
  if (top.length === 0) {
    const types = [...new Set(tasks.map(t => t.type).filter(Boolean))];
    return types.slice(0, 2).join('-').slice(0, 30);
  }

  return top.join('-').slice(0, 40);
}
