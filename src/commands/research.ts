/**
 * research - 技术调研命令
 * 创建技术调研任务，评估技术方案、对比工具选项
 */

import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { ensureDir, writeFile, pathExists } from 'fs-extra';
import { join } from 'path';

export interface ResearchOptions {
  name?: string;
  desc?: string;
  topic?: string;
  options?: string;   // 要对比的选项（逗号分隔）
  taskId?: string;
  iteration?: string;
}

export async function researchCommand(options: ResearchOptions): Promise<void> {
  if (!options.name && !options.topic) {
    logger.error('请提供调研主题。用法: speccore research --name "<主题>" [--options "选项A,选项B"]');
    return;
  }

  const spinner = new Spinner('正在创建技术调研任务...');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('未找到活跃期次。请先运行: speccore iteration create --name <名称>');
      return;
    }

    const topic = options.name || options.topic || '技术调研';
    const taskId = options.taskId || await generateTaskId(iteration);
    const compareOptions = options.options
      ? options.options.split(',').map((o) => o.trim())
      : [];

    // 创建调研任务目录
    const taskDir = join(iteration, taskId);
    await ensureDir(join(taskDir, 'backend'));

    // 创建 .task-type
    await writeFile(join(taskDir, '.task-type'), 'research');

    // 生成调研 Spec
    await writeFile(
      join(taskDir, 'backend', 'REQ.md'),
      generateResearchReq(topic, options.desc || '', compareOptions)
    );
    await writeFile(
      join(taskDir, 'backend', 'TASK.md'),
      generateResearchTask(topic, options.desc || '')
    );

    spinner.stop(`技术调研任务已创建: ${taskId}`);
    logger.info('');
    logger.info(`🔬 调研详情:`);
    logger.info(`   期次: ${iteration}`);
    logger.info(`   任务: ${taskId} - ${topic}`);
    if (compareOptions.length > 0) {
      logger.info(`   对比选项: ${compareOptions.join(', ')}`);
    }
    if (options.desc) {
      logger.info(`   描述: ${options.desc}`);
    }
    logger.info('');
    logger.info('下一步:');
    logger.info(`  1. 编辑 ${taskId}/backend/REQ.md 完善调研范围`);
    logger.info(`  2. 运行: speccore execute --task=${taskId}`);
  } catch (error) {
    spinner.fail(`调研任务创建失败: ${error}`);
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

function generateResearchReq(topic: string, desc: string, options: string[]): string {
  let optionsSection = '';
  if (options.length > 0) {
    optionsSection = '\n## 3. 候选方案\n\n';
    for (const opt of options) {
      optionsSection += `### ${opt}\n\n- 优势：\n- 劣势：\n- 适用场景：\n\n`;
    }
  }

  return `# ${topic} - 技术调研需求

## 1. 调研背景

${desc || '请补充调研背景'}

## 2. 调研目标

- 
- 
${optionsSection}
## ${options.length > 0 ? '4' : '3'}. 评估维度

| 维度 | 权重 | 说明 |
| :--- | :--- | :--- |
| 性能 | 30% | |
| 易用性 | 25% | |
| 生态/社区 | 20% | |
| 维护成本 | 15% | |
| 团队熟悉度 | 10% | |

## ${options.length > 0 ? '5' : '4'}. 决策标准

- 
- 

## ${options.length > 0 ? '6' : '5'}. 产出物

- [ ] 技术调研报告
- [ ] Demo 代码（如适用）
- [ ] 推荐方案及理由
`;
}

function generateResearchTask(topic: string, desc: string): string {
  const now = new Date().toISOString().split('T')[0];
  return `# ${topic} - 执行追踪

> **任务类型**: research | **创建日期**: ${now} | **状态**: 🔲 待开发

## 1. 变更履历

| 日期 | 版本 | 变更说明 | 作者 |
| :--- | :--- | :--- | :--- |
| ${now} | v1.0 | 初始创建：${desc || topic} | SpecCore |

## 2. 调研步骤

- [ ] 信息收集
- [ ] 对比分析
- [ ] Demo 验证
- [ ] 撰写报告
- [ ] 团队评审

## 3. 参考资源

| 资源 | 链接 | 备注 |
| :--- | :--- | :--- |
| | | |

## 4. 结论与建议

（调研完成后填写）
`;
}
