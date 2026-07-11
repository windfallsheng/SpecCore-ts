import { z } from 'zod';
import { TaskStatusSchema } from './task-status.schema';
import { TaskTypeSchema } from './task-type.schema';
import { PlatformSchema } from './platform.schema';
import { ChangelogEntrySchema } from './changelog.schema';

const TaskOutputSchema = z.object({
  type: z.string(), path: z.string(), status: z.enum(['pending','done']).default('pending'),
});

const TaskAssigneesSchema = z.object({
  backend: z.string().optional(),
  frontend: z.record(PlatformSchema, z.string()).optional(),
});

export const TaskSchema = z.object({
  id: z.string().regex(/^Task-\d{3}$/, 'Task ID must be Task-NNN format'),
  name: z.string().min(1).max(100),
  type: TaskTypeSchema,
  status: TaskStatusSchema,
  priority: z.enum(['high','medium','low']).default('medium'),
  iteration: z.string(),
  assignees: TaskAssigneesSchema.default({}),
  dependencies: z.array(z.string()).default([]),
  platforms: z.array(PlatformSchema).default(['web']),
  outputs: z.array(TaskOutputSchema).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  changelog: z.array(ChangelogEntrySchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskInputSchema = TaskSchema.omit({
  id: true, createdAt: true, updatedAt: true, changelog: true, outputs: true,
}).extend({ name: z.string().min(1).max(100), iteration: z.string() });
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;
