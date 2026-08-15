/**
 * quality-audit — AI 生成内容质量核验
 * 
 * 核心问题：AI 生成 Spec 文档后，没有检查是否真的做到了：
 *   1. 按端区分（后端写了，前端没写）
 *   2. 专业性（后端有接口定义，前端有页面/组件/路由）
 *   3. 完整性（遗漏了某些端或某些维度）
 * 
 * 设计思路：
 *   - CLI 做确定性检查（关键词/结构/数量），不做 AI 内容判断
 *   - 输出 QUALITY_AUDIT.md 供 AI 参考修复
 *   - 支持最大修复轮次控制（默认 2 轮）
 */
import { readFile, writeFile, pathExists, ensureDir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';

// ================================================================
// 类型定义
// ================================================================

export interface AuditDimension {
  /** 维度名称 */
  name: string;
  /** 是否通过 */
  pass: boolean;
  /** 详情 */
  detail: string;
  /** 严重级别 */
  severity: 'error' | 'warn' | 'info';
}

export interface PlatformAudit {
  /** 端名称 */
  platform: string;
  /** 端类型分类 */
  type: 'backend' | 'frontend' | 'service';
  /** 各维度检查结果 */
  dimensions: AuditDimension[];
  /** 总体通过率 */
  passRate: number;
  /** 总评 */
  verdict: 'pass' | 'warn' | 'fail';
}

export interface QualityAuditResult {
  /** 文档名称 */
  document: string;
  /** 各端审计结果 */
  platforms: PlatformAudit[];
  /** 全局审计维度 */
  global: AuditDimension[];
  /** 总体评分 (0-100) */
  score: number;
  /** 总体结论 */
  verdict: 'pass' | 'warn' | 'fail';
  /** 修复建议 */
  suggestions: string[];
  /** 推荐修复轮次 */
  recommendedRounds: number;
}

// ================================================================
// 端类型分类
// ================================================================

// 前端关键词必须优先匹配（避免 'app-android' 被 'app' 误判为后端）
const FRONTEND_KEYWORDS = ['admin', 'h5', 'web', 'miniapp', 'app-android', 'app-ios', 'mobile', 'app-web', 'frontend', 'pc', 'wap'];
const BACKEND_KEYWORDS = ['service', 'backend', 'server', 'api', 'gateway', 'worker'];
// 原生 App 单独判断（排除 app-android/app-ios 已归入前端）
const NATIVE_APP_KEYWORDS = ['app-native', 'rn-', 'flutter'];

function classifyPlatform(platform: string): 'backend' | 'frontend' | 'service' {
  const lower = platform.toLowerCase();
  // 1. 先匹配前端（优先级最高，避免 admin/app-* 被误判）
  if (FRONTEND_KEYWORDS.some(k => lower.includes(k))) return 'frontend';
  // 2. 原生 App 归入前端
  if (NATIVE_APP_KEYWORDS.some(k => lower.includes(k))) return 'frontend';
  // 3. 后端服务
  if (BACKEND_KEYWORDS.some(k => lower.includes(k))) return 'backend';
  // 4. 纯 'app'（不含后缀）视为后端服务
  if (lower === 'app' || lower.includes('-app') || lower.includes('app-')) return 'backend';
  return 'service';
}

// ================================================================
// 后端文档检查维度
// ================================================================

function auditBackendContent(content: string, docType: string): AuditDimension[] {
  const dims: AuditDimension[] = [];

  // 1. API 接口定义
  const apiCount = (content.match(/\|?\s*(GET|POST|PUT|DELETE|PATCH)\s+\//gi) || []).length;
  const apiTableCount = (content.match(/\|.*\/api\/.*\|/g) || []).length;
  dims.push({
    name: 'API 接口定义',
    pass: apiCount >= 3 || apiTableCount >= 3,
    detail: `检测到 ${apiCount} 个 HTTP 方法引用, ${apiTableCount} 个 API 路径表格行`,
    severity: (apiCount >= 3 || apiTableCount >= 3) ? 'info' : 'error',
  });

  // 2. 请求/响应字段定义
  const fieldTableCount = (content.match(/\|\s*\w+\s*\|\s*(string|number|boolean|integer|object|array|String|Number|Boolean)/gi) || []).length;
  dims.push({
    name: '请求/响应字段定义',
    pass: fieldTableCount >= 5,
    detail: `检测到 ${fieldTableCount} 个类型化字段定义`,
    severity: fieldTableCount >= 5 ? 'info' : 'warn',
  });

  // 3. 数据库/数据模型
  const dbMentions = (content.match(/(CREATE TABLE|数据表|表结构|字段|column|PRIMARY KEY|entity|schema)/gi) || []).length;
  dims.push({
    name: '数据模型定义',
    pass: dbMentions >= 2,
    detail: `检测到 ${dbMentions} 处数据模型相关内容`,
    severity: dbMentions >= 2 ? 'info' : 'warn',
  });

  // 4. 业务规则
  const ruleMentions = (content.match(/(业务规则|R-\d+|校验|验证|规则|constraint|validation)/gi) || []).length;
  dims.push({
    name: '业务规则',
    pass: ruleMentions >= 2,
    detail: `检测到 ${ruleMentions} 处业务规则相关内容`,
    severity: ruleMentions >= 2 ? 'info' : 'warn',
  });

  // 5. 错误码/异常处理
  const errorMentions = (content.match(/(错误码|error.?code|异常|exception|状态码|HTTP \d{3})/gi) || []).length;
  dims.push({
    name: '错误码/异常处理',
    pass: errorMentions >= 2,
    detail: `检测到 ${errorMentions} 处异常处理相关内容`,
    severity: errorMentions >= 2 ? 'info' : 'warn',
  });

  return dims;
}

// ================================================================
// 前端文档检查维度
// ================================================================

function auditFrontendContent(content: string, docType: string): AuditDimension[] {
  const dims: AuditDimension[] = [];

  // 1. 页面结构/路由
  const pageMentions = (content.match(/(页面|路由|route|path|\/[a-z]+[a-z-]*\s*\|)/gi) || []).length;
  const routeTableRows = (content.match(/\|\s*\/[a-z].*\|.*\|/g) || []).length;
  dims.push({
    name: '页面结构与路由',
    pass: pageMentions >= 5 || routeTableRows >= 3,
    detail: `检测到 ${pageMentions} 处页面/路由引用, ${routeTableRows} 行路由表格`,
    severity: (pageMentions >= 5 || routeTableRows >= 3) ? 'info' : 'error',
  });

  // 2. 组件清单
  const componentMentions = (content.match(/(组件|component|Component|模块|视图|view|Widget)/gi) || []).length;
  dims.push({
    name: '组件清单',
    pass: componentMentions >= 5,
    detail: `检测到 ${componentMentions} 处组件相关内容`,
    severity: componentMentions >= 5 ? 'info' : 'warn',
  });

  // 3. 字段→UI 映射
  const fieldUiMappings = (content.match(/(字段.*映射|UI.*字段|展示.*字段|来源.*API|响应字段|field.*mapping)/gi) || []).length;
  dims.push({
    name: '字段→UI 映射',
    pass: fieldUiMappings >= 3,
    detail: `检测到 ${fieldUiMappings} 处字段映射相关内容`,
    severity: fieldUiMappings >= 3 ? 'info' : 'warn',
  });

  // 4. 状态枚举/交互状态
  const stateEnums = (content.match(/(状态.*枚举|枚举.*状态|status.*enum|待|进行中|已完成|已拒绝|颜色|颜色标记|tag|标签.*颜色)/gi) || []).length;
  dims.push({
    name: '状态枚举与交互状态',
    pass: stateEnums >= 2,
    detail: `检测到 ${stateEnums} 处状态/枚举相关内容`,
    severity: stateEnums >= 2 ? 'info' : 'warn',
  });

  // 5. 交互设计/UX
  const uxMentions = (content.match(/(交互|点击|按钮|表单|输入|弹窗|弹框|toast|提示|loading|加载|空态|空状态|错误态|边界)/gi) || []).length;
  dims.push({
    name: '交互设计与 UX',
    pass: uxMentions >= 5,
    detail: `检测到 ${uxMentions} 处交互/UX 相关内容`,
    severity: uxMentions >= 5 ? 'info' : 'warn',
  });

  // 6. 响应式/兼容性（H5/移动端特有）
  const responsiveMentions = (content.match(/(响应式|适配|移动端|触摸|手势|scroll|下拉|上拉|移动端兼容|iOS|Android|小程序|微信)/gi) || []).length;
  dims.push({
    name: '响应式/移动端适配',
    pass: responsiveMentions >= 2,
    detail: `检测到 ${responsiveMentions} 处移动端适配相关内容`,
    severity: responsiveMentions >= 2 ? 'info' : 'warn',
  });

  return dims;
}

// ================================================================
// 通用文档检查
// ================================================================

function auditGlobalContent(content: string, docType: string): AuditDimension[] {
  const dims: AuditDimension[] = [];
  const lineCount = content.split('\n').length;

  // 1. 内容充实度
  dims.push({
    name: '内容充实度',
    pass: lineCount >= 30,
    detail: `文档共 ${lineCount} 行`,
    severity: lineCount >= 50 ? 'info' : lineCount >= 30 ? 'warn' : 'error',
  });

  // 2. 结构化程度（Markdown 标题数量）
  const headingCount = (content.match(/^#{1,4}\s+.+/gm) || []).length;
  dims.push({
    name: '文档结构化',
    pass: headingCount >= 3,
    detail: `检测到 ${headingCount} 个 Markdown 标题`,
    severity: headingCount >= 5 ? 'info' : headingCount >= 3 ? 'warn' : 'error',
  });

  // 3. 是否有实质内容（排除纯模板/待填充）
  const placeholderCount = (content.match(/(_待(填充|补充|导入|确认|AI)|TODO|TBD|待填写|待完善)/gi) || []).length;
  dims.push({
    name: '实质内容（非占位符）',
    pass: placeholderCount <= 5,
    detail: `检测到 ${placeholderCount} 处占位符/待填充内容`,
    severity: placeholderCount <= 3 ? 'info' : placeholderCount <= 5 ? 'warn' : 'error',
  });

  // 4. 表格使用（专业文档应有结构化表格）
  const tableRowCount = (content.match(/^\|.*\|.*\|/gm) || []).length;
  dims.push({
    name: '结构化表格',
    pass: tableRowCount >= 3,
    detail: `检测到 ${tableRowCount} 行表格内容`,
    severity: tableRowCount >= 5 ? 'info' : tableRowCount >= 3 ? 'warn' : 'warn',
  });

  return dims;
}

// ================================================================
// 主审计函数
// ================================================================

export async function auditDocument(
  content: string,
  docType: string,
  platforms: string[],
): Promise<QualityAuditResult> {
  const result: QualityAuditResult = {
    document: docType,
    platforms: [],
    global: auditGlobalContent(content, docType),
    score: 0,
    verdict: 'pass',
    suggestions: [],
    recommendedRounds: 0,
  };

  // 按端审计
  for (const platform of platforms) {
    const type = classifyPlatform(platform);
    const dims = type === 'backend'
      ? auditBackendContent(content, docType)
      : type === 'frontend'
        ? auditFrontendContent(content, docType)
        : auditBackendContent(content, docType); // service 按后端标准

    const passed = dims.filter(d => d.pass).length;
    const total = dims.length;
    const passRate = Math.round((passed / total) * 100);

    result.platforms.push({
      platform,
      type,
      dimensions: dims,
      passRate,
      verdict: passRate >= 70 ? 'pass' : passRate >= 50 ? 'warn' : 'fail',
    });
  }

  // 计算总分
  const allDims = [
    ...result.global,
    ...result.platforms.flatMap(p => p.dimensions),
  ];
  const totalPassed = allDims.filter(d => d.pass).length;
  const totalDims = allDims.length;
  result.score = Math.round((totalPassed / Math.max(totalDims, 1)) * 100);

  // 判定
  const errorCount = allDims.filter(d => d.severity === 'error' && !d.pass).length;
  const warnCount = allDims.filter(d => d.severity === 'warn' && !d.pass).length;
  result.verdict = errorCount >= 3 ? 'fail' : errorCount >= 1 || warnCount >= 5 ? 'warn' : 'pass';

  // 生成修复建议
  for (const p of result.platforms) {
    const failed = p.dimensions.filter(d => !d.pass);
    for (const dim of failed) {
      if (dim.severity === 'error') {
        result.suggestions.push(`[${p.platform}/${dim.name}] ❌ ${dim.detail} — 必须补充`);
      } else if (dim.severity === 'warn') {
        result.suggestions.push(`[${p.platform}/${dim.name}] ⚠️ ${dim.detail} — 建议补充`);
      }
    }
  }
  for (const dim of result.global.filter(d => !d.pass)) {
    if (dim.severity === 'error') {
      result.suggestions.push(`[全局/${dim.name}] ❌ ${dim.detail} — 必须补充`);
    }
  }

  // 推荐修复轮次
  result.recommendedRounds = errorCount >= 3 ? 2 : errorCount >= 1 ? 1 : 0;

  return result;
}

// ================================================================
// 生成 QUALITY_AUDIT.md
// ================================================================

export async function generateQualityAudit(
  specDir: string,
  platforms: string[],
  maxRounds: number = 2,
): Promise<QualityAuditResult | null> {
  const docTypes = ['REQUIREMENT.md', 'ANALYSIS.md', 'TECH.md', 'TEST.md', 'UI_SPEC.md'];
  const allResults: QualityAuditResult[] = [];

  for (const docType of docTypes) {
    const docPath = join(specDir, docType);
    if (!(await pathExists(docPath))) continue;

    const content = await readFile(docPath, 'utf-8');
    const result = await auditDocument(content, docType, platforms);
    allResults.push(result);
  }

  if (allResults.length === 0) return null;

  // 汇总
  const avgScore = Math.round(allResults.reduce((sum, r) => sum + r.score, 0) / allResults.length);
  const totalErrors = allResults.reduce((sum, r) => sum + r.suggestions.filter(s => s.includes('❌')).length, 0);
  const totalWarnings = allResults.reduce((sum, r) => sum + r.suggestions.filter(s => s.includes('⚠️')).length, 0);
  const maxRecommended = Math.min(
    Math.max(...allResults.map(r => r.recommendedRounds)),
    maxRounds,
  );

  // 生成报告
  const now = new Date().toISOString().split('T')[0];
  const lines: string[] = [];
  lines.push(`# 质量审计报告`);
  lines.push(`> 自动生成于 ${now} | speccore quality-audit`);
  lines.push(`> 最大修复轮次: ${maxRounds}`);
  lines.push('');
  lines.push(`## 总览`);
  lines.push('');
  lines.push(`| 指标 | 值 |`);
  lines.push(`| :--- | :--- |`);
  lines.push(`| 综合评分 | ${avgScore}/100 ${avgScore >= 70 ? '✅' : avgScore >= 50 ? '⚠️' : '❌'} |`);
  lines.push(`| 检查文档数 | ${allResults.length} |`);
  lines.push(`| 严重问题 | ${totalErrors} |`);
  lines.push(`| 改进建议 | ${totalWarnings} |`);
  lines.push(`| 推荐修复轮次 | ${maxRecommended} |`);
  lines.push('');

  // 按文档分述
  for (const result of allResults) {
    lines.push(`## ${result.document} — ${result.score}/100 ${result.verdict === 'pass' ? '✅' : result.verdict === 'warn' ? '⚠️' : '❌'}`);
    lines.push('');

    // 全局维度
    lines.push(`### 全局检查`);
    lines.push('');
    lines.push(`| 维度 | 结果 | 详情 |`);
    lines.push(`| :--- | :--- | :--- |`);
    for (const dim of result.global) {
      lines.push(`| ${dim.name} | ${dim.pass ? '✅' : dim.severity === 'error' ? '❌' : '⚠️'} | ${dim.detail} |`);
    }
    lines.push('');

    // 各端维度
    for (const p of result.platforms) {
      const typeLabel = p.type === 'backend' ? '后端' : p.type === 'frontend' ? '前端' : '服务';
      lines.push(`### ${p.platform} (${typeLabel}) — ${p.passRate}% ${p.verdict === 'pass' ? '✅' : p.verdict === 'warn' ? '⚠️' : '❌'}`);
      lines.push('');
      lines.push(`| 维度 | 结果 | 详情 |`);
      lines.push(`| :--- | :--- | :--- |`);
      for (const dim of p.dimensions) {
        lines.push(`| ${dim.name} | ${dim.pass ? '✅' : dim.severity === 'error' ? '❌' : '⚠️'} | ${dim.detail} |`);
      }
      lines.push('');
    }
  }

  // 修复建议汇总
  const allSuggestions = allResults.flatMap(r => r.suggestions);
  if (allSuggestions.length > 0) {
    lines.push(`## 修复建议汇总`);
    lines.push('');
    for (const s of allSuggestions) {
      lines.push(`- ${s}`);
    }
    lines.push('');
    lines.push(`> 💡 建议执行 ${maxRecommended} 轮修复后重新审计`);
    lines.push(`> 修复命令: \`speccore analyze -I <迭代> --audit-fix\``);
  }

  // 写入文件
  const auditPath = join(specDir, 'QUALITY_AUDIT.md');
  await writeFile(auditPath, lines.join('\n'));
  logger.info(`   📋 质量审计: ${avgScore}/100 | ${totalErrors} 严重 | ${totalWarnings} 建议 | 推荐 ${maxRecommended} 轮修复`);
  logger.info(`   📄 报告: ${join(specDir, 'QUALITY_AUDIT.md')}`);

  // 返回汇总结果
  return {
    document: 'ALL',
    platforms: [],
    global: [],
    score: avgScore,
    verdict: avgScore >= 70 ? 'pass' : avgScore >= 50 ? 'warn' : 'fail',
    suggestions: allSuggestions,
    recommendedRounds: maxRecommended,
  };
}
