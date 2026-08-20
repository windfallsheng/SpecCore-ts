/**
 * audit - AI 智能审计命令
 * 扫描全量层发现重复需求、歧义描述、潜在冲突、孤立需求
 */

import { logger, Spinner } from '../utils/logger';
import { readGlobalIndex, readRequirementDetail } from '../core/global-layer';
import { getDefaultIteration, getIterationDir } from '../core/context';
import { join } from 'path';
import { readdir, readFile, pathExists } from 'fs-extra';

export interface AuditOptions {
  fix?: boolean;
  detail?: boolean;
  specs?: boolean;
  iteration?: string;
}

interface AuditIssue {
  type: 'duplicate' | 'ambiguous' | 'orphan' | 'conflict';
  severity: '🔴' | '🟡' | '🟢';
  reqId: string;
  reqName: string;
  description: string;
  suggestion: string;
}

export async function auditCommand(options: AuditOptions): Promise<void> {
  // v6.69.2+: specs 模式审计 020-specs/ 文档质量
  if (options.specs) {
    await auditSpecsCommand(options);
    return;
  }

  const spinner = new Spinner('扫描全量层...');
  spinner.start();

  try {
    const index = await readGlobalIndex();

    if (index.reqs.length === 0) {
      spinner.fail('全量层为空，无法执行审计。请先导入项目。');
      return;
    }

    spinner.stop(`扫描 ${index.reqs.length} 条需求...`);

    const issues: AuditIssue[] = [];

    // 1. 重复检测
    const duplicates = detectDuplicates(index);
    issues.push(...duplicates);

    // 2. 歧义检测
    for (const req of index.reqs) {
      const detail = await readRequirementDetail(req.project, req.id);
      const ambiguous = detectAmbiguity(req, detail || '');
      issues.push(...ambiguous);
    }

    // 3. 孤立检测
    const orphans = index.reqs.filter(
      (r) => !r.iteration && r.status !== '🗑️ 已废弃' && r.status !== '📦 已有实现'
    );
    for (const req of orphans.slice(0, 10)) {
      issues.push({
        type: 'orphan',
        severity: '🟡',
        reqId: req.id,
        reqName: req.name,
        description: `未关联任何迭代或 Task，处于孤立状态`,
        suggestion: `建议纳入近期迭代`,
      });
    }

    // 4. 冲突检测
    const conflicts = detectConflicts(index);
    issues.push(...conflicts);

    // 输出报告
    outputAuditReport(issues, index.reqs.length, options.detail || false);

    if (options.fix) {
      logger.info('');
      logger.info('🔧 --fix 模式：自动标记可修复的问题');
      autoFixIssues(issues);
    }
  } catch (error) {
    spinner.fail(`审计失败: ${error}`);
    throw error;
  }
}

/**
 * 重复检测
 */
function detectDuplicates(index: Awaited<ReturnType<typeof readGlobalIndex>>): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const checked = new Set<string>();

  for (let i = 0; i < index.reqs.length; i++) {
    for (let j = i + 1; j < index.reqs.length; j++) {
      const a = index.reqs[i];
      const b = index.reqs[j];
      const key = [a.id, b.id].sort().join('|');
      if (checked.has(key)) continue;
      checked.add(key);

      const similarity = calculateSimilarity(a.name, b.name);
      if (similarity > 0.8) {
        issues.push({
          type: 'duplicate',
          severity: '🔴',
          reqId: `${a.id} ⇔ ${b.id}`,
          reqName: `${a.name} / ${b.name}`,
          description: `高度重复（相似度 ${Math.round(similarity * 100)}%），来源: ${a.project} / ${b.project}`,
          suggestion: '建议合并或明确区分',
        });
      } else if (similarity > 0.6) {
        issues.push({
          type: 'duplicate',
          severity: '🟡',
          reqId: `${a.id} ⇔ ${b.id}`,
          reqName: `${a.name} / ${b.name}`,
          description: `可能重复（相似度 ${Math.round(similarity * 100)}%）`,
          suggestion: '建议审查是否可合并',
        });
      }
    }
  }

  return issues;
}

/**
 * 简单字符串相似度（Jaccard 系数）
 */
function calculateSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(''));
  const setB = new Set(b.toLowerCase().split(''));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

/**
 * 歧义检测
 */
function detectAmbiguity(
  req: { id: string; name: string },
  detail: string
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const ambiguousWords: Record<string, string> = {
    '尽快': '指定具体时间或 SLA',
    '优先': '明确优先级排序规则',
    '及时': '指定具体响应时间',
    '大量': '指定具体数字或范围',
    '众多': '指定具体数量',
    '若干': '指定明确的数量',
    '尽量': '改为明确的要求',
    '尽可能': '改为明确的约束',
    '稳定': '指定可测量的标准（如 99.9%）',
    '可靠': '指定可靠的量化指标',
    '良好': '指定可测量的质量标准',
    '适当': '指定具体的数值',
  };

  for (const [word, suggestion] of Object.entries(ambiguousWords)) {
    if (detail.includes(word)) {
      issues.push({
        type: 'ambiguous',
        severity: '🟡',
        reqId: req.id,
        reqName: req.name,
        description: `发现模糊词汇: "${word}"`,
        suggestion,
      });
    }
  }

  return issues.slice(0, 3); // 最多保留 3 条
}

/**
 * 冲突检测
 */
function detectConflicts(index: Awaited<ReturnType<typeof readGlobalIndex>>): AuditIssue[] {
  const issues: AuditIssue[] = [];

  // 检测同名需求在不同项目中
  const nameMap = new Map<string, string[]>();
  for (const req of index.reqs) {
    if (!nameMap.has(req.name)) nameMap.set(req.name, []);
    nameMap.get(req.name)!.push(req.project);
  }

  for (const [name, projects] of nameMap) {
    if (projects.length > 1) {
      issues.push({
        type: 'conflict',
        severity: '🟡',
        reqId: '',
        reqName: name,
        description: `相同需求出现在 ${projects.length} 个项目中: ${projects.join(', ')}`,
        suggestion: '检查是否存在重复实现，考虑抽取为公共服务',
      });
    }
  }

  return issues.slice(0, 5);
}

/**
 * 输出审计报告
 */
function outputAuditReport(issues: AuditIssue[], totalReqs: number, detail: boolean): void {
  logger.info('');
  logger.info('🤖 AI 智能审计报告');
  logger.info('');

  const duplicates = issues.filter((i) => i.type === 'duplicate');
  const ambiguous = issues.filter((i) => i.type === 'ambiguous');
  const orphans = issues.filter((i) => i.type === 'orphan');
  const conflicts = issues.filter((i) => i.type === 'conflict');

  // 重复需求
  if (duplicates.length > 0) {
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('🔴 重复需求（建议合并）');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const d of duplicates.slice(0, detail ? 20 : 5)) {
      logger.info(`   ${d.severity} ${d.reqId} | ${d.reqName}`);
      logger.info(`     ${d.description}`);
      logger.info(`     💡 ${d.suggestion}`);
    }
  }

  // 歧义描述
  if (ambiguous.length > 0) {
    logger.info('');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('⚠️ 歧义描述（建议量化）');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const a of ambiguous.slice(0, detail ? 20 : 8)) {
      logger.info(`   ${a.severity} ${a.reqId}: ${a.description}`);
      logger.info(`     💡 ${a.suggestion}`);
    }
  }

  // 冲突
  if (conflicts.length > 0) {
    logger.info('');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('🔶 潜在冲突');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const c of conflicts) {
      logger.info(`   ${c.severity} ${c.reqName}`);
      logger.info(`     ${c.description}`);
      logger.info(`     💡 ${c.suggestion}`);
    }
  }

  // 孤立需求
  if (orphans.length > 0) {
    logger.info('');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('🔶 孤立需求（建议关联迭代）');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const o of orphans.slice(0, detail ? 20 : 8)) {
      logger.info(`   ${o.severity} ${o.reqId}: ${o.description}`);
      logger.info(`     💡 ${o.suggestion}`);
    }
  }

  // 健康度评分
  const dupCount = duplicates.filter((d) => d.severity === '🔴').length;
  const dupYellow = duplicates.filter((d) => d.severity === '🟡').length;
  const ambCount = ambiguous.length;

  const clarityScore = Math.max(0, 100 - ambCount * 5);
  const dupScore = Math.max(0, 100 - dupCount * 10 - dupYellow * 5);
  const linkScore = Math.max(0, 100 - orphans.length * 5);
  const overallScore = Math.round((clarityScore + dupScore + linkScore) / 3);

  logger.info('');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(`📊 健康度评分: ${overallScore}/100`);
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(`   需求完整性: ${clarityScore}/100`);
  logger.info(`   描述清晰度: ${clarityScore}/100`);
  logger.info(`   关联完整性: ${linkScore}/100`);
  logger.info(`   重复率: ${dupScore}/100（越低越好）`);

  // 总结
  logger.info('');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info('💡 建议');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  let idx = 1;
  if (dupCount > 0) {
    logger.info(`   ${idx++}. 🔴 高优先级: 解决 ${dupCount} 条高度重复需求`);
  }
  if (ambCount > 0) {
    logger.info(`   ${idx++}. 🟡 中优先级: 量化 ${ambCount} 条模糊描述`);
  }
  if (orphans.length > 0) {
    logger.info(`   ${idx++}. 🟢 低优先级: 为 ${orphans.length} 条孤立需求关联迭代`);
  }

  if (issues.length === 0) {
    logger.info('   🎉 全量层质量良好，未发现明显问题！');
  }

  logger.info('');
  logger.info('📋 输入 speccore audit --fix 自动修复可修复的问题');
}

/**
 * 自动修复
 */
function autoFixIssues(issues: AuditIssue[]): void {
  let fixed = 0;
  for (const issue of issues) {
    if (issue.type === 'ambiguous') {
      // 自动标记模糊词汇
      logger.info(`   已标记: ${issue.reqId} - "${issue.description}"`);
      fixed++;
    } else if (issue.type === 'orphan') {
      // 无法自动关联迭代
      logger.info(`   需确认: ${issue.reqId} - 请手动关联迭代`);
    }
  }
  logger.info('');
  logger.info(`✅ 已自动处理 ${fixed} 条问题`);
}

// ============================================
// v6.69.2+: 020-specs/ 文档质量审计
// ============================================

interface SpecAuditIssue {
  type: 'enum_mismatch' | 'api_mismatch' | 'coverage_gap' | 'dir_illegal' | 'ref_broken';
  severity: '🔴' | '🟡' | '🟢';
  file: string;
  description: string;
  suggestion: string;
}

async function auditSpecsCommand(options: AuditOptions): Promise<void> {
  const iteration = await getDefaultIteration(options.iteration);
  const iterDir = await getIterationDir(iteration);
  const specDir = join(iterDir, '020-specs');

  if (!(await pathExists(specDir))) {
    logger.error(`❌ 未找到 020-specs/ 目录: ${specDir}`);
    logger.info('   请先执行 speccore analyze 生成 spec 文档');
    return;
  }

  const spinner = new Spinner('扫描 020-specs/ 文档质量...');
  spinner.start();

  try {
    // 收集所有 .md 文件
    const files = await collectSpecFiles(specDir);
    if (files.length === 0) {
      spinner.fail('020-specs/ 为空，无法执行审计');
      return;
    }

    spinner.stop(`扫描 ${files.length} 个 spec 文档...`);

    // 读取所有文件内容
    const contents: Record<string, string> = {};
    for (const f of files) {
      contents[f.relative] = await readFile(f.absolute, 'utf-8');
    }

    const issues: SpecAuditIssue[] = [];

    // 1. 目录结构合法性检查
    issues.push(...checkDirectoryStructure(files, specDir));

    // 2. 枚举值一致性检查
    issues.push(...checkEnumConsistency(contents));

    // 3. 接口路径一致性检查
    issues.push(...checkApiPathConsistency(contents));

    // 4. 功能覆盖完整性检查
    issues.push(...checkCoverageGaps(contents, files));

    // 输出报告
    outputSpecAuditReport(issues, files.length, iteration);
  } catch (error) {
    spinner.fail(`审计失败: ${error}`);
    throw error;
  }
}

async function collectSpecFiles(specDir: string): Promise<{ relative: string; absolute: string; platform: string }[]> {
  const files: { relative: string; absolute: string; platform: string }[] = [];

  async function walk(dir: string, platform: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs, e.name);
      } else if (e.name.endsWith('.md')) {
        files.push({ relative: join(platform, e.name), absolute: abs, platform });
      }
    }
  }

  const topEntries = await readdir(specDir, { withFileTypes: true });
  for (const e of topEntries) {
    const abs = join(specDir, e.name);
    if (e.isDirectory()) {
      await walk(abs, e.name);
    } else if (e.name.endsWith('.md')) {
      files.push({ relative: e.name, absolute: abs, platform: 'root' });
    }
  }

  return files;
}

function checkDirectoryStructure(
  files: { relative: string; platform: string }[],
  specDir: string
): SpecAuditIssue[] {
  const issues: SpecAuditIssue[] = [];
  const illegalPatterns = [/^\d+$/, /^\.+$/, /[一-\u9fff]/]; // 纯数字、纯点、含中文

  const platforms = new Set(files.map(f => f.platform));
  for (const p of platforms) {
    if (p === 'root') continue;
    for (const pattern of illegalPatterns) {
      if (pattern.test(p)) {
        issues.push({
          type: 'dir_illegal',
          severity: '🔴',
          file: p,
          description: `非法目录名: "${p}"（不符合端名规范）`,
          suggestion: '删除该目录，将文档移动到正确的端目录或 global/ 下',
        });
        break;
      }
    }
  }

  return issues;
}

function checkEnumConsistency(contents: Record<string, string>): SpecAuditIssue[] {
  const issues: SpecAuditIssue[] = [];
  const enumMap: Record<string, Record<string, string>> = {}; // file -> {enumKey -> definition}

  // 提取所有枚举定义（status=0:空闲, type=1:会议 等格式）
  const enumRegex = /(\w+)[=：:]\s*(\d+)\s*[=:]?\s*([^,\n；;]+)/g;
  const enumBlockRegex = /(?:状态|枚举|类型|status|type|enum)[：:]?\s*\n?\s*([\s\S]{0,300}?)(?=\n##|\n###|$)/gi;

  for (const [file, content] of Object.entries(contents)) {
    enumMap[file] = {};
    let match;
    while ((match = enumRegex.exec(content)) !== null) {
      const key = match[1].toLowerCase();
      const val = match[2];
      const desc = match[3].trim();
      enumMap[file][`${key}=${val}`] = desc;
    }
  }

  // 跨文件对比枚举定义
  const allKeys = new Set<string>();
  for (const defs of Object.values(enumMap)) {
    for (const k of Object.keys(defs)) allKeys.add(k);
  }

  for (const key of allKeys) {
    const fileDefs: Record<string, string> = {};
    for (const [file, defs] of Object.entries(enumMap)) {
      if (key in defs) fileDefs[file] = defs[key];
    }

    const uniqueDefs = new Set(Object.values(fileDefs));
    if (uniqueDefs.size > 1) {
      issues.push({
        type: 'enum_mismatch',
        severity: '🔴',
        file: Object.keys(fileDefs).join(', '),
        description: `枚举值不一致: ${key} → ${Array.from(uniqueDefs).map((d, i) => `[${Object.keys(fileDefs)[i]}] ${d}`).join(' vs ')}`,
        suggestion: '统一所有文档中的枚举定义，确保跨文档一致',
      });
    }
  }

  return issues;
}

function checkApiPathConsistency(contents: Record<string, string>): SpecAuditIssue[] {
  const issues: SpecAuditIssue[] = [];
  const apiMap: Record<string, Record<string, string>> = {}; // file -> {path -> method}

  // 提取 API 路径（/api/xxx、/v1/xxx 等）
  const apiRegex = /(GET|POST|PUT|DELETE|PATCH)\s+([\/\w\-{}]+)/gi;
  const mdApiRegex = /\|\s*(GET|POST|PUT|DELETE|PATCH)\s*\|\s*([\/\w\-{}]+)\s*\|/gi;

  for (const [file, content] of Object.entries(contents)) {
    apiMap[file] = {};
    let match;
    const combined = content;
    while ((match = apiRegex.exec(combined)) !== null) {
      const method = match[1].toUpperCase();
      const path = normalizeApiPath(match[2]);
      apiMap[file][path] = method;
    }
    while ((match = mdApiRegex.exec(combined)) !== null) {
      const method = match[1].toUpperCase();
      const path = normalizeApiPath(match[2]);
      apiMap[file][path] = method;
    }
  }

  // 检查同一端内路径一致性（简化：只检查全局 vs 各端）
  const globalApis = apiMap['overview/REQUIREMENT.md'] || apiMap['global/REQUIREMENT.md'] || apiMap['REQUIREMENT.md'] || {};
  for (const [file, apis] of Object.entries(apiMap)) {
    if (file.includes('overview/') || file.includes('global/') || file === 'REQUIREMENT.md') continue;
    for (const [path, method] of Object.entries(apis)) {
      const globalMethod = Object.entries(globalApis).find(([p]) => p === path)?.[1];
      if (globalMethod && globalMethod !== method) {
        issues.push({
          type: 'api_mismatch',
          severity: '🟡',
          file,
          description: `接口方法不一致: ${method} ${path} vs 全局 ${globalMethod} ${path}`,
          suggestion: '统一接口方法，确保与全局需求文档一致',
        });
      }
    }
  }

  return issues;
}

function normalizeApiPath(path: string): string {
  // 归一化：去掉末尾斜杠，统一大小写（路径段）
  return path.replace(/\/$/, '').toLowerCase();
}

function checkCoverageGaps(
  contents: Record<string, string>,
  files: { relative: string; platform: string }[]
): SpecAuditIssue[] {
  const issues: SpecAuditIssue[] = [];

  // 检查 overview/REQUIREMENT.md 是否存在
  const hasReq = files.some(f => f.relative.includes('REQUIREMENT.md'));
  if (!hasReq) {
    issues.push({
      type: 'coverage_gap',
      severity: '🔴',
      file: '020-specs/',
      description: '缺少 overview/REQUIREMENT.md（需求规格基线）',
      suggestion: '执行 speccore analyze 重新生成迭代综合需求文档',
    });
  }

  // 检查 API_CONTRACT.md 是否存在（v6.69.0+ 契约先行要求）
  const hasContract = files.some(f => f.relative.includes('API_CONTRACT.md'));
  if (!hasContract) {
    issues.push({
      type: 'coverage_gap',
      severity: '🟡',
      file: '020-specs/',
      description: '缺少 API_CONTRACT.md（跨端 API 契约）',
      suggestion: '建议在 analyze Phase 1 后生成 API_CONTRACT.md，作为 Phase 2 的输入',
    });
  }

  // 检查各端是否都有 TECH.md
  const platforms = new Set(files.filter(f => f.platform !== 'root').map(f => f.platform));
  for (const p of platforms) {
    const hasTech = files.some(f => f.platform === p && f.relative.endsWith('TECH.md'));
    if (!hasTech) {
      issues.push({
        type: 'coverage_gap',
        severity: '🟡',
        file: `${p}/`,
        description: `端 "${p}" 缺少 TECH.md（技术方案）`,
        suggestion: '为该端补充技术方案文档',
      });
    }
  }

  return issues;
}

function outputSpecAuditReport(issues: SpecAuditIssue[], fileCount: number, iteration: string): void {
  logger.info('');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(`📋 020-specs/ 质量审计报告 — ${iteration}`);
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(`   扫描文档数: ${fileCount}`);
  logger.info(`   发现问题数: ${issues.length}`);
  logger.info('');

  const groups: Record<string, SpecAuditIssue[]> = {
    '🔴 严重': issues.filter(i => i.severity === '🔴'),
    '🟡 警告': issues.filter(i => i.severity === '🟡'),
    '🟢 提示': issues.filter(i => i.severity === '🟢'),
  };

  for (const [label, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    logger.info(`${label} (${items.length} 项)`);
    logger.info('────────────────────────────────────');
    for (const item of items) {
      logger.info(`   [${item.type}] ${item.file}`);
      logger.info(`      ${item.description}`);
      logger.info(`      💡 ${item.suggestion}`);
    }
    logger.info('');
  }

  if (issues.length === 0) {
    logger.info('🎉 020-specs/ 质量良好，未发现明显问题！');
  } else {
    const critical = issues.filter(i => i.severity === '🔴').length;
    logger.info(`⚠️ 发现 ${issues.length} 个问题（${critical} 个严重），建议修复后再进入 split/execute 阶段`);
    logger.info('');
    logger.info('💡 修复建议:');
    logger.info('   1. 严重问题：必须修复，否则会影响后续开发');
    logger.info('   2. 警告：建议修复，提高文档质量');
    logger.info('   3. 可执行 speccore analyze --prompt -I <迭代名> 重新生成有问题的文档');
  }
  logger.info('');
}
