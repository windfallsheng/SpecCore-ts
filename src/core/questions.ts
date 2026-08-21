/**
 * questions — AI 自动模式疑问清单管理
 *
 * 自动模式下 AI 不询问用户，有疑问时写入 .speccore/questions/ 目录。
 * 文件命名: {命令}-{迭代或任务名}-{日期}-{时间}.md
 */
import { writeFile, ensureDir, pathExists, readFile, readdir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';

/** 疑问条目 */
export interface QuestionItem {
  /** 疑问分类标签（如: 需求边界、技术选型、依赖风险、任务粒度） */
  category: string;
  /** 问题描述 */
  question: string;
  /** AI 的判断/决策 */
  decision: string;
  /** 建议后续动作 */
  suggestion?: string;
}

/** 疑问清单上下文 */
export interface QuestionContext {
  /** 命令名（split/analyze/execute/plan/change/done） */
  command: string;
  /** 迭代名或任务名 */
  scope: string;
  /** 额外信息（如粒度、模式等） */
  meta?: string;
}

const QUESTIONS_DIR = join('.speccore', 'questions');

/**
 * 生成疑问清单文件路径
 * 格式: {command}-{scope}-{YYYYMMDD}-{HHmmss}.md
 */
function getQuestionFilePath(command: string, scope: string): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0].replace(/-/g, '');
  const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
  // 清理 scope 中的特殊字符
  const cleanScope = scope.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 30);
  const fileName = `${command}-${cleanScope}-${date}-${time}.md`;
  return join(QUESTIONS_DIR, fileName);
}

/**
 * 写入疑问清单文件
 */
export async function writeQuestions(
  context: QuestionContext,
  questions: QuestionItem[],
): Promise<string> {
  await ensureDir(QUESTIONS_DIR);
  const filePath = getQuestionFilePath(context.command, context.scope);

  let content = `# 疑问清单 — ${context.command} / ${context.scope}\n\n`;
  content += `> 生成时间: ${new Date().toLocaleString('zh-CN')}\n`;
  if (context.meta) content += `> ${context.meta}\n`;
  content += `\n---\n\n`;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    content += `## 疑问 ${i + 1} — ${q.category}\n\n`;
    content += `- **问题**: ${q.question}\n`;
    content += `- **判断**: ${q.decision}\n`;
    if (q.suggestion) {
      content += `- **建议**: ${q.suggestion}\n`;
    }
    content += `\n`;
  }

  await writeFile(filePath, content, 'utf-8');
  logger.info(`   📝 疑问清单 → ${filePath}（${questions.length} 项）`);
  return filePath;
}

/**
 * 追加疑问到已有清单文件
 */
export async function appendQuestions(
  existingFilePath: string,
  questions: QuestionItem[],
): Promise<void> {
  let existing = '';
  if (await pathExists(existingFilePath)) {
    existing = await readFile(existingFilePath, 'utf-8');
  }

  // 计算已有疑问数
  const existingCount = (existing.match(/^## 疑问 /gm) || []).length;

  let addition = '';
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    addition += `\n## 疑问 ${existingCount + i + 1} — ${q.category}\n\n`;
    addition += `- **问题**: ${q.question}\n`;
    addition += `- **判断**: ${q.decision}\n`;
    if (q.suggestion) {
      addition += `- **建议**: ${q.suggestion}\n`;
    }
  }

  await writeFile(existingFilePath, existing + addition, 'utf-8');
  logger.info(`   📝 追加 ${questions.length} 项疑问 → ${existingFilePath}`);
}

/**
 * 从 AI 输出文本中提取疑问条目
 * 
 * 匹配格式:
 * ## 疑问 N — 分类标签
 * - **问题**: ...
 * - **判断**: ...
 * - **建议**: ...
 */
export function extractQuestionsFromText(text: string): QuestionItem[] {
  const questions: QuestionItem[] = [];
  // 匹配 "## 疑问 N — 分类" 或 "## 疑问 N - 分类"
  const questionBlocks = text.split(/(?=^## \s*疑问\s+\d+)/m);
  
  for (const block of questionBlocks) {
    if (!block.match(/^## \s*疑问\s+\d+/)) continue;
    
    // 提取分类标签
    const categoryMatch = block.match(/^## \s*疑问\s+\d+\s*[—\-–]\s*(.+)$/m);
    const category = categoryMatch ? categoryMatch[1].trim() : '未分类';
    
    // 提取问题/判断/建议
    const questionMatch = block.match(/\*\*问题\*\*[：:]\s*(.+)/);
    const decisionMatch = block.match(/\*\*判断\*\*[：:]\s*(.+)/);
    const suggestionMatch = block.match(/\*\*建议\*\*[：:]\s*(.+)/);
    
    if (questionMatch && decisionMatch) {
      questions.push({
        category,
        question: questionMatch[1].trim(),
        decision: decisionMatch[1].trim(),
        suggestion: suggestionMatch ? suggestionMatch[1].trim() : undefined,
      });
    }
  }
  return questions;
}

/**
 * 收集 .speccore/questions/ 目录下所有疑问清单文件
 * 返回按时间排序的文件路径列表
 */
export async function collectQuestionFiles(): Promise<string[]> {
  const questionsDir = join('.speccore', 'questions');
  if (!(await pathExists(questionsDir))) return [];
  const files = await readdir(questionsDir);
  return files
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => join(questionsDir, f));
}

/**
 * 判断是否为自动模式（非交互模式）
 * 统一判断: 没有 --interactive 或 --strict 标记时为自动模式
 */
export function isAutoMode(options: { interactive?: boolean; strict?: boolean }): boolean {
  return !options.interactive && !options.strict;
}

/**
 * 构建 AI prompt 中的自动模式指令片段
 * 所有 AI 命令的 prompt 都应包含此片段
 */
export function buildAutoModeInstruction(command: string, scope: string): string {
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  return [
    `## 🤖 自动模式指令`,
    ``,
    `本操作在自动模式下执行，请遵循以下原则:`,
    `1. **不要询问用户** — 按你的最佳判断直接执行，不要请求确认或澄清`,
    `2. **有疑问就记录** — 如果对需求理解、技术选型、执行边界有疑问，不要停下来问，而是:`,
    `   - 按你的最佳判断继续执行`,
    `   - 将疑问写入 \`.speccore/questions/${command}-${scope}-${date}-*.md\``,
    `   - 格式: \`## 疑问 N — 分类标签\\n- **问题**: ...\\n- **判断**: ...\\n- **建议**: ...\``,
    `3. **遇阻断就跳过** — 如果某个部分信息不足无法处理，跳过它并在疑问清单中记录`,
    `4. **直接输出结果** — 不要输出多余的解释或确认请求`,
    ``,
  ].join('\n');
}
