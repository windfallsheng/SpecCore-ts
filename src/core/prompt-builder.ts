/**
 * prompt-builder — 统一的 Spec → AI Prompt 构建引擎
 * 
 * CLI 不自己生成内容，而是读取 Spec 上下文，构建结构化 Prompt 输出到 stdout。
 * Skill/宿主 AI 捕获 stdout，解析 Prompt，调用 AI 生成内容后，由 CLI --apply 写回。
 * 
 * 架构: CLI(确定性) → stdout(Prompt) → AI(生成) → CLI(确定性写入)
 */
import { readFile, pathExists, readdir } from 'fs-extra';
import { join } from 'path';
import { isTimestampBackup } from '../utils/task-utils';

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
  const reqPath = join(cwd, taskDir, '00-specs', 'REQ.md');
  const legacyPath = join(cwd, taskDir, 'REQ.md');
  const actualPath = (await pathExists(reqPath)) ? reqPath : (await pathExists(legacyPath)) ? legacyPath : null;
  if (!actualPath) return [];

  const content = await readFile(actualPath, 'utf-8');
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
  const reqPath = join(cwd, taskDir, '00-specs', 'REQ.md');
  const legacyPath = join(cwd, taskDir, 'REQ.md');
  const actualPath = (await pathExists(reqPath)) ? reqPath : (await pathExists(legacyPath)) ? legacyPath : null;
  if (!actualPath) return [];

  const content = await readFile(actualPath, 'utf-8');
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
    const reqPath = join(cwd, taskDir, '00-specs', 'REQ.md');
    const legacyReqPath = join(cwd, taskDir, 'REQ.md');
    const actualReqPath = (await pathExists(reqPath)) ? reqPath : (await pathExists(legacyReqPath)) ? legacyReqPath : null;
    if (actualReqPath) {
      const content = await readFile(actualReqPath, 'utf-8');
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
 */
async function loadExtraSpecs(cwd: string, taskDir: string): Promise<TaskExtraSpec[]> {
  const extras: TaskExtraSpec[] = [];
  const files = [
    { name: '技术方案', path: '00-specs/TECH.md' },
    { name: '任务追踪', path: '00-specs/TASK.md' },
    { name: '数据库设计', path: '00-specs/SCHEMA.md' },
    { name: 'API 契约', path: '_shared/API_CONTRACT.yaml' },
    { name: '测试计划', path: '99-artifacts/TEST.md' },
    { name: '评审清单', path: '99-artifacts/REVIEW.md' },
    { name: '风险评估', path: '99-artifacts/RISK.md' },
    { name: '已知问题', path: '.issues.md' },
  ];

  for (const f of files) {
    const fullPath = join(cwd, taskDir, f.path);
    if (await pathExists(fullPath)) {
      const content = await readFile(fullPath, 'utf-8');
      // 跳过空文件或纯占位符文件
      if (content.trim().length > 50 && !content.trim().match(/^#+\s*待填充|^<!--\s*AI-FILL\s*-->$/m)) {
        extras.push({ name: f.name, path: f.path, content });
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
 * 构建全局知识库目录（TOC）
 * 只读 ## 标题行，不读正文，非常轻量
 */
async function buildGlobalTOC(globalDir: string): Promise<TOCEntry[]> {
  const toc: TOCEntry[] = [];

  // 1. synthesis/ 下的综合文档
  const synthesisDir = join(globalDir, 'synthesis');
  if (await pathExists(synthesisDir)) {
    const files = await readdir(synthesisDir);
    for (const f of files.filter(f => f.endsWith('.md') && !isTimestampBackup(f))) {
      const content = await readFile(join(synthesisDir, f), 'utf-8');
      toc.push({
        path: `synthesis/${f}`,
        description: FILE_DESC[f] || f.replace('.md', ''),
        sections: extractHeadings(content),
      });
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
        toc.push({
          path: `platforms/${platformName}/${f}`,
          description: `${platformName} 端 — ${f.replace('.md', '')}`,
          sections: extractHeadings(content),
        });
      }
    }
  }

  return toc;
}

/**
 * 加载全局上下文
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

  // 必读：INDEX.md 直接注入
  const indexPath = join(globalDir, 'INDEX.md');
  if (await pathExists(indexPath)) {
    const content = await readFile(indexPath, 'utf-8');
    ctx.indexSummary = content.slice(0, 1500);
  }

  // 其余：只给目录，AI 自己决定读什么
  ctx.toc = await buildGlobalTOC(globalDir);

  return ctx;
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
    '- 跨端功能（后端 + Admin + H5）→ 按端拆',
    '- 独立第三方集成（支付/短信/OSS）→ 有独立文档和调试流程',
    '- 数据迁移/脚本 → 独立执行窗口',
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
    '    "scope": ["后端", "admin"],',
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
    '**重要：`functionalUnit` 字段必须填写**',
    '- 填写该任务所属的**功能单元**名称（不是需求文档的章节名）',
    '- 功能单元 = 一个独立的功能模块，由 AI 根据语义判断',
    '- 例如：用户 CRUD + 头像上传 → 都属于“用户管理”功能单元',
    '- 例如：订单创建 + 订单支付 + 订单退款 → 都属于“订单系统”功能单元',
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
        '要求：',
        `1. 严格遵循上面的技术栈选型`,
        `2. 实现所有 ${context.apiCount} 个 API 接口`,
        `3. 创建所有 ${context.modelCount} 个数据模型的 DDL`,
        '4. 遵循 CONSTITUTION 中定义的命名规范和异常码体系',
        '5. 代码必须能直接编译通过',
        '6. 包含必要的 import 语句和注解',
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
  const apiSpecs = await loadApiSpecs(cwd, taskDir);
  const dataModels = await loadDataModels(cwd, taskDir);
  const businessRules = await loadBusinessRules(cwd, taskDir);
  const extraSpecs = taskDir ? await loadExtraSpecs(cwd, taskDir) : [];

  // 加载全局上下文（智能注入）
  const globalContext = await loadGlobalContext(cwd, command, options.platform);

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
    extraSpecs,
    globalContext: (globalContext.indexSummary || globalContext.toc.length > 0) ? globalContext : undefined,
    instruction: getInstruction(command, context),
    outputHint: command === 'execute'
      ? '请返回格式: {"files": [{"path": "相对路径", "content": "代码内容"}]}'
      : command === 'split'
        ? '请返回 JSON 数组格式的任务列表（参见拆分原则中的输出格式）'
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

  // 额外任务上下文（TECH.md / TASK.md / SCHEMA.md / .issues.md 等）
  if (prompt.extraSpecs.length > 0) {
    for (const spec of prompt.extraSpecs) {
      lines.push(`## ${spec.name} (${spec.path})`);
      lines.push(spec.content);
      lines.push('');
    }
  }

  // 全局上下文（从 GLOBAL 层智能注入）
  if (prompt.globalContext) {
    const gc = prompt.globalContext;
    lines.push('## 🌐 全局知识库');
    lines.push('> 以下信息来自项目全局知识库。必读内容已注入，其余文件请按需自行 Read。\n');

    // 必读：INDEX.md
    if (gc.indexSummary) {
      lines.push('### 📌 必读（已注入）');
      lines.push(gc.indexSummary);
      lines.push('');
    }

    // 可选：TOC 目录
    if (gc.toc.length > 0) {
      lines.push('### 📂 可选参考（按需 Read）');
      if (prompt.platform) {
        lines.push(`> 当前任务涉及 **${prompt.platform}** 端，建议优先参考该端文档\n`);
      }

      // 按目录分组
      const synthesisEntries = gc.toc.filter(e => e.path.startsWith('synthesis/'));
      const platformEntries = gc.toc.filter(e => e.path.startsWith('platforms/'));

      if (synthesisEntries.length > 0) {
        lines.push('**全局综合文档** (.speccore/GLOBAL/)');
        for (const e of synthesisEntries) {
          lines.push(`- \`${e.path}\` — ${e.description}`);
          if (e.sections.length > 0) {
            lines.push(`  章节: ${e.sections.join(' | ')}`);
          }
        }
        lines.push('');
      }

      if (platformEntries.length > 0) {
        lines.push('**各端分析文档** (.speccore/GLOBAL/)');
        // 按端分组
        const byPlatform = new Map<string, TOCEntry[]>();
        for (const e of platformEntries) {
          const plat = e.path.split('/')[1]; // platforms/{plat}/...
          if (!byPlatform.has(plat)) byPlatform.set(plat, []);
          byPlatform.get(plat)!.push(e);
        }
        for (const [plat, entries] of byPlatform) {
          const marker = plat === prompt.platform ? ' ⬅ 当前端' : '';
          lines.push(`📂 ${plat}/${marker}`);
          for (const e of entries) {
            lines.push(`  - \`${e.path}\` — ${e.description}`);
            if (e.sections.length > 0) {
              lines.push(`    章节: ${e.sections.slice(0, 8).join(' | ')}`);
            }
          }
        }
        lines.push('');
      }

      // 指示 AI 可以自行 Read
      lines.push('### 💡 使用方式');
      lines.push('以上文件均可通过 Read 工具直接读取（路径相对于 `.speccore/GLOBAL/`）。');
      lines.push('建议根据当前任务需要选择性阅读，不必全部读取。');
      lines.push('');
    }
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
