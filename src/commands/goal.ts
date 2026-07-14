/**
 * goal - 完整需求交付命令
 * 从需求描述出发，自动创建任务并生成完整的 Spec 文档结构
 */

import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { ensureDir, writeFile, pathExists } from 'fs-extra';
import { generateTaskId } from '../utils/task-utils';
import { join } from 'path';

export interface GoalOptions {
  name?: string;
  desc?: string;
  type?: string;
  taskId?: string;
  iteration?: string;
  backendOnly?: boolean;
  frontendOnly?: boolean;
}

export async function goalCommand(options: GoalOptions): Promise<void> {
  if (!options.name && !options.desc) {
    logger.error('请提供功能名称或描述。用法: speccore goal --name "<功能名>" [--desc "<描述>"]');
    return;
  }

  const spinner = new Spinner('正在创建完整需求交付...');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('未找到活跃期次。请先运行: speccore iteration create --name <名称>');
      return;
    }

    const taskName = options.name || '新功能';
    const taskType = options.type || 'feature';
    const taskId = options.taskId || await generateTaskId(iteration);
    const taskDir = join(iteration, taskId);

    // 创建任务目录结构
    await ensureDir(join(taskDir, 'backend'));
    await ensureDir(join(taskDir, 'frontend'));
    await ensureDir(join(taskDir, '_shared'));

    // 创建 .task-type
    await writeFile(join(taskDir, '.task-type'), taskType);

    // 生成后端 Spec 文件
    if (!options.frontendOnly) {
      await writeFile(
        join(taskDir, 'backend', 'REQ.md'),
        generateBackendReq(taskName, options.desc || '')
      );
      await writeFile(
        join(taskDir, 'backend', 'TECH.md'),
        generateBackendTech(taskName, options.desc || '')
      );
      await writeFile(
        join(taskDir, 'backend', 'TASK.md'),
        generateTask(taskName, taskType, options.desc || '')
      );
    }

    // 生成前端 Spec 文件
    if (!options.backendOnly) {
      await writeFile(
        join(taskDir, 'frontend', 'REQ.md'),
        generateFrontendReq(taskName, options.desc || '')
      );
      await writeFile(
        join(taskDir, 'frontend', 'TECH.md'),
        generateFrontendTech(taskName, options.desc || '')
      );
      await writeFile(
        join(taskDir, 'frontend', 'TASK.md'),
        generateTask(taskName, taskType, options.desc || '')
      );
    }

    // 生成 API 契约
    await writeFile(
      join(taskDir, '_shared', 'API_CONTRACT.yaml'),
      generateApiContract(taskName, options.desc || '')
    );

    spinner.stop(`需求交付已创建: ${taskId}`);
    logger.info('');
    logger.info(`📋 任务详情:`);
    logger.info(`   期次: ${iteration}`);
    logger.info(`   任务: ${taskId} - ${taskName}`);
    logger.info(`   类型: ${taskType}`);
    if (options.desc) {
      logger.info(`   描述: ${options.desc}`);
    }
    logger.info('');
    logger.info('下一步:');
    logger.info(`  1. 编辑 ${taskId}/backend/REQ.md 补充需求细节`);
    logger.info(`  2. 编辑 ${taskId}/backend/TECH.md 完善技术方案`);
    logger.info('  3. 运行: speccore execute --all');
  } catch (error) {
    spinner.fail(`需求交付创建失败: ${error}`);
    throw error;
  }
}

function generateBackendReq(name: string, desc: string): string {
  return `# ${name} - 后端需求

## 1. 需求描述

${desc || '请补充功能描述'}

## 2. 业务规则

1. 
2. 

## 3. 验收标准

- [ ] 
- [ ] 

## 4. 非功能需求

- 性能：
- 安全：
- 可用性：
`;
}

function generateBackendTech(name: string, desc: string): string {
  return `# ${name} - 后端技术方案

## 1. 方案概述

${desc || '请补充技术方案概述'}

## 2. 核心设计

### 2.1 接口设计

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| | | |

### 2.2 数据模型

\`\`\`
（请补充数据模型）
\`\`\`

## 3. 技术决策

| 决策项 | 方案 | 理由 |
| :--- | :--- | :--- |
| | | |
`;
}

function generateFrontendReq(name: string, desc: string): string {
  return `# ${name} - 前端需求

## 1. 页面描述

${desc || '请补充页面功能描述'}

## 2. 交互流程

1. 
2. 

## 3. UI 要求

- 
- 

## 4. 验收标准

- [ ] 
- [ ] 
`;
}

function generateFrontendTech(name: string, desc: string): string {
  return `# ${name} - 前端技术方案

## 1. 方案概述

${desc || '请补充前端技术方案概述'}

## 2. 组件设计

### 2.1 组件树

\`\`\`
（请补充组件树结构）
\`\`\`

### 2.2 状态管理

\`\`\`
（请补充状态设计）
\`\`\`

## 3. 技术决策

| 决策项 | 方案 | 理由 |
| :--- | :--- | :--- |
| | | |
`;
}

function generateTask(name: string, type: string, desc: string): string {
  const now = new Date().toISOString().split('T')[0];
  return `# ${name} - 执行追踪

> **任务类型**: ${type} | **创建日期**: ${now} | **状态**: 🔲 待开发

## 1. 变更履历

| 日期 | 版本 | 变更说明 | 作者 |
| :--- | :--- | :--- | :--- |
| ${now} | v1.0 | 初始创建 | SpecCore |

## 2. 任务描述

${desc || '请补充任务描述'}

## 3. 子任务

- [ ] 需求分析
- [ ] 方案设计
- [ ] 编码实现
- [ ] 测试验证
- [ ] 代码审查

## 4. 产出物清单

| 产出物 | 路径 | 状态 |
| :--- | :--- | :--- |
| | | |
`;
}

function generateApiContract(name: string, desc: string): string {
  return `# ${name} - API 契约
# OpenAPI 3.0.3
openapi: "3.0.3"
info:
  title: ${name}
  description: ${desc || '请补充接口描述'}
  version: "1.0.0"

paths:
  # 请在此定义 API 路径
  # /api/v1/resource:
  #   post:
  #     summary: 
  #     requestBody:
  #       content:
  #         application/json:
  #           schema:
  #             type: object
  #     responses:
  #       '200':
  #         description: 成功

components:
  schemas:
    # 请在此定义数据模型
`;
}
