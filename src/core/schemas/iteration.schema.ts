/**
 * Iteration Schema — Zod 数据模型
 * 定义迭代（期次）的核心数据结构
 */

import { z } from 'zod';
import { TaskStatusSchema, PrioritySchema } from './task.schema';

// 迭代状态
export const IterationStatusSchema = z.enum([
  'planning',    // 规划中
  'active',       // 进行中
  'paused',       // 暂停
  'completed',    // 已完成
  'archived',     // 已归档
]);

// 迭代目标
export const IterationGoalSchema = z.object({
  description: z.string().min(1),
  scope: z.string().optional(),
  deliverables: z.array(z.string()).default([]),
  successCriteria: z.array(z.string()).default([]),
});

// 迭代统计（计算字段，非持久化）
export const IterationStatsSchema = z.object({
  totalTasks: z.number().int().nonnegative(),
  pendingTasks: z.number().int().nonnegative(),
  inProgressTasks: z.number().int().nonnegative(),
  completedTasks: z.number().int().nonnegative(),
  blockedTasks: z.number().int().nonnegative(),
  completionRate: z.number().min(0).max(100),
});

// 迭代核心 Schema
export const IterationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),

  // 状态
  status: IterationStatusSchema.default('planning'),
  priority: PrioritySchema.default('medium'),

  // 目标
  goal: IterationGoalSchema.optional(),

  // 任务列表（引用 Task ID）
  tasks: z.array(z.string()).default([]),

  // 关联需求（全量层 REQ-ID）
  requirements: z.array(z.string()).default([]),

  // 时间规划
  startDate: z.string().optional(),
  endDate: z.string().optional(),

  // 负责人
  assignee: z.string().optional(),

  // 变更历史
  changelog: z.array(z.object({
    version: z.string(),
    date: z.string(),
    content: z.string(),
    author: z.string(),
  })).default([]),

  // 时间戳
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// 导出类型
export type IterationStatus = z.infer<typeof IterationStatusSchema>;
export type IterationGoal = z.infer<typeof IterationGoalSchema>;
export type IterationStats = z.infer<typeof IterationStatsSchema>;
export type Iteration = z.infer<typeof IterationSchema>;
