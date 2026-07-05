/**
 * help - 命令帮助命令
 * 显示所有可用命令、别名和参数说明
 */

import { logger } from '../utils/logger';
import { getAllCommandMappings, getCommandMapping } from '../core/intent-recognition';

export interface HelpOptions {
  command?: string;
  search?: string;
}

export async function helpCommand(options: HelpOptions): Promise<void> {
  if (options.command) {
    await showCommandDetail(options.command);
    return;
  }

  if (options.search) {
    await searchCommands(options.search);
    return;
  }

  showAllCommands();
}

function showAllCommands(): void {
  logger.info('📖 SpecCore 命令帮助');
  logger.info('');

  // 分类显示
  const categories: Record<string, string[]> = {
    '🔍 智能入口': ['spec - 自然语言意图识别，自动匹配命令'],
    '👋 引导与体验': ['welcome - 首次使用引导', 'demo - 快速体验示例项目'],
    '🏗️ 初始化与导入': ['init - 初始化 SpecCore 项目', 'import - 从存量项目导入'],
    '📋 期次管理': ['iteration create - 创建期次', 'iteration split - 需求拆分为任务'],
    '📝 任务管理': ['task new - 创建任务', 'goal - 完整需求交付', 'bugfix - 快速 Bug 修复', 'research - 技术调研'],
    '⚡ 执行与调度': ['plan - 智能调度方案', 'execute - 执行控制中心'],
    '🔄 变更管理': ['change - 需求变更联动', 'sync - 反向同步（代码→Spec）'],
    '✅ 审查与验证': ['review - 审查产出', 'validate - Spec 合规性检查'],
    '📊 进度与状态': ['progress - 进度总览', 'status - 状态看板', 'health - 项目健康度'],
    '📦 归档与交接': ['archive - 归档任务', 'handover - 生成交接文档', 'retro - 期次回顾'],
    '⚙️ 配置与工具': ['config - 配置管理', 'report - 生成项目报告', 'template-add - 添加代码模板'],
  };

  for (const [category, commands] of Object.entries(categories)) {
    logger.info('');
    logger.info(`${category}:`);
    for (const cmd of commands) {
      logger.info(`  speccore ${cmd}`);
    }
  }

  logger.info('');
  logger.info('---');
  logger.info('💡 使用 speccore help --command=<命令名> 查看详细参数');
  logger.info('💡 使用 speccore help --search=<关键词> 搜索相关命令');
}

async function showCommandDetail(commandName: string): Promise<void> {
  const mapping = getCommandMapping(commandName);
  if (!mapping) {
    // 尝试在现有命令中查找
    logger.warn(`未找到命令 "${commandName}"。`);
    logger.info('可用的命令:');
    const all = getAllCommandMappings();
    for (const m of all) {
      logger.info(`  - speccore ${m.id}: ${m.description}`);
    }
    return;
  }

  logger.info(`📖 speccore ${mapping.id}`);
  logger.info('');
  logger.info(`描述: ${mapping.description}`);
  logger.info(`优先级: ${mapping.priority}`);
  logger.info('');
  logger.info('触发关键词:');
  logger.info(`  ${mapping.triggers.join(' / ')}`);
  logger.info('');
  if (mapping.args) {
    logger.info(`参数: ${mapping.args}`);
  }
  logger.info('更多参数请使用 --help 查看。');
}

async function searchCommands(keyword: string): Promise<void> {
  const all = getAllCommandMappings();
  const matched = all.filter(
    (m) =>
      m.id.includes(keyword) ||
      m.description.includes(keyword) ||
      m.triggers.some((t) => t.includes(keyword))
  );

  if (matched.length === 0) {
    logger.warn(`未找到匹配 "${keyword}" 的命令。`);
    return;
  }

  logger.info(`🔍 搜索 "${keyword}" 的结果:`);
  logger.info('');

  for (const m of matched) {
    logger.info(`  speccore ${m.id}`);
    logger.info(`    ${m.description}`);
    logger.info(`    触发: ${m.triggers.slice(0, 3).join(', ')}`);
    logger.info('');
  }
}
