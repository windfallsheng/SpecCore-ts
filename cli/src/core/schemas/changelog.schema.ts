import { z } from 'zod';

export const ChangelogEntrySchema = z.object({
  version: z.string(), date: z.string(), content: z.string(),
  source: z.string(), author: z.string(),
});
export type ChangelogEntry = z.infer<typeof ChangelogEntrySchema>;
