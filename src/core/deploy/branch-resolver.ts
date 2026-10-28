/**
 * branch-resolver — 部署目标分支解析（v8.3.348+）
 *
 * 四级回退：
 *   1. 环境平台级 branch（.speccore/environments/{env}.yaml → platforms.{端}.branch）
 *   2. 环境全局 branch（environments/{env}.yaml → branch）
 *   3. PROJECT.yaml 端级 default_branch
 *   4. 子任务 git-config 源分支（Iteration-{N}/030-tasks/{类型}/{任务}/{端}/{子任务}/.meta/git-config）
 *
 * 纪律（重要）：本模块所有函数每次调用都实时读磁盘，不做任何缓存——
 * 用户可能临时修改配置（branch / git-config），必须当次发起当次生效，
 * 不允许复用上一次调用或会话内的旧结果。
 */
import { existsSync, readdirSync, statSync, readFileSync } from 'fs-extra';
import { join } from 'path';
import { logger } from '../../utils/logger';
import { findProjectRoot } from '../../utils/task-utils';
import { loadSubtaskGitConfig } from '../git-integration';
import type { PlatformConfig } from '../unified-config';
import type { EnvironmentConfig } from '../environment-config';

/** 读取当前活跃迭代名（实时读 .speccore/local/context.json，不缓存） */
function getCurrentIteration(): string | null {
  try {
    const projectRoot = findProjectRoot() || process.cwd();
    const ctxPath = join(projectRoot, '.speccore', 'local', 'context.json');
    if (!existsSync(ctxPath)) return null;
    const ctx = JSON.parse(readFileSync(ctxPath, 'utf-8'));
    return ctx.currentIteration || null;
  } catch {
    return null;
  }
}

/** 从子任务 git-config 中读取对应平台的源分支（实时遍历任务目录，不缓存） */
function findSubtaskBranchForPlatform(iteration: string, platformName: string): string | null {
  try {
    const projectRoot = findProjectRoot() || process.cwd();
    const tasksDir = join(projectRoot, `Iteration-${iteration}`, '030-tasks');
    if (!existsSync(tasksDir)) return null;

    for (const taskType of readdirSync(tasksDir)) {
      const taskTypeDir = join(tasksDir, taskType);
      if (!statSync(taskTypeDir).isDirectory()) continue;

      for (const taskId of readdirSync(taskTypeDir)) {
        const platformDir = join(taskTypeDir, taskId, platformName);
        if (!existsSync(platformDir)) continue;

        for (const subtask of readdirSync(platformDir)) {
          const subtaskDir = join(platformDir, subtask);
          if (!statSync(subtaskDir).isDirectory()) continue;
          const cfg = loadSubtaskGitConfig(subtaskDir);
          if (cfg.defaultBranch) return cfg.defaultBranch;
        }
      }
    }
  } catch {}
  return null;
}

/** 解析结果：目标分支 + 来源说明（计划面板展示「拉了什么分支、为什么」） */
export interface ResolvedBranch {
  branch: string;
  /** 分支来源描述（哪一级配置、哪个文件/字段） */
  source: string;
}

/**
 * 解析端的目标分支（四级回退，每次实时读），返回分支 + 来源
 *
 * 回退顺序：
 *   1. 环境平台级 branch（environments/{env}.yaml → platforms.{端}.branch）
 *   2. 环境全局 branch（environments/{env}.yaml → branch）
 *   3. PROJECT.yaml 端级 default_branch
 *   4. 子任务 git-config 源分支（Iteration-{N}/030-tasks/.../git-config）
 *
 * @param platform     端配置（PROJECT.yaml platforms[]）
 * @param envConfig    环境配置（.speccore/environments/{env}.yaml 解析结果，可为 null）
 * @returns 分支 + 来源；全部回退落空时返回 null（调用方决定跳过或报错）
 */
export function resolvePlatformBranchDetailed(
  platform: PlatformConfig,
  envConfig: EnvironmentConfig | null
): ResolvedBranch | null {
  // 1. 环境平台级 branch（优先级最高：环境文件里给这个端单独指定的分支）
  const envPlatformBranch = envConfig?.platforms?.[platform.name]?.branch;
  if (envPlatformBranch) {
    logger.info(`   [${platform.name}] 分支来源: 环境配置 platforms.${platform.name}.branch → ${envPlatformBranch}`);
    return { branch: envPlatformBranch, source: `environments/{env}.yaml → platforms.${platform.name}.branch` };
  }

  // 2. 环境全局 branch
  if (envConfig?.branch) {
    logger.info(`   [${platform.name}] 分支来源: 环境全局 branch → ${envConfig.branch}`);
    return { branch: envConfig.branch, source: 'environments/{env}.yaml → branch（环境全局）' };
  }

  // 3. PROJECT.yaml 端级 default_branch
  if (platform.default_branch) {
    logger.info(`   [${platform.name}] 分支来源: PROJECT.yaml default_branch → ${platform.default_branch}`);
    return { branch: platform.default_branch, source: 'PROJECT.yaml → default_branch' };
  }

  // 4. 子任务 git-config 源分支
  const currentIteration = getCurrentIteration();
  if (currentIteration) {
    const subtaskBranch = findSubtaskBranchForPlatform(currentIteration, platform.name);
    if (subtaskBranch) {
      logger.info(`   [${platform.name}] 分支来源: 子任务 git-config 源分支 → ${subtaskBranch}`);
      return { branch: subtaskBranch, source: '子任务 git-config 源分支' };
    }
  }

  return null;
}

/** 兼容包装：只返回分支名（pipeline 等旧调用方） */
export function resolvePlatformBranch(
  platform: PlatformConfig,
  envConfig: EnvironmentConfig | null
): string | null {
  return resolvePlatformBranchDetailed(platform, envConfig)?.branch ?? null;
}
