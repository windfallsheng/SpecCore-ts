/**
 * 任务模块命名识别（v8.3.337+）
 *
 * 三层命名链改造后：
 * - 模块目录名 = 功能单元名（admin-web-01-yudingguanli，无 Task- 前缀、无计数器）
 * - 子任务目录名 = Task-{模块名}（端名由目录层级承载，不再拼入）
 * 本测试锁定 isTaskModuleDirName 新旧识别 + findTaskDir 新命名链定位。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { isTaskModuleDirName, findTaskDir } from '../../../src/core/task-paths';

describe('isTaskModuleDirName（v8.3.337+）', () => {
  it('旧格式 Task- 前缀目录仍识别', () => {
    expect(isTaskModuleDirName('Task-033-yudingguanli')).toBe(true);
  });

  it('新格式功能单元名识别（小写字母+连字符段）', () => {
    expect(isTaskModuleDirName('admin-web-01-yudingguanli')).toBe(true);
    expect(isTaskModuleDirName('booking-service-02-dingdanguanli')).toBe(true);
  });

  it('排除非模块目录（类型目录/序号目录/隐藏/下划线/大写）', () => {
    expect(isTaskModuleDirName('feature')).toBe(false);     // 类型目录无连字符
    expect(isTaskModuleDirName('00-specs')).toBe(false);    // 数字开头
    expect(isTaskModuleDirName('_shared')).toBe(false);     // 下划线开头
    expect(isTaskModuleDirName('.backup-x')).toBe(false);   // 隐藏目录
    expect(isTaskModuleDirName('Admin-Web-01')).toBe(false);// 大写开头
  });
});

describe('findTaskDir 新命名链定位（v8.3.337+）', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'task-module-naming-'));
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('子任务 ID Task-{模块名} → {type}/{模块名}/{端}/Task-{模块名}', async () => {
    const taskId = 'Task-admin-web-01-yudingguanli';
    const expected = join(
      testRoot, 'feature', 'admin-web-01-yudingguanli', 'admin-web', taskId
    );
    mkdirSync(expected, { recursive: true });
    const found = await findTaskDir(testRoot, taskId);
    expect(found).toBe(expected);
  });

  it('旧格式子任务 ID 仍兼容（多段子任务名逐段递减推父模块）', async () => {
    // 旧布局：模块 Task-033-yudingguanli 与子任务 Task-033-yudingguanli-booking-service 同名前缀，
    // 模块级在第 2 步精确命中，多段子任务 ID 才走到第 3 步子任务查找
    const taskId = 'Task-033-yudingguanli-booking-service';
    const expected = join(
      testRoot, 'feature', 'Task-033-yudingguanli', 'booking-service', taskId
    );
    mkdirSync(join(testRoot, 'feature', 'Task-033-yudingguanli'), { recursive: true });
    mkdirSync(expected, { recursive: true });
    const found = await findTaskDir(testRoot, taskId);
    expect(found).toBe(expected);
  });
});
