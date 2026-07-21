/**
 * migrate — Shell 版 to CLI 版 config migration command
 *
 * Detects existing Shell v3.x Speccore project config (.speccore, iterations, tasks)
 * and migrates it to CLI v4.x format.
 *
 * Migration includes:
 *  - Global layer directory setup
 *  - platforms.yaml creation
 *  - context.json upgrade to v4 format
 *  - .gitignore update
 *  - Migration report generation
 */

import { pathExists, readdir, readFile, ensureDir } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../utils/logger';
import { FileTransaction } from '../core/transaction';
import { DEFAULT_CONTEXT } from '../core/schemas';
import { DEFAULT_PLATFORMS } from '../core/schemas';

export interface MigrateOptions {
  dryRun?: boolean;
  force?: boolean;
}

interface MigrationReport {
  projectRoot: string;
  shellVersion?: string;
  iterations: number;
  tasks: number;
  actions: string[];
  warnings: string[];
}

export async function migrateCommand(options: MigrateOptions): Promise<void> {
  const spinner = new Spinner('Starting migration...');
  spinner.start();

  try {
    const projectRoot = process.cwd();
    const report: MigrationReport = {
      projectRoot,
      iterations: 0,
      tasks: 0,
      actions: [],
      warnings: [],
    };

    // 1. 检测 Shell 版项目
    const speccoreDir = join(projectRoot, '.speccore');
    const hasSpeccoreDir = await pathExists(speccoreDir);

    if (!hasSpeccoreDir) {
      spinner.fail('No .speccore directory found. This project may not be a Speccore project.');
      return;
    }

    // 2. 检测 Shell 版本
    const versionPath = join(speccoreDir, 'VERSION');
    if (await pathExists(versionPath)) {
      report.shellVersion = (await readFile(versionPath, 'utf-8')).trim();
      report.actions.push(`Detected Shell version: ${report.shellVersion}`);
    }

    const tx = new FileTransaction();

    // 3. 扫描迭代/任务
    const entries = await readdir(projectRoot, { withFileTypes: true });
    const iterDirs = entries.filter((e) => e.isDirectory() && e.name.startsWith('期次-'));
    report.iterations = iterDirs.length;

    for (const iterDir of iterDirs) {
      const taskEntries = await readdir(join(projectRoot, iterDir.name), { withFileTypes: true });
      const tasks = taskEntries.filter((e) => e.isDirectory() && e.name.startsWith('Task-'));
      report.tasks += tasks.length;
    }

    report.actions.push(`Found ${report.iterations} iterations, ${report.tasks} tasks`);

    // 4. 补充全量层
    const globalDir = join(speccoreDir, 'GLOBAL');
    if (!(await pathExists(globalDir))) {
      await ensureDir(join(globalDir, 'PROJECTS', '_template'));
      report.actions.push('Created GLOBAL/ layer directory');
    }

    // 5. 创建 platforms.yaml（如果缺失）
    const platformsPath = join(speccoreDir, 'config', 'platforms.yaml');
    if (!(await pathExists(platformsPath))) {
      const yaml = require('js-yaml');
      const content = yaml.dump(DEFAULT_PLATFORMS, { indent: 2, lineWidth: -1 });
      tx.write(platformsPath, content);
      report.actions.push('Created .speccore/config/platforms.yaml');
    }

    // 6. 更新 context.json 到 v4 格式
    const contextPath = join(speccoreDir, 'local', 'context.json');
    await ensureDir(join(speccoreDir, 'local'));

    if (await pathExists(contextPath)) {
      try {
        const existing = JSON.parse(await readFile(contextPath, 'utf-8'));
        // 合并 v4 默认值，保留已有设置
        const updated = { ...DEFAULT_CONTEXT, ...existing };
        tx.write(contextPath, JSON.stringify(updated, null, 2));
        report.actions.push('Updated context.json to v4 format');
      } catch {
        report.warnings.push('Failed to parse existing context.json, creating new one');
        tx.write(contextPath, JSON.stringify(DEFAULT_CONTEXT, null, 2));
      }
    } else {
      tx.write(contextPath, JSON.stringify(DEFAULT_CONTEXT, null, 2));
      report.actions.push('Created context.json');
    }

    // 7. 更新 .gitignore
    const gitignorePath = join(projectRoot, '.gitignore');
    const neededRule = '.speccore/local/context.json';
    let hasRule = false;

    if (await pathExists(gitignorePath)) {
      const gitignore = await readFile(gitignorePath, 'utf-8');
      hasRule = gitignore.includes(neededRule);
      if (!hasRule) {
        tx.write(gitignorePath, gitignore + '\n' + neededRule + '\n');
        report.actions.push('Updated .gitignore');
      }
    } else {
      tx.write(gitignorePath, neededRule + '\n');
      report.actions.push('Created .gitignore');
    }

    // 8. 检查缺失的 PATTERNS 目录
    const patternsDir = join(speccoreDir, 'PATTERNS', 'TEMPLATES');
    if (!(await pathExists(patternsDir))) {
      await ensureDir(join(patternsDir, 'crud'));
      await ensureDir(join(patternsDir, 'auth'));
      await ensureDir(join(patternsDir, 'export'));
      await ensureDir(join(patternsDir, 'report'));
      report.actions.push('Created PATTERNS/TEMPLATES/ structure');
    }

    // 9. 提交或预览
    if (options.dryRun) {
      spinner.stop('Migration preview (--dry-run)');
      printReport(report);
      logger.info('');
      logger.info(`📋 ${tx.length} file changes pending. Remove --dry-run to apply.`);
      return;
    }

    if (tx.length > 0) {
      await tx.commit();
      report.actions.push(`Applied ${tx.length} file changes (transaction protected)`);
    }

    spinner.stop('Migration complete!');
    printReport(report);

    logger.info('');
    logger.info('📋 Next steps:');
    logger.info('   speccore validate          # Verify migration');
    logger.info('   speccore global-status     # Check global layer');
    logger.info('   speccore init --force      # Re-init if needed');
  } catch (error) {
    spinner.fail(`Migration failed: ${error}`);
    throw error;
  }
}

function printReport(report: MigrationReport): void {
  logger.info('');
  logger.info('📊 Migration Report');
  logger.info('');
  logger.info(`   Project: ${report.projectRoot}`);
  if (report.shellVersion) {
    logger.info(`   Shell version: ${report.shellVersion} → CLI v4.x`);
  }
  logger.info(`   Iterations: ${report.iterations}`);
  logger.info(`   Tasks: ${report.tasks}`);
  logger.info('');
  logger.info('Actions taken:');
  for (const action of report.actions) {
    logger.info(`   ✅ ${action}`);
  }
  if (report.warnings.length > 0) {
    logger.info('');
    logger.info('Warnings:');
    for (const warning of report.warnings) {
      logger.warn(`   ⚠️ ${warning}`);
    }
  }
}
