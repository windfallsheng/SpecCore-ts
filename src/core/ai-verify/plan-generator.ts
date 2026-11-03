/**
 * plan-generator — AI 验证剧本生成（v8.3.350+）
 *
 * 只切片不解析语义：从 020-specs/{单元}/{端}/UI_SPEC.md 抓「页面清单/交互流程」段、
 * TEST.md 抓「测试用例」段，原文组装成自然语言场景。语义理解交给执行 AI。
 */

import { join } from 'path';
import { ensureDir, readFile, writeFile, readdirSync, existsSync, statSync } from 'fs-extra';
import { parseYamlFile } from '../yaml-parser';
import { extractTableOperationSteps } from '../ui-verify/spec-generator';
import type { EnvironmentConfig } from '../environment-config';
import type {
  AccountEnvVarHint,
  AccountVerificationHint,
  AiVerifyGroup,
  AiVerifyPlan,
  AiVerifyScenario,
  AiVerifySkipped,
  ScopeUnit,
} from './types';

/** SKELETON 空模板标记（analyze 未执行的产物，跳过） */
const SKELETON_MARK = '<!-- SPEC-SKELETON -->';

/** 原型/设计稿素材扩展名（v8.3.355+ 剧本原型参考区块） */
const PROTOTYPE_ASSET_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.html'];

/**
 * 收集迭代级原型/设计稿素材（v8.3.355+）：扫描 010-requirements 下的
 * prototypes/、assets/designs/、assets/prototypes/、assets/screenshots/ 目录。
 * 收集图片与 HTML 绝对路径——执行 AI 打开对照理解界面（复杂流程的视觉参照物）。
 */
export function collectPrototypeAssets(iterDir: string): string[] {
  const reqDir = join(iterDir, '010-requirements');
  const roots = [
    join(reqDir, 'prototypes'),
    join(reqDir, 'assets', 'designs'),
    join(reqDir, 'assets', 'prototypes'),
    join(reqDir, 'assets', 'screenshots'),
  ];
  const assets: string[] = [];
  const seen = new Set<string>();

  const walk = (dir: string, depth: number): void => {
    if (depth > 3 || !existsSync(dir)) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        walk(full, depth + 1);
        continue;
      }
      if (PROTOTYPE_ASSET_EXTS.some((ext) => name.toLowerCase().endsWith(ext)) && !seen.has(full)) {
        seen.add(full);
        assets.push(full);
      }
    }
  };

  for (const root of roots) walk(root, 0);
  return assets.sort();
}

/** 分层开关配置（settings.tests.layered，缺省全开） */
export interface LayeredToggle {
  common?: boolean;
  modules?: boolean;
}

/** 分层默认开关（未配置时公共层 + 模块层全开） */
export const DEFAULT_LAYERED: Required<LayeredToggle> = { common: true, modules: true };

/** 段落切片结果 */
interface Section {
  title: string;
  body: string[];
}

/** accounts.yaml 的解析形态（宽松：只取需要的字段） */
interface AccountsFile {
  [env: string]: {
    accounts?: Record<string, InlineAccount>;
  };
}

/** 环境内嵌账号（environments/{env}.yaml tests.accounts，v8.3.351+ 权威源） */
type InlineAccount = {
  username?: string;
  password?: string;
  note?: string;
  platforms?: string[];
  /** v8.3.354+: 登录验证码约定（type + 取码说明 note），剧本头集中声明 */
  verification?: { type?: string; note?: string };
};

/** 账号选择结果：引用名 + 来源（环境文件内嵌权威源 / accounts.yaml 全局兑底） */
interface AccountPick {
  ref: string;
  from: 'env-file' | 'accounts-yaml';
  /** v8.3.354+: 登录验证码约定（取码说明随账号走，登录态场景直接提示） */
  verification?: { type: string; note: string };
}

export interface PlanGenerateInput {
  iteration: string;
  iterDir: string;
  env: string;
  envConfig: EnvironmentConfig;
  units: ScopeUnit[];
  /** 端过滤（空为不过滤） */
  platformFilter: string[];
  projectRoot: string;
  /** accounts.yaml 绝对路径（不存在时剧本标注无账号） */
  accountsPath: string;
  /** 分层开关（settings.tests.layered，缺省全开） */
  layered?: LayeredToggle;
}

export interface PlanGenerateOutput {
  plan: AiVerifyPlan;
  planJsonPath: string;
  planMdPath: string;
}

/** 按 ^#{2,3} 标题切段，返回 {标题, 正文行数组} */
export function sliceSections(markdown: string): Section[] {
  const lines = markdown.split('\n');
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    const match = /^#{2,3}\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (current) sections.push(current);
      current = { title: match[1].trim(), body: [] };
    } else if (current) {
      const trimmed = line.trim();
      if (trimmed) current.body.push(trimmed);
    }
  }
  if (current) sections.push(current);
  return sections;
}

/** 空模板检测 */
export function isSkeleton(content: string): boolean {
  return content.includes(SKELETON_MARK);
}

/** UI_SPEC 相关段标题关键词（页面清单/交互流程） */
const UI_SPEC_SECTION_KEYS = ['页面清单', '页面', '交互', '流程', '路由'];
/** TEST 相关段标题关键词（测试用例/验收） */
const TEST_SECTION_KEYS = ['测试用例', '用例', '场景', '验收', '流程'];

/** 从 UI_SPEC.md 提取交互段落 */
async function extractUiSections(uiSpecPath: string): Promise<Section[]> {
  try {
    const content = await readFile(uiSpecPath, 'utf-8');
    if (isSkeleton(content)) return [];
    return sliceSections(content).filter((s) => UI_SPEC_SECTION_KEYS.some((k) => s.title.includes(k)));
  } catch {
    return [];
  }
}

/** 从 TEST.md 提取用例段落 */
async function extractTestSections(testPath: string): Promise<Section[]> {
  try {
    const content = await readFile(testPath, 'utf-8');
    if (isSkeleton(content)) return [];
    return sliceSections(content).filter((s) => TEST_SECTION_KEYS.some((k) => s.title.includes(k)));
  } catch {
    return [];
  }
}

/** 读 accounts.yaml（不存在/解析失败返回 null） */
async function loadAccounts(accountsPath: string): Promise<AccountsFile | null> {
  const result = await parseYamlFile(accountsPath);
  if (!result.success || !result.data) return null;
  return result.data as AccountsFile;
}

/** 单源账号选择：platforms 含该端 → 无端限定 → 第一个。prefix 为引用名前缀（文件源带 {env}.） */
function selectFrom(
  entries: Record<string, InlineAccount> | undefined,
  platform: string,
  prefix: string,
  from: AccountPick['from']
): AccountPick | null {
  if (!entries) return null;
  const list = Object.entries(entries);
  if (list.length === 0) return null;
  // v8.3.354+: 验证码约定随账号走（取码说明只在剧本中指引，不落码）
  const toPick = ([name, cfg]: [string, InlineAccount]): AccountPick => ({
    ref: `${prefix}${name}`,
    from,
    verification: cfg?.verification?.note
      ? { type: cfg.verification.type || 'verification', note: cfg.verification.note }
      : undefined,
  });
  const matched = list.find(([, cfg]) => cfg?.platforms?.includes(platform));
  if (matched) return toPick(matched);
  const unrestricted = list.find(([, cfg]) => !cfg?.platforms || cfg.platforms.length === 0);
  return toPick(unrestricted || list[0]);
}

/**
 * 为端选账号（v8.3.351+ 账号收敛）：优先环境内嵌 tests.accounts（权威源，就近声明），
 * 兜底 accounts.yaml 的 {env} 分组（全局兑底，多环境共享账号时用）。
 */
function pickAccount(
  inline: Record<string, InlineAccount> | undefined,
  accounts: AccountsFile | null,
  env: string,
  platform: string
): AccountPick | null {
  return selectFrom(inline, platform, '', 'env-file') ?? selectFrom(accounts?.[env]?.accounts, platform, `${env}.`, 'accounts-yaml');
}

/** 扫描账号配置中的 ${VAR} 环境变量引用（password/username），返回引用提示列表。双源：环境内嵌（权威源，ref=账号名） + accounts.yaml（兑底，ref={env}.{name}） */
export function collectEnvVarRefs(
  accounts: AccountsFile | null,
  inline?: Record<string, InlineAccount>
): AccountEnvVarHint[] {
  const hints: AccountEnvVarHint[] = [];
  const scan = (refPrefix: string, entries: Record<string, InlineAccount> | undefined): void => {
    if (!entries) return;
    for (const [name, cfg] of Object.entries(entries)) {
      if (!cfg) continue;
      for (const field of ['username', 'password'] as const) {
        const value = String(cfg[field] ?? '');
        const match = /^\$\{([A-Z_][A-Z0-9_]*)\}$/.exec(value.trim());
        if (!match) continue;
        const varName = match[1];
        hints.push({
          ref: `${refPrefix}${name}`,
          field,
          varName,
          set: !!process.env[varName],
        });
      }
    }
  };
  scan('', inline);
  if (accounts) {
    for (const [env, envCfg] of Object.entries(accounts)) {
      scan(`${env}.`, envCfg?.accounts);
    }
  }
  return hints;
}

/**
 * 收集登录验证码约定（v8.3.354+）：双源（环境内嵌权威源 + accounts.yaml 兑底），
 * 剧本头集中声明取码说明——只落「通道指引」不落码本身。
 */
export function collectAccountVerifications(
  accounts: AccountsFile | null,
  env: string,
  inline?: Record<string, InlineAccount>
): AccountVerificationHint[] {
  const hints: AccountVerificationHint[] = [];
  const scan = (refPrefix: string, entries: Record<string, InlineAccount> | undefined): void => {
    if (!entries) return;
    for (const [name, cfg] of Object.entries(entries)) {
      if (!cfg?.verification?.note) continue;
      hints.push({
        ref: `${refPrefix}${name}`,
        type: cfg.verification.type || 'verification',
        note: cfg.verification.note,
      });
    }
  };
  scan('', inline);
  scan(`${env}.`, accounts?.[env]?.accounts);
  return hints;
}

/**
 * 为端选账号引用：优先匹配 platforms 含该端的账号，否则选无端限定的账号，再兑底第一个。
 * 返回引用名（如 staging.admin）或 null。
 */

/**
 * 标题关键词重合度（v8.3.353+）：中文 2+ 字 token 与英文单词取交集计数，
 * 用于交互流程段与 TEST 用例段的就近配对（替代同下标取模）。
 */
function scoreTitleMatch(flowTitle: string, testTitle: string): number {
  const tokens = (t: string): Set<string> => {
    const cn = t.match(/[\u4e00-\u9fa5]{2,}/g) || [];
    const en = t.toLowerCase().match(/[a-z0-9_]+/g) || [];
    return new Set([...cn, ...en].filter((x) => x.length >= 2));
  };
  const a = tokens(flowTitle);
  const b = tokens(testTitle);
  let score = 0;
  for (const x of a) if (b.has(x)) score += 1;
  return score;
}

/** 组装单个（单元, 端）的场景列表 */
async function buildUnitScenarios(
  unit: ScopeUnit,
  platform: string,
  entry: string,
  account: string | null
): Promise<{ scenarios: AiVerifyScenario[]; skipped: AiVerifySkipped[] }> {
  const specsDir = join(unit.path, platform);
  const uiSections = await extractUiSections(join(specsDir, 'UI_SPEC.md'));
  const testSections = await extractTestSections(join(specsDir, 'TEST.md'));

  const scenarios: AiVerifyScenario[] = [];
  const skipped: AiVerifySkipped[] = [];

  // 主场景：以 UI_SPEC 交互流程段为骨架，TEST 用例段按序拼为预期结果
  const flowSections = uiSections.filter((s) => /交互|流程/.test(s.title));
  const pageSections = uiSections.filter((s) => /页面清单|页面|路由/.test(s.title));

  const build = (title: string, steps: string[], expected: string[], index: number): AiVerifyScenario => ({
    id: `${unit.name}__${platform}__${index}`,
    group: 'modules',
    unit: unit.name,
    platform,
    entry,
    account: account ?? undefined,
    steps,
    expected,
    title,
  });

  let index = 0;

  if (flowSections.length > 0) {
    const used = new Set<number>();
    for (const flow of flowSections) {
      // v8.3.353+: 标题关键词就近匹配（替代同下标取模——流程段与用例段数量错位时取模会轮转配错预期）；
      // 同下标 tie-break + 无重合时退回同下标配对（单流程单用例的常见形态行为不变）。
      let bestIdx = -1;
      let bestScore = -1;
      testSections.forEach((t, i) => {
        if (used.has(i)) return;
        const score = scoreTitleMatch(flow.title, t.title);
        if (score > bestScore || (score === bestScore && i === index)) {
          bestScore = score;
          bestIdx = i;
        }
      });
      if (bestScore <= 0 && index < testSections.length && !used.has(index)) {
        bestIdx = index;
      }
      const expected = bestIdx >= 0
        ? [testSections[bestIdx].title, ...testSections[bestIdx].body]
        : ['（TEST.md 未提供匹配的预期结果，执行时对照页面实际表现判断）'];
      if (bestIdx >= 0) used.add(bestIdx);
      scenarios.push(build(`${unit.name}：${flow.title}`, flow.body, expected, index));
      index += 1;
    }
    // 剩余未配对的 TEST 段补为独立场景（操作步骤=用例步骤，预期=后续内容）
    for (let i = 0; i < testSections.length; i += 1) {
      if (used.has(i)) continue;
      const t = testSections[i];
      // v8.3.353+: 段内验收表格「操作步骤」列拆为精细步骤（表格是好的验证素材）
      const tableSteps = extractTableOperationSteps(t.body.join('\n'));
      scenarios.push(build(`${unit.name}：${t.title}`, tableSteps.length > 0 ? tableSteps : t.body, [], index));
      index += 1;
    }
  } else if (pageSections.length > 0) {
    // 无交互流程段：按页面清单做「页面可用性 + 内容」场景
    for (const page of pageSections) {
      scenarios.push(build(`${unit.name}：${page.title}`, page.body, [], index));
      index += 1;
    }
  } else {
    // 兜底：仅验证入口可达与基本可用性
    scenarios.push(
      build(
        `${unit.name}：入口可达性检查`,
        [`打开入口地址 ${entry}，确认页面正常加载（无 404/白屏/报错）`],
        ['页面可访问且渲染正常'],
        index
      )
    );
    index += 1;
  }

  // 完全无素材（SKELETON 或文件缺失）→ 跳过并说明
  if (uiSections.length === 0 && testSections.length === 0) {
    // 检查是否两个文件都缺失/空模板
    const hasUi = await readFile(join(specsDir, 'UI_SPEC.md'), 'utf-8').then(
      (c) => !isSkeleton(c) && c.trim().length > 0,
      () => false
    );
    const hasTest = await readFile(join(specsDir, 'TEST.md'), 'utf-8').then(
      (c) => !isSkeleton(c) && c.trim().length > 0,
      () => false
    );
    if (!hasUi && !hasTest) {
      skipped.push({
        unit: unit.name,
        platform,
        reason: 'UI_SPEC.md/TEST.md 为空模板或缺失（analyze 未执行或未落盘）',
      });
      return { scenarios: [], skipped };
    }
  }

  return { scenarios, skipped };
}

/**
 * 公共能力层场景（CLI 模板生成，不解析规格语义）：
 * 每端固定三类——入口可达性 / 登录态 / 全局导航。先于模块层执行（登录就绪是模块场景前置）。
 * 登录态场景无账号时进 skipped（不阻断其它公共场景）。
 */
export function buildCommonScenarios(input: {
  env: string;
  baseUrls: Record<string, string>;
  platformFilter: string[];
  accounts: AccountsFile | null;
  /** 环境内嵌账号（tests.accounts，权威源；缺失时 accounts 兑底） */
  inlineAccounts?: Record<string, InlineAccount>;
}): { scenarios: AiVerifyScenario[]; skipped: AiVerifySkipped[] } {
  const { env, baseUrls, platformFilter, accounts, inlineAccounts } = input;
  const scenarios: AiVerifyScenario[] = [];
  const skipped: AiVerifySkipped[] = [];

  const platforms = Object.keys(baseUrls).filter(
    (p) => platformFilter.length === 0 || platformFilter.includes(p)
  );

  let index = 0;
  for (const platform of platforms) {
    const entry = baseUrls[platform];
    const account = pickAccount(inlineAccounts, accounts, env, platform);
    const build = (title: string, steps: string[], expected: string[]): AiVerifyScenario => ({
      id: `common__${platform}__${index}`,
      group: 'common',
      unit: 'common',
      platform,
      entry,
      account: account?.ref,
      steps,
      expected,
      title,
    });

    scenarios.push(
      build(
        `公共能力：入口可达性检查（${platform}）`,
        [`打开入口地址 ${entry}，确认页面正常加载（无 404/白屏/报错）`],
        ['页面可访问且渲染正常']
      )
    );
    index += 1;

    if (account) {
      const credSource = account.from === 'env-file'
        ? `environments/${env}.yaml 的 tests.accounts`
        : '.speccore/tests/accounts.yaml';
      // v8.3.354+: 登录需验证码时，取码说明随账号走，登录态场景直接提示执行 AI
      const verificationStep = account.verification
        ? `该账号登录需要验证码（${account.verification.type}）：${account.verification.note}`
        : null;
      scenarios.push(
        build(
          `公共能力：登录态验证（${platform}）`,
          [
            `使用账号 ${account.ref} 登录（凭据从 ${credSource} 读取明文，勿落盘）`,
            ...(verificationStep ? [verificationStep] : []),
            '确认登录成功并进入登录后的主界面',
          ],
          ['登录成功，页面显示登录后状态（用户信息/退出入口等）']
        )
      );
      index += 1;
    } else {
      skipped.push({
        unit: 'common',
        platform,
        reason: `公共能力层-登录场景跳过：未配置账号（environments/${env}.yaml tests.accounts 与 .speccore/tests/accounts.yaml 均无该环境账号）`,
      });
    }

    scenarios.push(
      build(
        `公共能力：全局导航检查（${platform}）`,
        [
          '检查全局布局与导航（顶部导航/侧边栏/页脚等）',
          '确认关键导航入口渲染完整且可点击（不点击可能跳转到未开发页面的入口）',
        ],
        ['全局导航元素渲染完整，关键入口可交互']
      )
    );
    index += 1;
  }

  return { scenarios, skipped };
}

/** 组装分层视图（每层含 enabled 状态 + 场景 + 执行说明） */
function buildGroups(
  layered: Required<LayeredToggle>,
  common: { scenarios: AiVerifyScenario[] },
  modules: AiVerifyScenario[]
): AiVerifyGroup[] {
  return [
    {
      id: 'common',
      label: '公共能力层',
      enabled: layered.common,
      scenarios: layered.common ? common.scenarios : [],
      note: '先于模块层执行：入口可达性与登录就绪是模块场景的前置条件',
    },
    {
      id: 'modules',
      label: '模块层',
      enabled: layered.modules,
      scenarios: layered.modules ? modules : [],
      note: '公共能力层全部通过后进入本层，按端分批逐单元推进',
    },
  ];
}

/** 生成剧本（plan.json + AI_VERIFY_PLAN.md） */
export async function generateAiVerifyPlan(input: PlanGenerateInput): Promise<PlanGenerateOutput> {
  const { iteration, iterDir, env, envConfig, units, platformFilter, projectRoot, accountsPath } = input;
  const outDir = join(iterDir, '000-overview', 'ai-verify');
  await ensureDir(outDir);

  const accounts = await loadAccounts(accountsPath);
  const baseUrls = envConfig.tests?.base_urls || {};
  const inlineAccounts = envConfig.tests?.accounts;
  const layered: Required<LayeredToggle> = { ...DEFAULT_LAYERED, ...input.layered };

  const scenarios: AiVerifyScenario[] = [];
  const skipped: AiVerifySkipped[] = [];

  // 层 1：公共能力（CLI 模板生成，按环境 base_urls 逐端）
  const commonBuilt = layered.common
    ? buildCommonScenarios({ env, baseUrls, platformFilter, accounts, inlineAccounts })
    : { scenarios: [], skipped: [] };

  // 层 2：模块层（各单元规格切片；层开关关闭时不生成，避免平铺混入关闭层场景）
  const moduleScenarios: AiVerifyScenario[] = [];
  if (layered.modules) {
    for (const unit of units) {
      for (const platform of unit.platforms) {
        if (platformFilter.length > 0 && !platformFilter.includes(platform)) continue;
        const entry = baseUrls[platform];
        if (!entry) {
          skipped.push({
            unit: unit.name,
            platform,
            reason: `环境 "${env}" 未配置该端测试地址（environments/${env}.yaml 的 tests.base_urls.${platform}）`,
          });
          continue;
        }
        const account = pickAccount(inlineAccounts, accounts, env, platform);
        if (!account) {
          skipped.push({ unit: unit.name, platform, reason: `未配置账号（environments/${env}.yaml tests.accounts 与 .speccore/tests/accounts.yaml 均无该环境账号）` });
          // 无账号仍生成场景（执行时可跳过登录或标注）
        }
        const built = await buildUnitScenarios(unit, platform, entry, account?.ref ?? null);
        moduleScenarios.push(...built.scenarios);
        skipped.push(...built.skipped);
      }
    }
  }

  scenarios.push(...commonBuilt.scenarios, ...moduleScenarios);
  skipped.push(...commonBuilt.skipped);

  // 账号来源说明（v8.3.351+ 账号收敛）：执行 AI 据此定位明文（机器可读，供 SPECCORE_AI_VERIFY_ACCOUNTS 标记与 SKILL 协议消费）
  const accountSources: string[] = [];
  if (inlineAccounts && Object.keys(inlineAccounts).length > 0) {
    accountSources.push(`environments/${env}.yaml (tests.accounts)`);
  }
  if (accounts) accountSources.push(accountsPath);

  const plan: AiVerifyPlan = {
    version: '1.0',
    env,
    iteration,
    generatedAt: new Date().toISOString(),
    accountsPath,
    accountSources,
    scenarios,
    groups: buildGroups(layered, commonBuilt, moduleScenarios),
    skipped,
    accountEnvVars: collectEnvVarRefs(accounts, inlineAccounts),
    accountVerifications: collectAccountVerifications(accounts, env, inlineAccounts),
    prototypeAssets: collectPrototypeAssets(iterDir),
    outDir,
  };

  const planJsonPath = join(outDir, 'plan.json');
  const planMdPath = join(outDir, 'AI_VERIFY_PLAN.md');
  await writeFile(planJsonPath, JSON.stringify(plan, null, 2), 'utf-8');
  await writeFile(planMdPath, renderPlanMarkdown(plan), 'utf-8');

  return { plan, planJsonPath, planMdPath };
}

/** 剧本 Markdown（执行 AI 的可读版本，按层组织：公共能力层 → 模块层） */
function renderPlanMarkdown(plan: AiVerifyPlan): string {
  const lines: string[] = [];
  lines.push(`# AI 浏览器验证剧本（环境: ${plan.env}）`);
  lines.push('');
  lines.push(`> 迭代: ${plan.iteration} | 生成时间: ${plan.generatedAt} | 场景数: ${plan.scenarios.length}`);
  // 账号来源行按实际情况精确化（权威源内嵌 / 仅兑底 / 均无），避免误导执行 AI
  const srcList = plan.accountSources || [];
  const hasInline = srcList.some((s) => s.includes('tests.accounts'));
  if (hasInline && srcList.length > 1) {
    lines.push(`> 账号来源: ${srcList[0]}（权威源，引用名即账号名）→ ${srcList[1]}（兑底，引用名 {env}.{name}）；执行时读取明文，本剧本不落密码`);
  } else if (hasInline) {
    lines.push(`> 账号来源: ${srcList[0]}（权威源，引用名即账号名）；执行时读取明文，本剧本不落密码`);
  } else if (srcList.length === 1) {
    lines.push(`> 账号来源: ${srcList[0]}（环境文件未声明 tests.accounts，兑底生效，引用名 {env}.{name}）；执行时读取明文，本剧本不落密码`);
  } else {
    lines.push('> 账号来源: 未配置（见下方降级警告）');
  }
  lines.push('> 输出目录: ' + plan.outDir);
  lines.push('> 分层: 公共能力层（入口可达性/登录态/全局导航）→ 模块层（逐单元业务场景），关闭的层标 ⏭️ 跳过');
  lines.push('');

  // v8.3.351+: 公共能力层缺登录账号 → 降级为纯可达性，剧本头显式标注（避免执行 AI 误以为已覆盖登录后业务）
  const commonLoginSkipped = plan.skipped.filter((s) => s.unit === 'common' && s.reason.includes('登录'));
  if (commonLoginSkipped.length > 0) {
    lines.push('> ⚠️ **公共能力层降级**：以下端无登录账号，登录态验证被跳过，公共层仅覆盖纯可达性（入口可达/全局导航）：');
    for (const s of commonLoginSkipped) lines.push(`>   - ${s.platform}: ${s.reason}`);
    lines.push(`> 补齐账号（environments/${plan.env}.yaml 的 tests.accounts 或 ${plan.accountsPath}）后重新生成剧本，可恢复登录态与登录后业务覆盖。`);
    lines.push('');
  }

  if (plan.accountEnvVars && plan.accountEnvVars.length > 0) {
    lines.push('## 账号环境变量引用');
    lines.push('');
    lines.push('以下账号的 username/password 为 ${VAR} 形式，执行时从环境变量取明文，勿将明文写入任何落盘文件：');
    lines.push('');
    for (const h of plan.accountEnvVars) {
      lines.push(`- ${h.ref} 的 ${h.field} → 环境变量 ${h.varName}（${h.set ? '已设置' : '⚠️ 当前未设置'}）`);
    }
    lines.push('');
  }

  // v8.3.354+: 登录验证码说明——只落「通道指引」不落码，执行 AI 按 note 自行取码
  if (plan.accountVerifications && plan.accountVerifications.length > 0) {
    lines.push('## 登录验证码说明');
    lines.push('');
    lines.push('以下账号登录需要验证码，执行时按说明自行取码（码本身勿写入任何落盘文件）：');
    lines.push('');
    for (const v of plan.accountVerifications) {
      lines.push(`- ${v.ref}（${v.type}）：${v.note}`);
    }
    lines.push('');
  }

  // v8.3.355+: 原型与设计稿参考——执行 AI 打开对照理解界面，复杂流程有视觉参照物
  if (plan.prototypeAssets && plan.prototypeAssets.length > 0) {
    lines.push('## 原型与设计稿参考');
    lines.push('');
    lines.push('以下素材来自 010-requirements 的原型/设计稿目录，执行前打开对照理解界面（尤其是复杂流程）：');
    lines.push('');
    for (const asset of plan.prototypeAssets) {
      lines.push(`- ${asset}`);
    }
    lines.push('');
  }

  if (plan.skipped.length > 0) {
    lines.push('## 跳过项');
    lines.push('');
    for (const s of plan.skipped) {
      lines.push(`- ${s.unit}${s.platform ? `/${s.platform}` : ''}: ${s.reason}`);
    }
    lines.push('');
  }

  // 按层渲染（层内按端分组）
  for (const group of plan.groups) {
    lines.push(`## ${group.label}${group.enabled ? '' : '（⏭️ 已关闭）'}`);
    lines.push('');
    if (group.note) {
      lines.push(`> ${group.note}`);
      lines.push('');
    }
    if (!group.enabled || group.scenarios.length === 0) {
      lines.push('（本层无场景）');
      lines.push('');
      continue;
    }

    const byPlatform = new Map<string, AiVerifyScenario[]>();
    for (const s of group.scenarios) {
      const list = byPlatform.get(s.platform) || [];
      list.push(s);
      byPlatform.set(s.platform, list);
    }

    for (const [platform, list] of byPlatform) {
      const entry = list[0]?.entry || '';
      lines.push(`### ${platform} — ${entry}`);
      lines.push('');
      for (const s of list) {
        lines.push(`#### ${s.title}`);
        lines.push('');
        lines.push(`- 入口: ${s.entry}`);
        lines.push(`- 账号: ${s.account || '（未配置）'}`);
        lines.push('');
        if (s.steps.length > 0) {
          lines.push('**操作步骤**');
          lines.push('');
          for (const step of s.steps) lines.push(`- ${step}`);
          lines.push('');
        }
        if (s.expected.length > 0) {
          lines.push('**预期结果**');
          lines.push('');
          for (const e of s.expected) lines.push(`- ${e}`);
          lines.push('');
        }
      }
    }
  }

  return lines.join('\n');
}
