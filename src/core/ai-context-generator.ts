/**
 * ai-context-generator — AI 分析上下文生成器
 *
 * 将需求文档 + 源码结构索引导出为结构化 AI prompt，
 * 供 WorkBuddy 等 AI 助手进行智能分析（需求完整性、架构影响、代码对标等）。
 *
 * 输出位置: .speccore/prompts/analyze-<scope>.md
 */
import { readFile, writeFile, pathExists, ensureDir } from 'fs-extra';
import { join, relative, basename, dirname } from 'path';
import { logger } from '../utils/logger';

// ── 类型 ──

interface CodeFile {
  path: string;
  language: string;
  exports: string[];
  apis: string[];
  lastModified: number;
}

interface CodeIndex {
  updatedAt: string;
  files: CodeFile[];
}

export interface AIContextInput {
  /** 需求文档路径列表 */
  requirements: string[];
  /** 源码目录列表 */
  sources: string[];
  /** 分析范围 */
  scope: 'global' | 'iteration' | 'task';
  /** 期次名称 */
  iteration?: string;
  /** 任务 ID */
  taskId?: string;
  /** 分析深度 */
  depth: 'quick' | 'normal' | 'deep';
}

export interface AIContextResult {
  /** 输出的 prompt 文件路径 */
  promptPath: string;
  /** prompt 内容 */
  content: string;
  /** 涉及的文件数 */
  totalFiles: number;
  /** 发现的 API 数 */
  totalApis: number;
}

// ── 常量 ──

const PROMPTS_DIR = join('.speccore', 'prompts');
const INDEX_PATH = join('.speccore', 'cache', 'code-structure.json');

// ── 主入口 ──

export async function generateAIContext(input: AIContextInput): Promise<AIContextResult> {
  await ensureDir(PROMPTS_DIR);

  // 1. 读取需求文档
  const reqContents: string[] = [];
  for (const reqPath of input.requirements) {
    if (await pathExists(reqPath)) {
      const content = await readFile(reqPath, 'utf-8');
      reqContents.push(`## 来源: ${reqPath}\n\n${content}`);
    }
  }

  // 1.5 读取 CONSTITUTION.md 获取工程配置映射
  let constitutionInfo = '';
  if (await pathExists(join('.speccore', 'CONSTITUTION.md'))) {
    constitutionInfo = await readFile(join('.speccore', 'CONSTITUTION.md'), 'utf-8');
  }

  // 1.6 构建"端目录 ← → 工程源码"对应关系
  const platformSourceMap = buildPlatformSourceMap(input);

  // 2. 读取代码索引
  let codeIndex: CodeIndex | null = null;
  if (await pathExists(INDEX_PATH)) {
    codeIndex = JSON.parse(await readFile(INDEX_PATH, 'utf-8'));
  }

  // 3. 构建文件树
  const fileTree = buildFileTree(codeIndex);

  // 4. 提取 API 清单
  const apiInventory = codeIndex
    ? [...new Set(codeIndex.files.flatMap(f => f.apis))]
    : [];

  // 5. 模块分组
  const modules = codeIndex ? groupByModule(codeIndex.files) : {};

  // 6. 生成 prompt
  const promptContent = buildPrompt({
    ...input,
    reqContents,
    fileTree,
    apiInventory,
    modules,
    codeIndex,
    constitutionInfo,
    platformSourceMap,
  });

  // 7. 写入文件
  const scopeName = input.scope === 'global'
    ? 'global'
    : input.scope === 'task'
      ? `task-${input.taskId}`
      : `iteration-${input.iteration || 'current'}`;

  const promptPath = join(PROMPTS_DIR, `analyze-${scopeName}.md`);
  await writeFile(promptPath, promptContent);

  return {
    promptPath,
    content: promptContent,
    totalFiles: codeIndex?.files.length || 0,
    totalApis: apiInventory.length,
  };
}

// ── 构建 Prompt ──

function buildPrompt(params: {
  scope: string;
  iteration?: string;
  taskId?: string;
  depth: string;
  reqContents: string[];
  fileTree: string;
  apiInventory: string[];
  modules: Record<string, CodeFile[]>;
  codeIndex: CodeIndex | null;
  constitutionInfo?: string;
  platformSourceMap?: string;
}): string {
  const { scope, iteration, taskId, depth, reqContents, fileTree, apiInventory, modules, constitutionInfo, platformSourceMap } = params;

  const scopeLabel = scope === 'global' ? '全局' : scope === 'task' ? `任务 ${taskId}` : `期次 ${iteration || '当前'}`;

  return `# SpecCore AI 分析上下文

> 自动生成 | ${new Date().toISOString().split('T')[0]} | Scope: ${scopeLabel} | Depth: ${depth}

---

${constitutionInfo ? `## 🏗 项目工程配置 (CONSTITUTION.md)

${constitutionInfo.split('\n').filter(l => l.trim() && !l.startsWith('# ') && !l.startsWith('> ')).join('\n').slice(0, 2000)}

> 以上为项目配置信息。AI 应据此处配置判断各需求端（APP/H5/小程序/管理后台）对应哪个工程源码。

---

` : ''}
${platformSourceMap ? `## 🔗 端 ↔ 工程对应关系

${platformSourceMap}

> 以上为"产品需求端目录"与"工程源码路径"的对应关系。分析时请按此映射对标。

---

` : ''}
## 📋 需求文档

${reqContents.join('\n\n---\n\n') || '_无需求文档_'}

---

## 🗂 源码结构

${fileTree || '_未扫描源码 (未传 --src)_'}

${apiInventory.length > 0 ? `### API 清单

${apiInventory.map(a => `- \`${a}\``).join('\n')}

` : ''}
${Object.keys(modules).length > 0 ? `### 模块分组

${Object.entries(modules).map(([name, files]) =>
    `**${name}** (${files.length} 文件):\n${files.map(f => `- \`${f.path}\``).join('\n')}`
  ).join('\n\n')}
` : ''}
---

## 🤖 AI 分析任务

请对以上需求和源码进行以下分析，并将结果写入对应的分析文档:

### 1. 需求完整性分析
- 逐条检查需求是否覆盖所有功能点、边界条件、异常处理
- 是否有遗漏的非功能需求（性能指标、安全性、兼容性、可维护性）
- 产品需求中模糊或矛盾的表述，提出澄清建议

### 2. 改动范围分析 ⭐
- **功能改动**: 列出每个功能点涉及的具体模块/服务
- **文件级变更**: ${Object.keys(modules).length > 0 ? `预测需要修改的源码文件（从以下模块中识别）:\n${Object.entries(modules).slice(0,5).map(([name, files]) => `  - ${name}: ${files.map(f => f.path).join(', ')}`).join('\n')}` : '_未提供源码，无法分析_'}
- **数据库变更**: 是否需要新增/修改表结构
- **接口变更**: 新增/修改的 API 端点
- **配置变更**: 环境变量、配置文件、CI/CD 改动

### 3. 风险评估 ⭐
按以下维度详细评估:
| 风险类型 | 具体风险 | 可能性 | 影响 | 缓解措施 |
| :--- | :--- | :--- | :--- | :--- |
| 技术风险 | | | | |
| 业务风险 | | | | |
| 依赖风险 | | | | |
| 安全风险 | | | | |
| 性能风险 | | | | |

### 4. ${scope === 'global' ? '全局架构影响' : '架构影响评估'}
- 需求变更对现有架构的影响范围（模块间耦合分析）
- 是否需要新增模块/服务/中间件
- 数据库/接口变更的级联影响

### 5. 需求-代码对标${Object.keys(modules).length > 0 ? `\n- 将每个需求功能点映射到具体的代码模块和文件\n- 标记需要修改的文件、函数、类型定义\n- 识别可能产生冲突的现有逻辑` : '\n- _未提供源码，无法对标_'}
### 6. 任务拆分建议
- 推荐的任务拆解粒度（建议每个 Task 1-3 天完成）
- 任务间的依赖关系（哪些必须先做完）
- 预估工时参考

### 7. 验收标准建议
- 每个功能点的验收条件
- 回归测试范围

---

## 📝 输出格式

请将分析结果写入以下文件:
- **${scope === 'global'
      ? '.speccore/GLOBAL/ANALYSIS.md'
      : scope === 'task'
        ? `期次-${iteration}/${taskId}/backend/ANALYSIS.md`
        : `期次-${iteration || 'current'}/00-需求文档/ANALYSIS.md`}**

同时参考填充同目录下的 TECH.md、TEST.md、REVIEW.md、RISK.md、DEPS.md、MONITOR.md 模板文件。
`;
}

// ── 文件树构建 ──

function buildFileTree(index: CodeIndex | null): string {
  if (!index || index.files.length === 0) return '';

  const tree: Record<string, string[]> = {};
  for (const f of index.files) {
    const dir = dirname(f.path);
    if (!tree[dir]) tree[dir] = [];
    tree[dir].push(`${basename(f.path)} (${f.language}${f.exports.length > 0 ? `, exports: ${f.exports.slice(0, 3).join(', ')}` : ''}${f.apis.length > 0 ? `, APIs: ${f.apis.length}` : ''})`);
  }

  return Object.entries(tree)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, files]) => `\`${dir}/\`\n${files.map(f => `  - ${f}`).join('\n')}`)
    .join('\n\n');
}

// ── 模块分组 ──

function groupByModule(files: CodeFile[]): Record<string, CodeFile[]> {
  const groups: Record<string, CodeFile[]> = {};

  const patterns: [RegExp, string][] = [
    [/controller/i, 'Controllers'],
    [/service/i, 'Services'],
    [/model|entity|schema/i, 'Models'],
    [/route|router/i, 'Routes'],
    [/middleware/i, 'Middleware'],
    [/util|helper/i, 'Utils'],
    [/test|spec/i, 'Tests'],
    [/config/i, 'Config'],
  ];

  for (const f of files) {
    let matched = false;
    for (const [regex, name] of patterns) {
      if (regex.test(f.path)) {
        if (!groups[name]) groups[name] = [];
        groups[name].push(f);
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (!groups['Other']) groups['Other'] = [];
      groups['Other'].push(f);
    }
  }

  return groups;
}

// ── 端 ↔ 工程对应关系 ──

/**
 * 构建产品需求端目录与工程源码路径的对应关系。
 *
 * 从两个来源推断:
 * 1. 00-产品需求/ 下的子目录名 (APP端/H5端/小程序端/管理后台 等)
 * 2. CONSTITUTION.md 中「项目信息」表格 (工程名+路径+Git仓库)
 *
 * AI 可据此判断: "APP端需求 → 对应哪个工程源码"
 */
function buildPlatformSourceMap(input: AIContextInput): string {
  const lines: string[] = [];
  
  // 从需求路径中提取端目录
  const platformDirs = new Set<string>();
  for (const req of input.requirements) {
    // 期次-Q1/00-产品需求/APP端/xxx.md → APP端
    const parts = req.split('/');
    const prdIdx = parts.indexOf('00-产品需求');
    if (prdIdx >= 0 && prdIdx + 1 < parts.length) {
      const platformDir = parts[prdIdx + 1];
      if (platformDir && !platformDir.startsWith('_')) {
        platformDirs.add(platformDir);
      }
    }
  }

  // 从源码路径中也提取关键目录名
  const sourceNames = input.sources.map(s => {
    const parts = s.split('/');
    return parts[parts.length - 1] || s;
  });

  if (platformDirs.size === 0 && sourceNames.length === 0) return '';

  lines.push('| 产品需求端 | 工程源码 | 说明 |');
  lines.push('| :--- | :--- | :--- |');

  const platforms = [...platformDirs];
  for (let i = 0; i < Math.max(platforms.length, sourceNames.length); i++) {
    const p = platforms[i] || '—';
    const s = sourceNames[i] || '—';
    const note = p !== '—' && s !== '—' 
      ? `${p}需求 → 对应 \`${s}\` 工程` 
      : p !== '—' 
        ? `${p}需求（待指定工程）`
        : `\`${s}\` 工程（待指定需求端）`;
    lines.push(`| ${p} | \`${s}\` | ${note} |`);
  }

  // 通用需求
  lines.push('');
  lines.push('> **注意**: `_shared/` 目录下的需求为跨端共用，分析时应覆盖到所有相关工程。');

  return lines.join('\n');
}
