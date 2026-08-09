/**
 * analyze — 统一分析命令
 * 
 * 支持:
 *   - 需求分析: --req docs/a.md docs/b.md
 *   - 代码分析: --src backend/src frontend/src
 *   - 联合分析: --src backend/src --req docs/req.md
 * 
 * 输出范围:
 *   - global    → .speccore/GLOBAL/    全局架构/代码健康
 *   - iteration → Iteration-XX/02-需求文档/  (默认)
 *   - task      → Iteration-XX/Task-NN/     单任务深化
 */
import { writeFile, pathExists, ensureDir } from 'fs-extra';
import { join, dirname } from 'path';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, getIterationDir } from '../core/context';
import { extractQuestions, showQuestionChecklist } from '../core/question-checklist';
import { showNextSteps } from '../core/next-steps';
import { runAnalysis, AnalyzeInput } from '../core/analyze-engine';
import { generateGlobalArtifacts } from '../core/global-artifacts';
import { buildPrompt, formatPrompt } from '../core/prompt-builder';

export interface AnalyzeOptions {
  iteration?: string;
  output?: string;
  auto?: boolean;
  interactive?: boolean;
  task?: string;
  type?: string;   // 任务类型: feature|bugfix|refactor|...
  // NEW options (CLI passes comma-separated strings)
  source?: string;
  requirements?: string;
  scope?: 'global' | 'iteration' | 'task';
  depth?: 'quick' | 'normal' | 'deep';
  prompt?: boolean;     // --prompt: 输出结构化分析 Prompt 到 stdout
  apply?: string;       // --apply: 接收 AI 分析结果写入 ANALYSIS.md
  withCode?: boolean;   // --with-code: 结合工程源码分析
}

export async function analyzeCommand(options: AnalyzeOptions): Promise<void> {
  // ── 非 prompt/apply 模式 → 全部转 AI prompt，不再走代码模板分析 ──
  if (!options.prompt && !options.apply) {
    options.prompt = true;
  }

  // ── Prompt 模式 ──
  if (options.prompt) {
    const iter = options.iteration || await getDefaultIteration();
    const prompt = await buildMultiDocPrompt('analyze', { iteration: iter, task: options.task, type: options.type, scope: options.scope, withCode: options.withCode });
    process.stdout.write(`[SPECCORE_PROMPT]\n${prompt}`);
    process.exitCode = 10;
    return;
  }

  // ── Apply 模式 ──
  if (options.apply) {
    if (!options.iteration) { logger.error('--apply 需要 --iteration'); return; }
    const iterDir = await getIterationDir(options.iteration);
    const specDir = join(iterDir, '020-specs');
    await ensureDir(specDir);
    // 支持 JSON 多文档写入: {"ANALYSIS.md":"...","TECH.md":"..."}
    if (options.apply.startsWith('{')) {
      try {
        const docs: Record<string, string> = JSON.parse(options.apply);
        let count = 0;
        for (const [filename, content] of Object.entries(docs)) {
          await writeFile(join(specDir, filename), content);
          count++;
        }
        logger.success(`✅ ${count} 个 Spec 文档已写入 020-specs/`);
        if (options.task) {
          const taskDir = join(iterDir, '030-tasks', options.task.startsWith('Task-') ? options.task : `Task-${options.task}`);
          await ensureDir(taskDir);
          for (const [filename, content] of Object.entries(docs)) {
            await writeFile(join(taskDir, filename), content);
          }
        }
        return;
      } catch {
        // fallback to single-file mode
      }
    }
    await writeFile(join(specDir, 'ANALYSIS.md'), options.apply);
    logger.success(`✅ ANALYSIS.md 已写入 020-specs/`);
    if (options.task) {
      const taskDir = join(iterDir, '030-tasks', options.task.startsWith('Task-') ? options.task : `Task-${options.task}`);
      await ensureDir(taskDir);
      await writeFile(join(taskDir, 'ANALYSIS.md'), options.apply);
    }
    return;
  }

  // ── 非 prompt/apply 模式 → 自动转为 prompt 模式，所有分析必须经 AI 执行 ──
  if (!options.prompt && !options.apply) {
    options.prompt = true;
  }

  // ── Prompt 模式 ──
  if (options.prompt) {
    const iter = options.iteration || await getDefaultIteration();
    const prompt = await buildMultiDocPrompt('analyze', { iteration: iter, task: options.task, type: options.type, scope: options.scope, withCode: options.withCode });
    process.stdout.write(`[SPECCORE_PROMPT]\n${prompt}`);
    process.exitCode = 10;
    return;
  }

  // ── Apply 模式 ──
  if (options.apply) {
  }
}

/**
 * 迭代创建全套规范文件
 */
async function generateIterationSpecDocs(iteration: string): Promise<void> {
  const iterDir = await getIterationDir(iteration);
  const specDir = join(iterDir, '020-specs');

  const now = new Date().toISOString().split('T')[0];
  const templates: [string, string][] = [
    // ANALYSIS.md 由分析引擎自动生成，此处不覆盖
    ['TECH.md',
      `# 技术方案\n\n> 迭代: ${iteration} | 生成: ${now}\n\n`
      + `## 架构\n\n_待填充_\n\n`
      + `## 数据库设计\n\n| 表名 | 字段 | 索引 | 说明 |\n| :--- | :--- | :--- | :--- |\n| | | | |\n\n`
      + `## API 设计\n\n| 方法 | 路径 | 说明 |\n| :--- | :--- | :--- |\n| | | |\n\n`
      + `## 缓存策略\n\n_待填充_\n`],
    ['TEST.md',
      `# 测试计划\n\n> 迭代: ${iteration} | 生成: ${now}\n\n`
      + `## 单元测试\n\n- [ ] 核心模块覆盖\n\n`
      + `## 集成测试\n\n- [ ] API 端到端\n\n`
      + `## 边界测试\n\n- [ ] 异常参数\n- [ ] 超时重试\n- [ ] 并发冲突\n\n`
      + `## 性能测试\n\n- [ ] 压测方案\n`],
    ['REVIEW.md',
      `# Code Review 清单\n\n> 迭代: ${iteration}\n\n`
      + `## 检查项\n\n- [ ] 参数校验完整性\n- [ ] 幂等性处理\n- [ ] 索引覆盖\n- [ ] 迁移脚本可回滚\n- [ ] 鉴权配置\n- [ ] 日志规范\n`],
    ['RISK.md',
      `# 风险评估\n\n> 迭代: ${iteration} | 生成: ${now}\n\n`
      + `## 风险矩阵\n\n| 风险 | 可能性 | 影响 | 缓解措施 |\n| :--- | :--- | :--- | :--- |\n| | | | |\n\n`
      + `## 回滚方案\n\n1. 触发条件: _待定_\n2. 回滚步骤: _待定_\n`],
    ['DEPS.md',
      `# 依赖清单\n\n> 迭代: ${iteration}\n\n`
      + `## 上游依赖\n\n| 服务 | 版本 | 用途 | SLA |\n| :--- | :--- | :--- | :--- |\n| | | | |\n\n`
      + `## 下游影响\n\n| 消费方 | 接口 | 影响 |\n| :--- | :--- | :--- |\n| | | |\n`],
    ['MONITOR.md',
      `# 监控指标\n\n> 迭代: ${iteration}\n\n`
      + `## 业务指标\n\n| 指标 | 阈值 | 级别 |\n| :--- | :--- | :--- |\n| 成功率 | <99.9% | P1 |\n| P99延迟 | >1000ms | P2 |\n\n`
      + `## 告警规则\n\n| 规则 | 条件 | 通知 |\n| :--- | :--- | :--- |\n| | | |\n`],
  ];

  let created = 0;
  let skipped = 0;
  for (const [filename, content] of templates) {
    const filePath = join(specDir, filename);
    if (!(await pathExists(filePath))) {
      await writeFile(filePath, content);
      created++;
    } else {
      skipped++;
    }
  }

  logger.info(`\n📄 Spec 文档: 新建 ${created} 个, 跳过 ${skipped} 个 (已存在) → ${specDir}/`);
}

/**
 * 任务级文档补全 (原 perTaskAnalyze 逻辑)
 */
async function enrichTaskDocs(iteration: string, taskId: string, reqFiles: string[]): Promise<void> {
  const { readdirSync } = require('fs');
  const iterDir = await getIterationDir(iteration);
  
  if (!(await pathExists(iterDir))) return;

  const entries = readdirSync(iterDir, { withFileTypes: true });
  const taskEntry = entries.find((e: any) => e.isDirectory() && e.name.startsWith(taskId));
  // enrichTaskDocs continues, but taskEntry logic remains...
  if (!taskEntry) return;
  
  if (!taskEntry) {
    logger.info(`   ℹ️ 未找到任务目录 ${taskId}，跳过文档补全`);
    return;
  }

  const fullTaskDir = join(iterDir, taskEntry.name);
  const backendDir = join(fullTaskDir, 'backend');
  
  if (!(await pathExists(backendDir))) return;

  let reqContent = '';
  
  // 读取任务 REQ 或传入的需求文件
  const taskReqPath = join(backendDir, 'REQ.md');
  if (await pathExists(taskReqPath)) {
    reqContent = await require('fs-extra').readFile(taskReqPath, 'utf-8');
  } else if (reqFiles.length > 0) {
    for (const f of reqFiles) {
      if (await pathExists(f)) reqContent += await require('fs-extra').readFile(f, 'utf-8') + '\n';
    }
  }

  if (!reqContent) return;

  // 补全 TECH.md
  const techPath = join(backendDir, 'TECH.md');
  let techContent = '';
  if (await pathExists(techPath)) {
    techContent = await require('fs-extra').readFile(techPath, 'utf-8');
    if (!techContent.includes('## 分析建议')) {
      const items: string[] = [];
      const apis = (reqContent.match(/\/api\/[a-zA-Z0-9\/-]+/g) || []).map((a: string) => a.trim());
      if (apis.length > 0) {
        items.push(`检测到 ${apis.length} 个 API:`);
        for (const api of [...new Set(apis)]) items.push(`  \`${api}\``);
      }
      if (reqContent.match(/数据库|表|DDL/)) items.push('涉及数据库变更，请补充 DDL');
      if (reqContent.match(/权限|RBAC|鉴权/)) items.push('涉及权限控制，注意鉴权边界');
      if (items.length > 0) {
        techContent += `\n\n---\n\n## 分析建议\n\n> 自动生成\n\n${items.map(i => `- ${i}`).join('\n')}\n`;
        await writeFile(techPath, techContent);
        logger.info(`   📄 更新 TECH.md`);
      }
    }
  }

  // 补全 TEST.md
  const testPath = join(backendDir, 'TEST.md');
  if (await pathExists(testPath)) {
    let testContent = await require('fs-extra').readFile(testPath, 'utf-8');
    if (!testContent.includes('## 补充分析')) {
      const items: string[] = [];
      if (reqContent.includes('POST') || reqContent.includes('创建')) items.push('[ ] 正常参数 + 异常参数测试');
      if (reqContent.includes('GET') || reqContent.includes('查询')) items.push('[ ] 分页 / 筛选 / 空结果测试');
      if (reqContent.includes('DELETE') || reqContent.includes('删除')) items.push('[ ] 删除确认 + 级联处理');
      if (reqContent.includes('权限') || reqContent.includes('RBAC')) items.push('[ ] 无权限访问 + 越权检测');
      if (items.length > 0) {
        testContent += `\n\n---\n\n## 补充分析\n${items.join('\n')}\n`;
        await writeFile(testPath, testContent);
        logger.info(`   📄 更新 TEST.md`);
      }
    }
  }

  // 补全 REVIEW.md
  const reviewPath = join(backendDir, 'REVIEW.md');
  if (await pathExists(reviewPath)) {
    let reviewContent = await require('fs-extra').readFile(reviewPath, 'utf-8');
    if (!reviewContent.includes('## 本任务专项检查')) {
      const items: string[] = [];
      if (reqContent.includes('POST') || reqContent.includes('创建')) items.push('[ ] 参数校验 + 幂等性处理');
      if (reqContent.includes('数据库') || reqContent.includes('表')) items.push('[ ] 索引覆盖 + 迁移脚本可回滚');
      if (reqContent.includes('权限') || reqContent.includes('RBAC')) items.push('[ ] 鉴权注解/中间件正确配置');
      if (items.length > 0) {
        reviewContent += `\n\n---\n\n## 本任务专项检查\n${items.join('\n')}\n`;
        await writeFile(reviewPath, reviewContent);
        logger.info(`   📄 更新 REVIEW.md`);
      }
    }
  }

  // 创建缺失文件
  const templates: [string, string][] = [
    ['RISK.md', `# 风险评估\n\n> analyze | ${new Date().toISOString().split('T')[0]}\n\n## 风险矩阵\n| 风险 | 可能 | 影响 | 缓解 |\n| :--- | :--- | :--- | :--- |\n| 兼容性 | 中 | 高 | 版本号+测试 |\n\n## 回滚\n1. 触发: 线上错误率 > 1%\n2. 步骤: git revert → 重部署\n`],
    ['DEPS.md', `# 依赖清单\n\n## 上游依赖\n| 服务 | 版本 | 用途 |\n| :--- | :--- | :--- |\n| _待补充_ | — | — |\n`],
    ['MONITOR.md', `# 监控\n\n## 关键指标\n| 指标 | 阈值 | 级别 |\n| :--- | :--- | :--- |\n| 成功率 | <99.9% | P1 |\n| P99延迟 | >1000ms | P2 |\n`],
  ];

  for (const [filename, content] of templates) {
    const fp = join(backendDir, filename);
    if (!(await pathExists(fp))) {
      await writeFile(fp, content);
      logger.info(`   📄 创建 ${filename}`);
    }
  }
}

/**
 * 从 process.argv 手动解析选项 (Commander.js 偶发不传递部分选项)
 */
function parseArgv(options: AnalyzeOptions): void {
  const argv = process.argv;
  const strFlags: [string[], (v: string) => void][] = [
    [['--iteration', '-i', '-I'], (v) => { options.iteration = v; }],
    [['--task', '-t'], (v) => { options.task = v; }],
    [['--scope'], (v) => { options.scope = v as any; }],
    [['--src', '--source'], (v) => { options.source = v; }],
    [['--req', '--requirements'], (v) => { options.requirements = v; }],
    [['--output', '-o'], (v) => { options.output = v; }],
    [['--depth'], (v) => { options.depth = v as any; }],
  ];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    for (const [flags, setter] of strFlags) {
      for (const flag of flags) {
        // --flag value
        if (arg === flag && i + 1 < argv.length) {
          setter(argv[i + 1]);
        }
        // --flag=value
        if (arg.startsWith(flag + '=')) {
          setter(arg.slice(flag.length + 1));
        }
      }
    }
  }
}

// ── buildMultiDocPrompt: 多文档协议 ──
async function buildMultiDocPrompt(command: string, ctx: { iteration?: string; task?: string; type?: string; scope?: string; withCode?: boolean }): Promise<string> {
  const iter = ctx.iteration || '当前迭代';
  const task = ctx.task ? ` — ${ctx.task}` : '';
  const taskType = ctx.type || 'feature';
  const now = new Date().toISOString().split('T')[0];
  const isTask = ctx.scope === 'task' || !!ctx.task;
  const isGlobal = ctx.scope === 'global';

  // global 范围: 从源码反推需求 + 生成技术栈配置
  if (isGlobal) {
    let prompt = `\n# 任务: ${command} (全局分析${ctx.withCode ? '+源码' : ''})\n\n`;
    prompt += `## 要求\n`;
    prompt += `1. Read .speccore/CONSTITUTION.md 获取全局技术栈和源码配置\n`;
    prompt += `2. Read .speccore/GLOBAL/ 下所有文档了解跨项目需求\n`;
    if (ctx.withCode) {
      prompt += `3. 从 CONSTITUTION.md 的「源码路径」列读取各工程目录，逐个 Read 源码\n`;
      prompt += `4. **按端和语言分别分析**，先识别每个工程的平台和语言，再针对性提取:\n`;
      prompt += `   > 识别规则: 扫 package.json → Node/Vue/React；扫 pom.xml → Java/SpringBoot；扫 go.mod → Go；扫 requirements.txt → Python\n`;
      prompt += `   > 端分类: admin(Web管理端)、h5(移动H5)、miniapp(小程序)、app(后端服务)、android、ios\n`;
      prompt += `   - TECH_STACK.md: 按端分表列出语言、框架、构建工具、UI库、运行时版本\n`;
      prompt += `   - API_INVENTORY.md: Controller/Route/handler → 完整接口清单（标记所属端和语言）\n`;
      prompt += `   - DATA_MODEL.md: Entity/Schema/Model → 数据模型（Java JPA / Node Sequelize / Go GORM 分别标注）\n`;
      prompt += `   - BUSINESS_RULES.md: validator/middleware/guard → 业务规则（标注实现语言和框架）\n`;
      prompt += `   - CONFIG_MAP.md: .env/yml/json → 环境变量和配置（标记所属端）\n`;
      prompt += `   - ERROR_CODES.md: Exception/enum → 错误码清单（Java/Node/Go 分别列出）\n`;
      prompt += `   - DEPENDENCY_GRAPH.md: import/require → 模块依赖拓扑（按端分图）\n`;
      prompt += `   - CODE_INDEX.md: 各端目录结构、关键文件、语言和框架标注\n`;
      prompt += `   - ERROR_CODES.md: 扫描 Error/Exception/enum 提取错误码清单和含义\n`;
      prompt += `   - DEPENDENCY_GRAPH.md: 分析模块间 import/require 依赖关系，生成依赖拓扑图\n`;
      prompt += `   - CODE_INDEX.md: 各工程目录结构、关键文件清单、模块职责说明\n`;
      prompt += `5. **知识沉淀（按工程+端区分）**: 从各端源码识别可复用模式，写入 .speccore/PATTERNS/:\n`;
      prompt += `   - 命名规则: **{CONSTITUTION中的工程名}-{端}-{分类}-{模式名}.md**\n`;
      prompt += `   - 工程名从 CONSTITUTION.md 的「工程」列读取\n`;
      prompt += `   - 端从 CONSTITUTION.md 的「对应需求端」列读取，如: admin/h5/miniapp/app/android/web\n`;
      prompt += `   - 示例: meeting-system-admin-auth-jwt.md | booking-service-app-data-repo.md | meeting-system-h5-comp-table.md\n`;
      prompt += `   - 后台分类: auth(鉴权)、api(接口设计)、data(数据访问)、error(异常)、log(日志)、util(工具)、arch(架构)\n`;
      prompt += `   - 前端分类: comp(组件)、state(状态管理)、router(路由)、request(请求)、form(表单)、style(样式)、build(构建)\n`;
      prompt += `   - 每个文件含: 工程名/端/分类 + 适用场景 + 核心代码片段 + 注意事项 + 反例\n`;
      prompt += `6. 以上文档输出到 .speccore/GLOBAL/ 和 .speccore/PATTERNS/，使用 Write 工具写入\n`;
    } else {
      prompt += `3. 读取 .speccore/GLOBAL/ 下各项目需求文档，生成跨项目索引和需求目录\n`;
    }
    prompt += `\n## 输出文档 (${ctx.withCode ? '9 类' : '1 个'})\n`;
    if (ctx.withCode) {
      prompt += `| 文档 | 从源码提取内容 | 输出目录 |\n`;
      prompt += `| :--- | :--- | :--- |\n`;
      prompt += `| TECH_STACK.md | 语言、框架、构建工具、UI库（前后端全覆盖） | GLOBAL/ |\n`;
      prompt += `| API_INVENTORY.md | 接口路径、方法、参数、响应、鉴权（后台）+ 前端API调用清单（axios/fetch） | GLOBAL/ |\n`;
      prompt += `| DATA_MODEL.md | 表结构、字段、索引、关系（后台）+ 前端Store/State/Type定义 | GLOBAL/ |\n`;
      prompt += `| BUSINESS_RULES.md | 校验规则、业务约束、状态机（后台中间件 + 前端表单校验/路由守卫） | GLOBAL/ |\n`;
      prompt += `| CONFIG_MAP.md | 环境变量、开关、密钥（后台 .env + 前端 .env.local/vite.config） | GLOBAL/ |\n`;
      prompt += `| ERROR_CODES.md | 错误码清单（后台 Exception + 前端统一错误处理/拦截器） | GLOBAL/ |\n`;
      prompt += `| DEPENDENCY_GRAPH.md | 模块依赖拓扑（后台 import + 前端组件树/路由嵌套） | GLOBAL/ |\n`;
      prompt += `| CODE_INDEX.md | 目录结构、关键文件、模块职责（前后端分列） | GLOBAL/ |\n`;
      prompt += `| PATTERNS/*.md | 可复用设计模式，前后端分别提取： | PATTERNS/ |\n`;
      prompt += `  - 后台: 架构(mvc/ddd)、鉴权(jwt/oauth)、API(pagination/restful)、数据(repository)、异常(handler)、日志(aop)\n`;
      prompt += `  - 前端: 组件(composable/hook)、状态管理(pinia/redux)、路由(guard/layout)、请求(interceptor)、表单(validation)、UI(theme/layout)\n`;
    } else {
      prompt += `- REQUIREMENT.md — 合并各迭代需求，生成跨项目需求索引\n`;
    }
    prompt += `\n⚠️ 如 CONSTITUTION.md 中「源码路径」为空或路径不存在: 提示用户先配置，给出三个选项：\n`;
    prompt += `   [1] 停止分析 → 配置后重来 | [2] 跳过源码 → 只用文档分析 | [3] 手动指定路径后继续\n`;
    return prompt;
  }

  const docs: [string, string][] = [
    ['ANALYSIS.md', `# 需求分析报告\n\n> ${iter} | ${now}\n\n## 1. 功能分析\n> 从需求文档总结所有功能模块、用户角色、业务场景\n\n## 2. 接口推导\n> 根据业务功能推导需要的接口，自由描述\n\n## 3. 数据模型\n> 从业务描述推导数据结构\n\n## 4. 业务规则\n> 提取所有业务约束、校验规则、状态流转\n\n## 5. 异常场景\n> 各功能的异常情况处理\n`],
    ['TECH.md', `# 技术方案\n\n> ${iter}\n\n## 1. 架构\n\n## 2. DDL\n\n\`\`\`sql\n\`\`\`\n\n## 3. 接口\n\n## 4. 缓存\n\n## 5. 流程\n`],
    ['TEST.md', `# 测试计划\n\n> ${iter}\n\n## 1. 单元\n\n## 2. 集成\n\n## 3. 边界\n\n## 4. 性能\n`],
    ['REVIEW.md', `# Code Review\n\n> ${iter}\n\n## 安全\n- [ ] SQL注入\n- [ ] XSS\n\n## 质量\n- [ ] 参数校验\n- [ ] 幂等\n`],
    ['RISK.md', `# 风险评估\n\n> ${iter}\n\n| 风险 | 概率 | 影响 | 缓解 |\n|:---|:---|:---|:---|\n`],
    ['DEPS.md', `# 依赖清单\n\n> ${iter}\n\n| 服务 | 版本 | 用途 |\n|:---|:---|:---|\n`],
    ['MONITOR.md', `# 监控\n\n> ${iter}\n\n| 指标 | 阈值 | 级别 |\n|:---|:---|:---|\n| 成功率 | <99.9% | P1 |\n`],
  ];

  // 任务类型 × 文档矩阵: 每种类型生成哪些文档
  const DOC_MATRIX: Record<string, string[]> = {
    feature:    ['ANALYSIS.md','TECH.md','TEST.md','REVIEW.md','RISK.md','DEPS.md','MONITOR.md'],
    refactor:   ['ANALYSIS.md','TECH.md','TEST.md','REVIEW.md','RISK.md'],
    bugfix:     ['ANALYSIS.md','TECH.md','TEST.md'],
    research:   ['ANALYSIS.md'],
    review:     ['REVIEW.md','RISK.md'],
    test:       ['TEST.md','RISK.md'],
    docs:       ['ANALYSIS.md'],
    deploy:     ['ANALYSIS.md','TECH.md','RISK.md','DEPS.md','MONITOR.md'],
    security:   ['ANALYSIS.md','TEST.md','REVIEW.md','RISK.md'],
    performance:['ANALYSIS.md','TECH.md','TEST.md','MONITOR.md'],
  };
  const includeDocs = isTask ? (DOC_MATRIX[taskType] || DOC_MATRIX['feature']) : DOC_MATRIX['feature'];
  const taskDocs = docs.filter(([n]) => includeDocs.includes(n));

  let prompt = `\n# 任务: ${command}${task} (${taskDocs.length}个文档)\n\n`;
  prompt += `## 要求\n1. Read 010-requirements/ 和 PRD/PRD.md 等所有需求文档\n`;
  prompt += `2. 读懂需求文档后，对每个文档填入实质内容。内容来自你对需求的理解，不是找现成格式\n`;
  prompt += `3. 每个文档都要具体内容（禁止"待填充"），即使文档中没有现成表格也要输出分析结果\n`;
  prompt += `3. 写入: speccore analyze --apply '{"ANALYSIS.md":"...","TECH.md":"..."}' -I ${iter}\n\n`;
  for (let i = 0; i < taskDocs.length; i++) {
    prompt += `### ${i+1}/${taskDocs.length}: ${taskDocs[i][0]}\n\`\`\`markdown\n${taskDocs[i][1]}\n\`\`\`\n\n`;
  }
  return prompt;
}
