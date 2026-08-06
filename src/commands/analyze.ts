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
 *   - iteration → Iteration-XX/00-需求文档/  (默认)
 *   - task      → Iteration-XX/Task-NN/     单任务深化
 */
import { writeFile, pathExists, ensureDir } from 'fs-extra';
import { join, dirname } from 'path';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { extractQuestions, showQuestionChecklist } from '../core/question-checklist';
import { showNextSteps } from '../core/next-steps';
import { runAnalysis, AnalyzeInput } from '../core/analyze-engine';
import { generateGlobalArtifacts } from '../core/global-artifacts';

export interface AnalyzeOptions {
  iteration?: string;
  output?: string;
  auto?: boolean;
  interactive?: boolean;
  task?: string;
  // NEW options (CLI passes comma-separated strings)
  source?: string;
  requirements?: string;
  scope?: 'global' | 'iteration' | 'task';
  depth?: 'quick' | 'normal' | 'deep';
}

export async function analyzeCommand(options: AnalyzeOptions): Promise<void> {
  // 手动解析 argv (Commander.js 偶发不传递部分选项)
  parseArgv(options);

  const spinner = new Spinner('正在分析...');
  spinner.start();

  try {
    // ── 应用默认值 ──
    options.depth = options.depth || 'normal';

    // ── 解析逗号分隔的输入 ──
    const sources = options.source
      ? options.source.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const requirements = options.requirements
      ? options.requirements.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    // ── 解析 scope ──
    const scope: 'global' | 'iteration' | 'task' =
      options.scope ||
      (options.task ? 'task' : 'iteration');

    // ── 解析 iteration ──
    let iteration = options.iteration;
    if (scope === 'iteration' || scope === 'task') {
      iteration = await getDefaultIteration(options.iteration);
      if (!iteration) {
        spinner.fail('无效期次: 请用 -i 指定');
        return;
      }
    }

    // ── 构建输入 ──
    const input: AnalyzeInput = {
      sources,
      requirements,
      scope,
      iteration,
      taskId: options.task,
      depth: options.depth || 'normal',
      output: options.output,
    };

    spinner.stop();

    // ── 显示分析配置 ──
    logger.info('');
    logger.info('╔══════════════════════════════════════════╗');
    logger.info('║  📊 SpecCore 分析引擎                       ║');
    logger.info('╚══════════════════════════════════════════╝');
    logger.info('');
    logger.info(`   🎯 范围:   ${scope === 'global' ? '全局' : scope === 'task' ? '任务' : '期次'}`);
    if (iteration) logger.info(`   📅 期次:   ${iteration}`);
    if (options.task) logger.info(`   📋 任务:   ${options.task}`);
    if (sources.length > 0) logger.info(`   📁 源码:   ${sources.join(', ')}`);
    if (requirements.length > 0) logger.info(`   📄 需求:   ${requirements.join(', ')}`);
    logger.info(`   🔍 深度:   ${input.depth}`);
    logger.info('');

    // ── 执行分析 ──
    const runSpinner = new Spinner('分析中...');
    runSpinner.start();

    const result = await runAnalysis(input);

    runSpinner.stop('分析完成');

    // ── 摘要 ──
    logger.info('');
    logger.info('📊 分析摘要:');
    if (result.summary.blockers > 0) logger.info(`   🔴 阻断: ${result.summary.blockers} 个`);
    logger.info(`   ⚠️  问题: ${result.summary.issues} 个`);
    logger.info(`   📁 扫描文件: ${result.summary.filesAnalyzed} 个`);
    logger.info(`   🔗 API: ${result.summary.apisFound} 个`);
    logger.info(`   ⚡ 风险: ${result.summary.risks} 个`);
    logger.info(`   📝 报告: ${result.outputPath}`);
    logger.info('');

    // ── 确认保存 ──
    const isAuto = options.auto !== false; // --auto 是默认行为
    if (isAuto) {
      // 非交互: 直接保存
      await ensureDir(dirname(result.outputPath));
      await writeFile(result.outputPath, result.report);
      logger.info(`  ✅ 报告已保存 → ${result.outputPath}`);
    } else if (options.interactive) {
      // 交互确认
      const ask = (q: string): Promise<string> => {
        return new Promise(resolve => {
          const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
          rl.question(q, (a: string) => { rl.close(); resolve(a); });
        });
      };
      
      const answer = (await ask('  → 保存报告？[y]保存 [N]取消: ')).toLowerCase();
      if (answer !== 'y' && answer !== 'yes') {
        logger.info('\n  ❌ 已取消，报告未保存\n');
        return;
      }

      await ensureDir(dirname(result.outputPath));
      await writeFile(result.outputPath, result.report);
      logger.info(`\n  ✅ 分析完成 → ${result.outputPath}\n`);
    }

    // ── 全局范围: 生成 TECH_STACK + CODE_INDEX + REQUIREMENT ──
    if (scope === 'global' && sources.length > 0) {
      await generateGlobalArtifacts(sources, input.depth);
    }

    // ── 下一步提示 + Spec 文档生成 (仅 iteration 范围) ──
    if (scope === 'iteration') {
      if (result.summary.blockers > 0) {
        logger.warn('\n⚠️  存在阻断问题，建议解决后再拆分任务。');
      } else {
        logger.info('\n✅ 未发现阻断问题，可以继续拆分任务。');
      }

      // 生成全套 Spec 规范文档
      await generateIterationSpecDocs(iteration!);

      // 显示待确认清单
      try {
        const iterDir = `Iteration-${iteration}`;
        const questions = await extractQuestions(iterDir);
        if (questions.length > 0) {
          showQuestionChecklist(questions, '需求分析待确认');
        }
        showNextSteps('analyze');
      } catch { /* 非关键步骤 */ }
    }

    // ── Task 范围: 也检查是否补全 TECH/TEST/REVIEW ──
    if (scope === 'task' && options.task && iteration) {
      await enrichTaskDocs(iteration, options.task, requirements);
    }

  } catch (error: any) {
    spinner.fail(`分析失败: ${error.message || error}`);
    throw error;
  }
}

/**
 * 期次级 Spec 文档生成: 为 00-需求文档/ 创建全套规范文件
 */
async function generateIterationSpecDocs(iteration: string): Promise<void> {
  const specDir = join(`Iteration-${iteration}`, '00-产品需求');
  await ensureDir(specDir);

  const now = new Date().toISOString().split('T')[0];
  const templates: [string, string][] = [
    // ANALYSIS.md 由分析引擎自动生成，此处不覆盖
    ['TECH.md',
      `# 技术方案\n\n> 期次: ${iteration} | 生成: ${now}\n\n`
      + `## 架构\n\n_待填充_\n\n`
      + `## 数据库设计\n\n| 表名 | 字段 | 索引 | 说明 |\n| :--- | :--- | :--- | :--- |\n| | | | |\n\n`
      + `## API 设计\n\n| 方法 | 路径 | 说明 |\n| :--- | :--- | :--- |\n| | | |\n\n`
      + `## 缓存策略\n\n_待填充_\n`],
    ['TEST.md',
      `# 测试计划\n\n> 期次: ${iteration} | 生成: ${now}\n\n`
      + `## 单元测试\n\n- [ ] 核心模块覆盖\n\n`
      + `## 集成测试\n\n- [ ] API 端到端\n\n`
      + `## 边界测试\n\n- [ ] 异常参数\n- [ ] 超时重试\n- [ ] 并发冲突\n\n`
      + `## 性能测试\n\n- [ ] 压测方案\n`],
    ['REVIEW.md',
      `# Code Review 清单\n\n> 期次: ${iteration}\n\n`
      + `## 检查项\n\n- [ ] 参数校验完整性\n- [ ] 幂等性处理\n- [ ] 索引覆盖\n- [ ] 迁移脚本可回滚\n- [ ] 鉴权配置\n- [ ] 日志规范\n`],
    ['RISK.md',
      `# 风险评估\n\n> 期次: ${iteration} | 生成: ${now}\n\n`
      + `## 风险矩阵\n\n| 风险 | 可能性 | 影响 | 缓解措施 |\n| :--- | :--- | :--- | :--- |\n| | | | |\n\n`
      + `## 回滚方案\n\n1. 触发条件: _待定_\n2. 回滚步骤: _待定_\n`],
    ['DEPS.md',
      `# 依赖清单\n\n> 期次: ${iteration}\n\n`
      + `## 上游依赖\n\n| 服务 | 版本 | 用途 | SLA |\n| :--- | :--- | :--- | :--- |\n| | | | |\n\n`
      + `## 下游影响\n\n| 消费方 | 接口 | 影响 |\n| :--- | :--- | :--- |\n| | | |\n`],
    ['MONITOR.md',
      `# 监控指标\n\n> 期次: ${iteration}\n\n`
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
  const iterDir = `Iteration-${iteration}`;
  
  if (!(await pathExists(iterDir))) return;

  const entries = readdirSync(iterDir, { withFileTypes: true });
  const taskEntry = entries.find((e: any) => e.isDirectory() && e.name.startsWith(taskId));
  
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
