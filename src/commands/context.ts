/**
 * context — 查看当前 Task 的上下文加载状态和 Spec 依赖链
 */

import { pathExists, readFile, readdir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { loadContext } from '../core/context';

export interface ContextOptions {
  task?: string;
}

export async function contextCommand(options: ContextOptions): Promise<void> {
  try {
    const ctx = await loadContext();
    const taskName = options.task || ctx.currentTask;

    if (!taskName) {
      logger.info('📋 SpecCore 上下文信息');
      logger.info('');
      logger.info('当前状态：');
      logger.info(`  当前期次：${ctx.currentIteration || '无'}`);
      logger.info(`  当前任务：${ctx.currentTask || '无'}`);
      logger.info(`  执行人：${ctx.currentAssignee || '无'}`);
      logger.info(`  期次状态：${ctx.iterationStatus || '无'}`);
      logger.info(`  待处理：${ctx.pendingTasks}  进行中：${ctx.inProgressTasks}  已完成：${ctx.completedTasks}  阻塞：${ctx.blockedTasks}`);
      logger.info('');
      logger.info(`  最后操作：${ctx.lastAction || '无'}`);
      logger.info(`  最后意图：${ctx.lastIntent || '无'}`);
      logger.info(`  最后更新：${ctx.lastUpdated || '无'}`);
      return;
    }

    // 查找 Task 目录
    const taskDir = await findTaskDir(taskName);
    if (!taskDir) {
      logger.error(`Task not found: ${taskName}`);
      return;
    }

    // 分析上下文
    const analysis = await analyzeTaskContext(taskDir);

    logger.info('📋 Task 上下文分析');
    logger.info('');
    logger.info(`📂 Task: ${taskName}`);
    logger.info(`📍 路径: ${taskDir}`);
    logger.info('');

    // Spec 文件状态
    logger.info('📄 Spec 文件加载状态：');
    for (const file of analysis.specFiles) {
      const icon = file.exists ? '✅' : '❌';
      logger.info(`  ${icon} ${file.name} [${file.type}] ${file.size ? `(${file.size})` : ''}`);
    }

    // 平台
    if (analysis.platforms.length > 0) {
      logger.info('');
      logger.info('📱 平台覆盖：');
      for (const platform of analysis.platforms) {
        logger.info(`  - ${platform}`);
      }
    }

    // 依赖分析
    if (analysis.dependencies.length > 0) {
      logger.info('');
      logger.info('🔗 跨平台依赖：');
      for (const dep of analysis.dependencies) {
        logger.info(`  - ${dep}`);
      }
    }

    // 验收标准
    logger.info('');
    logger.info('📊 验收标准：');
    logger.info(`  总计: ${analysis.totalAC}  通过: ${analysis.passedAC}  未通过: ${analysis.failedAC}`);
  } catch (error) {
    logger.error(`Context analysis failed: ${error}`);
  }
}

/**
 * 查找 Task 目录
 */
async function findTaskDir(taskName: string): Promise<string | null> {
  const cwd = process.cwd();
  const entries = await readdir(cwd, { withFileTypes: true });

  // 直接匹配
  const directPaths = [
    join(cwd, taskName),
    join(cwd, `期次-*/*${taskName}*`),
  ];

  const exactMatch = join(cwd, taskName);
  if (await pathExists(exactMatch)) return exactMatch;

  // 遍历期次目录查找
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('期次-')) {
      const iterPath = join(cwd, entry.name);
      const tasks = await readdir(iterPath, { withFileTypes: true });
      for (const task of tasks) {
        if (task.isDirectory() && (
          task.name === taskName ||
          task.name.startsWith(taskName) ||
          task.name.includes(taskName)
        )) {
          return join(iterPath, task.name);
        }
      }
    }
  }

  return null;
}

/**
 * 分析 Task 上下文
 */
async function analyzeTaskContext(taskDir: string): Promise<{
  specFiles: { name: string; type: string; exists: boolean; size: string }[];
  platforms: string[];
  dependencies: string[];
  totalAC: number;
  passedAC: number;
  failedAC: number;
}> {
  const result = {
    specFiles: [] as { name: string; type: string; exists: boolean; size: string }[],
    platforms: [] as string[],
    dependencies: [] as string[],
    totalAC: 0,
    passedAC: 0,
    failedAC: 0,
  };

  // 检查 _shared/
  const shared = join(taskDir, '_shared');
  if (await pathExists(shared)) {
    const sharedFiles = await readdir(shared);
    for (const file of sharedFiles) {
      const filePath = join(shared, file);
      const stats = await readFile(filePath, 'utf-8').then(s => s.length).catch(() => 0);
      result.specFiles.push({ name: file, type: '共享', exists: true, size: formatSize(stats) });
    }
  }

  // 检查 backend/
  const backend = join(taskDir, 'backend');
  if (await pathExists(backend)) {
    const files = await readdir(backend);
    for (const file of files) {
      const filePath = join(backend, file);
      const stats = await readFile(filePath, 'utf-8').then(s => s.length).catch(() => 0);
      result.specFiles.push({ name: file, type: '后端', exists: true, size: formatSize(stats) });

      // 统计验收标准
      if (file === 'REQ.md') {
        const content = await readFile(filePath, 'utf-8').catch(() => '');
        result.totalAC += (content.match(/- \[[ x]\] AC-/g) || []).length;
        result.passedAC += (content.match(/- \[x\] AC-/g) || []).length;
        result.failedAC = result.totalAC - result.passedAC;
      }
    }
  } else {
    result.specFiles.push({ name: 'backend/', type: '后端', exists: false, size: '-' });
  }

  // 检查 frontend/{platform}/
  const frontend = join(taskDir, 'frontend');
  if (await pathExists(frontend)) {
    const platformDirs = await readdir(frontend, { withFileTypes: true });
    for (const pd of platformDirs) {
      if (pd.isDirectory()) {
        result.platforms.push(pd.name);
        const pDir = join(frontend, pd.name);
        const files = await readdir(pDir);
        for (const file of files) {
          const filePath = join(pDir, file);
          const stats = await readFile(filePath, 'utf-8').then(s => s.length).catch(() => 0);
          result.specFiles.push({ name: file, type: `前端/${pd.name}`, exists: true, size: formatSize(stats) });
        }
      }
    }
  }

  // 检查跨平台依赖
  if (result.platforms.length > 0) {
    for (let i = 0; i < result.platforms.length; i++) {
      for (let j = i + 1; j < result.platforms.length; j++) {
        result.dependencies.push(`${result.platforms[i]} ↔ ${result.platforms[j]} (共享 API_CONTRACT.yaml)`);
      }
    }
  }

  return result;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
