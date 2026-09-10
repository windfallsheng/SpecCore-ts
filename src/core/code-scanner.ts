/**
 * code-scanner — 智能源码发现 + 范围控制 + 多端识别
 * 
 * 策略:
 *   1. 首次: 扫描项目结构生成索引缓存 (.speccore/cache/code-structure.json)
 *   2. 分析时: 从需求提取关键词 → 匹配源码 → 只读相关文件
 *   3. 增量: 对比 lastModified 只更新变化文件
 *   4. 多端: 自动识别 frontend/backend/mobile/cli/shared 等端
 *   5. git 联动: 分析 git log 找出高频共同变更的文件组
 */
import { readFile, writeFile, pathExists, ensureDir, readdir, stat } from 'fs-extra';
import { join, relative, dirname, basename } from 'path';
import { execSync } from 'child_process';
import { logger } from '../utils/logger';
import { extractAnnotations, buildModuleGroups, matchModule, discoverProjectRoots } from './spec-annotations';
import { loadFreshKnowledgeGraph, KnowledgeGraph, getFullTaskContext } from './knowledge-graph';
import { scanCodeForSpecAnnotations } from './reverse-sync';
import { parsePlatformList } from './spec-paths';
// v8.3.125+: 同义词扩展，补充 SEMANTIC_MAP 覆盖范围
import { expandSynonyms } from '../utils/synonyms';

// ── 端名缓存（v6.48.0+）：从 CONSTITUTION.md 加载，优先于通用模式匹配 ──
let _constitutionPlatforms: string[] | null = null;
async function getConstitutionPlatforms(): Promise<string[]> {
  if (_constitutionPlatforms === null) {
    _constitutionPlatforms = await parsePlatformList();
  }
  return _constitutionPlatforms;
}

// ── 数据结构 ──

export interface CodeFile {
  path: string;
  language: string;
  exports: string[];       // 导出的类/函数名
  apis: string[];          // 包含的 API 路径
  imports: string[];       // 导入的模块路径
  lastModified: number;
  lines: number;           // 代码行数
  endpoint: string;        // 所属端: frontend/backend/mobile/cli/shared/common
  module: string;          // 所属模块（按目录分组）
}

export interface EndpointInfo {
  name: string;            // 端名称
  rootPath: string;        // 根路径
  techStack: string;       // 技术栈描述
  entryFile: string;       // 入口文件
  fileCount: number;       // 文件数量
  frameworks: string[];    // 检测到的框架
}

export interface ModuleInfo {
  name: string;            // 模块名称
  path: string;            // 模块路径
  endpoint: string;        // 所属端
  fileCount: number;       // 文件数量
  coreFiles: string[];     // 核心文件（按导出数排序 top 3）
  exports: string[];       // 对外导出汇总
  dependencies: string[];  // 依赖的其他模块
}

export interface GitCorrelation {
  files: string[];         // 共同变更的文件组
  count: number;           // 共同变更次数
  pattern: string;         // 变更模式描述
}

export interface CodeIndex {
  updatedAt: string;
  files: CodeFile[];
  endpoints: EndpointInfo[];
  modules: ModuleInfo[];
  correlations: GitCorrelation[];
  gitStats: { totalCommits: number; analyzedCommits: number };
}

const CACHE_DIR = join('.speccore', 'cache');
const INDEX_PATH = join(CACHE_DIR, 'code-structure.json');
const DEFAULT_SCOPE = ['src/', 'app/', 'lib/', 'pkg/'];

// ── 端识别规则 ──
const ENDPOINT_PATTERNS: Record<string, { patterns: string[]; techHints: Record<string, string> }> = {
  frontend: {
    patterns: ['src/web', 'src/frontend', 'src/client', 'src/ui', 'src/pages', 'src/views', 'src/components', 'web/', 'frontend/', 'app/'],
    techHints: { 'react': 'React', 'vue': 'Vue', 'angular': 'Angular', 'svelte': 'Svelte', 'next': 'Next.js', 'nuxt': 'Nuxt' },
  },
  backend: {
    patterns: ['src/server', 'src/backend', 'src/api', 'src/routes', 'src/controllers', 'src/services', 'server/', 'backend/', 'api/'],
    techHints: { 'express': 'Express', 'koa': 'Koa', 'fastify': 'Fastify', 'nestjs': 'NestJS', 'spring': 'Spring', 'gin': 'Gin' },
  },
  mobile: {
    patterns: ['src/mobile', 'src/native', 'src/app', 'ios/', 'android/', 'mobile/'],
    techHints: { 'react-native': 'React Native', 'flutter': 'Flutter', 'expo': 'Expo' },
  },
  cli: {
    patterns: ['src/cli', 'src/commands', 'src/cmd', 'bin/', 'cli/'],
    techHints: { 'commander': 'Commander', 'yargs': 'Yargs', 'cobra': 'Cobra', 'click': 'Click' },
  },
  shared: {
    patterns: ['src/shared', 'src/common', 'src/utils', 'src/lib', 'shared/', 'common/', 'lib/'],
    techHints: {},
  },
};

/**
 * 扫描项目目录，构建代码索引
 * scope: 扫描范围 ("src/:backend/**" 表示只扫 backend 下的 src)
 */
/**
 * 全量扫描构建代码索引
 */
export async function buildCodeIndex(scope?: string, incremental: boolean = false): Promise<number> {
  await ensureDir(CACHE_DIR);

  // 增量模式：加载现有索引
  let existingIndex: CodeIndex | null = null;
  if (incremental) {
    existingIndex = await loadIndex();
  }

  const dirs = scope ? scope.split(',').map(s => s.trim()) : DEFAULT_SCOPE;
  const files: CodeFile[] = existingIndex ? [...existingIndex.files] : [];
  const processedPaths = new Set(files.map(f => f.path));

  for (const dir of dirs) {
    if (!(await pathExists(dir))) continue;
    await scanDirectory(dir, dir, files, processedPaths, incremental);
  }

  // 多端识别
  const endpoints = detectEndpoints(files);
  // 模块分组
  const modules = groupModules(files, endpoints);
  // git 变更联动分析
  const { correlations, gitStats } = await analyzeGitCorrelations(files);

  const index: CodeIndex = {
    updatedAt: new Date().toISOString(),
    files,
    endpoints,
    modules,
    correlations,
    gitStats,
  };

  await writeFile(INDEX_PATH, JSON.stringify(index, null, 2));
  return files.length;
}

async function scanDirectory(
  root: string, dir: string, result: CodeFile[],
  processedPaths?: Set<string>, incremental?: boolean
): Promise<void> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      // 跳过 node_modules, .git, dist, outputs 等
      if (entry.name.startsWith('.') && entry.name !== '.env') continue;
      if (['node_modules', 'dist', 'build', 'target', '__pycache__', 'outputs', '.speccore', 'templates', 'docs', 'tests', 'examples'].includes(entry.name)) continue;
      
      if (entry.isDirectory()) {
        const depth = fullPath.split('/').length - root.split('/').length;
        if (depth < 6) await scanDirectory(root, fullPath, result, processedPaths, incremental);
      } else if (entry.isFile()) {
        const ext = entry.name.split('.').pop() || '';
        const langMap: Record<string, string> = {
          ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
          py: 'python', java: 'java', go: 'go', rs: 'rust',
          vue: 'vue', sql: 'sql', yaml: 'yaml', yml: 'yaml',
        };
        const lang = langMap[ext];
        if (!lang) continue;

        try {
          const st = await stat(fullPath);
          const relPath = relative(process.cwd(), fullPath);

          // 增量模式：跳过未修改的文件
          if (incremental && processedPaths) {
            const existing = result.find(f => f.path === relPath);
            if (existing && existing.lastModified >= st.mtimeMs) continue;
            // 文件已修改，移除旧记录
            if (existing) {
              const idx = result.indexOf(existing);
              result.splice(idx, 1);
            }
          }

          const content = await readFile(fullPath, 'utf-8');
          const exports = extractExports(content, lang);
          const apis = extractApis(content, lang);
          const imports = extractImports(content, lang);
          const lines = content.split(/\r?\n/).length;
          const endpoint = await detectEndpoint(relPath);
          const module = detectModule(relPath);

          const fileEntry: CodeFile = {
            path: relPath,
            language: lang,
            exports,
            apis,
            imports,
            lastModified: st.mtimeMs,
            lines,
            endpoint,
            module,
          };

          // 增量模式替换旧记录
          if (incremental && processedPaths) {
            processedPaths.add(relPath);
          }
          result.push(fileEntry);
        } catch {
          // 跳过二进制/不可读文件
        }
      }
    }
  } catch {
    // 跳过无权限目录
  }
}

function extractExports(content: string, lang: string): string[] {
  const results: string[] = [];
  if (lang === 'java') {
    const matches = content.match(/class\s+(\w+)/g) || [];
    for (const m of matches) {
      const name = m.replace('class ', '').trim();
      if (name && !name.startsWith('_')) results.push(name);
    }
  } else if (lang === 'typescript' || lang === 'javascript') {
    const matches = content.match(/export\s+(class|function|const|interface)\s+(\w+)/g) || [];
    for (const m of matches) {
      const name = m.replace(/export\s+(class|function|const|interface)\s+/, '').trim();
      if (name) results.push(name);
    }
  }
  return [...new Set(results)].slice(0, 20); // 最多 20 个
}

function extractApis(content: string, lang: string): string[] {
  const apis: string[] = [];
  // Java: @RequestMapping("/api/xxx") or @GetMapping("/api/xxx")
  if (lang === 'java') {
    const matches = content.match(/@\w*Mapping\s*\(\s*"(\/[^"]+)"/g) || [];
    for (const m of matches) {
      const path = m.match(/"(\/[^"]+)"/)?.[1];
      if (path) apis.push(path);
    }
  }
  // TS/JS: router.get('/api/xxx')
  if (lang === 'typescript' || lang === 'javascript') {
    const matches = content.match(/(?:router\.|app\.)(?:get|post|put|delete|patch)\s*\(\s*'(\/[^']+)'/g) || [];
    for (const m of matches) {
      const path = m.match(/'(\/[^']+)'/)?.[1];
      if (path) apis.push(path);
    }
  }
  return [...new Set(apis)];
}

/**
 * 根据需求内容查找匹配的源码文件（解耦设计：从完整索引中按 scope 筛选）
 *
 * v3 增强:
 *   - 端配额：每个 endpoint 最多占 limit 的 40%，保证多端多样性
 *   - API 契约：加载 API_CONTRACT.yaml，命中契约路径的文件加分
 *   - 知识图谱：传入 iteration/taskId 时优先加载 KG 关联的代码文件
 *   - @spec 关联：扫描代码中的 @spec 注释，命中 taskId 的文件加分
 *   - Git 联动：命中了常一起变更的文件组，联动文件也加分
 *   - 语义扩展：关键词自动扩展同义词
 */
export async function findRelevantCode(
  requirements: string,
  limit: number = 10,
  scope?: string,           // 查询时过滤：如 'src/commands,src/core'
  iteration?: string,       // 迭代名（用于加载知识图谱）
  taskId?: string,          // 任务 ID（用于 KG 关联 + @spec 扫描）
): Promise<{ file: string; exports: string[]; apis: string[]; score: number }[]> {
  const index = await loadIndex();
  if (!index) return [];

  // scope 过滤：只考虑指定目录下的文件
  const scopeDirs = scope ? scope.split(',').map(s => s.trim()).filter(Boolean) : [];
  const filesToSearch = scopeDirs.length > 0
    ? index.files.filter(f => scopeDirs.some(dir => f.path.startsWith(dir)))
    : index.files;

  // ── P0: 深度知识图谱关联 + Spec 内容引导 ──
  // v8.3.122+: 不再只获取 depends_on 任务ID，而是深度利用知识图谱的全部关联信息
  let kgTaskIds = new Set<string>();
  let specKeywords: string[] = [];              // 从 spec 文件提取的技术关键词（高权重）
  let kgSourceFilePaths = new Set<string>();    // 知识图谱中的 source-file 实体路径
  let kgCodeEntities = new Set<string>();       // business_module 的 codeEntities

  if (iteration) {
    const kg = await loadFreshKnowledgeGraph(process.cwd(), iteration);
    if (kg && taskId) {
      // 1. 当前任务直接关联 + 依赖任务
      kgTaskIds.add(taskId);
      for (const rel of kg.relations) {
        if (rel.from === taskId && rel.type === 'depends_on') {
          kgTaskIds.add(rel.to);
        }
      }

      // v8.3.122+: 深度利用知识图谱 — 获取完整任务上下文
      const fullContext = getFullTaskContext(kg, taskId);

      // 2. 从 relatedSpecs 读取内容，提取精准技术关键词
      for (const spec of fullContext.relatedSpecs) {
        if (spec.file && await pathExists(spec.file)) {
          try {
            const specContent = await readFile(spec.file, 'utf-8');
            const techKws = extractTechnicalKeywords(specContent);
            specKeywords.push(...techKws);
            logger.debug(`   📄 Spec ${spec.file} 提取 ${techKws.length} 个技术关键词`);
          } catch { /* 读取失败不阻断 */ }
        }
      }

      // 3. 从知识图谱 source-file 实体中查找关联文件
      const demandKws = extractKeywords(requirements);
      for (const entity of Object.values(kg.entities)) {
        if (entity.type === 'source-file' && entity.file) {
          // 3a. 通过平台匹配：任务的平台与该 source-file 的 endpoint 一致
          const taskPlatforms = fullContext.siblingSubtasks
            .map(st => st.platform)
            .filter(Boolean) as string[];
          if (entity.endpoint && taskPlatforms.includes(entity.endpoint)) {
            kgSourceFilePaths.add(entity.file);
          }
          // 3b. 通过语义标签匹配：semanticTags 与需求关键词匹配
          if (entity.semanticTags && entity.semanticTags.length > 0) {
            for (const tag of entity.semanticTags) {
              const tagLower = tag.toLowerCase();
              if (demandKws.some(kw => tagLower.includes(kw.toLowerCase()) || kw.toLowerCase().includes(tagLower))) {
                kgSourceFilePaths.add(entity.file);
              }
            }
          }
          // 3c. 通过 exports 匹配：导出的类/函数名出现在 spec 关键词中
          if (entity.exports && specKeywords.length > 0) {
            for (const exp of entity.exports) {
              const expLower = exp.toLowerCase();
              if (specKeywords.some(kw => expLower.includes(kw.toLowerCase()) || kw.toLowerCase().includes(expLower))) {
                kgSourceFilePaths.add(entity.file);
              }
            }
          }
        }
        // 4. 从 business_module 实体获取 codeEntities
        if (entity.type === 'business_module' && entity.codeEntities) {
          const moduleName = (entity.businessModule || entity.title || '').toLowerCase();
          if (demandKws.some(kw => moduleName.includes(kw.toLowerCase()) || kw.toLowerCase().includes(moduleName))) {
            for (const ce of entity.codeEntities) {
              kgCodeEntities.add(ce);
            }
          }
        }
      }
    }
  }

  // 去重并限制 spec 关键词数量
  specKeywords = [...new Set(specKeywords)].slice(0, 50);
  if (specKeywords.length > 0) {
    logger.debug(`   🔑 Spec 技术关键词: ${specKeywords.slice(0, 10).join(', ')}${specKeywords.length > 10 ? '...' : ''}`);
  }

  // ── P0: 扫描 @spec 注释，找到关联的代码文件 ──
  let specAnnotatedFiles = new Map<string, number>(); // filePath -> score boost
  if (taskId) {
    for (const srcDir of ['src', 'app', 'lib', 'pkg', 'packages', 'server', 'client']) {
      if (!(await pathExists(srcDir))) continue;
      try {
        const refs = await scanCodeForSpecAnnotations(srcDir);
        for (const ref of refs) {
          // 支持 Task-001 匹配 Task-001-user-login-backend-a3f2（前缀匹配）
          if (ref.taskId === taskId || ref.taskId.startsWith(taskId + '-')) {
            specAnnotatedFiles.set(ref.file, 50);
          }
          // 依赖任务的代码也加分（低一些）
          if (kgTaskIds.has(ref.taskId) || ref.taskId.startsWith([...kgTaskIds].find(t => ref.taskId.startsWith(t + '-')) || '___')) {
            const existing = specAnnotatedFiles.get(ref.file) || 0;
            specAnnotatedFiles.set(ref.file, Math.max(existing, 30));
          }
        }
      } catch { /* 扫描失败不阻断 */ }
    }
  }

  // ── L3: 加载 API 契约路径（用于加分） ──
  const contractApis = await loadContractApiPaths();

  const keywords = extractKeywords(requirements);
  const scored: { file: CodeFile; score: number }[] = [];

  for (const f of filesToSearch) {
    let score = 0;

    // P0: 知识图谱 / @spec 关联加分（最高优先级）
    const specBoost = specAnnotatedFiles.get(f.path);
    if (specBoost) {
      score += specBoost;
    }

    // v8.3.122+: 知识图谱 source-file 实体直接关联（平台/语义标签/exports 匹配）
    if (kgSourceFilePaths.has(f.path)) {
      score += 40;
    }

    // v8.3.122+: 知识图谱 business_module codeEntities 关联
    for (const ce of kgCodeEntities) {
      if (f.path.includes(ce) || basename(f.path).replace(/\.[^.]+$/, '') === ce) {
        score += 35;
        break;
      }
    }

    // 文件名匹配（精确 + 模糊）
    for (const kw of keywords) {
      if (f.path.toLowerCase().includes(kw.toLowerCase())) {
        score += 10;
      } else {
        // P3: 模糊匹配 — 关键词长度≥4 时，文件名包含其子串也加分
        if (kw.length >= 4) {
          const kwLower = kw.toLowerCase();
          // 取关键词的前 N 个字符作为模糊子串
          const fuzzyLen = Math.max(3, Math.floor(kw.length * 0.6));
          const fuzzySub = kwLower.slice(0, fuzzyLen);
          if (f.path.toLowerCase().includes(fuzzySub)) score += 3;
        }
      }
    }
    // v8.3.122+: Spec 技术关键词高权重匹配（从 TECH.md/REQ.md 等提取的精准关键词）
    for (const kw of specKeywords) {
      const kwLower = kw.toLowerCase();
      // 文件名匹配（权重 +25，比普通关键词 +10 更高）
      if (f.path.toLowerCase().includes(kwLower)) {
        score += 25;
      }
      // 导出名匹配
      for (const exp of f.exports) {
        if (exp.toLowerCase().includes(kwLower) || kwLower.includes(exp.toLowerCase())) {
          score += 20;
        }
      }
      // API 路径匹配
      for (const api of f.apis) {
        if (api.toLowerCase().includes(kwLower) || kwLower.includes(api.toLowerCase())) {
          score += 22;
        }
      }
    }

    // API 匹配
    for (const api of f.apis) {
      if (requirements.includes(api)) score += 20;
      // L3: 命中 API 契约路径额外加分
      if (contractApis.some(cp => api.includes(cp) || cp.includes(api))) {
        score += 15;
      }
    }
    // 导出匹配（精确 + 模糊）
    for (const exp of f.exports) {
      const expLower = exp.toLowerCase();
      for (const kw of keywords) {
        const kwLower = kw.toLowerCase();
        if (expLower.includes(kwLower)) {
          score += 5;
        } else if (kw.length >= 4 && expLower.includes(kwLower.slice(0, Math.max(3, Math.floor(kw.length * 0.6))))) {
          score += 2;
        }
      }
    }
    // L3: 关键词命中契约中的 API 描述也加分
    for (const cp of contractApis) {
      for (const kw of keywords) {
        if (cp.toLowerCase().includes(kw.toLowerCase())) score += 3;
      }
    }

    // P0: Git 联动加分 — 如果命中了文件 A，且 A 常和 B/C 一起改，B/C 也加分
    if (score > 0 && index.correlations) {
      for (const corr of index.correlations) {
        const filesInCorr = corr.files || [];
        if (filesInCorr.some(name => f.path.includes(name))) {
          for (const related of filesInCorr) {
            if (!f.path.includes(related)) {
              // 给相关模块的文件额外加分（在后续遍历中处理）
            }
          }
        }
      }
    }

    // P1: Import 依赖传播 — 如果 A 被命中，import A 的 B 也加分
    // P2: 模块邻近度 — 同模块文件加分
    if (score > 0) {
      // 模块邻近度：同模块文件加 3 分
      for (const other of filesToSearch) {
        if (other.path !== f.path && other.module === f.module && other.endpoint === f.endpoint) {
          // 标记：后续遍历中处理
        }
      }
    }

    if (score > 0) scored.push({ file: f, score });
  }

  // P0: Git 联动 — 给相关文件加 bonus（第二轮遍历）
  if (index.correlations && index.correlations.length > 0) {
    const topFiles = new Set(scored.slice(0, 3).map(s => s.file.path));
    const bonusScores = new Map<string, number>();
    for (const corr of index.correlations) {
      const filesInCorr = corr.files || [];
      if (filesInCorr.some(name => [...topFiles].some(tf => tf.includes(name)))) {
        for (const related of filesInCorr) {
          for (const sf of filesToSearch) {
            if (sf.path.includes(related) && !topFiles.has(sf.path)) {
              bonusScores.set(sf.path, (bonusScores.get(sf.path) || 0) + 10);
            }
          }
        }
      }
    }
    // 把 bonus 加到已评分的文件上
    for (const s of scored) {
      const bonus = bonusScores.get(s.file.path);
      if (bonus) s.score += bonus;
    }
  }

  // P1: Import 依赖传播 — 如果 A 被命中，import A 的 B 也加分
  const importBonus = new Map<string, number>();
  for (const s of scored) {
    const matchedPath = s.file.path;
    for (const other of filesToSearch) {
      if (other.path === matchedPath) continue;
      // 检查 other 是否 import 了 matchedPath
      const matchedBasename = matchedPath.replace(/\.[^.]+$/, '').replace(/.*[\/\\]/, '');
      if (other.imports.some(imp => imp.includes(matchedBasename) || imp.includes(matchedPath))) {
        importBonus.set(other.path, (importBonus.get(other.path) || 0) + 8);
      }
    }
  }
  for (const s of scored) {
    const bonus = importBonus.get(s.file.path);
    if (bonus) s.score += bonus;
  }

  // v8.3.122+: 反向 Import 传播 — 如果 A 被命中，A 所 import 的公共模块 C 也加分
  // 解决需求文档不提"拦截器/通用方法/缓存"但代码实际依赖这些模块的问题
  const SHARED_DIRS = ['shared', 'common', 'utils', 'lib', 'helpers', 'interceptors', 'middleware', 'core', 'base', 'config', 'constants', 'types', 'decorators', 'filters', 'guards', 'pipes'];
  const isSharedFile = (path: string) => SHARED_DIRS.some(dir => path.toLowerCase().includes(`/${dir}/`));

  const reverseImportBonus = new Map<string, number>();
  for (const s of scored) {
    const matchedFile = s.file;
    for (const imp of matchedFile.imports) {
      const importedBase = imp.replace(/^\.\.?\//, '').replace(/\.[^.]+$/, '');
      for (const other of filesToSearch) {
        if (other.path === matchedFile.path) continue;
        const otherBase = basename(other.path).replace(/\.[^.]+$/, '');
        const otherDirBase = basename(dirname(other.path));
        if (otherBase === importedBase || otherDirBase === importedBase || other.path.includes(imp.replace(/^\.\.?\//, ''))) {
          const bonus = isSharedFile(other.path) ? 15 : 5;
          reverseImportBonus.set(other.path, (reverseImportBonus.get(other.path) || 0) + bonus);
        }
      }
    }
  }
  for (const s of scored) {
    const bonus = reverseImportBonus.get(s.file.path);
    if (bonus) s.score += bonus;
  }

  // v8.3.122+: 高被引用公共模块主动发现 — shared/common/utils 下被 3+ 模块引用的文件自动入榜
  const referenceCount = new Map<string, number>();
  const sharedCandidates = filesToSearch.filter(f => isSharedFile(f.path));
  for (const f of filesToSearch) {
    for (const imp of f.imports) {
      const impBase = imp.replace(/^\.\.?\//, '').replace(/\.[^.]+$/, '');
      const impDirBase = impBase.includes('/') ? basename(impBase) : impBase;
      for (const sc of sharedCandidates) {
        const scBase = basename(sc.path).replace(/\.[^.]+$/, '');
        const scDirBase = basename(dirname(sc.path));
        if (scBase === impBase || scBase === impDirBase || scDirBase === impBase || sc.path.includes(imp.replace(/^\.\.?\//, ''))) {
          referenceCount.set(sc.path, (referenceCount.get(sc.path) || 0) + 1);
        }
      }
    }
  }
  for (const [path, count] of referenceCount) {
    if (count >= 3) {
      const alreadyScored = scored.some(s => s.file.path === path);
      if (!alreadyScored) {
        const fileObj = filesToSearch.find(f => f.path === path);
        if (fileObj) {
          scored.push({ file: fileObj, score: 10 + Math.min(count, 10) });
        }
      }
    }
  }

  // P2: 模块邻近度 — 同模块文件加分
  const moduleBonus = new Map<string, number>();
  const scoredModules = new Set(scored.map(s => `${s.file.endpoint}:${s.file.module}`));
  for (const f of filesToSearch) {
    const modKey = `${f.endpoint}:${f.module}`;
    if (scoredModules.has(modKey)) {
      const alreadyScored = scored.some(s => s.file.path === f.path);
      if (!alreadyScored) {
        moduleBonus.set(f.path, 3);
      }
    }
  }
  // 把模块邻近度加到已有评分文件
  for (const s of scored) {
    const bonus = moduleBonus.get(s.file.path);
    if (bonus) s.score += bonus;
  }

  // ── L2: 端配额 — 每端最多占 limit 的 40%，保证多端多样性 ──
  const endpointCap = Math.max(2, Math.ceil(limit * 0.4));
  const byEndpoint = new Map<string, typeof scored>();
  for (const s of scored) {
    const ep = s.file.endpoint || 'common';
    if (!byEndpoint.has(ep)) byEndpoint.set(ep, []);
    byEndpoint.get(ep)!.push(s);
  }
  // 每端内按分数降序
  for (const arr of byEndpoint.values()) {
    arr.sort((a, b) => b.score - a.score);
  }
  // 轮询取结果，每端每轮取一个，直到满 limit
  const result: typeof scored = [];
  const endpointCounts = new Map<string, number>();
  const sortedEndpoints = [...byEndpoint.entries()]
    .sort((a, b) => (b[1][0]?.score || 0) - (a[1][0]?.score || 0));
  let filled = 0;
  while (filled < limit) {
    let added = false;
    for (const [ep, items] of sortedEndpoints) {
      if (filled >= limit) break;
      const count = endpointCounts.get(ep) || 0;
      if (count >= endpointCap) continue;
      const idx = count;
      if (idx < items.length) {
        result.push(items[idx]);
        endpointCounts.set(ep, count + 1);
        filled++;
        added = true;
      }
    }
    if (!added) break;
  }

  return result.map(s => ({
    file: s.file.path,
    exports: s.file.exports.slice(0, 5),
    apis: s.file.apis,
    score: s.score,
  }));
}

// L3: 从项目中的 API_CONTRACT.yaml 文件加载 API 路径
// 搜索 .speccore/ 和 Iteration-xxx/Task-xxx/_shared/ 下的契约文件
async function loadContractApiPaths(): Promise<string[]> {
  const paths: string[] = [];
  try {
    const { glob } = require('glob');
    const files: string[] = await glob('.speccore/**/API_CONTRACT.yaml');
    const iterFiles: string[] = await glob('Iteration-*/**/API_CONTRACT.yaml');
    const allFiles = [...files, ...iterFiles];
    for (const f of allFiles) {
      if (!await pathExists(f)) continue;
      const content = await readFile(f, 'utf-8');
      // 提取 YAML 中的路径：  /api/xxx:  格式
      const matches = content.match(/^\s{2,4}(\/[\w/{}.-]+)\s*:/gm) || [];
      for (const m of matches) {
        const p = m.trim().replace(/:$/, '').trim();
        if (p.startsWith('/') && !paths.includes(p)) paths.push(p);
      }
    }
  } catch {}
  return paths;
}

/**
 * 读取匹配到的源码文件内容（用于分析注入）
 * v8.3.122+: 移除 matches.slice(0, 5) 硬限制，改为按 maxBytes 动态控制，
 * 让 analyze 传入的 limit 和 maxBytes 真正生效。
 */
export async function readRelevantSource(
  matches: { file: string; score: number }[],
  maxBytes: number = 50000,   // 最多读 50KB
  maxFiles?: number           // 最多读多少个文件（不传则不限制，由 maxBytes 控制）
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let totalBytes = 0;

  const filesToRead = maxFiles ? matches.slice(0, maxFiles) : matches;
  for (const m of filesToRead) {
    if (totalBytes >= maxBytes) break;
    try {
      const content = await readFile(m.file, 'utf-8');
      const bytes = Buffer.byteLength(content);
      if (totalBytes + bytes > maxBytes) {
        // 字节安全截断: 使用 Buffer 避免 UTF-8 字符中间切断
        const remaining = maxBytes - totalBytes;
        const buf = Buffer.from(content, 'utf-8');
        result[m.file] = buf.slice(0, remaining).toString('utf-8') + '\n// ... truncated';
        break;
      }
      result[m.file] = content;
      totalBytes += bytes;
    } catch {}
  }

  return result;
}

export async function loadCodeIndex(): Promise<CodeIndex | null> {
  if (await pathExists(INDEX_PATH)) {
    return JSON.parse(await readFile(INDEX_PATH, 'utf-8'));
  }
  return null;
}

// 兼容旧调用
async function loadIndex(): Promise<CodeIndex | null> {
  return loadCodeIndex();
}

/**
 * 检查代码索引新鲜度
 * 返回：{ fresh: boolean; indexAge: number; sourceAge: number; staleFiles: string[] }
 *   - fresh: 索引是否新鲜（源码无更新，或更新在索引之后）
 *   - indexAge: 索引更新时间戳
 *   - sourceAge: 源码最新修改时间戳
 *   - staleFiles: 索引后修改过的文件列表（最多10个）
 */
export async function checkCodeIndexFreshness(
  scope?: string[]
): Promise<{ fresh: boolean; indexAge: number; sourceAge: number; staleFiles: string[]; message: string }> {
  const index = await loadCodeIndex();
  const indexAge = index ? new Date(index.updatedAt).getTime() : 0;

  const dirs = scope && scope.length > 0 ? scope : DEFAULT_SCOPE;
  let sourceAge = 0;
  const staleFiles: string[] = [];

  for (const dir of dirs) {
    if (!(await pathExists(dir))) continue;
    try {
      const files = await findSourceFiles(dir);
      for (const f of files) {
        try {
          const st = await stat(f);
          if (st.mtimeMs > sourceAge) sourceAge = st.mtimeMs;
          if (indexAge > 0 && st.mtimeMs > indexAge + 60000) { // 1分钟容差
            staleFiles.push(f);
          }
        } catch {}
      }
    } catch {}
  }

  // 如果没有索引，认为不新鲜
  if (!index) {
    return {
      fresh: false,
      indexAge: 0,
      sourceAge,
      staleFiles,
      message: '代码索引不存在，请先运行: speccore code-index',
    };
  }

  // 如果源码有更新且比索引新
  const threshold = 5 * 60 * 1000; // 5分钟容差
  if (sourceAge > indexAge + threshold) {
    return {
      fresh: false,
      indexAge,
      sourceAge,
      staleFiles: staleFiles.slice(0, 10),
      message: `代码索引已过期（索引: ${new Date(indexAge).toLocaleString()}, 源码最新: ${new Date(sourceAge).toLocaleString()}），建议先运行: speccore code-index`,
    };
  }

  return {
    fresh: true,
    indexAge,
    sourceAge,
    staleFiles: [],
    message: '代码索引新鲜',
  };
}

/** 递归查找源码文件 */
async function findSourceFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const codeExts = ['.ts', '.tsx', '.js', '.jsx', '.java', '.py', '.go', '.vue', '.rb', '.php', '.cs'];

  async function scan(d: string): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'build') continue;
        await scan(p);
      } else if (codeExts.some(ext => e.name.endsWith(ext))) {
        results.push(p);
      }
    }
  }

  await scan(dir);
  return results;
}

// ── 关键词提取增强: 停用词过滤 + 语义扩展 ──

const STOP_WORDS = new Set([
  // 中文停用词
  '功能', '实现', '需要', '进行', '一个', '可以', '使用', '通过', '根据', '按照',
  '对于', '关于', '以及', '或者', '并且', '但是', '如果', '然后', '最后', '如下',
  // 英文停用词
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'are', 'was', 'were',
  'been', 'have', 'has', 'had', 'does', 'did', 'will', 'would', 'could', 'should',
  'shall', 'may', 'might', 'must', 'can', 'need', 'used', 'using', 'based',
]);

const SEMANTIC_MAP: Record<string, string[]> = {
  'login': ['auth', 'authentication', 'signin', 'session', 'credential', 'token'],
  'auth': ['login', 'authentication', 'session', 'credential', 'token', 'jwt'],
  'user': ['account', 'profile', 'member', 'person', 'customer'],
  'order': ['purchase', 'transaction', 'payment', 'cart', 'checkout'],
  'payment': ['pay', 'order', 'transaction', 'checkout', 'billing'],
  'product': ['goods', 'item', 'sku', 'spu', 'merchandise'],
  'inventory': ['stock', 'warehouse', 'storage', 'reserve'],
  'notification': ['message', 'push', 'alert', 'remind', 'notice'],
  'report': ['statistics', 'analytics', 'dashboard', 'metrics', 'chart'],
  'config': ['setting', 'configuration', 'preference', 'option'],
  'upload': ['file', 'import', 'batch', 'excel', 'csv'],
  'export': ['download', 'output', 'report', 'excel', 'csv'],
  'search': ['query', 'filter', 'find', 'lookup', 'retrieve'],
  'validate': ['verify', 'check', 'confirm', 'authentication'],
  'cache': ['redis', 'memory', 'store', 'buffer', 'ttl'],
  'queue': ['mq', 'message', 'kafka', 'rabbitmq', 'producer', 'consumer'],
  '日志': ['log', 'record', 'trace', 'audit', '监控'],
  '监控': ['monitor', 'alert', 'metric', 'observability', '日志'],
  '权限': ['auth', 'role', 'rbac', 'acl', 'access', '授权'],
  '认证': ['login', 'auth', 'sso', 'oauth', 'jwt', 'token'],
};

function expandKeywords(keywords: string[]): string[] {
  const expanded = new Set(keywords);
  for (const kw of keywords) {
    const lower = kw.toLowerCase();
    if (SEMANTIC_MAP[lower]) {
      for (const syn of SEMANTIC_MAP[lower]) {
        expanded.add(syn);
      }
    }
    // 反向查找：如果语义映射的值中包含当前词，也加入其同义词
    for (const [key, syns] of Object.entries(SEMANTIC_MAP)) {
      if (syns.includes(lower) && !expanded.has(key)) {
        expanded.add(key);
      }
    }
  }
  // v8.3.125+: 补充 SYNONYM_GROUPS 扩展（覆盖更多中英文同义词，如 "登录" ↔ "auth"）
  for (const syn of expandSynonyms(keywords)) {
    expanded.add(syn);
  }
  return [...expanded];
}

function extractKeywords(text: string): string[] {
  // 提取中文关键词（2-4字词）和英文标识符
  const keywords: string[] = [];
  const cn = text.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
  keywords.push(...cn);
  const en = text.match(/\b[a-zA-Z]{3,}\b/g) || [];
  keywords.push(...en);

  // 复合短语提取："用户管理" "订单创建" 等 2-4 字中文组合
  const cnPhrases = text.match(/[\u4e00-\u9fa5]{2,6}/g) || [];
  keywords.push(...cnPhrases);

  // CamelCase / snake_case 拆分：userService → [user, Service]
  const camelParts = text.match(/[a-z]+|[A-Z][a-z]*/g) || [];
  keywords.push(...camelParts.filter(p => p.length >= 3));

  // 停用词过滤
  const filtered = [...new Set(keywords)].filter(k => !STOP_WORDS.has(k.toLowerCase()));

  // 语义扩展
  const expanded = expandKeywords(filtered);

  return expanded.slice(0, 30);
}

/**
 * 从 Spec/Markdown 内容中提取技术关键词（类名、接口名、API路径、表名等）
 * v8.3.122+: 用于增强 findRelevantCode 的代码匹配精准度
 */
function extractTechnicalKeywords(content: string): string[] {
  const keywords: string[] = [];

  // 1. 类名/接口名/类型别名（代码块内外都找）
  const classMatches = content.match(/(?:class|interface|type|enum)\s+([A-Z][a-zA-Z0-9_]*)/g) || [];
  for (const m of classMatches) {
    const name = m.replace(/^(class|interface|type|enum)\s+/, '').trim();
    if (name && name.length >= 2) keywords.push(name);
  }

  // 2. 函数名（从代码块中提取 export function xxx）
  const funcMatches = content.match(/(?:export\s+)?(?:function|const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[=:]/g) || [];
  for (const m of funcMatches) {
    const name = m.replace(/^(?:export\s+)?(?:function|const|let|var)\s+/, '').replace(/\s*[=:]$/, '').trim();
    if (name && name.length >= 2 && !['if', 'for', 'while', 'return', 'await', 'async'].includes(name)) {
      keywords.push(name);
    }
  }

  // 3. API 路径（/api/xxx, /v1/xxx）
  const apiMatches = content.match(/['"]\s*(\/[\w/{}.-]+)\s*['"]/g) || [];
  for (const m of apiMatches) {
    const path = m.replace(/['"]/g, '').trim();
    if (path.startsWith('/') && path.length > 2) {
      keywords.push(path);
      // 也提取路径中的段
      const segments = path.split('/').filter(s => s.length >= 2 && !s.match(/^\{.*\}$/));
      keywords.push(...segments);
    }
  }

  // 4. 数据库表名（从 schema 描述中提取）
  const tableMatches = content.match(/(?:表名|table|TABLE)[:\s]+[`']?([a-zA-Z_][a-zA-Z0-9_]*)[`']?/g) || [];
  for (const m of tableMatches) {
    const name = m.replace(/(?:表名|table|TABLE)[:\s]+/, '').replace(/[`']/g, '').trim();
    if (name) keywords.push(name);
  }

  // 5. 组件名（前端 <XxxComponent />, <Xxx />）
  const componentMatches = content.match(/<([A-Z][a-zA-Z0-9]*(?:Component|Page|View|Card|Modal|Form)?)\s*\/?>/g) || [];
  for (const m of componentMatches) {
    const name = m.replace(/[<\s/>]/g, '');
    if (name && name.length >= 2) keywords.push(name);
  }

  // 6. 驼峰命名/下划线命名的复合词（通常是有意义的标识符）
  const identifierMatches = content.match(/\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/g) || [];
  for (const m of identifierMatches) {
    if (m.length >= 4) keywords.push(m);
  }

  return [...new Set(keywords)].slice(0, 50);
}

/**
 * 检查索引是否过期
 * v8.3.125+: 基于实际文件 mtime 判断 + 24h 强制刷新（捕获新增文件）
 */
export async function isIndexStale(scope?: string): Promise<boolean> {
  const index = await loadIndex();
  if (!index) return true;

  // 24 小时强制刷新（捕获新增文件）
  const age = Date.now() - new Date(index.updatedAt).getTime();
  if (age > 86400000) return true;

  // 检查已有文件是否被修改或删除（最多检查 300 个，避免大量 stat）
  const checkLimit = Math.min(index.files.length, 300);
  for (let i = 0; i < checkLimit; i++) {
    const file = index.files[i];
    try {
      const fullPath = join(process.cwd(), file.path);
      if (!(await pathExists(fullPath))) return true;
      const st = await stat(fullPath);
      if (st.mtimeMs > file.lastModified + 1000) return true;
    } catch {
      return true;
    }
  }

  // 采样检查是否有新增文件：对比 scope 下文件数
  const dirs = scope ? scope.split(',').map(s => s.trim()) : DEFAULT_SCOPE;
  for (const dir of dirs.slice(0, 3)) {
    if (!(await pathExists(dir))) continue;
    try {
      let count = 0;
      await quickCountSourceFiles(dir, 0, (n: number) => { count = n; });
      const indexedCount = index.files.filter(f =>
        f.path.startsWith(dir.replace(/\/$/, ''))
      ).length;
      if (count > indexedCount + 5) return true;
    } catch { /* 跳过 */ }
  }

  return false;
}

/** 快速统计目录下源码文件数（不深入解析） */
async function quickCountSourceFiles(
  dir: string, depth: number, cb: (n: number) => void
): Promise<void> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    let count = 0;
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.env') continue;
      if (['node_modules', 'dist', 'build', 'target', '__pycache__', 'outputs', '.speccore', 'templates', 'docs', 'tests', 'examples'].includes(e.name)) continue;
      if (e.isDirectory() && depth < 4) {
        await quickCountSourceFiles(join(dir, e.name), depth + 1, (n: number) => { count += n; });
      } else if (e.isFile()) {
        const ext = e.name.split('.').pop() || '';
        if (['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'go', 'rs', 'vue', 'sql', 'yaml', 'yml'].includes(ext)) {
          count++;
        }
      }
    }
    cb(count);
  } catch { /* 跳过 */ }
}

/**
 * 加载完整索引（含端、模块、联动）
 */
export async function loadFullIndex(): Promise<CodeIndex | null> {
  return loadIndex();
}

/**
 * v8.3.125+: 根据迭代名解析涉及的源码路径 scope
 * 读取 PLATFORMS.md / 020-specs/ 子目录推断端名，匹配 CONSTITUTION.md 中的源码路径
 */
export async function resolveIterationScope(iteration?: string): Promise<string | undefined> {
  if (!iteration) return undefined;

  try {
    const { getIterationDir } = await import('../core/context');
    const { logger: log } = await import('../utils/logger');
    const iterDir = await getIterationDir(iteration);
    if (!(await pathExists(iterDir))) return undefined;

    // 读取 CONSTITUTION.md 获取源码路径
    const constitutionPath = join(process.cwd(), '.speccore', 'CONSTITUTION.md');
    let sourcePaths: string[] = ['src'];
    if (await pathExists(constitutionPath)) {
      const content = await readFile(constitutionPath, 'utf-8');
      const match = content.match(/源码路径[\s\S]*?\n\s*-\s*`?([^`\n]+)`?/g);
      if (match) {
        sourcePaths = match.map(m => m.replace(/.*-\s*`?/, '').replace(/`?$/, '').trim()).filter(Boolean);
      }
    }
    if (sourcePaths.length <= 1) return undefined;

    // 1. 尝试从 PLATFORMS.md 读取端列表
    let platformNames: string[] = [];
    const platformsPath = join(iterDir, '020-specs', 'PLATFORMS.md');
    if (await pathExists(platformsPath)) {
      const pContent = await readFile(platformsPath, 'utf-8');
      const pMatch = pContent.match(/-\s*(\w+)/g);
      if (pMatch) platformNames = pMatch.map(m => m.replace(/^-\s*/, '').trim().toLowerCase());
    }
    // 2. fallback：从 020-specs/ 子目录推断端名
    if (platformNames.length === 0) {
      const specsDir = join(iterDir, '020-specs');
      if (await pathExists(specsDir)) {
        const entries = await readdir(specsDir, { withFileTypes: true });
        platformNames = entries
          .filter(e => e.isDirectory() && e.name !== 'overview' && e.name !== 'requirements')
          .map(e => e.name.toLowerCase());
      }
    }
    // 3. 筛选 sourcePaths
    if (platformNames.length > 0) {
      const matched = sourcePaths.filter(sp => {
        const lower = sp.toLowerCase();
        return platformNames.some(pn => lower.includes(pn));
      });
      // 保留 shared/common/lib 等公共路径
      const sharedPaths = sourcePaths.filter(sp => /shared|common|lib|utils|pkg/.test(sp.toLowerCase()));
      const combined = [...new Set([...matched, ...sharedPaths])];
      if (combined.length > 0) {
        log?.info?.(`   📂 代码索引按端筛选: ${combined.join(', ')}（涉及端: ${platformNames.join(', ')}）`);
        return combined.join(',');
      }
    }
  } catch {
    // 筛选失败不阻断
  }
  return undefined;
}

// ── 端识别 ──

async function detectEndpoint(filePath: string): Promise<string> {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  // v6.48.0+：优先匹配 CONSTITUTION.md 端列表中的端名
  const platforms = await getConstitutionPlatforms();
  for (const platform of platforms) {
    if (normalized.includes(platform.toLowerCase())) return platform;
  }
  // 回退：通用模式匹配
  for (const [endpoint, config] of Object.entries(ENDPOINT_PATTERNS)) {
    for (const pattern of config.patterns) {
      if (normalized.includes(pattern.toLowerCase())) return endpoint;
    }
  }
  return 'common';
}

function detectModule(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  // 找到 src/ 之后的第一层目录作为模块名
  const srcIdx = parts.findIndex(p => ['src', 'app', 'lib', 'pkg'].includes(p));
  if (srcIdx >= 0 && srcIdx + 1 < parts.length) {
    return parts[srcIdx + 1];
  }
  // 没有 src 则取第一层目录
  return parts[0] || 'root';
}

function detectEndpoints(files: CodeFile[]): EndpointInfo[] {
  const endpointMap = new Map<string, CodeFile[]>();
  for (const f of files) {
    const ep = f.endpoint;
    if (!endpointMap.has(ep)) endpointMap.set(ep, []);
    endpointMap.get(ep)!.push(f);
  }

  const result: EndpointInfo[] = [];
  for (const [name, epFiles] of endpointMap) {
    if (epFiles.length === 0) continue;
    // 检测技术栈
    const frameworks: string[] = [];
    const patterns = ENDPOINT_PATTERNS[name];
    if (patterns) {
      for (const [hint, label] of Object.entries(patterns.techHints)) {
        if (epFiles.some(f => f.imports.some(i => i.includes(hint)) || f.path.includes(hint))) {
          frameworks.push(label);
        }
      }
    }
    // 入口文件猜测
    const entryCandidates = epFiles.filter(f =>
      f.path.includes('index.') || f.path.includes('main.') || f.path.includes('app.')
    );
    const entryFile = entryCandidates.length > 0 ? entryCandidates[0].path : (epFiles[0]?.path || '');
    // 根路径
    const paths = epFiles.map(f => f.path.split('/'));
    const rootParts: string[] = [];
    if (paths.length > 0) {
      const minLen = Math.min(...paths.map(p => p.length));
      for (let i = 0; i < minLen - 1; i++) {
        const vals = new Set(paths.map(p => p[i]));
        if (vals.size === 1) rootParts.push(paths[0][i]);
        else break;
      }
    }
    const techStack = frameworks.length > 0 ? frameworks.join(' + ') : (epFiles[0]?.language || 'unknown');

    result.push({
      name,
      rootPath: rootParts.join('/') || '.',
      techStack,
      entryFile,
      fileCount: epFiles.length,
      frameworks,
    });
  }

  return result.sort((a, b) => b.fileCount - a.fileCount);
}

// ── 模块分组 ──

function groupModules(files: CodeFile[], endpoints: EndpointInfo[]): ModuleInfo[] {
  const moduleMap = new Map<string, CodeFile[]>();
  for (const f of files) {
    const key = `${f.endpoint}:${f.module}`;
    if (!moduleMap.has(key)) moduleMap.set(key, []);
    moduleMap.get(key)!.push(f);
  }

  const result: ModuleInfo[] = [];
  for (const [key, modFiles] of moduleMap) {
    if (modFiles.length === 0) continue;
    const [endpoint, moduleName] = key.split(':');
    // 核心文件：按导出数排序 top 3
    const sorted = [...modFiles].sort((a, b) => b.exports.length - a.exports.length);
    const coreFiles = sorted.slice(0, 3).map(f => f.path);
    // 所有导出
    const allExports = [...new Set(modFiles.flatMap(f => f.exports))].slice(0, 30);
    // 依赖分析：看 import 指向哪些其他模块
    const deps = new Set<string>();
    for (const f of modFiles) {
      for (const imp of f.imports) {
        const target = files.find(tf => tf.path.includes(imp.replace(/^\.\.?\//, '')) || imp.includes(basename(tf.path, '.ts')));
        if (target && target.module !== moduleName) {
          deps.add(target.module);
        }
      }
    }
    const commonPath = modFiles.map(f => f.path).reduce((a, b) => {
      const pa = a.split('/'), pb = b.split('/');
      const common: string[] = [];
      for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
        if (pa[i] === pb[i]) common.push(pa[i]); else break;
      }
      return common.join('/');
    });

    result.push({
      name: moduleName,
      path: commonPath || modFiles[0].path,
      endpoint,
      fileCount: modFiles.length,
      coreFiles,
      exports: allExports,
      dependencies: [...deps].slice(0, 10),
    });
  }

  return result.sort((a, b) => b.fileCount - a.fileCount);
}

// ── git 变更联动分析 ──

async function analyzeGitCorrelations(files: CodeFile[]): Promise<{
  correlations: GitCorrelation[];
  gitStats: { totalCommits: number; analyzedCommits: number };
}> {
  const correlations: GitCorrelation[] = [];
  let totalCommits = 0;
  let analyzedCommits = 0;

  try {
    // 取最近 100 次提交的变更文件
    const gitLog = execSync(
      'git log --name-only --pretty=format:"---COMMIT---" -100',
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 15000 }
    );

    // 解析每个 commit 的文件列表
    const commitFiles: string[][] = [];
    let current: string[] = [];
    for (const line of gitLog.split(/\r?\n/)) {
      if (line === '---COMMIT---') {
        if (current.length > 0) commitFiles.push(current);
        current = [];
      } else if (line.trim()) {
        current.push(line.trim());
      }
    }
    if (current.length > 0) commitFiles.push(current);

    totalCommits = commitFiles.length;
    analyzedCommits = Math.min(totalCommits, 100);

    // 统计文件对共同出现次数
    const pairCount = new Map<string, number>();
    for (const cf of commitFiles) {
      // 只关注已索引的文件
      const indexed = cf.filter(f => files.some(idx => idx.path === f));
      if (indexed.length < 2 || indexed.length > 10) continue;
      // 按模块分组
      const modules = [...new Set(indexed.map(f => {
        const idx = files.find(fi => fi.path === f);
        return idx ? idx.module : '';
      }))].filter(Boolean);
      if (modules.length >= 2) {
        const key = modules.sort().join(' ↔ ');
        pairCount.set(key, (pairCount.get(key) || 0) + 1);
      }
    }

    // 取 top 10 高频联动
    const sorted = [...pairCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    for (const [pattern, count] of sorted) {
      if (count >= 2) {
        correlations.push({
          files: pattern.split(' ↔ '),
          count,
          pattern: `改 ${pattern.split(' ↔ ')[0]} → ${Math.round(count / analyzedCommits * 100)}% 概率联动 ${pattern.split(' ↔ ')[1]}`,
        });
      }
    }
  } catch {
    // git 不可用时跳过
  }

  return { correlations, gitStats: { totalCommits, analyzedCommits } };
}

// ── 导入提取 ──

function extractImports(content: string, lang: string): string[] {
  const imports: string[] = [];
  if (lang === 'typescript' || lang === 'javascript') {
    // import ... from 'xxx'
    const matches = content.match(/import\s+.*?from\s+['"]([^'"]+)['"]/g) || [];
    for (const m of matches) {
      const path = m.match(/['"]([^'"]+)['"]/)?.[1];
      if (path) imports.push(path);
    }
    // require('xxx')
    const reqMatches = content.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g) || [];
    for (const m of reqMatches) {
      const path = m.match(/['"]([^'"]+)['"]/)?.[1];
      if (path) imports.push(path);
    }
  } else if (lang === 'python') {
    const matches = content.match(/(?:import|from)\s+(\S+)/g) || [];
    for (const m of matches) {
      const mod = m.replace(/^(?:import|from)\s+/, '');
      if (mod) imports.push(mod);
    }
  } else if (lang === 'java') {
    const matches = content.match(/import\s+([\w.]+);/g) || [];
    for (const m of matches) {
      imports.push(m.replace('import ', '').replace(';', ''));
    }
  } else if (lang === 'go') {
    const matches = content.match(/"([\w./]+)"/g) || [];
    for (const m of matches) {
      imports.push(m.replace(/"/g, ''));
    }
  }
  return [...new Set(imports)].slice(0, 30);
}
