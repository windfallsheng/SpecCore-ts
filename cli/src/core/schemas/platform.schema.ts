import { z } from 'zod';

export const PlatformSchema = z.enum(['web','h5','miniapp','tablet','tv']);
export type Platform = z.infer<typeof PlatformSchema>;

export const PLATFORM_LABELS: Record<Platform, string> = {
  web:'Web端',h5:'H5端',miniapp:'小程序端',tablet:'平板端',tv:'智能电视端',
};

export const PlatformConfigSchema = z.object({
  name: z.string(), description: z.string(), tech_stack: z.string(),
  default: z.boolean().default(false), enabled: z.boolean().default(true),
});
export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;

export const PlatformsConfigSchema = z.object({ platforms: z.record(z.string(), PlatformConfigSchema) });
export type PlatformsConfig = z.infer<typeof PlatformsConfigSchema>;
