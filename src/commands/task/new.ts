import { ensureDir, writeFile, pathExists } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../../utils/logger';
import { getDefaultIteration, updateContext } from '../../core/context';

export interface TaskNewOptions {
  name?: string;
  type?: string;
  id?: string;
  desc?: string;
  file?: string;
  sections?: string;
  backendOnly?: boolean;
  frontendOnly?: boolean;
  iteration?: string;
}

export async function taskNewCommand(options: TaskNewOptions): Promise<void> {
  if (!options.name) {
    logger.error('Task name is required. Use --name <name>');
    return;
  }

  const spinner = new Spinner(`Creating task: ${options.name}`);
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('No active iteration found. Please specify --iteration or create one first.');
      return;
    }

    const iterationDir = `期次-${iteration}`;
    
    // Determine task ID
    const rawId = options.id || await findNextTaskId(iterationDir);
    const taskId = rawId.replace(/^Task-/, '');
    const taskDir = join(iterationDir, `Task-${taskId}`);

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
