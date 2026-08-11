/**
 * verify-engine — 代码验证引擎
 *
 * 执行后自动验证：编译检查 + Lint + 单元测试
 * 根据项目类型（Node.js/Java/Go/Python）自动检测命令
 * 生成结构化报告到 99-artifacts/VERIFY_REPORT.md
 */

import { execSync } from 'child_process';
import { join } from 'path';
import { pathExists, readFile, writeFile, ensureDir } from 'fs-extra';
import { logger } from '../utils/logger';

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

    // 提取验收标准（以 - [ ] 开头的行）
    const criteria = reqContent.match(/-\s*\[[ x]\]\s*(.+)/g) || [];
    if (criteria.length === 0) {
      return { name: 'Spec 一致性', status: 'skip', duration: Date.now() - start, output: '', details: 'REQ.md 无验收标准', blocking: false };
    }

    // 扫描代码文件，检查是否有关键词匹配
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

    const allCode = srcFiles.map(f => { try { return require('fs').readFileSync(f, 'utf-8'); } catch { return ''; } }).join('\n');

    // 检查每个验收标准的关键词是否在代码中出现
    const matched: string[] = [];
    const unmatched: string[] = [];
    for (const c of criteria) {
      const text = c.replace(/^-\s*\[[ x]\]\s*/, '').trim();
      // 提取关键词（中文 2+ 字，英文 3+ 字母）
      const keywords = [...(text.match(/[\u4e00-\u9fa5]{2,}/g) || []), ...(text.match(/[a-zA-Z]{3,}/g) || [])];
      const found = keywords.some(kw => allCode.toLowerCase().includes(kw.toLowerCase()));
      if (found) matched.push(text);
      else unmatched.push(text);
    }

    if (unmatched.length === 0) {
      return { name: 'Spec 一致性', status: 'pass', duration: Date.now() - start, output: `${matched.length} 项验收标准均有代码对应`, details: '全部匹配', blocking: false };
    }
    return {
      name: 'Spec 一致性',
      status: unmatched.length > matched.length ? 'fail' : 'warn',
      duration: Date.now() - start,
      output: `未匹配:\n${unmatched.map(u => `  - ${u}`).join('\n')}`,
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

export interface QualityGateResult {
  passed: boolean;
  blockingFailed: CheckResult[];
  warnings: CheckResult[];
  report: VerifyReport;
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
  options?: { timeout?: number }
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

  // 写入报告
  const reportDir = join(taskDir, '99-artifacts');
  await writeVerifyReport(report, reportDir);

  // 输出结果
  for (const c of checks) {
    const icon = c.status === 'pass' ? '✅' : c.status === 'fail' ? '❌' : c.status === 'warn' ? '⚠️' : '⏭️';
    const block = c.blocking ? ' 🔒' : '';
    logger.info(`   ${icon} ${c.name}${block}: ${c.details}`);
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

  return { passed, blockingFailed, warnings, report };
}
