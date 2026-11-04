import { describe, it, expect } from 'vitest';
import { resolveSubtaskId, matchesTaskAlias, TaskState } from '../../../src/core/state';

/**
 * v8.3.384: 子任务 ID 目录名事实源优先回归测试
 * 背景：用户手动修改子任务目录名后，TASK.md 内「子任务 ID」字段仍是旧名，
 * scanTasks 此前用字段覆盖目录名，导致 execute --skip/--task 用新目录名匹配不上，
 * 报「speccore 还在用旧任务名字」。
 */
describe('resolveSubtaskId — 目录名事实源优先（v8.3.384+）', () => {
  const oldFieldMd = (oldId: string) =>
    `# 子任务\n- **子任务 ID**: \`${oldId}\`\n- **依赖任务**: 无`;

  it('新结构：目录名优先，TASK.md 旧「子任务 ID」字段不覆盖', () => {
    // 用户把 Task-033-21-booking-service 改名成 Task-admin-web-01-yudingguanli，
    // TASK.md 字段仍是旧名
    expect(
      resolveSubtaskId(
        'Task-admin-web-01-yudingguanli',
        'admin-web-01-yudingguanli',
        'booking-service',
        oldFieldMd('Task-033-21-booking-service'),
        true,
      ),
    ).toBe('Task-admin-web-01-yudingguanli');
  });

  it('新结构：TASK.md 无「子任务 ID」字段时也用目录名', () => {
    expect(
      resolveSubtaskId(
        'Task-booking-service-02-tuikuan',
        'booking-service-02-tuikuan',
        'booking-service',
        '# 子任务\n- **依赖任务**: 无',
        true,
      ),
    ).toBe('Task-booking-service-02-tuikuan');
  });

  it('旧结构：端目录直铺 TASK.md，回退「子任务 ID」字段兜底', () => {
    // 旧结构目录名是端名（booking-service），不以 Task- 开头
    expect(
      resolveSubtaskId(
        'booking-service',
        'Task-002-f1-booking',
        'booking-service',
        oldFieldMd('Task-002-f1-booking-booking-service'),
        false,
      ),
    ).toBe('Task-002-f1-booking-booking-service');
  });

  it('旧结构：无字段时拼 {taskId}-{platform}', () => {
    expect(
      resolveSubtaskId(
        'booking-service',
        'Task-002-f1-booking',
        'booking-service',
        '# 子任务\n- **依赖任务**: 无',
        false,
      ),
    ).toBe('Task-002-f1-booking-booking-service');
  });

  it('新结构目录名不带 Task- 前缀时（存量异常），仍回退字段兜底', () => {
    expect(
      resolveSubtaskId(
        'unauthorized-edit',
        'Task-274-unauthorized-meeting-room-edit',
        'booking-service',
        oldFieldMd('Task-274-unauthorized-meeting-room-edit-booking-service'),
        true,
      ),
    ).toBe('Task-274-unauthorized-meeting-room-edit-booking-service');
  });
});

describe('matchesTaskAlias — --skip/--only 别名匹配（v8.3.384+）', () => {
  const task: TaskState = {
    id: 'Task-admin-web-01-yudingguanli',
    name: '预订管理',
    type: 'feature',
    status: 'pending',
    assignee: '',
    dependencies: [],
    priority: 'medium',
    progress: 0,
    path: '/proj/Iteration-002/030-tasks/feature/admin-web-01-yudingguanli/booking-service/Task-admin-web-01-yudingguanli',
  };

  it('完整 ID 精确命中', () => {
    expect(matchesTaskAlias(task, ['Task-admin-web-01-yudingguanli'])).toBe(true);
  });

  it('去 Task- 前缀的模块名命中', () => {
    expect(matchesTaskAlias(task, ['admin-web-01-yudingguanli'])).toBe(true);
  });

  it('path 尾段（实际目录名）命中', () => {
    const renamed: TaskState = { ...task, id: 'Task-admin-web-01-yudingguanli' };
    expect(matchesTaskAlias(renamed, ['Task-admin-web-01-yudingguanli'])).toBe(true);
  });

  it('不相关名字不命中', () => {
    expect(matchesTaskAlias(task, ['Task-booking-service-02-tuikuan'])).toBe(false);
    expect(matchesTaskAlias(task, ['booking-service'])).toBe(false);
  });

  it('多个 skip 项任一命中即命中', () => {
    expect(matchesTaskAlias(task, ['Task-a', 'admin-web-01-yudingguanli', 'Task-b'])).toBe(true);
  });
});
