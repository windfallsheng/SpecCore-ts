import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { archiveCommand } from '@/commands/archive';

const TMP = join(__dirname, '__tmp_archive');

function write(path: string, content: string) {
  mkdirSync(join(TMP, path, '..'), { recursive: true });
  writeFileSync(join(TMP, path), content);
}
function read(relPath: string): string {
  return readFileSync(join(TMP, relPath), 'utf-8');
}

beforeEach(() => { rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true }); });
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('archiveCommand', () => {
  it('应该在期次不存在时失败', async () => {
    const r = await archiveCommand({ projectRoot: TMP, iteration: 'x' });
    expect(r.success).toBe(false);
  });

  it('应该跳过未完成的 Task', async () => {
    write('期次-test/Task-001/backend/TASK.md', '**状态**: 📋 待开发');
    const r = await archiveCommand({
      projectRoot: TMP, iteration: '期次-test', all: true,
    });
    expect(r.success).toBe(true);
    expect(r.skipped.some(s => s.includes('未完成'))).toBe(true);
  });

  it('应该在 dryRun 时只报告', async () => {
    write('期次-test/Task-001/backend/TASK.md', '**状态**: ✅ 已完成');
    const r = await archiveCommand({
      projectRoot: TMP, iteration: '期次-test', all: true, dryRun: true,
    });
    expect(r.success).toBe(true);
    expect(r.archived.some(a => a.includes('将归档'))).toBe(true);
  });

  it('应该在指定 task 时只归档该 task', async () => {
    write('期次-test/Task-001/backend/TASK.md', '**状态**: ✅ 已完成');
    write('期次-test/Task-002/backend/TASK.md', '**状态**: ✅ 已完成');

    // Only archive Task-001
    const r = await archiveCommand({
      projectRoot: TMP, iteration: '期次-test', task: 'Task-001',
    });
    expect(r.success).toBe(true);
    // Task-001 should be moved to archived/
    expect(existsSync(join(TMP, '期次-test', 'archived', 'Task-001'))).toBe(true);
    // Task-002 should remain
    expect(existsSync(join(TMP, '期次-test', 'Task-002'))).toBe(true);
  });

  it('应该在 all=true 时归档所有已完成的', async () => {
    write('期次-test/Task-001/backend/TASK.md', '**状态**: ✅ 已完成');
    write('期次-test/Task-002/backend/TASK.md', '**状态**: 📋 待开发');

    const r = await archiveCommand({
      projectRoot: TMP, iteration: '期次-test', all: true,
    });
    expect(r.success).toBe(true);
    expect(existsSync(join(TMP, '期次-test', 'archived', 'Task-001'))).toBe(true);
    expect(r.skipped.some(s => s.includes('Task-002') && s.includes('未完成'))).toBe(true);
  });
});
