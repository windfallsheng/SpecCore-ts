/**
 * prompt-builder — 统一的 Spec → AI Prompt 构建引擎
 * 
 * CLI 不自己生成内容，而是读取 Spec 上下文，构建结构化 Prompt 输出到 stdout。
 * Skill/宿主 AI 捕获 stdout，解析 Prompt，调用 AI 生成内容后，由 CLI --apply 写回。
 * 
 * 架构: CLI(确定性) → stdout(Prompt) → AI(生成) → CLI(确定性写入)
 */
import { readFile, pathExists } from 'fs-extra';
import { join } from 'path';

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
  instruction: string;
  outputHint: string;
}

// ═══════════════════════════════════════════════════════════
// 上下文加载
// ═══════════════════════════════════════════════════════════

/**
 * 从 CONSTITUTION.md 解析技术栈
 */
async function loadTechStack(cwd: string): Promise<TechStack> {
  const constitutionPath = join(cwd, '.speccore', 'CONSTITUTION.md');
  if (!await pathExists(constitutionPath)) return {};

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
}

/**
 * 从 REQ.md 解析 API 定义
 */
async function loadApiSpecs(cwd: string, taskDir: string): Promise<ApiSpec[]> {
  const reqPath = join(cwd, taskDir, 'REQ.md');
  if (!await pathExists(reqPath)) return [];

  const content = await readFile(reqPath, 'utf-8');
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
 * 从 REQ.md 解析数据模型
 */
async function loadDataModels(cwd: string, taskDir: string): Promise<DataModel[]> {
  const reqPath = join(cwd, taskDir, 'REQ.md');
  if (!await pathExists(reqPath)) return [];

  const content = await readFile(reqPath, 'utf-8');
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
 * 从 CONSTITUTION.md + REQ.md 提取业务规则
 */
async function loadBusinessRules(cwd: string, taskDir?: string): Promise<BusinessRule[]> {
  const rules: BusinessRule[] = [];
  
  // 从 CONSTITUTION 读取命名规范等
  const constitutionPath = join(cwd, '.speccore', 'CONSTITUTION.md');
  if (await pathExists(constitutionPath)) {
    const content = await readFile(constitutionPath, 'utf-8');
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
    const reqPath = join(cwd, taskDir, 'REQ.md');
    if (await pathExists(reqPath)) {
      const content = await readFile(reqPath, 'utf-8');
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
        '要求：',
        `1. 严格遵循上面的技术栈选型`,
        `2. 实现所有 ${context.apiCount} 个 API 接口`,
        `3. 创建所有 ${context.modelCount} 个数据模型的 DDL`,
        '4. 遵循 CONSTITUTION 中定义的命名规范和异常码体系',
        '5. 代码必须能直接编译通过',
        '6. 包含必要的 import 语句和注解',
      ].join('\n');
    
    case 'analyze':
      return [
        '请分析以下需求文档，输出结构化分析结果。',
        '1. 需求完整性评估（API 覆盖率、数据模型完整性）',
        '2. 技术方案建议（架构、选型、依赖）',
        '3. 风险识别（技术难点、依赖风险、性能瓶颈）',
        '4. 工作量估算（按 API 数量估算人天）',
        '请按 Markdown 格式输出，包含上述 4 个章节。',
      ].join('\n');

    case 'split':
      return [
        '请根据以下需求分析结果，拆分开发任务。',
        '1. 按端（app/h5/miniapp/admin）分组',
        '2. 每个 API 3~8 个接口为一个 Task',
        '3. 标注 Task 间的依赖关系',
        '4. 给出建议的负责人分配',
        '请按 Markdown 表格格式输出 Task 列表。',
      ].join('\n');

    case 'plan':
      return [
        '请根据以下 Task 列表和人员配置，生成执行计划。',
        '1. 拓扑排序确定执行顺序',
        '2. 识别可并行的 Task 批次',
        '3. 分配负责人',
        '4. 估算每个 Task 的工作量和里程碑',
        '请按 Markdown 表格格式输出执行计划。',
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
  const apiSpecs = await loadApiSpecs(cwd, taskDir);
  const dataModels = await loadDataModels(cwd, taskDir);
  const businessRules = await loadBusinessRules(cwd, taskDir);

  const context = {
    taskName: options.task,
    apiCount: apiSpecs.length,
    modelCount: dataModels.length,
  };

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
    instruction: getInstruction(command, context),
    outputHint: command === 'execute'
      ? '请返回格式: {"files": [{"path": "相对路径", "content": "代码内容"}]}'
      : '请返回 Markdown 格式的分析结果',
  };
}

// ═══════════════════════════════════════════════════════════
// Prompt 序列化
// ═══════════════════════════════════════════════════════════

/**
 * 将 Prompt 序列化为 AI 可读的文本（输出到 stdout）
 */
export function formatPrompt(prompt: SpecCorePrompt): string {
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
