/**
 * dev — 智能开发入口（对标 Spec-Kit 的 5-slash 体验）
 *
 * 自动检测当前阶段，一键推进到下一步。无需记住 65 个命令。
 *
 * 阶段检测:
 *   init? → 引导初始化
 *   有需求文档? → analyze
 *   有 ANALYSIS.md? → split
 *   有 Task? → execute
 *   有代码? → lifecycle → pr
 *   有 PR? → merge-check → done
 */
import { pathExists, readdir } from 'fs-extra';
import { join } from 'path';
import { execSync } from 'child_process';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';

interface DevOptions {
  iteration?: string;
  force?: boolean;
  auto?: boolean;
  from?: string;
  to?: string;      // 结束阶段
}

export async function devCommand(options: DevOptions): Promise<void> {
  // ── Auto-pipeline mode ──
  if (options.auto) {
    await autoPipeline(options);
    return;
  }

  // ── Single-step detect mode ──
  const iteration = await getDefaultIteration(options.iteration);
  if (!iteration) {
    // Phase 0: 未初始化
    logger.info('\n🔍 检测到项目尚未初始化');
    logger.info('');
    logger.info('下一步: speccore init');
    logger.info('用途: 初始化 SpecCore 项目结构');
    if (!options.force) return;
    execSync('speccore init', { stdio: 'inherit' });
    return;
  }

  const iterDir = `期次-${iteration}`;
  logger.info(`\n📍 期次: ${iteration}`);
  logger.info('');

  // Phase 1: Check for requirement docs
  const reqDoc = join(iterDir, '00-需求文档', 'REQUIREMENT.md');
  if (!(await pathExists(reqDoc))) {
    showPhase('导入需求', [
      'speccore doc2spec --files "doc.docx=端名" -i ' + iteration,
      '将 Word/MD 需求文档导入为 Spec 格式',
    ]);
    return;
  }

  // Phase 2: Check for ANALYSIS.md
  const analysis = join(iterDir, '00-需求文档', 'ANALYSIS.md');
  if (!(await pathExists(analysis))) {
    showPhase('分析需求', [
      'speccore analyze --iteration=' + iteration,
      '自动扫描完整性 + 源码对标 + 宪法检查',
    ]);
    return;
  }

  // Phase 3: Check for tasks
  const hasTasks = await hasTaskDirs(iterDir);
  if (!hasTasks) {
    showPhase('拆分任务', [
      'speccore iteration split --iteration=' + iteration,
      '拆分为独立 Task，生成 11 份文档',
    ]);
    return;
  }

  // Phase 4: Check task execution status
  const pendingTasks = await getPendingTasks(iterDir);
  if (pendingTasks.length > 0) {
    const first = pendingTasks[0];
    showPhase(`执行任务 (${pendingTasks.length} 个待开发)`, [
      `speccore execute --task=${first} --force`,
      pendingTasks.length > 3 
        ? `speccore execute --all --batch-size=3 --force (批量执行)`
        : `speccore execute --all --force (全部执行)`,
      `speccore execute --task=${first} --agent=trae (委派外部AI)`,
    ]);
    return;
  }

  // Phase 5: Check lifecycle state
  const inProgress = await getTasksInState(iterDir, 'testing|in_progress');
  if (inProgress.length > 0) {
    showPhase('推进生命周期', [
      `speccore lifecycle --task=${inProgress[0]} --status=testing`,
      `speccore lifecycle --task=${inProgress[0]} --status=review`,
      '质量关卡: TEST.md 完成 → testing, REVIEW.md 审批 → review',
    ]);
    return;
  }

  // Phase 6: Ready for PR
  const toReview = await getTasksInState(iterDir, 'review');
  if (toReview.length > 0) {
    showPhase('创建 PR + 合并', [
      `speccore pr --task=${toReview[0]}`,
      'speccore merge-check --iteration=' + iteration,
      'speccore lifecycle --task=' + toReview[0] + ' --status=done',
    ]);
    return;
  }

  // Phase 7: All done
  logger.info('✨ 所有任务已完成！');
  logger.info('');
  logger.info('收尾操作:');
  logger.info('  speccore done --task=Task-001         一键归档');
  logger.info('  speccore arch-update                 更新架构文档');
  logger.info('  speccore dashboard                   查看全景');
  logger.info('  speccore retro                       迭代回顾');
}

function showPhase(title: string, steps: string[]): void {
  logger.info(`📋 ${title}`);
  logger.info('');
  for (let i = 0; i < steps.length; i++) {
    if (i % 2 === 0) {
      logger.info(`  ${steps[i]}`);
    } else {
      logger.info(`     ${steps[i]}`);
    }
  }
  logger.info('');
}

async function hasTaskDirs(iterDir: string): Promise<boolean> {
  try {
    const entries = await readdir(iterDir, { withFileTypes: true });
    return entries.some(e => e.isDirectory() && e.name.startsWith('Task-'));
  } catch { return false; }
}

async function getPendingTasks(iterDir: string): Promise<string[]> {
  try {
    const entries = await readdir(iterDir, { withFileTypes: true });
    const tasks = entries.filter(e => e.isDirectory() && e.name.startsWith('Task-'));
    const pending: string[] = [];
    for (const t of tasks) {
      const taskMd = join(iterDir, t.name, 'backend', 'TASK.md');
      if (await pathExists(taskMd)) {
        const { readFile } = require('fs-extra');
        const content = await readFile(taskMd, 'utf-8');
        if (content.includes('待开发') || content.includes('in_progress')) {
          pending.push(t.name);
        }
      } else {
        pending.push(t.name);
      }
    }
    return pending;
  } catch { return []; }
}

async function getTasksInState(iterDir: string, states: string): Promise<string[]> {
  try {
    const entries = await readdir(iterDir, { withFileTypes: true });
    const tasks = entries.filter(e => e.isDirectory() && e.name.startsWith('Task-'));
    const result: string[] = [];
    const stateList = states.split('|');
    for (const t of tasks) {
      const taskMd = join(iterDir, t.name, 'backend', 'TASK.md');
      if (await pathExists(taskMd)) {
        const { readFile } = require('fs-extra');
        const content = await readFile(taskMd, 'utf-8');
        for (const s of stateList) {
          if (content.includes(s)) { result.push(t.name); break; }
        }
      }
    }
    return result;
  } catch { return []; }
}

// ============================================================
// 全自动流水线：无人干预，级联执行剩余全部阶段
// ============================================================
async function autoPipeline(options: DevOptions): Promise<void> {
  const { join } = require('path');
  const { pathExists } = require('fs-extra');
  const { execSync } = require('child_process');
  const { getDefaultIteration } = require('../core/context');

  type Step = { name: string; check: () => Promise<boolean>; run: (it: string) => void };
  const steps: Step[] = [];

  // Step 0: Init
  steps.push({
    name: 'init',
    check: async () => pathExists(join(process.cwd(), '.speccore')),
    run: () => execSync('speccore init', { stdio: 'inherit' })
  });

  // Step 1: doc2spec
  steps.push({
    name: 'doc2spec',
    check: async () => {
      const it = await getDefaultIteration(options.iteration);
      return it ? pathExists(join(process.cwd(), '期次-' + it, '00-需求文档', 'REQUIREMENT.md')) : false;
    },
    run: (it) => logger.info('   💡 手动: speccore doc2spec -f PRD.docx -i ' + it)
  });

  // Step 2: analyze
  steps.push({
    name: 'analyze',
    check: async () => {
      const it = await getDefaultIteration(options.iteration);
      return it ? pathExists(join(process.cwd(), '期次-' + it, '00-需求文档', 'ANALYSIS.md')) : false;
    },
    run: (it) => execSync('speccore analyze -I ' + it + ' --depth quick', { stdio: 'inherit' })
  });

  // Step 3: split
  steps.push({
    name: 'split',
    check: async () => {
      const it = await getDefaultIteration(options.iteration);
      if (!it) return false;
      try {
        const dirs = require('fs').readdirSync(join(process.cwd(), '期次-' + it));
        return dirs.some((d: string) => d.startsWith('Task-'));
      } catch { return false; }
    },
    run: (it) => execSync('speccore iteration split -i ' + it, { stdio: 'inherit' })
  });

  // Step 4: plan
  steps.push({
    name: 'plan',
    check: async () => pathExists(join(process.cwd(), '.speccore', 'local', 'plans.json')),
    run: (it) => execSync('speccore plan -I ' + it, { stdio: 'inherit' })
  });

  // Step 5: execute
  steps.push({
    name: 'execute',
    check: async () => false,
    run: (it) => execSync('speccore execute --all --force --iteration=' + it, { stdio: 'inherit' })
  });

  // Step 6: pr
  steps.push({
    name: 'pr',
    check: async () => false,
    run: (it) => execSync('speccore pr --iteration=' + it, { stdio: 'inherit' })
  });

  // Step 7: done
  steps.push({
    name: 'done',
    check: async () => false,
    run: (it) => execSync('speccore done --iteration=' + it + ' 2>/dev/null || true', { stdio: 'pipe' })
  });

  // ── Execute pipeline ──
  const iteration = await getDefaultIteration(options.iteration) || '';
  logger.info('\n🚀 Auto pipeline: ' + (options.from || 'init') + ' → ' + (options.to || 'done'));

  let fromIdx = 0;
  let toIdx = steps.length - 1;
  if (options.from) {
    const idx = steps.findIndex(s => s.name === options.from);
    if (idx >= 0) { fromIdx = idx; logger.info('   ⏩ from: ' + options.from); }
  }
  if (options.to) {
    const idx = steps.findIndex(s => s.name === options.to);
    if (idx >= 0) toIdx = idx;
  }

  let completed = 0;
  for (let i = fromIdx; i <= toIdx && i < steps.length; i++) {
    const step = steps[i];
    try {
      const done = await step.check();
      if (done) { logger.info('   ⏭️ ' + step.name + ': already done'); continue; }
      logger.info('   ▶ ' + step.name);
      step.run(iteration);
      completed++;
    } catch (e: any) {
      logger.error('   ❌ ' + step.name + ': ' + (e.message || e));
      logger.info('\n   修复后继续: speccore dev --auto --from=' + step.name);
      break;
    }
  }
  logger.info('\n✅ Done: ' + completed + ' steps\n');
}
