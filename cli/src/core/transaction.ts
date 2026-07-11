import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { dirname } from 'path';

/** 事务操作类型 */
type OpType = 'write' | 'delete' | 'move';

/** 单个事务操作 */
interface TransactionOp {
  type: OpType;
  path: string;
  content?: string;
  newPath?: string;
  backup?: string | null;      // null = file didn't exist before
  backupPath?: string | null;  // for move: original path
}

/**
 * 文件操作事务 — 支持写入/删除/移动，失败时自动回滚。
 *
 * 用法:
 *   const tx = new FileTransaction();
 *   tx.write('a.txt', 'hello').delete('b.txt').move('old.txt', 'new.txt');
 *   await tx.commit();
 */
export class FileTransaction {
  private ops: TransactionOp[] = [];
  private committed = false;

  /** 写入文件（事务内） */
  write(path: string, content: string): this {
    const backup = existsSync(path) ? readFileSync(path, 'utf-8') : null;
    this.ops.push({ type: 'write', path, content, backup });
    return this;
  }

  /** 删除文件（事务内） */
  delete(path: string): this {
    const backup = existsSync(path) ? readFileSync(path, 'utf-8') : null;
    this.ops.push({ type: 'delete', path, backup });
    return this;
  }

  /** 移动文件（事务内） */
  move(oldPath: string, newPath: string): this {
    const content = existsSync(oldPath) ? readFileSync(oldPath, 'utf-8') : null;
    const newBackup = existsSync(newPath) ? readFileSync(newPath, 'utf-8') : null;
    this.ops.push({ type: 'move', path: oldPath, newPath, backup: content, backupPath: newBackup });
    return this;
  }

  /** 获取操作数量 */
  get size(): number {
    return this.ops.length;
  }

  /**
   * 执行事务 — 逐条执行操作。任何一步失败，回滚所有已执行的操作。
   * @throws 事务失败时抛出异常，状态回滚
   */
  async commit(): Promise<void> {
    if (this.committed) {
      throw new Error('Transaction already committed');
    }

    const executed: TransactionOp[] = [];
    try {
      for (const op of this.ops) {
        this.executeOp(op);
        executed.push(op);
      }
      this.committed = true;
    } catch (error) {
      // 回滚所有已执行的操作（逆序）
      for (const op of executed.reverse()) {
        this.rollbackOp(op);
      }
      throw new Error(
        `Transaction failed at step ${executed.length + 1}/${this.ops.length}: ${(error as Error).message}`
      );
    }
  }

  /** 执行单个操作 */
  private executeOp(op: TransactionOp): void {
    mkdirSync(dirname(op.path), { recursive: true });

    switch (op.type) {
      case 'write':
        writeFileSync(op.path, op.content!, 'utf-8');
        break;
      case 'delete':
        if (existsSync(op.path)) unlinkSync(op.path);
        break;
      case 'move':
        if (op.backup !== null) {
          mkdirSync(dirname(op.newPath!), { recursive: true });
        }
        renameSync(op.path, op.newPath!);
        break;
    }
  }

  /** 回滚单个操作 */
  private rollbackOp(op: TransactionOp): void {
    try {
      switch (op.type) {
        case 'write':
          if (op.backup !== null) {
            writeFileSync(op.path, op.backup, 'utf-8');
          } else {
            if (existsSync(op.path)) unlinkSync(op.path);
          }
          break;
        case 'delete':
          if (op.backup !== null) {
            writeFileSync(op.path, op.backup, 'utf-8');
          }
          break;
        case 'move':
          // Restore move: rename back + restore newPath backup
          if (existsSync(op.newPath!)) {
            if (op.backupPath !== null) {
              writeFileSync(op.newPath!, op.backupPath, 'utf-8');
            } else {
              unlinkSync(op.newPath!);
            }
          }
          if (op.backup !== null) {
            writeFileSync(op.path, op.backup, 'utf-8');
          }
          break;
      }
    } catch {
      // Rollback failure is non-recoverable — log but don't throw
    }
  }
}
