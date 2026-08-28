/**
 * l2-ai-arbiter.ts — L2 规范契约 AI 辅助裁决器
 *
 * v8.3.24+: AI 生成修复建议，等待开发者确认
 */

import type { Conflict } from './conflict-types';
import type { Verdict } from './verdict-types';

export interface L2ArbitrationResult {
  verdict?: Verdict;           // 有裁决结果时（如升级到 L3）
  conflict: Conflict;          // 更新后的冲突状态
  suggestedFix?: string;       // AI 修复建议
  needsHumanConfirm: boolean;  // 是否需要人工确认
}

/**
 * L2 裁决：AI 辅助裁决
 * 生成修复建议，将冲突状态改为 pending-fix 等待确认
 */
export async function arbitrateL2(conflict: Conflict): Promise<L2ArbitrationResult> {
  // 生成基于契约类型的修复建议
  const fix = generateFixSuggestion(conflict);

  const updatedConflict: Conflict = {
    ...conflict,
    status: 'pending-fix',
    violation: {
      ...conflict.violation,
      suggestedFix: fix,
    },
    arbiter: 'L2-AI-Arbiter',
  };

  return {
    conflict: updatedConflict,
    suggestedFix: fix,
    needsHumanConfirm: true,
  };
}

/** 根据契约类型生成修复建议 */
function generateFixSuggestion(conflict: Conflict): string {
  const { contractId, message } = conflict.violation;

  switch (contractId) {
    case 'L2-spec-consistency':
      return `【Spec 不一致修复建议】\n1. 对比 REQ.md 验收标准与代码实现\n2. 补充缺失的逻辑分支或校验\n3. 重新运行 speccore execute 验证\n\n具体: ${message}`;

    case 'L2-api-contract':
      return `【API 契约修复建议】\n1. 检查 API_CONTRACT.yaml 中的字段定义\n2. 确保响应 DTO 包含所有必需字段\n3. 确保请求参数校验与契约一致\n\n具体: ${message}`;

    case 'L2-schema':
      return `【Schema 修复建议】\n1. 对比 SCHEMA.md 中的实体定义\n2. 确保数据库字段、Entity、DTO 三者一致\n3. 如有变更，同步更新迁移脚本\n\n具体: ${message}`;

    case 'L2-lint':
      return `【Lint 修复建议】\n1. 运行自动格式化: npx eslint --fix\n2. 检查剩余的手动修复项\n3. 确保代码风格与项目规范一致\n\n具体: ${message}`;

    case 'L2-dev-guide':
      return `【DEV_GUIDE 修复建议】\n1. 对照 DEV_GUIDE 中的改造范围清单\n2. 确认所有要求项已实现\n3. 如有偏差，在 TASK.md 中说明原因\n\n具体: ${message}`;

    case 'L2-test-coverage':
      return `【测试覆盖修复建议】\n1. 对照 TEST.md 中的测试用例\n2. 为新增代码补充单元测试\n3. 确保边界条件和异常路径有覆盖\n\n具体: ${message}`;

    case 'L2-review':
      return `【评审项修复建议】\n1. 对照 REVIEW.md 中的评审清单\n2. 逐项确认已实现或已说明例外\n3. 如有未满足项，补充实现\n\n具体: ${message}`;

    case 'L2-error-code':
      return `【错误码修复建议】\n1. 检查 ERROR_CODES.md 中的定义\n2. 确保代码中使用的错误码与文档一致\n3. 新增错误码需同步更新文档\n\n具体: ${message}`;

    case 'L2-spec-doc-quality':
      return `【文档质量修复建议】\n1. 确保 REQ.md 有明确的验收标准\n2. 确保 TECH.md 有技术方案细节\n3. 补充缺失的字段说明或流程图\n\n具体: ${message}`;

    default:
      return `【通用修复建议】\n1. 分析冲突原因: ${message}\n2. 参考项目规范文档修复\n3. 重新运行验证确认`;
  }
}
