/**
 * next — 检测当前迭代进度，提示下一步操作
 * 只做指引（不执行任何命令），输出：当前阶段 + 下一步命令 + 前方闸口 + 剩余路线图
 */
import { pathExists, readdir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { scanTasks } from '../core/state';

export interface NextOptions {
  iteration?: string;
}

/** 阶段定义（与 run 的 13 阶段一致，这里仅用于进度检测与指引展示） */
const PHASES: { key: string; label: string; layer: 'prepare' | 'main'; gate?: string; gateTitle?: string }[] = [
  { key: 'init',     label: '初始化',     layer: 'prepare' },
  { key: 'doc2spec', label: '导入需求',   layer: 'prepare' },
  { key: 'analyze',  label: '分析需求',   layer: 'main' },
  { key: 'validate', label: '校验 Spec',  layer: 'main' },
  { key: 'split',    label: '拆分任务',   layer: 'main', gate: 'A', gateTitle: 'Spec 定稿 review' },
  { key: 'plan',     label: '执行计划',   layer: 'main' },
  { key: 'execute',  label: '执行开发',   layer: 'main' },
  { key: 'verify',   label: '验证',       layer: 'main', gate: 'B', gateTitle: '代码 review' },
  { key: 'pipeline', label: '部署',       layer: 'main', gate: 'C', gateTitle: '部署前确认' },
  { key: 'pr',       label: '合并请求',   layer: 'main' },
  { key: 'done',     label: '复盘归档',   layer: 'main' },
  { key: 'spec2doc', label: '导出文档',   layer: 'main' },
];

async function hasFeatureDirs(iterDir: string): Promise<boolean> {
  try {
    const featuresDir = join(iterDir, '010-requirements', 'features');
    const entries = await readdir(featuresDir, { withFileTypes: true });
    return entries.some(e => e.isDirectory() && !e.name.startsWith('.'));
  } catch { return false; }
}

async function hasTaskDirs(iterDir: string): Promise<boolean> {
  try {
    const entries = await readdir(join(iterDir, '030-tasks'), { withFileTypes: true });
    return entries.some((e: any) => e.isDirectory() && e.name.startsWith('Task-'));
  } catch { return false; }
}

async function hasPlan(iterDir: string): Promise<boolean> {
  try {
    const plansDir = join(iterDir, '000-overview', 'plans');
    if (!(await pathExists(plansDir))) return false;
    const entries = await readdir(plansDir);
    return entries.some((e: string) => e.endsWith('.md'));
  } catch { return false; }
}

export async function nextCommand(options: NextOptions): Promise<void> {
  // ── 未初始化 ──
  if (!(await pathExists('.speccore'))) {
    logger.info('\n📍 项目尚未初始化');
    logger.info('  → speccore init');
    return;
  }

  const iteration = await getDefaultIteration(options.iteration);
  if (!iteration) {
    logger.info('\n📭 当前迭代未设置');
    logger.info('  → speccore iteration create -n Q1');
    logger.info('  → 或 speccore doc2spec -f PRD.docx --iter Q1');
    return;
  }

  const iterDir = `Iteration-${iteration}`;
  const reqDoc = join(iterDir, '010-requirements', 'REQUIREMENT.md');
  const analysis = join(iterDir, '020-specs', 'ANALYSIS.md');
  const retro = join(iterDir, '000-overview', 'RETRO.md');

  // ── 逐阶段检测，找到第一个未完成的阶段 ──
  let nextIdx = 0;

  // 0 init（.speccore 存在即视为已完成）
  nextIdx = 1;

  // 1 doc2spec（需求文档存在即视为已完成）
  const hasReq = (await pathExists(reqDoc)) || (await hasFeatureDirs(iterDir));
  if (hasReq) nextIdx = 2;

  // 2 analyze（ANALYSIS.md 存在即视为已完成）
  if (await pathExists(analysis)) nextIdx = 3;

  // 3 validate → 4 split（Task-* 存在即视为已完成）
  if (await hasTaskDirs(iterDir)) nextIdx = 4;

  // 4 split → 5 plan（plans 存在即视为已完成）
  if (await hasPlan(iterDir)) nextIdx = 5;

  // 5 plan → 6 execute（无 pending 任务即视为已完成）
  let hasPending = false;
  try {
    const tasks = await scanTasks(iteration);
    hasPending = tasks.some(t => t.status === 'pending');
  } catch { /* 无法扫描任务时保守认为尚未执行 */ }
  if (!hasPending && (await hasTaskDirs(iterDir))) nextIdx = 6;

  // 6 execute → 7 verify → 8 pipeline → 9 pr → 10 done（RETRO.md 存在即视为已完成）
  if (await pathExists(retro)) nextIdx = 10;

  // 10 done → 11 spec2doc（导出产物检测：outputs 里有 spec2doc 导出则视为已完成）
  // 导出阶段无可靠产物标记，仅当 retro 存在且用户显式进入 spec2doc 才提示完成

  const phase = PHASES[nextIdx];
  const isPrepare = phase.layer === 'prepare';

  // ── 输出指引 ──
  logger.info(`\n📍 当前进度: ${iteration}`);
  logger.info(`   ${PHASES.filter((_, i) => i < nextIdx).map(p => p.label).join(' → ')}${nextIdx > 0 ? ' ✅' : ''}`);
  logger.info('');
  logger.info(`🎯 下一步: ${phase.label}`);

  // 下一步命令
  const cmdMap: Record<string, string> = {
    init: 'speccore init',
    doc2spec: 'speccore doc2spec -f PRD.docx -i ' + iteration,
    analyze: 'speccore analyze --iteration=' + iteration,
    validate: 'speccore validate --iteration=' + iteration,
    split: 'speccore iteration split -i ' + iteration,
    plan: 'speccore plan -i ' + iteration,
    execute: 'speccore execute --auto -i ' + iteration,
    verify: 'speccore verify',
    pipeline: 'speccore pipeline --all',
    pr: 'speccore pr -i ' + iteration,
    done: 'speccore done --all -i ' + iteration,
    spec2doc: 'speccore spec2doc -i ' + iteration,
  };
  logger.info(`   → ${cmdMap[phase.key]}`);

  // 前方闸口提醒
  if (phase.gate) {
    logger.warn(`\n🛑 前方闸口 ${phase.gate}: ${phase.gateTitle}`);
    logger.warn(`   确认后继续: speccore run --from ${phase.key} -I ${iteration}`);
  }

  // 剩余路线图
  const remaining = PHASES.slice(nextIdx).map(p => p.label);
  logger.info(`\n🗺️ 剩余流程: ${remaining.join(' → ')}`);

  // 一键执行提示
  if (!isPrepare) {
    logger.info(`\n💡 一键自动: speccore run --from ${phase.key} -I ${iteration}`);
  }
}
