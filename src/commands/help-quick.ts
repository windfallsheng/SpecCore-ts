/**
 * help-quick — 精简帮助，核心流程展示
 */
import { logger } from '../utils/logger';

export function showQuickHelp(): void {
  logger.info('');
  logger.info('╔══════════════════════════════════════════════╗');
  logger.info('║         SpecCore — Code by Spec               ║');
  logger.info('╚══════════════════════════════════════════════╝');
  logger.info('');
  logger.info('  快速开始 (7 步):');
  logger.info('');
  logger.info('  1️⃣  speccore init');
  logger.info('  2️⃣  speccore word2spec --files "a.docx=端1"');
  logger.info('  3️⃣  speccore analyze');
  logger.info('  4️⃣  speccore iteration split');
  logger.info('  5️⃣  speccore execute --task=Task-001 --force');
  logger.info('  6️⃣  speccore pr --task=Task-001');
  logger.info('  7️⃣  speccore done --task=Task-001');
  logger.info('');
  logger.info('  💡 不确定用什么命令？直接说需求:');
  logger.info('     speccore spec "新增订单导出功能"');
  logger.info('     speccore spec "修复支付回调超时"');
  logger.info('');
  logger.info('  📖 全部 67 个命令: speccore --help');
  logger.info('  📖 场景实战: docs/场景实战.md (32 个场景)');
  logger.info('');
}

export function showPhaseHelp(phase: string): void {
  const phases: Record<string, { title: string; cmds: string[] }> = {
    setup: {
      title: '项目初始化',
      cmds: ['init', 'iteration create', 'import', 'config'],
    },
    require: {
      title: '需求管理',
      cmds: ['word2spec', 'analyze [--task]', 'spec', 'change', 'tracker'],
    },
    develop: {
      title: '任务开发',
      cmds: ['iteration split', 'execute [--strict|--skip|--only|--batch-size|--base]', 'new-task', 'bugfix'],
    },
    review: {
      title: '审查合并',
      cmds: ['lifecycle', 'pr', 'merge-check', 'validate', 'review'],
    },
    release: {
      title: '发布运维',
      cmds: ['done', 'rollback', 'archive', 'arch-update', 'sync', 'dashboard'],
    },
  };

  const p = phases[phase];
  if (!p) { showQuickHelp(); return; }
  
  logger.info(`\n📋 ${p.title}:`);
  for (const cmd of p.cmds) {
    logger.info(`  speccore ${cmd}`);
  }
}
