import { describe, it, expect } from 'vitest';
import { TaskSchema, CreateTaskInputSchema } from '@/core/schemas/task.schema';
import { TaskTypeSchema } from '@/core/schemas/task-type.schema';
import { TaskStatusSchema } from '@/core/schemas/task-status.schema';
import { PlatformSchema } from '@/core/schemas/platform.schema';
import { IterationSchema } from '@/core/schemas/iteration.schema';

const validTask = {
  id: 'Task-001', name: '用户登录',
  type: 'feature' as const, status: 'pending' as const,
  priority: 'high' as const, iteration: '2026-07-会议预定',
  assignees: { backend: '张三' }, dependencies: ['Task-002'],
  platforms: ['web', 'h5'], outputs: [],
  acceptanceCriteria: ['正常登录返回 Token', '错误 5 次锁定'],
  changelog: [{ version: 'v1.0', date: '2026-07-05T10:00:00Z', content: '初始创建', source: '/spec-import', author: 'AI' }],
  createdAt: '2026-07-05T10:00:00Z', updatedAt: '2026-07-05T15:00:00Z',
};

describe('Zod 数据模型', () => {
  describe('TaskSchema', () => {
    it('应该接受有效 Task', () => { expect(TaskSchema.safeParse(validTask).success).toBe(true); });
    it('应该拒绝无效 Task ID', () => { expect(TaskSchema.safeParse({ ...validTask, id: 'TASK-1' }).success).toBe(false); });
    it('应该拒绝空名称', () => { expect(TaskSchema.safeParse({ ...validTask, name: '' }).success).toBe(false); });
    it('应该拒绝无效状态', () => { expect(TaskSchema.safeParse({ ...validTask, status: 'deleted' }).success).toBe(false); });
    it('priority 默认 medium', () => {
      const { priority, ...rest } = validTask;
      const r = TaskSchema.safeParse(rest);
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.priority).toBe('medium');
    });
  });

  describe('CreateTaskInputSchema', () => {
    it('应该接受创建输入', () => {
      const r = CreateTaskInputSchema.safeParse({ name: '用户登录', type: 'feature', status: 'pending', iteration: '2026-07-会议预定' });
      expect(r.success).toBe(true);
    });
    it('应该拒绝缺少字段', () => { expect(CreateTaskInputSchema.safeParse({}).success).toBe(false); });
  });

  describe('TaskTypeSchema', () => {
    it.each(['feature','bugfix','research','optimization','migration','document'])('应该接受 %s', (t) => {
      expect(TaskTypeSchema.safeParse(t).success).toBe(true);
    });
    it('拒绝无效类型', () => { expect(TaskTypeSchema.safeParse('unknown').success).toBe(false); });
  });

  describe('TaskStatusSchema', () => {
    it.each(['pending','in_progress','completed','blocked','archived'])('应该接受 %s', (s) => {
      expect(TaskStatusSchema.safeParse(s).success).toBe(true);
    });
  });

  describe('PlatformSchema', () => {
    it.each(['web','h5','miniapp','tablet','tv'])('应该接受 %s', (p) => {
      expect(PlatformSchema.safeParse(p).success).toBe(true);
    });
  });

  describe('IterationSchema', () => {
    it('应该接受有效期次', () => {
      const r = IterationSchema.safeParse({
        name: '2026-07-会议预定', status: 'in_progress', taskCount: 5,
        requirements: ['REQ-001'], createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-05T00:00:00Z',
      });
      expect(r.success).toBe(true);
    });
    it('应该拒绝无效名称', () => {
      expect(IterationSchema.safeParse({
        name: 'invalid', status: 'in_progress',
        createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-05T00:00:00Z',
      }).success).toBe(false);
    });
  });
});
