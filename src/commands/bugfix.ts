/**
 * bugfix - 快速 Bug 修复命令
 * 创建修复任务，自动标注受影响文件和回归范围
 */

import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { ensureDir, writeFile, pathExists, readFile } from 'fs-extra';
import { join } from 'path';
import { createInterface } from 'readline';

function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${question} `, answer => { rl.close(); resolve(answer.trim()); });
  });
}

export interface BugfixOptions {
  name?: string;
  desc?: string;
  batch?: string;
  batchFile?: string;  // Excel/CSV 文件路径
  interactive?: boolean;
  taskId?: string;
  iteration?: string;
  affectedTask?: string;
  schedule?: string;  // night/now
}

export async function bugfixCommand(options: BugfixOptions): Promise<void> {
  // 批量模式
  if (options.batch || options.batchFile) {
    // 支持文件导入（自动识别 .xlsx/.csv/.txt）
    if (options.batchFile) {
      if (!await pathExists(options.batchFile)) { logger.error('文件不存在: ' + options.batchFile); return; }
      
      const ext = options.batchFile.split('.').pop()?.toLowerCase();
      if (ext === 'xlsx') {
        try {
          const XLSX = require('xlsx');
          const wb = XLSX.readFile(options.batchFile);
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
          // 跳过表头，每行取第一列（或拼所有列）
          options.batch = data.slice(1)
            .filter((row: any[]) => row.some((c: any) => c))
            .map((row: any[]) => row.filter((c: any) => c).join(' — '))
            .join('\n');
          logger.info('📊 从 Excel 导入: ' + options.batchFile);
        } catch (e: any) {
          logger.error('Excel 解析失败: ' + e.message);
          return;
        }
      } else {
        options.batch = await readFile(options.batchFile, 'utf-8');
        logger.info('📄 从文件导入: ' + options.batchFile);
      }
    }
    const bugs = (options.batch || '').split('\n').filter(b => b.trim());
    if (bugs.length === 0) {
      logger.error('批量输入为空');
      return;
    }

    // ── Interactive preview ──
    if (options.interactive) {
      logger.info(`📋 解析到 ${bugs.length} 个 Bug:\n`);
      for (let i = 0; i < bugs.length; i++) {
        const title = bugs[i].split('\n')[0].slice(0, 50);
        logger.info(`  ${i + 1}. ${title}`);
      }
      logger.info('');
      logger.info('💡 [y] 全部创建  [e] 编辑某个  [s] 跳过某个  [q] 取消');
      const answer = await promptUser('确认创建？');
      if (answer?.toLowerCase() === 'q') { logger.info('已取消'); return; }
      if (answer?.toLowerCase() === 'e') {
        const idx = await promptUser('编辑第几个？');
        const i = parseInt(idx) - 1;
        if (i >= 0 && i < bugs.length) {
          logger.info(`当前: ${bugs[i].slice(0, 100)}`);
          const edit = await promptUser('修改后内容（留空保留原样）: ');
          if (edit) bugs[i] = edit;
        }
      }
      if (answer?.toLowerCase() === 's') {
        const skip = await promptUser('跳过第几个（逗号分隔）？');
        const skipIdx = skip.split(',').map(s => parseInt(s.trim()) - 1).filter(i => i >= 0 && i < bugs.length);
        skipIdx.sort((a, b) => b - a).forEach(i => bugs.splice(i, 1));
        logger.info(`保留 ${bugs.length} 个 Bug`);
      }
    }

    await batchBugfixCreate(bugs, options);
    return;
  }

  if (!options.name && !options.desc) {
    logger.error('请提供 Bug 描述。用法: speccore bugfix --name "<标题>" [--batch="多行"]');
    return;
  }

  const spinner = new Spinner('正在创建 Bug 修复任务...');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('未找到活跃期次。请先运行: speccore iteration create --name <名称>');
      return;
    }

    const bugName = options.name || 'Bug修复';
    const taskId = options.taskId || await generateTaskId(iteration);

    // 创建修复任务目录
    const taskDir = join(iteration, taskId);
    await ensureDir(join(taskDir, 'backend'));

    // 创建 .task-type
    await writeFile(join(taskDir, '.task-type'), 'bugfix');

    // 生成修复 Spec
    await writeFile(
      join(taskDir, 'backend', 'REQ.md'),
      generateBugfixReq(bugName, options.desc || '', options.affectedTask)
    );
    await writeFile(
      join(taskDir, 'backend', 'TASK.md'),
      generateBugfixTask(bugName, options.desc || '', options.affectedTask)
    );

    spinner.stop(`Bug 修复任务已创建: ${taskId}`);
    logger.info('');
    logger.info(`🐛 Bug 修复详情:`);
    logger.info(`   期次: ${iteration}`);
    logger.info(`   任务: ${taskId} - ${bugName}`);
    if (options.affectedTask) {
      logger.info(`   ⚠️ 受影响任务: ${options.affectedTask}`);
    }
    if (options.desc) {
      logger.info(`   描述: ${options.desc}`);
    }
    logger.info('');
    logger.info('下一步:');
    logger.info(`  1. 编辑 ${taskId}/backend/REQ.md 补充根因分析`);
    logger.info('  2. 运行: speccore execute --task=' + taskId);
  } catch (error) {
    spinner.fail(`Bug 修复任务创建失败: ${error}`);
    throw error;
  }
}

async function generateTaskId(iteration: string): Promise<string> {
  let maxId = 0;
  const iterationDir = join(process.cwd(), iteration);
  if (await pathExists(iterationDir)) {
    const { readdir } = await import('fs-extra');
    const entries = await readdir(iterationDir);
    for (const entry of entries) {
      const match = entry.match(/^Task-(\d+)$/);
      if (match) {
        const id = parseInt(match[1], 10);
        if (id > maxId) maxId = id;
      }
    }
  }
  return `Task-${String(maxId + 1).padStart(3, '0')}`;
}

function generateBugfixReq(name: string, desc: string, affectedTask?: string): string {
  return `# ${name} - Bug 修复需求

## 1. 问题描述

${desc || '请补充问题描述'}

## 2. 复现步骤

1. 
2. 
3. 

## 3. 预期行为

- 

## 4. 实际行为

- 

${affectedTask ? `
## 5. 受影响任务

- ${affectedTask} → 🔶 待回归
` : ''}

## 6. 根因分析

- 

## 7. 修复方案

- 

## 8. 验收标准

- [ ] Bug 不再复现
- [ ] 回归测试通过
- [ ] 相关 Spec 文件已同步更新
`;
}

function generateBugfixTask(name: string, desc: string, affectedTask?: string): string {
  const now = new Date().toISOString().split('T')[0];
  return `# ${name} - 执行追踪

> **任务类型**: bugfix | **创建日期**: ${now} | **状态**: 🔲 待开发

## 1. 变更履历

| 日期 | 版本 | 变更说明 | 作者 |
| :--- | :--- | :--- | :--- |
| ${now} | v1.0 | 初始创建：${desc} | SpecCore |

## 2. 修复步骤

- [ ] 根因定位
- [ ] 编写修复代码
- [ ] 单元测试
- [ ] 回归测试${affectedTask ? ` (含 ${affectedTask})` : ''}
- [ ] Spec 同步更新

## 3. 影响范围

| 受影响文件 | 影响描述 | 状态 |
| :--- | :--- | :--- |
| | | |

## 4. 线上问题记录

| 日期 | 问题描述 | 根因 | 修复方案 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
  | ${now} | ${desc} | 待分析 | 待制定 | 🔲 |
`;
}

// ============================================================
// 批量 Bug 导入
// ============================================================

async function batchBugfixCreate(bugs: string[], options: BugfixOptions): Promise<void> {
  logger.info(`🐛 批量创建 ${bugs.length} 个 Bug 修复任务...`);
  logger.info('');
  
  const iteration = await getDefaultIteration(options.iteration);
  if (!iteration) {
    logger.error('未找到活跃期次。请先运行: speccore iteration create --name <名称>');
    return;
  }

  let created = 0;
  for (const bug of bugs) {
    // 取第一行作标题
    const lines = bug.trim().split('\n');
    const name = lines[0].slice(0, 50);
    const desc = lines.join('\n');
    const taskId = await generateTaskId(iteration);
    const taskDir = join(iteration, taskId);
    
    await ensureDir(join(taskDir, 'backend'));
    await writeFile(join(taskDir, '.task-type'), 'bugfix');
    await writeFile(join(taskDir, 'backend', 'REQ.md'), generateBugfixReq(name, desc));
    await writeFile(join(taskDir, 'backend', 'TASK.md'), generateBugfixTask(name, desc));
    created++;
    
    const scheduleTag = options.schedule === 'night' ? ' 🌙' : '';
    logger.info(`   ${taskId} ${name}${scheduleTag}`);
  }

  logger.info('');
  logger.info(`✅ 创建了 ${created}/${bugs.length} 个 Bug 修复任务`);
  
  if (options.schedule === 'night') {
    logger.info('');
    logger.info('🌙 已标记为夜间批量执行');
    logger.info('   speccore execute --all --scheduled  手动触发');
    logger.info('   或等待 automation 定时执行（如果已设置）');
  } else {
    logger.info('');
    logger.info('📋 下一步:');
    logger.info('   speccore plan --iteration=' + iteration + '  生成执行计划');
    logger.info('   speccore execute --all --scheduled       批量修复');
  }
}
