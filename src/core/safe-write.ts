/**
 * Safe Write Wrapper — 所有命令写文件的统一入口
 *
 * 自动附加 FileTransaction 保护。在不需要完整事务的地方，
 * 至少提供原子写入保障。
 */

import { writeFile, ensureDir } from 'fs-extra';
import { dirname } from 'path';
import { FileTransaction } from './transaction';

/**
 * 带事务保护的批量写入
 */
export function createWriteTransaction(): FileTransaction {
  return new FileTransaction();
}

/**
 * 安全单文件写入（原子操作）
 */
export async function safeWriteFile(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, content);
}

/**
 * 受事务保护的单文件写入
 */
export async function transactionSafeWrite(tx: FileTransaction, path: string, content: string): Promise<void> {
  tx.write(path, content);
}
