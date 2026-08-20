/**
 * AGENTS 引擎 — 加载器
 *
 * 负责：
 * 1. 扫描 .speccore/AGENTS/ 目录下的角色定义
 * 2. 解析 Markdown 文件为 AgentDefinition
 * 3. 解析 _INDEX.md 注册表
 * 4. 根据 platform/industry 解析特化版本
 * 5. 条件过滤和优先级排序
 *
 * v6.84.0+
 */

import { join } from 'path';
import { pathExists, readFile, readdir } from 'fs-extra';
import {
  AgentDefinition,
  AgentActivation,
  AgentRegistry,
  AgentRegistryEntry,
  AgentContext,
  ResolvedAgent,
} from './types';

const BUILTIN_AGENTS_DIR = join(__dirname, '..', 'defaults');

// ============================================================
// 1. Markdown 解析
// ============================================================

function parseAgentMarkdown(content: string, source: 'builtin' | 'user-defined'): AgentDefinition {
  const name = extractHeading(content) || 'unknown';
  const description = extractSection(content, '职责') || extractSection(content, 'Description') || '';
  const responsibilities = extractListItems(content, '职责') || extractListItems(content, 'Responsibilities') || [];
  const inputSpec = extractSection(content, '输入') || extractSection(content, 'Input') || '';
  const checkList = extractCheckboxItems(content) || [];
  const outputFormat = extractSection(content, '输出格式') || extractSection(content, 'Output Format') || '';
  const activations = parseSelfDescribedActivations(content);

  // rolePrompt = 整个文档内容（作为 AI 的 system prompt 注入）
  const rolePrompt = content;

  return {
    name,
    description,
    responsibilities,
    inputSpec,
    checkList,
    outputFormat,
    rolePrompt,
    source,
    activations,
  };
}

/**
 * 解析 Agent 自描述激活规则
 * 从 Markdown 中的 "## 激活规则" 或 "## Activations" 部分提取
 *
 * 支持格式：
 * | 命令 | 阶段 | 优先级 | 条件 |
 * | :--- | :--- | :--- | :--- |
 * | analyze | clarify | 60 | project.industry == 'finance' |
 */
function parseSelfDescribedActivations(content: string): AgentActivation[] {
  const section = extractSection(content, '激活规则') || extractSection(content, 'Activations');
  if (!section) return [];

  const activations: AgentActivation[] = [];
  const lines = section.split('\n').filter(l => l.trim().startsWith('|') && !l.trim().match(/^\|[\s-:]+\|/));

  for (const line of lines) {
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 3) {
      activations.push({
        command: cells[0],
        phase: cells[1],
        priority: parseInt(cells[2], 10) || 50,
        condition: cells[3] && cells[3] !== '—' && cells[3] !== '-' ? cells[3] : undefined,
      });
    }
  }

  return activations;
}

function extractHeading(content: string): string | undefined {
  const m = content.match(/^#\s+Agent:\s*(.+)$/m);
  return m?.[1].trim();
}

function extractSection(content: string, sectionName: string): string | undefined {
  const regex = new RegExp(`^##\\s+${sectionName}\\s*\\n(.*?)(?=\\n##\\s|$)`, 'ms');
  const m = content.match(regex);
  return m?.[1].trim();
}

function extractListItems(content: string, sectionName: string): string[] | undefined {
  const section = extractSection(content, sectionName);
  if (!section) return undefined;
  const items: string[] = [];
  for (const line of section.split('\n')) {
    const m = line.match(/^\s*[-*]\s+(.+)$/);
    if (m) items.push(m[1].trim());
  }
  return items.length > 0 ? items : undefined;
}

function extractCheckboxItems(content: string): string[] | undefined {
  const items: string[] = [];
  const matches = content.match(/^\s*-\s*\[[ x]\]\s*(.+)$/gm);
  if (matches) {
    for (const m of matches) {
      const item = m.replace(/^\s*-\s*\[[ x]\]\s*/, '').trim();
      if (item) items.push(item);
    }
  }
  return items.length > 0 ? items : undefined;
}

// ============================================================
// 2. 注册表解析
// ============================================================

function parseRegistryMarkdown(content: string): AgentRegistry {
  const phases: Record<string, AgentRegistryEntry[]> = {};
  const phaseMatches = content.matchAll(/^##\s+(.+?)\s*\/\s*(.+?)\s*\n([\s\S]*?)(?=\n##\s|$)/gm);

  for (const match of phaseMatches) {
    const command = match[1].trim();
    const phase = match[2].trim();
    const phaseKey = `${command}/${phase}`;
    const tableContent = match[3];

    phases[phaseKey] = parseRegistryTable(tableContent);
  }

  return { phases };
}

function parseRegistryTable(content: string): AgentRegistryEntry[] {
  const entries: AgentRegistryEntry[] = [];
  const lines = content.split('\n').filter(l => l.trim().startsWith('|') && !l.trim().match(/^\|[\s-:]+\|/));

  for (const line of lines) {
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 2) {
      entries.push({
        agent: cells[0],
        priority: parseInt(cells[1], 10) || 50,
        condition: cells[2] && cells[2] !== '—' && cells[2] !== '-' ? cells[2] : undefined,
        description: cells[3],
      });
    }
  }

  return entries;
}

// ============================================================
// 3. 条件表达式求值（简单实现）
// ============================================================

function evaluateCondition(condition: string | undefined, context: AgentContext): boolean {
  if (!condition) return true;

  try {
    // 支持的格式：
    // project.industry == 'finance'
    // project.securityLevel > 2
    // platform == 'backend'

    const eqMatch = condition.match(/^(.+?)\s*==\s*['"](.+?)['"]$/);
    if (eqMatch) {
      const path = eqMatch[1].trim();
      const expected = eqMatch[2];
      const actual = getContextValue(context, path);
      return String(actual) === expected;
    }

    const gtMatch = condition.match(/^(.+?)\s*>\s*(\d+)$/);
    if (gtMatch) {
      const path = gtMatch[1].trim();
      const expected = parseInt(gtMatch[2], 10);
      const actual = getContextValue(context, path);
      return Number(actual) > expected;
    }

    const gteMatch = condition.match(/^(.+?)\s*>=\s*(\d+)$/);
    if (gteMatch) {
      const path = gteMatch[1].trim();
      const expected = parseInt(gteMatch[2], 10);
      const actual = getContextValue(context, path);
      return Number(actual) >= expected;
    }

    // 简单布尔：存在即真
    const path = condition.trim();
    const actual = getContextValue(context, path);
    return actual !== undefined && actual !== null && actual !== false;
  } catch {
    return true; // 条件解析失败，默认通过
  }
}

function getContextValue(context: AgentContext, path: string): any {
  const parts = path.split('.');
  let current: any = context;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

// ============================================================
// 4. Agent 扫描与加载
// ============================================================

/**
 * 扫描指定目录下的所有 Agent 定义文件
 */
async function scanAgentFiles(dir: string): Promise<{ name: string; content: string; source: 'builtin' | 'user-defined' }[]> {
  if (!(await pathExists(dir))) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const agents: { name: string; content: string; source: 'builtin' | 'user-defined' }[] = [];

  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    if (e.name.startsWith('_')) continue; // _INDEX.md, _TEMPLATE.md 跳过

    const content = await readFile(join(dir, e.name), 'utf-8');
    agents.push({
      name: e.name.replace(/\.md$/, ''),
      content,
      source: dir === BUILTIN_AGENTS_DIR ? 'builtin' : 'user-defined',
    });
  }

  return agents;
}

// ============================================================
// 5. 特化版本解析
// ============================================================

/**
 * 根据 platform/industry 解析特化版本的 Agent 名称
 *
 * 优先级：platform-specific > industry-specific > generic
 */
export function resolveAgentName(
  baseAgent: string,
  context: AgentContext,
  availableAgents: Set<string>
): string {
  const platform = context.platform;
  const industry = context.project?.industry;

  // 1. 尝试 platform-specific: product-analyst-backend
  if (platform) {
    const platformSpecific = `${baseAgent}-${platform}`;
    if (availableAgents.has(platformSpecific)) return platformSpecific;
  }

  // 2. 尝试 industry-specific: security-reviewer-finance
  if (industry) {
    const industrySpecific = `${baseAgent}-${industry}`;
    if (availableAgents.has(industrySpecific)) return industrySpecific;
  }

  // 3. 回退到通用版
  return baseAgent;
}

// ============================================================
// 6. 主 API
// ============================================================

/**
 * 加载所有可用的 Agent 定义
 * 优先读取用户自定义，回退到内置默认
 */
export async function loadAllAgents(projectRoot: string): Promise<Map<string, AgentDefinition>> {
  const agents = new Map<string, AgentDefinition>();
  const userAgentsDir = join(projectRoot, '.speccore', 'AGENTS');

  // 1. 先加载内置默认
  const builtinFiles = await scanAgentFiles(BUILTIN_AGENTS_DIR);
  for (const f of builtinFiles) {
    const def = parseAgentMarkdown(f.content, 'builtin');
    agents.set(f.name, def);
  }

  // 2. 用户自定义覆盖（同名覆盖）
  const userFiles = await scanAgentFiles(userAgentsDir);
  for (const f of userFiles) {
    const def = parseAgentMarkdown(f.content, 'user-defined');
    agents.set(f.name, def);
  }

  return agents;
}

/**
 * 加载注册表
 * 优先读取用户自定义，回退到内置默认
 */
export async function loadRegistry(projectRoot: string): Promise<AgentRegistry> {
  const userIndex = join(projectRoot, '.speccore', 'AGENTS', '_INDEX.md');
  const builtinIndex = join(BUILTIN_AGENTS_DIR, '_INDEX.md');

  let content = '';
  if (await pathExists(userIndex)) {
    content = await readFile(userIndex, 'utf-8');
  } else if (await pathExists(builtinIndex)) {
    content = await readFile(builtinIndex, 'utf-8');
  }

  if (!content) return { phases: {} };
  return parseRegistryMarkdown(content);
}

/**
 * 获取指定命令/阶段下需要激活的 Agent 列表
 * 返回按优先级排序的 ResolvedAgent 数组
 *
 * 混合模式：
 * 1. 注册表中的核心角色（显式配置，优先）
 * 2. 用户自定义角色的自描述激活规则（扩展）
 */
export async function resolveAgentsForPhase(
  command: string,
  phase: string,
  context: AgentContext,
  projectRoot: string
): Promise<ResolvedAgent[]> {
  const phaseKey = `${command}/${phase}`;

  // 1. 加载注册表和 Agent 定义
  const registry = await loadRegistry(projectRoot);
  const allAgents = await loadAllAgents(projectRoot);
  const availableNames = new Set(allAgents.keys());

  // 2. 收集注册表中的角色
  const registryEntries = registry.phases[phaseKey] || [];
  const resolvedMap = new Map<string, ResolvedAgent>();

  for (const entry of registryEntries) {
    if (!evaluateCondition(entry.condition, context)) continue;

    const resolvedName = resolveAgentName(entry.agent, context, availableNames);
    const def = allAgents.get(resolvedName);
    if (!def) continue;

    resolvedMap.set(resolvedName, {
      name: resolvedName,
      definition: def,
      priority: entry.priority,
    });
  }

  // 3. 扫描用户自定义角色的自描述激活规则（扩展角色）
  for (const [agentName, def] of allAgents) {
    // 只扫描用户自定义的角色（内置角色不扫描自描述规则）
    if (def.source !== 'user-defined') continue;
    // 已在注册表中的跳过（注册表优先）
    if (resolvedMap.has(agentName)) continue;

    for (const act of def.activations) {
      if (act.command === command && act.phase === phase) {
        if (evaluateCondition(act.condition, context)) {
          resolvedMap.set(agentName, {
            name: agentName,
            definition: def,
            priority: act.priority,
          });
        }
        break; // 匹配到一个就够了
      }
    }
  }

  // 4. 按优先级排序（高优先级在前）
  const resolved = Array.from(resolvedMap.values());
  resolved.sort((a, b) => b.priority - a.priority);

  return resolved;
}

/**
 * 获取单个 Agent 的定义
 */
export async function loadAgentDefinition(
  agentName: string,
  projectRoot: string
): Promise<AgentDefinition | undefined> {
  const allAgents = await loadAllAgents(projectRoot);
  return allAgents.get(agentName);
}

/**
 * 获取内置 Agent 的原始 Markdown 内容（用于 init 时复制到项目）
 */
export async function getBuiltinAgentContents(): Promise<{ name: string; content: string }[]> {
  const files = await scanAgentFiles(BUILTIN_AGENTS_DIR);
  return files.map(f => ({ name: f.name, content: f.content }));
}

/**
 * 获取内置注册表内容（用于 init 时复制到项目）
 */
export async function getBuiltinRegistryContent(): Promise<string | undefined> {
  const path = join(BUILTIN_AGENTS_DIR, '_INDEX.md');
  if (await pathExists(path)) {
    return readFile(path, 'utf-8');
  }
  return undefined;
}

/**
 * 获取内置模板内容（用于 init 时复制到项目）
 */
export async function getBuiltinTemplateContent(): Promise<string | undefined> {
  const path = join(BUILTIN_AGENTS_DIR, '_TEMPLATE.md');
  if (await pathExists(path)) {
    return readFile(path, 'utf-8');
  }
  return undefined;
}
