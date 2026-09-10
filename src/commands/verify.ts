/**
 * verify — 代码验证命令
 *
 * 执行后验证代码质量：编译检查 + Lint + 单元测试
 * 支持项目级和任务级验证
 *
 * 用法:
 *   speccore verify                          # 验证当前迭代所有任务
 *   speccore verify -t Task-001              # 验证单个任务
 *   speccore verify -t Task-001 --type=lint  # 只跑 lint
 *   speccore verify --path=./backend         # 指定代码路径
 */

import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, getIterationDir } from '../core/context';
import { pathExists, readFile, writeFile, ensureDir } from 'fs-extra';
import { join, basename, isAbsolute } from 'path';
import { scanTasks, TaskState } from '../core/state';
import { resolveTask, formatResolveResult } from '../core/resolver';
import { runVerification, writeVerifyReport, VerifyReport } from '../core/verify-engine';
import { loadConfig, loadProjectConfig } from '../core/unified-config';
import { parsePlatformList } from '../core/spec-paths';
import { parseYamlFile } from '../core/yaml-parser';
import { createInterface } from 'readline';
import {
  VerifySpec,
  UIVerifyOptions,
  UIVerifyReport,
  runSmokeTest,
  runVisualCheck,
  generateHtmlReport,
  // v8.3.57+: 路由/页面发现 + 模块过滤
  scanRoutes,
  scanPages,
  generateSpecFromRoutes,
  generateSpecFromPages,
  writeVerifySpec,
  filterSpec,
  parseFilterArgs,
  logFilterSummary,
  flattenRoutes,
} from '../core/ui-verify';
import {
  ApiContractSpec,
  ApiVerifyReport,
  runApiContractTest,
} from '../core/api-verify';
import {
  PerfSpec,
  PerfVerifyReport,
  runPerfTest,
} from '../core/perf-verify';
import {
  loadTaskQualityGate,
  mergeQualityGate,
  shouldRunUIVerify,
} from '../core/quality-gate';
import { loadTestConfig, mergeTestConfigWithEnv } from '../core/test-config';
import type { TestConfig, TestCase } from '../core/test-config';
import { collectTaskReports, generateQualityReport } from '../core/verify-report-aggregator';
import { findProjectRoot } from '../utils/task-utils';

interface VerifyOptions {
  task?: string;
  iteration?: string;
  type?: 'compile' | 'lint' | 'test' | 'artifact' | 'all';
  path?: string;
  timeout?: number;
  // v8.3.60+: 分层测试阶段
  stage?: 'dev' | 'pr' | 'deploy' | 'release' | '';
  ui?: boolean;
  smokeOnly?: boolean;
  visualOnly?: boolean;
  device?: string;
  updateBaseline?: boolean;
  headed?: boolean;
  browser?: string;
  visualModel?: string;
  url?: string;
  spec?: string;
  output?: string;
  apiContract?: boolean;
  perf?: boolean;
  updatePerfBaseline?: boolean;
  // v8.3.57+: 路由发现 + 模块过滤
  discoverRoutes?: boolean;
  discoverPages?: boolean;
  generateSpec?: boolean;
  routerFile?: string;
  module?: string;
  page?: string;
  scenario?: string;
  baseUrl?: string;
  envFile?: string;
  config?: string;
}

export async function verifyCommand(options: VerifyOptions): Promise<void> {
  // v8.3.101+: 向上查找项目根目录（支持在子目录执行）
  const projectRoot = findProjectRoot() || process.cwd();

  // v8.3.60+: 分层测试阶段映射
  if (options.stage) {
    applyStageDefaults(options);
  }

  const spinner = new Spinner('正在执行代码验证...');
  spinner.start();

  try {
    // ============================================================
    // v8.3.60+ 新模式零：测试场景配置文件驱动
    // ============================================================
    if (options.config) {
      spinner.stop();
      await runTestConfigMode(options);
      return;
    }

    // ============================================================
    // v8.3.57+ 模式零：路由/页面自动发现
    // ============================================================
    if (options.discoverRoutes || options.discoverPages || options.generateSpec) {
      spinner.stop();
      await handleDiscoveryMode(options);
      return;
    }

    // ============================================================
    // 模式一：独立模式（无项目结构，直接测任意 URL）
    // ============================================================
    if ((options.ui || options.smokeOnly || options.visualOnly) && (options.url || options.spec)) {
      spinner.stop();
      logger.info('🌐 独立模式：不依赖 SpecCore 项目结构');

      const uiReport = await runUIVerificationIndependent(options);
      if (uiReport) {
        logger.info('');
        logUIReport(uiReport);
      }
      return;
    }

    // ============================================================
    // 模式二/三：需要 SpecCore 项目结构
    // ============================================================
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('未找到活跃迭代。请先运行: speccore iteration create --name <名称>');
      logger.info('💡 或使用独立模式: speccore verify --ui --url=https://example.com --spec=./test.yaml');
      return;
    }

    const iterDir = await getIterationDir(iteration);
    const config = await loadConfig();
    const projectConfig = await loadProjectConfig();
    // v8.3.105+: 加载平台列表用于推断平台名
    const platformList = await parsePlatformList();
    const platformSet = new Set(platformList);

    // 确定代码路径（v8.3.101+: 基于项目根目录解析）
    let codePath: string;
    if (options.path) {
      codePath = options.path;
    } else {
      codePath = projectConfig.code_scope?.[0] || projectRoot;
      if (!isAbsolute(codePath)) {
        codePath = join(projectRoot, codePath);
      }
    }

    // 检查代码路径是否存在
    if (!(await pathExists(codePath))) {
      spinner.fail(`代码路径不存在: ${codePath}`);
      logger.info('💡 使用 --path 指定正确的代码路径，或在 .speccore.yml 中配置 code_scope');
      return;
    }

    // ── 模式三：任务绑定模式 ──
    if (options.task) {
      const taskResult = await resolveTask(options.task, iteration);
      if (!taskResult.exact || !taskResult.value) {
        spinner.fail(taskResult.hint || `Task "${options.task}" 未找到`);
        return;
      }
      if (taskResult.matchType !== 'exact') {
        const hint = formatResolveResult(taskResult, 'Task');
        if (hint) logger.info(hint);
      }

      const task = taskResult.value;
      spinner.stop();

      // ── 质量门禁配置合并（v8.3.48+）──
      const taskDir = await findTaskDir(task.id, iterDir);
      const taskQG = taskDir ? await loadTaskQualityGate(taskDir) : null;
      const resolvedQG = mergeQualityGate({
        projectLevel: config.quality_gates?.verify_ui,
        taskLevel: taskQG?.verify_ui,
        cliOverrides: {
          enabled: options.ui || options.smokeOnly || options.visualOnly || undefined,
          smokeOnly: options.smokeOnly,
          visualOnly: options.visualOnly,
          device: options.device,
          browser: options.browser,
          timeout: options.timeout,
        },
      });

      // UI 验证（任务绑定，自动检测配置）
      if (shouldRunUIVerify(resolvedQG)) {
        logger.info(`🔒 质量门禁: UI 验证已启用（项目级${config.quality_gates?.verify_ui?.enabled ? '✅' : '⏭️'} → 任务级${taskQG?.verify_ui?.enabled ? '✅' : '⏭️'} → 命令行${options.ui ? '✅' : '⏭️'}）`);
        const uiReport = await runUIVerification(task.id, iterDir, options, resolvedQG);
        if (uiReport) {
          logger.info('');
          logUIReport(uiReport);
          // 如果 UI 验证失败且阈值 strict，阻断后续流程
          if (!uiReport.summary.passed && resolvedQG.verify_ui.threshold === 'strict') {
            logger.error('❌ UI 验证失败（strict 模式），阻断执行');
            return;
          }
        }
      }

      // API 契约测试（v8.3.48+）
      if (options.apiContract) {
        const apiReport = await runApiContractVerification(task.id, iterDir, options);
        if (apiReport && !apiReport.summary.passed) {
          logger.error('❌ API 契约测试失败，阻断执行');
          return;
        }
      }

      // 性能基线测试（v8.3.48+）
      if (options.perf) {
        const perfReport = await runPerfVerification(task.id, iterDir, options);
        if (perfReport && !perfReport.summary.passed) {
          logger.error('❌ 性能基线测试失败，阻断执行');
          return;
        }
      }

      // 代码验证
      const taskCodePath = await findTaskCodePath(task, iterDir, codePath);
      const platformName = taskDir ? inferPlatformName(taskDir, platformSet) : undefined;
      const report = await runVerification(task.id, taskCodePath, {
        type: options.type || 'all',
        timeout: options.timeout,
        platformName,
      });

      const reportDir = taskDir ? join(taskDir, '99-artifacts') : join(iterDir, '020-specs');
      const reportPath = await writeVerifyReport(report, reportDir);

      logReport(report, reportPath);
      return;
    }

    // ── 模式二：项目内独立模式（有项目，无任务）──
    if (options.ui || options.smokeOnly || options.visualOnly) {
      spinner.stop();
      logger.info('📁 项目内独立模式：使用项目配置，但不绑定任务');

      // 尝试从项目 tests/ 目录或 --spec 参数读取
      const uiReport = await runUIVerificationProject(options, iterDir, projectConfig);
      if (uiReport) {
        logger.info('');
        logUIReport(uiReport);
        return;
      }
    }

    // 迭代级验证（原有逻辑）
    spinner.stop();
    const platformName = inferPlatformName(codePath, platformSet) || inferPlatformNameFromCodePath(codePath, projectConfig.platforms);
    const report = await runVerification(`Iteration-${iteration}`, codePath, {
      type: options.type || 'all',
      timeout: options.timeout,
      platformName,
    });

    // v8.3.49+: 迭代级报告输出到 000-overview/，与 plan 同级
    const reportDir = join(iterDir, '000-overview');
    await ensureDir(reportDir);
    const reportPath = await writeVerifyReport(report, reportDir);

    logReport(report, reportPath);

    // 生成迭代级质量看板（聚合所有 Task 的测试报告）
    const taskReports = await collectTaskReports(iterDir);
    if (taskReports.length > 0) {
      await generateQualityReport(iterDir, taskReports);
    }
  } catch (error) {
    spinner.fail(`验证失败: ${error}`);
    throw error;
  }
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 查找任务对应的代码路径
 */
async function findTaskCodePath(task: TaskState, iterDir: string, defaultCodePath: string): Promise<string> {
  // 1. 检查任务目录下是否有 code/ 子目录
  const taskDir = await findTaskDir(task.id, iterDir);
  if (taskDir) {
    const codeDir = join(taskDir, 'code');
    if (await pathExists(codeDir)) return codeDir;
  }

  // 2. 使用默认代码路径
  return defaultCodePath;
}

/**
 * 查找任务目录（兼容多种布局）
 */
async function findTaskDir(taskId: string, iterDir: string): Promise<string | null> {
  const candidates = [
    join(iterDir, '030-tasks', taskId),
    join(iterDir, taskId),
  ];
  for (const c of candidates) {
    if (await pathExists(c)) return c;
  }
  return null;
}

/**
 * 格式化输出报告
 */
function logReport(report: VerifyReport, reportPath: string): void {
  const { summary } = report;
  const passRate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;

  logger.info('');
  logger.info(`📊 验证报告 — ${report.taskId}`);
  logger.info(`   项目类型: ${report.projectType}`);
  logger.info(`   代码路径: ${report.codePath}`);
  logger.info('');

  for (const check of report.checks) {
    const icon = check.status === 'pass' ? '✅' : check.status === 'fail' ? '❌' : check.status === 'warn' ? '⚠️' : '⏭️';
    const dur = check.duration > 0 ? `(${(check.duration / 1000).toFixed(1)}s)` : '';
    logger.info(`   ${icon} ${check.name}: ${check.details} ${dur}`);
  }

  logger.info('');
  logger.info(`   通过率: ${passRate}% (${summary.passed}/${summary.total})`);

  if (summary.failed > 0) {
    logger.warn(`   ❌ ${summary.failed} 项检查失败`);
  }
  if (summary.warnings > 0) {
    logger.info(`   ⚠️ ${summary.warnings} 项警告`);
  }

  logger.info('');
  logger.info(`   📄 报告: ${reportPath}`);

  if (summary.failed > 0) {
    logger.info('');
    logger.info('💡 下一步:');
    logger.info(`   修复失败项后重新运行: speccore verify -t ${report.taskId}`);
  }
}

// ============================================================
// UI 验证辅助函数（v8.3.47+）
// ============================================================

export async function runUIVerification(
  taskId: string,
  iterDir: string,
  options: VerifyOptions,
  qgConfig?: import('../core/quality-gate').ResolvedQualityGate
): Promise<UIVerifyReport | null> {
  const taskDir = await findTaskDir(taskId, iterDir);
  if (!taskDir) {
    logger.warn(`未找到任务目录: ${taskId}`);
    return null;
  }

  // 查找 VERIFY_SPEC.yaml
  const specPaths = [
    join(taskDir, 'VERIFY_SPEC.yaml'),
    join(taskDir, '00-specs', 'VERIFY_SPEC.yaml'),
    join(taskDir, 'frontend', 'VERIFY_SPEC.yaml'),
    join(taskDir, 'web', 'VERIFY_SPEC.yaml'),
  ];

  let specPath: string | null = null;
  for (const p of specPaths) {
    if (await pathExists(p)) {
      specPath = p;
      break;
    }
  }

  // v8.3.60+: 无 VERIFY_SPEC.yaml 时，尝试从源码扫描生成
  if (!specPath) {
    logger.warn(`未找到 VERIFY_SPEC.yaml`);

    let generatedSpec: VerifySpec | null = null;
    let generatedPath: string | null = null;

    try {
      const projectConfig = await loadProjectConfig();
      // 推断当前任务对应的端名（从 taskDir 路径提取）
      const platformHint = inferPlatformFromTaskDir(taskDir);
      const platformConfig = projectConfig.platforms.find(
        p => p.name === platformHint || taskDir.includes(p.name)
      );
      const codePath = platformConfig?.code_path
        ? (isAbsolute(platformConfig.code_path)
            ? platformConfig.code_path
            : join(findProjectRoot() || process.cwd(), platformConfig.code_path))
        : null;

      if (codePath && await pathExists(codePath)) {
        const routeResult = await scanRoutes(codePath);
        if (routeResult.routes.length > 0) {
          logger.info(`🔍 从源码扫描到 ${routeResult.routes.length} 条路由`);

          const baseUrl = options.baseUrl || options.url || 'http://localhost:3000';
          generatedSpec = generateSpecFromRoutes(routeResult.routes, {
            baseUrl,
            platform: platformHint || routeResult.framework,
            name: `${taskId} UI 验证`,
          });
          generatedPath = join(taskDir, 'VERIFY_SPEC.yaml');

          // 交互式确认（TTY 环境下）
          if (process.stdin.isTTY) {
            logger.info('');
            const answer = await promptUser('是否根据扫描的路由自动生成 VERIFY_SPEC.yaml？[Y/n]');
            if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
              logger.info('⏭️  跳过自动生成，UI 验证取消');
              return null;
            }
          } else {
            logger.info('💡 非交互环境，自动根据源码生成 VERIFY_SPEC.yaml');
          }

          await writeVerifySpec(generatedSpec, generatedPath);
          logger.info(`📄 VERIFY_SPEC.yaml 已自动生成: ${generatedPath}`);
          specPath = generatedPath;
        }
      }
    } catch {
      // 扫描失败，静默回退到原有提示
    }

    if (!specPath) {
      logger.info(`💡 在任务目录下创建 VERIFY_SPEC.yaml 以启用 UI 验证`);
      logger.info(`   或运行: speccore verify --ui --discover-routes --generate-spec`);
      return null;
    }
  }

  logger.info(`📄 加载测试规格: ${specPath}`);

  const parseResult = await parseYamlFile(specPath);
  if (!parseResult.success || !parseResult.data) {
    logger.error(`解析 VERIFY_SPEC.yaml 失败: ${parseResult.error}`);
    return null;
  }

  const spec = parseResult.data as VerifySpec;

  // 准备目录
  const screenshotDir = join(taskDir, '99-artifacts', 'screenshots');
  const baselineDir = join(taskDir, '99-artifacts', 'baselines');
  const diffDir = join(taskDir, '99-artifacts', 'diffs');
  const reportDir = join(taskDir, '99-artifacts');

  await ensureDir(screenshotDir);
  await ensureDir(baselineDir);
  await ensureDir(diffDir);

  const uiOptions: UIVerifyOptions = {
    smokeTest: qgConfig ? qgConfig.verify_ui.smoke_test : !options.visualOnly,
    visualCheck: qgConfig ? qgConfig.verify_ui.visual_check : !options.smokeOnly,
    devices: options.device ? [options.device] : qgConfig?.verify_ui.devices || ['desktop'],
    browsers: options.browser ? [options.browser] : qgConfig?.verify_ui.browsers || ['chromium'],
    updateBaseline: options.updateBaseline || false,
    threshold: qgConfig?.verify_ui.threshold || 'normal',
    timeout: options.timeout || qgConfig?.verify_ui.timeout || 30000,
    visualModel: options.visualModel
      ? parseVisualModelCli(options.visualModel)
      : qgConfig?.verify_ui.visual_model,
    headed: options.headed ?? qgConfig?.verify_ui?.headed ?? false,
  };

  const startTime = Date.now();
  let smokeResults: import('../core/ui-verify').SmokeResult[] = [];
  let visualResults: import('../core/ui-verify').VisualResult[] = [];

  // 1. 执行冒烟测试
  if (uiOptions.smokeTest) {
    logger.info('🔥 执行冒烟测试...');
    smokeResults = await runSmokeTest(spec, {
      screenshotDir,
      browser: uiOptions.browsers?.[0] as 'chromium' | 'firefox' | 'webkit',
      device: uiOptions.devices?.[0],
      timeout: uiOptions.timeout,
      executablePath: process.env.SPECCORE_BROWSER_PATH,
      headless: !options.headed,
    });
  }

  // 2. 执行视觉检查
  if (uiOptions.visualCheck) {
    logger.info('👁️ 执行视觉检查...');
    visualResults = await runVisualCheck(smokeResults, {
      baselineDir,
      screenshotDir,
      diffDir,
      threshold: uiOptions.threshold || 'normal',
      updateBaseline: uiOptions.updateBaseline || false,
      visualModel: uiOptions.visualModel,
    });
  }

  const duration = Date.now() - startTime;
  const allResults = [...smokeResults, ...visualResults];
  const passed = allResults.filter((r) => r.passed).length;
  const failed = allResults.filter((r) => !r.passed).length;

  const report: UIVerifyReport = {
    taskId,
    timestamp: new Date().toISOString(),
    platform: spec.platform,
    url: spec.url,
    smokeEnabled: uiOptions.smokeTest,
    visualEnabled: uiOptions.visualCheck,
    smokeResults,
    visualResults,
    summary: {
      total: allResults.length,
      passed,
      failed,
      duration,
    },
  };

  // 生成 HTML 报告
  const htmlPath = await generateHtmlReport(report, reportDir);
  logger.info(`📄 UI 验证报告: ${htmlPath}`);

  return report;
}

export function logUIReport(report: UIVerifyReport): void {
  const { summary } = report;
  const passRate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;

  logger.info('');
  logger.info(`🎨 UI 验证报告 — ${report.taskId}`);
  logger.info(`   平台: ${report.platform} | URL: ${report.url}`);
  logger.info(`   冒烟测试: ${report.smokeEnabled ? '✅' : '⏭️'} | 视觉检查: ${report.visualEnabled ? '✅' : '⏭️'}`);
  logger.info('');

  if (report.smokeEnabled && report.smokeResults.length > 0) {
    logger.info('   🔥 冒烟测试结果:');
    for (const r of report.smokeResults) {
      const icon = r.passed ? '✅' : '❌';
      logger.info(`      ${icon} ${r.scenarioName} (${r.steps.filter((s) => s.passed).length}/${r.steps.length} 步通过)`);
    }
    logger.info('');
  }

  if (report.visualEnabled && report.visualResults.length > 0) {
    logger.info('   👁️ 视觉检查结果:');
    for (const r of report.visualResults) {
      const icon = r.passed ? '✅' : '⚠️';
      const issueCount = r.issues.length;
      logger.info(`      ${icon} ${r.scenarioName}${issueCount > 0 ? ` (${issueCount} 项问题)` : ''}`);
    }
    logger.info('');
  }

  logger.info(`   通过率: ${passRate}% (${summary.passed}/${summary.total})`);

  if (summary.failed > 0) {
    logger.warn(`   ❌ ${summary.failed} 项检查失败`);
  }
}

// ============================================================
// 视觉模型 CLI 参数解析
// ============================================================

function parseVisualModelCli(input: string): string | import('../core/quality-gate').VisualModelConfig {
  // 尝试解析为 JSON 配置对象
  if (input.startsWith('{')) {
    try {
      const parsed = JSON.parse(input);
      if (parsed.provider) {
        return parsed as import('../core/quality-gate').VisualModelConfig;
      }
    } catch {
      // 不是合法 JSON，回退为字符串
    }
  }
  return input;
}

// ============================================================
// v8.3.60+ 测试场景配置驱动模式
// ============================================================

async function runTestConfigMode(options: VerifyOptions): Promise<void> {
  logger.info('📄 测试场景配置模式');

  const testConfig = await loadTestConfig(options.config!);
  if (!testConfig) {
    logger.error('❌ 无法加载测试配置文件');
    process.exitCode = 1;
    return;
  }

  // 若指定了环境文件，加载并合并（支持环境名或文件路径）
  let mergedConfig = testConfig;
  if (options.envFile) {
    const { loadEnvironmentByNameOrPath } = await import('../core/environment-config');
    const envConfig = await loadEnvironmentByNameOrPath(options.envFile);
    if (envConfig) {
      mergedConfig = mergeTestConfigWithEnv(testConfig, envConfig);
      logger.info(`🌍 已合并环境配置: ${options.envFile}`);
    }
  }

  const outputDir = options.output || mergedConfig.output || join(findProjectRoot() || process.cwd(), 'reports');
  const screenshotDir = join(outputDir, 'screenshots');
  const baselineDir = join(outputDir, 'baselines');
  const diffDir = join(outputDir, 'diffs');
  await ensureDir(screenshotDir);
  await ensureDir(baselineDir);
  await ensureDir(diffDir);

  const allReports: UIVerifyReport[] = [];

  for (const testCase of mergedConfig.tests) {
    logger.info(`\n🔹 执行测试: ${testCase.name} [${testCase.type}]`);

    const targetUrl = resolveTestUrl(testCase, mergedConfig, options.url);
    if (!targetUrl) {
      logger.warn(`⚠️ 无法确定目标 URL，跳过: ${testCase.name}`);
      continue;
    }

    if (testCase.type === 'smoke' || testCase.type === 'visual') {
      const spec = buildVerifySpecFromTestCase(testCase, targetUrl);
      const browser = (testCase.browsers?.[0] || options.browser || 'chromium') as 'chromium' | 'firefox' | 'webkit';
      const device = testCase.devices?.[0] || options.device || 'desktop';
      const timeout = options.timeout || 30000;

      logger.info(`   目标: ${targetUrl}`);
      const smokeResults = await runSmokeTest(spec, {
        screenshotDir,
        browser,
        device,
        timeout,
        executablePath: process.env.SPECCORE_BROWSER_PATH,
        headless: !options.headed,
      });

      let visualResults: import('../core/ui-verify').VisualResult[] = [];
      if (testCase.type === 'visual') {
        const visualModel = mergedConfig.visual_model
          ? mergedConfig.visual_model
          : options.visualModel
            ? parseVisualModelCli(options.visualModel)
            : undefined;
        visualResults = await runVisualCheck(smokeResults, {
          baselineDir,
          screenshotDir,
          diffDir,
          threshold: testCase.threshold || 'normal',
          updateBaseline: options.updateBaseline || false,
          visualModel,
        });
      }

      const passed = [...smokeResults, ...visualResults].filter((r) => r.passed).length;
      const failed = [...smokeResults, ...visualResults].filter((r) => !r.passed).length;

      const report: UIVerifyReport = {
        taskId: testCase.name,
        timestamp: new Date().toISOString(),
        platform: 'test-config',
        url: targetUrl,
        smokeEnabled: true,
        visualEnabled: testCase.type === 'visual',
        smokeResults,
        visualResults,
        summary: {
          total: smokeResults.length + visualResults.length,
          passed,
          failed,
          duration: 0,
        },
      };
      allReports.push(report);
    }

    if (testCase.type === 'api') {
      logger.info(`   API 测试: ${targetUrl}`);
      // API 测试需要 API_CONTRACT.yaml，尝试从测试配置目录查找
      const apiSpecPath = options.spec || join(findProjectRoot() || process.cwd(), 'API_CONTRACT.yaml');
      if (await pathExists(apiSpecPath)) {
        const parseResult = await parseYamlFile(apiSpecPath);
        if (parseResult.success && parseResult.data) {
          const apiSpec = parseResult.data as ApiContractSpec;
          // 使用测试配置中的 targetUrl 覆盖 spec 中的 baseUrl
          apiSpec.baseUrl = targetUrl;
          const apiReport = await runApiContractTest(apiSpec);
          if (apiReport) {
            logger.info(`   API 测试完成: ${apiReport.summary.passed}/${apiReport.summary.total} 通过`);
          }
        } else {
          logger.warn(`   ⚠️ API 规格解析失败: ${parseResult.error}`);
        }
      } else {
        logger.warn(`   ⚠️ 未找到 API_CONTRACT.yaml，跳过 API 测试`);
      }
    }
  }

  // 汇总并输出报告
  if (allReports.length > 0) {
    const combinedReport: UIVerifyReport = {
      taskId: mergedConfig.name || 'test-config-run',
      timestamp: new Date().toISOString(),
      platform: 'test-config',
      url: mergedConfig.target?.url || '',
      smokeEnabled: true,
      visualEnabled: mergedConfig.tests.some((t) => t.type === 'visual'),
      smokeResults: allReports.flatMap((r) => r.smokeResults),
      visualResults: allReports.flatMap((r) => r.visualResults),
      summary: {
        total: allReports.reduce((s, r) => s + r.summary.total, 0),
        passed: allReports.reduce((s, r) => s + r.summary.passed, 0),
        failed: allReports.reduce((s, r) => s + r.summary.failed, 0),
        duration: 0,
      },
    };

    logUIReport(combinedReport);
    const htmlPath = await generateHtmlReport(combinedReport, outputDir);
    logger.info(`\n📄 测试报告: ${htmlPath}`);
  }
}

/** 根据测试用例和全局配置解析目标 URL */
function resolveTestUrl(testCase: TestCase, config: TestConfig, cliUrl?: string): string | null {
  if (cliUrl) return cliUrl;
  if (config.target?.url) return config.target.url;
  if (testCase.routes && testCase.routes.length > 0) {
    // 取第一个 route 拼接 base_url
    const base = config.target?.base_url || '';
    return base + testCase.routes[0];
  }
  return null;
}

/** 将 TestCase 转换为 VerifySpec */
function buildVerifySpecFromTestCase(testCase: TestCase, baseUrl: string): VerifySpec {
  const routes = testCase.routes || ['/'];
  const scenarios = routes.map((route) => ({
    name: `navigate-${route}`,
    actions: [
      { type: 'navigate' as const, value: baseUrl + route },
      { type: 'screenshot' as const },
    ],
    assertions: [{ type: 'visible' as const }],
  }));

  return {
    name: testCase.name,
    platform: 'test-config',
    url: baseUrl,
    scenarios,
  };
}

// ============================================================
// 模式一：独立模式（无项目结构）
// ============================================================

async function runUIVerificationIndependent(options: VerifyOptions): Promise<UIVerifyReport | null> {
  const specPath = options.spec;
  const url = options.url;

  if (!specPath || !(await pathExists(specPath))) {
    logger.warn(`未找到测试规格文件: ${specPath}`);
    logger.info('💡 使用 --spec=./VERIFY_SPEC.yaml 指定测试规格');
    return null;
  }

  logger.info(`📄 加载测试规格: ${specPath}`);

  const parseResult = await parseYamlFile(specPath);
  if (!parseResult.success || !parseResult.data) {
    logger.error(`解析规格文件失败: ${parseResult.error}`);
    return null;
  }

  const spec = parseResult.data as VerifySpec;

  // 如果命令行指定了 url，覆盖规格中的 url
  if (url) {
    spec.url = url;
  }

  const outputDir = options.output || join(findProjectRoot() || process.cwd(), 'reports');
  const screenshotDir = join(outputDir, 'screenshots');
  const baselineDir = join(outputDir, 'baselines');
  const diffDir = join(outputDir, 'diffs');

  await ensureDir(screenshotDir);
  await ensureDir(baselineDir);
  await ensureDir(diffDir);

  const uiOptions: UIVerifyOptions = {
    smokeTest: !options.visualOnly,
    visualCheck: !options.smokeOnly,
    devices: options.device ? [options.device] : ['desktop'],
    browsers: options.browser ? [options.browser] : ['chromium'],
    updateBaseline: options.updateBaseline || false,
    threshold: 'normal',
    timeout: options.timeout || 30000,
    visualModel: options.visualModel ? parseVisualModelCli(options.visualModel) : undefined,
    headed: options.headed ?? false,
  };

  const startTime = Date.now();
  let smokeResults: import('../core/ui-verify').SmokeResult[] = [];
  let visualResults: import('../core/ui-verify').VisualResult[] = [];

  if (uiOptions.smokeTest) {
    logger.info('🔥 执行冒烟测试...');
    smokeResults = await runSmokeTest(spec, {
      screenshotDir,
      browser: uiOptions.browsers?.[0] as 'chromium' | 'firefox' | 'webkit',
      device: uiOptions.devices?.[0],
      timeout: uiOptions.timeout,
      executablePath: process.env.SPECCORE_BROWSER_PATH,
      headless: !options.headed,
    });
  }

  if (uiOptions.visualCheck) {
    logger.info('👁️ 执行视觉检查...');
    visualResults = await runVisualCheck(smokeResults, {
      baselineDir,
      screenshotDir,
      diffDir,
      threshold: uiOptions.threshold || 'normal',
      updateBaseline: uiOptions.updateBaseline || false,
      visualModel: uiOptions.visualModel,
    });
  }

  const duration = Date.now() - startTime;
  const allResults = [...smokeResults, ...visualResults];
  const passed = allResults.filter((r) => r.passed).length;
  const failed = allResults.filter((r) => !r.passed).length;

  const report: UIVerifyReport = {
    taskId: 'independent',
    timestamp: new Date().toISOString(),
    platform: spec.platform,
    url: spec.url,
    smokeEnabled: uiOptions.smokeTest,
    visualEnabled: uiOptions.visualCheck,
    smokeResults,
    visualResults,
    summary: {
      total: allResults.length,
      passed,
      failed,
      duration,
    },
  };

  const htmlPath = await generateHtmlReport(report, outputDir);
  logger.info(`📄 UI 验证报告: ${htmlPath}`);

  return report;
}

// ============================================================
// 模式二：项目内独立模式（有项目，无任务）
// ============================================================

async function runUIVerificationProject(
  options: VerifyOptions,
  iterDir: string,
  projectConfig: any
): Promise<UIVerifyReport | null> {
  // 1. 优先使用 --spec 指定的文件
  if (options.spec && (await pathExists(options.spec))) {
    return runUIVerificationIndependent({
      ...options,
      output: options.output || join(iterDir, '020-specs', 'ui-reports'),
    });
  }

  // 2. 查找项目 tests/ 目录下的 VERIFY_SPEC.yaml
  const projectRoot = findProjectRoot() || process.cwd();
  const testsDir = join(projectRoot, 'tests');
  const projectTestsDir = join(projectRoot, '.speccore', 'tests');

  const specPaths = [
    join(testsDir, 'VERIFY_SPEC.yaml'),
    join(projectTestsDir, 'VERIFY_SPEC.yaml'),
    join(testsDir, 'ui-test.yaml'),
    join(projectTestsDir, 'ui-test.yaml'),
  ];

  for (const p of specPaths) {
    if (await pathExists(p)) {
      logger.info(`📄 发现项目测试规格: ${p}`);
      return runUIVerificationIndependent({
        ...options,
        spec: p,
        output: options.output || join(iterDir, '020-specs', 'ui-reports'),
      });
    }
  }

  logger.warn('未找到项目内测试规格文件');
  logger.info('💡 在项目根目录创建 tests/VERIFY_SPEC.yaml，或使用 --spec 指定');
  return null;
}

// ============================================================
// API 契约测试（v8.3.48+）
// ============================================================

async function runApiContractVerification(
  taskId: string,
  iterDir: string,
  options: VerifyOptions
): Promise<ApiVerifyReport | null> {
  const taskDir = await findTaskDir(taskId, iterDir);
  if (!taskDir) {
    logger.warn(`未找到任务目录: ${taskId}`);
    return null;
  }

  // 查找 API_CONTRACT.yaml
  const contractPaths = [
    join(taskDir, 'API_CONTRACT.yaml'),
    join(taskDir, '00-specs', 'API_CONTRACT.yaml'),
    join(taskDir, 'backend', 'API_CONTRACT.yaml'),
    join(taskDir, 'api', 'API_CONTRACT.yaml'),
  ];

  let contractPath: string | null = null;
  for (const p of contractPaths) {
    if (await pathExists(p)) {
      contractPath = p;
      break;
    }
  }

  if (!contractPath) {
    logger.warn(`未找到 API_CONTRACT.yaml，跳过 API 契约测试`);
    logger.info(`💡 在任务目录下创建 API_CONTRACT.yaml 以启用 API 契约测试`);
    return null;
  }

  logger.info(`📄 加载 API 契约规格: ${contractPath}`);

  const parseResult = await parseYamlFile(contractPath);
  if (!parseResult.success || !parseResult.data) {
    logger.error(`解析 API_CONTRACT.yaml 失败: ${parseResult.error}`);
    return null;
  }

  const spec = parseResult.data as ApiContractSpec;

  const report = await runApiContractTest(spec, {
    timeout: options.timeout || 10000,
    verbose: true,
  });

  // 保存 JSON 报告
  const reportDir = join(taskDir, '99-artifacts');
  await ensureDir(reportDir);
  const jsonPath = join(reportDir, 'api-verify-report.json');
  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  logger.info(`📄 API 契约测试报告: ${jsonPath}`);

  return report;
}

// ============================================================
// 性能基线测试（v8.3.48+）
// ============================================================

async function runPerfVerification(
  taskId: string,
  iterDir: string,
  options: VerifyOptions
): Promise<PerfVerifyReport | null> {
  const taskDir = await findTaskDir(taskId, iterDir);
  if (!taskDir) {
    logger.warn(`未找到任务目录: ${taskId}`);
    return null;
  }

  // 查找 PERF_SPEC.yaml
  const perfPaths = [
    join(taskDir, 'PERF_SPEC.yaml'),
    join(taskDir, '00-specs', 'PERF_SPEC.yaml'),
    join(taskDir, 'frontend', 'PERF_SPEC.yaml'),
    join(taskDir, 'web', 'PERF_SPEC.yaml'),
  ];

  let perfPath: string | null = null;
  for (const p of perfPaths) {
    if (await pathExists(p)) {
      perfPath = p;
      break;
    }
  }

  if (!perfPath) {
    logger.warn(`未找到 PERF_SPEC.yaml，跳过性能基线测试`);
    logger.info(`💡 在任务目录下创建 PERF_SPEC.yaml 以启用性能基线测试`);
    return null;
  }

  logger.info(`📄 加载性能规格: ${perfPath}`);

  const parseResult = await parseYamlFile(perfPath);
  if (!parseResult.success || !parseResult.data) {
    logger.error(`解析 PERF_SPEC.yaml 失败: ${parseResult.error}`);
    return null;
  }

  const spec = parseResult.data as PerfSpec;

  const baselineDir = join(taskDir, '99-artifacts');
  await ensureDir(baselineDir);

  const report = await runPerfTest(spec, baselineDir, {
    updateBaseline: options.updatePerfBaseline,
    verbose: true,
  });

  // 保存 JSON 报告
  const reportPath = join(baselineDir, 'perf-verify-report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  logger.info(`📄 性能基线测试报告: ${reportPath}`);

  return report;
}

// ============================================================
// v8.3.57+: 路由/页面自动发现模式
// ============================================================

async function handleDiscoveryMode(options: VerifyOptions): Promise<void> {
  const projectRoot = options.path || findProjectRoot() || process.cwd();

  // ── 路由发现 ──
  if (options.discoverRoutes) {
    logger.info('🔍 扫描前端路由配置...');

    // 优先级：CLI 参数 > 项目配置 > 自动发现
    let routerFile = options.routerFile;
    if (!routerFile) {
      try {
        const projectConfig = await loadProjectConfig();
        if (projectConfig.verify?.router_file) {
          routerFile = projectConfig.verify.router_file;
          logger.info(`📋 使用项目配置中的路由文件: ${routerFile}`);
        }
      } catch { /* 无 PROJECT.yaml 时忽略 */ }
    }

    const result = await scanRoutes(projectRoot, { routerFile });

    if (result.framework === 'unknown' || result.routes.length === 0) {
      logger.warn('⚠️  未检测到前端路由配置');
      logger.info('💡 支持的框架：Vue Router / React Router');
      logger.info('💡 期望路径：src/router/index.ts 或 src/App.tsx');
      return;
    }

    logger.info(`✅ 检测到 ${result.framework.toUpperCase()} Router，发现 ${result.routes.length} 条路由`);
    logger.info(`   模块: ${result.modules.join(', ')}`);

    // 打印路由清单
    const flat = flattenRoutes(result.routes);
    for (const r of flat.slice(0, 20)) {
      logger.info(`   ${r.module ? `[${r.module}]` : ''} ${r.path} ${r.name ? `(${r.name})` : ''}`);
    }
    if (flat.length > 20) {
      logger.info(`   ... 共 ${flat.length} 条路由`);
    }

    // 生成规格文件
    if (options.generateSpec) {
      const baseUrl = options.baseUrl || options.url || 'http://localhost:8080';
      const spec = generateSpecFromRoutes(result.routes, {
        baseUrl,
        platform: result.framework,
        name: `${basename(projectRoot)} UI 验证`,
      });
      const outputPath = options.spec || join(projectRoot, 'tests', 'VERIFY_SPEC.yaml');
      await writeVerifySpec(spec, outputPath);
      logger.info(`📄 规格文件已生成: ${outputPath}`);
    }

    // 直接执行测试（如果带 --ui）
    if (options.ui || options.smokeOnly || options.visualOnly) {
      const baseUrl = options.baseUrl || options.url || 'http://localhost:8080';
      const spec = generateSpecFromRoutes(result.routes, {
        baseUrl,
        platform: result.framework,
      });
      await runDiscoveredSpec(spec, options);
    }

    return;
  }

  // ── 页面目录扫描 ──
  if (options.discoverPages) {
    logger.info('🔍 扫描页面目录结构...');
    const result = await scanPages(projectRoot);

    if (!result || result.pages.length === 0) {
      logger.warn('⚠️  未检测到页面目录');
      logger.info('💡 期望路径：src/views/、src/pages/、src/screens/');
      return;
    }

    logger.info(`✅ 在 ${result.rootDir} 发现 ${result.pages.length} 个页面`);
    logger.info(`   模块: ${result.modules.join(', ')}`);

    for (const p of result.pages.slice(0, 20)) {
      logger.info(`   [${p.module}] ${p.name} → ${p.routePath}`);
    }
    if (result.pages.length > 20) {
      logger.info(`   ... 共 ${result.pages.length} 个页面`);
    }

    // 生成规格文件
    if (options.generateSpec) {
      const baseUrl = options.baseUrl || options.url || 'http://localhost:8080';
      const spec = generateSpecFromPages(result.pages, {
        baseUrl,
        platform: 'web',
        name: `${basename(projectRoot)} UI 验证`,
      });
      const outputPath = options.spec || join(projectRoot, 'tests', 'VERIFY_SPEC.yaml');
      await writeVerifySpec(spec, outputPath);
      logger.info(`📄 规格文件已生成: ${outputPath}`);
    }

    // 直接执行测试（如果带 --ui）
    if (options.ui || options.smokeOnly || options.visualOnly) {
      const baseUrl = options.baseUrl || options.url || 'http://localhost:8080';
      const spec = generateSpecFromPages(result.pages, {
        baseUrl,
        platform: 'web',
      });
      await runDiscoveredSpec(spec, options);
    }

    return;
  }

  // ── 仅生成规格文件 ──
  if (options.generateSpec) {
    // 优先尝试路由发现，回退到页面扫描
    const routeResult = await scanRoutes(projectRoot);
    if (routeResult.routes.length > 0) {
      const baseUrl = options.baseUrl || options.url || 'http://localhost:8080';
      const spec = generateSpecFromRoutes(routeResult.routes, {
        baseUrl,
        platform: routeResult.framework,
        name: `${basename(projectRoot)} UI 验证`,
      });
      const outputPath = options.spec || join(projectRoot, 'tests', 'VERIFY_SPEC.yaml');
      await writeVerifySpec(spec, outputPath);
      logger.info(`📄 规格文件已生成: ${outputPath}`);
      logger.info(`   基于: ${routeResult.framework} Router（${routeResult.routes.length} 条路由）`);
    } else {
      const pageResult = await scanPages(projectRoot);
      if (pageResult && pageResult.pages.length > 0) {
        const baseUrl = options.baseUrl || options.url || 'http://localhost:8080';
        const spec = generateSpecFromPages(pageResult.pages, {
          baseUrl,
          platform: 'web',
          name: `${basename(projectRoot)} UI 验证`,
        });
        const outputPath = options.spec || join(projectRoot, 'tests', 'VERIFY_SPEC.yaml');
        await writeVerifySpec(spec, outputPath);
        logger.info(`📄 规格文件已生成: ${outputPath}`);
        logger.info(`   基于: 页面目录扫描（${pageResult.pages.length} 个页面）`);
      } else {
        logger.warn('⚠️  未发现可生成规格的路由或页面');
      }
    }
  }
}

// 执行发现的规格（支持模块过滤）
async function runDiscoveredSpec(spec: VerifySpec, options: VerifyOptions): Promise<void> {
  // 应用模块/页面过滤
  const filterOptions = parseFilterArgs(options.module, options.page, options.scenario);
  const filteredSpec = filterSpec(spec, filterOptions);
  logFilterSummary(spec, filteredSpec);

  if (filteredSpec.scenarios.length === 0) {
    logger.warn('⚠️  过滤后没有可测试的场景');
    return;
  }

  const outputDir = options.output || join(findProjectRoot() || process.cwd(), 'reports');
  const screenshotDir = join(outputDir, 'screenshots');
  const baselineDir = join(outputDir, 'baselines');
  const diffDir = join(outputDir, 'diffs');

  await ensureDir(screenshotDir);
  await ensureDir(baselineDir);
  await ensureDir(diffDir);

  const uiOptions: UIVerifyOptions = {
    smokeTest: !options.visualOnly,
    visualCheck: !options.smokeOnly,
    devices: options.device ? [options.device] : ['desktop'],
    browsers: options.browser ? [options.browser] : ['chromium'],
    updateBaseline: options.updateBaseline || false,
    threshold: 'normal',
    timeout: options.timeout || 30000,
    visualModel: options.visualModel ? parseVisualModelCli(options.visualModel) : undefined,
    headed: options.headed ?? false,
  };

  logger.info('🔥 执行冒烟测试...');
  const smokeResults = options.visualOnly
    ? []
    : await runSmokeTest(filteredSpec, {
        screenshotDir,
        browser: uiOptions.browsers?.[0] as 'chromium' | 'firefox' | 'webkit',
        device: uiOptions.devices?.[0],
        timeout: uiOptions.timeout,
        executablePath: process.env.SPECCORE_BROWSER_PATH,
        headless: !options.headed,
      });

  let visualResults: import('../core/ui-verify').VisualResult[] = [];
  if (uiOptions.visualCheck) {
    logger.info('👁️ 执行视觉检查...');
    visualResults = await runVisualCheck(smokeResults, {
      baselineDir,
      screenshotDir,
      diffDir,
      threshold: uiOptions.threshold || 'normal',
      updateBaseline: uiOptions.updateBaseline || false,
      visualModel: uiOptions.visualModel,
    });
  }

  const duration = Date.now();
  const allResults = [...smokeResults, ...visualResults];
  const passed = allResults.filter((r) => r.passed).length;
  const failed = allResults.filter((r) => !r.passed).length;

  const report: UIVerifyReport = {
    taskId: 'discovered',
    timestamp: new Date().toISOString(),
    platform: filteredSpec.platform,
    url: filteredSpec.url,
    smokeEnabled: uiOptions.smokeTest,
    visualEnabled: uiOptions.visualCheck,
    smokeResults,
    visualResults,
    summary: {
      total: allResults.length,
      passed,
      failed,
      duration,
    },
  };

  const htmlPath = await generateHtmlReport(report, outputDir);
  logger.info(`📄 UI 验证报告: ${htmlPath}`);

  logUIReport(report);
}

// ── 交互式提示辅助函数 ──
function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${question} `, answer => { rl.close(); resolve(answer.trim()); });
  });
}

// ── 分层测试阶段默认参数映射 ──
function applyStageDefaults(options: VerifyOptions): void {
  const stage = options.stage;
  if (!stage) return;

  switch (stage) {
    case 'dev':
      // 开发阶段：编译 + Lint + 单元测试
      if (!options.type) options.type = 'all';
      logger.info(`🧪 [stage=dev] 开发阶段测试：编译 + Lint + 单元测试`);
      break;

    case 'pr':
      // PR 阶段：代码质量 + 关键页面冒烟 + API 契约
      if (!options.type) options.type = 'all';
      if (!options.ui) options.ui = true;
      if (!options.smokeOnly && !options.visualOnly) options.smokeOnly = true;
      if (!options.apiContract) options.apiContract = true;
      logger.info(`🧪 [stage=pr] PR 阶段测试：代码质量 + 关键 UI 冒烟 + API 契约`);
      break;

    case 'deploy':
      // 部署阶段：仅冒烟测试
      if (!options.ui) options.ui = true;
      if (!options.smokeOnly && !options.visualOnly) options.smokeOnly = true;
      logger.info(`🧪 [stage=deploy] 部署阶段测试：UI 冒烟测试`);
      break;

    case 'release':
      // 发布阶段：全量回归
      if (!options.ui) options.ui = true;
      if (!options.smokeOnly && !options.visualOnly) {
        // 默认执行冒烟 + 视觉（不强制 smoke-only）
      }
      if (!options.apiContract) options.apiContract = true;
      if (!options.perf) options.perf = true;
      logger.info(`🧪 [stage=release] 发布阶段测试：全量 UI + API + 性能回归`);
      break;

    default:
      logger.warn(`⚠️ 未知测试阶段: ${stage}，忽略 stage 参数`);
  }
}

// ── 从任务目录路径推断端名 ──
function inferPlatformFromTaskDir(taskDir: string): string | undefined {
  // 路径结构: .../Task-NNN-xxx/{platform}/Task-NNN-xxx-{platform}
  // 端名通常在倒数第二层目录
  const parts = taskDir.split('/');
  if (parts.length >= 2) {
    const parentDir = parts[parts.length - 2];
    // 排除常见非端目录名
    if (parentDir && !['030-tasks', 'feature', 'bugfix', 'refactor', 'research'].includes(parentDir)) {
      return parentDir;
    }
  }
  return undefined;
}

// v8.3.105+: 从路径中匹配已知平台名
function inferPlatformName(path: string, platformSet: Set<string>): string | undefined {
  for (const name of platformSet) {
    if (path.includes(name)) return name;
  }
  return undefined;
}

// v8.3.105+: 从 codePath 匹配 PROJECT.yaml 中的平台配置
function inferPlatformNameFromCodePath(
  codePath: string,
  platforms: import('../core/unified-config').PlatformConfig[]
): string | undefined {
  for (const p of platforms) {
    if (p.code_path && codePath.includes(p.code_path.replace(/^\.\//, ''))) {
      return p.name;
    }
  }
  return undefined;
}
