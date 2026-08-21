/**
 * iteration-cache — 迭代分析临时产物目录管理
 * v7.2.0+
 *
 * 迭代分析过程中产生的临时数据统一存放在：
 *   .speccore/cache/iterations/{iteration-name}/
 *
 * 存放内容：
 *   - context.json — 本次分析的上下文参数（docName/featureName/withCode 等）
 *   - feature-locations.json — 语义定位结果
 *   - code-scan.json — 代码扫描摘要
 *   - analysis-snapshot.json — 分析快照（用于增量更新对比）
 *   - deep-outline-{doc}.md — 迭代式补全的大纲文件
 */
import { ensureDir, pathExists, writeJson, readJson, writeFile, readFile } from 'fs-extra';
import { join } from 'path';

export interface IterationCacheContext {
  iteration: string;
  docName?: string;
  featureName?: string;
  withCode?: boolean;
  timestamp: string;
}

function getCacheDir(iteration: string): string {
  return join(process.cwd(), '.speccore', 'cache', 'iterations', iteration);
}

/**
 * 确保迭代临时目录存在
 */
export async function ensureIterationCache(iteration: string): Promise<string> {
  const dir = getCacheDir(iteration);
  await ensureDir(dir);
  return dir;
}

/**
 * 保存分析上下文
 */
export async function saveAnalysisContext(ctx: IterationCacheContext): Promise<void> {
  const dir = await ensureIterationCache(ctx.iteration);
  await writeJson(join(dir, 'context.json'), ctx, { spaces: 2 });
}

/**
 * 读取分析上下文
 */
export async function loadAnalysisContext(iteration: string): Promise<IterationCacheContext | null> {
  const path = join(getCacheDir(iteration), 'context.json');
  if (await pathExists(path)) {
    return await readJson(path) as IterationCacheContext;
  }
  return null;
}

/**
 * 保存语义定位结果
 */
export async function saveFeatureLocations(iteration: string, featureName: string, locations: unknown): Promise<void> {
  const dir = await ensureIterationCache(iteration);
  await writeJson(join(dir, `feature-locations-${featureName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-')}.json`), locations, { spaces: 2 });
}

/**
 * 保存代码扫描摘要
 */
export async function saveCodeScanSummary(iteration: string, summary: unknown): Promise<void> {
  const dir = await ensureIterationCache(iteration);
  await writeJson(join(dir, 'code-scan.json'), summary, { spaces: 2 });
}

/**
 * 保存分析快照（用于增量更新对比）
 */
export async function saveAnalysisSnapshot(iteration: string, snapshot: unknown): Promise<void> {
  const dir = await ensureIterationCache(iteration);
  await writeJson(join(dir, 'analysis-snapshot.json'), snapshot, { spaces: 2 });
}

/**
 * 读取分析快照
 */
export async function loadAnalysisSnapshot(iteration: string): Promise<unknown | null> {
  const path = join(getCacheDir(iteration), 'analysis-snapshot.json');
  if (await pathExists(path)) {
    return await readJson(path);
  }
  return null;
}

/**
 * 保存迭代式补全大纲
 */
export async function saveDeepOutline(iteration: string, docName: string, outline: string): Promise<void> {
  const dir = await ensureIterationCache(iteration);
  await writeFile(join(dir, `deep-outline-${docName.replace(/\//g, '-')}.md`), outline);
}

/**
 * 读取迭代式补全大纲
 */
export async function loadDeepOutline(iteration: string, docName: string): Promise<string | null> {
  const path = join(getCacheDir(iteration), `deep-outline-${docName.replace(/\//g, '-')}.md`);
  if (await pathExists(path)) {
    return await readFile(path, 'utf-8');
  }
  return null;
}

/**
 * 清理迭代临时目录
 */
export async function clearIterationCache(iteration: string): Promise<void> {
  const { remove } = await import('fs-extra');
  const dir = getCacheDir(iteration);
  if (await pathExists(dir)) {
    await remove(dir);
  }
}
