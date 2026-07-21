/**
 * pattern save — 将 Task/内容/文件 保存为可复用模式
 */
import { logger } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { scanTasks } from '../core/state';
import { readFile, writeFile, pathExists, ensureDir } from 'fs-extra';
import { join } from 'path';

export interface PatternOptions {
  name: string;
  task?: string;
  content?: string;
  file?: string;
  desc?: string;
  iteration?: string;
  force?: boolean;
}

export async function patternCommand(options: PatternOptions): Promise<void> {
  if (!options.name) {
    logger.error('请指定模式名称: speccore pattern save --name=<名称>');
    return;
  }

  const patternsDir = join(process.cwd(), '.speccore', 'patterns');
  const targetDir = join(patternsDir, options.name);

  // 同名检查
  if (await pathExists(targetDir) && !options.force) {
    logger.warn(`模式 "${options.name}" 已存在。使用 --force 覆盖`);
    return;
  }

  await ensureDir(targetDir);

  // 三个输入源
  if (options.task) {
    await saveFromTask(options, targetDir);
  } else if (options.content) {
    await saveFromContent(options, targetDir);
  } else if (options.file) {
    await saveFromFile(options, targetDir);
  } else {
    logger.error('请指定输入源: --task / --content / --file');
    return;
  }

  // 写 PATTERN.md 元信息
  const meta = generatePatternMeta(options);
  await writeFile(join(targetDir, 'PATTERN.md'), meta);

  // 列出保存的文件
  const { readdir: rd } = await import('fs-extra');
  const files = (await rd(targetDir)).filter(f => !f.startsWith('.'));
  logger.success(`模式 "${options.name}" 已保存 (${files.length} 个文件)`);
  logger.info(`   路径: .speccore/patterns/${options.name}/`);
  logger.info('   使用: speccore new-task --name="xxx" --pattern=' + options.name);
}

async function saveFromTask(options: PatternOptions, targetDir: string): Promise<void> {
  const iteration = await getDefaultIteration(options.iteration);
  const tasks = await scanTasks(iteration);
  const task = tasks.find(t => t.id === options.task || t.id.startsWith(options.task + '-'));

  if (!task) {
    logger.error(`未找到 Task: ${options.task}`);
    return;
  }

  const cwd = process.cwd();
  const iterDir = join(cwd, `期次-${iteration}`);
  const taskDir = join(iterDir, task.id);
  const backendDir = join(taskDir, 'backend');

  // 复制 Spec 文件，替换占位符
  const taskName = task.name || task.id;
  if (await pathExists(join(backendDir, 'REQ.md'))) {
    let content = await readFile(join(backendDir, 'REQ.md'), 'utf-8');
    content = generalizeContent(content, taskName);
    await writeFile(join(targetDir, 'REQ.tmpl.md'), content);
  }
  if (await pathExists(join(backendDir, 'TECH.md'))) {
    let content = await readFile(join(backendDir, 'TECH.md'), 'utf-8');
    content = generalizeContent(content, taskName);
    await writeFile(join(targetDir, 'TECH.tmpl.md'), content);
  }
  if (await pathExists(join(backendDir, 'TASK.md'))) {
    let content = await readFile(join(backendDir, 'TASK.md'), 'utf-8');
    content = generalizeContent(content, taskName);
    await writeFile(join(targetDir, 'TASK.tmpl.md'), content);
  }
}

async function saveFromContent(options: PatternOptions, targetDir: string): Promise<void> {
  await writeFile(join(targetDir, 'REQ.tmpl.md'), options.content || '');
  logger.info('已从 --content 保存');
}

async function saveFromFile(options: PatternOptions, targetDir: string): Promise<void> {
  if (!options.file || !(await pathExists(options.file))) {
    logger.error(`文件不存在: ${options.file}`);
    return;
  }
  const content = await readFile(options.file!, 'utf-8');
  const basename = options.file!.split('/').pop() || 'file';
  await writeFile(join(targetDir, basename.replace('.md', '.tmpl.md')), content);
  logger.info('已从 ' + basename + ' 保存');
}

function generatePatternMeta(options: PatternOptions): string {
  const source = options.task ? `Task-${options.task}` : options.file ? options.file : '--content';
  return `# ${options.name}

> 类型: pattern | 来源: ${source} | 保存时间: ${new Date().toISOString()}

## 描述
${options.desc || '无描述'}

## 占位符
| 占位符 | 说明 |
| :--- | :--- |
| {{Entity}} | 实体名 (PascalCase) |
| {{entity}} | 实体名 (camelCase) |

## 使用方式
\`\`\`bash
speccore new-task --name="xxx" --pattern=${options.name}
\`\`\`
`;
}

/** 将指定名称替换为占位符 */
function generalizeContent(content: string, taskName: string): string {
  // 简单替换：任务名 → {{Entity}}
  return content
    .split(taskName).join('{{Entity}}')
    .split(taskName.toLowerCase()).join('{{entity}}');
}
