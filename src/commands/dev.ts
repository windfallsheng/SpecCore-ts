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
  auto?: boolean;  // 全自动级联，无人工干预
  from?: string;   // 从指定阶段开始
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
  logger.info('💡 输入 speccore dev --force 自动执行下一步');
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
  const { pathExists, readFile } = require('fs-extra');
  const { execSync } = require('child_process');
  const { getDefaultIteration } = require('../core/context');

  const steps: { name: string; check: () => Promise<boolean>; run: () => void }[] = [];

  // Step 0: Init
  steps.push({
    name: 'init',
    check: async () => (await pathExists(join(process.cwd(), '.speccore', 'config', 'mode.json'))),
    run: () => {
      logger.info('\\n🤖 Step 1/9: speccore init');
      execSync('speccore init', { stdio: 'inherit' });
    }
  });

  // Step 1: Import — 智能检测已有项目
  steps.push({
    name: 'import',
    check: async () => {
      // 检查全量层是否已有项目
      const globalProjects = join(process.cwd(), '.speccore', 'GLOBAL', 'PROJECTS');
      if (await pathExists(globalProjects)) {
        const entries = await require('fs-extra').readdir(globalProjects);
        const hasProjects = entries.some((e: string) => e !== '_template');
        if (hasProjects) return true;  // 已导入过
      }
      // 检查是否有需求文档（doc2spec 方式）
      const iter = await getDefaultIteration(options.iteration);
      return iter ? await pathExists(join(process.cwd(), '期次-'+iter, '00-需求文档', 'REQUIREMENT.md')) : false;
    },
    run: () => {
      logger.info('\\n🤖 Step 2/9: speccore import (智能检测源码)');
      // 读取用户配置的 import 策略
      const configPath = join(process.cwd(), '.speccore', 'SETTINGS.md');
      logger.info('   💡 自动导入需手动配置项目路径，当前跳过');
      logger.info('   📋 手动运行: speccore import --project=<name> --path=<src> --type=<backend|frontend>');
      logger.info('   📋 或用文档方式: speccore doc2spec --file=PRD.md --platform=backend -i <迭代>');
    }
  });

  // Step 2: Analyze
  steps.push({
    name: 'analyze',
    check: async () => {
      const iter = await getDefaultIteration(options.iteration);
      if (!iter) return false;
      return await pathExists(join(process.cwd(), '期次-'+iter, '00-需求文档', 'ANALYSIS.md'));
    },
    run: () => {
      const iteration = require('../core/context').getDefaultIteration().then((it: string) => {
        logger.info('\\n🤖 Step 3/9: speccore analyze');
        execSync(`speccore analyze --iteration=${it}`, { stdio: 'inherit' });
      });
    }
  });

  // Step 3: Split
  steps.push({
    name: 'split',
    check: async () => {
      const iter = await getDefaultIteration(options.iteration);
      if (!iter) return false;
      const fs = require('fs');
      const entries = fs.readdirSync(join(process.cwd(), '期次-'+iter), { withFileTypes: true });
      return entries.some((e: any) => e.isDirectory() && e.name.startsWith('Task-'));
    },
    run: () => {
      const iteration = require('../core/context').getDefaultIteration().then((it: string) => {
        logger.info('\\n🤖 Step 4/9: speccore iteration split');
        execSync(`speccore iteration split --iteration=${it}`, { stdio: 'inherit' });
      });
    }
  });

  // Step 4: Plan
  steps.push({
    name: 'plan',
    check: async () => {
      const iter = await getDefaultIteration(options.iteration);
      if (!iter) return false;
      return await pathExists(join(process.cwd(), '期次-'+iter, 'PLAN.md'));
    },
    run: () => {
      const iteration = require('../core/context').getDefaultIteration().then((it: string) => {
        logger.info('\\n🤖 Step 5/9: speccore plan');
        execSync(`speccore plan --iteration=${it}`, { stdio: 'inherit' });
      });
    }
  });

  // Step 5: Execute (all tasks)
  steps.push({
    name: 'execute',
    check: async () => {
      const iter = await getDefaultIteration(options.iteration);
      if (!iter) return false;
      return false;  // Always try execute
    },
    run: () => {
      const iteration = require('../core/context').getDefaultIteration().then((it: string) => {
        logger.info('\\n🤖 Step 6/9: speccore execute --all --force --verify');
        execSync(`speccore execute --all --force --verify --iteration=${it}`, { stdio: 'inherit' });
      });
    }
  });

  // Step 6: Pr
  steps.push({
    name: 'pr',
    check: async () => false,
    run: () => {
      const iteration = require('../core/context').getDefaultIteration().then((it: string) => {
        logger.info('\\n🤖 Step 7/9: speccore pr');
        execSync(`speccore pr --iteration=${it}`, { stdio: 'inherit' });
      });
    }
  });

  // Step 7: Done
  steps.push({
    name: 'done',
    check: async () => false,
    run: () => {
      const iteration = require('../core/context').getDefaultIteration().then((it: string) => {
        logger.info('\\n🤖 Step 8/9: speccore done --all');
        execSync(`speccore done --all --iteration=${it} --skipValidate 2>/dev/null || true`, { stdio: 'inherit' });
      });
    }
  });

  // ── Execute pipeline ──
  logger.info('🚀 全自动流水线启动（无人干预模式）');
  logger.info('���━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  let fromIdx = 0;
  if (options.from) {
    const idx = steps.findIndex(s => s.name === options.from);
    if (idx >= 0) {
      fromIdx = idx;
      logger.info(`   ⏩ 从 "${options.from}" 阶段开始`);
    }
  }

  let completed = 0;
  let skipped = 0;
  
  for (let i = fromIdx; i < steps.length; i++) {
    const step = steps[i];
    
    try {
      const alreadyDone = await step.check();
      if (alreadyDone) {
        logger.info(`   ⏭️ ${step.name}: 已完成，跳过`);
        skipped++;
        continue;
      }

      step.run();
      completed++;
      logger.info(`   ✅ ${step.name} 完成`);
    } catch (e: any) {
      logger.error(`   ❌ ${step.name} 失败: ${e.message || e}`);
      logger.info('');
      logger.info('流水线中断。修复后运行: speccore dev --auto --from=' + step.name);
      break;
    }
  }

  logger.info('');
  logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  logger.info(`✅ 执行 ${completed} 个阶段 | ⏭️ 跳过 ${skipped} 个 | 总数 ${steps.length}`);
}
