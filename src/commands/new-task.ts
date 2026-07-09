/**
 * new-task — 创建单个原子任务，支持多平台
 * 支持 --platforms 参数指定前端平台，--backend-only / --frontend-only
 */

import { pathExists, ensureDir, readFile, writeFile, readdir } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, updateContext } from '../core/context';
import yaml from 'js-yaml';

export interface NewTaskOptions {
  name: string;
  type?: string;
  desc?: string;
  platforms?: string;
  backendOnly?: boolean;
  frontendOnly?: boolean;
  iteration?: string;
}

export async function newTaskCommand(options: NewTaskOptions): Promise<void> {
  const spinner = new Spinner('Creating task');
  spinner.start();

  try {
    if (!options.name) {
      spinner.fail('Task name is required. Use --name="<task name>"');
      return;
    }

    // 自动推断任务类型
    const taskType = options.type || inferTaskType(options.name);

    // 读取平台配置
    const platforms = await resolvePlatforms(options);

    // 确定期次
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('No active iteration found. Create one first with: speccore iteration create');
      return;
    }

    // 生成 Task ID
    const taskId = await generateTaskId(iteration);

    // 创建 Task 目录结构
    const taskDirName = `${taskId}-${options.name}`;
    const taskDir = join(process.cwd(), `期次-${iteration}`, taskDirName);

    if (await pathExists(taskDir)) {
      spinner.fail(`Task directory already exists: ${taskDirName}`);
      return;
    }

    await ensureDir(taskDir);

    // 创建 _shared/ 目录
    await ensureDir(join(taskDir, '_shared'));

    // 创建后端目录（除非 --frontend-only）
    if (!options.frontendOnly) {
      await ensureDir(join(taskDir, 'backend'));
      await createBackendSpecs(taskDir, taskId, options.name, taskType, iteration);
    }

    // 创建前端各平台目录（除非 --backend-only）
    if (!options.backendOnly && platforms.length > 0) {
      await ensureDir(join(taskDir, 'frontend'));
      for (const platform of platforms) {
        await ensureDir(join(taskDir, 'frontend', platform));
        await createFrontendPlatformSpecs(taskDir, platform, taskId, options.name, taskType, iteration);
      }
    }

    // 创建共享文件
    await createSharedFiles(taskDir, taskId, options.name, platforms);

    // 更新上下文
    await updateContext({
      currentTask: taskDirName,
      lastUpdated: new Date().toISOString(),
    });

    spinner.stop('Task created successfully');
    logger.info('');
    logger.info(`✅ ${taskDirName} 创建完成！`);
    logger.info('');
    logger.info(`📁 已创建目录：`);
    logger.info(`  - ${taskDirName}/ (${taskType})`);
    if (!options.frontendOnly) {
      logger.info(`  - backend/ REQ.md TECH.md TASK.md`);
    }
    if (!options.backendOnly && platforms.length > 0) {
      for (const platform of platforms) {
        logger.info(`  - frontend/${platform}/ REQ.md TECH.md TASK.md`);
      }
    }
    logger.info('');
    logger.info('📋 下一步：/spec-execute --task=' + taskId + ' 开始开发');
  } catch (error) {
    spinner.fail(`Task creation failed: ${error}`);
    throw error;
  }
}

/**
 * 读取 platforms.yaml 确定平台列表
 */
async function resolvePlatforms(options: NewTaskOptions): Promise<string[]> {
  const platformsYaml = join(process.cwd(), '.speccore', 'config', 'platforms.yaml');

  if (!(await pathExists(platformsYaml))) {
    return [];
  }

  const content = await readFile(platformsYaml, 'utf-8');
  const config = yaml.load(content) as any;
  const availablePlatforms: string[] = [];

  if (config?.platforms) {
    for (const [key, value] of Object.entries(config.platforms)) {
      const p = value as any;
      if (p?.enabled) {
        availablePlatforms.push(key);
      }
    }
  }

  // 如果指定了具体平台，则过滤
  if (options.platforms && options.platforms !== 'all') {
    const specified = options.platforms.split(',').map((s) => s.trim());
    return specified.filter((p) => availablePlatforms.includes(p));
  }

  return availablePlatforms;
}

/**
 * 自动推断任务类型
 */
function inferTaskType(name: string): string {
  const typePatterns: [RegExp, string][] = [
    [/修复|bug|bugfix|错误|异常|crash/i, 'bugfix'],
    [/调研|研究|research|选型|评估/i, 'research'],
    [/优化|improve|优化|提速|加快/i, 'optimization'],
    [/迁移|升级|upgrade|版本/i, 'migration'],
    [/文档|doc|document|手册/i, 'document'],
    [/登录|注册|认证|auth|支付|订单|管理/i, 'feature'],
  ];

  for (const [pattern, type] of typePatterns) {
    if (pattern.test(name)) return type;
  }

  return 'feature';
}

/**
 * 生成 Task ID
 */
async function generateTaskId(iteration: string): Promise<string> {
  const iterDir = join(process.cwd(), `期次-${iteration}`);
  let maxNum = 0;

  if (await pathExists(iterDir)) {
    const entries = await readdir(iterDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const match = entry.name.match(/^Task-(\d+)/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNum) maxNum = num;
        }
      }
    }
  }

  return `Task-${String(maxNum + 1).padStart(3, '0')}`;
}

/**
 * 创建后端 Spec 文件
 */
async function createBackendSpecs(
  taskDir: string,
  taskId: string,
  taskName: string,
  taskType: string,
  iteration: string
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  await writeFile(
    join(taskDir, 'backend', 'REQ.md'),
    `# ${taskId} ${taskName} - 后端需求\n\n` +
    `> 创建时间：${today}\n` +
    `> 任务类型：${taskType}\n` +
    `> 关联期次：${iteration}\n\n` +
    `## 需求描述\n\n_待填写_\n\n` +
    `## 验收标准\n\n- [ ] AC-01: \n`
  );

  await writeFile(
    join(taskDir, 'backend', 'TECH.md'),
    `# ${taskId} ${taskName} - 后端技术方案\n\n` +
    `## 技术选型\n\n_待填写_\n\n` +
    `## 核心类设计\n\n_待填写_\n\n` +
    `## 异常处理\n\n_待填写_\n`
  );

  await writeFile(
    join(taskDir, 'backend', 'TASK.md'),
    `# ${taskId} ${taskName} - 后端任务\n\n` +
    `| 属性 | 值 |\n` +
    `| :--- | :--- |\n` +
    `| 状态 | 🔲 待开发 |\n` +
    `| 优先级 | medium |\n\n` +
    `## 开发清单\n\n- [ ] 待拆分\n`
  );
}

/**
 * 创建前端平台 Spec 文件
 */
async function createFrontendPlatformSpecs(
  taskDir: string,
  platform: string,
  taskId: string,
  taskName: string,
  taskType: string,
  iteration: string
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  await writeFile(
    join(taskDir, 'frontend', platform, 'REQ.md'),
    `# ${taskId} ${taskName} - ${platform} 前端需求\n\n` +
    `> 创建时间：${today}\n` +
    `> 任务类型：${taskType}\n` +
    `> 关联期次：${iteration}\n` +
    `> 目标平台：${platform}\n\n` +
    `## 页面列表\n\n_待填写_\n\n` +
    `## 验收标准\n\n- [ ] AC-01: \n`
  );

  await writeFile(
    join(taskDir, 'frontend', platform, 'TECH.md'),
    `# ${taskId} ${taskName} - ${platform} 技术方案\n\n` +
    `## 组件设计\n\n_待填写_\n\n` +
    `## 状态管理\n\n_待填写_\n`
  );

  await writeFile(
    join(taskDir, 'frontend', platform, 'TASK.md'),
    `# ${taskId} ${taskName} - ${platform} 任务\n\n` +
    `| 属性 | 值 |\n` +
    `| :--- | :--- |\n` +
    `| 状态 | 🔲 待开发 |\n` +
    `| 优先级 | medium |\n\n` +
    `## 开发清单\n\n- [ ] 待拆分\n`
  );
}

/**
 * 创建共享文件
 */
async function createSharedFiles(
  taskDir: string,
  taskId: string,
  taskName: string,
  platforms: string[]
): Promise<void> {
  await writeFile(
    join(taskDir, '_shared', 'API_CONTRACT.yaml'),
    `# ${taskId} ${taskName} — API Contract\n` +
    `# 所有平台共享的接口定义\n\n` +
    `endpoints: []\n`
  );

  await writeFile(
    join(taskDir, '_shared', 'business-rules.md'),
    `# 业务规则\n\n` +
    `> 所有平台共享的业务规则\n\n` +
    `## 规则列表\n\n_待填写_\n`
  );
}
