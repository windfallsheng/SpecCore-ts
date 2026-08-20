/**
 * prompt-builder — 统一的 Spec → AI Prompt 构建引擎
 * 
 * CLI 不自己生成内容，而是读取 Spec 上下文，构建结构化 Prompt 输出到 stdout。
 * Skill/宿主 AI 捕获 stdout，解析 Prompt，调用 AI 生成内容后，由 CLI --apply 写回。
 * 
 * 架构: CLI(确定性) → stdout(Prompt) → AI(生成) → CLI(确定性写入)
 */
import { readFile, pathExists, readdir, stat } from 'fs-extra';
import { join, dirname } from 'path';
import { isTimestampBackup } from '../utils/task-utils';
import { logger } from '../utils/logger';
import { loadKnowledgeGraph, getTaskContext, isGraphStale, refreshKnowledgeGraph, KnowledgeGraph } from './knowledge-graph';
import { buildCompactContext } from './context-builder';
import { parseProjectInfo } from './spec-paths';
import {
  loadRagIndex, isRagIndexStale, retrieveRelevantChunks,
  assembleChunksForPrompt, indexTaskDocuments,
} from './rag-engine';
import { unifiedSearch, assembleUnifiedContext } from './unified-retrieval';
// v6.85.0+: RULES 规范库注入
import { resolveRulesForTechStack, formatRulesPrompt } from './rule-loader';
// v6.86.0+: AGENTS 全阶段扩展
import { resolveAgentsForPhase } from './agents';
import type { AgentContext } from './agents';

// ═══════════════════════════════════════════════════════════
// 进程级缓存（避免重复 I/O + 重复解析）
// ═══════════════════════════════════════════════════════════

interface CacheEntry<T> {
  data: T;
  mtime: number;
  key: string;
}

const techStackCache = new Map<string, CacheEntry<TechStack>>();
const constitutionCache = new Map<string, CacheEntry<string>>();
const reqContentCache = new Map<string, CacheEntry<string>>();
const tocCache = new Map<string, CacheEntry<TOCEntry[]>>();

/** 通用文件缓存读取 */
async function cachedRead<T>(
  cache: Map<string, CacheEntry<T>>,
  filePath: string,
  loader: () => Promise<T>,
): Promise<T> {
  try {
    const st = await stat(filePath);
    const cached = cache.get(filePath);
    if (cached && cached.mtime >= st.mtimeMs) {
      return cached.data;
    }
    const data = await loader();
    cache.set(filePath, { data, mtime: st.mtimeMs, key: filePath });
    return data;
  } catch {
    // 文件不存在时直接加载（不缓存）
    return loader();
  }
}

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

/** Prompt 类型 */
export type PromptCommand = 'execute' | 'analyze' | 'split' | 'plan';

/** 技术栈信息 */
export interface TechStack {
  language?: string;
  framework?: string;
  database?: string;
  cache?: string;
  frontend?: string;
}

/** API 接口定义 */
export interface ApiSpec {
  method: string;
  path: string;
  description: string;
  requestBody?: string;
  responseBody?: string;
}

/** 数据模型 */
export interface DataModel {
  name: string;
  table?: string;
  fields: { name: string; type: string; description: string }[];
}

/** 业务规则 */
export interface BusinessRule {
  rule: string;
  condition?: string;
}

/** 任务额外上下文文件 */
export interface TaskExtraSpec {
  name: string;
  path: string;
  content: string;
}

/** 全局知识库目录条目 */
export interface TOCEntry {
  /** 文件相对路径（如 synthesis/ARCHITECTURE.md） */
  path: string;
  /** 文件简述 */
  description: string;
  /** ## 标题列表 */
  sections: string[];
  /** 首段摘要（标题后第一段非空内容，≤200字） */
  summary?: string;
  /** 涉及的端列表（从路径/内容推断） */
  platforms?: string[];
  /** 文件行数（AI 判断阅读成本） */
  lineCount?: number;
  /** 关键词标签（从 ## 标题提取核心词） */
  tags?: string[];
}

/** 全局上下文（从 GLOBAL 层注入） */
export interface GlobalContext {
  /** 全局索引摘要（INDEX.md 全文，必读） */
  indexSummary?: string;
  /** 全局知识库目录（AI 按需 Read） */
  toc: TOCEntry[];
}

/** SpecCore 结构化 Prompt */
export interface SpecCorePrompt {
  marker: '[SPECCORE_PROMPT]';
  version: string;
  command: PromptCommand;
  iteration: string;
  task?: string;
  platform?: string;
  techStack: TechStack;
  apiSpecs: ApiSpec[];
  dataModels: DataModel[];
  businessRules: BusinessRule[];
  extraSpecs: TaskExtraSpec[];
  globalContext?: GlobalContext;
  taskContext?: string;  // 知识图谱：当前任务的关联链
  projectPaths?: string; // v6.49.6+：工程路径信息（用于 execute 命令）
  rulesContent?: string; // v6.85.0+: 编码规范注入
  instruction: string;
  outputHint: string;
}

// ═══════════════════════════════════════════════════════════
// 上下文加载
// ═══════════════════════════════════════════════════════════

/**
 * 从 CONSTITUTION.md 解析技术栈（带进程缓存）
 */
async function loadTechStack(cwd: string): Promise<TechStack> {
  const constitutionPath = join(cwd, '.speccore', 'CONSTITUTION.md');
  if (!await pathExists(constitutionPath)) return {};

  return cachedRead(techStackCache, constitutionPath, async () => {
    const content = await readFile(constitutionPath, 'utf-8');
    const stack: TechStack = {};

    // 解析技术栈章节
    const techSection = content.match(/##\s*技术栈[\s\S]*?(?=## |$)/i);
    if (techSection) {
      const section = techSection[0];
      const langMatch = section.match(/语言[：:]\s*(.+)/i);
      if (langMatch) stack.language = langMatch[1].trim();
      const frameworkMatch = section.match(/框架[：:]\s*(.+)/i);
      if (frameworkMatch) stack.framework = frameworkMatch[1].trim();
      const dbMatch = section.match(/数据库[：:]\s*(.+)/i);
      if (dbMatch) stack.database = dbMatch[1].trim();
      const cacheMatch = section.match(/缓存[：:]\s*(.+)/i);
      if (cacheMatch) stack.cache = cacheMatch[1].trim();
    }

    return stack;
  });
}

/**
 * 定位 REQ.md 实际路径（支持新旧结构）
 */
async function resolveReqPath(cwd: string, taskDir: string): Promise<string | null> {
  const paths = [
    join(cwd, taskDir, '_shared', 'REQ.md'),
    join(cwd, taskDir, '00-specs', 'REQ.md'),
    join(cwd, taskDir, 'REQ.md'),
  ];
  for (const p of paths) {
    if (await pathExists(p)) return p;
  }
  return null;
}

/**
 * 加载 REQ.md 内容（带进程缓存）
 */
async function loadReqContent(cwd: string, taskDir: string): Promise<string | null> {
  const reqPath = await resolveReqPath(cwd, taskDir);
  if (!reqPath) return null;

  return cachedRead(reqContentCache, reqPath, async () => {
    return await readFile(reqPath, 'utf-8');
  });
}

/**
 * 从 REQ.md 解析 API 定义（支持传入已读取的内容，避免重复 I/O）
 */
async function loadApiSpecs(cwd: string, taskDir: string, reqContent?: string): Promise<ApiSpec[]> {
  const content = reqContent ?? await loadReqContent(cwd, taskDir);
  if (!content) return [];

  const apis: ApiSpec[] = [];

  // 解析 API 表格: | 方法 | 路径 | 说明 | 或 | Method | Path | Description |
  const tableRegex = /\|.*(?:方法|Method).*\|.*(?:路径|Path).*\|.*(?:说明|Description).*\|.*/i;
  const tableMatch = content.match(tableRegex);
  if (tableMatch) {
    const startIdx = content.indexOf(tableMatch[0]);
    const afterTable = content.substring(startIdx);
    const lines = afterTable.split('\n');
    for (let i = 2; i < lines.length; i++) { // 跳过表头和分隔线
      const line = lines[i].trim();
      if (!line.startsWith('|')) break;
      const cols = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length >= 3) {
        apis.push({
          method: cols[0],
          path: cols[1],
          description: cols[2] || '',
        });
      }
    }
  }

  return apis;
}

/**
 * 从 REQ.md 解析数据模型（支持传入已读取的内容）
 */
async function loadDataModels(cwd: string, taskDir: string, reqContent?: string): Promise<DataModel[]> {
  const content = reqContent ?? await loadReqContent(cwd, taskDir);
  if (!content) return [];

  const models: DataModel[] = [];

  // 查找所有数据模型表格
  const modelSection = content.match(/(?:数据模型|实体|Entity|Model)[\s\S]*?(?=## |\n##|$)/i);
  if (modelSection) {
    const section = modelSection[0];
    // 解析字段表格: | 字段 | 类型 | 说明 |
    const fieldTableRegex = /\|.*字段.*\|.*类型.*\|.*说明.*\|/gi;
    let match;
    let currentModel: DataModel | null = null;

    const lines = section.split('\n');
    for (let i = 0; i < lines.length; i++) {
      // 检测模型名称（### 标题 或 **粗体**）
      const headingMatch = lines[i].match(/^#{2,4}\s*(.+)/);
      const boldMatch = lines[i].match(/\*\*(.+?)\*\*/);
      if (headingMatch || boldMatch) {
        const name = (headingMatch || boldMatch)![1];
        if (currentModel && currentModel.fields.length > 0) {
          models.push(currentModel);
        }
        currentModel = { name, fields: [] };
      }

      // 解析字段行
      if (currentModel && lines[i].startsWith('|') && !lines[i].includes('---') && !lines[i].includes('字段')) {
        const cols = lines[i].split('|').map(c => c.trim()).filter(Boolean);
        if (cols.length >= 3) {
          currentModel.fields.push({
            name: cols[0],
            type: cols[1],
            description: cols[2] || '',
          });
        }
      }
    }
    if (currentModel && currentModel.fields.length > 0) {
      models.push(currentModel);
    }
  }

  return models;
}

/**
 * 从 CONSTITUTION.md + REQ.md 提取业务规则（支持传入已读取的 REQ 内容）
 */
async function loadBusinessRules(cwd: string, taskDir?: string, reqContent?: string): Promise<BusinessRule[]> {
  const rules: BusinessRule[] = [];

  // 从 CONSTITUTION 读取命名规范等（带缓存）
  const constitutionPath = join(cwd, '.speccore', 'CONSTITUTION.md');
  if (await pathExists(constitutionPath)) {
    const content = await cachedRead(constitutionCache, constitutionPath, async () => await readFile(constitutionPath, 'utf-8'));
    const namingSection = content.match(/##\s*命名规范[\s\S]*?(?=## |$)/i);
    if (namingSection) {
      const lines = namingSection[0].split('\n');
      for (const line of lines) {
        if (line.match(/^[-*]\s+(.+)/)) {
          rules.push({ rule: RegExp.$1.trim() });
        }
      }
    }
  }

  if (taskDir) {
    const content = reqContent ?? await loadReqContent(cwd, taskDir);
    if (content) {
      const ruleSection = content.match(/(?:业务规则|约束条件|Constraint)[\s\S]*?(?=## |\n##|$)/i);
      if (ruleSection) {
        const lines = ruleSection[0].split('\n');
        for (const line of lines) {
          if (line.match(/^[-*]\s+(.+)/)) {
            rules.push({ rule: RegExp.$1.trim() });
          }
        }
      }
    }
  }

  return rules;
}

/**
 * 读取任务目录中的额外上下文文件（TECH.md / TASK.md / SCHEMA.md / .issues.md 等）
 * 带大小限制，防止 prompt 爆炸
 */
async function loadExtraSpecs(
  cwd: string, taskDir: string, platform?: string, iteration?: string,
  options?: { maxCharsPerFile?: number; maxTotalChars?: number },
): Promise<TaskExtraSpec[]> {
  const extras: TaskExtraSpec[] = [];
  const MAX_PER_FILE = options?.maxCharsPerFile ?? 2000;
  const MAX_TOTAL = options?.maxTotalChars ?? 8000;
  let totalChars = 0;

  const files = [
    { name: '任务上下文', path: '_shared/CONTEXT.md' },
    { name: '技术方案', path: '00-specs/TECH.md' },
    { name: '技术方案(旧)', path: '_shared/TECH.md' },
    { name: '需求规格', path: '00-specs/REQ.md' },
    { name: '需求规格(旧)', path: '_shared/REQ.md' },
    { name: '数据库设计', path: '00-specs/SCHEMA.md' },
    { name: '数据库设计(旧)', path: '_shared/SCHEMA.md' },
    { name: 'API 契约', path: '_shared/API_CONTRACT.yaml' },
    { name: '已知问题', path: '.issues.md' },
  ];

  // 加载迭代级设计文档（020-specs/）—— 填补迭代层上下文断裂
  if (iteration) {
    const iterDir = join(cwd, `Iteration-${iteration}`);
    files.push(
      { name: '迭代设计文档', path: join(iterDir, '020-specs', 'DESIGN.md') },
    );
    if (platform) {
      // 迭代级各端规格文档
      const platSpecDir = join(iterDir, '020-specs', 'platforms', platform);
      // 动态扫描该端的 spec 文件（在调用时处理）
      files.push(
        { name: `${platform}端迭代规格`, path: join(platSpecDir, 'SPEC.md') },
      );
    }
  }

  // v6.49.9+: 按端执行时，加载该端的子任务文件（新结构: {platform}/{subtask}/）
  if (platform) {
    const platformBase = join(cwd, taskDir, platform);
    // 动态扫描子任务目录
    let subtaskDirsList: string[] = [];
    try {
      if (await pathExists(platformBase)) {
        const entries = await readdir(platformBase, { withFileTypes: true });
        subtaskDirsList = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);
      }
    } catch { /* 跳过 */ }
    // 加载第一个子任务的 TASK.md（作为主要上下文）
    if (subtaskDirsList.length > 0) {
      const firstSub = subtaskDirsList[0];
      files.unshift(
        { name: `${platform}端子任务`, path: join(platform, firstSub, 'TASK.md') },
      );
      const isBackend = platform === 'backend' || platform.startsWith('后台') || /-(service|api|server|backend)$/i.test(platform);
      if (!isBackend) {
        files.unshift(
          { name: `${platform}端组件树`, path: join(platform, firstSub, 'COMPONENT_TREE.md') },
          { name: `${platform}端路由`, path: join(platform, firstSub, 'ROUTES.md') },
          { name: `${platform}端状态管理`, path: join(platform, firstSub, 'STATE.md') },
        );
      }
    }
    // 回退: 旧结构 10-backend/{服务}/ 或 20-frontend/{端}/
    const isBk = platform === 'backend' || platform.startsWith('后台');
    const categoryDir = isBk ? '10-backend' : '20-frontend';
    const serviceName = isBk && platform === 'backend' ? 'api' : platform;
    const legacyBase = join(cwd, taskDir, categoryDir, serviceName);
    if (subtaskDirsList.length === 0) {
      try {
        if (await pathExists(legacyBase)) {
          const entries = await readdir(legacyBase, { withFileTypes: true });
          const legacySubs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);
          if (legacySubs.length > 0) {
            files.unshift(
              { name: `${platform}端子任务(旧)`, path: join(categoryDir, serviceName, legacySubs[0], 'TASK.md') },
            );
          }
        }
      } catch { /* ignore */ }
    }
  }

  for (const f of files) {
    const fullPath = join(cwd, taskDir, f.path);
    if (await pathExists(fullPath)) {
      let content = await readFile(fullPath, 'utf-8');
      // 跳过空文件或纯占位符文件
      if (content.trim().length <= 50 || content.trim().match(/^#+\s*待填充|^<!--\s*AI-FILL\s*-->$/m)) {
        continue;
      }
      // 单文件大小限制
      if (content.length > MAX_PER_FILE) {
        content = content.slice(0, MAX_PER_FILE) + `\n\n> ... (已截断，原文件 ${content.length} 字)`;
      }
      // 总大小限制
      if (totalChars + content.length > MAX_TOTAL) {
        const remain = MAX_TOTAL - totalChars;
        if (remain > 200) {
          content = content.slice(0, remain) + `\n\n> ... (已达总上限 ${MAX_TOTAL} 字)`;
          extras.push({ name: f.name, path: f.path, content });
        }
        break; // 总大小超限，停止加载更多文件
      }
      totalChars += content.length;
      extras.push({ name: f.name, path: f.path, content });
    }
  }

  return extras;
}

// ═══════════════════════════════════════════════════════════
// 全量兜底读取（检索不足时，读取所有内容）
// ═══════════════════════════════════════════════════════════

/** 全量兜底：当统一检索结果不足时，读取任务目录 + 迭代规格 + 关联任务的所有内容 */
async function loadAllTaskContext(
  cwd: string, taskDir: string, platform?: string, iteration?: string,
  graph?: KnowledgeGraph | null,
): Promise<TaskExtraSpec[]> {
  const extras: TaskExtraSpec[] = [];
  const MAX_PER_FILE = 8000;
  const MAX_TOTAL = 20000;
  let totalChars = 0;
  const seen = new Set<string>();

  const addFile = async (fullPath: string, name: string, relPath: string) => {
    if (seen.has(fullPath)) return;
    seen.add(fullPath);
    if (!(await pathExists(fullPath))) return;
    let content = await readFile(fullPath, 'utf-8');
    if (content.trim().length <= 50 || content.trim().match(/^#+\s*待填充|^<!--\s*AI-FILL\s*-->$/m)) return;
    if (content.length > MAX_PER_FILE) {
      content = content.slice(0, MAX_PER_FILE) + `\n\n> ... (已截断，原文件 ${content.length} 字)`;
    }
    if (totalChars + content.length > MAX_TOTAL) return;
    totalChars += content.length;
    extras.push({ name, path: relPath, content });
  };

  // 1. 递归扫描任务目录所有 .md / .yaml 文件
  // 排除自检/审查/产出阶段文件（这些在代码生成后的 verify 阶段才需要）
  // 排除整个 10-backend/ 和 20-frontend/ 旧大类目录 + 00-specs/ _shared/ 等非代码目录
  const CODEGEN_EXCLUDE_DIRS = new Set(['node_modules', '10-backend', '20-frontend', '00-specs', '_shared', '99-artifacts', '.meta']);
  const CODEGEN_EXCLUDE_FILES = new Set(['test.md', 'schema.md', 'review.md', 'changelog.md', 'deploy.md', '.issues.md']);
  const scanTaskDir = async (dir: string, prefix: string) => {
    if (!(await pathExists(dir))) return;
    try {
      const items = await readdir(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith('.') || isTimestampBackup(item.name)) continue;
        const fullPath = join(dir, item.name);
        if (item.isDirectory()) {
          if (CODEGEN_EXCLUDE_DIRS.has(item.name)) continue;
          await scanTaskDir(fullPath, `${prefix}${item.name}/`);
        } else if (/\.(md|yaml|yml)$/i.test(item.name)) {
          // 排除自检阶段文件（TEST.md / SCHEMA.md / REVIEW.md 等）
          if (CODEGEN_EXCLUDE_FILES.has(item.name.toLowerCase())) continue;
          await addFile(fullPath, `${prefix}${item.name}`, `${prefix}${item.name}`);
        }
      }
    } catch { /* 跳过 */ }
  };
  await scanTaskDir(taskDir, '');

  // 2. 迭代规格 020-specs/ 所有 .md（含 global/ 子目录）
  if (iteration) {
    const iterDir = join(cwd, `Iteration-${iteration}`);
    const specsDir = join(iterDir, '020-specs');
    if (await pathExists(specsDir)) {
      try {
        // 2a. 根目录下的 .md（TECH.md、TEST.md 等端无关模板）
        const items = await readdir(specsDir, { withFileTypes: true });
        for (const item of items) {
          if (!item.name.endsWith('.md') || isTimestampBackup(item.name)) continue;
          await addFile(join(specsDir, item.name), `迭代规格: ${item.name}`, `020-specs/${item.name}`);
        }
        // 2b. global/ 子目录下的全局文档（v6.41.0+）
        const globalDir = join(specsDir, 'global');
        if (await pathExists(globalDir)) {
          const globalItems = await readdir(globalDir, { withFileTypes: true });
          for (const item of globalItems) {
            if (!item.name.endsWith('.md') || isTimestampBackup(item.name)) continue;
            await addFile(join(globalDir, item.name), `迭代综合规格: ${item.name}`, `020-specs/overview/${item.name}`);
          }
        }
        // 各端规格（新路径 020-specs/{端}/，兼容旧路径 020-specs/platforms/{端}/）
        if (platform) {
          let platDir = join(specsDir, platform);
          if (!(await pathExists(platDir))) {
            platDir = join(specsDir, 'platforms', platform);
          }
          if (await pathExists(platDir)) {
            const platItems = await readdir(platDir, { withFileTypes: true });
            for (const item of platItems) {
              if (!item.name.endsWith('.md') || isTimestampBackup(item.name)) continue;
              await addFile(join(platDir, item.name), `${platform}端规格: ${item.name}`, `020-specs/${platform}/${item.name}`);
            }
          }
        }
        // features/ 规格
        const featuresDir = join(specsDir, 'features');
        if (await pathExists(featuresDir)) {
          const featItems = await readdir(featuresDir, { withFileTypes: true });
          for (const item of featItems) {
            if (!item.name.endsWith('.md') || isTimestampBackup(item.name)) continue;
            await addFile(join(featuresDir, item.name), `功能规格: ${item.name}`, `020-specs/features/${item.name}`);
          }
        }
      } catch { /* 跳过 */ }
    }
  }

  // 3. 关联任务的 00-specs/（从知识图谱获取依赖任务）
  if (graph) {
    const relatedIds: string[] = [];
    for (const rel of graph.relations) {
      if (rel.type === 'depends_on' || rel.type === 'subtask_of') {
        relatedIds.push(rel.from, rel.to);
      }
    }
    const uniqueRelated = [...new Set(relatedIds)];
    if (iteration && uniqueRelated.length > 0) {
      const iterDir = join(cwd, `Iteration-${iteration}`);
      const tasksDir = join(iterDir, '030-tasks');
      for (const relId of uniqueRelated.slice(0, 3)) {
        const relTaskDir = join(tasksDir, relId, '00-specs');
        if (await pathExists(relTaskDir)) {
          try {
            const relItems = await readdir(relTaskDir, { withFileTypes: true });
            for (const item of relItems) {
              if (!item.name.endsWith('.md') || isTimestampBackup(item.name)) continue;
              await addFile(join(relTaskDir, item.name), `关联任务 ${relId}: ${item.name}`, `030-tasks/${relId}/00-specs/${item.name}`);
            }
          } catch { /* 跳过 */ }
        }
      }
    }
  }

  return extras;
}

// ═══════════════════════════════════════════════════════════
// 全局上下文加载（目录索引 + AI 自主读取）
// ═══════════════════════════════════════════════════════════

/** 文件描述映射 */
const FILE_DESC: Record<string, string> = {
  'ARCHITECTURE.md': '全量系统架构',
  'TECH_FULL.md': '全量技术方案',
  'CROSS_PLATFORM.md': '跨端业务关系',
  'GLOSSARY.md': '术语定义表',
};

/** 规则文件描述 */
const RULES_DESC: Record<string, string> = {
  'CODE_REVIEW.md': '代码审查规则',
  'POST_COMPLETION.md': '任务完成检查清单',
};

/**
 * 从 Markdown 文件中提取 ## 标题行
 */
function extractHeadings(content: string): string[] {
  const headings: string[] = [];
  for (const line of content.split('\n')) {
    if (line.startsWith('## ')) {
      headings.push(line.replace(/^##\s+/, '').trim());
    }
  }
  return headings;
}

/**
 * 提取首段摘要：# 标题后的第一段非空内容，≤ 200 字
 */
function extractSummary(content: string): string {
  const lines = content.split('\n');
  let foundTitle = false;
  let summaryLines: string[] = [];
  let totalLen = 0;

  for (const line of lines) {
    if (line.startsWith('# ') && !foundTitle) {
      foundTitle = true;
      continue;
    }
    if (!foundTitle) continue;
    // 遇到下一个 ## 就停
    if (line.startsWith('## ')) break;
    // 跳过空行和分隔线
    if (!line.trim() || line.startsWith('---') || line.startsWith('```')) continue;
    // 跳过表格头、图片、HTML 注释
    if (line.startsWith('|') || line.startsWith('![') || line.startsWith('<!--')) continue;

    summaryLines.push(line.trim());
    totalLen += line.trim().length;
    if (totalLen >= 200) break;
  }

  const result = summaryLines.join(' ');
  return result.length > 200 ? result.slice(0, 197) + '...' : result;
}

/**
 * 从路径和内容推断涉及的端
 */
function extractPlatforms(path: string, content: string): string[] {
  const platforms = new Set<string>();
  const knownPlatforms = ['backend', 'admin', 'h5', 'miniapp', 'app', 'web', 'ios', 'android'];

  // 从路径推断
  for (const p of knownPlatforms) {
    if (path.toLowerCase().includes(p)) {
      platforms.add(p);
    }
  }
  // platforms/{端名}/ 路径
  const platMatch = path.match(/^platforms\/([^/]+)\//);
  if (platMatch) {
    platforms.add(platMatch[1].toLowerCase());
  }

  // 从内容中扫描（前 2000 字）
  const head = content.slice(0, 2000).toLowerCase();
  for (const p of knownPlatforms) {
    if (head.includes(p)) {
      platforms.add(p);
    }
  }

  return Array.from(platforms);
}

/**
 * 从 ## 标题提取关键词标签（去停用词，取核心名词）
 */
function extractTags(headings: string[]): string[] {
  const stopWords = new Set([
    '的', '与', '和', '及', '在', '中', '对', '为', '是', '有', '从', '到',
    'of', 'the', 'and', 'or', 'in', 'for', 'to', 'from', 'with', 'by',
    '概述', '说明', '介绍', '详情', '附录', '参考', '其他', '更多',
  ]);

  const tags = new Set<string>();
  for (const h of headings) {
    // 去掉编号前缀（如 "1. ", "2.1 "）
    const cleaned = h.replace(/^\d+(\.\d+)*\.?\s*/, '').trim();
    // 按常见分隔符拆分
    const parts = cleaned.split(/[、，,；;\/\|]/).map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      if (part.length <= 1 || stopWords.has(part.toLowerCase())) continue;
      if (part.length > 12) continue; // 太长的不要
      tags.add(part);
    }
    // 整个标题也作为一个 tag（如果不长）
    if (cleaned.length <= 10 && !stopWords.has(cleaned.toLowerCase())) {
      tags.add(cleaned);
    }
  }
  return Array.from(tags).slice(0, 10); // 最多 10 个
}

/**
 * 构建单个 TOC 条目（含摘要/端/行数/标签）
 */
function buildTOCEntry(path: string, description: string, content: string, maxSections?: number): TOCEntry {
  const sections = extractHeadings(content);
  return {
    path,
    description,
    sections: maxSections ? sections.slice(0, maxSections) : sections,
    summary: extractSummary(content) || undefined,
    platforms: extractPlatforms(path, content) || undefined,
    lineCount: content.split('\n').length,
    tags: extractTags(sections) || undefined,
  };
}

/**
 * 构建全局知识库目录（TOC）
 * 只读 ## 标题行 + 摘要/端/行数/标签，非常轻量
 */
async function buildGlobalTOC(globalDir: string): Promise<TOCEntry[]> {
  const toc: TOCEntry[] = [];
  const speccoreDir = join(globalDir, '..'); // .speccore/

  // 1. synthesis/ 下的综合文档
  const synthesisDir = join(globalDir, 'synthesis');
  if (await pathExists(synthesisDir)) {
    const files = await readdir(synthesisDir);
    for (const f of files.filter(f => f.endsWith('.md') && !isTimestampBackup(f))) {
      const content = await readFile(join(synthesisDir, f), 'utf-8');
      toc.push(buildTOCEntry(`synthesis/${f}`, FILE_DESC[f] || f.replace('.md', ''), content));
    }
  }

  // 2. platforms/ 下各端文档
  const platformsDir = join(globalDir, 'platforms');
  if (await pathExists(platformsDir)) {
    const entries = await readdir(platformsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const platformName = entry.name;
      const subFiles = await readdir(join(platformsDir, platformName));
      for (const f of subFiles.filter(f => f.endsWith('.md') && !isTimestampBackup(f))) {
        const content = await readFile(join(platformsDir, platformName, f), 'utf-8');
        toc.push(buildTOCEntry(`platforms/${platformName}/${f}`, `${platformName} 端 — ${f.replace('.md', '')}`, content));
      }
    }
  }

  // 3. PROJECTS/ 下各工程文档
  const projectsDir = join(globalDir, 'PROJECTS');
  if (await pathExists(projectsDir)) {
    const entries = await readdir(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      const projectName = entry.name;
      const subFiles = await readdir(join(projectsDir, projectName));
      for (const f of subFiles.filter(f => f.endsWith('.md') && !isTimestampBackup(f))) {
        const content = await readFile(join(projectsDir, projectName, f), 'utf-8');
        toc.push(buildTOCEntry(`PROJECTS/${projectName}/${f}`, `${projectName} — ${f.replace('.md', '')}`, content));
      }
    }
  }

  // 4. GLOBAL/ 下扁平文件（排除 INDEX.md 和已有子目录的文件）
  const globalFiles = await readdir(globalDir);
  for (const f of globalFiles.filter(f => {
    if (!f.endsWith('.md') || isTimestampBackup(f)) return false;
    if (f === 'INDEX.md') return false; // 必读，已单独注入
    return true;
  })) {
    const content = await readFile(join(globalDir, f), 'utf-8');
    toc.push(buildTOCEntry(`GLOBAL:${f}`, FILE_DESC[f] || f.replace('.md', ''), content));
  }

  // 5. PATTERNS/ 可复用模式（含 TEMPLATES/ 写作模板）
  const patternsDir = join(speccoreDir, 'PATTERNS');
  if (await pathExists(patternsDir)) {
    const scanPatterns = async (dir: string, prefix: string) => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await scanPatterns(join(dir, entry.name), `${prefix}${entry.name}/`);
        } else if (entry.name.endsWith('.md')) {
          const content = await readFile(join(dir, entry.name), 'utf-8');
          const isTemplate = prefix.startsWith('TEMPLATES/');
          const label = isTemplate
            ? entry.name.replace('-template.md', '').toUpperCase() + ' 写作模板'
            : (prefix ? prefix.slice(0, -1).replace(/\//g, ' › ') + ' › ' : '') + entry.name.replace('.md', '');
          toc.push(buildTOCEntry(`PATTERNS:${prefix}${entry.name}`, label, content, isTemplate ? 6 : 4));
        }
      }
    };
    await scanPatterns(patternsDir, '');
  }

  // 6. RULES/ 规则文件
  const rulesDir = join(speccoreDir, 'RULES');
  if (await pathExists(rulesDir)) {
    const files = await readdir(rulesDir);
    for (const f of files.filter(f => f.endsWith('.md') && !isTimestampBackup(f))) {
      const content = await readFile(join(rulesDir, f), 'utf-8');
      toc.push(buildTOCEntry(`RULES:${f}`, RULES_DESC[f] || f.replace('.md', ''), content));
    }
  }

  return toc;
}

/**
 * 加载全局上下文（带 TOC 缓存）
 * 策略：必读的 INDEX.md 直接注入 + 其余文件只给目录，AI 自己 Read
 */
export async function loadGlobalContext(
  cwd: string,
  _command: PromptCommand,
  _platform?: string
): Promise<GlobalContext> {
  const globalDir = join(cwd, '.speccore', 'GLOBAL');
  const ctx: GlobalContext = { toc: [] };

  if (!await pathExists(globalDir)) return ctx;

  // 必读：INDEX.md 直接注入（带缓存）
  const indexPath = join(globalDir, 'INDEX.md');
  if (await pathExists(indexPath)) {
    const content = await cachedRead(constitutionCache, indexPath, async () => await readFile(indexPath, 'utf-8'));
    ctx.indexSummary = content.slice(0, 1500);
  }

  // 其余：只给目录，AI 自己决定读什么（带缓存）
  const cached = tocCache.get(globalDir);
  if (cached) {
    ctx.toc = cached.data;
  } else {
    ctx.toc = await buildGlobalTOC(globalDir);
    tocCache.set(globalDir, { data: ctx.toc, mtime: Date.now(), key: globalDir });
  }

  return ctx;
}

/**
 * 格式化单个 TOC 条目（含摘要/端/行数/标签）
 * @param indent 缩进空格数（0/2）
 */
function formatTOCEntry(e: TOCEntry, indent: number): string {
  const pad = ' '.repeat(indent);
  const displayPath = e.path.replace(/^(GLOBAL:|PATTERNS:|RULES:)/, '');
  const lineCountStr = e.lineCount ? ` [~${e.lineCount}行]` : '';
  const lines: string[] = [];

  // 第一行：路径 + 描述 + 行数
  lines.push(`${pad}- \`${displayPath}\` — ${e.description}${lineCountStr}`);

  // 标签
  if (e.tags && e.tags.length > 0) {
    lines.push(`${pad}  🏷 ${e.tags.join(', ')}`);
  }

  // 涉及端
  if (e.platforms && e.platforms.length > 0) {
    lines.push(`${pad}  📱 ${e.platforms.join(', ')}`);
  }

  // 摘要
  if (e.summary) {
    lines.push(`${pad}  📝 ${e.summary}`);
  }

  // 章节
  if (e.sections.length > 0) {
    lines.push(`${pad}  章节: ${e.sections.slice(0, 8).join(' | ')}`);
  }

  return lines.join('\n');
}

/**
 * 格式化全局上下文为 Markdown 字符串（供 formatPrompt 和 split.ts 共用）
 */
export function formatGlobalContext(ctx: GlobalContext, platform?: string): string {
  const lines: string[] = [];

  lines.push('## 🌐 全局知识库');
  lines.push('> 以下信息来自项目全局知识库。必读内容已注入，其余文件请按需自行 Read。\n');

  if (ctx.indexSummary) {
    lines.push('### 📌 必读（已注入）');
    lines.push(ctx.indexSummary);
    lines.push('');
  }

  if (ctx.toc.length > 0) {
    lines.push('### 📂 可选参考（按需 Read）');
    if (platform) {
      lines.push(`> 当前任务涉及 **${platform}** 端，建议优先参考该端文档\n`);
    }

    const groups: { label: string; prefix: string; basePath: string }[] = [
      { label: '**📚 跨端综合文档**', prefix: 'synthesis/', basePath: '.speccore/GLOBAL/synthesis/' },
      { label: '**📱 各端分析文档**', prefix: 'platforms/', basePath: '.speccore/GLOBAL/platforms/' },
      { label: '**📖 参考文档**', prefix: 'GLOBAL:', basePath: '.speccore/GLOBAL/' },
      { label: '**🧩 可复用模式与模板**', prefix: 'PATTERNS:', basePath: '.speccore/PATTERNS/' },
      { label: '**📏 规则与检查清单**', prefix: 'RULES:', basePath: '.speccore/RULES/' },
    ];

    for (const group of groups) {
      const entries = ctx.toc.filter(e => e.path.startsWith(group.prefix));
      if (entries.length === 0) continue;

      lines.push(group.label + ` (${group.basePath})`);

      // 特殊提示
      if (group.prefix === 'PATTERNS:') {
        lines.push('> 全局分析时沉淀的可复用模式 + 写作模板\n');
      }

      // 需要按子目录分组的（platforms, PROJECTS, PATTERNS）
      if (group.prefix === 'platforms/' || group.prefix === 'PROJECTS/' || group.prefix === 'PATTERNS:') {
        const bySub = new Map<string, TOCEntry[]>();
        for (const e of entries) {
          // PATTERNS:architecture/x.md → architecture; platforms/admin/x.md → admin
          const sub = group.prefix === 'PATTERNS:'
            ? e.path.replace('PATTERNS:', '').split('/')[0]
            : e.path.split('/')[1];
          if (!bySub.has(sub)) bySub.set(sub, []);
          bySub.get(sub)!.push(e);
        }
        for (const [sub, subEntries] of bySub) {
          const marker = group.prefix === 'platforms/' && sub === platform ? ' ⬅ 当前端' : '';
          lines.push(`📂 ${sub}/${marker}`);
          for (const e of subEntries) {
            lines.push(formatTOCEntry(e, 2));
          }
        }
      } else {
        for (const e of entries) {
          lines.push(formatTOCEntry(e, 0));
        }
      }
      lines.push('');
    }

    lines.push('### 💡 使用方式');
    lines.push('- GLOBAL/ 下的文件：路径相对于 `.speccore/GLOBAL/`');
    lines.push('- PATTERNS/ 下的文件：路径相对于 `.speccore/PATTERNS/`');
    lines.push('- RULES/ 下的文件：路径相对于 `.speccore/RULES/`');
    lines.push('- 建议根据当前任务需要选择性阅读，不必全部读取');
    lines.push('');
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════
// Split 智能拆分指令
// ═══════════════════════════════════════════════════════════

/** 构建 SpecCore 智能拆分指令（含三档粒度 + 原子任务原则） */
function buildSplitInstruction(): string {
  return [
    '',
    '## SpecCore 任务拆分原则',
    '',
    'SpecCore 核心理念: "Code by Spec, Not by Vibe" — 每个任务必须有对应的 Spec，AI 在 Spec 约束下工作。',
    '',
    '### 前置读取（拆分前必须执行）',
    '',
    '拆分前，必须先读取以下分析文档，确保拆分基于已有的分析结果而非凭空想象：',
    '',
    '1. **Read `020-specs/overview/FUNCTION_MAP.md`** → 了解功能单元与端的映射关系',
    '   - 每个功能单元涉及哪些端？',
    '   - 功能单元之间的依赖关系？',
    '   - **必须按 FUNCTION_MAP.md 中的功能单元来拆分任务**，不要自己重新定义功能单元',
    '',
    '2. **Read `020-specs/overview/REQUIREMENT.md`** → 了解整体需求范围',
    '   - 功能模块清单、涉及端、验收标准',
    '',
    '3. **Read `020-specs/overview/INTERACTION_MAP.md`** → 了解跨端交互时序',
    '   - 哪些功能需要跨端协作？',
    '   - 数据如何在端之间流转？',
    '',
    '4. **Read `020-specs/{端名}/TECH.md`**（每个端都要读）→ 了解各端技术方案',
    '   - 各端有哪些接口/页面？',
    '   - 各端技术栈和架构约束？',
    '   - **据此确定每个任务涉及哪些端**',
    '',
    '### 原子任务定义',
    '一个原子任务 = 一个开发者在指定粒度内可独立完成的、有明确验收标准的最小工作单元。',
    '判定标准（全部满足）:',
    '- 有独立的输入/输出（API 接口 / 页面 / 数据表）',
    '- 00-specs/ 三件套能独立写满（REQ.md + TECH.md + TASK.md）',
    '- execute 时不强依赖其他 Task 的运行时状态（可通过 API_CONTRACT.yaml 解耦）',
    '- 有明确的验收标准（AC 可枚举）',
    '- 可独立提 PR、独立 review',
    '',
    '### 粒度规则',
    '',
    '**合并规则（这些应该是一个任务）:**',
    '- 同一数据实体的 CRUD（如用户管理的增删改查）→ 共享数据模型',
    '- 页面 + 对应后端接口 < 5 个 → 前后端强耦合，一人做效率最高',
    '- 纯配置/文案/样式微调 → 不构成独立工作单元',
    '- 关联紧密的小功能（如列表页 + 详情页）→ 共享路由和状态',
    '- 同一模块的接口 + 单元测试 → 测试是接口的一部分',
    '',
    '**拆分规则（这些必须是独立任务）:**',
    '- 接口 > 8 个 → 按业务领域拆',
    '- 涉及 > 3 张新表 → 按数据层拆',
    '- 超出粒度时间上限 → 必须再拆',
    '- **跨端功能 → 按端拆**：参考 FUNCTION_MAP.md 中每个功能单元涉及的端，为每个端生成独立的子任务',
    '  - 例：FUNCTION_MAP.md 中「订单系统」涉及 booking-service + admin-web + h5-mobile → 拆成 3 个子任务（每端 1 个）',
    '  - 例：FUNCTION_MAP.md 中「用户管理」只涉及 booking-service → 只拆 1 个子任务',
    '- 独立第三方集成（支付/短信/OSS）→ 有独立文档和调试流程',
    '- 数据迁移/脚本 → 独立执行窗口',
    '',
    '### 按端拆分原则（关键）',
    '',
    '1. **读取 FUNCTION_MAP.md**：确定每个功能单元涉及哪些端',
    '2. **一个功能单元 × 一个端 = 一个子任务**：',
    '   - 如果功能单元涉及 N 个端，就拆成 N 个子任务（每端一个）',
    '   - 每个子任务的 `scope` 只包含一个端',
    '3. **子任务命名规则**：`{功能单元} — {端名}`',
    '   - 例：`用户管理 — booking-service`、`用户管理 — admin-web`、`用户管理 — h5-mobile`',
    '4. **子任务内容差异化**：',
    '   - 后端子任务：聚焦接口设计、数据模型、业务逻辑、单元测试',
    '   - 前端子任务：聚焦页面设计、组件实现、状态管理、API 调用链、UI 测试',
    '   - `reqContent` 和 `techContent` 必须按端裁剪，只包含该端负责的内容',
    '',
    '### 依赖关系规则',
    '- 数据依赖: Task-B 需要 Task-A 创建的表 → B 依赖 A',
    '- API 依赖: Task-B 调用 Task-A 的接口 → B 依赖 A（需先定义 API_CONTRACT.yaml）',
    '- 依赖链深度 ≤ 3（A→B→C 可以，A→B→C→D 需重新拆）',
    '- 基础模块（认证/数据库/配置）优先拆出，作为第一批任务',
    '',
    '### 输出格式',
    '请输出 JSON 数组，每个 Task 包含:',
    '```json',
    '[',
    '  {',
    '    "id": "Task-001",',
    '    "functionalUnit": "所属功能单元（如：用户管理、订单系统、支付模块）",',
    '    "name": "任务名称",',
    '    "type": "feature|bugfix|refactor|research",',
    '    "reason": "为什么这样拆分（语义解释）",',
    '    "scope": ["booking-service", "admin-web", "h5-mobile"],',
    '    "apis": ["POST /api/auth/login", "GET /api/auth/me"],',
    '    "tables": ["users", "sessions"],',
    '    "estimatedHours": 8,',
    '    "priority": "high|medium|low",',
    '    "dependencies": [],',
    '    "acceptanceCriteria": ["AC1: ...", "AC2: ..."],',
    '    "risk": "low|medium|high",',
    '    "reqContent": "需求描述（Markdown，写入 REQ.md）",',
    '    "techContent": "技术方案（Markdown，写入 TECH.md）"',
    '  }',
    ']',
    '```',
    '',
    '**重要：`scope` 字段必须使用标准端名**',
    '- `scope` 必须是 CONSTITUTION.md「## 端列表」中声明的标准端名',
    '- **禁止**使用中文简写（如"后端"、"前端"、"管理端"），必须使用标准端名（如 `booking-service`、`admin-web`、`h5-mobile`）',
    '- 跨端功能必须列出所有涉及的端，不要遗漏',
    '- 单端功能只列一个端',
    '',
    '**重要：`functionalUnit` 字段必须填写**',
    '- 填写该任务所属的**功能单元**名称（不是需求文档的章节名）',
    '- **功能单元必须来自 FUNCTION_MAP.md**，不要自己重新定义',
    '- 例如：用户 CRUD + 头像上传 → 都属于"用户管理"功能单元',
    '- 例如：订单创建 + 订单支付 + 订单退款 → 都属于"订单系统"功能单元',
    '- 用于校验每个功能单元的拆分数量是否合理（默认 1 个，最多 3 个）',
    '',
    '**重要：`reqContent` 和 `techContent` 必须填写**',
    '- `reqContent`：该任务的需求描述（Markdown 格式，含业务规则、数据模型、接口定义），直接写入 REQ.md',
    '- `techContent`：该任务的技术方案（Markdown 格式，含架构设计、核心逻辑、测试策略），直接写入 TECH.md',
    '- 内容是**子切面**：只包含该任务负责的部分，不是整个功能单元的内容',
    '',
    '### 质量自检',
    '拆分完成后自查:',
    '□ 每个任务都满足原子任务定义？',
    '□ 没有超出粒度时间上限的任务？',
    '□ 没有循环依赖？',
    '□ 基础模块排在前面？',
    '□ 同功能单元内的任务没被过度拆分？',
    '',
    '### 🚨 拆分粒度约束（必须遵守）',
    '',
    '**📌 核心原则：按功能独立性拆分，而非章节划分**',
    '',
    '拆分必须**基于功能独立性**判断，而不是机械地按章节拆分：',
    '- **一个独立功能 = 一个任务**：无论它在需求文档中是一个章节还是多个章节',
    '- **章节只是参考**：需求文档的章节划分可能很粗（如"系统管理"包含多个功能）或很细（如"用户管理-创建"单独一章）',
    '- **判断标准**：功能是否有独立的输入/输出、是否可以独立开发测试、是否有明确的验收标准',
    '',
    '**拆分示例:**',
    '- ✅ 正确："用户管理"章节包含用户 CRUD + 权限管理 → 拆成 2 个任务（用户管理 + 权限管理）',
    '- ✅ 正确："用户管理-创建"和"用户管理-删除"各一个章节 → 合并为 1 个任务（都是用户管理功能）',
    '- ❌ 错误：把 "用户管理的增删改查" 拆成 4 个任务 → 过度拆分',
    '- ❌ 错误：把 "系统管理" 章节的所有功能合并成 1 个任务 → 拆分不足',
    '',
    '**数量参考（非硬性约束）:**',
    '- 一个功能单元**通常**拆 1-3 个任务',
    '- 如果功能单元确实包含多个独立子模块，可以适当增加',
    '- 但每个任务必须满足原子任务定义（独立输入/输出、可独立开发测试）',
    '',
    '**合并优先级（从高到低）:**',
    '1. 同一数据实体的 CRUD → 合并为一个任务',
    '2. 页面 + 对应后端接口 < 5 个 → 合并为一个任务',
    '3. 关联紧密的小功能（列表页 + 详情页）→ 合并为一个任务',
    '4. 同一模块的接口 + 单元测试 → 合并为一个任务',
    '5. 工时 < 8h 的小任务 → 寻找可合并的关联任务',
    '',
    '**自检清单:**',
    '□ 每个功能单元拆出的任务数 ≤ 3？',
    '□ 同一功能单元内没有可以合并的子任务？',
    '□ 每个任务都满足原子任务定义？',
    '',
    '### 🤖 自动模式指令',
    '',
    '本拆分在自动模式下执行，请遵循以下原则:',
    '1. **不要询问用户** — 按你的最佳判断直接拆分，不要请求确认或澄清',
    '2. **有疑问就记录** — 如果对需求理解、技术选型、任务边界有疑问，不要停下来问，而是:',
    '   - 按你的最佳判断继续拆分',
    '   - 将疑问写入 `.speccore/questions/split-{迭代名}-{日期}.md`',
    '   - 格式: `## 疑问 N\n- 问题描述\n- 你的判断\n- 建议后续动作`',
    '3. **遇阻断就跳过** — 如果某个功能模块信息不足无法拆分，跳过它并在疑问清单中记录',
    '4. **输出 JSON** — 直接输出拆分结果的 JSON 数组，不要输出其他内容',
    '5. **逐功能单元自检** — 生成 JSON 前，逐功能单元检查：每个功能单元拆出的任务数 ≤ 3，超过则合并',
    '',
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════
// Prompt 构建
// ═══════════════════════════════════════════════════════════

/**
 * 获取命令对应的指令模板
 */
function getInstruction(command: PromptCommand, context: { taskName?: string; apiCount: number; modelCount: number }): string {
  switch (command) {
    case 'execute':
      return [
        `请根据以下 Spec 规范，为 "${context.taskName || '当前任务'}" 生成完整的代码实现。`,
        '',
        '## 相邻任务关联（Layer 2）',
        '在开始编码前，先读取相邻任务的文档，建立任务间关联认知：',
        '1. **读取前置任务**（本任务依赖的任务）：',
        '   - 在 030-tasks/ 下查找依赖本任务的任务目录',
        '   - Read 其 _shared/CONTEXT.md 和 00-specs/REQ.md → 了解前置任务的输出接口/数据模型',
        '   - Read 其 _shared/API_CONTRACT.yaml → 了解前置任务定义的契约',
        '2. **读取并行任务**（同一功能单元的其他端任务）：',
        '   - 在 030-tasks/ 下查找同一 Task-NNN 下的其他端子任务',
        '   - Read 其 _shared/CONTEXT.md → 了解并行任务的接口定义和状态设计',
        '3. **契约验证**：',
        '   - 本任务的接口定义是否与前置任务的输出一致？',
        '   - 本任务的数据模型是否与并行任务的数据模型一致？',
        '   - 本任务的状态枚举是否与全局 API_CONTRACT.yaml 一致？',
        '   - 标注不一致项，在代码注释中说明处理方案',
        '4. **强制要求**：',
        '   - 如果存在前置任务或并行任务，必须先 Read 其文档后再开始编码',
        '   - 如果因找不到相邻任务文档而无法验证契约，在代码注释中明确标注「未验证：相邻任务文档缺失」',
        '   - 不允许在完全不了解相邻任务的情况下直接生成接口/模型代码',
        '',
        '## 后端实现要求（Layer 3）',
        `1. 严格遵循上面的技术栈选型`,
        `2. 实现所有 ${context.apiCount} 个 API 接口`,
        `3. 创建所有 ${context.modelCount} 个数据模型的 DDL`,
        '4. 遵循 CONSTITUTION 中定义的命名规范和异常码体系',
        '5. 代码必须能直接编译通过',
        '6. 包含必要的 import 语句和注解',
        '',
        '## 前端实现要求（Layer 3）',
        '如果任务涉及前端各端（admin/H5/小程序/App），还需：',
        '1. 按 UI_SPEC.md 中的字段→UI 映射实现每个页面',
        '2. 按路由表创建页面组件和路由配置',
        '3. 实现状态枚举的前端展示（与后端数据模型一致）',
        '4. 实现表单校验规则（与后端校验规则一致）',
        '5. 实现页面四态：加载中/正常/空态/错误态',
        '6. 实现响应式适配（按 UI_SPEC.md 中的断点和布局策略）',
        '7. 前端组件必须与后端 API 响应字段一一对应，不能硬编码',
        '',
        '## 🤖 自动模式指令',
        '',
        '本操作在自动模式下执行，请遵循以下原则:',
        '1. **不要询问用户** — 按你的最佳判断直接生成代码，不要请求确认或澄清',
        '2. **有疑问就记录** — 如果对需求理解、技术选型有疑问，按最佳判断实现，并将疑问写入 `.speccore/questions/execute-{任务名}-{日期}-*.md`',
        '3. **遇阻断就跳过** — 如果某个功能信息不足无法实现，跳过它并在疑问清单中记录',
        '4. **直接输出代码** — 按 JSON 格式输出文件列表，不要输出多余解释',
      ].join('\n');
    
    case 'analyze':
      return [
        '请分析以下需求文档，输出结构化分析结果。',
        '1. 需求完整性评估（API 覆盖率、数据模型完整性）',
        '2. 技术方案建议（架构、选型、依赖）',
        '3. 风险识别（技术难点、依赖风险、性能瓶颈）',
        '4. 工作量估算（按 API 数量估算人天）',
        '请按 Markdown 格式输出，包含上述 4 个章节。',
        '',
        '## 🤖 自动模式指令',
        '',
        '本操作在自动模式下执行，请遵循以下原则:',
        '1. **不要询问用户** — 按你的最佳判断直接分析，不要请求确认或澄清',
        '2. **有疑问就记录** — 将疑问写入 `.speccore/questions/analyze-{迭代名}-{日期}-*.md`',
        '3. **遇阻断就跳过** — 信息不足的章节标注“待补充”，不要停下来问',
      ].join('\n');

    case 'split':
      return buildSplitInstruction();

    case 'plan':
      return [
        '请根据以下 Task 列表和人员配置，生成执行计划。',
        '1. 拓扑排序确定执行顺序',
        '2. 识别可并行的 Task 批次',
        '3. 分配负责人',
        '4. 估算每个 Task 的工作量和里程碑',
        '请按 Markdown 表格格式输出执行计划。',
        '',
        '## 🤖 自动模式指令',
        '',
        '本操作在自动模式下执行，请遵循以下原则:',
        '1. **不要询问用户** — 按你的最佳判断直接排计划，不要请求确认或澄清',
        '2. **有疑问就记录** — 将疑问写入 `.speccore/questions/plan-{迭代名}-{日期}-*.md`',
        '3. **直接输出结果** — 输出 Markdown 表格，不要输出多余解释',
      ].join('\n');
  }
}

/**
 * 构建完整的 SpecCore Prompt
 */
export async function buildPrompt(
  command: PromptCommand,
  options: {
    cwd?: string;
    iteration?: string;
    task?: string;
    taskDir?: string;
    platform?: string;
  }
): Promise<SpecCorePrompt> {
  const cwd = options.cwd || process.cwd();
  const techStack = await loadTechStack(cwd);
  const taskDir = options.taskDir || '';

  // P0-1: 统一读取 REQ.md，避免 loadApiSpecs/loadDataModels/loadBusinessRules 各读一次
  const reqContent = taskDir ? await loadReqContent(cwd, taskDir) : null;
  const apiSpecs = await loadApiSpecs(cwd, taskDir, reqContent || undefined);
  const dataModels = await loadDataModels(cwd, taskDir, reqContent || undefined);
  const businessRules = await loadBusinessRules(cwd, taskDir, reqContent || undefined);

  // 统一检索层：同时查询文档 RAG + 代码切片 + 知识图谱
  let extraSpecs: TaskExtraSpec[] = [];
  if (taskDir) {
    try {
      const unifiedResult = await unifiedSearch(cwd, {
        query: options.task || options.iteration || '',
        iteration: options.iteration,
        taskId: options.task,
        platform: options.platform,
        taskDir,
      });

      if (unifiedResult.documentChunks.length > 0 || unifiedResult.codeSlices.length > 0) {
        extraSpecs = assembleUnifiedContext(unifiedResult, { maxTotalChars: 8000, generous: true });
        logger?.info?.(
          `   🔍 统一检索: ${unifiedResult.stats.docChunksFound} 文档块 + ${unifiedResult.stats.codeSlicesFound} 代码切片 | ~${unifiedResult.stats.totalTokensEstimate} tokens`
        );
      }
    } catch (e) {
      logger?.debug?.('统一检索失败，回退到传统模式:', e);
    }

    // 回退：统一检索失败或结果为空时，用传统截断模式
    if (extraSpecs.length === 0) {
      extraSpecs = await loadExtraSpecs(cwd, taskDir, options.platform, options.iteration, {
        maxCharsPerFile: 2000,
        maxTotalChars: 8000,
      });
      if (extraSpecs.length > 0) {
        logger?.info?.(`   📄 传统模式: ${extraSpecs.length} 个参考文档已加载`);
      }
    }

    // 稀疏检测 + 全量兜底：检索内容不足时，读取所有内容
    const SPARSE_THRESHOLD = 3000;
    const currentChars = extraSpecs.reduce((sum, s) => sum + s.content.length, 0);
    if (currentChars < SPARSE_THRESHOLD) {
      // 提前加载知识图谱（供全量兜底使用）
      let fallbackGraph: KnowledgeGraph | null = null;
      try {
        fallbackGraph = await loadKnowledgeGraph(cwd);
        if (fallbackGraph && await isGraphStale(cwd, options.iteration)) {
          fallbackGraph = await refreshKnowledgeGraph(cwd, options.iteration);
        }
      } catch { /* 图谱不可用时跳过 */ }

      const fullContext = await loadAllTaskContext(cwd, taskDir, options.platform, options.iteration, fallbackGraph || undefined);
      if (fullContext.length > extraSpecs.length) {
        extraSpecs = fullContext;
        logger?.info?.(`   📚 全量兜底: ${fullContext.length} 个文件 (检索内容不足 ${currentChars} < ${SPARSE_THRESHOLD})`);
      }
    }
  }

  // v6.72.0+: execute 时注入 CONSISTENCY_CHECK.md（前后端一致性校验）
  if (command === 'execute' && taskDir) {
    try {
      const iterDir = dirname(dirname(taskDir)); // Task-NNN/ → 030-tasks/ → Iteration-XXX/
      const ccPaths = [
        join(iterDir, '020-specs', 'global', 'CONSISTENCY_CHECK.md'),
        join(cwd, '.speccore', 'GLOBAL', 'CONSISTENCY_CHECK.md'),
      ];
      for (const ccPath of ccPaths) {
        if (await pathExists(ccPath)) {
          const ccContent = await readFile(ccPath, 'utf-8');
          if (ccContent.trim().length > 0) {
            extraSpecs.push({
              name: 'CONSISTENCY_CHECK.md',
              path: ccPath,
              content: `## 前后端一致性校验报告\n\n${ccContent}`,
            });
            logger?.info?.(`   📋 已注入一致性校验报告: ${ccPath.replace(cwd + '/', '')}`);
            break;
          }
        }
      }
    } catch { /* 忽略读取失败 */ }
  }

  // 加载全局上下文（智能注入）
  const globalContext = await loadGlobalContext(cwd, command, options.platform);

  // 加载知识图谱 → 生成任务关联链（< 500 tokens）
  let taskContextStr: string | undefined;
  if (options.task) {
    let graph = await loadKnowledgeGraph(cwd);
    const stale = await isGraphStale(cwd, options.iteration);
    if (stale) {
      graph = await refreshKnowledgeGraph(cwd, options.iteration);
    }
    if (graph) {
      taskContextStr = buildCompactContext(graph, {
        taskId: options.task,
        platform: options.platform,
      }) || undefined;
    }
  }

  const context = {
    taskName: options.task,
    apiCount: apiSpecs.length,
    modelCount: dataModels.length,
  };

  // v6.49.6+：加载工程路径信息（用于 execute 命令告诉 AI 代码写到哪里）
  let projectPathsInfo: string | undefined;
  if (command === 'execute') {
    const projectInfoMap = await parseProjectInfo();
    if (projectInfoMap.size > 0) {
      const lines = ['## 📂 工程路径（代码输出位置）', '', '| 工程标识 | 工程类型 | 源码路径 | 对应端 |', '| :--- | :--- | :--- | :--- |'];
      for (const [identifier, info] of projectInfoMap) {
        lines.push(`| ${identifier} | ${info.projectType || '-'} | \`${info.srcPath}\` | ${info.platform} |`);
      }
      lines.push('');
      lines.push('**重要**：输出文件时，路径必须以工程标识开头。');
      lines.push('例如：`booking-service/src/main/java/...` 会写入 `../outputs-project/backend/booking-service/src/main/java/...`');
      lines.push('如果不以工程标识开头，文件将写入迭代目录（兼容旧行为）。');
      projectPathsInfo = lines.join('\n');
    }
  }

  // v6.85.0+: 根据技术栈加载编码规范
  let rulesContent: string | undefined;
  if (command === 'execute') {
    const identifiers: string[] = [];
    if (techStack.language) identifiers.push(techStack.language.toLowerCase());
    if (techStack.framework) identifiers.push(techStack.framework.toLowerCase());
    if (techStack.database) identifiers.push(techStack.database.toLowerCase());
    if (techStack.frontend) identifiers.push(techStack.frontend.toLowerCase());
    if (techStack.cache) identifiers.push(techStack.cache.toLowerCase());
    if (options.platform) identifiers.push(options.platform.toLowerCase());

    if (identifiers.length > 0) {
      try {
        const rules = await resolveRulesForTechStack(identifiers, cwd);
        if (rules.length > 0) {
          rulesContent = formatRulesPrompt(rules);
        }
      } catch {
        // RULES 加载失败静默跳过，不影响主流程
      }
    }
  }

  // v6.86.0+: 为 split/plan 命令注入 AGENTS
  let instruction = getInstruction(command, context);
  if (command === 'split' || command === 'plan') {
    const phase = 'default';
    const agentContext: AgentContext = {
      iteration: options.iteration || '',
    };
    try {
      const agents = await resolveAgentsForPhase(command, phase, agentContext, cwd);
      if (agents.length > 0) {
        instruction += '\n\n## 专业角色指引\n\n';
        for (const ra of agents) {
          instruction += ra.definition.rolePrompt;
          instruction += '\n\n';
        }
      }
    } catch {
      // AGENTS 加载失败静默跳过
    }
  }

  return {
    marker: '[SPECCORE_PROMPT]',
    version: '1.0',
    command,
    iteration: options.iteration || '',
    task: options.task,
    platform: options.platform,
    techStack,
    apiSpecs,
    dataModels,
    businessRules,
    extraSpecs,
    globalContext: (globalContext.indexSummary || globalContext.toc.length > 0) ? globalContext : undefined,
    taskContext: taskContextStr,
    projectPaths: projectPathsInfo,
    rulesContent,
    instruction,
    outputHint: command === 'execute'
      ? '请返回格式: {"files": [{"path": "工程标识/相对路径", "content": "代码内容"}]}'
      : command === 'split'
        ? '请返回 JSON 数组格式的任务列表（参见拆分原则中的输出格式）'
        : '请返回 Markdown 格式的分析结果',
  };
}

// ═══════════════════════════════════════════════════════════
// Prompt 序列化
// ═══════════════════════════════════════════════════════════

/**
 * 粗略估算 token 数（中文 ≈ 1.5 tokens/字，英文 ≈ 0.25 tokens/字符）
 */
function estimateTokens(text: string): number {
  let tokens = 0;
  for (const ch of text) {
    tokens += ch.charCodeAt(0) > 127 ? 1.5 : 0.25;
  }
  return Math.ceil(tokens);
}

/**
 * 将 Prompt 序列化为 AI 可读的文本（输出到 stdout）
 * 带动态裁剪：超出预算时按优先级逐级简化
 */
export function formatPrompt(prompt: SpecCorePrompt, maxTokens: number = 12000): string {
  // 尝试完整构建
  let result = buildPromptText(prompt);
  let tokens = estimateTokens(result);

  if (tokens <= maxTokens) return result;

  // Level 1: 简化全局上下文（只保留 INDEX.md，去掉 TOC 目录）
  if (prompt.globalContext) {
    const slimGlobal = { ...prompt.globalContext, toc: [] };
    result = buildPromptText({ ...prompt, globalContext: slimGlobal });
    tokens = estimateTokens(result);
    if (tokens <= maxTokens) {
      logger?.info?.(`   🪶 Prompt 已简化：隐藏全局目录（-${estimateTokens(formatGlobalContext(prompt.globalContext!, prompt.platform))} tokens）`);
      return result;
    }
  }

  // Level 2: 压缩 extraSpecs（截断到 500 字/文件）
  if (prompt.extraSpecs.length > 0) {
    const slimExtras = prompt.extraSpecs.map(s => ({
      ...s,
      content: s.content.length > 500 ? s.content.slice(0, 500) + '\n> ... (已截断)' : s.content,
    }));
    result = buildPromptText({ ...prompt, extraSpecs: slimExtras });
    tokens = estimateTokens(result);
    if (tokens <= maxTokens) {
      logger?.info?.(`   🪶 Prompt 已简化：压缩 extraSpecs 至 500 字/文件`);
      return result;
    }
  }

  // Level 3: 移除 taskContext（知识图谱关联链）
  if (prompt.taskContext) {
    result = buildPromptText({ ...prompt, taskContext: undefined });
    tokens = estimateTokens(result);
    if (tokens <= maxTokens) {
      logger?.info?.(`   🪶 Prompt 已简化：隐藏任务关联链`);
      return result;
    }
  }

  // Level 4: 终极简化——只保留核心（技术栈 + API + 指令）
  const minimalPrompt: SpecCorePrompt = {
    ...prompt,
    extraSpecs: [],
    taskContext: undefined,
    globalContext: undefined,
    dataModels: prompt.dataModels.slice(0, 2),
    businessRules: prompt.businessRules.slice(0, 3),
  };
  result = buildPromptText(minimalPrompt);
  logger?.info?.(`   🪶 Prompt 已极简模式：仅保留技术栈/API/核心指令`);
  return result;
}

/** 实际构建 prompt 文本（无裁剪逻辑） */
function buildPromptText(prompt: SpecCorePrompt): string {
  const lines: string[] = [];

  lines.push('[SPECCORE_PROMPT]');
  lines.push('');
  lines.push(`# 任务: ${prompt.command} — ${prompt.task || prompt.iteration}`);
  lines.push('');

  // 技术栈
  if (Object.keys(prompt.techStack).length > 0) {
    lines.push('## 技术栈');
    if (prompt.techStack.language) lines.push(`- 语言: ${prompt.techStack.language}`);
    if (prompt.techStack.framework) lines.push(`- 框架: ${prompt.techStack.framework}`);
    if (prompt.techStack.database) lines.push(`- 数据库: ${prompt.techStack.database}`);
    if (prompt.techStack.cache) lines.push(`- 缓存: ${prompt.techStack.cache}`);
    if (prompt.techStack.frontend) lines.push(`- 前端: ${prompt.techStack.frontend}`);
    lines.push('');
  }

  // v6.85.0+: 编码规范注入
  if (prompt.rulesContent) {
    lines.push(prompt.rulesContent);
    lines.push('');
  }

  // API 定义
  if (prompt.apiSpecs.length > 0) {
    lines.push('## API 接口定义');
    lines.push('| 方法 | 路径 | 说明 |');
    lines.push('| :--- | :--- | :--- |');
    for (const api of prompt.apiSpecs) {
      lines.push(`| ${api.method} | ${api.path} | ${api.description} |`);
    }
    lines.push('');
  }

  // 数据模型
  if (prompt.dataModels.length > 0) {
    lines.push('## 数据模型');
    for (const model of prompt.dataModels) {
      lines.push(`### ${model.name}${model.table ? ` (${model.table})` : ''}`);
      if (model.fields.length > 0) {
        lines.push('| 字段 | 类型 | 说明 |');
        lines.push('| :--- | :--- | :--- |');
        for (const field of model.fields) {
          lines.push(`| ${field.name} | ${field.type} | ${field.description} |`);
        }
      }
      lines.push('');
    }
  }

  // 业务规则
  if (prompt.businessRules.length > 0) {
    lines.push('## 业务规则和约束');
    for (const rule of prompt.businessRules) {
      lines.push(`- ${rule.rule}`);
    }
    lines.push('');
  }

  // 额外任务上下文（TECH.md / TASK.md / SCHEMA.md / .issues.md 等）
  if (prompt.extraSpecs.length > 0) {
    for (const spec of prompt.extraSpecs) {
      lines.push(`## ${spec.name} (${spec.path})`);
      lines.push(spec.content);
      lines.push('');
    }
  }

  // 任务关联链（知识图谱）
  if (prompt.taskContext) {
    lines.push('## 🔗 任务关联链');
    lines.push(prompt.taskContext);
    lines.push('');
  }

  // 全局上下文（从 GLOBAL 层智能注入）
  if (prompt.globalContext) {
    lines.push(formatGlobalContext(prompt.globalContext, prompt.platform));
    lines.push('');
  }

  // v6.49.6+：工程路径信息（用于 execute 命令）
  if (prompt.projectPaths) {
    lines.push(prompt.projectPaths);
    lines.push('');
  }

  // 输出格式提示
  lines.push(`## 输出格式要求`);
  lines.push(prompt.outputHint);
  lines.push('');

  // 执行指令
  lines.push('## 执行指令');
  lines.push(prompt.instruction);
  lines.push('');

  // 尾标记
  lines.push('[/SPECCORE_PROMPT]');

  return lines.join('\n');
}

/**
 * 解析 AI 返回的 JSON 文件列表
 */
export function parseAiResponse(response: string): { files: { path: string; content: string }[] } | null {
  // 尝试从响应中提取 JSON
  const jsonMatch = response.match(/\{[\s\S]*"files"[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.files && Array.isArray(parsed.files)) {
      return parsed;
    }
  } catch {
    // 非 JSON 响应，当作原始代码处理
  }

  return null;
}

// ═══════════════════════════════════════════════════════════
// 缺参数请求协议
// ═══════════════════════════════════════════════════════════

/** 缺参数请求 */
export interface NeedsInfoRequest {
  marker: '[SPECCORE_NEEDS_INFO]';
  command: string;
  missing: string[];
  provided: Record<string, string>;
  hint: string;
  availableOptions?: {
    iterations?: string[];
    tasks?: string[];
    platforms?: string[];
  };
}

/** 命令参数表 */
const COMMAND_PARAMS: Record<string, { name: string; required: boolean; desc: string; example: string }[]> = {
  execute: [
    { name: '-t, --task', required: true, desc: '任务编号', example: 'Task-001' },
    { name: '-i, --iteration', required: true, desc: '迭代名', example: 'Q1' },
    { name: '--all', required: false, desc: '执行全部待开发任务', example: '--all' },
    { name: '--platform', required: false, desc: '指定平台端', example: 'app/h5/miniapp/admin' },
    { name: '--force', required: false, desc: '跳过确认直接执行', example: '--force' },
    { name: '--resume', required: false, desc: '断点续跑', example: '--resume' },
  ],
  analyze: [
    { name: '-I, --iteration', required: true, desc: '迭代名', example: 'Q1' },
    { name: '--task', required: false, desc: '分析特定任务', example: 'Task-001' },
    { name: '--scope', required: false, desc: '分析范围', example: 'global/iteration/task' },
    { name: '--depth', required: false, desc: '分析深度', example: 'quick/normal/deep' },
  ],
  split: [
    { name: '-I, --iteration', required: true, desc: '迭代名', example: 'Q1' },
    { name: '--owner', required: false, desc: '指定负责人', example: '张三' },
    { name: '--dry-run', required: false, desc: '预览模式不创建', example: '--dry-run' },
  ],
  plan: [
    { name: '-I, --iteration', required: true, desc: '迭代名', example: 'Q1' },
    { name: '--owner', required: false, desc: '指定负责人', example: '张三' },
  ],
  doc2spec: [
    { name: '-f, --file', required: true, desc: '源文件路径', example: 'PRD.docx' },
    { name: '--iter', required: true, desc: '目标迭代', example: 'Q1' },
    { name: '--platform', required: false, desc: '平台标识', example: 'app' },
  ],
  spec2doc: [
    { name: '-i, --iteration', required: true, desc: '迭代名', example: 'Q1' },
    { name: '-o, --output', required: true, desc: '输出文件名', example: '需求文档.docx' },
    { name: '-f, --format', required: false, desc: '导出格式', example: 'docx/pdf/html' },
    { name: '--all', required: false, desc: '全量导出', example: '--all' },
  ],
  pr: [
    { name: '--task', required: true, desc: '任务编号', example: 'Task-001' },
    { name: '-i, --iteration', required: false, desc: '迭代名', example: 'Q1' },
    { name: '--title', required: false, desc: 'PR 标题', example: '"feat: 用户认证"' },
  ],
  done: [
    { name: '--task', required: false, desc: '任务编号', example: 'Task-001' },
    { name: '--all', required: false, desc: '全部归档', example: '--all' },
    { name: '-i, --iteration', required: false, desc: '迭代名', example: 'Q1' },
  ],
};

/** 命令别名和描述 */
const COMMAND_DESC: Record<string, { desc: string; aliases: string[] }> = {
  execute: { desc: '执行开发任务：读取 Spec → AI 生成代码 → 写入文件', aliases: ['ex'] },
  analyze: { desc: '需求分析：读取需求文档 → AI 分析 → 写入 ANALYSIS.md', aliases: ['al'] },
  split: { desc: '任务拆分：读取分析 → AI 拆分 → 创建 Task 目录', aliases: ['sp'] },
  plan: { desc: '生成执行计划：读取 Task → AI 排程 → 写入 plan.json', aliases: ['pl'] },
  doc2spec: { desc: '导入文档：Word/PDF → Pandoc 转换 + AI 验证 → Spec MD', aliases: ['d2s'] },
  spec2doc: { desc: '导出文档：Spec MD → AI 排版 → Word/PDF/HTML', aliases: ['s2d'] },
  pr: { desc: '创建 Pull Request：AI 生成描述 → 提交代码', aliases: [] },
  done: { desc: '任务归档：验证 → 回顾 → 同步全局', aliases: ['dn'] },
};

/**
 * 输出缺参数请求到 stdout，退出码 11。
 * 重格式：包含命令说明、参数表、可用选项、使用示例、推荐命令。
 */
export function outputNeedsInfo(req: Omit<NeedsInfoRequest, 'marker'>): void {
  const params = COMMAND_PARAMS[req.command] || [];
  const cmdInfo = COMMAND_DESC[req.command] || { desc: req.command, aliases: [] };
  const lines: string[] = [];

  lines.push('[SPECCORE_NEEDS_INFO]');
  lines.push('');
  lines.push(`## ⚠️ 命令 \`${req.command}\` 缺少必要参数`);
  lines.push('');
  lines.push(`**说明**: ${cmdInfo.desc}`);
  if (cmdInfo.aliases.length > 0) lines.push(`**别名**: ${cmdInfo.aliases.join(', ')}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('### 📋 全部参数');
  lines.push('');
  lines.push('| 参数 | 必填 | 说明 | 示例 |');
  lines.push('| :--- | :--- | :--- | :--- |');
  for (const p of params) {
    const isMissing = req.missing.some(m => p.name.includes(m));
    const icon = p.required ? '🔴 必填' : '🟢 可选';
    const marker = isMissing ? '**← 缺失**' : '';
    lines.push(`| \`${p.name}\` | ${icon} | ${p.desc} ${marker} | \`${p.example}\` |`);
  }
  lines.push('');

  // 已提供的参数
  if (Object.keys(req.provided).length > 0) {
    lines.push('### ✅ 已提供');
    lines.push('| 参数 | 值 |');
    lines.push('| :--- | :--- |');
    for (const [k, v] of Object.entries(req.provided)) {
      lines.push(`| ${k} | ${v} |`);
    }
    lines.push('');
  }

  // 可用选项
  if (req.availableOptions) {
    const opts = req.availableOptions;
    if (opts.tasks && opts.tasks.length > 0) {
      lines.push('### 📦 可用的 Task');
      for (const t of opts.tasks) lines.push(`- \`${t}\``);
      lines.push('');
    }
    if (opts.iterations && opts.iterations.length > 0) {
      lines.push('### 📅 可用的迭代');
      for (const i of opts.iterations) lines.push(`- \`${i}\``);
      lines.push('');
    }
    if (opts.platforms && opts.platforms.length > 0) {
      lines.push('### 📱 可用的平台');
      for (const p of opts.platforms) lines.push(`- \`${p}\``);
      lines.push('');
    }
  }

  // 使用示例
  const examples = generateExamples(req.command, req);
  if (examples.length > 0) {
    lines.push('### 💡 使用示例');
    for (const e of examples) lines.push(e);
    lines.push('');
  }

  // 推荐命令
  if (req.availableOptions?.tasks && req.availableOptions.tasks.length > 0 && req.availableOptions.iterations) {
    const t = req.availableOptions.tasks[0];
    const i = req.availableOptions.iterations![0] || 'Q1';
    lines.push(`### 🚀 推荐命令（可直接使用）`);
    lines.push(`\`\`\``);
    lines.push(`speccore ${req.command} --prompt -t ${t} -i ${i}`);
    lines.push(`\`\`\``);
    lines.push('');
  }

  lines.push('[/SPECCORE_NEEDS_INFO]');

  process.stdout.write(lines.join('\n'));
  process.exitCode = 11;
}

function generateExamples(command: string, req: Omit<NeedsInfoRequest, 'marker'>): string[] {
  const iter = req.provided.iteration || 'Q1';
  const task = req.availableOptions?.tasks?.[0] || 'Task-001';
  switch (command) {
    case 'execute':
      return [
        `- 执行单个任务: \`speccore execute --prompt -t ${task}\``,
        `- 执行全部: \`speccore execute --all --force\``,
        `- 断点续跑: \`speccore execute --resume\``,
      ];
    case 'analyze':
      return [
        `- 分析迭代: \`speccore analyze --prompt -I ${iter}\``,
        `- 分析特定任务: \`speccore analyze --prompt -I ${iter} --task ${task}\``,
      ];
    case 'split':
      return [
        `- 拆分任务: \`speccore iteration split --prompt -I ${iter}\``,
        `- 指定负责人: \`speccore iteration split --prompt -I ${iter} --owner 张三\``,
      ];
    default:
      return [`\`speccore ${command} --prompt ${req.missing.map(m => `<${m}>`).join(' ')}\``];
  }
}
