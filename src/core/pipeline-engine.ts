/**
 * Pipeline Engine - 通用流水线执行引擎（状态机设计）
 *
 * 核心思路:
 *   CLI 是单次运行进程，无法在一次调用中"等待" AI 的 --apply。
 *   所以用状态文件追踪当前步骤，每次 CLI 调用执行一步，
 *   --apply 完成后 CLI 自动推进到下一步并输出新 prompt。
 *
 * 状态流转 (analyze 两阶段分析):
 *   init → phase1-prompt → (AI --apply) → phase1-done
 *     → 检测多端 → phase2-prompt → (AI --apply) → done
 *
 * AI 侧流程 (v8.3.160+ 步骤隔离模式):
 *   1. 收到 Phase 1 prompt → 生成全局文档 → --apply
 *   2. CLI 写入文件 → 自动推进 → 输出 [SPECCORE_STEP_DONE] + [SPECCORE_NEXT_STEP] + Phase 2 prompt
 *   3. AI 在新会话中执行提示的命令 → 生成各端文档 → --apply
 *   4. CLI 写入文件 → 标记完成 → Pipeline 结束
 *
 * @since v6.68.0
 */

import { writeFile, readFile, pathExists, ensureDir, unlink } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';

// ── 上下文快照（步骤间传递的紧凑上下文，替代对话历史） ──
export interface ContextSnapshot {
  /** 核心约束摘要（从 CONSTITUTION.md 提取） */
  keyConstraints: string[];
  /** 已完成步骤的产出文件路径 */
  completedOutputs: string[];
  /** 技术栈摘要 */
  techStackSummary?: string;
  /** 当前任务/迭代 */
  currentTask?: string;
  /** 当前迭代 */
  iteration: string;
  /** 已完成的步骤 ID 列表 */
  completedSteps: string[];
  /** 下一步骤 ID */
  nextStep?: string;
  /** 生成时间 */
  generatedAt: string;
}

// ── 状态接口 ──
export interface PipelineState {
  /** 当前步骤 */
  currentStep: string;
  /** 所有步骤列表 */
  steps: string[];
  /** 已完成步骤 */
  completedSteps: string[];
  /** 迭代名称 */
  iteration: string;
  /** 流水线名称 */
  name: string;
  /** 端列表（analyze 专用） */
  platforms?: string[];
  /** v8.3.160+: 上下文快照（步骤隔离模式） */
  contextSnapshot?: ContextSnapshot;
  /** 创建时间 */
  createdAt: string;
  /** 最后更新时间 */
  updatedAt: string;
}

// ── 步骤推进结果 ──
export interface StepResult {
  nextStepId: string | null;
  nextStepName: string | null;
  isComplete: boolean;
  /** v8.3.160+: 是否需要新会话（步骤隔离模式） */
  requiresNewSession: boolean;
  /** v8.3.160+: 上下文快照（供新会话恢复） */
  contextSnapshot?: ContextSnapshot;
  /** v8.3.160+: 推荐的 Subagent */
  subagent?: string;
  /** v8.3.160+: 上下文 Token 预算 */
  contextBudget?: number;
  /** v8.3.160+: 上下文加载类型 */
  contextType?: 'full' | 'incremental' | 'platform-only' | 'contract-only';
}

// ── 步骤定义 ──
export interface PipelineStepDef {
  /** 步骤 ID */
  id: string;
  /** 步骤显示名 */
  name: string;
  /** 下一步 ID（null = 结束） */
  next: string | null;
  /** 条件判断：返回 true 才执行此步骤，否则跳到 next */
  condition?: () => Promise<boolean> | boolean;
  /** v8.3.160+: 该步骤使用的 Subagent 名称 */
  subagent?: string;
  /** v8.3.160+: 该步骤的上下文 Token 预算（默认 12000） */
  contextBudget?: number;
  /** v8.3.160+: 该步骤需要加载的上下文类型 */
  contextType?: 'full' | 'incremental' | 'platform-only' | 'contract-only';
}

// ── 引擎选项 ──
export interface PipelineEngineOptions {
  /** 迭代名称 */
  iteration: string;
  /** 流水线名称 */
  name: string;
  /** 工作区根目录（默认 process.cwd()） */
  cwd?: string;
}

export class PipelineEngine {
  private state: PipelineState | null = null;
  private steps: Map<string, PipelineStepDef> = new Map();
  private iteration: string;
  private name: string;
  private cwd: string;
  private stateFilePath: string;

  constructor(options: PipelineEngineOptions) {
    this.iteration = options.iteration;
    this.name = options.name;
    this.cwd = options.cwd || process.cwd();
    this.stateFilePath = join(this.cwd, '.speccore', 'local', `.pipeline-${options.iteration}.json`);
  }

  // ── 定义步骤 ──
  defineSteps(stepDefs: PipelineStepDef[]): void {
    this.steps.clear();
    for (const step of stepDefs) {
      this.steps.set(step.id, step);
    }
  }

  // ── 初始化流水线 ──
  async init(firstStepId: string, extra?: Record<string, any>): Promise<void> {
    const stepDef = this.steps.get(firstStepId);
    if (!stepDef) {
      throw new Error(`Pipeline step '${firstStepId}' not defined`);
    }

    this.state = {
      currentStep: firstStepId,
      steps: Array.from(this.steps.keys()),
      completedSteps: [],
      iteration: this.iteration,
      name: this.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...extra,
    };

    await this.saveState();
    logger.info(`🚀 Pipeline "${this.name}" 已初始化 (${this.state.steps.length} 个步骤)`);
  }

  // ── 推进到下一步 ──
  // v8.3.160+: 默认步骤隔离模式，每步完成后必须新会话继续
  async advance(): Promise<StepResult> {
    if (!this.state) {
      const loaded = await this.loadState();
      if (!loaded) {
        throw new Error('Pipeline state not found. Is the pipeline initialized?');
      }
    }

    const currentStepDef = this.steps.get(this.state!.currentStep);
    if (!currentStepDef) {
      throw new Error(`Step '${this.state!.currentStep}' not defined in pipeline`);
    }

    // 标记当前步骤完成
    this.state!.completedSteps.push(this.state!.currentStep);

    let nextStepId = currentStepDef.next;

    // 条件检查：如果下一步有条件，检查是否满足
    if (nextStepId) {
      const nextStepDef = this.steps.get(nextStepId);
      if (nextStepDef?.condition) {
        const shouldExecute = await nextStepDef.condition();
        if (!shouldExecute) {
          // 条件不满足，跳过这一步
          logger.info(`⏭️  步骤 ${nextStepDef.name} 条件不满足，跳过`);
          nextStepId = nextStepDef.next;
        }
      }
    }

    if (nextStepId) {
      this.state!.currentStep = nextStepId;
      this.state!.updatedAt = new Date().toISOString();

      // v8.3.160+: 步骤隔离模式下，构建上下文快照
      this.state!.contextSnapshot = await this.buildSnapshot(nextStepId);
      await this.saveSnapshot(this.state!.contextSnapshot);

      await this.saveState();

      const nextStepDef = this.steps.get(nextStepId);
      return {
        nextStepId,
        nextStepName: nextStepDef?.name || nextStepId,
        isComplete: false,
        requiresNewSession: true, // 默认步骤隔离，必须新会话
        contextSnapshot: this.state!.contextSnapshot,
        subagent: nextStepDef?.subagent,
        contextBudget: nextStepDef?.contextBudget,
        contextType: nextStepDef?.contextType,
      };
    }

    // 没有下一步 → 完成
    this.state!.currentStep = 'done';
    this.state!.updatedAt = new Date().toISOString();
    await this.saveState();

    return {
      nextStepId: null,
      nextStepName: null,
      isComplete: true,
      requiresNewSession: false,
    };
  }

  // ── v8.3.160+: 构建上下文快照 ──
  private async buildSnapshot(nextStepId?: string): Promise<ContextSnapshot> {
    const completedOutputs: string[] = [];
    // 根据已完成步骤推断产出文件路径
    for (const stepId of this.state!.completedSteps) {
      if (stepId.endsWith('-done') || stepId === 'phase1-prompt') {
        // 分析类步骤的产出通常写入 020-specs/
        completedOutputs.push(`Iteration-${this.iteration}/020-specs/`);
      }
    }

    return {
      keyConstraints: [], // 由调用方（PromptBuilder）填充
      completedOutputs: [...new Set(completedOutputs)],
      techStackSummary: '', // 由调用方填充
      iteration: this.iteration,
      completedSteps: [...this.state!.completedSteps],
      nextStep: nextStepId,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── v8.3.160+: 保存快照到独立文件 ──
  private async saveSnapshot(snapshot: ContextSnapshot): Promise<void> {
    const snapshotPath = join(this.cwd, '.speccore', 'local', `.pipeline-${this.iteration}-snapshot.json`);
    await ensureDir(join(this.cwd, '.speccore', 'local'));
    await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));
  }

  // ── v8.3.160+: 加载快照 ──
  static async loadSnapshot(cwd: string, iteration: string): Promise<ContextSnapshot | null> {
    const snapshotPath = join(cwd, '.speccore', 'local', `.pipeline-${iteration}-snapshot.json`);
    if (!(await pathExists(snapshotPath))) return null;
    try {
      const data = await readFile(snapshotPath, 'utf-8');
      return JSON.parse(data) as ContextSnapshot;
    } catch {
      return null;
    }
  }

  // ── v8.3.160+: 更新快照中的关键约束 ──
  async updateSnapshotConstraints(constraints: string[]): Promise<void> {
    if (this.state?.contextSnapshot) {
      this.state.contextSnapshot.keyConstraints = constraints;
      await this.saveSnapshot(this.state.contextSnapshot);
    }
  }

  // ── 获取当前步骤 ──
  getCurrentStep(): string | null {
    return this.state?.currentStep || null;
  }

  // ── 获取当前步骤定义 ──
  getCurrentStepDef(): PipelineStepDef | null {
    if (!this.state) return null;
    return this.steps.get(this.state.currentStep) || null;
  }

  // ── 检查流水线是否活跃（未完成） ──
  async isActive(): Promise<boolean> {
    const state = await this.loadState();
    if (!state) return false;
    return state.currentStep !== 'done';
  }

  // ── 获取完整状态 ──
  async getState(): Promise<PipelineState | null> {
    return this.loadState();
  }

  // ── 检查是否有活跃流水线 ──
  static async hasActivePipeline(cwd: string, iteration: string): Promise<boolean> {
    const statePath = join(cwd, '.speccore', 'local', `.pipeline-${iteration}.json`);
    if (!(await pathExists(statePath))) return false;
    try {
      const data = await readFile(statePath, 'utf-8');
      const state = JSON.parse(data) as PipelineState;
      return state.currentStep !== 'done';
    } catch {
      return false;
    }
  }

  // ── 加载已有流水线状态 ──
  static async loadExistingState(cwd: string, iteration: string): Promise<PipelineState | null> {
    const statePath = join(cwd, '.speccore', 'local', `.pipeline-${iteration}.json`);
    if (!(await pathExists(statePath))) return null;
    try {
      const data = await readFile(statePath, 'utf-8');
      return JSON.parse(data) as PipelineState;
    } catch {
      return null;
    }
  }

  // ── 重置（清理状态文件） ──
  async reset(): Promise<void> {
    try {
      if (await pathExists(this.stateFilePath)) {
        await unlink(this.stateFilePath);
      }
      this.state = null;
      logger.debug('Pipeline 状态已重置');
    } catch (error) {
      logger.debug('Pipeline 重置失败（非关键）:', error);
    }
  }

  // ── 内部：保存状态 ──
  private async saveState(): Promise<void> {
    if (!this.state) return;
    const dir = join(this.cwd, '.speccore', 'local');
    await ensureDir(dir);
    await writeFile(this.stateFilePath, JSON.stringify(this.state, null, 2));
  }

  // ── 内部：加载状态 ──
  private async loadState(): Promise<PipelineState | null> {
    if (this.state) return this.state;
    if (!(await pathExists(this.stateFilePath))) return null;
    try {
      const data = await readFile(this.stateFilePath, 'utf-8');
      this.state = JSON.parse(data);
      return this.state;
    } catch {
      return null;
    }
  }
}

// ── 工厂函数：创建 analyze 流水线 ──
// v6.69.0+: 支持契约先行 + 逐端推进（增强策略一 & 三）
// v6.69.0+: 支持变更感知过滤 + 关键路径优先排序（增强策略二 & 三）
// v6.80.0+: 增加需求澄清前置步骤（clarify-prompt → clarify-done → confirm-check）
export async function createAnalyzePipeline(
  iteration: string,
  cwd?: string,
  options?: {
    /** 变更感知：仅分析受影响的端 */
    affectedPlatforms?: string[];
    /** 关键路径优先：端排序优先级（靠前的优先分析） */
    platformOrder?: string[];
    /** 是否跳过需求澄清 */
    skipClarify?: boolean;
    /** v8.3.167+: 功能模块列表（用于大项目分批） */
    features?: string[];
  }
): Promise<{
  engine: PipelineEngine;
  steps: PipelineStepDef[];
}> {
  // 动态导入避免循环依赖
  const { parsePlatformList } = await import('../core/spec-paths');
  let platforms = await parsePlatformList();

  // 变更感知：过滤仅受影响的端
  if (options?.affectedPlatforms && options.affectedPlatforms.length > 0) {
    const before = platforms.length;
    platforms = platforms.filter(p => options.affectedPlatforms!.includes(p));
    if (platforms.length < before) {
      logger.info(`🎯 变更感知: 从 ${before} 个端过滤为 ${platforms.length} 个端 (${platforms.join(', ')})`);
    }
  }

  // 关键路径优先：按优先级排序端
  if (options?.platformOrder && options.platformOrder.length > 0) {
    const orderMap = new Map(options.platformOrder.map((p, i) => [p, i]));
    platforms.sort((a, b) => {
      const orderA = orderMap.get(a) ?? Infinity;
      const orderB = orderMap.get(b) ?? Infinity;
      return orderA - orderB;
    });
    logger.info(`🎯 关键路径优先: 端分析顺序 → ${platforms.join(' → ')}`);
  }

  // v6.80.0+: 条件判断是否需要需求澄清
  const needsClarify = options?.skipClarify !== true;

  // v8.3.167+: 功能模块级分批检测
  const features = options?.features || [];
  const useFeatureBatches = features.length > 2;
  if (useFeatureBatches) {
    logger.info(`📦 功能模块分批模式: ${features.length} 个模块将分 ${features.length} 个 Agent 会话处理`);
  }

  // v8.3.160+: 以 _INDEX.md 角色定义为准，将多角色步骤拆分为单角色子步骤
  // clarify 阶段拆分为 product-analyst → interaction-designer → security-reviewer
  const steps: PipelineStepDef[] = [];

  if (needsClarify) {
    steps.push({
      id: 'clarify-product',
      name: 'Phase 0a: 产品分析（业务流程、遗漏识别、术语统一）',
      next: 'clarify-interaction',
      subagent: 'product-analyst',
      contextType: 'full',
      contextBudget: 4000,
    });
    steps.push({
      id: 'clarify-interaction',
      name: 'Phase 0b: 交互设计（信息架构、状态矩阵、前后端一致性）',
      next: 'clarify-security',
      subagent: 'interaction-designer',
      contextType: 'full',
      contextBudget: 4000,
    });
    steps.push({
      id: 'clarify-security',
      name: 'Phase 0c: 安全审查（认证授权、输入验证、数据保护）',
      next: 'confirm-check',
      // v8.3.160+: 条件判断 securityLevel > 2 时执行，否则跳过
      condition: async () => {
        try {
          const projectPath = join(cwd || process.cwd(), '.speccore', 'PROJECT.yaml');
          if (!await pathExists(projectPath)) return true; // 默认执行
          const { readFile } = await import('fs-extra');
          const content = await readFile(projectPath, 'utf-8');
          const match = content.match(/securityLevel:\s*(\d+)/);
          return match ? parseInt(match[1], 10) > 2 : true;
        } catch {
          return true;
        }
      },
      subagent: 'security-reviewer',
      contextType: 'full',
      contextBudget: 3000,
    });
  }

  // v8.3.167+: Phase 1 根据功能模块数量调整策略
  // 大项目：Phase 1 只生成全局索引，功能模块文档由独立 Agent 分批处理
  // 小项目：Phase 1 一次性生成所有全局文档
  const phase1NextId = useFeatureBatches
    ? `feature-${features[0]}-prompt`
    : (platforms.length >= 2 ? 'contract-prompt' : 'done');

  steps.push(
    {
      id: 'confirm-check',
      name: '需求确认检查',
      next: 'phase1-prompt',
      subagent: 'product-analyst',
      contextType: 'incremental',
      contextBudget: 4000,
    },
    {
      id: 'phase1-prompt',
      name: useFeatureBatches ? 'Phase 1: 全局索引文档生成' : 'Phase 1: 全局文档生成',
      next: 'phase1-done',
      subagent: 'spec-analyzer',
      contextType: 'full',
      // v8.3.167+: 大项目降低预算（只生成索引），小项目保持 10K
      contextBudget: useFeatureBatches ? 6000 : 10000,
    },
    {
      id: 'phase1-done',
      name: 'Phase 1 完成检查',
      next: phase1NextId,
      subagent: 'spec-analyzer',
      contextType: 'incremental',
      contextBudget: 4000,
    },
  );

  // v8.3.167+: 功能模块级分批步骤（大项目）
  // 每个功能模块由独立 Agent 会话处理，生成该模块的 overview/ 文档
  if (useFeatureBatches) {
    for (let i = 0; i < features.length; i++) {
      const feature = features[i];
      const isLastFeature = i === features.length - 1;
      const featureNextPromptId = isLastFeature
        ? (platforms.length >= 2 ? 'contract-prompt' : 'done')
        : `feature-${features[i + 1]}-prompt`;

      steps.push({
        id: `feature-${feature}-prompt`,
        name: `Phase 1b-${i + 1}: ${feature} 功能模块分析`,
        next: `feature-${feature}-done`,
        // v8.3.167+: 功能模块级 Subagent
        subagent: 'spec-analyzer',
        contextType: 'full',
        contextBudget: 10000,
      });
      steps.push({
        id: `feature-${feature}-done`,
        name: `${feature} 模块完成检查`,
        next: featureNextPromptId,
        subagent: 'spec-analyzer',
        contextType: 'incremental',
        contextBudget: 4000,
      });
    }
  }

  // 多端项目：插入契约先行 + 逐端分析步骤
  if (platforms.length >= 2) {
    // 契约先行阶段
    steps.push({
      id: 'contract-prompt',
      name: '契约先行: 跨端 API 契约定义',
      next: 'contract-done',
      subagent: 'spec-analyzer',
      contextType: 'contract-only',
      contextBudget: 6000,
    });
    steps.push({
      id: 'contract-done',
      name: '契约定义完成检查',
      next: platforms.length > 0 ? `platform-${platforms[0]}-prompt` : 'done',
      subagent: 'spec-analyzer',
      contextType: 'incremental',
      contextBudget: 4000,
    });

    // 逐端推进：每个端独立一个步骤
    for (let i = 0; i < platforms.length; i++) {
      const platform = platforms[i];
      const nextId = i < platforms.length - 1
        ? `platform-${platforms[i + 1]}-prompt`
        : 'done';

      steps.push({
        id: `platform-${platform}-prompt`,
        name: `Phase 2-${i + 1}: ${platform} 端专属文档生成`,
        next: `platform-${platform}-done`,
        // v8.3.166+: 端级 Subagent，每个端有独立的分析角色
        subagent: `spec-analyzer-${platform}`,
        contextType: 'platform-only',
        contextBudget: 8000,
      });
      steps.push({
        id: `platform-${platform}-done`,
        name: `${platform} 端完成检查`,
        next: nextId,
        subagent: `spec-analyzer-${platform}`,
        contextType: 'incremental',
        contextBudget: 4000,
      });
    }
  }

  steps.push({
    id: 'done',
    name: 'Pipeline 完成',
    next: null,
  });

  const engine = new PipelineEngine({
    iteration,
    name: 'analyze',
    cwd,
  });

  // 将平台列表存入引擎状态，供后续步骤使用
  engine.defineSteps(steps);

  return { engine, steps };
}

// ── 工厂函数：创建 split 流水线 ──
export async function createSplitPipeline(iteration: string, cwd?: string): Promise<{
  engine: PipelineEngine;
  steps: PipelineStepDef[];
}> {
  // v8.3.160+: 以 _INDEX.md 角色定义为准
  const steps: PipelineStepDef[] = [
    {
      id: 'init',
      name: '初始化拆分流程',
      next: 'prompt-analysis',
      subagent: 'task-decomposer',
      contextType: 'incremental',
      contextBudget: 4000,
    },
    {
      id: 'prompt-analysis',
      name: 'AI分析需求文档，输出任务拆分建议',
      next: 'dependency-analysis',
      subagent: 'task-decomposer',
      contextType: 'full',
      contextBudget: 8000,
    },
    {
      id: 'dependency-analysis',
      name: '分析任务间依赖关系',
      next: 'effort-estimation',
      subagent: 'dependency-analyst',
      contextType: 'incremental',
      contextBudget: 5000,
    },
    {
      id: 'effort-estimation',
      name: '工时估算',
      next: 'confirmation',
      subagent: 'effort-estimator',
      contextType: 'incremental',
      contextBudget: 4000,
    },
    {
      id: 'confirmation',
      name: '用户确认拆分方案',
      next: 'creation',
      subagent: 'task-decomposer',
      contextType: 'incremental',
      contextBudget: 3000,
    },
    {
      id: 'creation',
      name: '创建任务目录结构',
      next: 'validation',
      subagent: 'task-decomposer',
      contextType: 'incremental',
      contextBudget: 4000,
    },
    {
      id: 'validation',
      name: '验证任务结构完整性',
      next: 'done',
      subagent: 'task-decomposer',
      contextType: 'incremental',
      contextBudget: 4000,
    },
    {
      id: 'done',
      name: 'Pipeline 完成',
      next: null,
    },
  ];

  const engine = new PipelineEngine({
    iteration,
    name: 'split',
    cwd,
  });

  engine.defineSteps(steps);

  return { engine, steps };
}

// ── 工厂函数：创建 execute 流水线 ──
export async function createExecutePipeline(iteration: string, task?: string, cwd?: string): Promise<{
  engine: PipelineEngine;
  steps: PipelineStepDef[];
}> {
  // v8.3.160+: 以 _INDEX.md 角色定义为准，将 verification 拆分为 5 个专业子步骤
  const steps: PipelineStepDef[] = [
    {
      id: 'init',
      name: '初始化执行环境',
      next: 'prompt-analysis',
      subagent: 'spec-executor',
      contextType: 'incremental',
      contextBudget: 4000,
    },
    {
      id: 'prompt-analysis',
      name: 'AI分析任务需求，生成代码实现方案',
      next: 'code-generation',
      subagent: 'spec-executor',
      contextType: 'full',
      // v8.3.160+: 降为 10K（配合按需加载 REQ.md）
      contextBudget: 10000,
    },
    {
      id: 'code-generation',
      name: '生成代码文件',
      next: 'quality-gate-build',
      subagent: 'spec-executor',
      contextType: 'incremental',
      contextBudget: 10000,
    },
    {
      id: 'quality-gate-build',
      name: '质量门禁: 编译与测试',
      next: 'quality-gate-nfr',
      // v8.3.160+: 合并 compiler + test-engineer，减少会话切换
      subagent: 'compiler',
      contextType: 'incremental',
      contextBudget: 8000,
    },
    {
      id: 'quality-gate-nfr',
      name: '质量门禁: 安全与性能',
      next: 'quality-gate-doc-sync',
      // v8.3.160+: 合并 security-reviewer + performance-expert
      subagent: 'security-reviewer',
      contextType: 'incremental',
      contextBudget: 6000,
    },
    {
      id: 'quality-gate-doc-sync',
      name: '质量门禁: 文档同步检查',
      next: 'done',
      subagent: 'doc-sync-agent',
      contextType: 'incremental',
      contextBudget: 3000,
    },
    {
      id: 'done',
      name: 'Pipeline 完成',
      next: null,
    },
  ];

  const engine = new PipelineEngine({
    iteration,
    name: task ? `execute-${task}` : 'execute',
    cwd,
  });

  engine.defineSteps(steps);

  return { engine, steps };
}

// ── 工厂函数：创建全局分析流水线 ──
export async function createGlobalAnalyzePipeline(cwd?: string): Promise<{
  engine: PipelineEngine;
  steps: PipelineStepDef[];
}> {
  // v8.3.160+: 以 _INDEX.md 角色定义为准
  const steps: PipelineStepDef[] = [
    {
      id: 'init',
      name: '初始化全局分析环境',
      next: 'discovery',
      subagent: 'spec-global-analyzer',
      contextType: 'full',
      contextBudget: 6000,
    },
    {
      id: 'discovery',
      name: '发现所有迭代和项目',
      next: 'global-analysis',
      subagent: 'spec-global-analyzer',
      contextType: 'full',
      contextBudget: 8000,
    },
    {
      id: 'global-analysis',
      name: '分析跨迭代依赖关系',
      next: 'consistency-check',
      subagent: 'spec-global-analyzer',
      contextType: 'full',
      // v8.3.160+: 降为 10K（discovery 已提供迭代摘要，无需全量加载）
      contextBudget: 10000,
    },
    {
      id: 'consistency-check',
      name: '检查全局一致性',
      next: 'report-generation',
      subagent: 'spec-global-analyzer',
      contextType: 'incremental',
      contextBudget: 8000,
    },
    {
      id: 'report-generation',
      name: '生成全局报告',
      next: 'done',
      subagent: 'spec-global-analyzer',
      contextType: 'incremental',
      contextBudget: 8000,
    },
    {
      id: 'done',
      name: 'Pipeline 完成',
      next: null,
    },
  ];

  const engine = new PipelineEngine({
    iteration: 'GLOBAL', // 使用特殊标识表示全局分析
    name: 'global-analyze',
    cwd,
  });

  engine.defineSteps(steps);

  return { engine, steps };
}
