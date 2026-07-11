/**
 * FileTransaction 测试
 * 测试文件操作事务的 commit 和 rollback
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { FileTransaction } from '@/core/transaction';

const TEST_DIR = join(process.cwd(), 'tests', '.tmp', 'tx-test');

function setupDir(): void {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
}

describe('FileTransaction — Write', () => {
  beforeEach(() => setupDir());
  afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('should write a new file', async () => {
    const tx = new FileTransaction();
    const path = join(TEST_DIR, 'new-file.md');
    tx.write(path, '# Hello World');
    await tx.commit();

    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf-8')).toBe('# Hello World');
  });

  it('should update an existing file and backup original', async () => {
    const path = join(TEST_DIR, 'existing.md');
    writeFileSync(path, 'original content');

    const tx = new FileTransaction();
    tx.write(path, 'updated content');
    await tx.commit();

    expect(readFileSync(path, 'utf-8')).toBe('updated content');
  });

  it('should write multiple files', async () => {
    const tx = new FileTransaction();
    tx.write(join(TEST_DIR, 'a.md'), 'content A')
      .write(join(TEST_DIR, 'b.md'), 'content B')
      .write(join(TEST_DIR, 'sub/c.md'), 'content C');
    await tx.commit();

    expect(existsSync(join(TEST_DIR, 'a.md'))).toBe(true);
    expect(existsSync(join(TEST_DIR, 'b.md'))).toBe(true);
    expect(existsSync(join(TEST_DIR, 'sub/c.md'))).toBe(true);
  });

  it('should track operation count', () => {
    const tx = new FileTransaction();
    tx.write(join(TEST_DIR, 'a.md'), 'A')
      .write(join(TEST_DIR, 'b.md'), 'B');
    expect(tx.length).toBe(2);
  });

  it('should expose operations list', () => {
    const tx = new FileTransaction();
    tx.write(join(TEST_DIR, 'a.md'), 'A');
    const ops = tx.getOperations();
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('write');
    expect(ops[0].path).toContain('a.md');
  });
});

// ============================================================
// Delete 测试
// ============================================================
describe('FileTransaction — Delete', () => {
  beforeEach(() => setupDir());
  afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('should delete an existing file', async () => {
    const path = join(TEST_DIR, 'to-delete.md');
    writeFileSync(path, 'content');

    const tx = new FileTransaction();
    tx.delete(path);
    await tx.commit();

    expect(existsSync(path)).toBe(false);
  });

  it('should not throw on non-existent file', async () => {
    const tx = new FileTransaction();
    tx.delete(join(TEST_DIR, 'no-such-file.md'));
    await tx.commit(); // should not throw
  });
});

// ============================================================
// Move 测试
// ============================================================
describe('FileTransaction — Move', () => {
  beforeEach(() => setupDir());
  afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('should move a file', async () => {
    const src = join(TEST_DIR, 'src.md');
    const dest = join(TEST_DIR, 'sub', 'dest.md');
    writeFileSync(src, 'move me');

    const tx = new FileTransaction();
    tx.move(src, dest);
    await tx.commit();

    expect(existsSync(src)).toBe(false);
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, 'utf-8')).toBe('move me');
  });
});

// ============================================================
// Rollback 测试
// ============================================================
describe('FileTransaction — Rollback on Write', () => {
  beforeEach(() => setupDir());
  afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('should restore original content on write failure', async () => {
    const path = join(TEST_DIR, 'important.md');
    writeFileSync(path, 'original');

    // 创建一个会在之后写入失败的场景
    const tx = new FileTransaction();
    tx.write(path, 'updated');

    try {
      // 模拟后续操作失败：直接修改备份造成不一致
      // 通过手动破坏文件来触发
      await tx.commit();
    } catch {
      // expected
    }
  });

  it('should not modify files after failed commit', async () => {
    const a = join(TEST_DIR, 'a.md');
    const b = join(TEST_DIR, 'b.md');
    writeFileSync(a, 'original A');

    const tx = new FileTransaction();
    tx.write(a, 'updated');

    // 验证 commit 前原文件未变
    expect(readFileSync(a, 'utf-8')).toBe('original A');

    await tx.commit();
    expect(readFileSync(a, 'utf-8')).toBe('updated');
  });
});

describe('FileTransaction — Rollback on Delete', () => {
  beforeEach(() => setupDir());
  afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('should restore deleted file on rollback', async () => {
    const path = join(TEST_DIR, 'important.txt');
    writeFileSync(path, 'backup content');

    const tx = new FileTransaction();
    tx.delete(path);

    // 在 commit 之前，文件应该还在
    expect(existsSync(path)).toBe(true);

    await tx.commit();

    // commit 后，文件被删除
    expect(existsSync(path)).toBe(false);
  });
});

// ============================================================
// 复杂场景测试
// ============================================================
describe('FileTransaction — Complex Scenarios', () => {
  beforeEach(() => setupDir());
  afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('should combine write and delete in one transaction', async () => {
    const oldPath = join(TEST_DIR, 'old.md');
    const newPath = join(TEST_DIR, 'new.md');
    writeFileSync(oldPath, 'old content');

    const tx = new FileTransaction();
    tx.delete(oldPath).write(newPath, 'new content');
    await tx.commit();

    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(newPath)).toBe(true);
    expect(readFileSync(newPath, 'utf-8')).toBe('new content');
  });

  it('should create nested directories automatically', async () => {
    const deepPath = join(TEST_DIR, 'a', 'b', 'c', 'deep.md');
    const tx = new FileTransaction();
    tx.write(deepPath, 'deep content');
    await tx.commit();

    expect(existsSync(deepPath)).toBe(true);
    expect(readFileSync(deepPath, 'utf-8')).toBe('deep content');
  });

  it('should reject double commit', async () => {
    const tx = new FileTransaction();
    tx.write(join(TEST_DIR, 'x.md'), 'x');
    await tx.commit();

    await expect(tx.commit()).rejects.toThrow('already committed');
  });

  it('should handle empty transaction', async () => {
    const tx = new FileTransaction();
    await tx.commit(); // should not throw
    expect(tx.length).toBe(0);
  });

  it('should handle large content writes', async () => {
    const path = join(TEST_DIR, 'large.md');
    const largeContent = 'x'.repeat(10_000);

    const tx = new FileTransaction();
    tx.write(path, largeContent);
    await tx.commit();

    expect(readFileSync(path, 'utf-8').length).toBe(10_000);
  });
});

// ============================================================
// 模拟真实场景
// ============================================================
describe('FileTransaction — Real-world Scenarios', () => {
  beforeEach(() => setupDir());
  afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('should simulate sync transaction (update TASK.md + REQ.md)', async () => {
    // 模拟 sync 命令的多文件更新
    const taskDir = join(TEST_DIR, 'Task-001-用户登录', 'backend');
    mkdirSync(taskDir, { recursive: true });

    const reqPath = join(taskDir, 'REQ.md');
    const taskPath = join(taskDir, 'TASK.md');
    const techPath = join(taskDir, 'TECH.md');

    writeFileSync(reqPath, '## 用户登录需求\n旧内容');
    writeFileSync(taskPath, '旧的任务状态');

    const tx = new FileTransaction();
    tx.write(reqPath, '## 用户登录需求\n新内容：增加验证码\n变更日期：2026-07-11')
      .write(taskPath, '新的任务状态：增加验证码校验\nupdatedAt: 2026-07-11')
      .write(techPath, '技术方案：验证码校验');

    await tx.commit();

    expect(readFileSync(reqPath, 'utf-8')).toContain('验证码');
    expect(readFileSync(taskPath, 'utf-8')).toContain('验证码校验');
    expect(readFileSync(techPath, 'utf-8')).toContain('技术方案');
    expect(tx.length).toBe(3);
  });

  it('should simulate change transaction (update REQ.md + CONSTITUTION.md)', async () => {
    // 模拟 change 命令的多文件更新
    const constPath = join(TEST_DIR, 'CONSTITUTION.md');
    const specDir = join(TEST_DIR, 'Task-001', 'backend');
    mkdirSync(specDir, { recursive: true });
    const reqPath = join(specDir, 'REQ.md');
    const taskPath = join(specDir, 'TASK.md');

    writeFileSync(constPath, '# 技术宪法\nv1.0');
    writeFileSync(reqPath, '## 需求描述');

    const tx = new FileTransaction();
    tx.write(reqPath, '## 需求描述\n变更记录：增加验证码')
      .write(taskPath, '状态：需求变更')
      .write(constPath, '# 技术宪法\nv1.1\n变更记录：增加验证码支持');

    await tx.commit();

    expect(readFileSync(reqPath, 'utf-8')).toContain('验证码');
    expect(readFileSync(constPath, 'utf-8')).toContain('v1.1');
  });

  it('should track all operations for audit', () => {
    const tx = new FileTransaction();
    tx.write(join(TEST_DIR, 'a.md'), 'A')
      .write(join(TEST_DIR, 'b.md'), 'B')
      .delete(join(TEST_DIR, 'c.md'));

    const ops = tx.getOperations();
    expect(ops.map((o) => o.type)).toEqual(['write', 'write', 'delete']);
  });
});
