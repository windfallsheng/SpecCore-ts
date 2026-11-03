/**
 * plan-generator 单元测试（v8.3.350+）
 *
 * 覆盖：入口地址注入 / 账号引用（端匹配 + 无端限定）/ SKELETON 空模板跳过 /
 * 缺地址端标注 / 无账号标注 / 剧本落盘。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  generateAiVerifyPlan,
  sliceSections,
  isSkeleton,
  collectEnvVarRefs,
  collectAccountVerifications,
  collectPrototypeAssets,
} from '../../../../src/core/ai-verify/plan-generator';
import type { EnvironmentConfig } from '../../../../src/core/environment-config';
import type { ScopeUnit } from '../../../../src/core/ai-verify/types';

let root: string;
let projectRoot: string;
let iterDir: string;
let accountsPath: string;

const envConfig: EnvironmentConfig = {
  env: 'staging',
  platforms: {},
  tests: {
    base_urls: {
      h5: 'https://staging.example.com/h5',
      'admin-web': 'https://staging.example.com/admin',
    },
  },
};

function makeUnit(name: string, platforms: string[]): ScopeUnit {
  return { name, path: join(iterDir, '020-specs', name), platforms };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'speccore-plan-'));
  projectRoot = join(root, 'proj');
  iterDir = join(projectRoot, 'Iteration-001-demo');
  const specsDir = join(iterDir, '020-specs');

  // 订单管理/h5 + admin-web：完整素材
  for (const platform of ['h5', 'admin-web']) {
    mkdirSync(join(specsDir, '订单管理', platform), { recursive: true });
    writeFileSync(
      join(specsDir, '订单管理', platform, 'UI_SPEC.md'),
      `# UI 规格\n\n## 页面清单\n- 首页\n- 下单页\n\n## 交互流程\n1. 点击「下单」按钮\n2. 填写收货信息\n3. 提交订单\n`
    );
    writeFileSync(
      join(specsDir, '订单管理', platform, 'TEST.md'),
      `# 测试\n\n## 测试用例：下单成功\n1. 提交后出现订单号\n2. 跳转支付页\n`
    );
  }

  // 用户管理/admin-web：SKELETON 空模板 → 应跳过
  mkdirSync(join(specsDir, '用户管理', 'admin-web'), { recursive: true });
  writeFileSync(join(specsDir, '用户管理', 'admin-web', 'UI_SPEC.md'), '<!-- SPEC-SKELETON -->\n');
  writeFileSync(join(specsDir, '用户管理', 'admin-web', 'TEST.md'), '<!-- SPEC-SKELETON -->\n');

  // 支付中心/miniapp：环境缺地址 → 应标注跳过
  mkdirSync(join(specsDir, '支付中心', 'miniapp'), { recursive: true });
  writeFileSync(
    join(specsDir, '支付中心', 'miniapp', 'UI_SPEC.md'),
    '# UI 规格\n\n## 交互流程\n1. 发起支付\n'
  );

  // accounts.yaml
  const testsDir = join(projectRoot, '.speccore', 'tests');
  mkdirSync(testsDir, { recursive: true });
  accountsPath = join(testsDir, 'accounts.yaml');
  writeFileSync(
    accountsPath,
    [
      'staging:',
      '  accounts:',
      '    admin:',
      '      username: admin',
      '      password: pass-admin',
      '      platforms: [admin-web]',
      '    user:',
      '      username: testuser',
      '      password: pass-user',
      '',
    ].join('\n')
  );
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('sliceSections / isSkeleton', () => {
  it('should slice markdown by ##/### headings and drop empty lines', () => {
    const md = '## 页面清单\n- A\n\n### 交互流程\n1. x\n';
    const sections = sliceSections(md);
    expect(sections.map((s) => s.title)).toEqual(['页面清单', '交互流程']);
    expect(sections[0].body).toEqual(['- A']);
  });

  it('should ignore h1 and plain paragraphs before first heading', () => {
    const sections = sliceSections('# 标题\n前置段落\n## 页面清单\n- A\n');
    expect(sections.map((s) => s.title)).toEqual(['页面清单']);
  });

  it('should detect skeleton mark', () => {
    expect(isSkeleton('<!-- SPEC-SKELETON -->')).toBe(true);
    expect(isSkeleton('# 正常文档')).toBe(false);
  });
});

describe('collectEnvVarRefs', () => {
  it('扫描 password/username 中的 ${VAR} 引用并标记是否已设置', () => {
    const accounts = {
      staging: {
        accounts: {
          admin: { username: 'admin', password: '${STAGING_ADMIN_PW}' },
          user: { username: '${STAGING_USER_NAME}', password: 'plain-pass' },
          plain: { username: 'a', password: 'b' },
        },
      },
    };
    const hints = collectEnvVarRefs(accounts);
    expect(hints.length).toBe(2);
    const pw = hints.find((h) => h.ref === 'staging.admin');
    expect(pw).toMatchObject({ field: 'password', varName: 'STAGING_ADMIN_PW', set: false });
    const un = hints.find((h) => h.ref === 'staging.user');
    expect(un).toMatchObject({ field: 'username', varName: 'STAGING_USER_NAME', set: false });
  });

  it('非纯 ${VAR} 值（含普通文本）不视为引用；无账号配置返回空', () => {
    expect(
      collectEnvVarRefs({
        staging: { accounts: { a: { username: 'x', password: 'prefix-${VAR}-suffix' } } },
      })
    ).toEqual([]);
    expect(collectEnvVarRefs(null)).toEqual([]);
  });

  it('账号 password 为 ${VAR} 时剧本记录 accountEnvVars 且不落明文', async () => {
    // 覆盖 accounts.yaml 为环境变量引用（覆盖式重写临时账号文件）
    writeFileSync(
      accountsPath,
      [
        'staging:',
        '  accounts:',
        '    admin:',
        '      username: admin',
        '      password: ${STAGING_ADMIN_PW}',
        '      platforms: [admin-web]',
        '    user:',
        '      username: testuser',
        '      password: ${STAGING_USER_PW}',
        '',
      ].join('\n')
    );
    const out = await generateAiVerifyPlan({
      iteration: 'Iteration-001-demo',
      iterDir,
      env: 'staging',
      envConfig,
      units: [makeUnit('订单管理', ['h5'])],
      platformFilter: [],
      projectRoot,
      accountsPath,
    });
    const hints = out.plan.accountEnvVars || [];
    expect(hints.length).toBe(2);
    expect(hints.map((h) => h.varName).sort()).toEqual(['STAGING_ADMIN_PW', 'STAGING_USER_PW']);
    // 剧本 md 包含环境变量提示段，不落 ${VAR} 之外的任何明文
    const md = readFileSync(out.planMdPath, 'utf-8');
    expect(md).toContain('账号环境变量引用');
    expect(md).toContain('STAGING_USER_PW');
    // 恢复原 accounts.yaml（后续用例依赖端匹配/无端限定的明文账号）
    writeFileSync(
      accountsPath,
      [
        'staging:',
        '  accounts:',
        '    admin:',
        '      username: admin',
        '      password: pass-admin',
        '      platforms: [admin-web]',
        '    user:',
        '      username: testuser',
        '      password: pass-user',
        '',
      ].join('\n')
    );
  });
});

describe('collectAccountVerifications（v8.3.354+ 登录验证码约定）', () => {
  it('双源收集：环境内嵌账号用账号名引用，accounts.yaml 兑底用 {env}.{name} 引用', () => {
    const accounts = {
      staging: {
        accounts: {
          ops: { username: 'ops', password: 'p', verification: { type: 'sms', note: '短信网关取码' } },
        },
      },
    };
    const inline = {
      admin: { username: 'admin', password: 'p', verification: { type: 'totp', note: 'TOTP 工具取码' } },
      plain: { username: 'plain', password: 'p' },
    };
    const hints = collectAccountVerifications(accounts, 'staging', inline);
    expect(hints).toHaveLength(2);
    expect(hints.find((h) => h.ref === 'admin')).toMatchObject({ type: 'totp', note: 'TOTP 工具取码' });
    expect(hints.find((h) => h.ref === 'staging.ops')).toMatchObject({ type: 'sms', note: '短信网关取码' });
  });

  it('无 verification 或 note 缺失的账号不收集；无账号返回空', () => {
    expect(
      collectAccountVerifications(
        { staging: { accounts: { a: { username: 'a', password: 'b' } } } },
        'staging'
      )
    ).toEqual([]);
    expect(collectAccountVerifications(null, 'staging')).toEqual([]);
  });

  it('账号配置 verification 后剧本含「登录验证码说明」区块且登录态场景带取码提示', async () => {
    writeFileSync(
      accountsPath,
      [
        'staging:',
        '  accounts:',
        '    admin:',
        '      username: admin',
        '      password: plain-pass',
        '      platforms: [admin-web]',
        '      verification:',
        '        type: sms',
        '        note: 验证码发送至测试手机，从短信网关读取',
      ].join('\n'),
      'utf-8'
    );
    const { plan, planMdPath } = await generateAiVerifyPlan({
      iteration: 'Iteration-001-demo',
      iterDir,
      env: 'staging',
      envConfig,
      units: [makeUnit('订单管理', ['h5', 'admin-web'])],
      platformFilter: ['admin-web'],
      projectRoot,
      accountsPath,
    });
    expect(plan.accountVerifications).toEqual([
      { ref: 'staging.admin', type: 'sms', note: '验证码发送至测试手机，从短信网关读取' },
    ]);
    const md = readFileSync(planMdPath, 'utf-8');
    expect(md).toContain('## 登录验证码说明');
    expect(md).toContain('staging.admin（sms）：验证码发送至测试手机，从短信网关读取');
    // 登录态场景步骤带就近提示
    expect(md).toContain('该账号登录需要验证码（sms）：验证码发送至测试手机，从短信网关读取');
    // 恢复 accounts.yaml（后续 generateAiVerifyPlan 用例依赖明文账号）
    writeFileSync(
      accountsPath,
      [
        'staging:',
        '  accounts:',
        '    admin:',
        '      username: admin',
        '      password: pass-admin',
        '      platforms: [admin-web]',
        '    user:',
        '      username: testuser',
        '      password: pass-user',
        '',
      ].join('\n')
    );
  });
});

describe('collectPrototypeAssets（v8.3.355+ 原型/设计稿素材收集）', () => {
  it('无素材目录时返回空数组', () => {
    const emptyIter = mkdtempSync(join(tmpdir(), 'speccore-assets-empty-'));
    expect(collectPrototypeAssets(emptyIter)).toEqual([]);
    rmSync(emptyIter, { recursive: true, force: true });
  });

  it('收集 assets/designs、assets/prototypes、prototypes 下的图片与 HTML，跳过无关文件', () => {
    const reqDir = join(iterDir, '010-requirements');
    mkdirSync(join(reqDir, 'assets', 'designs'), { recursive: true });
    mkdirSync(join(reqDir, 'assets', 'prototypes'), { recursive: true });
    mkdirSync(join(reqDir, 'prototypes'), { recursive: true });
    writeFileSync(join(reqDir, 'assets', 'designs', 'list.png'), 'png');
    writeFileSync(join(reqDir, 'assets', 'prototypes', 'order-flow.html'), '<html></html>');
    writeFileSync(join(reqDir, 'prototypes', 'overview.jpg'), 'jpg');
    writeFileSync(join(reqDir, 'assets', 'designs', 'notes.md'), 'md');

    const assets = collectPrototypeAssets(iterDir);
    expect(assets).toHaveLength(3);
    expect(assets.some((a) => a.endsWith('list.png'))).toBe(true);
    expect(assets.some((a) => a.endsWith('order-flow.html'))).toBe(true);
    expect(assets.some((a) => a.endsWith('overview.jpg'))).toBe(true);
    expect(assets.every((a) => !a.endsWith('notes.md'))).toBe(true);
  });

  it('有素材时剧本含「原型与设计稿参考」区块', async () => {
    const out = await generateAiVerifyPlan({
      iteration: 'Iteration-001-demo',
      iterDir,
      env: 'staging',
      envConfig,
      units: [makeUnit('订单管理', ['h5'])],
      platformFilter: [],
      projectRoot,
      accountsPath,
    });
    if (out.plan.prototypeAssets && out.plan.prototypeAssets.length > 0) {
      const md = readFileSync(out.planMdPath, 'utf-8');
      expect(md).toContain('## 原型与设计稿参考');
    }
  });
});

describe('generateAiVerifyPlan', () => {
  it('应注入入口地址与账号引用（端匹配优先、无端限定次之）', async () => {
    const out = await generateAiVerifyPlan({
      iteration: 'Iteration-001-demo',
      iterDir,
      env: 'staging',
      envConfig,
      units: [makeUnit('订单管理', ['h5', 'admin-web'])],
      platformFilter: [],
      projectRoot,
      accountsPath,
    });

    expect(out.plan.scenarios.length).toBe(8);
    // 模块层场景（公共能力层场景单独验证）
    const moduleGroup = out.plan.groups.find((g) => g.id === 'modules');
    expect(moduleGroup?.scenarios.length).toBe(2);
    const h5 = moduleGroup?.scenarios.find((s) => s.platform === 'h5');
    const admin = moduleGroup?.scenarios.find((s) => s.platform === 'admin-web');
    // 地址注入
    expect(h5?.entry).toBe('https://staging.example.com/h5');
    expect(admin?.entry).toBe('https://staging.example.com/admin');
    // 账号引用：h5 无端限定匹配 → user；admin-web 端匹配 → admin
    expect(h5?.account).toBe('staging.user');
    expect(admin?.account).toBe('staging.admin');
    // 步骤/预期为原文切片
    expect(h5?.steps.join('')).toContain('点击「下单」按钮');
    expect(h5?.expected.join('')).toContain('提交后出现订单号');
    // 场景 ID 稳定可对齐
    expect(h5?.id).toBe('订单管理__h5__0');
  });

  it('SKELETON 空模板单元应进入跳过项且不生成场景', async () => {
    const out = await generateAiVerifyPlan({
      iteration: 'Iteration-001-demo',
      iterDir,
      env: 'staging',
      envConfig,
      units: [makeUnit('用户管理', ['admin-web'])],
      platformFilter: [],
      projectRoot,
      accountsPath,
    });
    expect(out.plan.groups.find((g) => g.id === 'modules')?.scenarios.length).toBe(0);
    const skipped = out.plan.skipped.find((s) => s.unit === '用户管理');
    expect(skipped?.platform).toBe('admin-web');
    expect(skipped?.reason).toContain('空模板');
  });

  it('环境缺地址的端应进入跳过项并标注 base_urls', async () => {
    const out = await generateAiVerifyPlan({
      iteration: 'Iteration-001-demo',
      iterDir,
      env: 'staging',
      envConfig,
      units: [makeUnit('支付中心', ['miniapp'])],
      platformFilter: [],
      projectRoot,
      accountsPath,
    });
    expect(out.plan.groups.find((g) => g.id === 'modules')?.scenarios.length).toBe(0);
    const skipped = out.plan.skipped.find((s) => s.unit === '支付中心');
    expect(skipped?.reason).toContain('tests.base_urls');
  });

  it('无账号配置时场景不引用账号并标注', async () => {
    const out = await generateAiVerifyPlan({
      iteration: 'Iteration-001-demo',
      iterDir,
      env: 'staging',
      envConfig,
      units: [makeUnit('订单管理', ['h5'])],
      platformFilter: [],
      projectRoot,
      accountsPath: join(root, 'none-accounts.yaml'),
    });
    expect(out.plan.scenarios[0].account).toBeUndefined();
    expect(out.plan.skipped.some((s) => s.reason.includes('未配置账号'))).toBe(true);
  });

  it('v8.3.351+ 账号收敛：环境内嵌 tests.accounts 优先于 accounts.yaml，引用名不带 env 前缀', async () => {
    const inlineEnv: EnvironmentConfig = {
      env: 'staging',
      platforms: {},
      tests: {
        base_urls: envConfig.tests?.base_urls,
        accounts: {
          ops: { username: 'ops', password: 'pass-ops', platforms: ['admin-web'] },
          viewer: { username: 'viewer', password: 'pass-viewer' },
        },
      },
    };
    const out = await generateAiVerifyPlan({
      iteration: 'Iteration-001-demo',
      iterDir,
      env: 'staging',
      envConfig: inlineEnv,
      units: [makeUnit('订单管理', ['h5', 'admin-web'])],
      platformFilter: [],
      projectRoot,
      accountsPath, // accounts.yaml 仍存在但不应被使用（内嵌优先）
    });
    const moduleGroup = out.plan.groups.find((g) => g.id === 'modules');
    const h5 = moduleGroup?.scenarios.find((s) => s.platform === 'h5');
    const admin = moduleGroup?.scenarios.find((s) => s.platform === 'admin-web');
    // 内嵌账号：端匹配 → ops；无端限定 → viewer（均不带 staging. 前缀，区别于 accounts.yaml 兑底）
    expect(h5?.account).toBe('viewer');
    expect(admin?.account).toBe('ops');
    // accountSources 指明来源（v8.3.351+ 账号收敛）：环境文件权威源 + accounts.yaml 兑底双列
    expect(out.plan.accountSources).toContain('environments/staging.yaml (tests.accounts)');
    expect(out.plan.accountSources).toContain(accountsPath);
    // 公共层登录场景步骤标注环境文件来源
    const commonLogin = out.plan.groups.find((g) => g.id === 'common')?.scenarios
      .find((s) => s.title.includes('登录态'));
    expect(commonLogin?.steps.join('')).toContain('environments/staging.yaml 的 tests.accounts');
  });

  it('v8.3.351+ 账号收敛：环境内嵌无账号时才兑底 accounts.yaml 的 {env} 分组', async () => {
    // 权威源语义：内嵌源有账号则用内嵌（哪怕端不匹配也第一个兑底）；仅内嵌源完全无账号才降级兑底文件
    const emptyInline: EnvironmentConfig = {
      env: 'staging',
      platforms: {},
      tests: {
        base_urls: envConfig.tests?.base_urls,
        accounts: {},
      },
    };
    const out = await generateAiVerifyPlan({
      iteration: 'Iteration-001-demo',
      iterDir,
      env: 'staging',
      envConfig: emptyInline,
      units: [makeUnit('订单管理', ['h5'])],
      platformFilter: [],
      projectRoot,
      accountsPath,
    });
    const moduleGroup = out.plan.groups.find((g) => g.id === 'modules');
    const h5 = moduleGroup?.scenarios.find((s) => s.platform === 'h5');
    // 内嵌源空 → 兑底 accounts.yaml 的 staging.user（带前缀）
    expect(h5?.account).toBe('staging.user');
  });

  it('collectEnvVarRefs 双源：环境内嵌账号以账号名为 ref，accounts.yaml 以 {env}.{name} 为 ref', () => {
    const hints = collectEnvVarRefs(
      { staging: { accounts: { fileUser: { username: '${FILE_USER}', password: 'x' } } } },
      { inlineUser: { username: '${INLINE_USER}', password: 'y' } }
    );
    expect(hints.length).toBe(2);
    expect(hints.find((h) => h.ref === 'inlineUser')?.varName).toBe('INLINE_USER');
    expect(hints.find((h) => h.ref === 'staging.fileUser')?.varName).toBe('FILE_USER');
  });

  it('v8.3.351+ 剧本头警告：公共能力层无登录账号时标注降级为纯可达性', async () => {
    const out = await generateAiVerifyPlan({
      iteration: 'Iteration-001-demo',
      iterDir,
      env: 'staging',
      envConfig,
      units: [makeUnit('订单管理', ['h5'])],
      platformFilter: [],
      projectRoot,
      accountsPath: join(root, 'none-accounts.yaml'),
    });
    const md = readFileSync(out.planMdPath, 'utf-8');
    expect(md).toContain('公共能力层降级');
    expect(md).toContain('登录态验证被跳过');
    // 无内嵌且无兑底时：accountSources 为空，剧本头账号来源行标「未配置」
    expect(out.plan.accountSources).toEqual([]);
    expect(md).toContain('账号来源: 未配置');
    // 有账号时不出现降级警告
    const withAccount = await generateAiVerifyPlan({
      iteration: 'Iteration-001-demo',
      iterDir,
      env: 'staging',
      envConfig,
      units: [makeUnit('订单管理', ['h5'])],
      platformFilter: [],
      projectRoot,
      accountsPath,
    });
    expect(readFileSync(withAccount.planMdPath, 'utf-8')).not.toContain('公共能力层降级');
  });

  it('端过滤只生成指定端的场景', async () => {
    const out = await generateAiVerifyPlan({
      iteration: 'Iteration-001-demo',
      iterDir,
      env: 'staging',
      envConfig,
      units: [makeUnit('订单管理', ['h5', 'admin-web'])],
      platformFilter: ['h5'],
      projectRoot,
      accountsPath,
    });
    expect(out.plan.groups.find((g) => g.id === 'modules')?.scenarios.map((s) => s.platform)).toEqual(['h5']);
    // 公共层同样受端过滤约束
    expect(out.plan.groups.find((g) => g.id === 'common')?.scenarios.every((s) => s.platform === 'h5')).toBe(true);
  });

  it('剧本落盘 plan.json + AI_VERIFY_PLAN.md，且内容不落密码', async () => {
    const out = await generateAiVerifyPlan({
      iteration: 'Iteration-001-demo',
      iterDir,
      env: 'staging',
      envConfig,
      units: [makeUnit('订单管理', ['h5'])],
      platformFilter: [],
      projectRoot,
      accountsPath,
    });
    expect(out.planJsonPath.endsWith(join('000-overview', 'ai-verify', 'plan.json'))).toBe(true);
    expect(existsSync(out.planJsonPath)).toBe(true);
    expect(existsSync(out.planMdPath)).toBe(true);
    const md = readFileSync(out.planMdPath, 'utf-8');
    expect(md).toContain('staging.user');
    expect(md).not.toContain('pass-user');
    expect(md).not.toContain('pass-admin');
    // plan.json 机器可读且场景一致
    const json = JSON.parse(readFileSync(out.planJsonPath, 'utf-8'));
    expect(json.scenarios.length).toBe(out.plan.scenarios.length);
  });

  it('分层视图：groups 含公共能力层与模块层，场景平铺与分层视图一致', async () => {
    const out = await generateAiVerifyPlan({
      iteration: 'Iteration-001-demo',
      iterDir,
      env: 'staging',
      envConfig,
      units: [makeUnit('订单管理', ['h5', 'admin-web'])],
      platformFilter: [],
      projectRoot,
      accountsPath,
    });
    const plan = out.plan;
    expect(plan.groups.map((g) => [g.id, g.enabled])).toEqual([
      ['common', true],
      ['modules', true],
    ]);
    // 场景平铺 = 各层场景之和（按层顺序：公共层在前）
    const grouped = plan.groups.flatMap((g) => g.scenarios);
    expect(plan.scenarios).toEqual(grouped);
    expect(plan.scenarios[0].group).toBe('common');
    // 剧本 md 按层组织
    const md = readFileSync(out.planMdPath, 'utf-8');
    expect(md.indexOf('公共能力层')).toBeLessThan(md.indexOf('模块层'));
  });

  it('公共能力层：每端生成入口可达性/登录态/全局导航三类场景，id 前缀 common__', async () => {
    const out = await generateAiVerifyPlan({
      iteration: 'Iteration-001-demo',
      iterDir,
      env: 'staging',
      envConfig,
      units: [makeUnit('订单管理', ['h5', 'admin-web'])],
      platformFilter: [],
      projectRoot,
      accountsPath,
    });
    const common = out.plan.groups.find((g) => g.id === 'common')!;
    // 两端各 3 条（有账号时含登录态）
    expect(common.scenarios.length).toBe(6);
    expect(common.scenarios.every((s) => s.id.startsWith('common__'))).toBe(true);
    expect(common.scenarios.every((s) => s.unit === 'common' && s.group === 'common')).toBe(true);
    // 标题覆盖三类
    const titles = common.scenarios.map((s) => s.title).join('|');
    expect(titles).toContain('入口可达性检查');
    expect(titles).toContain('登录态验证');
    expect(titles).toContain('全局导航检查');
    // 登录态场景带账号引用
    const login = common.scenarios.find((s) => s.title.includes('登录态验证'));
    expect(login?.account).toBeTruthy();
  });

  it('公共能力层：无账号时登录态场景进跳过项，其余场景保留', async () => {
    const out = await generateAiVerifyPlan({
      iteration: 'Iteration-001-demo',
      iterDir,
      env: 'staging',
      envConfig,
      units: [makeUnit('订单管理', ['h5'])],
      platformFilter: [],
      projectRoot,
      accountsPath: join(root, 'none-accounts.yaml'),
    });
    const common = out.plan.groups.find((g) => g.id === 'common')!;
    // 公共层按环境 base_urls 逐端生成（h5 + admin-web 各 2 条：入口可达性 + 全局导航）
    expect(common.scenarios.length).toBe(4);
    expect(common.scenarios.some((s) => s.title.includes('登录态验证'))).toBe(false);
    const loginSkips = out.plan.skipped.filter((s) => s.unit === 'common');
    expect(loginSkips.length).toBe(2);
    expect(loginSkips.every((s) => s.reason.includes('登录场景跳过'))).toBe(true);
  });

  it('分层开关：layered.common=false 关闭公共能力层（保留层头审计）', async () => {
    const out = await generateAiVerifyPlan({
      iteration: 'Iteration-001-demo',
      iterDir,
      env: 'staging',
      envConfig,
      units: [makeUnit('订单管理', ['h5'])],
      platformFilter: [],
      projectRoot,
      accountsPath,
      layered: { common: false },
    });
    const common = out.plan.groups.find((g) => g.id === 'common')!;
    expect(common.enabled).toBe(false);
    expect(common.scenarios.length).toBe(0);
    expect(out.plan.scenarios.every((s) => s.group === 'modules')).toBe(true);
    // 剧本 md 标注层已关闭
    const md = readFileSync(out.planMdPath, 'utf-8');
    expect(md).toContain('已关闭');
  });

  it('分层开关：layered.modules=false 关闭模块层（仅公共能力层）', async () => {
    const out = await generateAiVerifyPlan({
      iteration: 'Iteration-001-demo',
      iterDir,
      env: 'staging',
      envConfig,
      units: [makeUnit('订单管理', ['h5'])],
      platformFilter: [],
      projectRoot,
      accountsPath,
      layered: { modules: false },
    });
    const modules = out.plan.groups.find((g) => g.id === 'modules')!;
    expect(modules.enabled).toBe(false);
    expect(modules.scenarios.length).toBe(0);
    expect(out.plan.scenarios.every((s) => s.group === 'common')).toBe(true);
  });
});
