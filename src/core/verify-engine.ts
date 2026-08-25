/**
 * verify-engine — 代码验证引擎
 *
 * 执行后自动验证：编译检查 + Lint + 单元测试
 * 根据项目类型（Node.js/Java/Go/Python）自动检测命令
 * 生成结构化报告到 VERIFY_REPORT.md（任务根目录）
 */

import { execSync } from 'child_process';
import { join } from 'path';
import { pathExists, readFile, writeFile, ensureDir, readdir } from 'fs-extra';
import { logger } from '../utils/logger';
// v6.84.0+: AGENTS 引擎集成
import {
  resolveAgentsForPhase,
  buildAgentPrompt,
  type AgentContext,
} from './agents';
import { validateContentQuality } from './spec-skeleton';

// ============================================================
// 类型定义
// ============================================================

export type ProjectType = 'node' | 'java' | 'go' | 'python' | 'unknown';

export interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'skip' | 'warn';
  duration: number; // ms
  output: string;
  details: string;
  blocking: boolean; // true = 阻塞性检查，失败则不允许继续
}

export interface VerifyReport {
  taskId: string;
  timestamp: string;
  projectType: ProjectType;
  codePath: string;
  checks: CheckResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    warnings: number;
  };
}

// ============================================================
// 项目类型检测
// ============================================================

export async function detectProjectType(codePath: string): Promise<ProjectType> {
  if (await pathExists(join(codePath, 'package.json'))) return 'node';
  if (await pathExists(join(codePath, 'pom.xml'))) return 'java';
  if (await pathExists(join(codePath, 'build.gradle')) || await pathExists(join(codePath, 'build.gradle.kts'))) return 'java';
  if (await pathExists(join(codePath, 'go.mod'))) return 'go';
  if (await pathExists(join(codePath, 'requirements.txt')) || await pathExists(join(codePath, 'setup.py')) || await pathExists(join(codePath, 'pyproject.toml'))) return 'python';
  return 'unknown';
}

// ============================================================
// 命令构建
// ============================================================

interface ProjectCommands {
  compile: string | null;
  lint: string | null;
  test: string | null;
}

function getCommands(projectType: ProjectType, codePath: string): ProjectCommands {
  switch (projectType) {
    case 'node':
      return {
        compile: detectNodeCompileCommand(codePath),
        lint: detectNodeLintCommand(codePath),
        test: detectNodeTestCommand(codePath),
      };
    case 'java':
      return {
        compile: 'mvn compile -q 2>&1 || ./mvnw compile -q 2>&1',
        lint: 'mvn checkstyle:check -q 2>&1 || true',
        test: 'mvn test -q 2>&1 || ./mvnw test -q 2>&1',
      };
    case 'go':
      return {
        compile: 'go build ./... 2>&1',
        lint: 'golangci-lint run 2>&1 || true',
        test: 'go test ./... -v 2>&1',
      };
    case 'python':
      return {
        compile: 'python -m py_compile $(find . -name "*.py") 2>&1 || python3 -m compileall . -q 2>&1',
        lint: 'flake8 . 2>&1 || pylint . 2>&1 || ruff check . 2>&1 || true',
        test: 'pytest -v 2>&1 || python -m pytest -v 2>&1 || true',
      };
    default:
      return { compile: null, lint: null, test: null };
  }
}

function detectNodeCompileCommand(codePath: string): string {
  // 检测 tsconfig.json → TypeScript 项目
  // 检测 package.json 中的 build script
  try {
    const fs = require('fs');
    const pkgPath = join(codePath, 'package.json');
    if (require('fs').existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      // TypeScript 项目
      if (require('fs').existsSync(join(codePath, 'tsconfig.json'))) {
        if (pkg.devDependencies?.['typescript'] || pkg.dependencies?.['typescript']) {
          return 'npx tsc --noEmit 2>&1';
        }
      }
      // 有 build script
      if (pkg.scripts?.build) {
        return 'npm run build 2>&1';
      }
    }
  } catch {}
  return 'npx tsc --noEmit 2>&1 || echo "No compile check available"';
}

function detectNodeLintCommand(codePath: string): string | null {
  try {
    const fs = require('fs');
    const pkgPath = join(codePath, 'package.json');
    if (require('fs').existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.scripts?.lint) return 'npm run lint 2>&1';
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['eslint']) return 'npx eslint . --ext .js,.jsx,.ts,.tsx 2>&1';
      if (deps['biome']) return 'npx biome check . 2>&1';
    }
  } catch {}
  return null;
}

function detectNodeTestCommand(codePath: string): string | null {
  try {
    const fs = require('fs');
    const pkgPath = join(codePath, 'package.json');
    if (require('fs').existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.scripts?.test) return 'npm test 2>&1';
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['vitest']) return 'npx vitest run 2>&1';
      if (deps['jest']) return 'npx jest --passWithNoTests 2>&1';
    }
  } catch {}
  return null;
}

// ============================================================
// 执行检查
// ============================================================

function runCheck(name: string, command: string | null, codePath: string, timeout: number = 120000, blocking: boolean = true): CheckResult {
  if (!command) {
    return { name, status: 'skip', duration: 0, output: '', details: '未检测到可用命令', blocking };
  }

  const start = Date.now();
  try {
    const output = execSync(command, {
      cwd: codePath,
      timeout,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const duration = Date.now() - start;
    return { name, status: 'pass', duration, output: output || '', details: '通过', blocking };
  } catch (error: any) {
    const duration = Date.now() - start;
    const output = (error.stdout || '') + (error.stderr || '');

    // 检查是否有 warning 但无 error
    if (error.status === 0) {
      return { name, status: 'warn', duration, output, details: '有警告但通过', blocking };
    }

    // lint 命令可能用 || true 结尾，status=0 但无输出
    if (command.includes('|| true')) {
      return { name, status: 'warn', duration, output, details: 'Lint 工具未安装或无配置', blocking: false };
    }

    return { name, status: 'fail', duration, output: output.slice(0, 5000), details: `退出码: ${error.status}`, blocking };
  }
}

// ============================================================
// 报告生成
// ============================================================

export function generateReportMarkdown(report: VerifyReport): string {
  const { summary } = report;
  const passRate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;

  let md = `# 验证报告 — ${report.taskId}\n\n`;
  md += `> 执行时间: ${report.timestamp}\n`;
  md += `> 项目类型: ${report.projectType}\n`;
  md += `> 代码路径: \`${report.codePath}\`\n\n`;

  // 总览
  md += `## 总览\n\n`;
  md += `| 指标 | 值 |\n| :--- | :--- |\n`;
  md += `| 通过率 | ${passRate}% (${summary.passed}/${summary.total}) |\n`;
  md += `| 耗时 | ${report.checks.reduce((s, c) => s + c.duration, 0) / 1000}s |\n`;
  md += `| 失败 | ${summary.failed} |\n`;
  md += `| 警告 | ${summary.warnings} |\n`;
  md += `| 跳过 | ${summary.skipped} |\n\n`;

  // 各项检查
  md += `## 检查结果\n\n`;
  md += `| 检查项 | 状态 | 耗时 | 详情 |\n`;
  md += `| :--- | :--- | :--- | :--- |\n`;
  for (const check of report.checks) {
    const icon = check.status === 'pass' ? '✅' : check.status === 'fail' ? '❌' : check.status === 'warn' ? '⚠️' : '⏭️';
    const dur = check.duration > 0 ? `${(check.duration / 1000).toFixed(1)}s` : '-';
    md += `| ${check.name} | ${icon} ${check.status} | ${dur} | ${check.details} |\n`;
  }
  md += '\n';

  // 详细输出（仅失败和警告）
  const failedChecks = report.checks.filter(c => c.status === 'fail' || c.status === 'warn');
  if (failedChecks.length > 0) {
    md += `## 详细输出\n\n`;
    for (const check of failedChecks) {
      md += `### ${check.name}\n\n`;
      md += `\`\`\`
${check.output.slice(0, 3000)}
\`\`\`

`;
    }
  }

  // 结论
  md += `## 结论\n\n`;
  if (summary.failed === 0 && summary.warnings === 0) {
    md += `✅ 所有检查通过，代码质量良好。\n`;
  } else if (summary.failed === 0) {
    md += `⚠️ 所有检查通过，但有 ${summary.warnings} 项警告需要关注。\n`;
  } else {
    md += `❌ ${summary.failed} 项检查失败，请修复后重新验证。\n`;
    md += `\n建议:\n`;
    for (const check of failedChecks.filter(c => c.status === 'fail')) {
      md += `- 修复 **${check.name}** 中的问题\n`;
    }
  }

  return md;
}

// ============================================================
// 主入口
// ============================================================

export async function runVerification(
  taskId: string,
  codePath: string,
  options?: { type?: 'compile' | 'lint' | 'test' | 'all'; timeout?: number }
): Promise<VerifyReport> {
  const checkType = options?.type || 'all';
  const timeout = options?.timeout || 120000;

  logger.info(`🔍 开始验证: ${taskId}`);
  logger.info(`   代码路径: ${codePath}`);

  // 检测项目类型
  const projectType = await detectProjectType(codePath);
  logger.info(`   项目类型: ${projectType}`);

  if (projectType === 'unknown') {
    logger.warn('   未识别项目类型，跳过验证');
    return {
      taskId,
      timestamp: new Date().toISOString(),
      projectType,
      codePath,
      checks: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0, warnings: 0 },
    };
  }

  const commands = getCommands(projectType, codePath);
  const checks: CheckResult[] = [];

  // 编译检查
  if (checkType === 'all' || checkType === 'compile') {
    logger.info('   📦 编译检查...');
    const result = runCheck('编译检查', commands.compile, codePath, timeout);
    checks.push(result);
    logger.info(`   ${result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : '⏭️'} ${result.details} (${(result.duration / 1000).toFixed(1)}s)`);
  }

  // Lint 检查
  if (checkType === 'all' || checkType === 'lint') {
    logger.info('   🔎 Lint 检查...');
    const result = runCheck('Lint 检查', commands.lint, codePath, timeout);
    checks.push(result);
    logger.info(`   ${result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : '⏭️'} ${result.details} (${(result.duration / 1000).toFixed(1)}s)`);
  }

  // 单元测试
  if (checkType === 'all' || checkType === 'test') {
    logger.info('   🧪 单元测试...');
    const result = runCheck('单元测试', commands.test, codePath, timeout);
    checks.push(result);
    logger.info(`   ${result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : '⏭️'} ${result.details} (${(result.duration / 1000).toFixed(1)}s)`);
  }

  // 汇总
  const report: VerifyReport = {
    taskId,
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    projectType,
    codePath,
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter(c => c.status === 'pass').length,
      failed: checks.filter(c => c.status === 'fail').length,
      skipped: checks.filter(c => c.status === 'skip').length,
      warnings: checks.filter(c => c.status === 'warn').length,
    },
  };

  return report;
}

/**
 * 将验证报告写入文件
 */
export async function writeVerifyReport(report: VerifyReport, outputDir: string): Promise<string> {
  await ensureDir(outputDir);
  const reportPath = join(outputDir, 'VERIFY_REPORT.md');
  const md = generateReportMarkdown(report);
  await writeFile(reportPath, md);
  return reportPath;
}

/**
 * 生成 AI 修复 Prompt（v8.2.0+ 增强版）
 * 当验证失败时，生成结构化 Prompt 让 AI 定位并修复问题
 * 注入任务规格上下文、知识图谱依赖链、API 契约等
 */
export async function generateFixPrompt(report: VerifyReport, taskDir: string): Promise<string> {
  const failedChecks = report.checks.filter(c => c.status === 'fail');
  const warningChecks = report.checks.filter(c => c.status === 'warn');

  let prompt = `# 代码验证失败 — 请修复\n\n`;
  prompt += `## 任务信息\n\n`;
  prompt += `- 任务: ${report.taskId}\n`;
  prompt += `- 代码路径: \`${report.codePath}\`\n`;
  prompt += `- 项目类型: ${report.projectType}\n`;
  prompt += `- 验证轮次: ${report.checks.length} 项检查\n\n`;

  // ── v8.2.0+: 注入任务规格上下文 ──
  const specCtx = await loadFixSpecContext(taskDir);
  if (specCtx.reqSummary) {
    prompt += `## 需求规格摘要 (REQ.md)\n\n`;
    prompt += `${specCtx.reqSummary}\n\n`;
  }
  if (specCtx.techSummary) {
    prompt += `## 技术规格摘要 (TECH.md)\n\n`;
    prompt += `${specCtx.techSummary}\n\n`;
  }

  // ── v8.2.0+: 注入知识图谱上下文（依赖链 + 相邻任务） ──
  try {
    const { loadKnowledgeGraph, traceDependencyChain } = await import('./knowledge-graph');
    const graph = await loadKnowledgeGraph(process.cwd());
    if (graph && report.taskId) {
      const chains = traceDependencyChain(graph, report.taskId, 2);
      if (chains.length > 0) {
        prompt += `## 依赖链路（知识图谱）\n\n`;
        prompt += `修复时请注意以下依赖任务的影响:\n`;
        for (const chain of chains.slice(0, 5)) {
          const depEntity = graph.entities[chain.path[chain.path.length - 1]];
          if (depEntity) {
            prompt += `- **${depEntity.title}** (${depEntity.type}) — 深度 ${chain.depth}\n`;
          }
        }
        prompt += '\n';
      }
    }
  } catch { /* 知识图谱不可用则跳过 */ }

  // ── v8.2.0+: 注入 API 契约 ──
  try {
    const contractPath = join(taskDir, '_shared', 'API_CONTRACT.yaml');
    if (await pathExists(contractPath)) {
      const content = await readFile(contractPath, 'utf-8');
      if (content.trim().length > 0) {
        prompt += `## API 契约 (_shared/API_CONTRACT.yaml)\n\n`;
        prompt += `\`\`\`yaml
${content.slice(0, 1200)}
\`\`\`

`;
      }
    }
  } catch { /* 跳过 */ }

  prompt += `## 失败项\n\n`;
  for (const check of failedChecks) {
    prompt += `### ${check.name}\n\n`;
    prompt += `状态: ❌ 失败\n`;
    prompt += `耗时: ${(check.duration / 1000).toFixed(1)}s\n\n`;
    prompt += `错误输出:\n\`\`\`\n${check.output.slice(0, 3000)}\n\`\`\`\n\n`;
  }

  if (warningChecks.length > 0) {
    prompt += `## 警告项\n\n`;
    for (const check of warningChecks) {
      prompt += `### ${check.name}\n\n`;
      prompt += `状态: ⚠️ 警告\n\`\`\`\n${check.output.slice(0, 1000)}\n\`\`\`\n\n`;
    }
  }

  prompt += `## 要求\n\n`;
  prompt += `1. 读取上述错误信息，定位问题根因\n`;
  prompt += `2. **注意依赖影响**：修复时不要破坏 API 契约中定义的接口契约\n`;
  prompt += `3. 修复代码，确保:\n`;
  prompt += `   - 编译通过（无类型错误、语法错误）\n`;
  prompt += `   - Lint 通过（无代码风格问题）\n`;
  prompt += `   - 测试通过（所有测试用例绿灯）\n`;
  prompt += `   - 测试用例覆盖：检查子任务目录下的 \`TEST.md\` 中的未覆盖用例，补充实现\n`;
  prompt += `   - 评审项合规：检查子任务目录下的 \`REVIEW.md\` 中的未合规项，补充实现\n`;
  prompt += `4. 修复后在下方「修复记录」表格中记录:\n`;
  prompt += `   - 问题描述\n`;
  prompt += `   - 修复方案\n`;
  prompt += `   - 修改的文件\n\n`;

  prompt += `## 修复记录\n\n`;
  prompt += `| 问题 | 根因 | 修复方案 | 修改文件 |\n`;
  prompt += `| :--- | :--- | :--- | :--- |\n`;
  prompt += `| | | | |\n\n`;

  prompt += `> 修复完成后，运行 \`speccore verify -t ${report.taskId}\` 重新验证\n`;

  return prompt;
}

/**
 * 加载修复 Prompt 所需的规格上下文
 */
async function loadFixSpecContext(taskDir: string): Promise<{ reqSummary: string; techSummary: string }> {
  const result = { reqSummary: '', techSummary: '' };
  try {
    const reqPaths = [join(taskDir, '00-specs', 'REQ.md'), join(taskDir, 'REQ.md')];
    for (const p of reqPaths) {
      if (await pathExists(p)) {
        const content = await readFile(p, 'utf-8');
        result.reqSummary = extractFixSummary(content, 1200);
        break;
      }
    }
    const techPaths = [join(taskDir, '00-specs', 'TECH.md'), join(taskDir, 'TECH.md')];
    for (const p of techPaths) {
      if (await pathExists(p)) {
        const content = await readFile(p, 'utf-8');
        result.techSummary = extractFixSummary(content, 800);
        break;
      }
    }
  } catch { /* 静默失败 */ }
  return result;
}

/** 从文档提取修复所需摘要（保留标题 + 关键段落） */
function extractFixSummary(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const lines = content.split('\n');
  const result: string[] = [];
  let chars = 0;
  let inCodeBlock = false;
  for (const line of lines) {
    if (line.startsWith('```')) inCodeBlock = !inCodeBlock;
    // 优先保留标题行和列表项
    const isImportant = line.startsWith('#') || line.startsWith('- ') || line.startsWith('|');
    if (chars + line.length > maxChars && !isImportant) break;
    result.push(line);
    chars += line.length + 1;
    if (chars >= maxChars && !inCodeBlock) break;
  }
  if (result.length < lines.length) {
    result.push('\n> ...（内容已截断）');
  }
  return result.join('\n');
}

/**
 * 生成 SPECCORE_EXEC 标签，触发 AI 修复
 */
export async function outputFixTag(report: VerifyReport, taskDir: string, round: number): Promise<void> {
  const prompt = await generateFixPrompt(report, taskDir);
  console.log('');
  console.log(`[SPECCORE_EXEC: verify-fix round=${round} task=${report.taskId}]`);
  console.log('');
  console.log(prompt);
  console.log('');
  console.log('[/SPECCORE_EXEC]');
}

// ============================================================
// 扩展检查：依赖完整性 / 安全扫描 / Spec 一致性
// ============================================================

/**
 * 依赖完整性检查：检查 package.json 中是否有未安装的依赖
 */
function checkDependencies(codePath: string, projectType: ProjectType): CheckResult {
  const start = Date.now();
  try {
    if (projectType === 'node') {
      // 检查 node_modules 是否存在
      if (!require('fs').existsSync(join(codePath, 'node_modules'))) {
        return { name: '依赖完整性', status: 'fail', duration: Date.now() - start, output: 'node_modules 不存在，请运行 npm install', details: '依赖未安装', blocking: false };
      }
      // 检查是否有缺失的依赖
      try {
        execSync('npm ls --depth=0 2>&1', { cwd: codePath, encoding: 'utf-8', timeout: 30000 });
        return { name: '依赖完整性', status: 'pass', duration: Date.now() - start, output: '', details: '所有依赖已安装', blocking: false };
      } catch (e: any) {
        const output = (e.stdout || '') + (e.stderr || '');
        if (output.includes('MISSING') || output.includes('UNMET')) {
          return { name: '依赖完整性', status: 'fail', duration: Date.now() - start, output: output.slice(0, 2000), details: '存在缺失依赖', blocking: false };
        }
        return { name: '依赖完整性', status: 'pass', duration: Date.now() - start, output: '', details: '通过', blocking: false };
      }
    }
    if (projectType === 'java') {
      return { name: '依赖完整性', status: 'skip', duration: Date.now() - start, output: '', details: 'Java 依赖由 Maven/Gradle 管理', blocking: false };
    }
    if (projectType === 'go') {
      return { name: '依赖完整性', status: 'skip', duration: Date.now() - start, output: '', details: 'Go 依赖由 go mod 管理', blocking: false };
    }
    return { name: '依赖完整性', status: 'skip', duration: Date.now() - start, output: '', details: '跳过', blocking: false };
  } catch {
    return { name: '依赖完整性', status: 'skip', duration: Date.now() - start, output: '', details: '检查失败', blocking: false };
  }
}

/**
 * 安全扫描：检查已知漏洞和硬编码密钥
 */
function checkSecurity(codePath: string, projectType: ProjectType): CheckResult {
  const start = Date.now();
  try {
    if (projectType === 'node') {
      try {
        const output = execSync('npm audit --json 2>&1', { cwd: codePath, encoding: 'utf-8', timeout: 30000 });
        const audit = JSON.parse(output);
        const vulns = audit.metadata?.vulnerabilities || {};
        const total = (vulns.low || 0) + (vulns.moderate || 0) + (vulns.high || 0) + (vulns.critical || 0);
        if (total === 0) {
          return { name: '安全扫描', status: 'pass', duration: Date.now() - start, output: '', details: '无已知漏洞', blocking: false };
        }
        if (vulns.critical > 0 || vulns.high > 0) {
          return { name: '安全扫描', status: 'fail', duration: Date.now() - start, output: `高危: ${vulns.critical || 0}, 中危: ${vulns.moderate || 0}, 低危: ${vulns.low || 0}`, details: `${total} 个漏洞`, blocking: false };
        }
        return { name: '安全扫描', status: 'warn', duration: Date.now() - start, output: `低危: ${vulns.low || 0}`, details: `${total} 个低危漏洞`, blocking: false };
      } catch {
        return { name: '安全扫描', status: 'skip', duration: Date.now() - start, output: '', details: 'npm audit 不可用', blocking: false };
      }
    }
    return { name: '安全扫描', status: 'skip', duration: Date.now() - start, output: '', details: '跳过', blocking: false };
  } catch {
    return { name: '安全扫描', status: 'skip', duration: Date.now() - start, output: '', details: '检查失败', blocking: false };
  }
}

/**
 * 扫描代码目录，读取所有源码文件内容（供启发式检查复用）
 */
function scanCodeFiles(codePath: string): string {
  const srcFiles: string[] = [];
  const scanDir = (dir: string) => {
    try {
      const entries = require('fs').readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') scanDir(full);
        else if (e.isFile() && /\.(ts|js|tsx|jsx|java|go|py)$/.test(e.name)) srcFiles.push(full);
      }
    } catch {}
  };
  scanDir(codePath);
  return srcFiles.map(f => { try { return require('fs').readFileSync(f, 'utf-8'); } catch { return ''; } }).join('\n');
}

// ═══════════════════════════════════════════════════════════
// v8.3.0+: 结构化文档解析工具（用于质量门禁 L1 精确检查）
// ═══════════════════════════════════════════════════════════

/** 解析 Markdown 表格，返回表头 + 数据行 */
function parseMarkdownTable(content: string, sectionHeading: string): { headers: string[]; rows: string[][] } | null {
  const headingRegex = new RegExp(`^(#{2,4}\\s+.*${sectionHeading}.*)$`, 'im');
  const headingMatch = content.match(headingRegex);
  if (!headingMatch) return null;
  const startIdx = content.indexOf(headingMatch[1]);
  const sectionText = content.slice(startIdx, startIdx + 5000);
  const lines = sectionText.split('\n');
  let tableStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('|')) { tableStart = i; break; }
  }
  if (tableStart === -1) return null;
  const tableLines: string[] = [];
  for (let i = tableStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) break;
    tableLines.push(line);
  }
  if (tableLines.length < 3) return null; // 需要表头 + 分隔符 + 至少一行数据
  const headers = tableLines[0].split('|').map(c => c.trim()).filter(Boolean);
  const rows: string[][] = [];
  for (let i = 2; i < tableLines.length; i++) {
    const cells = tableLines[i].split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= headers.length) rows.push(cells);
  }
  return { headers, rows };
}

/** 从代码中提取结构信息：函数名、类名、路由路径 */
function extractCodeStructure(allCode: string): {
  functions: string[];
  classes: string[];
  routes: Array<{ method: string; path: string }>;
} {
  const functions: string[] = [];
  const classes: string[] = [];
  const routes: Array<{ method: string; path: string }> = [];

  // 提取函数名：async function xxx( / function xxx( / const xxx =
  for (const m of allCode.match(/(?:async\s+function|function)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g) || []) {
    const name = m.replace(/(?:function|async\s+function)\s+/, '').replace(/\s*\($/, '');
    if (name && !['if', 'while', 'for', 'switch', 'catch'].includes(name)) functions.push(name);
  }
  for (const m of allCode.match(/(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[=:]\s*(?:async\s*)?\(/g) || []) {
    const name = m.replace(/(?:const|let|var)\s+/, '').replace(/\s*[=:].*$/, '');
    if (name) functions.push(name);
  }

  // 提取类名：class Xxx / interface Xxx
  for (const m of allCode.match(/(?:class|interface)\s+([a-zA-Z_$][a-zA-Z0-9_$]+)/g) || []) {
    const name = m.replace(/(?:class|interface)\s+/, '');
    if (name) classes.push(name);
  }

  // 提取路由：Express/Fastify/Koa 风格
  const routePatterns = [
    /\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    /\.(Get|Post|Put|Delete|Patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    /@(Get|Post|Put|Delete|Patch)\s*\(['"`]([^'"`]+)['"`]/gi,
  ];
  for (const pattern of routePatterns) {
    let match;
    while ((match = pattern.exec(allCode)) !== null) {
      routes.push({ method: match[1].toUpperCase(), path: match[2] });
    }
  }

  return {
    functions: [...new Set(functions)],
    classes: [...new Set(classes)],
    routes: [...new Map(routes.map(r => [`${r.method} ${r.path}`, r])).values()],
  };
}

/** 简单 YAML 解析器（只处理 key: value 和 - list 结构） */
function simpleYamlParse(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = content.split('\n');
  const stack: Array<{ obj: Record<string, any>; indent: number }> = [{ obj: result, indent: -1 }];
  let currentList: any[] | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;

    // 弹出比当前更深的层级
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    if (line.trim().startsWith('- ')) {
      const item = line.trim().slice(2).trim();
      if (!currentList) {
        currentList = [];
        // 找到父对象中最后一个值，把它变成列表
        const keys = Object.keys(parent);
        if (keys.length > 0) {
          const lastKey = keys[keys.length - 1];
          if (!Array.isArray(parent[lastKey])) {
            parent[lastKey] = [];
          }
          currentList = parent[lastKey];
        }
      }
      if (currentList) {
        if (item.includes(':')) {
          const [k, ...v] = item.split(':');
          currentList.push({ [k.trim()]: v.join(':').trim() });
        } else {
          currentList.push(item);
        }
      }
    } else if (line.includes(':')) {
      currentList = null;
      const [key, ...valueParts] = line.trim().split(':');
      const keyStr = key.trim();
      const valueStr = valueParts.join(':').trim();
      if (!valueStr) {
        const newObj: Record<string, any> = {};
        parent[keyStr] = newObj;
        stack.push({ obj: newObj, indent });
      } else {
        parent[keyStr] = valueStr.replace(/^['"]|['"]$/g, '');
      }
    }
  }
  return result;
}

/**
 * 从 Markdown 中提取检查项（- [ ] / - [x] / ⬜ / ✅ / ❌ / | 行）
 */
function extractCheckItems(content: string): string[] {
  const items: string[] = [];
  // checkbox: - [ ] xxx / - [x] xxx
  for (const m of content.match(/-\s*\[[ x]\]\s*(.+)/g) || []) {
    items.push(m.replace(/^-\s*\[[ x]\]\s*/, '').trim());
  }
  // emoji checkbox: ⬜ xxx / ✅ xxx / ❌ xxx
  for (const m of content.match(/[⬜✅❌]\s*(.+)/g) || []) {
    const text = m.replace(/^[⬜✅❌]\s*/, '').trim();
    if (text.length > 2) items.push(text);
  }
  // table rows: | 描述 | ... |
  for (const m of content.match(/^\|\s*[^|]+\s*\|/gm) || []) {
    const cells = m.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 2 && !cells[0].match(/^[-:]+$/)) items.push(cells[0]);
  }
  return [...new Set(items)];
}

/**
 * TEST.md 测试用例覆盖率检查
 * 读取 TEST.md 中的测试用例，检查代码中是否有关键词对应
 */
async function checkTestCoverage(codePath: string, taskDir: string): Promise<CheckResult> {
  const start = Date.now();
  try {
    const testPaths: string[] = [
      join(taskDir, 'TEST.md'),
    ];
    // 扫描子任务目录下的 TEST.md（新结构: 10-backend/svc/sub/ 20-frontend/plat/sub/）
    for (const catDir of ['10-backend', '20-frontend']) {
      const catPath = join(taskDir, catDir);
      if (await pathExists(catPath)) {
        try {
          const services = await readdir(catPath, { withFileTypes: true });
          for (const svc of services) {
            if (!svc.isDirectory()) continue;
            const subs = await readdir(join(catPath, svc.name), { withFileTypes: true });
            for (const sub of subs) {
              if (!sub.isDirectory()) continue;
              testPaths.push(join(catPath, svc.name, sub.name, 'TEST.md'));
            }
          }
        } catch { /* 跳过 */ }
      }
    }
    // 旧结构回退
    testPaths.push(join(taskDir, '99-artifacts', 'TEST.md'));
    let testContent = '';
    for (const p of testPaths) {
      if (await pathExists(p)) { testContent = await readFile(p, 'utf-8'); break; }
    }
    if (!testContent) {
      return { name: '测试用例覆盖', status: 'skip', duration: Date.now() - start, output: '', details: '未找到 TEST.md', blocking: false };
    }

    const cases = extractCheckItems(testContent);
    if (cases.length === 0) {
      return { name: '测试用例覆盖', status: 'skip', duration: Date.now() - start, output: '', details: 'TEST.md 无可提取用例', blocking: false };
    }

    const allCode = scanCodeFiles(codePath);
    const covered: string[] = [];
    const uncovered: string[] = [];
    for (const c of cases) {
      const keywords = [
        ...(c.match(/[\u4e00-\u9fa5]{2,}/g) || []),
        ...(c.match(/[a-zA-Z]{3,}/g) || []),
      ];
      const found = keywords.some(kw => allCode.toLowerCase().includes(kw.toLowerCase()));
      if (found) covered.push(c);
      else uncovered.push(c);
    }

    const rate = cases.length > 0 ? Math.round((covered.length / cases.length) * 100) : 0;
    if (uncovered.length === 0) {
      return { name: '测试用例覆盖', status: 'pass', duration: Date.now() - start, output: '', details: `${covered.length} 个用例全部有代码覆盖`, blocking: false };
    }
    return {
      name: '测试用例覆盖',
      status: rate >= 60 ? 'warn' : 'fail',
      duration: Date.now() - start,
      output: `未覆盖:\n${uncovered.slice(0, 8).map(u => `  - ${u}`).join('\n')}`,
      details: `${covered.length}/${cases.length} 覆盖 (${rate}%)`,
      blocking: false,
    };
  } catch {
    return { name: '测试用例覆盖', status: 'skip', duration: Date.now() - start, output: '', details: '检查失败', blocking: false };
  }
}

/**
 * REVIEW.md 评审检查项合规检查
 * 读取 REVIEW.md 中的检查项，验证代码中是否有对应实现
 */
async function checkReviewCompliance(codePath: string, taskDir: string): Promise<CheckResult> {
  const start = Date.now();
  try {
    const reviewPaths: string[] = [
      join(taskDir, 'REVIEW.md'),
    ];
    // 扫描子任务目录下的 REVIEW.md（新结构）
    for (const catDir of ['10-backend', '20-frontend']) {
      const catPath = join(taskDir, catDir);
      if (await pathExists(catPath)) {
        try {
          const services = await readdir(catPath, { withFileTypes: true });
          for (const svc of services) {
            if (!svc.isDirectory()) continue;
            const subs = await readdir(join(catPath, svc.name), { withFileTypes: true });
            for (const sub of subs) {
              if (!sub.isDirectory()) continue;
              reviewPaths.push(join(catPath, svc.name, sub.name, 'REVIEW.md'));
            }
          }
        } catch { /* 跳过 */ }
      }
    }
    // 旧结构回退
    reviewPaths.push(join(taskDir, '99-artifacts', 'REVIEW.md'));
    let reviewContent = '';
    for (const p of reviewPaths) {
      if (await pathExists(p)) { reviewContent = await readFile(p, 'utf-8'); break; }
    }
    if (!reviewContent) {
      return { name: '评审项合规', status: 'skip', duration: Date.now() - start, output: '', details: '未找到 REVIEW.md', blocking: false };
    }

    const items = extractCheckItems(reviewContent);
    if (items.length === 0) {
      return { name: '评审项合规', status: 'skip', duration: Date.now() - start, output: '', details: 'REVIEW.md 无可提取检查项', blocking: false };
    }

    const allCode = scanCodeFiles(codePath);
    const passed: string[] = [];
    const missed: string[] = [];
    for (const item of items) {
      const keywords = [
        ...(item.match(/[\u4e00-\u9fa5]{2,}/g) || []),
        ...(item.match(/[a-zA-Z]{3,}/g) || []),
      ];
      const found = keywords.some(kw => allCode.toLowerCase().includes(kw.toLowerCase()));
      if (found) passed.push(item);
      else missed.push(item);
    }

    const rate = items.length > 0 ? Math.round((passed.length / items.length) * 100) : 0;
    if (missed.length === 0) {
      return { name: '评审项合规', status: 'pass', duration: Date.now() - start, output: '', details: `${passed.length} 项全部合规`, blocking: false };
    }
    return {
      name: '评审项合规',
      status: rate >= 60 ? 'warn' : 'fail',
      duration: Date.now() - start,
      output: `未合规:\n${missed.slice(0, 8).map(m => `  - ${m}`).join('\n')}`,
      details: `${passed.length}/${items.length} 合规 (${rate}%)`,
      blocking: false,
    };
  } catch {
    return { name: '评审项合规', status: 'skip', duration: Date.now() - start, output: '', details: '检查失败', blocking: false };
  }
}

/**
 * 通用产出物一致性检查
 * 检查 DEPLOY.md / ERROR_CODES.md 等文件中的条目是否在代码中有对应实现
 */
async function checkArtifactConsistency(codePath: string, taskDir: string, filename: string, checkName: string): Promise<CheckResult> {
  const start = Date.now();
  try {
    const filePaths: string[] = [
      join(taskDir, filename),
    ];
    // 扫描子任务目录（新结构）
    for (const catDir of ['10-backend', '20-frontend']) {
      const catPath = join(taskDir, catDir);
      if (await pathExists(catPath)) {
        try {
          const services = await readdir(catPath, { withFileTypes: true });
          for (const svc of services) {
            if (!svc.isDirectory()) continue;
            const subs = await readdir(join(catPath, svc.name), { withFileTypes: true });
            for (const sub of subs) {
              if (!sub.isDirectory()) continue;
              filePaths.push(join(catPath, svc.name, sub.name, filename));
            }
          }
        } catch { /* 跳过 */ }
      }
    }
    // 旧结构回退
    filePaths.push(join(taskDir, '99-artifacts', filename));
    let content = '';
    for (const p of filePaths) {
      if (await pathExists(p)) { content = await readFile(p, 'utf-8'); break; }
    }
    if (!content) {
      return { name: checkName, status: 'skip', duration: Date.now() - start, output: '', details: `未找到 ${filename}`, blocking: false };
    }

    const items = extractCheckItems(content);
    if (items.length === 0) {
      return { name: checkName, status: 'skip', duration: Date.now() - start, output: '', details: `${filename} 无可提取条目`, blocking: false };
    }

    const allCode = scanCodeFiles(codePath);
    const matched: string[] = [];
    const unmatched: string[] = [];
    for (const item of items) {
      const keywords = [
        ...(item.match(/[\u4e00-\u9fa5]{2,}/g) || []),
        ...(item.match(/[a-zA-Z]{3,}/g) || []),
      ];
      const found = keywords.some(kw => allCode.toLowerCase().includes(kw.toLowerCase()));
      if (found) matched.push(item);
      else unmatched.push(item);
    }

    const rate = items.length > 0 ? Math.round((matched.length / items.length) * 100) : 0;
    if (unmatched.length === 0) {
      return { name: checkName, status: 'pass', duration: Date.now() - start, output: '', details: `${matched.length} 项全部有代码对应`, blocking: false };
    }
    return {
      name: checkName,
      status: rate >= 60 ? 'warn' : 'fail',
      duration: Date.now() - start,
      output: `未匹配:\n${unmatched.slice(0, 8).map(u => `  - ${u}`).join('\n')}`,
      details: `${matched.length}/${items.length} 匹配 (${rate}%)`,
      blocking: false,
    };
  } catch {
    return { name: checkName, status: 'skip', duration: Date.now() - start, output: '', details: '检查失败', blocking: false };
  }
}

// ═══════════════════════════════════════════════════════════
// v8.3.0+: L1 结构化检查 — 解析文档表格/YAML 做精确验证
// ═══════════════════════════════════════════════════════════

/**
 * DEV_GUIDE.md 合规检查
 * 解析改造范围清单表格 → 检查文件是否存在
 * 解析接口契约表格 → 检查路由是否实现
 */
async function checkDevGuideCompliance(codePath: string, taskDir: string): Promise<CheckResult> {
  const start = Date.now();
  try {
    const devGuidePaths = [join(taskDir, '00-specs', 'DEV_GUIDE.md'), join(taskDir, 'DEV_GUIDE.md')];
    let content = '';
    for (const p of devGuidePaths) {
      if (await pathExists(p)) { content = await readFile(p, 'utf-8'); break; }
    }
    if (!content) {
      return { name: 'DEV_GUIDE 合规', status: 'skip', duration: Date.now() - start, output: '', details: '未找到 DEV_GUIDE.md', blocking: false };
    }

    const allCode = scanCodeFiles(codePath);
    const codeStruct = extractCodeStructure(allCode);
    const issues: string[] = [];
    let checkCount = 0;

    // 1. 检查改造范围清单
    const scopeTable = parseMarkdownTable(content, '改造范围');
    if (scopeTable) {
      const typeIdx = scopeTable.headers.findIndex(h => h.includes('类型') || h.toLowerCase().includes('type'));
      const fileIdx = scopeTable.headers.findIndex(h => h.includes('文件') || h.includes('目录') || h.toLowerCase().includes('file') || h.toLowerCase().includes('path'));
      if (fileIdx >= 0) {
        for (const row of scopeTable.rows) {
          const type = typeIdx >= 0 ? row[typeIdx] : '';
          const filePath = row[fileIdx];
          if (!filePath || filePath === '文件/目录' || filePath === '') continue;
          checkCount++;
          // 提取路径（去除反引号）
          const cleanPath = filePath.replace(/`/g, '').trim();
          if (!cleanPath) continue;
          const fullPath = join(codePath, cleanPath);
          const exists = require('fs').existsSync(fullPath);
          if (type.includes('新增') || type.toLowerCase().includes('add') || type.toLowerCase().includes('new')) {
            if (!exists) issues.push(`改造范围: 应新增文件不存在: ${cleanPath}`);
          } else if (type.includes('修改') || type.toLowerCase().includes('modify') || type.toLowerCase().includes('update')) {
            if (!exists) issues.push(`改造范围: 应修改文件不存在: ${cleanPath}`);
          }
        }
      }
    }

    // 2. 检查接口契约表
    const contractTable = parseMarkdownTable(content, '接口契约');
    if (contractTable) {
      const pathIdx = contractTable.headers.findIndex(h => h.includes('路径') || h.toLowerCase().includes('path'));
      const methodIdx = contractTable.headers.findIndex(h => h.includes('方法') || h.toLowerCase().includes('method'));
      if (pathIdx >= 0) {
        for (const row of contractTable.rows) {
          const apiPath = row[pathIdx];
          if (!apiPath || apiPath === '路径' || apiPath === '接口' || apiPath === '') continue;
          checkCount++;
          const cleanPath = apiPath.replace(/`/g, '').trim();
          const method = methodIdx >= 0 ? row[methodIdx].replace(/`/g, '').trim().toUpperCase() : '';
          // 检查代码中是否有匹配的路由
          const hasRoute = codeStruct.routes.some(r => {
            const routeMatch = cleanPath.includes(r.path) || r.path.includes(cleanPath);
            const methodMatch = !method || r.method === method || r.method === 'USE';
            return routeMatch && methodMatch;
          });
          if (!hasRoute) {
            issues.push(`接口契约: 未找到路由实现 ${method ? method + ' ' : ''}${cleanPath}`);
          }
        }
      }
    }

    if (checkCount === 0) {
      return { name: 'DEV_GUIDE 合规', status: 'skip', duration: Date.now() - start, output: '', details: 'DEV_GUIDE.md 无结构化改造范围/接口契约', blocking: false };
    }
    if (issues.length === 0) {
      return { name: 'DEV_GUIDE 合规', status: 'pass', duration: Date.now() - start, output: '', details: `${checkCount} 项全部合规`, blocking: false };
    }
    return {
      name: 'DEV_GUIDE 合规',
      status: issues.length > checkCount / 2 ? 'fail' : 'warn',
      duration: Date.now() - start,
      output: issues.slice(0, 8).map(i => `  - ${i}`).join('\n'),
      details: `${checkCount - issues.length}/${checkCount} 合规, ${issues.length} 项缺失`,
      blocking: false,
    };
  } catch {
    return { name: 'DEV_GUIDE 合规', status: 'skip', duration: Date.now() - start, output: '', details: '检查失败', blocking: false };
  }
}

/**
 * API_CONTRACT.yaml 合规检查
 * 解析 YAML 中的 paths → 检查代码中是否有对应路由实现
 */
async function checkApiContractCompliance(codePath: string, taskDir: string): Promise<CheckResult> {
  const start = Date.now();
  try {
    const contractPaths = [
      join(taskDir, '_shared', 'API_CONTRACT.yaml'),
      join(taskDir, 'API_CONTRACT.yaml'),
    ];
    let content = '';
    for (const p of contractPaths) {
      if (await pathExists(p)) { content = await readFile(p, 'utf-8'); break; }
    }
    if (!content) {
      return { name: 'API 契约合规', status: 'skip', duration: Date.now() - start, output: '', details: '未找到 API_CONTRACT.yaml', blocking: false };
    }

    const allCode = scanCodeFiles(codePath);
    const codeStruct = extractCodeStructure(allCode);
    const issues: string[] = [];
    let checkCount = 0;

    // 解析 YAML 中的 paths
    const yamlDoc = simpleYamlParse(content);
    const paths = yamlDoc.paths || {};
    for (const [apiPath, methods] of Object.entries(paths)) {
      if (typeof methods !== 'object' || methods === null) continue;
      for (const [method, _spec] of Object.entries(methods as Record<string, any>)) {
        if (method === 'parameters' || method === 'summary' || method === 'description') continue;
        checkCount++;
        const httpMethod = method.toUpperCase();
        const hasRoute = codeStruct.routes.some(r => {
          const routeMatch = apiPath.includes(r.path) || r.path.includes(apiPath);
          const methodMatch = r.method === httpMethod || r.method === 'USE';
          return routeMatch && methodMatch;
        });
        if (!hasRoute) {
          issues.push(`未找到路由实现: ${httpMethod} ${apiPath}`);
        }
      }
    }

    if (checkCount === 0) {
      return { name: 'API 契约合规', status: 'skip', duration: Date.now() - start, output: '', details: 'API_CONTRACT.yaml 无接口定义', blocking: false };
    }
    if (issues.length === 0) {
      return { name: 'API 契约合规', status: 'pass', duration: Date.now() - start, output: '', details: `${checkCount} 个接口全部有代码实现`, blocking: false };
    }
    return {
      name: 'API 契约合规',
      status: issues.length > checkCount / 2 ? 'fail' : 'warn',
      duration: Date.now() - start,
      output: issues.slice(0, 8).map(i => `  - ${i}`).join('\n'),
      details: `${checkCount - issues.length}/${checkCount} 个接口有实现, ${issues.length} 个缺失`,
      blocking: false,
    };
  } catch {
    return { name: 'API 契约合规', status: 'skip', duration: Date.now() - start, output: '', details: '检查失败', blocking: false };
  }
}

/**
 * SCHEMA.md 一致性检查
 * 解析表结构定义 → 检查代码中是否有对应实体类/字段
 */
async function checkSchemaConsistency(codePath: string, taskDir: string): Promise<CheckResult> {
  const start = Date.now();
  try {
    const schemaPaths = [join(taskDir, '00-specs', 'SCHEMA.md'), join(taskDir, 'SCHEMA.md')];
    let content = '';
    for (const p of schemaPaths) {
      if (await pathExists(p)) { content = await readFile(p, 'utf-8'); break; }
    }
    if (!content) {
      return { name: 'Schema 一致性', status: 'skip', duration: Date.now() - start, output: '', details: '未找到 SCHEMA.md', blocking: false };
    }

    const allCode = scanCodeFiles(codePath);
    const codeStruct = extractCodeStructure(allCode);
    const issues: string[] = [];
    let fieldCount = 0;

    // 解析所有表格（每个表格是一个表）
    const tableRegex = /^#{2,4}\s+(.+)$/gm;
    let m;
    while ((m = tableRegex.exec(content)) !== null) {
      const heading = m[1];
      const sectionStart = content.indexOf(m[0]);
      const sectionText = content.slice(sectionStart, sectionStart + 3000);
      const table = parseMarkdownTable(sectionText, heading);
      if (!table) continue;

      const fieldIdx = table.headers.findIndex(h =>
        h.includes('字段') || h.includes('列') || h.toLowerCase().includes('field') || h.toLowerCase().includes('column')
      );
      if (fieldIdx < 0) continue;

      // 尝试从表名/heading 推断实体类名
      const possibleEntityNames = heading.split(/[^a-zA-Z0-9_]/).filter(w => w.length > 1);
      const entityMatch = codeStruct.classes.some(c =>
        possibleEntityNames.some(n => c.toLowerCase().includes(n.toLowerCase()) || n.toLowerCase().includes(c.toLowerCase()))
      );

      for (const row of table.rows) {
        const fieldName = row[fieldIdx];
        if (!fieldName || fieldName === '字段' || fieldName === '列名') continue;
        fieldCount++;
        const cleanField = fieldName.replace(/`/g, '').trim();
        if (!cleanField) continue;

        // 检查代码中是否有该字段名（作为类属性、变量、数据库列名）
        const snakeField = cleanField.replace(/([A-Z])/g, '_$1').toLowerCase();
        const camelField = cleanField.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
        // v8.3.0+: 增强字段匹配 — 支持多种代码中的出现形式
        const fieldPatterns = [
          ` ${cleanField}:`, ` ${cleanField} =`, ` ${cleanField};`,
          ` ${cleanField}?:`, `.${cleanField}`, `'${cleanField}'`, `"${cleanField}"`,
          ` ${snakeField}:`, ` ${snakeField} =`, ` ${snakeField};`, `.${snakeField}`,
          ` ${camelField}:`, ` ${camelField} =`, ` ${camelField};`, `.${camelField}`,
          `column\s*:\s*['"\`]${cleanField}['"\`]`,
        ];
        const found = entityMatch && fieldPatterns.some(p => allCode.includes(p));

        if (!found && entityMatch) {
          issues.push(`字段未找到: ${cleanField} (表: ${heading})`);
        }
      }
    }

    if (fieldCount === 0) {
      return { name: 'Schema 一致性', status: 'skip', duration: Date.now() - start, output: '', details: 'SCHEMA.md 无表结构定义', blocking: false };
    }
    if (issues.length === 0) {
      return { name: 'Schema 一致性', status: 'pass', duration: Date.now() - start, output: '', details: `${fieldCount} 个字段全部有对应`, blocking: false };
    }
    return {
      name: 'Schema 一致性',
      status: issues.length > fieldCount / 3 ? 'warn' : 'pass',
      duration: Date.now() - start,
      output: issues.slice(0, 8).map(i => `  - ${i}`).join('\n'),
      details: `${fieldCount - issues.length}/${fieldCount} 个字段有对应, ${issues.length} 个缺失`,
      blocking: false,
    };
  } catch {
    return { name: 'Schema 一致性', status: 'skip', duration: Date.now() - start, output: '', details: '检查失败', blocking: false };
  }
}

/**
 * 知识图谱依赖一致性检查（v8.3.0+）
 * 加载知识图谱，检查上游依赖任务的接口是否在本任务代码中被正确引用
 */
async function checkDependencyGraphConsistency(codePath: string, taskDir: string, taskId: string): Promise<CheckResult> {
  const start = Date.now();
  try {
    const { loadKnowledgeGraph, traceDependencyChain } = await import('./knowledge-graph');
    const graph = await loadKnowledgeGraph(process.cwd());
    if (!graph) {
      return { name: '依赖一致性', status: 'skip', duration: Date.now() - start, output: '', details: '知识图谱未加载', blocking: false };
    }

    // 提取本任务的 platform（从 taskId 或 taskDir 推断）
    const allCode = scanCodeFiles(codePath);
    const issues: string[] = [];
    let depCount = 0;

    // 追踪上游依赖（深度 1）
    const upstreamDeps = traceDependencyChain(graph, taskId, 1).filter(c => c.depth === 1);
    for (const dep of upstreamDeps) {
      const depEntity = graph.entities[dep.path[dep.path.length - 1]];
      if (!depEntity) continue;
      depCount++;

      // 检查代码中是否有对该依赖任务的引用（import、调用等）
      const depKeywords = depEntity.title.split(/[^a-zA-Z0-9_]/).filter(w => w.length > 2);
      const hasReference = depKeywords.some(kw =>
        allCode.toLowerCase().includes(kw.toLowerCase())
      );

      // 更精确：检查是否有 import/require 引用
      const importPatterns = [
        new RegExp(`from\\s+['"\`].*${depEntity.title.toLowerCase().replace(/\s+/g, '[-_]')}['"\`]`),
        new RegExp(`import\\s+.*\\b${depKeywords[0]}\\b`),
        new RegExp(`require\\s*\\(\\s*['"\`].*${depKeywords[0]}['"\`]\\s*\\)`),
      ];
      const hasImport = importPatterns.some(p => p.test(allCode));

      if (!hasReference && !hasImport) {
        issues.push(`未引用上游依赖: ${depEntity.title} (${depEntity.type})`);
      }
    }

    if (depCount === 0) {
      return { name: '依赖一致性', status: 'skip', duration: Date.now() - start, output: '', details: '无上游依赖任务', blocking: false };
    }
    if (issues.length === 0) {
      return { name: '依赖一致性', status: 'pass', duration: Date.now() - start, output: '', details: `${depCount} 个上游依赖全部有引用`, blocking: false };
    }
    return {
      name: '依赖一致性',
      status: 'warn',
      duration: Date.now() - start,
      output: issues.slice(0, 8).map(i => `  - ${i}`).join('\n'),
      details: `${depCount - issues.length}/${depCount} 个依赖有引用, ${issues.length} 个缺失`,
      blocking: false,
    };
  } catch {
    return { name: '依赖一致性', status: 'skip', duration: Date.now() - start, output: '', details: '检查失败', blocking: false };
  }
}

/**
 * Spec-代码一致性检查（v8.3.0+ 增强版）
 * L1: 关键词匹配（保留）+ L2: 语义匹配（新增）
 * 检查 REQ.md 中的验收标准是否在代码中有对应实现
 */
async function checkSpecConsistency(codePath: string, taskDir: string): Promise<CheckResult> {
  const start = Date.now();
  try {
    const reqPaths = [join(taskDir, '00-specs', 'REQ.md'), join(taskDir, 'REQ.md')];
    let reqContent = '';
    for (const p of reqPaths) {
      if (await pathExists(p)) { reqContent = await readFile(p, 'utf-8'); break; }
    }
    if (!reqContent) {
      return { name: 'Spec 一致性', status: 'skip', duration: Date.now() - start, output: '', details: '未找到 REQ.md', blocking: false };
    }

    const criteria = extractCheckItems(reqContent);
    if (criteria.length === 0) {
      return { name: 'Spec 一致性', status: 'skip', duration: Date.now() - start, output: '', details: 'REQ.md 无验收标准', blocking: false };
    }

    const allCode = scanCodeFiles(codePath);
    const codeStruct = extractCodeStructure(allCode);
    const matched: string[] = [];
    const unmatched: string[] = [];

    for (const c of criteria) {
      // L1: 关键词匹配（保留）
      const keywords = [
        ...(c.match(/[\u4e00-\u9fa5]{2,}/g) || []),
        ...(c.match(/[a-zA-Z]{3,}/g) || []),
      ];
      const keywordMatch = keywords.some(kw => allCode.toLowerCase().includes(kw.toLowerCase()));

      // L2: 语义匹配（v8.3.0+ 新增）
      // 提取验收标准中的动词+名词组合，与代码中的函数名做匹配
      let semanticMatch = false;
      const actionNouns = c.match(/(?:创建|删除|更新|查询|获取|发送|验证|检查|生成|导入|导出|登录|注册|注销|锁定|解锁|禁用|启用|审批|拒绝|提交|取消|支付|退款|分配|合并|拆分|复制|移动|排序|过滤|搜索|导入|导出|create|delete|update|get|fetch|send|verify|check|generate|import|export|login|register|logout|lock|unlock|disable|enable|approve|reject|submit|cancel|pay|refund|assign|merge|split|copy|move|sort|filter|search)/gi);
      if (actionNouns && actionNouns.length > 0) {
        const targetNouns = c.match(/(?:用户|订单|商品|账户|角色|权限|日志|配置|模板|通知|消息|文件|图片|视频|报表|统计|备份|恢复|任务|流程|节点|表单|字段|页面|菜单|按钮|列表|详情|搜索|筛选|排序|分页|缓存|索引|队列|定时|推送|Webhook|user|order|product|account|role|permission|log|config|template|notification|message|file|image|video|report|stat|backup|restore|task|flow|node|form|field|page|menu|button|list|detail|search|filter|sort|page|cache|index|queue|schedule|push|webhook)/gi);
        const possibleFnNames: string[] = [];
        for (const action of actionNouns) {
          const act = action.toLowerCase();
          for (const target of (targetNouns || [])) {
            const tgt = target.toLowerCase();
            // 生成可能的函数名组合
            possibleFnNames.push(
              `${act}${tgt}`, `${tgt}${act}`,
              `${act}_${tgt}`, `${tgt}_${act}`,
              `handle${act.charAt(0).toUpperCase() + act.slice(1)}${tgt.charAt(0).toUpperCase() + tgt.slice(1)}`,
            );
          }
        }
        semanticMatch = codeStruct.functions.some(fn =>
          possibleFnNames.some(p => fn.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(fn.toLowerCase()))
        );
      }

      if (keywordMatch || semanticMatch) {
        matched.push(c);
      } else {
        unmatched.push(c);
      }
    }

    if (unmatched.length === 0) {
      return { name: 'Spec 一致性', status: 'pass', duration: Date.now() - start, output: '', details: `${matched.length} 项验收标准均有代码对应`, blocking: false };
    }
    return {
      name: 'Spec 一致性',
      status: unmatched.length > matched.length ? 'fail' : 'warn',
      duration: Date.now() - start,
      output: `未匹配:\n${unmatched.slice(0, 8).map(u => `  - ${u}`).join('\n')}`,
      details: `${matched.length}/${criteria.length} 项匹配（含语义匹配）`,
      blocking: false,
    };
  } catch {
    return { name: 'Spec 一致性', status: 'skip', duration: Date.now() - start, output: '', details: '检查失败', blocking: false };
  }
}

// ============================================================
// 质量门禁：execute 后强制执行
// ============================================================

export interface AgentQualityCheck {
  agent: string;
  prompt: string;
}

export interface QualityGateResult {
  passed: boolean;
  blockingFailed: CheckResult[];
  warnings: CheckResult[];
  report: VerifyReport;
  agentChecks?: AgentQualityCheck[]; // v6.84.0+: AGENTS 扩展检查
}

/**
 * 质量门禁 — execute 后自动运行，不可跳过
 * 阻塞性检查（编译/Lint/测试/依赖）失败 → 不允许进入下一步
 * 非阻塞检查（安全/Spec一致性）失败 → 警告但不阻塞
 */
export async function runQualityGate(
  taskId: string,
  codePath: string,
  taskDir: string,
  options?: { timeout?: number; withAgents?: boolean; projectRoot?: string }
): Promise<QualityGateResult> {
  const projectType = await detectProjectType(codePath);
  const commands = getCommands(projectType, codePath);
  const timeout = options?.timeout || 120000;
  const checks: CheckResult[] = [];

  logger.info('');
  logger.info(`🚧 质量门禁 — ${taskId} (${projectType})`);

  // 1. 编译检查（唯一阻塞项：编译不过 = 代码不可用）
  logger.info('   📦 编译检查...');
  checks.push(runCheck('编译检查', commands.compile, codePath, timeout, true));

  // 2. Lint 检查（非阻塞，记录报告）
  logger.info('   🔎 Lint 检查...');
  checks.push(runCheck('Lint 检查', commands.lint, codePath, timeout, false));

  // 3. 单元测试（非阻塞，记录报告）
  logger.info('   🧪 单元测试...');
  checks.push(runCheck('单元测试', commands.test, codePath, timeout, false));

  // 4. 依赖完整性（非阻塞，记录报告）
  logger.info('   📋 依赖检查...');
  checks.push(checkDependencies(codePath, projectType));

  // 5. 安全扫描（非阻塞）
  logger.info('   🔒 安全扫描...');
  checks.push(checkSecurity(codePath, projectType));

  // 6. Spec 一致性（非阻塞，L1 关键词 + L2 语义匹配）
  logger.info('   📐 Spec 一致性...');
  checks.push(await checkSpecConsistency(codePath, taskDir));

  // 7. DEV_GUIDE 合规（v8.3.0+，结构化检查：改造范围清单 + 接口契约）
  logger.info('   📋 DEV_GUIDE 合规...');
  checks.push(await checkDevGuideCompliance(codePath, taskDir));

  // 8. API 契约合规（v8.3.0+，解析 API_CONTRACT.yaml 检查接口实现）
  logger.info('   🔌 API 契约合规...');
  checks.push(await checkApiContractCompliance(codePath, taskDir));

  // 9. Schema 一致性（v8.3.0+，解析 SCHEMA.md 检查实体字段）
  logger.info('   🗄️  Schema 一致性...');
  checks.push(await checkSchemaConsistency(codePath, taskDir));

  // 10. 测试用例覆盖率（非阻塞，读取 TEST.md）
  logger.info('   🧪 测试用例覆盖...');
  checks.push(await checkTestCoverage(codePath, taskDir));

  // 11. 评审项合规（非阻塞，读取 REVIEW.md）
  logger.info('   📝 评审项合规...');
  checks.push(await checkReviewCompliance(codePath, taskDir));

  // 12. 部署清单检查（非阻塞，读取 DEPLOY.md）
  logger.info('   🚀 部署清单...');
  checks.push(await checkArtifactConsistency(codePath, taskDir, 'DEPLOY.md', '部署项检查'));

  // 13. 错误码一致性（非阻塞，读取 ERROR_CODES.md）
  logger.info('   🔢 错误码一致性...');
  checks.push(await checkArtifactConsistency(codePath, taskDir, 'ERROR_CODES.md', '错误码一致性'));

  // 14. 知识图谱依赖一致性（v8.3.0+，检查上游依赖接口是否已可用）
  logger.info('   🔗 依赖一致性...');
  checks.push(await checkDependencyGraphConsistency(codePath, taskDir, taskId));

  // 15. 规格文档质量校验（v8.1.0+，检查 REQ.md/TECH.md 是否有实质内容）
  logger.info('   📋 规格文档质量...');
  checks.push(await checkSpecDocQuality(taskDir));

  // 16. 代码文件非空检查（v8.1.0+，确保 src/ 下有实际代码）
  logger.info('   📁 代码文件检查...');
  checks.push(await checkCodeFilesExist(codePath));

  // 汇总
  const report: VerifyReport = {
    taskId,
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    projectType,
    codePath,
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter(c => c.status === 'pass').length,
      failed: checks.filter(c => c.status === 'fail').length,
      skipped: checks.filter(c => c.status === 'skip').length,
      warnings: checks.filter(c => c.status === 'warn').length,
    },
  };

  const blockingFailed = checks.filter(c => c.blocking && c.status === 'fail');
  const warnings = checks.filter(c => !c.blocking && (c.status === 'fail' || c.status === 'warn'));

  // 写入报告（任务根目录）
  const reportDir = taskDir;
  await writeVerifyReport(report, reportDir);

  // 输出结果
  for (const c of checks) {
    const icon = c.status === 'pass' ? '✅' : c.status === 'fail' ? '❌' : c.status === 'warn' ? '⚠️' : '⏭️';
    const block = c.blocking ? ' 🔒' : '';
    logger.info(`   ${icon} ${c.name}${block}: ${c.details}`);
  }

  // v6.84.0+: AGENTS 扩展检查（可选）
  let agentChecks: AgentQualityCheck[] | undefined;
  if (options?.withAgents && options?.projectRoot) {
    try {
      const agentContext: AgentContext = {
        iteration: taskId.split('/')[0],
        taskDir,
        codePath,
      };
      const agents = await resolveAgentsForPhase('execute', 'quality-gate', agentContext, options.projectRoot);
      if (agents.length > 0) {
        agentChecks = [];
        logger.info(`   🤖 AGENTS 扩展检查 (${agents.length} 个角色)...`);
        for (const ra of agents) {
          const prompt = buildAgentPrompt(ra.definition, agentContext);
          agentChecks.push({ agent: ra.name, prompt });
          logger.info(`      - ${ra.name} (优先级: ${ra.priority})`);
        }
      }
    } catch {
      // AGENTS 扩展检查失败不影响主流程
    }
  }

  const passed = blockingFailed.length === 0;
  if (passed) {
    logger.info(`   ✅ 编译通过，质量门禁放行`);
    if (warnings.length > 0) {
      logger.info(`   📝 ${warnings.length} 项警告已记录到 VERIFY_REPORT.md`);
    }
  } else {
    logger.warn(`   ❌ 编译失败，质量门禁拦截`);
    logger.info(`   💡 修复编译错误后自动重新检查`);
  }

  return { passed, blockingFailed, warnings, report, agentChecks };
}

// ============================================================
// v8.1.0+: 规格文档质量校验 — 检查 REQ.md/TECH.md 是否有实质内容
// ============================================================

async function checkSpecDocQuality(taskDir: string): Promise<CheckResult> {
  const start = Date.now();
  const issues: string[] = [];
  let totalScore = 0;
  let checkedCount = 0;

  // 扫描子任务目录下的 REQ.md 和 TECH.md
  const specFiles: { path: string; docName: string }[] = [];
  const candidates = ['REQ.md', 'TECH.md'];

  // 直接子目录（00-specs/）
  for (const doc of candidates) {
    const p = join(taskDir, '00-specs', doc);
    if (await pathExists(p)) specFiles.push({ path: p, docName: doc });
  }

  // 端子任务目录（10-backend/*/subtask/, 20-frontend/*/subtask/）
  for (const catDir of ['10-backend', '20-frontend']) {
    const catPath = join(taskDir, catDir);
    if (!(await pathExists(catPath))) continue;
    try {
      const services = await readdir(catPath, { withFileTypes: true });
      for (const svc of services) {
        if (!svc.isDirectory()) continue;
        const subs = await readdir(join(catPath, svc.name), { withFileTypes: true });
        for (const sub of subs) {
          if (!sub.isDirectory()) continue;
          for (const doc of candidates) {
            const p = join(catPath, svc.name, sub.name, doc);
            if (await pathExists(p)) specFiles.push({ path: p, docName: doc });
          }
        }
      }
    } catch { /* 跳过 */ }
  }

  if (specFiles.length === 0) {
    return {
      name: '规格文档质量',
      status: 'skip',
      duration: Date.now() - start,
      output: '未找到 REQ.md/TECH.md',
      details: '未找到规格文档',
      blocking: false,
    };
  }

  for (const sf of specFiles) {
    try {
      const content = await readFile(sf.path, 'utf-8');
      const result = await validateContentQuality(sf.docName, content);
      totalScore += result.score;
      checkedCount++;
      if (result.score < 60) {
        issues.push(`${sf.path.replace(taskDir + '/', '')}: ${result.score}/100 — ${result.issues.join('；')}`);
      }
    } catch { /* skip */ }
  }

  const avgScore = checkedCount > 0 ? Math.round(totalScore / checkedCount) : 0;
  const details = checkedCount > 0
    ? `${checkedCount} 个文档平均 ${avgScore}/100${issues.length > 0 ? `，${issues.length} 个不达标` : ''}`
    : '无文档可检查';

  return {
    name: '规格文档质量',
    status: issues.length > 0 ? 'warn' : 'pass',
    duration: Date.now() - start,
    output: issues.join('\n'),
    details,
    blocking: false,
  };
}

// ============================================================
// v8.1.0+: 代码文件非空检查 — 确保 src/ 下有实际代码
// ============================================================

async function checkCodeFilesExist(codePath: string): Promise<CheckResult> {
  const start = Date.now();
  const srcDir = join(codePath, 'src');
  const codeExts = ['.ts', '.js', '.java', '.go', '.py', '.vue', '.jsx', '.tsx'];
  let codeFileCount = 0;

  async function countCodeFiles(dir: string): Promise<void> {
    if (!(await pathExists(dir))) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await countCodeFiles(join(dir, entry.name));
        } else if (codeExts.some(ext => entry.name.endsWith(ext))) {
          codeFileCount++;
        }
      }
    } catch { /* skip */ }
  }

  await countCodeFiles(srcDir);

  // 也检查 tests/ 目录
  let testFileCount = 0;
  const testDir = join(codePath, 'tests');
  await countCodeFiles(testDir).then(() => {
    testFileCount = codeFileCount - testFileCount;
    // 重新计算：只统计 tests/
  });

  return {
    name: '代码文件检查',
    status: codeFileCount === 0 ? 'warn' : 'pass',
    duration: Date.now() - start,
    output: codeFileCount === 0 ? 'src/ 目录无代码文件' : `发现 ${codeFileCount} 个代码文件`,
    details: codeFileCount === 0 ? 'src/ 无代码文件' : `${codeFileCount} 个代码文件`,
    blocking: false,
  };
}

// ============================================================
// v6.79.0+: 文档同步 — 根据实际测试结果更新 TEST.md
// ============================================================

/**
 * 根据单元测试结果同步更新 TEST.md 勾选状态
 * - 测试全部通过 → 所有 `[ ]` 改为 `[x]`
 * - 测试有失败 → 保持 `[ ]` 不变（等待修复后重试）
 * - 无 TEST.md → 跳过
 */
export async function syncTestDocFromResults(
  taskDir: string,
  testPassed: boolean
): Promise<void> {
  const testPaths: string[] = [
    join(taskDir, 'TEST.md'),
    join(taskDir, '99-artifacts', 'TEST.md'),
  ];
  // 扫描子任务目录下的 TEST.md（新结构）
  for (const catDir of ['10-backend', '20-frontend']) {
    const catPath = join(taskDir, catDir);
    if (await pathExists(catPath)) {
      try {
        const services = await readdir(catPath, { withFileTypes: true });
        for (const svc of services) {
          if (!svc.isDirectory()) continue;
          const subs = await readdir(join(catPath, svc.name), { withFileTypes: true });
          for (const sub of subs) {
            if (!sub.isDirectory()) continue;
            testPaths.push(join(catPath, svc.name, sub.name, 'TEST.md'));
          }
        }
      } catch { /* 跳过 */ }
    }
  }

  for (const testPath of testPaths) {
    if (!(await pathExists(testPath))) continue;
    let content = await readFile(testPath, 'utf-8');
    const original = content;

    if (testPassed) {
      // 全部通过：把所有 `[ ]` 改为 `[x]`
      content = content.replace(/- \[ \]/g, '- [x]');
      content += `\n\n> ✅ 单元测试已通过，自动勾选（v6.79.0+）\n`;
    } else {
      // 有失败：保持 `[ ]` 不变，但添加备注
      if (!content.includes('> ⏳ 单元测试未通过')) {
        content += `\n\n> ⏳ 单元测试未通过，待修复后重试（v6.79.0+）\n`;
      }
    }

    if (content !== original) {
      await writeFile(testPath, content);
      logger.info(`   📝 TEST.md 已同步: ${testPath.replace(taskDir + '/', '')}`);
    }
  }
}
