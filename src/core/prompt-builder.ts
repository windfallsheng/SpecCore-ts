/**
 * prompt-builder — 统一的 Spec → AI Prompt 构建引擎
 * 
 * CLI 不自己生成内容，而是读取 Spec 上下文，构建结构化 Prompt 输出到 stdout。
 * Skill/宿主 AI 捕获 stdout，解析 Prompt，调用 AI 生成内容后，由 CLI --apply 写回。
 * 
 * 架构: CLI(确定性) → stdout(Prompt) → AI(生成) → CLI(确定性写入)
 */
import { readFile, pathExists, readdir, stat } from 'fs-extra';
import { join, dirname, relative, basename } from 'path';
import { isTimestampBackup, findProjectRoot } from '../utils/task-utils';
import { logger } from '../utils/logger';
import { loadKnowledgeGraph, loadFreshKnowledgeGraph, getTaskContext, getFullTaskContext, isGraphStale, refreshKnowledgeGraph, KnowledgeGraph } from './knowledge-graph';
import { buildCompactContext } from './context-builder';
import { parseProjectInfo, GLOBAL_SPECS_DIR, parseFeatureList } from './spec-paths';
import { getIterationDir } from './context';
import {
  loadRagIndex, isRagIndexStale, retrieveRelevantChunks,
  assembleChunksForPrompt, indexTaskDocuments, extractHtmlText,
} from './rag-engine';
import { unifiedSearch, assembleUnifiedContext } from './unified-retrieval';
// v8.3.122+: execute 时深入读取关联源码
import { findRelevantCode, readRelevantSource } from './code-scanner';
// v8.3.125+: 同义词扩展，解决中英文/缩写关键词匹配失败
import { expandSynonyms, extractNormalizedKeywords } from '../utils/synonyms';
// v8.3.94+: 视觉模型引擎（ specs 图片理解）
import { loadVisionConfig, describeImage, isVisionEnabled, VisionModelConfig } from './vision-engine';
// v6.93.0+: Prompt 插件系统
import { getPluginsForCommand } from './prompt-plugins';

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
  /** v8.3.129+: 关键全局文件全文注入（BUSINESS_RULES.md 等） */
  keyFileSummaries?: { path: string; content: string }[];
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
  codeGraphSummary?: string; // v6.91.0+: 代码知识图谱摘要（analyze 阶段注入）
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
    const lines = afterTable.split(/\r?\n/);
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

    const lines = section.split(/\r?\n/);
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
      const lines = namingSection[0].split(/\r?\n/);
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
        const lines = ruleSection[0].split(/\r?\n/);
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
 * v8.3.15+: 自动扫描子任务目录和 00-specs/ 下用户自定义的文档
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
  const seenPaths = new Set<string>();
  // v8.3.94+: 读取视觉模型配置（用于 specs 图片理解）
  const visionConfig = await loadVisionConfig(cwd);

  const files = [
    { name: '开发指南', path: '00-specs/DEV_GUIDE.md' },
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
  // v8.3.126+: feature/platform 端级规格改为阅读清单模式（省 Token + AI 按需 Read）
  const readingListItems: { path: string; feature: string; name: string }[] = [];

  if (iteration) {
    const iterDir = join(cwd, `Iteration-${iteration}`);
    files.push(
      { name: '迭代设计文档', path: join(iterDir, '020-specs', 'DESIGN.md') },
    );
    // v8.3.4+: 读取 overview/ 核心文档（analyze 产物），控制长度防漂移
    const overviewDir = join(iterDir, '020-specs', GLOBAL_SPECS_DIR);
    for (const f of ['REQUIREMENT.md', 'ANALYSIS.md', 'TECH.md', 'DEV_GUIDE.md']) {
      files.push({ name: `迭代overview/${f}`, path: join(overviewDir, f) });
    }
    if (platform) {
      // v8.3.126+: 扫描 020-specs/{feature}/{platform}/ 下的 .md 文件，改为阅读清单
      const specsDir = join(iterDir, '020-specs');
      try {
        const features = await parseFeatureList(iterDir);
        for (const feature of features) {
          const featurePlatDir = join(specsDir, feature, platform);
          if (await pathExists(featurePlatDir)) {
            const entries = await readdir(featurePlatDir, { withFileTypes: true });
            for (const entry of entries) {
              const isMd = entry.name.endsWith('.md') && !isTimestampBackup(entry.name);
              if (isMd) {
                readingListItems.push({
                  path: join(featurePlatDir, entry.name),
                  feature,
                  name: entry.name,
                });
              }
            }
          }
        }
      } catch { /* ignore */ }
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
    // v8.3.121+: 已移除 10-backend/20-frontend 旧结构回退，端平铺结构 {platform}/{subtask}/ 为标准
  }

  for (const f of files) {
    const fullPath = join(cwd, taskDir, f.path);
    seenPaths.add(fullPath);
    if (await pathExists(fullPath)) {
      let rawContent = await readFile(fullPath, 'utf-8');
      // v8.3.122+: HTML 原型文件保留完整内容（CSS/JS/结构），不再提取纯文本
      // 原型包含视觉效果和交互逻辑，AI 需要完整解析
      const isHtml = fullPath.endsWith('.html') || fullPath.endsWith('.htm');
      let content = rawContent;
      // v8.3.93+: Markdown 链接自动展开 + 图片提取
      if (fullPath.endsWith('.md')) {
        content = await processMarkdownContent(content, fullPath, seenPaths, visionConfig, {
          maxLinkDepth: 2, maxLinkChars: 1200, maxSvgChars: 1500,
        });
      }
      // 跳过空文件或纯占位符文件
      if (content.trim().length <= 50 || content.trim().match(/^#+\s*待填充|^<!--\s*AI-FILL\s*-->$/m)) {
        continue;
      }
      // 单文件大小限制
      if (content.length > MAX_PER_FILE) {
        content = content.slice(0, MAX_PER_FILE) + `\n\n> ... (已截断，原文件 ${rawContent.length} 字，完整内容请 Read: ${fullPath})`;
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

  // v8.3.15+: 自动扫描用户自定义文档（00-specs/ 和子任务目录）
  // 只要用户放了文件，AI 就应该读到
  const userCustomFiles = await scanUserCustomFiles(cwd, taskDir, platform, seenPaths);
  for (const uf of userCustomFiles) {
    const fullPath = join(cwd, taskDir, uf.path);
    if (seenPaths.has(fullPath)) continue;
    seenPaths.add(fullPath);

    try {
      let rawContent = await readFile(fullPath, 'utf-8');
      // v8.3.122+: HTML 原型文件保留完整内容（CSS/JS/结构），不再提取纯文本
      const isHtml = fullPath.endsWith('.html') || fullPath.endsWith('.htm');
      let content = rawContent;
      // v8.3.93+: Markdown 链接自动展开 + 图片提取
      if (fullPath.endsWith('.md')) {
        content = await processMarkdownContent(content, fullPath, seenPaths, visionConfig, {
          maxLinkDepth: 2, maxLinkChars: 1200, maxSvgChars: 1500,
        });
      }
      if (content.trim().length <= 50 || content.trim().match(/^#+\s*待填充|^<!--\s*AI-FILL\s*-->$/m)) {
        continue;
      }
      if (content.length > MAX_PER_FILE) {
        content = content.slice(0, MAX_PER_FILE) + `\n\n> ... (已截断，原文件 ${content.length} 字)`;
      }
      if (totalChars + content.length > MAX_TOTAL) {
        const remain = MAX_TOTAL - totalChars;
        if (remain > 200) {
          content = content.slice(0, remain) + `\n\n> ... (已达总上限 ${MAX_TOTAL} 字)`;
          extras.push({ name: uf.name, path: uf.path, content });
        }
        break;
      }
      totalChars += content.length;
      extras.push({ name: uf.name, path: uf.path, content });
    } catch { /* 忽略读取失败的文件 */ }
  }

  // v8.3.126+: 将 020-specs/{feature}/{platform}/ 端级规格转为阅读清单
  if (readingListItems.length > 0) {
    const listLines: string[] = [
      '## 📚 迭代层端级规格阅读清单',
      '> 以下文档与当前任务相关，已改为阅读清单模式（节省 Token）。',
      '> 如需深入了解某个功能模块的规格，请按需 Read 对应文件。',
      '',
    ];
    for (const item of readingListItems) {
      try {
        const raw = await readFile(item.path, 'utf-8');
        const lines = raw.split(/\r?\n/);
        // 提取第一个 # 标题
        const titleLine = lines.find(l => l.startsWith('#')) || '';
        const title = titleLine.replace(/^#+\s*/, '').trim() || item.name;
        // 提取 ## 标签（前 5 个二级标题）
        const sections = lines
          .filter(l => l.startsWith('## ') && !l.includes('<!--'))
          .slice(0, 5)
          .map(l => l.replace(/^##\s*/, '').trim());
        // 首段摘要（标题后第一个非空段落，最多 120 字）
        let summary = '';
        let foundTitle = false;
        for (const l of lines) {
          if (l.startsWith('#')) { foundTitle = true; continue; }
          if (foundTitle && l.trim()) {
            summary = l.trim().slice(0, 120);
            if (l.trim().length > 120) summary += '...';
            break;
          }
        }
        const relPath = relative(cwd, item.path);
        listLines.push(`### ${item.feature}/${item.name}`);
        listLines.push(`- **文件**: \`${relPath}\``);
        listLines.push(`- **标题**: ${title}`);
        if (sections.length > 0) listLines.push(`- **章节**: ${sections.join(' | ')}`);
        if (summary) listLines.push(`- **摘要**: ${summary}`);
        listLines.push('');
      } catch { /* 忽略读取失败 */ }
    }
    listLines.push('---');
    listLines.push('💡 **使用方式**: 如果预加载的任务规格不足以理解实现细节，请打开对应文件查看完整规格。');
    extras.push({
      name: '📚 迭代层端级规格阅读清单',
      path: 'reading-list.md',
      content: listLines.join('\n'),
    });
  }

  return extras;
}

/**
 * v8.3.15+: 扫描用户自定义文档
 * 扫描 00-specs/ 和子任务目录下所有 .md/.yaml/.yml/.json 文件
 * 排除白名单已覆盖的文件和系统目录
 */
async function scanUserCustomFiles(
  cwd: string,
  taskDir: string,
  platform: string | undefined,
  seenPaths: Set<string>,
): Promise<{ name: string; path: string }[]> {
  const results: { name: string; path: string }[] = [];
  const validExts = ['.md', '.yaml', '.yml', '.json', '.html', '.htm'];
  const skipDirs = new Set(['.meta', '.git', 'node_modules', 'tests', 'src', 'dist', 'build']);

  // 1. 扫描 00-specs/ 下所有文件（排除已在白名单中的）
  const specsDir = join(cwd, taskDir, '00-specs');
  try {
    if (await pathExists(specsDir)) {
      const entries = await readdir(specsDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) continue;
        const ext = e.name.slice(e.name.lastIndexOf('.'));
        if (!validExts.includes(ext)) continue;
        const relPath = join('00-specs', e.name);
        const fullPath = join(cwd, taskDir, relPath);
        if (!seenPaths.has(fullPath)) {
          results.push({ name: `用户补充/${e.name}`, path: relPath });
        }
      }
    }
  } catch { /* 忽略 */ }

  // 2. 扫描子任务目录下所有文件（递归）
  if (platform) {
    const platformBase = join(cwd, taskDir, platform);
    try {
      if (await pathExists(platformBase)) {
        const subtaskEntries = await readdir(platformBase, { withFileTypes: true });
        for (const subE of subtaskEntries) {
          if (!subE.isDirectory() || subE.name.startsWith('.')) continue;
          const subtaskDir = join(platformBase, subE.name);
          await scanDirRecursive(subtaskDir, join(platform, subE.name), results, seenPaths, skipDirs, validExts, cwd, taskDir);
        }
      }
    } catch { /* 忽略 */ }
  }

  return results;
}

/** 递归扫描目录，收集用户自定义文档 */
async function scanDirRecursive(
  dir: string,
  relPrefix: string,
  results: { name: string; path: string }[],
  seenPaths: Set<string>,
  skipDirs: Set<string>,
  validExts: string[],
  cwd: string,
  taskDir: string,
): Promise<void> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const relPath = join(relPrefix, e.name);
      const fullPath = join(cwd, taskDir, relPath);

      if (e.isDirectory()) {
        if (skipDirs.has(e.name) || e.name.startsWith('.')) continue;
        await scanDirRecursive(join(dir, e.name), relPath, results, seenPaths, skipDirs, validExts, cwd, taskDir);
      } else if (e.isFile()) {
        const ext = e.name.slice(e.name.lastIndexOf('.'));
        if (!validExts.includes(ext)) continue;
        if (!seenPaths.has(fullPath)) {
          results.push({ name: `用户补充/${relPath}`, path: relPath });
        }
      }
    }
  } catch { /* 忽略读取失败的目录 */ }
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
  // v8.3.94+: 读取视觉模型配置（用于 specs 图片理解）
  const visionConfig = await loadVisionConfig(cwd);

  const addFile = async (fullPath: string, name: string, relPath: string) => {
    if (seen.has(fullPath)) return;
    seen.add(fullPath);
    if (!(await pathExists(fullPath))) return;
    let rawContent = await readFile(fullPath, 'utf-8');
    // v8.3.122+: HTML 原型文件保留完整内容（CSS/JS/结构），不再提取纯文本
    const isHtml = fullPath.endsWith('.html') || fullPath.endsWith('.htm');
    let content = rawContent;
    // v8.3.93+: Markdown 链接自动展开 + 图片提取
    if (fullPath.endsWith('.md')) {
      content = await processMarkdownContent(content, fullPath, seen, visionConfig, {
        maxLinkDepth: 2, maxLinkChars: 1500, maxSvgChars: 2000,
      });
    }
    if (content.trim().length <= 50 || content.trim().match(/^#+\s*待填充|^<!--\s*AI-FILL\s*-->$/m)) return;
    if (content.length > MAX_PER_FILE) {
      content = content.slice(0, MAX_PER_FILE) + `\n\n> ... (已截断，原文件 ${rawContent.length} 字，完整内容请 Read: ${fullPath})`;
    }
    if (totalChars + content.length > MAX_TOTAL) return;
    totalChars += content.length;
    extras.push({ name, path: relPath, content });
  };

  // 1. 递归扫描任务目录所有 .md / .yaml 文件
  // 排除自检/审查/产出阶段文件（这些在代码生成后的 verify 阶段才需要）
  // 排除非代码目录（保留 10-backend/20-frontend 排除项以兼容旧项目数据）
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
          // v8.3.125+: 如果有 platform，根目录下只扫描匹配的端 + _shared
          if (platform && prefix === '' && item.name !== '_shared' && item.name !== platform) continue;
          await scanTaskDir(fullPath, `${prefix}${item.name}/`);
        } else if (/\.(md|yaml|yml|html|htm)$/i.test(item.name)) {
          // 排除自检阶段文件（TEST.md / SCHEMA.md / REVIEW.md 等）
          if (CODEGEN_EXCLUDE_FILES.has(item.name.toLowerCase())) continue;
          await addFile(fullPath, `${prefix}${item.name}`, `${prefix}${item.name}`);
        }
      }
    } catch { /* 跳过 */ }
  };
  await scanTaskDir(taskDir, '');

  // 1b. 单独读取 00-specs/DEV_GUIDE.md（被 CODEGEN_EXCLUDE_DIRS 排除，但开发指南是 execute 的核心输入）
  const devGuidePath = join(taskDir, '00-specs', 'DEV_GUIDE.md');
  await addFile(devGuidePath, '开发指南', '00-specs/DEV_GUIDE.md');

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
        // 2b. overview/ 子目录下的全局文档（v6.78.0+ 新路径，兼容旧版 global/）
        const overviewDir = join(specsDir, GLOBAL_SPECS_DIR);
        if (await pathExists(overviewDir)) {
          const overviewItems = await readdir(overviewDir, { withFileTypes: true });
          for (const item of overviewItems) {
            if (!item.name.endsWith('.md') || isTimestampBackup(item.name)) continue;
            await addFile(join(overviewDir, item.name), `迭代综合规格: ${item.name}`, `020-specs/${GLOBAL_SPECS_DIR}/${item.name}`);
          }
        }
        // v8.3.21+: 各端规格 — 扫描 020-specs/{feature}/{platform}/ 下的文档
        if (platform) {
          try {
            const features = await parseFeatureList(iterDir);
            for (const feature of features) {
              const featurePlatDir = join(specsDir, feature, platform);
              if (await pathExists(featurePlatDir)) {
                const platItems = await readdir(featurePlatDir, { withFileTypes: true });
                for (const item of platItems) {
                  if (!item.name.endsWith('.md') || isTimestampBackup(item.name)) continue;
                  await addFile(join(featurePlatDir, item.name), `${feature}-${platform}端规格: ${item.name}`, `020-specs/${feature}/${platform}/${item.name}`);
                }
              }
            }
          } catch { /* ignore */ }
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

/** 技能文件描述 */
const SKILLS_DESC: Record<string, string> = {
  'caching.md': '缓存策略与 Redis 最佳实践',
  'deployment.md': '部署与发布流程',
  'db-migration.md': '数据库迁移规范',
  'logging.md': '日志与监控',
};

/**
 * 从 Markdown frontmatter 中提取 priority（数值越高越优先）
 * v8.3.134+: 用于 RULES/ 自动注入排序
 */
function extractPriority(content: string): number {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (match) {
    const priorityMatch = match[1].match(/priority:\s*(\d+)/);
    if (priorityMatch) return parseInt(priorityMatch[1], 10);
  }
  return 50; // 默认优先级
}

/**
 * 从 Markdown 文件中提取 ## 标题行
 */
function extractHeadings(content: string): string[] {
  const headings: string[] = [];
  for (const line of content.split(/\r?\n/)) {
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
  const lines = content.split(/\r?\n/);
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
    lineCount: content.split(/\r?\n/).length,
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

  // 7. SKILLS/ 技术能力库（v8.3.134+ 四层架构：TOC 可见性）
  const skillsDir = join(speccoreDir, 'SKILLS');
  if (await pathExists(skillsDir)) {
    const files = await readdir(skillsDir);
    for (const f of files.filter(f => f.endsWith('.md') && !isTimestampBackup(f))) {
      const content = await readFile(join(skillsDir, f), 'utf-8');
      toc.push(buildTOCEntry(`SKILLS:${f}`, SKILLS_DESC[f] || f.replace('.md', ''), content));
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
  platform?: string
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

  // v8.3.132+: 关键全局文件自动全文注入
  // 支持单文件（兼容旧路径）+ BUSINESS_RULES/ 目录（推荐，支持按 platform 过滤）
  if (!ctx.keyFileSummaries) ctx.keyFileSummaries = [];

  // 1. 兼容旧路径：GLOBAL/BUSINESS_RULES.md
  const legacyPath = join(globalDir, 'BUSINESS_RULES.md');
  if (await pathExists(legacyPath)) {
    try {
      const content = await readFile(legacyPath, 'utf-8');
      ctx.keyFileSummaries.push({ path: 'BUSINESS_RULES.md', content: content.slice(0, 4000) });
    } catch { /* 忽略 */ }
  }

  // 2. 新路径：GLOBAL/BUSINESS_RULES/ 目录，按 platform 过滤加载
  const businessRulesDir = join(globalDir, 'BUSINESS_RULES');
  if (await pathExists(businessRulesDir)) {
    try {
      const files = (await readdir(businessRulesDir))
        .filter(f => f.endsWith('.md'))
        .sort();
      for (const file of files) {
        // platform 过滤：无 platform 时加载全部；有 platform 时加载 common + 匹配端
        if (platform) {
          const base = file.replace(/\.md$/, '');
          const isCommon = base.includes('-common');
          const isPlatformMatch = base === platform || base.endsWith(`-${platform}`) || base.includes(`-${platform}-`);
          if (!isCommon && !isPlatformMatch) continue;
        }
        const content = await readFile(join(businessRulesDir, file), 'utf-8');
        ctx.keyFileSummaries.push({ path: `BUSINESS_RULES/${file}`, content: content.slice(0, 4000) });
      }
    } catch { /* 忽略 */ }
  }

  // 3. v8.3.134+: RULES/ 规则文件自动注入（四层架构第二层）
  // 按 frontmatter priority 降序排序，优先加载高优先级规则；总量上限 8000 字符
  const rulesDir = join(cwd, '.speccore', 'RULES');
  if (await pathExists(rulesDir)) {
    try {
      const files = (await readdir(rulesDir))
        .filter(f => f.endsWith('.md') && !isTimestampBackup(f));
      const withPriority = await Promise.all(
        files.map(async f => {
          const content = await readFile(join(rulesDir, f), 'utf-8');
          return { file: f, content, priority: extractPriority(content) };
        })
      );
      withPriority.sort((a, b) => b.priority - a.priority);
      let injectedChars = 0;
      const MAX_RULES_CHARS = 8000;
      const MAX_PER_FILE = 2000;
      for (const { file, content } of withPriority) {
        if (injectedChars >= MAX_RULES_CHARS) break;
        const sliceLen = Math.min(MAX_PER_FILE, MAX_RULES_CHARS - injectedChars, content.length);
        ctx.keyFileSummaries.push({ path: `RULES/${file}`, content: content.slice(0, sliceLen) });
        injectedChars += sliceLen;
      }
    } catch { /* 忽略 */ }
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

  // v8.3.129+: 关键全局文件（BUSINESS_RULES.md 等）自动注入
  if (ctx.keyFileSummaries && ctx.keyFileSummaries.length > 0) {
    lines.push('### 📋 关键全局规则（已注入）');
    for (const kf of ctx.keyFileSummaries) {
      lines.push(`\n**📄 ${kf.path}**`);
      lines.push(kf.content);
      lines.push('');
    }
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
      { label: '**🛠 技术能力库**', prefix: 'SKILLS:', basePath: '.speccore/SKILLS/' },
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
        // v8.2.0+: PATTERNS 通用分类（始终保留）
        // v8.3.0+: 增加 shared（跨端共享模式）
        const PATTERN_COMMON_CATEGORIES = new Set(['architecture', 'data-model', 'api-contract', 'security', 'performance', 'shared', 'TEMPLATES', 'README']);

        for (const e of entries) {
          // PATTERNS:architecture/x.md → architecture; platforms/admin/x.md → admin
          const sub = group.prefix === 'PATTERNS:'
            ? e.path.replace('PATTERNS:', '').split(/[\\/]/)[0]
            : e.path.split(/[\\/]/)[1];

          // v8.2.0+: PATTERNS 按端过滤 — 只保留通用分类 + 当前端相关模式
          if (group.prefix === 'PATTERNS:' && platform) {
            const isCommon = PATTERN_COMMON_CATEGORIES.has(sub);
            const isCurrentPlatform = sub === platform;
            if (!isCommon && !isCurrentPlatform) continue; // 跳过不相关的端专属模式
          }

          if (!bySub.has(sub)) bySub.set(sub, []);
          bySub.get(sub)!.push(e);
        }

        // 如果没有匹配到任何条目，跳过该组
        if (bySub.size === 0) {
          lines.pop(); // 移除 group.label
          continue;
        }

        for (const [sub, subEntries] of bySub) {
          const isCurrent = (group.prefix === 'platforms/' || group.prefix === 'PATTERNS:') && sub === platform;
          const marker = isCurrent ? ' ⬅ 当前端' : '';
          const commonMarker = group.prefix === 'PATTERNS:' && PATTERN_COMMON_CATEGORIES.has(sub) ? ' 🌐 通用' : '';
          lines.push(`📂 ${sub}/${marker}${commonMarker}`);
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
    lines.push('- SKILLS/ 下的文件：路径相对于 `.speccore/SKILLS/`');
    lines.push('- 建议根据当前任务需要选择性阅读，不必全部读取');
    lines.push('');

    // v8.3.134+: 四层架构 — 阅读清单指引
    lines.push('### 📋 阅读清单（何时该读什么）');
    lines.push('| 场景 | 推荐读取 | 原因 |');
    lines.push('|:---|:---|:---|');
    lines.push('| **编写代码前** | `RULES/` 中标记 `appliesTo` 匹配当前技术栈的规则 | 确保代码符合项目规范 |');
    lines.push('| **设计 API/数据库** | `RULES/api-design.md` + `RULES/database.md` | 统一接口格式和表设计 |');
    lines.push('| **实现复杂功能** | `SKILLS/` 中 tags 匹配当前场景的技能文档 | 参考最佳实践，避免踩坑 |');
    lines.push('| **全局分析阶段** | `PATTERNS/` 中通用分类 + 当前端专属模式 | 复用已沉淀的架构模式 |');
    lines.push('| **排查性能问题** | `SKILLS/caching.md` + `PATTERNS/performance/` | 缓存策略和性能优化模式 |');
    lines.push('| **代码审查前** | `RULES/CODE_REVIEW.md` | 对照检查清单逐项核对 |');
    lines.push('');
    lines.push('> **四层覆盖策略**：TOC 目录（知道有）→ 自动注入（关键规则必达）→ RAG 检索（语义召回）→ 阅读清单（按需查阅）');
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
    '4. **Read `020-specs/{功能模块}/{端名}/TECH.md`**（按功能模块×端组合读取）→ 了解各端技术方案',
    '   - 先读 FUNCTION_MAP.md 获取功能模块清单',
    '   - 再按 `020-specs/{功能模块}/{端名}/TECH.md` 读取该功能在各端的技术方案',
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
        '',
        '## 🔍 信息充足性自检（v8.3.124+）',
        '',
        '生成代码前，必须先评估当前上下文是否充足：',
        '1. **检查 API 契约**：所有接口的入参、出参、错误码是否都已明确？',
        '2. **检查数据模型**：Entity 的字段类型、约束、关系是否完整？',
        '3. **检查依赖服务**：是否需要调用其他 Service/Module，但其接口未提供？',
        '4. **检查公共模块**：是否需要使用通用工具类、拦截器、中间件，但未提供其签名？',
        '5. **检查前端映射**：UI 字段→API 字段的映射是否完整？',
        '',
        '如果存在信息缺口，在代码文件的注释中标注 `[INFO_GAP: 具体缺什么]`，例如：',
        '- `// [INFO_GAP: 缺少 UserService.findById 的返回类型定义]`',
        '- `// [INFO_GAP: 不知道 OrderStatus 枚举的完整取值]`',
        '- `// [INFO_GAP: 缺少支付回调接口的签名]`',
        '',
        '**要求**：',
        '- 每发现一个缺口就标注一个 `[INFO_GAP: ...]`',
        '- 不要假设缺失的信息「应该就是这样」，必须标注',
        '- INFO_GAP 标注不影响代码生成，但为后续补充提供精确目标',
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
        '',
        '## 计划制定原则',
        '',
        '1. **参考 DEV_GUIDE.md 改造顺序** — 每个任务的 DEV_GUIDE.md 中都有「实施步骤（按依赖排序）」，排计划时必须尊重这些依赖关系',
        '2. **拓扑排序确定执行顺序** — 先执行被依赖的任务，再执行依赖方',
        '3. **识别可并行的 Task 批次** — 无依赖关系的任务可以并行',
        '4. **参考 RISK.md 和 .issues.md** — 高风险任务和有已知问题的任务应安排更充裕的时间或提前验证',
        '5. **分配负责人** — 根据技能匹配分配',
        '6. **估算工作量和里程碑** — 基于改造范围和接口数量估算',
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
  const cwd = options.cwd || findProjectRoot() || process.cwd();
  const techStack = await loadTechStack(cwd);
  const taskDir = options.taskDir || '';

  // P0-1: 统一读取 REQ.md，避免 loadApiSpecs/loadDataModels/loadBusinessRules 各读一次
  const reqContent = taskDir ? await loadReqContent(cwd, taskDir) : null;
  const apiSpecs = await loadApiSpecs(cwd, taskDir, reqContent || undefined);
  const dataModels = await loadDataModels(cwd, taskDir, reqContent || undefined);
  const businessRules = await loadBusinessRules(cwd, taskDir, reqContent || undefined);

  // 统一检索层：同时查询文档 RAG + 代码切片 + 知识图谱
  let extraSpecs: TaskExtraSpec[] = [];

  // v8.3.123+: analyze/split 阶段也需要统一检索，从迭代需求提取查询词
  let searchQuery = options.task || options.iteration || '';
  if (reqContent) {
    const titleMatch = reqContent.match(/^#\s+(.+)$/m);
    if (titleMatch) searchQuery = titleMatch[1].trim();
  } else if ((command === 'analyze' || command === 'split') && options.iteration) {
    try {
      const iterDir = await getIterationDir(options.iteration);
      if (iterDir) {
        const reqIndex = join(iterDir, '010-requirements', 'INDEX.md');
        if (await pathExists(reqIndex)) {
          const idxContent = await readFile(reqIndex, 'utf-8');
          const titleMatch = idxContent.match(/^#\s+(.+)$/m);
          if (titleMatch) searchQuery = titleMatch[1].trim();
        } else {
          // 尝试读取第一个需求文档
          const reqDir = join(iterDir, '010-requirements');
          const reqFiles = (await readdir(reqDir).catch(() => [] as string[]))
            .filter(f => f.endsWith('.md') && !f.startsWith('.'));
          if (reqFiles.length > 0) {
            const firstReq = await readFile(join(reqDir, reqFiles[0]), 'utf-8');
            const titleMatch = firstReq.match(/^#\s+(.+)$/m);
            if (titleMatch) searchQuery = titleMatch[1].trim();
          }
        }
      }
    } catch { /* 忽略需求读取失败 */ }
  }

  const shouldSearchUnified = !!taskDir || command === 'analyze' || command === 'split';
  if (shouldSearchUnified && options.iteration) {
    try {
      const unifiedResult = await unifiedSearch(cwd, {
        query: searchQuery,
        iteration: options.iteration,
        taskId: options.task,
        platform: options.platform,
        taskDir: taskDir || undefined,
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

    // 回退：统一检索失败或结果为空时，用传统截断模式（仅 taskDir 存在时）
    if (extraSpecs.length === 0 && taskDir) {
      extraSpecs = await loadExtraSpecs(cwd, taskDir, options.platform, options.iteration, {
        maxCharsPerFile: 2000,
        maxTotalChars: 8000,
      });
      if (extraSpecs.length > 0) {
        logger?.info?.(`   📄 传统模式: ${extraSpecs.length} 个参考文档已加载`);
      }
    }

    // 稀疏检测 + 全量兜底：检索内容不足时，读取所有内容（仅 taskDir 存在时）
    if (taskDir) {
      const SPARSE_THRESHOLD = 3000;
      const currentChars = extraSpecs.reduce((sum, s) => sum + s.content.length, 0);
      if (currentChars < SPARSE_THRESHOLD) {
        let fallbackGraph: KnowledgeGraph | null = null;
        try {
          fallbackGraph = await loadFreshKnowledgeGraph(cwd, options.iteration);
        } catch { /* 图谱不可用时跳过 */ }

        const fullContext = await loadAllTaskContext(cwd, taskDir, options.platform, options.iteration, fallbackGraph || undefined);
        if (fullContext.length > extraSpecs.length) {
          extraSpecs = fullContext;
          logger?.info?.(`   📚 全量兜底: ${fullContext.length} 个文件 (检索内容不足 ${currentChars} < ${SPARSE_THRESHOLD})`);
        }
      }
    }
  }

    // v8.3.122+: execute / analyze 时深入读取关联源码（完整文件内容，不只是切片）
  // v8.3.122++: 同时注入知识图谱任务上下文，帮助 AI 理解代码关联关系
  if ((command === 'execute' || command === 'analyze') && searchQuery) {
    try {
      // v8.3.124+: execute 阶段优先注入结构化事实卡片（structured-data.json）
      // 这是最高优先级的改进：用结构化卡片替代原始源码，Token 效率提升 10-20 倍
      const structuredDataPath = join(cwd, '.speccore', 'cache', 'structured-data.json');
      let structuredCardsInjected = false;
      if (await pathExists(structuredDataPath)) {
        try {
          const sdContent = await readFile(structuredDataPath, 'utf-8');
          const structured = JSON.parse(sdContent);
          // v8.3.125+: 使用同义词扩展，解决 "登录" 与 "auth" 等跨语言/缩写不匹配
          const queryWords = [...expandSynonyms(extractNormalizedKeywords(searchQuery))];
          const matchedApis: any[] = [];
          const matchedEntities: any[] = [];
          const matchedComponents: any[] = [];
          const matchedRoutes: any[] = [];
          const matchedDtos: any[] = [];      // v8.3.126+
          const matchedServices: any[] = [];  // v8.3.126+

          for (const [platform, data] of Object.entries(structured.endpoints || {}) as [string, any][]) {
            // API 匹配
            for (const api of data.apis || []) {
              const text = `${api.path || ''} ${api.handler || ''} ${api.description || ''}`.toLowerCase();
              if (queryWords.some(qw => text.includes(qw))) matchedApis.push({ ...api, platform });
            }
            // Entity 匹配
            for (const entity of data.entities || []) {
              const text = `${entity.name || ''} ${entity.tableName || ''} ${entity.description || ''}`.toLowerCase();
              if (queryWords.some(qw => text.includes(qw))) matchedEntities.push({ ...entity, platform });
            }
            // Component 匹配
            for (const comp of data.components || []) {
              const text = `${comp.name || ''} ${comp.description || ''}`.toLowerCase();
              if (queryWords.some(qw => text.includes(qw))) matchedComponents.push({ ...comp, platform });
            }
            // Route 匹配
            for (const route of data.routes || []) {
              const text = `${route.path || ''} ${route.component || ''}`.toLowerCase();
              if (queryWords.some(qw => text.includes(qw))) matchedRoutes.push({ ...route, platform });
            }
          }

          // v8.3.126+: 全局 DTO 匹配（跨平台）
          for (const dto of structured.dtos || []) {
            const text = `${dto.name || ''} ${dto.fields?.map((f: any) => f.name).join(' ') || ''}`.toLowerCase();
            if (queryWords.some(qw => text.includes(qw))) matchedDtos.push(dto);
          }
          // v8.3.126+: 全局 Service 匹配（跨平台）
          for (const svc of structured.services || []) {
            const text = `${svc.name || ''} ${svc.methods?.map((m: any) => m.name).join(' ') || ''}`.toLowerCase();
            if (queryWords.some(qw => text.includes(qw))) matchedServices.push(svc);
          }

          const cardLines: string[] = ['## 📇 结构化代码事实卡片（自动提取）'];
          cardLines.push('> 以下信息从代码扫描工具提取的结构化数据生成，信息密度高于原始源码。如需查看具体实现，参考下方源码文件。\n');

          if (matchedApis.length > 0) {
            cardLines.push(`### API 接口 (${matchedApis.length} 个匹配)`);
            for (const api of matchedApis.slice(0, 8)) {
              cardLines.push(`\n**${api.method || 'GET'} ${api.path || '/'}** — \`${api.handler}\``);
              cardLines.push(`- 📁 文件: \`${api.filePath}\`:${api.line}`);
              // v8.3.124+: 优先展示详细参数信息（含类型、装饰器、校验规则）
              if (api.parameterDetails && api.parameterDetails.length > 0) {
                const paramLines = api.parameterDetails.map((p: any) => {
                  let s = `  - \`${p.name}\`${p.type ? `:\`${p.type}\`` : ''}${p.required === false ? ' (可选)' : ''}`;
                  if (p.decorators && p.decorators.length > 0) s += ` 装饰:${p.decorators.map((d: string) => `\`${d}\``).join(',')}`;
                  if (p.validationRules && p.validationRules.length > 0) s += ` 校验:${p.validationRules.map((v: string) => `\`${v}\``).join(',')}`;
                  return s;
                });
                cardLines.push(`- 📥 参数:`);
                cardLines.push(...paramLines.slice(0, 6));
                if (paramLines.length > 6) cardLines.push(`  ...等${paramLines.length}个参数`);
              } else if (api.parameters && api.parameters.length > 0) {
                cardLines.push(`- 📥 参数: ${api.parameters.join(', ')}`);
              }
              if (api.dtoRef) cardLines.push(`- 📦 DTO: \`${api.dtoRef}\``);
              if (api.responseType) cardLines.push(`- 📤 返回: \`${api.responseType}\``);
              if (api.authDecorators && api.authDecorators.length > 0) {
                cardLines.push(`- 🔐 鉴权: ${api.authDecorators.map((d: string) => `\`${d}\``).join(', ')}`);
              }
              if (api.decorators && api.decorators.length > 0) cardLines.push(`- 🏷️ 路由装饰器: ${api.decorators.map((d: string) => `\`${d}\``).join(', ')}`);
              // v8.3.125+: Service 调用链
              if (api.serviceCalls && api.serviceCalls.length > 0) {
                const callStrs = api.serviceCalls.slice(0, 5).map((c: any) => `\`${c.service}.${c.method}\``);
                cardLines.push(`- 🔗 调用链: ${callStrs.join(' → ')}${api.serviceCalls.length > 5 ? ` ...等${api.serviceCalls.length}个` : ''}`);
              }
              if (api.description) cardLines.push(`- 📝 说明: ${api.description}`);
            }
          }

          if (matchedEntities.length > 0) {
            cardLines.push(`\n### 数据实体 (${matchedEntities.length} 个匹配)`);
            for (const entity of matchedEntities.slice(0, 6)) {
              cardLines.push(`\n**${entity.name}**${entity.tableName ? ` (表: \`${entity.tableName}\`)` : ''}`);
              cardLines.push(`- 📁 文件: \`${entity.filePath}\`:${entity.line}`);
              if (entity.fields && entity.fields.length > 0) {
                const fieldStrs = entity.fields.slice(0, 8).map((f: any) => {
                  let s = `\`${f.name}\`: ${f.type}`;
                  if (f.isPrimaryKey) s += ' [PK]';
                  if (f.nullable) s += ' ?';
                  if (f.defaultValue !== undefined) s += ` =${f.defaultValue}`;
                  // v8.3.124+: 展示列配置和校验规则
                  if (f.columnOptions && Object.keys(f.columnOptions).length > 0) {
                    const opts = Object.entries(f.columnOptions).map(([k, v]) => `${k}:${v}`).join(',');
                    s += ` {${opts}}`;
                  }
                  if (f.validationRules && f.validationRules.length > 0) s += ` [${f.validationRules.map((v: string) => `\`${v}\``).join(',')}]`;
                  return s;
                });
                cardLines.push(`- 🏗️ 字段: ${fieldStrs.join(', ')}${entity.fields.length > 8 ? ` ...等${entity.fields.length}个` : ''}`);
              }
              if (entity.indexes && entity.indexes.length > 0) {
                const idxStrs = entity.indexes.map((idx: any) => {
                  let s = `${idx.fields.join('+')}`;
                  if (idx.unique) s += '(唯一)';
                  if (idx.name) s = `${idx.name}:${s}`;
                  return s;
                });
                cardLines.push(`- 📇 索引: ${idxStrs.join('; ')}`);
              }
              if (entity.constraints && entity.constraints.length > 0) {
                cardLines.push(`- ⛓️ 约束: ${entity.constraints.map((c: any) => `${c.type}(${c.fields.join('+')})`).join('; ')}`);
              }
              if (entity.relations && entity.relations.length > 0) {
                cardLines.push(`- 🔗 关系: ${entity.relations.map((r: any) => `${r.type} → ${r.target}`).join(', ')}`);
              }
            }
          }

          if (matchedComponents.length > 0) {
            cardLines.push(`\n### 前端组件 (${matchedComponents.length} 个匹配)`);
            for (const comp of matchedComponents.slice(0, 6)) {
              cardLines.push(`\n**${comp.name}** — \`${comp.filePath}\`:${comp.line}`);
              if (comp.props && comp.props.length > 0) cardLines.push(`- Props: ${comp.props.join(', ')}`);
            }
          }

          if (matchedRoutes.length > 0) {
            cardLines.push(`\n### 页面路由 (${matchedRoutes.length} 个匹配)`);
            for (const route of matchedRoutes.slice(0, 6)) {
              cardLines.push(`- \`${route.path}\` → ${route.component || 'unknown'}${route.lazy ? ' (lazy)' : ''}`);
            }
          }

          // v8.3.126+: DTO 定义展示
          if (matchedDtos.length > 0) {
            cardLines.push(`\n### DTO 定义 (${matchedDtos.length} 个匹配)`);
            for (const dto of matchedDtos.slice(0, 6)) {
              cardLines.push(`\n**${dto.name}** — \`${dto.filePath}\`:${dto.line}`);
              if (dto.fields && dto.fields.length > 0) {
                const fieldStrs = dto.fields.slice(0, 10).map((f: any) => {
                  let s = `\`${f.name}\`: ${f.type}`;
                  if (f.required === false) s += ' (可选)';
                  if (f.validationRules && f.validationRules.length > 0) s += ` [${f.validationRules.map((v: string) => `\`${v}\``).join(',')}]`;
                  return s;
                });
                cardLines.push(`- 🏷️ 字段: ${fieldStrs.join(', ')}${dto.fields.length > 10 ? ` ...等${dto.fields.length}个` : ''}`);
              }
            }
          }

          // v8.3.126+: Service 定义展示
          if (matchedServices.length > 0) {
            cardLines.push(`\n### Service 定义 (${matchedServices.length} 个匹配)`);
            for (const svc of matchedServices.slice(0, 6)) {
              cardLines.push(`\n**${svc.name}** — \`${svc.filePath}\`:${svc.line}`);
              if (svc.injects && svc.injects.length > 0) {
                cardLines.push(`- 💉 注入: ${svc.injects.map((i: string) => `\`${i}\``).join(', ')}`);
              }
              if (svc.methods && svc.methods.length > 0) {
                const methodStrs = svc.methods.slice(0, 8).map((m: any) => {
                  const params = m.parameters?.map((p: any) => `${p.name}${p.type ? `:${p.type}` : ''}`).join(', ') || '';
                  return `\`${m.name}(${params})${m.returnType ? ": " + m.returnType : ''}\``;
                });
                cardLines.push(`- ⚙️ 方法: ${methodStrs.join(', ')}${svc.methods.length > 8 ? ` ...等${svc.methods.length}个` : ''}`);
              }
            }
          }

          if (matchedApis.length > 0 || matchedEntities.length > 0 || matchedComponents.length > 0 || matchedRoutes.length > 0 || matchedDtos.length > 0 || matchedServices.length > 0) {
            extraSpecs.push({
              name: '📇 结构化代码事实卡片',
              path: 'structured-data-cards.md',
              content: cardLines.join('\n'),
            });
            const cardChars = cardLines.join('\n').length;
            logger?.info?.(`   📇 结构化卡片: ${matchedApis.length} API + ${matchedEntities.length} Entity + ${matchedComponents.length} Component + ${matchedRoutes.length} Route + ${matchedDtos.length} DTO + ${matchedServices.length} Service (${Math.round(cardChars / 1000)}K 字符)`);
            structuredCardsInjected = true;
          }
        } catch { /* 结构化数据解析失败不阻断 */ }
      }

      const codeMatches = await findRelevantCode(searchQuery, 15, undefined, options.iteration, options.task);
      if (codeMatches.length > 0) {
        // v8.3.124+: 如果已注入结构化卡片，减少原始源码的文件数和长度
        const sourceMaxFiles = structuredCardsInjected ? 8 : 15;
        const sourceMaxBytes = structuredCardsInjected ? 60000 : 100000;
        const sourceContents = await readRelevantSource(codeMatches, sourceMaxBytes, sourceMaxFiles);
        const sourceKeys = Object.keys(sourceContents);
        if (sourceKeys.length > 0) {
          // v8.3.122+: execute 时注入知识图谱任务上下文
          // v8.3.125+: 自动检查过期并刷新
          if (command === 'execute' && options.iteration && options.task) {
            try {
              const kg = await loadFreshKnowledgeGraph(cwd, options.iteration);
              if (kg) {
                const ctx = getFullTaskContext(kg, options.task);
                const ctxLines: string[] = ['## 🔗 任务关联上下文（知识图谱）', ''];
                if (ctx.requirement) ctxLines.push(`- **上游需求**: ${ctx.requirement.title} (${ctx.requirement.file})`);
                if (ctx.parentTask) ctxLines.push(`- **父任务**: ${ctx.parentTask.title}`);
                if (ctx.dependsOn.length > 0) ctxLines.push(`- **依赖任务**（需先完成）: ${ctx.dependsOn.map(d => d.title).join(', ')}`);
                if (ctx.downstreamTasks.length > 0) ctxLines.push(`- **下游任务**（依赖本任务）: ${ctx.downstreamTasks.map(d => d.title).join(', ')}`);
                if (ctx.relatedSpecs.length > 0) {
                  ctxLines.push(`- **关联规格文档**:`);
                  for (const spec of ctx.relatedSpecs) {
                    ctxLines.push(`  - ${spec.title}: \`${spec.file}\``);
                  }
                }
                if (ctx.dependencyChain.length > 0) {
                  ctxLines.push(`- **依赖链路**: ${ctx.dependencyChain.map(c => c.taskName).join(' → ')}`);
                }
                extraSpecs.push({
                  name: '🔗 任务关联上下文',
                  path: 'kg-context.md',
                  content: ctxLines.join('\n'),
                });
              }
            } catch { /* 知识图谱加载失败不阻断 */ }
          }

          // v8.3.123+: analyze 时注入知识图谱迭代级上下文
          // v8.3.125+: 自动检查过期并刷新
          if (command === 'analyze' && options.iteration) {
            try {
              const kg = await loadFreshKnowledgeGraph(cwd, options.iteration);
              if (kg) {
                const compactCtx = buildCompactContext(kg, {});
                if (compactCtx) {
                  extraSpecs.push({
                    name: '🧠 知识图谱摘要',
                    path: 'kg-summary.md',
                    content: compactCtx,
                  });
                }
              }
            } catch { /* 知识图谱加载失败不阻断 */ }
          }

          // 按匹配得分排序注入源码，并附加匹配原因
          const sortedMatches = [...codeMatches].sort((a, b) => b.score - a.score);
          for (const match of sortedMatches.slice(0, sourceMaxFiles)) {
            const content = sourceContents[match.file];
            if (!content) continue;
            const reasons: string[] = [];
            if (match.score >= 50) reasons.push(`@spec 注释直接关联 (score:${match.score})`);
            else if (match.score >= 40) reasons.push(`知识图谱 source-file 实体关联 (score:${match.score})`);
            else if (match.score >= 35) reasons.push(`业务模块 codeEntities 关联 (score:${match.score})`);
            else if (match.score >= 25) reasons.push(`Spec 技术关键词匹配 (score:${match.score})`);
            else reasons.push(`关键词匹配 (score:${match.score})`);
            if (match.exports.length > 0) reasons.push(`导出: ${match.exports.join(', ')}`);
            if (match.apis.length > 0) reasons.push(`API: ${match.apis.join(', ')}`);
            extraSpecs.push({
              name: `🔍 ${basename(match.file)}`,
              path: match.file,
              content: `## 关联源码: ${match.file}\n> **匹配原因**: ${reasons.join(' | ')}\n\n\`\`\`${match.file.split('.').pop() || 'ts'}\n${content}\n\`\`\``,
            });
          }
          logger?.info?.(`   💻 深入源码: ${sourceKeys.length} 个完整文件已注入 (${Math.round(Object.values(sourceContents).reduce((a, c) => a + c.length, 0) / 1000)}K 字符)`);

          // v8.3.125+: 可选阅读清单 — 让宿主 AI 按需深入读取未预加载的关联文件
          // 解决 "8文件/60KB 限制导致大型功能读不全" 的问题
          const unreadMatches = sortedMatches.slice(sourceMaxFiles);
          if (unreadMatches.length > 0) {
            const optionalLines: string[] = [
              '## 📖 可选阅读清单（宿主 AI 按需读取）',
              '> 以下文件与当前任务高度相关，但因 Token 预算限制未完整预加载到上下文中。',
              '> 如果你的 IDE（Cursor / Claude Code / Windsurf）支持文件读取，可按需打开以下文件深入理解业务逻辑：',
              '',
            ];
            for (const match of unreadMatches.slice(0, 15)) {
              const reasons: string[] = [];
              if (match.score >= 50) reasons.push('@spec 注释直接关联');
              else if (match.score >= 40) reasons.push('知识图谱关联');
              else if (match.score >= 35) reasons.push('业务模块关联');
              else if (match.score >= 25) reasons.push('技术关键词匹配');
              else reasons.push('关键词匹配');
              if (match.exports.length > 0) reasons.push(`导出 ${match.exports.join(', ')}`);
              if (match.apis.length > 0) reasons.push(`API ${match.apis.join(', ')}`);
              optionalLines.push(`- \`${match.file}\` — ${reasons.join(' | ')} (score:${match.score})`);
            }
            if (unreadMatches.length > 15) {
              optionalLines.push(`\n... 还有 ${unreadMatches.length - 15} 个关联文件未列出`);
            }
            optionalLines.push('\n---');
            optionalLines.push('💡 **使用方式**: 如果上述预加载源码不足以理解实现细节，请打开对应文件查看完整代码。');
            extraSpecs.push({
              name: '📖 可选阅读清单',
              path: 'optional-reading.md',
              content: optionalLines.join('\n'),
            });
            logger?.info?.(`   📖 可选阅读清单: ${unreadMatches.length} 个关联文件（宿主 AI 可按需读取）`);
          }
        }
      }
    } catch (e) {
      logger?.debug?.('深入源码读取失败:', e);
    }
  }

  // v8.3.125+: execute 时注入 INFO_GAP 自动补充上下文（如果存在）
  if (command === 'execute' && options.task) {
    try {
      const supplementPath = join(cwd, '.speccore', 'cache', `info-gap-supplement-${options.task}.md`);
      if (await pathExists(supplementPath)) {
        const supplementContent = await readFile(supplementPath, 'utf-8');
        if (supplementContent.trim().length > 0) {
          extraSpecs.push({
            name: '📎 INFO_GAP 自动补充上下文',
            path: supplementPath,
            content: `## 📎 上一轮执行发现的信息缺口补充\n\n${supplementContent}`,
          });
          logger?.info?.(`   📎 已注入 INFO_GAP 补充上下文`);
        }
      }
    } catch { /* 忽略读取失败 */ }
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
            logger?.info?.(`   📋 已注入一致性校验报告: ${relative(cwd, ccPath)}`);
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
    const graph = await loadFreshKnowledgeGraph(cwd, options.iteration);
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
      const lines = ['## 📂 工程路径（代码输出位置）', '', '| 工程标识 | 工程类型 | 源码路径 | 对应需求端 |', '| :--- | :--- | :--- | :--- |'];
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

  // v6.93.0+: Prompt 插件系统 — 命令特定的增强逻辑由插件提供
  let rulesContent: string | undefined;
  let codeGraphSummary: string | undefined;
  let instruction = getInstruction(command, context);

  try {
    const pluginCtx = {
      cwd,
      command,
      iteration: options.iteration,
      task: options.task,
      taskDir: options.taskDir,
      platform: options.platform,
      techStack,
    };
    const plugins = getPluginsForCommand(command);
    for (const plugin of plugins) {
      const enhancement = await plugin.enhance(pluginCtx);
      if (enhancement.rulesContent) rulesContent = enhancement.rulesContent;
      if (enhancement.codeGraphSummary) codeGraphSummary = enhancement.codeGraphSummary;
      if (enhancement.instruction) instruction += enhancement.instruction;
      if (enhancement.projectPaths) projectPathsInfo = enhancement.projectPaths;
    }
  } catch {
    // 插件执行失败静默跳过，不影响主流程
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
    codeGraphSummary,
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

  // Level 2: 分层预算控制 extraSpecs（v8.3.125+ unit-context-assembler）
  // 优先级: P1(结构化卡片/源码/INFO_GAP) > P2(KG上下文) > P3(全局规范/一致性检查)
  if (prompt.extraSpecs.length > 0) {
    const BUDGET_P1 = 10000; // 高优先级: 结构化卡片、关联源码、INFO_GAP补充
    const BUDGET_P2 = 5000;  // 中优先级: 知识图谱上下文、任务关联链
    const BUDGET_P3 = 3000;  // 低优先级: 全局规范、一致性检查、项目路径

    function getPriority(spec: { name: string }): number {
      const n = spec.name;
      if (n.includes('结构化代码事实') || n.includes('INFO_GAP') || n.includes('关联源码')) return 1;
      if (n.includes('知识图谱') || n.includes('任务关联上下文')) return 2;
      return 3; // CONSISTENCY_CHECK、工程路径、全局规范等
    }

    const sorted = [...prompt.extraSpecs].sort((a, b) => getPriority(a) - getPriority(b));
    const budgeted: typeof prompt.extraSpecs = [];
    let usedP1 = 0, usedP2 = 0, usedP3 = 0;

    for (const spec of sorted) {
      const p = getPriority(spec);
      const len = spec.content.length;
      let keep = true;
      let content = spec.content;

      if (p === 1) {
        if (usedP1 + len > BUDGET_P1) {
          const remain = Math.max(0, BUDGET_P1 - usedP1);
          if (remain < 200) { keep = false; }
          else { content = content.slice(0, remain) + '\n> ... (P1预算截断)'; }
        }
        if (keep) usedP1 += content.length;
      } else if (p === 2) {
        if (usedP2 + len > BUDGET_P2) {
          const remain = Math.max(0, BUDGET_P2 - usedP2);
          if (remain < 200) { keep = false; }
          else { content = content.slice(0, remain) + '\n> ... (P2预算截断)'; }
        }
        if (keep) usedP2 += content.length;
      } else {
        if (usedP3 + len > BUDGET_P3) {
          const remain = Math.max(0, BUDGET_P3 - usedP3);
          if (remain < 200) { keep = false; }
          else { content = content.slice(0, remain) + '\n> ... (P3预算截断)'; }
        }
        if (keep) usedP3 += content.length;
      }

      if (keep) budgeted.push({ ...spec, content });
    }

    result = buildPromptText({ ...prompt, extraSpecs: budgeted });
    tokens = estimateTokens(result);
    if (tokens <= maxTokens) {
      const removed = prompt.extraSpecs.length - budgeted.length;
      logger?.info?.(`   🪶 Prompt 已简化：分层预算控制 (P1:${usedP1}/${BUDGET_P1} P2:${usedP2}/${BUDGET_P2} P3:${usedP3}/${BUDGET_P3}${removed > 0 ? ` 移除${removed}项` : ''})`);
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

  // v6.91.0+: 代码知识图谱摘要注入
  if (prompt.codeGraphSummary) {
    lines.push(prompt.codeGraphSummary);
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
/** v8.3.124+: 解析 AI 响应中的 INFO_GAP 标记 */
export function extractInfoGaps(response: string): string[] {
  const gaps: string[] = [];
  const regex = /\[INFO_GAP:\s*([^\]]+)\]/g;
  let match;
  while ((match = regex.exec(response)) !== null) {
    gaps.push(match[1].trim());
  }
  return [...new Set(gaps)]; // 去重
}

export function parseAiResponse(response: string): { files: { path: string; content: string }[]; infoGaps?: string[] } | null {
  // 先提取 INFO_GAP（即使 JSON 解析失败也能捕获）
  const infoGaps = extractInfoGaps(response);

  // 尝试从响应中提取 JSON
  const jsonMatch = response.match(/\{[\s\S]*"files"[\s\S]*\}/);
  if (!jsonMatch) {
    // 没有 JSON，但有 INFO_GAP，返回空文件列表 + gaps
    if (infoGaps.length > 0) return { files: [], infoGaps };
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.files && Array.isArray(parsed.files)) {
      return { files: parsed.files, infoGaps: infoGaps.length > 0 ? infoGaps : undefined };
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

// ═══════════════════════════════════════════════════════════
// Markdown 链接自动展开 + 图片提取（v8.3.93+）
// ═══════════════════════════════════════════════════════════

/** 提取 Markdown 文本链接 [text](path)，排除图片链接
 * v8.3.125+: 不再跳过外部链接 — 由调用方决定如何处理（收集到外链清单）
 */
function extractMarkdownLinks(content: string): Array<{ text: string; path: string }> {
  const links: Array<{ text: string; path: string }> = [];
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const text = match[1];
    const path = match[2].trim();
    // 跳过图片链接 ![alt](path) — 检查前一个字符
    if (match.index > 0 && content.charAt(match.index - 1) === '!') continue;
    // 跳过锚点和危险协议（保留 http/https/ftp 外链，由调用方处理）
    if (/^(mailto:|javascript:)/i.test(path)) continue;
    if (path.startsWith('#')) continue;
    links.push({ text, path });
  }
  return links;
}

/** 提取 Markdown 图片链接 ![alt](path) */
function extractMarkdownImages(content: string): Array<{ alt: string; path: string }> {
  const images: Array<{ alt: string; path: string }> = [];
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    images.push({ alt: match[1], path: match[2].trim() });
  }
  return images;
}

/** 判断是否为外部链接 */
function isExternalLink(path: string): boolean {
  return /^(https?:|mailto:|ftp:|javascript:)/i.test(path);
}

/** 解析链接相对路径 */
function resolveLinkPath(baseDir: string, linkPath: string): string {
  if (linkPath.startsWith('/')) return linkPath;
  return join(baseDir, linkPath);
}

/** 递归展开 Markdown 链接指向的文件内容（防循环，限深度） */
async function expandMarkdownLinks(
  content: string,
  baseDir: string,
  seenPaths: Set<string>,
  maxDepth: number = 2,
  currentDepth: number = 0,
  maxChars: number = 1500,
): Promise<string> {
  if (currentDepth >= maxDepth) return content;

  const links = extractMarkdownLinks(content);
  if (links.length === 0) return content;

  const expansions: string[] = [];
  // v8.3.125+: 收集外链资源，供宿主 AI 按需读取（用 Map 按 URL 去重）
  const externalLinks = new Map<string, string>(); // path -> text

  for (const link of links) {
    if (isExternalLink(link.path)) {
      externalLinks.set(link.path, link.text);
      continue;
    }
    const resolved = resolveLinkPath(baseDir, link.path);
    if (seenPaths.has(resolved)) continue;
    seenPaths.add(resolved);

    try {
      if (!await pathExists(resolved)) continue;
      const st = await stat(resolved);
      if (!st.isFile()) continue;

      let linkContent = await readFile(resolved, 'utf-8');
      // v8.3.122+: HTML 原型文件保留完整内容，不再提取纯文本
      if (resolved.endsWith('.html') || resolved.endsWith('.htm')) {
        // 保留原始 HTML（包含 CSS/JS/结构），让 AI 完整解析原型
      }
      if (linkContent.trim().length <= 30) continue;
      const isTruncated = linkContent.length > maxChars;
      if (isTruncated) {
        linkContent = linkContent.slice(0, maxChars) + `\n\n> ... (已截断，完整内容请 Read: ${resolved})`;
      }
      expansions.push(
        `\n\n<!-- 展开链接: ${link.path} -->\n**[链接展开] ${link.text}** (${link.path}):\n\n${linkContent}`
      );
    } catch { /* 忽略读取失败的链接文件 */ }
  }

  let expanded = content + expansions.join('');

  // v8.3.125+: 在内容末尾附加外链资源清单，提示宿主 AI 按需读取
  if (externalLinks.size > 0) {
    const externalSection = [
      '\n\n---',
      '📎 **外链资源清单**（CLI 无法直接获取内容，宿主 AI 可按需访问）：',
      ...Array.from(externalLinks.entries()).map(([path, text]) => `- [${text || '链接'}](${path})`),
    ].join('\n');
    expanded += externalSection;
  }

  // 递归展开新内容中的链接（深度 + 1）
  if (currentDepth + 1 < maxDepth) {
    return expandMarkdownLinks(expanded, baseDir, seenPaths, maxDepth, currentDepth + 1, maxChars);
  }
  return expanded;
}

/** inline Markdown 图片信息（SVG 直接读取，启用视觉模型时描述位图，其他记录元信息） */
async function inlineMarkdownImages(
  content: string,
  baseDir: string,
  seenPaths: Set<string>,
  visionConfig?: VisionModelConfig,
  maxSvgChars: number = 2000,
): Promise<string> {
  const images = extractMarkdownImages(content);
  if (images.length === 0) return content;

  const inlines: string[] = [];
  let visionCallCount = 0;
  const maxVisionCalls = visionConfig?.maxImagesPerPrompt ?? 10;
  // v8.3.125+: 收集外链图片，供宿主 AI 按需查看（用 Map 按 URL 去重）
  const externalImages = new Map<string, string>(); // path -> alt

  for (const img of images) {
    if (isExternalLink(img.path)) {
      externalImages.set(img.path, img.alt);
      inlines.push(`\n<!-- 外链图片: ${img.alt || '无描述'} | URL: ${img.path} -->`);
      continue;
    }
    const resolved = resolveLinkPath(baseDir, img.path);
    if (seenPaths.has(resolved)) continue;
    seenPaths.add(resolved);

    // SVG 直接 inline 其文本内容
    if (resolved.endsWith('.svg')) {
      try {
        if (await pathExists(resolved)) {
          const svgContent = await readFile(resolved, 'utf-8');
          if (svgContent.length <= maxSvgChars) {
            inlines.push(`\n<!-- SVG 图片: ${img.path} -->\n${svgContent}`);
          } else {
            inlines.push(`\n<!-- SVG 图片: ${img.path} (内容过长已省略，大小: ${svgContent.length} 字符) -->`);
          }
        }
      } catch { /* ignore */ }
    } else if (isVisionEnabled(visionConfig) && visionCallCount < maxVisionCalls) {
      // v8.3.94+: 调用视觉模型描述图片
      visionCallCount++;
      try {
        const result = await describeImage(resolved, visionConfig!);
        if (result.success) {
          inlines.push(
            `\n<!-- 图片描述 (视觉模型: ${visionConfig!.provider}): ${img.path} -->\n**[图片内容]** ${img.alt || '无描述'}\n\n${result.description}`
          );
        } else {
          // v8.3.138+: Vision 描述失败时，明确提示宿主 AI 打开文件查看
          inlines.push(`\n\n---\n🖼️ **图片文件**（视觉模型描述失败，宿主 AI 请直接打开查看）：\n- ${img.alt || '无描述'}: ${resolved}\n> 请打开此图片文件查看内容，以辅助理解需求。`);
        }
      } catch (e: any) {
        // v8.3.138+: 描述异常时，同样提示宿主 AI 打开查看
        inlines.push(`\n\n---\n🖼️ **图片文件**（视觉模型异常，宿主 AI 请直接打开查看）：\n- ${img.alt || '无描述'}: ${resolved}\n> 请打开此图片文件查看内容，以辅助理解需求。`);
      }
    } else {
      // v8.3.138+: 无视觉模型时，明确提示宿主 AI 打开图片查看（不要用 HTML 注释，AI 会忽略）
      inlines.push(`\n\n---\n🖼️ **图片文件**（CLI 无法解析图片内容，宿主 AI 请直接打开查看）：`);
      inlines.push(`- ${img.alt || '无描述'}: ${resolved}`);
      try {
        if (await pathExists(resolved)) {
          const st = await stat(resolved);
          inlines.push(`- 文件大小: ${(st.size / 1024).toFixed(1)} KB`);
        }
      } catch { /* ignore */ }
      inlines.push(`> 请打开此图片文件查看内容，以辅助理解需求。`);
    }
  }

  // v8.3.125+: 在内容末尾附加外链图片清单，提示宿主 AI 按需查看
  if (externalImages.size > 0) {
    inlines.push([
      '\n\n---',
      '🖼️ **外链图片清单**（CLI 无法直接获取内容，宿主 AI 可按需查看）：',
      ...Array.from(externalImages.entries()).map(([path, alt]) => `- ${alt || '无描述'}: ${path}`),
    ].join('\n'));
  }

  return content + inlines.join('');
}

/**
 * 统一处理 Markdown 内容：展开链接 + 提取图片
 * 在 loadExtraSpecs / loadAllTaskContext 的文件加载后调用
 * v8.3.97+: 导出供 analyze-engine / analyze 命令使用
 */
export async function processMarkdownContent(
  content: string,
  filePath: string,
  seenPaths: Set<string>,
  visionConfig?: VisionModelConfig,
  options?: {
    maxLinkDepth?: number;
    maxLinkChars?: number;
    maxSvgChars?: number;
  },
): Promise<string> {
  const baseDir = dirname(filePath);
  let processed = content;
  processed = await expandMarkdownLinks(
    processed, baseDir, seenPaths,
    options?.maxLinkDepth ?? 2,
    0,
    options?.maxLinkChars ?? 1500,
  );
  processed = await inlineMarkdownImages(
    processed, baseDir, seenPaths,
    visionConfig,
    options?.maxSvgChars ?? 2000,
  );
  return processed;
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
