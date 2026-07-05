/**
 * change - 需求变更联动命令
 * 修改任务需求时，自动更新关联 Spec 文件
 */

import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { readFile, writeFile, pathExists, readdir } from 'fs-extra';
import { join } from 'path';

export interface ChangeOptions {
  task?: string;
  desc?: string;
  global?: boolean;
  iteration?: string;
  dryRun?: boolean;
  force?: boolean;
}

export async function changeCommand(options: ChangeOptions): Promise<void> {
  if (!options.task && !options.global) {
    logger.error('请指定要变更的 Task 或使用 --global。用法: speccore change --task=<Task编号> --desc="<变更描述>"');
    return;
  }

  if (!options.desc) {
    logger.error('请提供变更描述。用法: speccore change --desc="<变更描述>"');
    return;
  }

  const spinner = new Spinner('正在分析变更影响...');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration && !options.global) {
      spinner.fail('未找到活跃期次。请先运行: speccore iteration create --name <名称>');
      return;
    }

    if (options.dryRun) {
      await dryRunChange(options, iteration);
      spinner.stop('变更预览完成（--dry-run 模式，未实际修改）');
      return;
    }

    if (options.global) {
      await applyGlobalChange(options);
    } else {
      await applyTaskChange(options, iteration);
    }

    spinner.stop('需求变更已生效');
    logger.info('');
    logger.info('下一步:');
    logger.info('  1. 运行 speccore validate --task=' + (options.task || '') + ' 验证完整性');
    logger.info('  2. 检查受影响的下游任务是否需要回归');
  } catch (error) {
    spinner.fail(`变更失败: ${error}`);
    throw error;
  }
}

async function dryRunChange(options: ChangeOptions, iteration: string): Promise<void> {
  if (options.global) {
    logger.info('🔍 全局层变更影响分析：');
    logger.info('');
    logger.info('| 文件 | 影响描述 |');
    logger.info('| :--- | :--- |');
    logger.info('| .speccore/CONSTITUTION.md | 全局配置变更 |');
    logger.info('| 所有期次的 TECH.md | 架构方案需同步 |');
    logger.info('');
    return;
  }

  logger.info(`🔍 ${options.task} 变更影响分析：`);
  logger.info('');
  logger.info(`变更描述: ${options.desc}`);

  if (iteration) {
    const taskDir = join(process.cwd(), iteration, options.task || '');
    logger.info('| 文件 | 影响描述 |');
    logger.info('| :--- | :--- |');
    logger.info(`| ${options.task}/backend/REQ.md | 需求变更 |`);
    logger.info(`| ${options.task}/backend/TECH.md | 方案需调整 |`);
    logger.info(`| ${options.task}/_shared/API_CONTRACT.yaml | 接口契约可能需更新 |`);

    // 查找受影响的依赖任务
    if (await pathExists(taskDir)) {
      const graphPath = join(process.cwd(), iteration, '00-期次总览', 'PROJECT_GRAPH.md');
      if (await pathExists(graphPath)) {
        const content = await readFile(graphPath, 'utf-8');
        const deps = findDependentTasks(content, options.task || '');
        if (deps.length > 0) {
          logger.info('');
          logger.warn('🔗 受影响下游任务：');
          for (const dep of deps) {
            logger.info(`   ${dep} → 🔶 待回归`);
          }
        }
      }
    }
  }
}

async function applyTaskChange(options: ChangeOptions, iteration: string): Promise<void> {
  if (!options.task) {
    logger.error('请指定 --task');
    return;
  }

  const taskDir = join(process.cwd(), iteration, options.task);
  if (!await pathExists(taskDir)) {
    logger.error(`任务目录不存在: ${taskDir}`);
    return;
  }

  // 更新 REQ.md
  const reqPath = join(taskDir, 'backend', 'REQ.md');
  if (await pathExists(reqPath)) {
    let content = await readFile(reqPath, 'utf-8');
    const now = new Date().toISOString().split('T')[0];
    const changeNote = `\n## 变更记录\n\n| ${now} | v1.1 | ${options.desc} | SpecCore |\n`;
    content += changeNote;
    await writeFile(reqPath, content);
    logger.info(`✅ 已更新: ${options.task}/backend/REQ.md`);
  }

  // 更新 TASK.md 变更履历
  const taskMdPath = join(taskDir, 'backend', 'TASK.md');
  if (await pathExists(taskMdPath)) {
    let content = await readFile(taskMdPath, 'utf-8');
    const now = new Date().toISOString().split('T')[0];
    const changeEntry = `| ${now} | v1.1 | 需求变更: ${options.desc} | SpecCore |\n`;
    // 在变更履历表格后插入
    content = content.replace(
      /(\| :--- \| :--- \| :--- \| :--- \|)/,
      `$1\n${changeEntry}`
    );
    await writeFile(taskMdPath, content);
    logger.info(`✅ 已更新: ${options.task}/backend/TASK.md`);
  }
}

async function applyGlobalChange(options: ChangeOptions): Promise<void> {
  // 更新 CONSTITUTION.md 的变更记录
  const constPath = join(process.cwd(), '.speccore', 'CONSTITUTION.md');
  if (await pathExists(constPath)) {
    let content = await readFile(constPath, 'utf-8');
    const now = new Date().toISOString().split('T')[0];
    content += `\n## 变更记录\n\n| ${now} | ${options.desc} | SpecCore |\n`;
    await writeFile(constPath, content);
    logger.info('✅ 已更新: .speccore/CONSTITUTION.md');
  }
}

function findDependentTasks(graphContent: string, taskName: string): string[] {
  const deps: string[] = [];
  const lines = graphContent.split('\n');
  for (const line of lines) {
    // 查找依赖关系：Task 行中包含对目标 Task 的引用
    if (line.includes(taskName) && !line.includes(`| ${taskName} |`)) {
      const match = line.match(/Task-\d+/g);
      if (match) {
        for (const t of match) {
          if (t !== taskName && !deps.includes(t)) {
            deps.push(t);
          }
        }
      }
    }
  }
  return deps;
}
