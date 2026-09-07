/**
 * 性能基线测试 — 执行引擎
 *
 * 收集性能指标并与基线对比
 */

import { execSync } from 'child_process';
import { statSync } from 'fs';
import { pathExists, readFile, writeFile } from 'fs-extra';
import { join } from 'path';
import { logger } from '../../utils/logger';
import type {
  PerfSpec,
  PerfMetric,
  PerfMetricResult,
  PerfVerifyReport,
  PerfVerifyOptions,
} from './types';

// ─────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────

export async function runPerfTest(
  spec: PerfSpec,
  baselineDir: string,
  options: PerfVerifyOptions = {}
): Promise<PerfVerifyReport> {
  const results: PerfMetricResult[] = [];
  const startTime = Date.now();

  logger.info(`⏱️  性能基线测试: ${spec.name}`);
  logger.info(`   指标数量: ${spec.metrics.length}`);
  logger.info('');

  // 加载基线
  const baselinePath = join(baselineDir, '.perf-baseline.json');
  const baseline = await loadBaseline(baselinePath);

  for (const metric of spec.metrics) {
    const result = await measureMetric(metric, baseline?.[metric.name]);
    results.push(result);

    const icon = result.passed ? '✅' : '❌';
    const baselineInfo = result.baseline
      ? ` (基线: ${formatValue(result.baseline, result.unit)}` +
        `${result.regression !== undefined ? `, 退化: ${result.regression.toFixed(1)}%` : ''})`
      : '';
    logger.info(
      `   ${icon} ${metric.name}: ${formatValue(result.value, result.unit)}${baselineInfo}`
    );
    if (!result.passed && result.message) {
      logger.info(`      ⚠️ ${result.message}`);
    }
  }

  const duration = Date.now() - startTime;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  logger.info('');
  logger.info(`   总计: ${results.length} 指标 | ✅ ${passed} 通过 | ❌ ${failed} 失败 | ⏱️ ${duration}ms`);

  // 保存/更新基线
  if (options.updateBaseline || !baseline) {
    const newBaseline: Record<string, number> = {};
    for (const r of results) {
      newBaseline[r.name] = r.value;
    }
    await saveBaseline(baselinePath, newBaseline);
    logger.info(`   💾 已${baseline ? '更新' : '创建'}基线: ${baselinePath}`);
  }

  return {
    specName: spec.name,
    timestamp: new Date().toISOString(),
    results,
    summary: { total: results.length, passed, failed, duration },
  };
}

// ─────────────────────────────────────────
// 指标测量
// ─────────────────────────────────────────

async function measureMetric(
  metric: PerfMetric,
  baselineValue?: number
): Promise<PerfMetricResult> {
  switch (metric.type) {
    case 'command':
      return measureCommand(metric, baselineValue);
    case 'size':
      return measureSize(metric, baselineValue);
    case 'bundle':
      return { ...await measureSize(metric, baselineValue), type: 'bundle' };
    default:
      return {
        name: metric.name,
        type: metric.type,
        passed: false,
        value: 0,
        unit: 'unknown',
        threshold: metric.threshold,
        message: `未知指标类型: ${metric.type}`,
      };
  }
}

// ── 命令执行时间 ──

function measureCommand(metric: PerfMetric, baselineValue?: number): PerfMetricResult {
  if (!metric.command) {
    return createFailResult(metric, '未指定 command');
  }

  const start = Date.now();
  try {
    execSync(metric.command, {
      cwd: metric.workingDir || process.cwd(),
      stdio: 'pipe',
      timeout: 300000, // 5 分钟上限
    });
  } catch (e: any) {
    return createFailResult(metric, `命令执行失败: ${e.message}`);
  }
  const value = Date.now() - start;

  return evaluateThreshold(metric, value, baselineValue, 'ms');
}

// ── 文件/目录大小 ──

async function measureSize(metric: PerfMetric, baselineValue?: number): Promise<PerfMetricResult> {
  if (!metric.path) {
    return createFailResult(metric, '未指定 path');
  }

  const fullPath = metric.path.startsWith('/')
    ? metric.path
    : join(process.cwd(), metric.path);

  if (!(await pathExists(fullPath))) {
    return createFailResult(metric, `路径不存在: ${fullPath}`);
  }

  const value = getSize(fullPath);
  return evaluateThreshold(metric, value, baselineValue, 'B');
}

function getSize(p: string): number {
  try {
    const s = statSync(p);
    if (s.isFile()) return s.size;
    if (s.isDirectory()) {
      // 递归计算目录大小
      let total = 0;
      const { readdirSync } = require('fs');
      const entries = readdirSync(p, { withFileTypes: true });
      for (const entry of entries) {
        const child = join(p, entry.name);
        if (entry.isFile()) {
          total += statSync(child).size;
        } else if (entry.isDirectory()) {
          total += getSize(child);
        }
      }
      return total;
    }
    return 0;
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────
// 阈值评估
// ─────────────────────────────────────────

function evaluateThreshold(
  metric: PerfMetric,
  value: number,
  baselineValue?: number,
  unit = ''
): PerfMetricResult {
  const { threshold } = metric;
  let passed = true;
  const messages: string[] = [];

  if (threshold.min !== undefined && value < threshold.min) {
    passed = false;
    messages.push(`低于最小阈值: ${formatValue(value, unit)} < ${formatValue(threshold.min, unit)}`);
  }
  if (threshold.max !== undefined && value > threshold.max) {
    passed = false;
    messages.push(`超过最大阈值: ${formatValue(value, unit)} > ${formatValue(threshold.max, unit)}`);
  }

  let regression: number | undefined;
  if (baselineValue !== undefined && baselineValue > 0) {
    regression = ((value - baselineValue) / baselineValue) * 100;
    if (threshold.regression !== undefined && regression > threshold.regression) {
      passed = false;
      messages.push(
        `性能退化: ${regression.toFixed(1)}% > 允许退化 ${threshold.regression}%`
      );
    }
  }

  return {
    name: metric.name,
    type: metric.type,
    passed,
    value,
    unit,
    baseline: baselineValue,
    regression,
    threshold,
    message: messages.length > 0 ? messages.join('; ') : undefined,
  };
}

function createFailResult(metric: PerfMetric, message: string): PerfMetricResult {
  return {
    name: metric.name,
    type: metric.type,
    passed: false,
    value: 0,
    unit: '',
    threshold: metric.threshold,
    message,
  };
}

// ─────────────────────────────────────────
// 基线管理
// ─────────────────────────────────────────

async function loadBaseline(path: string): Promise<Record<string, number> | null> {
  if (!(await pathExists(path))) return null;
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return null;
  }
}

async function saveBaseline(path: string, data: Record<string, number>): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2));
}

// ─────────────────────────────────────────
// 格式化
// ─────────────────────────────────────────

function formatValue(value: number, unit: string): string {
  if (unit === 'ms') {
    if (value < 1000) return `${value}ms`;
    return `${(value / 1000).toFixed(1)}s`;
  }
  if (unit === 'B') {
    if (value < 1024) return `${value}B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`;
    return `${(value / (1024 * 1024)).toFixed(1)}MB`;
  }
  return `${value}${unit}`;
}
