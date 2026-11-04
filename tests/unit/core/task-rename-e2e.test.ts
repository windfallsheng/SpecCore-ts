import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { scanTasks, matchesTaskAlias } from '../../../src/core/state';
import { findTaskDir } from '../../../src/core/task-paths';

/**
 * v8.3.384: 用户手动改任务目录名后 execute 链路端到端闭环回归
 *
 * 背景：用户验证时生成的任务名不规范（旧格式拼端名），手动改目录名后
 * execute --skip 用新目录名匹配不上，speccore 报「还在用旧任务名字」。
 * 根因：scanTasks 读 TASK.md 内「子任务 ID」旧字段覆盖实际目录名。
 * 契约：目录名是事实源——scanTasks 的 id 随目录名、findTaskDir 按目录名定位、
 * --skip 按目录名匹配，三者闭环。
 */

let testRoot: string;
const origCwd = process.cwd();

function writeSubtaskMd(staleId: string): string {
  return `# 预订管理 — booking-service\n- **子任务 ID**: \`${staleId}\`\n- **依赖任务**: 无`;
}

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'taskrename-'));
  mkdirSync(join(testRoot, '.speccore'), { recursive: true });
  process.chdir(testRoot);
});

afterEach(() => {
  process.chdir(origCwd);
  rmSync(testRoot, { recursive: true, force: true });
});

describe('改名后 execute 链路不再读旧名（v8.3.384 闭环）', () => {
  it('只改子任务目录名：scanTasks id 随目录名，findTaskDir 定位，skip 匹配', async () => {
    const iter = 'Iteration-002-test';
    // 用户把「Task-274-...-booking-service」改名为「Task-274-unauthorized-meeting-room-edit」
    // （去掉拼端名后缀），但 TASK.md 内「子任务 ID」字段仍是旧名
    const subtaskDir = join(testRoot, iter, '030-tasks', 'feature',
      'Task-274-unauthorized-meeting-room-edit', 'booking-service',
      'Task-274-unauthorized-meeting-room-edit');
    mkdirSync(subtaskDir, { recursive: true });
    mkdirSync(join(subtaskDir, '.meta'), { recursive: true });
    writeFileSync(join(subtaskDir, 'TASK.md'),
      writeSubtaskMd('Task-274-unauthorized-meeting-room-edit-booking-service'));
    writeFileSync(join(subtaskDir, '.meta', 'status'), 'pending');

    const tasks = await scanTasks('002-test');
    expect(tasks.length).toBe(1);
    // 关键断言：id 随实际目录名（改名后），不被 TASK.md 旧字段覆盖
    expect(tasks[0].id).toBe('Task-274-unauthorized-meeting-room-edit');
    expect(tasks[0].id).not.toContain('-booking-service');

    // findTaskDir：父模块目录名未改（推断失败），兜底按目录名精确定位
    const tasksRoot = join(testRoot, iter, '030-tasks');
    const found = await findTaskDir(tasksRoot, tasks[0].id);
    expect(found).toBe(subtaskDir);

    // --skip 用新目录名（含去 Task- 前缀的模块名）都能命中
    expect(matchesTaskAlias(tasks[0], ['Task-274-unauthorized-meeting-room-edit'])).toBe(true);
    expect(matchesTaskAlias(tasks[0], ['274-unauthorized-meeting-room-edit'])).toBe(true);
    // 旧名不再命中（已是过去式）
    expect(matchesTaskAlias(tasks[0], ['Task-274-unauthorized-meeting-room-edit-booking-service'])).toBe(false);
  });

  it('模块目录与子任务目录都改名：scanTasks + findTaskDir 均按目录名工作', async () => {
    const iter = 'Iteration-002-test';
    const moduleDir = 'admin-web-01-yudingguanli'; // 用户改后的模块目录名（功能单元格式）
    const subtaskDir = join(testRoot, iter, '030-tasks', 'feature', moduleDir,
      'admin-web', 'Task-admin-web-01-yudingguanli');
    mkdirSync(subtaskDir, { recursive: true });
    mkdirSync(join(subtaskDir, '.meta'), { recursive: true });
    writeFileSync(join(subtaskDir, 'TASK.md'), writeSubtaskMd('Task-033-21-admin-web'));
    writeFileSync(join(subtaskDir, '.meta', 'status'), 'pending');

    const tasks = await scanTasks('002-test');
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe('Task-admin-web-01-yudingguanli');
    expect(tasks[0].platform).toBe('admin-web');

    const tasksRoot = join(testRoot, iter, '030-tasks');
    const found = await findTaskDir(tasksRoot, tasks[0].id);
    expect(found).toBe(subtaskDir);
  });
});
