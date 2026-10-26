/**
 * 命令面收敛名单（v8.3.346+）
 *
 * help 面板（speccore --help）只展示核心命令，其余命令隐藏但功能保留——
 * ask 引擎意图词典、run 流水线编排、内部逻辑调用仍直接可用，只是不再占用面板。
 * 全量清单入口: speccore help --all
 *
 * 单一事实源：cli.ts（隐藏遍历）与 help.ts（--all 全量视图）共同消费此名单，
 * 增删命令时只需改这一处。
 */
export const CORE_COMMANDS: ReadonlySet<string> = new Set([
  // 流水线 13 阶段
  'init', 'doc2spec', 'req-doc', 'unitize', 'analyze', 'taskify', 'plan',
  'execute', 'verify', 'pipeline', 'pr', 'done', 'spec2doc',
  // 基础管理
  'iteration', 'task',
  // 智能入口与友好辅助
  'ask', 'run', 'next', 'dashboard', 'status', 'about', 'help',
]);

export function isCoreCommand(name: string): boolean {
  return CORE_COMMANDS.has(name);
}
