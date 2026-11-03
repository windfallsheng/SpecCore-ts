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
import { writeFile, ensureDir, readFile, pathExists, rename, readdir } from 'fs-extra';
import { join, dirname, basename, resolve, extname } from 'path';
import { logger } from '../utils/logger';
import { getProjectRoot } from '../utils/task-utils';
import { buildCodeIndex, loadFullIndex, type CodeIndex, type CodeFile, type EndpointInfo, type ModuleInfo } from './code-scanner';

/**
 * 写入前检查冲突：内容不同则旧文件归档到同目录 .history/ 子目录（时间戳命名）。
 * v8.3.368: 旧版是平铺改名（同目录 REQUIREMENT-20260923…md），生成性文档每轮必变，
 * 坟头在四层目录疯长（已见 21 个）并污染 INDEX/RAG 索引；改归档后主目录永远只有正本，
 * .history/ 以点开头，reindex 的 scanMarkdownFiles 自动跳过（startsWith('.')）。
 */
async function safeWrite(filePath: string, newContent: string): Promise<void> {
  if (await pathExists(filePath)) {
    const existing = await readFile(filePath, 'utf-8');
    if (existing.trim() !== newContent.trim()) {
      const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const historyDir = join(dirname(filePath), '.history');
      await ensureDir(historyDir);
      const backupPath = join(historyDir, `${basename(filePath).replace(/\.md$/, '')}-${ts}.md`);
      await rename(filePath, backupPath);
      logger.info(`   ⚠️  冲突: ${join('.', filePath)} → 归档 ${join('.', historyDir)}/`);
    }
  }
  await writeFile(filePath, newContent);
}

export async function generateGlobalArtifacts(sources: string[], depth: string): Promise<void> {
  const globalDir = join(getProjectRoot(), '.speccore', 'GLOBAL');
  const overviewDir = join(globalDir, 'overview');
  const platformsDir = join(globalDir, 'platforms');
  const reqDir = join(globalDir, 'requirements');
  await ensureDir(overviewDir);
  await ensureDir(platformsDir);
  await ensureDir(reqDir);
  // v8.3.368: 不再预创建 images/prototypes 空目录（无写入方，徒增散乱）
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
  await safeWrite(join(overviewDir, 'TECH_STACK.md'), [
    '# 统一技术栈注册表',
    '> 自动检测 | ' + now,
    '',
    techStack || '_未检测到明确的技术栈_',
  ].join('\n'));

  // 2. CODE_INDEX.md
  await safeWrite(join(overviewDir, 'CODE_INDEX.md'), buildCodeIndexDoc(index, sources, now));

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

  // 9. v8.3.369: 四层线 4b/4c 语义文档骨架并入本生成器（体系收敛：一个概念一个生成器）。
  //    旧状：4b/4c 九文档无人生成只被检查（global analyze 永远报缺）；现由 CLI 统一铺骨架，
  //    宿主 AI 按 _DOCS_PLAYBOOK.md 接力填语义，4b/4c 检查自然通过。
  await buildSemanticDocSkeletons(index, sources, overviewDir, now);

  // 10. v8.3.369: AI 接力剧本（语义层占位清单 + 素材指引，宿主 AI 按此填占位）
  await safeWrite(join(globalDir, '_DOCS_PLAYBOOK.md'), await buildDocsPlaybook(index, sources, now));

  logger.info('   📄 全局技术分析: TECH_STACK + CODE_INDEX + ARCHITECTURE + API_INVENTORY + DATA_MODEL + GLOSSARY');
  if (index && index.endpoints.length > 0) {
    logger.info(`   📄 按端文档: ${index.endpoints.map(e => e.name).join(', ')} （OVERVIEW + TECH）`);
  }
  logger.info('   📄 语义骨架: FUNCTION_MAP + API_CONTRACT + INTERACTION_MAP + 安全/性能/数据流/部署/一致性 5 文档');
  logger.info('   📝 AI 接力剧本: _DOCS_PLAYBOOK.md（宿主 AI 按剧本填语义占位）');
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

/**
 * v8.3.369: 技术栈检测重写（对标 GitHub Linguist 的「标记文件 + 扩展名统计」双轨策略，工程级适配）。
 *
 * 检测顺序：
 *   1. 标记文件（从 sources 目录向上回溯 ≤6 层找工程根）：package.json / pom.xml / go.mod /
 *      requirements.txt / setup.py / Cargo.toml / Gemfile
 *   2. 依赖表框架识别（15+ 主流框架，按专一度排序避免误报）
 *   3. 扩展名统计兜底（无标记文件时按文件扩展名分布取 Top 语言）
 *
 * 旧版缺陷：只找 {dir}/package.json（源码子目录下必扑空），且框架表仅 6 种、无 TypeScript 判定。
 */

/** 框架检测表：[显示名, 依赖键] —— 按专一度排序（Next/Nuxt/Nest 优先于 React/Vue） */
const FRAMEWORK_TABLE: [string, string][] = [
  ['Next.js', 'next'], ['Nuxt', 'nuxt'], ['NestJS', '@nestjs/core'],
  ['Angular', '@angular/core'], ['Svelte', 'svelte'], ['React', 'react'],
  ['Vue', 'vue'], ['React Native', 'react-native'], ['Electron', 'electron'],
  ['Express', 'express'], ['Koa', 'koa'], ['Fastify', 'fastify'],
  ['Egg', 'egg'], ['Commander', 'commander'], ['Vite', 'vite'], ['Webpack', 'webpack'],
];

/** 工程根标记文件 → 语言 + 框架判定器 */
const ROOT_MARKERS = [
  'package.json', 'pom.xml', 'go.mod', 'requirements.txt', 'setup.py', 'Cargo.toml', 'Gemfile',
];

/** 扩展名 → 语言（兜底统计用） */
const EXT_LANG: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.vue': 'Vue', '.py': 'Python', '.java': 'Java', '.go': 'Go', '.rs': 'Rust',
  '.kt': 'Kotlin', '.swift': 'Swift', '.cs': 'C#', '.php': 'PHP', '.rb': 'Ruby',
};

/** 从目录向上回溯找工程根（含任一标记文件的最近祖先目录），最多 6 层 */
export async function findProjectMarkerRoot(dir: string): Promise<string | null> {
  let cur = dir;
  for (let i = 0; i <= 6; i++) {
    for (const marker of ROOT_MARKERS) {
      if (await pathExists(join(cur, marker))) return cur;
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

/** package.json → { language, framework } */
export async function detectFromPackage(pkgRoot: string): Promise<{ language: string; framework?: string }> {
  const pkg = JSON.parse(await readFile(join(pkgRoot, 'package.json'), 'utf-8'));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const frameworks = FRAMEWORK_TABLE.filter(([, key]) => deps[key]).map(([name]) => name);
  return {
    language: deps['typescript'] ? 'TypeScript' : 'JavaScript',
    framework: frameworks.join(' + ') || undefined,
  };
}

/** Python requirements.txt / setup.py → 语言 + 框架 */
async function detectFromPython(root: string): Promise<{ language: string; framework?: string }> {
  const reqPath = join(root, 'requirements.txt');
  let content = '';
  if (await pathExists(reqPath)) {
    content = await readFile(reqPath, 'utf-8');
  } else if (await pathExists(join(root, 'setup.py'))) {
    content = await readFile(join(root, 'setup.py'), 'utf-8');
  }
  const lower = content.toLowerCase();
  const framework = lower.includes('fastapi') ? 'FastAPI'
    : lower.includes('django') ? 'Django'
    : lower.includes('flask') ? 'Flask'
    : undefined;
  return { language: 'Python', framework };
}

/** 扩展名统计兜底（无标记文件时），返回 Top 3 语言（含文件数） */
export async function detectByExtensions(absDir: string): Promise<string> {
  const counts = new Map<string, number>();
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8) return;
    let items;
    try { items = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (it.isDirectory()) {
        if (it.name.startsWith('.') || it.name === 'node_modules' || it.name === 'vendor') continue;
        await walk(join(dir, it.name), depth + 1);
      } else {
        const ext = extname(it.name).toLowerCase();
        if (EXT_LANG[ext]) counts.set(ext, (counts.get(ext) || 0) + 1);
      }
    }
  };
  await walk(absDir, 0);
  const langCounts = new Map<string, number>();
  for (const [ext, lang] of Object.entries(EXT_LANG)) {
    const c = counts.get(ext) || 0;
    if (c) langCounts.set(lang, (langCounts.get(lang) || 0) + c);
  }
  const top = [...langCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return top.length ? top.map(([lang, count]) => `${lang} (${count} 文件)`).join(', ') : '未知';
}

export async function detectTechStack(sources: string[]): Promise<string> {
  const projectRoot = getProjectRoot();
  const rows: string[] = [];

  for (const dir of sources) {
    const absDir = resolve(projectRoot, dir);
    const markerRoot = await findProjectMarkerRoot(absDir);

    if (!markerRoot) {
      rows.push(`| ${dir} | ${await detectByExtensions(absDir)} | — |`);
      continue;
    }

    if (await pathExists(join(markerRoot, 'package.json'))) {
      const info = await detectFromPackage(markerRoot);
      rows.push(`| ${dir} | ${info.language} | ${info.framework || '—'} |`);
    } else if (await pathExists(join(markerRoot, 'pom.xml'))) {
      const pom = await readFile(join(markerRoot, 'pom.xml'), 'utf-8');
      const framework = pom.includes('spring-cloud') ? 'Spring Cloud'
        : pom.includes('spring-boot') || pom.includes('springframework') ? 'Spring Boot'
        : undefined;
      rows.push(`| ${dir} | Java | ${framework || '—'} |`);
    } else if (await pathExists(join(markerRoot, 'go.mod'))) {
      rows.push(`| ${dir} | Go | — |`);
    } else if (await pathExists(join(markerRoot, 'requirements.txt')) || await pathExists(join(markerRoot, 'setup.py'))) {
      const info = await detectFromPython(markerRoot);
      rows.push(`| ${dir} | ${info.language} | ${info.framework || '—'} |`);
    } else if (await pathExists(join(markerRoot, 'Cargo.toml'))) {
      rows.push(`| ${dir} | Rust | — |`);
    } else if (await pathExists(join(markerRoot, 'Gemfile'))) {
      rows.push(`| ${dir} | Ruby | — |`);
    } else {
      rows.push(`| ${dir} | ${await detectByExtensions(absDir)} | — |`);
    }
  }

  return ['| 工程 | 语言 | 框架 |', '| :--- | :--- | :--- |', ...rows].join('\n');
}

// ── v8.3.369: 语义文档骨架生成器 + AI 接力闭环（体系收敛：一个概念一个生成器）──

/** 剧本扫描清单（占位从实盘文档动态派生，剧本与现实一致） */
const PLAYBOOK_DOCS = [
  'overview/ARCHITECTURE.md', 'overview/FUNCTION_MAP.md', 'overview/INTERACTION_MAP.md',
  'overview/SECURITY_AUDIT.md', 'overview/PERFORMANCE_BASELINE.md', 'overview/DATA_FLOW.md',
  'overview/DEPLOYMENT.md', 'overview/CONSISTENCY_CHECK.md',
  'overview/DATA_MODEL.md', 'overview/GLOSSARY.md', 'overview/API_CONTRACT.yaml',
];

/**
 * 4b/4c 语义文档骨架（v8.3.369）：旧状这些文档无人生成只被检查（global analyze 4b/4c 永远报缺），
 * 现并入本生成器统一铺骨架——确定性事实 + `_AI 填写` 占位，宿主 AI 按 _DOCS_PLAYBOOK.md 接力填语义。
 */
async function buildSemanticDocSkeletons(index: CodeIndex | null, _sources: string[], overviewDir: string, now: string): Promise<void> {
  // 4b: FUNCTION_MAP / API_CONTRACT.yaml（真实提取数据，非空壳）/ INTERACTION_MAP
  await safeWrite(join(overviewDir, 'FUNCTION_MAP.md'), buildFunctionMapDoc(index, now));
  await safeWrite(join(overviewDir, 'API_CONTRACT.yaml'), buildApiContractYaml(index, now));
  await safeWrite(join(overviewDir, 'INTERACTION_MAP.md'), buildInteractionMapDoc(index, now));
  // 4c: 五个扩展文档骨架
  await safeWrite(join(overviewDir, 'SECURITY_AUDIT.md'), buildSecurityAuditDoc(index, now));
  await safeWrite(join(overviewDir, 'PERFORMANCE_BASELINE.md'), buildPerformanceBaselineDoc(index, now));
  await safeWrite(join(overviewDir, 'DATA_FLOW.md'), buildDataFlowDoc(index, now));
  await safeWrite(join(overviewDir, 'DEPLOYMENT.md'), buildDeploymentDoc(index, now));
  await safeWrite(join(overviewDir, 'CONSISTENCY_CHECK.md'), buildConsistencyCheckDoc(index, now));
}

function buildFunctionMapDoc(index: CodeIndex | null, now: string): string {
  const lines = ['# 功能映射', '> 自动生成 | ' + now, ''];
  if (!index || index.modules.length === 0) {
    lines.push('> _未检测到模块，功能映射待 AI 补充_');
    return lines.join('\n');
  }
  lines.push('## 模块 → 职责（确定性盘点）', '', '| 模块 | 端 | 文件数 | 核心文件 |', '| :--- | :--- | :--- | :--- |');
  for (const m of index.modules.slice(0, 60)) {
    lines.push(`| \`${m.name}\` | \`${m.endpoint}\` | ${m.fileCount} | ${m.coreFiles.slice(0, 2).map(f => '`' + f + '`').join(', ') || '—'} |`);
  }
  lines.push('', '## 职责定义（宿主 AI 补充）', '', '> ⚠️ 每个模块的业务职责、对外能力、上下游边界由宿主 AI 完成。', '', '- _AI 填写：逐模块职责一句话描述（模块名 → 职责）');
  return lines.join('\n');
}

function buildApiContractYaml(index: CodeIndex | null, now: string): string {
  const lines = [
    '# 全局 API 契约（v8.3.369: CLI 确定性提取 + 宿主 AI 语义补全）',
    '# 生成: generateGlobalArtifacts（体系收敛：一个概念一个生成器）',
    `generated_at: ${now}`,
    'endpoints:',
  ];
  if (!index || index.files.length === 0) {
    lines.push('  # _AI 填写：未检测到接口，请按实际工程补全');
    return lines.join('\n');
  }
  // 按端聚合去重 apiDetails（"METHOD /path" 形式）
  const byEndpoint = new Map<string, Set<string>>();
  for (const f of index.files) {
    if (!f.apiDetails || f.apiDetails.length === 0) continue;
    if (!byEndpoint.has(f.endpoint)) byEndpoint.set(f.endpoint, new Set());
    for (const d of f.apiDetails) byEndpoint.get(f.endpoint)!.add(d);
  }
  let count = 0;
  for (const [ep, apis] of byEndpoint) {
    lines.push(`  ${JSON.stringify(ep)}:`);
    for (const api of [...apis].sort()) {
      const [method, ...rest] = api.split(' ');
      lines.push(`    - method: ${method || 'ANY'}`);
      lines.push(`      path: ${rest.join(' ') || '/'}`);
      lines.push('      description: _AI 填写');
      count++;
    }
  }
  if (count === 0) lines.push('  # _AI 填写：未提取到接口明细');
  return lines.join('\n');
}

function buildInteractionMapDoc(index: CodeIndex | null, now: string): string {
  const lines = ['# 交互映射', '> 自动生成 | ' + now, ''];
  if (!index || index.endpoints.length === 0) {
    lines.push('> _未检测到端，交互映射待 AI 补充_');
    return lines.join('\n');
  }
  lines.push('## 端清单（确定性）', '');
  for (const ep of index.endpoints) {
    lines.push(`- \`${ep.name}\`：${ep.fileCount} 文件 / ${index.modules.filter(m => m.endpoint === ep.name).length} 模块`);
  }
  lines.push('', '## 端间交互（宿主 AI 补充）', '', '> ⚠️ 端间调用关系（REST/消息/共享契约）与数据流方向由宿主 AI 完成。', '', '| 调用方 | 被调用方 | 协议 | 说明 |', '| :--- | :--- | :--- | :--- |', '| _AI 填写_ | _AI 填写_ | _AI 填写_ | _AI 填写_ |');
  return lines.join('\n');
}

function buildSecurityAuditDoc(index: CodeIndex | null, now: string): string {
  const lines = ['# 安全审计', '> 自动生成 | ' + now, ''];
  if (index) {
    lines.push('## 审计范围（确定性）', '', `- 端：${index.endpoints.map(e => '`' + e.name + '`').join('、') || '—'}`, `- 代码文件：${index.files.length}`, '');
  }
  lines.push('## 审计结论（宿主 AI 补充）', '', '> ⚠️ 认证/授权/输入验证/数据保护等检查由宿主 AI 完成（参考 .speccore/RULES/security.md）。', '', '| 检查项 | 现状 | 风险等级 | 建议 |', '| :--- | :--- | :--- | :--- |', '| 认证与授权 | _AI 填写_ | _AI 填写_ | _AI 填写_ |', '| 输入验证 | _AI 填写_ | _AI 填写_ | _AI 填写_ |', '| 数据保护 | _AI 填写_ | _AI 填写_ | _AI 填写_ |');
  return lines.join('\n');
}

function buildPerformanceBaselineDoc(index: CodeIndex | null, now: string): string {
  const lines = ['# 性能基线', '> 自动生成 | ' + now, ''];
  if (index) {
    lines.push('## 规模基线（确定性）', '', `- 代码文件：${index.files.length}`, `- 模块：${index.modules.length}`, `- 端：${index.endpoints.length}`, '');
  }
  lines.push('## 性能特征（宿主 AI 补充）', '', '> ⚠️ 关键路径、瓶颈预判、缓存策略由宿主 AI 完成（参考 .speccore/SKILLS/caching.md）。', '', '- _AI 填写：关键路径与性能特征', '- _AI 填写：潜在瓶颈与优化方向');
  return lines.join('\n');
}

function buildDataFlowDoc(index: CodeIndex | null, now: string): string {
  const lines = ['# 数据流', '> 自动生成 | ' + now, ''];
  if (index) {
    const dataFiles = index.files.filter(f => /entity|model|schema|migration|domain/i.test(f.path)).length;
    lines.push('## 数据持有方（确定性）', '', `- 端：${index.endpoints.map(e => '`' + e.name + '`').join('、') || '—'}`, `- 潜在数据层文件：${dataFiles}（entity/model/schema 路径）`, '');
  }
  lines.push('## 数据流向（宿主 AI 补充）', '', '> ⚠️ 端间数据流动方向、存储介质、一致性策略由宿主 AI 完成。', '', '- _AI 填写：核心数据流（产生方 → 消费方）', '- _AI 填写：存储介质与一致性策略');
  return lines.join('\n');
}

function buildDeploymentDoc(index: CodeIndex | null, now: string): string {
  const lines = ['# 部署清单', '> 自动生成 | ' + now, ''];
  if (index && index.endpoints.length > 0) {
    lines.push('## 部署单元（确定性）', '');
    for (const ep of index.endpoints) {
      lines.push(`- \`${ep.name}\`：${ep.fileCount} 文件（技术栈 ${ep.techStack || '未知'}）`);
    }
    lines.push('');
  }
  lines.push('## 部署方案（宿主 AI 补充）', '', '> ⚠️ 构建方式、运行环境、发布流程由宿主 AI 完成。', '', '- _AI 填写：各端构建与运行方式', '- _AI 填写：发布流程与环境');
  return lines.join('\n');
}

function buildConsistencyCheckDoc(index: CodeIndex | null, now: string): string {
  const lines = ['# 一致性检查', '> 自动生成 | ' + now, ''];
  if (index) {
    const apiCount = new Set(index.files.flatMap(f => f.apiDetails || [])).size;
    lines.push('## 自动核验（确定性）', '', '| 检查项 | 状态 |', '| :--- | :--- |', `| 端清单与 CODE_INDEX 对齐 | ✅ ${index.endpoints.length} 端 |`, `| 模块归属端一致 | ✅ ${index.modules.length} 模块 |`, `| API 明细去重 | ✅ ${apiCount} 条 |`, '| 时间戳备份归档（.history/） | ✅ 已启用 |', '');
  }
  lines.push('## 语义核验（宿主 AI 补充）', '', '> ⚠️ 跨文档语义一致性（架构描述 ↔ 功能映射 ↔ API 契约）由宿主 AI 完成。', '', '- _AI 填写：跨文档语义一致性结论');
  return lines.join('\n');
}

/** 扫描文档中的 `_AI 填写` 占位（按标题归组），供剧本清单动态派生 */
async function scanPlaceholders(globalDir: string, rels: string[]): Promise<{ file: string; sections: string[] }[]> {
  const result: { file: string; sections: string[] }[] = [];
  for (const rel of rels) {
    const filePath = join(globalDir, rel);
    if (!await pathExists(filePath)) continue;
    const content = await readFile(filePath, 'utf-8');
    if (rel.endsWith('.yaml') || rel.endsWith('.yml')) {
      const n = (content.match(/_AI 填写/g) || []).length;
      if (n > 0) result.push({ file: rel, sections: [`description 字段 ×${n}`] });
      continue;
    }
    const lines = content.split('\n');
    let heading = '';
    const found = new Set<string>();
    for (const line of lines) {
      const h = /^(#{2,4})\s+(.+)$/.exec(line);
      if (h) { heading = h[1] + ' ' + h[2].trim(); continue; }
      if (line.includes('_AI 填写')) found.add(heading || '（文首）');
    }
    if (found.size > 0) result.push({ file: rel, sections: [...found] });
  }
  return result;
}

/**
 * AI 接力剧本（v8.3.369）：占位清单从实盘文档动态派生（剧本与现实一致），
 * 附素材指引 + 回填契约，宿主 AI 按剧本把 `_AI 填写` 占位系统性填满。
 */
export async function buildDocsPlaybook(index: CodeIndex | null, _sources: string[], now: string): Promise<string> {
  const globalDir = join(getProjectRoot(), '.speccore', 'GLOBAL');
  const rels = [...PLAYBOOK_DOCS];
  if (index) {
    for (const ep of index.endpoints) {
      rels.push(join('platforms', sanitize(ep.name), 'OVERVIEW.md'));
      rels.push(join('platforms', sanitize(ep.name), 'TECH.md'));
    }
  }
  const placeholders = await scanPlaceholders(globalDir, rels);
  const lines = [
    '# 全局技术文档 AI 接力剧本',
    '> 自动生成 | ' + now,
    '',
    '## 背景',
    '',
    'CLI 已完成确定性提取（技术栈/代码索引/模块拓扑/API 明细/数据模型），语义层以 `_AI 填写` 占位留白。',
    '宿主 AI 按本剧本接力完成语义抽象，使这套文档从「盘点」升格为「真文档」。',
    '',
    '## 待填占位清单',
    '',
    '| # | 文档 | 待填节 |',
    '| :--- | :--- | :--- |',
  ];
  let i = 0;
  for (const p of placeholders) {
    lines.push(`| ${++i} | \`${p.file}\` | ${p.sections.map(s => '`' + s + '`').join('、')} |`);
  }
  if (i === 0) lines.push('| — | _无占位（骨架已满）_ | — |');
  lines.push(
    '',
    '## 素材指引',
    '',
    '| 场景 | 读什么 |',
    '| :--- | :--- |',
    '| 架构/分层 | `overview/CODE_INDEX.md`（模块依赖）+ 各端 `TECH.md` |',
    '| API 语义 | `overview/API_INVENTORY.md` + 源码路由文件 |',
    '| 术语定义 | `overview/GLOSSARY.md` 候选术语 + 源码符号 |',
    '| 安全/性能 | `.speccore/RULES/security.md` + 源码拦截器/缓存层 |',
    '',
    '## 回填契约（--apply）',
    '',
    '```',
    "speccore analyze --from-code --apply '<JSON>'",
    '```',
    '',
    'JSON 结构：`{"<文档相对路径>": {"<标题行原文>": "<该节完整内容（Markdown）>"}}`',
    '',
    '- 文档相对路径相对 `.speccore/GLOBAL/`（如 `"overview/ARCHITECTURE.md"`）',
    '- 标题行原文与文档中完全一致（含 `#` 前缀），内容替换到下一个同级标题前',
    '- 只写语义，不重复确定性表格',
    '- `API_CONTRACT.yaml` 用节名 `"description 字段"`，值为 `{"GET /path": "描述"}` 映射',
    '',
    '## 完成标准',
    '',
    '1. 所有 `_AI 填写` 占位被替换',
    '2. `speccore global analyze --layer 4` 的 4b/4c 检查通过',
    '3. 文档间语义一致（架构 ↔ 功能映射 ↔ API 契约）',
  );
  return lines.join('\n');
}

/** --prompt 接力 Prompt：引导宿主 AI 读剧本填占位（v8.3.369） */
export function buildGlobalDocsPrompt(): string {
  return [
    '# 任务：全局技术文档语义层接力（AI 接力闭环）',
    '',
    'CLI 已完成 `.speccore/GLOBAL/` 下的确定性技术文档（骨架 + `_AI 填写` 占位）。',
    '请宿主 AI 完成语义抽象，把骨架升格为完整技术文档。',
    '',
    '## 步骤',
    '',
    '1. 读取 `.speccore/GLOBAL/_DOCS_PLAYBOOK.md` —— 占位清单 + 素材指引',
    '2. 按清单逐一阅读占位所在文档与素材文件（CODE_INDEX/各端 TECH/源码）',
    '3. 产出回填 JSON，执行：',
    '',
    '```',
    "speccore analyze --from-code --apply '<JSON>'",
    '```',
    '',
    '## 回填 JSON 契约',
    '',
    '`{"<文档相对路径>": {"<标题行原文>": "<该节完整内容（Markdown）>"}}`',
    '',
    '- 路径相对 `.speccore/GLOBAL/`（如 `"overview/ARCHITECTURE.md"`）',
    '- 标题行必须与文档中原文完全一致（含 `#` 前缀）',
    '- 内容只写语义结论，不重复确定性数据表',
    '- `API_CONTRACT.yaml` 用节名 `"description 字段"`，值为 `{"GET /path": "描述"}` 映射',
    '',
    '## 质量要求',
    '',
    '- 语义结论必须从源码证据出发（引用模块名/文件路径）',
    '- 术语定义与 `.speccore/RULES/` 一致',
    '- 跨文档口径一致（架构分层 ↔ 功能映射 ↔ API 契约）',
  ].join('\n');
}

/** 标题定位替换：heading 标题下的内容替换为 body（到下一个同级/上级标题前），标题未命中返回 null */
export function mergeSectionIntoText(text: string, heading: string, body: string): string | null {
  const lines = text.split('\n');
  const idx = lines.findIndex(l => l.trim() === heading.trim());
  if (idx === -1) return null;
  const level = (heading.trim().match(/^#+/) || ['##'])[0].length;
  let end = idx + 1;
  while (end < lines.length) {
    const m = /^(#+)\s/.exec(lines[end]);
    if (m && m[1].length <= level) break;
    end++;
  }
  // 标题 + 空行 + 新内容 + 空行（若下一行非空） + 后续内容
  const tail = lines.slice(end);
  return [...lines.slice(0, idx + 1), '', ...body.split('\n'), ...(tail[0] === undefined || tail[0].trim() !== '' ? ['', ...tail] : tail)].join('\n');
}

/** YAML description 回填：按 "METHOD path" 或 "path" 匹配，返回替换后文本与未匹配键 */
export function fillYamlDescriptions(text: string, descMap: Record<string, string>): { text: string; filled: number; unmatched: string[] } {
  const matched = new Set<string>();
  const lines = text.split('\n');
  let currentMethod = '';
  let currentPath = '';
  const out: string[] = [];
  for (const line of lines) {
    const m = /^\s+- method: (\S+)/.exec(line);
    const p = /^\s+path: (\S+)/.exec(line);
    if (m) { currentMethod = m[1]; out.push(line); continue; }
    if (p) { currentPath = p[1]; out.push(line); continue; }
    if (/^\s+description: _AI 填写/.test(line)) {
      const byKey = Object.prototype.hasOwnProperty.call(descMap, `${currentMethod} ${currentPath}`) ? `${currentMethod} ${currentPath}` : null;
      const key = byKey || (Object.prototype.hasOwnProperty.call(descMap, currentPath) ? currentPath : null);
      if (key) {
        const indent = line.match(/^\s*/)?.[0] || '';
        out.push(`${indent}description: ${JSON.stringify(descMap[key])}`);
        matched.add(key);
        continue;
      }
    }
    out.push(line);
  }
  const unmatched = Object.keys(descMap).filter(k => !matched.has(k));
  return { text: out.join('\n'), filled: matched.size, unmatched };
}

/**
 * 语义回填（v8.3.369）：接收宿主 AI 的 JSON 内容，按「标题定位」合并进骨架文档。
 * 返回 { filled, total, missing }，missing 供宿主 AI 修正后重发。
 */
export async function applySemanticContent(content: string): Promise<{ filled: number; total: number; missing: string[] }> {
  let payload: Record<string, Record<string, unknown>>;
  try {
    payload = JSON.parse(content);
  } catch {
    throw new Error('--apply 内容必须是 JSON：{"文档相对路径": {"标题行原文": "内容"}}');
  }
  const globalDir = join(getProjectRoot(), '.speccore', 'GLOBAL');
  let filled = 0;
  let total = 0;
  const missing: string[] = [];

  for (const [rel, sections] of Object.entries(payload)) {
    if (!rel || rel.includes('..') || rel.startsWith('/')) {
      missing.push(`${rel}（非法路径）`);
      continue;
    }
    const filePath = join(globalDir, rel);
    if (!await pathExists(filePath)) {
      missing.push(`${rel}（文件不存在）`);
      continue;
    }
    let text = await readFile(filePath, 'utf-8');

    // YAML 契约：仅支持 "description 字段" 节（值 = {"METHOD /path": "描述"} 映射）
    if (rel.endsWith('.yaml') || rel.endsWith('.yml')) {
      const descMap = (sections['description 字段'] || {}) as Record<string, string>;
      const keys = Object.keys(descMap);
      total += keys.length;
      if (keys.length === 0) {
        missing.push(`${rel}（YAML 仅支持 "description 字段" 节）`);
        continue;
      }
      const r = fillYamlDescriptions(text, descMap);
      filled += r.filled;
      for (const k of r.unmatched) missing.push(`${rel} / ${k}（未匹配到 method+path）`);
      if (r.filled > 0) await writeFile(filePath, r.text);
      continue;
    }

    // Markdown：标题定位合并
    for (const [heading, body] of Object.entries(sections)) {
      total++;
      if (typeof body !== 'string') {
        missing.push(`${rel} / ${heading}（内容必须是字符串）`);
        continue;
      }
      const merged = mergeSectionIntoText(text, heading, body);
      if (merged === null) {
        missing.push(`${rel} / ${heading}（标题未命中）`);
        continue;
      }
      text = merged;
      filled++;
    }
    await writeFile(filePath, text);
  }
  return { filled, total, missing };
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '-');
}
