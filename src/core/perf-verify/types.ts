/**
 * 性能基线测试 — 类型定义
 *
 * PERF_SPEC.yaml 结构：
 *   name: 前端构建性能基线
 *   metrics:
 *     - name: 构建时间
 *       type: command
 *       command: npm run build
 *       workingDir: ./frontend
 *       threshold:
 *         max: 60000
 *     - name: 产物体积
 *       type: size
 *       path: ./frontend/dist
 *       threshold:
 *         max: 5242880
 *     - name: 主包体积
 *       type: size
 *       path: ./frontend/dist/index.js
 *       threshold:
 *         max: 1048576
 */

export interface PerfSpec {
  name: string;
  metrics: PerfMetric[];
}

export type MetricType = 'command' | 'size' | 'bundle';

export interface PerfMetric {
  name: string;
  type: MetricType;
  // command 类型
  command?: string;
  workingDir?: string;
  // size 类型
  path?: string;
  // bundle 类型（预留）
  entry?: string;
  // 阈值配置
  threshold: {
    min?: number;
    max?: number;
    regression?: number; // 相对基线的退化百分比（如 10 表示允许比基线慢 10%）
  };
}

// ── 测试结果 ──

export interface PerfMetricResult {
  name: string;
  type: MetricType;
  passed: boolean;
  value: number; // 实际值（毫秒或字节）
  unit: string;
  baseline?: number; // 基线值
  regression?: number; // 退化百分比
  threshold: { min?: number; max?: number; regression?: number };
  message?: string;
}

export interface PerfVerifyReport {
  specName: string;
  timestamp: string;
  results: PerfMetricResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    duration: number;
  };
}

// ── 执行选项 ──

export interface PerfVerifyOptions {
  updateBaseline?: boolean;
  verbose?: boolean;
}
