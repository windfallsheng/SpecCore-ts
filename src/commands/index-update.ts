/**
 * index-update — 扫描 GLOBAL/PROJECTS/ 下所有项目需求，自动重建 GLOBAL/INDEX.md
 */

import { pathExists, readFile, writeFile, readdir } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../utils/logger';
import { readGlobalIndex, getNextReqId } from '../core/global-layer';

export interface IndexUpdateOptions {
  dryRun?: boolean;
}

export async function indexUpdateCommand(options: IndexUpdateOptions): Promise<void> {
  const spinner = new Spinner('Scanning requirements and rebuilding index');
  spinner.start();

  try {
    const globalDir = join(process.cwd(), '.speccore', 'GLOBAL');

    if (!(await pathExists(globalDir))) {
      spinner.fail('Global layer not initialized. Run: speccore init');
      return;
    }

    const projectsDir = join(globalDir, 'PROJECTS');
    if (!(await pathExists(projectsDir))) {
      spinner.fail('No projects found in GLOBAL/PROJECTS/');
      return;
    }

    const index = await readGlobalIndex();
    const today = new Date().toISOString().split('T')[0];

    // 扫描所有项目
    const projects = await scanAllProjects(projectsDir);

    // 收集所有需求
    const allReqs: Array<{
      id: string;
      project: string;
      name: string;
      status: string;
      version: string;
    }> = [];

    let totalReqs = 0;
    let newReqs = 0;
    let updatedReqs = 0;
    const currentReqIds = new Set<string>();

    for (const proj of projects) {
      // 提取 REQ-XXX 条目
      const reqContent = await readFile(join(projectsDir, proj, 'REQUIREMENT.md'), 'utf-8');
      const reqMatches = reqContent.matchAll(/### (REQ-\d+).*\n([\s\S]*?)(?=### REQ-\d+|$)/g);

      for (const match of reqMatches) {
        const reqId = match[1];
        const reqBody = match[2];
        currentReqIds.add(reqId);
        totalReqs++;

        // 从 GLOBAL/INDEX 查找现有状态
        const existingEntry = index.reqs?.find((r: any) => r.id === reqId);

        const name = extractField(reqBody, '需求名称') || proj;
        const status = extractField(reqBody, '状态') || '📝 待开发';
        const version = extractField(reqBody, '版本') || 'v1.0';

        allReqs.push({ id: reqId, project: proj, name, status, version });

        if (!existingEntry) {
          newReqs++;
        } else if (
          existingEntry.status !== status ||
          existingEntry.name !== name
        ) {
          updatedReqs++;
        }
      }
    }

    // 重建 INDEX.md
    if (!options.dryRun) {
      await rebuildIndex(globalDir, allReqs, projects, totalReqs, today);
    }

    spinner.stop(options.dryRun ? 'Dry run completed (no changes made)' : 'Index rebuilt successfully');

    logger.info('');
    logger.info('📊 扫描结果：');
    logger.info(`  项目数：${projects.length} 个`);
    logger.info(`  需求数：${totalReqs} 条`);

    if (!options.dryRun) {
      logger.info(`  新增需求：${newReqs} 条`);
      logger.info(`  状态更新：${updatedReqs} 条`);
      logger.info('');
      logger.info('✅ GLOBAL/INDEX.md 已更新！');
    } else {
      logger.info('');
      logger.info('💡 预览模式（--dry-run），索引未被实际修改。');
      logger.info('   去除 --dry-run 执行实际更新。');
    }

    // 列出项目摘要
    logger.info('');
    logger.info('📁 项目摘要：');
    for (const proj of projects) {
      const reqCount = allReqs.filter((r) => r.project === proj).length;
      logger.info(`  - ${proj}: ${reqCount} 个需求`);
    }
  } catch (error) {
    spinner.fail(`Index update failed: ${error}`);
    throw error;
  }
}

/**
 * 扫描 GLOBAL/PROJECTS/ 下所有项目
 */
async function scanAllProjects(projectsDir: string): Promise<string[]> {
  const projects: string[] = [];
  if (!(await pathExists(projectsDir))) return projects;

  const entries = await readdir(projectsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('_')) {
      const reqPath = join(projectsDir, entry.name, 'REQUIREMENT.md');
      if (await pathExists(reqPath)) {
        projects.push(entry.name);
      }
    }
  }
  return projects;
}

/**
 * 从 markdown 正文中提取字段
 */
function extractField(body: string, field: string): string | null {
  const patterns = [
    new RegExp(`\\*\\*${field}\\*\\*\\s*[：:]\\s*([^\\n]+)`, 'i'),
    new RegExp(`\\|\\s*${field}\\s*\\|\\s*([^\\|]+)\\|`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * 重建 INDEX.md
 */
async function rebuildIndex(
  globalDir: string,
  reqs: { id: string; project: string; name: string; status: string; version: string }[],
  projects: string[],
  totalReqs: number,
  today: string
): Promise<void> {
  const indexPath = join(globalDir, 'INDEX.md');

  // 按需求 ID 排序
  reqs.sort((a, b) => a.id.localeCompare(b.id));

  let content = `# 全量需求索引（Global Catalog）

> 本文件是需求定位的"地图"。具体需求内容请查看各项目的 \`PROJECTS/{项目名}/REQUIREMENT.md\`。
> 本文件由 \`speccore import\` 和 \`speccore index-update\` 自动维护，请勿手动编辑。

---

## 需求索引

| 需求 ID | 项目 | 需求名称 | 状态 | 版本 | 文件路径 |
| :--- | :--- | :--- | :--- | :--- | :--- |
`;

  if (reqs.length === 0) {
    content += '| _暂无需求_ | - | - | - | - | - |\n';
  } else {
    for (const req of reqs) {
      content += `| ${req.id} | ${req.project} | ${req.name} | ${req.status} | ${req.version} | GLOBAL/PROJECTS/${req.project}/REQUIREMENT.md |\n`;
    }
  }

  content += `
---

## 项目列表

| 项目名称 | 需求数 | 状态 | 最后更新 |
| :--- | :--- | :--- | :--- |
`;

  if (projects.length === 0) {
    content += '| _暂无项目_ | - | - | - |\n';
  } else {
    for (const proj of projects) {
      const reqCount = reqs.filter((r) => r.project === proj).length;
      content += `| ${proj} | ${reqCount} | 活跃 | ${today} |\n`;
    }
  }

  content += `
---

## 版本信息

| 版本 | 日期 | 变更说明 |
| :--- | :--- | :--- |
| v1.0 | ${today} | 由 speccore index-update 自动重建 |
`;

  await writeFile(indexPath, content);
}
