/**
 * Quality Gate — 质量门禁配置管理
 *
 * 三层配置合并：项目级（.speccore.yml）→ 任务级（Task/.meta/quality-gate.yaml）→ 命令行（CLI flags）
 */

import { join } from 'path';
import { pathExists, readFile } from 'fs-extra';
import { parseYamlFile } from './yaml-parser';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────

import type { VisualModelConfig } from './ui-verify/visual-model-client';
export type { VisualModelConfig };

export interface TaskQualityGateConfig {
  verify_ui?: {
    enabled?: boolean;
    smoke_test?: boolean;
    visual_check?: boolean;
    threshold?: 'strict' | 'normal' | 'loose';
    devices?: string[];
    browsers?: string[];
    timeout?: number;
    /** 有头模式：显示浏览器窗口（调试用，默认 false） */
    headed?: boolean;
    visual_model?: VisualModelConfig;
  };
}

export interface ResolvedQualityGate {
  verify_ui: {
    enabled: boolean;
    smoke_test: boolean;
    visual_check: boolean;
    threshold: 'strict' | 'normal' | 'loose';
    devices: string[];
    browsers: string[];
    timeout: number;
    /** 有头模式：显示浏览器窗口（调试用，默认 false） */
    headed: boolean;
    visual_model?: VisualModelConfig;
  };
}

// ─────────────────────────────────────────
// 任务级配置读取
// ─────────────────────────────────────────

export async function loadTaskQualityGate(taskDir: string): Promise<TaskQualityGateConfig | null> {
  const paths = [
    join(taskDir, '.meta', 'quality-gate.yaml'),
    join(taskDir, '.meta', 'quality-gate.yml'),
    join(taskDir, 'quality-gate.yaml'),
    join(taskDir, 'quality-gate.yml'),
  ];

  for (const p of paths) {
    if (await pathExists(p)) {
      const result = await parseYamlFile(p);
      if (result.success && result.data) {
        logger.info(`  📄 加载任务级质量门禁: ${p}`);
        return result.data as TaskQualityGateConfig;
      }
    }
  }

  return null;
}

// ─────────────────────────────────────────
// 三层配置合并
// ─────────────────────────────────────────

export interface QualityGateMergeInput {
  /** 项目级配置（来自 .speccore.yml quality_gates.verify_ui） */
  projectLevel?: Partial<ResolvedQualityGate['verify_ui']>;
  /** 任务级配置（来自 Task/.meta/quality-gate.yaml） */
  taskLevel?: TaskQualityGateConfig['verify_ui'];
  /** 命令行覆盖 */
  cliOverrides?: {
    enabled?: boolean;
    smokeOnly?: boolean;
    visualOnly?: boolean;
    device?: string;
    browser?: string;
    timeout?: number;
    headed?: boolean;
  };
}

export function mergeQualityGate(input: QualityGateMergeInput): ResolvedQualityGate {
  // 默认值
  const defaults: ResolvedQualityGate['verify_ui'] = {
    enabled: false,
    smoke_test: true,
    visual_check: true,
    threshold: 'normal',
    devices: ['desktop'],
    browsers: ['chromium'],
    timeout: 30000,
    headed: false,
    visual_model: {
      provider: 'qwen-vl',
      model: 'qwen-vl-max',
    },
  };

  // 1. 项目级覆盖
  const projectMerged = { ...defaults, ...input.projectLevel };

  // 2. 任务级覆盖
  const taskMerged = input.taskLevel
    ? {
        ...projectMerged,
        ...input.taskLevel,
        devices: input.taskLevel.devices || projectMerged.devices,
        browsers: input.taskLevel.browsers || projectMerged.browsers,
        visual_model: input.taskLevel.visual_model || projectMerged.visual_model,
      }
    : projectMerged;

  // 3. 命令行覆盖（最高优先级）
  const cli = input.cliOverrides;
  const final: ResolvedQualityGate['verify_ui'] = {
    enabled: cli?.enabled ?? taskMerged.enabled,
    smoke_test: cli?.smokeOnly === true ? true : cli?.visualOnly === true ? false : taskMerged.smoke_test,
    visual_check: cli?.visualOnly === true ? true : cli?.smokeOnly === true ? false : taskMerged.visual_check,
    threshold: taskMerged.threshold,
    devices: cli?.device ? [cli.device] : taskMerged.devices,
    browsers: cli?.browser ? [cli.browser] : taskMerged.browsers,
    timeout: cli?.timeout || taskMerged.timeout,
    headed: cli?.headed ?? taskMerged.headed ?? false,
  };

  return { verify_ui: final };
}

// ─────────────────────────────────────────
// 快捷函数：判断任务是否需要 UI 验证
// ─────────────────────────────────────────

export function shouldRunUIVerify(resolved: ResolvedQualityGate): boolean {
  return resolved.verify_ui.enabled;
}
