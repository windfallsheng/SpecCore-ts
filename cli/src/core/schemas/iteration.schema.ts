import { z } from 'zod';

export const IterationStatusSchema = z.enum(['planning','in_progress','completed','archived']);
export type IterationStatus = z.infer<typeof IterationStatusSchema>;

export const IterationSchema = z.object({
  name: z.string().regex(/^\d{4}-\d{2}-.+$/, 'Iteration name must be YYYY-MM-xxx format'),
  status: IterationStatusSchema,
  taskCount: z.number().int().min(0).default(0),
  requirements: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Iteration = z.infer<typeof IterationSchema>;

export const ITERATION_STATUS_LABELS: Record<IterationStatus, string> = {
  planning:'规划中', in_progress:'进行中', completed:'已完成', archived:'已归档',
};
