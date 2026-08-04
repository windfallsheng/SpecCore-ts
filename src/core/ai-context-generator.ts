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
}): string {
  const { scope, iteration, taskId, depth, reqContents, fileTree, apiInventory, modules } = params;

  const scopeLabel = scope === 'global' ? '全局' : scope === 'task' ? `任务 ${taskId}` : `期次 ${iteration || '当前'}`;

  return `# SpecCore AI 分析上下文

> 自动生成 | ${new Date().toISOString().split('T')[0]} | Scope: ${scopeLabel} | Depth: ${depth}

---

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

### 1. 需求完整性检查
- 检查需求是否覆盖了所有必要的功能点
- 是否有遗漏的边界条件、异常处理
- 是否需要补充非功能性需求（性能、安全、兼容性）

### 2. ${scope === 'global' ? '全局架构影响' : '架构影响评估'}
- 需求变更对现有架构的影响范围
- 是否需要新增模块/服务
- 数据库/接口变更风险

### 3. 需求-代码对标${Object.keys(modules).length > 0 ? `\n- 将需求功能点映射到具体的代码模块\n- 识别需要修改的文件和函数\n- 标记可能冲突的现有逻辑` : '\n- _未提供源码，无法对标_'}
### 4. 风险识别
- 技术风险和业务风险
- 依赖链路风险
- 回滚复杂度

### 5. 任务拆分建议
- 推荐的任务拆解粒度
- 任务间的依赖关系
- 预估工时参考

---

## 📝 输出格式

请将分析结果输出到:
- **${scope === 'global'
      ? '.speccore/GLOBAL/ANALYSIS.md'
      : scope === 'task'
        ? `期次-${iteration}/${taskId}/backend/ANALYSIS.md`
        : `期次-${iteration || 'current'}/00-需求文档/ANALYSIS.md`}**
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
