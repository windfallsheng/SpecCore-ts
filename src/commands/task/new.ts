import { ensureDir, writeFile, pathExists, readFile } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../../utils/logger';
import { getDefaultIteration, updateContext, getIterationDir } from '../../core/context';
import { nextTaskId } from '../../core/global-counters';

export interface TaskNewOptions {
  name?: string;
  topic?: string;
  type?: string;
  id?: string;
  desc?: string;
  file?: string;
  sections?: string;
  backendOnly?: boolean;
  frontendOnly?: boolean;
  iteration?: string;
  batch?: string;
  batchFile?: string;
  interactive?: boolean;
  schedule?: string;
}

export async function taskNewCommand(options: TaskNewOptions): Promise<void> {
  // ── 批量模式 ──
  if (options.batch || options.batchFile) {
    await batchCreateTasks(options);
    return;
  }

  if (!options.name) {
    logger.error('Task name is required. Use --name <name>');
    return;
  }

  await createSingleTask(options);
}

/** 批量创建 Task */
async function batchCreateTasks(options: TaskNewOptions): Promise<void> {
  let batchText = options.batch || '';

  // 从文件读取
  if (options.batchFile) {
    if (!await pathExists(options.batchFile)) {
      logger.error('文件不存在: ' + options.batchFile);
      return;
    }
    const ext = options.batchFile.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx') {
      try {
        const XLSX = require('xlsx');
        const wb = XLSX.readFile(options.batchFile);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
        batchText = data.slice(1)
          .filter((row: any[]) => row.some((c: any) => c))
          .map((row: any[]) => row.filter((c: any) => c).join(' — '))
          .join('\n');
        logger.info('📊 从 Excel 导入: ' + options.batchFile);
      } catch (e: any) {
        logger.error('Excel 解析失败: ' + e.message);
        return;
      }
    } else {
      batchText = await readFile(options.batchFile, 'utf-8');
      logger.info('📄 从文件导入: ' + options.batchFile);
    }
  }

  const items = batchText.split('\n').filter(b => b.trim());
  if (items.length === 0) {
    logger.error('未找到有效的任务描述');
    return;
  }

  // 交互确认
  if (options.interactive) {
    logger.info(`\n📋 共 ${items.length} 个任务:\n`);
    for (let i = 0; i < items.length; i++) {
      logger.info(`  ${i + 1}. ${items[i].trim()}`);
    }
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer: string = await new Promise(resolve => rl.question('\n确认创建？[y/N] ', resolve));
    rl.close();
    if (answer.toLowerCase() !== 'y') {
      logger.info('已取消');
      return;
    }
  }

  const type = options.type || 'bugfix';
  const schedule = options.schedule || 'now';
  let created = 0;

  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    try {
      await createSingleTask({
        ...options,
        name: trimmed.slice(0, 60),
        desc: trimmed,
        type,
        schedule,
      });
      created++;
    } catch (e: any) {
      logger.error(`创建失败 "${trimmed.slice(0, 30)}": ${e.message}`);
    }
  }

  logger.info(`\n✅ 创建完成: ${created}/${items.length} 个任务`);
}

/** 创建单个 Task */
async function createSingleTask(options: TaskNewOptions): Promise<void> {

  const spinner = new Spinner(`Creating task: ${options.name}`);
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('No active iteration found. Please specify --iteration or create one first.');
      return;
    }

    const iterationDir = await getIterationDir(iteration);
    
    // Determine task ID (使用 --topic 英文主题词)
    const { id: rawId } = options.id 
      ? { id: options.id.replace(/^Task-/, '') } 
      : await nextTaskId(options.topic);
    const taskId = rawId.replace(/^Task-/, '');
    const taskDir = join(iterationDir, '030-tasks', `Task-${taskId}`);

    if (await pathExists(taskDir)) {
      spinner.fail(`Task already exists: Task-${taskId}`);
      return;
    }

    // Create directories
    if (!options.frontendOnly) {
      await ensureDir(join(taskDir, 'backend'));
    }
    if (!options.backendOnly) {
      await ensureDir(join(taskDir, 'frontend'));
    }
    await ensureDir(join(taskDir, '_shared'));

  // Write task type
  await writeFile(join(taskDir, '.task-type'), options.type || 'feature');
  
  // Write task status (schedule=night → queue, else → todo)
  const status = options.schedule === 'night' ? 'queue' : 'todo';
  await writeFile(join(taskDir, '.task-status'), status);

    // Generate task content
    const taskContent = await generateTaskContent(options);

    // Write backend files
    if (!options.frontendOnly) {
      await writeFile(join(taskDir, 'backend', 'REQ.md'), taskContent.req);
      await writeFile(join(taskDir, 'backend', 'TECH.md'), taskContent.tech);
      await writeFile(join(taskDir, 'backend', 'TASK.md'), taskContent.task);
    }

    // Write frontend files
    if (!options.backendOnly) {
      await writeFile(join(taskDir, 'frontend', 'REQ.md'), taskContent.req);
      await writeFile(join(taskDir, 'frontend', 'TECH.md'), taskContent.tech);
      await writeFile(join(taskDir, 'frontend', 'TASK.md'), taskContent.task);
    }

    // Update context
    await updateContext({
      currentTask: `Task-${taskId}`,
      currentIteration: iteration,
      lastUpdated: new Date().toISOString()
    });

    spinner.stop(`Task created: Task-${taskId} - ${options.name}`);
  } catch (error) {
    spinner.fail(`Failed to create task: ${error}`);
    throw error;
  }
}

async function findNextTaskId(iterationDir: string): Promise<string> {
  const { readdir } = await import('fs-extra');
  
  const entries = await readdir(iterationDir, { withFileTypes: true });
  const taskDirs = entries
    .filter(e => e.isDirectory() && e.name.startsWith('Task-'))
    .map(e => parseInt(e.name.replace('Task-', '')))
    .filter(n => !isNaN(n));
  
  const maxId = Math.max(0, ...taskDirs);
  return String(maxId + 1).padStart(3, '0');
}

async function generateTaskContent(options: TaskNewOptions): Promise<{ req: string; tech: string; task: string }> {
  const name = options.name || 'New Task';
  const desc = options.desc || '';
  const type = options.type || 'feature';

  const req = `# ${name}

## 需求描述

${desc}

## 验收标准

- [ ] AC-1: 
- [ ] AC-2: 
- [ ] AC-3: 

## 输入/输出

### 输入

### 输出

## 业务规则

## 错误处理
`;

  const tech = `# ${name} - 技术方案

## 1. 方案概述

## 2. 接口设计

### 2.1 API 定义

### 2.2 请求/响应格式

## 3. 数据模型

## 4. 核心逻辑

### 4.1 流程图

### 4.2 伪代码

## 5. 测试策略

### 5.1 单元测试

### 5.2 集成测试

## 6. 风险与应对
`;

  const task = `# ${name}

## 任务信息
- 类型: ${type}
- 状态: 🔲 待开发
- 优先级: medium
- 预计耗时: 2h
- 创建时间: ${new Date().toISOString().split('T')[0]}

## 变更履历
| 时间 | 变更内容 | 变更人 |
| :--- | :--- | :--- |
| ${new Date().toISOString().split('T')[0]} | 创建任务 | CLI |

## 产出物
| 产出物 | 状态 | 路径 |
| :--- | :--- | :--- |
| REQ.md | ✅ | ./REQ.md |
| TECH.md | ✅ | ./TECH.md |
| TASK.md | ✅ | ./TASK.md |
| API_CONTRACT.yaml | ⏳ | ./_shared/API_CONTRACT.yaml |

## 依赖关系
| 依赖任务 | 依赖原因 | 状态 |
| :--- | :--- | :--- |
| | | |

## 阻塞关系
| 被阻塞任务 | 阻塞原因 | 状态 |
| :--- | :--- | :--- |
| | | |
`;

  return { req, tech, task };
}
