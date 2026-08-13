/**
 * iteration-from-global - 从全量层生成迭代命令
 * 从 GLOBAL/INDEX.md 查找需求 ID，定位到对应项目 REQUIREMENT.md 提取需求，生成新的迭代
 */

import { logger, Spinner } from '../utils/logger';
import { ensureDir, writeFile, pathExists, readFile } from 'fs-extra';
import { FileTransaction } from '../core/transaction';
import { join } from 'path';
import { backupWithTimestamp } from '../utils/task-utils';
import { nextTaskId } from '../core/global-counters';
import { readGlobalIndex, readRequirementDetail, appendIterationLink, updateReqInIndex, updateIndexVersion, bumpGlobalVersion } from '../core/global-layer';
import { updateContext, Context } from '../core/context';

export interface IterationFromGlobalOptions {
  reqs?: string;
  name?: string;
  force?: boolean;
}

export async function iterationFromGlobalCommand(options: IterationFromGlobalOptions): Promise<void> {
  if (!options.reqs) {
    logger.error('请提供需求 ID 列表。用法: speccore iteration-from-global --reqs=REQ-001,REQ-002 --name=<迭代名称>');
    logger.info('提示: 使用 speccore global-status 查看可用的需求列表');
    return;
  }

  if (!options.name) {
    logger.error('请提供迭代名称。用法: speccore iteration-from-global --name=<迭代名称>');
    return;
  }

  const spinner = new Spinner('读取全量层需求...');
  spinner.start();

  try {
    // 1. 读取全量索引
    const index = await readGlobalIndex();
    const reqIds = options.reqs.split(',').map((r) => r.trim()).filter(Boolean);

    // 2. 查找需求
    const foundReqs: typeof index.reqs = [];
    const notFound: string[] = [];

    for (const reqId of reqIds) {
      const req = index.reqs.find((r) => r.id === reqId);
      if (req) {
        foundReqs.push(req);
      } else {
        notFound.push(reqId);
      }
    }

    if (notFound.length > 0) {
      spinner.fail(`以下需求 ID 不存在: ${notFound.join(', ')}`);
      logger.info('请运行 speccore global-status 查看可用需求列表');
      return;
    }

    // 3. 读取需求详情
    spinner.stop(`找到 ${foundReqs.length} 个需求，正在生成迭代...`);
    const reqDetails: { req: typeof index.reqs[0]; detail: string }[] = [];

    for (const req of foundReqs) {
      const detail = await readRequirementDetail(req.project, req.id);
      reqDetails.push({ req, detail: detail || `### ${req.id}：${req.name}\n\n（需求详情从 ${req.filePath} 读取）` });
    }

    // 4. 预览方案
    logger.info('');
    logger.info(`📋 准备生成迭代: ${options.name}`);
    logger.info('');
    logger.info('选择需求:');
    for (const { req } of reqDetails) {
      logger.info(`   ${req.id}: ${req.name}（${req.project}）`);
    }
    logger.info('');

    // 5. 创建迭代目录
    const iterationDir = join(process.cwd(), `Iteration-${options.name}`);
    if (await pathExists(iterationDir)) {
      if (!options.force) {
        logger.error(`迭代 Iteration-${options.name} 已存在。使用 --force 覆盖。`);
        return;
      }
    }

    await ensureDir(join(iterationDir, '020-specs'));
    await ensureDir(join(iterationDir, '000-overview'));

    // 6. 生成需求文档
    const reqContent = generateIterationRequirement(options.name, reqDetails);
    const reqPath = join(iterationDir, '020-specs', 'REQUIREMENT.md');
    const bk = await backupWithTimestamp(reqPath);
    if (bk) logger.info(`   📦 旧版已备份: ${bk.split('/').pop()}`);
    await writeFile(reqPath, reqContent);

    // 7. 生成架构文档
    const archContent = generateIterationArchitecture(options.name, foundReqs);
    await writeFile(join(iterationDir, '000-overview', 'ARCHITECTURE.md'), archContent);

    // 8. 自动拆分 Task（先生成以获取实际任务 ID）
    const taskIds = await autoSplitTasks(iterationDir, foundReqs);

    // 9. 生成迭代总览（使用实际任务 ID）
    const graphContent = generateProjectGraph(options.name, foundReqs, reqDetails.length, taskIds);
    await writeFile(join(iterationDir, '000-overview', 'PROJECT_GRAPH.md'), graphContent);

    // 10. 更新全量索引
    const today = new Date().toISOString().split('T')[0];
    for (let i = 0; i < foundReqs.length; i++) {
      await updateReqInIndex(foundReqs[i].id, {
        status: '✅ 已实现',
        iteration: options.name,
        task: taskIds[i] || '',
      });
    }

    await appendIterationLink({
      name: options.name,
      reqs: reqIds,
      status: '🔄 进行中',
      createdAt: today,
    });

    const newVersion = bumpGlobalVersion(index.version);
    await updateIndexVersion(newVersion);

    // 11. 更新上下文
    await updateContext({
      currentIteration: `Iteration-${options.name}`,
      lastUpdated: new Date().toISOString(),
    } as Partial<Context>);

    // 12. 输出结果
    logger.info('');
    logger.success('✅ 迭代生成完成！');
    logger.info('');
    logger.info(`📁 迭代: Iteration-${options.name}`);
    logger.info(`📋 包含需求: ${reqIds.join(', ')}`);
    logger.info('');
    logger.info(`📊 生成 Task（${taskIds.length} 个）:`);
    for (let i = 0; i < foundReqs.length; i++) {
      logger.info(`   ${taskIds[i]}: ${foundReqs[i].name}（来源: ${foundReqs[i].id}）`);
    }
    logger.info('');
    logger.info('📋 全量索引已更新');
    logger.info('📋 下一步:');
    logger.info('   speccore plan          生成调度方案');
    logger.info('   speccore execute       开始开发');
    logger.info('   需求变更时运行 speccore sync-global 同步回全量层');
  } catch (error) {
    spinner.fail(`迭代生成失败: ${error}`);
    throw error;
  }
}

/**
 * 生成迭代需求文档
 */
function generateIterationRequirement(
  iterationName: string,
  reqDetails: { req: { id: string; name: string; project: string }; detail: string }[]
): string {
  const today = new Date().toISOString().split('T')[0];
  let content = `# ${iterationName} - 需求文档

> 本文件从全量层生成。需求来源: GLOBAL/PROJECTS/
> 创建日期: ${today}

---

## 需求列表

`;

  for (const { req, detail } of reqDetails) {
    content += `### ${req.id}：${req.name}
> 来源项目: ${req.project}

${detail}

---
`;
  }

  return content;
}

/**
 * 生成迭代架构文档
 */
function generateIterationArchitecture(
  iterationName: string,
  reqs: { id: string; name: string; project: string }[]
): string {
  const today = new Date().toISOString().split('T')[0];
  let content = `# ${iterationName} - 技术架构

> 本文件从全量层继承。创建日期: ${today}

## 涉及项目

`;

  const projects = [...new Set(reqs.map((r) => r.project))];
  for (const proj of projects) {
    content += `- **${proj}**: ${reqs.filter((r) => r.project === proj).map((r) => r.name).join('、')}\n`;
  }

  content += `
## 技术栈

（从全量层 GLOBAL/TECH_STACK.md 继承）

## 架构决策

（继承全量层架构，详见 GLOBAL/ARCHITECTURE.md）

## 变更记录

| 日期 | 版本 | 变更说明 | 作者 |
| :--- | :--- | :--- | :--- |
| ${today} | v1.0 | 从全量层生成 | SpecCore |
`;

  return content;
}

/**
 * 生成迭代总览
 */
function generateProjectGraph(
  iterationName: string,
  reqs: { id: string; name: string; project: string }[],
  taskCount: number,
  taskIds: string[]
): string {
  const today = new Date().toISOString().split('T')[0];
  let content = `# ${iterationName} - 迭代总览

> 创建日期: ${today}
> 状态: 🔄 进行中

## 任务列表

| Task ID | 名称 | 来源需求 | 优先级 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
`;

  for (let i = 0; i < reqs.length; i++) {
    const taskId = taskIds[i] || `Task-${String(i + 1).padStart(3, '0')}`;
    content += `| ${taskId} | ${reqs[i].name} | ${reqs[i].id} | 高 | 🔲 待开发 |\n`;
  }

  content += `
## 完成统计

- 总任务数: ${taskCount}
- 已完成: 0
- 进行中: 0
- 待开发: ${taskCount}

## 变更记录

| 日期 | 版本 | 变更说明 | 作者 |
| :--- | :--- | :--- | :--- |
| ${today} | v1.0 | 从全量层生成 | SpecCore |
`;

  return content;
}

/**
 * 自动拆分 Task
 */
async function autoSplitTasks(
  iterationDir: string,
  reqs: { id: string; name: string; project: string; status: string }[]
): Promise<string[]> {
  const taskIds: string[] = [];
  const today = new Date().toISOString().split('T')[0];

  for (let i = 0; i < reqs.length; i++) {
    const { id: taskId } = await nextTaskId(reqs[i].name);
    const taskDir = join(iterationDir, taskId);
    await ensureDir(join(taskDir, '10-backend'));
    await ensureDir(join(taskDir, '20-frontend'));

    // .task-type
    await writeFile(join(taskDir, '.task-type'), 'feature');

    // 00-specs/TASK.md
    await writeFile(join(taskDir, '00-specs', 'TASK.md'),
      `# ${taskId}: ${reqs[i].name}

> 来源: ${reqs[i].id}（${reqs[i].project}）
> 创建日期: ${today}
> 状态: 🔲 待开发

## 实现方案

（待补充）

## 产出物

- [ ] 代码实现
- [ ] 单元测试
- [ ] 集成测试
- [ ] API 文档

## 变更记录

| 日期 | 版本 | 变更说明 | 作者 |
| :--- | :--- | :--- | :--- |
| ${today} | v1.0 | 自动生成 | SpecCore |
`
    );

    // 00-specs/REQ.md
    await writeFile(join(taskDir, '00-specs', 'REQ.md'),
      `# ${reqs[i].name} - 需求

> 来源: ${reqs[i].id}（${reqs[i].project}）
> 创建日期: ${today}

## 功能描述

（从全量层继承）

## 验收标准

- [ ] 功能验收
- [ ] 性能验收
- [ ] 安全验收
`
    );

    // 00-specs/TECH.md
    await writeFile(join(taskDir, '00-specs', 'TECH.md'),
      `# ${reqs[i].name} - 技术方案

> 来源: ${reqs[i].id}（${reqs[i].project}）
> 创建日期: ${today}

## 技术方案

（从全量层继承）

## 技术决策

（待补充）
`
    );

    taskIds.push(taskId);
  }

  return taskIds;
}
