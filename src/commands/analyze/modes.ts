/**
 * analyze 模式注册表（Strategy 模式）——detect 谓词与处理器解耦。
 * 注册顺序即优先级，与旧 analyzeCommand if 瀑布的检测顺序完全一致；
 * 命中即退出（handle 返回 true），唯一例外 --context-guard 可能返回 false 继续往下走。
 * v8.3.359+: 从 analyzeCommand 的 if 瀑布抽取（渐进重构批次 F，逻辑不搬家、行为不变）
 */
import type { AnalyzeOptions } from './shared';
import { analyzeFromCode } from './from-code';
import { analyzeAuditFix } from './audit-fix';
import { analyzeContextGuard } from './context-guard';
import { analyzeIncrementalMode } from './incremental';
import { analyzeAddPlatformMode } from './add-platform';
import { analyzeModuleMode } from './module';
import { analyzeFeatureMode } from './feature';
import { analyzeDocMode } from './doc';
import { analyzeOverviewMode } from './overview';
import { analyzeUnitModes } from './units';

interface AnalyzeModeStrategy {
  /** 模式名（调试/日志用） */
  name: string;
  /** 检测谓词：选项是否命中该模式 */
  detect: (options: AnalyzeOptions) => boolean;
  /** 处理器：返回 true 表示已处理完成，analyzeCommand 应退出 */
  handle: (options: AnalyzeOptions, projectRoot: string) => Promise<boolean>;
}

/** 模式注册表——顺序即优先级，与旧 if 瀑布检测顺序一致 */
const MODE_STRATEGIES: AnalyzeModeStrategy[] = [
  {
    // --from-code 模式: 从源码反推需求（两跳 IR→UR）+ 全局技术分析
    // v8.3.184+: CLI 确定性产出「逐模块 IR 骨架 + 合成 UR 骨架 + 两跳 prompt + 全局技术分析文档集」，
    //           宿主 AI 完成语义抽象
    name: 'from-code',
    detect: (o) => !!o.fromCode,
    handle: async (o) => { await analyzeFromCode(o); return true; },
  },
  {
    // --full 模式: 委托给 synthesizeCommand（原 synthesize 命令）
    // v8.3.1+ 修复：--phase 不再委托给 synthesize，analyze 的 Phase 1/2 由 analyze 自己处理
    // 原因：analyze --phase 2 应该生成端级文档（{端}/TECH.md/DEV_GUIDE.md），
    //       而 synthesize --phase 2 是跨端关系提取（CROSS_PLATFORM.md/ARCHITECTURE.md），
    //       两者完全不同，委托会导致用户永远无法执行 analyze 的 Phase 2
    name: 'full',
    detect: (o) => !!o.full,
    handle: async (o) => {
      const { synthesizeCommand } = await import('../synthesize');
      await synthesizeCommand({
        iteration: o.iteration,
        withCode: o.withCode,
        prompt: o.prompt,
        apply: o.apply,
        full: o.full,
        phase: o.phase,
        applyPhase: o.applyPhase,
      });
      return true;
    },
  },
  {
    // --audit-fix 模式: 读取质量审计报告并生成修复指令
    name: 'audit-fix',
    detect: (o) => !!o.auditFix,
    handle: async (o) => { await analyzeAuditFix(o); return true; },
  },
  {
    // v6.75.0+: 上下文爆炸防护（--context-guard / --estimate-only）
    // 唯一允许 fallthrough 的模式：handle 返回 false 时继续后续模式检测
    name: 'context-guard',
    detect: (o) => !!(o.contextGuard || o.estimateOnly),
    handle: async (o) => analyzeContextGuard(o),
  },
  {
    // v6.75.0+: 增量分析模式（--incremental / --reanalyze）
    name: 'incremental',
    detect: (o) => !!(o.incremental || o.reanalyze),
    handle: async (o) => { await analyzeIncrementalMode(o); return true; },
  },
  {
    // v6.75.0+: 新增端分析模式（--add-platform）
    name: 'add-platform',
    detect: (o) => !!o.addPlatform,
    handle: async (o) => { await analyzeAddPlatformMode(o); return true; },
  },
  {
    // v6.76.0+: 功能模块级全局分析（--module）
    name: 'module',
    detect: (o) => !!o.module,
    handle: async (o) => { await analyzeModuleMode(o); return true; },
  },
  {
    // --feature 模式: 局部刷新单个功能模块
    name: 'feature',
    detect: (o) => !!o.feature,
    handle: async (o, root) => { await analyzeFeatureMode(o, root); return true; },
  },
  {
    // --doc 模式: 局部刷新单个类型文档（bugs/refactors/research）
    name: 'doc',
    detect: (o) => !!o.doc,
    handle: async (o, root) => { await analyzeDocMode(o, root); return true; },
  },
  {
    // v8.3.177+: 总览生成模式（--scope=overview --phase=skeleton|full）
    name: 'overview',
    detect: (o) => o.scope === 'overview',
    handle: async (o) => { await analyzeOverviewMode(o); return true; },
  },
  {
    // v8.2.0+: 功能单元聚焦分析模式（--extract-units / --unit / --consolidate / --resume-units / --auto-units）
    name: 'unit-modes',
    detect: (o) => !!(o.extractUnits || o.unit || o.consolidate || o.resumeUnits || o.autoUnits),
    handle: async (o, root) => { await analyzeUnitModes(o, root); return true; },
  },
];

/**
 * 按注册表顺序分发模式：首个 detect 命中的策略执行 handle，
 * 返回 true 表示已处理完成（analyzeCommand 应退出）。
 */
export async function dispatchAnalyzeModes(options: AnalyzeOptions, projectRoot: string): Promise<boolean> {
  for (const strategy of MODE_STRATEGIES) {
    if (!strategy.detect(options)) continue;
    return await strategy.handle(options, projectRoot);
  }
  return false;
}
