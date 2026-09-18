/**
 * handoff-generator — 阶段传递摘要生成器
 *
 * 每个 Pipeline 阶段完成后，生成精简的传递摘要给下一阶段 AI 使用。
 * 核心原则：完整版存文件，传递版只给下一阶段 AI 看。
 */
import { pathExists, readFile, readdir, writeFile, ensureDir } from 'fs-extra';
import { join } from 'path';

export type HandoffStage = 'analyze' | 'split' | 'plan' | 'execute' | 'review' | 'done';

interface HandoffConfig {
  maxLines: number;
  requiredSections: string[];
}

const HANDOFF_LIMITS: Record<string, HandoffConfig> = {
  'analyze-split': { maxLines: 60, requiredSections: ['modules', 'dependencies', 'constraints'] },
  'split-plan': { maxLines: 60, requiredSections: ['tasks', 'dependencies', 'staffing'] },
  'plan-execute': { maxLines: 150, requiredSections: ['currentTask', 'upstreamContracts', 'globalConstraints'] },
  'execute-review': { maxLines: 80, requiredSections: ['deliverables', 'acceptanceCriteria'] },
  'review-done': { maxLines: 40, requiredSections: ['reviewResults', 'openIssues'] },
};

/**
 * 生成阶段传递摘要
 */
export async function generateHandoff(
  from: HandoffStage,
  to: HandoffStage,
  iteration: string
): Promise<string> {
  const iterDir = `Iteration-${iteration.replace(/^Iteration-/, '')}`;
  const handoffDir = join('.speccore', 'local', 'handoffs');
  await ensureDir(handoffDir);

  const handoffKey = `${from}-${to}`;
  const config = HANDOFF_LIMITS[handoffKey];
  if (!config) {
    throw new Error(`未知阶段传递: ${from} → ${to}`);
  }

  const summary = await buildHandoffContent(from, to, iterDir, config);
  const handoffPath = join(handoffDir, `handoff-${handoffKey}.md`);
  await writeFile(handoffPath, summary);

  return handoffPath;
}

/**
 * 构建传递摘要内容
 */
async function buildHandoffContent(
  from: HandoffStage,
  to: HandoffStage,
  iterDir: string,
  config: HandoffConfig
): Promise<string> {
  const lines: string[] = [];

  // 头部信息
  lines.push(`# 阶段传递：${from} → ${to}`);
  lines.push('');
  lines.push('## 1. 核心信息');
  lines.push('');
  lines.push(`| 项目 | 内容 |`);
  lines.push(`| :--- | :--- |`);
  lines.push(`| 迭代 | ${iterDir} |`);
  lines.push(`| 阶段 | ${from} → ${to} |`);
  lines.push(`| 时间 | ${new Date().toISOString().split('T')[0]} |`);
  lines.push('');

  // 根据阶段组合生成不同内容
  switch (`${from}-${to}`) {
    case 'analyze-split':
      await appendAnalyzeToSplit(lines, iterDir);
      break;
    case 'split-plan':
      await appendSplitToPlan(lines, iterDir);
      break;
    case 'plan-execute':
      await appendPlanToExecute(lines, iterDir);
      break;
    case 'execute-review':
      await appendExecuteToReview(lines, iterDir);
      break;
    case 'review-done':
      await appendReviewToDone(lines, iterDir);
      break;
  }

  // 文件引用
  lines.push('');
  lines.push('## 文件引用（需要时自行读取）');
  lines.push('');
  lines.push('| 文件 | 路径 | 用途 |');
  lines.push('| :--- | :--- | :--- |');
  lines.push(`| 完整需求 | ${iterDir}/010-requirements/converted/ | 查看需求细节 |`);
  lines.push(`| 功能单元 | ${iterDir}/010-requirements/features/ | 按模块查看需求 |`);
  lines.push(`| 全局规格 | ${iterDir}/020-specs/overview/ | 查看分析结果 |`);
  lines.push('');

  const result = lines.join('\n');

  // 校验行数上限
  const lineCount = result.split('\n').length;
  if (lineCount > config.maxLines) {
    // 截断到上限
    const truncated = result.split('\n').slice(0, config.maxLines).join('\n');
    return truncated + `\n\n> ⚠️ 摘要已截断（原 ${lineCount} 行 > 上限 ${config.maxLines} 行）\n`;
  }

  return result;
}

/**
 * analyze → split: 功能模块清单 + 依赖关系 + 关键约束
 */
async function appendAnalyzeToSplit(lines: string[], iterDir: string): Promise<void> {
  const featuresDir = join(iterDir, '010-requirements', 'features');

  lines.push('## 2. 功能模块清单');
  lines.push('');
  lines.push('| 模块 | 涉及端 | 优先级 | 依赖 | 摘要 |');
  lines.push('| :--- | :--- | :--- | :--- | :--- |');

  if (await pathExists(featuresDir)) {
    const entries = await readdir(featuresDir, { withFileTypes: true });
    const units = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));
    for (const unit of units.slice(0, 20)) { // 限制行数
      const readmePath = join(featuresDir, unit.name, 'README.md');
      let summary = '';
      if (await pathExists(readmePath)) {
        const content = await readFile(readmePath, 'utf-8');
        const firstLine = content.split('\n')[0] || '';
        summary = firstLine.replace(/^#\s*/, '').slice(0, 30);
      }
      lines.push(`| ${unit.name} | 待分析 | 中 | 无 | ${summary} |`);
    }
  } else {
    lines.push('| (未拆分) | 全部 | 中 | 无 | 见 converted/ |');
  }

  lines.push('');
  lines.push('## 3. 依赖关系');
  lines.push('');
  lines.push('```mermaid');
  lines.push('flowchart LR');
  lines.push('    A[需求分析] --> B[任务拆分]');
  lines.push('```');
  lines.push('');
  lines.push('## 4. 关键约束（≤5条）');
  lines.push('');
  lines.push('- 待 analyze 阶段补充');
  lines.push('');
}

/**
 * split → plan: 任务清单 + 人员配置 + 关键路径
 */
async function appendSplitToPlan(lines: string[], iterDir: string): Promise<void> {
  const tasksDir = join(iterDir, '030-tasks');

  lines.push('## 2. 任务清单');
  lines.push('');
  lines.push('| 任务 ID | 名称 | 依赖 | 工时 | 涉及端 |');
  lines.push('| :--- | :--- | :--- | :--- | :--- |');

  if (await pathExists(tasksDir)) {
    const entries = await readdir(tasksDir, { withFileTypes: true });
    const tasks = entries.filter(e => e.isDirectory() && e.name.startsWith('Task-'));
    for (const task of tasks.slice(0, 30)) {
      lines.push(`| ${task.name} | 待填写 | 无 | 待评估 | 待分析 |`);
    }
  } else {
    lines.push('| Task-001 | 示例任务 | 无 | 8h | 全部 |');
  }

  lines.push('');
  lines.push('## 3. 关键路径');
  lines.push('');
  lines.push('- 待 plan 阶段计算');
  lines.push('');
}

/**
 * plan → execute: 当前任务 Spec + 上游依赖契约
 */
async function appendPlanToExecute(lines: string[], iterDir: string): Promise<void> {
  lines.push('## 2. 当前任务规格');
  lines.push('');
  lines.push('- 执行时由 CLI 动态加载当前任务的 REQ.md + TECH.md');
  lines.push('- 只加载当前任务，不加载其他任务');
  lines.push('');
  lines.push('## 3. 上游依赖契约');
  lines.push('');
  lines.push('- 由 CLI 自动读取上游任务的 `_shared/API_CONTRACT.yaml`');
  lines.push('- 只传契约，不传实现');
  lines.push('');
  lines.push('## 4. 全局约束');
  lines.push('');
  lines.push('- 技术栈见 CONSTITUTION.md');
  lines.push('- 命名规范见 PROJECT.yaml');
  lines.push('');
}

/**
 * execute → review: 产出物清单 + 验收标准
 */
async function appendExecuteToReview(lines: string[], iterDir: string): Promise<void> {
  lines.push('## 2. 产出物清单');
  lines.push('');
  lines.push('- 代码文件（CONSTITUTION.md 指定的源码路径）');
  lines.push('- 测试用例（TEST.md）');
  lines.push('- API 契约（_shared/API_CONTRACT.yaml）');
  lines.push('');
  lines.push('## 3. 验收标准');
  lines.push('');
  lines.push('- 编译通过');
  lines.push('- 测试通过');
  lines.push('- 无占位符');
  lines.push('');
}

/**
 * review → done: 审查结果 + 未解决问题
 */
async function appendReviewToDone(lines: string[], iterDir: string): Promise<void> {
  lines.push('## 2. 审查结果');
  lines.push('');
  lines.push('- 待 review 阶段填写');
  lines.push('');
  lines.push('## 3. 未解决问题');
  lines.push('');
  lines.push('- [ ] 待确认');
  lines.push('');
}

/**
 * 读取 handoff 文件路径
 */
export function getHandoffPath(from: HandoffStage, to: HandoffStage): string {
  return join('.speccore', 'local', 'handoffs', `handoff-${from}-${to}.md`);
}

/**
 * 检查 handoff 是否存在
 */
export async function handoffExists(from: HandoffStage, to: HandoffStage): Promise<boolean> {
  return pathExists(getHandoffPath(from, to));
}
