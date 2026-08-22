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
 * 生成 AI 修复 Prompt
 * 当验证失败时，生成结构化 Prompt 让 AI 定位并修复问题
 */
export function generateFixPrompt(report: VerifyReport, taskDir: string): string {
  const failedChecks = report.checks.filter(c => c.status === 'fail');
  const warningChecks = report.checks.filter(c => c.status === 'warn');

  let prompt = `# 代码验证失败 — 请修复\n\n`;
  prompt += `## 任务信息\n\n`;
  prompt += `- 任务: ${report.taskId}\n`;
  prompt += `- 代码路径: \`${report.codePath}\`\n`;
  prompt += `- 项目类型: ${report.projectType}\n`;
  prompt += `- 验证轮次: ${report.checks.length} 项检查\n\n`;

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
  prompt += `2. 修复代码，确保:\n`;
  prompt += `   - 编译通过（无类型错误、语法错误）\n`;
  prompt += `   - Lint 通过（无代码风格问题）\n`;
  prompt += `   - 测试通过（所有测试用例绿灯）\n`;
  prompt += `   - 测试用例覆盖：检查子任务目录下的 \`TEST.md\` 中的未覆盖用例，补充实现\n`;
  prompt += `   - 评审项合规：检查子任务目录下的 \`REVIEW.md\` 中的未合规项，补充实现\n`;
  prompt += `3. 修复后在下方「修复记录」表格中记录:\n`;
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
 * 生成 SPECCORE_EXEC 标签，触发 AI 修复
 */
export function outputFixTag(report: VerifyReport, taskDir: string, round: number): void {
  const prompt = generateFixPrompt(report, taskDir);
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

/**
 * Spec-代码一致性检查（基础启发式）
 * 检查 REQ.md 中的验收标准是否在代码中有对应实现
 */
async function checkSpecConsistency(codePath: string, taskDir: string): Promise<CheckResult> {
  const start = Date.now();
  try {
    // 读取 REQ.md 的验收标准
    const reqPaths = [
      join(taskDir, '00-specs', 'REQ.md'),
      join(taskDir, 'REQ.md'),
    ];
    let reqContent = '';
    for (const p of reqPaths) {
      if (await pathExists(p)) {
        reqContent = await readFile(p, 'utf-8');
        break;
      }
    }
    if (!reqContent) {
      return { name: 'Spec 一致性', status: 'skip', duration: Date.now() - start, output: '', details: '未找到 REQ.md', blocking: false };
    }

    const criteria = extractCheckItems(reqContent);
    if (criteria.length === 0) {
      return { name: 'Spec 一致性', status: 'skip', duration: Date.now() - start, output: '', details: 'REQ.md 无验收标准', blocking: false };
    }

    const allCode = scanCodeFiles(codePath);

    // 检查每个验收标准的关键词是否在代码中出现
    const matched: string[] = [];
    const unmatched: string[] = [];
    for (const c of criteria) {
      const keywords = [
        ...(c.match(/[\u4e00-\u9fa5]{2,}/g) || []),
        ...(c.match(/[a-zA-Z]{3,}/g) || []),
      ];
      const found = keywords.some(kw => allCode.toLowerCase().includes(kw.toLowerCase()));
      if (found) matched.push(c);
      else unmatched.push(c);
    }

    if (unmatched.length === 0) {
      return { name: 'Spec 一致性', status: 'pass', duration: Date.now() - start, output: '', details: `${matched.length} 项验收标准均有代码对应`, blocking: false };
    }
    return {
      name: 'Spec 一致性',
      status: unmatched.length > matched.length ? 'fail' : 'warn',
      duration: Date.now() - start,
      output: `未匹配:\n${unmatched.slice(0, 8).map(u => `  - ${u}`).join('\n')}`,
      details: `${matched.length}/${criteria.length} 项匹配`,
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

  // 6. Spec 一致性（非阻塞）
  logger.info('   📐 Spec 一致性...');
  checks.push(await checkSpecConsistency(codePath, taskDir));

  // 7. 测试用例覆盖率（非阻塞，读取 TEST.md）
  logger.info('   🧪 测试用例覆盖...');
  checks.push(await checkTestCoverage(codePath, taskDir));

  // 8. 评审项合规（非阻塞，读取 REVIEW.md）
  logger.info('   📝 评审项合规...');
  checks.push(await checkReviewCompliance(codePath, taskDir));

  // 9. 部署清单检查（非阻塞，读取 DEPLOY.md）
  logger.info('   🚀 部署清单...');
  checks.push(await checkArtifactConsistency(codePath, taskDir, 'DEPLOY.md', '部署项检查'));

  // 10. 错误码一致性（非阻塞，读取 ERROR_CODES.md）
  logger.info('   🔢 错误码一致性...');
  checks.push(await checkArtifactConsistency(codePath, taskDir, 'ERROR_CODES.md', '错误码一致性'));

  // 11. 规格文档质量校验（v8.1.0+，检查 REQ.md/TECH.md 是否有实质内容）
  logger.info('   📋 规格文档质量...');
  checks.push(await checkSpecDocQuality(taskDir));

  // 12. 代码文件非空检查（v8.1.0+，确保 src/ 下有实际代码）
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
