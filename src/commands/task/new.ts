import { ensureDir, writeFile, pathExists, readFile } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../../utils/logger';
import { getDefaultIteration, updateContext, getIterationDir } from '../../core/context';
import { nextTaskId } from '../../core/global-counters';
import { parsePlatformList } from '../../core/spec-paths';
import { extractExcelBugs, extractExcelTextOnly, type ExcelBugRow } from '../../core/excel-extract';

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
  platforms?: string;
  iteration?: string;
  batch?: string;
  batchFile?: string;
  interactive?: boolean;
  feature?: string;      // --feature: 关联功能模块（影响 bugfix 分支 base）
  module?: string;       // Excel 表「模块」列解析出的功能模块（优先于 --feature）
  priority?: string;     // Excel 表「优先级」列
  severity?: string;     // Excel 表「严重度」列
  images?: { ext: string; buffer: Buffer }[];  // Excel 内嵌图片（bug 截图，随任务落盘）
  autoExecute?: boolean; // --auto-execute: 创建后自动 analyze→execute 修复
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
  interface TaskItem { name: string; desc: string; images: { ext: string; buffer: Buffer }[]; priority?: string; severity?: string; module?: string }
  const items: TaskItem[] = [];

  if (options.batchFile) {
    if (!await pathExists(options.batchFile)) {
      logger.error('文件不存在: ' + options.batchFile);
      return;
    }
    const ext = options.batchFile.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
      // v8.3.207+: 优先 exceljs（含内嵌图片 + 优先级/严重度/模块列），fallback xlsx 纯文本
      const bugs = await extractExcelBugs(options.batchFile);
      if (bugs) {
        for (const b of bugs) {
          const desc = b.cells.join(' — ');
          items.push({
            name: desc.slice(0, 60),
            desc,
            images: b.images.map(i => ({ ext: i.ext, buffer: i.buffer })),
            priority: b.priority,
            severity: b.severity,
            module: b.module,
          });
        }
        const imgCount = bugs.reduce((s, b) => s + b.images.length, 0);
        logger.info(`📊 从 Excel 导入 ${bugs.length} 个 bug${imgCount > 0 ? `（含 ${imgCount} 张截图）` : ''}: ${options.batchFile}`);
      } else {
        const rows = await extractExcelTextOnly(options.batchFile);
        if (rows) {
          for (const r of rows) items.push({ name: r.slice(0, 60), desc: r, images: [] });
          logger.info('📊 从 Excel 导入（纯文本，exceljs 未安装）: ' + options.batchFile);
        } else {
          logger.error('Excel 解析失败: ' + options.batchFile);
          return;
        }
      }
    } else {
      const text = await readFile(options.batchFile, 'utf-8');
      for (const line of text.split('\n').filter(b => b.trim())) {
        items.push({ name: line.trim().slice(0, 60), desc: line.trim(), images: [] });
      }
      logger.info('📄 从文件导入: ' + options.batchFile);
    }
  } else if (options.batch) {
    for (const line of options.batch.split('\n').filter(b => b.trim())) {
      items.push({ name: line.trim().slice(0, 60), desc: line.trim(), images: [] });
    }
  }

  if (items.length === 0) {
    logger.error('未找到有效的任务描述');
    return;
  }

  // 交互确认
  if (options.interactive) {
    logger.info(`\n📋 共 ${items.length} 个任务:\n`);
    for (let i = 0; i < items.length; i++) {
      const meta = [items[i].priority ? `P${items[i].priority}` : '', items[i].severity ? `S${items[i].severity}` : '', items[i].module ? `模块:${items[i].module}` : ''].filter(Boolean).join(' ');
      logger.info(`  ${i + 1}. ${items[i].name}${items[i].images.length > 0 ? ` 🖼️x${items[i].images.length}` : ''}${meta ? `  [${meta}]` : ''}`);
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
  let created = 0;

  for (const item of items) {
    try {
      await createSingleTask({
        ...options,
        name: item.name,
        desc: item.desc,
        type,
        images: item.images,
        priority: item.priority,
        severity: item.severity,
        module: item.module,
      });
      created++;
    } catch (e: any) {
      logger.error(`创建失败 "${item.name.slice(0, 30)}": ${e.message}`);
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
    
    // Determine task ID (使用 --topic 英文主题词，fallback 到 --name)
    // v8.3.77+: 修复只传 topic 导致 name 被忽略的问题
    // 始终递增计数器，即使手动指定 --id 也如此，避免后续自动编号冲突
    const { id: counterId } = await nextTaskId(options.name, options.topic);
    const taskId = options.id
      ? options.id.replace(/^Task-/, '')
      : counterId.replace(/^Task-/, '');
    const taskType = options.type || 'feature';
    // counterId 已含 slug（nextTaskId 返回 Task-NNN-slug），直接用
    const taskDir = join(iterationDir, '030-tasks', taskType, `Task-${taskId}`);

    if (await pathExists(taskDir)) {
      spinner.fail(`Task already exists: Task-${taskId}`);
      return;
    }

    // Create directories — 三级嵌套目录结构
    const today = new Date().toISOString().split('T')[0];
    const status = 'todo';
    await ensureDir(join(taskDir, '.meta'));
    await ensureDir(join(taskDir, '00-specs'));
    await ensureDir(join(taskDir, '_shared'));  // 共享契约（API_CONTRACT.yaml 等）

    // 创建子任务目录（新结构: {端名}/{taskId}-impl/，v6.49.2+ 平铺架构）
    // v8.3.145+: 使用项目实际端名（工程标识），不再硬编码 api/web
    const isResearch = taskType === 'research';
    let projectPlatforms = await parsePlatformList();
    if (projectPlatforms.length === 0) {
      projectPlatforms = ['api', 'web'];// fallback
    }

    // 根据参数过滤要创建的端
    let platformsToCreate = projectPlatforms;
    if (options.platforms) {
      const specified = options.platforms.split(',').map(p => p.trim()).filter(Boolean);
      platformsToCreate = projectPlatforms.filter(p => specified.includes(p));
    } else if (options.backendOnly) {
      platformsToCreate = projectPlatforms.filter(p =>
        /service|api|server|backend|后台/i.test(p)
      );
    } else if (options.frontendOnly) {
      platformsToCreate = projectPlatforms.filter(p =>
        /web|h5|miniapp|app|frontend|前端|ios|android|admin/i.test(p)
      );
    }

    if (!isResearch) {
      for (const platform of platformsToCreate) {
        const subtaskDir = join(taskDir, platform, `Task-${taskId}-impl`);
        await ensureDir(join(subtaskDir, '.meta'));
        await writeFile(join(subtaskDir, '.meta', 'type'), options.type || 'feature');
        await writeFile(join(subtaskDir, '.meta', 'status'), status);
        await writeFile(join(subtaskDir, '.meta', 'owner'), '未分配');
        await writeFile(join(subtaskDir, '.meta', 'created-at'), today);
      }
    }

    // Write task meta
    await ensureDir(join(taskDir, '.meta'));
    await writeFile(join(taskDir, '.meta', 'type'), options.type || 'feature');
    await writeFile(join(taskDir, '.meta', 'status'), status);
    await writeFile(join(taskDir, '.meta', 'owner'), '未分配');
    await writeFile(join(taskDir, '.meta', 'created-at'), today);
    // 功能单元标识（v6.49.4+）：Excel 模块列 > --feature > 任务名称
    await writeFile(join(taskDir, '.meta', 'feature'), options.module || options.feature || options.name || '未分类');
    // v8.3.209+: 优先级 / 严重度（Excel 表解析，可选）
    if (options.priority) await writeFile(join(taskDir, '.meta', 'priority'), options.priority);
    if (options.severity) await writeFile(join(taskDir, '.meta', 'severity'), options.severity);

    // Generate task content
    const taskContent = await generateTaskContent(options);

    // v8.3.207+: 落盘 Excel 内嵌图片 + REQ.md 引用（bug 截图进任务上下文）
    let reqContent = taskContent.req;
    if (options.images && options.images.length > 0) {
      const shotsDir = join(taskDir, 'assets', 'screenshots');
      await ensureDir(shotsDir);
      const refs: string[] = [];
      for (let i = 0; i < options.images.length; i++) {
        const img = options.images[i];
        const fn = `bug-${String(i + 1).padStart(2, '0')}.${img.ext}`;
        await writeFile(join(shotsDir, fn), img.buffer);
        refs.push(`![缺陷截图${i + 1}](../assets/screenshots/${fn})`);
      }
      reqContent += `\n\n## 缺陷截图\n\n${refs.join('\n\n')}\n`;
    }

    // Write core specs to 00-specs/
    await writeFile(join(taskDir, '00-specs', 'REQ.md'), reqContent);
    await writeFile(join(taskDir, '00-specs', 'TECH.md'), taskContent.tech);
    await writeFile(join(taskDir, '00-specs', 'CHANGELOG.md'), `# ${options.name} - 变更记录\n\n| 时间 | 版本 | 变更内容 | 变更人 |\n| :--- | :--- | :--- | :--- |\n| ${today} | v1.0 | 初始创建 | CLI |\n`);

    // Write per-platform TASK.md + 执行产出文档（新结构: {端名}/{taskId}-impl/）
    // v8.3.145+: 使用项目实际端名，不再硬编码 api/web
    if (!isResearch) {
      for (const platform of platformsToCreate) {
        const sub = join(taskDir, platform, `Task-${taskId}-impl`);
        await writeFile(join(sub, 'TASK.md'), taskContent.task);
        // 只有前端端才写 README.md（根据端名特征判断）
        const isFrontend = /web|h5|miniapp|app|frontend|前端|ios|android|admin/i.test(platform);
        if (isFrontend) {
          await writeFile(join(sub, 'README.md'), `# ${options.name}\n\n${platform} 端实现目录。\n`);
        }
      }
    }

    // Pre-create issues tracker
    await writeFile(join(taskDir, '.issues.md'), `# ${options.name} - 问题追踪\n\n> 执行过程中发现的问题记录于此。\n\n`);

    // Update context
    await updateContext({
      currentTask: `Task-${taskId}`,
      currentIteration: iteration,
      lastUpdated: new Date().toISOString()
    });

    spinner.stop(`Task created: Task-${taskId} - ${options.name}`);

    // v8.3.207+: --auto-execute 创建后自动 execute 修复（bug 无人值守）
    if (options.autoExecute) {
      const { execSync } = await import('child_process');
      logger.info(`🚀 [auto-execute] 自动修复 Task-${taskId}...`);
      logger.info(`   🔄 00-specs/ 由宿主 AI 填充（任务层 analyze 已废弃）`);
      logger.info(`   ⚡ execute --force`);
      try { execSync(`speccore execute --task=Task-${taskId} --force -I ${iteration}`, { stdio: 'inherit' }); } catch (e: any) { logger.warn(`   ⚠️ execute 失败: ${e.message}`); }
      logger.success('✅ [auto-execute] 自动修复完成');
    }
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
  const priority = options.priority || 'medium';

  const req = buildReqByType(type, name, desc);

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
- 优先级: ${priority}
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

/** v8.3.210+: 按任务类型差异化 REQ 结构（差异下沉到文档模板，交互不变） */
function buildReqByType(type: string, name: string, desc: string): string {
  const t = (type || 'feature').toLowerCase();
  const templates: Record<string, string> = {
    feature: `# ${name}\n\n## 需求描述\n\n${desc}\n\n## 验收标准\n\n- [ ] AC-1: \n- [ ] AC-2: \n- [ ] AC-3: \n\n## 输入/输出\n\n### 输入\n\n### 输出\n\n## 业务规则\n\n## 错误处理\n`,
    bugfix: `# ${name}\n\n## 缺陷描述\n\n${desc}\n\n## 复现步骤\n\n1. \n2. \n3. \n\n## 预期行为\n\n## 实际行为\n\n## 影响范围\n\n- 影响端/模块：\n- 影响程度：\n\n## 修复验收\n\n- [ ] 复现步骤可稳定复现\n- [ ] 修复后不再复现\n- [ ] 无回归\n`,
    refactor: `# ${name}\n\n## 重构目标\n\n${desc}\n\n## 现状问题\n\n- \n\n## 重构方案要点\n\n- \n\n## 重构边界\n\n> ⚠️ 仅重构内部实现，不改变外部行为/接口\n\n## 验收标准\n\n- [ ] 行为不变（原测试全过）\n- [ ] 代码结构改善\n`,
    test: `# ${name}\n\n## 测试范围\n\n${desc}\n\n## 覆盖目标\n\n- [ ] 功能路径\n- [ ] 边界条件\n- [ ] 异常处理\n\n## 测试环境\n\n## 交付物\n\n- 测试用例 + 结果\n`,
    security: `# ${name}\n\n## 安全风险描述\n\n${desc}\n\n## 攻击面\n\n- \n\n## 修复目标\n\n- \n\n## 验收标准\n\n- [ ] 漏洞已修复\n- [ ] 无新暴露面\n`,
    performance: `# ${name}\n\n## 性能指标\n\n${desc}\n\n## 当前基线\n\n- \n\n## 优化目标\n\n- \n\n## 验收标准\n\n- [ ] 达到目标指标\n- [ ] 无功能回归\n`,
    docs: `# ${name}\n\n## 文档范围\n\n${desc}\n\n## 目标受众\n\n## 交付物\n\n- \n`,
    review: `# ${name}\n\n## 审查范围\n\n${desc}\n\n## 审查要点\n\n- [ ] 正确性\n- [ ] 完整性\n- [ ] 一致性\n- [ ] 安全性\n\n## 审查结论\n`,
    research: `# ${name}\n\n## 调研目标\n\n${desc}\n\n## 待验证假设\n\n- \n\n## 调研结论\n\n## 建议\n`,
    deploy: `# ${name}\n\n## 部署范围\n\n${desc}\n\n## 部署步骤\n\n- \n\n## 回滚方案\n\n## 验收标准\n\n- [ ] 部署成功且可回滚\n`,
  };
  return templates[t] || templates.feature;
}
