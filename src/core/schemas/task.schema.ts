/**
 * Task Schema — Zod 数据模型
 * 定义 Task（任务）的核心数据结构
 */

import { z } from 'zod';

// 任务状态枚举
export const TaskStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'blocked',
  'archived',
]);

// 任务类型枚举
export const TaskTypeSchema = z.enum([
  'feature',
  'bugfix',
  'research',
  'optimization',
  'migration',
  'document',
]);

// 平台枚举
export const PlatformSchema = z.enum([
  'web',
  'h5',
  'miniapp',
  'tablet',
  'tv',
]);

// 优先级枚举
export const PrioritySchema = z.enum([
  'high',
  'medium',
  'low',
]);

// 任务产出物
export const TaskOutputSchema = z.object({
  type: z.string().min(1),
  path: z.string().min(1),
  status: z.enum(['pending', 'done']).default('pending'),
});

// 变更记录
export const ChangelogEntrySchema = z.object({
  version: z.string(),
  date: z.string(),
  content: z.string(),
  source: z.string(),
  author: z.string(),
});

// 执行人分配（支持多平台前端）
// 使用 string key 而不是 PlatformSchema enum，因为实际使用时只包含启用的平台
export const AssigneeSchema = z.object({
  backend: z.string().optional(),
  frontend: z.record(z.string(), z.string()).optional(),
});

// 任务核心 Schema
export const TaskSchema = z.object({
  // 标识
  id: z.string().regex(/^Task-\d{3}$/, 'Task ID must match Task-NNN format'),
  name: z.string().min(1).max(100),

  // 分类
  type: TaskTypeSchema,
  status: TaskStatusSchema.default('pending'),
  priority: PrioritySchema.default('medium'),

  // 关联
  iteration: z.string().min(1),
  dependencies: z.array(z.string()).default([]),

  // 平台
  platforms: z.array(PlatformSchema).default(['web']),

  // 执行人（按平台分配）
  assignees: AssigneeSchema.optional(),

  // 产出物
  outputs: z.array(TaskOutputSchema).default([]),

  // 验收标准
  acceptanceCriteria: z.array(z.string()).default([]),

  // 变更历史
  changelog: z.array(ChangelogEntrySchema).default([]),

  // 时间戳
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// 导出类型
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskType = z.infer<typeof TaskTypeSchema>;
export type Platform = z.infer<typeof PlatformSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type TaskOutput = z.infer<typeof TaskOutputSchema>;
export type ChangelogEntry = z.infer<typeof ChangelogEntrySchema>;
export type Assignee = z.infer<typeof AssigneeSchema>;
export type Task = z.infer<typeof TaskSchema>;
