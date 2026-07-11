import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { FileTransaction } from '@/core/transaction';

const TMP = join(__dirname, '__tmp_transaction');

function write(path: string, content: string) {
  mkdirSync(join(TMP, path, '..'), { recursive: true });
  writeFileSync(join(TMP, path), content);
}
function read(relPath: string): string {
  return readFileSync(join(TMP, relPath), 'utf-8');
}

beforeEach(() => { rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true }); });
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('FileTransaction', () => {
  describe('write', () => {
    it('应该成功写入文件', async () => {
      const tx = new FileTransaction();
      tx.write(join(TMP, 'test.txt'), 'hello');
      await tx.commit();
      expect(read('test.txt')).toBe('hello');
    });

    it('应该在写入后覆盖之前的文件并备份', async () => {
      write('original.txt', 'original content');
      const tx = new FileTransaction();
      tx.write(join(TMP, 'original.txt'), 'new content');
      await tx.commit();
      expect(read('original.txt')).toBe('new content');
      // backup is internal — we verify the content changed
    });

    it('应该不允许重复提交', async () => {
      const tx = new FileTransaction();
      tx.write(join(TMP, 'a.txt'), 'a');
      await tx.commit();
      await expect(tx.commit()).rejects.toThrow('already committed');
    });
  });

  describe('delete', () => {
    it('应该删除文件', async () => {
      write('to-delete.txt', 'delete me');
      const tx = new FileTransaction();
      tx.delete(join(TMP, 'to-delete.txt'));
      await tx.commit();
      expect(existsSync(join(TMP, 'to-delete.txt'))).toBe(false);
    });

    it('应该安全处理不存在的文件', async () => {
      const tx = new FileTransaction();
      tx.delete(join(TMP, 'nonexistent.txt'));
      await tx.commit();
      expect(existsSync(join(TMP, 'nonexistent.txt'))).toBe(false);
    });
  });

  describe('move', () => {
    it('应该移动文件', async () => {
      write('old.txt', 'move content');
      const tx = new FileTransaction();
      tx.move(join(TMP, 'old.txt'), join(TMP, 'new.txt'));
      await tx.commit();
      expect(existsSync(join(TMP, 'old.txt'))).toBe(false);
      expect(read('new.txt')).toBe('move content');
    });
  });

  describe('回滚', () => {
    it('应该在写入失败时回滚', async () => {
      write('a.txt', 'original a');
      write('b.txt', 'original b');

      const tx = new FileTransaction();
      tx.write(join(TMP, 'a.txt'), 'modified a');
      tx.write(join(TMP, 'b.txt'), 'modified b');

      // 模拟第三操作失败：对不存在的旧文件做 move
      tx.move(join(TMP, 'nonexistent.txt'), join(TMP, 'c.txt'));

      await expect(tx.commit()).rejects.toThrow('Transaction failed');

      // 前两个操作应该被回滚
      expect(read('a.txt')).toBe('original a');
      expect(read('b.txt')).toBe('original b');
    });

    it('应该在删除后回滚时恢复文件', async () => {
      write('important.txt', 'do not lose me');

      const tx = new FileTransaction();
      tx.delete(join(TMP, 'important.txt'));
      // Add a failing operation
      tx.move(join(TMP, 'no-file.txt'), join(TMP, 'dest.txt'));

      await expect(tx.commit()).rejects.toThrow('Transaction failed');
      expect(existsSync(join(TMP, 'important.txt'))).toBe(true);
      expect(read('important.txt')).toBe('do not lose me');
    });
  });

  describe('size', () => {
    it('应该返回操作数量', () => {
      const tx = new FileTransaction();
      expect(tx.size).toBe(0);
      tx.write(join(TMP, 'a.txt'), 'a');
      expect(tx.size).toBe(1);
      tx.write(join(TMP, 'b.txt'), 'b').delete(join(TMP, 'c.txt'));
      expect(tx.size).toBe(3);
    });
  });
});
