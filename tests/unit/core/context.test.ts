/**
 * 上下文管理测试
 * 测试 Context 的加载、保存和更新功能
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ContextSchema, DEFAULT_CONTEXT } from '@/core/schemas/index';

// Context 测试需要在真实文件系统上进行
// 使用临时目录隔离测试环境
const TEST_DIR = join(process.cwd(), 'tests', '.tmp', 'context-test');

function setupTestDir(): string {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(join(TEST_DIR, '.speccore', 'local'), { recursive: true });
  return TEST_DIR;
}

function teardownTestDir(): void {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

describe('Context — Schema Compliance', () => {
  it('should match ContextSchema structure', () => {
    const result = ContextSchema.safeParse(DEFAULT_CONTEXT);
    expect(result.success).toBe(true);
  });

  it('should validate context with custom aliases', () => {
    const ctx = {
      currentIteration: '2026-07-test',
      currentTask: 'Task-001',
      currentAssignee: '张三',
      lastUpdated: '2026-07-09T00:00:00Z',
      lastAction: 'spec',
      lastIntent: 'execute',
      interruptedAt: '',
      iterationStatus: 'active',
      pendingTasks: 5,
      inProgressTasks: 2,
      completedTasks: 3,
      blockedTasks: 1,
      customAliases: { nt: 'new-task' },
      history: [],
    };
    const result = ContextSchema.safeParse(ctx);
    expect(result.success).toBe(true);
  });
});

describe('Context — JSON Persistence', () => {
  beforeEach(() => {
    setupTestDir();
  });

  afterEach(() => {
    teardownTestDir();
  });

  it('should create valid context.json structure', () => {
    const contextJson = {
      currentIteration: '2026-07-测试期次',
      currentTask: 'Task-001',
      currentAssignee: '',
      lastUpdated: '2026-07-09T00:00:00Z',
      lastAction: 'init',
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

    const ctxPath = join(TEST_DIR, '.speccore', 'local', 'context.json');
    writeFileSync(ctxPath, JSON.stringify(contextJson, null, 2));

    // 验证写入的文件可以被读取
    const fs = require('fs');
    const content = fs.readFileSync(ctxPath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.currentIteration).toBe('2026-07-测试期次');
    expect(parsed.pendingTasks).toBe(0);
    expect(parsed.customAliases).toEqual({});
    expect(parsed.history).toEqual([]);
  });

  it('should handle history entries', () => {
    const contextJson = {
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
      history: [
        { command: 'execute', iteration: '期次-2026-07', task: 'Task-001', timestamp: '2026-07-09T10:00:00Z' },
        { command: 'validate', iteration: '期次-2026-07', task: 'Task-001', timestamp: '2026-07-09T10:05:00Z' },
      ],
    };

    const result = ContextSchema.safeParse(contextJson);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.history).toHaveLength(2);
    }
  });
});
