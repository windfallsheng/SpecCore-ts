/**
 * pipeline-test — Pipeline 专用测试引擎
 *
 * 在 build 之后、deploy 之前执行，测试失败可阻断部署。
 *
 * 支持三种测试层级：
 *   1. build-check: 构建产物检查（默认，轻量级）
 *   2. smoke:      HTTP 可达性检查（需要 base_url）
 *   3. visual:     视觉回归测试（需要 Playwright + 视觉模型）
 *   4. api:        API 契约测试
 *   5. all:        依次执行 build-check + smoke + visual + api
 *
 * v8.3.60+
 */

import { pathExists } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import type { EnvironmentConfig } from './environment-config';
import type { PlatformConfig, DeployEnvConfig } from './unified-config';
import type { VerifySpec, SmokeResult, VisualResult } from './ui-verify';
import { runSmokeTest, runVisualCheck } from './ui-verify';
import type { ApiContractSpec, ApiVerifyReport } from './api-verify';
import { runApiContractTest } from './api-verify';

export interface PipelineTestOptions {
  /** 测试平台 */
  platform: PlatformConfig;
  /** 环境名 */
  env: string;
  /** 测试类型 */
  type: 'build-check' | 'smoke' | 'visual' | 'api' | 'all';
  /** 环境配置（用于读取 tests.base_urls / local_urls 等） */
  envConfig?: EnvironmentConfig;
  /** 是否预览模式 */
  dryRun?: boolean;
  /** 构建输出目录（用于 build-check） */
  outputDir?: string;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 测试阶段（v8.3.98+）：pre-deploy 用 local_urls，post-deploy 用 base_urls */
  stage?: 'pre-deploy' | 'post-deploy';
}

export interface PipelineTestResult {
  /** 平台名 */
  platform: string;
  /** 是否全部通过 */
  passed: boolean;
  /** 失败严重程度: critical(严重，必须阻断) / warning(警告，可继续部署) */
  severity: 'critical' | 'warning';
  /** 执行的测试类型列表 */
  types: string[];
  /** 耗时（毫秒） */
  duration: number;
  /** 各测试详情 */
  details: {
    buildCheck?: BuildCheckResult;
    smoke?: SmokeResult[];
    visual?: VisualResult[];
    api?: ApiVerifyReport;
  };
  /** 汇总 */
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  /** 错误信息（整体失败时） */
  error?: string;
}

interface BuildCheckResult {
  passed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    message?: string;
  }>;
}

/**
 * 执行 Pipeline 测试
 *
 * 按配置的类型依次执行测试，任一失败即返回失败结果。
 */
export async function runPipelineTest(
  options: PipelineTestOptions
): Promise<PipelineTestResult> {
  const { platform, env, type, envConfig, dryRun } = options;
  const startTime = Date.now();

  const result: PipelineTestResult = {
    platform: platform.name,
    passed: true,
    severity: 'warning',
    types: [],
    duration: 0,
    details: {},
    summary: { total: 0, passed: 0, failed: 0 },
  };

  const typesToRun = resolveTestTypes(type);
  // v8.3.98+: 根据 stage 选择 baseUrl
  //   pre-deploy → 必须用 local_urls（代码未部署，base_urls 指向的服务器不可用）
  //   post-deploy → 用 base_urls（代码已部署到服务器）
  const isPreDeploy = options.stage === 'pre-deploy';
  const baseUrl = isPreDeploy
    ? envConfig?.tests?.local_urls?.[platform.name]
    : envConfig?.tests?.base_urls?.[platform.name];

  for (const testType of typesToRun) {
    if (dryRun) {
      logger.info(`   [DRY-RUN] 将执行 ${testType} 测试`);
      result.types.push(testType);
      continue;
    }

    logger.info(`   🔍 ${testType} 测试...`);

    switch (testType) {
      case 'build-check': {
        const bc = await runBuildCheck(platform, options.outputDir, options.env);
        result.details.buildCheck = bc;
        accumulate(result, bc.passed ? 0 : 1, 1);
        if (!bc.passed) {
          result.error = `构建产物检查失败: ${bc.checks.filter((c) => !c.passed).map((c) => c.message).join('; ')}`;
          result.severity = 'critical';
        }
        break;
      }

      case 'smoke': {
        if (!baseUrl) {
          const urlKey = isPreDeploy ? 'local_urls' : 'base_urls';
          logger.warn(`   ⚠️ 未配置 ${platform.name} 的 ${urlKey}，跳过 smoke 测试`);
          logger.info(`   💡 在环境配置中添加: tests.${urlKey}.${platform.name}: ${isPreDeploy ? 'http://localhost:3000' : 'https://...'}`);
          continue;
        }
        const smoke = await runHttpSmokeTest(baseUrl, platform.name, options.timeout);
        result.details.smoke = smoke;
        const failed = smoke.filter((s) => !s.passed).length;
        accumulate(result, failed, smoke.length);
        if (failed > 0) {
          result.error = `HTTP 冒烟测试失败: ${smoke.filter((s) => !s.passed).map((s) => s.scenarioName).join(', ')}`;
          // 判断严重程度: 连接失败/5xx = critical, 404 = warning
          const hasCritical = smoke.some((s) => !s.passed && s.steps.some((step) => {
            const err = step.error || '';
            return err.includes('ECONNREFUSED') || err.includes('ETIMEDOUT') || err.includes('fetch failed') || err.startsWith('HTTP 5');
          }));
          if (hasCritical) {
            result.severity = 'critical';
          }
        }
        break;
      }

      case 'visual': {
        if (!baseUrl) {
          const urlKey = isPreDeploy ? 'local_urls' : 'base_urls';
          logger.warn(`   ⚠️ 未配置 ${platform.name} 的 ${urlKey}，跳过 visual 测试`);
          continue;
        }
        const visual = await runPipelineVisualTest(
          baseUrl,
          platform.name,
          env,
          envConfig?.tests?.visual_model,
          options.timeout
        );
        result.details.visual = visual;
        const failed = visual.filter((v) => !v.passed).length;
        accumulate(result, failed, visual.length);
        if (failed > 0) {
          result.error = `视觉测试失败: ${visual.filter((v) => !v.passed).map((v) => v.scenarioName).join(', ')}`;
          // 视觉差异默认 warning（服务可用，只是外观差异）
          if (result.severity !== 'critical') {
            result.severity = 'warning';
          }
        }
        break;
      }

      case 'api': {
        if (!baseUrl) {
          const urlKey = isPreDeploy ? 'local_urls' : 'base_urls';
          logger.warn(`   ⚠️ 未配置 ${platform.name} 的 ${urlKey}，跳过 api 测试`);
          continue;
        }
        const api = await runPipelineApiTest(baseUrl, platform.name);
        result.details.api = api;
        accumulate(result, api.summary.failed, api.summary.total);
        if (api.summary.failed > 0) {
          result.error = `API 测试失败: ${api.summary.failed}/${api.summary.total} 未通过`;
          // API 失败默认 warning（服务可用，只是契约差异）
          if (result.severity !== 'critical') {
            result.severity = 'warning';
          }
        }
        break;
      }
    }

    result.types.push(testType);

    // 任一测试失败即停止（除非 type === 'all' 且想收集全部结果）
    // 默认行为：失败即停止，不继续后续测试类型
    if (!result.passed) {
      break;
    }
  }

  result.duration = Date.now() - startTime;
  return result;
}

/** 解析测试类型列表 */
function resolveTestTypes(type: string): string[] {
  switch (type) {
    case 'all':
      return ['build-check', 'smoke', 'visual', 'api'];
    case 'smoke':
      return ['build-check', 'smoke'];
    case 'visual':
      return ['build-check', 'smoke', 'visual'];
    case 'api':
      return ['build-check', 'api'];
    case 'build-check':
    default:
      return ['build-check'];
  }
}

/** 累加测试结果 */
function accumulate(result: PipelineTestResult, failed: number, total: number): void {
  result.summary.total += total;
  result.summary.failed += failed;
  result.summary.passed += total - failed;
  result.passed = result.summary.failed === 0;
}

// ─────────────────────────────────────────
// Build Check — 构建产物检查
// ─────────────────────────────────────────

async function runBuildCheck(
  platform: PlatformConfig,
  outputDir?: string,
  env?: string
): Promise<BuildCheckResult> {
  const checks: BuildCheckResult['checks'] = [];

  // 推断输出目录
  const inferredDir = outputDir || inferOutputDir(platform, env);

  // 检查 1: 输出目录是否存在
  const dirExists = await pathExists(inferredDir);
  checks.push({
    name: '输出目录存在',
    passed: dirExists,
    message: dirExists ? undefined : `目录不存在: ${inferredDir}`,
  });

  if (!dirExists) {
    return { passed: false, checks };
  }

  // 检查 2: 关键文件是否存在（按平台类型推断）
  const keyFiles = inferKeyFiles(platform, inferredDir);
  for (const file of keyFiles) {
    const exists = await pathExists(file);
    checks.push({
      name: `关键文件: ${file}`,
      passed: exists,
      message: exists ? undefined : `文件不存在: ${file}`,
    });
  }

  const allPassed = checks.every((c) => c.passed);
  return { passed: allPassed, checks };
}

/** 推断构建输出目录 */
function inferOutputDir(platform: PlatformConfig, env?: string): string {
  // 从 deploy 配置中读取 output_dir（按环境）
  if (env && platform.deploy?.[env]) {
    const envDeploy = platform.deploy[env] as DeployEnvConfig;
    if (envDeploy.output_dir) {
      return envDeploy.output_dir;
    }
  }
  // 回退到 staging / production
  if (platform.deploy?.staging?.output_dir) {
    return platform.deploy.staging.output_dir;
  }
  if (platform.deploy?.production?.output_dir) {
    return platform.deploy.production.output_dir;
  }
  // 默认
  return 'dist';
}

/** 推断关键文件 */
function inferKeyFiles(platform: PlatformConfig, dir: string): string[] {
  switch (platform.type) {
    case 'frontend':
      return [join(dir, 'index.html')];
    case 'backend':
      // Java: jar 文件
      return [join(dir, `${platform.name}.jar`), join(dir, 'app.jar')];
    case 'infra':
      return [join(dir, 'index.html')];
    default:
      return [join(dir, 'index.html')];
  }
}

// ─────────────────────────────────────────
// HTTP Smoke Test — 轻量级可达性检查
// ─────────────────────────────────────────

async function runHttpSmokeTest(
  baseUrl: string,
  platformName: string,
  timeout = 10000
): Promise<SmokeResult[]> {
  const results: SmokeResult[] = [];

  const urls = [
    { name: `${platformName}-首页`, path: '/' },
    { name: `${platformName}-健康检查`, path: '/health' },
  ];

  for (const { name, path } of urls) {
    const url = baseUrl.endsWith('/') ? baseUrl + path.slice(1) : baseUrl + path;
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);

      const duration = Date.now() - start;
      const passed = response.ok;

      results.push({
        scenarioName: name,
        passed,
        duration,
        steps: [
          {
            action: { type: 'navigate', value: url },
            passed,
            duration,
            error: passed ? undefined : `HTTP ${response.status} ${response.statusText}`,
          },
        ],
      });
    } catch (e: any) {
      results.push({
        scenarioName: name,
        passed: false,
        duration: Date.now() - start,
        steps: [
          {
            action: { type: 'navigate', value: url },
            passed: false,
            duration: Date.now() - start,
            error: e.message || String(e),
          },
        ],
      });
    }
  }

  return results;
}

// ─────────────────────────────────────────
// Visual Test — 视觉回归测试（Pipeline 版）
// ─────────────────────────────────────────

async function runPipelineVisualTest(
  baseUrl: string,
  platformName: string,
  env: string,
  visualModel?: NonNullable<EnvironmentConfig['tests']>['visual_model'],
  timeout = 30000
): Promise<VisualResult[]> {
  const spec: VerifySpec = {
    name: `${platformName}-pipeline-visual`,
    platform: platformName,
    url: baseUrl,
    scenarios: [
      {
        name: `${platformName}-首页截图`,
        actions: [
          { type: 'navigate', value: baseUrl },
          { type: 'screenshot' },
        ],
        assertions: [{ type: 'visible' }],
      },
    ],
  };

  const screenshotDir = join(process.cwd(), 'reports', 'pipeline', env, platformName, 'screenshots');
  const baselineDir = join(process.cwd(), 'reports', 'pipeline', env, platformName, 'baselines');
  const diffDir = join(process.cwd(), 'reports', 'pipeline', env, platformName, 'diffs');

  try {
    const smokeResults = await runSmokeTest(spec, {
      screenshotDir,
      headless: true,
      browser: 'chromium',
      timeout,
    });

    const visualResults = await runVisualCheck(smokeResults, {
      baselineDir,
      screenshotDir,
      diffDir,
      threshold: 'normal',
      updateBaseline: false,
      visualModel: visualModel as any,
    });

    return visualResults;
  } catch (e: any) {
    logger.error(`   ❌ 视觉测试执行失败: ${e.message}`);
    return [
      {
        scenarioName: `${platformName}-视觉测试`,
        passed: false,
        currentPath: '',
        analysis: `执行失败: ${e.message}`,
        issues: [{ severity: 'error', description: e.message }],
      },
    ];
  }
}

// ─────────────────────────────────────────
// API Test — API 契约测试（Pipeline 版）
// ─────────────────────────────────────────

async function runPipelineApiTest(
  baseUrl: string,
  platformName: string
): Promise<ApiVerifyReport> {
  // 尝试查找 API_CONTRACT.yaml
  const contractPath = join(process.cwd(), 'API_CONTRACT.yaml');
  const hasContract = await pathExists(contractPath);

  if (!hasContract) {
    // 无契约文件时，执行基础健康检查
    return {
      specName: `${platformName}-pipeline-api`,
      baseUrl,
      timestamp: new Date().toISOString(),
      results: [],
      summary: { total: 0, passed: 0, failed: 0, duration: 0 },
    };
  }

  try {
    const { parseYamlFile } = await import('./yaml-parser');
    const parseResult = await parseYamlFile(contractPath);

    if (!parseResult.success || !parseResult.data) {
      return {
        specName: `${platformName}-pipeline-api`,
        baseUrl,
        timestamp: new Date().toISOString(),
        results: [],
        summary: { total: 0, passed: 0, failed: 0, duration: 0 },
      };
    }

    const spec = parseResult.data as ApiContractSpec;
    spec.baseUrl = baseUrl;

    return await runApiContractTest(spec);
  } catch (e: any) {
    logger.error(`   ❌ API 测试执行失败: ${e.message}`);
    return {
      specName: `${platformName}-pipeline-api`,
      baseUrl,
      timestamp: new Date().toISOString(),
      results: [],
      summary: { total: 0, passed: 0, failed: 0, duration: 0 },
    };
  }
}

/**
 * 生成 Pipeline 测试报告（供 Skill / AI 读取）
 *
 * 输出格式便于 AI 解析失败原因。
 */
export function formatPipelineTestReport(result: PipelineTestResult): string {
  const lines: string[] = [];
  lines.push(`## Pipeline 测试报告: ${result.platform}`);
  lines.push('');
  lines.push(`- 状态: ${result.passed ? '✅ 通过' : '❌ 失败'}`);
  lines.push(`- 测试类型: ${result.types.join(', ')}`);
  lines.push(`- 耗时: ${result.duration}ms`);
  lines.push(`- 汇总: ${result.summary.passed}/${result.summary.total} 通过, ${result.summary.failed} 失败`);
  lines.push('');

  if (result.details.buildCheck) {
    lines.push('### 构建产物检查');
    for (const c of result.details.buildCheck.checks) {
      lines.push(`- ${c.passed ? '✅' : '❌'} ${c.name}${c.message ? ` — ${c.message}` : ''}`);
    }
    lines.push('');
  }

  if (result.details.smoke) {
    lines.push('### HTTP 冒烟测试');
    for (const s of result.details.smoke) {
      lines.push(`- ${s.passed ? '✅' : '❌'} ${s.scenarioName} (${s.duration}ms)`);
      for (const step of s.steps) {
        if (!step.passed && step.error) {
          lines.push(`  - ❌ ${step.error}`);
        }
      }
    }
    lines.push('');
  }

  if (result.details.visual) {
    lines.push('### 视觉回归测试');
    for (const v of result.details.visual) {
      lines.push(`- ${v.passed ? '✅' : '❌'} ${v.scenarioName}`);
      if (v.issues.length > 0) {
        for (const issue of v.issues) {
          lines.push(`  - ${issue.severity === 'error' ? '❌' : '⚠️'} ${issue.description}`);
        }
      }
    }
    lines.push('');
  }

  if (result.details.api) {
    lines.push('### API 契约测试');
    lines.push(`- 总计: ${result.details.api.summary.total} 端点`);
    lines.push(`- 通过: ${result.details.api.summary.passed}`);
    lines.push(`- 失败: ${result.details.api.summary.failed}`);
    for (const r of result.details.api.results) {
      lines.push(`- ${r.passed ? '✅' : '❌'} ${r.method} ${r.path}`);
      for (const ar of r.assertionResults) {
        if (!ar.passed) {
          lines.push(`  - ❌ ${ar.assertion}: ${ar.message || '断言失败'}`);
        }
      }
    }
    lines.push('');
  }

  if (result.error) {
    lines.push(`### 错误总结`);
    lines.push(result.error);
    lines.push('');
  }

  return lines.join('\n');
}
