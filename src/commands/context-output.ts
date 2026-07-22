/**
 * context — 输出任务完整上下文，供任何 AI 使用
 */
import { readFile, pathExists } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { loadConfig } from '../core/unified-config';
import { getDefaultIteration } from '../core/context';

export interface ContextOptions {
  task?: string;
  iteration?: string;
  format?: 'text' | 'markdown';
}

export async function contextCommand(options: ContextOptions): Promise<void> {
  const iteration = await getDefaultIteration(options.iteration);
  if (!iteration) { logger.error('No active iteration'); return; }

  const iterDir = `期次-${iteration}`;
  const fs = require('fs');
  
  // Find task
  let taskId = options.task;
  if (!taskId) {
    const entries = fs.readdirSync(iterDir, { withFileTypes: true });
    const tasks = entries.filter((e: any) => e.isDirectory() && e.name.startsWith('Task-'));
    if (tasks.length === 0) { logger.error('No tasks found'); return; }
    taskId = tasks[0].name;
  }

  const entries = fs.readdirSync(iterDir, { withFileTypes: true });
  const taskEntry = entries.find((e: any) => e.isDirectory() && e.name.startsWith(taskId));
  if (!taskEntry) { logger.error(`Task not found: ${taskId}`); return; }

  const backendDir = join(iterDir, taskEntry.name, 'backend');
  const sharedDir = join(iterDir, taskEntry.name, '_shared');
  const config = await loadConfig();

  // Collect context
  const context: string[] = [];
  
  // CONSTITUTION
  const constitutionPath = '.speccore/PROJECT/CONSTITUTION.md';
  if (await pathExists(constitutionPath)) {
    const constitution = await readFile(constitutionPath, 'utf-8');
    context.push('## 项目宪法（必须遵守）\n');
    context.push(constitution);
  }

  // REQ
  if (await pathExists(join(backendDir, 'REQ.md'))) {
    context.push('\n## 需求规格\n');
    context.push(await readFile(join(backendDir, 'REQ.md'), 'utf-8'));
  }

  // TECH
  if (await pathExists(join(backendDir, 'TECH.md'))) {
    context.push('\n## 技术方案\n');
    const tech = await readFile(join(backendDir, 'TECH.md'), 'utf-8');
    context.push(tech.slice(0, 2000)); // limit
  }

  // API Contract
  if (await pathExists(join(sharedDir, 'API_CONTRACT.yaml'))) {
    context.push('\n## API 契约\n```yaml');
    context.push(await readFile(join(sharedDir, 'API_CONTRACT.yaml'), 'utf-8'));
    context.push('```');
  }

  // TEST
  if (await pathExists(join(backendDir, 'TEST.md'))) {
    context.push('\n## 测试要求\n');
    const test = await readFile(join(backendDir, 'TEST.md'), 'utf-8');
    context.push(test.slice(0, 1000));
  }

  // Tech stack
  if (config.tech_stack) {
    context.push('\n## 技术栈\n');
    for (const [k, v] of Object.entries(config.tech_stack)) {
      if (v) context.push(`- ${k}: ${v}`);
    }
  }

  const output = context.join('\n');
  
  logger.info(`\n📋 ${taskEntry.name} 上下文 (${output.length} 字符):\n`);
  logger.info(output);
  logger.info('\n---');
  logger.info('💡 复制以上内容到任何 AI 工具（Copilot/Claude/GPT），基于 Spec 生成代码');
}
