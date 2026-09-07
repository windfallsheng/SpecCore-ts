/**
 * deploy — 部署端到指定环境
 *
 * 封装 deploy-engine，提供 CLI 入口，支持单端/全量部署。
 */
import { execSync } from 'child_process';
import { logger, Spinner } from '../utils/logger';
import { loadProjectConfigWithEnv } from '../core/unified-config';
import { deployPlatform } from '../core/deploy/engine';
import type { DeployOptions as EngineDeployOptions, DeployResult } from '../core/deploy/engine';
import type { PlatformConfig } from '../core/unified-config';

export interface DeployCliOptions {
  platform?: string;
  env?: string;
  dryRun?: boolean;
  skipBuild?: boolean;
  all?: boolean;
  envFile?: string;
  branch?: string;
}

export async function deployCommand(options: DeployCliOptions): Promise<void> {
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
    logger.info('💡 请指定要部署的平台:');
    logger.info(`   speccore deploy --platform <平台名> --env <环境>`);
    logger.info(`   speccore deploy --all --env <环境>`);
    logger.info(`   可用平台: ${config.platforms.map((p) => p.name).join(', ')}`);
    return;
  }

  const results: DeployResult[] = [];

  for (const platform of targets) {
    const cwd = platform.code_path || process.cwd();

    // 分支切换
    if (options.branch) {
      try {
        logger.info(`  🌿 切换到分支: ${options.branch}`);
        execSync(`git checkout "${options.branch}"`, { stdio: 'pipe', cwd });
      } catch (e: any) {
        logger.error(`  ❌ [${platform.name}] 切换分支失败: ${e.message || e}`);
        results.push({
          success: false,
          platform: platform.name,
          env,
          type: 'none',
          duration: 0,
          message: `切换分支 ${options.branch} 失败`,
        });
        continue;
      }
    }

    const spinner = new Spinner(`🚀 准备部署 ${platform.name} → ${env}...`);
    spinner.start();

    const engineOptions: EngineDeployOptions = {
      platform: platform.name,
      env,
      dryRun: options.dryRun || false,
      skipBuild: options.skipBuild || false,
    };

    try {
      const result = await deployPlatform(platform, env, engineOptions);
      spinner.stop();
      results.push(result);

      if (result.success) {
        logger.success(`✅ [${result.platform}] ${result.message}`);
      } else {
        logger.error(`❌ [${result.platform}] ${result.message}`);
      }
    } catch (e: any) {
      spinner.stop();
      logger.error(`❌ [${platform.name}] 部署异常: ${e.message || e}`);
      results.push({
        success: false,
        platform: platform.name,
        env,
        type: 'unknown',
        duration: 0,
        message: `部署异常: ${e.message || e}`,
      });
    }
  }

  // 汇总报告
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.length - successCount;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  logger.info('');
  logger.info('┌──────────────────────────────────────────┐');
  logger.info('│              部署汇总报告                │');
  logger.info('├──────────────────────────────────────────┤');
  for (const r of results) {
    const icon = r.success ? '✅' : '❌';
    const time = `(${(r.duration / 1000).toFixed(1)}s)`;
    const type = `[${r.type}]`;
    logger.info(`│ ${icon} ${r.platform.padEnd(12)} ${type.padEnd(10)} ${time.padEnd(10)} │`);
  }
  logger.info('├──────────────────────────────────────────┤');
  logger.info(`│ 成功: ${String(successCount).padEnd(3)}  失败: ${String(failCount).padEnd(3)}  总计: ${String(results.length).padEnd(3)} │`);
  logger.info(`│ 总耗时: ${((totalDuration) / 1000).toFixed(1)}s`.padEnd(39) + '│');
  logger.info('└──────────────────────────────────────────┘');

  if (failCount > 0) {
    process.exitCode = 1;
  }
}
