/**
 * run — 端到端流水线执行入口
 * 唯一执行入口：13 阶段全自动流水线（--auto 默认，--from/--to 指定起止，--demo 放宽闸口 A/B）
 */
import { pathExists, readdir, writeFile, ensureDir, readFile } from 'fs-extra';
import { join, basename } from 'path';
import { execSync } from 'child_process';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { collectQuestionFiles } from '../core/questions';
import { generateHandoff, type HandoffStage } from '../core/handoff-generator';
import { loadConfigWithMeta } from '../core/unified-config';

export interface RunOptions {
  iteration?: string; force?: boolean; auto?: boolean; autoSteps?: string;
  from?: string; to?: string;
  demo?: boolean;       // v8.3.184+: --demo 演示模式（放宽闸口 A/B，保留 C）
  demand?: string;      // v8.3.184+: 一句话需求描述（req-doc 阶段入口）
  preset?: string;      // v8.3.190+: --preset 预设/自定义流水线名
}

async function hasFeatureDirs(iterDir: string): Promise<boolean> {
  try {
    const featuresDir = join(iterDir, '010-requirements', 'features');
    const entries = await readdir(featuresDir, { withFileTypes: true });
    return entries.some(e => e.isDirectory() && !e.name.startsWith('.'));
  } catch { return false; }
}

export async function runCommand(options: RunOptions): Promise<void> {
  await autoPipeline(options);
}

async function autoPipeline(options: RunOptions): Promise<void> {
  const PIPELINE_PHASES = [
    // ── 需求入口（二选一：req-doc 一句话需求 / doc2spec 导入文档）──
    { key: 'req-doc',   cmd: 'speccore req-doc',         layer: 'prepare' },
    { key: 'doc2spec',  cmd: 'speccore doc2spec',        layer: 'prepare' },
    // ── 结构化：切分功能单元（1→N，独立于澄清）──
    { key: 'split-units', cmd: 'speccore doc2spec --split', layer: 'prepare' },
    // ── 主流程（分析→校验→任务化→计划→执行→验证→部署→合并→归档→导出）──
    { key: 'analyze',   cmd: 'speccore analyze',         layer: 'main' },
    { key: 'validate',  cmd: 'speccore validate',        layer: 'main' },
    { key: 'taskify',   cmd: 'speccore iteration taskify', layer: 'main' },
    { key: 'plan',      cmd: 'speccore plan',            layer: 'main' },
    { key: 'execute',   cmd: 'speccore execute',         layer: 'main' },
    { key: 'verify',    cmd: 'speccore verify',          layer: 'main' },
    { key: 'pipeline',  cmd: 'speccore pipeline',        layer: 'main' },
    { key: 'pr',        cmd: 'speccore pr',              layer: 'main' },
    { key: 'done',      cmd: 'speccore done',            layer: 'main' },
    { key: 'spec2doc',  cmd: 'speccore spec2doc',        layer: 'main' },
  ];

  // v8.3.190+: 内置预设流水线（起止点对，覆盖常见业务操作）
  // 默认流水线为 develop（分析→验证，代码完成即止）；pr/done/spec2doc 为独立收尾操作，
  // 需「提交代码/归档/导出」时用 deliver/import/docs preset 或单独跑命令。
  const PRESETS: Record<string, { from: string; to: string; desc: string }> = {
    full:    { from: 'req-doc',  to: 'spec2doc', desc: '全流程：需求→导出（含收尾）' },
    import:  { from: 'doc2spec', to: 'pr',       desc: '导入需求→合并请求' },
    analyze: { from: 'analyze',  to: 'validate', desc: '只分析校验' },
    spec:    { from: 'doc2spec', to: 'taskify',  desc: '导入需求→任务化（生成 Spec，看效果）' },
    develop: { from: 'analyze',  to: 'verify',   desc: '分析→验证（默认，代码+验证完成）' },
    deliver: { from: 'execute',  to: 'pr',       desc: '执行→提交代码' },
    deploy:  { from: 'analyze',  to: 'pipeline', desc: '分析→部署验证' },
    docs:    { from: 'analyze',  to: 'spec2doc', desc: '分析→文档导出' },
  };

  // v8.3.184+: review 闸口（功能开发质量底线）——阶段执行前触发，软停等待宿主 AI 确认
  // A: taskify 前（Spec 定稿）、B: verify 前（代码 review）、C: pipeline 前（部署前确认，永不跳过）
  const GATES: Record<string, { id: string; title: string; hint: string; resumeFrom: string }> = {
    taskify:  { id: 'A', title: 'Spec 定稿',   hint: '请 review 生成的 Spec（功能单元/端覆盖/验收标准），确认后继续', resumeFrom: 'taskify' },
    verify:   { id: 'B', title: '代码 review', hint: '请 review 生成的代码（重点扫 AI 标记的低置信点 / .issues.md / .deviations），确认后继续', resumeFrom: 'verify' },
    pipeline: { id: 'C', title: '部署前确认',  hint: '即将部署到环境（destructive 操作），确认后才执行', resumeFrom: 'pipeline' },
  };

  const iteration = await getDefaultIteration(options.iteration);
  if (!iteration) {
    logger.info('🤖 Auto-pipeline: 未找到迭代，先初始化...');
    execSync('speccore init', { stdio: 'inherit' });
    return;
  }

  const iterDir = `Iteration-${iteration}`;
  logger.info(`\n🤖 Auto-pipeline: ${iteration}\n`);

  // v8.3.190+: 读取 optional_steps（off 跳过）+ pipelines（命名流水线）配置
  let optionalSteps: Record<string, 'auto' | 'on' | 'off'> = {};
  let pipelinesConfig: { default?: string; custom?: Record<string, string> } = {};
  try {
    const { config } = await loadConfigWithMeta();
    optionalSteps = (config.settings.optional_steps || {}) as Record<string, 'auto' | 'on' | 'off'>;
    pipelinesConfig = (config.settings.pipelines || {}) as { default?: string; custom?: Record<string, string> };
  } catch { /* 配置读取失败用默认 */ }

  // v7.4.0+: Pipeline 阶段结果追踪
  interface PhaseResult {
    key: string;
    status: 'success' | 'skipped' | 'failed' | 'warning';
    message: string;
    questions: string[];
    duration: number;
  }
  const phaseResults: PhaseResult[] = [];
  const pipelineStart = Date.now();

  // ── 解析流水线范围（优先级：--auto-steps > --from/--to > --preset/默认 > full）──
  let startIdx = 0;
  let endIdx = PIPELINE_PHASES.length - 1;

  // 1. 解析预设/自定义流水线（--preset > 配置 default > 内置 full）
  const presetName = options.preset || pipelinesConfig.default || 'full';
  let presetFrom: string | undefined;
  let presetTo: string | undefined;
  if (PRESETS[presetName]) {
    presetFrom = PRESETS[presetName].from;
    presetTo = PRESETS[presetName].to;
    if (options.preset) logger.info(`🎯 预设流水线 [${presetName}]: ${presetFrom} → ${presetTo}（${PRESETS[presetName].desc}）\n`);
  } else if (pipelinesConfig.custom?.[presetName]) {
    const steps = pipelinesConfig.custom![presetName].split(',').map(s => s.trim()).filter(Boolean);
    if (steps.length > 0) {
      presetFrom = steps[0];
      presetTo = steps[steps.length - 1];
      logger.info(`🎯 自定义流水线 [${presetName}]: ${presetFrom} → ${presetTo}\n`);
    }
  } else if (presetName !== 'full') {
    logger.warn(`⚠️ 未知流水线 "${presetName}"，回退到 full`);
    presetFrom = PRESETS.full.from;
    presetTo = PRESETS.full.to;
  }

  // 2. 应用 preset 起止点（--from/--to 会覆盖）
  if (presetFrom) {
    const fi = PIPELINE_PHASES.findIndex(p => p.key === presetFrom);
    if (fi >= 0) startIdx = fi;
  }
  if (presetTo) {
    const ti = PIPELINE_PHASES.findIndex(p => p.key === presetTo);
    if (ti >= 0) endIdx = ti;
  }

  // 3. --from/--to 显式覆盖
  if (options.from) {
    const fi = PIPELINE_PHASES.findIndex(p => p.key === options.from);
    if (fi >= 0) startIdx = fi;
    else { logger.error(`未知阶段: ${options.from}`); return; }
  }
  if (options.to) {
    const ti = PIPELINE_PHASES.findIndex(p => p.key === options.to);
    if (ti >= 0) endIdx = ti;
    else { logger.error(`未知阶段: ${options.to}`); return; }
  }

  // 4. --auto-steps 最高优先级（指定连续步骤）
  if (options.autoSteps) {
    const stepKeys = options.autoSteps.split(',').map(s => s.trim());
    const indices = stepKeys.map(k => PIPELINE_PHASES.findIndex(p => p.key === k));
    if (indices.some(i => i < 0)) {
      const unknown = stepKeys.filter(k => !PIPELINE_PHASES.find(p => p.key === k));
      logger.error(`未知阶段: ${unknown.join(', ')}`);
      logger.info(`可用: ${PIPELINE_PHASES.map(p => p.key).join(', ')}`);
      return;
    }
    // 验证连续性
    const sorted = [...indices].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) {
        logger.error(`auto-steps 必须连续！${stepKeys.join(',')} 在流水线中不连续`);
        logger.info(`流水线顺序: ${PIPELINE_PHASES.map(p => p.key).join(' → ')}`);
        return;
      }
    }
    startIdx = sorted[0];
    endIdx = sorted[sorted.length - 1];
    logger.info(`🎯 自动步骤: ${stepKeys.join(' → ')}\n`);
  }

  // ── 逐步执行 ──
  let pausedGate: string | null = null;
  let prevLayer = '';
  for (let i = startIdx; i <= endIdx; i++) {
    const phase = PIPELINE_PHASES[i];

    // v8.3.189+: 分层展示（准备层 / 主流程）
    if (phase.layer && phase.layer !== prevLayer) {
      prevLayer = phase.layer;
      logger.info(phase.layer === 'prepare'
        ? '\n────────── 🏗️ 准备层（初始化 + 需求入口）──────────'
        : '\n────────── 🚀 主流程（分析→拆分→执行→验证→部署→归档→导出）──────────');
    }

    // v8.3.184+: review 闸口软停（功能开发质量底线）
    const gate = GATES[phase.key];
    if (gate) {
      const skipGate = options.demo && gate.id !== 'C';  // demo 跳过 A/B，C 永不跳过
      if (!skipGate) {
        logger.warn(`\n🛑 [SPECCORE_GATE_${gate.id}] ${gate.title}`);
        logger.warn(`   ${gate.hint}`);
        logger.warn(`   确认后继续: speccore run --auto --from ${gate.resumeFrom} -I ${iteration}\n`);
        pausedGate = gate.id;
        break;  // 软停，等宿主 AI 确认后 --from 继续
      }
    }

    logger.info(`━━━ [${i - startIdx + 1}/${endIdx - startIdx + 1}] ${phase.key} ━━━`);
    const phaseStart = Date.now();
    let phaseStatus: PhaseResult['status'] = 'success';
    let phaseMessage = '完成';
    let phaseQuestions: string[] = [];

    try {
      switch (phase.key) {
      case 'req-doc': {
        // v8.3.184+: 一句话需求 → PRD（口语化需求入口，与 doc2spec 二选一）
        const reqDoc = join(iterDir, '010-requirements', 'REQUIREMENT.md');
        const hasFeatures = await hasFeatureDirs(iterDir);
        if ((await pathExists(reqDoc)) || hasFeatures) {
          logger.info('  ✅ 需求已存在，跳过 req-doc');
        } else if (options.demand) {
          execSync(`speccore req-doc "${options.demand}" --to ${iteration}`, { stdio: 'inherit' });
        } else {
          logger.info('  ℹ️ 未提供一句话需求，跳过 req-doc（走 doc2spec 导入文档）');
        }
        break;
      }
      case 'doc2spec': {
        const reqDoc = join(iterDir, '010-requirements', 'REQUIREMENT.md');
        const hasFeatures = await hasFeatureDirs(iterDir);
        if (!(await pathExists(reqDoc)) && !hasFeatures) {
          logger.info('  ℹ️ 未找到需求文档，跳过（请手动 doc2spec）');
        } else {
          // 检查需求文档是否有实质内容（不是空文件）
          let hasContent = false;
          try {
            const { readFile: rf } = require('fs-extra');
            const content = await rf(reqDoc, 'utf-8');
            hasContent = content.replace(/^#+\s.*$/gm, '').replace(/\s/g, '').length > 50;
          } catch {}
          if (hasContent) {
            logger.info('  ✅ 需求已导入且有实质内容，跳过');
          } else {
            logger.info('  ⚠️ 需求文档存在但内容为空，请手动 doc2spec 导入');
          }
        }
        break;
      }
      case 'split-units': {
        // v8.3.191+: 切分功能单元（结构化，独立于澄清）
        // 已切分（features/ 非空）则跳过；否则对 converted/ 和 REQUIREMENT.md 文档切分
        const featuresDir = join(iterDir, '010-requirements', 'features');
        let hasFeatures = false;
        try {
          const entries = await readdir(featuresDir, { withFileTypes: true });
          hasFeatures = entries.some((e: any) => e.isDirectory() && !e.name.startsWith('.'));
        } catch {}
        if (hasFeatures) {
          logger.info('  ✅ 功能单元已切分，跳过');
          phaseStatus = 'skipped';
          phaseMessage = '功能单元已切分';
          break;
        }
        // 收集待切分的需求文档（converted/ + REQUIREMENT.md）
        const docsToSplit: string[] = [];
        const convDir = join(iterDir, '010-requirements', 'converted');
        if (await pathExists(convDir)) {
          const files = await readdir(convDir);
          for (const f of files.filter((f: string) => f.endsWith('.md'))) docsToSplit.push(join(convDir, f));
        }
        const reqRoot = join(iterDir, '010-requirements', 'REQUIREMENT.md');
        if (await pathExists(reqRoot)) docsToSplit.push(reqRoot);
        if (docsToSplit.length === 0) {
          logger.info('  ℹ️ 无需求文档可切分，跳过');
          phaseStatus = 'skipped';
          phaseMessage = '无需求文档可切分';
          break;
        }
        const { splitDocumentToUnits } = await import('./doc2spec');
        let written = 0;
        for (const doc of docsToSplit) {
          try {
            await splitDocumentToUnits(iterDir, doc, '', basename(doc));
            written++;
          } catch (e: any) {
            logger.warn(`  ⚠️ 切分失败: ${basename(doc)} — ${e?.message || e}`);
          }
        }
        logger.info(`  🔪 切分功能单元完成: ${written}/${docsToSplit.length} 个文档`);
        break;
      }
      case 'analyze': {
        const analysis = join(iterDir, '020-specs', 'ANALYSIS.md');
        const techSpec = join(iterDir, '020-specs', 'ANALYSIS.md');
        let needsAnalysis = !(await pathExists(analysis));
        let needsSpecs = false;
        if (!needsAnalysis) {
          try {
            const { readFile: rf } = require('fs-extra');
            const techContent = await rf(techSpec, 'utf-8');
            const meaningful = techContent.replace(/_待填充_|_待补充_|\|\s*\|/g, '').replace(/\s/g, '');
            needsSpecs = meaningful.length < 50;
          } catch { needsSpecs = true; }
        }
        if (needsAnalysis || needsSpecs) {
          execSync(`speccore analyze --auto -I ${iteration}`, { stdio: 'inherit' });
        } else {
          logger.info('  ✅ 分析已完成，跳过');
          phaseStatus = 'skipped';
          phaseMessage = '分析已完成，跳过';
        }
        // v7.4.0+: CLARIFY_REPORT 质量检查
        const clarifyPath = join(iterDir, '010-requirements', 'CLARIFY_REPORT.md');
        if (await pathExists(clarifyPath)) {
          try {
            const clarifyContent = await readFile(clarifyPath, 'utf-8');
            const lowScoreMatch = clarifyContent.match(/总分[：:]\s*(\d+)/);
            if (lowScoreMatch) {
              const score = parseInt(lowScoreMatch[1]);
              if (score < 60) {
                logger.warn(`  ⚠️ CLARIFY_REPORT 质量评分偏低: ${score}/100`);
                logger.warn(`     建议重新澄清需求或手动补充后再继续`);
                phaseStatus = 'warning';
                phaseMessage = `CLARIFY_REPORT 质量评分 ${score}/100，建议重新澄清`;
                phaseQuestions.push(`需求澄清质量评分 ${score}/100，低于 60 分基线`);
              }
            }
          } catch {}
        }
        break;
      }
      case 'validate': {
        // v8.3.184+: Spec 质量门禁（analyze 后校验完整性/一致性，不通过不进入 split）
        const analysis = join(iterDir, '020-specs', 'ANALYSIS.md');
        if (await pathExists(analysis)) {
          execSync(`speccore validate --iteration=${iteration}`, { stdio: 'inherit' });
        } else {
          logger.info('  ⏭️ 无 Spec 可校验，跳过 validate');
        }
        break;
      }
      case 'taskify': {
        let hasTasks = false;
        try {
          const entries = await readdir(join(iterDir, '030-tasks'), { withFileTypes: true });
          hasTasks = entries.some((e: any) => e.isDirectory() && e.name.startsWith('Task-'));
        } catch {}
        if (!hasTasks) {
          execSync(`speccore iteration taskify -i ${iteration} --force`, { stdio: 'inherit' });
        } else {
          logger.info('  ✅ 任务已拆分，跳过');
        }
        break;
      }
      case 'plan': {
        // v8.3.190+: 单任务跳过 plan（无需调度计划，直接 execute）；多任务才列计划
        let taskCount = 0;
        try {
          const { readdir: rd3 } = require('fs-extra');
          const tasksDir = join(iterDir, '030-tasks');
          if (await pathExists(tasksDir)) {
            const entries = await rd3(tasksDir, { withFileTypes: true });
            taskCount = entries.filter((e: any) => e.isDirectory() && e.name.startsWith('Task-')).length;
          }
        } catch {}
        if (taskCount <= 1) {
          logger.info(`  ⏭️ 仅 ${taskCount} 个任务，跳过 plan（单任务无需调度计划）`);
          phaseStatus = 'skipped';
          phaseMessage = '单任务跳过 plan';
          break;
        }
        // v6.91.1+: 检查是否已有计划，避免重复生成
        const plansDir = join(iterDir, '000-overview', 'plans');
        let hasPlan = false;
        try {
          const { readdir: rd2, pathExists: pe2 } = require('fs-extra');
          if (await pe2(plansDir)) {
            const entries = await rd2(plansDir);
            hasPlan = entries.some((e: string) => e.endsWith('.md'));
          }
        } catch {}
        if (hasPlan) {
          logger.info('  ✅ 执行计划已存在，跳过');
        } else {
          execSync(`speccore plan -i ${iteration} --force`, { stdio: 'inherit' });
        }
        break;
      }
      case 'execute': {
        // v6.91.1+: 检查是否还有 pending 任务
        let hasPending = false;
        try {
          const { scanTasks } = await import('../core/state');
          const tasks = await scanTasks(iteration);
          hasPending = tasks.some(t => t.status === 'pending');
        } catch {}
        if (!hasPending) {
          logger.info('  ✅ 所有任务已完成，跳过 execute');
        } else {
          execSync(`speccore execute --auto -i ${iteration}`, { stdio: 'inherit' });
        }
        break;
      }
      case 'verify': {
        if (optionalSteps['verify'] === 'off') {
          logger.info('  ⏭️ 已配置跳过（optional_steps.verify = off）');
          phaseStatus = 'skipped';
          phaseMessage = '已配置跳过';
          break;
        }
        // v8.3.184+: 验证（execute 后，编译+Lint+测试+ui 截图，只报告不阻断）
        let hasPendingV = false;
        try {
          const { scanTasks } = await import('../core/state');
          const tasks = await scanTasks(iteration);
          hasPendingV = tasks.some(t => t.status === 'pending');
        } catch {}
        if (hasPendingV) {
          logger.info('  ⏭️ 还有 pending 任务，跳过 verify');
        } else {
          execSync(`speccore verify`, { stdio: 'inherit' });
        }
        break;
      }
      case 'pipeline': {
        if (optionalSteps['pipeline'] === 'off') {
          logger.info('  ⏭️ 已配置跳过（optional_steps.pipeline = off）');
          phaseStatus = 'skipped';
          phaseMessage = '已配置跳过';
          break;
        }
        // v8.3.184+: 部署（闸口 C 在阶段前已软停，确认后才到这）
        execSync(`speccore pipeline --all`, { stdio: 'inherit' });
        break;
      }
      case 'pr': {
        if (optionalSteps['pr'] === 'off') {
          logger.info('  ⏭️ 已配置跳过（optional_steps.pr = off）');
          phaseStatus = 'skipped';
          phaseMessage = '已配置跳过';
          break;
        }
        // v6.91.1+: 检查是否有未提交的代码变更
        let hasChanges = false;
        try {
          const { execSync: es2 } = await import('child_process');
          const gitStatus = es2('git status --short', { encoding: 'utf-8', cwd: process.cwd() });
          hasChanges = gitStatus.trim().length > 0;
        } catch {}
        if (!hasChanges) {
          logger.info('  ✅ 没有未提交的变更，跳过 pr');
        } else {
          execSync(`speccore pr -i ${iteration} --force`, { stdio: 'inherit' });
        }
        break;
      }
      case 'done': {
        if (optionalSteps['done'] === 'off') {
          logger.info('  ⏭️ 已配置跳过（optional_steps.done = off）');
          phaseStatus = 'skipped';
          phaseMessage = '已配置跳过';
          break;
        }
        // v6.91.1+: 检查是否已归档
        const retroPath = join(iterDir, '000-overview', 'RETRO.md');
        if (await pathExists(retroPath)) {
          logger.info('  ✅ 已生成复盘报告，跳过 done');
        } else {
          execSync(`speccore done --all -i ${iteration}`, { stdio: 'inherit' });
        }
        break;
      }
      case 'spec2doc': {
        if (optionalSteps['spec2doc'] === 'off') {
          logger.info('  ⏭️ 已配置跳过（optional_steps.spec2doc = off）');
          phaseStatus = 'skipped';
          phaseMessage = '已配置跳过';
          break;
        }
        execSync(`speccore spec2doc -i ${iteration}`, { stdio: 'inherit' });
        break;
      }
      } // end switch
    } catch (err: any) {
      phaseStatus = 'failed';
      phaseMessage = err?.message?.slice(0, 100) || '执行失败';
      logger.error(`  ❌ ${phase.key} 失败: ${phaseMessage}`);
    }

    // v7.4.0+: 每个阶段执行后收集疑问
    try {
      const qFiles = await collectQuestionFiles();
      for (const qf of qFiles) {
        if (qf.includes(`-${phase.key}-`)) {
          phaseQuestions.push(qf.split('/').pop() || qf);
        }
      }
    } catch {}

    phaseResults.push({
      key: phase.key,
      status: phaseStatus,
      message: phaseMessage,
      questions: phaseQuestions,
      duration: Math.round((Date.now() - phaseStart) / 1000),
    });

    // v8.3.187+: 阶段交接摘要（generateHandoff）——关键阶段成功后生成精简传递摘要，
    // 完整产物存文件、传递摘要只给下一阶段 AI 看，控制跨阶段上下文大小。
    // 13 阶段流水线 → 6 阶段 handoff 映射：verify 对应 review 闸口。
    if (phaseStatus === 'success') {
      const handoffMap: Record<string, [HandoffStage, HandoffStage]> = {
        analyze: ['analyze', 'taskify'],
        taskify: ['taskify', 'plan'],
        plan: ['plan', 'execute'],
        execute: ['execute', 'review'],
        verify: ['review', 'done'],
      };
      const handoff = handoffMap[phase.key];
      if (handoff) {
        try {
          const handoffPath = await generateHandoff(handoff[0], handoff[1], iteration);
          logger.info(`  📋 阶段交接摘要: ${handoffPath}`);
        } catch (err: any) {
          logger.debug(`  交接摘要生成跳过: ${err.message}`);
        }
      }
    }

    logger.info('');
  }

  // v7.4.0+: 生成 Pipeline 总结报告
  const totalDuration = Math.round((Date.now() - pipelineStart) / 1000);
  const reportDir = join(iterDir, '000-overview');
  await ensureDir(reportDir);
  const reportPath = join(reportDir, 'PIPELINE_REPORT.md');
  const now = new Date().toLocaleString('zh-CN');

  let report = `# Pipeline 执行报告\n\n`;
  report += `> 迭代: ${iteration} | 执行时间: ${now} | 总耗时: ${totalDuration}s\n`;
  report += `> 执行范围: ${PIPELINE_PHASES.slice(startIdx, endIdx + 1).map(p => p.key).join(' → ')}\n\n`;
  report += `## 阶段执行结果\n\n`;
  report += `| 阶段 | 状态 | 耗时 | 说明 |\n`;
  report += `| :--- | :--- | :--- | :--- |\n`;
  for (const pr of phaseResults) {
    const icon = pr.status === 'success' ? '✅' : pr.status === 'skipped' ? '⏭️' : pr.status === 'warning' ? '⚠️' : '❌';
    report += `| ${pr.key} | ${icon} ${pr.status} | ${pr.duration}s | ${pr.message} |\n`;
  }

  // 汇总所有疑问
  const allQuestions = phaseResults.filter(pr => pr.questions.length > 0);
  if (allQuestions.length > 0) {
    report += `\n## 疑问清单\n\n`;
    for (const pr of allQuestions) {
      report += `### ${pr.key} 阶段\n\n`;
      for (const q of pr.questions) {
        report += `- ${q}\n`;
      }
    }
  }

  // 失败项汇总
  const failedPhases = phaseResults.filter(pr => pr.status === 'failed');
  if (failedPhases.length > 0) {
    report += `\n## 失败项需要处理\n\n`;
    for (const fp of failedPhases) {
      report += `- **${fp.key}**: ${fp.message}\n`;
    }
  }

  report += `\n---\n> 报告自动生成 by speccore run auto-pipeline\n`;
  await writeFile(reportPath, report, 'utf-8');
  if (pausedGate) {
    logger.warn(`\n🛑 Pipeline 已暂停在闸口 ${pausedGate}（完成至 ${phaseResults.map(p => p.key).join(' → ')}）`);
    logger.warn(`   确认后继续: speccore run --auto --from ${GATES[Object.keys(GATES).find(k => GATES[k].id === pausedGate)!].resumeFrom} -I ${iteration}\n`);
  } else {
    logger.success(`\n✅ Pipeline 完成: ${PIPELINE_PHASES.slice(startIdx, endIdx + 1).map(p => p.key).join(' → ')}`);
  }
  logger.info(`📊 执行报告 → ${reportPath}\n`);
}
