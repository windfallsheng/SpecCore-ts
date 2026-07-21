/**
 * question-checklist — 从 ANALYSIS.md 提取待确认问题，执行后提醒用户审查
 */
import { readFile, pathExists } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';

export interface Question {
  text: string;
  category: 'requirement' | 'tech' | 'dependency' | 'risk';
  severity: '🔴' | '🟡' | '⚪';
}

/**
 * 从迭代 ANALYSIS.md 提取所有待确认问题
 */
export async function extractQuestions(iterationDir: string): Promise<Question[]> {
  const analysisPath = join(iterationDir, '00-需求文档', 'ANALYSIS.md');
  if (!(await pathExists(analysisPath))) return [];

  const content = await readFile(analysisPath, 'utf-8');
  const questions: Question[] = [];

  // 从「待确认」section 提取
  const pendingSection = content.match(/(?:###\s*待确认|##\s*(?:\d+\.\s*)?待确认)[\s\S]*?(?=###|\n---|$)/);
  if (pendingSection) {
    const items = pendingSection[0].match(/[-*]\s+(\[[ x]\]\s*)?[^\n]+/g) || [];
    for (const item of items) {
      const text = item.replace(/^[-*]\s+(\[[ x]\]\s*)?/, '').trim();
      if (text.length > 5) {
        questions.push({
          text,
          category: detectCategory(text),
          severity: '🟡',
        });
      }
    }
  }

  // 从「阻断问题」提取
  const blockerSection = content.match(/(?:###\s*阻断问题|##\s*Blockers)[\s\S]*?(?=###|\n---|$)/);
  if (blockerSection) {
    const items = blockerSection[0].match(/[-*]\s+.+/g) || [];
    for (const item of items) {
      const text = item.replace(/^[-*]\s+(\[[ x]\]\s*)?/, '').trim();
      if (text.length > 5) {
        questions.push({
          text,
          category: detectCategory(text),
          severity: '🔴',
        });
      }
    }
  }

  // 从需求分析标记提取
  const warnLines = content.match(/[⚠️🟡].+/g) || [];
  for (const line of warnLines) {
    const text = line.replace(/[⚠️🟡]\s*/, '').trim();
    if (text.length > 5 && !questions.some(q => q.text.includes(text.slice(0, 10)))) {
      questions.push({
        text,
        category: 'requirement',
        severity: '🟡',
      });
    }
  }

  return questions;
}

function detectCategory(text: string): Question['category'] {
  if (text.match(/接口|API|端点|endpoint/i)) return 'dependency';
  if (text.match(/技术|框架|选型|DB|数据库|中间件|MQ|Redis/i)) return 'tech';
  if (text.match(/风险|安全|权限|并发|性能/i)) return 'risk';
  return 'requirement';
}

/**
 * 显示问题审查清单
 */
export function showQuestionChecklist(questions: Question[], context: string = ''): void {
  if (questions.length === 0) {
    logger.info('  ✅ 无待确认问题');
    return;
  }

  const blockers = questions.filter(q => q.severity === '🔴');
  const pending = questions.filter(q => q.severity === '🟡');

  logger.info('');
  logger.info(`╔══════════════════════════════════════════╗`);
  logger.info(`║  📋 ${context || '待确认问题清单'} (${questions.length} 项)        ║`);
  logger.info(`╚══════════════════════════════════════════╝`);
  logger.info('');

  if (blockers.length > 0) {
    logger.info(`  🔴 阻断 (${blockers.length}):`);
    for (const q of blockers) {
      logger.info(`    - ${q.text}`);
    }
    logger.info('');
  }

  if (pending.length > 0) {
    logger.info(`  🟡 待确认 (${pending.length}):`);
    for (const q of pending) {
      logger.info(`    - ${q.text}`);
    }
    logger.info('');
  }

  logger.info('  💡 建议: 逐项确认后再执行 speccore done');
  logger.info('');
}
