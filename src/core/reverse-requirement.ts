/**
 * reverse-requirement.ts — 从源码反推需求（两跳 IR → UR 渐进抽象）
 *
 * 方法论对齐 UserTrace：源码不是直接跳到用户需求，而是分两跳——
 *   第一跳（源码 → 中间需求 IR）：按技术模块切分，每个模块产出一份「实现级」IR；
 *   第二跳（IR → 用户需求 UR）：合并所有 IR，抽象出「用户级」需求 + EARS 验收标准。
 *
 * 架构边界（SpecCore 哲学）：
 *   - CLI 只做「确定性」分层：扫描分组、依赖排序、tree-sitter 摘要、骨架生成。
 *   - 宿主 AI 做「语义」抽象：IR 的业务语义填充、功能单元划分、EARS 验收标准撰写。
 *   - 所有产物标 status: candidate（候选），澄清后才成 Spec。
 *
 * 复用能力：
 *   - code-scanner 的 CodeIndex（modules 分组 + endpoints 端识别 + CodeFile 符号/API）
 *   - multi-lang-parser 的 tree-sitter 结构化摘要（summarizeCode / summarizeSources）
 *
 * v8.3.184+
 */

import { join, basename } from 'path';
import { ensureDir, readFile, writeFile, pathExists } from 'fs-extra';
import {
  buildCodeIndex,
  loadFullIndex,
  type CodeIndex,
  type CodeFile,
  type ModuleInfo,
} from './code-scanner';
import { summarizeCode, isTreeSitterLang } from './multi-lang-parser';
import { logger } from '../utils/logger';

// ── 类型定义 ──

export interface ReverseRequirementOptions {
  /** 源码目录（可选，缺省用 code-index 的默认扫描范围） */
  sources?: string[];
  /** 分析深度 quick/normal/deep，影响读文件数与摘要粒度 */
  depth?: string;
  /** 输出根目录，默认 .speccore/GLOBAL/requirements */
  outputDir?: string;
  /** 只反推指定端（frontend/backend/mobile/cli/shared），缺省全端 */
  platforms?: string[];
  /** 最多反推的模块数（防止超大工程爆量），默认 30 */
  maxModules?: number;
}

/** 一个技术模块的中间需求（IR）——第一跳产物 */
export interface IRModule {
  /** 唯一 id：{endpoint}/{module} */
  id: string;
  endpoint: string;
  module: string;
  files: string[];
  symbols: string[];
  apis: string[];
  imports: string[];
  /** tree-sitter 结构化摘要 */
  summary: string;
  lines: number;
}

export interface ReverseResult {
  outputDir: string;
  irDir: string;
  irCount: number;
  modules: IRModule[];
  /** 两跳执行 prompt 路径（宿主 AI 据此完成语义抽象） */
  promptPath: string;
}

// ── 阶段 1：扫描 + 分组（CLI 确定性，零 Token）──

async function scanAndGroup(
  options: ReverseRequirementOptions,
): Promise<{ index: CodeIndex; modules: IRModule[] }> {
  // 确保索引最新（复用 code-scanner）
  await buildCodeIndex(options.sources?.join(',') || undefined, true);
  const index = await loadFullIndex();
  if (!index || !index.modules || index.modules.length === 0) {
    throw new Error('代码索引为空，无法反推需求。请确认源码目录存在且包含可解析的代码文件。');
  }

  const platformFilter = new Set(options.platforms?.filter(Boolean) || []);
  const maxModules = options.maxModules || 30;

  // 按「依赖深度」做分层排序（简单拓扑）：被依赖多的模块先分析（底层优先）
  const sortedModules = sortModulesByDependencies(index.modules);

  const result: IRModule[] = [];
  for (const m of sortedModules) {
    if (result.length >= maxModules) break;
    if (platformFilter.size > 0 && !platformFilter.has(m.endpoint)) continue;

    // 该模块的所有代码文件
    const files = index.files.filter(f => f.module === m.name && f.endpoint === m.endpoint);
    // 模块无代码文件（可能只有配置）则跳过
    if (files.length === 0) continue;

    const symbols = dedupe(files.flatMap(f => f.exports));
    const apis = dedupe(files.flatMap(f => f.apiDetails || []));
    const imports = dedupe(m.dependencies || []);
    const lines = files.reduce((a, f) => a + f.lines, 0);

    // 读文件内容，生成 tree-sitter 摘要
    const contents: Record<string, string> = {};
    for (const f of files.slice(0, 8)) {
      try {
        const fullPath = join(process.cwd(), f.path);
        if (await pathExists(fullPath)) {
          contents[f.path] = await readFile(fullPath, 'utf-8');
        }
      } catch { /* 忽略不可读文件 */ }
    }
    let summary = '';
    for (const f of files.slice(0, 8)) {
      if (!contents[f.path]) continue;
      const lang = f.language;
      const s = isTreeSitterLang(lang)
        ? await summarizeCode(contents[f.path], lang)
        : null;
      if (s) summary += `\n${s}\n`;
    }

    result.push({
      id: `${m.endpoint}/${m.name}`,
      endpoint: m.endpoint,
      module: m.name,
      files: files.map(f => f.path),
      symbols,
      apis,
      imports,
      summary: summary.trim(),
      lines,
    });
  }

  return { index, modules: result };
}

/** 简单拓扑分层：按「被依赖次数」降序（底层模块先分析），无环时安全 */
function sortModulesByDependencies(modules: ModuleInfo[]): ModuleInfo[] {
  const depCount = new Map<string, number>();
  for (const m of modules) {
    for (const d of m.dependencies || []) {
      depCount.set(d, (depCount.get(d) || 0) + 1);
    }
  }
  return [...modules].sort((a, b) => {
    const da = depCount.get(a.name) || 0;
    const db = depCount.get(b.name) || 0;
    return db - da; // 被依赖多的排前面
  });
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// ── 阶段 3：第一跳 —— 逐模块 IR 骨架 ──

function buildIRSkeleton(m: IRModule): string {
  const lines: string[] = [];
  lines.push(`# IR: ${m.module}（${m.endpoint}）`);
  lines.push('');
  lines.push(`> 状态: candidate | 层级: 实现级中间需求 | 模块 id: \`${m.id}\``);
  lines.push('');
  lines.push(`## 代码事实（CLI 提取，确定）`);
  lines.push('');
  lines.push(`- 端: \`${m.endpoint}\``);
  lines.push(`- 文件: ${m.files.length} 个（${m.lines} 行）`);
  lines.push(`- 符号: ${m.symbols.length ? m.symbols.slice(0, 15).map(s => '`' + s + '`').join(', ') : '_无_'} `);
  lines.push(`- API: ${m.apis.length ? m.apis.slice(0, 15).map(a => '`' + a + '`').join(', ') : '_无_'} `);
  if (m.imports.length) {
    lines.push(`- 依赖模块: ${m.imports.slice(0, 10).map(d => '`' + d + '`').join(', ')}`);
  }
  lines.push('');
  lines.push(`## 源码结构摘要（tree-sitter 提取）`);
  lines.push('');
  if (m.summary) {
    lines.push('```text');
    lines.push(m.summary);
    lines.push('```');
  } else {
    lines.push('> _无可解析摘要（文件可能为空或非代码）_');
  }
  lines.push('');
  lines.push(`## 业务语义（宿主 AI 填写）`);
  lines.push('');
  lines.push(`> ⚠️ 以下由宿主 AI 基于「代码事实 + 结构摘要」做语义抽象，勿编造代码中不存在的逻辑。`);
  lines.push('');
  lines.push(`### 模块职责`);
  lines.push('');
  lines.push(`_AI 填写：这个模块在业务上做什么？_`);
  lines.push('');
  lines.push(`### 关键业务规则`);
  lines.push('');
  lines.push(`- _AI 填写：从代码逻辑中抽象出的规则（如「密码错误 5 次锁定」）_`);
  lines.push('');
  lines.push(`### 输入 / 输出`);
  lines.push('');
  lines.push(`| 项 | 说明 |`);
  lines.push(`| :--- | :--- |`);
  lines.push(`| 输入 | _AI 填写_ |`);
  lines.push(`| 输出 | _AI 填写_ |`);
  lines.push('');
  lines.push(`### 异常与边界`);
  lines.push('');
  lines.push(`- _AI 填写_`);
  lines.push('');
  lines.push(`## 文件清单`);
  lines.push('');
  m.files.forEach(f => lines.push(`- \`${f}\``));
  lines.push('');
  return lines.join('\n');
}

// ── 阶段 4：第二跳 —— 合成 UR 骨架 + EARS ──

function buildURSkeleton(modules: IRModule[]): string {
  const lines: string[] = [];
  lines.push(`# 用户需求（UR）—— 从源码反推`);
  lines.push('');
  lines.push(`> 状态: candidate | 层级: 用户级需求 | 反推时间: ${new Date().toISOString().split('T')[0]}`);
  lines.push(`> 说明: 本文件由 CLI 从 ${modules.length} 个技术模块的 IR 合成骨架，功能单元划分与 EARS 验收标准由宿主 AI 完成。`);
  lines.push('');
  lines.push(`## 功能单元清单（宿主 AI 抽象）`);
  lines.push('');
  lines.push(`> 把下面 ${modules.length} 个技术模块按业务语义合并为「功能单元」（一个功能单元可对应多个技术模块，如「用户认证」对应 auth 后端模块 + login 前端模块）。`);
  lines.push('');
  lines.push(`| 功能单元 | 涉及技术模块 | 涉及端 |`);
  lines.push(`| :--- | :--- | :--- |`);
  lines.push(`| _AI 填写_ | _AI 填写_ | _AI 填写_ |`);
  lines.push('');
  lines.push(`## 端覆盖矩阵（CLI 确定）`);
  lines.push('');
  const endpoints = dedupe(modules.map(m => m.endpoint));
  lines.push(`| 端 | 模块数 | 模块清单 |`);
  lines.push(`| :--- | :--- | :--- |`);
  for (const ep of endpoints) {
    const ms = modules.filter(m => m.endpoint === ep);
    lines.push(`| \`${ep}\` | ${ms.length} | ${ms.map(m => m.module).join(', ')} |`);
  }
  lines.push('');
  lines.push(`## 验收标准（EARS 格式，宿主 AI 撰写）`);
  lines.push('');
  lines.push(`> 每个功能单元至少 3 条验收标准，采用 EARS 模板：`);
  lines.push(`> 当 [触发条件] 时，系统应 [期望行为]，以便 [用户价值]。`);
  lines.push('');
  lines.push(`### _功能单元名_`);
  lines.push('');
  lines.push(`- **AC-01**：当 _触发条件_ 时，系统应 _期望行为_，以便 _用户价值_。`);
  lines.push(`- **AC-02**：当 _异常条件_ 时，系统应 _容错行为_，以便 _用户价值_。`);
  lines.push('');
  lines.push(`## 待确认项（人工确认）`);
  lines.push('');
  lines.push(`- [ ] 功能单元边界是否正确（有无遗漏/重复/需拆分合并）`);
  lines.push(`- [ ] 端覆盖矩阵是否正确`);
  lines.push(`- [ ] 验收标准是否与代码实现一致、可测试`);
  lines.push(`- [ ] 是否有代码中未体现、但业务上存在的规则需补充`);
  lines.push('');
  return lines.join('\n');
}

// ── 阶段 5：两跳执行 prompt（宿主 AI 据此完成语义抽象）──

function buildReversePrompt(outputDir: string, irDir: string, modules: IRModule[]): string {
  const lines: string[] = [];
  lines.push(`# 源码反推需求 · 两跳执行指引`);
  lines.push('');
  lines.push(`> 目标：从源码恢复「候选需求」（status: candidate），澄清后才成为 Spec。`);
  lines.push('');
  lines.push(`## 第一跳：逐模块填充 IR`);
  lines.push('');
  lines.push(`目录：\`${irDir}\`（共 ${modules.length} 个 IR）`);
  lines.push('');
  lines.push(`对每个 IR 文件，只做「业务语义抽象」：`);
  lines.push(`1. 读该 IR 的「代码事实 + 源码结构摘要」（CLI 已提取，勿重读源码）；`);
  lines.push(`2. 填写「模块职责 / 关键业务规则 / 输入输出 / 异常边界」；`);
  lines.push(`3. 禁止编造代码中不存在的逻辑；不确定处标注 \`待确认\`。`);
  lines.push('');
  lines.push(`## 第二跳：合成 UR`);
  lines.push('');
  lines.push(`1. 读完所有 IR 后，按业务语义把技术模块合并为「功能单元」；`);
  lines.push(`2. 在 \`${outputDir}/REQUIREMENT.md\` 填写功能单元清单 + EARS 验收标准；`);
  lines.push(`3. 端覆盖矩阵已由 CLI 确定，勿改动。`);
  lines.push('');
  lines.push(`## 约束`);
  lines.push('');
  lines.push(`- 产出物一律标 \`status: candidate\`；`);
  lines.push(`- 需求只从前端反推「用户能做什么」，后端只产出「技术约束」（接口/数据模型/规则）；`);
  lines.push(`- 验收标准必须 EARS 格式、无歧义、可测试。`);
  lines.push('');
  return lines.join('\n');
}

// ── 主函数 ──

export async function reverseRequirementsFromCode(
  options: ReverseRequirementOptions,
): Promise<ReverseResult> {
  const outputDir = options.outputDir || join('.speccore', 'GLOBAL', 'requirements');
  const irDir = join(outputDir, '_ir');
  await ensureDir(irDir);

  logger.info('   🔍 反推需求：扫描源码并分组...');
  const { modules } = await scanAndGroup(options);
  if (modules.length === 0) {
    throw new Error('未找到可反推的代码模块。请确认源码目录或 --platforms 过滤条件。');
  }
  logger.info(`   📦 识别到 ${modules.length} 个技术模块（按端分组 + 依赖排序）`);

  // 第一跳：逐模块 IR 骨架
  logger.info('   🧩 第一跳：生成逐模块 IR 骨架...');
  for (const m of modules) {
    const irPath = join(irDir, `${sanitize(m.id)}.md`);
    await writeFile(irPath, buildIRSkeleton(m));
  }

  // 第二跳：合成 UR 骨架
  logger.info('   🧬 第二跳：合成 UR 骨架 + EARS 模板...');
  const urPath = join(outputDir, 'REQUIREMENT.md');
  await writeFile(urPath, buildURSkeleton(modules));

  // 两跳执行 prompt
  const promptPath = join(outputDir, 'REVERSE_PROMPT.md');
  await writeFile(promptPath, buildReversePrompt(outputDir, irDir, modules));

  logger.info(`   ✅ IR: ${modules.length} 个 → ${irDir}`);
  logger.info(`   ✅ UR 骨架: ${urPath}`);
  logger.info(`   ✅ 两跳指引: ${promptPath}`);

  return {
    outputDir,
    irDir,
    irCount: modules.length,
    modules,
    promptPath,
  };
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '-');
}
