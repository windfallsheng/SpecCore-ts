import { z } from 'zod';

export const TaskTypeSchema = z.enum(['feature','bugfix','research','optimization','migration','document']);
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  feature:'功能开发',bugfix:'Bug修复',research:'技术调研',
  optimization:'性能优化',migration:'数据迁移',document:'文档编写',
};
