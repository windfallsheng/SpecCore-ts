/**
 * unit-staffing —— 功能单元人员归属核心（v8.3.302+）
 *
 * 将「负责人」从任务级（030-tasks owner）前置到单元级（_matrix.md owners 声明）：
 *   - unitize：写入 owners 空声明（端推断回填后才有端可推导）
 *   - analyze：端推断回填 platforms 后，按 STAFFING 方向推导候选写入 pending，
 *     人工在 _matrix.md 把候选拍板为 confirmed（单一事实源）
 *   - taskify：autoAssign 优先消费 confirmed 声明，负荷均衡兜底
 *   - SpecTest：gen 阶段读取 confirmed 声明，作为第三事实源
 *
 * 铁律（与 SpecTest 人员读取层一致）：报缺不脑补——
 * 方向唯一成员才写入候选；多人或无人时保持缺省，由人工声明。
 */
import { pathExists, readFile, writeFile, ensureDir } from 'fs-extra';
import { join, resolve } from 'path';
import { logger } from '../utils/logger';

/** STAFFING.md 单行成员 */
export interface StaffingMember {
  name: string;
  /** 平台方向（可多个，如 APP / H5 / admin / 小程序） */
  directions: string[];
  /** 投入比例（%） */
  capacity: number;
  /**
   * 成员状态（v8.3.321+）：active 在职 / inactive 出项目。
   * undefined = 未声明（基座缺省视为在职；迭代覆盖层缺省不覆盖，继承基座状态）
   */
  status?: 'active' | 'inactive';
}

/** _matrix.md owners 段单条声明 */
export interface UnitOwnerDecl {
  /** 标准端名（与 CONSTITUTION 端列表一致） */
  platform: string;
  /** 负责人姓名 */
  name: string;
  /** pending=候选待人工拍板 / confirmed=已确认 */
  status: 'pending' | 'confirmed';
}

/** 安全读取文件内容；缺失/读失败返回空串 */
function readOrEmpty(path: string): string {
  try {
    return require('fs').existsSync(path) ? require('fs').readFileSync(path, 'utf-8') : '';
  } catch {
    return '';
  }
}

/** 从起始目录向上查找 .speccore/ 所在项目根（迭代目录可能位于任意深度） */
export function findSpeccoreRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (require('fs').existsSync(join(dir, '.speccore'))) return dir;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 解析含「成员 / 平台方向 / 投入比例」列的 Markdown 人员表格（按表头定位列，兼容列序差异）。
 * TEAM.md（全员基座，多列）与 STAFFING.md（迭代覆盖，三/四列）共用此解析器；
 * 表头缺「平台方向」列（旧版 TEAM.md 仅 5 列）时返回空数组（基座不可用，回退仅迭代级）。
 * 「状态」列（v8.3.321+）：出/离/停/inactive 归一为 inactive，其余为 active；
 * 无此列或该行留空 → undefined（基座缺省在职，迭代层缺省不覆盖）。
 */
export function parseStaffingTable(content: string): StaffingMember[] {
  let nameIdx = -1, dirIdx = -1, capIdx = -1, statusIdx = -1;
  const members: StaffingMember[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.startsWith('|') || line.includes(':---')) continue;
    // 只去首尾空项（| 包裹产生），保留中间空列（如「| 张三 | | 0% |」的方向留空）
    const cols = line.split('|').map((c: string) => c.trim());
    if (cols[0] === '') cols.shift();
    if (cols.length > 0 && cols[cols.length - 1] === '') cols.pop();
    if (cols.length < 3) continue;
    // 表头行：定位「成员/平台方向/投入比例/状态」列索引
    if (nameIdx < 0 && (cols[0] === '成员' || cols[0] === '人员')) {
      cols.forEach((c, i) => {
        if (c === '成员' || c === '人员') nameIdx = i;
        else if (c === '平台方向' || c === '方向') dirIdx = i;
        else if (c === '投入比例' || c === '比例') capIdx = i;
        else if (c === '状态') statusIdx = i;
      });
      continue;
    }
    if (nameIdx < 0) continue; // 表头未出现前忽略
    const name = cols[nameIdx];
    if (!name) continue;
    // 投入比例解析：0% 是合法值（本迭代不参与），不能用 || 兜底成 100
    const rawCap = capIdx >= 0 ? (cols[capIdx] || '100') : '100';
    const cap = parseInt(rawCap);
    // 状态归一化：留空/无列 = undefined（不声明）
    const rawStatus = statusIdx >= 0 ? (cols[statusIdx] || '') : '';
    const status: 'active' | 'inactive' | undefined = rawStatus
      ? (/出|离|停|inactive|off|exit/i.test(rawStatus) ? 'inactive' : 'active')
      : undefined;
    members.push({
      name,
      directions: dirIdx >= 0
        ? (cols[dirIdx] || '').split(/[,，、]/).map((d: string) => d.trim()).filter(Boolean)
        : [],
      capacity: Number.isNaN(cap) ? 100 : cap,
      status,
    });
  }
  return dirIdx < 0 ? [] : members;
}

/**
 * 两级合并（v8.3.319+）：全局基座（TEAM.md 全员名册）为底，迭代覆盖层（STAFFING.md）
 * 同名成员整体覆盖方向/比例（含方向留空 = 本迭代不做该方向），迭代独有成员追加末尾；
 * 未在迭代列出的基座成员默认保留（全员名册一次维护，已建迭代即时继承）。
 * 状态（v8.3.321+）：迭代层未声明状态时继承基座状态（写「在职」可复活出项目成员，写「出项目」可局部停用）。
 */
export function mergeStaffing(
  globalMembers: StaffingMember[],
  iterationMembers: StaffingMember[]
): StaffingMember[] {
  if (globalMembers.length === 0) return [...iterationMembers];
  if (iterationMembers.length === 0) return [...globalMembers];
  const merged = [...globalMembers];
  for (const m of iterationMembers) {
    const idx = merged.findIndex((g) => g.name === m.name);
    if (idx >= 0) merged[idx] = { ...m, status: m.status ?? merged[idx].status };
    else merged.push({ ...m });
  }
  return merged;
}

/**
 * 读取人员排期（两级合并）：全局 .speccore/PROJECT/TEAM.md 全员基座
 * + 迭代 STAFFING.md 差异覆盖（v8.3.319+）。任一文件缺失均不阻塞。
 * v8.3.321+：出项目（inactive）成员统一剔除——analyze 候选推导、
 * taskify 负荷均衡自动跳过，只选在职成员；已拍板/已固化的 .meta/owner 不受影响。
 */
export function loadStaffing(iterationDir: string): StaffingMember[] {
  const iterationMembers = parseStaffingTable(
    readOrEmpty(join(iterationDir, 'STAFFING.md'))
  );
  const root = findSpeccoreRoot(iterationDir);
  const globalMembers = root
    ? parseStaffingTable(readOrEmpty(join(root, '.speccore', 'PROJECT', 'TEAM.md')))
    : [];
  // 基座未声明状态 = 在职
  const base = globalMembers.map((m) => ({ ...m, status: m.status ?? 'active' as const }));
  return mergeStaffing(base, iterationMembers).filter((m) => m.status !== 'inactive');
}

/** 端名 ↔ STAFFING 方向匹配：先精确双向包含，再按类别词别名词边界匹配（如「后台」→ backend/service） */
const DIRECTION_ALIASES: Record<string, string[]> = {
  '后台': ['backend', 'service'],
  'web': ['h5', 'frontend'],
  'app': [],
  '小程序': ['miniapp', 'mini'],
};

export function matchDirection(platform: string, direction: string): boolean {
  const p = platform.toLowerCase();
  const d = direction.toLowerCase();
  // 全词边界匹配（app 不误匹配 miniapp；h5 词边界命中 h5-mobile）
  const word = (w: string) => new RegExp(`(^|[-_.])${w}([-_.]|$)`).test(p);
  if (word(d)) return true;
  // 类别词别名：词边界匹配（如「后台」→ backend/service）
  const aliases = DIRECTION_ALIASES[d] ?? [];
  return aliases.some((a) => word(a));
}

/** 定位 _matrix.md 中 owners 块的范围 [start, end)；不存在返回 null（end 含块尾换行衔接） */
function locateOwnersBlock(content: string): [number, number] | null {
  const start = content.search(/^owners:/m);
  if (start < 0) return null;
  const tail = content.slice(start + 'owners:'.length);
  const nextKey = tail.search(/\n(?:feature|type|platforms|clarify|dependencies|apis)\s*:|\n#/);
  const end = nextKey >= 0 ? start + 'owners:'.length + nextKey : content.length;
  return [start, end];
}

/** 解析 _matrix.md 的 owners 段 → 声明数组 */
export function parseOwnerDecls(matrixContent: string): UnitOwnerDecl[] {
  const range = locateOwnersBlock(matrixContent);
  if (!range) return [];
  const block = matrixContent.slice(range[0], range[1]);
  const decls: UnitOwnerDecl[] = [];
  let current: Partial<UnitOwnerDecl> | null = null;
  for (const line of block.split(/\r?\n/)) {
    const pm = line.match(/^\s*-\s*platform:\s*(\S+)/);
    if (pm) {
      if (current?.platform && current?.name) decls.push(current as UnitOwnerDecl);
      current = { platform: pm[1] };
      continue;
    }
    if (!current) continue;
    const nm = line.match(/^\s*name:\s*(.+?)\s*$/);
    if (nm) current.name = nm[1];
    const sm = line.match(/^\s*status:\s*(pending|confirmed)/);
    if (sm) current.status = sm[1] as UnitOwnerDecl['status'];
  }
  if (current?.platform && current?.name) decls.push(current as UnitOwnerDecl);
  return decls.filter((d) => d.status);
}

/** 渲染 owners 段（保持 _matrix.md 既有格式风格） */
export function renderOwnersBlock(decls: UnitOwnerDecl[]): string {
  const lines = ['owners:'];
  if (decls.length === 0) {
    lines.push('  []');
    return lines.join('\n');
  }
  for (const d of decls) {
    lines.push(`  - platform: ${d.platform}`);
    lines.push(`    name: ${d.name}`);
    lines.push(`    status: ${d.status}`);
  }
  return lines.join('\n');
}

/**
 * 按 STAFFING 推导候选负责人：方向唯一成员 → pending 候选；
 * 多人或无人 → 不推导（报缺不脑补，人工在 _matrix.md 声明）
 */
export function deriveOwnerCandidates(
  platforms: string[],
  staffing: StaffingMember[]
): UnitOwnerDecl[] {
  const decls: UnitOwnerDecl[] = [];
  for (const platform of platforms) {
    const matched = staffing.filter((m) => m.directions.some((d) => matchDirection(platform, d)));
    if (matched.length === 1) {
      decls.push({ platform, name: matched[0].name, status: 'pending' });
    }
  }
  return decls;
}

/**
 * 合并写回 _matrix.md owners 段：
 *   - confirmed 声明（人工拍板）原样保留
 *   - 新候选写入 pending（该端已有 confirmed 时跳过，不覆盖人工结论）
 *   - 无端候选的旧 pending 丢弃（端声明已收敛）
 */
export async function updateMatrixOwners(
  matrixPath: string,
  candidates: UnitOwnerDecl[]
): Promise<boolean> {
  try {
    if (!(await pathExists(matrixPath))) return false;
    const content = await readFile(matrixPath, 'utf-8');
    const existing = parseOwnerDecls(content);
    const confirmed = existing.filter((d) => d.status === 'confirmed');
    const confirmedPlatforms = new Set(confirmed.map((d) => d.platform));
    const merged: UnitOwnerDecl[] = [
      ...confirmed,
      ...candidates.filter((c) => !confirmedPlatforms.has(c.platform)),
    ];
    const newBlock = renderOwnersBlock(merged);
    let updated: string;
    const range = locateOwnersBlock(content);
    if (range) {
      updated = content.slice(0, range[0]) + newBlock + content.slice(range[1]);
    } else {
      // 无 owners 段（旧矩阵）：插在 platforms 块之后
      const pm = content.search(/^platforms:\s*\n/m);
      if (pm < 0) return false;
      const tail = content.slice(pm + 'platforms:'.length);
      const nextKey = tail.search(/\n(?:feature|type|clarify|dependencies|apis)\s*:|\n#/);
      const insertAt = nextKey >= 0 ? pm + 'platforms:'.length + nextKey : content.length;
      updated = content.slice(0, insertAt) + '\n' + newBlock + content.slice(insertAt);
    }
    await writeFile(matrixPath, updated);
    return true;
  } catch (e) {
    logger.debug('updateMatrixOwners 失败:', e);
    return false;
  }
}

/** 读取单元已拍板（confirmed）的某端负责人；无 → undefined */
export function resolveDeclaredOwner(
  matrixContent: string,
  platform: string
): string | undefined {
  const decl = parseOwnerDecls(matrixContent).find(
    (d) => d.status === 'confirmed' && d.platform === platform
  );
  return decl?.name;
}

/**
 * 渲染单元负责人视图 OWNERS.md（CLI 确定性产物，非 AI 产物）：
 * 反映 _matrix.md owners 段的当前状态（pending 候选 / confirmed 已拍板 / 缺失报缺），
 * 供 SpecTest gen 阶段读取（第三事实源）与人类审阅。
 */
export function renderOwnersView(
  feature: string,
  platforms: string[],
  decls: UnitOwnerDecl[]
): string {
  const lines: string[] = [
    `# ${feature} - 端负责人`,
    '',
    '> 由 analyze 自动生成（v8.3.302+）。事实源: `010-requirements/features/{单元}/_matrix.md` owners 段 + STAFFING.md。',
    '> pending = STAFFING 方向唯一候选，待人工拍板；confirmed = 已确认。修改 _matrix.md 后重跑 analyze 刷新。',
    '',
    '| 端 | 负责人 | 状态 |',
    '|:---|:---|:---|',
  ];
  for (const p of platforms) {
    const decl = decls.find((d) => d.platform === p);
    if (decl) {
      const statusLabel = decl.status === 'confirmed' ? '✅ confirmed' : '⏳ pending';
      lines.push(`| ${p} | ${decl.name} | ${statusLabel} |`);
    } else {
      lines.push(`| ${p} | — | ❌ 未登记（报缺不脑补，请在 _matrix.md 声明） |`);
    }
  }
  if (platforms.length === 0) {
    lines.push('| — | — | 端声明为空，先跑端推断回填 platforms |');
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * 刷新全部单元的 OWNERS.md 视图（020-specs/{单元}/overview/OWNERS.md）。
 * 返回写入的单元数；无 _matrix.md（老单元）时跳过，不阻塞分析。
 */
export async function refreshUnitOwnerViews(
  specDir: string,
  featuresDir: string,
  features: string[],
  featurePlatforms: Map<string, string[]>
): Promise<number> {
  let written = 0;
  for (const feature of features) {
    try {
      const matrixPath = join(featuresDir, feature, '_matrix.md');
      if (!(await pathExists(matrixPath))) continue;
      const decls = parseOwnerDecls(await readFile(matrixPath, 'utf-8'));
      const platforms = featurePlatforms.get(feature) || [];
      const viewPath = join(specDir, feature, 'overview', 'OWNERS.md');
      await ensureDir(join(specDir, feature, 'overview'));
      await writeFile(viewPath, renderOwnersView(feature, platforms, decls));
      written++;
    } catch (e) {
      logger.debug(`OWNERS.md 视图刷新失败（${feature}）:`, e);
    }
  }
  return written;
}
