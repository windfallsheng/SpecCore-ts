/**
 * platform-add — 动态添加前端平台类型
 * 自动更新 platforms.yaml 并同步到现有 Task
 */

import { pathExists, readFile, writeFile, readdir, ensureDir } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../utils/logger';
import yaml from 'js-yaml';

export interface PlatformAddOptions {
  name: string;
  description?: string;
  tech?: string;
  syncExisting?: boolean;
}

export async function platformAddCommand(options: PlatformAddOptions): Promise<void> {
  const spinner = new Spinner('Adding platform');
  spinner.start();

  try {
    if (!options.name) {
      spinner.fail('Platform name is required. Use --name=<identifier>');
      return;
    }

    const configDir = join(process.cwd(), '.speccore', 'config');
    const platformsYaml = join(configDir, 'platforms.yaml');

    // 确保配置目录存在
    await ensureDir(configDir);

    let config: any = { platforms: {} };

    // 读取现有配置
    if (await pathExists(platformsYaml)) {
      const content = await readFile(platformsYaml, 'utf-8');
      config = yaml.load(content) as any;
    }

    // 检查是否已存在
    if (config?.platforms?.[options.name]) {
      spinner.fail(`Platform "${options.name}" already exists in platforms.yaml`);
      return;
    }

    // 添加新平台
    if (!config.platforms) config.platforms = {};
    config.platforms[options.name] = {
      name: options.description || options.name,
      description: options.description || '',
      default: false,
      tech_stack: options.tech || '',
      enabled: true,
    };

    // 写回配置文件
    const newYaml = yaml.dump(config, { indent: 2, lineWidth: -1, noRefs: true });
    await writeFile(platformsYaml, newYaml);

    // 同步到现有 Task
    let syncedCount = 0;
    if (options.syncExisting !== false) {
      syncedCount = await syncPlatformToExistingTasks(options.name);
    }

    spinner.stop('Platform added successfully');
    logger.info('');
    logger.info('✅ 平台类型添加完成！');
    logger.info('');
    logger.info(`📁 已更新配置：`);
    logger.info(`  - .speccore/config/platforms.yaml (+${options.name})`);
    logger.info('');
    if (syncedCount > 0) {
      logger.info(`📁 已同步到 ${syncedCount} 个现有 Task`);
    }
    logger.info('📋 验证：speccore validate 检查完整性');
    logger.info(`📋 使用：speccore new-task --platforms=${options.name}`);
  } catch (error) {
    spinner.fail(`Platform addition failed: ${error}`);
    throw error;
  }
}

/**
 * 同步平台到现有 Task（为每个 Task 创建 frontend/{platform}/ 目录）
 */
async function syncPlatformToExistingTasks(platformName: string): Promise<number> {
  let count = 0;
  const cwd = process.cwd();

  // 扫描所有期次目录
  const dirEntries = await readdir(cwd, { withFileTypes: true });
  const iterDirs = dirEntries.filter(
    (e) => e.isDirectory() && e.name.startsWith('期次-')
  );

  for (const iterDir of iterDirs) {
    const iterPath = join(cwd, iterDir.name);
    const taskEntries = await readdir(iterPath, { withFileTypes: true });

    for (const taskEntry of taskEntries) {
      if (taskEntry.isDirectory() && taskEntry.name.startsWith('Task-')) {
        const frontendDir = join(iterPath, taskEntry.name, 'frontend', platformName);
        if (!(await pathExists(frontendDir))) {
          await ensureDir(frontendDir);

          const taskId = taskEntry.name.match(/^(Task-\d+)/)?.[1] || taskEntry.name;
          const taskName = taskEntry.name.replace(/^Task-\d+-/, '');
          const today = new Date().toISOString().split('T')[0];

          // 创建模板 Spec 文件
          await writeFile(
            join(frontendDir, 'REQ.md'),
            `# ${taskId} ${taskName} - ${platformName} 前端需求\n\n` +
            `> 目标平台：${platformName}\n` +
            `> 创建时间：${today}\n\n` +
            `## 页面列表\n\n_待填写_\n`
          );
          await writeFile(
            join(frontendDir, 'TECH.md'),
            `# ${taskId} ${taskName} - ${platformName} 技术方案\n\n_待填写_\n`
          );
          await writeFile(
            join(frontendDir, 'TASK.md'),
            `# ${taskId} ${taskName} - ${platformName} 任务\n\n` +
            `| 状态 | 🔲 待开发 |\n` +
            `| 优先级 | medium |\n\n` +
            `## 开发清单\n\n- [ ] 待拆分\n`
          );

          count++;
        }
      }
    }
  }

  return count;
}
