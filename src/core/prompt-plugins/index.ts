/**
 * Prompt 插件系统 — 统一入口
 * v6.93.0
 */
export * from './types';
export { executeRulesPlugin } from './execute-rules-plugin';
export { analyzeGraphPlugin } from './analyze-graph-plugin';
export { agentsPlugin } from './agents-plugin';
export { executeGraphPlugin } from './execute-graph-plugin';

import { registerPromptPlugin } from './types';
import { executeRulesPlugin } from './execute-rules-plugin';
import { analyzeGraphPlugin } from './analyze-graph-plugin';
import { agentsPlugin } from './agents-plugin';
import { executeGraphPlugin } from './execute-graph-plugin';

// 注册所有默认插件
registerPromptPlugin(executeRulesPlugin);
registerPromptPlugin(analyzeGraphPlugin);
registerPromptPlugin(agentsPlugin);
registerPromptPlugin(executeGraphPlugin);
