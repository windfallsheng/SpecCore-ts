import { z } from 'zod';

export const TaskStatusSchema = z.enum([
  'pending', 'in_progress', 'completed', 'blocked', 'archived',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '待开发', in_progress: '开发中', completed: '已完成',
  blocked: '已阻塞', archived: '已归档',
};
