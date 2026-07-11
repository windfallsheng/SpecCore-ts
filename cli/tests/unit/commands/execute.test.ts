import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { executeCommand } from '@/commands/execute';

const TMP = join(__dirname, '__tmp_execute');

function write(path: string, content: string) {
  mkdirSync(join(TMP, path, '..'), { recursive: true });
  writeFileSync(join(TMP, path), content);
}
function read(relPath: string): string {
  return readFileSync(join(TMP, relPath), 'utf-8');
}

beforeEach(() => { rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true }); });
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('executeCommand', () => {
  it('应该在期次不存在时返回失败', async () => {
    const r = await executeCommand({ projectRoot: TMP, iteration: '期次-x' });
    expect(r.success).toBe(false);
  });

  it('应该将 pending Task 标记为进行中', async () => {
    write('期次-test/Task-001/backend/TASK.md', '**状态**: 📋 待开发');
    write('期次-test/Task-002/backend/TASK.md', '**状态**: 📋 待开发');

    const r = await executeCommand({ projectRoot: TMP, iteration: '期次-test' });
    expect(r.success).toBe(true);
    expect(r.executed.length).toBe(2);

    expect(read('期次-test/Task-001/backend/TASK.md')).toContain('🔄 进行中');
    expect(read('期次-test/Task-002/backend/TASK.md')).toContain('🔄 进行中');
  });

  it('应该跳过已完成的 Task', async () => {
    write('期次-test/Task-001/backend/TASK.md', '**状态**: ✅ 已完成');
    write('期次-test/Task-002/backend/TASK.md', '**状态**: 📋 待开发');

    const r = await executeCommand({ projectRoot: TMP, iteration: '期次-test' });
    expect(r.success).toBe(true);
    expect(r.skipped.some(s => s.includes('已完成'))).toBe(true);
    expect(r.executed.some(s => s.includes('Task-002'))).toBe(true);
  });

  it('应该在 dryRun 时只报告不写入', async () => {
    write('期次-test/Task-001/backend/TASK.md', '**状态**: 📋 待开发');

    const r = await executeCommand({
      projectRoot: TMP, iteration: '期次-test', dryRun: true,
    });
    expect(r.success).toBe(true);
    // 文件未被修改
    expect(read('期次-test/Task-001/backend/TASK.md')).toContain('📋 待开发');
  });

  it('应该支持指定 assignee', async () => {
    write('期次-test/Task-001/backend/TASK.md', '**状态**: 📋 待开发\n**执行人**: 未分配');

    const r = await executeCommand({
      projectRoot: TMP, iteration: '期次-test', assignee: '张三',
    });
    expect(r.success).toBe(true);
    expect(read('期次-test/Task-001/backend/TASK.md')).toContain('张三');
  });
});
