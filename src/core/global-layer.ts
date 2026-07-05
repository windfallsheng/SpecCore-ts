/**
 * GLOBAL 全量层管理核心模块
 * 负责管理 GLOBAL/ 目录下的全量需求索引、项目映射、期次关联
 */

import { ensureDir, writeFile, readFile, pathExists, readdir } from 'fs-extra';
import { join } from 'path';

// ============================================================
// 类型定义
// ============================================================

/** 需求状态 */
export type ReqStatus = '📦 已有实现' | '✅ 已实现' | '🔄 进行中' | '🔲 待开发' | '🗑️ 已废弃';

/** 项目类型 */
export type ProjectType = 'backend' | 'web' | 'h5' | 'miniapp';

/** 需求索引条目 */
export interface ReqIndexEntry {
  id: string;
  project: string;
  name: string;
  status: ReqStatus;
  version: string;
  iteration: string;
  task: string;
  filePath: string;          // 相对于 GLOBAL/ 的路径
}

/** 项目条目 */
export interface ProjectEntry {
  name: string;
  type: ProjectType;
  reqCount: number;
  implemented: number;
  inProgress: number;
  pending: number;
  lastImport: string;
}

/** 期次关联条目 */
export interface IterationLink {
  name: string;
  reqs: string[];
  status: string;
  createdAt: string;
}

/** INDEX.md 解析后的全局索引 */
export interface GlobalIndex {
  reqs: ReqIndexEntry[];
  projects: ProjectEntry[];
  iterations: IterationLink[];
  version: string;
  lastUpdated: string;
}

/** 导入项目参数 */
export interface ImportProjectParams {
  project: string;
  path: string;
  type: ProjectType;
}

/** 需求变更条目 */
export interface ReqChange {
  reqId: string;
  reqName: string;
  project: string;
  changeType: '新增' | '修改' | '废弃';
  changeDesc: string;
}

// ============================================================
// 路径工具
// ============================================================

function getGlobalDir(): string {
  return join(process.cwd(), '.speccore', 'GLOBAL');
}

function getIndexPath(): string {
  return join(getGlobalDir(), 'INDEX.md');
}

function getProjectReqPath(project: string): string {
  return join(getGlobalDir(), 'PROJECTS', project, 'REQUIREMENT.md');
}

function getProjectMetaPath(project: string): string {
  return join(getGlobalDir(), 'PROJECTS', project, 'METADATA.md');
}

// ============================================================
// INDEX.md 读写
// ============================================================

/**
 * 解析 GLOBAL/INDEX.md
 */
export async function readGlobalIndex(): Promise<GlobalIndex> {
  const indexPath = getIndexPath();
  if (!(await pathExists(indexPath))) {
    return { reqs: [], projects: [], iterations: [], version: 'v1.0', lastUpdated: '' };
  }

  const content = await readFile(indexPath, 'utf-8');
  const index: GlobalIndex = { reqs: [], projects: [], iterations: [], version: 'v1.0', lastUpdated: '' };

  // 解析需求索引表
  const reqTableMatch = content.match(/\| 需求 ID \|[\s\S]*?(?=\n\n---|$)/);
  if (reqTableMatch) {
    const lines = reqTableMatch[0].split('\n');
    for (const line of lines) {
      const cols = line.split('|').map((c) => c.trim());
      if (line.includes(':---')) continue;
      if (cols.length >= 9 && cols[1] && cols[1].match(/^REQ-\d+$/)) {
        index.reqs.push({
          id: cols[1],
          project: cols[2],
          name: cols[3],
          status: cols[4] as ReqStatus,
          version: cols[5],
          iteration: cols[6] === '-' ? '' : cols[6],
          task: cols[7] === '-' ? '' : cols[7],
          filePath: cols[8],
        });
      }
    }
  }

  // 解析项目列表
  const projTableMatch = content.match(/\| 项目名称 \|[\s\S]*?(?=\n\n---|$)/);
  if (projTableMatch) {
    const lines = projTableMatch[0].split('\n');
    for (const line of lines) {
      const cols = line.split('|').map((c) => c.trim());
      // Skip separator lines (all colons and dashes)
      if (line.includes(':---')) continue;
      if (cols.length >= 8 && cols[1] && cols[1] !== '_暂无项目_' && cols[1] !== '项目名称') {
        index.projects.push({
          name: cols[1],
          type: cols[2] as ProjectType,
          reqCount: parseInt(cols[3]) || 0,
          implemented: parseInt(cols[4]) || 0,
          inProgress: parseInt(cols[5]) || 0,
          pending: parseInt(cols[6]) || 0,
          lastImport: cols[7],
        });
      }
    }
  }

  // 解析期次关联
  const iterTableMatch = content.match(/\| 期次名称 \|[\s\S]*?(?=\n\n---|$)/);
  if (iterTableMatch) {
    const lines = iterTableMatch[0].split('\n');
    for (const line of lines) {
      const cols = line.split('|').map((c) => c.trim());
      if (line.includes(':---')) continue;
      if (cols.length >= 5 && cols[1] && cols[1] !== '_暂无期次_' && cols[1] !== '期次名称') {
        index.iterations.push({
          name: cols[1],
          reqs: cols[2].split(',').map((r) => r.trim()),
          status: cols[3],
          createdAt: cols[4],
        });
      }
    }
  }

  // 解析版本信息
  const verMatch = content.match(/\| v(\d+\.\d+) \| ([^|]+) \|/);
  if (verMatch) {
    index.version = `v${verMatch[1]}`;
    index.lastUpdated = verMatch[2].trim();
  }

  return index;
}

/**
 * 获取下一个需求编号
 */
export function getNextReqId(index: GlobalIndex): string {
  let maxNum = 0;
  for (const req of index.reqs) {
    const match = req.id.match(/REQ-(\d+)/);
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
  }
  return `REQ-${String(maxNum + 1).padStart(3, '0')}`;
}

/**
 * 递增全局版本号
 */
export function bumpGlobalVersion(currentVersion: string): string {
  const match = currentVersion.match(/v(\d+)\.(\d+)/);
  if (match) {
    const major = parseInt(match[1]);
    const minor = parseInt(match[2]);
    return `v${major}.${minor + 1}`;
  }
  return 'v1.1';
}

/**
 * 追加需求条目到 INDEX.md 的需求索引表
 */
export async function appendReqToIndex(entry: ReqIndexEntry): Promise<void> {
  const indexPath = getIndexPath();
  let content = await readFile(indexPath, 'utf-8');

  const newLine = `| ${entry.id} | ${entry.project} | ${entry.name} | ${entry.status} | ${entry.version} | ${entry.iteration || '-'} | ${entry.task || '-'} | \`${entry.filePath}\` |`;

  // 如果存在占位行，替换第一条占位行
  if (content.includes('_暂无需求_')) {
    content = content.replace('| _暂无需求_ | - | - | - | - | - | - | - |', newLine);
  } else {
    // 在需求索引表最后一行后追加（就在分隔线前）
    const insertPoint = content.lastIndexOf('| _暂无需求_');
    if (insertPoint === -1) {
      // 找到表格最后一行数据
      const tableEnd = content.indexOf('\n\n---', content.indexOf('| 需求 ID |'));
      if (tableEnd > 0) {
        content = content.slice(0, tableEnd) + '\n' + newLine + content.slice(tableEnd);
      }
    }
  }

  await writeFile(indexPath, content);
}

/**
 * 更新 INDEX.md 中需求条目的状态、版本等信息
 */
export async function updateReqInIndex(reqId: string, updates: Partial<ReqIndexEntry>): Promise<void> {
  const indexPath = getIndexPath();
  let content = await readFile(indexPath, 'utf-8');

  const lines = content.split('\n');
  const newLines: string[] = [];

  for (const line of lines) {
    if (line.includes(`| ${reqId} |`)) {
      const cols = line.split('|').map((c) => c.trim());
      // cols[0]是空, cols[1]是需求ID, cols[2]是项目, cols[3]是名称
      // cols[4]是状态, cols[5]是版本, cols[6]是关联期次, cols[7]是关联Task, cols[8]是文件路径
      if (cols.length >= 9 && cols[1] === reqId) {
        if (updates.status) cols[4] = updates.status;
        if (updates.version) cols[5] = updates.version;
        if (updates.iteration !== undefined) cols[6] = updates.iteration || '-';
        if (updates.task !== undefined) cols[7] = updates.task || '-';
        if (updates.name) cols[3] = updates.name;
        newLines.push(`| ${cols[1]} | ${cols[2]} | ${cols[3]} | ${cols[4]} | ${cols[5]} | ${cols[6]} | ${cols[7]} | ${cols[8]} |`);
        continue;
      }
    }
    newLines.push(line);
  }

  await writeFile(indexPath, newLines.join('\n'));
}

/**
 * 追加项目条目到 INDEX.md
 */
export async function upsertProjectInIndex(project: ProjectEntry): Promise<void> {
  const indexPath = getIndexPath();
  let content = await readFile(indexPath, 'utf-8');

  const newLine = `| ${project.name} | ${project.type} | ${project.reqCount} | ${project.implemented} | ${project.inProgress} | ${project.pending} | ${project.lastImport} |`;

  // 只在项目列表表格区域内查找
  const projSectionStart = content.indexOf('## 项目列表');
  const projSectionEnd = content.indexOf('\n---', projSectionStart);
  const projSection = projSectionStart >= 0
    ? content.substring(projSectionStart, projSectionEnd > projSectionStart ? projSectionEnd : undefined)
    : '';

  // 检查项目列表区是否已有该项目（同时匹配名称和类型，避免与需求表混淆）
  const hasProjectLine = projSection.split('\n').some(
    (line) => line.trim().startsWith(`| ${project.name} |`) && line.includes(`| ${project.type} |`)
  );

  if (hasProjectLine) {
    // 更新已有项目条目
    const lines = content.split('\n');
    const newLines: string[] = [];
    for (const line of lines) {
      if (line.trim().startsWith(`| ${project.name} |`) && line.includes(`| ${project.type} |`)) {
        newLines.push(newLine);
      } else {
        newLines.push(line);
      }
    }
    content = newLines.join('\n');
  } else if (content.includes('_暂无项目_')) {
    // 替换占位行
    content = content.replace(/\| _暂无项目_ \| - \| - \| - \| - \| - \| - \|/, newLine);
  } else {
    // 在项目表格最后一行后追加
    const lastRowEnd = projSectionEnd > 0 ? projSectionEnd : content.length;
    content = content.slice(0, lastRowEnd) + '\n' + newLine + content.slice(lastRowEnd);
  }

  await writeFile(indexPath, content);
}

/**
 * 追加期次关联到 INDEX.md
 */
export async function appendIterationLink(link: IterationLink): Promise<void> {
  const indexPath = getIndexPath();
  let content = await readFile(indexPath, 'utf-8');

  const reqsStr = link.reqs.join(',');
  const newLine = `| ${link.name} | ${reqsStr} | ${link.status} | ${link.createdAt} |`;

  if (content.includes('_暂无期次_')) {
    content = content.replace(/\| _暂无期次_ \| - \| - \| - \|/, newLine);
  } else {
    // 在期次关联表格后面追加
    const iterSectionStart = content.indexOf('## 期次关联');
    const iterSectionEnd = content.indexOf('\n---', iterSectionStart);
    const insertPos = iterSectionEnd > iterSectionStart ? iterSectionEnd : content.length;
    content = content.slice(0, insertPos) + '\n' + newLine + content.slice(insertPos);
  }

  await writeFile(indexPath, content);
}

/**
 * 更新 INDEX.md 版本信息
 */
export async function updateIndexVersion(version: string): Promise<void> {
  const indexPath = getIndexPath();
  let content = await readFile(indexPath, 'utf-8');
  const today = new Date().toISOString().split('T')[0];

  // 更新最后的版本行
  const newVerLine = `| ${version} | ${today} | 自动更新 |`;
  const lines = content.split('\n');
  const newLines: string[] = [];
  let foundVersion = false;

  for (const line of lines) {
    if (line.match(/^\| v\d+\.\d+ \|/) && !foundVersion) {
      newLines.push(newVerLine);
      foundVersion = true;
    } else {
      newLines.push(line);
    }
  }

  await writeFile(indexPath, newLines.join('\n'));
}

// ============================================================
// 项目管理
// ============================================================

/**
 * 确保项目目录存在
 */
export async function ensureProjectDir(project: string): Promise<void> {
  const projDir = join(getGlobalDir(), 'PROJECTS', project);
  await ensureDir(projDir);
}

/**
 * 写入项目需求文档
 */
export async function writeProjectRequirements(
  project: string,
  projectType: ProjectType,
  requirements: { name: string; description: string; id: string }[],
  techStack: string = ''
): Promise<ReqIndexEntry[]> {
  const reqPath = getProjectReqPath(project);
  const today = new Date().toISOString().split('T')[0];
  const entries: ReqIndexEntry[] = [];

  let content = `# ${project} - 需求文档

> 本文件仅包含本项目需求。跨项目引用请通过 \`GLOBAL/INDEX.md\` 映射。
> 最后更新：${today}

---

## 项目信息

| 属性 | 值 |
| :--- | :--- |
| 项目名称 | ${project} |
| 项目类型 | ${projectType} |
| 技术栈 | ${techStack || '待补充'} |
| 负责人 | 待补充 |

---

## 需求列表

`;

  for (const req of requirements) {
    const reqId = req.id;
    content += `### ${reqId}：${req.name}

> **元数据（Metadata）**
> | 字段 | 值 |
> | :--- | :--- |
> | 来源 | \`speccore import\` \\| 项目：${project} \\| 导入时间：${today} |
> | 当前版本 | v1.0 |
> | 状态 | 📦 已有实现 |
> | 最后修改 | ${today} \\| 修改人：SpecCore |
> | 关联期次 | - |
> | 关联 Task | - |

**需求描述**
${req.description || '从代码分析提取的需求描述'}

**验收标准**
- [ ] 功能验收
- [ ] 性能验收
- [ ] 安全验收

**📝 变更历史（Changelog）**
| 版本 | 日期 | 变更内容 | 变更来源 | 修改人 |
| :--- | :--- | :--- | :--- | :--- |
| v1.0 | ${today} | 初始创建：从 ${project} 代码导入 | \`speccore import\` | SpecCore |

`;
    entries.push({
      id: reqId,
      project,
      name: req.name,
      status: '📦 已有实现',
      version: 'v1.0',
      iteration: '',
      task: '',
      filePath: `PROJECTS/${project}/REQUIREMENT.md`,
    });
  }

  await writeFile(reqPath, content);
  return entries;
}

/**
 * 写入项目元数据
 */
export async function writeProjectMetadata(
  project: string,
  projectType: ProjectType,
  techStack: string = '',
  repoUrl: string = ''
): Promise<void> {
  const metaPath = getProjectMetaPath(project);
  const today = new Date().toISOString().split('T')[0];

  const content = `# ${project} - 元数据

| 属性 | 值 |
| :--- | :--- |
| 项目名称 | ${project} |
| 项目类型 | ${projectType} |
| 技术栈 | ${techStack || '待补充'} |
| 版本 | 1.0.0 |
| 负责人 | 待补充 |
| 代码仓库 | ${repoUrl || '待补充'} |
| 最后扫描 | ${today} |

## 依赖关系

| 依赖项目 | 依赖方式 | 说明 |
| :--- | :--- | :--- |
| _待填写_ | - | - |
`;

  await writeFile(metaPath, content);
}

// ============================================================
// 需求查找与变更同步
// ============================================================

/**
 * 从指定项目中读取指定需求 ID 的详细内容
 */
export async function readRequirementDetail(project: string, reqId: string): Promise<string> {
  const reqPath = getProjectReqPath(project);
  if (!(await pathExists(reqPath))) {
    return '';
  }
  const content = await readFile(reqPath, 'utf-8');

  // 提取需求段落（从 ### REQ-XXX 开始到下一个 ### 或文件结尾）
  const regex = new RegExp(`### ${reqId}[：:][^]*?(?=\\n### |$)`, 'm');
  const match = content.match(regex);
  return match ? match[0] : '';
}

/**
 * 对比两个需求描述并返回变更清单
 */
export function diffRequirements(
  sourceTitle: string,
  sourceContent: string,
  targetContent: string
): ReqChange[] {
  const changes: ReqChange[] = [];

  if (!targetContent) {
    changes.push({
      reqId: '',
      reqName: sourceTitle,
      project: '',
      changeType: '新增',
      changeDesc: '全量层中不存在该需求，将新增',
    });
  } else {
    // 简单对比：长度差异、关键词检查
    if (sourceContent.length !== targetContent.length) {
      const diff = Math.abs(sourceContent.length - targetContent.length);
      if (diff > 50) {
        changes.push({
          reqId: '',
          reqName: sourceTitle,
          project: '',
          changeType: '修改',
          changeDesc: `内容长度差异 ${diff} 字符`,
        });
      }
    }
  }

  return changes;
}

/**
 * 获取所有已导入项目的列表
 */
export async function listProjectDirs(): Promise<string[]> {
  const projectsDir = join(getGlobalDir(), 'PROJECTS');
  if (!(await pathExists(projectsDir))) {
    return [];
  }
  const entries = await readdir(projectsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && e.name !== '_template')
    .map((e) => e.name);
}

// ============================================================
// 汇总导出
// ============================================================

export { getGlobalDir, getIndexPath, getProjectReqPath, getProjectMetaPath };
