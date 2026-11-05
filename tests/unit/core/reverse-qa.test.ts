/**
 * v8.3.367+: 反推需求 QA 环（reverse-qa）单元测试
 *
 * 对齐 recipe-reverse-engineer 五阶段配方的 verify → review → revision：
 *   - checkInventoryCoverage 完整性基线（counts balance：覆盖统计 / blocked 判定）
 *   - runReverseVerify 验证环三件产物（INVENTORY / VERIFY_PLAYBOOK / verify.json，已存在不覆盖）
 *   - runReverseReview 审查产物（REVIEW_PLAYBOOK / review.json，verify.json 缺失时补模板并警告）
 *   - runReverseRevision 裁决门禁（缺失/损坏/未裁决报错；apply=0 闭环完成；apply>0 生成修订剧本+轮次）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, pathExists, readFile, ensureDir } from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  checkInventoryCoverage,
  runReverseVerify,
  runReverseReview,
  runReverseRevision,
} from '../../../src/core/reverse-qa';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sc-qa-'));
  await mkdir(join(dir, '_ir'));
  await writeFile(join(dir, '_ir', 'booking-service-order-service.md'), '# IR: order-service');
  await writeFile(join(dir, '_ir', 'admin-web-login.md'), '# IR: login');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function seedRequirement(content: string): Promise<void> {
  await writeFile(join(dir, 'REQUIREMENT.md'), content);
}

const PARTIAL_REQ = [
  '## 验收标准',
  '- **AC-01**：当用户提交订单时，系统应创建订单。[溯源: `booking-service/order-service`]',
  '- **AC-02**：系统应登录。溯源: `_AI 填写模块id`',
].join('\n');

describe('checkInventoryCoverage 完整性基线', () => {
  it('覆盖统计正确：已覆盖/未覆盖模块与覆盖率', async () => {
    await seedRequirement(PARTIAL_REQ);
    const cov = await checkInventoryCoverage(dir);
    expect(cov).not.toBeNull();
    expect(cov!.totalModules).toBe(2);
    expect(cov!.coveredModules).toEqual(['booking-service-order-service']);
    expect(cov!.uncoveredModules).toEqual(['admin-web-login']);
    expect(cov!.coverageRatio).toBe(0.5);
    expect(cov!.blocked).toBe(false);
  });

  it('无已填锚点时 blocked 判定（Quality Gate）', async () => {
    await seedRequirement('- **AC-01**：系统应 X。溯源: `_AI 填写模块id`');
    const cov = await checkInventoryCoverage(dir);
    expect(cov!.blocked).toBe(true);
    expect(cov!.coverageRatio).toBe(0);
  });

  it('全量覆盖时无未覆盖模块', async () => {
    await seedRequirement([
      '- **AC-01**：系统应 X。[溯源: `booking-service/order-service`]',
      '- **AC-02**：系统应 Y。[溯源: `admin-web/login`]',
    ].join('\n'));
    const cov = await checkInventoryCoverage(dir);
    expect(cov!.uncoveredModules).toEqual([]);
    expect(cov!.coverageRatio).toBe(1);
  });

  it('REQUIREMENT.md 缺失时返回 null', async () => {
    expect(await checkInventoryCoverage(dir)).toBeNull();
  });
});

describe('runReverseVerify 验证环', () => {
  it('生成 INVENTORY.md + VERIFY_PLAYBOOK.md + verify.json 三件产物', async () => {
    await seedRequirement(PARTIAL_REQ);
    await runReverseVerify(dir);
    const qa = join(dir, '_qa');
    expect(await pathExists(join(qa, 'INVENTORY.md'))).toBe(true);
    expect(await pathExists(join(qa, 'VERIFY_PLAYBOOK.md'))).toBe(true);
    expect(await pathExists(join(qa, 'verify.json'))).toBe(true);

    const inventory = await readFile(join(qa, 'INVENTORY.md'), 'utf-8');
    expect(inventory).toContain('已覆盖模块: 1');
    expect(inventory).toContain('admin-web-login'); // unaccounted items 进入审查证据

    const playbook = await readFile(join(qa, 'VERIFY_PLAYBOOK.md'), 'utf-8');
    expect(playbook).toContain('code-verifier');
    expect(playbook).toContain('Quality Gate');

    const vj = JSON.parse(await readFile(join(qa, 'verify.json'), 'utf-8'));
    expect(vj.status).toBe('pending');
    expect(vj.summary.inventoryCoverage.ratio).toBe('50%');
  });

  it('verify.json 已存在时不覆盖（宿主 AI 填写结果保留）', async () => {
    await seedRequirement(PARTIAL_REQ);
    await runReverseVerify(dir);
    const vjPath = join(dir, '_qa', 'verify.json');
    await writeFile(vjPath, JSON.stringify({ status: 'done', custom: true }));
    await runReverseVerify(dir);
    const vj = JSON.parse(await readFile(vjPath, 'utf-8'));
    expect(vj.status).toBe('done');
    expect(vj.custom).toBe(true);
  });
});

describe('runReverseReview 语义审查', () => {
  async function seedDoneVerify(): Promise<void> {
    await ensureDir(join(dir, '_qa'));
    await writeFile(join(dir, '_qa', 'verify.json'), JSON.stringify({
      status: 'done',
      items: [
        { acId: 'AC-01', status: 'verified', evidence: 'core/auth.ts#login' },
        { acId: 'AC-02', status: 'needs_review', evidence: 'core/order.ts#create' },
      ],
    }));
  }

  it('生成 REVIEW_PLAYBOOK.md + review.json，剧本含六维审查与裁决门禁', async () => {
    await seedRequirement(PARTIAL_REQ);
    await seedDoneVerify();
    await runReverseReview(dir);
    const qa = join(dir, '_qa');
    expect(await pathExists(join(qa, 'REVIEW_PLAYBOOK.md'))).toBe(true);
    expect(await pathExists(join(qa, 'review.json'))).toBe(true);

    const playbook = await readFile(join(qa, 'REVIEW_PLAYBOOK.md'), 'utf-8');
    expect(playbook).toContain('document-reviewer');
    expect(playbook).toContain('completeness');
    expect(playbook).toContain('translation');
    expect(playbook).toContain('Review Resolution');

    const rj = JSON.parse(await readFile(join(qa, 'review.json'), 'utf-8'));
    expect(rj.status).toBe('draft');
    expect(rj.findings[0].disposition).toBe('pending');
  });

  it('verify.json 缺失时拒绝推进（review 以验证结果为证据，硬门禁）', async () => {
    await seedRequirement(PARTIAL_REQ);
    await expect(runReverseReview(dir)).rejects.toThrow(/未找到 .*verify\.json/);
  });

  it('verify.json 未完成时拒绝推进（status 非 done / 有 unverified 条目 / evidence 缺失）', async () => {
    await seedRequirement(PARTIAL_REQ);
    // 场景 1: status 非 done
    await ensureDir(join(dir, '_qa'));
    await writeFile(join(dir, '_qa', 'verify.json'), JSON.stringify({ status: 'pending', items: [] }));
    await expect(runReverseReview(dir)).rejects.toThrow(/status 为 pending/);
    // 场景 2: 有 unverified 条目
    await writeFile(join(dir, '_qa', 'verify.json'), JSON.stringify({
      status: 'done',
      items: [{ acId: 'AC-01', status: 'unverified', evidence: 'x#y' }],
    }));
    await expect(runReverseReview(dir)).rejects.toThrow(/未验证/);
    // 场景 3: evidence 缺失
    await writeFile(join(dir, '_qa', 'verify.json'), JSON.stringify({
      status: 'done',
      items: [{ acId: 'AC-01', status: 'verified', evidence: '' }],
    }));
    await expect(runReverseReview(dir)).rejects.toThrow(/evidence/);
  });
});

describe('runReverseRevision 裁决门禁', () => {
  async function seedReview(findings: unknown[], status = 'resolved'): Promise<void> {
    await ensureDir(join(dir, '_qa'));
    await writeFile(join(dir, '_qa', 'review.json'), JSON.stringify({ status, findings }));
  }

  it('review.json 缺失时报错（Review Resolution Gate）', async () => {
    await expect(runReverseRevision(dir)).rejects.toThrow(/未找到 .*review\.json/);
  });

  it('review.json 损坏时报错', async () => {
    await mkdir(join(dir, '_qa'));
    await writeFile(join(dir, '_qa', 'review.json'), '{broken json');
    await expect(runReverseRevision(dir)).rejects.toThrow(/解析失败/);
  });

  it('存在未裁决 findings 时报错（gate 强制）', async () => {
    await seedReview([{ id: 'F-01', disposition: 'pending' }, { id: 'F-02', disposition: 'apply' }]);
    await expect(runReverseRevision(dir)).rejects.toThrow(/未裁决/);
  });

  it('apply=0（decline-only）时闭环完成', async () => {
    await seedReview([
      { id: 'F-01', disposition: 'decline' },
      { id: 'F-02', disposition: 'decline' },
    ]);
    const r = await runReverseRevision(dir);
    expect(r.completed).toBe(true);
    expect(r.apply).toBe(0);
    expect(await pathExists(join(dir, '_qa', 'REVISION_PLAYBOOK.md'))).toBe(false);
  });

  it('0 findings 空心审查时报错（不可闭环，防假绿）', async () => {
    await seedReview([]);
    await expect(runReverseRevision(dir)).rejects.toThrow(/空心审查/);
  });

  it('apply>0 时生成修订剧本（含 apply findings 全文）+ 修订轮次记录', async () => {
    await seedReview([
      { id: 'F-01', severity: 'major', disposition: 'apply', finding: 'AC 歧义' },
      { id: 'F-02', disposition: 'decline' },
    ]);
    const r = await runReverseRevision(dir);
    expect(r.completed).toBe(false);
    expect(r.apply).toBe(1);

    const qa = join(dir, '_qa');
    const playbook = await readFile(join(qa, 'REVISION_PLAYBOOK.md'), 'utf-8');
    expect(playbook).toContain('update');
    expect(playbook).toContain('AC 歧义'); // apply findings 全文进入修订范围
    expect(playbook).toContain('re-validation');

    const log = await readFile(join(qa, 'REVISION_LOG.md'), 'utf-8');
    expect(log).toContain('## Round 1');

    // 第二轮修订：轮次递增
    await seedReview([{ id: 'F-03', disposition: 'apply' }]);
    await runReverseRevision(dir);
    const log2 = await readFile(join(qa, 'REVISION_LOG.md'), 'utf-8');
    expect(log2).toContain('## Round 2');
  });
});
