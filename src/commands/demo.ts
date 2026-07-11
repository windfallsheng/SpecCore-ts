/**
 * demo - 快速体验命令
 * 5 分钟快速体验 SpecCore 完整流程，内置示例项目
 */

import { logger, Spinner } from '../utils/logger';
import { ensureDir, writeFile, pathExists } from 'fs-extra';
import { FileTransaction } from '../core/transaction';
import { join } from 'path';

export interface DemoOptions {
  project?: string;   // book / todo / blog
  list?: boolean;     // 列出可用示例
}

const DEMO_PROJECTS: Record<string, { name: string; description: string; features: string[] }> = {
  book: {
    name: '图书管理系统',
    description: 'CRUD + 借阅管理，包含用户认证、图书录入、借阅/归还流程',
    features: ['用户注册登录', '图书增删改查', '借阅管理', '超期罚款'],
  },
  todo: {
    name: '待办事项管理',
    description: '任务创建、状态流转、分类筛选',
    features: ['任务CRUD', '状态流转（未开始/进行中/已完成）', '分类标签', '截止日期提醒'],
  },
  blog: {
    name: '博客系统',
    description: '文章发布、评论管理、标签分类',
    features: ['文章发布编辑', '评论管理', '标签分类', 'Markdown 编辑器'],
  },
};

export async function demoCommand(options: DemoOptions): Promise<void> {
  if (options.list) {
    showDemoList();
    return;
  }

  const projectKey = options.project || 'book';
  const project = DEMO_PROJECTS[projectKey];

  if (!project) {
    logger.error(`未知示例 "${projectKey}"。可用的示例:`);
    showDemoList();
    return;
  }

  const spinner = new Spinner(`正在创建 ${project.name} 示例项目...`);
  spinner.start();

  try {
    await createDemoProject(projectKey, project);
    spinner.stop(`${project.name} 示例项目创建完成！`);
    logger.info('');
    logger.info('🚀 快速体验 SpecCore:');
    logger.info(`  1. 查看需求: cat 期次-${projectKey}/00-需求文档/REQUIREMENT.md`);
    logger.info(`  2. 查看项目图谱: cat 期次-${projectKey}/00-期次总览/PROJECT_GRAPH.md`);
    logger.info(`  3. 查看进度: speccore progress --iteration=期次-${projectKey}`);
    logger.info(`  4. 查看状态: speccore status --iteration=期次-${projectKey}`);
    logger.info(`  5. 生成报告: speccore report --iteration=期次-${projectKey} --format=markdown`);
  } catch (error) {
    spinner.fail(`示例创建失败: ${error}`);
    throw error;
  }
}

function showDemoList(): void {
  logger.info('🎮 可用的示例项目:');
  logger.info('');

  for (const [key, project] of Object.entries(DEMO_PROJECTS)) {
    logger.info(`  ${key} - ${project.name}`);
    logger.info(`    ${project.description}`);
    logger.info(`    特性: ${project.features.join('、')}`);
    logger.info('');
  }

  logger.info('用法: speccore demo --project=<key>');
  logger.info('例如: speccore demo --project=todo');
}

async function createDemoProject(
  key: string,
  project: { name: string; description: string; features: string[] }
): Promise<void> {
  const iterationName = `期次-${key}`;
  const iterDir = join(process.cwd(), iterationName);

  if (await pathExists(iterDir)) {
    logger.warn(`期次 ${iterationName} 已存在，将复用现有结构。`);
    return;
  }

  // 创建期次目录
  await ensureDir(join(iterDir, '00-需求文档'));
  await ensureDir(join(iterDir, '00-技术文档'));
  await ensureDir(join(iterDir, '00-期次总览'));

  // 需求文档
  const featuresList = project.features.map((f, i) => `${i + 1}. ${f}`).join('\n');
  await writeFile(
    join(iterDir, '00-需求文档', 'REQUIREMENT.md'),
    `# ${project.name} - 需求文档\n\n` +
    `## 1. 项目背景\n\n${project.description}\n\n` +
    `## 2. 功能清单\n\n${featuresList}\n\n` +
    `## 3. 非功能需求\n\n- 性能：接口响应时间 < 500ms\n` +
    `- 安全：JWT 认证，密码 BCrypt 加密\n` +
    `- 可用性：99.9%\n\n` +
    `## 4. 验收标准\n\n` +
    project.features.map((f) => `- [ ] ${f} 功能可用`).join('\n') + `\n`
  );

  // 技术文档
  await writeFile(
    join(iterDir, '00-技术文档', 'ARCHITECTURE.md'),
    `# ${project.name} - 技术架构\n\n` +
    `## 1. 整体架构\n\n采用前后端分离架构\n\n` +
    `\`\`\`\n` +
    `[前端] ← HTTP/REST → [后端] ← [数据库]\n` +
    `\`\`\`\n\n` +
    `## 2. 技术选型\n\n` +
    `| 层 | 技术 |\n` +
    `| :--- | :--- |\n` +
    `| 前端 | Vue 3 + TypeScript + Element Plus |\n` +
    `| 后端 | Spring Boot 3 + MyBatis Plus |\n` +
    `| 数据库 | MySQL 8.0 |\n` +
    `| 缓存 | Redis |\n\n` +
    `## 3. 决策记录\n\n` +
    `| 决策 | 方案 | 理由 |\n` +
    `| :--- | :--- | :--- |\n` +
    `| 认证方案 | JWT | 无状态，适合微服务扩展 |\n` +
    `| 密码加密 | BCrypt | 业界标准，抗暴力破解 |\n` +
    `| API 规范 | RESTful | 通用性强，容易理解 |\n`
  );

  // 项目图谱
  await writeFile(
    join(iterDir, '00-期次总览', 'PROJECT_GRAPH.md'),
    `# ${project.name} - 项目图谱\n\n` +
    `## 1. 任务依赖关系\n\n` +
    `\`\`\`mermaid\n` +
    `graph TD\n` +
    `    Task-001[用户注册登录] --> Task-002[核心业务 CRUD]\n` +
    `    Task-002 --> Task-003[高级功能]\n` +
    `    Task-002 --> Task-004[管理后台]\n` +
    `\`\`\`\n\n` +
    `## 2. 任务列表\n\n` +
    `| 任务 | 类型 | 状态 | 负责人 | 依赖 |\n` +
    `| :--- | :--- | :--- | :--- | :--- |\n` +
    `| Task-001 用户注册登录 | feature | 🔲 待开发 | | |\n` +
    `| Task-002 核心业务 | feature | 🔲 待开发 | | Task-001 |\n` +
    `| Task-003 高级功能 | feature | 🔲 待开发 | | Task-002 |\n` +
    `| Task-004 管理后台 | feature | 🔲 待开发 | | Task-002 |\n`
  );

  // 创建示例任务
  const tasks = [
    { id: 'Task-001', name: '用户注册登录', type: 'feature' },
    { id: 'Task-002', name: '核心业务', type: 'feature' },
    { id: 'Task-003', name: '高级功能', type: 'feature' },
    { id: 'Task-004', name: '管理后台', type: 'feature' },
  ];

  for (const task of tasks) {
    const taskDir = join(iterDir, task.id);
    await ensureDir(join(taskDir, 'backend'));
    await ensureDir(join(taskDir, '_shared'));

    await writeFile(join(taskDir, '.task-type'), task.type);

    await writeFile(
      join(taskDir, 'backend', 'REQ.md'),
      `# ${task.name} - 后端需求\n\n` +
      `## 1. 需求描述\n\n待补充\n\n` +
      `## 2. 验收标准\n\n- [ ] 功能可用\n`
    );

    await writeFile(
      join(taskDir, 'backend', 'TASK.md'),
      `# ${task.name} - 执行追踪\n\n` +
      `> 任务类型: ${task.type} | 状态: 🔲 待开发\n\n` +
      `## 1. 变更履历\n\n` +
      `| 日期 | 版本 | 变更说明 | 作者 |\n` +
      `| :--- | :--- | :--- | :--- |\n` +
      `| ${new Date().toISOString().split('T')[0]} | v1.0 | 初始创建 | SpecCore |\n`
    );

    await writeFile(
      join(taskDir, 'backend', 'TECH.md'),
      `# ${task.name} - 技术方案\n\n## 1. 方案概述\n\n待补充\n`
    );

    await writeFile(
      join(taskDir, '_shared', 'API_CONTRACT.yaml'),
      `# ${task.name} - API 契约\nopenapi: "3.0.3"\ninfo:\n  title: ${task.name}\n  version: "1.0.0"\npaths: {}\n`
    );
  }
}
