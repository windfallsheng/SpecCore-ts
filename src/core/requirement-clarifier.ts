/**
 * requirement-clarifier — 需求专业化模块
 *
 * 将用户原始需求描述（口语化/非专业）整理为 PRD 级专业需求文档。
 * 支持专业度检测、AI 整理 Prompt 构建、结果解析和文件写入。
 *
 * v6.76.0+
 */
import { ensureDir, writeFile, pathExists, readFile, readdir, stat } from 'fs-extra';
import { join, basename } from 'path';
import { logger } from '../utils/logger';
import { backupWithTimestamp } from '../utils/task-utils';
import { assembleUnitContext } from './unit-context-assembler';

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
 * v8.2.0+: 改为写入 020-specs/requirements/ 作为黄金需求目录
 * 原始需求保留在 010-requirements/ 不变
 */
export async function writeClarifiedDoc(
  content: string,
  iterDir: string,
  sourceName: string
): Promise<string> {
  // v8.2.0+: 黄金需求目录 — 澄清后的专业需求作为唯一分析依据
  const goldenDir = join(iterDir, '020-specs', 'requirements');
  await ensureDir(goldenDir);

  // 生成文件名：基于来源名 + 时间戳
  const baseName = basename(sourceName, '.md')
    .replace(/[^\w\u4e00-\u9fa5-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'clarified';

  const now = new Date();
  const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const filename = `clarified-${baseName}-${timestamp}.md`;
  const filepath = join(goldenDir, filename);

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
 * v6.80.0+: 增加版本号和质量评分
 */
export function buildClarifiedHeader(
  originalSource: string,
  clarifyTime: string = new Date().toISOString(),
  version: string = '1.0'
): string {
  return `---
source: "${originalSource}"
clarified-at: "${clarifyTime}"
status: "clarified"
version: "${version}"
---

`;
}

// ═══════════════════════════════════════════════════════════
// v6.80.0+: 多维度需求质量评价
// ═══════════════════════════════════════════════════════════

export interface QualityDimension {
  name: string;
  score: number; // 0-100
  issues: string[];
  suggestions: string[];
}

export interface RequirementQualityReport {
  filePath: string;
  overallScore: number; // 0-100
  level: 'high' | 'medium' | 'low';
  dimensions: QualityDimension[];
  summary: string;
  clarified: boolean;
  version?: string;
}

/**
 * 多维度需求质量评价
 * 评分维度：完整性 / 一致性 / 可测试性 / 可追溯性 / 专业度 / 交互逻辑 / 业务流程
 * v6.83.0+: 增加交互逻辑完整性和业务流程完整性维度
 */
export function assessRequirementQuality(content: string, filePath: string = ''): RequirementQualityReport {
  const dimensions: QualityDimension[] = [];

  // 1. 完整性 (Completeness)
  const completenessIssues: string[] = [];
  const completenessSuggestions: string[] = [];
  if (!/(背景|目标|目的|概述)/i.test(content)) {
    completenessIssues.push('缺少背景与目标描述');
    completenessSuggestions.push('补充「为什么要做这个功能」');
  }
  if (!/(用户故事|user story|作为.*我希望)/i.test(content)) {
    completenessIssues.push('缺少用户故事');
    completenessSuggestions.push('添加用户故事：作为[角色]，我希望[目标]，以便[价值]');
  }
  if (!/(功能清单|功能模块|特性|feature)/i.test(content)) {
    completenessIssues.push('缺少功能清单');
    completenessSuggestions.push('按模块列出功能清单');
  }
  if (!/(异常|错误|失败|边界|极端)/i.test(content)) {
    completenessIssues.push('缺少异常场景和边界条件');
    completenessSuggestions.push('补充异常流程和边界值处理');
  }
  if (!/(非功能|性能|安全|兼容|可用性)/i.test(content)) {
    completenessIssues.push('缺少非功能需求');
    completenessSuggestions.push('补充性能、安全、兼容性等要求（如适用）');
  }
  const completenessScore = Math.max(0, 100 - completenessIssues.length * 20);
  dimensions.push({
    name: '完整性',
    score: completenessScore,
    issues: completenessIssues,
    suggestions: completenessSuggestions,
  });

  // 2. 一致性 (Consistency)
  const consistencyIssues: string[] = [];
  const consistencySuggestions: string[] = [];
  // 检测同一概念的不同表述
  const conceptVariations = detectConceptVariations(content);
  if (conceptVariations.length > 0) {
    consistencyIssues.push(...conceptVariations.map(v => `概念表述不一致: ${v}`));
    consistencySuggestions.push('统一术语表述，建立术语表');
  }
  // 检测矛盾描述
  const contradictions = detectContradictions(content);
  if (contradictions.length > 0) {
    consistencyIssues.push(...contradictions);
    consistencySuggestions.push('消除矛盾描述，明确优先级');
  }
  const consistencyScore = Math.max(0, 100 - consistencyIssues.length * 15);
  dimensions.push({
    name: '一致性',
    score: consistencyScore,
    issues: consistencyIssues,
    suggestions: consistencySuggestions,
  });

  // 3. 可测试性 (Testability)
  const testabilityIssues: string[] = [];
  const testabilitySuggestions: string[] = [];
  const acMatches = content.match(/(验收标准|AC|acceptance criteria)/gi);
  if (!acMatches || acMatches.length === 0) {
    testabilityIssues.push('缺少验收标准');
    testabilitySuggestions.push('为每个功能点编写可测试的验收标准');
  } else {
    // 检测 AC 是否量化
    const acSection = content.split(/(验收标准|## AC|acceptance criteria)/i)[2] || '';
    if (!/\d+(%|ms|秒|分|个|条)/.test(acSection)) {
      testabilityIssues.push('验收标准缺少量化指标');
      testabilitySuggestions.push('AC 应包含具体数值（如响应时间<200ms，成功率>99%）');
    }
  }
  if (!/\[ \]|\[x\]/.test(content)) {
    testabilityIssues.push('验收标准未使用勾选列表');
    testabilitySuggestions.push('用 `- [ ]` 标记验收项，便于测试跟踪');
  }
  const testabilityScore = Math.max(0, 100 - testabilityIssues.length * 25);
  dimensions.push({
    name: '可测试性',
    score: testabilityScore,
    issues: testabilityIssues,
    suggestions: testabilitySuggestions,
  });

  // 4. 可追溯性 (Traceability)
  const traceabilityIssues: string[] = [];
  const traceabilitySuggestions: string[] = [];
  if (!/(需求编号|REQ-|ID:|R-\d+)/i.test(content)) {
    traceabilityIssues.push('缺少需求编号/ID');
    traceabilitySuggestions.push('为每个需求分配唯一编号（如 R-01, R-02）');
  }
  if (!/(来源|出处|引用|参见)/i.test(content)) {
    traceabilityIssues.push('缺少需求来源标注');
    traceabilitySuggestions.push('标注需求来源文档和章节');
  }
  const traceabilityScore = Math.max(0, 100 - traceabilityIssues.length * 30);
  dimensions.push({
    name: '可追溯性',
    score: traceabilityScore,
    issues: traceabilityIssues,
    suggestions: traceabilitySuggestions,
  });

  // 5. 专业度 (Professionalism) - 复用已有逻辑
  const profLevel = detectProfessionalLevel(content);
  const profIssues: string[] = [];
  const profSuggestions: string[] = [];
  if (profLevel !== 'high') {
    if (/(我要|我想|能不能|可不可以|帮忙|弄一个|搞一个)/g.test(content)) {
      profIssues.push('存在口语化表述');
      profSuggestions.push('使用专业术语替代口语化表达');
    }
    if (!/^#{2,3}\s+/m.test(content)) {
      profIssues.push('缺少结构化标题');
      profSuggestions.push('使用 ## 三级标题组织文档结构');
    }
    if (!/(业务规则|约束条件|校验规则)/i.test(content)) {
      profIssues.push('缺少业务规则');
      profSuggestions.push('明确业务规则和约束条件');
    }
    if (!/(功能范围|范围|边界|不涉及|不包含)/i.test(content)) {
      profIssues.push('缺少功能边界');
      profSuggestions.push('明确「做什么」和「不做什么」');
    }
  }
  const profScore = profLevel === 'high' ? 90 : profLevel === 'medium' ? 60 : 30;
  dimensions.push({
    name: '专业度',
    score: profScore,
    issues: profIssues,
    suggestions: profSuggestions,
  });

  // 6. 交互逻辑完整性 (Interaction Completeness) — v6.83.0+
  const interactionIssues: string[] = [];
  const interactionSuggestions: string[] = [];
  if (!/(加载|loading|等待|spinner|骨架屏)/i.test(content)) {
    interactionIssues.push('缺少加载/等待状态定义');
    interactionSuggestions.push('为每个异步操作定义 Loading 状态（如骨架屏、Spinner）');
  }
  if (!/(空状态|empty|无数据|暂无)/i.test(content)) {
    interactionIssues.push('缺少空状态（Empty State）定义');
    interactionSuggestions.push('定义列表为空、搜索结果为空时的页面状态');
  }
  if (!/(错误提示|错误状态|失败处理|异常处理)/i.test(content)) {
    interactionIssues.push('缺少错误状态定义');
    interactionSuggestions.push('定义网络失败、接口报错、权限不足时的用户提示');
  }
  if (!/(分页|page|加载更多|无限滚动|虚拟列表)/i.test(content) && /(列表|表格|数据)/i.test(content)) {
    interactionIssues.push('列表/表格缺少分页或加载策略');
    interactionSuggestions.push('定义数据量大时的分页、加载更多或虚拟滚动策略');
  }
  if (!/(筛选|过滤|排序|搜索|查询)/i.test(content) && /(列表|表格)/i.test(content)) {
    interactionIssues.push('列表/表格缺少筛选/排序逻辑');
    interactionSuggestions.push('定义筛选条件、排序规则、重置逻辑');
  }
  if (!/(确认|二次确认|弹窗|对话框|是否确认)/i.test(content) && /(删除|取消|修改|提交)/i.test(content)) {
    interactionIssues.push('缺少不可逆操作的确认机制');
    interactionSuggestions.push('为删除、取消订单等不可逆操作添加二次确认');
  }
  if (!/(表单校验|输入校验|验证规则|校验)/i.test(content) && /(表单|输入|填写)/i.test(content)) {
    interactionIssues.push('表单缺少校验规则');
    interactionSuggestions.push('定义每个表单字段的校验规则（必填、格式、长度、范围）');
  }
  if (!/(权限|角色|可见|可操作)/i.test(content)) {
    interactionIssues.push('缺少权限控制说明');
    interactionSuggestions.push('定义不同角色看到的内容和可执行的操作');
  }
  const interactionScore = Math.max(0, 100 - interactionIssues.length * 12);
  dimensions.push({
    name: '交互逻辑',
    score: interactionScore,
    issues: interactionIssues,
    suggestions: interactionSuggestions,
  });

  // 7. 业务流程完整性 (Business Flow Completeness) — v6.83.0+
  const flowIssues: string[] = [];
  const flowSuggestions: string[] = [];
  if (!/(流程|步骤|环节|阶段)/i.test(content)) {
    flowIssues.push('缺少业务流程描述');
    flowSuggestions.push('描述用户完成核心目标的完整步骤');
  }
  if (!/(状态|status|state|流转)/i.test(content)) {
    flowIssues.push('缺少状态定义和状态流转');
    flowSuggestions.push('定义业务实体的所有状态及状态转换条件（如 待支付→已支付→已发货）');
  }
  if (!/(异常|错误|失败|超时|回滚|补偿)/i.test(content)) {
    flowIssues.push('缺少异常流程');
    flowSuggestions.push('为每个正常流程定义对应的异常分支（支付失败、库存不足、超时）');
  }
  if (!/(通知|消息|推送|提醒|邮件|短信)/i.test(content) && /(状态变化|订单|审核)/i.test(content)) {
    flowIssues.push('状态变化缺少通知机制');
    flowSuggestions.push('定义关键状态变化时的通知方式（站内信、推送、邮件、短信）');
  }
  if (!/(回退|撤销|取消|退货|退款)/i.test(content) && /(订单|交易|支付)/i.test(content)) {
    flowIssues.push('缺少逆向流程');
    flowSuggestions.push('定义取消、退款、退货等逆向业务流程');
  }
  if (!/(并发|竞态|重复|幂等)/i.test(content) && /(提交|支付|下单)/i.test(content)) {
    flowIssues.push('缺少并发和幂等性考虑');
    flowSuggestions.push('定义重复提交、并发操作的防护策略');
  }
  const flowScore = Math.max(0, 100 - flowIssues.length * 16);
  dimensions.push({
    name: '业务流程',
    score: flowScore,
    issues: flowIssues,
    suggestions: flowSuggestions,
  });

  // 综合评分
  const overallScore = Math.round(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length);
  const level: 'high' | 'medium' | 'low' = overallScore >= 80 ? 'high' : overallScore >= 50 ? 'medium' : 'low';

  const totalIssues = dimensions.reduce((s, d) => s + d.issues.length, 0);
  const summary = totalIssues === 0
    ? '需求文档质量良好，可直接进入技术方案生成。'
    : `发现 ${totalIssues} 个问题，建议先澄清再分析。`;

  return {
    filePath,
    overallScore,
    level,
    dimensions,
    summary,
    clarified: false,
  };
}

/** 检测同一概念的不同表述 */
function detectConceptVariations(content: string): string[] {
  const variations: string[] = [];
  // 常见概念对：检测文档中是否同时出现不同的叫法
  const pairs = [
    [/用户/, /客户/],
    [/订单/, /定单/],
    [/账号/, /帐户/],
    [/登录/, /登陆/],
    [/权限/, /权利/],
  ];
  for (const [a, b] of pairs) {
    if (a.test(content) && b.test(content)) {
      variations.push(`同时出现「${a.source}」和「${b.source}」`);
    }
  }
  return variations;
}

/** 检测矛盾描述（简单启发式） */
function detectContradictions(content: string): string[] {
  const contradictions: string[] = [];
  // 检测 "必须" 和 "可选" 同时描述同一事物
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/必须.*可选|可选.*必须/.test(line)) {
      contradictions.push(`第 ${i + 1} 行存在矛盾: ${line.trim().slice(0, 50)}...`);
    }
    if (/必填.*非必填|非必填.*必填/.test(line)) {
      contradictions.push(`第 ${i + 1} 行存在矛盾: ${line.trim().slice(0, 50)}...`);
    }
  }
  return contradictions;
}

/**
 * 生成 CLARIFY_REPORT.md
 * v6.80.0+: 汇总所有需求文档的质量评价
 */
export async function writeClarifyReport(
  iterDir: string,
  reports: RequirementQualityReport[]
): Promise<string> {
  const reportPath = join(iterDir, '010-requirements', 'CLARIFY_REPORT.md');
  await ensureDir(join(iterDir, '010-requirements'));

  const now = new Date().toISOString().split('T')[0];
  let md = `# 需求澄清报告\n\n> 生成时间: ${now}\n> 文档数: ${reports.length}\n\n`;

  // 汇总表
  md += `## 质量评分汇总\n\n`;
  md += `| 文档 | 综合评分 | 等级 | 问题数 | 状态 |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;
  for (const r of reports) {
    const name = r.filePath.split('/').pop() || '-';
    const badge = r.level === 'high' ? '✅' : r.level === 'medium' ? '⚠️' : '❌';
    const status = r.clarified ? '已澄清' : r.level === 'high' ? '无需澄清' : '待澄清';
    md += `| ${name} | ${r.overallScore} | ${badge} ${r.level.toUpperCase()} | ${r.dimensions.reduce((s, d) => s + d.issues.length, 0)} | ${status} |\n`;
  }

  // 详细报告
  for (const r of reports) {
    const name = r.filePath.split('/').pop() || '-';
    md += `\n## ${name}\n\n`;
    md += `**综合评分**: ${r.overallScore}/100 | **等级**: ${r.level.toUpperCase()}\n\n`;

    for (const dim of r.dimensions) {
      const badge = dim.score >= 80 ? '🟢' : dim.score >= 50 ? '🟡' : '🔴';
      md += `### ${badge} ${dim.name}: ${dim.score}/100\n\n`;
      if (dim.issues.length > 0) {
        md += `**问题**:\n`;
        for (const issue of dim.issues) {
          md += `- ❌ ${issue}\n`;
        }
        md += `\n**建议**:\n`;
        for (const sug of dim.suggestions) {
          md += `- 💡 ${sug}\n`;
        }
        md += '\n';
      } else {
        md += `✅ 该维度无问题\n\n`;
      }
    }
  }

  md += `\n---\n\n`;
  md += `## 下一步\n\n`;
  const needClarify = reports.filter(r => r.level !== 'high' && !r.clarified);
  if (needClarify.length > 0) {
    md += `- ${needClarify.length} 个文档需要澄清，请执行: \`speccore analyze --prompt -I <迭代>\`\n`;
    md += `- 或跳过澄清: \`speccore analyze --prompt -I <迭代> --skip-clarify\`\n`;
  } else {
    md += `- ✅ 所有文档质量达标，可直接执行技术方案生成\n`;
  }

  await writeFile(reportPath, md, 'utf-8');
  return reportPath;
}

/**
 * 检测迭代是否已有有效的 clarified 文档
 * v8.2.0+: 改为检查 020-specs/requirements/ 目录
 */
export async function hasValidClarifiedDocs(iterDir: string): Promise<boolean> {
  const goldenDir = join(iterDir, '020-specs', 'requirements');
  if (!(await pathExists(goldenDir))) return false;

  const files = await readdir(goldenDir);
  const clarifiedFiles = files.filter(f => f.startsWith('clarified-') && f.endsWith('.md'));
  if (clarifiedFiles.length === 0) return false;

  // 检查是否有 source 文档比 clarified 更新
  const sourcesDir = join(iterDir, '010-requirements', 'sources');
  const featuresDir = join(iterDir, '010-requirements', 'features');

  let latestSourceTime = 0;
  for (const dir of [sourcesDir, featuresDir]) {
    if (await pathExists(dir)) {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && e.name.endsWith('.md')) {
            const st = await stat(join(dir, e.name));
            if (st.mtimeMs > latestSourceTime) latestSourceTime = st.mtimeMs;
          }
        }
      } catch { /* 忽略 */ }
    }
  }

  // 如果 source 比 clarify 新，需要重新 clarify
  let latestClarifyTime = 0;
  for (const f of clarifiedFiles) {
    const st = await stat(join(goldenDir, f));
    if (st.mtimeMs > latestClarifyTime) latestClarifyTime = st.mtimeMs;
  }

  return latestClarifyTime >= latestSourceTime;
}

// ═══════════════════════════════════════════════════════════
// v8.2.0+: 功能单元聚焦澄清（解决注意力漂移）
// ═══════════════════════════════════════════════════════════

export interface ClarifyUnit {
  id: string;
  name: string;
  content: string; // 该单元的原始内容
}

export interface ClarifiedUnit {
  id: string;
  name: string;
  clarifiedContent: string; // AI 澄清后的内容
  timestamp: string;
}

/** 从 Markdown 内容中提取功能单元（基于 ##/### 标题） */
export function extractUnitsFromText(content: string): ClarifyUnit[] {
  const units: ClarifyUnit[] = [];
  const lines = content.split('\n');
  let idCounter = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^#{2,3}\s+(.+)$/);
    if (!headingMatch) continue;
    const name = headingMatch[1].trim();

    // 跳过通用标题
    const skipKeywords = ['需求概述', '术语表', '附录', '测试策略', '参考资料', '目录', '引言', '背景', '总结', '结论'];
    if (skipKeywords.some(k => name.includes(k))) continue;

    // 收集该单元的完整内容（直到下一个同级或更高级标题）
    const unitLines: string[] = [line];
    for (let j = i + 1; j < lines.length; j++) {
      const nextLine = lines[j];
      if (nextLine.match(/^#{1,3}\s+/)) break;
      unitLines.push(nextLine);
    }

    units.push({
      id: `M-${String(idCounter++).padStart(2, '0')}`,
      name,
      content: unitLines.join('\n').trim(),
    });
    if (idCounter > 30) break;
  }

  return units;
}

/** 构建单个功能单元的澄清 Prompt（v8.2.0+ 智能上下文组装） */
export async function buildUnitClarifyPrompt(
  unit: ClarifyUnit,
  fullContent: string,
  context?: { iteration?: string; sourceFile?: string; iterDir?: string; allUnits?: ClarifyUnit[] }
): Promise<string> {
  const sections: string[] = [];

  sections.push('# 需求专业化 — 功能单元澄清');
  sections.push('');
  sections.push('## 你的角色');
  sections.push('你是资深产品经理 + 领域专家。请将以下功能单元整理为专业的需求规格。');
  sections.push('');

  sections.push('## 迭代信息');
  if (context?.iteration) sections.push(`- 迭代: ${context.iteration}`);
  if (context?.sourceFile) sections.push(`- 来源: ${context.sourceFile}`);
  sections.push(`- 单元ID: ${unit.id}`);
  sections.push('');

  // 使用智能上下文组装引擎（如果提供了迭代目录和单元列表）
  let unitContext = '';
  if (context?.iterDir && context?.allUnits && context?.iteration) {
    const unitRef = { id: unit.id, name: unit.name, content: unit.content };
    const allUnitRefs = context.allUnits.map(u => ({ id: u.id, name: u.name, content: u.content }));
    const ctxResult = await assembleUnitContext(context.iterDir, context.iteration, unitRef, allUnitRefs, {
      maxTokens: 5000,
      maxRelatedUnits: 3,
      maxCodeFiles: 3,
      useKnowledgeGraph: true,
    });
    unitContext = ctxResult.context;
    sections.push(`## 需求上下文（智能组装: ${ctxResult.stats.estimatedTokens} tokens）`);
  } else {
    sections.push('## 功能单元原文');
    sections.push('```markdown');
    sections.push(unit.content);
    sections.push('```');
  }
  sections.push('');
  if (unitContext) {
    sections.push(unitContext);
    sections.push('');
  }

  sections.push('## 整理要求');
  sections.push('');
  sections.push('请对「' + unit.name + '」进行专业化整理，输出以下内容：');
  sections.push('');
  sections.push('### 1. 功能描述（用户故事格式）');
  sections.push('- 作为 [角色]，我希望 [目标]，以便 [价值]');
  sections.push('- 输入/输出定义');
  sections.push('- 前置条件与后置条件');
  sections.push('');
  sections.push('### 2. 业务规则（R-XX 编号）');
  sections.push('- 每个规则必须有唯一编号（如 R-01, R-02）');
  sections.push('- 规则必须包含：条件、动作、异常处理');
  sections.push('');
  sections.push('### 3. 业务流程');
  sections.push('- 正常流程（主路径）');
  sections.push('- 异常分支（所有可能的错误路径）');
  sections.push('- 状态流转图（文字描述即可）');
  sections.push('');
  sections.push('### 4. 页面交互逻辑');
  sections.push('- 页面结构');
  sections.push('- 用户操作 → 系统反馈');
  sections.push('- Loading / Empty / Error 状态');
  sections.push('- 权限控制');
  sections.push('');
  sections.push('### 5. 验收标准（AC）');
  sections.push('- 可测试、可量化');
  sections.push('- 每条用 `[ ]` 标记');
  sections.push('');
  sections.push('### 6. 异常场景和边界条件');
  sections.push('- 网络失败、权限不足、数据为空、超时等');
  sections.push('');
  sections.push('### 7. 待确认事项');
  sections.push('- 如果原始描述不完整，标注「待确认」而不是编造');
  sections.push('');

  sections.push('## 输出格式');
  sections.push('使用 [UNIT:xxx] 标记输出：');
  sections.push('');
  sections.push('```');
  sections.push(`[UNIT:${unit.id}]`);
  sections.push('（澄清后的专业内容...）');
  sections.push('```');
  sections.push('');

  sections.push('## 重要提示');
  sections.push(`- 只分析当前功能单元「${unit.name}」，不要涉及其他模块`);
  sections.push('- 统一术语，建立术语表（如果是第一个单元）');
  sections.push('- 验收标准必须量化（如响应时间<200ms）');
  sections.push('- 如果原始描述不完整，标注「待确认」而不是编造');
  sections.push('- 不要添加文档中未提及的功能');
  sections.push('');

  return sections.join('\n');
}

/** 汇总所有澄清单元为统一 PRD */
export function consolidateClarifiedUnits(
  units: ClarifiedUnit[],
  originalSource: string,
): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push(`source: "${originalSource}"`);
  lines.push(`clarified-at: "${new Date().toISOString()}"`);
  lines.push('status: "clarified"');
  lines.push('version: "1.0"');
  lines.push('---');
  lines.push('');
  lines.push('# 需求规格说明书（PRD）');
  lines.push('');
  lines.push('> 本文档由 AI 自动澄清生成，基于原始需求文档的专业化整理。');
  lines.push('');

  // 术语表（从第一个单元提取，如果有）
  lines.push('## 术语表');
  lines.push('| 术语 | 定义 |');
  lines.push('| :--- | :--- |');
  lines.push('| （请根据实际内容补充）| |');
  lines.push('');

  // 功能模块清单
  lines.push('## 功能模块清单');
  lines.push('| 单元ID | 模块名称 | 状态 |');
  lines.push('| :--- | :--- | :--- |');
  for (const u of units) {
    lines.push(`| ${u.id} | ${u.name} | ✅ 已澄清 |`);
  }
  lines.push('');

  // 各单元详细内容
  for (const u of units) {
    lines.push(`---`);
    lines.push('');
    lines.push(`## ${u.id} ${u.name}`);
    lines.push('');
    lines.push(u.clarifiedContent);
    lines.push('');
  }

  // 全局验收标准汇总
  lines.push('---');
  lines.push('');
  lines.push('## 全局验收标准');
  lines.push('');
  lines.push('（各单元验收标准的汇总，去重后整合）');
  lines.push('');

  // 非功能需求
  lines.push('## 非功能需求');
  lines.push('- 性能: （待补充）');
  lines.push('- 安全: （待补充）');
  lines.push('- 兼容性: （待补充）');
  lines.push('- 可访问性: （待补充）');
  lines.push('');

  // 依赖与约束
  lines.push('## 依赖与约束');
  lines.push('- （待补充）');
  lines.push('');

  // 功能边界
  lines.push('## 功能边界');
  lines.push('- **包含**: （明确做什么）');
  lines.push('- **不包含**: （明确不做什么）');
  lines.push('');

  // 待确认事项
  lines.push('## 待确认事项');
  lines.push('- [ ] （从各单元收集中汇总）');
  lines.push('');

  return lines.join('\n');
}

