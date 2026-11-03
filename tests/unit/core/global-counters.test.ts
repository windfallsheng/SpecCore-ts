/**
 * 任务/迭代/计划 ID slug 生成回归基线（v8.3.289+）
 *
 * 锁定两处修复：
 * 1. 拼音兜底不再带 iter- 前缀（v8.3.289 前任务目录名是 Task-001-iter-zhifuxiugai）；
 * 2. 英文/LLM 英译 slug 上限 20→40，长词不截断（booking-order-status-not-synced）。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { nextTaskId, nextPlanId, nextIterationId } from '../../../src/core/global-counters';

let cwd = '';
let tmpDir = '';

beforeAll(async () => {
  cwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), 'speccore-counters-'));
  // counters.json 路径基于 process.cwd()，切到临时目录隔离计数
  process.chdir(tmpDir);
});

afterAll(async () => {
  process.chdir(cwd);
  await rm(tmpDir, { recursive: true, force: true });
});

describe('nextTaskId slug', () => {
  it('纯中文标题拼音兜底：不带 iter- 前缀', async () => {
    const { id } = await nextTaskId('支付回调异常');
    expect(id).toMatch(/^Task-\d{3}-zhi-fu-hui-tiao-yi-chang$/);
    expect(id).not.toContain('iter-');
  });

  it('显式英文 topic 直达目录名，长 slug 不截断', async () => {
    const { id } = await nextTaskId('支付回调异常', 'booking-order-status-not-synced');
    expect(id).toBe(`Task-002-booking-order-status-not-synced`);
  });

  it('英文片段提取：中英混合标题取英文', async () => {
    const { id } = await nextTaskId('User 登录页 404');
    expect(id).toBe('Task-003-user-404');
  });
});

describe('nextPlanId / nextIterationId slug', () => {
  it('Plan slug 同样无 iter- 前缀', async () => {
    const { id } = await nextPlanId('数据大屏');
    expect(id).toMatch(/^Plan-\d{3}-shu-ju-da-ping$/);
  });

  it('Iteration slug 无双重前缀（Iteration- + 拼音）', async () => {
    const { id } = await nextIterationId('会议室预订');
    expect(id).toMatch(/^Iteration-\d{3}-hui-yi-shi-yu-ding$/);
    expect(id).not.toContain('iter-');
  });
});

describe('nextIterationId 用户指定数字名（v8.3.372）', () => {
  it('纯数字名以用户为准作序号 + topic 英译 slug', async () => {
    const { id, num } = await nextIterationId('261115', 'payment');
    expect(id).toBe('Iteration-261115-payment');
    expect(num).toBe(261115);
  });

  it('中文 topic 拼音兜底（逐字连字符）', async () => {
    const { id } = await nextIterationId('261115', '支付');
    expect(id).toBe('Iteration-261115-zhi-fu');
  });

  it('数字名不推进全局计数器（自动编号与用户命名各走各的）', async () => {
    const a = await nextIterationId('先普通创建');
    const custom = await nextIterationId('261115', 'payment');
    expect(custom.id).toBe('Iteration-261115-payment');
    const b = await nextIterationId('再普通创建');
    const numA = parseInt(a.id.match(/^Iteration-(\d+)/)![1], 10);
    const numB = parseInt(b.id.match(/^Iteration-(\d+)/)![1], 10);
    // 261115 不插队：计数器只走自己的一格（a → b）
    expect(numB).toBe(numA + 1);
  });

  it('与已有目录重名时拼内容 hash 兜底（同输入幂等）', async () => {
    await mkdir(join(tmpDir, 'Iteration-261116-payment'), { recursive: true });
    const r1 = await nextIterationId('261116', 'payment');
    expect(r1.id).toMatch(/^Iteration-261116-payment-[0-9a-f]{6}$/);
    const r2 = await nextIterationId('261116', 'payment');
    expect(r2.id).toBe(r1.id);
  });
});
