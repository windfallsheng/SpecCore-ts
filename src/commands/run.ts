/**
 * run — 端到端流水线执行入口
 * 唯一执行入口：13 阶段全自动流水线（--auto 默认，--from/--to 指定起止，--demo 放宽闸口 A/B）
 */
import { pathExists, readdir, writeFile, ensureDir, readFile } from 'fs-extra';
import { join, basename } from 'path';
import { execSync } from 'child_process';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, getIterationDir } from '../core/context';
import { collectQuestionFiles } from '../core/questions';
import { generateHandoff, type HandoffStage } from '../core/handoff-generator';
import { loadConfigWithMeta } from '../core/unified-config';
import { parseRunRange, resolveStageToken } from '../core/stage-aliases';

export interface RunOptions {
  iteration?: string; force?: boolean; auto?: boolean; autoSteps?: string;
  from?: string; to?: string;
  demo?: boolean;       // v8.3.184+: --demo 演示模式（放宽闸口 A/B，保留 C）
  demand?: string;      // v8.3.184+: 一句话需求描述（req-doc 阶段入口）
  preset?: string;      // v8.3.190+: --preset 预设/自定义流水线名
  gate?: 'manual' | 'auto'; // v8.3.195+: --gate 闸口模式（manual=都停 / auto=跳过A/B，C永不跳过）
  env?: string;         // v8.3.196+: --env 部署环境（透传给 pipeline 阶段）
  smoke?: 'on' | 'off'; // v8.3.217+: --smoke / --skip-smoke 单次强制/跳过冒烟
  scope?: 'full' | 'module'; // v8.3.217+: --scope 单次指定冒烟范围
  noDepCheck?: boolean;  // v8.3.223+: --no-dep-check 跳过阶段前置依赖检查（逃生舱）
  demandExplicit?: boolean; // v8.3.290+: --demand 显式指定（跳过 preset/范围文法解析，防保留字误判）
}

async function hasFeatureDirs(iterDir: string): Promise<boolean> {
  try {
    const featuresDir = join(iterDir, '010-requirements', 'features');
    const entries = await readdir(featuresDir, { withFileTypes: true });
    return entries.some(e => e.isDirectory() && !e.name.startsWith('.'));
  } catch { return false; }
}

/**
 * v8.3.223+（v8.3.290 提升为模块级，供智能续跑检测复用）:
 * 检测需求文档是否已导入（converted/、sources/ 下的文档或 REQUIREMENT.md 有实质内容）
 */
async function hasRequirementDocs(iterDir: string): Promise<boolean> {
  const reqDir = join(iterDir, '010-requirements');
  const reqMd = join(reqDir, 'REQUIREMENT.md');
  if (await pathExists(reqMd)) {
    try {
      const content = await readFile(reqMd, 'utf-8');
      if (content.replace(/\s/g, '').length > 100) return true;
    } catch { /* ignore */ }
  }
  for (const d of ['converted', 'sources']) {
    const dir = join(reqDir, d);
    if (await pathExists(dir)) {
      const entries = await readdir(dir).catch(() => []);
      // v8.3.262: readdir 未传 withFileTypes 时返回字符串数组，直接 test 文件名
      if (entries.some((e: any) => /\.(md|docx|doc|pdf)$/i.test(e))) return true;
    }
  }
  return false;
}

// ── v8.3.290: 智能续跑（无参 run 快捷操作）──
interface CheckpointItem {
  key: string;
  label: string;
  done: boolean;
  partial?: boolean;   // 半途状态（如骨架半填、任务执行中）——断点仍落在此阶段
  evidence?: string;   // 已完成/半途的产物佐证，未做阶段留空
}

/**
 * v8.3.290+: 里程碑检测——按产物判定各阶段完成态，定位「第一个未完成阶段」。
 * 谓词全部复用 PRECONDITIONS / analyze 已有的检测函数（hasRequirementDocs /
 * hasFeatureDirs / detectEmptySkeletonDocs / scanTasks），不新造判定逻辑。
 * 默认终点 pipeline（部署验证）；pr/done/spec2doc 为收尾阶段，不参与断点定位。
 */
async function detectPipelineCheckpoint(iterDir: string, iteration: string): Promise<{
  items: CheckpointItem[];
  checkpointKey: string | null;
  hasRequirement: boolean;
  fresh: boolean;
  allDone: boolean;
}> {
  const specDir = join(iterDir, '020-specs');
  const overviewDir = join(iterDir, '000-overview');
  const hasReq = await hasRequirementDocs(iterDir);
  const hasFeatures = await hasFeatureDirs(iterDir);

  // analyze 完成：020-specs 存在、无 SKELETON 残留；半途：有骨架残留（续跑继续填充）
  let specsReady = false;
  let skeletons: string[] = [];
  if (await pathExists(specDir)) {
    skeletons = await detectEmptySkeletonDocs(iterDir);
    specsReady = skeletons.length === 0 && (await readdir(specDir)).length > 0;
  }

  // execute 完成：全部任务 status === 'completed'；半途：部分完成（execute --resume 续跑）
  let tasks: { status: string }[] = [];
  try {
    const { scanTasks } = await import('../core/state');
    tasks = await scanTasks(iteration);
  } catch { /* ignore */ }
  const doneCount = tasks.filter(t => t.status === 'completed').length;
  const allTasksDone = tasks.length > 0 && doneCount === tasks.length;

  // plan 完成：000-overview/plans/ 下任意 PLAN.md（planId 子目录，需递归）
  let planExists = false;
  try {
    const plansDir = join(overviewDir, 'plans');
    if (await pathExists(plansDir)) {
      const walk = async (d: string): Promise<boolean> => {
        for (const e of await readdir(d, { withFileTypes: true })) {
          const full = join(d, e.name);
          if (e.isDirectory() && await walk(full)) return true;
          if (e.isFile() && e.name === 'PLAN.md') return true;
        }
        return false;
      };
      planExists = await walk(plansDir);
    }
  } catch { /* ignore */ }

  const items: CheckpointItem[] = [
    { key: 'doc2spec',    label: '需求导入',     done: hasReq,      evidence: hasReq ? '需求文档已就绪' : undefined },
    { key: 'split-units', label: '切分功能单元', done: hasFeatures, evidence: hasFeatures ? 'features/ 已有单元目录' : undefined },
    { key: 'analyze',     label: '需求分析',     done: specsReady,  partial: !specsReady && skeletons.length > 0, evidence: skeletons.length > 0 ? `骨架残留 ${skeletons.length} 个待填充` : (specsReady ? '020-specs 已生成' : undefined) },
    { key: 'validate',    label: '质量审计',     done: await pathExists(join(specDir, 'QUALITY_AUDIT.md')), evidence: undefined },
    { key: 'taskify',     label: '任务拆分',     done: tasks.length > 0, evidence: tasks.length > 0 ? `${tasks.length} 个任务` : undefined },
    { key: 'plan',        label: '执行计划',     done: planExists,  evidence: planExists ? 'PLAN.md 已生成' : undefined },
    { key: 'execute',     label: '执行开发',     done: allTasksDone, partial: tasks.length > 0 && !allTasksDone, evidence: allTasksDone ? `${tasks.length} 个任务全部完成` : (tasks.length > 0 ? `${doneCount}/${tasks.length} 个任务完成` : undefined) },
    { key: 'verify',      label: '验证',         done: await pathExists(join(overviewDir, 'VERIFY_REPORT.md')), evidence: undefined },
    { key: 'pipeline',    label: '部署验证',     done: await pathExists(join(overviewDir, 'PIPELINE_REPORT.md')), evidence: undefined },
  ];
  // 断点 = 第一个未完成阶段；全部 done → allDone（跑完至部署验证）
  const checkpointItem = items.find(i => !i.done);
  return {
    items,
    checkpointKey: checkpointItem?.key ?? null,
    hasRequirement: hasReq,
    // 全新：除需求外无任何阶段产物（无单元目录/无 specs/无任务）；
    // 无需求时由调用方先走「需求入口」面板，不在此判定
    fresh: !hasFeatures && !(await pathExists(specDir)) && tasks.length === 0,
    allDone: !checkpointItem,
  };
}

/**
 * v8.3.202+: 检测 020-specs 下仍为骨架状态（<!-- SPEC-SKELETON -->）的文档。
 * 空模板会一路传到 taskify/execute，导致 AI 拿空需求瞎编代码，必须硬停。
 */

// v8.3.266: 流水线子命令统一执行器——子命令输出 [SPECCORE_PROMPT]/[SPECCORE_STEP_DONE]
// 后 exit 10 表示「内容需宿主 AI 响应落盘」，此时应明确交接并停止流水线，
// 而非让 execSync 抛未捕获异常崩溃（此前 6 处调用全裸奔，Prompt 打了没人接）。
// 返回 'handoff' 时调用方必须 return 停止流水线。
function runPhaseCommand(cmd: string, phase: string, iteration: string, extraEnv?: Record<string, string>): 'ok' | 'handoff' {
  try {
    execSync(cmd, { stdio: 'inherit', ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}) });
    return 'ok';
  } catch (e: any) {
    if (e && (e.status === 10 || e.code === 10 || e.exitCode === 10)) {
      logger.warn(`  🤖 [${phase}] 已输出 AI Prompt（exit 10）——需要宿主 AI 响应上方输出落盘`);
      logger.warn(`     落盘完成后继续: speccore run --from ${phase} -i ${iteration}`);
      return 'handoff';
    }
    throw e;
  }
}

async function detectEmptySkeletonDocs(iterDir: string): Promise<string[]> {
  const specDir = join(iterDir, '020-specs');
  if (!await pathExists(specDir)) return [];
  const skeletons: string[] = [];
  const check = async (dir: string, prefix = '') => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      const full = join(dir, e.name);
      if (e.isDirectory()) { await check(full, rel); }
      else if (e.name.endsWith('.md')) {
        try {
          const content = await readFile(full, 'utf-8');
          if (content.includes('<!-- SPEC-SKELETON -->')) skeletons.push(rel);
        } catch { /* ignore */ }
      }
    }
  };
  await check(specDir);
  return skeletons;
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
    { key: 'split-units', cmd: 'speccore unitize', layer: 'prepare' },
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
  // A: taskify 前（Spec 定稿）、B: verify 前（代码 review）、C: pipeline 前（部署前确认）
  // v8.3.195+: 三闸口统一由 gates.mode 控制（manual=都停 / auto=都跳过，含 C）
  const GATES: Record<string, { id: string; title: string; hint: string; resumeFrom: string }> = {
    taskify:  { id: 'A', title: 'Spec 定稿',   hint: '请 review 生成的 Spec（功能单元/端覆盖/验收标准），确认后继续', resumeFrom: 'taskify' },
    verify:   { id: 'B', title: '代码 review', hint: '请 review 生成的代码（重点扫 AI 标记的低置信点 / .issues.md / .deviations），确认后继续', resumeFrom: 'verify' },
    pipeline: { id: 'C', title: '部署前确认',  hint: '即将部署到环境（destructive 操作），确认后才执行', resumeFrom: 'pipeline' },
  };

  // v8.3.262: 迭代名归一化——context.json 的 currentIteration 可能带 Iteration- 前缀
  // （历史版本写入），不归一化会拼出 Iteration-Iteration-xxx 双前缀，导致前置依赖误判
  const rawIteration = (await getDefaultIteration(options.iteration)).replace(/^Iteration-/, '');
  if (!rawIteration) {
    logger.info('🤖 Auto-pipeline: 未找到迭代，先初始化...');
    execSync('speccore init', { stdio: 'inherit' });
    return;
  }

  // v8.3.388: 目录名模糊解析（BUG-11）——此前直接拼 `Iteration-${iteration}`，短名
  // （无序号前缀，如 ding-dan-guan-li-xi-tong）拼出不存在目录，基于 iterDir 的前置
  // 依赖检查读空路径全部失败，报「阶段前置依赖未满足」且 remedy 仍让用户用短名重试，
  // 自相矛盾。统一走 getIterationDir（精确/后缀匹配，找不到时回退拼接，向后兼容）
  const iterDir = await getIterationDir(rawIteration);
  const iteration = basename(iterDir).replace(/^Iteration-/, '');
  logger.info(`\n🤖 Auto-pipeline: ${iteration}\n`);

  // v8.3.223+: 阶段前置依赖表——上游依赖未满足时阻断流水线，防止下游空跑产出垃圾产物。
  // 历史教训：`--from taskify` 跳过 split-units 后，features/ 为空仍按需求文档粒度拆分，
  // AI 把骨架「📋 质量标准」标题当功能单元，产出 Task-NNN-requirement-md 垃圾任务。
  // hard=true 缺失时硬阻断（🛑 + 补救命令）；hard=false 缺失时警告继续。--no-dep-check 可全部跳过。
  const PRECONDITIONS: Record<string, {
    desc: string; impact: string; remedy: string; bypassNote: string; hard: boolean;
    check: () => Promise<boolean>;
  }> = {
    'split-units': {
      desc: '存在可切分的需求文档（converted/、sources/ 或 REQUIREMENT.md 有实质内容）',
      impact: '无需求文档则切分功能单元无从谈起，下游 analyze 拿不到输入',
      remedy: `先导入需求: speccore doc2spec --iter ${iteration}（或 speccore run --from doc2spec -i ${iteration}）`,
      bypassNote: '需求已由手动方式准备',
      hard: true,
      check: () => hasRequirementDocs(iterDir),
    },
    analyze: {
      desc: '存在需求文档（converted/、sources/ 或 REQUIREMENT.md 有实质内容）',
      impact: '无需求文档 analyze 无输入，会产出空 Spec 骨架',
      remedy: `先导入需求: speccore doc2spec --iter ${iteration}`,
      bypassNote: '需求已由手动方式准备',
      hard: true,
      check: () => hasRequirementDocs(iterDir),
    },
    taskify: {
      desc: '功能单元已切分（010-requirements/features/ 下存在功能单元目录）',
      impact: '未切分将按需求文档粒度拆分，任务粒度过粗；AI 易把骨架引导标题（质量标准/写作要求）误当功能单元，产出垃圾任务',
      remedy: `先切分功能单元: speccore unitize --files "..." -i ${iteration}（或 speccore run --from split-units -i ${iteration}）`,
      bypassNote: '确认按需求文档粒度拆分（小型项目）',
      hard: true,
      check: async () => await hasFeatureDirs(iterDir),
    },
    plan: {
      desc: '开发任务已拆分（030-tasks 下存在真实任务）',
      impact: '无任务无法生成执行计划，后续 execute 空转假成功',
      remedy: `先拆分任务: speccore iteration taskify -i ${iteration} --force（或 speccore run --from taskify -i ${iteration}）`,
      bypassNote: '任务目录由手动创建',
      hard: true,
      check: async () => {
        try {
          const { scanTasks } = await import('../core/state');
          return (await scanTasks(iteration)).length > 0;
        } catch { return false; }
      },
    },
    execute: {
      desc: '开发任务已拆分（030-tasks 下存在真实任务）',
      impact: '无任务 execute 0 秒空转假成功，用户误以为代码已开发',
      remedy: `先拆分任务: speccore iteration taskify -i ${iteration} --force（或 speccore run --from taskify -i ${iteration}）`,
      bypassNote: '任务目录由手动创建',
      hard: true,
      check: async () => {
        try {
          const { scanTasks } = await import('../core/state');
          return (await scanTasks(iteration)).length > 0;
        } catch { return false; }
      },
    },
    verify: {
      desc: '存在已完成的开发任务（代码已生成）',
      impact: '无任务产物 verify 没有验证对象',
      remedy: `先执行开发: speccore run --from execute -i ${iteration}`,
      bypassNote: '跳过验证',
      hard: false,
      check: async () => {
        try {
          const { scanTasks } = await import('../core/state');
          const tasks = await scanTasks(iteration);
          return tasks.length > 0 && tasks.some(t => t.status === 'completed');
        } catch { return false; }
      },
    },
  };

  // v8.3.190+: 读取 optional_steps（off 跳过）+ pipelines（命名流水线）配置
  let optionalSteps: Record<string, 'auto' | 'on' | 'off'> = {};
  let pipelinesConfig: { default?: string; custom?: Record<string, string> } = {};
  // v8.3.217+: 冒烟测试统一配置（三时机开关 + 范围 + 按环境差异化）
  let smokeCfg: { points?: Record<string, 'auto' | 'on' | 'off'>; scope?: 'full' | 'module'; scope_by_env?: Record<string, 'full' | 'module'> } = {};
  // v8.3.195+: 闸口模式（命令 flag > 配置 > 默认 manual）
  let gateMode: 'manual' | 'auto' = 'manual';
  try {
    const { config } = await loadConfigWithMeta();
    optionalSteps = (config.settings.optional_steps || {}) as Record<string, 'auto' | 'on' | 'off'>;
    pipelinesConfig = (config.settings.pipelines || {}) as { default?: string; custom?: Record<string, string> };
    smokeCfg = (config.settings.smoke || {}) as typeof smokeCfg;
    if (config.settings.gates?.mode === 'auto') gateMode = 'auto';
  } catch { /* 配置读取失败用默认 */ }
  if (options.gate) gateMode = options.gate;  // 命令 flag 最高优先级
  if (options.demo) gateMode = 'auto';        // --demo 兼容：等价于 --gate auto
  // v8.3.386: --auto 切换全自动闸口（BUG-9）——此前 options.auto 逻辑上零消费，
  // `run --auto --from taskify` 仍在闸口 A 软停，与「全自动流水线」文档承诺矛盾；
  // 续跑命令 `speccore run --auto --from <阶段>` 现可无人干预跨闸口级联执行
  if (options.auto) gateMode = 'auto';

  // v8.3.217+: 冒烟范围解析（命令 --scope > 按环境 scope_by_env > 默认 scope）
  const resolveSmokeScope = (env?: string): 'full' | 'module' => {
    if (options.scope) return options.scope;
    if (env && smokeCfg.scope_by_env?.[env]) return smokeCfg.scope_by_env[env];
    return smokeCfg.scope || 'module';
  };

  // v8.3.196+: 自定义流水线步骤参数（custom 里「阶段:参数」语法，如 pipeline:--env=production）
  const stepParams: Record<string, string> = {};

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

  // ── v8.3.290: run 位置参数文法（快捷语法糖，不依赖 ask 引擎）──
  //   run <preset名>      → preset 直呼（单 token 命中内置/自定义流水线名）
  //   run <阶段/别名>      → 单阶段快捷（从该阶段续跑至 pipeline，如 run smoke / run split）
  //   run <from> to <to>  → 范围（自然语言式，首 token 命中阶段/别名才解析）
  //   run <from>..<to>    → 范围（紧凑式）
  //   run <其他多词>       → 一句话需求（req-doc 阶段消费）
  //   run                  → 智能续跑（见下 smartResume 分支）
  //   --demand 显式传入时跳过文法解析（逃生舱：需求文本恰为 preset/阶段保留字）
  if (options.demand && !options.demandExplicit) {
    const demandText = options.demand.trim();
    const presetNames = [...Object.keys(PRESETS), ...Object.keys(pipelinesConfig.custom || {})];
    if (presetNames.includes(demandText)) {
      logger.info(`🎯 位置参数直呼预设流水线 [${demandText}]\n`);
      options.preset = demandText;
      options.demand = undefined;
    } else {
      // 单 token 命中规范阶段/别名 → 单阶段快捷（从该阶段续跑至部署验证）
      // preset 优先（docs 既是 preset 又是别名，直呼 preset 更符合直觉）
      const singleStage = resolveStageToken(demandText);
      if (singleStage) {
        logger.info(`🎯 单阶段快捷: ${singleStage} → pipeline\n`);
        options.from = singleStage;
        options.to = 'pipeline';
        options.demand = undefined;
      } else {
        const { range, error } = parseRunRange(demandText);
        if (error) {
          // 首 token 命中阶段但末 token 不命中 → 用户明显想写范围但写错，报错不静默降级
          logger.error(error);
          logger.error(`规范阶段: ${PIPELINE_PHASES.map(p => p.key).join(', ')}`);
          return;
        }
        if (range) {
          logger.info(`🎯 范围语法: ${range.from} → ${range.to}\n`);
          options.from = range.from;
          options.to = range.to;
          options.demand = undefined;
        }
      }
    }
  }

  // ── v8.3.290: 智能续跑（无参 run 快捷操作）──
  // 未指定 --from/--to/--preset/--auto-steps/需求描述 时，按里程碑产物检测断点：
  //   全新且无需求 → 软停请用户提供需求入口（CLI 无法无米之炊）
  //   全新且有需求 → 自动从切分功能单元续跑至部署验证（不询问，三闸口兑底）
  //   部分完成     → [SPECCORE_RESUME] 面板软停，宿主 AI 询问「断点继续/重新切分/自定义」
  //   全部完成     → 指路收尾（deliver/docs），不重跑
  const smartResume = !options.from && !options.to && !options.preset && !options.autoSteps && !options.demand;
  if (smartResume) {
    const cp = await detectPipelineCheckpoint(iterDir, iteration);
    logger.info(`\n🤖 智能续跑检测 — ${iterDir}\n`);
    for (const it of cp.items) {
      const mark = it.done ? '✅' : (it.partial ? '🔄' : '⬜');
      logger.info(`  ${mark} ${it.label}${it.evidence ? ` — ${it.evidence}` : ''}`);
    }
    logger.info('');
    if (!cp.hasRequirement) {
      logger.info('[SPECCORE_RESUME] 未检测到需求文档，请选择需求入口:');
      logger.info(`  ① 导入 PRD 文档:  speccore doc2spec --iter ${iteration}（或 speccore run --from doc2spec -i ${iteration}）`);
      logger.info(`  ② 一句话需求:    speccore run "需求描述" -i ${iteration}`);
      logger.info('');
      logger.warn('🤖 等待用户选择后执行对应命令（宿主 AI 请用选项询问用户）');
      process.exitCode = 10;
      return;
    }
    if (cp.fresh) {
      logger.info(`▶ 全新迭代（需求已就绪），自动从切分功能单元开始: split-units → pipeline\n`);
      options.from = 'split-units';
      options.to = 'pipeline';
    } else if (cp.checkpointKey) {
      logger.info(`▶ 断点: ${cp.checkpointKey}`);
      logger.info('[SPECCORE_RESUME] 已有步骤可跳过，请选择续跑方式:');
      logger.info(`  ① 从断点继续:  speccore run --from ${cp.checkpointKey} --to pipeline -i ${iteration}`);
      if (cp.checkpointKey !== 'split-units') {
        // 断点已在切分阶段时「重新切分」与「从断点继续」同义，不重复展示
        logger.info(`  ② 重新切分:    speccore run --from split-units --to pipeline -i ${iteration}`);
        logger.info(`  ③ 自定义起止:  speccore run --from <阶段> --to <阶段> -i ${iteration}`);
      } else {
        logger.info(`  ② 自定义起止:  speccore run --from <阶段> --to <阶段> -i ${iteration}`);
      }
      logger.info('');
      logger.warn('🤖 等待用户选择后执行对应命令（宿主 AI 请用选项询问用户）');
      process.exitCode = 10;
      return;
    } else {
      logger.info(`🎉 ${iterDir} 已跑完至部署验证（pipeline），无需续跑。`);
      logger.info('收尾操作: speccore run deliver（提交代码+PR）/ speccore run docs（导出文档）');
      return;
    }
  }

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
    const rawSteps = pipelinesConfig.custom![presetName].split(',').map(s => s.trim()).filter(Boolean);
    // v8.3.196+: 识别「阶段:参数」语法（如 pipeline:--env=production），
    // 参数存入 stepParams，执行阶段时附加；冒号前的阶段名用于确定起止点
    const stepKeys: string[] = [];
    for (const raw of rawSteps) {
      const idx = raw.indexOf(':');
      if (idx < 0) { stepKeys.push(raw); continue; }
      const key = raw.slice(0, idx).trim();
      const arg = raw.slice(idx + 1).trim();
      stepKeys.push(key);
      if (arg) stepParams[key] = arg;
    }
    if (stepKeys.length > 0) {
      presetFrom = stepKeys[0];
      presetTo = stepKeys[stepKeys.length - 1];
      const paramNote = Object.keys(stepParams).length > 0
        ? `（参数: ${Object.entries(stepParams).map(([k, v]) => `${k}=${v}`).join(' ')}）`
        : '';
      logger.info(`🎯 自定义流水线 [${presetName}]: ${presetFrom} → ${presetTo}${paramNote}\n`);
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

  // v8.3.223+: 提示被跳过的上游阶段（--from 起点之前的阶段不会执行，依赖需已满足）
  if (startIdx > 0) {
    const skipped = PIPELINE_PHASES.slice(0, startIdx).map(p => p.key);
    logger.warn(`⏭️  从 ${PIPELINE_PHASES[startIdx].key} 开始，上游阶段已跳过: ${skipped.join(' → ')}`);
    logger.warn(`    每个阶段执行前会校验前置依赖，缺失时硬阻断（--no-dep-check 可强制跳过检查）\n`);
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

    // v8.3.223+: 阶段前置依赖校验——上游依赖未满足时阻断流水线。
    // 解决「--from taskify 跳过 split-units 仍继续拆分」类问题：依赖缺失必须停下并给补救命令。
    // 注意：必须在 review 闸口软停之前——依赖不满足时应第一时间硬阻断，
    // 而不是让用户先在闸口确认、之后才被告知依赖缺失。
    if (!options.noDepCheck) {
      const pre = PRECONDITIONS[phase.key];
      if (pre) {
        const preOk = await pre.check();
        if (!preOk) {
          if (pre.hard) {
            logger.error(`\n🛑 [SPECCORE_GATE] 阶段前置依赖未满足: ${phase.key}`);
            logger.error(`   缺少: ${pre.desc}`);
            logger.error(`   影响: ${pre.impact}`);
            logger.error(`   补救: ${pre.remedy}`);
            logger.error(`   继续: 补齐依赖后重新执行 speccore run --from ${phase.key} -I ${iteration}`);
            logger.error(`   绕过: 如确需跳过检查（${pre.bypassNote}），加 --no-dep-check 显式继续\n`);
            process.exitCode = 1;
            return;
          }
          logger.warn(`  ⚠️ 前置依赖建议: ${pre.desc}`);
          logger.warn(`     ${pre.remedy}（软依赖，继续执行...）`);
        }
      }
    }

    // v8.3.184+: review 闸口软停（功能开发质量底线）
    const gate = GATES[phase.key];
    if (gate) {
      // v8.3.195+: 闸口模式统一（A/B/C 均遵循）
      //   manual = 都软停人工确认；auto = 都跳过（--gate auto 或 --demo）
      const skipGate = gateMode === 'auto';
      if (!skipGate) {
        logger.warn(`\n🛑 [SPECCORE_GATE_${gate.id}] ${gate.title}`);
        logger.warn(`   ${gate.hint}`);
        logger.warn(`   确认后继续: speccore run --auto --from ${gate.resumeFrom} -I ${iteration}\n`);
        pausedGate = gate.id;
        break;  // 软停，等宿主 AI 确认后 --from 继续
      } else if (gate.id === 'C') {
        // auto 跳过闸口 C（部署）时给醒目警告——部署是 destructive 操作
        logger.warn(`\n⚠️  [auto] 已跳过闸口 C（部署前确认），即将自动部署到环境。`);
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
          if (runPhaseCommand(`speccore req-doc "${options.demand}" --to ${iteration}`, 'req-doc', iteration) === 'handoff') return;
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
        // v8.3.222+: 统计 features/ 一级子目录（功能单元）数，排除 . / _ 开头系统目录
        const countFeatureDirs = async (): Promise<number> => {
          try {
            const entries = await readdir(featuresDir, { withFileTypes: true });
            return entries.filter((e: any) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_')).length;
          } catch { return 0; }
        };
        let hasFeatures = (await countFeatureDirs()) > 0;
        // v8.3.317+: 显式 --from split-units 视为增量重切请求（新增单元/新文档补切），
        // 不因 features/ 非空跳过；默认自动断点场景保留跳过（幂等）
        const incrementalResplit = options.from === 'split-units';
        if (hasFeatures && !incrementalResplit) {
          logger.info('  ✅ 功能单元已切分，跳过');
          logger.info('     💡 需求新增功能单元/新文档时增量重切: speccore run --from split-units');
          phaseStatus = 'skipped';
          phaseMessage = '功能单元已切分';
          break;
        }
        if (hasFeatures && incrementalResplit) {
          logger.info('  🔪 增量重切: 已有单元跳过（skip），新增功能单元自动补齐');
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
        // v8.3.222+: 切分前统计需求文档的功能单元候选（## 二级标题数），用于切分后覆盖验证
        let candidateUnits = 0;
        for (const doc of docsToSplit) {
          try {
            const c = await readFile(doc, 'utf-8');
            const h2 = c.split('\n').filter(l => /^##\s+.+/.test(l));
            candidateUnits += h2.length;
          } catch { /* ignore */ }
        }
        const { splitDocumentToUnits } = await import('./doc2spec');
        for (const doc of docsToSplit) {
          try {
            // v8.3.317+: 增量重切（--from split-units 且已有单元）传 onDuplicate=skip——
            // 同名已有单元跳过不覆盖，新增章节自动产出；首次切分照旧默认 ask
            await splitDocumentToUnits(
              iterDir, doc, '', basename(doc),
              undefined, undefined,
              hasFeatures && incrementalResplit ? 'skip' : undefined,
            );
          } catch (e: any) {
            logger.warn(`  ⚠️ 切分失败: ${basename(doc)} — ${e?.message || e}`);
          }
        }
        // v8.3.222+: 切分结果验证——以「实际产出的功能单元目录数」为准，而非「调用次数」。
        // 修复「切分完成 4/4 但 features/ 一个单元都没产出」的假完成。
        const producedUnits = await countFeatureDirs();
        logger.info(`  🔪 切分功能单元: 实际产出 ${producedUnits} 个功能单元（${docsToSplit.length} 个需求文档，${candidateUnits} 个候选章节）`);
        if (producedUnits === 0) {
          logger.error(`\n🛑 [SPECCORE_GATE] 切分功能单元失败——features/ 未产出任何功能单元`);
          logger.error('   需求文档可能不含可识别的功能单元章节（## 二级标题），或切分逻辑未生效。');
          logger.error(`   涉及文档: ${docsToSplit.map(d => basename(d)).join(', ')}`);
          logger.error('   功能单元应体现为需求文档的「## 章节」（如 ## 会议室管理、## 预订管理）。');
          process.exitCode = 1;
          return;
        }
        // v8.3.222+: 覆盖验证——产出数明显少于候选章节数时警告（可能漏切），不阻断（AI 语义合并是合理的）
        if (candidateUnits > 0 && producedUnits < Math.floor(candidateUnits * 0.5)) {
          logger.warn(`  ⚠️ 功能单元产出 ${producedUnits} 个，候选章节 ${candidateUnits} 个，可能漏切（部分 ## 章节被合并或未识别）`);
          logger.warn(`     如需完整拆分，可检查 features/ 是否覆盖所有功能章节，或手动补切。`);
        }
        break;
      }
      case 'analyze': {
        const analysis = join(iterDir, '020-specs', 'ANALYSIS.md');
        // v8.3.223+: 修复复制粘贴 bug——techSpec 原指向 ANALYSIS.md，
        // 与 analysis 同文件导致技术方案校验形同虚设，应指向 TECH.md
        const techSpec = join(iterDir, '020-specs', 'TECH.md');
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
        // v8.3.265: analyze 输出 [SPECCORE_PROMPT] 后 exit 10 的接力标记——
        // 内容需宿主 AI 响应落盘，硬闸口拦截时据此给出「AI 接力」指引而非普通报错
        let analyzePromptHandoff = false;
        if (needsAnalysis || needsSpecs) {
          try {
            execSync(`speccore analyze --auto -I ${iteration}`, { stdio: 'inherit' });
          } catch (e: any) {
            // analyze --auto 输出分析 Prompt 让宿主 AI 接管（exitCode 10），不 算失败
            analyzePromptHandoff = (e && (e.status === 10 || e.code === 10 || e.exitCode === 10));
            logger.info('  ⚠️ analyze 已输出分析 Prompt，等待 AI 分析结果落盘');
          }
        } else {
          logger.info('  ✅ 分析已完成，跳过');
          phaseStatus = 'skipped';
          phaseMessage = '分析已完成，跳过';
        }

        // v8.3.202+: 骨架硬闸口——检测 020-specs 是否仍有空模板，有则硬停防止下游雪崩
        const emptySkeleton = await detectEmptySkeletonDocs(iterDir);
        if (emptySkeleton.length > 0) {
          // v8.3.203+: 区分根因——澄清未完成 vs 分析未落盘，给精准修复指引
          let clarifyBlocked = false;
          try {
            const { hasValidClarifiedDocs, detectProfessionalLevel } = await import('../core/requirement-clarifier');
            const hasClarified = await hasValidClarifiedDocs(iterDir);
            if (!hasClarified) {
              let lowQuality = 0;
              const reqDir = join(iterDir, '010-requirements');
              const checkReqQuality = async (dir: string) => {
                if (!await pathExists(dir)) return;
                try {
                  const files = await readdir(dir, { withFileTypes: true });
                  for (const f of files) {
                    if (f.name.startsWith('.')) continue;
                    const full = join(dir, f.name);
                    if (f.isDirectory()) await checkReqQuality(full);
                    else if (f.name.endsWith('.md')) {
                      try {
                        const c = await readFile(full, 'utf-8');
                        if (detectProfessionalLevel(c) !== 'high') lowQuality++;
                      } catch { /* ignore */ }
                    }
                  }
                } catch { /* ignore */ }
              };
              await checkReqQuality(reqDir);
              clarifyBlocked = lowQuality > 0;
            }
          } catch { /* ignore */ }

          logger.error(`\n🛑 [SPECCORE_GATE] 需求分析未完成——${emptySkeleton.length} 个 Spec 文档仍是空模板`);
          for (const d of emptySkeleton.slice(0, 8)) logger.error(`   ❌ ${d}`);
          if (emptySkeleton.length > 8) logger.error(`   ... 还有 ${emptySkeleton.length - 8} 个`);

          if (analyzePromptHandoff) {
            // v8.3.378: 接力窗口优先——analyze --auto 以 exit 10 输出分析 Prompt，
            // 内容需宿主 AI 响应落盘，此刻骨架必为空模板（正常中间态而非失败态）。
            // 硬停 exit 1 会让全自动流水线永远死在 analyze 阶段（Prompt 打了没人接），
            // 宿主 AI 收到失败信号只能停下来问用户。改为接力退出 exit 10：
            // 宿主 AI 响应 Prompt 落盘后 run --from taskify 继续，taskify 阶段
            // 第二道骨架闸口兜底校验（漏填仍会拦截）。
            logger.error('');
            logger.error('   ℹ️  这是正常中间态：analyze --auto 刚预建骨架并输出分析 Prompt，');
            logger.error('      分析内容由宿主 AI 接力生成，尚未落盘。');
            if (clarifyBlocked) {
              logger.error('');
              logger.error('   ⚠️ 附带提醒：需求澄清未完成——上方 [SPECCORE_PROMPT] 已含澄清指令，');
              logger.error('     宿主 AI 响应时请先完成 Phase 0 澄清，再生成 Phase 1+2 分析内容。');
            }
            logger.error('');
            logger.error('   🤖 宿主 AI 接力：请响应上方 [SPECCORE_PROMPT] 输出，逐单元生成分析内容');
            logger.error(`      并通过 speccore analyze --apply "[DOC:...]" -I ${iteration} 落盘；`);
            logger.error(`      全部落盘后运行: speccore run --from taskify -i ${iteration}`);
            process.exitCode = 10;
            return;
          }

          if (clarifyBlocked) {
            logger.error('');
            logger.error('   ⚠️ 根因：需求澄清未完成——需求文档质量不足且未生成澄 清产物。');
            logger.error('   请先澄清需求（二选一）:');
            logger.error(`   1. speccore req-doc --from "<需求文档>" --to ${iteration} --prompt   # 引导澄清后落盘黄金需求`);
            logger.error(`   2. speccore analyze -I ${iteration} --skip-clarify                    # 跳过澄清直接分析（不推荐）`);
          } else {
            logger.error('   空模板会让 taskify/execute 拿不到真实需求，生成代码质量极差。');
            logger.error(`   请先完成需求分析落盘: speccore analyze -I ${iteration} --auto`);
          }
          logger.error(`   确认落盘后继续: speccore run --auto --from taskify -i ${iteration}\n`);
          process.exitCode = 1;
          return;
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
        // v8.3.221+: 骨架硬闸口——检测 020-specs 是否仍有空模板，有则硬停。
        // 空骨架会一路传到 taskify，AI 把「写作要求/质量标准」等骨架文字误当功能模块，拆出垃圾任务。
        // 之前 analyze 阶段的闸口会被 --from taskify 绕过，故在此处再设一道。
        const emptySkeleton = await detectEmptySkeletonDocs(iterDir);
        if (emptySkeleton.length > 0) {
          logger.error(`\n🛑 [SPECCORE_GATE] 需求分析未完成——${emptySkeleton.length} 个 Spec 文档仍是空模板，无法拆分任务`);
          for (const d of emptySkeleton.slice(0, 6)) logger.error(`   ❌ ${d}`);
          if (emptySkeleton.length > 6) logger.error(`   ... 还有 ${emptySkeleton.length - 6} 个`);
          logger.error('   空模板会让 taskify 把「写作要求/质量标准」等骨架文字误当功能模块，拆出垃圾任务。');
          logger.error(`   请先完成需求分析落盘: speccore analyze -I ${iteration} --auto`);
          logger.error(`   确认落盘后继续: speccore run --auto --from taskify -i ${iteration}\n`);
          process.exitCode = 1;
          return;
        }
        // v8.3.223+: 功能单元切分校验已提升到阶段级前置依赖检查（PRECONDITIONS.taskify，硬阻断），
        // 此处不再重复 warn——只有 --no-dep-check 逃生舱时才可能走到这且 features/ 为空。
        // v8.3.223+: 改用 scanTasks 判断任务是否已拆分——游离目录（无 .meta/TASK.md）
        // 不再误判为已拆分（旧逻辑只看 030-tasks 根下 Task- 前缀目录，垃圾目录导致 taskify 假跳过）
        let hasTasks = false;
        try {
          const { scanTasks } = await import('../core/state');
          hasTasks = (await scanTasks(iteration)).length > 0;
        } catch {}
        if (!hasTasks) {
          // v8.3.266: AI 上下文（非 TTY）中 taskify 默认禁 --force，但 run 流水线已
          // 通过上游硬闸口校验，容器内调用需豁免；同时处理 exit 10 接力
          if (runPhaseCommand(`speccore iteration taskify -i ${iteration} --force`, 'taskify', iteration, { SPECCORE_PIPELINE_RUN: '1' }) === 'handoff') return;
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
          // v8.3.223+: plan 命令无 --force 选项，此前调用必然报 unknown option 失败
          if (runPhaseCommand(`speccore plan -i ${iteration}`, 'plan', iteration) === 'handoff') return;
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
          // v8.3.397+: 优先复用 plan 阶段生成的全部 active 调度计划（任务顺序/批次大小已在计划内），
          // 避免「先谋」产出被「后动」弃用、重新 --auto --all 全选重来。多计划逗号拼接交给 execute 合并执行。
          let planIds = '';
          try {
            const { listPlans } = await import('../core/plan-store');
            // v8.3.398+: 先取全量再过滤 active，避免 limit 截断漏掉更早的 active 计划
            //（历史僵尸计划过多时会挤掉真正待执行的蓝图）
            const plans = await listPlans(iteration, 100);
            planIds = plans.filter(p => p.status === 'active').map(p => p.id).join(',');
          } catch { /* 计划库不可读时回退全量执行 */ }
          if (planIds) {
            logger.info(`  📋 复用执行计划: ${planIds}`);
            if (runPhaseCommand(`speccore execute --plan ${planIds} -i ${iteration}`, 'execute', iteration) === 'handoff') return;
          } else {
            // v8.3.223+: --auto 仅执行第一个待执行任务，必须加 --all 覆盖全部 pending
            if (runPhaseCommand(`speccore execute --auto --all -i ${iteration}`, 'execute', iteration) === 'handoff') return;
          }
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
          // v8.3.217+: 本地冒烟（①）——受 settings.smoke.points.local 三态控制，--smoke/--skip-smoke 单次覆盖
          const localPoint = options.smoke === 'off' ? 'off' : options.smoke === 'on' ? 'on' : (smokeCfg.points?.local ?? 'auto');
          if (localPoint === 'off') {
            logger.info('  ⏭️ 已配置跳过本地冒烟（settings.smoke.points.local = off）');
          } else {
            const smokeConfig = '.speccore/tests/smoke.yaml';
            if (await pathExists(smokeConfig)) {
              const scope = resolveSmokeScope('local');
              const scopeNote = scope === 'module' ? '（module 范围：未显式指定模块时按全量跑）' : '';
              try {
                execSync(`speccore verify --config ${smokeConfig} --env-file local`, { stdio: 'inherit' });
                logger.info(`  ✅ 本地冒烟完成（范围 ${scope}${scopeNote}）`);
              } catch {
                logger.warn('  ⚠️ UI 冒烟测试未通过或环境未就绪（首次开发可能尚未部署/启动），已降级为仅代码验证');
                phaseStatus = 'warning';
                phaseMessage = 'UI 冒烟未通过或环境未就绪，仅完成代码验证';
              }
            } else {
              logger.info('  ℹ️ 未配置冒烟测试（.speccore/tests/smoke.yaml），跳过 UI 冒烟');
            }
          }
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
        // v8.3.196+: 透传环境参数——custom 步骤参数(stepParams)优先，其次 run --env，默认 pipeline 内部 staging
        const pipelineArg = stepParams['pipeline'] || (options.env ? `--env ${options.env}` : '');
        execSync(`speccore pipeline --all${pipelineArg ? ` ${pipelineArg}` : ''}`, { stdio: 'inherit' });
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
          if (runPhaseCommand(`speccore pr -i ${iteration} --force`, 'pr', iteration) === 'handoff') return;
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
          if (runPhaseCommand(`speccore done --all -i ${iteration}`, 'done', iteration) === 'handoff') return;
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
