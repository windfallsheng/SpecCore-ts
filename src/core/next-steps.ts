/**
 * next-steps — 每个阶段完成时提示下一步操作
 */
import { logger } from '../utils/logger';

interface StepHint {
  action: string;      // 命令
  desc: string;        // 说明
  args?: string;        // 常用参数
}

export function showNextSteps(stage: string, context: Record<string, string> = {}): void {
  const hints = getHints(stage, context);
  if (hints.length === 0) return;

  logger.info('\n📋 下一步:');
  for (const h of hints) {
    logger.info(`  ${h.action}`);
    logger.info(`     ${h.desc}`);
    if (h.args) logger.info(`     常用参数: ${h.args}`);
  }
  logger.info('');
}

function getHints(stage: string, ctx: Record<string, string>): StepHint[] {
  const iter = ctx.iteration || '';

  switch (stage) {
    case 'init':
      return [
        { action: 'speccore iteration create --name=Q3', desc: '创建第一个期次', args: '--from/--to 指定时间范围' },
        { action: 'speccore import --project=backend --path=./src', desc: '导入现有代码到全量层', args: '--type backend|frontend|shell' },
      ];

    case 'word2spec':
      return [
        { action: `speccore analyze${iter ? ` --iteration=${iter}` : ''}`, desc: '分析需求：完整性 + 源码对标 + 架构影响 → ANALYSIS.md', args: '--auto 跳过交互直接生成报告' },
        { action: 'cat 期次-' + (iter || 'X') + '/00-需求文档/ANALYSIS.md', desc: '查看分析报告，填写技术方案部分' },
      ];

    case 'analyze':
      return [
        { action: `├─ 阻断问题 → 修复后再继续`, desc: '' },
        { action: `└─ 无阻断 → speccore iteration split${iter ? ` --iteration=${iter}` : ''}`, desc: '拆分需求为 Task', args: '--strict 逐 Task 预览确认' },
        { action: `补全技术方案:`, desc: '编辑 ANALYSIS.md 中的「技术方案」部分（选型/DB变更/接口依赖）' },
      ];

    case 'split':
      return [
        { action: `cat 期次-${iter || 'X'}/IMPACT.md`, desc: '查看风险评分 + 任务依赖关系' },
        { action: `speccore execute --task=Task-001 --strict --force${iter ? ` --iteration=${iter}` : ''}`, desc: '严格模式开发：逐项确认后再生成代码' },
        { action: `speccore execute --all --force${iter ? ` --iteration=${iter}` : ''}`, desc: '快速模式开发：AI 自动生成所有 Task 代码' },
        { action: `speccore lifecycle --all${iter ? ` --iteration=${iter}` : ''}`, desc: '查看任务看板' },
      ];

    case 'execute':
      return [
        { action: `speccore lifecycle --task=${ctx.task || 'Task-001'} --status=testing`, desc: '推进到测试阶段' },
        { action: `speccore lifecycle --task=${ctx.task || 'Task-001'} --check`, desc: '检查 TEST.md / REVIEW.md 进度' },
        { action: `speccore validate --task=${ctx.task || 'Task-001'}`, desc: '校验 Spec 一致性' },
      ];

    case 'lifecycle':
      return [
        { action: '参照 backend/TEST.md 逐项验证', desc: '测试通过后推进', args: `speccore lifecycle --task=${ctx.task || 'Task-001'} --status=review` },
        { action: '对照 backend/REVIEW.md 审查', desc: '审查通过后推进', args: `speccore lifecycle --task=${ctx.task || 'Task-001'} --status=done` },
        { action: `speccore archive --task=${ctx.task || 'Task-001'}`, desc: '归档完成的任务' },
      ];

    case 'archive':
      return [
        { action: `speccore sync-global --iteration=${iter || 'Q3'} --direction=to_global`, desc: '同步到全量层' },
        { action: 'speccore dashboard', desc: '查看全景仪表盘' },
        { action: 'speccore retro', desc: '迭代回顾' },
      ];

    default:
      return [];
  }
}
