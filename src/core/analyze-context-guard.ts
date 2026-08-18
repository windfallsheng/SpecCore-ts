/**
 * analyze-context-guard — 分析上下文爆炸防护引擎（v6.75.0）
 *
 * 核心能力：
 * 1. 预估分析上下文大小（基于文件数、端数、模块数、代码量）
 * 2. 智能分段策略推荐（一次性 / 按端 / 按模块 / 按功能单元）
 * 3. 交互式确认：提示用户当前预估大小，建议分段策略
 * 4. 自动降级：非交互模式下自动选择最优策略
 *
 * 预估模型：
 * - 基础 overhead：每个 prompt 模板约 2K tokens
 * - 每端 overhead：读取索引 + 分析指令约 3K tokens
 * - 每模块 overhead：需求文档 + 关联代码约 5K tokens
 * - 每功能单元 overhead：详细设计约 8K tokens
 * - 全局文档 overhead：FUNCTION_MAP + API_CONTRACT 约 4K tokens
 */

import { join } from 'path';
import { pathExists, readFile, stat, readdir } from 'fs-extra';
import { logger } from '../utils/logger';
import { parsePlatformList } from './spec-paths';

// ── 类型定义 ──

/** 上下文大小等级 */
export type ContextSizeLevel = 'small' | 'medium' | 'large' | 'xlarge';

/** 分段策略 */
export type SegmentationStrategy =
  | 'all-at-once'      // 一次性分析（小项目）
  | 'by-platform'      // 按端分段（中等项目）
  | 'by-module'        // 按功能模块分段（大型项目）
  | 'by-feature-unit'; // 按功能单元分段（超大型项目）

/** 上下文预估结果 */
export interface ContextEstimate {
  /** 预估 tokens 数（近似值） */
  estimatedTokens: number;
  /** 大小等级 */
  level: ContextSizeLevel;
  /** 推荐策略 */
  recommendedStrategy: SegmentationStrategy;
  /** 预估原因 */
  reasons: string[];
  /** 各维度详情 */
  details: {
    platformCount: number;
    moduleCount: number;
    featureUnitCount: number;
    totalFileSize: number;
    codeFileCount: number;
    docFileCount: number;
  };
}

/** 分段计划 */
export interface SegmentationPlan {
  strategy: SegmentationStrategy;
  segments: Segment[];
  totalEstimatedTokens: number;
  explanation: string;
}

/** 单个分段 */
export interface Segment {
  id: string;
  name: string;
  type: 'global' | 'platform' | 'module' | 'feature-unit';
  target: string;
  estimatedTokens: number;
  dependencies: string[];
  inputs: string[];
  outputs: string[];
}

// ── 常量配置 ──

/** Token 预估系数（中文约 1.5 tokens/字，英文约 0.75 tokens/字，取保守值 1.0） */
const TOKENS_PER_CHAR = 1.0;

/** 上下文大小阈值（tokens） */
const LEVEL_THRESHOLDS: Record<ContextSizeLevel, number> = {
  small: 8000,
  medium: 16000,
  large: 32000,
  xlarge: 64000,
};

/** 各等级推荐策略 */
const STRATEGY_BY_LEVEL: Record<ContextSizeLevel, SegmentationStrategy> = {
  small: 'all-at-once',
  medium: 'by-platform',
  large: 'by-module',
  xlarge: 'by-feature-unit',
};

/** 策略说明 */
const STRATEGY_DESCRIPTIONS: Record<SegmentationStrategy, string> = {
  'all-at-once': '一次性分析所有端，适合小型项目（< 8K tokens）',
  'by-platform': '按端逐个分析，每端独立生成 prompt，适合中型项目（8K-16K tokens）',
  'by-module': '按功能模块逐个分析，跨端关联在同一模块内处理，适合大型项目（16K-32K tokens）',
  'by-feature-unit': '按功能单元细粒度分析，每个单元一个独立任务，适合超大型项目（> 32K tokens）',
};

// ── 核心函数 ──

/**
 * 预估分析上下文大小
 * @param iterDir 迭代目录
 * @param options 分析选项
 */
export async function estimateContextSize(
  iterDir: string,
  options?: { withCode?: boolean; platform?: string; feature?: string }
): Promise<ContextEstimate> {
  const reasons: string[] = [];
  const details = {
    platformCount: 0,
    moduleCount: 0,
    featureUnitCount: 0,
    totalFileSize: 0,
    codeFileCount: 0,
    docFileCount: 0,
  };

  // 1. 统计端数量
  const platforms = await parsePlatformList();
  details.platformCount = platforms.length;
  if (platforms.length >= 4) {
    reasons.push(`端数量较多（${platforms.length} 个），上下文较大`);
  }

  // 2. 统计需求文档大小
  const reqDir = join(iterDir, '010-requirements');
  let docSize = 0;
  let docCount = 0;
  if (await pathExists(reqDir)) {
    const docFiles = await findAllFiles(reqDir, ['.md', '.txt']);
    for (const f of docFiles) {
      const s = await stat(f);
      docSize += s.size;
      docCount++;
    }
  }
  details.docFileCount = docCount;
  details.totalFileSize += docSize;

  if (docSize > 100000) {
    reasons.push(`需求文档较大（${(docSize / 1024).toFixed(0)} KB），建议分段`);
  }

  // 3. 统计功能模块数量
  const featuresDir = join(reqDir, 'features');
  let moduleCount = 0;
  if (await pathExists(featuresDir)) {
    const entries = await readdir(featuresDir, { withFileTypes: true });
    moduleCount = entries.filter(e => e.isDirectory()).length;
  }
  details.moduleCount = moduleCount;
  if (moduleCount >= 10) {
    reasons.push(`功能模块较多（${moduleCount} 个），建议按模块分段`);
  }

  // 4. 统计源码量（如果 --with-code）
  let codeSize = 0;
  let codeCount = 0;
  if (options?.withCode) {
    const constitutionPath = join(iterDir, '..', '.speccore', 'CONSTITUTION.md');
    if (await pathExists(constitutionPath)) {
      const constitutionContent = await readFile(constitutionPath, 'utf-8');
      // 提取源码路径
      const sourcePaths = extractSourcePaths(constitutionContent);
      for (const sp of sourcePaths) {
        const fullPath = join(iterDir, '..', sp);
        if (await pathExists(fullPath)) {
          const files = await findAllFiles(fullPath, ['.ts', '.tsx', '.js', '.jsx', '.java', '.go', '.py', '.vue']);
          for (const f of files) {
            const s = await stat(f);
            codeSize += s.size;
            codeCount++;
          }
        }
      }
    }
  }
  details.codeFileCount = codeCount;
  details.totalFileSize += codeSize;

  if (codeSize > 500000) {
    reasons.push(`源码量较大（${(codeSize / 1024).toFixed(0)} KB），建议按模块或功能单元分段`);
  }

  // 5. 预估功能单元数量（从 FUNCTION_MAP 或需求文档估算）
  const functionMapPath = join(iterDir, '..', '.speccore', 'GLOBAL', 'FUNCTION_MAP.md');
  let featureUnitCount = moduleCount * 2; // 默认估算
  if (await pathExists(functionMapPath)) {
    const fmContent = await readFile(functionMapPath, 'utf-8');
    // 简单统计表格行数
    const rows = fmContent.split('\n').filter(l => l.startsWith('|') && !l.includes('---'));
    if (rows.length > 1) {
      featureUnitCount = rows.length - 1; // 减去表头
    }
  }
  details.featureUnitCount = featureUnitCount;

  // 6. 计算预估 tokens
  // 基础 overhead
  let estimatedTokens = 2000;

  // 每端 overhead
  estimatedTokens += platforms.length * 3000;

  // 文档内容
  estimatedTokens += docSize * TOKENS_PER_CHAR;

  // 源码内容（如果 withCode，只算 20% 代码会被读取）
  if (options?.withCode) {
    estimatedTokens += codeSize * TOKENS_PER_CHAR * 0.2;
  }

  // 全局文档 overhead
  estimatedTokens += 4000;

  // 7. 确定大小等级
  let level: ContextSizeLevel = 'small';
  if (estimatedTokens > LEVEL_THRESHOLDS.xlarge) {
    level = 'xlarge';
  } else if (estimatedTokens > LEVEL_THRESHOLDS.large) {
    level = 'large';
  } else if (estimatedTokens > LEVEL_THRESHOLDS.medium) {
    level = 'medium';
  }

  const recommendedStrategy = STRATEGY_BY_LEVEL[level];

  return {
    estimatedTokens: Math.round(estimatedTokens),
    level,
    recommendedStrategy,
    reasons: reasons.length > 0 ? reasons : ['上下文大小适中，可以一次性分析'],
    details,
  };
}

/**
 * 生成分段计划
 */
export async function buildSegmentationPlan(
  estimate: ContextEstimate,
  iterDir: string,
  options?: { withCode?: boolean }
): Promise<SegmentationPlan> {
  const strategy = estimate.recommendedStrategy;
  const segments: Segment[] = [];

  switch (strategy) {
    case 'all-at-once': {
      segments.push({
        id: 'all',
        name: '全局一次性分析',
        type: 'global',
        target: 'all',
        estimatedTokens: estimate.estimatedTokens,
        dependencies: [],
        inputs: ['CONSTITUTION.md', '010-requirements/'],
        outputs: ['020-specs/global/', '020-specs/{端}/'],
      });
      break;
    }

    case 'by-platform': {
      const platforms = await parsePlatformList();
      // 先全局扫描
      segments.push({
        id: 'global-scan',
        name: '全局快速扫描',
        type: 'global',
        target: 'global',
        estimatedTokens: 4000,
        dependencies: [],
        inputs: ['CONSTITUTION.md', '010-requirements/INDEX.md'],
        outputs: ['.speccore/GLOBAL/platforms/_shared/_INDEX.md'],
      });

      // 后端端先分析
      const backendPlatforms = platforms.filter(async p => {
        const types = await import('./spec-paths').then(m => m.parsePlatformTypes());
        const t = types.get(p) || '';
        return t.includes('service') || t.includes('后端');
      });
      for (const p of backendPlatforms) {
        segments.push({
          id: `backend-${p}`,
          name: `后端端分析: ${p}`,
          type: 'platform',
          target: p,
          estimatedTokens: Math.round(estimate.estimatedTokens / platforms.length),
          dependencies: ['global-scan'],
          inputs: [`platforms/${p}/_INDEX.md`, 'global/ARCHITECTURE.md'],
          outputs: [`platforms/${p}/API_INVENTORY.md`, `platforms/${p}/DATA_MODEL.md`],
        });
      }

      // 前端端后分析
      const frontendPlatforms = platforms.filter(p => !backendPlatforms.includes(p));
      for (const p of frontendPlatforms) {
        segments.push({
          id: `frontend-${p}`,
          name: `前端端分析: ${p}`,
          type: 'platform',
          target: p,
          estimatedTokens: Math.round(estimate.estimatedTokens / platforms.length),
          dependencies: backendPlatforms.map(bp => `backend-${bp}`),
          inputs: [`platforms/${p}/_INDEX.md`, 'global/API_CONTRACT.yaml'],
          outputs: [`platforms/${p}/FEATURES.md`, `platforms/${p}/UI_SPEC.md`],
        });
      }
      break;
    }

    case 'by-module': {
      // 按功能模块分段，每个模块跨端分析
      const featuresDir = join(iterDir, '010-requirements', 'features');
      let modules: string[] = [];
      if (await pathExists(featuresDir)) {
        const entries = await readdir(featuresDir, { withFileTypes: true });
        modules = entries.filter(e => e.isDirectory()).map(e => e.name);
      }

      if (modules.length === 0) {
        // 回退到按端分段
        return buildSegmentationPlan(
          { ...estimate, recommendedStrategy: 'by-platform' },
          iterDir,
          options
        );
      }

      // 全局扫描
      segments.push({
        id: 'global-scan',
        name: '全局快速扫描',
        type: 'global',
        target: 'global',
        estimatedTokens: 4000,
        dependencies: [],
        inputs: ['CONSTITUTION.md'],
        outputs: ['.speccore/GLOBAL/platforms/_shared/_INDEX.md'],
      });

      for (const mod of modules) {
        segments.push({
          id: `module-${mod}`,
          name: `功能模块分析: ${mod}`,
          type: 'module',
          target: mod,
          estimatedTokens: Math.round(estimate.estimatedTokens / modules.length),
          dependencies: ['global-scan'],
          inputs: [`010-requirements/features/${mod}/README.md`, 'global/API_CONTRACT.yaml'],
          outputs: [`020-specs/features/${mod}.md`],
        });
      }
      break;
    }

    case 'by-feature-unit': {
      // 按功能单元分段，最细粒度
      // 先读取 FUNCTION_MAP 获取功能单元列表
      const functionMapPath = join(iterDir, '..', '.speccore', 'GLOBAL', 'FUNCTION_MAP.md');
      let units: string[] = [];
      if (await pathExists(functionMapPath)) {
        const content = await readFile(functionMapPath, 'utf-8');
        // 提取功能单元名称（表格第二列）
        const lines = content.split('\n');
        for (const line of lines) {
          const match = line.match(/^\|\s*\w+\s*\|\s*([^|]+)\s*\|/);
          if (match && !line.includes('功能单元')) {
            units.push(match[1].trim());
          }
        }
      }

      if (units.length === 0) {
        // 回退到按模块分段
        return buildSegmentationPlan(
          { ...estimate, recommendedStrategy: 'by-module' },
          iterDir,
          options
        );
      }

      // 全局扫描
      segments.push({
        id: 'global-scan',
        name: '全局快速扫描',
        type: 'global',
        target: 'global',
        estimatedTokens: 4000,
        dependencies: [],
        inputs: ['CONSTITUTION.md'],
        outputs: ['.speccore/GLOBAL/platforms/_shared/_INDEX.md'],
      });

      for (const unit of units.slice(0, 20)) { // 最多 20 个功能单元
        segments.push({
          id: `unit-${unit}`,
          name: `功能单元分析: ${unit}`,
          type: 'feature-unit',
          target: unit,
          estimatedTokens: Math.round(estimate.estimatedTokens / Math.min(units.length, 20)),
          dependencies: ['global-scan'],
          inputs: ['global/FUNCTION_MAP.md', 'global/API_CONTRACT.yaml'],
          outputs: [`020-specs/units/${unit}.md`],
        });
      }
      break;
    }
  }

  return {
    strategy,
    segments,
    totalEstimatedTokens: estimate.estimatedTokens,
    explanation: STRATEGY_DESCRIPTIONS[strategy],
  };
}

/**
 * 显示上下文预估报告并获取用户确认（交互模式）
 * @returns 用户选择的策略
 */
export async function promptSegmentationStrategy(
  estimate: ContextEstimate,
  plan: SegmentationPlan,
  interactive: boolean
): Promise<SegmentationStrategy> {
  logger.info('');
  logger.info('📊 分析上下文预估报告');
  logger.info('═══════════════════════════════════════');
  logger.info(`预估 Tokens: ~${estimate.estimatedTokens.toLocaleString()} (${estimate.level})`);
  logger.info(`端数量: ${estimate.details.platformCount}`);
  logger.info(`功能模块: ${estimate.details.moduleCount}`);
  logger.info(`功能单元: ${estimate.details.featureUnitCount}`);
  logger.info(`需求文档: ${estimate.details.docFileCount} 个, ${(estimate.details.totalFileSize / 1024).toFixed(0)} KB`);
  if (estimate.details.codeFileCount > 0) {
    logger.info(`源码文件: ${estimate.details.codeFileCount} 个`);
  }
  logger.info('');

  if (estimate.reasons.length > 0) {
    logger.info('💡 预估原因:');
    for (const r of estimate.reasons) {
      logger.info(`   • ${r}`);
    }
    logger.info('');
  }

  logger.info(`🎯 推荐策略: ${estimate.recommendedStrategy}`);
  logger.info(`   ${STRATEGY_DESCRIPTIONS[estimate.recommendedStrategy]}`);
  logger.info('');

  if (plan.segments.length > 1) {
    logger.info(`📋 分段计划 (${plan.segments.length} 个阶段):`);
    for (const seg of plan.segments) {
      const depStr = seg.dependencies.length > 0 ? ` [依赖: ${seg.dependencies.join(', ')}]` : '';
      logger.info(`   ${seg.id}: ${seg.name} (~${seg.estimatedTokens.toLocaleString()} tokens)${depStr}`);
    }
    logger.info('');
  }

  // 非交互模式直接返回推荐策略
  if (!interactive) {
    logger.info('🤖 非交互模式，自动采用推荐策略');
    return estimate.recommendedStrategy;
  }

  // 交互模式：提示用户确认或选择其他策略
  logger.info('请选择分析策略:');
  logger.info('   [1] 接受推荐（默认）');
  logger.info('   [2] 一次性分析（可能上下文溢出）');
  logger.info('   [3] 按端分段');
  logger.info('   [4] 按模块分段');
  logger.info('   [5] 按功能单元分段（最细粒度）');
  logger.info('');

  // 由于 CLI 环境无法真正交互，这里返回推荐策略
  // 实际交互由宿主 AI 处理（通过 prompt 输出选项让用户选择）
  return estimate.recommendedStrategy;
}

/**
 * 生成上下文防护提示（用于 prompt 输出）
 */
export function buildContextGuardPrompt(
  estimate: ContextEstimate,
  plan: SegmentationPlan
): string {
  let prompt = `\n## 📊 上下文大小预估与分段策略\n\n`;

  prompt += `### 预估结果\n\n`;
  prompt += `- **预估 Tokens**: ~${estimate.estimatedTokens.toLocaleString()}\n`;
  prompt += `- **大小等级**: ${estimate.level}\n`;
  prompt += `- **端数量**: ${estimate.details.platformCount}\n`;
  prompt += `- **功能模块**: ${estimate.details.moduleCount}\n`;
  prompt += `- **需求文档**: ${estimate.details.docFileCount} 个\n\n`;

  prompt += `### 推荐策略\n\n`;
  prompt += `**${estimate.recommendedStrategy}** — ${STRATEGY_DESCRIPTIONS[estimate.recommendedStrategy]}\n\n`;

  if (plan.segments.length > 1) {
    prompt += `### 分段执行计划\n\n`;
    prompt += `本次分析将分为 **${plan.segments.length}** 个阶段执行：\n\n`;
    prompt += `| 阶段 | 名称 | 类型 | 预估 Tokens | 依赖 |\n`;
    prompt += `| :--- | :--- | :--- | :--- | :--- |\n`;
    for (const seg of plan.segments) {
      const depStr = seg.dependencies.join(', ') || '无';
      prompt += `| ${seg.id} | ${seg.name} | ${seg.type} | ~${seg.estimatedTokens.toLocaleString()} | ${depStr} |\n`;
    }
    prompt += `\n`;

    prompt += `### 执行顺序\n\n`;
    prompt += `请按以下顺序执行：\n\n`;

    // 拓扑排序输出
    const executed = new Set<string>();
    const pending = [...plan.segments];
    let step = 1;
    while (pending.length > 0) {
      const ready = pending.filter(s => s.dependencies.every(d => executed.has(d)));
      if (ready.length === 0) break;
      for (const seg of ready) {
        prompt += `${step}. **${seg.name}**\n`;
        prompt += `   \`\`\`bash\n`;
        prompt += `   speccore analyze --prompt -I {迭代名} --global --with-code --streaming-phase ${seg.id}\n`;
        prompt += `   \`\`\`\n`;
        executed.add(seg.id);
        step++;
      }
      for (const s of ready) {
        const idx = pending.indexOf(s);
        if (idx >= 0) pending.splice(idx, 1);
      }
    }
    prompt += `\n`;
  }

  prompt += `> ⚠️ **上下文爆炸防护**: 如果某阶段执行时感觉上下文过大，可随时中断并请求更细粒度的分段。\n`;

  return prompt;
}

// ── 辅助函数 ──

/** 递归查找所有文件 */
async function findAllFiles(dir: string, extensions: string[]): Promise<string[]> {
  const result: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        result.push(...await findAllFiles(fullPath, extensions));
      } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
        result.push(fullPath);
      }
    }
  } catch { /* ignore */ }
  return result;
}

/** 从 CONSTITUTION.md 提取源码路径 */
function extractSourcePaths(content: string): string[] {
  const paths: string[] = [];
  // 匹配「源码路径」列的内容
  const lines = content.split('\n');
  for (const line of lines) {
    // 简单匹配表格中包含 / 或 . 的单元格
    const matches = line.match(/\|[\s\w]*源码路径[\s\w]*\|([^|\n]+)/g);
    if (matches) {
      for (const m of matches) {
        const pathMatch = m.match(/[\w\-./]+/g);
        if (pathMatch) {
          paths.push(...pathMatch.filter(p => p.includes('/') || p.includes('.')));
        }
      }
    }
  }
  return [...new Set(paths)];
}
