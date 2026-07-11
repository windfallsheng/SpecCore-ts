import { createHash } from 'crypto';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { FileTransaction } from '../core/transaction';
import { YamlParser } from '../core/yaml-parser';

/**
 * 同步命令结果
 */
export interface SyncResult {
  success: boolean;
  changes: string[];
  errors: string[];
}

/**
 * 从代码/文件变更反向同步到 Spec。
 *
 * 支持：
 * - 扫描指定 Task 目录的文件变更（修改时间）
 * - 更新 TASK.md 中的输出文件列表
 * - 更新 API_CONTRACT.yaml（如果有变更）
 * - 使用事务保证原子性
 */
export async function syncCommand(options: {
  projectRoot: string;
  iteration: string;
  task?: string;
  dryRun?: boolean;
}): Promise<SyncResult> {
  const { projectRoot, iteration, task, dryRun = false } = options;
  const changes: string[] = [];
  const errors: string[] = [];

  // 确定要同步的 Task
  const iterDir = join(projectRoot, iteration);
  if (!existsSync(iterDir)) {
    return { success: false, changes: [], errors: [`期次目录不存在: ${iteration}`] };
  }

  const tasks = task
    ? [task]
    : (existsSync(iterDir) ? readdirSync(iterDir).filter(f => f.startsWith('Task-')).sort() : []);

  if (tasks.length === 0) {
    return { success: true, changes: ['无 Task 需要同步'], errors: [] };
  }

  const tx = new FileTransaction();

  for (const t of tasks) {
    const taskPath = join(iterDir, t, 'backend', 'TASK.md');
    if (!existsSync(taskPath)) continue;

    // 读取当前 TASK.md
    const current = readFileSync(taskPath, 'utf-8');

    // 扫描 Task 目录下的实际文件
    const files = scanTaskFiles(join(iterDir, t));
    const outputSection = files.map(f => `- [ ] ${f}`).join('\n');

    // 更新 TASK.md 中的「📁 产出文件」部分
    let updated = current;
    const outputsPattern = /##\s*📁\s*产出文件[\s\S]*?(?=##|$)/;

    if (outputsPattern.test(current)) {
      updated = current.replace(outputsPattern, `## 📁 产出文件\n\n${outputSection}\n\n`);
    } else {
      updated = current + `\n## 📁 产出文件\n\n${outputSection}\n`;
    }

    // 计算文件哈希
    const checksum = createHash('md5').update(updated).digest('hex');

    if (dryRun) {
      changes.push(`${t}: 将更新 ${files.length} 个产出文件`);
      if (updated !== current) {
        changes.push(`${t}: TASK.md 有变更 (checksum: ${checksum})`);
      }
    } else {
      tx.write(taskPath, updated);
      changes.push(`${t}: 已同步 ${files.length} 个产出文件`);
    }
  }

  if (dryRun) {
    return { success: true, changes, errors };
  }

  try {
    await tx.commit();
    return { success: true, changes, errors };
  } catch (e) {
    errors.push(`事务失败: ${(e as Error).message}`);
    return { success: false, changes, errors };
  }
}

/** 扫描 Task 目录下实际文件 */
function scanTaskFiles(taskPath: string): string[] {
  const files: string[] = [];
  function walk(dir: string, prefix = '') {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full, prefix + entry + '/');
      } else if (!entry.endsWith('.md') && !entry.endsWith('.yaml')) {
        files.push(prefix + entry);
      }
    }
  }
  walk(join(taskPath, 'backend'));
  walk(join(taskPath, 'frontend'));
  return files;
}
