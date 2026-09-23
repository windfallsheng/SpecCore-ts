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
    case 'iteration-create':
      return [
        { action: `speccore doc2spec -f <PRD文件> --iter=${iter || '<迭代名>'}`, desc: '导入需求文档到 010-requirements/' },
        { action: `speccore analyze --prompt -I ${iter || '<迭代名>'}`, desc: '分析需求 → 生成 020-specs/ 规格文档' },
        { action: `speccore iteration taskify -i ${iter || '<迭代名>'}`, desc: '拆分为开发任务 → 030-tasks/' },
      ];

    case 'init':
      return [
        { action: 'speccore iteration create --name=Q3', desc: '创建该迭代', args: '--from/--to 指定时间范围' },
        // v8.3.260: import 命令已移除，导入现有代码到全量层由 global from-source 承担
        { action: 'speccore global from-source --src ./src', desc: '从现有代码反推需求到全量层', args: '--src 逗号分隔多端源码目录' },
      ];

    case 'doc2spec':
      return [
        { action: `speccore analyze${iter ? ` --iteration=${iter}` : ''}`, desc: '分析需求：完整性 + 源码对标 + 架构影响 → ANALYSIS.md', args: '--auto 跳过交互直接生成报告' },
        { action: 'cat Iteration-' + (iter || 'X') + '/020-specs/overview/ANALYSIS.md', desc: '查看分析报告，填写技术方案部分' },
      ];

    case 'analyze':
      return [
        { action: `speccore iteration taskify${iter ? ` --iteration=${iter}` : ''}`, desc: '拆分需求为 Task (--interactive 预览依赖)', args: '--strict 逐项确认' },
        { action: `如果 ANALYSIS.md 有阻断问题请先修复`, desc: '' },
        { action: `补全技术方案:`, desc: '编辑 ANALYSIS.md 中的技术方案部分（选型/DB变更/接口依赖）' },
      ];

    case 'split':
      return [
        { action: `speccore execute --prompt${iter ? ` -i ${iter}` : ''}`, desc: '🧠 宿主 AI 填充 00-specs/ 后开发（taskify 已预创建骨架）' },
        { action: `cat Iteration-${iter || 'X'}/IMPACT.md`, desc: '查看风险评分 + 任务依赖关系' },
        { action: `speccore execute --task=Task-001 --strict --force${iter ? ` --iteration=${iter}` : ''}`, desc: '严格模式开发：逐项确认后再生成代码' },
        { action: `speccore execute --all --force${iter ? ` --iteration=${iter}` : ''}`, desc: '快速模式开发：AI 自动生成所有 Task 代码' },
        { action: `speccore task list${iter ? ` -i ${iter}` : ''}`, desc: '查看任务看板' },
      ];

    case 'split-units':
      return [
        { action: `speccore analyze -I ${iter || '<迭代>'}`.trim(), desc: '🧠 基于功能单元做需求分析 → 020-specs/（确保无 SPEC-SKELETON 残留）' },
        { action: `speccore iteration taskify${iter ? ` --iteration=${iter}` : ''}`, desc: '功能单元 → 开发任务（Task-*，--interactive 预览）' },
      ];

    case 'execute':
      return [
        { action: `speccore verify --task=${ctx.task || 'Task-001'}`, desc: '验证测试用例与回归（子任务目录/TEST.md）' },
        { action: `speccore validate --task=${ctx.task || 'Task-001'}`, desc: '校验 Spec 一致性' },
      ];

    case 'lifecycle':
      return [
        { action: '参照子任务目录/TEST.md 逐项验证', desc: '测试通过后进入审查', args: `speccore review${iter ? ` -I ${iter}` : ''}` },
        { action: '对照子任务目录/REVIEW.md 审查', desc: '审查通过后归档', args: `speccore archive --task=${ctx.task || 'Task-001'}` },
      ];

    case 'archive':
      return [
        { action: `speccore sync --global --iteration=${iter || 'Q3'} --direction=to_global`, desc: '同步到全量层' },
        { action: 'speccore dashboard', desc: '查看全景仪表盘' },
        { action: 'speccore retro', desc: '迭代回顾' },
      ];

    default:
      return [];
  }
}
