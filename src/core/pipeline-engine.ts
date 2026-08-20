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
 * AI 侧流程:
 *   1. 收到 Phase 1 prompt → 生成全局文档 → --apply
 *   2. CLI 写入文件 → 自动推进 → 输出 [SPECCORE_PIPELINE_NEXT] + Phase 2 prompt
 *   3. AI 看到标记 → 自动执行下一个命令 → 生成各端文档 → --apply
 *   4. CLI 写入文件 → 标记完成 → Pipeline 结束
 *
 * @since v6.68.0
 */

import { writeFile, readFile, pathExists, ensureDir, unlink } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';

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
  /** 创建时间 */
  createdAt: string;
  /** 最后更新时间 */
  updatedAt: string;
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
  async advance(): Promise<{ nextStepId: string | null; nextStepName: string | null; isComplete: boolean }> {
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
      await this.saveState();

      const nextStepDef = this.steps.get(nextStepId);
      return {
        nextStepId,
        nextStepName: nextStepDef?.name || nextStepId,
        isComplete: false,
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
    };
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

  const steps: PipelineStepDef[] = [
    {
      id: 'clarify-prompt',
      name: 'Phase 0: 需求澄清',
      next: 'clarify-done',
      condition: needsClarify ? undefined : () => false, // skipClarify 时跳过
    },
    {
      id: 'clarify-done',
      name: '需求澄清完成检查',
      next: 'confirm-check',
    },
    {
      id: 'confirm-check',
      name: '需求确认检查',
      next: 'phase1-prompt',
      // 非自动模式下可在此暂停等待用户确认，自动模式直接通过
    },
    {
      id: 'phase1-prompt',
      name: 'Phase 1: 全局文档生成',
      next: 'phase1-done',
    },
    {
      id: 'phase1-done',
      name: 'Phase 1 完成检查',
      next: platforms.length >= 2 ? 'contract-prompt' : 'done',
    },
  ];

  // 多端项目：插入契约先行 + 逐端分析步骤
  if (platforms.length >= 2) {
    // 契约先行阶段
    steps.push({
      id: 'contract-prompt',
      name: '契约先行: 跨端 API 契约定义',
      next: 'contract-done',
    });
    steps.push({
      id: 'contract-done',
      name: '契约定义完成检查',
      next: platforms.length > 0 ? `platform-${platforms[0]}-prompt` : 'done',
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
      });
      steps.push({
        id: `platform-${platform}-done`,
        name: `${platform} 端完成检查`,
        next: nextId,
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
  const steps: PipelineStepDef[] = [
    {
      id: 'init',
      name: '初始化拆分流程',
      next: 'prompt-analysis',
    },
    {
      id: 'prompt-analysis',
      name: 'AI分析需求文档，输出任务拆分建议',
      next: 'confirmation',
    },
    {
      id: 'confirmation',
      name: '用户确认拆分方案',
      next: 'creation',
    },
    {
      id: 'creation',
      name: '创建任务目录结构',
      next: 'validation',
    },
    {
      id: 'validation',
      name: '验证任务结构完整性',
      next: 'done',
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
  const steps: PipelineStepDef[] = [
    {
      id: 'init',
      name: '初始化执行环境',
      next: 'prompt-analysis',
    },
    {
      id: 'prompt-analysis',
      name: 'AI分析任务需求，生成代码实现方案',
      next: 'code-generation',
    },
    {
      id: 'code-generation',
      name: '生成代码文件',
      next: 'verification',
    },
    {
      id: 'verification',
      name: '代码验证与测试',
      next: 'done',
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
  const steps: PipelineStepDef[] = [
    {
      id: 'init',
      name: '初始化全局分析环境',
      next: 'discovery',
    },
    {
      id: 'discovery',
      name: '发现所有迭代和项目',
      next: 'global-analysis',
    },
    {
      id: 'global-analysis',
      name: '分析跨迭代依赖关系',
      next: 'consistency-check',
    },
    {
      id: 'consistency-check',
      name: '检查全局一致性',
      next: 'report-generation',
    },
    {
      id: 'report-generation',
      name: '生成全局报告',
      next: 'done',
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
