/**
 * change-impact-global — 变更驱动的全局分析文档过期检测
 * v7.2.0+
 *
 * 检测源码变更后哪些全局分析文档需要更新：
 *   1. 获取源码目录最近修改时间
 *   2. 获取全局分析文档最后修改时间
 *   3. 如果源码比文档新 → 标记该文档需要更新
 *   4. 输出影响报告和更新建议
 */
import { stat, pathExists, readdir } from 'fs-extra';
import { join } from 'path';
import { execSync } from 'child_process';
import { logger } from '../utils/logger';

export interface StaleDoc {
  docPath: string;
  docMtime: Date;
  sourceMtime: Date;
  staleDays: number;
  suggestion: string;
}

/**
 * 获取源码目录最近修改时间（基于 git）
 */
export async function getSourceLastModified(projectRoot: string): Promise<Date> {
  try {
    const output = execSync(
      'git log -1 --format=%ct -- .',
      { cwd: projectRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const timestamp = parseInt(output.trim(), 10);
    return new Date(timestamp * 1000);
  } catch {
    // fallback: 取 src/ 目录下最新文件时间
    return getDirLatestMtime(join(projectRoot, 'src'));
  }
}

async function getDirLatestMtime(dir: string): Promise<Date> {
  let latest = new Date(0);
  if (!(await pathExists(dir))) return latest;

  const scan = async (target: string) => {
    const entries = await readdir(target, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(target, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        await scan(fullPath);
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx|py|go|java|rs|vue)$/.test(entry.name)) {
        const s = await stat(fullPath);
        if (s.mtime > latest) latest = s.mtime;
      }
    }
  };

  await scan(dir);
  return latest;
}

/**
 * 检测全局分析文档是否过期
 */
export async function detectStaleGlobalDocs(projectRoot: string): Promise<StaleDoc[]> {
  const globalDir = join(projectRoot, '.speccore', 'GLOBAL');
  if (!(await pathExists(globalDir))) return [];

  const sourceMtime = await getSourceLastModified(projectRoot);
  const staleDocs: StaleDoc[] = [];

  const scanDocs = async (dir: string) => {
    if (!(await pathExists(dir))) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDocs(fullPath);
      } else if (/\.(md|yaml|yml)$/.test(entry.name)) {
        const s = await stat(fullPath);
        const docMtime = s.mtime;
        if (sourceMtime > docMtime) {
          const diffMs = sourceMtime.getTime() - docMtime.getTime();
          const staleDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          const relPath = fullPath.replace(globalDir + '/', '');

          // 根据文档路径生成更新建议
          let suggestion = '';
          if (relPath.includes('platforms/')) {
            suggestion = `speccore analyze --scope global --layer 1 --with-code`;
          } else if (relPath.includes('overview/')) {
            suggestion = `speccore analyze --scope global --layer 4`;
          } else if (relPath.includes('requirements/')) {
            suggestion = `speccore analyze --scope global --layer 4`;
          } else {
            suggestion = `speccore analyze --scope global --layer 3`;
          }

          staleDocs.push({
            docPath: relPath,
            docMtime,
            sourceMtime,
            staleDays,
            suggestion,
          });
        }
      }
    }
  };

  await scanDocs(globalDir);

  // 按过期天数排序
  return staleDocs.sort((a, b) => b.staleDays - a.staleDays);
}

/**
 * 打印过期文档报告
 */
export function printStaleDocReport(docs: StaleDoc[]): void {
  if (docs.length === 0) return;

  logger.info('');
  logger.info('⚠️  全局分析文档可能已过期');
  logger.info(`   检测到 ${docs.length} 份文档在源码变更后未更新`);
  logger.info('');

  for (const doc of docs.slice(0, 5)) {
    logger.info(`   📄 ${doc.docPath}`);
    logger.info(`      文档: ${doc.docMtime.toLocaleDateString('zh-CN')} | 源码: ${doc.sourceMtime.toLocaleDateString('zh-CN')} | 过期 ${doc.staleDays} 天`);
    logger.info(`      建议: ${doc.suggestion}`);
  }

  if (docs.length > 5) {
    logger.info(`   ... 还有 ${docs.length - 5} 份文档`);
  }

  logger.info('');
  logger.info('💡 快速更新: speccore analyze --scope global --incremental');
}
