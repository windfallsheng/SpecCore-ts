/**
 * multi-lang-parser.ts — 多语言 AST 解析（tree-sitter WASM）
 *
 * 替代 code-scanner.ts 中脆弱的正则提取（extractExports/extractApis/extractImports）。
 * 用 tree-sitter 精确解析 Java / Go / Python / Rust，其余语言回退正则。
 *
 * 设计：
 *   - 零 LLM Token，代码不出本机
 *   - 惰性初始化：首次调用才加载 WASM 引擎 + 语法
 *   - 语法 .wasm 随包发布（vendor/tree-sitter/），不依赖远程服务
 *   - 单语言加载失败（如 rust 未 vendor）自动降级正则，不影响主流程
 *
 * 覆盖：
 *   java / go / python / rust → tree-sitter
 *   vue                       → 抽取 <script> 块后按 js 正则处理
 *   typescript / javascript   → 保留正则（code-graph/parser.ts 已有 Compiler API 精确解析）
 */

import { join } from 'path';
import { existsSync } from 'fs';

// ── 语言 → wasm 语法文件映射 ──
const LANG_WASM: Record<string, string> = {
  java: 'tree-sitter-java.wasm',
  go: 'tree-sitter-go.wasm',
  python: 'tree-sitter-python.wasm',
  rust: 'tree-sitter-rust.wasm',
};

// ── 惰性初始化状态 ──
let ParserCtor: any = null;
let initPromise: Promise<void> | null = null;
const parserCache = new Map<string, any>();

/** 定位 vendor 目录（兼容 dev 仓库根 与 published 包根） */
function vendorDir(): string {
  // dist/core/ 下的 __dirname → 上溯到包根
  return join(__dirname, '..', '..', 'vendor', 'tree-sitter');
}

async function ensureParser(): Promise<any> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    // web-tree-sitter@0.20.8 CJS：module.exports 即 Parser 类
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ParserCtor = require('web-tree-sitter');
    await ParserCtor.init();
  })();
  return initPromise;
}

/** 获取某语言的 parser（失败返回 null，供调用方降级正则） */
async function getParser(lang: string): Promise<any | null> {
  if (!LANG_WASM[lang]) return null;
  if (parserCache.has(lang)) return parserCache.get(lang);

  const wasmPath = join(vendorDir(), LANG_WASM[lang]);
  if (!existsSync(wasmPath)) return null;

  try {
    await ensureParser();
    const Language = await ParserCtor.Language.load(wasmPath);
    const parser = new ParserCtor();
    parser.setLanguage(Language);
    parserCache.set(lang, parser);
    return parser;
  } catch {
    return null; // 语法加载失败 → 降级
  }
}

// ─────────────────────────────────────────────────────────────
// 提取结果
// ─────────────────────────────────────────────────────────────

export interface ExtractedCode {
  exports: string[];
  apis: string[];          // 仅 path（兼容下游契约按 path 匹配）
  apiDetails: string[];    // "GET /path" 形式，保留 HTTP 方法
  imports: string[];
}

/** 判断某语言是否走 tree-sitter */
export function isTreeSitterLang(lang: string): boolean {
  return lang in LANG_WASM;
}

/**
 * 用 tree-sitter 精确提取 imports / exports / apis。
 * 不支持的 lang 返回 null，由调用方回退正则。
 */
export async function extractWithTreeSitter(content: string, lang: string): Promise<ExtractedCode | null> {
  const parser = await getParser(lang);
  if (!parser) return null;

  try {
    const tree = parser.parse(content);
    const root = tree.rootNode;
    const exportsSet = new Set<string>();
    const importsSet = new Set<string>();
    const apisSet = new Set<string>();
    const apiDetailsSet = new Set<string>();

    walk(root, content, lang, exportsSet, importsSet, apisSet, apiDetailsSet);

    return {
      exports: [...exportsSet].slice(0, 20),
      apis: [...apisSet],
      apiDetails: [...apiDetailsSet],
      imports: [...importsSet].slice(0, 30),
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 通用遍历
// ─────────────────────────────────────────────────────────────

function walk(
  node: any,
  src: string,
  lang: string,
  exportsSet: Set<string>,
  importsSet: Set<string>,
  apisSet: Set<string>,
  apiDetailsSet: Set<string>,
): void {
  const t: string = node.type;

  collectExport(t, node, src, lang, exportsSet);
  collectImport(t, node, src, lang, importsSet);
  collectApi(t, node, src, lang, apisSet, apiDetailsSet);

  for (let i = 0; i < node.childCount; i++) {
    walk(node.child(i), src, lang, exportsSet, importsSet, apisSet, apiDetailsSet);
  }
}

/** 从节点文本中取名字（首个 identifier 类子节点） */
function nameOf(node: any): string {
  for (const c of node.namedChildren || []) {
    if (['identifier', 'type_identifier', 'field_identifier', 'constant'].includes(c.type)) {
      return c.text;
    }
  }
  return '';
}

function collectExport(t: string, node: any, src: string, lang: string, out: Set<string>): void {
  let name = '';
  if (lang === 'java' && ['class_declaration', 'interface_declaration', 'enum_declaration'].includes(t)) {
    name = nameOf(node);
  } else if (lang === 'go' && t === 'type_declaration') {
    // type_declaration 含 type_spec，取其 type_identifier
    for (const c of node.namedChildren || []) {
      if (c.type === 'type_spec') { name = nameOf(c); break; }
    }
  } else if (lang === 'go' && (t === 'function_declaration' || t === 'method_declaration')) {
    name = nameOf(node);
    if (name && name[0] !== name[0].toUpperCase()) name = ''; // 仅导出（首字母大写）
  } else if (lang === 'python' && ['class_definition', 'function_definition'].includes(t)) {
    name = nameOf(node);
  } else if (lang === 'rust' && ['struct_item', 'enum_item', 'trait_item', 'function_item', 'impl_item'].includes(t)) {
    name = nameOf(node);
  }
  if (name && !name.startsWith('_')) out.add(name);
}

function collectImport(t: string, node: any, src: string, lang: string, out: Set<string>): void {
  if (lang === 'java' && t === 'import_declaration') {
    // 去掉 import 与 ; 和 .* 通配
    const txt = src.slice(node.startIndex, node.endIndex).replace(/^import\s+/, '').replace(/;\s*$/, '').trim();
    if (txt) out.add(txt);
  } else if (lang === 'go' && t === 'import_spec') {
    const txt = src.slice(node.startIndex, node.endIndex).replace(/["`]/g, '').trim();
    if (txt && !txt.includes('(')) out.add(txt);
  } else if (lang === 'python' && t === 'import_statement') {
    // import a.b.c
    for (const c of node.namedChildren || []) {
      if (c.type === 'dotted_name') { out.add(c.text); break; }
    }
  } else if (lang === 'python' && t === 'import_from_statement') {
    // from X import Y → 提取模块 X（而非符号 Y），避免把 Y 误当依赖
    const txt = src.slice(node.startIndex, node.endIndex);
    const m = txt.match(/^from\s+([\w.]+)\s+import\b/);
    if (m) out.add(m[1]);
  } else if (lang === 'rust' && t === 'use_declaration') {
    const txt = src.slice(node.startIndex, node.endIndex).replace(/^use\s+/, '').replace(/;\s*$/, '').trim();
    if (txt) out.add(txt.split('::')[0]);
  }
}

function collectApi(t: string, node: any, src: string, lang: string, out: Set<string>, detailOut: Set<string>): void {
  if (lang === 'java' && t === 'annotation') {
    const txt = src.slice(node.startIndex, node.endIndex);
    // @GetMapping("/path") / @RequestMapping("/path") / @RequestMapping(value="/path", method=POST)
    const m = txt.match(/@(Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?"(\/[^"]*)"/);
    if (m) {
      out.add(m[2]);
      const method = m[1] === 'Request' ? 'ANY' : m[1].toUpperCase();
      detailOut.add(`${method} ${m[2]}`);
    }
  } else if (lang === 'python' && t === 'decorated_definition') {
    const txt = src.slice(node.startIndex, node.endIndex);
    const m = txt.match(/(?:router|app)\.(get|post|put|delete|patch|route)\s*\(\s*["'](\/[^"']*)["']/);
    if (m) {
      out.add(m[2]);
      detailOut.add(`${m[1].toUpperCase()} ${m[2]}`);
    }
  } else if (lang === 'go' && t === 'call_expression') {
    const txt = src.slice(node.startIndex, node.endIndex);
    const m = txt.match(/\.(GET|POST|PUT|DELETE|PATCH)\s*\(\s*"(\/[^"]*)"/);
    if (m) {
      out.add(m[2]);
      detailOut.add(`${m[1]} ${m[2]}`);
    }
  }
  // rust: actix 的 #[get("/path")] 少见，暂不处理
}

// ─────────────────────────────────────────────────────────────
// 结构化摘要（替代 analyze 里的 slice(0,N) 硬切原文）
// ─────────────────────────────────────────────────────────────

/**
 * 用 tree-sitter 生成「结构化摘要」——只保留 imports / 符号 / 接口，
 * 丢弃方法体，作为注入 AI 上下文的轻量替代，避免原文被按字符腰斩。
 * 不支持的 lang 返回 null，调用方回退原文截断。
 */
export async function summarizeCode(content: string, lang: string): Promise<string | null> {
  const ext = await extractWithTreeSitter(content, lang);
  if (!ext) return null;
  const lines: string[] = [];
  const lineCount = content.split(/\r?\n/).length;
  lines.push(`# ${lang} · ${lineCount} 行`);
  if (ext.imports.length) lines.push(`imports: ${ext.imports.slice(0, 15).join(', ')}`);
  if (ext.exports.length) lines.push(`symbols: ${ext.exports.join(', ')}`);
  if (ext.apiDetails.length) lines.push(`apis: ${ext.apiDetails.join(', ')}`);
  return lines.join('\n');
}

/**
 * 批量生成结构化摘要：path→content 映射 → path→summary 映射。
 * 只覆盖 tree-sitter 语言（java/go/python/rust），其余跳过（返回不含该 path）。
 */
export async function summarizeSources(contents: Record<string, string>): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [path, content] of Object.entries(contents)) {
    const lang = langFromPath(path);
    if (!lang) continue;
    const summary = await summarizeCode(content, lang);
    if (summary) result[path] = summary;
  }
  return result;
}

function langFromPath(path: string): string {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const map: Record<string, string> = { java: 'java', go: 'go', py: 'python', rs: 'rust' };
  return map[ext] || '';
}

// ─────────────────────────────────────────────────────────────
// vue：抽取 <script> 块（供调用方按 js 处理）
// ─────────────────────────────────────────────────────────────

export function extractVueScript(content: string): string {
  const m = content.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
  return m ? m[1] : '';
}
