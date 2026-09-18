/**
 * feature-metadata — 功能单元元数据扫描器
 *
 * 扫描 features/ 目录下的所有功能单元，提取元数据用于总览生成。
 * 核心原则：不读全文，只读 _matrix.md + README.md 前 2 句。
 */
import { pathExists, readFile, readdir } from 'fs-extra';
import { join } from 'path';
import yaml from 'js-yaml';
import { logger } from '../utils/logger';

export interface FeatureMetadata {
  feature: string;
  platforms: string[];
  dependencies: string[];
  apis: Array<{ path: string; method?: string; description?: string }>;
  summary: string;
  sources: string[];
  status: string;
}

export interface OverviewInput {
  iteration: string;
  features: FeatureMetadata[];
  globalConstraints: {
    techStack?: string;
    apiFormat?: string;
    errorCode?: string;
  };
}

/**
 * 扫描迭代目录下的所有功能单元元数据
 */
export async function scanFeatureMetadata(iteration: string): Promise<FeatureMetadata[]> {
  const featuresDir = join(iteration, '010-requirements', 'features');
  if (!(await pathExists(featuresDir))) {
    return [];
  }

  const entries = await readdir(featuresDir, { withFileTypes: true });
  const featureDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

  const metadata: FeatureMetadata[] = [];
  for (const dirName of featureDirs) {
    const featureDir = join(featuresDir, dirName);
    const matrix = await parseMatrixFile(featureDir);
    const summary = await extractSummary(featureDir);
    const sources = await listSources(featureDir);
    const status = await readStatus(featureDir);

    metadata.push({
      feature: matrix.feature || dirName,
      platforms: matrix.platforms || [],
      dependencies: matrix.dependencies || [],
      apis: matrix.apis || [],
      summary,
      sources,
      status,
    });
  }

  return metadata;
}

/**
 * 解析功能单元的 _matrix.md 文件
 */
async function parseMatrixFile(featureDir: string): Promise<Partial<FeatureMetadata>> {
  const matrixPath = join(featureDir, '_matrix.md');
  if (!(await pathExists(matrixPath))) {
    return {};
  }

  try {
    const content = await readFile(matrixPath, 'utf-8');
    // 去掉 Markdown 标题行（# xxx），保留 YAML 内容
    const yamlContent = content.replace(/^#.*\n+/, '');
    const data = yaml.load(yamlContent) as any;

    return {
      feature: data?.feature || '',
      platforms: Array.isArray(data?.platforms) ? data.platforms : [],
      dependencies: Array.isArray(data?.dependencies) ? data.dependencies : [],
      apis: Array.isArray(data?.apis) ? data.apis : [],
    };
  } catch (error) {
    logger.warn(`解析 _matrix.md 失败: ${featureDir}`);
    return {};
  }
}

/**
 * 从 README.md 提取前 2 句话作为摘要
 */
async function extractSummary(featureDir: string): Promise<string> {
  const readmePath = join(featureDir, 'README.md');
  if (!(await pathExists(readmePath))) {
    return '';
  }

  try {
    const content = await readFile(readmePath, 'utf-8');
    const lines = content.split('\n');

    // 跳过标题和元数据，取第一个正文段落的前 2 句
    const contentLines = lines.filter(line =>
      !line.startsWith('#') &&
      !line.startsWith('>') &&
      !line.startsWith('|') &&
      line.trim() !== ''
    );

    const firstParagraph = contentLines[0] || '';
    // 按中文句号、英文句号、感叹号、问号分割
    const sentences = firstParagraph.split(/[。\.!?？！]/).filter(s => s.trim());
    return sentences.slice(0, 2).join('。') + (sentences.length > 0 ? '。' : '');
  } catch {
    return '';
  }
}

/**
 * 列出功能单元的来源文档（从 .meta/source 读取）
 */
async function listSources(featureDir: string): Promise<string[]> {
  const sourcePath = join(featureDir, '.meta', 'source');
  if (!(await pathExists(sourcePath))) {
    return [];
  }

  try {
    const content = await readFile(sourcePath, 'utf-8');
    const data = yaml.load(content) as any;
    return data?.source_file ? [data.source_file] : [];
  } catch {
    return [];
  }
}

/**
 * 读取功能单元状态
 */
async function readStatus(featureDir: string): Promise<string> {
  const sourcePath = join(featureDir, '.meta', 'source');
  if (!(await pathExists(sourcePath))) {
    return 'unknown';
  }

  try {
    const content = await readFile(sourcePath, 'utf-8');
    const data = yaml.load(content) as any;
    return data?.status || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * 构建总览输入 JSON
 * @param iteration 迭代目录名
 * @param metadata 功能单元元数据列表
 * @returns 总览输入结构
 */
export async function buildOverviewInput(
  iteration: string,
  metadata: FeatureMetadata[]
): Promise<OverviewInput> {
  return {
    iteration,
    features: metadata,
    globalConstraints: {
      techStack: '从 CONSTITUTION.md 读取',
      apiFormat: '从 CONSTITUTION.md 读取',
      errorCode: '从 CONSTITUTION.md 读取',
    },
  };
}

/**
 * 计算端覆盖统计
 */
export function calculatePlatformCoverage(metadata: FeatureMetadata[]): Record<string, number> {
  const coverage: Record<string, number> = {};
  for (const m of metadata) {
    for (const p of m.platforms) {
      coverage[p] = (coverage[p] || 0) + 1;
    }
  }
  return coverage;
}

/**
 * 计算功能单元间的交叉引用（被多个功能引用的接口）
 */
export function findCrossFeatureApis(
  metadata: FeatureMetadata[]
): Array<{ path: string; usedBy: string[] }> {
  const usageMap = new Map<string, string[]>();

  for (const m of metadata) {
    for (const api of m.apis) {
      const path = api.path;
      if (!usageMap.has(path)) {
        usageMap.set(path, []);
      }
      usageMap.get(path)!.push(m.feature);
    }
  }

  return Array.from(usageMap.entries())
    .filter(([, usedBy]) => usedBy.length > 1)
    .map(([path, usedBy]) => ({ path, usedBy }));
}
