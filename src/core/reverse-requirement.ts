/**
 * reverse-requirement.ts — 从源码反推需求（两跳 IR → UR 渐进抽象）
 *
 * 方法论对齐 UserTrace：源码不是直接跳到用户需求，而是分两跳——
 *   第一跳（源码 → 中间需求 IR）：按技术模块切分，每个模块产出一份「实现级」IR；
 *   第二跳（IR → 用户需求 UR）：合并所有 IR，抽象出「用户级」需求 + EARS 五句式验收标准。
 *   验证环（v8.3.301+）：校验 UR 溯源锚点与 IR 模块清单一致性，悬空锚点即疑似 AI 幻觉。
 *
 * 架构边界（SpecCore 哲学）：
 *   - CLI 只做「确定性」分层：扫描分组、依赖排序、tree-sitter 摘要、骨架生成、锚点校验。
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
import { ensureDir, readFile, writeFile, readdir, pathExists } from 'fs-extra';
import {
  buildCodeIndex,
  loadFullIndex,
  type CodeIndex,
  type CodeFile,
  type ModuleInfo,
} from './code-scanner';
import { summarizeCode, isTreeSitterLang } from './multi-lang-parser';
// v8.3.365+: 业务切片——从导出符号提取带函数体的切片（结构摘要丢弃方法体，业务语义藏在函数体里）
import { sliceCodeFile } from './unified-retrieval';
import { logger } from '../utils/logger';

// ── v8.3.365: 反推深度三档（depth 参数此前为死参数，本轮激活）──
// 影响：每模块读文件数 / 每文件切片数 / 切片函数体行数上限
export const DEPTH_CONFIG = {
  quick:  { maxFiles: 3,  slicesPerFile: 2, maxBodyLines: 30 },
  normal: { maxFiles: 8,  slicesPerFile: 3, maxBodyLines: 50 },
  deep:   { maxFiles: 20, slicesPerFile: 5, maxBodyLines: 50 },
} as const;
export type ReverseDepth = keyof typeof DEPTH_CONFIG;
/** 每模块切片总字符预算，防 IR 爆量 */
const MAX_SLICE_CHARS_PER_MODULE = 10000;

// ── 类型定义 ──

export interface ReverseRequirementOptions {
  /** 源码目录（可选，缺省用 code-index 的默认扫描范围） */
  sources?: string[];
  /** 分析深度 quick/normal/deep，影响读文件数与摘要粒度 */
  depth?: string;
  /** 输出根目录，默认 .speccore/GLOBAL/_reverse（v8.3.368: 与全局分析 requirements/ 域隔离，避免 REQUIREMENT.md 被两条管线抢用） */
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
  /** v8.3.365+: 带函数体的导出符号切片——业务语义抽象的素材来源 */
  slices: IRCodeSlice[];
  lines: number;
}

/** 业务切片（v8.3.365+）：导出符号 + 注释 + 签名 + 函数体（截断后） */
export interface IRCodeSlice {
  /** 来源文件路径 */
  file: string;
  /** 符号名 */
  name: string;
  /** 符号类型（function/class/interface/type/enum/variable） */
  type: string;
  /** 前置注释（JSDoc 等） */
  comments: string;
  /** 签名行 */
  signature: string;
  /** 函数体（截断后） */
  body: string;
  /** 起始行号（1-based） */
  lineStart: number;
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
  // v8.3.365: depth 参数激活（此前为死参数）
  const dc = DEPTH_CONFIG[options.depth === 'deep' ? 'deep' : options.depth === 'quick' ? 'quick' : 'normal'];

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

    // 读文件内容（v8.3.365: 文件数由 depth 决定，不再硬编码 8）
    const contents: Record<string, string> = {};
    for (const f of files.slice(0, dc.maxFiles)) {
      try {
        const fullPath = join(process.cwd(), f.path);
        if (await pathExists(fullPath)) {
          contents[f.path] = await readFile(fullPath, 'utf-8');
        }
      } catch { /* 忽略不可读文件 */ }
    }
    let summary = '';
    for (const f of files.slice(0, dc.maxFiles)) {
      if (!contents[f.path]) continue;
      const lang = f.language;
      const s = isTreeSitterLang(lang)
        ? await summarizeCode(contents[f.path], lang)
        : null;
      if (s) summary += `\n${s}\n`;
    }

    // ── v8.3.365: 业务切片——tree-sitter 摘要只留符号/接口（丢弃方法体），
    // 业务规则、异常分支、交互逻辑全在函数体里；此处从导出符号提取带函数体的
    // 切片，让宿主 AI 有真实业务素材可抽象，而非对着签名猜概括 ──
    const slices: IRCodeSlice[] = [];
    let sliceChars = 0;
    for (const f of files.slice(0, dc.maxFiles)) {
      if (slices.length >= dc.maxFiles * dc.slicesPerFile) break;
      if (!contents[f.path]) continue;
      try {
        const fileSlices = sliceCodeFile(contents[f.path], f.path);
        for (const s of fileSlices.slice(0, dc.slicesPerFile)) {
          const bodyLines = s.body.split('\n');
          const body = bodyLines.length > dc.maxBodyLines
            ? bodyLines.slice(0, dc.maxBodyLines).join('\n') + '\n// ... (截断)'
            : s.body;
          const charCost = (s.comments + s.signature + body).length;
          if (sliceChars + charCost > MAX_SLICE_CHARS_PER_MODULE && slices.length > 0) break;
          slices.push({
            file: f.path,
            name: s.name,
            type: s.type,
            comments: s.comments,
            signature: s.signature,
            body,
            lineStart: s.lineStart,
          });
          sliceChars += charCost;
        }
      } catch { /* 单文件切片失败不阻断 */ }
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
      slices,
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
  // v8.3.365+: 业务切片章节——结构摘要丢弃方法体，切片是业务语义素材
  if (m.slices.length > 0) {
    lines.push(`## 业务切片（v8.3.365+，含函数体）`);
    lines.push('');
    lines.push(`> CLI 从导出符号提取的带函数体切片，是「业务规则 / 异常分支 / 交互逻辑」的素材来源。`);
    lines.push(`> 切片不足以确认业务语义时，用 Read 工具深读对应文件原文（函数体）。`);
    lines.push('');
    for (const s of m.slices) {
      lines.push(`### \`${s.file}\` — ${s.name} (${s.type} · L${s.lineStart})`);
      lines.push('');
      lines.push('```ts');
      if (s.comments) lines.push(s.comments);
      lines.push(s.signature);
      lines.push(s.body);
      lines.push('```');
      lines.push('');
    }
  }
  lines.push(`## 业务语义（宿主 AI 填写）`);
  lines.push('');
  lines.push(`> ⚠️ 以下由宿主 AI 基于「代码事实 + 结构摘要 + 业务切片」做语义抽象，勿编造代码中不存在的逻辑。`);
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
  lines.push(`### 溯源锚点`);
  lines.push('');
  lines.push(`- _AI 填写：每条语义抽象对应的代码位置（格式 \`文件路径#符号\`，如 \`core/auth-service.ts#login\`）。无锚点的抽象视为未验证。_`);
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
  lines.push(`> 每个功能单元必须带「溯源锚点」：列出支撑它的 IR 模块 id（格式 \`{端}/{模块}\`），保证需求可追溯到代码。`);
  lines.push('');
  lines.push(`| 功能单元 | 涉及技术模块 | 涉及端 | 溯源锚点 |`);
  lines.push(`| :--- | :--- | :--- | :--- |`);
  lines.push('| _AI 填写_ | _AI 填写_ | _AI 填写_ | _AI 填写：如 `booking-service/order-service`_ |');
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
  lines.push(`## 验收标准（EARS 五句式，宿主 AI 撰写）`);
  lines.push('');
  lines.push(`> 每个功能单元至少 3 条验收标准，按场景从 EARS 五种句式选择（v8.3.301+）：`);
  lines.push('');
  lines.push(`| 句式 | 适用场景 | 模板 |`);
  lines.push(`| :--- | :--- | :--- |`);
  lines.push(`| 普遍性 Ubiquitous | 无前置条件的基础能力 | 系统应 [期望行为] |`);
  lines.push(`| 事件驱动 Event-driven | 由用户/外部动作触发 | 当 [触发事件] 时，系统应 [期望行为] |`);
  lines.push(`| 状态驱动 State-driven | 系统处于某状态期间 | 在 [状态下] 期间，系统应 [期望行为] |`);
  lines.push(`| 异常处理 Unwanted | 非预期条件出现时 | 如果 [非预期条件]，则系统应 [容错行为] |`);
  lines.push(`| 可选特性 Optional | 特性启用/配置开启时 | 在 [特性启用时]，系统应 [期望行为] |`);
  lines.push('');
  lines.push(`> 反翻译腔规则（两条硬约束）：`);
  lines.push(`> 1. 主语必须是「用户」或业务对象，禁止函数名/类名/接口名（把「调用 XService.createOrder」写成「用户提交订单」）；`);
  lines.push(`> 2. 每条必须带用户价值或系统责任，禁止把「输出 JSON / 返回 200」当验收标准。`);
  lines.push('');
  lines.push(`### _功能单元名_`);
  lines.push('');
  lines.push(`- **AC-01**：当 _触发事件_ 时，系统应 _期望行为_。[溯源: \`_AI 填写模块id\`]`);
  lines.push(`- **AC-02**：如果 _非预期条件_，则系统应 _容错行为_。[溯源: \`_AI 填写模块id\`]`);
  lines.push('');
  lines.push(`## 待确认项（人工确认）`);
  lines.push('');
  lines.push(`- [ ] 功能单元边界是否正确（有无遗漏/重复/需拆分合并）`);
  lines.push(`- [ ] 端覆盖矩阵是否正确`);
  lines.push(`- [ ] 验收标准是否与代码实现一致、可测试`);
  lines.push(`- [ ] 溯源锚点是否真实存在（完成后运行 \`speccore global from-source --src <dirs> --verify\` 校验）`);
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
  lines.push(`对每个 IR 文件，做「业务语义抽象」：`);
  lines.push(`1. 读该 IR 的「代码事实 + 源码结构摘要 + 业务切片」（CLI 已预提取）；`);
  lines.push(`2. 业务切片不足以确认的规则 / 分支 / 交互，用 Read 工具按需深读锚点文件的函数体原文——`);
  lines.push(`   业务语义藏在函数体里，只读签名写不出真实需求；`);
  lines.push(`3. 填写「模块职责 / 关键业务规则 / 输入输出 / 异常边界」；`);
  lines.push(`4. 禁止编造代码中不存在的逻辑；不确定处标注 \`待确认\`。`);
  lines.push('');
  lines.push(`## 第二跳：合成 UR`);
  lines.push('');
  lines.push(`1. 读完所有 IR 后，按业务语义把技术模块合并为「功能单元」；`);
  lines.push(`2. 在 \`${outputDir}/REQUIREMENT.md\` 填写功能单元清单 + EARS 验收标准；`);
  lines.push(`3. 每条验收标准必须带「溯源锚点」（引用真实 IR 模块 id），功能单元表必须填「溯源锚点」列；`);
  lines.push(`4. 端覆盖矩阵已由 CLI 确定，勿改动。`);
  lines.push('');
  lines.push(`## 第三跳起：QA 环（v8.3.367+，对齐 recipe-reverse-engineer 五阶段）`);
  lines.push('');
  lines.push(`两跳完成后进入「验证 → 审查 → 修订」闭环（对应业界最优配方 discover→generate→verify→review→revision）：`);
  lines.push('');
  lines.push(`### 1. 验证（--verify）：锚点门禁 + 完整性基线 + code-verifier 剧本`);
  lines.push(`运行 \`speccore global from-source --src <dirs> --verify\`：CLI 校验「溯源锚点」与 IR 清单一致性（悬空锚点=疑似幻觉）+ 覆盖完整性（未被引用的模块=遗漏），并生成 \`_qa/VERIFY_PLAYBOOK.md\` 与 \`_qa/verify.json\` 模板。`);
  lines.push(`宿主 AI 按剧本扮演 code-verifier：逐条 AC 对照代码证据验证，填写 verify.json（status: verified/needs_review/inconsistent/unverified，须过 Quality Gate——计数平衡、无 blocked）。`);
  lines.push('');
  lines.push(`### 2. 审查（--review）：document-reviewer 语义审查`);
  lines.push(`运行 \`speccore global from-source --src <dirs> --review\`：CLI 生成 \`_qa/REVIEW_PLAYBOOK.md\` 与 \`_qa/review.json\` 模板。`);
  lines.push(`宿主 AI 按剧本扮演 document-reviewer：拿 verify.json 作证据，从完整性/正确性/可测试性/翻译腔/粒度/可追溯性六维审查「写得如何」，逐条 finding 做 Review Resolution 裁决（apply=必须修订 / decline=拒绝），填 review.json。`);
  lines.push('');
  lines.push(`### 3. 修订（--revise）：有条件修订 + re-validation`);
  lines.push(`运行 \`speccore global from-source --src <dirs> --revise\`：CLI 读 review.json 做裁决门禁——无 apply findings 即闭环完成；有 apply findings 则生成 \`_qa/REVISION_PLAYBOOK.md\`（apply findings 全文作修订范围）并记入 \`_qa/REVISION_LOG.md\`。`);
  lines.push(`修订后必须重新验证（re-validation）：先 \`--verify\` 重跑 code-verifier，再 \`--review\` 带 prior_feedback 重跑 document-reviewer，直到无 apply findings。`);
  lines.push('');
  lines.push(`## 约束`);
  lines.push('');
  lines.push(`- 产出物一律标 \`status: candidate\`；`);
  lines.push(`- 需求只从前端反推「用户能做什么」，后端只产出「技术约束」（接口/数据模型/规则）；`);
  lines.push(`- 验收标准必须 EARS 五句式、无歧义、可测试、带溯源锚点；`);
  lines.push(`- 禁止把 IR 骨架当需求直译交差——先抽象再落笔，函数名/类名不得出现在需求文本里。`);
  lines.push('');
  return lines.join('\n');
}

// ── 主函数 ──

export async function reverseRequirementsFromCode(
  options: ReverseRequirementOptions,
): Promise<ReverseResult> {
  const outputDir = options.outputDir || join('.speccore', 'GLOBAL', '_reverse');
  const irDir = join(outputDir, '_ir');
  await ensureDir(irDir);

  const depthLabel = options.depth === 'deep'
    ? 'deep（每模块 ≤20 文件 × 5 切片）'
    : options.depth === 'quick'
      ? 'quick（每模块 ≤3 文件 × 2 切片）'
      : 'normal（每模块 ≤8 文件 × 3 切片）';
  logger.info(`   🔍 反推需求：扫描源码并分组（深度: ${depthLabel}）...`);
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

export function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '-');
}

// ── 验证环：锚点一致性校验（v8.3.301+，反幻觉门禁）──

/** 锚点校验结果（UR 溯源锚点 vs IR 模块清单） */
export interface VerifyAnchorsResult {
  outputDir: string;
  /** 已填写的锚点总数（不含 AI 未填的占位） */
  total: number;
  /** 能回溯到真实 IR 模块的锚点数 */
  valid: number;
  /** 悬空锚点（引用了不存在的模块 id，疑似 AI 幻觉） */
  dangling: string[];
  reportPath: string;
}

/** 提取「溯源: `xxx`」或「[溯源: `xxx`]」中的锚点 */
const ANCHOR_RE = /\[?溯源[:：]\s*`([^`]+)`\]?/g;

/**
 * 提取 REQUIREMENT.md 中已填写的溯源锚点（占位锚点「_AI 填写模块id」不计入）。
 * v8.3.367: 从 verifyReverseAnchors 抽出，供 QA 环（完整性基线）复用。
 */
export function extractFilledAnchors(content: string): string[] {
  const anchors: string[] = [];
  let m: RegExpExecArray | null;
  ANCHOR_RE.lastIndex = 0;
  while ((m = ANCHOR_RE.exec(content)) !== null) {
    anchors.push(m[1]);
  }
  return anchors.filter(a => !/_AI 填写|填写模块id/.test(a));
}

/**
 * 校验 REQUIREMENT.md 的溯源锚点与 IR 模块清单的一致性。
 * 锚点与 IR 文件名都经过 sanitize 归一化后比对（'/' → '-'），
 * 悬空锚点即宿主 AI 引用了不存在的模块——典型幻觉特征，须修正后重新校验。
 */
export async function verifyReverseAnchors(outputDir: string): Promise<VerifyAnchorsResult> {
  const urPath = join(outputDir, 'REQUIREMENT.md');
  if (!(await pathExists(urPath))) {
    throw new Error(`未找到 ${urPath}，请先运行 speccore global from-source --src <dirs> 完成反推并填充 UR 后再校验。`);
  }

  // IR 模块 id 白名单（IR 文件名 = sanitize(moduleId)）
  let whitelist = new Set<string>();
  const irDir = join(outputDir, '_ir');
  if (await pathExists(irDir)) {
    const files = await readdir(irDir);
    whitelist = new Set(files.filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, '')));
  }

  const content = await readFile(urPath, 'utf-8');
  const filled = extractFilledAnchors(content);
  const dangling = filled.filter(a => !whitelist.has(sanitize(a)));

  const reportPath = join(outputDir, 'VERIFY_REPORT.md');
  await writeFile(reportPath, buildVerifyReport(filled.length, dangling));

  logger.info('');
  logger.info('🔍 验证环：溯源锚点一致性校验');
  logger.info(`   📄 校验对象: ${urPath}`);
  logger.info(`   🧩 IR 白名单: ${whitelist.size} 个模块`);
  logger.info(`   📌 已填锚点: ${filled.length} | 有效: ${filled.length - dangling.length} | 悬空: ${dangling.length}`);
  if (dangling.length > 0) {
    logger.warn(`   ⚠️ 悬空锚点（疑似 AI 幻觉，引用不存在的模块）:`);
    dangling.slice(0, 20).forEach(d => logger.warn(`      - \`${d}\``));
    logger.warn(`   详见报告: ${reportPath}`);
  } else {
    logger.info('   ✅ 全部锚点通过校验，需求可追溯。');
  }
  logger.info('');

  return {
    outputDir,
    total: filled.length,
    valid: filled.length - dangling.length,
    dangling,
    reportPath,
  };
}

function buildVerifyReport(total: number, dangling: string[]): string {
  const lines: string[] = [];
  lines.push('# 反推需求验证报告（VERIFY）');
  lines.push('');
  lines.push(`> 生成时间: ${new Date().toISOString()}`);
  lines.push(`> 校验规则: REQUIREMENT.md 中每条「溯源锚点」必须能回溯到真实存在的 IR 模块（\`.speccore/GLOBAL/_reverse/_ir/\`）。`);
  lines.push('');
  lines.push('## 统计');
  lines.push('');
  lines.push(`- 已填锚点总数: ${total}`);
  lines.push(`- 有效锚点: ${total - dangling.length}（能回溯到真实 IR 模块）`);
  lines.push(`- 悬空锚点: ${dangling.length}（疑似 AI 幻觉，引用不存在的模块）`);
  lines.push('');
  if (dangling.length > 0) {
    lines.push('## 悬空锚点清单');
    lines.push('');
    dangling.forEach(d => lines.push(`- \`${d}\``));
    lines.push('');
    lines.push('> 修正方式：把锚点改为真实 IR 模块 id（见 _ir/ 目录文件名），或补充代码依据后重新运行 --verify。');
    lines.push('');
  }
  lines.push('## 结论');
  lines.push('');
  lines.push(dangling.length === 0
    ? '✅ 全部锚点通过校验，需求可追溯。'
    : '❌ 存在悬空锚点，需求尚未通过验证环，请修正后重新校验。');
  lines.push('');
  return lines.join('\n');
}
