/**
 * verify — 代码验证命令
 *
 * 执行后验证代码质量：编译检查 + Lint + 单元测试
 * 支持项目级和任务级验证
 *
 * 验证阶段模型（--stage，与 pipeline 部署时机对齐）：
 *   - dev     开发阶段：编译 + Lint + 单元测试（代码/规范/案例，无关浏览器）
 *   - pr      PR 阶段：代码质量 + 关键 UI 冒烟 + API 契约（≈ pipeline pre-deploy，可阻断）
 *   - deploy  部署阶段：UI 冒烟测试（≈ pipeline post-deploy，只报告）
 *   - release 发布阶段：全量 UI + API + 性能回归（部署后，只报告）
 * 即：部署前验证（dev/pr，代码/规范/契约）可阻断；部署后验证（deploy/release，冒烟/回归）只报告。
 *
 * 用法:
 *   speccore verify                          # 验证当前迭代所有任务
 *   speccore verify -t Task-001              # 验证单个任务
 *   speccore verify -t Task-001 --type=lint  # 只跑 lint
 *   speccore verify --path=./backend         # 指定代码路径
 *   speccore verify --stage=pr               # PR 阶段（部署前）验证
 */

import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, getIterationDir } from '../core/context';
import { pathExists, readFile, writeFile, ensureDir, readdir } from 'fs-extra';
import { join, basename, isAbsolute, dirname } from 'path';
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
import { loadTestConfig, mergeTestConfigWithEnv, describeAuthResolution } from '../core/test-config';
import type { TestConfig, TestCase } from '../core/test-config';
import { collectTaskReports, generateQualityReport } from '../core/verify-report-aggregator';
import { findProjectRoot } from '../utils/task-utils';
// v8.3.293+: 复用 core 任务路径定位（支持 030-tasks/{type}/Task-* 新布局与子任务层级）
import { findTaskDir as coreFindTaskDir, getTasksRoot } from '../core/task-paths';

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
  /** v8.3.352+: API 测试缺契约时报错阻断（默认跳过仅告警，防「契约缺失=验证通过」假象） */
  requireContract?: boolean;
  // v8.3.350+: AI 浏览器验证模式
  ai?: boolean;
  scope?: string;
  platform?: string;
  env?: string;
  aiReport?: string;
  aiJudge?: string;
}

export async function verifyCommand(options: VerifyOptions): Promise<void> {
  // v8.3.101+: 向上查找项目根目录（支持在子目录执行）
  const projectRoot = findProjectRoot() || process.cwd();

  // v8.3.353+: CLI 参数归一化（commander 默认值是字符串，不转数字会让 Playwright 报 expected float）
  if (typeof options.timeout === 'string') options.timeout = Number(options.timeout);

  // v8.3.351+: 测试双线开关（一次读取，AI 验证/冒烟线/剧本分层共用；CLI 显式参数优先于开关）
  const unifiedConfig = await loadConfig();
  const testsCfg = unifiedConfig.settings?.tests;
  const smokeOff = testsCfg?.smoke?.enabled === false;

  // v8.3.350+ AI 模式：生成验证剧本 / 回写 HTML 报告 / 视觉判定兜底（不进入代码验证流程）
  if (options.ai) {
    await runAiVerifyMode(options, testsCfg);
    return;
  }
  if (options.aiReport) {
    await runAiReportMode(options.aiReport);
    return;
  }
  if (options.aiJudge) {
    await runAiJudgeMode(options.aiJudge, options);
    return;
  }

  // 冒烟线已关闭但用户显式要求执行 → 显式参数优先，仅提示配置状态
  if (smokeOff && (options.ui || options.smokeOnly || options.visualOnly || options.config || options.stage)) {
    logger.warn('⚠️ 冒烟线已在 settings.tests.smoke.enabled 关闭，本次按显式参数执行');
  }

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
    // v8.3.351+: 复用函数开头读取的配置（含 tests 双线开关）
    const config = unifiedConfig;
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
        // v8.3.351+: 冒烟线开关——配置关闭且非命令行显式时跳过自动触发的 UI 验证
        const cliExplicitUi = Boolean(options.ui || options.smokeOnly || options.visualOnly);
        if (smokeOff && !cliExplicitUi) {
          logger.info('⏭️ 冒烟线已在 settings.tests.smoke.enabled 关闭，跳过自动 UI 验证（可用 --ui 显式执行）');
        } else {
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
 * v8.3.293+: 修复此前只查 030-tasks/{taskId} 根级直铺与 {iterDir}/{taskId} 旧布局、
 * 导致 taskify 产物（030-tasks/{type}/Task-xxx/{端}/{子任务}/）无法定位的断链。
 */
async function findTaskDir(taskId: string, iterDir: string): Promise<string | null> {
  const candidates = [
    join(iterDir, '030-tasks', taskId),
    join(iterDir, taskId),
  ];
  for (const c of candidates) {
    if (await pathExists(c)) return c;
  }
  // 新布局：030-tasks/{type}/Task-xxx/ 与子任务层级（复用 core task-paths 的递归查找）
  return coreFindTaskDir(getTasksRoot('', iterDir), taskId);
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
    // v8.3.353+: 失败必须非零退出（CI 无法感知失败即假通过）
    process.exitCode = 1;
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

    // v8.3.293+: 无源码可扫描（首次建设/需求阶段）时，从任务 Spec 文档生成流程骨架——
    // UI_SPEC「元素标识约定」清单 → 业务流程步骤 → 场景 selector 自动装配，
    // 弥合「分析阶段元素约定」与「冒烟配置生成阶段」之间的断链。
    if (!specPath) {
      try {
        const specTexts: string[] = [];
        // 1. 子任务 TEST.md（含测试场景/业务流程）
        const testMd = join(taskDir, 'TEST.md');
        if (await pathExists(testMd)) specTexts.push(await readFile(testMd, 'utf-8'));
        // 2. 任务级 00-specs 文档
        const specsDir = join(taskDir, '00-specs');
        if (await pathExists(specsDir)) {
          const { readdir: rd } = await import('fs-extra');
          for (const f of await rd(specsDir)) {
            if (f.endsWith('.md')) specTexts.push(await readFile(join(specsDir, f), 'utf-8'));
          }
        }
        // 3. 020-specs UI_SPEC（按 .meta/feature 与端名定位，匹配不上则跳过）
        try {
          const featureName = (await readFile(join(taskDir, '.meta', 'feature'), 'utf-8')).trim();
          const platformName = inferPlatformFromTaskDir(taskDir) || '';
          const specsRoot = join(iterDir, '020-specs');
          if (featureName && featureName !== '未分类' && platformName && await pathExists(specsRoot)) {
            const { readdir: rd } = await import('fs-extra');
            for (const d of await rd(specsRoot)) {
              if (!d.includes(featureName) && !featureName.includes(d)) continue;
              const uiSpec = join(specsRoot, d, platformName, 'UI_SPEC.md');
              if (await pathExists(uiSpec)) { specTexts.push(await readFile(uiSpec, 'utf-8')); break; }
            }
          }
        } catch { /* 定位失败时只用任务文档 */ }

        const combined = specTexts.join('\n\n');
        if (combined.trim().length > 0) {
          const { generateSpecFromUiSpec } = await import('../core/ui-verify');
          const baseUrl = options.baseUrl || options.url || 'http://localhost:3000';
          const platformName = inferPlatformFromTaskDir(taskDir) || 'web';
          const specGen = generateSpecFromUiSpec(combined, {
            baseUrl,
            platform: platformName,
            name: `${taskId} UI 验证（Spec 流程骨架）`,
          });
          if (specGen.scenarios.length > 0) {
            generatedSpec = specGen;
            generatedPath = join(taskDir, 'VERIFY_SPEC.yaml');

            if (process.stdin.isTTY) {
              logger.info('');
              const answer = await promptUser('未发现源码路由，是否根据任务 Spec 文档生成流程场景骨架？[Y/n]');
              if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
                logger.info('⏭️  跳过自动生成，UI 验证取消');
                return null;
              }
            } else {
              logger.info('💡 非交互环境，根据任务 Spec 文档生成流程场景骨架');
            }

            await writeVerifySpec(generatedSpec, generatedPath);
            logger.info(`📄 VERIFY_SPEC.yaml 已按 Spec 文档生成: ${generatedPath}`);
            specPath = generatedPath;
          }
        }
      } catch {
        // Spec 提取失败，静默回退到原有提示
      }
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
    // v8.3.353+: 失败必须非零退出（CI 无法感知失败即假通过）
    process.exitCode = 1;
  }
  // v8.3.352+: 跳过项显式展示——降级跳过不再无声蒸发
  if (summary.skipped && summary.skipped > 0) {
    logger.warn(`   ⏭️  ${summary.skipped} 项检查被跳过（未覆盖，详情见跳过清单）`);
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

/** 从需求/Spec 文档提取「测试账号」章节里的账号名（v8.3.216+） */
async function extractTestAccountHint(projectRoot: string): Promise<string | undefined> {
  try {
    const { glob } = await import('glob');
    const patterns = [
      // Spec 优先（测试账号约定/元素标识是实现约定的权威来源，analyze 产出）
      join(projectRoot, 'Iteration-*', '020-specs', '**', '*.md'),
      join(projectRoot, 'Iteration-*', '010-requirements', '**', '*.md'),
      join(projectRoot, '.speccore', '**', '*.md'),
    ];
    const files: string[] = [];
    for (const p of patterns) {
      files.push(...(await glob(p, { ignore: ['**/node_modules/**'] })));
    }
    for (const f of files.slice(0, 80)) {
      const content = await readFile(f, 'utf-8');
      const idx = content.indexOf('测试账号');
      if (idx === -1) continue;
      const section = content.slice(idx, idx + 400);
      // 优先 email 格式
      const email = section.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (email) return email[0];
      // 兜底 admin 开头
      const admin = section.match(/\b(admin[a-zA-Z0-9_]*)\b/i);
      if (admin) return admin[1];
    }
  } catch {}
  return undefined;
}

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

  // v8.3.352+: 跳过项显式统计——契约缺失/账号未就绪/URL 无法确定等降级不再无声蒸发，
  // 汇总报告单独列出，配合 --require-contract 可将契约缺失升级为失败。
  let skippedCount = 0;
  const skipReasons: string[] = [];
  let contractFailure = false;

  // v8.3.216+: 冒烟前自动装配登录账号（开发完成、即将冒烟的时间点，内存装配 + 透明告知）
  if (mergedConfig.auth) {
    const hint = await extractTestAccountHint(findProjectRoot() || process.cwd());
    const resolution = describeAuthResolution(mergedConfig.auth, hint);
    // 写回内存装配结果（不落盘，密码不进 git），让后续 runSmokeTest 能拿到提取的账号
    if (resolution.username) mergedConfig.auth.credentials.username = resolution.username;
    if (resolution.password) mergedConfig.auth.credentials.password = resolution.password;

    logger.info(`\n🔐 冒烟登录账号装配：`);
    logger.info(`   - 账号: ${resolution.username || '（未确定）'}（来源：${resolution.usernameSource}）`);
    logger.info(`   - 密码: ${resolution.password ? '已就绪（' + resolution.password.length + ' 位）' : '（未确定）'}（来源：${resolution.passwordSource}）`);
    // v8.3.354+: 验证码装配状态透明展示（就绪/降级原因）；未就绪计入 skipped，不假通过
    if (resolution.verificationNote) {
      logger.info(`   - 验证码: ${resolution.verificationNote}`);
    }
    if (resolution.warnings.length > 0) {
      for (const w of resolution.warnings) {
        logger.warn(`   ⚠️ ${w}`);
      }
      logger.warn(`   💡 冒烟时若账号未就绪，登录将自动降级跳过（不影响页面可达性检查）`);
    }
    // 账号未就绪 → 登录场景降级跳过：计入 skipped，报告里可见「哪些场景因账号缺失没测」
    if (!resolution.username || !resolution.password) {
      skippedCount += 1;
      skipReasons.push(`登录场景降级跳过（账号未就绪：${!resolution.username ? '用户名缺失' : ''}${!resolution.username && !resolution.password ? '、' : ''}${!resolution.password ? '密码缺失' : ''}）`);
    } else if (resolution.verificationReady === false) {
      // 账号密码就绪但验证码未就绪：登录可能卡在验证码环节，同样计入 skipped 显式声明
      skippedCount += 1;
      skipReasons.push('登录二次验证降级跳过（验证码码源未就绪：code_env 未设置或 fixed_code/code_selector 缺失）');
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
      skippedCount += 1;
      skipReasons.push(`[${testCase.name}] 无法确定目标 URL`);
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
        auth: mergedConfig.auth,
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
            if (apiReport.summary.failed > 0) {
              contractFailure = true;
            }
          }
        } else {
          // v8.3.352+: 解析失败不再静默——计入 skipped；--require-contract 时升级为失败
          skippedCount += 1;
          skipReasons.push(`[${testCase.name}] API 规格解析失败: ${parseResult.error}`);
          if (options.requireContract) contractFailure = true;
          logger.warn(`   ⚠️ API 规格解析失败，已计入跳过项: ${parseResult.error}`);
        }
      } else {
        // v8.3.352+: 契约缺失显式计入 skipped（不再只 warn 后当无事发生）；
        // --require-contract 时将「契约缺失」升级为验证失败，杜绝假通过。
        skippedCount += 1;
        skipReasons.push(`[${testCase.name}] 未找到 API_CONTRACT.yaml`);
        if (options.requireContract) {
          contractFailure = true;
          logger.error(`   ❌ 未找到 API_CONTRACT.yaml（--require-contract 已开启，契约缺失按失败处理）`);
        } else {
          logger.warn(`   ⚠️ 未找到 API_CONTRACT.yaml，跳过 API 测试（已计入跳过项；--require-contract 可升级为失败）`);
        }
      }
    }
  }

  // 汇总并输出报告
  if (allReports.length > 0 || skippedCount > 0) {
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
        skipped: skippedCount,
      },
    };

    logUIReport(combinedReport);

    // v8.3.352+: 跳过项清单单独列出——降级跳过的场景不再无声蒸发
    if (skippedCount > 0) {
      logger.warn('');
      logger.warn(`⏭️  本次共跳过 ${skippedCount} 项检查（非失败，但未覆盖）：`);
      for (const reason of skipReasons) {
        logger.warn(`   - ${reason}`);
      }
    }

    // v8.3.352+: 契约缺失/解析失败升级为失败时，验证非零退出
    if (contractFailure) {
      logger.error('❌ API 契约缺失/解析失败（--require-contract），验证不通过');
      process.exitCode = 1;
    }

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

/** 将 TestCase 转换为 VerifySpec（v8.3.353+: 优先透传精细场景 verify_scenarios，否则 routes 可达性三件套） */
function buildVerifySpecFromTestCase(testCase: TestCase, baseUrl: string): VerifySpec {
  // 精细场景优先：完整执行 22 种动作 + 9 种断言，不再降级为纯可达性
  if (testCase.verify_scenarios && testCase.verify_scenarios.length > 0) {
    const scenarios = testCase.verify_scenarios.map((sc) => ({
      ...sc,
      // navigate 相对路径归一化：非 http(s):// 开头的 URL 拼上 baseUrl
      actions: sc.actions.map((a) =>
        a.type === 'navigate' && typeof a.value === 'string' && !/^https?:\/\//i.test(a.value)
          ? { ...a, value: baseUrl.replace(/\/$/, '') + a.value }
          : a
      ),
    }));
    return {
      name: testCase.name,
      platform: 'test-config',
      url: baseUrl,
      scenarios,
    };
  }

  const routes = testCase.routes || ['/'];
  const scenarios = routes.map((route) => ({
    name: `navigate-${route}`,
    actions: [
      // 完整 URL 不再重复拼接（修复 VERIFY_SPEC 转换后双重前缀隐患）
      { type: 'navigate' as const, value: /^https?:\/\//i.test(route) ? route : baseUrl + route },
      { type: 'screenshot' as const },
    ],
    // v8.3.353+: 断言 body 可见（无 selector 的 visible 断言必抛错，属历史 bug）
    assertions: [{ type: 'visible' as const, selector: 'body' }],
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
    // 排除常见非端目录名（v8.3.308: + presentation；用户自定义类型目录名在
    // 下方 inferPlatformName 的 platformSet 匹配中会被自然过滤）
    if (parentDir && !['030-tasks', 'feature', 'bugfix', 'refactor', 'research', 'doc', 'script', 'data', 'presentation'].includes(parentDir)) {
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

// ══════════════════════════════════════════════════════════════════════
// v8.3.350+ AI 浏览器验证模式（--ai 生成剧本 / --ai-report 回写报告）
//
// 分工原则：CLI 只切片不解析语义——从 020-specs 的 UI_SPEC.md/TEST.md
// 按标题抓取原文段落组装剧本，语义理解与页面操作交给宿主 AI。
// ══════════════════════════════════════════════════════════════════════

/** 列出项目下已配置的环境名（排除 .example） */
async function listEnvironmentNames(projectRoot: string): Promise<string[]> {
  const envDir = join(projectRoot, '.speccore', 'environments');
  let entries: string[];
  try {
    entries = await readdir(envDir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f) => f.replace(/\.(yaml|yml)$/, ''))
    .filter((n) => n && !n.includes('.example'));
}

/** 环境选择：--env 显式 > 交互选择（TTY）> 默认 staging */
async function promptForEnv(projectRoot: string, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const names = await listEnvironmentNames(projectRoot);
  if (names.length === 0) {
    logger.warn('⚠️ 未找到任何环境配置（.speccore/environments/*.yaml），默认使用环境 "staging"');
    return 'staging';
  }
  if (!process.stdin.isTTY) {
    const fallback = names.includes('staging') ? 'staging' : names[0];
    logger.info(`ℹ️ 非交互环境，默认使用环境 "${fallback}"（可用 --env 指定）`);
    return fallback;
  }
  logger.info('可用环境:');
  names.forEach((n, i) => logger.info(`  [${i + 1}] ${n}`));
  const answer = await promptUser(`请选择环境（1-${names.length}，回车默认 staging）:`);
  const idx = parseInt(answer, 10);
  if (!Number.isNaN(idx) && idx >= 1 && idx <= names.length) return names[idx - 1];
  if (names.includes(answer)) return answer;
  return names.includes('staging') ? 'staging' : names[0];
}

/** --ai：生成验证剧本 + 输出宿主 AI 接管标记 */
async function runAiVerifyMode(options: VerifyOptions, testsCfg?: { smoke?: { enabled?: boolean }; ai_verify?: { enabled?: boolean }; layered?: { common?: boolean; modules?: boolean } }): Promise<void> {
  const { resolveScopeUnits, parsePlatformFilter } = await import('../core/ai-verify/scope-resolver');
  const { generateAiVerifyPlan } = await import('../core/ai-verify/plan-generator');
  const { loadEnvironmentByNameOrPath } = await import('../core/environment-config');

  // v8.3.351+: AI 验证线开关——显式 --ai 优先，关闭时仅提示
  if (testsCfg?.ai_verify?.enabled === false) {
    logger.warn('⚠️ AI 验证线已在 settings.tests.ai_verify.enabled 关闭，本次按显式参数执行');
  }

  const projectRoot = findProjectRoot() || process.cwd();
  const iteration = await getDefaultIteration(options.iteration);
  const iterDir = await getIterationDir(iteration);
  const env = await promptForEnv(projectRoot, options.env);
  const platformFilter = parsePlatformFilter(options.platform);

  // 环境配置（environments/{env}.yaml，提供 tests.base_urls）
  const envConfig = await loadEnvironmentByNameOrPath(env);
  if (!envConfig) {
    logger.error(`❌ 无法加载环境配置 "${env}"（.speccore/environments/${env}.yaml）`);
    process.exitCode = 1;
    return;
  }

  // 范围解析：all / deployed / modules:xxx
  const resolved = await resolveScopeUnits({
    iterDir,
    scope: options.scope || 'all',
    platformFilter: options.platform,
    projectRoot,
  }).catch((err: Error) => {
    logger.error(`❌ ${err.message}`);
    return null;
  });
  if (!resolved) {
    process.exitCode = 1;
    return;
  }
  for (const w of resolved.warnings) logger.warn(`⚠️ ${w}`);
  // v8.3.351+: 无功能单元时——公共能力层开启则仅生成公共层，否则才视为无剧本可生成
  const layeredCfg = testsCfg?.layered;
  const commonOn = layeredCfg?.common !== false;
  if (resolved.units.length === 0 && !commonOn) {
    logger.warn('⚠️ 范围内没有可验证的功能单元（020-specs 为空或过滤后无匹配），且公共能力层已关闭');
    process.exitCode = 1;
    return;
  }
  if (resolved.units.length === 0) {
    logger.warn('⚠️ 范围内没有功能单元（020-specs 为空或过滤后无匹配），仅生成公共能力层场景');
  }

  // 账号配置（v8.3.351+ 账号收敛）：环境内嵌 tests.accounts 为权威源；
  // 环境文件已声明账号时不生成 accounts.yaml 占位模板（兑底源非必需，避免噪音）。
  // 环境文件无账号且 accounts.yaml 不存在时才从模板生成示例并提醒填写（已存在不覆盖）。
  const accountsPath = join(projectRoot, '.speccore', 'tests', 'accounts.yaml');
  if (!envConfig.tests?.accounts && !(await pathExists(accountsPath))) {
    const tplPath = join(__dirname, '..', '..', 'templates', 'accounts-example.yaml');
    if (await pathExists(tplPath)) {
      await ensureDir(dirname(accountsPath));
      await writeFile(accountsPath, await readFile(tplPath, 'utf-8'), 'utf-8');
      logger.warn('⚠️ 已生成账号模板 .speccore/tests/accounts.yaml（占位密码 change-me），请填写真实账号后再执行验证；或直接在 environments/{env}.yaml 的 tests.accounts 声明环境内嵌账号');
    }
  }

  // 剧本生成（layered 分层开关透传，缺省全开）
  const output = await generateAiVerifyPlan({
    iteration,
    iterDir,
    env,
    envConfig,
    units: resolved.units,
    platformFilter,
    projectRoot,
    accountsPath,
    layered: layeredCfg,
  });

  // 按层统计（公共能力层 → 模块层）
  const groupStats = output.plan.groups
    .map((g) => `${g.label}${g.enabled ? ` ${g.scenarios.length} 场景` : '（⏭️ 已关闭）'}`)
    .join(' | ');
  logger.success(`✅ AI 验证剧本已生成：${output.plan.scenarios.length} 个场景（${groupStats}）`);
  logger.info(`   剧本: ${output.planMdPath}`);
  if (output.plan.skipped.length > 0) {
    logger.warn(`⚠️ ${output.plan.skipped.length} 个单元被跳过（缺地址/空模板等），详见剧本「跳过项」`);
  }
  // 账号密码/用户名使用 ${VAR} 引用但环境变量未设置 → 提醒（不阻断，执行 AI 可按提示从环境读取）
  for (const h of output.plan.accountEnvVars || []) {
    if (!h.set) {
      logger.warn(`⚠️ 账号 ${h.ref} 的 ${h.field} 引用环境变量 ${h.varName}，但当前未设置`);
    }
  }
  logger.info('');
  logger.info('🤖 执行协议（宿主 AI）:');
  logger.info(`   1. 读剧本 ${output.planJsonPath}（accountSources 指明账号来源）取账号明文`);
  logger.info('   2. 按层推进：先公共能力层（入口可达性/登录态/全局导航），全部通过后进模块层；enabled=false 的层跳过');
  logger.info('   3. 层内按端分批，用 Browser 子代理逐场景视觉执行，结果写 ' + join(output.plan.outDir, 'results.json'));
  logger.info('   4. 执行 speccore verify --ai-report ' + join(output.plan.outDir, 'results.json') + ' 生成 HTML 报告');
  logger.info('');

  // 机器可读标记（spec-verify skill 据此接管执行）；账号标记按实际来源输出（v8.3.351+ 账号收敛：
  // 权威源环境文件 tests.accounts 优先，accounts.yaml 兑底；均无时回退指向兑底路径）
  console.log(`[SPECCORE_AI_VERIFY: ${output.planJsonPath}]`);
  for (const src of output.plan.accountSources || []) {
    console.log(`[SPECCORE_AI_VERIFY_ACCOUNTS: ${src}]`);
  }
  if (!output.plan.accountSources || output.plan.accountSources.length === 0) {
    console.log(`[SPECCORE_AI_VERIFY_ACCOUNTS: ${accountsPath}]`);
  }
}

/** --ai-report：读 results.json + 同目录 plan.json → 生成 HTML 报告 */
async function runAiReportMode(resultsPath: string): Promise<void> {
  const { parseAiVerifyResults, buildReportContext, generateAiVerifyReport, summarizeResults } =
    await import('../core/ai-verify/result-parser');

  const results = await parseAiVerifyResults(resultsPath);
  if (!results) {
    logger.error(`❌ 无法解析结果文件: ${resultsPath}（需为含 results 数组的 JSON）`);
    process.exitCode = 1;
    return;
  }

  // plan.json 与 results.json 同目录（均为剧本输出目录）
  const planPath = join(dirname(resultsPath), 'plan.json');
  if (!(await pathExists(planPath))) {
    logger.error(`❌ 未找到剧本 plan.json（${planPath}），无法对齐场景`);
    process.exitCode = 1;
    return;
  }
  let plan: import('../core/ai-verify/types').AiVerifyPlan;
  try {
    plan = JSON.parse(await readFile(planPath, 'utf-8'));
  } catch {
    logger.error(`❌ 剧本 plan.json 解析失败（${planPath}）`);
    process.exitCode = 1;
    return;
  }
  // 以 results.json 实际位置为准落盘报告（支持相对路径调用）
  plan.outDir = dirname(resultsPath);

  const ctx = buildReportContext(plan, results);
  const reportPath = await generateAiVerifyReport(ctx);
  const summary = summarizeResults(ctx);

  logger.info('');
  logger.info(`📊 AI 验证结果摘要（${plan.env} · ${plan.iteration}）:`);
  logger.info(
    `   总场景 ${summary.total} | ✅ 通过 ${summary.passed} | ❌ 失败 ${summary.failed} | ⏭️ 跳过 ${summary.skipped} | ⬜ 未执行 ${summary.notRun}`
  );
  if (summary.notRun > 0) {
    logger.warn(`⚠️ ${summary.notRun} 个场景未执行（结果中缺失），报告已标注`);
  }
  if (summary.failed > 0) {
    logger.error(`❌ ${summary.failed} 个场景失败，详情见报告: ${reportPath}`);
    process.exitCode = 1;
  } else {
    logger.success(`✅ 全部场景通过（或跳过），报告: ${reportPath}`);
  }
}

/** --ai-judge：视觉判定兜底——对 judged:false 的截图用视觉模型判定，回写后生成报告 */
async function runAiJudgeMode(resultsPath: string, options: VerifyOptions): Promise<void> {
  const { parseAiVerifyResults, buildReportContext, generateAiVerifyReport, summarizeResults } =
    await import('../core/ai-verify/result-parser');
  const { runAiJudge } = await import('../core/ai-verify/visual-judge');

  const results = await parseAiVerifyResults(resultsPath);
  if (!results) {
    logger.error(`❌ 无法解析结果文件: ${resultsPath}（需为含 results 数组的 JSON）`);
    process.exitCode = 1;
    return;
  }

  // plan.json 与 results.json 同目录
  const planPath = join(dirname(resultsPath), 'plan.json');
  if (!(await pathExists(planPath))) {
    logger.error(`❌ 未找到剧本 plan.json（${planPath}），无法获取场景预期结果`);
    process.exitCode = 1;
    return;
  }
  let plan: import('../core/ai-verify/types').AiVerifyPlan;
  try {
    plan = JSON.parse(await readFile(planPath, 'utf-8'));
  } catch {
    logger.error(`❌ 剧本 plan.json 解析失败（${planPath}）`);
    process.exitCode = 1;
    return;
  }

  // 视觉模型配置：CLI --visual-model 优先，其次 .speccore.yml quality_gates.verify_ui.visual_model
  let visualModel: import('../core/quality-gate').VisualModelConfig | undefined;
  if (options.visualModel) {
    const parsed = parseVisualModelCli(options.visualModel);
    // 字符串形式为 provider 名（如 qwen-vl），包装为配置对象
    visualModel = typeof parsed === 'string'
      ? { provider: parsed as import('../core/quality-gate').VisualModelConfig['provider'] }
      : parsed;
  } else {
    const cfg = await loadConfig().catch(() => null);
    visualModel = cfg?.quality_gates?.verify_ui?.visual_model;
  }

  try {
    const judgedCount = await runAiJudge(resultsPath, plan, visualModel);
    if (judgedCount > 0) logger.success(`✅ 视觉判定兜底完成：${judgedCount} 个场景已判定并回写`);
  } catch (error: any) {
    logger.error(`❌ 视觉判定兜底失败: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  // 判定后重新生成报告
  const freshResults = await parseAiVerifyResults(resultsPath);
  if (!freshResults) {
    process.exitCode = 1;
    return;
  }
  plan.outDir = dirname(resultsPath);
  const ctx = buildReportContext(plan, freshResults);
  const reportPath = await generateAiVerifyReport(ctx);
  const summary = summarizeResults(ctx);
  logger.info(`📊 报告: ${reportPath}（总 ${summary.total} | 通过 ${summary.passed} | 失败 ${summary.failed} | 跳过 ${summary.skipped} | 未执行 ${summary.notRun}）`);
  if (summary.failed > 0) process.exitCode = 1;
}
