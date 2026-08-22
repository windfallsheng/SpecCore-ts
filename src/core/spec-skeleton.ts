/**
 * spec-skeleton — 骨架优先架构核心模块 (v8.0.0+)
 *
 * 设计原则：CLI 预创建所有文件骨架（含占位内容），AI 只覆盖内容，不决定路径。
 * 从根本上消除"AI 写错文件位置"的问题。
 *
 * 对比旧架构：
 *   旧: CLI → prompt → AI 决定内容+路径 → sanitize 事后清理（永远不完整）
 *   新: CLI → 预创建骨架 → AI 覆盖内容 → 文件已在正确位置（不需要清理）
 */
import { join, dirname } from 'path';
import { pathExists, ensureDir, readFile, writeFile } from 'fs-extra';
import { GLOBAL_SPECS_DIR } from './spec-paths';

// ================================================================
// 常量
// ================================================================

/** 骨架标记 — 用于检测文件是否仍为占位状态 */
export const SKELETON_MARKER = '<!-- SPEC-SKELETON -->';

// ================================================================
// 类型定义
// ================================================================

export interface SpecFileEntry {
  /** 相对 020-specs/ 的路径，如 "overview/ANALYSIS.md" */
  relPath: string;
  /** 分类：overview（全局）或 platform（端专属） */
  category: 'overview' | 'platform';
  /** 端名（仅 platform 类） */
  platform?: string;
  /** 文件名 */
  docName: string;
  /** 占位内容（含写作指引） */
  placeholder: string;
}

export interface SkeletonResult {
  /** 新创建的骨架文件 */
  created: string[];
  /** 已存在（保留原内容） */
  skipped: string[];
}

export interface ProgressResult {
  /** 已填充（非骨架） */
  filled: string[];
  /** 仍为骨架 */
  unfilled: string[];
  /** 下一个需要生成的 entry */
  nextUnfilled: SpecFileEntry | null;
  /** 已填充数 */
  filledCount: number;
  /** 总数 */
  totalCount: number;
}

// ================================================================
// Phase 1 文档清单（overview/ 全局文档）
// ================================================================

const PHASE1_DOCS: { name: string; buildPlaceholder: (iter: string) => string }[] = [
  {
    name: 'REQUIREMENT.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 需求规格

> 迭代: ${iter} | 生成: 待填充

## 写作要求
基于 010-requirements/ 下的需求文档，整理本迭代的功能模块清单。
- 每个功能模块必须标注「涉及端」
- 列出验收标准
- 标注优先级（P0/P1/P2）
`,
  },
  {
    name: 'ANALYSIS.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 需求分析

> 迭代: ${iter} | 生成: 待填充

## 写作要求
基于需求文档和源码审计，分析本迭代的功能点清单。
- 按优先级分节（P0 必修 / P1 应修 / P2 建议）
- 每个功能点标注编号（F-01, F-02...）和涉及端
- 列出接口变更和数据库变更
`,
  },
  {
    name: 'TECH.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 技术架构（跨端全局）

> 迭代: ${iter} | 生成: 待填充

## 写作要求
基于源码和依赖分析，描述本迭代的整体技术架构。
- 整体架构图
- 跨端交互（调用方 → 被调方、协议）
- 中间件选型
- 数据库设计（表/字段/索引）
`,
  },
  {
    name: 'DEPS.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 依赖清单

> 迭代: ${iter} | 生成: 待填充

## 写作要求
列出本迭代涉及的内部服务依赖和外部第三方依赖。
`,
  },
  {
    name: 'RISK.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 风险评估

> 迭代: ${iter} | 生成: 待填充

## 写作要求
| 风险 | 可能性 | 影响 | 缓解措施 |
|:---|:---|:---|:---|
| | | | |

## 回滚方案
1. 触发条件: _待定_
2. 回滚步骤: _待定_
`,
  },
  {
    name: 'REVIEW.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# Code Review 清单

> 迭代: ${iter} | 生成: 待填充

## 检查项
- [ ] 参数校验完整性
- [ ] 幂等性处理
- [ ] 索引覆盖
- [ ] 迁移脚本可回滚
- [ ] 鉴权配置
- [ ] 日志规范
`,
  },
  {
    name: 'MONITOR.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 监控指标

> 迭代: ${iter} | 生成: 待填充

## 业务指标
| 指标 | 阈值 | 级别 |
|:---|:---|:---|
| 成功率 | <99.9% | P1 |
| P99延迟 | >1000ms | P2 |

## 告警规则
| 规则 | 条件 | 通知 |
|:---|:---|:---|
| | | |
`,
  },
  {
    name: 'FUNCTION_MAP.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 功能模块清单

> 迭代: ${iter} | 生成: 待填充

## 写作要求
列出本迭代所有功能模块及其涉及端，供 split 命令读取。

| 功能模块 | 涉及端 | 优先级 | 来源 |
|:---|:---|:---|:---|
| | | | |
`,
  },
];

// ================================================================
// Phase 2 文档清单（各端专属文档）
// ================================================================

const PHASE2_DOCS: { name: string; buildPlaceholder: (iter: string, platform: string) => string }[] = [
  {
    name: 'TECH.md',
    buildPlaceholder: (iter, platform) => `${SKELETON_MARKER}
# ${platform} 技术架构

> 迭代: ${iter} | 端: ${platform} | 生成: 待填充

## 写作要求
基于 overview/TECH.md 的整体架构，细化本端的技术方案：
- 接口定义（路径/参数/响应）
- 数据模型（Entity/DTO/VO）
- 核心业务逻辑
- 与 overview/TECH.md 保持一致
`,
  },
  {
    name: 'TEST.md',
    buildPlaceholder: (iter, platform) => `${SKELETON_MARKER}
# ${platform} 测试计划

> 迭代: ${iter} | 端: ${platform} | 生成: 待填充

## 写作要求
- 单元测试覆盖
- API 端到端测试
- 边界测试（异常参数、超时、并发）
- 性能测试方案
`,
  },
  {
    name: 'UI_SPEC.md',
    buildPlaceholder: (iter, platform) => `${SKELETON_MARKER}
# ${platform} UI 规格

> 迭代: ${iter} | 端: ${platform} | 生成: 待填充

## 写作要求
- 页面清单与路由
- 组件拆分
- 交互流程
- 状态管理
`,
  },
];

// ================================================================
// 任务级文档清单（split 用）
// ================================================================

const TASK_DOCS: { name: string; buildPlaceholder: (taskName: string, platform: string) => string }[] = [
  {
    name: 'REQ.md',
    buildPlaceholder: (taskName, platform) => `${SKELETON_MARKER}
# 本任务需求规格

> ${taskName} | 端: ${platform} | 生成: 待填充

## 写作要求
根据 split 产出的需求切片，结合全局上下文，重新组织本任务的需求规格：
- 明确本任务的验收标准（可测试的、具体的）
- 细化业务规则和边界条件
- 列出异常场景和处理方式
- 标注与其他 Task 的依赖关系
`,
  },
  {
    name: 'TECH.md',
    buildPlaceholder: (taskName, platform) => `${SKELETON_MARKER}
# 本任务技术方案

> ${taskName} | 端: ${platform} | 生成: 待填充

## 写作要求
基于 overview/TECH.md 的整体架构，细化到函数/接口级别：
- 具体的接口定义（路径/参数/响应）
- 数据模型设计（Entity/DTO/VO 字段映射）
- 核心业务逻辑的伪代码或流程描述
- 前端组件拆分和状态设计
- 必须与 overview/TECH.md 的整体架构保持一致
`,
  },
  {
    name: 'TASK.md',
    buildPlaceholder: (taskName, platform) => `${SKELETON_MARKER}
# 实施计划

> ${taskName} | 端: ${platform} | 生成: 待填充

## 写作要求
根据本任务的需求和技术方案，制定具体实施步骤：
- 按开发顺序列出具体步骤
- 每个步骤有明确的完成标准
- 标注步骤间的依赖关系
- 估算每步的工作量
`,
  },
];

// ================================================================
// 质量标准（Quality Rubrics）— v8.1.0+
// 每种文档类型的专业质量检查清单，自动注入骨架文件和 prompt
// ================================================================

export const QUALITY_RUBRICS: Record<string, { checklist: string[]; antiPatterns: string[] }> = {
  'REQUIREMENT.md': {
    checklist: [
      '产品愿景与目标用户画像',
      '核心场景地图（按业务场景分章节组织）',
      '每个场景：用户故事 → 操作流程 → 业务规则 → 边界条件',
      '验收标准（Given/When/Then 格式）',
      '功能优先级矩阵（P0/P1/P2）',
      '功能模块清单表（含「涉及端」列，标准端名）',
      '发布里程碑与风险预判',
    ],
    antiPatterns: [
      '按端分章节（应按业务场景组织）',
      '写技术实现细节（应纯产品视角）',
      '功能模块缺少「涉及端」标注',
      '验收标准用模糊描述（如「正常使用」「合理范围」）',
    ],
  },
  'ANALYSIS.md': {
    checklist: [
      '按优先级分节（P0 必修 / P1 应修 / P2 建议）',
      '每个功能点有唯一编号（F-01, F-02...）',
      '每个功能点标注涉及端',
      '接口变更清单（路径/方法/参数变化）',
      '数据库变更清单（新增表/字段/索引）',
      '风险点与缓解策略',
    ],
    antiPatterns: [
      '功能点无编号或无涉及端标注',
      '只列功能名不描述具体行为',
      '缺少接口变更和数据库变更清单',
    ],
  },
  'TECH.md': {
    checklist: [
      '整体架构图（Mermaid graph/flowchart）',
      '跨端交互说明（调用方 → 被调方、协议、接口路径）',
      '中间件选型及理由',
      '数据库设计（表名/字段/类型/索引/约束）',
      '安全方案（鉴权/加密/脱敏/SQL注入防护）',
      '性能指标（QPS预估/缓存策略/慢查询优化）',
      'API 契约（统一响应格式/错误码/分页规范）',
    ],
    antiPatterns: [
      '只列技术栈不解释选型理由',
      '接口定义缺少字段级说明',
      '无安全方案或性能考量',
      '架构图与文字描述不一致',
    ],
  },
  'DEPS.md': {
    checklist: [
      '内部服务依赖清单（服务名/用途/接口/SLA）',
      '第三方依赖清单（包名/版本/用途/许可证）',
      '集成方式说明（SDK/API/消息队列）',
      '版本兼容性风险',
    ],
    antiPatterns: [
      '只列名称不说明用途',
      '缺少版本号',
      '遗漏关键依赖',
    ],
  },
  'RISK.md': {
    checklist: [
      '至少 3 个风险项',
      '每项标注可能性（高/中/低）和影响（高/中/低）',
      '每项有具体缓解措施',
      '回滚方案（触发条件 + 具体步骤）',
      '数据恢复方案（如涉及数据变更）',
    ],
    antiPatterns: [
      '风险描述笼统（如「可能出问题」）',
      '缓解措施为空或「待定」',
      '无回滚方案',
    ],
  },
  'REVIEW.md': {
    checklist: [
      '参数校验完整性',
      '幂等性处理',
      '索引覆盖',
      '迁移脚本可回滚',
      '鉴权配置',
      '日志规范',
      '错误处理',
      '并发安全',
      '至少 8 项检查，每项有具体检查方法',
    ],
    antiPatterns: [
      '检查项过于笼统（如「代码质量」）',
      '缺少具体检查方法',
      '遗漏安全相关检查项',
    ],
  },
  'MONITOR.md': {
    checklist: [
      '业务指标（成功率/响应时间/错误率，含阈值）',
      '系统指标（CPU/内存/连接池/磁盘）',
      '告警规则（条件/级别/通知渠道）',
      '监控大盘（必备指标列表）',
      '至少 3 个业务指标 + 2 条告警规则',
    ],
    antiPatterns: [
      '指标无阈值',
      '告警规则无通知渠道',
      '只有系统指标没有业务指标',
    ],
  },
  'FUNCTION_MAP.md': {
    checklist: [
      '表格含所有列：功能单元/涉及端/优先级/全局对比/共享能力/依赖任务/说明',
      '功能单元与 REQUIREMENT.md 一一对应（不允许合并）',
      '涉及端使用标准端名（逗号分隔）',
      '全局对比标注（新增/扩展/重构/复用）',
      '依赖任务标注正确',
      '每行有跨端交互说明',
    ],
    antiPatterns: [
      '将多个功能模块合并为一行',
      '涉及端为空或使用非标准端名',
      '缺少全局对比列',
      '功能单元与 REQUIREMENT.md 不对应',
    ],
  },
  'TEST.md': {
    checklist: [
      '单元测试覆盖（核心函数/方法）',
      '集成测试（API 端到端）',
      '边界测试（异常参数/超时/并发/空值）',
      '性能测试方案（基准/目标/工具）',
      '测试用例含前置条件+操作步骤+预期结果',
      '覆盖所有核心功能的正常流+异常流',
    ],
    antiPatterns: [
      '只列「需要测试」不写具体用例',
      '缺少异常场景测试',
      '无性能测试基准',
      '测试用例缺少预期结果',
    ],
  },
  'UI_SPEC.md': {
    checklist: [
      '页面清单（页面名/路由/核心功能/入口）',
      '组件拆分（组件名/职责/复用级别）',
      '交互流程（关键操作流程+状态变化）',
      '状态管理（全局状态/本地状态/同步策略）',
      '字段映射（前端字段 ↔ 后端 API 响应字段一一对应）',
      '异常状态 UI（空状态/加载态/错误态/骨架屏）',
    ],
    antiPatterns: [
      '字段映射与后端 API 不一致',
      '缺少异常状态 UI 设计',
      '只画正常流程不处理边界',
      '组件拆分粒度过粗或过细',
    ],
  },
  'REQ.md': {
    checklist: [
      '功能描述（本任务的核心职责）',
      '验收标准（Given/When/Then 格式，具体可测试）',
      '业务规则（具体到可执行逻辑）',
      '边界条件（参数范围/时间窗口/并发限制）',
      '异常场景（至少 3 种异常 + 处理方式）',
      '与其他 Task 的依赖关系',
    ],
    antiPatterns: [
      '验收标准不可测试（如「功能正常」）',
      '业务规则模糊（如「合理处理」）',
      '缺少异常场景',
      '未标注依赖关系',
    ],
  },
  'TASK.md': {
    checklist: [
      '按开发顺序列出实施步骤',
      '每步有明确的完成标准（可验证）',
      '标注步骤间依赖关系',
      '估算每步工作量',
    ],
    antiPatterns: [
      '步骤过于笼统（如「实现功能」）',
      '无完成标准',
      '缺少依赖关系',
    ],
  },
};

/**
 * 根据文档名获取质量标准文本
 * 自动区分 overview 和 platform 文档（TECH.md 后端/前端差异化）
 */
export function buildQualityRubRIC(docName: string, platform?: string): string {
  const rubric = QUALITY_RUBRICS[docName];
  if (!rubric) return '';

  let text = `\n## 📋 质量标准（${docName}）\n\n`;

  // 端特定提示
  if (platform && docName === 'TECH.md') {
    const isBackend = /service|api|server|backend/i.test(platform);
    if (isBackend) {
      text += `> 🎯 **${platform} 是后端服务**，TECH.md 必须包含：接口签名（路径/方法/参数/响应）、数据模型（表/字段/索引）、业务逻辑、安全方案\n\n`;
    } else {
      text += `> 🎯 **${platform} 是前端端**，TECH.md 必须包含：用户旅程、页面清单与路由、API 调用清单、组件设计、状态管理\n\n`;
    }
  }

  text += `**必含内容**：\n`;
  for (const item of rubric.checklist) {
    text += `- [ ] ${item}\n`;
  }
  text += `\n**禁止**：\n`;
  for (const item of rubric.antiPatterns) {
    text += `- ❌ ${item}\n`;
  }

  return text;
}

/**
 * 校验已填充文档的内容质量
 * 检查：最低字数、必含章节、表格是否有真实数据
 */
export async function validateContentQuality(
  docName: string,
  content: string,
  platform?: string,
): Promise<{ pass: boolean; score: number; issues: string[] }> {
  const issues: string[] = [];
  let score = 100;

  // 1. 最低字数检查（排除标记和空白）
  const cleanContent = content
    .replace(/<!--.*?-->/gs, '')
    .replace(/^#+\s/gm, '')
    .replace(/^>\s/gm, '')
    .trim();
  if (cleanContent.length < 200) {
    issues.push(`内容过薄（${cleanContent.length} 字符，最低 200）`);
    score -= 30;
  } else if (cleanContent.length < 500) {
    issues.push(`内容偏少（${cleanContent.length} 字符，建议 500+）`);
    score -= 10;
  }

  // 2. 必含章节检查
  const rubric = QUALITY_RUBRICS[docName];
  if (rubric) {
    const sectionMarkers: Record<string, string[]> = {
      'REQUIREMENT.md': ['验收标准', '优先级', '涉及端'],
      'ANALYSIS.md': ['P0', 'F-'],
      'TECH.md': ['接口', '数据模型'],
      'TEST.md': ['单元测试', '边界'],
      'UI_SPEC.md': ['页面', '组件'],
      'RISK.md': ['回滚'],
      'MONITOR.md': ['告警'],
      'FUNCTION_MAP.md': ['功能单元', '涉及端'],
      'REQ.md': ['验收标准', '异常'],
      'TASK.md': ['步骤'],
    };
    const markers = sectionMarkers[docName] || [];
    for (const marker of markers) {
      if (!content.includes(marker)) {
        issues.push(`缺少关键内容：「${marker}」`);
        score -= 10;
      }
    }
  }

  // 3. 占位符残留检查
  const placeholders = ['待填充', 'TODO', 'TBD', '_待定_', 'AI-FILL'];
  for (const ph of placeholders) {
    if (content.includes(ph)) {
      issues.push(`含占位符残留：「${ph}」`);
      score -= 5;
    }
  }

  // 4. 表格数据检查（有表头但无数据行）
  const tableHeaders = content.match(/^\|.+\|$/gm);
  if (tableHeaders && tableHeaders.length > 0) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/^\|.+\|$/.test(lines[i]) && lines[i].includes('---')) {
        const nextLine = lines[i + 1] || '';
        if (!/^\|.+\|$/.test(nextLine) || /^\|\s*\|$/.test(nextLine)) {
          issues.push('表格有表头但无数据行');
          score -= 10;
          break;
        }
      }
    }
  }

  return {
    pass: score >= 60 && issues.filter(i => i.includes('过薄')).length === 0,
    score: Math.max(0, score),
    issues,
  };
}

// ================================================================
// Manifest 计算函数
// ================================================================

/**
 * 计算 analyze 命令的文件清单
 * @param platforms 端列表
 * @param phase '1' = Phase 1 (overview), '2' = Phase 2 (各端), undefined = 全部
 * @param iteration 迭代名（用于占位内容）
 */
export function computeAnalyzeManifest(
  platforms: string[],
  phase?: '1' | '2',
  iteration: string = '',
): SpecFileEntry[] {
  const entries: SpecFileEntry[] = [];

  // Phase 1: overview/ 全局文档
  if (!phase || phase === '1') {
    for (const doc of PHASE1_DOCS) {
      entries.push({
        relPath: join(GLOBAL_SPECS_DIR, doc.name),
        category: 'overview',
        docName: doc.name,
        placeholder: doc.buildPlaceholder(iteration),
      });
    }
  }

  // Phase 2: 各端专属文档
  if (!phase || phase === '2') {
    for (const platform of platforms) {
      for (const doc of PHASE2_DOCS) {
        entries.push({
          relPath: join(platform, doc.name),
          category: 'platform',
          platform,
          docName: doc.name,
          placeholder: doc.buildPlaceholder(iteration, platform),
        });
      }
    }
  }

  return entries;
}

/**
 * 计算 split 命令的任务文件清单
 * @param taskName 任务名（如 Task-001-xxx）
 * @param platforms 涉及的端列表
 */
export function computeTaskManifest(
  taskName: string,
  platforms: string[],
): SpecFileEntry[] {
  const entries: SpecFileEntry[] = [];

  for (const platform of platforms) {
    for (const doc of TASK_DOCS) {
      entries.push({
        relPath: join(platform, doc.name),
        category: 'platform',
        platform,
        docName: doc.name,
        placeholder: doc.buildPlaceholder(taskName, platform),
      });
    }
  }

  return entries;
}

// ================================================================
// 骨架生成器
// ================================================================

/**
 * 预创建文件骨架
 * - 文件不存在 → 创建目录 + 写入占位内容
 * - 文件已存在且非骨架 → 跳过（保留已有内容，不覆盖）
 * - 文件已存在且仍为骨架 → 跳过（等 AI 覆盖）
 */
export async function generateSkeleton(
  specDir: string,
  entries: SpecFileEntry[],
): Promise<SkeletonResult> {
  const result: SkeletonResult = { created: [], skipped: [] };

  for (const entry of entries) {
    const fullPath = join(specDir, entry.relPath);

    if (await pathExists(fullPath)) {
      // 文件已存在 → 跳过（无论是否为骨架，都不覆盖）
      result.skipped.push(entry.relPath);
      continue;
    }

    // 文件不存在 → 创建骨架
    // v8.1.0+: 自动追加质量标准（AI 填充时可见质量要求）
    await ensureDir(dirname(fullPath));
    const rubricSection = buildQualityRubRIC(entry.docName, entry.platform);
    const fullContent = entry.placeholder + rubricSection;
    await writeFile(fullPath, fullContent, 'utf-8');
    result.created.push(entry.relPath);
  }

  return result;
}

// ================================================================
// 内容验证器
// ================================================================

/**
 * 检测哪些骨架文件已被 AI 填充
 * - 存在且不含 SKELETON_MARKER → filled
 * - 不存在或仍含 SKELETON_MARKER → unfilled
 */
export async function validateFilled(
  specDir: string,
  entries: SpecFileEntry[],
): Promise<{ filled: string[]; unfilled: string[] }> {
  const filled: string[] = [];
  const unfilled: string[] = [];

  for (const entry of entries) {
    const fullPath = join(specDir, entry.relPath);

    if (!(await pathExists(fullPath))) {
      unfilled.push(entry.relPath);
      continue;
    }

    const content = await readFile(fullPath, 'utf-8');
    if (content.includes(SKELETON_MARKER)) {
      unfilled.push(entry.relPath);
    } else {
      filled.push(entry.relPath);
    }
  }

  return { filled, unfilled };
}

// ================================================================
// 进度检测（替代 detectIterationDocsStatus）
// ================================================================

/**
 * 检测骨架填充进度，返回下一个需要生成的文件
 * 用于逐文档链式推进模式
 */
export async function detectSkeletonProgress(
  specDir: string,
  entries: SpecFileEntry[],
): Promise<ProgressResult> {
  const { filled, unfilled } = await validateFilled(specDir, entries);

  // 找到第一个未填充的 entry
  let nextUnfilled: SpecFileEntry | null = null;
  for (const entry of entries) {
    if (unfilled.includes(entry.relPath)) {
      nextUnfilled = entry;
      break;
    }
  }

  return {
    filled,
    unfilled,
    nextUnfilled,
    filledCount: filled.length,
    totalCount: entries.length,
  };
}

// ================================================================
// Prompt 辅助：生成骨架文件列表文本
// ================================================================

/**
 * 生成注入 prompt 的骨架文件列表
 * 用于告诉 AI 哪些文件需要覆盖
 */
export function buildSkeletonFileList(
  entries: SpecFileEntry[],
  specDir: string,
): string {
  const overviewEntries = entries.filter(e => e.category === 'overview');
  const platformEntries = entries.filter(e => e.category === 'platform');

  let text = `## 文件清单（CLI 已预创建骨架，请逐个覆盖内容）\n\n`;

  if (overviewEntries.length > 0) {
    text += `### 全局文档（overview/）\n`;
    for (const e of overviewEntries) {
      text += `- \`${e.relPath}\`\n`;
    }
    text += `\n`;
  }

  // 按端分组
  const platformGroups = new Map<string, SpecFileEntry[]>();
  for (const e of platformEntries) {
    const p = e.platform || 'unknown';
    if (!platformGroups.has(p)) platformGroups.set(p, []);
    platformGroups.get(p)!.push(e);
  }

  if (platformGroups.size > 0) {
    text += `### 各端专属文档\n`;
    for (const [platform, platformEntries] of platformGroups) {
      text += `\n**${platform}/**\n`;
      for (const e of platformEntries) {
        text += `- \`${e.relPath}\`\n`;
      }
    }
  }

  text += `\n> 完整路径前缀: \`${specDir}/\`\n`;
  text += `> 写入方式: 用 Write 工具直接覆盖上述路径的文件，不要创建新文件\n`;

  return text;
}
