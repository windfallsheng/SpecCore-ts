import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { changeCommand } from '@/commands/change';

const TMP = join(__dirname, '__tmp_change');

function write(path: string, content: string) {
  mkdirSync(join(TMP, path, '..'), { recursive: true });
  writeFileSync(join(TMP, path), content);
}
function read(relPath: string): string {
  return readFileSync(join(TMP, relPath), 'utf-8');
}

beforeEach(() => { rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true }); });
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('changeCommand', () => {
  it('应该在 Task 不存在时返回失败', async () => {
    const result = await changeCommand({
      projectRoot: TMP, iteration: '期次-test', task: 'Task-001',
      description: '增加验证码',
    });
    expect(result.success).toBe(false);
  });

  it('应该更新 TASK.md 追加变更历史', async () => {
    write('期次-test/Task-001/backend/TASK.md', '## 任务\n\n原始内容\n');
    const result = await changeCommand({
      projectRoot: TMP, iteration: '期次-test', task: 'Task-001',
      description: '增加验证码校验',
    });
    expect(result.success).toBe(true);
    // Verify TASK.md contains changelog
    expect(result.changes.some(c => c.includes('TASK.md'))).toBe(true);
    const content = read('期次-test/Task-001/backend/TASK.md');
    expect(content).toContain('增加验证码校验');
    expect(result.affectedFiles).toContain('backend/TASK.md');
  });

  it('应该在 dryRun 时只报告不写入', async () => {
    write('期次-test/Task-001/backend/TASK.md', '## 原始内容');
    const result = await changeCommand({
      projectRoot: TMP, iteration: '期次-test', task: 'Task-001',
      description: '变更描述', dryRun: true,
    });
    expect(result.success).toBe(true);
    expect(result.changes.length).toBeGreaterThan(0);
    // 原始内容未被修改
    expect(read('期次-test/Task-001/backend/TASK.md')).toBe('## 原始内容');
  });

  it('应该更新 PROJECT_GRAPH.md', async () => {
    write('期次-test/Task-001/backend/TASK.md', '## 任务');
    write('期次-test/00-期次总览/PROJECT_GRAPH.md', '# 期次总览\n');
    const result = await changeCommand({
      projectRoot: TMP, iteration: '期次-test', task: 'Task-001',
      description: '登录增加锁定机制',
    });
    expect(result.success).toBe(true);
    expect(result.affectedFiles).toContain('00-期次总览/PROJECT_GRAPH.md');
    const pg = read('期次-test/00-期次总览/PROJECT_GRAPH.md');
    expect(pg).toContain('Task-001');
  });

  it('应该更新 REQ.md', async () => {
    write('期次-test/Task-001/backend/TASK.md', '## 任务');
    write('期次-test/Task-001/backend/REQ.md', '## 需求描述\n\n登录功能\n');
    const result = await changeCommand({
      projectRoot: TMP, iteration: '期次-test', task: 'Task-001',
      description: 'REQ变更测试',
    });
    expect(result.success).toBe(true);
    expect(result.affectedFiles).toContain('backend/REQ.md');
  });
});
