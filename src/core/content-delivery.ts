/**
 * content-delivery.ts — 统一内容供给管线（Content Delivery Pipeline）
 *
 * 目标：收敛所有"组装内容给 AI"的散点逻辑（prompt-builder / ai-context-generator /
 *      analyze-engine / rag-engine / agent-adapter），提供唯一入口。
 *
 * 核心：四层递进供给 + 能力探测 + 相关性分级 + 预算裁剪
 *   L0 引用索引    类型 + 名称 + 一句话 + 路径        ~30字/个   永远给
 *   L1 结构化摘要  符号签名/小节清单/HTML文本/图片描述 ~200-500字/个  默认给
 *   L2 按需原文    宿主有读文件工具时，给读取提示       路径        按能力给
 *   L3 视觉产物    截图/图片路径                       路径        多模态时给
 *
 * 设计原则：L0+L1 是确定性兜底（CLI 产出，保证不遗漏）；L2+L3 按宿主能力增强。
 *
 * 本文件是「骨架」：自包含、可独立测试，尚未接入现有调用点。
 * 后续 prompt-builder / analyze-engine / rag-engine 的散点逻辑应逐步路由到这里。
 */

import { pathExists, readFile, stat } from 'fs-extra';
import { join } from 'path';
import { renderHtmlPrototype } from './html-prototype';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

/** 内容类型 */
export type ContentType = 'md' | 'code' | 'image' | 'html' | 'yaml' | 'json' | 'external';

/** 相关性分级 */
export type Relevance = 'core' | 'related' | 'peripheral';

/** 宿主 AI 能力（由 ask-host-ai / agent-adapter 探测后传入） */
export interface HostCapabilities {
  multimodal: boolean;   // 多模态（能直接看图）
  readFile: boolean;     // 有读文件工具
  readImage: boolean;    // 有读图工具
  browse: boolean;       // 有浏览器/打开 HTML 工具
}

/** 单个待供给的内容项 */
export interface ContentItem {
  type: ContentType;
  /** 本地路径或 URL */
  path: string;
  /** 名称 / 一句话摘要 */
  title?: string;
  relevance: Relevance;
  /** 原始内容（调用方已读入时可传，避免管线重复 readFile） */
  content?: string;
}

/** 内容供给请求 */
export interface ContentRequest {
  items: ContentItem[];
  scope: string;               // analyze | execute | ask | review ...
  budget: number;              // 总字符预算（L0+L1 合计）
  host: HostCapabilities;
}

/** 统一产出 */
export interface ContentBundle {
  index: string;               // L0 引用索引
  summaries: string;           // L1 结构化摘要
  onDemandHints: string;       // L2 按需读取提示
  visuals: string[];           // L3 视觉产物路径（多模态时）
  externalLinks: string[];     // 外链清单（无法本地获取的）
  totalChars: number;
}

// ═══════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════

export async function deliverContent(req: ContentRequest): Promise<ContentBundle> {
  // 1. 相关性排序（core 优先，peripheral 最后被裁剪）
  const order = { core: 0, related: 1, peripheral: 2 } as const;
  const items = [...req.items].sort((a, b) => order[a.relevance] - order[b.relevance]);

  // 2. 逐层供给
  const indexLines: string[] = [];
  const summaryLines: string[] = [];
  const hintLines: string[] = [];
  const visuals: string[] = [];
  const externalLinks: string[] = [];

  let usedChars = 0;

  for (const item of items) {
    // ── L0：引用索引（永远给，极小）──
    const idxLine = `- [${typeLabel(item.type)}] ${item.title || item.path} \`${item.path}\``;
    indexLines.push(idxLine);
    usedChars += idxLine.length;

    // ── 外链：无法本地获取，只进清单 ──
    if (item.type === 'external') {
      externalLinks.push(item.path);
      continue;
    }

    // ── 视觉：多模态时直接给路径 ──
    if (item.type === 'image' && req.host.multimodal) {
      visuals.push(item.path);
    }

    // ── L1：结构化摘要（默认给）──
    const remaining = req.budget - usedChars;
    if (remaining <= 200) break; // 预算耗尽，停止 L1

    // HTML 原型：Playwright 截图（多模态视觉）+ accessibility tree（纯文本语义）
    if (item.type === 'html') {
      const proto = await renderHtmlPrototype(item.path);
      if (proto) {
        if (proto.screenshotPath) visuals.push(proto.screenshotPath);
        const tree = proto.accessibilityTree;
        if (tree) {
          summaryLines.push(`\n### ${item.title || item.path}（页面结构）\n${clip(tree, Math.min(500, remaining))}`);
          usedChars += tree.length;
        }
      }
      if (req.host.readFile) hintLines.push(`- 如需交互细节，打开 \`${item.path}\``);
      continue;
    }

    const summary = await summarizeItem(item, Math.min(500, remaining));
    if (summary) {
      summaryLines.push(`\n### ${item.title || item.path}\n${summary}`);
      usedChars += summary.length;
    }

    // ── L2：按需读取提示（宿主有读文件工具时给）──
    if (req.host.readFile && item.type !== 'image') {
      hintLines.push(`- 如需细节，读取 \`${item.path}\``);
    }
  }

  return {
    index: indexLines.join('\n'),
    summaries: summaryLines.join('\n'),
    onDemandHints: hintLines.length ? `\n## 按需读取\n${hintLines.join('\n')}` : '',
    visuals,
    externalLinks,
    totalChars: usedChars,
  };
}

// ═══════════════════════════════════════════════════════════
// 逐类型 L1 摘要
// ═══════════════════════════════════════════════════════════

async function summarizeItem(item: ContentItem, maxChars: number): Promise<string | null> {
  switch (item.type) {
    case 'code': {
      // 复用 tree-sitter 结构化摘要（签名+符号+接口）
      const lang = langFromPath(item.path);
      if (!lang) return null;
      const content = item.content || (await safeRead(item.path));
      if (!content) return null;
      const { summarizeCode } = await import('./multi-lang-parser');
      const s = await summarizeCode(content, lang);
      return s ? clip(s, maxChars) : null;
    }
    case 'md': {
      const content = item.content || (await safeRead(item.path));
      if (!content) return null;
      return clip(extractMdOutline(content), maxChars);
    }
    case 'image': {
      // 无视觉模型时，用 alt/title 兜底（真正的视觉描述由 vision-engine 单独调用）
      return item.title ? `图片：${item.title}` : null;
    }
    case 'yaml':
    case 'json': {
      const content = item.content || (await safeRead(item.path));
      if (!content) return null;
      return clip(content, maxChars);
    }
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════
// 工具
// ═══════════════════════════════════════════════════════════

function typeLabel(t: ContentType): string {
  const map: Record<ContentType, string> = {
    md: '文档', code: '代码', image: '图片', html: '原型',
    yaml: '配置', json: '数据', external: '外链',
  };
  return map[t] || t;
}

function langFromPath(path: string): string {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const map: Record<string, string> = { java: 'java', go: 'go', py: 'python', rs: 'rust' };
  return map[ext] || '';
}

/** 提取 Markdown 大纲：标题层级 + 每节首句，作为 L1 摘要 */
export function extractMdOutline(content: string): string {
  const lines = content.split(/\r?\n/);
  const outline: string[] = [];
  let headingCount = 0;
  for (const line of lines) {
    const m = line.match(/^(#{1,4})\s+(.+)$/);
    if (m) {
      if (headingCount >= 30) break; // 最多 30 个标题
      outline.push(`${'  '.repeat(m[1].length - 1)}- ${m[2].trim()}`);
      headingCount++;
    }
  }
  if (outline.length === 0) {
    // 无标题时，取首段非空文本
    for (const line of lines) {
      const t = line.trim();
      if (t && !t.startsWith('#') && !t.startsWith('|') && !t.startsWith('!')) {
        outline.push(t.slice(0, 120));
        break;
      }
    }
  }
  return outline.join('\n');
}

async function safeRead(path: string): Promise<string | null> {
  if (!(await pathExists(path))) return null;
  try {
    const st = await stat(path);
    if (!st.isFile()) return null;
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '\n…(截断)' : s;
}
