/**
 * requirement-clarifier — 需求专业化模块
 *
 * 将用户原始需求描述（口语化/非专业）整理为 PRD 级专业需求文档。
 * 支持专业度检测、AI 整理 Prompt 构建、结果解析和文件写入。
 *
 * v6.76.0+
 */
import { ensureDir, writeFile, pathExists, readFile } from 'fs-extra';
import { join, basename } from 'path';
import { logger } from '../utils/logger';
import { backupWithTimestamp } from '../utils/task-utils';

/**
 * 检测文档专业度
 * 宽松策略：满足 2+ 个条件即判定为 "low"
 */
export function detectProfessionalLevel(content: string): 'high' | 'medium' | 'low' {
  if (!content || content.trim().length < 50) return 'low';

  const checks = {
    // 1. 口语化检测：大量短句、无标点或口语词
    oral: (() => {
      const oralPatterns = /(我要|我想|能不能|可不可以|帮忙|弄一个|搞一个|加个|改下|顺便|反正|大概|差不多)/g;
      const oralMatches = content.match(oralPatterns);
      const oralRatio = oralMatches ? oralMatches.length / content.length : 0;
      return oralRatio > 0.005; // 口语词密度 > 0.5%
    })(),

    // 2. 无结构化标题：没有 ## 二级标题
    noStructure: !/^#{2,3}\s+/m.test(content),

    // 3. 无验收标准：没有"验收"、"AC"、"验收标准"等关键词
    noAcceptance: !/(验收标准|验收条件|AC[:：]|acceptance criteria|验收准则|测试标准)/i.test(content),

    // 4. 无业务规则：没有"规则"、"约束"、"限制"等关键词
    noRules: !/(业务规则|约束条件|限制条件|校验规则|规则[:：]|rule[:：])/i.test(content),

    // 5. 纯文本段落：没有表格、列表、代码块等结构化元素
    noFormatting: !/(\|.*\|.*\||^\s*[-*]\s+|```)/m.test(content),

    // 6. 无功能边界：没有"范围"、"边界"、"不涉及"等关键词
    noBoundary: !/(功能范围|范围[:：]|边界|不涉及|不包含|排除)/i.test(content),
  };

  const failCount = Object.values(checks).filter(Boolean).length;

  if (failCount >= 4) return 'low';
  if (failCount >= 2) return 'medium';
  return 'high';
}

/**
 * 构建需求专业化 Prompt
 * 让 AI 以专业产品经理角色整理 PRD
 */
export function buildClarifyPrompt(
  rawDesc: string,
  context?: {
    iteration?: string;
    sourceFile?: string;
    existingDocs?: string[];
  }
): string {
  const sections: string[] = [];

  sections.push('# 需求专业化 — 将原始描述整理为 PRD 级需求文档');
  sections.push('');
  sections.push('## 你的角色');
  sections.push('你是资深产品经理 + 领域专家。请将用户的原始需求描述整理为一份专业的需求规格说明书（PRD）。');
  sections.push('');

  sections.push('## 用户原始输入');
  sections.push('```');
  sections.push(rawDesc);
  sections.push('```');
  sections.push('');

  if (context?.sourceFile) {
    sections.push(`> 来源: ${context.sourceFile}`);
    sections.push('');
  }

  sections.push('## 整理要求');
  sections.push('');
  sections.push('### 必须包含的章节');
  sections.push('1. **背景与目标**：为什么要做这个功能，解决什么问题，预期收益');
  sections.push('2. **用户故事**：作为 [角色]，我希望 [目标]，以便 [价值]（可写多个）');
  sections.push('3. **功能规格**：');
  sections.push('   - 功能清单（按模块组织）');
  sections.push('   - 每个功能的详细描述（输入、处理、输出）');
  sections.push('   - 业务规则（校验、约束、状态流转）');
  sections.push('   - 异常场景和边界条件');
  sections.push('4. **验收标准（AC）**：可测试的、具体的验收条件，每条用 [ ] 标记');
  sections.push('5. **非功能需求**：性能、安全、兼容性等（如适用）');
  sections.push('6. **依赖与约束**：依赖的其他系统/模块，技术/业务约束');
  sections.push('');
  sections.push('### 写作规范');
  sections.push('- 使用 Markdown 格式，结构清晰');
  sections.push('- 语言专业、准确，避免口语化表达');
  sections.push('- 技术术语使用行业标准表述');
  sections.push('- 不要添加文档中未提及的功能，不要脑补');
  sections.push('- 如果原始描述不完整，标注「待补充」而不是自行编造');
  sections.push('');

  sections.push('## 输出格式');
  sections.push('直接输出整理后的 Markdown PRD 文档，不要输出 JSON、不要输出解释、不要输出代码块包裹整个文档。');
  sections.push('文档末尾附加「原始输入」章节，记录用户原始描述。');
  sections.push('');

  return sections.join('\n');
}

/**
 * 解析 AI 返回的整理结果
 * 提取 PRD 内容和原始输入
 */
export function parseClarifiedRequirement(response: string): {
  content: string;
  hasOriginalSection: boolean;
} {
  // 移除常见的代码块包裹
  let cleaned = response.trim();
  if (cleaned.startsWith('```markdown')) {
    cleaned = cleaned.slice('```markdown'.length).trim();
  }
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3).trim();
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3).trim();
  }

  const hasOriginalSection = /## 原始输入/.test(cleaned);

  return { content: cleaned, hasOriginalSection };
}

/**
 * 写入澄清后的需求文档
 * 位置: 010-requirements/converted/clarified-{slug}.md
 */
export async function writeClarifiedDoc(
  content: string,
  iterDir: string,
  sourceName: string
): Promise<string> {
  const convertedDir = join(iterDir, '010-requirements', 'converted');
  await ensureDir(convertedDir);

  // 生成文件名：基于来源名 + 时间戳
  const baseName = basename(sourceName, '.md')
    .replace(/[^\w\u4e00-\u9fa5-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'clarified';

  const now = new Date();
  const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const filename = `clarified-${baseName}-${timestamp}.md`;
  const filepath = join(convertedDir, filename);

  // 备份已有文件
  const backup = await backupWithTimestamp(filepath);
  if (backup) {
    logger.info(`   📦 旧版已备份: ${basename(backup)}`);
  }

  await writeFile(filepath, content, 'utf-8');
  return filepath;
}

/**
 * 读取需求文档并检测专业度
 * 返回检测结果和建议
 */
export async function assessRequirementDoc(
  filePath: string
): Promise<{
  level: 'high' | 'medium' | 'low';
  content: string;
  issues: string[];
}> {
  const content = await readFile(filePath, 'utf-8');
  const level = detectProfessionalLevel(content);

  const issues: string[] = [];
  if (level !== 'high') {
    if (!/(验收标准|验收条件|AC[:：]|acceptance criteria)/i.test(content)) {
      issues.push('缺少验收标准（AC）');
    }
    if (!/(业务规则|约束条件|校验规则)/i.test(content)) {
      issues.push('缺少业务规则');
    }
    if (!/^#{2,3}\s+/m.test(content)) {
      issues.push('缺少结构化标题');
    }
    if (/(我要|我想|能不能|可不可以|帮忙|弄一个|搞一个)/g.test(content)) {
      issues.push('存在口语化表述');
    }
  }

  return { level, content, issues };
}

/**
 * 生成澄清后的文档头部元信息
 */
export function buildClarifiedHeader(
  originalSource: string,
  clarifyTime: string = new Date().toISOString()
): string {
  return `---
source: "${originalSource}"
clarified-at: "${clarifyTime}"
status: "clarified"
---

`;
}
