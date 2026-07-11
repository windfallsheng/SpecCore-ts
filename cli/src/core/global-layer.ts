import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/** 需求条目 */
export interface RequirementEntry {
  id: string;
  title: string;
  version: string;
  status: string;
  project: string;
  lastModified: string;
  relatedIteration: string;
}

/**
 * 全量层索引管理器 — 读写 GLOBAL/INDEX.md
 */
export class GlobalLayer {
  private indexPath: string;

  constructor(private projectRoot: string) {
    this.indexPath = join(projectRoot, '.speccore', 'GLOBAL', 'INDEX.md');
  }

  /** 检查 INDEX.md 是否存在 */
  exists(): boolean {
    return existsSync(this.indexPath);
  }

  /** 读取 INDEX.md 原始内容 */
  readRaw(): string | null {
    if (!this.exists()) return null;
    return readFileSync(this.indexPath, 'utf-8');
  }

  /** 从 INDEX.md 中提取需求条目 */
  parseRequirements(): RequirementEntry[] {
    const content = this.readRaw();
    if (!content) return [];

    const entries: RequirementEntry[] = [];
    const lines = content.split('\n');
    let currentId = '';
    let currentTitle = '';

    for (const line of lines) {
      // REQ-XXX 标题行
      const idMatch = line.match(/^###\s+(REQ-\d+):?\s*(.*)/);
      if (idMatch) {
        currentId = idMatch[1];
        currentTitle = idMatch[2] || '';
      }

      // 表格行（提取元数据）
      const tableMatch = line.match(
        /^\|\s*([\w.]+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/
      );
      if (tableMatch && currentId) {
        entries.push({
          id: currentId,
          title: currentTitle,
          version: tableMatch[1],
          status: tableMatch[2],
          project: tableMatch[3],
          lastModified: tableMatch[4],
          relatedIteration: tableMatch[5],
        });
        currentId = '';
      }
    }

    return entries;
  }

  /** 重建 INDEX.md */
  rebuildIndex(entries: RequirementEntry[], projectNames: string[]): void {
    const header = `# 全局需求索引

> 自动生成于 ${new Date().toISOString().split('T')[0]}
> 项目: ${projectNames.join(', ')}

## 需求索引

| ID | 版本 | 状态 | 项目 | 最后修改 | 关联期次 |
| :--- | :--- | :--- | :--- | :--- | :--- |
`;

    const rows = entries.map(e =>
      `| ${e.id} | ${e.version} | ${e.status} | ${e.project} | ${e.lastModified} | ${e.relatedIteration} |`
    ).join('\n');

    this.ensureDir();
    writeFileSync(this.indexPath, header + rows + '\n');
  }

  /** 获取每个项目的需求数量 */
  countByProject(): Record<string, number> {
    const entries = this.parseRequirements();
    const counts: Record<string, number> = {};
    for (const e of entries) {
      counts[e.project] = (counts[e.project] || 0) + 1;
    }
    return counts;
  }

  /** 确保 GLOBAL 目录存在 */
  private ensureDir(): void {
    const { mkdirSync } = require('fs');
    const globalDir = join(this.projectRoot, '.speccore', 'GLOBAL');
    mkdirSync(globalDir, { recursive: true });
  }
}
