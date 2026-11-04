/**
 * findTaskDir — 任务目录定位边界回归基线（v8.3.316+）
 *
 * 修复历史：前缀匹配无边界——Task-033 会误命中 Task-0331-xxx，
 * 导致 execute/done 等命令把兄弟任务目录当目标任务处理。
 * 契约：前缀匹配后，下一字符必须是 '-' 或串尾（Task-033 命中
 * Task-033 / Task-033-yudingguanli，不命中 Task-0331-xxx）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { findTaskDir } from '../../../src/core/task-paths';

let testRoot: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'findtask-'));
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('findTaskDir', () => {
  it('新布局：精确命中 Task-033 自身', async () => {
    mkdirSync(join(testRoot, 'feature', 'Task-033-yudingguanli'), { recursive: true });
    const found = await findTaskDir(testRoot, 'Task-033');
    expect(found).toBe(join(testRoot, 'feature', 'Task-033-yudingguanli'));
  });

  it('v8.3.316+: Task-033 不误命中 Task-0331-xxx（前缀边界）', async () => {
    mkdirSync(join(testRoot, 'feature', 'Task-0331-user-auth'), { recursive: true });
    const found = await findTaskDir(testRoot, 'Task-033');
    expect(found).toBeNull();
  });

  it('边界不误伤：Task-033 命中 Task-033（无 topic 后缀）', async () => {
    mkdirSync(join(testRoot, 'feature', 'Task-033'), { recursive: true });
    const found = await findTaskDir(testRoot, 'Task-033');
    expect(found).toBe(join(testRoot, 'feature', 'Task-033'));
  });

  it('同前缀兄弟共存：只命中自己，不串到 Task-0331', async () => {
    mkdirSync(join(testRoot, 'feature', 'Task-033-yudingguanli'), { recursive: true });
    mkdirSync(join(testRoot, 'feature', 'Task-0331-user-auth'), { recursive: true });
    const found = await findTaskDir(testRoot, 'Task-033');
    expect(found).toBe(join(testRoot, 'feature', 'Task-033-yudingguanli'));
  });

  it('子任务完整 ID：从最长前缀逐段递减定位子任务目录', async () => {
    // 父任务组 Task-033-login-flow，端 booking-service 下挂子任务
    mkdirSync(join(testRoot, 'feature', 'Task-033-login-flow', 'booking-service',
      'Task-033-login-flow-booking-service'), { recursive: true });
    const found = await findTaskDir(testRoot, 'Task-033-login-flow-booking-service');
    expect(found).toBe(join(testRoot, 'feature', 'Task-033-login-flow', 'booking-service',
      'Task-033-login-flow-booking-service'));
  });

  it('v8.3.384+: 用户改子任务目录名后（父目录名未改），按目录名精确定位', async () => {
    // 目录已改名 Task-admin-web-01-yudingguanli，但父模块目录仍是旧名
    // Task-033-login-flow，父目录推断必失败——兜底按目录名递归查找
    mkdirSync(join(testRoot, 'feature', 'Task-033-login-flow', 'booking-service',
      'Task-admin-web-01-yudingguanli'), { recursive: true });
    const found = await findTaskDir(testRoot, 'Task-admin-web-01-yudingguanli');
    expect(found).toBe(join(testRoot, 'feature', 'Task-033-login-flow', 'booking-service',
      'Task-admin-web-01-yudingguanli'));
  });

  it('v8.3.384+: 模块目录与子任务目录均改名前，仍按目录名定位', async () => {
    // 模块目录改为功能单元名（无 Task- 前缀），子任务目录同步改
    mkdirSync(join(testRoot, 'feature', 'admin-web-01-yudingguanli', 'booking-service',
      'Task-admin-web-01-yudingguanli'), { recursive: true });
    const found = await findTaskDir(testRoot, 'Task-admin-web-01-yudingguanli');
    expect(found).toBe(join(testRoot, 'feature', 'admin-web-01-yudingguanli', 'booking-service',
      'Task-admin-web-01-yudingguanli'));
  });
});
