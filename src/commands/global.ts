import { logger } from '../utils/logger';
import { analyzeCommand } from './analyze';

/**
 * v8.3.255+: speccore global —— 全局层分析独立命令入口
 *
 * 全局层定位（与迭代层 analyze 彻底分家）：
 * - global analyze     : 源码→技术文档（Layer 1→4 自动推进，产物 .speccore/GLOBAL/）
 * - global from-source : 源码→需求文档（反推候选需求，原 spec-from-source 能力）
 * - global rules       : 规则生成指引（产物 .speccore/GLOBAL/RULES/）
 * - global patterns    : 模式沉淀指引（复用 pattern 命令）
 *
 * 实现策略：路由复用 analyzeCommand 的 global 分支引擎（逻辑不搬家、行为不变），
 * 避免把 20 处 global 分支物理搬出 analyze.ts 引入回归风险。
 * 后续版本可逐步把引擎下沉到 core/global-layer 等模块。
 */

export interface GlobalAnalyzeOptions {
  layer?: string | number;
  withCode?: boolean;
  src?: string;
  source?: string;
  platform?: string;
  depth?: string;
  outDir?: string;
  auto?: boolean;
  prompt?: boolean;
  interactive?: boolean;
  [key: string]: unknown;
}

/** 源码→技术文档（Layer 1→4 推进） */
export async function globalAnalyzeCommand(options: GlobalAnalyzeOptions): Promise<void> {
  await analyzeCommand({ ...options, scope: 'global', _fromGlobal: true } as never);
}

/** 源码→需求文档（反推候选需求） */
export async function globalFromSourceCommand(options: GlobalAnalyzeOptions): Promise<void> {
  await analyzeCommand({ ...options, fromCode: true, scope: 'global', _fromGlobal: true } as never);
}

/** 规则生成指引（全局分析产物自动沉淀 RULES/ 候选，此处给出路径） */
export async function globalRulesCommand(): Promise<void> {
  logger.info('');
  logger.info('📐 规则生成（global rules）');
  logger.info('   全局分析会把规则候选沉淀到 .speccore/GLOBAL/RULES/');
  logger.info('   立即执行全局分析: speccore global analyze --layer 1');
  logger.info('   项目规则入口: .speccore/RULES/（appliesTo 匹配技术栈后自动注入 Prompt）');
  logger.info('');
}

/** 模式沉淀指引（复用 pattern 命令保存可复用模式） */
export async function globalPatternsCommand(): Promise<void> {
  logger.info('');
  logger.info('🧩 模式沉淀（global patterns）');
  logger.info('   保存可复用模式模板: speccore pattern -n <名称> -c <内容>');
  logger.info('   自动扫描候选: speccore pattern --auto-detect <目录>');
  logger.info('   已有模式库: .speccore/GLOBAL/PATTERNS/');
  logger.info('');
}
