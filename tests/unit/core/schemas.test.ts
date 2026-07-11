/**
 * Schema 验证测试
 * 测试所有 Zod Schema 的正向和反向验证
 */

import { describe, it, expect } from 'vitest';
import {
  TaskSchema,
  IterationSchema,
  ContextSchema,
  PlatformConfigSchema,
  PlatformsConfigSchema,
  TaskStatusSchema,
  TaskTypeSchema,
  PrioritySchema,
  DEFAULT_PLATFORMS,
  DEFAULT_CONTEXT,
} from '@/core/schemas/index';

// ============================================================
// Task Schema 测试
// ============================================================
describe('TaskSchema', () => {
  const validTask = {
    id: 'Task-001',
    name: '用户登录功能',
    type: 'feature',
    iteration: '2026-07-用户系统',
    createdAt: '2026-07-09T00:00:00Z',
    updatedAt: '2026-07-09T00:00:00Z',
  };

  it('should validate a valid task', () => {
    const result = TaskSchema.safeParse(validTask);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('pending');
      expect(result.data.priority).toBe('medium');
      expect(result.data.platforms).toEqual(['web']);
    }
  });

  it('should reject task with invalid ID format', () => {
    const invalid = { ...validTask, id: 'Task-1' };
    const result = TaskSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject task with invalid ID format (no zeros)', () => {
    const invalid = { ...validTask, id: 'Task-99' };
    const result = TaskSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject task with empty name', () => {
    const invalid = { ...validTask, name: '' };
    const result = TaskSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject task with name exceeding 100 chars', () => {
    const invalid = { ...validTask, name: 'A'.repeat(101) };
    const result = TaskSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject task with invalid type', () => {
    const invalid = { ...validTask, type: 'invalid_type' };
    const result = TaskSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should validate task with platforms', () => {
    const withPlatforms = {
      ...validTask,
      platforms: ['web', 'h5', 'miniapp'],
    };
    const result = TaskSchema.safeParse(withPlatforms);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.platforms).toHaveLength(3);
    }
  });

  it('should validate task with assignees', () => {
    const withAssignees = {
      ...validTask,
      assignees: {
        backend: '张三',
        frontend: { web: '李四', h5: '王五' },
      },
    };
    const result = TaskSchema.safeParse(withAssignees);
    expect(result.success).toBe(true);
  });

  it('should validate task with acceptance criteria', () => {
    const withAC = {
      ...validTask,
      acceptanceCriteria: ['AC-01: 登录成功', 'AC-02: 错误提示'],
    };
    const result = TaskSchema.safeParse(withAC);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.acceptanceCriteria).toHaveLength(2);
    }
  });
});

// ============================================================
// TaskStatus/TaskType/Priority 枚举测试
// ============================================================
describe('Task Enums', () => {
  it('should validate all task statuses', () => {
    const statuses = ['pending', 'in_progress', 'completed', 'blocked', 'archived'];
    for (const s of statuses) {
      expect(TaskStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it('should validate all task types', () => {
    const types = ['feature', 'bugfix', 'research', 'optimization', 'migration', 'document'];
    for (const t of types) {
      expect(TaskTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it('should validate all priorities', () => {
    const priorities = ['high', 'medium', 'low'];
    for (const p of priorities) {
      expect(PrioritySchema.safeParse(p).success).toBe(true);
    }
  });

  it('should reject invalid status', () => {
    expect(TaskStatusSchema.safeParse('deleted').success).toBe(false);
  });
});

// ============================================================
// Iteration Schema 测试
// ============================================================
describe('IterationSchema', () => {
  const validIteration = {
    id: 'iteration-001',
    name: '2026-07-用户系统',
    createdAt: '2026-07-09T00:00:00Z',
    updatedAt: '2026-07-09T00:00:00Z',
  };

  it('should validate a valid iteration', () => {
    const result = IterationSchema.safeParse(validIteration);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('planning');
    }
  });

  it('should validate with goals and tasks', () => {
    const withGoals = {
      ...validIteration,
      goal: {
        description: '完成用户系统',
        deliverables: ['登录', '注册'],
      },
      tasks: ['Task-001', 'Task-002'],
      requirements: ['REQ-001'],
    };
    const result = IterationSchema.safeParse(withGoals);
    expect(result.success).toBe(true);
  });

  it('should reject empty name', () => {
    expect(IterationSchema.safeParse({ ...validIteration, name: '' }).success).toBe(false);
  });
});

// ============================================================
// Context Schema 测试
// ============================================================
describe('ContextSchema', () => {
  it('should validate default context', () => {
    const result = ContextSchema.safeParse(DEFAULT_CONTEXT);
    expect(result.success).toBe(true);
  });

  it('should validate context with values', () => {
    const ctx = {
      ...DEFAULT_CONTEXT,
      currentIteration: '2026-07-用户系统',
      currentTask: 'Task-001',
      currentAssignee: '张三',
      pendingTasks: 5,
      inProgressTasks: 2,
      completedTasks: 3,
    };
    const result = ContextSchema.safeParse(ctx);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pendingTasks).toBe(5);
    }
  });

  it('should reject negative task count', () => {
    const ctx = { ...DEFAULT_CONTEXT, pendingTasks: -1 };
    expect(ContextSchema.safeParse(ctx).success).toBe(false);
  });
});

// ============================================================
// Platform Schema 测试
// ============================================================
describe('PlatformConfigSchema', () => {
  it('should validate default platforms config', () => {
    const result = PlatformsConfigSchema.safeParse(DEFAULT_PLATFORMS);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data.platforms)).toHaveLength(3);
    }
  });

  it('should validate single platform config', () => {
    const config = {
      name: '平板端',
      description: '平板端应用',
      default: false,
      tech_stack: 'React Native',
      enabled: true,
    };
    expect(PlatformConfigSchema.safeParse(config).success).toBe(true);
  });

  it('should reject platform with empty name', () => {
    expect(PlatformConfigSchema.safeParse({ name: '' }).success).toBe(false);
  });
});
