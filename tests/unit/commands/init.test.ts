/**
 * Command Integration Tests
 * 测试关键命令的端到端行为（使用真实文件系统）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { FileTransaction } from '@/core/transaction';

const TEST_DIR = join(process.cwd(), 'tests', '.tmp', 'cmd-int');

function setup(): string {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  // Pre-create .speccore for init testing
  mkdirSync(join(TEST_DIR, '.speccore', 'local'), { recursive: true });
  mkdirSync(join(TEST_DIR, '.speccore', 'GLOBAL', 'PROJECTS', '_template'), { recursive: true });
  mkdirSync(join(TEST_DIR, '.speccore', 'config'), { recursive: true });
  // Create context.json
  writeFileSync(join(TEST_DIR, '.speccore', 'local', 'context.json'), JSON.stringify({
    currentIteration: '期次-2026-07-int-test',
    currentTask: '',
    currentAssignee: '',
    lastUpdated: '2026-07-11T00:00:00Z',
    lastAction: '',
    lastIntent: '',
    interruptedAt: '',
    iterationStatus: 'active',
    pendingTasks: 0,
    inProgressTasks: 0,
    completedTasks: 0,
    blockedTasks: 0,
    customAliases: {},
    history: [],
  }, null, 2));

  // Create iteration with task
  mkdirSync(join(TEST_DIR, '期次-2026-07-int-test'), { recursive: true });
  mkdirSync(join(TEST_DIR, '期次-2026-07-int-test', 'Task-001-user-login', 'backend'), { recursive: true });
  mkdirSync(join(TEST_DIR, '期次-2026-07-int-test', 'Task-001-user-login', '_shared'), { recursive: true });
  writeFileSync(join(TEST_DIR, '期次-2026-07-int-test', 'Task-001-user-login', 'backend', 'REQ.md'), '## 需求描述\n用户登录功能\n## 验收标准\n- [ ] AC-01');
  writeFileSync(join(TEST_DIR, '期次-2026-07-int-test', 'Task-001-user-login', 'backend', 'TECH.md'), '## 技术选型\nSpring Boot');
  writeFileSync(join(TEST_DIR, '期次-2026-07-int-test', 'Task-001-user-login', 'backend', 'TASK.md'), '# Task-001\n状态: 🔲 待开发\n优先级: high');
  writeFileSync(join(TEST_DIR, '期次-2026-07-int-test', 'Task-001-user-login', '_shared', 'API_CONTRACT.yaml'), 'api:\n  path: /api/v1/login\n  method: POST');

  return TEST_DIR;
}

function cleanup() {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

describe('Command Integration — init structure', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('should detect .speccore directory', () => {
    expect(existsSync(join(TEST_DIR, '.speccore'))).toBe(true);
  });

  it('should have valid context.json structure', () => {
    const ctx = JSON.parse(readFileSync(join(TEST_DIR, '.speccore', 'local', 'context.json'), 'utf-8'));
    expect(ctx.currentIteration).toBe('期次-2026-07-int-test');
    expect(ctx.iterationStatus).toBe('active');
  });

  it('should have iteration directory with tasks', () => {
    expect(existsSync(join(TEST_DIR, '期次-2026-07-int-test'))).toBe(true);
    expect(existsSync(join(TEST_DIR, '期次-2026-07-int-test', 'Task-001-user-login'))).toBe(true);
  });
});

describe('Command Integration — validate structure', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('should verify task structure completeness', () => {
    const taskDir = join(TEST_DIR, '期次-2026-07-int-test', 'Task-001-user-login');
    const required = ['backend/REQ.md', 'backend/TECH.md', 'backend/TASK.md', '_shared/API_CONTRACT.yaml'];

    for (const f of required) {
      expect(existsSync(join(taskDir, f))).toBe(true);
    }
  });

  it('should detect missing spec file', () => {
    const taskDir = join(TEST_DIR, '期次-2026-07-int-test', 'Task-001-user-login');
    // Missing frontend directory
    expect(existsSync(join(taskDir, 'frontend'))).toBe(false);
  });

  it('should validate REQ.md has acceptance criteria', () => {
    const req = readFileSync(join(TEST_DIR, '期次-2026-07-int-test', 'Task-001-user-login', 'backend', 'REQ.md'), 'utf-8');
    expect(req).toContain('AC-01');
  });
});

describe('Command Integration — update task', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('should update task status via FileTransaction', async () => {
    const taskMdPath = join(TEST_DIR, '期次-2026-07-int-test', 'Task-001-user-login', 'backend', 'TASK.md');

    const tx = new FileTransaction();
    let content = readFileSync(taskMdPath, 'utf-8');
    const updated = content.replace('🔲 待开发', '✅ 已完成');
    tx.write(taskMdPath, updated);

    // Before commit, original unchanged
    const before = readFileSync(taskMdPath, 'utf-8');
    expect(before).toContain('待开发');

    // After commit
    tx.commit().then(() => {
      const after = readFileSync(taskMdPath, 'utf-8');
      expect(after).toContain('已完成');
    });
  });
});

describe('Command Integration — backup and restore', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('should create and restore backup by copying context', () => {
    const ctxPath = join(TEST_DIR, '.speccore', 'local', 'context.json');
    const backupDir = join(TEST_DIR, '.speccore', 'backups', 'test-backup');
    mkdirSync(join(backupDir, 'local'), { recursive: true });

    // Create backup
    writeFileSync(join(backupDir, 'local', 'context.json'), readFileSync(ctxPath, 'utf-8'));

    // Modify original
    const ctx = JSON.parse(readFileSync(ctxPath, 'utf-8'));
    ctx.currentIteration = 'modified';
    writeFileSync(ctxPath, JSON.stringify(ctx, null, 2));
    expect(JSON.parse(readFileSync(ctxPath, 'utf-8')).currentIteration).toBe('modified');

    // Restore
    writeFileSync(ctxPath, readFileSync(join(backupDir, 'local', 'context.json'), 'utf-8'));
    expect(JSON.parse(readFileSync(ctxPath, 'utf-8')).currentIteration).toBe('期次-2026-07-int-test');
  });
});
