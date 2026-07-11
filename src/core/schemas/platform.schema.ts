/**
 * Platform Schema — Zod 数据模型
 * 定义平台配置的核心数据结构
 * 对应 .speccore/config/platforms.yaml
 */

import { z } from 'zod';

// 单个平台配置
export const PlatformConfigSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(200).optional(),
  default: z.boolean().default(false),
  tech_stack: z.string().optional(),
  enabled: z.boolean().default(true),
});

// 平台集合（platforms.yaml 顶层结构）
export const PlatformsConfigSchema = z.object({
  platforms: z.record(z.string(), PlatformConfigSchema),
});

// 导出类型
export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;
export type PlatformsConfig = z.infer<typeof PlatformsConfigSchema>;

// 默认平台配置
export const DEFAULT_PLATFORMS: PlatformsConfig = {
  platforms: {
    web: {
      name: 'Web端',
      description: 'PC Web 端',
      default: true,
      tech_stack: 'Vue 3 + TypeScript + Vite',
      enabled: true,
    },
    h5: {
      name: 'H5端',
      description: '移动端 H5',
      default: true,
      tech_stack: 'Vue 3 + Vant + Vite',
      enabled: true,
    },
    miniapp: {
      name: '小程序端',
      description: '微信小程序',
      default: true,
      tech_stack: 'Taro + TypeScript',
      enabled: true,
    },
  },
};
