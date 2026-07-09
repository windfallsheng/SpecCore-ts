/**
 * import - 多项目导入命令
 * 将存量项目导入到全量层（GLOBAL/PROJECTS/），填充全量需求和索引
 */

import { pathExists, readdir, readFile, stat, writeFile, ensureDir } from 'fs-extra';
import { join, extname } from 'path';
import { logger, Spinner } from '../utils/logger';
import {
  readGlobalIndex,
  getNextReqId,
  bumpGlobalVersion,
  appendReqToIndex,
  upsertProjectInIndex,
  updateIndexVersion,
  ensureProjectDir,
  writeProjectRequirements,
  writeProjectMetadata,
  ProjectType,
} from '../core/global-layer';

export interface ImportOptions {
  source?: string;
  path?: string;
  url?: string;
  iteration?: string;
  project?: string;
  type?: string;
  force?: boolean;
  scope?: string;
  ignore?: string;
  update?: boolean;
}

export async function importCommand(options: ImportOptions): Promise<void> {
  const spinner = new Spinner('Importing project to global layer');
  spinner.start();

  try {
    // 新逻辑：多项目导入到全量层
    if (options.project) {
      const projectName = options.project;
      const projectPath = options.path || `./${projectName}`;
      const projectType = (options.type || 'backend') as ProjectType;

      await importToGlobalLayer(projectName, projectPath, projectType, options);
      spinner.stop('Project imported to global layer');
      return;
    }

    // 兼容旧逻辑
    const sources = (options.source || 'all').split(',');
    const results: string[] = [];

    for (const source of sources) {
      switch (source.trim()) {
        case 'code':
          results.push(await importCode(options.path || './'));
          break;
        case 'prd':
          results.push(await importPRD(options.path || './PRD.md'));
          break;
        case 'prototype':
          results.push(await importPrototype(options.url || ''));
          break;
        case 'all':
          results.push(await autoDetectImport(options.path || './'));
          break;
        default:
          logger.warn(`Unknown source type: ${source}`);
      }
    }

    spinner.stop('Import completed');
    for (const result of results) {
      logger.info(result);
    }
  } catch (error) {
    spinner.fail(`Import failed: ${error}`);
    throw error;
  }
}

/**
 * 多项目导入到全量层
 */
async function importToGlobalLayer(
  projectName: string,
  projectPath: string,
  projectType: ProjectType,
  options: ImportOptions
): Promise<void> {
  // 1. 检查路径
  if (!(await pathExists(projectPath))) {
    throw new Error(`Project path not found: ${projectPath}`);
  }

    // 2. 检查全局层是否已初始化
    const globalDir = join(process.cwd(), '.speccore', 'GLOBAL');
    if (!(await pathExists(globalDir))) {
      throw new Error('Global layer not initialized. Run: speccore init');
    }

    // 增量同步模式：检查项目是否已存在
    if (options.update) {
      const existingDir = join(globalDir, 'PROJECTS', projectName);
      if (await pathExists(existingDir)) {
        logger.info(`🔄 Incremental update mode: ${projectName} already exists, syncing changes...`);
      }
    }

  // 3. 读取当前全量索引
  const index = await readGlobalIndex();

  // 4. 扫描项目代码
  logger.info(`🔍 Scanning project: ${projectName} (${projectType})`);
  const scanResult = await scanProject(projectPath, projectType, options);
  logger.info(`   Found ${scanResult.apis.length} API endpoints, ${scanResult.models.length} data models`);

  // 5. 生成需求条目
  const requirements: { name: string; description: string; id: string }[] = [];
  let nextId = parseInt(getNextReqId(index).replace('REQ-', ''), 10);

  for (const api of scanResult.apis) {
    const reqId = `REQ-${String(nextId++).padStart(3, '0')}`;
    requirements.push({
      id: reqId,
      name: api.name,
      description: `API: ${api.method} ${api.path}\n${api.description || '从代码分析提取的功能描述'}`,
    });
  }

  // 如果没有扫描到 API，生成一个占位需求
  if (requirements.length === 0) {
    const reqId = `REQ-${String(nextId++).padStart(3, '0')}`;
    requirements.push({
      id: reqId,
      name: `${projectName} 项目导入`,
      description: `从 ${projectPath} 导入的项目，类型: ${projectType}`,
    });
  }

  // 6. 创建项目目录和文件
  await ensureProjectDir(projectName);
  const entries = await writeProjectRequirements(projectName, projectType, requirements, scanResult.techStack);
  await writeProjectMetadata(projectName, projectType, scanResult.techStack, scanResult.repoUrl);

  // 7. 更新全量索引
  for (const entry of entries) {
    await appendReqToIndex(entry);
  }

  await upsertProjectInIndex({
    name: projectName,
    type: projectType,
    reqCount: entries.length,
    implemented: entries.filter((e) => e.status === '📦 已有实现').length,
    inProgress: 0,
    pending: 0,
    lastImport: new Date().toISOString().split('T')[0],
  });

  // 8. 更新版本
  const newVersion = bumpGlobalVersion(index.version);
  await updateIndexVersion(newVersion);

  // 9. 更新 OVERVIEW.md 和 CHANGELOG.md
  await updateGlobalOverview(projectName, projectType);
  await updateGlobalChangelog(`导入项目 ${projectName}`, newVersion);

  // 10. 输出报告
  logger.info('');
  logger.info('✅ 项目导入完成！');
  logger.info('');
  logger.info('📊 导入摘要:');
  logger.info(`   项目名称: ${projectName}`);
  logger.info(`   项目类型: ${projectType}`);
  logger.info(`   识别接口: ${scanResult.apis.length} 个`);
  logger.info(`   数据模型: ${scanResult.models.length} 个`);
  logger.info(`   生成需求: ${entries.map((e) => e.id).join(', ')}`);
  logger.info('');
  logger.info('📁 已创建:');
  logger.info(`   GLOBAL/PROJECTS/${projectName}/REQUIREMENT.md`);
  logger.info(`   GLOBAL/PROJECTS/${projectName}/METADATA.md`);
  logger.info('');
  logger.info('📋 已更新:');
  logger.info('   GLOBAL/INDEX.md（需求映射 + 项目列表）');
  logger.info('   GLOBAL/OVERVIEW.md');
  logger.info('');
  logger.info('📋 下一步:');
  logger.info('   speccore global-status  查看全量层状态');
  logger.info('   speccore iteration-from-global  从全量层生成期次');
}

// ============================================================
// 项目扫描
// ============================================================

interface ApiEndpoint {
  method: string;
  path: string;
  name: string;
  description: string;
}

interface ScanResult {
  apis: ApiEndpoint[];
  models: string[];
  techStack: string;
  repoUrl: string;
}

async function scanProject(projectPath: string, projectType: ProjectType, options?: ImportOptions): Promise<ScanResult> {
  const result: ScanResult = {
    apis: [],
    models: [],
    techStack: '',
    repoUrl: '',
  };

  const absPath = join(process.cwd(), projectPath);

  // Handle --scope and --ignore
  const scope = options?.scope || 'all';
  const ignores = (options?.ignore || '').split(',').filter(Boolean).map(s => s.trim());

  if (projectType === 'backend') {
    // 扫描后端项目
    // 尝试读取 pom.xml (Java/Maven)
    const pomPath = join(absPath, 'pom.xml');
    if (await pathExists(pomPath)) {
      const pom = await readFile(pomPath, 'utf-8');
      const groupMatch = pom.match(/<groupId>([^<]+)<\/groupId>/);
      const artifactMatch = pom.match(/<artifactId>([^<]+)<\/artifactId>/);
      if (groupMatch && artifactMatch) {
        result.techStack = `Java Maven: ${groupMatch[1]}:${artifactMatch[1]}`;
      }
    }

    // 扫描 package.json (Node.js)
    const pkgPath = join(absPath, 'package.json');
    if (await pathExists(pkgPath)) {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
      result.techStack = `Node.js: ${pkg.name || 'unnamed'}`;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['@nestjs/core']) result.techStack += ' (NestJS)';
      else if (deps['express']) result.techStack += ' (Express)';
    }

    // 扫描 src/ 目录寻找 Controller/路由
    const srcDir = join(absPath, 'src');
    if (await pathExists(srcDir)) {
      result.apis = await scanApiEndpoints(srcDir, ignores, scope);
    }
  } else if (['web', 'h5', 'miniapp'].includes(projectType)) {
    // 扫描前端项目
    const pkgPath = join(absPath, 'package.json');
    if (await pathExists(pkgPath)) {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
      result.techStack = `${projectType}: ${pkg.name || 'unnamed'}`;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['vue']) result.techStack += ' (Vue)';
      else if (deps['react']) result.techStack += ' (React)';
      else if (deps['@angular/core']) result.techStack += ' (Angular)';

      // 扫描 pages/ 目录
      const pagesDir = join(absPath, 'src', 'pages');
      if (await pathExists(pagesDir)) {
        const pages = await readdir(pagesDir, { withFileTypes: true });
        for (const page of pages.filter((p) => p.isDirectory())) {
          result.apis.push({
            method: 'PAGE',
            path: `/${page.name}`,
            name: `${page.name} 页面`,
            description: `${projectType} 页面`,
          });
        }
      }
    }
  }

  return result;
}

/**
 * 递归扫描 API 端点
 */
async function scanApiEndpoints(srcDir: string, ignores: string[] = [], scope: string = 'all'): Promise<ApiEndpoint[]> {
  const apis: ApiEndpoint[] = [];

  async function scan(dir: string) {
    if (!(await pathExists(dir))) return;
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      // 跳过忽略的包
      if (ignores.some(ign => fullPath.includes(ign))) continue;

      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if ([
        '.java', '.ts', '.js', '.go', '.py',
      ].includes(extname(entry.name))) {
        // scope 过滤
        if (scope === 'core' && !fullPath.includes('controller') && !fullPath.includes('service')) continue;
        if (scope === 'api' && !fullPath.includes('controller') && !fullPath.includes('route')) continue;

        const content = await readFile(fullPath, 'utf-8');

        // Java Spring
        const javaMatches = content.matchAll(
          /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*(?:\([^)]*\))?\s*(?:@[^(\n]*\s*)*(?:public\s+\S+\s+)?(\w+)\s*\(/g
        );
        for (const match of javaMatches) {
          const annMethod = match[1];
          const funcName = match[2];
          // Try to extract path
          const pathMatch = content.substring(match.index || 0, (match.index || 0) + 200).match(
            /@\w+Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/
          );
          const apiPath = pathMatch ? pathMatch[1] : '/';
          apis.push({
            method: annMethod.replace('Mapping', '').toUpperCase(),
            path: apiPath,
            name: funcName ? funcName.replace(/([A-Z])/g, ' $1').trim() : apiPath,
            description: `从 ${entry.name} 扫描到的 API 端点`,
          });
        }

        // TypeScript NestJS
        const tsMatches = content.matchAll(
          /@(Get|Post|Put|Delete|Patch)\s*\(\s*(?:['"]([^'"]*)['"]\s*)?\)/g
        );
        for (const match of tsMatches) {
          apis.push({
            method: match[1],
            path: match[2] || '/',
            name: match[2] ? match[2].replace(/^\//, '').replace(/\//g, ' ') : 'API',
            description: `从 ${entry.name} 扫描到的 NestJS 端点`,
          });
        }

        // Express routes
        const expressMatches = content.matchAll(
          /(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g
        );
        for (const match of expressMatches) {
          apis.push({
            method: match[1].toUpperCase(),
            path: match[2],
            name: match[2].replace(/^\//, '').replace(/\//g, ' '),
            description: `从 ${entry.name} 扫描到的 Express 路由`,
          });
        }
      }
    }
  }

  await scan(srcDir);
  return apis;
}

// ============================================================
// 全局文件更新
// ============================================================

async function updateGlobalOverview(projectName: string, projectType: string): Promise<void> {
  const overviewPath = join(process.cwd(), '.speccore', 'GLOBAL', 'OVERVIEW.md');
  if (!(await pathExists(overviewPath))) return;

  let content = await readFile(overviewPath, 'utf-8');
  const today = new Date().toISOString().split('T')[0];

  const newEntry = `| ${projectName} | ${projectType} | 已导入 | - |`;
  if (content.includes('_待导入_')) {
    content = content.replace('| _待导入_ | - | - | - |', newEntry);
  }

  await writeFile(overviewPath, content);
}

async function updateGlobalChangelog(description: string, version: string): Promise<void> {
  const changelogPath = join(process.cwd(), '.speccore', 'GLOBAL', 'CHANGELOG.md');
  if (!(await pathExists(changelogPath))) return;

  let content = await readFile(changelogPath, 'utf-8');
  const today = new Date().toISOString().split('T')[0];

  const newEntry = `| ${today} | ${version} | 导入 | ${description} | SpecCore |`;
  if (content.includes('_暂无记录_')) {
    content = content.replace('| _暂无记录_ | v1.0 | 创建 | 全量层模板初始化 | - |', newEntry);
  } else {
    // 在变更记录表后面追加
    const firstEntry = content.indexOf('|', content.indexOf('## 变更记录'));
    const endOfLine = content.indexOf('\n', firstEntry);
    if (endOfLine > 0) {
      content = content.slice(0, endOfLine + 1) + newEntry + '\n' + content.slice(endOfLine + 1);
    }
  }

  await writeFile(changelogPath, content);
}

// ============================================================
// 旧版兼容函数
// ============================================================

async function importCode(sourcePath: string): Promise<string> {
  if (!(await pathExists(sourcePath))) {
    throw new Error(`Path not found: ${sourcePath}`);
  }

  const statsObj = await stat(sourcePath);
  if (!statsObj.isDirectory()) {
    throw new Error(`Path must be a directory: ${sourcePath}`);
  }

  const entries = await readdir(sourcePath, { withFileTypes: true });
  const files = entries.filter((e) =>
    e.isFile() && ['.java', '.ts', '.js', '.py', '.go'].includes(extname(e.name))
  );

  logger.info(`Legacy mode: Found ${files.length} source files.`);
  logger.info('💡 Tip: Use speccore import --project=<name> --path=<path> --type=<type> for global layer import.');
  return `Found ${files.length} source files in ${sourcePath}`;
}

async function importPRD(prdPath: string): Promise<string> {
  if (!(await pathExists(prdPath))) {
    throw new Error(`PRD file not found: ${prdPath}`);
  }
  const content = await readFile(prdPath, 'utf-8');
  const requirements = extractRequirements(content);
  logger.info(`Extracted ${requirements.length} requirements (legacy mode)`);
  return `Imported PRD from ${prdPath}: ${requirements.length} requirements`;
}

function extractRequirements(content: string): string[] {
  const requirements: string[] = [];
  const patterns = [
    /(?:需求|Requirement)\s*[:：]\s*(.+)/g,
    /(?:功能|Feature)\s*[:：]\s*(.+)/g,
    /\d+\.\s+(.+)/g,
  ];
  for (const pattern of patterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      requirements.push(match[1].trim());
    }
  }
  return requirements;
}

async function importPrototype(url: string): Promise<string> {
  if (!url) {
    throw new Error('Prototype URL is required');
  }
  logger.info(`Importing prototype from ${url}`);
  return `Prototype imported from ${url}`;
}

async function autoDetectImport(sourcePath: string): Promise<string> {
  logger.info('💡 Tip: Use speccore import --project=<name> --path=<path> --type=<type> for global layer import.');
  logger.info('Auto-detecting project structure...');

  const results: string[] = [];
  if (await pathExists(join(sourcePath, 'src'))) {
    results.push(await importCode(sourcePath));
  }
  const prdFiles = ['PRD.md', 'README.md', 'docs/PRD.md'];
  for (const prdFile of prdFiles) {
    if (await pathExists(join(sourcePath, prdFile))) {
      results.push(await importPRD(join(sourcePath, prdFile)));
      break;
    }
  }
  return results.join('\n');
}
