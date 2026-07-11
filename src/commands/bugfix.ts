/**
 * bugfix - 快速 Bug 修复命令
 * 创建修复任务，自动标注受影响文件和回归范围
 */

import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { ensureDir, writeFile, pathExists } from 'fs-extra';
import { FileTransaction } from '../core/transaction';
import { join } from 'path';

export interface BugfixOptions {
  name?: string;
  desc?: string;
  taskId?: string;
  iteration?: string;
  affectedTask?: string;
}

export async function bugfixCommand(options: BugfixOptions): Promise<void> {
  if (!options.name && !options.desc) {
    logger.error('请提供 Bug 描述。用法: speccore bugfix --name "<Bug名称>" [--desc "<详细描述>"]');
    return;
  }

  const spinner = new Spinner('正在创建 Bug 修复任务...');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('未找到活跃期次。请先运行: speccore iteration create --name <名称>');
      return;
    }

    const bugName = options.name || 'Bug修复';
    const taskId = options.taskId || await generateTaskId(iteration);

    // 创建修复任务目录
    const taskDir = join(iteration, taskId);
    await ensureDir(join(taskDir, 'backend'));

    // 创建 .task-type
    await writeFile(join(taskDir, '.task-type'), 'bugfix');

    // 生成修复 Spec
    await writeFile(
      join(taskDir, 'backend', 'REQ.md'),
      generateBugfixReq(bugName, options.desc || '', options.affectedTask)
    );
    await writeFile(
      join(taskDir, 'backend', 'TASK.md'),
      generateBugfixTask(bugName, options.desc || '', options.affectedTask)
    );

    spinner.stop(`Bug 修复任务已创建: ${taskId}`);
    logger.info('');
    logger.info(`🐛 Bug 修复详情:`);
    logger.info(`   期次: ${iteration}`);
    logger.info(`   任务: ${taskId} - ${bugName}`);
    if (options.affectedTask) {
      logger.info(`   ⚠️ 受影响任务: ${options.affectedTask}`);
    }
    if (options.desc) {
      logger.info(`   描述: ${options.desc}`);
    }
    logger.info('');
    logger.info('下一步:');
    logger.info(`  1. 编辑 ${taskId}/backend/REQ.md 补充根因分析`);
    logger.info('  2. 运行: speccore execute --task=' + taskId);
  } catch (error) {
    spinner.fail(`Bug 修复任务创建失败: ${error}`);
    throw error;
  }
}

async function generateTaskId(iteration: string): Promise<string> {
  let maxId = 0;
  const iterationDir = join(process.cwd(), iteration);
  if (await pathExists(iterationDir)) {
    const { readdir } = await import('fs-extra');
    const entries = await readdir(iterationDir);
    for (const entry of entries) {
      const match = entry.match(/^Task-(\d+)$/);
      if (match) {
        const id = parseInt(match[1], 10);
        if (id > maxId) maxId = id;
      }
    }
  }
  return `Task-${String(maxId + 1).padStart(3, '0')}`;
}

function generateBugfixReq(name: string, desc: string, affectedTask?: string): string {
  return `# ${name} - Bug 修复需求

## 1. 问题描述

${desc || '请补充问题描述'}

## 2. 复现步骤

1. 
2. 
3. 

## 3. 预期行为

- 

## 4. 实际行为

- 

${affectedTask ? `
## 5. 受影响任务

- ${affectedTask} → 🔶 待回归
` : ''}

## 6. 根因分析

- 

## 7. 修复方案

- 

## 8. 验收标准

- [ ] Bug 不再复现
- [ ] 回归测试通过
- [ ] 相关 Spec 文件已同步更新
`;
}

function generateBugfixTask(name: string, desc: string, affectedTask?: string): string {
  const now = new Date().toISOString().split('T')[0];
  return `# ${name} - 执行追踪

> **任务类型**: bugfix | **创建日期**: ${now} | **状态**: 🔲 待开发

## 1. 变更履历

| 日期 | 版本 | 变更说明 | 作者 |
| :--- | :--- | :--- | :--- |
| ${now} | v1.0 | 初始创建：${desc} | SpecCore |

## 2. 修复步骤

- [ ] 根因定位
- [ ] 编写修复代码
- [ ] 单元测试
- [ ] 回归测试${affectedTask ? ` (含 ${affectedTask})` : ''}
- [ ] Spec 同步更新

## 3. 影响范围

| 受影响文件 | 影响描述 | 状态 |
| :--- | :--- | :--- |
| | | |

## 4. 线上问题记录

| 日期 | 问题描述 | 根因 | 修复方案 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| ${now} | ${desc} | 待分析 | 待制定 | 🔲 |
`;
}
