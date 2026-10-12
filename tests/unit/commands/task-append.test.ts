/**
 * task new 补端模式回归基线（v8.3.311+）
 *
 * 修复历史：用户想在已有功能模块任务下补一个缺失的端子任务，ask 识别不了，
 * 误建了新模块任务。上游 020-specs 没有该端分析时，硬建子任务只能拿空模板。
 *
 * 验证三件事：
 *   1. 上游端级规格达标（非骨架且 ≥200 字符）→ 正常补端子任务，TASK.md 由上游提炼；
 *   2. 上游缺失 → 门禁拦截并提示先 analyze --platform（AGENTS.md 空需求禁令）；
 *   3. --skip-gate 强制建 → 创建成功但 TASK.md 明确标注「上游待补」。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, pathExists } from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';

const state = vi.hoisted(() => ({ iteration: 'Iteration-099-append-test', iterDir: '' }));

vi.mock('../../../src/core/context', () => ({
  getDefaultIteration: vi.fn(async () => state.iteration),
  getIterationDir: vi.fn(async () => state.iterDir),
  updateContext: vi.fn(async () => {}),
}));

vi.mock('../../../src/core/spec-paths', () => ({
  parsePlatformList: vi.fn(async () => ['booking-service', 'h5-mobile', 'admin-web']),
}));

// 必须在 vi.mock 之后动态导入（import 提升会先于 vi.mock 执行）
import { taskNewCommand } from '../../../src/commands/task/new';

const FEATURE = 'new-feature-notification-01-inbox-notification';
const TASK_ID = 'Task-005';
const HOST_DIR = () => join(state.iterDir, '030-tasks', 'feature', TASK_ID);

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'task-append-'));
  state.iterDir = tmp;
  // 宿主任务 Task-005（feature 类型目录布局，已有一个 booking-service 端子任务）
  const host = HOST_DIR();
  await mkdir(join(host, '.meta'), { recursive: true });
  await mkdir(join(host, '00-specs'), { recursive: true });
  await mkdir(join(host, 'booking-service', 'Task-005-booking-service'), { recursive: true });
  await writeFile(join(host, '.meta', 'feature'), FEATURE);
  await writeFile(
    join(host, '00-specs', 'CHANGELOG.md'),
    `# Task-005 - 变更记录\n\n| 时间 | 版本 | 变更内容 | 变更人 |\n| :--- | :--- | :--- | :--- |\n| 2026-09-24 | v1.0 | 初始创建 | CLI |\n`
  );
  // 上游端级规格：h5-mobile 达标（非骨架且 ≥200 字符）
  const spec = join(state.iterDir, '020-specs', FEATURE, 'h5-mobile');
  await mkdir(spec, { recursive: true });
  await writeFile(join(spec, 'TECH.md'), `# ${FEATURE} - 技术方案\n\n## 1. 方案概述\n\n${'需求'.repeat(120)}\n`);
});

afterEach(() => {
  state.iteration = 'Iteration-099-append-test';
  state.iterDir = '';
});

describe('task new --into 补端模式（v8.3.311+）', () => {
  it('上游规格达标：正常补端子任务，TASK.md 提炼上游要点', async () => {
    await taskNewCommand({ into: TASK_ID, platform: 'h5-mobile', name: '补端测试' } as any);

    const sub = join(HOST_DIR(), 'h5-mobile', 'Task-005-h5-mobile');
    expect(await pathExists(sub), '子任务目录应创建').toBe(true);
    expect(await pathExists(join(sub, '.meta', 'status')), '.meta/status 应写入').toBe(true);
    expect(await readFile(join(sub, '.meta', 'status'), 'utf-8')).toBe('todo');

    const taskMd = await readFile(join(sub, 'TASK.md'), 'utf-8');
    expect(taskMd).toContain('# Task-005-h5-mobile（补端子任务）');
    expect(taskMd).toContain('上游规格要点');
    expect(taskMd).toContain('020-specs');  // 提炼自上游，不是空模板
    expect(taskMd).not.toContain('上游规格待补');  // 达标时不出现待补警告

    // CHANGELOG 追加补端记录
    const changelog = await readFile(join(HOST_DIR(), '00-specs', 'CHANGELOG.md'), 'utf-8');
    expect(changelog).toContain('补端');
  });

  it('上游缺失：门禁拦截，不创建子任务目录', async () => {
    await taskNewCommand({ into: TASK_ID, platform: 'admin-web', name: '补端测试' } as any);

    expect(
      await pathExists(join(HOST_DIR(), 'admin-web')),
      '上游缺 admin-web 端级规格时不得创建子任务目录'
    ).toBe(false);
  });

  it('--skip-gate 强制建：创建成功但 TASK.md 标注上游待补', async () => {
    await taskNewCommand({ into: TASK_ID, platform: 'admin-web', skipGate: true, name: '补端测试' } as any);

    const sub = join(HOST_DIR(), 'admin-web', 'Task-005-admin-web');
    expect(await pathExists(sub)).toBe(true);
    const taskMd = await readFile(join(sub, 'TASK.md'), 'utf-8');
    expect(taskMd).toContain('上游规格待补');
    expect(taskMd).toContain('--platform');
  });

  it('子任务已存在：跳过不重复创建', async () => {
    await taskNewCommand({ into: TASK_ID, platform: 'booking-service', name: '补端测试' } as any);
    // 已存在端子任务不应被改动（不抛错、不覆盖）
    expect(await pathExists(join(HOST_DIR(), 'booking-service', 'Task-005-booking-service'))).toBe(true);
  });

  it('端名非法：拦截（不在 CONSTITUTION 端列表）', async () => {
    await taskNewCommand({ into: TASK_ID, platform: 'api', name: '补端测试' } as any);
    expect(await pathExists(join(HOST_DIR(), 'api'))).toBe(false);
  });

  it('宿主任务不存在：报错不创建', async () => {
    await taskNewCommand({ into: 'Task-999', platform: 'h5-mobile', name: '补端测试' } as any);
    expect(await pathExists(join(state.iterDir, '030-tasks', 'feature', 'Task-999'))).toBe(false);
  });
});

describe('task new --into 前缀匹配历史残片名（v8.3.309 前 Task-NNN-NN）', () => {
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'task-append-prefix-'));
    state.iterDir = tmp;
    // 宿主任务为历史残片名 Task-005-21（无精确 Task-005 目录）
    const host = join(state.iterDir, '030-tasks', 'feature', 'Task-005-21');
    await mkdir(join(host, '.meta'), { recursive: true });
    await mkdir(join(host, '00-specs'), { recursive: true });
    await writeFile(join(host, '.meta', 'feature'), FEATURE);
    const spec = join(state.iterDir, '020-specs', FEATURE, 'h5-mobile');
    await mkdir(spec, { recursive: true });
    await writeFile(join(spec, 'TECH.md'), `# ${FEATURE} - 技术方案\n\n${'需求'.repeat(120)}\n`);
  });

  it('--into Task-005 前缀命中 Task-005-21，子任务建在其下', async () => {
    await taskNewCommand({ into: 'Task-005', platform: 'h5-mobile', name: '补端测试' } as any);

    // 宿主名归一化：子任务目录沿用宿主完整名 Task-005-21-h5-mobile
    const sub = join(state.iterDir, '030-tasks', 'feature', 'Task-005-21', 'h5-mobile', 'Task-005-21-h5-mobile');
    expect(await pathExists(sub), `应建在 Task-005-21 下: ${sub}`).toBe(true);
  });
});
