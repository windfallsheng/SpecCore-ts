/**
 * function-map.ts — FUNCTION_MAP 解析与端覆盖交叉校验
 *
 * v8.3.343+:
 * 1. 从 taskify.ts 迁出 parseFunctionMap（表格/树形双格式），供 analyze 与 taskify 共享；
 * 2. 新增 detectNarrowPlatformDeclarations——「声明过窄检测」：
 *    doc2spec 写进 _matrix.md 的端声明语义是「这份端级需求文档属于哪个端」，
 *    而 FUNCTION_MAP 的端覆盖语义是「该功能单元跨端协作涉及哪些端」。
 *    两者语义不同却被同一字段承载，导致多端单元只有单端骨架、taskify 拿不到后端规格。
 *    本检测在 analyze 阶段比对两者：FUNCTION_MAP 声明了某端、_matrix 未声明、
 *    且该端目录无真实规格时，输出缺口警告（只告警不自动回灌，避免污染权威声明）。
 */
import { join } from 'path';
import { pathExists, readFile, readdir } from 'fs-extra';
import { GLOBAL_SPECS_DIR } from './spec-paths';
import { SKELETON_MARKER } from './spec-skeleton';

export interface FunctionMapUnit {
  name: string;
  platforms: string[];
  sharedCapability: string;
  dependsOn: string[];
  description: string;
}

/**
 * v7.4.2+: 解析 FUNCTION_MAP.md（表格格式优先，回退树形格式）。
 * 迁出自 taskify.ts 原 parseFunctionMap（v8.3.343），逻辑不变。
 */
export function parseFunctionMap(content: string, allPlatforms: string[]): FunctionMapUnit[] {
  const tableResult = parseFunctionMapTable(content, allPlatforms);
  if (tableResult.length > 0) return tableResult;
  return parseFunctionMapTree(content, allPlatforms);
}

/**
 * v7.4.2+: 解析 FUNCTION_MAP.md 表格格式
 */
function parseFunctionMapTable(content: string, allPlatforms: string[]): FunctionMapUnit[] {
  const units: FunctionMapUnit[] = [];
  const lines = content.split(/\r?\n/);
  let inTable = false;
  let platformColIdx = -1;
  let sharedCapColIdx = -1;
  let dependsOnColIdx = -1;
  let descColIdx = -1;
  // v8.3.345: 名称列定位。新格式表头「| 单元ID | 功能模块/功能单元 | 中文名 | 涉及端 | …」
  // 名称在第 2 列（首列是 M-01 这类单元ID）；旧格式「| 功能单元(目录名) | 名称 | 端列表 | …」
  // 名称在第 1 列。按表头含「功能模块/功能单元」且非「涉及端」定位，避免取到单元ID。
  let nameColIdx = -1;

  for (const line of lines) {
    if ((line.includes('功能单元') || line.includes('功能模块')) && line.includes('涉及端')) {
      inTable = true;
      const headerCells = line.split('|').map(c => c.trim()).filter(Boolean);
      platformColIdx = headerCells.findIndex(c => c.includes('涉及端'));
      sharedCapColIdx = headerCells.findIndex(c => c.includes('共享能力'));
      dependsOnColIdx = headerCells.findIndex(c => c.includes('依赖任务'));
      descColIdx = headerCells.findIndex(c => c.includes('说明'));
      nameColIdx = headerCells.findIndex(c =>
        (c.includes('功能模块') || c.includes('功能单元')) && !c.includes('涉及端'));
      continue;
    }
    if (!inTable) continue;
    if (line.startsWith('## ') && !line.includes('功能映射')) break;

    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length < 3) continue;
    if (cells.every(c => /^[-:]+$/.test(c))) continue;
    if (cells.some(c => c.includes('功能单元')) || cells.some(c => c.includes('涉及端'))) continue;

    // v8.3.268: 功能单元列此前取 cells[0]（旧数据「| 目录名 | 名称 | 端列表 | …」首列即目录名）。
    // v8.3.345: 新格式表头带「单元ID」列（首列 M-01），取 cells[0] 会拿到单元ID——
    // 改为优先表头定位列，无表头信息时兜底：首列若是单元ID 模式（M-01/F-01）取第二列。
    // 「dir（名称）」格式剥尾部括号注释。
    let unitNameRaw = '';
    if (nameColIdx >= 0 && nameColIdx < cells.length) {
      unitNameRaw = cells[nameColIdx];
    } else {
      const first = cells[0] || '';
      unitNameRaw = /^[A-Za-z]+-\d+$/.test(first) ? (cells[1] || first) : first;
    }
    const unitName = unitNameRaw.replace(/[（(][^）)]*[）)]$/, '').trim();
    if (!unitName || unitName === '#' || unitName === '功能单元') continue;

    let platforms: string[] = [];
    if (platformColIdx >= 0 && platformColIdx < cells.length) {
      const raw = cells[platformColIdx];
      if (raw && raw !== '无' && raw !== '—' && raw !== '-') {
        platforms = raw.split(/[,，]/).map(p => p.trim()).filter(p => p && allPlatforms.includes(p));
      }
    }
    // v8.3.268: 端列自适应——AI 落盘 FUNCTION_MAP 表格可能列错位（涉及端表头下是
    // 名称、端列表落在其他列），按表头解析落空时扫描整行，找「逗号分隔且 ≥2 个
    // 值全部属于标准端名」的单元格作为端列，避免静默回退全端平铺。
    if (platforms.length === 0) {
      platforms = findAdaptivePlatformCell(cells, allPlatforms);
    }
    if (platforms.length === 0) platforms = [...allPlatforms];

    let sharedCapability = '无';
    if (sharedCapColIdx >= 0 && sharedCapColIdx < cells.length) {
      const raw = cells[sharedCapColIdx];
      if (raw && raw !== '无' && raw !== '—' && raw !== '-') sharedCapability = raw;
    }

    let dependsOn: string[] = [];
    if (dependsOnColIdx >= 0 && dependsOnColIdx < cells.length) {
      const raw = cells[dependsOnColIdx];
      if (raw && raw !== '无' && raw !== '—' && raw !== '-') {
        dependsOn = raw.split(/[,，]/).map(p => p.trim()).filter(Boolean);
      }
    }

    let description = '';
    if (descColIdx >= 0 && descColIdx < cells.length) description = cells[descColIdx];

    units.push({ name: unitName, platforms, sharedCapability, dependsOn, description });
  }
  return units;
}

/**
 * v7.4.2+: 解析 FUNCTION_MAP.md 树形格式
 * 匹配: ├── 会议室 CRUD .............. room-service ✅ | admin-web ✅
 * 提取: 模块名="会议室 CRUD", 涉及端=[room-service, admin-web]
 */
function parseFunctionMapTree(content: string, allPlatforms: string[]): FunctionMapUnit[] {
  const units: FunctionMapUnit[] = [];
  const lines = content.split(/\r?\n/);
  const treeNodeRe = /[├└]──\s*/;
  const separatorRe = /\s*[.·]{3,}\s*/;

  for (const line of lines) {
    if (!treeNodeRe.test(line)) continue;

    const afterTree = line.replace(/.*[├└]──\s*/, '').trim();
    if (!afterTree) continue;

    // 跳过分类型节点（如 ├── 🏢 会议室管理），这些是父级分类
    if (!separatorRe.test(afterTree) && !afterTree.includes('✅') && !afterTree.includes('❌') && !afterTree.includes('⚠️')) {
      continue;
    }

    const parts = afterTree.split(separatorRe);
    if (parts.length < 2) continue;

    let unitName = parts[0].replace(/[🏢📅✅💰🔔👥📊⚙️🔑🛡️]/g, '').trim();
    if (!unitName || unitName.length < 2) continue;

    const platformPart = parts.slice(1).join(' ');
    const platforms: string[] = [];
    for (const p of allPlatforms) {
      if (platformPart.includes(p)) {
        platforms.push(p);
      }
    }
    if (platforms.length === 0) {
      platforms.push(...allPlatforms);
    }

    units.push({ name: unitName, platforms, sharedCapability: '无', dependsOn: [], description: '' });
  }
  return units;
}

/** 端列自适应定位：找「逗号分隔且 ≥2 个值全部属于标准端名」的单元格 */
function findAdaptivePlatformCell(cells: string[], allPlatforms: string[]): string[] {
  for (const cell of cells) {
    const parts = cell.split(/[,，]/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2 && parts.every(p => allPlatforms.includes(p))) {
      return parts;
    }
  }
  return [];
}

// ================================================================
// v8.3.343+: 声明过窄检测（FUNCTION_MAP 端覆盖 × _matrix 声明交叉校验）
// ================================================================

export interface NarrowPlatformGap {
  /** 功能单元目录名（如 admin-web-03-booking-management） */
  feature: string;
  /** _matrix.md 已声明的端 */
  declared: string[];
  /** FUNCTION_MAP 声明的端 */
  functionMap: string[];
  /** FUNCTION_MAP 有、声明无、且端目录无真实规格的端（需要补端分析） */
  missing: string[];
  /** FUNCTION_MAP 有、声明无、但端目录已有真实规格的端（_matrix 声明滞后，需同步声明） */
  undeclared: string[];
}

/**
 * v8.3.343+: 声明过窄检测。
 *
 * 背景：doc2spec 生成的 _matrix.md platforms 语义是「端级需求文档所属端」（常为单端），
 * 而 analyze 阶段 AI 写入的 FUNCTION_MAP 端覆盖语义是「功能单元跨端协作涉及端」（多端）。
 * 此前两者无交叉校验：骨架按单端声明收敛，后端端级规格缺失时静默通过，
 * taskify 拿不到后端规格（瞎编或漏任务）、execute 代码生成不完整。
 *
 * 策略：只读检测 + 警告（不回灌 _matrix，避免 AI 生成的 FUNCTION_MAP 污染权威声明）。
 * 锚定方式：FUNCTION_MAP 每行中与功能单元目录名精确相等的单元格 → 该行端列。
 * 目录名匹配不到的行跳过（宁缺勿滥，不做模糊匹配）。
 *
 * 两类缺口：
 * - missing：端级规格缺失 → 需补端分析；
 * - undeclared：端级规格已存在但 _matrix 未声明 → 声明滞后。
 *   后者也必须报：taskify 的 readMatrixPlatforms 非空即采信（端级文档反推被短路），
 *   声明不更新则多端子任务依然不会生成，补的端分析白费。
 *
 * @param iterDir 迭代目录绝对路径
 * @param features 功能单元目录名列表（parseFeatureList 产物）
 * @param declaredMap 单元 → _matrix 声明端映射（resolveFeaturePlatformMap 产物）
 * @param allPlatforms CONSTITUTION 标准端列表
 */
export async function detectNarrowPlatformDeclarations(
  iterDir: string,
  features: string[],
  declaredMap: Map<string, string[]>,
  allPlatforms: string[],
): Promise<NarrowPlatformGap[]> {
  if (features.length === 0) return [];
  const funcMapPath = join(iterDir, '020-specs', GLOBAL_SPECS_DIR, 'FUNCTION_MAP.md');
  if (!(await pathExists(funcMapPath))) return [];
  const content = await readFile(funcMapPath, 'utf-8').catch(() => '');
  if (!content.trim() || content.includes(SKELETON_MARKER)) return [];

  const rows = parseFunctionMapRawRows(content, allPlatforms);
  const featureSet = new Set(features);
  const gaps: NarrowPlatformGap[] = [];
  const specDir = join(iterDir, '020-specs');

  for (const row of rows) {
    // 锚定目录名：行内存在与功能单元目录名精确相等的单元格
    const featureCell = row.cells.find(c => featureSet.has(c));
    if (!featureCell) continue;
    const declared = declaredMap.get(featureCell) || [];
    const fmPlatforms = row.platforms.filter(p => allPlatforms.includes(p));
    if (fmPlatforms.length === 0) continue;
    // FUNCTION_MAP 声明了但 _matrix 未声明的端
    const beyond = fmPlatforms.filter(p => !declared.includes(p));
    if (beyond.length === 0) continue;
    // 分流：端目录无真实规格 → missing（补端分析）；已有真实规格 → undeclared（同步声明）
    const missing: string[] = [];
    const undeclared: string[] = [];
    for (const p of beyond) {
      const platformDir = join(specDir, featureCell, p);
      if (!(await pathExists(platformDir))) { missing.push(p); continue; }
      const hasReal = await dirHasRealContent(platformDir);
      if (!hasReal) missing.push(p);
      else undeclared.push(p);
    }
    if (missing.length > 0 || undeclared.length > 0) {
      gaps.push({ feature: featureCell, declared, functionMap: fmPlatforms, missing, undeclared });
    }
  }
  return gaps;
}

/** FUNCTION_MAP 表格行级解析：每行 cells + 自适应端列（与 parseFunctionMapTable 同口径） */
function parseFunctionMapRawRows(content: string, allPlatforms: string[]): { cells: string[]; platforms: string[] }[] {
  const rows: { cells: string[]; platforms: string[] }[] = [];
  const lines = content.split(/\r?\n/);
  let inTable = false;
  for (const line of lines) {
    if ((line.includes('功能单元') || line.includes('功能模块')) && line.includes('涉及端')) { inTable = true; continue; }
    if (!inTable) continue;
    if (line.startsWith('## ') && !line.includes('功能映射')) break;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length < 3) continue;
    if (cells.every(c => /^[-:]+$/.test(c))) continue;
    if (cells.some(c => c.includes('功能单元')) || cells.some(c => c.includes('涉及端'))) continue;
    // 端列自适应：找「逗号分隔且 ≥2 个值全部属于标准端名」的单元格
    const platforms = findAdaptivePlatformCell(cells, allPlatforms);
    rows.push({ cells, platforms });
  }
  return rows;
}

/** 目录内存在非骨架真实内容（≥100 字符的 .md/.yaml 即算） */
async function dirHasRealContent(dir: string): Promise<boolean> {
  const files = await readdir(dir, { withFileTypes: true }).catch(() => [] as import('fs').Dirent[]);
  for (const f of files) {
    if (!f.isFile()) continue;
    if (!/\.(md|yaml|yml)$/.test(f.name)) continue;
    const c = await readFile(join(dir, f.name), 'utf-8').catch(() => '');
    const t = c.trim();
    if (t && !t.includes(SKELETON_MARKER) && t.length >= 100) return true;
  }
  return false;
}
