/**
 * visual-judge — AI 验证视觉判定兜底（v8.3.350+）
 *
 * 三级执行通道的末级兜底：宿主 AI 无多模态能力时，只操作页面截图、不判定，
 * 在 results.json 中写 judged:false + screenshots。本模块用视觉模型（qwen-vl 默认）
 * 对「截图 + 预期结果原文」做业务断言，回写判定结果。
 *
 * 判定原则：业务断言为主——截图是否符合 plan.json 中该场景的预期结果。
 */

import { join, dirname, isAbsolute } from 'path';
import { readFile, writeFile } from 'fs-extra';
import type { VisualModelConfig, VisualModelResult } from '../ui-verify/visual-model-client';
import { callVisualModel, isVisualModelAvailable } from '../ui-verify/visual-model-client';
import { logger } from '../../utils/logger';
import type { AiVerifyPlan, AiVerifyResult, AiVerifyResults } from './types';

/** 待判定场景（judged:false 且有截图） */
export interface PendingJudgement {
  result: AiVerifyResult;
  screenshotPaths: string[];
}

/** 找出 results 中待视觉判定的场景（judged 不为 true 且有截图） */
export function findPendingJudgements(results: AiVerifyResults): PendingJudgement[] {
  return results.results
    .filter((r) => r.judged !== true && Array.isArray(r.screenshots) && r.screenshots.length > 0)
    .map((r) => ({ result: r, screenshotPaths: r.screenshots || [] }));
}

/** 业务断言 prompt：预期结果 + 截图 → passed/analysis */
function buildJudgementPrompt(scenarioTitle: string, expected: string[]): string {
  const expectLines = expected.length > 0 ? expected.map((e) => `- ${e}`).join('\n') : '（无明确预期，请判断页面是否正常渲染、无明显错误）';
  return `你是一个 Web 功能验收测试员。请判断「${scenarioTitle}」的页面截图是否符合以下预期结果：

预期结果：
${expectLines}

请仅依据截图内容判定（无法从截图确认的事项视为不符合预期），并按以下 JSON 格式输出，不要输出其他内容：
{
  "passed": true/false,
  "analysis": "判定理由（中文，200字以内）：截图中的哪些可见内容支持或否定预期"
}`;
}

/**
 * 用视觉模型判定单个待判定场景。
 * @param result 待判定结果（会被改写）
 * @param screenshotPaths 截图相对路径（相对 outDir）
 * @param outDir 剧本输出目录
 * @param plan 剧本（取场景标题与预期结果）
 * @param config 视觉模型配置
 */
export async function judgeScenario(
  result: AiVerifyResult,
  screenshotPaths: string[],
  outDir: string,
  plan: AiVerifyPlan,
  config: VisualModelConfig
): Promise<void> {
  const scenario = plan.scenarios.find((s) => s.id === result.scenarioId);
  const title = scenario?.title || result.scenarioId;
  const expected = scenario?.expected || [];

  // 依次尝试截图，取第一张可读的
  let currentImageBase64: string | null = null;
  for (const shot of screenshotPaths) {
    const abs = isAbsolute(shot) ? shot : join(outDir, shot);
    try {
      currentImageBase64 = (await readFile(abs)).toString('base64');
      break;
    } catch {
      continue;
    }
  }
  if (!currentImageBase64) {
    result.judged = true;
    result.executor = 'visual-judge';
    result.passed = false;
    result.reason = '视觉判定失败：截图文件缺失或无法读取';
    return;
  }

  let verdict: VisualModelResult;
  try {
    // 业务断言：用自定义 prompt 替代内置 UI 质量扫描（预期结果 + 截图 → passed/analysis）
    verdict = await callVisualModel(config, {
      scenarioName: title,
      currentImageBase64,
      threshold: 'normal',
      customPrompt: buildJudgementPrompt(title, expected),
    });
  } catch (error: any) {
    result.judged = true;
    result.executor = 'visual-judge';
    result.passed = false;
    result.reason = `视觉模型调用失败: ${error.message || String(error)}`;
    return;
  }

  result.executor = 'visual-judge';
  result.judged = true;
  result.passed = verdict.passed;
  result.reason = verdict.analysis || (verdict.passed ? '截图符合预期' : '截图不符合预期');
}

/**
 * 兜底判定入口：对 results 中所有待判定场景逐个判定并回写。
 * 返回判定数量；无待判定场景返回 0。
 */
export async function runAiJudge(
  resultsPath: string,
  plan: AiVerifyPlan,
  config?: VisualModelConfig
): Promise<number> {
  const outDir = dirname(resultsPath);

  const results = JSON.parse(await readFile(resultsPath, 'utf-8')) as AiVerifyResults;
  const pending = findPendingJudgements(results);
  if (pending.length === 0) {
    logger.info('ℹ️ 没有待视觉判定的场景（所有场景均已判定或缺少截图）');
    return 0;
  }

  if (!config) {
    logger.error('❌ 未配置视觉模型（.speccore.yml 的 quality_gates.verify_ui.visual_model 或环境变量 DASHSCOPE_API_KEY）');
    throw new Error('视觉模型不可用，无法执行 --ai-judge 兜底判定');
  }
  if (!(await isVisualModelAvailable(config))) {
    logger.error('❌ 视觉模型不可用：未配置 API Key（DASHSCOPE_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY）');
    throw new Error('视觉模型不可用，无法执行 --ai-judge 兜底判定');
  }

  logger.info(`🤖 视觉判定兜底：${pending.length} 个场景待判定（provider: ${config.provider}）`);
  for (const item of pending) {
    const before = item.result.passed;
    await judgeScenario(item.result, item.screenshotPaths, outDir, plan, config);
    const mark = item.result.passed ? '✅' : '❌';
    logger.info(`   ${mark} ${item.result.scenarioId}（判定前 passed=${before}）`);
  }

  // 判定结果回写 results.json（executor/judged/passed/reason 已被改写）
  await writeFile(resultsPath, JSON.stringify(results, null, 2), 'utf-8');
  return pending.length;
}
