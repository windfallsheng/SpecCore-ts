/**
 * 功能单元目录名确定性反查回归基线（v8.3.382+）
 *
 * AI 拆分路径 functionalUnit 给中文/缺失、sourceFile 未携带 features/ 路径时，
 * 任务目录名回退到 Task-NNN 计数命名（用户可见的「Task-数字」）。本组用例锁定
 * resolveFeatureUnitDir / resolveTaskModuleDirName 的三级反查：
 *   _matrix.md feature 字段 > SOURCE.md 标题 > 目录名尾段拼音比对。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveFeatureUnitDir, resolveTaskModuleDirName, generateSubtaskId } from '../../../src/commands/iteration/taskify';

let iterDir: string;

async function makeUnit(dirName: string, matrixFeature: string, sourceTitle: string): Promise<void> {
  const dir = join(iterDir, '010-requirements', 'features', dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '_matrix.md'), `# ${matrixFeature} - 端覆盖矩阵\n\nfeature: ${matrixFeature}\ntype: feature\nplatforms: []\n`);
  await writeFile(join(dir, 'SOURCE.md'), `# ${sourceTitle}\n\n需求原文切片\n`);
}

beforeAll(async () => {
  iterDir = await mkdtemp(join(tmpdir(), 'taskify-dir-resolve-'));
  await mkdir(join(iterDir, '010-requirements', 'features'), { recursive: true });
  // 中文名 → 目录名桥梁（v8.3.271+ 命名契约）
  await makeUnit('admin-web-01-yudingguanli', '预订管理', '预订管理');
  await makeUnit('admin-web-02-huiyuanzhongxin', '会员中心', '会员中心');
});

afterAll(async () => {
  await rm(iterDir, { recursive: true, force: true });
});

describe('resolveFeatureUnitDir 三级反查', () => {
  it('_matrix.md feature 字段精确命中（中文名 → 目录名）', async () => {
    expect(await resolveFeatureUnitDir(iterDir, '预订管理')).toBe('admin-web-01-yudingguanli');
  });

  it('SOURCE.md 一级标题命中（_matrix 缺失时）', async () => {
    // 单独造一个只有 SOURCE.md 的单元
    const dir = join(iterDir, '010-requirements', 'features', 'h5-mobile-01-dingdanguanli');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SOURCE.md'), '# 订单管理\n\n内容\n');
    expect(await resolveFeatureUnitDir(iterDir, '订单管理')).toBe('h5-mobile-01-dingdanguanli');
  });

  it('拼音比对兜底（目录名尾段 = 中文名拼音）', async () => {
    const dir = join(iterDir, '010-requirements', 'features', 'booking-service-01-tuikuan');
    await mkdir(dir, { recursive: true });
    expect(await resolveFeatureUnitDir(iterDir, '退款')).toBe('booking-service-01-tuikuan');
  });

  it('无匹配 → 空串（调用方回退 Task-NNN 链）', async () => {
    expect(await resolveFeatureUnitDir(iterDir, '不存在的功能')).toBe('');
    expect(await resolveFeatureUnitDir(iterDir, '')).toBe('');
  });

  it('features 目录不存在 → 空串', async () => {
    expect(await resolveFeatureUnitDir(join(iterDir, 'no-such-iter'), '预订管理')).toBe('');
  });
});

describe('resolveTaskModuleDirName 优先级', () => {
  it('AI 直接给合法目录名 → 直接采用（不反查）', async () => {
    const sec = { name: '预订管理', functionalUnit: 'admin-web-01-yudingguanli' };
    expect(await resolveTaskModuleDirName(iterDir, sec)).toBe('admin-web-01-yudingguanli');
  });

  it('functionalUnit 中文 → 反查 _matrix feature 字段', async () => {
    const sec = { name: '预订管理模块', functionalUnit: '预订管理' };
    expect(await resolveTaskModuleDirName(iterDir, sec)).toBe('admin-web-01-yudingguanli');
  });

  it('functionalUnit 缺失 → 用任务名反查', async () => {
    const sec = { name: '会员中心' };
    expect(await resolveTaskModuleDirName(iterDir, sec)).toBe('admin-web-02-huiyuanzhongxin');
  });

  it('全部落空 → 空串（调用方回退 nextTaskId）', async () => {
    const sec = { name: '神秘功能' };
    expect(await resolveTaskModuleDirName(iterDir, sec)).toBe('');
  });
});

describe('generateSubtaskId 子任务命名（v8.3.340+：不拼端名）', () => {
  it('子任务 ID = Task-{模块名}，端名由目录层级承载（默认一端一任务，多端同名）', () => {
    expect(generateSubtaskId('admin-web-01-yudingguanli')).toBe('Task-admin-web-01-yudingguanli');
    expect(generateSubtaskId('booking-service-02-tuikuan')).toBe('Task-booking-service-02-tuikuan');
    expect(generateSubtaskId('274-unauthorized-meeting-room-edit')).toBe('Task-274-unauthorized-meeting-room-edit');
  });

  it('不拼接端名（旧行为 Task-{id}-{platform} 已废弃）', () => {
    expect(generateSubtaskId('admin-web-01-yudingguanli')).not.toContain('booking-service');
    expect(generateSubtaskId('admin-web-01-yudingguanli')).not.toMatch(/-h5-mobile$/);
  });

  it('同一模块名多次调用幂等（多端子任务目录名一致，重名由 Git hash 兑底）', () => {
    const id = generateSubtaskId('admin-web-01-yudingguanli');
    expect(generateSubtaskId('admin-web-01-yudingguanli')).toBe(id);
  });
});
