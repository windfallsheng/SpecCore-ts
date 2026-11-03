/**
 * analyze 模式：--scope=overview 总览生成（--phase=skeleton|full）
 * 含总览 Prompt 构建与 [DOC:xxx] 标记落盘。
 * v8.3.341+: 从 analyzeCommand 抽出的模式早退块
 * v8.3.359+: 从 analyze.ts 拆分（渐进重构批次 C，逻辑不搬家、行为不变）
 */
import { join } from 'path';
import { writeFile, ensureDir } from 'fs-extra';
import { logger } from '../../utils/logger';
import { getDefaultIteration, getIterationDir } from '../../core/context';
import {
  scanFeatureMetadata,
  buildOverviewInput,
  calculatePlatformCoverage,
  findCrossFeatureApis,
  type OverviewInput,
} from '../../core/feature-metadata';
import { emitAiPrompt } from './shared';
import type { AnalyzeOptions } from './shared';

export async function analyzeOverviewMode(options: AnalyzeOptions): Promise<void> {
  const iter = options.iteration || await getDefaultIteration();
  if (!iter) { logger.error('请指定迭代: -I <iteration>'); return; }
  const iterDir = await getIterationDir(iter);

  // 扫描功能单元元数据
  const metadata = await scanFeatureMetadata(iterDir);
  if (metadata.length === 0) {
    logger.warn('未找到功能单元，请先运行: speccore doc2spec --split');
    return;
  }

  logger.info(`📊 总览生成: ${iter}`);
  logger.info(`   功能单元: ${metadata.length} 个`);

  // 构建总览输入
  const overviewInput = await buildOverviewInput(iter, metadata);
  const coverage = calculatePlatformCoverage(metadata);
  const crossApis = findCrossFeatureApis(metadata);

  const phase = options.phase || 'skeleton';

  // ── apply 模式：接收 AI 结果写入总览文件 ──
  if (options.apply) {
    await writeOverviewFiles(iterDir, options.apply, phase);
    logger.success(`✅ 总览已写入: ${iterDir}/020-specs/overview/`);
    return;
  }

  // ── prompt 模式：生成 AI Prompt ──
  const prompt = buildOverviewPrompt(overviewInput, coverage, crossApis, phase);
  await emitAiPrompt(iter, prompt, { mode: 'overview' });
  process.exitCode = 10;
}

/**
 * 构建总览生成 AI Prompt
 */
function buildOverviewPrompt(
  input: OverviewInput,
  coverage: Record<string, number>,
  crossApis: Array<{ path: string; usedBy: string[] }>,
  phase: string,
): string {
  const isSkeleton = phase === 'skeleton';

  let prompt = `# 任务: 生成迭代${isSkeleton ? '骨架' : '完整'}总览\n\n`;
  prompt += `## 输入数据（CLI 自动提取，${input.features.length} 个功能单元）\n\n`;
  prompt += `### 功能单元清单\n\n`;
  prompt += `| 功能单元 | 涉及端 | 依赖 | 摘要 |\n`;
  prompt += `| :--- | :--- | :--- | :--- |\n`;
  for (const f of input.features) {
    prompt += `| ${f.feature} | ${f.platforms.join(', ') || '-'} | ${f.dependencies.join(', ') || '无'} | ${f.summary.slice(0, 40)}${f.summary.length > 40 ? '...' : ''} |\n`;
  }

  prompt += `\n### 端覆盖统计\n\n`;
  prompt += `| 端 | 覆盖功能单元数 |\n`;
  prompt += `| :--- | :--- |\n`;
  for (const [platform, count] of Object.entries(coverage)) {
    prompt += `| ${platform} | ${count} |\n`;
  }

  if (crossApis.length > 0) {
    prompt += `\n### 跨功能单元接口\n\n`;
    prompt += `| 接口 | 被哪些功能引用 |\n`;
    prompt += `| :--- | :--- |\n`;
    for (const api of crossApis) {
      prompt += `| ${api.path} | ${api.usedBy.join(', ')} |\n`;
    }
  }

  if (isSkeleton) {
    prompt += `\n## 生成要求（骨架总览）\n\n`;
    prompt += `1. 生成 **功能地图**（Mermaid flowchart）：展示功能单元间的依赖关系\n`;
    prompt += `2. 生成 **端覆盖总览表**：指出哪些端缺少功能覆盖\n`;
    prompt += `3. 生成 **功能单元清单**：确认所有功能单元已识别\n`;
    prompt += `4. 内容控制在 40-60 行\n`;
    prompt += `5. 使用 [DOC:OVERVIEW] 标记输出\n`;
  } else {
    prompt += `\n## 生成要求（完整总览）\n\n`;
    prompt += `1. 生成 **系统架构图**（Mermaid）：服务拓扑 + 数据流\n`;
    prompt += `2. 生成 **跨功能单元接口清单**：标注哪些接口被多个功能引用\n`;
    prompt += `3. 生成 **实际依赖关系表**：基于接口调用关系\n`;
    prompt += `4. 内容控制在 60-80 行\n`;
    prompt += `5. 使用 [DOC:OVERVIEW] 和 [DOC:ARCHITECTURE] 标记输出\n`;
  }

  prompt += `\n## 输出格式\n\n`;
  prompt += `\`\`\`markdown\n`;
  prompt += `[DOC:OVERVIEW]\n`;
  prompt += `# 迭代总览（${isSkeleton ? '骨架' : '完整'}）\n`;
  prompt += `...\n`;
  prompt += `\`\`\`\n`;

  return prompt;
}

/**
 * 写入总览文件（解析 AI 返回的 [DOC:xxx] 标记）
 */
async function writeOverviewFiles(
  iterDir: string,
  applyContent: string,
  phase: string,
): Promise<void> {
  const specDir = join(iterDir, '020-specs');
  const overviewDir = join(specDir, 'overview');
  await ensureDir(overviewDir);

  // 解析 [DOC:OVERVIEW] 和 [DOC:ARCHITECTURE] 标记
  const overviewMatch = applyContent.match(/\[DOC:OVERVIEW\]([\s\S]*?)(?=\[DOC:|$)/);
  const archMatch = applyContent.match(/\[DOC:ARCHITECTURE\]([\s\S]*?)(?=\[DOC:|$)/);

  if (overviewMatch) {
    const content = overviewMatch[1].trim();
    const fileName = phase === 'skeleton' ? 'REQUIREMENT.md' : 'REQUIREMENT.md';
    await writeFile(join(overviewDir, fileName), content);
    logger.info(`   📝 已写入: overview/${fileName}`);
  }

  if (archMatch) {
    const content = archMatch[1].trim();
    await writeFile(join(overviewDir, 'ARCHITECTURE.md'), content);
    logger.info(`   📝 已写入: overview/ARCHITECTURE.md`);
  }

  // 如果没有标记，直接写入 REQUIREMENT.md
  if (!overviewMatch && !archMatch) {
    await writeFile(join(overviewDir, 'REQUIREMENT.md'), applyContent.trim());
    logger.info(`   📝 已写入: overview/REQUIREMENT.md`);
  }
}
