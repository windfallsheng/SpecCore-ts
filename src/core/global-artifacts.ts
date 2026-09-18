/**
 * global-artifacts — 全局分析时从源码反推技术栈、代码索引、架构、数据模型、接口清单、术语表
 *
 * v8.3.184+: 扩展为完整「全局技术分析文档集」
 *   - TECH_STACK.md / CODE_INDEX.md（技术栈 + 代码索引）
 *   - overview/ARCHITECTURE.md（端拓扑 + 模块依赖）
 *   - overview/API_INVENTORY.md（接口清单，含 HTTP 方法）
 *   - overview/DATA_MODEL.md（SQL 表 + Entity 类）
 *   - overview/GLOSSARY.md（术语表骨架 + 候选术语）
 *   - platforms/{端}/OVERVIEW.md + TECH.md（按端总览 + 技术方法）
 *
 * 数据来源：code-scanner 的 CodeIndex（files/endpoints/modules）+ code-graph 的 SQL schema 扫描。
 * 架构边界：CLI 只做确定性提取 + 骨架，语义抽象（架构描述/术语定义/技术方法）由宿主 AI 完成。
 */
import { writeFile, ensureDir, readFile, pathExists, rename } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { buildCodeIndex, loadFullIndex, type CodeIndex, type CodeFile, type EndpointInfo, type ModuleInfo } from './code-scanner';

/** 写入前检查冲突：内容不同则旧文件重命名为时间戳格式 */
async function safeWrite(filePath: string, newContent: string): Promise<void> {
  if (await pathExists(filePath)) {
    const existing = await readFile(filePath, 'utf-8');
    if (existing.trim() !== newContent.trim()) {
      const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const backupPath = filePath.replace(/\.md$/, `-${ts}.md`);
      await rename(filePath, backupPath);
      logger.info(`   ⚠️  冲突: ${join('.', filePath)} → 重命名为 ${join('.', backupPath)}`);
    }
  }
  await writeFile(filePath, newContent);
}

export async function generateGlobalArtifacts(sources: string[], depth: string): Promise<void> {
  const globalDir = join('.speccore', 'GLOBAL');
  const overviewDir = join(globalDir, 'overview');
  const platformsDir = join(globalDir, 'platforms');
  const reqDir = join(globalDir, 'requirements');
  await ensureDir(overviewDir);
  await ensureDir(platformsDir);
  await ensureDir(reqDir);
  await ensureDir(join(reqDir, 'images'));
  await ensureDir(join(reqDir, 'prototypes'));
  const now = new Date().toISOString().split('T')[0];

  // 确保代码索引最新（复用 code-scanner）
  let index: CodeIndex | null = null;
  try {
    await buildCodeIndex(sources.length ? sources.join(',') : undefined, true);
    index = await loadFullIndex();
  } catch (e) {
    logger.debug('代码索引构建失败（非关键）:', e);
  }

  // 1. TECH_STACK.md
  const techStack = await detectTechStack(sources);
  await safeWrite(join(globalDir, 'TECH_STACK.md'), [
    '# 统一技术栈注册表',
    '> 自动检测 | ' + now,
    '',
    techStack || '_未检测到明确的技术栈_',
  ].join('\n'));

  // 2. CODE_INDEX.md
  await safeWrite(join(globalDir, 'CODE_INDEX.md'), buildCodeIndexDoc(index, sources, now));

  // 3. overview/ARCHITECTURE.md
  await safeWrite(join(overviewDir, 'ARCHITECTURE.md'), buildArchitectureDoc(index, now));

  // 4. overview/API_INVENTORY.md
  await safeWrite(join(overviewDir, 'API_INVENTORY.md'), buildApiInventoryDoc(index, now));

  // 5. overview/DATA_MODEL.md
  await safeWrite(join(overviewDir, 'DATA_MODEL.md'), await buildDataModelDoc(index, now));

  // 6. overview/GLOSSARY.md
  await safeWrite(join(overviewDir, 'GLOSSARY.md'), buildGlossaryDoc(index, now));

  // 7. 按端 OVERVIEW.md + TECH.md
  if (index && index.endpoints.length > 0) {
    for (const ep of index.endpoints) {
      const epDir = join(platformsDir, sanitize(ep.name));
      await ensureDir(epDir);
      await safeWrite(join(epDir, 'OVERVIEW.md'), buildPlatformOverviewDoc(ep, index, now));
      await safeWrite(join(epDir, 'TECH.md'), buildPlatformTechDoc(ep, index, now));
    }
  }

  // 8. requirements/REQUIREMENT.md（骨架，语义由 AI 或 --from-code 补全）
  await safeWrite(join(reqDir, 'REQUIREMENT.md'), [
    '# 全局需求概览',
    '> 从源码反推 | ' + now,
    '',
    '## 检测到的工程',
    ...sources.map(s => '- `' + s + '`'),
    '',
    '## 待确认的功能模块',
    '> 请 AI 读取代码后补充各工程的核心功能模块，或用 `speccore analyze --from-code` 自动反推。',
  ].join('\n'));

  logger.info('   📄 全局技术分析: TECH_STACK + CODE_INDEX + ARCHITECTURE + API_INVENTORY + DATA_MODEL + GLOSSARY');
  if (index && index.endpoints.length > 0) {
    logger.info(`   📄 按端文档: ${index.endpoints.map(e => e.name).join(', ')}（OVERVIEW + TECH）`);
  }
}

// ── 各文档构建器（CLI 确定性提取 + 骨架）──

function buildCodeIndexDoc(index: CodeIndex | null, sources: string[], now: string): string {
  const lines = ['# 全局代码索引', '> 自动生成 | ' + now, ''];
  if (!index || index.endpoints.length === 0) {
    lines.push('| 工程路径 | 语言 | 框架 | 说明 |', '| :--- | :--- | :--- | :--- |');
    sources.forEach(s => lines.push('| `' + s + '` | _待分析_ | _待分析_ | -- |'));
    return lines.join('\n');
  }
  lines.push(`> 共 ${index.files.length} 个代码文件，${index.endpoints.length} 个端，${index.modules.length} 个模块`, '');
  lines.push('## 端清单', '', '| 端 | 技术栈 | 文件数 | 入口 |', '| :--- | :--- | :--- | :--- |');
  for (const ep of index.endpoints) {
    lines.push(`| \`${ep.name}\` | ${ep.techStack || '_未知_'} | ${ep.fileCount} | \`${ep.entryFile || '_未检测_'}\` |`);
  }
  lines.push('');
  lines.push('## 模块清单', '', '| 模块 | 端 | 文件数 | 核心文件 |', '| :--- | :--- | :--- | :--- |');
  for (const m of index.modules.slice(0, 60)) {
    lines.push(`| \`${m.name}\` | \`${m.endpoint}\` | ${m.fileCount} | ${m.coreFiles.slice(0, 2).map(f => '`' + f + '`').join(', ') || '—'} |`);
  }
  return lines.join('\n');
}

function buildArchitectureDoc(index: CodeIndex | null, now: string): string {
  const lines = ['# 系统架构', '> 自动生成 | ' + now, ''];
  if (!index || index.endpoints.length === 0) {
    lines.push('> _未检测到代码索引，架构骨架待 AI 补充_');
    return lines.join('\n');
  }
  lines.push('## 端拓扑', '', '| 端 | 技术栈 | 文件数 | 模块数 |', '| :--- | :--- | :--- | :--- |');
  for (const ep of index.endpoints) {
    const moduleCount = index.modules.filter(m => m.endpoint === ep.name).length;
    lines.push(`| \`${ep.name}\` | ${ep.techStack || '_未知_'} | ${ep.fileCount} | ${moduleCount} |`);
  }
  lines.push('');
  lines.push('## 模块依赖', '', '| 模块 | 端 | 依赖模块 |', '| :--- | :--- | :--- |');
  for (const m of index.modules.slice(0, 60)) {
    const deps = (m.dependencies || []).slice(0, 6);
    lines.push(`| \`${m.name}\` | \`${m.endpoint}\` | ${deps.length ? deps.map(d => '`' + d + '`').join(', ') : '—'} |`);
  }
  lines.push('');
  lines.push('## 架构描述（宿主 AI 补充）', '', '> ⚠️ 以下语义描述由宿主 AI 基于上面的确定性拓扑完成。', '', '### 系统分层', '', '_AI 填写：前后端分层、服务边界、数据流_', '', '### 跨端关系', '', '_AI 填写：各端如何协作（REST/消息/共享契约）_');
  return lines.join('\n');
}

function buildApiInventoryDoc(index: CodeIndex | null, now: string): string {
  const lines = ['# 接口清单', '> 自动生成 | ' + now, ''];
  if (!index || index.files.length === 0) {
    lines.push('> _未检测到接口，清单待 AI 补充_');
    return lines.join('\n');
  }
  // 按端分组聚合 apiDetails（"GET /path" 形式）
  const byEndpoint = new Map<string, Map<string, string[]>>();
  for (const f of index.files) {
    if (!f.apiDetails || f.apiDetails.length === 0) continue;
    if (!byEndpoint.has(f.endpoint)) byEndpoint.set(f.endpoint, new Map());
    const apiMap = byEndpoint.get(f.endpoint)!;
    for (const api of f.apiDetails) {
      const [method, ...rest] = api.split(' ');
      const path = rest.join(' ') || api;
      if (!apiMap.has(path)) apiMap.set(path, []);
      apiMap.get(path)!.push(method || 'ANY');
    }
  }
  for (const [ep, apiMap] of byEndpoint) {
    lines.push(`## ${ep}`, '', '| 方法 | 路径 |', '| :--- | :--- |');
    const sorted = [...apiMap.entries()].sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]));
    for (const [path, methods] of sorted) {
      lines.push(`| ${dedupe(methods).join('/')} | \`${path}\` |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function buildDataModelDoc(index: CodeIndex | null, now: string): Promise<string> {
  const lines = ['# 数据模型', '> 自动生成 | ' + now, ''];

  // SQL 表（复用 code-graph 的扫描）
  let tables: { name: string; columns: string[]; sourceFile: string }[] = [];
  try {
    const { scanSqlSchemas } = await import('./code-graph/multimodal');
    tables = await scanSqlSchemas(process.cwd());
  } catch { /* 无 SQL 或扫描失败 */ }

  if (tables.length > 0) {
    lines.push('## SQL 表', '', '| 表 | 列数 | 来源 |', '| :--- | :--- | :--- |');
    for (const t of tables.slice(0, 40)) {
      lines.push(`| \`${t.name}\` | ${t.columns.length} | \`${t.sourceFile}\` |`);
    }
    lines.push('');
  }

  // Entity/Model 类（从符号名启发式提取）
  if (index) {
    const entitySymbols = index.files
      .filter(f => /entity|model|domain|po|vo|dto/i.test(f.path))
      .flatMap(f => f.exports)
      .filter(Boolean);
    if (entitySymbols.length > 0) {
      lines.push('## Entity / Model 类', '', '> 从源码符号启发式提取（含 entity/model/domain 目录的类）', '');
      lines.push(dedupe(entitySymbols).slice(0, 50).map(s => '- `' + s + '`').join('\n'));
      lines.push('');
    }
  }

  if (tables.length === 0 && (!index || !index.files.some(f => /entity|model/i.test(f.path)))) {
    lines.push('> _未检测到数据模型，待 AI 补充_');
  }
  lines.push('');
  lines.push('## 数据关系（宿主 AI 补充）', '', '> ⚠️ 表间外键、聚合关系、多租户等语义由宿主 AI 完成。', '', '- _AI 填写：核心实体及关系_');
  return lines.join('\n');
}

function buildGlossaryDoc(index: CodeIndex | null, now: string): string {
  const lines = ['# 术语表', '> 自动生成 | ' + now, ''];
  // 启发式候选术语：模块名 + 高频符号前缀（去掉技术词）
  const candidates = new Set<string>();
  const stopWords = new Set(['controller', 'service', 'mapper', 'repository', 'manager', 'handler', 'util', 'utils', 'helper', 'config', 'entity', 'model', 'dto', 'vo', 'dao', 'impl', 'factory', 'builder', 'listener', 'filter', 'interceptor', 'aspect', 'component', 'view', 'page']);
  if (index) {
    for (const m of index.modules) candidates.add(m.name);
    for (const f of index.files) {
      for (const sym of f.exports) {
        const base = sym.replace(/(Controller|Service|Mapper|Repository|Manager|Handler|Util|Utils|Impl|DTO|VO|DAO|Entity|Model|View|Component)$/i, '');
        if (base && base.length >= 2 && !stopWords.has(base.toLowerCase())) {
          candidates.add(base);
        }
      }
    }
  }
  lines.push('## 候选术语（CLI 启发式提取）', '');
  if (candidates.size > 0) {
    lines.push([...candidates].slice(0, 40).map(c => '- `' + c + '`').join('\n'));
  } else {
    lines.push('> _未提取到候选术语_');
  }
  lines.push('');
  lines.push('## 术语定义（宿主 AI 补充）', '', '> ⚠️ 每个术语的准确定义、别名、业务含义由宿主 AI 完成。', '', '| 术语 | 定义 | 别名 |', '| :--- | :--- | :--- |', '| _AI 填写_ | _AI 填写_ | _AI 填写_ |');
  return lines.join('\n');
}

function buildPlatformOverviewDoc(ep: EndpointInfo, index: CodeIndex, now: string): string {
  const modules = index.modules.filter(m => m.endpoint === ep.name);
  const lines = ['# ' + ep.name + ' 总览', '> 自动生成 | ' + now, ''];
  lines.push('## 职责', '', `_AI 填写：${ep.name} 端在系统中的作用_`, '');
  lines.push('## 技术栈', '', ep.techStack || '_未知_', '');
  if (ep.frameworks && ep.frameworks.length > 0) {
    lines.push('### 框架', '', ep.frameworks.map(f => '- `' + f + '`').join('\n'), '');
  }
  lines.push('## 规模', '', `- 文件数: ${ep.fileCount}`, `- 模块数: ${modules.length}`, `- 入口: \`${ep.entryFile || '_未检测_'}\``, '');
  lines.push('## 模块清单', '', '| 模块 | 文件数 | 核心文件 |', '| :--- | :--- | :--- |');
  for (const m of modules.slice(0, 30)) {
    lines.push(`| \`${m.name}\` | ${m.fileCount} | ${m.coreFiles.slice(0, 2).map(f => '`' + f + '`').join(', ') || '—'} |`);
  }
  lines.push('');
  lines.push('## 与其他端的关系', '', '_AI 填写：本端如何与其他端协作_');
  return lines.join('\n');
}

function buildPlatformTechDoc(ep: EndpointInfo, index: CodeIndex, now: string): string {
  const modules = index.modules.filter(m => m.endpoint === ep.name);
  const lines = ['# ' + ep.name + ' 技术方法', '> 自动生成 | ' + now, ''];
  lines.push('## 架构分层', '', '> ⚠️ 分层规范由宿主 AI 基于本端技术栈补全（如 Controller→Service→Mapper）。', '', '- _AI 填写：分层职责与规范_', '');
  lines.push('## 设计模式', '', '> 从源码重复结构识别（模式沉淀见 .speccore/PATTERNS/）。', '', '- _AI 填写：本端常用的设计模式及使用场景_', '');
  lines.push('## 模块与依赖', '', '| 模块 | 依赖 |', '| :--- | :--- |');
  for (const m of modules.slice(0, 40)) {
    const deps = (m.dependencies || []).slice(0, 6);
    lines.push(`| \`${m.name}\` | ${deps.length ? deps.map(d => '`' + d + '`').join(', ') : '—'} |`);
  }
  lines.push('');
  lines.push('## 约定与规范', '', '> ⚠️ 命名、异常处理、事务、缓存等约定由宿主 AI 补全（参考全局 TECH_STACK + CONSTITUTION）。', '', '- _AI 填写_');
  return lines.join('\n');
}

async function detectTechStack(sources: string[]): Promise<string> {
  const fs = require('fs');
  const lines: string[] = [];

  for (const dir of sources) {
    const pkgPath = join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const frameworks: string[] = [];
        if (deps['react']) frameworks.push('React');
        if (deps['vue']) frameworks.push('Vue ');
        if (deps['@angular/core']) frameworks.push('Angular');
        if (deps['express']) frameworks.push('Express');
        if (deps['next']) frameworks.push('Next.js');
        if (deps['@nestjs/core']) frameworks.push('NestJS');
        lines.push('**' + dir + '**: Node.js ' + (frameworks.length > 0 ? frameworks.join(' + ') : '(通用)'));
      } catch {}
    }

    const pomPath = join(dir, 'pom.xml');
    if (fs.existsSync(pomPath)) {
      const pom = fs.readFileSync(pomPath, 'utf-8');
      const isSpring = pom.includes('spring-boot') || pom.includes('springframework');
      lines.push('**' + dir + '**: Java ' + (isSpring ? 'Spring Boot' : '(通用)'));
    }

    if (fs.existsSync(join(dir, 'go.mod'))) {
      lines.push('**' + dir + '**: Go');
    }

    if (fs.existsSync(join(dir, 'requirements.txt')) || fs.existsSync(join(dir, 'setup.py'))) {
      lines.push('**' + dir + '**: Python');
    }
  }

  return lines.join('\n') || '| 工程 | 语言 |\n| :--- | :--- |\n' + sources.map(s => '| ' + s + ' | 未检测到 |').join('\n');
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '-');
}
