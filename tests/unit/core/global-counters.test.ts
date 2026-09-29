/**
 * 任务/迭代/计划 ID slug 生成回归基线（v8.3.289+）
 *
 * 锁定两处修复：
 * 1. 拼音兜底不再带 iter- 前缀（v8.3.289 前任务目录名是 Task-001-iter-zhifuxiugai）；
 * 2. 英文/LLM 英译 slug 上限 20→40，长词不截断（booking-order-status-not-synced）。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
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
