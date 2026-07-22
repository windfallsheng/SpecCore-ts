/**
 * code-scanner — 智能源码发现 + 范围控制
 * 
 * 策略:
 *   1. 首次: 扫描项目结构生成索引缓存 (.speccore/cache/code-structure.json)
 *   2. 分析时: 从需求提取关键词 → 匹配源码 → 只读相关文件
 *   3. 增量: 仅读取 .speccore/SETTINGS.md 中配置的目录范围
 */
import { readFile, writeFile, pathExists, ensureDir, readdir, stat } from 'fs-extra';
import { join, relative } from 'path';
import { execSync } from 'child_process';
import { logger } from '../utils/logger';
import { extractAnnotations, buildModuleGroups, matchModule, discoverProjectRoots } from './spec-annotations';

interface CodeFile {
  path: string;
  language: string;
  exports: string[];       // 导出的类/函数名
  apis: string[];          // 包含的 API 路径
  lastModified: number;
}

interface CodeIndex {
  updatedAt: string;
  files: CodeFile[];
}

const CACHE_DIR = join('.speccore', 'cache');
const INDEX_PATH = join(CACHE_DIR, 'code-structure.json');
const DEFAULT_SCOPE = ['src/', 'app/', 'lib/', 'pkg/'];

/**
 * 扫描项目目录，构建代码索引
 * scope: 扫描范围 ("src/:backend/**" 表示只扫 backend 下的 src)
 */
export async function buildCodeIndex(scope?: string): Promise<number> {
  await ensureDir(CACHE_DIR);

  const dirs = scope ? scope.split(',').map(s => s.trim()) : DEFAULT_SCOPE;
  const files: CodeFile[] = [];

  for (const dir of dirs) {
    if (!(await pathExists(dir))) continue;
    await scanDirectory(dir, dir, files);
  }

  const index: CodeIndex = {
    updatedAt: new Date().toISOString(),
    files,
  };

  await writeFile(INDEX_PATH, JSON.stringify(index, null, 2));
  return files.length;
}

async function scanDirectory(root: string, dir: string, result: CodeFile[]): Promise<void> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      // 跳过 node_modules, .git, dist
      if (entry.name.startsWith('.') && entry.name !== '.env') continue;
      if (['node_modules', 'dist', 'build', 'target', '__pycache__'].includes(entry.name)) continue;
      
      if (entry.isDirectory()) {
        // 限制深度: 5层
        const depth = fullPath.split('/').length - root.split('/').length;
        if (depth < 5) await scanDirectory(root, fullPath, result);
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
          const content = await readFile(fullPath, 'utf-8');
          const st = await stat(fullPath);
          
          // 提取导出
          const exports = extractExports(content, lang);
          // 提取 API 路径
          const apis = extractApis(content, lang);
          
          result.push({
            path: relative(process.cwd(), fullPath),
            language: lang,
            exports,
            apis,
            lastModified: st.mtimeMs,
          });
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
 * 根据需求内容查找匹配的源码文件
 */
export async function findRelevantCode(
  requirements: string,
  limit: number = 10
): Promise<{ file: string; exports: string[]; apis: string[]; score: number }[]> {
  const index = await loadIndex();
  if (!index) return [];

  const keywords = extractKeywords(requirements);
  const scored: { file: CodeFile; score: number }[] = [];

  for (const f of index.files) {
    let score = 0;
    // 文件名匹配
    for (const kw of keywords) {
      if (f.path.toLowerCase().includes(kw.toLowerCase())) score += 10;
    }
    // API 匹配
    for (const api of f.apis) {
      if (requirements.includes(api)) score += 20;
    }
    // 导出匹配
    for (const exp of f.exports) {
      for (const kw of keywords) {
        if (exp.toLowerCase().includes(kw.toLowerCase())) score += 5;
      }
    }
    if (score > 0) scored.push({ file: f, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => ({
      file: s.file.path,
      exports: s.file.exports.slice(0, 5),
      apis: s.file.apis,
      score: s.score,
    }));
}

/**
 * 读取匹配到的源码文件内容（用于分析注入）
 */
export async function readRelevantSource(
  matches: { file: string; score: number }[],
  maxBytes: number = 50000   // 最多读 50KB
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let totalBytes = 0;

  for (const m of matches.slice(0, 5)) {
    if (totalBytes >= maxBytes) break;
    try {
      const content = await readFile(m.file, 'utf-8');
      const bytes = Buffer.byteLength(content);
      if (totalBytes + bytes > maxBytes) {
        result[m.file] = content.slice(0, maxBytes - totalBytes) + '\n// ... truncated';
        break;
      }
      result[m.file] = content;
      totalBytes += bytes;
    } catch {}
  }

  return result;
}

async function loadIndex(): Promise<CodeIndex | null> {
  if (await pathExists(INDEX_PATH)) {
    return JSON.parse(await readFile(INDEX_PATH, 'utf-8'));
  }
  return null;
}

function extractKeywords(text: string): string[] {
  // 提取中文关键词（2-4字词）和英文标识符
  const keywords: string[] = [];
  const cn = text.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
  keywords.push(...cn);
  const en = text.match(/\b[a-zA-Z]{3,}\b/g) || [];
  keywords.push(...en);
  return [...new Set(keywords)].slice(0, 15);
}

/**
 * 检查索引是否过期 (超过 1 小时)
 */
export async function isIndexStale(): Promise<boolean> {
  const index = await loadIndex();
  if (!index) return true;
  const age = Date.now() - new Date(index.updatedAt).getTime();
  return age > 3600000; // 1 hour
}
