/**
 * analyze 命令共享件——模式分发与主流程的公共基础设施
 * v8.3.359+: 从 analyze.ts 拆分（渐进重构批次 A：真共享件下沉）
 */
import { recordAiTrace } from '../../utils/ai-trace';

// v8.3.264: AI 交棒统一出口——所有 [SPECCORE_PROMPT] 输出必留 prompt-out 轨迹，
// 与 ai-trace 飞行记录仪的 apply-in/apply-done/apply-fail 配对，形成「发起→回传→落盘」闭环证据链。
// 此前 14 处输出点仅 2 处埋点，澄清链等 12 处交棒全程无痕（ai-trace/ 目录空白即因此）。
export async function emitAiPrompt(iter: string, prompt: string, meta: Record<string, unknown> = {}): Promise<void> {
  await recordAiTrace(iter, 'prompt-out', { promptLength: prompt.length, ...meta, prompt });
  process.stdout.write(`[SPECCORE_PROMPT]\n${prompt}`);
}

export interface AnalyzeOptions {
  iteration?: string;
  output?: string;
  auto?: boolean;
  interactive?: boolean;
  platform?: string; // 指定端: backend/web/admin/...
  // NEW options (CLI passes comma-separated strings)
  source?: string;
  requirements?: string;
  scope?: 'global' | 'iteration' | 'overview';
  depth?: 'quick' | 'normal' | 'deep';
  prompt?: boolean;     // --prompt: 输出结构化分析 Prompt 到 stdout
  apply?: string;       // --apply: 接收 AI 分析结果写入 ANALYSIS.md
  withCode?: boolean;   // --with-code: 结合工程源码分析
  noSource?: boolean;   // --no-source: 不读源码
  sourceScope?: string; // --source-scope <dirs>: 指定源码目录
  supplement?: boolean; // --supplement: 补充模式（追加源码到现有报告）
  feature?: string;     // --feature: 局部分析单个功能模块
  doc?: string;         // --doc: 局部分析类型文档（如 bugs/login-timeout, refactors/db-pool）
  auditFix?: boolean;   // --audit-fix: 读取质量审计报告并生成修复指令
  // synthesize 整合选项
  full?: boolean;       // --full: 全自动三阶段合成（原 synthesize --full）
  phase?: string;       // --phase N: 单阶段合成执行
  applyPhase?: string;  // --apply-phase N: 指定写入哪个阶段的合成结果
  // Pipeline 选项 (v6.68.0+)
  pipeline?: boolean;   // --pipeline: 启用流水线模式，自动执行 Phase 1 → Phase 2
  // 流式分析选项 (v6.74.0+)
  streaming?: boolean;  // --streaming: 启用流式全局分析
  streamingPhase?: string; // --streaming-phase: 指定流式分析阶段
  // 增量分析选项 (v6.75.0+)
  incremental?: boolean;  // --incremental: 增量分析
  reanalyze?: boolean;    // --reanalyze: 重新分析
  addPlatform?: string;   // --add-platform: 新增端分析
  contextGuard?: boolean; // --context-guard: 上下文爆炸防护
  estimateOnly?: boolean; // --estimate-only: 只预估不分析
  // 功能模块级全局分析 (v6.76.0+)
  module?: string;        // --module: 功能模块级全局分析
  // 需求澄清 (v6.76.0+)
  clarify?: boolean;      // --clarify: 检测到非专业文档时提示澄清
  skipClarify?: boolean;  // --skip-clarify: 跳过需求澄清阶段
  // v7.2.0+: 全局分析分层执行
  layer?: number;         // --layer N: 全局分析指定层级（1-4）
  // v7.2.0+: 单文档深度分析
  deep?: string;          // --deep <文档名>: 对指定文档进行深度分析（如 ARCHITECTURE.md）
  // v7.2.0+: 迭代式补全（大纲→逐节填充）
  iterative?: boolean;    // --iterative: 先输出大纲，再逐节深入（配合 --deep 使用）
  // v7.2.0+: 按需分析（只分析指定模块）
  filter?: string;        // --filter <关键词>: 只分析与关键词匹配的模块（如 "auth|login"）
  // v7.2.0+: 细粒度分析参数（由意图识别自动提取）
  docName?: string;       // 目标文档名（如 TECH.md）
  featureName?: string;   // 目标功能名（如 "订单模块"）
  extractUnits?: boolean; // --extract-units: 自动提取功能单元清单
  unit?: string;          // --unit <ID>: 分析功能单元，支持逗号分隔多个（如 M-01,M-03）
  autoUnits?: boolean;    // --auto-units: 自动遍历所有待分析的功能单元
  consolidate?: boolean;  // --consolidate: 汇总所有单元分析为统一报告
  resumeUnits?: boolean;  // --resume-units: 断点续跑未完成的单元分析
  // v8.3.122+: 增量合并模式
  merge?: boolean;         // --merge: 与现有文档合并（按标题替换/追加），不覆盖
  // v8.3.184+: 从源码反推需求（两跳 IR→UR）
  fromCode?: boolean;      // --from-code: 读源码生成候选需求（逐模块 IR → 合成 UR）
  // v8.3.301+: 验证环（--verify: 只校验 UR 溯源锚点与 IR 清单一致性，不重跑反推）
  verify?: boolean;
  // v8.3.367+: QA 环后续两步（对齐 recipe-reverse-engineer 五阶段）
  review?: boolean;        // --review: 生成 document-reviewer 语义审查剧本 + review.json 模板
  revise?: boolean;        // --revise: 读 review.json 做裁决门禁（有 apply findings 则生成修订剧本）
  // v8.3.191+: 反推需求产出目录（--out-dir，默认 .speccore/GLOBAL/requirements ）
  outDir?: string;
  // v8.3.386+: 跳过 4a 产品层（--no-product，只做技术文档不反推需求）
  noProduct?: boolean;
}

/** 解析 [DOC:xxx] 标记，提取文档名 → 内容 Map */
export function parseDocMarkers(text: string): Map<string, string> {
  const result = new Map<string, string>();
  const markerRegex = /\[DOC:([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  const positions: { name: string; index: number }[] = [];

  while ((match = markerRegex.exec(text)) !== null) {
    positions.push({ name: match[1].trim(), index: match.index });
  }

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].index + `[DOC:${positions[i].name}]`.length;
    const end = i < positions.length - 1 ? positions[i + 1].index : text.length;
    const content = text.slice(start, end).trim();
    result.set(positions[i].name, content);
  }

  return result;
}
