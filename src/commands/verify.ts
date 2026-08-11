/**
 * verify — 代码验证命令
 *
 * 执行后验证代码质量：编译检查 + Lint + 单元测试
 * 支持项目级和任务级验证
 *
 * 用法:
 *   speccore verify                          # 验证当前迭代所有任务
 *   speccore verify -t Task-001              # 验证单个任务
 *   speccore verify -t Task-001 --type=lint  # 只跑 lint
 *   speccore verify --path=./backend         # 指定代码路径
 */

import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, getIterationDir } from '../core/context';
import { pathExists, readFile, ensureDir } from 'fs-extra';
import { join } from 'path';
import { scanTasks, TaskState } from '../core/state';
import { resolveTask, formatResolveResult } from '../core/resolver';
import { runVerification, writeVerifyReport, VerifyReport } from '../core/verify-engine';
import { loadConfig } from '../core/unified-config';

interface VerifyOptions {
  task?: string;
  iteration?: string;
  type?: 'compile' | 'lint' | 'test' | 'all';
  path?: string;
  timeout?: number;
}

export async function verifyCommand(options: VerifyOptions): Promise<void> {
  const spinner = new Spinner('正在执行代码验证...');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('未找到活跃迭代。请先运行: speccore iteration create --name <名称>');
      return;
    }

    const iterDir = await getIterationDir(iteration);
    const config = await loadConfig();

    // 确定代码路径
    let codePath: string;
    if (options.path) {
      codePath = options.path;
    } else {
      // 从 code_scope 获取第一个代码路径
      codePath = config.code_scope?.[0] || process.cwd();
      if (!codePath.startsWith('/')) {
        codePath = join(process.cwd(), codePath);
      }
    }

    // 检查代码路径是否存在
    if (!(await pathExists(codePath))) {
      spinner.fail(`代码路径不存在: ${codePath}`);
      logger.info('💡 使用 --path 指定正确的代码路径，或在 .speccore.yml 中配置 code_scope');
      return;
    }

    // 任务级验证
    if (options.task) {
      const taskResult = await resolveTask(options.task, iteration);
      if (!taskResult.exact || !taskResult.value) {
        spinner.fail(taskResult.hint || `Task "${options.task}" 未找到`);
        return;
      }
      if (taskResult.matchType !== 'exact') {
        const hint = formatResolveResult(taskResult, 'Task');
        if (hint) logger.info(hint);
      }

      const task = taskResult.value;
      spinner.stop();

      // 任务级验证：尝试找到任务对应的代码目录
      const taskCodePath = await findTaskCodePath(task, iterDir, codePath);
      const report = await runVerification(task.id, taskCodePath, {
        type: options.type || 'all',
        timeout: options.timeout,
      });

      // 写入报告
      const taskDir = await findTaskDir(task.id, iterDir);
      const reportDir = taskDir ? join(taskDir, '99-artifacts') : join(iterDir, '020-specs');
      const reportPath = await writeVerifyReport(report, reportDir);

      logReport(report, reportPath);
      return;
    }

    // 迭代级验证：对整个 code_scope 验证
    spinner.stop();
    const report = await runVerification(`Iteration-${iteration}`, codePath, {
      type: options.type || 'all',
      timeout: options.timeout,
    });

    // 写入报告到迭代级
    const reportDir = join(iterDir, '020-specs');
    const reportPath = await writeVerifyReport(report, reportDir);

    logReport(report, reportPath);
  } catch (error) {
    spinner.fail(`验证失败: ${error}`);
    throw error;
  }
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 查找任务对应的代码路径
 */
async function findTaskCodePath(task: TaskState, iterDir: string, defaultCodePath: string): Promise<string> {
  // 1. 检查任务目录下是否有 code/ 子目录
  const taskDir = await findTaskDir(task.id, iterDir);
  if (taskDir) {
    const codeDir = join(taskDir, 'code');
    if (await pathExists(codeDir)) return codeDir;
  }

  // 2. 使用默认代码路径
  return defaultCodePath;
}

/**
 * 查找任务目录（兼容多种布局）
 */
async function findTaskDir(taskId: string, iterDir: string): Promise<string | null> {
  const candidates = [
    join(iterDir, '030-tasks', taskId),
    join(iterDir, taskId),
  ];
  for (const c of candidates) {
    if (await pathExists(c)) return c;
  }
  return null;
}

/**
 * 格式化输出报告
 */
function logReport(report: VerifyReport, reportPath: string): void {
  const { summary } = report;
  const passRate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;

  logger.info('');
  logger.info(`📊 验证报告 — ${report.taskId}`);
  logger.info(`   项目类型: ${report.projectType}`);
  logger.info(`   代码路径: ${report.codePath}`);
  logger.info('');

  for (const check of report.checks) {
    const icon = check.status === 'pass' ? '✅' : check.status === 'fail' ? '❌' : check.status === 'warn' ? '⚠️' : '⏭️';
    const dur = check.duration > 0 ? `(${(check.duration / 1000).toFixed(1)}s)` : '';
    logger.info(`   ${icon} ${check.name}: ${check.details} ${dur}`);
  }

  logger.info('');
  logger.info(`   通过率: ${passRate}% (${summary.passed}/${summary.total})`);

  if (summary.failed > 0) {
    logger.warn(`   ❌ ${summary.failed} 项检查失败`);
  }
  if (summary.warnings > 0) {
    logger.info(`   ⚠️ ${summary.warnings} 项警告`);
  }

  logger.info('');
  logger.info(`   📄 报告: ${reportPath}`);

  if (summary.failed > 0) {
    logger.info('');
    logger.info('💡 下一步:');
    logger.info(`   修复失败项后重新运行: speccore verify -t ${report.taskId}`);
  }
}
