/**
 * analyze 模式：--audit-fix 读取质量审计报告并生成修复指令
 * v8.3.341+: 从 analyzeCommand 抽出的模式早退块
 * v8.3.359+: 从 analyze.ts 拆分（渐进重构批次 B，逻辑不搬家、行为不变）
 */
import { join } from 'path';
import { logger } from '../../utils/logger';
import { getDefaultIteration, getIterationDir } from '../../core/context';
import { emitAiPrompt } from './shared';
import type { AnalyzeOptions } from './shared';

export async function analyzeAuditFix(options: AnalyzeOptions): Promise<void> {
  const iter = options.iteration || await getDefaultIteration();
  if (!iter) { logger.error('请指定迭代: -I <iteration>'); return; }
  const iterDir = await getIterationDir(iter);
  const specDir = join(iterDir, '020-specs');
  const auditPath = join(specDir, 'QUALITY_AUDIT.md');
  if (!(await import('fs-extra')).pathExists(auditPath)) {
    logger.warn('未找到 QUALITY_AUDIT.md，请先运行 speccore analyze 生成质量审计报告');
    return;
  }
  const auditContent = await (await import('fs-extra')).readFile(auditPath, 'utf-8');
  let prompt = `\n# 任务: 质量修复（基于 QUALITY_AUDIT.md）\n\n`;
  prompt += `## 审计报告\n\n${auditContent}\n\n`;
  prompt += `## 修复要求\n`;
  prompt += `1. Read 上述审计报告中标记为 ❌ 和 ⚠️ 的维度\n`;
  prompt += `2. 逐个修复对应文档中的缺失内容：\n`;
  prompt += `   - 后端缺失: 补充 API 接口定义、数据模型、业务规则、错误码\n`;
  prompt += `   - 前端缺失: 补充页面路由表、组件清单、字段→UI 映射、状态枚举、交互设计\n`;
  prompt += `3. 修复后重新运行 \`speccore analyze -I ${iter}\` 重新审计\n`;
  prompt += `4. 最多修复 2 轮，超过 2 轮仍有问题则标记为“需人工确认”\n`;
  prompt += `5. 写入: speccore analyze --apply '{...}' -I ${iter}\n`;
  await emitAiPrompt(iter, prompt, { mode: 'audit-fix' });
  process.exitCode = 10;
}
