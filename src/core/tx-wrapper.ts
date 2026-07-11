/**
 * 事务包装工具 — 简化 FileTransaction 在命令中的使用
 *
 * 用法:
 *   import { transactional } from './tx-wrapper';
 *   await transactional(async (tx) => {
 *     tx.write(path, content);
 *     tx.write(otherPath, otherContent);
 *   });
 */

import { FileTransaction } from '../core/transaction';

export async function transactional(
  fn: (tx: FileTransaction) => Promise<void>
): Promise<void> {
  const tx = new FileTransaction();
  await fn(tx);
  if (tx.length > 0) {
    await tx.commit();
  }
}

/**
 * 快速单文件安全写入
 */
export async function safeWrite(path: string, content: string): Promise<void> {
  const tx = new FileTransaction();
  tx.write(path, content);
  await tx.commit();
}
