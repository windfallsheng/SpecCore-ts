/**
 * Context Schema — Zod 数据模型
 * 定义 .speccore/local/context.json 的运行时上下文数据结构
 */

import { z } from 'zod';

// 历史记录条目
export const HistoryEntrySchema = z.object({
  command: z.string(),
  timestamp: z.string(),
  iteration: z.string().optional(),
  task: z.string().optional(),
});

// 上下文核心 Schema
export const ContextSchema = z.object({
  // 当前上下文
  currentIteration: z.string().default(''),
  currentTask: z.string().default(''),
  currentAssignee: z.string().default(''),

  // 状态追踪
  lastUpdated: z.string().default(''),
  lastAction: z.string().default(''),
  lastIntent: z.string().default(''),
  interruptedAt: z.string().default(''),

  // 迭代/任务统计
  iterationStatus: z.string().default(''),
  pendingTasks: z.number().int().nonnegative().default(0),
  inProgressTasks: z.number().int().nonnegative().default(0),
  completedTasks: z.number().int().nonnegative().default(0),
  blockedTasks: z.number().int().nonnegative().default(0),

  // 自定义别名（用户自定义的命令别名）
  customAliases: z.record(z.string(), z.string()).default({}),

  // 历史记录
  history: z.array(HistoryEntrySchema).default([]),
});

// 导出类型
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
export type Context = z.infer<typeof ContextSchema>;

// 默认上下文
export const DEFAULT_CONTEXT: Context = {
  currentIteration: '',
  currentTask: '',
  currentAssignee: '',
  lastUpdated: new Date().toISOString(),
  lastAction: '',
  lastIntent: '',
  interruptedAt: '',
  iterationStatus: '',
  pendingTasks: 0,
  inProgressTasks: 0,
  completedTasks: 0,
  blockedTasks: 0,
  customAliases: {},
  history: [],
};
