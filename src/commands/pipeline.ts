/**
 * pipeline — 环境驱动流水线：合并 → 构建 → [测试] → 部署 → [测试]
 *
 * 工作流：
 *   1. 读取环境配置（--env 或 --env-file）
 *   2. 获取当前 Git 分支作为源分支
 *   3. 从环境配置读取 branch（目标分支）
 *   4. checkout → pull → merge → build → [pre-deploy 测试] → deploy → [post-deploy 测试]
 *
 * 测试时机由 pipeline.test.stage 控制：
 *   - pre-deploy: build 后 deploy 前（默认，可阻断部署）
 *   - post-deploy: deploy 后（已上线，只报告不阻断）
 *   - both: 前后都测
 *
 * 支持单端/多端批量执行，失败不阻断其他端。
 */
import { execSync } from 'child_process';
import { logger } from '../utils/logger';
import { loadProjectConfigWithEnv } from '../core/unified-config';
import { loadEnvironmentByNameOrPath } from '../core/environment-config';
import { buildCommand } from './build';
import { deployCommand } from './deploy';
import type { PlatformConfig } from '../core/unified-config';
import { runPipelineTest, formatPipelineTestReport } from '../core/pipeline-test';
import { loadSubtaskGitConfig } from '../core/git-integration';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs-extra';
import { join } from 'path';

export interface PipelineOptions {
  platforms?: string;
  all?: boolean;
  env?: string;
  envFile?: string;
  skipBuild?: boolean;
  dryRun?: boolean;
}

interface PipelineResult {
  platform: string;
  success: boolean;
  steps: {
    checkout: boolean;
    merge: boolean;
    build: boolean;
    test: boolean;
    deploy: boolean;
  };
  /** 测试详情报告（供 AI 自动修复使用） */
  testReport?: string;
  message?: string;
}

function execGit(cwd: string, cmd: string, dryRun: boolean): boolean {
  if (dryRun) {
    logger.info(`  [DRY-RUN] ${cmd}`);
    return true;
  }
  try {
    execSync(cmd, { stdio: 'pipe', cwd });
    return true;
  } catch (e: any) {
    logger.error(`  ❌ git 失败: ${e.message || e}`);
    return false;
  }
}

/** 获取当前 Git 分支名 */
function getCurrentBranch(cwd: string): string | null {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8' }).trim();
    return branch || null;
  } catch {
    return null;
  }
}

/** 检测当前 git 仓库是否为 speccore 自身仓库（用户未配置 code_path 时易误用） */
function isSpeccoreOwnRepo(cwd: string): boolean {
  try {
    const remote = execSync('git remote get-url origin', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
    return /speccore|ts-cli/.test(remote);
  } catch {
    return false;
  }
}

/** v8.3.86+: 从子任务 git-config 中读取对应平台的源分支 */
function findSubtaskBranchForPlatform(iteration: string, platformName: string): string | null {
  try {
    const tasksDir = join(process.cwd(), `Iteration-${iteration}`, '030-tasks');
    if (!existsSync(tasksDir)) return null;

    for (const taskType of readdirSync(tasksDir)) {
      const taskTypeDir = join(tasksDir, taskType);
      if (!statSync(taskTypeDir).isDirectory()) continue;

      for (const taskId of readdirSync(taskTypeDir)) {
        const platformDir = join(taskTypeDir, taskId, platformName);
        if (!existsSync(platformDir)) continue;

        for (const subtask of readdirSync(platformDir)) {
          const subtaskDir = join(platformDir, subtask);
          if (!statSync(subtaskDir).isDirectory()) continue;
          const cfg = loadSubtaskGitConfig(subtaskDir);
          if (cfg.defaultBranch) return cfg.defaultBranch;
        }
      }
    }
  } catch {}
  return null;
}

/** 读取当前活跃迭代名 */
function getCurrentIteration(): string | null {
  try {
    const ctxPath = join(process.cwd(), '.speccore', 'local', 'context.json');
    if (!existsSync(ctxPath)) return null;
    const ctx = JSON.parse(readFileSync(ctxPath, 'utf-8'));
    return ctx.currentIteration || null;
  } catch {
    return null;
  }
}

export async function pipelineCommand(options: PipelineOptions): Promise<void> {
  const env = options.env || 'staging';
  const dryRun = options.dryRun || false;

  // 读取环境配置，获取目标分支
  const envConfig = await loadEnvironmentByNameOrPath(options.envFile || env);
  const globalBranch = envConfig?.branch;

  if (!globalBranch) {
    // v8.3.82+: 允许全局不配置 branch，只要各平台单独配置即可
    const hasPlatformBranch = envConfig?.platforms
      ? Object.values(envConfig.platforms).some((p: any) => p?.branch)
      : false;
    if (!hasPlatformBranch) {
      logger.error(`❌ 环境 "${env}" 未配置 branch 字段`);
      logger.info('   请在环境配置文件中添加 branch，例如：');
      logger.info(`   .speccore/environments/${env}.yaml`);
      logger.info('   ──');
      logger.info(`   env: ${env}`);
      logger.info(`   branch: ${env === 'staging' ? 'develop' : env === 'production' ? 'main' : 'your-branch'}`);
      logger.info('   ──');
      logger.info('   然后重试: speccore pipeline --env ' + env + ' --all');
      process.exitCode = 1;
      return;
    }
  }

  // 加载项目配置（含环境覆盖）
  const config = await loadProjectConfigWithEnv(options.envFile || env);

  if (!config.platforms || config.platforms.length === 0) {
    logger.warn('⚠️ PROJECT.yaml 中未配置任何平台');
    return;
  }

  let targets: PlatformConfig[];

  if (options.platforms) {
    const names = options.platforms.split(',').map((n) => n.trim());
    targets = config.platforms.filter((p) => names.includes(p.name));
    if (targets.length === 0) {
      logger.error(`❌ 未找到匹配平台: ${options.platforms}`);
      process.exitCode = 1;
      return;
    }
  } else if (options.all) {
    targets = config.platforms;
  } else {
    logger.info('💡 请指定目标平台:');
    logger.info(`   speccore pipeline --env ${env} --platforms h5,api`);
    logger.info(`   speccore pipeline --env ${env} --all`);
    logger.info(`   可用平台: ${config.platforms.map((p) => p.name).join(', ')}`);
    return;
  }

  // 获取当前分支（作为源分支）
  const firstCwd = targets[0]?.code_path || process.cwd();
  const sourceBranch = getCurrentBranch(firstCwd);
  if (!sourceBranch) {
    logger.error('❌ 无法获取当前 Git 分支');
    logger.info('   请检查以下配置之一：');
    logger.info('   1. PROJECT.yaml 中 platform.code_path 指向正确的工程目录');
    logger.info('   2. 在工程目录（含 .git）下运行 speccore pipeline');
    process.exitCode = 1;
    return;
  }

  // v8.3.86+: 检测是否在 speccore 自身仓库中运行（code_path 未配置时的常见误用）
  if (isSpeccoreOwnRepo(firstCwd)) {
    logger.warn('⚠️  当前 Git 仓库似乎是 speccore CLI 自身仓库');
    logger.warn('   你可能没有在 PROJECT.yaml 中配置 platform.code_path');
    logger.warn('   请在 .speccore/PROJECT.yaml 中为各平台添加 code_path 指向实际工程目录');
    logger.info('');
  }

  // v8.3.86+: 收集各平台目标分支（四级回退）
  // 优先级：环境平台级 branch > 环境全局 branch > PROJECT.yaml default_branch > 子任务 git-config 源分支
  const currentIteration = getCurrentIteration();
  const platformBranches = new Map<string, string>();
  for (const platform of targets) {
    let platformBranch = envConfig?.platforms?.[platform.name]?.branch || globalBranch;
    if (!platformBranch && platform.default_branch) {
      platformBranch = platform.default_branch;
      logger.info(`   [${platform.name}] 使用 PROJECT.yaml 默认分支: ${platformBranch}`);
    }
    if (!platformBranch && currentIteration) {
      const subtaskBranch = findSubtaskBranchForPlatform(currentIteration, platform.name);
      if (subtaskBranch) {
        platformBranch = subtaskBranch;
        logger.info(`   [${platform.name}] 使用子任务 git-config 源分支: ${platformBranch}`);
      }
    }
    if (platformBranch) {
      platformBranches.set(platform.name, platformBranch);
    }
  }

  logger.info('');
  logger.info('┌──────────────────────────────────────────┐');
  logger.info('│           Pipeline 执行计划              │');
  logger.info('├──────────────────────────────────────────┤');
  logger.info(`│ 源分支: ${sourceBranch.padEnd(32)}│`);
  if (platformBranches.size === 1) {
    const onlyBranch = platformBranches.values().next().value!;
    logger.info(`│ 目标分支: ${onlyBranch.padEnd(30)}│`);
  } else {
    logger.info(`│ 目标分支: ${'(各平台不同，见详情)'.padEnd(30)}│`);
  }
  logger.info(`│ 部署环境: ${env.padEnd(30)}│`);
  logger.info(`│ 平台数: ${String(targets.length).padEnd(31)}│`);
  logger.info(`│ 模式: ${(dryRun ? '预览' : '执行').padEnd(33)}│`);
  logger.info('└──────────────────────────────────────────┘');
  logger.info('');

  if (dryRun) {
    logger.info('📋 涉及平台:');
    for (const p of targets) {
      const pb = platformBranches.get(p.name) || globalBranch || '未配置';
      logger.info(`   • ${p.name} (${p.type}) → ${pb}`);
    }
    logger.info('');
  }

  const results: PipelineResult[] = [];

  for (const platform of targets) {
    const cwd = platform.code_path || process.cwd();
    const platformBranch = platformBranches.get(platform.name);
    if (!platformBranch) {
      logger.warn(`   ⚠️ [${platform.name}] 未配置 branch，跳过`);
      results.push({
        platform: platform.name,
        success: false,
        steps: { checkout: false, merge: false, build: false, test: false, deploy: false },
        message: '未配置 branch',
      });
      continue;
    }

    logger.info(`🔹 [${platform.name}] 开始处理...`);

    const result: PipelineResult = {
      platform: platform.name,
      success: true,
      steps: { checkout: false, merge: false, build: false, test: false, deploy: false },
    };

    // Step 1: checkout to target branch
    logger.info(`   1. 切换到 ${platformBranch}...`);
    result.steps.checkout = execGit(cwd, `git checkout "${platformBranch}"`, dryRun);
    if (!result.steps.checkout) {
      result.success = false;
      result.message = 'checkout 失败';
      results.push(result);
      continue;
    }

    if (!dryRun) {
      result.steps.checkout = execGit(cwd, `git pull origin "${platformBranch}"`, dryRun);
      if (!result.steps.checkout) {
        result.success = false;
        result.message = 'pull 失败';
        results.push(result);
        continue;
      }
    }

    // Step 2: merge source branch into target
    if (sourceBranch !== platformBranch) {
      logger.info(`   2. 合并 ${sourceBranch} → ${platformBranch}...`);
      result.steps.merge = execGit(cwd, `git merge "${sourceBranch}" --no-edit`, dryRun);
      if (!result.steps.merge) {
        result.success = false;
        result.message = 'merge 失败';
        results.push(result);
        continue;
      }
    } else {
      logger.info(`   2. 跳过 merge（已在目标分支）`);
      result.steps.merge = true;
    }

    // Step 3: build
    if (!options.skipBuild) {
      logger.info(`   3. 构建 ${platform.name}...`);
      if (dryRun) {
        logger.info('   [DRY-RUN] 将执行构建');
        result.steps.build = true;
      } else {
        try {
          await buildCommand({
            platform: platform.name,
            env,
            envFile: options.envFile,
          });
          result.steps.build = true;
        } catch {
          result.steps.build = false;
        }
      }
      if (!result.steps.build) {
        result.success = false;
        result.message = '构建失败';
        results.push(result);
        continue;
      }
    } else {
      logger.info('   3. 跳过构建 (--skip-build)');
      result.steps.build = true;
    }

    // Step 4/5: test + deploy（根据 stage 配置决定顺序）
    const pipelineTestConfig = envConfig?.pipeline?.test;
    const testEnabled = pipelineTestConfig?.enabled ?? false;
    const testType = pipelineTestConfig?.type || 'build-check';
    const testStage = pipelineTestConfig?.stage || 'pre-deploy';
    const failOnError = pipelineTestConfig?.fail_on_error ?? true;
    const autoFix = pipelineTestConfig?.auto_fix ?? true;

    // 辅助：执行 pipeline 测试
    async function executePipelineTest(stage: 'pre-deploy' | 'post-deploy'): Promise<{ passed: boolean; shouldContinue: boolean }> {
      if (!testEnabled) return { passed: true, shouldContinue: true };
      if (testStage !== stage && testStage !== 'both') return { passed: true, shouldContinue: true };

      const stepNum = stage === 'pre-deploy' ? '4' : '6';
      logger.info(`   ${stepNum}. 测试 ${platform.name} [${testType}] (${stage})...`);

      if (dryRun) {
        logger.info('   [DRY-RUN] 将执行测试');
        return { passed: true, shouldContinue: true };
      }

      const testResult = await runPipelineTest({
        platform,
        env,
        type: testType as any,
        envConfig: envConfig || undefined,
        dryRun: false,
        stage,  // v8.3.98+: 传入 stage，pre-deploy 用 local_urls
      });

      result.steps.test = testResult.passed;
      result.testReport = formatPipelineTestReport(testResult);

      if (!testResult.passed) {
        logger.error(`   ❌ 测试失败: ${testResult.error || '未知错误'}`);
        logger.info('');
        logger.info(result.testReport);

        if (stage === 'post-deploy') {
          // 部署后测试失败：已部署，不能阻断，只报告
          logger.warn(`   ⚠️ 部署后测试失败，服务已上线，请关注`);
          if (autoFix) {
            logger.info('');
            logger.info('[SPECCORE_PIPELINE_TEST_POST_DEPLOY_FAIL]');
            logger.info(`platform: ${platform.name}`);
            logger.info(`env: ${env}`);
            logger.info(`type: ${testType}`);
            logger.info(`severity: ${testResult.severity}`);
            logger.info(`error: ${testResult.error || ''}`);
            logger.info('---');
            logger.info(result.testReport);
            logger.info('[/SPECCORE_PIPELINE_TEST_POST_DEPLOY_FAIL]');
          }
          if (testResult.severity === 'critical') {
            logger.warn(`   🚨 严重错误！建议考虑回滚: speccore deploy --env ${env} --platform ${platform.name}`);
          }
          return { passed: false, shouldContinue: true };
        }

        // 部署前测试失败：按严重程度决定是否阻断
        const isCritical = testResult.severity === 'critical';
        const shouldBlock = failOnError && (isCritical || !autoFix);

        if (shouldBlock) {
          result.success = false;
          const blockReason = isCritical
            ? '严重错误，必须修复后才能部署'
            : '测试失败（未启用自动修复）';
          result.message = `${blockReason}: ${testResult.error || ''}`;

          if (autoFix) {
            logger.info('');
            logger.info('[SPECCORE_PIPELINE_TEST_FAIL]');
            logger.info(`platform: ${platform.name}`);
            logger.info(`env: ${env}`);
            logger.info(`type: ${testType}`);
            logger.info(`severity: ${testResult.severity}`);
            logger.info(`error: ${testResult.error || ''}`);
            logger.info('---');
            logger.info(result.testReport);
            logger.info('[/SPECCORE_PIPELINE_TEST_FAIL]');
          }
          return { passed: false, shouldContinue: false };
        } else if (!failOnError) {
          logger.warn(`   ⚠️ 测试失败，但 fail_on_error=false，继续部署`);
          return { passed: false, shouldContinue: true };
        } else {
          // 非严重错误 + 自动修复模式 → 先部署，同时触发修复
          logger.warn(`   ⚠️ 测试失败（${testResult.severity}），但自动修复已启用，先部署后修复`);
          result.steps.test = true;

          logger.info('');
          logger.info('[SPECCORE_PIPELINE_TEST_DEFERRED]');
          logger.info(`platform: ${platform.name}`);
          logger.info(`env: ${env}`);
          logger.info(`type: ${testType}`);
          logger.info(`severity: ${testResult.severity}`);
          logger.info(`error: ${testResult.error || ''}`);
          logger.info('---');
          logger.info(result.testReport);
          logger.info('[/SPECCORE_PIPELINE_TEST_DEFERRED]');
          return { passed: false, shouldContinue: true };
        }
      } else {
        logger.success(`   ✅ 测试通过: ${testResult.summary.passed}/${testResult.summary.total}`);
        return { passed: true, shouldContinue: true };
      }
    }

    // Pre-deploy 测试
    const preTest = await executePipelineTest('pre-deploy');
    if (!preTest.shouldContinue) {
      results.push(result);
      continue;
    }

    // Step 5: deploy（未配置则跳过，继续测试）
    logger.info(`   5. 部署 ${platform.name} → ${env}...`);
    if (dryRun) {
      logger.info('   [DRY-RUN] 将执行部署');
      result.steps.deploy = true;
    } else if (!platform.deploy?.[env]) {
      // v8.3.97+: 未配置部署参数时跳过，不阻断流水线
      logger.info(`   ⏭️  未配置部署参数，已跳过`);
      result.steps.deploy = true;
    } else {
      try {
        await deployCommand({
          platform: platform.name,
          env,
          envFile: options.envFile,
        });
        result.steps.deploy = true;
      } catch {
        result.steps.deploy = false;
      }
    }
    if (!result.steps.deploy) {
      result.success = false;
      result.message = '部署失败';
      results.push(result);
      continue;
    }

    // Post-deploy 测试
    await executePipelineTest('post-deploy');

    logger.success(`   ✅ [${platform.name}] 完成`);
    results.push(result);
  }

  // 汇总报告
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.length - successCount;

  logger.info('');
  logger.info('┌──────────────────────────────────────────┐');
  logger.info('│           Pipeline 执行汇总              │');
  logger.info('├──────────────────────────────────────────┤');
  for (const r of results) {
    const icon = r.success ? '✅' : '❌';
    const steps = [
      r.steps.checkout ? 'C' : 'c',
      r.steps.merge ? 'M' : 'm',
      r.steps.build ? 'B' : 'b',
      r.steps.test ? 'T' : 't',
      r.steps.deploy ? 'D' : 'd',
    ].join('');
    logger.info(`│ ${icon} ${r.platform.padEnd(12)} [${steps}] ${(r.message || '').padEnd(14)} │`);
  }
  logger.info('├──────────────────────────────────────────┤');
  logger.info(`│ 成功: ${String(successCount).padEnd(3)}  失败: ${String(failCount).padEnd(3)}  总计: ${String(results.length).padEnd(3)} │`);
  logger.info('└──────────────────────────────────────────┘');

  // 分支状态提示
  if (!dryRun) {
    const uniqueBranches = new Set(platformBranches.values());
    if (uniqueBranches.size === 1) {
      const onlyBranch = uniqueBranches.values().next().value;
      if (sourceBranch !== onlyBranch) {
        logger.info('');
        logger.info(`💡 Pipeline 已完成，当前在 ${onlyBranch} 分支`);
        logger.info(`   如需回到原分支: git checkout ${sourceBranch}`);
      }
    } else {
      logger.info('');
      logger.info(`💡 Pipeline 已完成，各平台所在分支:`);
      for (const [name, branch] of platformBranches) {
        logger.info(`   ${name}: ${branch}`);
      }
      logger.info(`   如需回到原分支: git checkout ${sourceBranch}`);
    }
  }

  if (failCount > 0) {
    process.exitCode = 1;
  }
}
