/**
 * handover - 生成交接文档命令
 * 汇总期次关键信息、待办事项和风险点
 */

import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { writeFile, pathExists, readFile, readdir } from 'fs-extra';
import { join } from 'path';

export interface HandoverOptions {
  iteration?: string;
  output?: string;
  format?: string;
}

export async function handoverCommand(options: HandoverOptions): Promise<void> {
  const spinner = new Spinner('正在生成交接文档...');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
  const iterDir = iteration.startsWith("期次-") ? iteration : `期次-${iteration}`;
    if (!iteration) {
      spinner.fail('未找到活跃期次。请先运行: speccore iteration create --name <名称>');
      return;
    }

    const doc = await generateHandoverDoc(iteration);
    const format = options.format || 'md';
    const outputPath =
      options.output || join(process.cwd(), iterDir, '00-期次总览', `交接文档.${format}`);

    await writeFile(outputPath, doc);

    spinner.stop(`交接文档已生成: ${outputPath}`);
    logger.info('');
    logger.info('📋 交接文档包含:');
    logger.info('   - 期次概览');
    logger.info('   - 任务完成情况');
    logger.info('   - 关键决策记录');
    logger.info('   - 待办事项');
    logger.info('   - 风险与建议');
  } catch (error) {
    spinner.fail(`交接文档生成失败: ${error}`);
    throw error;
  }
}

async function generateHandoverDoc(iteration: string): Promise<string> {
  const iterDir = join(process.cwd(), iteration);
  const now = new Date().toISOString().split('T')[0];

  // 扫描任务
  const tasks = await scanTasks(iterDir);
  const completed = tasks.filter((t) => t.status === 'completed');
  const inProgress = tasks.filter((t) => t.status === 'in_progress');
  const pending = tasks.filter((t) => t.status === 'pending');

  let doc = `# ${iteration} - 交接文档\n\n`;
  doc += `> 生成日期: ${now} | 生成工具: SpecCore\n\n`;
  doc += `---\n\n`;

  // 1. 期次概览
  doc += `## 1. 期次概览\n\n`;
  doc += `| 指标 | 数值 |\n`;
  doc += `| :--- | :--- |\n`;
  doc += `| 期次名称 | ${iteration} |\n`;
  doc += `| 总任务数 | ${tasks.length} |\n`;
  doc += `| 已完成 | ${completed.length} |\n`;
  doc += `| 进行中 | ${inProgress.length} |\n`;
  doc += `| 待开发 | ${pending.length} |\n`;
  doc += `| 完成率 | ${tasks.length > 0 ? Math.round((completed.length / tasks.length) * 100) : 0}% |\n\n`;

  // 2. 任务详情
  doc += `## 2. 任务详情\n\n`;

  if (completed.length > 0) {
    doc += `### ✅ 已完成任务\n\n`;
    doc += `| 任务 | 类型 | 完成日期 |\n`;
    doc += `| :--- | :--- | :--- |\n`;
    for (const t of completed) {
      doc += `| ${t.id} - ${t.name} | ${t.type} | ${t.endDate || '-'} |\n`;
    }
    doc += `\n`;
  }

  if (inProgress.length > 0) {
    doc += `### 🟦 进行中任务\n\n`;
    doc += `| 任务 | 类型 | 进度 | 阻塞项 |\n`;
    doc += `| :--- | :--- | :--- | :--- |\n`;
    for (const t of inProgress) {
      doc += `| ${t.id} - ${t.name} | ${t.type} | ${t.progress}% | ${t.blockers.join(', ') || '-'} |\n`;
    }
    doc += `\n`;
  }

  if (pending.length > 0) {
    doc += `### 🔲 待开发任务\n\n`;
    doc += `| 任务 | 类型 | 优先级 |\n`;
    doc += `| :--- | :--- | :--- |\n`;
    for (const t of pending) {
      doc += `| ${t.id} - ${t.name} | ${t.type} | ${t.priority || '-'} |\n`;
    }
    doc += `\n`;
  }

  // 3. 关键决策
  doc += `## 3. 关键决策记录\n\n`;
  // 从 ARCHITECTURE.md 提取
  const archPath = join(iterDir, '00-技术文档', 'ARCHITECTURE.md');
  if (await pathExists(archPath)) {
    const content = await readFile(archPath, 'utf-8');
    const decisions = content.match(/##\s*决策[\s\S]*?(?=\n##|\n---|$)/);
    if (decisions) {
      doc += decisions[0].trim() + '\n\n';
    } else {
      doc += '（无记录）\n\n';
    }
  } else {
    doc += '（无 ARCHITECTURE.md）\n\n';
  }

  // 4. 待办事项
  doc += `## 4. 待办事项\n\n`;
  doc += `- [ ] 审查未完成任务的 Spec 文件\n`;
  doc += `- [ ] 确认所有接口契约已更新\n`;
  doc += `- [ ] 回归测试已完成任务的功能\n\n`;

  // 5. 风险与建议
  doc += `## 5. 风险与建议\n\n`;
  doc += `| 风险项 | 级别 | 建议 |\n`;
  doc += `| :--- | :--- | :--- |\n`;

  if (inProgress.length > 0) {
    doc += `| 有 ${inProgress.length} 个任务仍在进行中 | 中 | 建议在交接前推动完成或重新分配 |\n`;
  }
  if (pending.length > 3) {
    doc += `| 待开发任务较多（${pending.length} 个） | 中 | 建议评估优先级，适当延期部分任务 |\n`;
  }

  doc += `| | | |\n\n`;

  // 6. 附录
  doc += `## 6. 附录\n\n`;
  doc += `### 相关文件\n\n`;
  doc += `- 期次目录: \`${iteration}/\`\n`;
  doc += `- 技术架构: \`${iteration}/00-技术文档/ARCHITECTURE.md\`\n`;
  doc += `- 需求文档: \`${iteration}/00-需求文档/REQUIREMENT.md\`\n`;
  doc += `- 项目图谱: \`${iteration}/00-期次总览/PROJECT_GRAPH.md\`\n`;

  return doc;
}

interface TaskInfo {
  id: string;
  name: string;
  type: string;
  status: 'pending' | 'in_progress' | 'completed';
  progress: number;
  priority?: string;
  startDate?: string;
  endDate?: string;
  blockers: string[];
}

async function scanTasks(iterDir: string): Promise<TaskInfo[]> {
  const tasks: TaskInfo[] = [];

  if (!await pathExists(iterDir)) return tasks;

  const entries = await readdir(iterDir);
  const taskDirs = entries.filter((e) => e.startsWith('Task-'));

  for (const taskDir of taskDirs) {
    const taskInfo: TaskInfo = {
      id: taskDir,
      name: taskDir,
      type: 'feature',
      status: 'pending',
      progress: 0,
      blockers: [],
    };

    // 读取 .task-type
    const typePath = join(iterDir, taskDir, '.task-type');
    if (await pathExists(typePath)) {
      taskInfo.type = (await readFile(typePath, 'utf-8')).trim();
    }

    // 读取 TASK.md 获取状态
    const taskMdPath = join(iterDir, taskDir, 'backend', 'TASK.md');
    if (await pathExists(taskMdPath)) {
      const content = await readFile(taskMdPath, 'utf-8');
      if (content.includes('✅ 已完成')) taskInfo.status = 'completed';
      else if (content.includes('🟦 开发中') || content.includes('进行中'))
        taskInfo.status = 'in_progress';

      // 提取任务名称
      const nameMatch = content.match(/^#\s*(.+?)(?:\s*-\s*执行追踪)?$/m);
      if (nameMatch) {
        taskInfo.name = nameMatch[1].trim();
      }
    }

    tasks.push(taskInfo);
  }

  return tasks;
}
