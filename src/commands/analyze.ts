/**
 * analyze — 需求分析 + 源码对标 + 技术方案确认
 * 流程：读取 REQUIREMENT.md → 分析 CODE_INDEX/ARCHITECTURE → 产出 ANALYSIS.md
 */
import { readFile, writeFile, pathExists, readdir } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../utils/logger';
import { extractQuestions, showQuestionChecklist } from '../core/question-checklist';
import { getDefaultIteration } from '../core/context';

import { showNextSteps } from '../core/next-steps';
import { registerRequirement, generateTrackerReport } from '../core/requirement-tracker';
import { buildCodeIndex, findRelevantCode, readRelevantSource, isIndexStale } from '../core/code-scanner';
export interface AnalyzeOptions {
  iteration?: string;
  output?: string;
  auto?: boolean;
  task?: string;   // 单任务分析模式
}

export async function analyzeCommand(options: AnalyzeOptions): Promise<void> {
  let spinner = new Spinner('正在分析需求...');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('无效期次');
      return;
    }

    const iterDir = `期次-${iteration}`;

    // ── Per-task analyze mode ──
    if (options.task) {
      spinner.stop();
      await perTaskAnalyze(iterDir, options.task);
      return;
    }

    const reqPath = join(iterDir, '00-需求文档', 'REQUIREMENT.md');
    
    if (!(await pathExists(reqPath))) {
      spinner.fail(`未找到需求文档: ${reqPath}`);
      logger.info('请先运行: speccore word2spec --files "..." -i ' + iteration);
      return;
    }

    const reqContent = await readFile(reqPath, 'utf-8');
    const cwd = process.cwd();

    // ── 1. 需求完整性扫描 ──
    spinner.stop(); spinner = new Spinner('扫描需求完整性...'); spinner.start();
    const issues = await scanCompleteness(reqContent);

    // ── 2. 智能源码扫描 ──
    spinner.stop(); spinner = new Spinner('扫描源码结构...'); spinner.start();
    
    // Build/refresh code index if needed
    if (await isIndexStale()) {
      const count = await buildCodeIndex();
      logger.info(`   📁 索引 ${count} 个源码文件`);
    }
    
    spinner.stop(); spinner = new Spinner('匹配相关源码...'); spinner.start();
    const rawMatches = await findRelevantCode(reqContent, 15);
    const codeMatches = rawMatches.map(m => ({
      path: m.file,
      matchType: 'api' as const,
      reason: m.apis.join(', ') || m.exports.join(', ') || `score: ${m.score}`,
    }));
    
    if (codeMatches.length > 0) {
      spinner.stop();
      logger.info(`   🔗 匹配到 ${codeMatches.length} 个相关文件:`);
      for (const m of rawMatches.slice(0, 5)) {
        logger.info(`     ${m.file} (score: ${m.score})`);
      }
      
      // Read relevant source for analysis
      spinner = new Spinner('读取相关源码...'); spinner.start();
      const sources = await readRelevantSource(rawMatches, 50000);
      spinner.stop();
      logger.info(`   📖 读取了 ${Object.keys(sources).length} 个源码文件`);
    } else {
      logger.info('   ⚠️ 未匹配到源码。配置扫描范围: .speccore/SETTINGS.md → code_scope');
    }


    // ── 3. 架构分析 ──
    spinner.stop(); spinner = new Spinner('分析架构影响...'); spinner.start();
    const archImpact = await analyzeArchitecture(cwd, reqContent);

    // ── 4. 生成分析报告 ──
    spinner.stop(); spinner = new Spinner('生成分析报告...'); spinner.start();
    const report = buildAnalysisReport(iteration, issues, codeMatches as any, archImpact);
    
    spinner.stop(`📊 报告已生成 (${report.length} 字符)`);

    // ── 4.5. 摘要预览 + 确认 ──
    logger.info('');
    logger.info('📊 分析摘要:');
    const blockerCount = issues.filter(i => i.severity === 'blocker').length;
    const warnCount = issues.filter(i => i.severity === 'warning').length;
    if (blockerCount > 0) logger.info(`   🔴 阻断问题: ${blockerCount} 个`);
    logger.info(`   🟡 待确认:   ${warnCount} 个`);
    logger.info(`   📁 涉及仓库: ${codeMatches.length} 个`);
    logger.info(`   ⚡ 影响模块: ${archImpact.modules?.length || 0} 个`);
    logger.info(`   详细报告: ${join(iterDir, '00-需求文档', options.output || 'ANALYSIS.md')}`);
    logger.info('');

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

    const outputPath = join(iterDir, '00-需求文档', options.output || 'ANALYSIS.md');
    await writeFile(outputPath, report);

    logger.info(`\n  ✅ 分析完成 → ${outputPath}\n`);
    
    if (issues.some(i => i.severity === 'blocker')) {
      logger.warn('\n⚠️  存在阻断问题，建议解决后再拆分任务。');
      logger.info(`   详细报告: ${outputPath}`);
    } else {
      logger.info('\n✅ 未发现阻断问题，可以继续拆分任务。');
    }
    
    // Show question checklist
    const questions = await extractQuestions(iterDir);
    if (questions.length > 0) {
      showQuestionChecklist(questions, '需求分析待确认');
    }
    showNextSteps('analyze');

  } catch (error) {
    spinner.fail(`分析失败: ${error}`);
    throw error;
  }
}

// ================================================================
// 需求完整性扫描
// ================================================================

interface Issue {
  severity: 'blocker' | 'warning' | 'info';
  category: string;
  message: string;
  location?: string;
}

async function scanCompleteness(content: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  const lines = content.split('\n');

  // 1. 检查接口表格是否完整
  let inTable = false;
  let tableRowCount = 0;
  let incompleteRows: string[] = [];

  for (const line of lines) {
    if (line.match(/^\|.*\|.*\|.*\|$/)) {
      if (line.includes(':---')) {
        inTable = true;
        continue;
      }
      if (inTable) {
        tableRowCount++;
        const cells = line.split('|').map(c => c.trim()).filter(Boolean);
        if (cells.length < 3 || cells.some(c => !c)) {
          incompleteRows.push(`  - ${line.trim()}`);
        }
      }
    } else {
      inTable = false;
    }
  }

  if (tableRowCount === 0) {
    issues.push({
      severity: 'warning',
      category: '接口定义',
      message: '需求中未检测到接口表格。建议补充「方法 | 路径 | 说明」格式的接口定义。',
    });
  }

  if (incompleteRows.length > 0) {
    issues.push({
      severity: 'blocker',
      category: '接口定义',
      message: `以下接口行缺少必填字段（方法/路径/说明）:\n${incompleteRows.join('\n')}`,
    });
  }

  // 2. 检查是否有空 section（只有标题，无内容）
  const sections = content.match(/^(#{2,3})\s+(.+)$/gm) || [];
  let prevIdx = 0;
  for (let i = 0; i < sections.length; i++) {
    const idx = content.indexOf(sections[i], prevIdx);
    const nextIdx = i + 1 < sections.length
      ? content.indexOf(sections[i + 1], idx + 1)
      : content.length;
    const sectionContent = content.substring(idx + sections[i].length, nextIdx).trim();
    
    if (!sectionContent || sectionContent.length < 20) {
      issues.push({
        severity: 'warning',
        category: '内容完整性',
        message: `章节「${sections[i].replace(/^#+\s*/, '')}」内容过少（${sectionContent.length} 字符），可能需要补充`,
        location: sections[i],
      });
    }
    prevIdx = idx;
  }

  // 3. 检查是否缺少关键章节
  const hasInterfaces = content.includes('接口') || content.includes('API');
  const hasDataModel = content.includes('数据模型') || content.includes('数据表') || content.includes('数据库');
  
  if (!hasInterfaces) {
    issues.push({
      severity: 'warning',
      category: '内容完整性',
      message: '未找到接口定义章节。建议添加「接口定义」部分。',
    });
  }

  if (!hasDataModel) {
    issues.push({
      severity: 'info',
      category: '内容完整性',
      message: '未找到数据模型/数据表描述。如需数据库变更，建议补充。',
    });
  }

  return issues;
}

// ================================================================
// 源码对标
// ================================================================

interface CodeMatch {
  repo: string;
  relevance: 'high' | 'medium' | 'low';
  reason: string;
  files?: string[];
}

async function matchCode(cwd: string, reqContent: string): Promise<CodeMatch[]> {
  const matches: CodeMatch[] = [];
  
  // 1. 读取 CODE_INDEX 获取所有仓库
  const codeIndexPath = join(cwd, '.speccore', 'GLOBAL', 'CODE_INDEX.md');
  let repos: { name: string; url: string; branch: string }[] = [];
  
  if (await pathExists(codeIndexPath)) {
    const codeIndex = await readFile(codeIndexPath, 'utf-8');
    const tableRows = codeIndex.match(/^\| .* \|.* \|.* \|/gm) || [];
    for (const row of tableRows) {
      const cells = row.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length >= 3 && !cells[0].includes('---') && cells[0] !== '项目名') {
        repos.push({ name: cells[0], url: cells[1] || '', branch: cells[2] || '' });
      }
    }
  }

  // 2. 提取需求中的关键词（路径、模块名、表名）
  const keywords = extractKeywords(reqContent);

  // 3. 读本地源代码目录匹配
  const srcDirs = ['src', 'app', 'lib', 'services', 'controllers', 'models', 'routes'];
  
  for (const dir of srcDirs) {
    const dirPath = join(cwd, dir);
    if (!(await pathExists(dirPath))) continue;
    
    const files = await readdir(dirPath);
    for (const keyword of keywords) {
      const matched = files.filter(f => 
        f.toLowerCase().includes(keyword.toLowerCase())
      );
      if (matched.length > 0) {
        matches.push({
          repo: `${dir}/`,
          relevance: 'high',
          reason: `匹配关键词「${keyword}」: ${matched.join(', ')}`,
          files: matched,
        });
      }
    }
  }

  // 4. 匹配 CODE_INDEX 中的仓库
  for (const repo of repos) {
    for (const keyword of keywords) {
      if (repo.name.toLowerCase().includes(keyword.toLowerCase()) ||
          repo.url.toLowerCase().includes(keyword.toLowerCase())) {
        matches.push({
          repo: repo.name,
          relevance: 'high',
          reason: `仓库名匹配关键词「${keyword}」`,
        });
      }
    }
  }

  // 去重
  const seen = new Set<string>();
  return matches.filter(m => {
    const key = m.repo + m.reason;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractKeywords(content: string): string[] {
  // 从需求和接口路径中提取关键词
  const keywords: string[] = [];
  
  // 提取接口路径中的模块名
  const pathMatches = content.match(/\/api\/\w+\/(\w+)/g) || [];
  for (const path of pathMatches) {
    const parts = path.split('/');
    const module = parts[parts.length - 1] || parts[parts.length - 2];
    if (module) keywords.push(module);
  }

  // 提取英文模块名
  const moduleMatches = content.match(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g) || [];
  keywords.push(...moduleMatches);

  // 提取中文关键词（名词短语）
  const cnMatches = content.match(/(?:用户|订单|支付|商品|消息|权限|日志|报表|配置|审计|通知|审批|工作流|搜索|推荐|统计|监控|调度|网关|缓存|队列)/g) || [];
  keywords.push(...cnMatches);

  return [...new Set(keywords)].slice(0, 20);
}

// ================================================================
// 架构影响分析
// ================================================================

interface ArchImpact {
  modules: string[];
  newDependencies: string[];
  risks: string[];
}

async function analyzeArchitecture(cwd: string, reqContent: string): Promise<ArchImpact> {
  const impact: ArchImpact = { modules: [], newDependencies: [], risks: [] };
  
  // 1. 读取架构文档
  const archPath = join(cwd, '.speccore', 'GLOBAL', 'ARCHITECTURE.md');
  if (await pathExists(archPath)) {
    const archContent = await readFile(archPath, 'utf-8');
    
    // 检查需求是否涉及现有模块
    const moduleSection = archContent.match(/## 模块|## 系统边界|## 服务列表/);
    if (moduleSection) {
      impact.modules.push('⚠️ 需要对照 ARCHITECTURE.md 确认影响范围');
    }
  }

  // 2. 检查跨模块依赖
  const apiCalls = reqContent.match(/\/api\/[a-zA-Z0-9/-]+/g) || [];
  const uniquePaths = [...new Set(apiCalls)];
  impact.modules.push(...uniquePaths.map(p => `接口: ${p}`));

  // 3. 新依赖检测
  if (reqContent.includes('消息队列') || reqContent.includes('MQ') || reqContent.includes('Kafka')) {
    impact.newDependencies.push('消息队列');
  }
  if (reqContent.includes('缓存') || reqContent.includes('Redis') || reqContent.includes('Cache')) {
    impact.newDependencies.push('缓存服务 (Redis)');
  }
  if (reqContent.includes('OSS') || reqContent.includes('对象存储') || reqContent.includes('文件上传')) {
    impact.newDependencies.push('对象存储 (OSS/S3)');
  }
  if (reqContent.includes('WebSocket') || reqContent.includes('实时') || reqContent.includes('推送')) {
    impact.newDependencies.push('WebSocket 实时通信');
  }
  if (reqContent.includes('定时') || reqContent.includes('调度') || reqContent.includes('Cron')) {
    impact.newDependencies.push('定时任务调度');
  }
  if (reqContent.includes('ES') || reqContent.includes('搜索') || reqContent.includes('全文')) {
    impact.newDependencies.push('搜索引擎 (Elasticsearch)');
  }

  // 4. 风险检测
  if (reqContent.includes('批量删除') || reqContent.includes('批量操作')) {
    impact.risks.push('存在批量操作，需考虑事务一致性和性能');
  }
  if (reqContent.includes('导出') || reqContent.includes('报表')) {
    impact.risks.push('存在导出/报表功能，需考虑大数据量时的内存和超时');
  }
  if (reqContent.includes('权限') || reqContent.includes('角色') || reqContent.includes('RBAC')) {
    impact.risks.push('涉及权限变更，需确认 RBAC 模型兼容性');
  }

  return impact;
}

// ================================================================
// 生成分析报告
// ================================================================

function buildAnalysisReport(
  iteration: string,
  issues: Issue[],
  codeMatches: CodeMatch[],
  archImpact: ArchImpact
): string {
  const now = new Date().toISOString().split('T')[0];
  const blockerCount = issues.filter(i => i.severity === 'blocker').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;

  let report = `# 需求分析报告\n\n`;
  report += `> 期次: ${iteration} | 分析时间: ${now} | 状态: ${blockerCount > 0 ? '🔴 有阻断' : '🟢 可拆分'}\n\n`;
  report += `---\n\n`;

  // 1. 完整性检查
  report += `## 1. 需求完整性检查\n\n`;
  report += `| 严重度 | 分类 | 问题 |\n`;
  report += `| :--- | :--- | :--- |\n`;
  for (const issue of issues) {
    const icon = issue.severity === 'blocker' ? '🔴' : issue.severity === 'warning' ? '🟡' : 'ℹ️';
    report += `| ${icon} ${issue.severity} | ${issue.category} | ${issue.message.replace(/\n/g, '<br>')} |\n`;
  }
  if (issues.length === 0) {
    report += `| ✅ | - | 未发现明显问题 |\n`;
  }
  report += `\n`;

  // 2. 源码对标
  report += `## 2. 源码对标\n\n`;
  if (codeMatches.length > 0) {
    report += `| 仓库/目录 | 关联度 | 原因 |\n`;
    report += `| :--- | :--- | :--- |\n`;
    for (const m of codeMatches) {
      report += `| ${m.repo} | ${m.relevance} | ${m.reason} |\n`;
    }
  } else {
    report += `> ⚠️ 未匹配到相关源码。请确认 CODE_INDEX.md 是否已配置。\n`;
  }
  report += `\n`;

  // 3. 架构影响
  report += `## 3. 架构影响\n\n`;
  
  if (archImpact.modules.length > 0) {
    report += `### 涉及模块\n`;
    for (const m of archImpact.modules) {
      report += `- ${m}\n`;
    }
    report += `\n`;
  }

  if (archImpact.newDependencies.length > 0) {
    report += `### 新增依赖\n`;
    for (const d of archImpact.newDependencies) {
      report += `- [ ] ${d}\n`;
    }
    report += `\n`;
  }

  if (archImpact.risks.length > 0) {
    report += `### ⚠️ 风险提示\n`;
    for (const r of archImpact.risks) {
      report += `- ${r}\n`;
    }
    report += `\n`;
  }

  // 4. 待确认清单
  report += `## 4. 待确认清单\n\n`;
  report += `> 以下问题需要团队在拆分任务前确认。\n\n`;
  
  for (const issue of issues.filter(i => i.severity !== 'info')) {
    report += `- [ ] ${issue.message.replace(/\n/g, ' ').slice(0, 100)}\n`;
  }

  for (const risk of archImpact.risks) {
    report += `- [ ] ${risk}\n`;
  }

  if (archImpact.newDependencies.length > 0) {
    report += `- [ ] 确认新增依赖的引入方案和排期\n`;
  }

  report += `\n---\n\n`;
  report += `## 5. 技术方案（待填写）\n\n`;
  report += `> 以下由技术负责人/开发团队填写，确认后执行 \`speccore iteration split\`。\n\n`;
  report += `### 技术选型\n\n`;
  report += `| 模块 | 技术方案 | 负责人 | 预计工时 |\n`;
  report += `| :--- | :--- | :--- | :--- |\n`;
  report += `| | | | |\n\n`;
  report += `### 数据库变更\n\n`;
  report += `| 表名 | 变更类型 | 说明 |\n`;
  report += `| :--- | :--- | :--- |\n`;
  report += `| | | |\n\n`;
  report += `### 接口依赖\n\n`;
  report += `| 调用方 | 被调用方 | 接口 | 说明 |\n`;
  report += `| :--- | :--- | :--- | :--- |\n`;
  report += `| | | | |\n\n`;
  report += `### 确认签字\n\n`;
  report += `- [ ] 需求确认无遗漏\n`;
  report += `- [ ] 技术方案评审通过\n`;
  report += `- [ ] 工时评估合理\n`;
  report += `- [ ] 可以开始拆分任务\n`;

  return report;
}

/**
 * 单任务分析 — 读取任务的 REQ.md，完善 TECH/TEST/REVIEW
 */
async function perTaskAnalyze(iterDir: string, taskId: string): Promise<void> {
  const { readdirSync } = require('fs');
  const entries = readdirSync(iterDir, { withFileTypes: true });
  const taskEntry = entries.find((e: any) => e.isDirectory() && e.name.startsWith(taskId));
  
  if (!taskEntry) {
    logger.error(`Task 未找到: ${taskId}`);
    logger.info('可用任务:');
    for (const e of entries) {
      if (e.isDirectory() && e.name.startsWith('Task-')) logger.info(`  - ${e.name}`);
    }
    return;
  }

  const fullTaskDir = join(iterDir, taskEntry.name);
  const backendDir = join(fullTaskDir, 'backend');
  
  const spinner = new Spinner(`分析 ${taskEntry.name}`);
  spinner.start();

  try {
    const reqPath = join(backendDir, 'REQ.md');
    let reqContent = '';
    if (await pathExists(reqPath)) reqContent = await readFile(reqPath, 'utf-8');

    // ── Compute changes (dry run) ──
    interface Change { file: string; section: string; items: string[] }
    const changes: Change[] = [];

    // Enrich TECH.md
    const techPath = join(backendDir, 'TECH.md');
    let techContent = '';
    if (await pathExists(techPath)) {
      techContent = await readFile(techPath, 'utf-8');
      if (!techContent.includes('## 分析建议')) {
        const items: string[] = [];
        const apis = (reqContent.match(/\/api\/[a-zA-Z0-9\/-]+/g) || []).map(a => a.trim());
        if (apis.length > 0) {
          items.push(`检测到 ${apis.length} 个 API:`);
          for (const api of [...new Set(apis)]) items.push(`  \`${api}\``);
        }
        if (reqContent.match(/数据库|表|DDL/)) items.push('涉及数据库变更，请补充 DDL');
        if (reqContent.match(/权限|RBAC|鉴权/)) items.push('涉及权限控制，注意鉴权边界');
        if (items.length > 0) changes.push({ file: 'TECH.md', section: '分析建议', items });
      }
    }

    // Enrich TEST.md
    const testPath = join(backendDir, 'TEST.md');
    if (await pathExists(testPath)) {
      const testContent = await readFile(testPath, 'utf-8');
      if (!testContent.includes('## 补充分析')) {
        const items: string[] = [];
        if (reqContent.includes('POST') || reqContent.includes('创建')) items.push('[ ] 正常参数 + 异常参数测试');
        if (reqContent.includes('GET') || reqContent.includes('查询')) items.push('[ ] 分页 / 筛选 / 空结果测试');
        if (reqContent.includes('DELETE') || reqContent.includes('删除')) items.push('[ ] 删除确认 + 级联处理');
        if (reqContent.includes('权限') || reqContent.includes('RBAC')) items.push('[ ] 无权限访问 + 越权检测');
        if (reqContent.includes('批量') || reqContent.includes('导出')) items.push('[ ] 大数据量 + 超时处理');
        if (items.length > 0) changes.push({ file: 'TEST.md', section: '补充分析', items });
      }
    }

    // Enrich REVIEW.md
    const reviewPath = join(backendDir, 'REVIEW.md');
    if (await pathExists(reviewPath)) {
      const reviewContent = await readFile(reviewPath, 'utf-8');
      if (!reviewContent.includes('## 本任务专项检查')) {
        const items: string[] = [];
        if (reqContent.includes('POST') || reqContent.includes('创建')) items.push('[ ] 参数校验 + 幂等性处理');
        if (reqContent.includes('数据库') || reqContent.includes('表')) items.push('[ ] 索引覆盖 + 迁移脚本可回滚');
        if (reqContent.includes('权限') || reqContent.includes('RBAC')) items.push('[ ] 鉴权注解/中间件正确配置');
        if (items.length > 0) changes.push({ file: 'REVIEW.md', section: '本任务专项检查', items });
      }
    }

    spinner.stop();

    if (changes.length === 0) {
      logger.info(`\n  ✅ ${taskEntry.name} 已是最新，无需更新`);
      return;
    }

    // ── Show preview ──
    logger.info(`\n╔══════════════════════════════════════════╗`);
    logger.info(`║  📋 ${taskEntry.name} 分析结果预览               ║`);
    logger.info(`╚══════════════════════════════════════════╝\n`);

    for (const c of changes) {
      logger.info(`  📄 ${c.file} → 新增「${c.section}」:`);
      for (const item of c.items) {
        logger.info(`      ${item}`);
      }
      logger.info('');
    }

    // ── Confirm ──
    const ask = (q: string): Promise<string> => {
      return new Promise(resolve => {
        const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
        rl.question(q, (a: string) => { rl.close(); resolve(a); });
      });
    };
    const answer = (await ask(`  → 确认写入？[y] 确认覆盖 [N] 取消: `)).toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      logger.info('\n  ❌ 已取消，文档未修改\n');
      return;
    }

    // ── Apply changes ──
    for (const c of changes) {
      if (c.file === 'TECH.md') {
        let notes = `\n\n---\n\n## ${c.section}\n\n> 自动生成，可反复修改\n\n`;
        notes += c.items.map(i => `- ${i}`).join('\n') + '\n';
        await writeFile(techPath, techContent + notes);
      }
      if (c.file === 'TEST.md') {
        let notes = `\n\n---\n\n## ${c.section}\n`;
        notes += c.items.join('\n') + '\n';
        await writeFile(testPath, (await readFile(testPath, 'utf-8')) + notes);
      }
      if (c.file === 'REVIEW.md') {
        let notes = `\n\n---\n\n## ${c.section}\n`;
        notes += c.items.join('\n') + '\n';
        await writeFile(reviewPath, (await readFile(reviewPath, 'utf-8')) + notes);
      }
    }

    logger.info(`\n  ✅ ${taskEntry.name} 分析完成，已更新 ${changes.length} 个文件`);
    logger.info('  💡 可反复运行完善:');
    logger.info(`     speccore analyze --task=${taskId} --iteration=${iterDir.replace('期次-', '')}`);
    logger.info('');

  } catch (error) {
    spinner.fail(`分析失败: ${error}`);
  }
}

async function checkConstitution(iterDir: string): Promise<string[]> {
  const constitutionPath = join(process.cwd(), ".speccore", "PROJECT", "CONSTITUTION.md");
  if (!(await pathExists(constitutionPath))) return [];
  
  const constitution = await readFile(constitutionPath, "utf-8");
  const reqPath = join(iterDir, "00-需求文档", "REQUIREMENT.md");
  if (!(await pathExists(reqPath))) return [];
  
  const req = await readFile(reqPath, "utf-8");
  const violations: string[] = [];
  
  // Check: RESTful requirement
  if (constitution.includes("RESTful") && req.includes("GraphQL")) {
    violations.push("[违反] 宪法要求 RESTful API，但需求中包含 GraphQL 引用");
  }
  if (constitution.includes("RESTful") && req.includes("WebSocket") && !req.includes("REST")) {
    violations.push("[警告] 宪法要求 RESTful，建议确认 WebSocket 使用场景");
  }
  
  // Check: language consistency
  if (constitution.includes("Java") && req.includes("Python Flask")) {
    violations.push("[违反] 宪法指定 Java，但技术方案使用 Python");
  }
  
  // Check: test requirement
  if (constitution.includes("单元测试")) {
    violations.push("[提醒] 宪法要求单元测试，请确认 TEST.md 已完善");
  }
  
  // Check: PR review requirement
  if (constitution.includes("PR 审查")) {
    violations.push("[提醒] 宪法要求 PR 审查，开发完成后需创建 PR");
  }
  
  return violations;
}

