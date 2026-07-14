/**
 * retro - 期次回顾命令
 * 总结期次经验和改进建议
 */

import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { writeFile, pathExists, readFile, readdir } from 'fs-extra';
import { join } from 'path';

export interface RetroOptions {
  iteration?: string;
  output?: string;
}

export async function retroCommand(options: RetroOptions): Promise<void> {
  const spinner = new Spinner('正在生成期次回顾...');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
  const iterDir = iteration.startsWith("期次-") ? iteration : `期次-${iteration}`;
    if (!iteration) {
      spinner.fail('未找到活跃期次。请先运行: speccore iteration create --name <名称>');
      return;
    }

    const doc = await generateRetroDoc(iteration);
    const outputPath =
      options.output || join(process.cwd(), iterDir, '00-期次总览', '回顾总结.md');

    await writeFile(outputPath, doc);

    spinner.stop(`期次回顾已生成: ${outputPath}`);
    logger.info('');
    logger.info('📝 回顾包含:');
    logger.info('   - 期次数据统计');
    logger.info('   - 做得好的 (Went Well)');
    logger.info('   - 待改进的 (To Improve)');
    logger.info('   - 行动计划 (Action Items)');
  } catch (error) {
    spinner.fail(`期次回顾生成失败: ${error}`);
    throw error;
  }
}

async function generateRetroDoc(iteration: string): Promise<string> {
  const iterDir = join(process.cwd(), iteration);
  const now = new Date().toISOString().split('T')[0];

  // 收集统计数据
  const stats = await collectStats(iterDir, iteration);

  let doc = `# ${iteration} - 期次回顾\n\n`;
  doc += `> 回顾日期: ${now} | 生成工具: SpecCore\n\n`;
  doc += `---\n\n`;

  // 1. 期次数据
  doc += `## 1. 期次数据\n\n`;
  doc += `| 指标 | 数值 |\n`;
  doc += `| :--- | :--- |\n`;
  doc += `| 期次名称 | ${iteration} |\n`;
  doc += `| 总任务数 | ${stats.totalTasks} |\n`;
  doc += `| 完成任务数 | ${stats.completedTasks} |\n`;
  doc += `| 完成率 | ${stats.completionRate}% |\n`;
  doc += `| 任务类型分布 | ${stats.typeDistribution} |\n\n`;

  // 2. 做得好的
  doc += `## 2. 做得好的 👍\n\n`;
  doc += `| 方面 | 具体表现 | 可复用经验 |\n`;
  doc += `| :--- | :--- | :--- |\n`;
  doc += `| | | |\n`;
  doc += `| | | |\n`;
  doc += `| | | |\n\n`;

  // 3. 待改进的
  doc += `## 3. 待改进的 🔧\n\n`;
  doc += `| 方面 | 问题描述 | 影响 | 改进建议 |\n`;
  doc += `| :--- | :--- | :--- | :--- |\n`;
  doc += `| | | | |\n`;
  doc += `| | | | |\n`;
  doc += `| | | | |\n\n`;

  // 4. 行动计划
  doc += `## 4. 行动计划 📋\n\n`;
  doc += `| 行动项 | 负责人 | 截止日期 | 优先级 |\n`;
  doc += `| :--- | :--- | :--- | :--- |\n`;

  if (stats.completionRate < 100) {
    doc += `| 完成剩余 ${stats.totalTasks - stats.completedTasks} 个任务 | 待分配 | | 高 |\n`;
  }
  doc += `| 更新项目 PATTERNS 模式库 | | | 中 |\n`;
  doc += `| 整理技术文档 | | | 中 |\n`;
  doc += `| | | | |\n\n`;

  // 5. 下期展望
  doc += `## 5. 下期展望\n\n`;
  const archPath = join(iterDir, '00-需求文档', 'REQUIREMENT.md');
  if (await pathExists(archPath)) {
    const content = await readFile(archPath, 'utf-8');
    const nextMatch = content.match(/下期|后续|下一期/);
    if (nextMatch) {
      doc += '请参考需求文档中的下期规划。\n\n';
    } else {
      doc += '（请在需求文档中补充下期规划）\n\n';
    }
  } else {
    doc += '（请创建需求文档）\n\n';
  }

  return doc;
}

async function collectStats(
  iterDir: string,
  _iteration: string
): Promise<{
  totalTasks: number;
  completedTasks: number;
  completionRate: number;
  typeDistribution: string;
}> {
  let totalTasks = 0;
  let completedTasks = 0;
  const types: Record<string, number> = {};

  if (await pathExists(iterDir)) {
    const entries = await readdir(iterDir);
    const taskDirs = entries.filter((e) => e.startsWith('Task-'));

    for (const taskDir of taskDirs) {
      totalTasks++;

      const typePath = join(iterDir, taskDir, '.task-type');
      if (await pathExists(typePath)) {
        const type = (await readFile(typePath, 'utf-8')).trim();
        types[type] = (types[type] || 0) + 1;
      }

      const taskMdPath = join(iterDir, taskDir, 'backend', 'TASK.md');
      if (await pathExists(taskMdPath)) {
        const content = await readFile(taskMdPath, 'utf-8');
        if (content.includes('✅ 已完成')) {
          completedTasks++;
        }
      }
    }
  }

  const completionRate =
    totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const typeDist = Object.entries(types)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  return {
    totalTasks,
    completedTasks,
    completionRate,
    typeDistribution: typeDist || '-',
  };
}
