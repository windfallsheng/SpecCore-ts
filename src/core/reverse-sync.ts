/**
 * Reverse Sync — 代码 → Spec 反向同步
 *
 * 扫描代码文件中的 @spec 注释，反向更新 TASK.md 的产出物清单
 */

import { pathExists, readFile, readdir } from 'fs-extra';
import { join } from 'path';
import { FileTransaction } from '../core/transaction';
import { logger } from '../utils/logger';

interface SpecRef {
  taskId: string;
  file: string;
  line: number;
  context: string;
}

/**
 * 扫描目录中的所有文件，提取 @spec Task-XXX 引用
 */
export async function scanCodeForSpecAnnotations(rootDir: string): Promise<SpecRef[]> {
  const results: SpecRef[] = [];
  const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.java', '.py', '.go', '.vue', '.rb'];

  async function scanDir(dir: string): Promise<void> {
    if (!(await pathExists(dir))) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const fullPath = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue;
        await scanDir(fullPath);
      } else if (codeExtensions.some((ext) => e.name.endsWith(ext))) {
        try {
          const content = await readFile(fullPath, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(/@spec\s+(Task-\d{3}\S*)/);
            if (match) {
              results.push({
                taskId: match[1],
                file: fullPath.replace(rootDir + '/', ''),
                line: i + 1,
                context: lines[i].trim(),
              });
            }
          }
        } catch {}
      }
    }
  }

  await scanDir(rootDir);
  return results;
}

/**
 * 反向同步：扫描代码 → 更新 TASK.md 产出物清单
 */
export async function reverseSync(rootDir: string, iteration?: string): Promise<{ task: string; files: number }[]> {
  const refs = await scanCodeForSpecAnnotations(rootDir);
  if (refs.length === 0) return [];

  // 按 Task 分组
  const byTask: Record<string, SpecRef[]> = {};
  for (const ref of refs) {
    if (!byTask[ref.taskId]) byTask[ref.taskId] = [];
    byTask[ref.taskId].push(ref);
  }

  const results: { task: string; files: number }[] = [];

  // 查找对应迭代中的 Task 目录
  const entries = await readdir(rootDir, { withFileTypes: true });
  const iterations = iteration
    ? [iteration]
    : entries.filter((e) => e.isDirectory() && e.name.startsWith('期次-')).map((e) => e.name);

  for (const taskId of Object.keys(byTask)) {
    for (const iter of iterations) {
      const taskDir = join(rootDir, iter, taskId);
      if (!(await pathExists(taskDir))) continue;

      // 更新 backend/TASK.md
      const taskMdPath = join(taskDir, 'backend', 'TASK.md');
      if (await pathExists(taskMdPath)) {
        const tx = new FileTransaction();
        let content = await readFile(taskMdPath, 'utf-8');
        const refs = byTask[taskId];

        // 追加或替换产出物清单
        const artifactSection = `## 4. 产出物清单\n\n| 产出物 | 路径 | 状态 |\n| :--- | :--- | :--- |\n${refs.map(r => `| 代码 | ${r.file} | 🔄 已关联 |`).join('\n')}\n`;
        if (content.includes('## 4. 产出物清单')) {
          content = content.replace(/## 4\. 产出物清单[\s\S]*?(?=\n## |$)/, artifactSection.trim());
        } else {
          content += '\n' + artifactSection;
        }

        tx.write(taskMdPath, content);

        // Also update _shared/TRACE.md
        const tracePath = join(taskDir, '_shared', 'TRACE.md');
        let traceContent = `# 追溯链：${taskId}\n\n> 自动生成于 ${new Date().toISOString()}\n\n`;
        for (const ref of refs) {
          traceContent += `- \`${ref.file}:${ref.line}\` — ${ref.context}\n`;
        }
        tx.write(tracePath, traceContent);

        await tx.commit();
        results.push({ task: taskId, files: refs.length });
        logger.info(`  ✅ ${taskId}: ${refs.length} code references synced`);
      }
    }
  }

  return results;
}
