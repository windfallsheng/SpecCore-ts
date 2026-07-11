/**
 * FileTransaction — 文件操作事务
 *
 * 提供原子性的多文件操作：写入、删除、移动。
 * 操作前自动备份原始内容，失败时回滚到备份。
 *
 * 使用方式:
 *   const tx = new FileTransaction();
 *   tx.write('path/to/file.md', 'new content')
 *     .write('path/to/other.md', 'updated')
 *     .delete('path/to/temp.md');
 *   await tx.commit();
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, renameSync } from 'fs';
import { dirname } from 'path';
import { mkdirpSync } from 'fs-extra';

/** 操作类型 */
type OpType = 'write' | 'delete' | 'move';

/** 单个操作 */
interface Operation {
  type: OpType;
  path: string;
  content?: string;       // write 操作的内容
  backup?: string | null;  // 原始内容的备份（null 表示原文件不存在）
  destPath?: string;       // move 操作的目标路径
}

export class FileTransaction {
  private operations: Operation[] = [];
  private committed = false;

  /**
   * 写入文件。自动备份原内容。
   */
  write(path: string, content: string): this {
    const hasBackup = existsSync(path);
    const backup = hasBackup ? readFileSync(path, 'utf-8') : null;
    this.operations.push({ type: 'write', path, content, backup });
    return this;
  }

  /**
   * 删除文件。自动备份原内容以便回滚。
   */
  delete(path: string): this {
    const hasBackup = existsSync(path);
    const backup = hasBackup ? readFileSync(path, 'utf-8') : null;
    this.operations.push({ type: 'delete', path, backup });
    return this;
  }

  /**
   * 移动/重命名文件。
   */
  move(srcPath: string, destPath: string): this {
    const hasBackup = existsSync(destPath);
    const backup = hasBackup ? readFileSync(destPath, 'utf-8') : null;
    const srcBackup = existsSync(srcPath) ? readFileSync(srcPath, 'utf-8') : null;
    this.operations.push({
      type: 'move',
      path: srcPath,
      destPath,
      backup: backup || null,
      content: srcBackup || undefined,
    });
    return this;
  }

  /**
   * 执行所有操作。任何一步失败则自动回滚。
   */
  async commit(): Promise<void> {
    if (this.committed) {
      throw new Error('Transaction already committed');
    }

    const executed: Operation[] = [];

    try {
      for (const op of this.operations) {
        // 确保父目录存在
        const parentDir = dirname(op.path);
        mkdirpSync(parentDir);
        if (op.destPath) {
          mkdirpSync(dirname(op.destPath));
        }

        switch (op.type) {
          case 'write':
            writeFileSync(op.path, op.content!, 'utf-8');
            break;

          case 'delete':
            if (existsSync(op.path)) {
              unlinkSync(op.path);
            }
            break;

          case 'move':
            if (existsSync(op.path)) {
              renameSync(op.path, op.destPath!);
            }
            break;
        }

        executed.push(op);
      }

      this.committed = true;
    } catch (error) {
      // 回滚：逆序恢复所有已执行操作
      await this.rollback(executed);
      throw new Error(
        `Transaction failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 回滚已执行的操作。
   */
  private async rollback(executed: Operation[]): Promise<void> {
    for (const op of executed.reverse()) {
      try {
        switch (op.type) {
          case 'write':
            if (op.backup !== null && op.backup !== undefined) {
              writeFileSync(op.path, op.backup, 'utf-8');
            } else if (existsSync(op.path)) {
              unlinkSync(op.path);
            }
            break;

          case 'delete':
            if (op.backup !== null && op.backup !== undefined) {
              writeFileSync(op.path, op.backup, 'utf-8');
            }
            break;

          case 'move':
            if (existsSync(op.destPath!)) {
              renameSync(op.destPath!, op.path);
            }
            break;
        }
      } catch {
        // 回滚失败时记录但不抛出（避免掩盖原始错误）
      }
    }
  }

  /**
   * 获取操作数量。
   */
  getOperations(): ReadonlyArray<{ type: OpType; path: string }> {
    return this.operations.map((op) => ({ type: op.type, path: op.path }));
  }

  /**
   * 获取操作数量。
   */
  get length(): number {
    return this.operations.length;
  }
}
