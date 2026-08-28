/**
 * done — 一键收尾：validate → archive → sync-global
 */
import { readFile, pathExists, readdir } from 'fs-extra';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, getIterationDir } from '../core/context';
import { warnIfIndexStale } from '../core/index-guard';
import { showNextSteps } from '../core/next-steps';
import { extractQuestions, showQuestionChecklist } from '../core/question-checklist';
import { saveSession, clearSession, tryResume } from '../core/session-state';
import { retroCommand } from './retro';
import { loadKnowledgeGraph, traceDependencyChain, type KnowledgeGraph } from '../core/knowledge-graph';
import { detectPatternCandidates, groupCandidatesByPlatform, resolveCodeDirsFromTask, getPatternAutoSaveMode, autoSavePattern, isHighConfidenceCandidate } from '../core/pattern-detector';

export interface DoneOptions {
  task?: string;
  iteration?: string;
  skipValidate?: boolean;
  skipSync?: boolean;
  interactive?: boolean;
  all?: boolean;
  prompt?: boolean;    // --prompt: 输出验收总结 Prompt
  response?: string;   // --response: 接收 AI 验收总结
}

export async function doneCommand(options: DoneOptions): Promise<void> {
  // ── Prompt 模式 ──
  if (options.prompt) {
    const iter = options.iteration || await getDefaultIteration();
    const prompt = await buildDoneArchivePrompt(iter, options.task);
    process.stdout.write(prompt);
    process.exitCode = 10;
    return;
  }
  // ── Response 模式 ──
  if (options.response) {
    logger.success(`✅ 验收总结:\n${options.response}`);
    return;
  }
  const iteration = await getDefaultIteration(options.iteration);
  if (!iteration) { logger.error('未找到活跃迭代'); return; }

  // 命令前索引新鲜度检查（非阻塞）
  await warnIfIndexStale(process.cwd(), 'done', iteration);

  const iterDir = `Iteration-${iteration}`;

  // ── --all: 自动扫描已完成任务 ──
  if (options.all) {
    const completed = await findCompletedTasks(iterDir);
    if (completed.length === 0) { logger.info('没有可归档的任务'); return; }

    // Interactive preview
    if (options.interactive) {
      await batchDoneFlow(completed, iterDir, iteration, options);
      return;
    }

    // Batch done all
    for (const taskId of completed) {
      await doDone(iterDir, taskId, iteration, options);
    }
    logger.info(`Done: ${completed.length} tasks archived`);
    return;
  }

  if (!options.task) {
    logger.error('请指定任务: speccore done --task=Task-001 或 done --all -I Q1');
    return;
  }

  // ── 批量指定 ──
  const taskIds = options.task.split(',').map(s => s.trim()).filter(Boolean);
  for (const tid of taskIds) {
    const tasks = await scanForTask(iterDir, tid);
    if (tasks.length === 0) { logger.error('Task 未找到: ' + tid); continue; }
    const taskId = tasks[0];

    if (options.interactive) {
      await interactiveDoneFlow(iterDir, taskId, iteration, options);
    } else {
      await doDone(iterDir, taskId, iteration, options);
    }
  }
  logger.info(`Done: ${taskIds.length} tasks`);
}

async function interactiveDoneFlow(
  iterDir: string, taskId: string, iteration: string, options: DoneOptions
): Promise<void> {
  const resume = await tryResume('done', iteration);
  let skipValidate = options.skipValidate;
  let skipSync = options.skipSync;

  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(`${q} `, a => r(a.trim())));

  if (!resume.resumed) {
    logger.info(`\n📋 即将收尾: ${taskId} (迭代: ${iteration})\n`);
    logger.info('   1. validate  — 规范合规校验');
    logger.info('   2. archive   — 任务归档');
    logger.info('   3. merge     — 新增需求合并回原文档');
    logger.info('   4. sync      — 同步到全局层');
    logger.info('   5. audit     — 生成审计摘要');

    const ans = await ask('\n跳过？ [0]全部 [1]跳过校验 [2]跳过同步 [3]都跳过: ');
    if (ans === '1') skipValidate = true;
    else if (ans === '2') skipSync = true;
    else if (ans === '3') { skipValidate = true; skipSync = true; }
    await saveSession({ command: 'done', sessionId: taskId, iteration, phase: 'options', answers: { skip: ans } });
  }

  const confirm = await ask(resume.resumed ? '\n继续执行？ [y/n]: ' : '\n确认执行？ [y/n]: ');
  rl.close();
  if (confirm !== 'y') { logger.info('已取消（会话已保留，下次可恢复）'); return; }

  await clearSession('done', iteration);
  await doDone(iterDir, taskId, iteration, { ...options, skipValidate, skipSync, interactive: false });
}

async function doDone(
  iterDir: string, taskId: string, iteration: string, options: DoneOptions
): Promise<void> {
  let spinner = new Spinner(`正在收尾 ${taskId}`);
  spinner.start();
  const steps: { ok: boolean; step: string }[] = [];

  if (!options.skipValidate) {
    spinner.stop(); 
    logger.info('   1/4 校验...');
    try {
      execSync(`speccore validate --task=${taskId} --iteration=${iteration}`, { stdio: 'pipe' });
      steps.push({ ok: true, step: 'validate' });
      logger.info('     ✅ 校验通过');
    } catch {
      steps.push({ ok: false, step: 'validate' });
      logger.warn('     ⚠️ 校验发现问题（已继续）');
    }
    spinner = new Spinner(`正在收尾 ${taskId}`);
    spinner.start();
  }

  spinner.stop();
  logger.info('   2/5 归档...');
  try {
    execSync(`speccore archive --task=${taskId} --iteration=${iteration}`, { stdio: 'pipe' });
    steps.push({ ok: true, step: 'archive' });
    logger.info('     ✅ 已归档');
  } catch {
    steps.push({ ok: false, step: 'archive' });
    logger.warn('     ⚠️ 归档失败');
  }
  spinner = new Spinner(`正在收尾 ${taskId}`);
  spinner.start();

  // ── 2.5 新增需求合并回原文档 ──
  spinner.stop();
  logger.info('   3/5 新增需求合并...');
  try {
    const { mergeNewRequirementsOnArchive } = await import('../core/spec-merger');
    const mergeResult = await mergeNewRequirementsOnArchive(iterDir);
    if (mergeResult.filesUpdated > 0) {
      steps.push({ ok: true, step: 'merge-requirements' });
      logger.info(`     ✅ 已合并 ${mergeResult.filesUpdated} 个新增需求到原文档`);
    } else {
      logger.info('     ℹ️️ 无新增需求需合并');
    }
  } catch (e) {
    logger.debug('新增需求合并失败（非关键）:', e);
  }
  spinner = new Spinner(`正在收尾 ${taskId}`);
  spinner.start();

  if (!options.skipSync) {
    spinner.stop();
    logger.info('   4/5 同步到全局...');
    try {
      execSync(`speccore sync-global --iteration=${iteration} --direction=to_global`, { stdio: 'pipe' });
      steps.push({ ok: true, step: 'sync-global' });
      logger.info('     ✅ 已同步');
    } catch {
      steps.push({ ok: false, step: 'sync-global' });
      logger.warn('     ⚠️ 同步失败');
    }
    spinner = new Spinner(`正在收尾 ${taskId}`);
    spinner.start();
  }

  spinner.stop();
  logger.info('   5/5 生成摘要...');
  try {
    execSync(`speccore audit --detail --iteration=${iteration}`, { stdio: 'pipe', encoding: 'utf-8' });
    logger.info('     ✅ 审计完成');
  } catch { /* ok */ }

  const okCount = steps.filter(s => s.ok).length;
  spinner.stop(`✅ ${taskId} 收尾完成 (${okCount}/${steps.length})`);

  if (okCount === steps.length) {
    try { await evolveRules(iterDir, taskId, iteration); } catch {}
  }

  const qs = await extractQuestions(iterDir);
  if (qs.length > 0) showQuestionChecklist(qs, '收尾前最终审查');

  logger.info('');
  showNextSteps('archive');

  // ── 自动生成任务回顾 ──
  if (taskId) {
    try { await retroCommand({ task: taskId, iteration }); } catch {}
  }

  // 自动刷新知识图谱（v6.49.10+）
  try {
    const { refreshKnowledgeGraph } = await import('../core/knowledge-graph');
    await refreshKnowledgeGraph(process.cwd(), iteration);
    logger.info('🧠 知识图谱已刷新');
  } catch {}

  // v8.3.23+: 归档时自动检测可复用模式候选（适配端平铺结构 + 自动写入）
  try {
    const taskDir = join(iterDir, '030-tasks', taskId);
    const codeDirs = await resolveCodeDirsFromTask(taskDir);
    if (codeDirs.length === 0) {
      // 无代码目录时静默跳过（代码可能在外部工程）
      return;
    }
    const candidates = await detectPatternCandidates(codeDirs, `task:${taskId}`);
    if (candidates.length === 0) return;

    const mode = await getPatternAutoSaveMode();
    const autoSaved: string[] = [];
    const manual: string[] = [];

    for (const c of candidates) {
      const result = await autoSavePattern(c, `task:${taskId}`, mode);
      if (result.saved && result.path) {
        autoSaved.push(`${c.name} [${result.confidence}]`);
      } else if (!isHighConfidenceCandidate(c) && mode === 'smart') {
        manual.push(`${c.name} [${c.category}]`);
      }
    }

    logger.info('');
    logger.info('🧩 检测到以下可复用模式候选:');
    const byPlatform = groupCandidatesByPlatform(candidates);
    for (const [plat, list] of Object.entries(byPlatform)) {
      const platLabel = plat === 'shared' ? '🌐 跨端共享' : plat === 'backend' ? '⚙️ 后端' : plat === 'frontend' ? '🎨 前端' : '📦 其他';
      logger.info(`   ${platLabel} (${list.length}个):`);
      for (const c of list.slice(0, 3)) {
        logger.info(`     • ${c.name} [${c.category}] — ${c.reason}`);
        logger.info(`       文件: ${c.file}`);
      }
      if (list.length > 3) {
        logger.info(`       ... 还有 ${list.length - 3} 个`);
      }
    }

    if (autoSaved.length > 0) {
      logger.info('');
      logger.info(`   ✅ 已自动保存 ${autoSaved.length} 个高置信度模式到 .speccore/PATTERNS/`);
      for (const s of autoSaved.slice(0, 3)) {
        logger.info(`      • ${s}`);
      }
    }
    if (manual.length > 0 && mode === 'smart') {
      logger.info('');
      logger.info(`   💡 以下 ${manual.length} 个候选置信度较低，建议手动确认后保存:`);
      for (const m of manual.slice(0, 3)) {
        logger.info(`      • ${m}`);
      }
      logger.info('      命令: speccore pattern save --name=<模式名> --file=<文件路径>');
    }
    if (mode === 'off') {
      logger.info('');
      logger.info('   💡 检测到可复用模式，自动保存已关闭。如需保存请执行:');
      logger.info('      speccore pattern save --name=<模式名> --file=<文件路径>');
    }
  } catch { /* 静默失败 */ }
}

/** 扫描迭代下所有已完成但未归档的任务 */
async function findCompletedTasks(iterDir: string): Promise<string[]> {
  const fs = require('fs');
  const entries = fs.readdirSync(iterDir, { withFileTypes: true });
  return entries
    .filter((e: any) => e.isDirectory() && e.name.startsWith('Task-'))
    .map((e: any) => e.name);
}

/** 批量归档交互预览 */
async function batchDoneFlow(
  taskIds: string[], iterDir: string, iteration: string, options: DoneOptions
): Promise<void> {
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(q + ' ', a => r(a.trim())));

  logger.info(`\n📋 即将归档 ${taskIds.length} 个任务:\n`);
  for (const tid of taskIds) logger.info(`   ${tid}`);
  
  const confirm = await ask('\n确认执行？ [y/n]: ');
  rl.close();
  if (confirm !== 'y') { logger.info('已取消'); return; }

  for (const tid of taskIds) {
    await doDone(iterDir, tid, iteration, { ...options, interactive: false });
  }
  logger.info(`Done: ${taskIds.length} tasks`);
}

async function scanForTask(iterDir: string, taskId: string): Promise<string[]> {
  const fs = require('fs');
  const entries = fs.readdirSync(iterDir, { withFileTypes: true });
  return entries
    .filter((e: any) => e.isDirectory() && e.name.startsWith(taskId))
    .map((e: any) => e.name);
}

async function evolveRules(iterDir: string, taskId: string, iteration: string): Promise<void> {
  const { join } = require('path');
  const { readFile, writeFile, pathExists } = require('fs-extra');
  const taskDir = join(iterDir, '030-tasks', taskId);
  const patterns: string[] = [];

  const taskPath = join(taskDir, '00-specs', 'TASK.md');
  if (await pathExists(taskPath)) {
    const content = await readFile(taskPath, 'utf-8');
    if (content.includes('ExceptionHandler') || content.includes('@ControllerAdvice'))
      patterns.push('| RULES/EXCEPTION_HANDLING.md | 异常处理 | 统一异常处理模式 |');
    if (content.includes('JWT') || content.includes('AuthGuard') || content.includes('Passport'))
      patterns.push('| RULES/AUTH.md | 认证鉴权 | JWT/Token 认证机制 |');
    if (content.includes('Repository') || content.includes('MyBatis') || content.includes('JPA'))
      patterns.push('| RULES/ORM.md | 数据访问 | ORM 框架使用规范 |');
    if (content.includes('Cache') || content.includes('Redis'))
      patterns.push('| RULES/CACHE.md | 缓存策略 | Redis/本地缓存规范 |');
  }

  const reqPath = join(taskDir, '00-specs', 'REQ.md');
  if (await pathExists(reqPath)) {
    const content = await readFile(reqPath, 'utf-8');
    if ((content.match(/GET.*POST.*PUT.*DELETE/s) || []).length > 0 || content.includes('RESTful'))
      patterns.push('| RULES/API_CONVENTIONS.md | API 规范 | RESTful API 设计规范 |');
  }

  if (patterns.length === 0) return;
  const capPath = join(process.cwd(), '.speccore', 'CAPABILITIES.md');
  if (!(await pathExists(capPath))) return;

  let caps = await readFile(capPath, 'utf-8');
  for (const p of patterns) {
    if (!caps.includes(p)) {
      caps = caps.replace(
        '| RULES/POST_COMPLETION.md | 上线维护',
        `${p}\n| RULES/POST_COMPLETION.md | 上线维护`
      );
    }
  }
  await writeFile(capPath, caps);
}

// ═══════════════════════════════════════════════════════════
// v8.2.0+: Done 归档上下文组装 — 为验收总结构建完整上下文
// ═══════════════════════════════════════════════════════════

interface DoneArchiveSection {
  title: string;
  priority: number;
  content: string;
}

const DEFAULT_TOKEN_BUDGET = 10000;

async function buildDoneArchivePrompt(iteration: string, taskId?: string): Promise<string> {
  const iterDir = await getIterationDir(iteration);
  const sections: DoneArchiveSection[] = [];

  let prompt = `# 任务归档验收总结 — ${taskId || iteration}\n\n`;
  prompt += `> 迭代: ${iteration}\n`;
  prompt += `> 时间: ${new Date().toISOString().slice(0, 19)}\n`;
  prompt += `> 模式: 归档上下文组装（v8.2.0+）\n\n`;

  prompt += `## 指令\n\n`;
  prompt += `请基于以下任务完整生命周期上下文，生成本任务的**验收总结报告**。\n\n`;
  prompt += `报告应包含:\n`;
  prompt += `1. **功能实现概述** — 本任务实现了哪些核心功能\n`;
  prompt += `2. **规格符合度** — 代码实现与 REQ.md/TECH.md 的符合情况\n`;
  prompt += `3. **测试覆盖度** — 测试用例执行情况与覆盖分析\n`;
  prompt += `4. **风险与问题** — 遗留问题、已知风险、待办事项\n`;
  prompt += `5. **依赖影响** — 对上下游任务的影响说明\n`;
  prompt += `6. **归档建议** — 是否满足归档条件，补充建议\n\n`;

  if (taskId) {
    const taskDirCandidates = [
      join(iterDir, '030-tasks', taskId),
      join(iterDir, '030-tasks', 'feature', taskId),
      join(iterDir, '030-tasks', 'backend', taskId),
      join(iterDir, '030-tasks', 'frontend', taskId),
    ];
    let taskDir: string | null = null;
    for (const c of taskDirCandidates) {
      if (await pathExists(c)) { taskDir = c; break; }
    }

    if (taskDir) {
      const reqPath = join(taskDir, '00-specs', 'REQ.md');
      if (await pathExists(reqPath)) {
        const content = await readFile(reqPath, 'utf-8');
        sections.push({ title: '## 需求规格 (REQ.md)', priority: 1, content: truncateDoc(content, 2000) });
      }
      const techPath = join(taskDir, '00-specs', 'TECH.md');
      if (await pathExists(techPath)) {
        const content = await readFile(techPath, 'utf-8');
        sections.push({ title: '## 技术规格 (TECH.md)', priority: 2, content: truncateDoc(content, 1500) });
      }
      const depsPath = join(taskDir, 'DEPS.md');
      if (await pathExists(depsPath)) {
        const content = await readFile(depsPath, 'utf-8');
        sections.push({ title: '## 依赖分析 (DEPS.md)', priority: 3, content: truncateDoc(content, 800) });
      }
      const chgPath = join(taskDir, 'CHANGELOG.md');
      if (await pathExists(chgPath)) {
        const content = await readFile(chgPath, 'utf-8');
        sections.push({ title: '## 变更日志 (CHANGELOG.md)', priority: 4, content: truncateDoc(content, 800) });
      }
      const riskPath = join(taskDir, 'RISK.md');
      if (await pathExists(riskPath)) {
        const content = await readFile(riskPath, 'utf-8');
        sections.push({ title: '## 风险评估 (RISK.md)', priority: 5, content: truncateDoc(content, 600) });
      }
      const monPath = join(taskDir, 'MONITOR.md');
      if (await pathExists(monPath)) {
        const content = await readFile(monPath, 'utf-8');
        sections.push({ title: '## 监控方案 (MONITOR.md)', priority: 6, content: truncateDoc(content, 600) });
      }
      const testPaths: string[] = [
        join(taskDir, 'TEST.md'),
        join(taskDir, '99-artifacts', 'TEST.md'),
      ];
      for (const catDir of ['10-backend', '20-frontend']) {
        const catPath = join(taskDir, catDir);
        if (await pathExists(catPath)) {
          try {
            const services = await readdir(catPath, { withFileTypes: true });
            for (const svc of services) {
              if (!svc.isDirectory()) continue;
              const subs = await readdir(join(catPath, svc.name), { withFileTypes: true });
              for (const sub of subs) {
                if (!sub.isDirectory()) continue;
                testPaths.push(join(catPath, svc.name, sub.name, 'TEST.md'));
              }
            }
          } catch { /* skip */ }
        }
      }
      let testContent = '';
      for (const p of testPaths) {
        if (await pathExists(p)) { testContent = await readFile(p, 'utf-8'); break; }
      }
      if (testContent) {
        sections.push({ title: '## 测试用例 (TEST.md)', priority: 7, content: truncateDoc(testContent, 1000) });
      }
      const verifyPath = join(taskDir, 'VERIFY_REPORT.md');
      if (await pathExists(verifyPath)) {
        const content = await readFile(verifyPath, 'utf-8');
        sections.push({ title: '## 验证报告 (VERIFY_REPORT.md)', priority: 8, content: truncateDoc(content, 1000) });
      }
      const issuesPath = join(taskDir, '.issues.md');
      if (await pathExists(issuesPath)) {
        const content = await readFile(issuesPath, 'utf-8');
        sections.push({ title: '## 问题追踪 (.issues.md)', priority: 9, content: truncateDoc(content, 800) });
      }
      const codeSummary = await summarizeCodeOutput(taskDir);
      if (codeSummary) {
        sections.push({ title: '## 代码产出摘要', priority: 10, content: codeSummary });
      }
      const contractPath = join(taskDir, '_shared', 'API_CONTRACT.yaml');
      if (await pathExists(contractPath)) {
        const content = await readFile(contractPath, 'utf-8');
        sections.push({ title: '## API 契约 (API_CONTRACT.yaml)', priority: 11, content: truncateDoc(content, 800) });
      }

      try {
        const graph = await loadKnowledgeGraph(process.cwd());
        if (graph && taskId) {
          const { traceDependencyChain } = await import('../core/knowledge-graph');
          const chains = traceDependencyChain(graph, taskId, 3);
          if (chains.length > 0) {
            const depLines: string[] = [''];
            for (const chain of chains.slice(0, 5)) {
              const depEntity = graph.entities[chain.path[chain.path.length - 1]];
              if (depEntity) {
                depLines.push(`- **${depEntity.title}** (${depEntity.type}) — 深度 ${chain.depth}`);
              }
            }
            if (depLines.length > 1) {
              sections.push({ title: '## 依赖链路（知识图谱）', priority: 3, content: depLines.join('\n') });
            }
          }
          const taskCtx = getTaskContext(graph, taskId);
          if (taskCtx.siblingSubtasks.length > 0) {
            const siblingLines = taskCtx.siblingSubtasks
              .filter(s => s.id !== taskId)
              .slice(0, 5)
              .map(s => `- **${s.title}** (${s.platform || '-'})`);
            if (siblingLines.length > 0) {
              sections.push({ title: '## 相邻任务', priority: 4, content: '\n' + siblingLines.join('\n') });
            }
          }
        }
      } catch { /* 知识图谱不可用则跳过 */ }
    }
  }

  const indexPath = join(iterDir, '000-overview', 'INDEX.md');
  if (await pathExists(indexPath)) {
    const content = await readFile(indexPath, 'utf-8');
    sections.push({ title: '## 迭代总览 (INDEX.md)', priority: 12, content: truncateDoc(content, 600) });
  }

  sections.sort((a, b) => a.priority - b.priority);

  let totalTokens = estimateTokens(prompt);
  for (const sec of sections) {
    const secTokens = estimateTokens(sec.title + '\n' + sec.content);
    if (totalTokens + secTokens > DEFAULT_TOKEN_BUDGET) {
      prompt += `\n\n> ⚠️ 上下文已截断（Token 预算 ${DEFAULT_TOKEN_BUDGET}）。剩余 ${sections.length - sections.indexOf(sec)} 个章节未包含。\n`;
      break;
    }
    prompt += `\n\n${sec.title}\n\n${sec.content}`;
    totalTokens += secTokens;
  }

  prompt += '\n\n---\n\n';
  prompt += '## 输出格式\n\n';
  prompt += '请按以下结构返回 Markdown 格式的验收总结报告:\n\n';
  prompt += '```markdown\n';
  prompt += '# 验收总结 — {任务名}\n\n';
  prompt += '## 1. 功能实现概述\n...\n\n';
  prompt += '## 2. 规格符合度\n...\n\n';
  prompt += '## 3. 测试覆盖度\n...\n\n';
  prompt += '## 4. 风险与问题\n...\n\n';
  prompt += '## 5. 依赖影响\n...\n\n';
  prompt += '## 6. 归档建议\n...\n\n';
  prompt += '```\n';

  return prompt;
}

function estimateTokens(text: string): number {
  let tokens = 0;
  for (const ch of text) {
    tokens += ch.charCodeAt(0) > 127 ? 1.5 : 0.25;
  }
  return Math.ceil(tokens);
}

function truncateDoc(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const truncated = content.slice(0, maxChars);
  const lastBreak = truncated.lastIndexOf('\n\n');
  if (lastBreak > maxChars * 0.7) {
    return truncated.slice(0, lastBreak) + '\n\n> ...（内容已截断）';
  }
  return truncated.slice(0, maxChars - 20) + '\n\n> ...（内容已截断）';
}

async function summarizeCodeOutput(taskDir: string): Promise<string> {
  const lines: string[] = [];
  for (const catDir of ['10-backend', '20-frontend']) {
    const catPath = join(taskDir, catDir);
    if (!(await pathExists(catPath))) continue;
    try {
      const services = await readdir(catPath, { withFileTypes: true });
      for (const svc of services) {
        if (!svc.isDirectory()) continue;
        const srcPath = join(catPath, svc.name, 'src');
        const testPath = join(catPath, svc.name, 'tests');
        let fileCount = 0;
        let testCount = 0;
        if (await pathExists(srcPath)) {
          fileCount = await countFiles(srcPath, ['.ts', '.js', '.tsx', '.jsx', '.java', '.go', '.py', '.vue']);
        }
        if (await pathExists(testPath)) {
          testCount = await countFiles(testPath, ['.test.ts', '.test.js', '.spec.ts', '.spec.js', '.py']);
        }
        if (fileCount > 0) {
          lines.push(`- **${svc.name}** (${catDir.replace(/^\d+-/, '')}): ${fileCount} 个代码文件${testCount > 0 ? `, ${testCount} 个测试文件` : ''}`);
        }
      }
    } catch { /* skip */ }
  }
  const rootSrc = join(taskDir, 'src');
  if (await pathExists(rootSrc)) {
    const count = await countFiles(rootSrc, ['.ts', '.js', '.tsx', '.jsx', '.java', '.go', '.py', '.vue']);
    if (count > 0) lines.push(`- **根级 src/**: ${count} 个代码文件`);
  }
  if (lines.length === 0) return '';
  return lines.join('\n');
}

async function countFiles(dir: string, exts: string[]): Promise<number> {
  let count = 0;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        count += await countFiles(join(dir, e.name), exts);
      } else if (exts.some(ext => e.name.endsWith(ext))) {
        count++;
      }
    }
  } catch { /* skip */ }
  return count;
}

function getTaskContext(graph: KnowledgeGraph, taskId: string) {
  const entity = graph.entities[taskId];
  if (!entity) {
    return { requirement: null, siblingSubtasks: [], parentTask: null, relatedSpecs: [], dependsOn: [] };
  }
  let parentTask: typeof entity | null = null;
  const siblingSubtasks: typeof entity[] = [];
  const parentIndex = new Map<string, typeof entity[]>();
  for (const e of Object.values(graph.entities)) {
    if (e.type === 'subtask' && e.parentTaskId) {
      const list = parentIndex.get(e.parentTaskId) || [];
      list.push(e);
      parentIndex.set(e.parentTaskId, list);
    }
  }
  for (const rel of graph.relations) {
    if (rel.from === taskId && rel.type === 'subtask_of') {
      parentTask = graph.entities[rel.to] || null;
    }
  }
  const parentId = entity.parentTaskId || parentTask?.id;
  if (parentId) {
    const siblings = parentIndex.get(parentId);
    if (siblings) siblingSubtasks.push(...siblings);
  }
  return { requirement: null, siblingSubtasks, parentTask, relatedSpecs: [], dependsOn: [] };
}
