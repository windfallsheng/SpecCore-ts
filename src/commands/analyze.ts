/**
 * analyze — 需求分析 + 源码对标 + 技术方案确认
 * 流程：读取 REQUIREMENT.md → 分析 CODE_INDEX/ARCHITECTURE → 产出 ANALYSIS.md
 */
import { readFile, writeFile, pathExists, readdir } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';

import { showNextSteps } from '../core/next-steps';
export interface AnalyzeOptions {
  iteration?: string;
  output?: string;
  auto?: boolean;  // 自动模式：不交互，直接产出分析报告
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

    // ── 2. 源码对标 ──
    spinner.stop(); spinner = new Spinner('对标现有源码...'); spinner.start();
    const codeMatches = await matchCode(cwd, reqContent);

    // ── 3. 架构分析 ──
    spinner.stop(); spinner = new Spinner('分析架构影响...'); spinner.start();
    const archImpact = await analyzeArchitecture(cwd, reqContent);

    // ── 4. 生成分析报告 ──
    spinner.stop(); spinner = new Spinner('生成分析报告...'); spinner.start();
    const report = buildAnalysisReport(iteration, issues, codeMatches, archImpact);
    
    const outputPath = join(iterDir, '00-需求文档', options.output || 'ANALYSIS.md');
    await writeFile(outputPath, report);

    spinner.stop(`✅ 分析完成 → ${outputPath}`);

    // ── 5. 摘要输出 ──
    logger.info('');
    logger.info('📊 分析摘要:');
    logger.info(`   🔴 阻断问题: ${issues.filter(i => i.severity === 'blocker').length} 个`);
    logger.info(`   🟡 待确认:   ${issues.filter(i => i.severity === 'warning').length} 个`);
    logger.info(`   📁 涉及仓库: ${codeMatches.length} 个`);
    logger.info(`   ⚡ 影响模块: ${archImpact.modules.length} 个`);
    
    if (issues.some(i => i.severity === 'blocker')) {
      logger.warn('\n⚠️  存在阻断问题，建议解决后再拆分任务。');
      logger.info(`   详细报告: ${outputPath}`);
    } else {
      logger.info('\n✅ 未发现阻断问题，可以继续拆分任务。');
  showNextSteps('analyze');
    }

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
