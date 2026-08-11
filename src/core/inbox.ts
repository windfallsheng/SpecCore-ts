/**
 * inbox — 需求收件箱
 * 管理 .speccore/inbox/ 目录：扫描新文件、追踪处理状态、读取文件内容
 */
import { join } from 'path';
import { readdir, readFile, writeFile, pathExists, stat, ensureDir } from 'fs-extra';
import { logger } from '../utils/logger';

// ── 类型定义 ──

export interface InboxFileEntry {
  name: string;
  path: string;
  size: number;
  mtime: string;
  type: 'text' | 'excel' | 'image' | 'other';
  content: string;       // 文本内容（图片为路径引用）
}

export interface InboxScanResult {
  newFiles: InboxFileEntry[];
  modifiedFiles: InboxFileEntry[];
  skippedFiles: string[];  // 已处理且未修改
  allFiles: InboxFileEntry[];
}

export interface ManifestEntry {
  processedAt: string;
  mtime: string;
  linkedTo: string[];
  action: 'change' | 'new' | 'unknown';
}

export interface InboxManifest {
  files: Record<string, ManifestEntry>;
  lastScan: string;
}

/** 单个任务的影响分析结果 */
export interface TaskImpact {
  id: string;
  name: string;
  status: string;           // 当前任务状态（todo/in-progress/done 等）
  level: 'direct' | 'indirect' | 'none';  // 影响级别
  reason: string;           // 影响原因说明
  affectedFiles: string[];  // 受影响的文件列表
  needReExecute: boolean;   // 是否需要重新执行
  needRegression: boolean;  // 是否需要回归测试
}

/** 结构化影响分析报告 */
export interface ImpactReport {
  directTasks: TaskImpact[];    // 直接影响：需修改 Spec + 重新执行
  indirectTasks: TaskImpact[];  // 间接影响：需回归验证
  unaffectedTasks: TaskImpact[]; // 无影响
}

// ── 常量 ──

const INBOX_DIR = '.speccore/inbox';
const MANIFEST_FILE = '.manifest.json';

// ── 核心函数 ──

/**
 * 获取 inbox 目录绝对路径
 */
export function getInboxDir(): string {
  return join(process.cwd(), INBOX_DIR);
}

/**
 * 确保 inbox 目录存在
 */
export async function ensureInboxDir(): Promise<void> {
  await ensureDir(getInboxDir());
}

/**
 * 读取 manifest
 */
export async function readManifest(): Promise<InboxManifest> {
  const manifestPath = join(getInboxDir(), MANIFEST_FILE);
  if (await pathExists(manifestPath)) {
    try {
      const content = await readFile(manifestPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return { files: {}, lastScan: '' };
    }
  }
  return { files: {}, lastScan: '' };
}

/**
 * 写入 manifest
 */
export async function writeManifest(manifest: InboxManifest): Promise<void> {
  const manifestPath = join(getInboxDir(), MANIFEST_FILE);
  manifest.lastScan = new Date().toISOString();
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

/**
 * 检测文件类型
 */
function detectFileType(name: string): InboxFileEntry['type'] {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['md', 'txt', 'markdown', 'json', 'yaml', 'yml', 'csv'].includes(ext)) return 'text';
  if (['xlsx', 'xls'].includes(ext)) return 'excel';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  return 'other';
}

/**
 * 读取单个文件内容
 */
async function readInboxFile(filePath: string, fileType: InboxFileEntry['type']): Promise<string> {
  switch (fileType) {
    case 'text':
      return readFile(filePath, 'utf-8');

    case 'excel':
      try {
        const XLSX = require('xlsx');
        const wb = XLSX.readFile(filePath);
        const sheets: string[] = [];
        for (const name of wb.SheetNames) {
          const ws = wb.Sheets[name];
          const csv: string = XLSX.utils.sheet_to_csv(ws);
          sheets.push(`## Sheet: ${name}\n${csv}`);
        }
        return sheets.join('\n\n');
      } catch (e) {
        return `[Excel 解析失败: ${filePath}]`;
      }

    case 'image':
      // 图片无法直接读取文本，返回路径引用
      return `[图片文件: ${filePath}]`;

    case 'other':
      try {
        return await readFile(filePath, 'utf-8');
      } catch {
        return `[无法读取: ${filePath}]`;
      }
  }
}

/**
 * 扫描 inbox 目录，区分新文件/已修改/已处理
 */
export async function scanInbox(options: { reprocess?: boolean } = {}): Promise<InboxScanResult> {
  const inboxDir = getInboxDir();

  if (!await pathExists(inboxDir)) {
    return { newFiles: [], modifiedFiles: [], skippedFiles: [], allFiles: [] };
  }

  const manifest = await readManifest();
  const entries = await readdir(inboxDir, { withFileTypes: true });

  const result: InboxScanResult = { newFiles: [], modifiedFiles: [], skippedFiles: [], allFiles: [] };

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;

    const filePath = join(inboxDir, entry.name);
    const fileType = detectFileType(entry.name);
    const fileStat = await stat(filePath);
    const mtime = fileStat.mtime.toISOString();

    const fileEntry: InboxFileEntry = {
      name: entry.name,
      path: filePath,
      size: fileStat.size,
      mtime,
      type: fileType,
      content: '',
    };

    // 检查 manifest 状态
    const manifestEntry = manifest.files[entry.name];

    if (options.reprocess || !manifestEntry) {
      // 新文件 或 强制重新处理
      fileEntry.content = await readInboxFile(filePath, fileType);
      if (manifestEntry) {
        result.modifiedFiles.push(fileEntry);
      } else {
        result.newFiles.push(fileEntry);
      }
    } else if (manifestEntry.mtime !== mtime) {
      // 文件已修改
      fileEntry.content = await readInboxFile(filePath, fileType);
      result.modifiedFiles.push(fileEntry);
    } else {
      // 已处理且未修改 → 跳过
      result.skippedFiles.push(entry.name);
    }

    result.allFiles.push(fileEntry);
  }

  return result;
}

/**
 * 更新 manifest：标记文件已处理
 */
export async function markProcessed(
  files: InboxFileEntry[],
  action: 'change' | 'new',
  linkedTo: string[] = []
): Promise<void> {
  const manifest = await readManifest();

  for (const file of files) {
    manifest.files[file.name] = {
      processedAt: new Date().toISOString(),
      mtime: file.mtime,
      linkedTo,
      action,
    };
  }

  await writeManifest(manifest);
}

/**
 * 清理 manifest 中已不存在的文件记录
 */
export async function cleanManifest(): Promise<number> {
  const manifest = await readManifest();
  const inboxDir = getInboxDir();
  let cleaned = 0;

  for (const name of Object.keys(manifest.files)) {
    if (!await pathExists(join(inboxDir, name))) {
      delete manifest.files[name];
      cleaned++;
    }
  }

  if (cleaned > 0) await writeManifest(manifest);
  return cleaned;
}

/**
 * 格式化 inbox 扫描结果为终端输出
 */
export function logInboxScan(result: InboxScanResult): void {
  const total = result.newFiles.length + result.modifiedFiles.length + result.skippedFiles.length;

  if (total === 0) {
    logger.info('📎 Inbox: 目录为空');
    return;
  }

  logger.info('📎 Inbox 扫描:');

  for (const f of result.newFiles) {
    const size = f.size > 1024 ? `${(f.size / 1024).toFixed(1)}KB` : `${f.size}B`;
    logger.info(`   🆕 ${f.name} (新文件, ${size})`);
  }

  for (const f of result.modifiedFiles) {
    const size = f.size > 1024 ? `${(f.size / 1024).toFixed(1)}KB` : `${f.size}B`;
    logger.info(`   🔄 ${f.name} (已修改, ${size})`);
  }

  for (const name of result.skippedFiles) {
    logger.info(`   ✅ ${name} (已处理 → 跳过)`);
  }

  const actionable = result.newFiles.length + result.modifiedFiles.length;
  if (actionable === 0) {
    logger.info('');
    logger.info('   所有文件已处理。请添加新文件或使用 --file 指定');
  }
}

/**
 * 构建澄清 Prompt：将用户描述 + 文件内容 + 任务详细上下文组合为结构化 Prompt
 * taskDetails 包含每个任务的 REQ 摘要、TECH 摘要、状态、依赖关系
 */
export function buildClarifyPrompt(
  desc: string,
  files: InboxFileEntry[],
  taskDetails: { id: string; name: string; reqSummary: string; techSummary: string; status: string; dependencies: string[] }[]
): string {
  const sections: string[] = [];

  sections.push('# 需求澄清与影响分析');
  sections.push('');
  sections.push('## 用户输入');
  sections.push(`原始描述: ${desc}`);
  sections.push('');

  // 附件内容
  if (files.length > 0) {
    sections.push('## 附件内容');
    for (const f of files) {
      if (f.type === 'image') {
        sections.push(`### ${f.name}`);
        sections.push(`[图片: ${f.path}]`);
      } else {
        sections.push(`### ${f.name}`);
        sections.push(f.content.slice(0, 5000));
        if (f.content.length > 5000) {
          sections.push(`... (内容截断，共 ${f.content.length} 字符)`);
        }
      }
      sections.push('');
    }
  }

  // 现有任务详细上下文
  if (taskDetails.length > 0) {
    sections.push('## 现有任务详情');
    for (const t of taskDetails) {
      sections.push(`### ${t.id}: ${t.name}`);
      sections.push(`- 状态: ${t.status}`);
      if (t.reqSummary) sections.push(`- 需求摘要: ${t.reqSummary}`);
      if (t.techSummary) sections.push(`- 技术方案摘要: ${t.techSummary}`);
      if (t.dependencies.length > 0) sections.push(`- 依赖: ${t.dependencies.join(', ')}`);
      sections.push('');
    }
  }

  // 输出要求
  sections.push('## 请分析并输出 JSON:');
  sections.push('```json');
  sections.push('{');
  sections.push('  "intent": "change | new",');
  sections.push('  "structuredDesc": "结构化需求描述",');
  sections.push('  "keyPoints": ["要点1", "要点2"],');
  sections.push('  "acceptanceCriteria": ["验收标准1", "验收标准2"],');
  sections.push('  "impactReport": {');
  sections.push('    "directTasks": [{ "id": "Task-003", "reason": "密码规则在该任务中定义", "affectedFiles": ["REQ.md", "TECH.md"] }],');
  sections.push('    "indirectTasks": [{ "id": "Task-005", "reason": "依赖 Task-003 的密码校验逻辑" }],');
  sections.push('    "unaffectedTasks": ["Task-001", "Task-002"]');
  sections.push('  },');
  sections.push('  "suggestedActions": ["修改 Task-003 密码字段定义", "回归测试 Task-005 登录流程"]');
  sections.push('}');
  sections.push('```');

  return sections.join('\n');
}

/** 解析澄清响应的返回类型 */
export interface ClarifyResult {
  intent: 'change' | 'new';
  structuredDesc: string;
  keyPoints: string[];
  acceptanceCriteria: string[];
  impactReport: {
    directTasks: { id: string; reason: string; affectedFiles: string[] }[];
    indirectTasks: { id: string; reason: string }[];
    unaffectedTasks: string[];
  };
  suggestedActions: string[];
}

/**
 * 解析澄清响应（AI 返回的 JSON）
 */
export function parseClarifyResponse(response: string): ClarifyResult | null {
  try {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * 格式化澄清结果为终端展示（含结构化影响范围）
 */
export function logClarifyResult(result: ClarifyResult): void {
  logger.info('');
  logger.info('📋 需求澄清结果:');
  logger.info('┌─────────────────────────────────────┐');
  logger.info(`│ 意图: ${result.intent === 'new' ? '🆕 新增（全新功能）' : '🔄 变更（修改已有需求）'}`);
  logger.info(`│ 结构化描述: ${result.structuredDesc}`);

  if (result.keyPoints.length > 0) {
    logger.info('│ 功能要点:');
    for (const p of result.keyPoints) {
      logger.info(`│   • ${p}`);
    }
  }

  if (result.acceptanceCriteria.length > 0) {
    logger.info('│ 验收标准:');
    for (const c of result.acceptanceCriteria) {
      logger.info(`│   ✓ ${c}`);
    }
  }

  logger.info('│');

  // 结构化影响范围
  if (result.impactReport) {
    const { directTasks, indirectTasks, unaffectedTasks } = result.impactReport;

    if (directTasks.length > 0) {
      logger.info('│ 🔴 直接影响（需修改 Spec + 重新执行）:');
      for (const t of directTasks) {
        const files = t.affectedFiles?.length ? ` [${t.affectedFiles.join(', ')}]` : '';
        logger.info(`│   ${t.id}${files} — ${t.reason}`);
      }
    }

    if (indirectTasks.length > 0) {
      logger.info('│ 🟡 间接影响（需回归验证）:');
      for (const t of indirectTasks) {
        logger.info(`│   ${t.id} — ${t.reason}`);
      }
    }

    if (unaffectedTasks.length > 0) {
      logger.info(`│ 🟢 无影响: ${unaffectedTasks.join(', ')}`);
    }
  }

  if (result.suggestedActions?.length > 0) {
    logger.info('│ 建议操作:');
    for (const a of result.suggestedActions) {
      logger.info(`│   → ${a}`);
    }
  }

  logger.info('└─────────────────────────────────────┘');
}

/**
 * 格式化影响分析报告为终端展示（本地分析结果）
 */
export function logImpactReport(report: ImpactReport): void {
  logger.info('');
  logger.info('📋 影响范围分析:');
  logger.info('┌─────────────────────────────────────┐');

  if (report.directTasks.length > 0) {
    logger.info('│ 🔴 直接影响（需修改 Spec + 重新执行）:');
    for (const t of report.directTasks) {
      const statusTag = t.status === 'done' ? ' [done→needs-rework]' : ` [${t.status}]`;
      logger.info(`│   ${t.id} ${t.name}${statusTag}`);
      logger.info(`│     ${t.reason}`);
      if (t.affectedFiles.length > 0) {
        logger.info(`│     受影响文件: ${t.affectedFiles.join(', ')}`);
      }
    }
  }

  if (report.indirectTasks.length > 0) {
    logger.info('│');
    logger.info('│ 🟡 间接影响（需回归验证）:');
    for (const t of report.indirectTasks) {
      const statusTag = t.status === 'done' ? ' [需回归测试]' : ` [${t.status}]`;
      logger.info(`│   ${t.id} ${t.name}${statusTag}`);
      logger.info(`│     ${t.reason}`);
    }
  }

  if (report.unaffectedTasks.length > 0) {
    logger.info('│');
    logger.info(`│ 🟢 无影响: ${report.unaffectedTasks.map(t => t.id).join(', ')}`);
  }

  logger.info('└─────────────────────────────────────┘');
}
