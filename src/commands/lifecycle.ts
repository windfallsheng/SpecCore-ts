/**
 * lifecycle — 任务生命周期管理（开发 → 测试 → 修复 → 审查 → 完成）
 */
import { readFile, writeFile, pathExists } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, getIterationDir } from '../core/context';
import { scanTasks } from '../core/state';
import { resolveTask, formatResolveResult } from '../core/resolver';

import { showNextSteps } from '../core/next-steps';

/**
 * 解析任务目录基础路径：优先 030-tasks/，兼容旧布局（迭代根目录）
 */
async function resolveTaskBase(iterDir: string): Promise<string> {
  const tasksDir = join(iterDir, '030-tasks');
  return (await pathExists(tasksDir)) ? tasksDir : iterDir;
}
export interface LifecycleOptions {
  task?: string;
  status?: string;     // 手动设置状态
  check?: boolean;     // 检查当前状态
  iteration?: string;
  all?: boolean;       // 查看所有任务
}

const STATES = ['pending', 'in_progress', 'testing', 'test_failed', 'review', 'review_failed', 'done'] as const;
type State = typeof STATES[number];

const STATE_ICONS: Record<State, string> = {
  pending: '🔲',
  in_progress: '🔵',
  testing: '🟡',
  test_failed: '🔴',
  review: '🟣',
  review_failed: '🟠',
  done: '🟢',
};

const STATE_LABELS: Record<State, string> = {
  pending: '待开发',
  in_progress: '开发中',
  testing: '测试中',
  test_failed: '测试未通过',
  review: '代码审查中',
  review_failed: '审查未通过',
  done: '已完成',
};

export async function lifecycleCommand(options: LifecycleOptions): Promise<void> {
  const iteration = await getDefaultIteration(options.iteration);
  if (!iteration) {
    logger.error('No active iteration');
    return;
  }

  // ── 查看所有任务状态 ──
  if (options.all) {
    await showAllTasks(iteration);
    return;
  }

  // ── 无 task 显示流程图 ──
  if (!options.task) {
    showLifecycleDiagram();
    return;
  }

  // ── 查找 task（使用统一 resolver） ──
  const taskResult = await resolveTask(options.task, iteration);
  if (!taskResult.exact || !taskResult.value) {
    if (taskResult.candidates.length > 1) {
      logger.warn(taskResult.hint || '找到多个匹配任务，请指定更精确的名称');
    } else {
      logger.error(taskResult.hint || `Task 未找到: ${options.task}`);
    }
    return;
  }
  const task = taskResult.value;
  if (taskResult.matchType !== 'exact') {
    const hint = formatResolveResult(taskResult, 'Task');
    if (hint) logger.info(hint);
  }

  const iterDir = await getIterationDir(iteration);
  const taskRoot = await resolveTaskBase(iterDir);
  // 优先 00-specs/，兼容旧路径 backend/
  const taskDir = join(taskRoot, task.id, '00-specs');
  const legacyTaskDir = join(taskRoot, task.id, 'backend');
  const taskMdPath = join(taskDir, 'TASK.md');
  const legacyTaskMdPath = join(legacyTaskDir, 'TASK.md');

  const actualTaskMd = (await pathExists(taskMdPath)) ? taskMdPath : (await pathExists(legacyTaskMdPath)) ? legacyTaskMdPath : null;
  if (!actualTaskMd) {
    logger.error(`TASK.md 未找到: ${taskMdPath}`);
    return;
  }

  let content = await readFile(actualTaskMd, 'utf-8');
  const currentState = detectState(content);
  let newState: State | undefined;

  // ── 设置状态 ──
  if (options.status) {
    const target = options.status.toLowerCase() as State;
    if (!STATES.includes(target)) {
      logger.error(`无效状态: ${options.status}。有效值: ${STATES.join(', ')}`);
      return;
    }
    
    if (target === currentState) {
      logger.info(`任务已在 ${STATE_ICONS[currentState]} ${STATE_LABELS[currentState]}`);
      return;
    }

    // ── 质量关卡 ──
    const blockReason = await checkQualityGate(taskRoot, task.id, currentState, target);
    if (blockReason) {
      logger.warn(`\n🚫 质量关卡未通过: ${blockReason}`);
      logger.info('   💡 请完成后再推进');
      return;
    }

    newState = target;
    content = updateState(content, currentState, newState);
    await writeFile(actualTaskMd, content);
  }

  // ── 检查并显示当前状态 ──
  const displayState = newState || currentState;
  logger.info(`\n${task.id}: ${STATE_ICONS[displayState]} ${STATE_LABELS[displayState]}`);

  // ── 智能提示下一步 ──
  showNextStep(task.id, iteration, displayState);

  // ── 自动建议 ──
  if (options.check) {
    await runCheck(task.id, taskRoot, task.id, displayState);
  }
}

// ================================================================
// 状态检测与更新
// ================================================================

function detectState(content: string): State {
  // 从 TASK.md 的变更履历中检测最后状态
  const stateMatch = content.match(/状态:\s*([^\n]+)/);
  if (stateMatch) {
    const label = stateMatch[1].trim();
    const entry = Object.entries(STATE_LABELS).find(([, v]) => v === label);
    if (entry) return entry[0] as State;
  }
  
  // 从 ## 变更履历 表最后一行获取
  const changelog = content.match(/## 变更履历[\s\S]*$/);
  if (changelog) {
    const lines = changelog[0].split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      for (const state of STATES) {
        if (lines[i].includes(STATE_LABELS[state])) return state;
      }
    }
  }

  return 'pending';
}

function updateState(content: string, from: State, to: State): string {
  const now = new Date().toISOString().split('T')[0];
  const entry = `| ${now} | 状态变更: ${STATE_LABELS[from]} → ${STATE_LABELS[to]} | lifecycle |`;

  // 更新状态行
  content = content.replace(
    /状态:\s*[^\n]+/,
    `状态: ${STATE_LABELS[to]}`
  );

  // 追加到变更履历
  const changelog = content.match(/## 变更履历/);
  if (changelog) {
    const idx = content.lastIndexOf('\n|', content.length - 100);
    if (idx > 0) {
      const endOfLine = content.indexOf('\n', idx + 1);
      content = content.slice(0, endOfLine) + '\n' + entry + content.slice(endOfLine);
    } else {
      content += '\n' + entry + '\n';
    }
  } else {
    content += `\n## 变更履历\n\n| 时间 | 变更内容 | 变更人 |\n| :--- | :--- | :--- |\n${entry}\n`;
  }

  return content;
}

// ================================================================
// 流程图与提示
// ================================================================

function showLifecycleDiagram(): void {
  logger.info('\n📋 任务生命周期流程:\n');
  showNextSteps('lifecycle');
  logger.info('  🔲 pending        → 待开发');
  logger.info('       ↓ speccore execute');
  logger.info('  🔵 in_progress    → 开发中');
  logger.info('       ↓ 编码完成');
  logger.info('  🟡 testing        → 测试中');
  logger.info('       ↓ 测试通过              → 回退 🔴 test_failed');
  logger.info('  🟣 review         → 代码审查');
  logger.info('       ↓ 审查通过              → 回退 🟠 review_failed');
  logger.info('  🟢 done           → 已完成\n');
  logger.info('用法:');
  logger.info('  speccore lifecycle --task=Task-001 --status=testing');
  logger.info('  speccore lifecycle --task=Task-001 --check');
  logger.info('  speccore lifecycle --all');
}

function showNextStep(taskId: string, iteration: string, state: State): void {
  const steps: Record<State, string> = {
    pending:      `speccore execute --task=${taskId} --force`,
    in_progress:  `speccore lifecycle --task=${taskId} --status=testing`,
    testing:      `参照 99-artifacts/TEST.md 逐项验证，通过后: speccore lifecycle --task=${taskId} --status=review`,
    test_failed:  '修复代码后: speccore lifecycle --task=Task-001 --status=testing',
    review:       `对照 99-artifacts/REVIEW.md 审查，通过后: speccore lifecycle --task=${taskId} --status=done`,
    review_failed:'修复审查意见后: speccore lifecycle --task=Task-001 --status=review',
    done:         `✅ 完成! 运行: speccore archive --task=${taskId}`,
  };
  logger.info(`   → 下一步: ${steps[state]}`);
}

async function showAllTasks(iteration: string): Promise<void> {
  const iterDir = await getIterationDir(iteration);
  const taskBase = await resolveTaskBase(iterDir);
  const tasks = await scanTasks(iteration);
  
  logger.info(`\n📋 迭代 ${iteration} 任务看板:\n`);
  
  const byState: Record<string, string[]> = {};
  for (const state of STATES) byState[state] = [];

  for (const task of tasks) {
    const taskMdPath = join(taskBase, task.id, '00-specs', 'TASK.md');
    if (await pathExists(taskMdPath)) {
      const content = await readFile(taskMdPath, 'utf-8');
      const state = detectState(content);
      byState[state].push(task.id);
    } else {
      byState['pending'].push(task.id);
    }
  }

  for (const state of STATES) {
    const tasks = byState[state];
    if (tasks.length > 0) {
      logger.info(`  ${STATE_ICONS[state]} ${STATE_LABELS[state]}: ${tasks.join(', ')}`);
    }
  }
  
  const total = tasks.length;
  const done = byState['done'].length;
  logger.info(`\n  进度: ${done}/${total} (${Math.round(done/total*100)}%)`);
}

async function runCheck(taskId: string, taskRoot: string, taskDirName: string, state: State): Promise<void> {
  const testMdPath = join(taskRoot, taskDirName, '99-artifacts', 'TEST.md');
  const reviewMdPath = join(taskRoot, taskDirName, '99-artifacts', 'REVIEW.md');

  if (state === 'testing' && await pathExists(testMdPath)) {
    const testContent = await readFile(testMdPath, 'utf-8');
    const total = (testContent.match(/⬜|✅|❌/g) || []).length;
    const passed = (testContent.match(/✅/g) || []).length;
    const failed = (testContent.match(/❌/g) || []).length;
    logger.info(`\n  🧪 测试用例: ${passed}✅ / ${failed}❌ / ${total - passed - failed}⬜`);
    if (failed > 0) {
      logger.warn('  ⚠️ 有未通过的测试，建议修复后再提交审查');
    } else if (passed === total) {
      logger.info('  ✅ 全部通过！可以推进到 review');
    }
  }

  if (state === 'review' && await pathExists(reviewMdPath)) {
    const reviewContent = await readFile(reviewMdPath, 'utf-8');
    const total = (reviewContent.match(/\[ \]|\[x\]/g) || []).length;
    const checked = (reviewContent.match(/\[x\]/g) || []).length;
    logger.info(`\n  📋 审查清单: ${checked}/${total} 项通过`);
    if (checked === total) {
      logger.info('  ✅ 审查清单全部确认！可以推进到 done');
    }
  }
}

/**
 * 质量关卡：禁止跳过必要步骤
 */
async function checkQualityGate(taskRoot: string, taskId: string, from: State, to: State): Promise<string | null> {
  if (from === 'in_progress' && to === 'review') {
    return '必须先经过 testing 阶段';
  }
  if (from !== 'review' && to === 'done' ) {
    return '必须先经过 review 阶段';
  }
  if (to === 'review') {
    const testPath = join(taskRoot, taskId, '99-artifacts', 'TEST.md');
    if (await pathExists(testPath)) {
      const testContent = await readFile(testPath, 'utf-8');
      const total = (testContent.match(/\[ \]/g) || []).length;
      const checked = (testContent.match(/\[x\]/gi) || []).length;
      if (total > 0 && checked < total) {
        return `TEST.md 还有 ${total - checked} 项未完成 (${checked}/${total})`;
      }
    }
  }
  if (to === 'done') {
    const reviewPath = join(taskRoot, taskId, '99-artifacts', 'REVIEW.md');
    if (await pathExists(reviewPath)) {
      const reviewContent = await readFile(reviewPath, 'utf-8');
      const total = (reviewContent.match(/\[ \]/g) || []).length;
      const checked = (reviewContent.match(/\[x\]/gi) || []).length;
      if (total > 0 && checked === 0) {
        return `REVIEW.md 尚未开始审查 (0/${total})`;
      }
    }
  }
  return null;
}
