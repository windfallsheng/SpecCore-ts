import { ensureDir, writeFile, pathExists, readFile } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../../utils/logger';
import { updateContext } from '../../core/context';

export interface IterationCreateOptions {
  name?: string;
  from?: string;
  to?: string;
}

export async function iterationCreateCommand(options: IterationCreateOptions): Promise<void> {
  if (!options.name) {
    logger.error('Iteration name is required. Use --name <name>');
    return;
  }

  const spinner = new Spinner(`Creating iteration: ${options.name}`);
  spinner.start();

  try {
    // Strip leading 期次- prefix if user already included it
    const iterName = options.name.replace(/^期次-/, '');
    const iterationDir = `期次-${iterName}`;

    // Check if already exists
    if (await pathExists(iterationDir)) {
      spinner.fail(`Iteration already exists: ${options.name}`);
      return;
    }

    // Create directory structure
    await ensureDir(join(iterationDir, '00-需求文档'));
    await ensureDir(join(iterationDir, '00-技术文档'));
    await ensureDir(join(iterationDir, '00-期次总览'));

    // Create default files
    await createIterationFiles(iterationDir, options);

    // Update ITERATIONS index
    await updateIterationsIndex(options.name, options);

    // Update context (store without 期次- prefix for consistency)
    await updateContext({
      currentIteration: iterName,
      lastUpdated: new Date().toISOString()
    });

    spinner.stop(`Iteration created: ${options.name}`);
    logger.info('');
    logger.info('Next steps:');
    logger.info(`  1. Edit ${iterationDir}/00-需求文档/REQUIREMENT.md`);
    logger.info(`  2. Edit ${iterationDir}/00-技术文档/ARCHITECTURE.md`);
    logger.info(`  3. Run: speccore iteration split`);
  } catch (error) {
    spinner.fail(`Failed to create iteration: ${error}`);
    throw error;
  }
}

async function createIterationFiles(iterationDir: string, options: IterationCreateOptions): Promise<void> {
  // REQUIREMENT.md
  await writeFile(
    join(iterationDir, '00-需求文档', 'REQUIREMENT.md'),
    `# 本期需求文档

> 期次：${options.name}
> 时间范围：${options.from || '未指定'} ~ ${options.to || '未指定'}

## 1. 需求概述

### 1.1 背景

### 1.2 目标

### 1.3 范围

## 2. 功能需求

### 2.1 功能模块一

### 2.2 功能模块二

## 3. 非功能需求

### 3.1 性能

### 3.2 安全

### 3.3 兼容性

## 4. 验收标准

## 5. 附录
`
  );

  // ARCHITECTURE.md
  await writeFile(
    join(iterationDir, '00-技术文档', 'ARCHITECTURE.md'),
    `# 本期技术文档

> 期次：${options.name}

## 1. 技术架构

### 1.1 整体架构

### 1.2 技术选型

## 2. 接口设计

## 3. 数据库设计

## 4. 部署方案

## 5. 风险与应对
`
  );

  // PROJECT_GRAPH.md
  await writeFile(
    join(iterationDir, '00-期次总览', 'PROJECT_GRAPH.md'),
    `# 本期任务总览

> 期次：${options.name}
> 时间范围：${options.from || '未指定'} ~ ${options.to || '未指定'}
> 期次状态：🔄 进行中

## 任务列表

| 任务编号 | 任务名称 | 类型 | 进度 | 状态 | 负责人 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| | | | | | |

## 依赖图谱

\`\`\`mermaid
graph TD
  A[Task-001] --> B[Task-002]
\`\`\`

## 状态看板

| 待开发 | 进行中 | 已完成 | 已归档 |
| :--- | :--- | :--- | :--- |
| | | | |
`
  );
}

async function updateIterationsIndex(name: string, options: IterationCreateOptions): Promise<void> {
  const indexPath = join('.speccore', 'ITERATIONS', 'README.md');
  
  let content = '';
  if (await pathExists(indexPath)) {
    content = await readFile(indexPath, 'utf-8');
  } else {
    content = '# 期次索引\n\n| 期次名称 | 时间范围 | 状态 | 负责人 | 备注 |\n| :--- | :--- | :--- | :--- | :--- |\n';
  }

  // Add new iteration entry
  const dateRange = `${options.from || '未指定'} ~ ${options.to || '未指定'}`;
  const newEntry = `| ${name} | ${dateRange} | 🔄 进行中 | | |\n`;
  
  content += newEntry;
  await writeFile(indexPath, content);
}
