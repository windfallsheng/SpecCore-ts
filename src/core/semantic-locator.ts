/**
 * semantic-locator — 语义定位引擎
 * v7.2.0+
 *
 * 基于功能名称在文档、代码、全局分析产出中定位相关内容，
 * 为细粒度分析提供精确的上下文关联。
 */
import { readFile, pathExists, readdir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';

export interface FeatureLocation {
  source: 'doc' | 'requirements' | 'code' | 'global';
  path: string;
  title?: string;
  content: string;
  relevance: number; // 0-100
  lineStart?: number;
  lineEnd?: number;
}

export interface FeatureContext {
  featureName: string;
  docLocations: FeatureLocation[];
  reqLocations: FeatureLocation[];
  codeLocations: FeatureLocation[];
  globalLocations: FeatureLocation[];
  summary: string;
}

// 功能关键词同义词扩展
const FEATURE_ALIASES: Record<string, string[]> = {
  '订单': ['order', '下单', '订单管理', '订单详情', '订单列表', '订单状态'],
  '认证': ['auth', '登录', '登出', '注册', 'token', 'jwt', 'oauth', 'sso', '权限'],
  '支付': ['payment', '收银', '付款', '充值', '退款', '结算', '账单'],
  '用户': ['user', '会员', '客户', 'account', 'profile', '个人信息'],
  '消息': ['message', '通知', '推送', '私信', '公告', '站内信', 'im'],
  '文件': ['file', '上传', '下载', 'oss', '存储', '附件', '图片'],
  '搜索': ['search', '检索', '查询', '筛选', '过滤', '排序', 'es'],
};

function expandKeywords(featureName: string): string[] {
  const keywords = [featureName];
  const lower = featureName.toLowerCase();
  for (const [key, aliases] of Object.entries(FEATURE_ALIASES)) {
    if (featureName.includes(key) || aliases.some(a => lower.includes(a.toLowerCase()))) {
      keywords.push(key, ...aliases);
    }
  }
  return [...new Set(keywords)];
}

function calcRelevance(content: string, keywords: string[]): number {
  const lowerContent = content.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    const lowerKw = kw.toLowerCase();
    const count = (lowerContent.match(new RegExp(lowerKw, 'g')) || []).length;
    score += count * 10;
    // 标题匹配加分
    if (/^#{1,3}\s/.test(content) && lowerContent.includes(lowerKw)) {
      score += 30;
    }
  }
  return Math.min(100, score);
}

/**
 * 在指定文档中定位功能章节
 */
export async function locateFeatureInDoc(docPath: string, featureName: string): Promise<FeatureLocation | null> {
  if (!(await pathExists(docPath))) return null;

  const content = await readFile(docPath, 'utf-8');
  const keywords = expandKeywords(featureName);

  // 按 Markdown 标题分块
  const sections = content.split(/\n(?=#{1,4}\s)/);
  let bestSection = '';
  let bestScore = 0;
  let bestLineStart = 0;
  let bestTitle = '';

  let lineNum = 0;
  for (const section of sections) {
    const score = calcRelevance(section, keywords);
    if (score > bestScore) {
      bestScore = score;
      bestSection = section;
      bestLineStart = lineNum;
      const titleMatch = section.match(/^#{1,4}\s+(.+)/m);
      bestTitle = titleMatch ? titleMatch[1].trim() : '';
    }
    lineNum += section.split('\n').length;
  }

  if (bestScore < 20) return null;

  return {
    source: 'doc',
    path: docPath,
    title: bestTitle,
    content: bestSection.slice(0, 3000), // 限制长度
    relevance: bestScore,
    lineStart: bestLineStart,
    lineEnd: bestLineStart + bestSection.split('\n').length,
  };
}

/**
 * 在需求文档中定位功能
 */
export async function locateFeatureInRequirements(iterDir: string, featureName: string): Promise<FeatureLocation[]> {
  const reqDir = join(iterDir, '010-requirements');
  if (!(await pathExists(reqDir))) return [];

  const locations: FeatureLocation[] = [];
  const keywords = expandKeywords(featureName);

  // 扫描 features/ 目录
  const featuresDir = join(reqDir, 'features');
  if (await pathExists(featuresDir)) {
    const entries = await readdir(featuresDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const readmePath = join(featuresDir, entry.name, 'README.md');
        if (await pathExists(readmePath)) {
          const loc = await locateFeatureInDoc(readmePath, featureName);
          if (loc) locations.push(loc);
        }
      }
    }
  }

  // 扫描 converted/ 和 sources/
  for (const sub of ['converted', 'sources']) {
    const subDir = join(reqDir, sub);
    if (!(await pathExists(subDir))) continue;
    const files = await readdir(subDir);
    for (const f of files.filter(f => f.endsWith('.md'))) {
      const loc = await locateFeatureInDoc(join(subDir, f), featureName);
      if (loc) locations.push(loc);
    }
  }

  // 按相关度排序
  return locations.sort((a, b) => b.relevance - a.relevance);
}

/**
 * 在代码中定位相关文件（基于 structured-data.json 或源码扫描）
 */
export async function locateFeatureInCode(projectRoot: string, featureName: string): Promise<FeatureLocation[]> {
  const structuredDataPath = join(projectRoot, '.speccore', 'cache', 'structured-data.json');
  const keywords = expandKeywords(featureName);
  const locations: FeatureLocation[] = [];

  // 如果有结构化数据，优先使用
  if (await pathExists(structuredDataPath)) {
    try {
      const data = await readFile(structuredDataPath, 'utf-8');
      const structured = JSON.parse(data);

      for (const [platform, info] of Object.entries(structured.endpoints || {})) {
        const pInfo = info as any;
        // 匹配 API
        for (const api of pInfo.apis || []) {
          const apiText = `${api.path} ${api.handler} ${api.description || ''}`;
          if (keywords.some(kw => apiText.toLowerCase().includes(kw.toLowerCase()))) {
            locations.push({
              source: 'code',
              path: api.filePath,
              title: `${api.method} ${api.path}`,
              content: `API: ${api.method} ${api.path}\nHandler: ${api.handler}\nFile: ${api.filePath}:${api.line}`,
              relevance: 80,
            });
          }
        }
        // 匹配 Entity
        for (const entity of pInfo.entities || []) {
          if (keywords.some(kw => entity.name.toLowerCase().includes(kw.toLowerCase()))) {
            locations.push({
              source: 'code',
              path: entity.filePath,
              title: `Entity: ${entity.name}`,
              content: `Entity: ${entity.name}\nTable: ${entity.tableName || 'N/A'}\nFile: ${entity.filePath}:${entity.line}`,
              relevance: 75,
            });
          }
        }
        // 匹配 Component
        for (const comp of pInfo.components || []) {
          if (keywords.some(kw => comp.name.toLowerCase().includes(kw.toLowerCase()))) {
            locations.push({
              source: 'code',
              path: comp.filePath,
              title: `Component: ${comp.name}`,
              content: `Component: ${comp.name}\nFile: ${comp.filePath}:${comp.line}`,
              relevance: 70,
            });
          }
        }
      }
    } catch { /* ignore */ }
  }

  return locations.sort((a, b) => b.relevance - a.relevance).slice(0, 10);
}

/**
 * 在全局分析产出中定位相关内容
 */
export async function locateFeatureInGlobal(projectRoot: string, featureName: string): Promise<FeatureLocation[]> {
  const globalDir = join(projectRoot, '.speccore', 'GLOBAL');
  if (!(await pathExists(globalDir))) return [];

  const locations: FeatureLocation[] = [];
  const keywords = expandKeywords(featureName);

  // 扫描 overview/ 和 platforms/
  const scanDir = async (dir: string) => {
    if (!(await pathExists(dir))) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.name.endsWith('.md')) {
        const loc = await locateFeatureInDoc(fullPath, featureName);
        if (loc) locations.push({ ...loc, source: 'global' });
      }
    }
  };

  await scanDir(join(globalDir, 'overview'));
  await scanDir(join(globalDir, 'platforms'));

  return locations.sort((a, b) => b.relevance - a.relevance).slice(0, 5);
}

/**
 * 构建功能单元的完整上下文
 */
export async function buildFeatureContext(
  projectRoot: string,
  iterDir: string,
  featureName: string,
  docName?: string,
): Promise<FeatureContext> {
  const ctx: FeatureContext = {
    featureName,
    docLocations: [],
    reqLocations: [],
    codeLocations: [],
    globalLocations: [],
    summary: '',
  };

  // 1. 在指定文档中定位
  if (docName) {
    const docPath = docName.startsWith('/') ? docName : join(iterDir, '020-specs', docName);
    const loc = await locateFeatureInDoc(docPath, featureName);
    if (loc) ctx.docLocations.push(loc);
  }

  // 2. 在需求文档中定位
  ctx.reqLocations = await locateFeatureInRequirements(iterDir, featureName);

  // 3. 在代码中定位
  ctx.codeLocations = await locateFeatureInCode(projectRoot, featureName);

  // 4. 在全局分析中定位
  ctx.globalLocations = await locateFeatureInGlobal(projectRoot, featureName);

  // 生成摘要
  const parts: string[] = [];
  if (ctx.docLocations.length > 0) parts.push(`文档命中: ${ctx.docLocations.length} 处`);
  if (ctx.reqLocations.length > 0) parts.push(`需求命中: ${ctx.reqLocations.length} 处`);
  if (ctx.codeLocations.length > 0) parts.push(`代码命中: ${ctx.codeLocations.length} 处`);
  if (ctx.globalLocations.length > 0) parts.push(`全局分析命中: ${ctx.globalLocations.length} 处`);
  ctx.summary = parts.join(' | ');

  logger.info(`🔍 语义定位: "${featureName}" → ${ctx.summary || '未找到匹配内容'}`);

  return ctx;
}

/**
 * 生成功能分析用的 Prompt 上下文注入文本
 */
export function buildFeatureContextPrompt(ctx: FeatureContext): string {
  let prompt = `\n## 🔍 关联上下文（自动定位）\n\n`;
  prompt += `> 正在分析功能: **${ctx.featureName}**\n`;
  prompt += `> ${ctx.summary || '未找到关联内容'}\n\n`;

  if (ctx.reqLocations.length > 0) {
    prompt += `### 需求文档（${ctx.reqLocations.length} 处）\n\n`;
    for (const loc of ctx.reqLocations.slice(0, 2)) {
      prompt += `**${loc.title || loc.path.split('/').pop()}** (相关度: ${loc.relevance})\n`;
      prompt += `\`\`\`
${loc.content.slice(0, 800)}
\`\`\`

`;
    }
  }

  if (ctx.codeLocations.length > 0) {
    prompt += `### 关联代码（${ctx.codeLocations.length} 处）\n\n`;
    for (const loc of ctx.codeLocations.slice(0, 3)) {
      prompt += `- **${loc.title}**: \`${loc.path}\`\n`;
    }
    prompt += `\n> 分析技术方案时，请 Read 上述代码文件获取真实实现细节\n\n`;
  }

  if (ctx.globalLocations.length > 0) {
    prompt += `### 全局架构（${ctx.globalLocations.length} 处）\n\n`;
    for (const loc of ctx.globalLocations.slice(0, 2)) {
      prompt += `- **${loc.title || loc.path.split('/').pop()}**: ${loc.path}\n`;
    }
    prompt += `\n`;
  }

  return prompt;
}
