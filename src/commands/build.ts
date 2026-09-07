/**
 * build — 按端构建工程
 *
 * 读取 PROJECT.yaml 中各端的 build_cmd 配置，或按端类型推断默认命令。
 */
import { execSync } from 'child_process';
import { pathExists } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../utils/logger';
import { loadProjectConfigWithEnv } from '../core/unified-config';
import type { PlatformConfig } from '../core/unified-config';

export interface BuildOptions {
  platform?: string;
  all?: boolean;
  env?: string;
  envFile?: string;
  branch?: string;
}

interface BuildResult {
  platform: string;
  success: boolean;
  duration: number;
  command: string;
  message?: string;
}

/** 按平台类型推断默认构建命令 */
function inferDefaultBuildCmd(platform: PlatformConfig): string | null {
  switch (platform.type) {
    case 'frontend':
      return 'npm run build';
    case 'backend': {
      const cwd = platform.code_path || process.cwd();
      // 优先检查 Node 后端
      if (pathExistsSync(join(cwd, 'package.json'))) {
        return 'npm run build';
      }
      // Java / Maven
      if (pathExistsSync(join(cwd, 'pom.xml'))) {
        return './mvnw package -DskipTests';
      }
      // Go
      if (pathExistsSync(join(cwd, 'go.mod'))) {
        return 'go build -o bin/' + platform.name;
      }
      return null;
    }
    case 'infra':
      return null;
    default:
      return null;
  }
}

function pathExistsSync(p: string): boolean {
  try {
    return require('fs').existsSync(p);
  } catch {
    return false;
  }
}

/** 解析并返回构建命令 */
function resolveBuildCmd(platform: PlatformConfig, env: string): string | null {
  // 1. 优先读取 deploy 环境配置中的 build_cmd
  const envConfig = platform.deploy?.[env];
  if (envConfig?.build_cmd) {
    return envConfig.build_cmd;
  }

  // 2. 回退到按类型推断
  return inferDefaultBuildCmd(platform);
}

/** 切换到指定分支 */
function checkoutBranch(cwd: string, branch?: string): boolean {
  if (!branch) return true;
  try {
    logger.info(`  🌿 切换到分支: ${branch}`);
    execSync(`git checkout "${branch}"`, { stdio: 'pipe', cwd });
    return true;
  } catch (e: any) {
    logger.error(`  ❌ 切换分支失败: ${e.message || e}`);
    return false;
  }
}

export async function buildCommand(options: BuildOptions): Promise<void> {
  const env = options.env || 'staging';
  const envInput = options.envFile || options.env;
  const config = await loadProjectConfigWithEnv(envInput);

  if (!config.platforms || config.platforms.length === 0) {
    logger.warn('⚠️ PROJECT.yaml 中未配置任何平台，请先添加 platforms 配置');
    return;
  }

  let targets: PlatformConfig[];

  if (options.platform) {
    const found = config.platforms.find((p) => p.name === options.platform);
    if (!found) {
      logger.error(`❌ 未找到平台: "${options.platform}"`);
      logger.info(`   可用平台: ${config.platforms.map((p) => p.name).join(', ')}`);
      process.exitCode = 1;
      return;
    }
    targets = [found];
  } else if (options.all) {
    targets = config.platforms;
  } else {
    logger.info('💡 请指定要构建的平台:');
    logger.info(`   speccore build --platform <平台名>`);
    logger.info(`   speccore build --all`);
    logger.info(`   可用平台: ${config.platforms.map((p) => p.name).join(', ')}`);
    return;
  }

  const results: BuildResult[] = [];

  for (const platform of targets) {
    const cmd = resolveBuildCmd(platform, env);
    const cwd = platform.code_path || process.cwd();

    // 分支切换
    if (options.branch) {
      const ok = checkoutBranch(cwd, options.branch);
      if (!ok) {
        results.push({
          platform: platform.name,
          success: false,
          duration: 0,
          command: '(checkout failed)',
          message: `切换分支 ${options.branch} 失败`,
        });
        continue;
      }
    }

    if (!cmd) {
      logger.warn(`⚠️ [${platform.name}] 未配置构建命令，且无法按类型推断，已跳过`);
      results.push({
        platform: platform.name,
        success: false,
        duration: 0,
        command: '(none)',
        message: '未配置构建命令',
      });
      continue;
    }

    const spinner = new Spinner(`🔨 构建 ${platform.name} (${platform.type})...`);
    spinner.start();
    const start = Date.now();

    try {
      logger.info(`\n  命令: ${cmd}`);
      logger.info(`  目录: ${cwd}`);

      execSync(cmd, {
        stdio: 'inherit',
        cwd,
      });

      const duration = Date.now() - start;
      spinner.stop();
      logger.success(`✅ [${platform.name}] 构建成功 (${(duration / 1000).toFixed(1)}s)`);
      results.push({ platform: platform.name, success: true, duration, command: cmd });
    } catch (e: any) {
      const duration = Date.now() - start;
      spinner.stop();
      logger.error(`❌ [${platform.name}] 构建失败 (${(duration / 1000).toFixed(1)}s)`);
      logger.error(`   ${e.message || e}`);
      results.push({
        platform: platform.name,
        success: false,
        duration,
        command: cmd,
        message: e.message || String(e),
      });
    }
  }

  // 汇总报告
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.length - successCount;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  logger.info('');
  logger.info('┌──────────────────────────────────────────┐');
  logger.info('│              构建汇总报告                │');
  logger.info('├──────────────────────────────────────────┤');
  for (const r of results) {
    const icon = r.success ? '✅' : '❌';
    const time = `(${(r.duration / 1000).toFixed(1)}s)`;
    logger.info(`│ ${icon} ${r.platform.padEnd(12)} ${time.padEnd(10)} │`);
  }
  logger.info('├──────────────────────────────────────────┤');
  logger.info(`│ 成功: ${String(successCount).padEnd(3)}  失败: ${String(failCount).padEnd(3)}  总计: ${String(results.length).padEnd(3)} │`);
  logger.info(`│ 总耗时: ${((totalDuration) / 1000).toFixed(1)}s`.padEnd(39) + '│');
  logger.info('└──────────────────────────────────────────┘');

  if (failCount > 0) {
    process.exitCode = 1;
  }
}
