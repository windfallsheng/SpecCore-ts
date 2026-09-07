/**
 * Visual Engine — 视觉模型分析引擎
 *
 * 对比基准图与当前截图，调用视觉模型分析差异
 */

import { join, basename } from 'path';
import { pathExists, readFile, ensureDir, copy } from 'fs-extra';
import { logger } from '../../utils/logger';
import { VisualResult, VisualIssue, SmokeResult } from './types';
import { callVisualModel, isVisualModelAvailable, type VisualModelConfig } from './visual-model-client';

interface VisualOptions {
  baselineDir: string;
  screenshotDir: string;
  diffDir: string;
  threshold: 'strict' | 'normal' | 'loose';
  updateBaseline: boolean;
  visualModel?: string | import('./visual-model-client').VisualModelConfig;
}

export async function runVisualCheck(
  smokeResults: SmokeResult[],
  options: VisualOptions
): Promise<VisualResult[]> {
  const results: VisualResult[] = [];

  await ensureDir(options.baselineDir);
  await ensureDir(options.diffDir);

  for (const smoke of smokeResults) {
    if (!smoke.screenshot) {
      logger.warn(`  ⚠️ ${smoke.scenarioName} 无截图，跳过视觉检查`);
      continue;
    }

    const scenarioSafeName = smoke.scenarioName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const baselinePath = join(options.baselineDir, `${scenarioSafeName}.png`);
    const currentPath = smoke.screenshot;
    const diffPath = join(options.diffDir, `${scenarioSafeName}_diff.png`);

    logger.info(`  🖼️ 视觉检查: ${smoke.scenarioName}`);

    // 检查是否存在基准图
    const hasBaseline = await pathExists(baselinePath);

    if (!hasBaseline) {
      // 首次运行：保存为基准图 + 单图通用质量扫描
      await copy(currentPath, baselinePath);
      logger.info(`    ✅ 已保存基准图`);

      // 单图通用质量扫描（无基准图时也能发现问题）
      const scanResult = await analyzeSingleImage({
        imagePath: currentPath,
        scenarioName: smoke.scenarioName,
        threshold: options.threshold,
        model: options.visualModel,
      });

      results.push({
        scenarioName: smoke.scenarioName,
        passed: scanResult.passed,
        baselinePath,
        currentPath,
        analysis: `首次运行，已保存基准图。${scanResult.analysis}`,
        issues: scanResult.issues,
      });

      const icon = scanResult.passed ? '✅' : '⚠️';
      logger.info(
        `    ${icon} 单图质量扫描: ${scanResult.passed ? '通过' : '发现问题'} (${scanResult.issues.length} 项)`
      );
      continue;
    }

    if (options.updateBaseline) {
      // 强制更新基准图
      await copy(currentPath, baselinePath);
      results.push({
        scenarioName: smoke.scenarioName,
        passed: true,
        baselinePath,
        currentPath,
        analysis: '基准图已更新',
        issues: [],
      });
      logger.info(`    ✅ 基准图已更新`);
      continue;
    }

    // 调用视觉模型分析差异
    const visualResult = await analyzeWithVisualModel({
      baselinePath,
      currentPath,
      diffPath,
      scenarioName: smoke.scenarioName,
      threshold: options.threshold,
      model: options.visualModel,
    });

    results.push(visualResult);

    const icon = visualResult.passed ? '✅' : '⚠️';
    logger.info(
      `    ${icon} ${visualResult.passed ? '通过' : '发现问题'} (${visualResult.issues.length} 项)`
    );
  }

  return results;
}

// ─────────────────────────────────────────
// 双图对比分析
// ─────────────────────────────────────────

interface AnalyzeOptions {
  baselinePath: string;
  currentPath: string;
  diffPath: string;
  scenarioName: string;
  threshold: 'strict' | 'normal' | 'loose';
  model?: string | import('./visual-model-client').VisualModelConfig;
}

async function analyzeWithVisualModel(options: AnalyzeOptions): Promise<VisualResult> {
  try {
    const currentBase64 = await imageToBase64(options.currentPath);
    const baselineBase64 = await imageToBase64(options.baselinePath);

    const config = parseVisualModelConfig(options.model);
    const result = await callVisualModel(config, {
      scenarioName: options.scenarioName,
      currentImageBase64: currentBase64,
      baselineImageBase64: baselineBase64,
      threshold: options.threshold,
    });

    return {
      scenarioName: options.scenarioName,
      passed: result.passed,
      baselinePath: options.baselinePath,
      currentPath: options.currentPath,
      diffPath: options.diffPath,
      analysis: result.analysis,
      issues: result.issues,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`    ❌ 视觉模型调用失败: ${message}`);

    return {
      scenarioName: options.scenarioName,
      passed: options.threshold !== 'strict',
      baselinePath: options.baselinePath,
      currentPath: options.currentPath,
      analysis: `视觉模型调用失败: ${message}`,
      issues: [{
        severity: 'warning',
        description: `视觉模型调用失败: ${message}`,
      }],
    };
  }
}

// ─────────────────────────────────────────
// 单图通用质量扫描（无基准图时）
// ─────────────────────────────────────────

interface SingleImageOptions {
  imagePath: string;
  scenarioName: string;
  threshold: 'strict' | 'normal' | 'loose';
  model?: string | import('./visual-model-client').VisualModelConfig;
}

interface SingleImageResult {
  passed: boolean;
  analysis: string;
  issues: import('./types').VisualIssue[];
}

async function analyzeSingleImage(options: SingleImageOptions): Promise<SingleImageResult> {
  try {
    const imageBase64 = await imageToBase64(options.imagePath);

    const config = parseVisualModelConfig(options.model);
    const result = await callVisualModel(config, {
      scenarioName: options.scenarioName,
      currentImageBase64: imageBase64,
      threshold: options.threshold,
    });

    return {
      passed: result.passed,
      analysis: result.analysis,
      issues: result.issues,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      passed: options.threshold !== 'strict',
      analysis: `单图扫描失败: ${message}`,
      issues: [{
        severity: 'warning',
        description: `单图扫描失败: ${message}`,
      }],
    };
  }
}

// ─────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────

async function imageToBase64(path: string): Promise<string> {
  const buffer = await readFile(path);
  return buffer.toString('base64');
}

function parseVisualModelConfig(
  model?: string | import('./visual-model-client').VisualModelConfig
): VisualModelConfig {
  // 如果是配置对象，直接返回
  if (model && typeof model === 'object' && 'provider' in model) {
    return model as VisualModelConfig;
  }

  const modelStr = (model as string) || '';

  if (!modelStr || modelStr === 'qwen-vl') {
    return { provider: 'qwen-vl', model: 'qwen-vl-max' };
  }
  if (modelStr === 'openai' || modelStr === 'gpt-4o') {
    return { provider: 'openai', model: 'gpt-4o' };
  }
  if (modelStr === 'anthropic' || modelStr === 'claude') {
    return { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' };
  }
  if (modelStr === 'local') {
    return { provider: 'local' };
  }
  // 默认使用 qwen-vl
  return { provider: 'qwen-vl', model: 'qwen-vl-max' };
}

// 重新导出，兼容旧代码
export { isVisualModelAvailable };
