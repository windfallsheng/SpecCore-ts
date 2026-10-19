/**
 * constitution-builder — 自动检测项目技术栈，完善 CONSTITUTION.md「技术栈」节（决策式）
 *
 * v8.3.325 重构：
 * - 写入目标从 .speccore/PROJECT/CONSTITUTION.md（无人读取的副本）改为 .speccore/CONSTITUTION.md 主文件
 * - 与 v8.3.324 决策式技术栈表对齐：检测产出「语言/框架/数据存储/依据」四列，端名留待用户拍板（不脑补）
 * - 不再生成框架通用规则（AGENTS.md 禁令 12：严禁框架自带标准用法）
 * - init 模式（模板刚生成）：替换示例行；update 模式（存量文件）：仅在技术栈未填时补填，绝不覆盖用户已填内容
 */
import { readFile, writeFile, pathExists } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { existsSync, readdirSync } from 'fs';

export interface DetectedStack {
  backend?: string;
  backendSource?: string;
  frontend?: string;
  frontendSource?: string;
  database?: string;
  databaseSource?: string;
  language?: string;
  languageSource?: string;
}

export interface EnhanceOptions {
  /** 端名列取值（init 传项目名；不传则「待填写」） */
  platformName?: string;
  /** true = 模板刚生成，直接替换示例行（init 用）；false = 存量文件，未填才补（update 用） */
  freshTemplate?: boolean;
}

/** 检测技术栈（pom.xml / build.gradle / package.json / go.mod / requirements.txt / 源码扫描） */
export async function detectStack(cwd: string): Promise<DetectedStack> {
  const stack: DetectedStack = {};

  // pom.xml → Java/Spring
  if (existsSync(join(cwd, 'pom.xml'))) {
    try {
      const pom = await readFile(join(cwd, 'pom.xml'), 'utf-8');
      if (pom.includes('spring-boot')) {
        stack.backend = 'Spring Boot';
        stack.backendSource = 'pom.xml';
      } else {
        stack.backend = 'Java';
        stack.backendSource = 'pom.xml';
      }
      stack.language = 'Java';
      stack.languageSource = 'pom.xml';
    } catch {}
  }

  // build.gradle → Java/Kotlin
  if (!stack.backend && existsSync(join(cwd, 'build.gradle'))) {
    try {
      const gradle = await readFile(join(cwd, 'build.gradle'), 'utf-8');
      if (gradle.includes('spring')) {
        stack.backend = 'Spring Boot';
        stack.backendSource = 'build.gradle';
      } else {
        stack.backend = 'Java/Kotlin';
        stack.backendSource = 'build.gradle';
      }
    } catch {}
  }

  // package.json → Node.js 生态
  if (existsSync(join(cwd, 'package.json'))) {
    try {
      const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['next'] || deps['react']) {
        stack.frontend = 'React/Next.js';
        stack.frontendSource = 'package.json';
      }
      if (deps['vue']) {
        stack.frontend = 'Vue';
        stack.frontendSource = 'package.json';
      }
      if (deps['express'] || deps['koa']) {
        stack.backend = stack.backend || 'Node.js';
        stack.backendSource = 'package.json';
      }
      if (deps['nestjs']) {
        stack.backend = 'NestJS';
        stack.backendSource = 'package.json';
      }
      if (deps['mysql2'] || deps['pg'] || deps['mongodb']) {
        stack.database = ['mysql2', 'pg', 'mongodb'].find((k) => deps[k]) || 'SQL';
        stack.databaseSource = 'package.json';
      }
      // v8.3.325: 仅显式依赖 typescript 才判 TS，避免把纯 JS 项目误判
      if (deps['typescript']) {
        stack.language = stack.language || 'TypeScript';
        stack.languageSource = 'package.json';
      }
    } catch {}
  }

  // go.mod → Go
  if (existsSync(join(cwd, 'go.mod'))) {
    stack.backend = stack.backend || 'Go';
    stack.backendSource = 'go.mod';
    stack.language = 'Go';
    stack.languageSource = 'go.mod';
  }

  // requirements.txt → Python
  if (existsSync(join(cwd, 'requirements.txt'))) {
    stack.backend = stack.backend || 'Python';
    stack.backendSource = 'requirements.txt';
    stack.language = 'Python';
    stack.languageSource = 'requirements.txt';
  }

  // 源码扫描兜底
  if (!stack.backend || !stack.frontend) {
    await scanSourceForFrameworks(cwd, stack);
  }

  return stack;
}

async function scanSourceForFrameworks(cwd: string, stack: DetectedStack): Promise<void> {
  const srcDirs = ['src', 'app', 'lib'];
  for (const dir of srcDirs) {
    const full = join(cwd, dir);
    if (!existsSync(full)) continue;
    const files = findFiles(full, /\.(java|ts|tsx|py|go|vue|jsx)$/, 2);
    for (const f of files) {
      if (f.endsWith('.vue') && !stack.frontend) {
        stack.frontend = 'Vue';
        stack.frontendSource = f;
      }
      if (f.endsWith('.java') && !stack.backend) {
        stack.backend = 'Java';
        stack.backendSource = f;
      }
    }
  }
}

function findFiles(dir: string, pattern: RegExp, maxDepth: number): string[] {
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

/** 表格数据行的「已填」判定：语言列或框架列有实质内容 */
function isFilledRow(row: string): boolean {
  const cols = row.split('|').map((c) => c.trim());
  // | 端 | 语言 | 框架 | 数据存储 | 依据 |
  const lang = cols[2] || '';
  const framework = cols[3] || '';
  return (
    lang !== '' &&
    lang !== '待填写' &&
    framework !== '' &&
    framework !== '待填写' &&
    framework !== '—'
  );
}

function buildDetectedRow(stack: DetectedStack, platformName?: string): string {
  const platform = platformName || '待填写';
  const language = stack.language || '待填写';
  const framework = stack.backend || stack.frontend || '待填写';
  const database = stack.database || '—';
  const source =
    stack.languageSource ||
    stack.backendSource ||
    stack.frontendSource ||
    stack.databaseSource ||
    '—';
  return `| ${platform} | ${language} | ${framework} | ${database} | ${source} |`;
}

/**
 * 检测并完善 .speccore/CONSTITUTION.md 的「## 技术栈」节。
 * @returns true = 已写入；false = 无需写入（已配置 / 检测不到 / 旧格式仅提示 / 文件不存在）
 */
export async function enhanceConstitutionTechStack(
  projectRoot: string,
  options: EnhanceOptions = {},
): Promise<boolean> {
  const constitutionPath = join(projectRoot, '.speccore', 'CONSTITUTION.md');
  if (!(await pathExists(constitutionPath))) return false;

  const content = await readFile(constitutionPath, 'utf-8');
  const lines = content.split('\n');

  // 1. 定位「## 技术栈」节
  const sectionIdx = lines.findIndex((l) => /^##\s+技术栈/.test(l.trim()));
  if (sectionIdx < 0) return false;

  // 2. 找表头行（| 端 | 语言 | …），跳过注释行
  let headerIdx = -1;
  for (let i = sectionIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('|') && t.includes('语言') && t.includes('框架')) {
      headerIdx = i;
      break;
    }
    // 遇到下一个 ## 节或表格外内容就停止（旧菜单格式无此表头）
    if (/^##\s+/.test(t)) break;
  }
  if (headerIdx < 0) {
    logger.info('  ℹ️ 技术栈为旧版菜单格式，未自动改写（可运行 speccore constitution 后手动升级为决策式）');
    return false;
  }

  // 3. 收集表头之后的数据行（跳过分隔行 :---；空行/注释/下一节为止）
  const dataRowIndexes: number[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^##\s+/.test(t) || (t !== '' && !t.startsWith('|') && !t.startsWith('>'))) break;
    if (t.startsWith('|') && !t.includes('---')) dataRowIndexes.push(i);
    if (t === '') break;
  }
  if (dataRowIndexes.length === 0) return false;

  const hasFilled = dataRowIndexes.some((i) => isFilledRow(lines[i]));

  // 4. 决策：存量文件已填 → 不覆盖；未填/模板刚生成 → 检测后替换
  if (!options.freshTemplate && hasFilled) {
    logger.info('  ℹ️ 技术栈已配置，跳过自动检测（可运行 speccore constitution 手动完善）');
    return false;
  }

  const stack = await detectStack(projectRoot);
  if (!stack.language && !stack.backend && !stack.frontend) {
    logger.info('  ℹ️ 未检测到可识别的技术栈（pom.xml/package.json/go.mod/requirements.txt），保留现状');
    return false;
  }

  const detectedRow = buildDetectedRow(stack, options.platformName);
  // 多行示例/占位 → 首行替换为检测行，其余删除（每端一行，不产生重复行）
  lines[dataRowIndexes[0]] = detectedRow;
  for (let i = dataRowIndexes.length - 1; i >= 1; i--) lines.splice(dataRowIndexes[i], 1);

  await writeFile(constitutionPath, lines.join('\n'));
  logger.info(`  🔍 技术栈自动检测完成：${stack.language || stack.backend || stack.frontend}（来源: ${
    stack.languageSource || stack.backendSource || stack.frontendSource || '—'
  }），已写入 CONSTITUTION.md 技术栈表（端名请人工确认）`);
  return true;
}

/** constitution 命令入口：存量文件手动完善（已填行不动，未填才补） */
export async function buildConstitution(cwd: string): Promise<void> {
  const ok = await enhanceConstitutionTechStack(cwd, { freshTemplate: false });
  if (!ok) {
    logger.info('  未检测到可完善的技术栈（可能已配置、旧格式、或无已知依赖清单文件）');
  }
}
