/**
 * constitution-builder — 自动检测项目技术栈，生成/完善 CONSTITUTION.md
 */
import { readFile, writeFile, pathExists } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { existsSync, readdirSync } from 'fs';

interface ConstitutionRule {
  category: string;
  rule: string;
  reason: string;
  enforced: boolean;
}

export async function buildConstitution(cwd: string): Promise<void> {
  const constitutionPath = join(cwd, '.speccore', 'PROJECT', 'CONSTITUTION.md');
  
  // Detect tech stack
  const stack = await detectStack(cwd);
  const rules = generateRules(stack);
  
  let content = '# 项目技术宪法\n\n';
  content += '> 自动检测 + 人工确认 | 以下规则在 analyze/split 时强制执行\n\n';
  content += `## 技术栈（自动检测）\n\n`;
  content += `| 层级 | 技术 | 来源 |\n`;
  content += `| :--- | :--- | :--- |\n`;
  
  if (stack.backend) content += `| 后端 | ${stack.backend} | ${stack.backendSource} |\n`;
  if (stack.frontend) content += `| 前端 | ${stack.frontend} | ${stack.frontendSource} |\n`;
  if (stack.database) content += `| 数据库 | ${stack.database} | ${stack.databaseSource} |\n`;
  if (stack.language) content += `| 语言 | ${stack.language} | ${stack.languageSource} |\n`;
  
  content += `\n## 强制规则（自动生成，可手动修改）\n\n`;
  
  for (const r of rules) {
    const icon = r.enforced ? '🔒' : '💡';
    content += `### ${icon} ${r.category}\n\n`;
    content += `- **规则**: ${r.rule}\n`;
    content += `- **原因**: ${r.reason}\n\n`;
  }
  
  content += `\n---\n> 编辑此文件后，运行 analyze 和 split 将强制执行这些规则。\n`;
  
  await writeFile(constitutionPath, content);
  logger.info(`  📜 CONSTITUTION.md 已完善（${rules.length} 条规则）`);
}

async function detectStack(cwd: string): Promise<{
  backend?: string; backendSource?: string;
  frontend?: string; frontendSource?: string;
  database?: string; databaseSource?: string;
  language?: string; languageSource?: string;
}> {
  const stack: any = {};
  // pom.xml → Java/Spring
  if (existsSync(join(cwd, 'pom.xml'))) {
    try {
      const pom = await readFile(join(cwd, 'pom.xml'), 'utf-8');
      if (pom.includes('spring-boot')) { stack.backend = 'Spring Boot'; stack.backendSource = 'pom.xml'; }
      else { stack.backend = 'Java'; stack.backendSource = 'pom.xml'; }
      stack.language = 'Java'; stack.languageSource = 'pom.xml';
    } catch {}
  }

  // build.gradle → Java/Kotlin
  if (!stack.backend && existsSync(join(cwd, 'build.gradle'))) {
    try {
      const gradle = await readFile(join(cwd, 'build.gradle'), 'utf-8');
      if (gradle.includes('spring')) { stack.backend = 'Spring Boot'; stack.backendSource = 'build.gradle'; }
      else { stack.backend = 'Java/Kotlin'; stack.backendSource = 'build.gradle'; }
    } catch {}
  }

  // package.json → Node.js
  if (existsSync(join(cwd, 'package.json'))) {
    try {
      const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['next'] || deps['react']) { stack.frontend = 'React/Next.js'; stack.frontendSource = 'package.json'; }
      if (deps['vue']) { stack.frontend = 'Vue'; stack.frontendSource = 'package.json'; }
      if (deps['express'] || deps['koa']) { stack.backend = stack.backend || 'Node.js'; stack.backendSource = 'package.json'; }
      if (deps['nestjs']) { stack.backend = 'NestJS'; stack.backendSource = 'package.json'; }
      if (deps['mysql2'] || deps['pg']) { stack.database = Object.keys(deps).find(k => deps[k] && ['mysql2','pg','mongodb'].includes(k)) || 'SQL'; stack.databaseSource = 'package.json'; }
      stack.language = stack.language || 'TypeScript'; stack.languageSource = 'package.json';
    } catch {}
  }

  // go.mod → Go
  if (existsSync(join(cwd, 'go.mod'))) {
    stack.backend = stack.backend || 'Go'; stack.backendSource = 'go.mod';
    stack.language = 'Go'; stack.languageSource = 'go.mod';
  }

  // requirements.txt → Python
  if (existsSync(join(cwd, 'requirements.txt'))) {
    stack.backend = stack.backend || 'Python'; stack.backendSource = 'requirements.txt';
    stack.language = 'Python'; stack.languageSource = 'requirements.txt';
  }

  // Scan src/ for framework detection
  if (!stack.backend || !stack.frontend) {
    await scanSourceForFrameworks(cwd, stack);
  }

  return stack;
}

async function scanSourceForFrameworks(cwd: string, stack: any): Promise<void> {
  const srcDirs = ['src', 'app', 'lib'];
  for (const dir of srcDirs) {
    const full = join(cwd, dir);
    if (!existsSync(full)) continue;
    const files = findFiles(full, /\.(java|ts|tsx|py|go|vue|jsx)$/, 2);
    for (const f of files) {
      if (f.endsWith('.vue') && !stack.frontend) { stack.frontend = 'Vue'; stack.frontendSource = f; }
      if (f.endsWith('.java') && !stack.backend) { stack.backend = 'Java'; stack.backendSource = f; }
    }
  }
}

function findFiles(dir: string, pattern: RegExp, maxDepth: number): string[] {
  const { join } = require('path');
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory() && maxDepth > 0) {
        results.push(...findFiles(full, pattern, maxDepth - 1));
      } else if (entry.isFile() && pattern.test(entry.name)) {
        results.push(full);
      }
    }
  } catch {}
  return results;
}

function generateRules(stack: any): ConstitutionRule[] {
  const rules: ConstitutionRule[] = [];

  if (stack.language) {
    rules.push({
      category: '编程语言',
      rule: `所有代码必须使用 ${stack.language}`,
      reason: `项目已使用 ${stack.language}，保持一致性`,
      enforced: true,
    });
  }

  if (stack.backend) {
    rules.push({
      category: 'API 规范',
      rule: '所有接口必须使用 RESTful 风格，返回 JSON',
      reason: `${stack.backend} 项目，保持 API 一致性`,
      enforced: true,
    });

    if (stack.backend.includes('Spring')) {
      rules.push({
        category: '框架约束',
        rule: '使用 Spring Boot 约定，Controller → Service → Repository 分层',
        reason: 'Spring Boot 标准分层架构',
        enforced: true,
      });
    }
  }

  if (stack.database) {
    rules.push({
      category: '数据库',
      rule: `数据库使用 ${stack.database}，所有表必须有 created_at/updated_at`,
      reason: '标准数据库规范，便于审计',
      enforced: true,
    });
  }

  rules.push({
    category: '错误处理',
    rule: '统一错误码格式：MODULE_XXX + HTTP 状态码',
    reason: '便于前端统一处理和监控告警',
    enforced: true,
  });

  rules.push({
    category: '代码审查',
    rule: '所有代码必须经过 PR 审查才能合并',
    reason: '质量保障',
    enforced: true,
  });

  rules.push({
    category: '测试',
    rule: '新增接口必须有对应的单元测试',
    reason: '避免回归',
    enforced: false,
  });

  return rules;
}
