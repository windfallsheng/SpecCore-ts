/**
 * SpecCore Schemas — Zod 数据模型统一导出
 *
 * 使用方式:
 *   import { TaskSchema, IterationSchema, ContextSchema } from '@core/schemas';
 *   const task = TaskSchema.parse(data);
 */

// Task 模型
export {
  TaskSchema,
  TaskStatusSchema,
  TaskTypeSchema,
  PlatformSchema,
  PrioritySchema,
  TaskOutputSchema,
  ChangelogEntrySchema,
  AssigneeSchema,
} from './task.schema';
export type {
  Task,
  TaskStatus,
  TaskType,
  Platform,
  Priority,
  TaskOutput,
  ChangelogEntry,
  Assignee,
} from './task.schema';

// Iteration 模型
export {
  IterationSchema,
  IterationStatusSchema,
  IterationGoalSchema,
  IterationStatsSchema,
} from './iteration.schema';
export type {
  Iteration,
  IterationStatus,
  IterationGoal,
  IterationStats,
} from './iteration.schema';

// Platform 模型
export {
  PlatformConfigSchema,
  PlatformsConfigSchema,
  DEFAULT_PLATFORMS,
} from './platform.schema';
export type {
  PlatformConfig,
  PlatformsConfig,
} from './platform.schema';

// Context 模型
export {
  ContextSchema,
  HistoryEntrySchema,
  DEFAULT_CONTEXT,
} from './context.schema';
export type {
  Context,
  HistoryEntry,
} from './context.schema';
