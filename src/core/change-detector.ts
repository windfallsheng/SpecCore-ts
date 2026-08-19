/**
 * change-detector — 变更检测模块
 *
 * 在 split/execute 等阶段前检测上游文档是否有更新，
 * 提示用户是否需要重新生成或同步。
 *
 * v6.76.0+
 */
import { stat, pathExists, readdir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';

/**
 * 获取目录下所有文件的最大 mtime（递归）
 */
async function getDirMaxMtime(dir: string): Promise<number> {
  if (!(await pathExists(dir))) return 0;

  let maxMtime = 0;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      if (entry.isDirectory()) {
        const subMtime = await getDirMaxMtime(fullPath);
        if (subMtime > maxMtime) maxMtime = subMtime;
      } else {
        const s = await stat(fullPath);
        if (s.mtimeMs > maxMtime) maxMtime = s.mtimeMs;
      }
    }
  } catch {
    // 忽略无权限等错误
  }
  return maxMtime;
}

/**
 * 获取单个文件 mtime
 */
async function getFileMtime(filePath: string): Promise<number> {
  if (!(await pathExists(filePath))) return 0;
  try {
    const s = await stat(filePath);
    return s.mtimeMs;
  } catch {
    return 0;
  }
}

export interface ChangeDetectionResult {
  hasChange: boolean;
  newerFiles: string[];
  message: string;
  suggestion: string;
}

/**
 * 检测迭代级 spec 是否比任务目录更新
 * 用于 split 前检测
 */
export async function detectSpecChangesBeforeSplit(
  iterDir: string
): Promise<ChangeDetectionResult> {
  const specDir = join(iterDir, '020-specs');
  const tasksDir = join(iterDir, '030-tasks');

  const specMtime = await getDirMaxMtime(specDir);
  const tasksMtime = await getDirMaxMtime(tasksDir);

  if (specMtime === 0) {
    return {
      hasChange: false,
      newerFiles: [],
      message: '未找到 020-specs/ 目录',
      suggestion: '先执行 analyze 生成 spec 文档',
    };
  }

  if (tasksMtime === 0) {
    // 第一次拆分，没有任务目录
    return {
      hasChange: false,
      newerFiles: [],
      message: '首次拆分',
      suggestion: '',
    };
  }

  if (specMtime > tasksMtime) {
    return {
      hasChange: true,
      newerFiles: ['020-specs/'],
      message: '020-specs/ 有更新（晚于上次拆分）',
      suggestion: '建议重新拆分以同步最新 spec 变更，或加 --ignore-specs-update 跳过',
    };
  }

  return {
    hasChange: false,
    newerFiles: [],
    message: 'spec 文档未变更',
    suggestion: '',
  };
}

/**
 * 检测上游变更（拆分前 / 执行前）
 * 检查 020-specs/ 是否比 Task 目录更新
 */
export async function detectUpstreamChangesBeforeExecute(
  iterDir: string,
  taskDir: string
): Promise<ChangeDetectionResult> {
  const specDir = join(iterDir, '020-specs');
  const taskSpecDir = join(taskDir, '00-specs');

  const specMtime = await getDirMaxMtime(specDir);
  const taskSpecMtime = await getDirMaxMtime(taskSpecDir);

  const newerFiles: string[] = [];

  if (specMtime > taskSpecMtime) {
    newerFiles.push('020-specs/');
  }

  if (newerFiles.length > 0) {
    return {
      hasChange: true,
      newerFiles,
      message: `上游文档有更新: ${newerFiles.join(', ')}`,
      suggestion: '建议重新拆分以同步最新变更，或加 --ignore-upstream-update 跳过',
    };
  }

  return {
    hasChange: false,
    newerFiles: [],
    message: '上游文档未变更',
    suggestion: '',
  };
}

/**
 * 检测任务级 spec 是否有更新（执行前）
 */
export async function detectTaskSpecChanges(
  taskDir: string,
  lastExecutionMarker?: string
): Promise<ChangeDetectionResult> {
  const taskSpecDir = join(taskDir, '00-specs');
  const taskSpecMtime = await getDirMaxMtime(taskSpecDir);

  if (lastExecutionMarker) {
    const markerMtime = await getFileMtime(lastExecutionMarker);
    if (taskSpecMtime > markerMtime) {
      return {
        hasChange: true,
        newerFiles: ['Task/00-specs/'],
        message: '任务规格有更新（晚于上次执行）',
        suggestion: '将基于最新规格执行',
      };
    }
  }

  return {
    hasChange: false,
    newerFiles: [],
    message: '任务规格未变更',
    suggestion: '',
  };
}

/**
 * 打印变更检测结果
 */
export function printChangeDetection(result: ChangeDetectionResult, label: string): void {
  if (!result.hasChange) {
    logger.debug(`[${label}] ${result.message}`);
    return;
  }

  logger.info('');
  logger.warn(`⚠️  ${label}: ${result.message}`);
  if (result.suggestion) {
    logger.info(`   💡 ${result.suggestion}`);
  }
  logger.info('');
}
