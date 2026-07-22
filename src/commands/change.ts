/**
 * change - 需求变更联动命令
 * 修改任务需求时，自动更新关联 Spec 文件
 */

import { logger, Spinner } from '../utils/logger';
import { registerRequirement } from '../core/requirement-tracker';
import { getDefaultIteration } from '../core/context';
import { readFile, writeFile, pathExists } from 'fs-extra';
import { join } from 'path';
import { FileTransaction } from '../core/transaction';
import { scanTasks } from '../core/state';

export interface ChangeOptions {
  task?: string;
  desc?: string;
  global?: boolean;
  iteration?: string;
  dryRun?: boolean;
  requirement?: boolean;  // 同步更新 REQUIREMENT.md
  analysis?: boolean;     // 同步更新 ANALYSIS.md
  force?: boolean;
}

export async function changeCommand(options: ChangeOptions): Promise<void> {
  if (!options.task && !options.global) {
    logger.error('请指定要变更的 Task 或使用 --global。用法: speccore change --task=<Task编号> --desc="<变更描述>"');
    return;
  }

  if (!options.desc) {
    logger.error('请提供变更描述。用法: speccore change --desc="<变更描述>"');
    return;
  }

  // 规范化描述：口语 → 结构化
  const normalized = normalizeDescription(options.desc);
  if (normalized !== options.desc) {
    logger.info(`📝 描述已规范化: "${options.desc}" → "${normalized}"`);
    options.desc = normalized;
  }

  const spinner = new Spinner('正在分析变更影响...');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration && !options.global) {
      spinner.fail('未找到活跃期次。请先运行: speccore iteration create --name <名称>');
      return;
    }

    // 短 Task ID 支持: Task-001 → Task-001-订单管理
    if (options.task) {
      const tasks = await scanTasks(iteration);
      const exact = tasks.find(t => t.id === options.task);
      if (!exact) {
        const prefix = tasks.filter(t => t.id.startsWith(options.task!));
        if (prefix.length === 1) {
          logger.info(`📎 Task 短名匹配: ${options.task} → ${prefix[0].id}`);
          options.task = prefix[0].id;
        }
      }
    }

    if (options.dryRun) {
      await dryRunChange(options, iteration);
      spinner.stop('变更预览完成（--dry-run 模式，未实际修改）');
      return;
    }

    if (options.global) {
      await applyGlobalChange(options);
    } else {
      await applyTaskChange(options, iteration);
    }

    spinner.stop('需求变更已生效');
    logger.info('');
    logger.info('下一步:');
    logger.info('  1. 运行 speccore validate --task=' + (options.task || '') + ' 验证完整性');
    logger.info('  2. 检查受影响的下游任务是否需要回归');
  } catch (error) {
    spinner.fail(`变更失败: ${error}`);
    throw error;
  }
}

async function dryRunChange(options: ChangeOptions, iteration: string): Promise<void> {
  if (options.global) {
    logger.info('🔍 全局层变更影响分析：');
    logger.info('');
    logger.info('| 文件 | 影响描述 |');
    logger.info('| :--- | :--- |');
    logger.info('| .speccore/CONSTITUTION.md | 全局配置变更 |');
    logger.info('| 所有期次的 TECH.md | 架构方案需同步 |');
    logger.info('');
    return;
  }

  logger.info(`🔍 ${options.task} 变更影响分析：`);
  logger.info('');
  logger.info(`变更描述: ${options.desc}`);

  if (iteration) {
    const taskDir = join(process.cwd(), iteration, options.task || '');
    logger.info('| 文件 | 影响描述 |');
    logger.info('| :--- | :--- |');
    logger.info(`| ${options.task}/backend/REQ.md | 需求变更 |`);
    logger.info(`| ${options.task}/backend/TECH.md | 方案需调整 |`);
    logger.info(`| ${options.task}/_shared/API_CONTRACT.yaml | 接口契约可能需更新 |`);

    // 查找受影响的依赖任务
    if (await pathExists(taskDir)) {
      const graphPath = join(process.cwd(), iteration, '00-期次总览', 'PROJECT_GRAPH.md');
      if (await pathExists(graphPath)) {
        const content = await readFile(graphPath, 'utf-8');
        const deps = findDependentTasks(content, options.task || '');
        if (deps.length > 0) {
          logger.info('');
          logger.warn('🔗 受影响下游任务：');
          for (const dep of deps) {
            logger.info(`   ${dep} → 🔶 待回归`);
          }
        }
      }
    }
  }
}

async function applyTaskChange(options: ChangeOptions, iteration: string): Promise<void> {
  if (!options.task) {
    logger.error('请指定 --task');
    return;
  }

  const taskDir = join(process.cwd(), iteration, options.task);
  if (!await pathExists(taskDir)) {
    logger.error(`任务目录不存在: ${taskDir}`);
    return;
  }

  const tx = new FileTransaction();
  const now = new Date().toISOString().split('T')[0];

  // 更新 REQ.md（事务保护）
  const reqPath = join(taskDir, 'backend', 'REQ.md');
  if (await pathExists(reqPath)) {
    let content = await readFile(reqPath, 'utf-8');
    const changeNote = `\n## 变更记录\n\n| ${now} | v1.1 | ${options.desc} | SpecCore |\n`;
    tx.write(reqPath, content + changeNote);
  }

  // 更新 TASK.md 变更履历（事务保护）
  const taskMdPath = join(taskDir, 'backend', 'TASK.md');
  if (await pathExists(taskMdPath)) {
    let content = await readFile(taskMdPath, 'utf-8');
    const changeEntry = `| ${now} | v1.1 | 需求变更: ${options.desc} | SpecCore |\n`;
    const updated = content.replace(
      /(\| :--- \| :--- \| :--- \| :--- \|)/,
      `$1\n${changeEntry}`
    );
    tx.write(taskMdPath, updated);
  }

  // 同步前端各平台 TASK.md（事务保护）
  const frontendDir = join(taskDir, 'frontend');
  if (await pathExists(frontendDir)) {
    const { readdir: rd } = await import('fs-extra');
    const platformDirs = await rd(frontendDir, { withFileTypes: true });
    for (const pd of platformDirs) {
      if (pd.isDirectory()) {
        const ftaskPath = join(frontendDir, pd.name, 'TASK.md');
        if (await pathExists(ftaskPath)) {
          let content = await readFile(ftaskPath, 'utf-8');
          const changeEntry = `| ${now} | v1.1 | 需求变更: ${options.desc} | SpecCore |\n`;
          const updated = content.replace(
            /(\| :--- \| :--- \| :--- \| :--- \|)/,
            `$1\n${changeEntry}`
          );
          tx.write(ftaskPath, updated);
        }
      }
    }
  }

  // 提交事务 — 原子写入，失败回滚
  if (tx.length > 0) {
    await tx.commit();
    logger.info(`✅ 已更新 ${tx.length} 个文件（事务保护）`);
    logger.info(`   ${options.task}/backend/REQ.md`);
    logger.info(`   ${options.task}/backend/TASK.md`);

    // ── 联动更新上层文档 ──
    if (options.requirement && options.task) {
      await syncToRequirement(iteration, options.task, options.desc!);
    }
    if (options.analysis && options.task) {
      await syncToAnalysis(iteration, options.task, options.desc!);
    }
  }
}

async function applyGlobalChange(options: ChangeOptions): Promise<void> {
  const tx = new FileTransaction();

  // 更新 CONSTITUTION.md 的变更记录（事务保护）
  const constPath = join(process.cwd(), '.speccore', 'CONSTITUTION.md');
  if (await pathExists(constPath)) {
    let content = await readFile(constPath, 'utf-8');
    const now = new Date().toISOString().split('T')[0];
    content += `\n## 变更记录\n\n| ${now} | ${options.desc} | SpecCore |\n`;
    tx.write(constPath, content);
  }

  if (tx.length > 0) {
    await tx.commit();
    logger.info('✅ 已更新: .speccore/CONSTITUTION.md（事务保护）');
  }
}

function findDependentTasks(graphContent: string, taskName: string): string[] {
  const deps: string[] = [];
  const lines = graphContent.split('\n');
  for (const line of lines) {
    // 查找依赖关系：Task 行中包含对目标 Task 的引用
    if (line.includes(taskName) && !line.includes(`| ${taskName} |`)) {
      const match = line.match(/Task-\d+/g);
      if (match) {
        for (const t of match) {
          if (t !== taskName && !deps.includes(t)) {
            deps.push(t);
          }
        }
      }
    }
  }
  return deps;
}

/**
 * 规范化变更描述：口语 → 结构化
 * "加了个批量删除" → "新增接口: 批量删除"
 * "修登录bug" → "修复: 登录异常"
 * "改一下密码规则" → "修改: 密码规则"
 */
function normalizeDescription(desc: string): string {
  const lower = desc.replace(/\s+/g, '');

  // 新增类
  if (/^(加|新增?|添?加|创建|做了?)/.test(lower)) {
    const cleaned = lower.replace(/^(加|新增?|添加|创建|做了?)了?(个|一下)?/, '').replace(/[了啦啊]$/, '');
    return `新增${cleaned ? `: ${cleaned}` : ''}`;
  }
  // 修复类
  if (/^(修|fix|修复|改bug|解决)/.test(lower)) {
    const cleaned = lower.replace(/^(修|fix|修复|改bug|解决)了?(个|一下)?/, '').replace(/[了啦啊]$/, '');
    return `修复${cleaned ? `: ${cleaned}` : ''}`;
  }
  // 修改类
  if (/^(改|调整|修改|换成?|更新|升级)/.test(lower)) {
    const cleaned = lower.replace(/^(改|调整|修改|换成?|更新|升级)了?(个|一下)?/, '').replace(/[了啦啊]$/, '');
    return `修改${cleaned ? `: ${cleaned}` : ''}`;
  }
  // 删除/移除类
  if (/^(删|移除|去掉|干掉)/.test(lower)) {
    const cleaned = lower.replace(/^(删|移除|去掉|干掉)了?(个|一下)?/, '').replace(/[了啦啊]$/, '');
    return `删除${cleaned ? `: ${cleaned}` : ''}`;
  }

  // 无法识别，原样返回但去语气词
  return desc.replace(/[了啦啊呢嗯哦哈]$/, '').trim();
}

/**
 * 同步变更到 REQUIREMENT.md（期次聚合需求文档）
 */
async function syncToRequirement(iteration: string, taskId: string, desc: string): Promise<void> {
  const iterDir = `期次-${iteration}`;
  const reqPath = join(iterDir, '00-需求文档', 'REQUIREMENT.md');
  
  if (!(await pathExists(reqPath))) {
    logger.warn(`  ⚠️ REQUIREMENT.md 不存在，跳过同步`);
    return;
  }

  const content = await readFile(reqPath, 'utf-8');
  const now = new Date().toISOString().split('T')[0];
  const entry = `\n| ${now} | ${taskId}: ${desc} | 变更 |`;
  
  // 在变更履历部分追加，或在末尾追加
  const changelogMatch = content.match(/## 变更履历/);
  let updated = '';
  if (changelogMatch) {
    const idx = content.indexOf('## 变更履历');
    const nextSection = content.indexOf('\n## ', idx + 1);
    if (nextSection > 0) {
      updated = content.slice(0, nextSection) + entry + '\n' + content.slice(nextSection);
    } else {
      updated = content + entry + '\n';
    }
  } else {
    updated = content + '\n## 变更履历\n\n| 时间 | 内容 | 类型 |\n| :--- | :--- | :--- |' + entry + '\n';
  }
  
  await writeFile(reqPath, updated);
  logger.info(`   → 已同步到 REQUIREMENT.md`);
}

/**
 * 同步变更到 ANALYSIS.md（技术方案文档）
 */
async function syncToAnalysis(iteration: string, taskId: string, desc: string): Promise<void> {
  const iterDir = `期次-${iteration}`;
  const analysisPath = join(iterDir, '00-需求文档', 'ANALYSIS.md');
  
  if (!(await pathExists(analysisPath))) {
    logger.warn(`  ⚠️ ANALYSIS.md 不存在，跳过同步。请先运行 speccore analyze`);
    return;
  }

  const content = await readFile(analysisPath, 'utf-8');
  const now = new Date().toISOString().split('T')[0];
  const entry = `| ${now} | ${taskId} | ${desc} |`;
  
  // 在技术方案末尾追加变更记录
  const marker = '可以开始拆分任务';
  const idx = content.lastIndexOf(marker);
  if (idx > 0) {
    const before = content.slice(0, idx + marker.length);
    const after = content.slice(idx + marker.length);
    
    if (after.includes('## 变更记录')) {
      const updated = before + after.replace(/## 变更记录[\s\S]*$/, 
        '## 变更记录\n\n| 时间 | 任务 | 变更内容 |\n| :--- | :--- | :--- |' + entry + '\n');
      await writeFile(analysisPath, updated);
    } else {
      const updated = before + '\n\n## 变更记录\n\n| 时间 | 任务 | 变更内容 |\n| :--- | :--- | :--- |' + entry + '\n' + after;
      await writeFile(analysisPath, updated);
    }
  } else {
    await writeFile(analysisPath, content + '\n\n## 变更记录\n\n| 时间 | 任务 | 变更内容 |\n| :--- | :--- | :--- |' + entry + '\n');
  }
  
  logger.info(`   → 已同步到 ANALYSIS.md`);
}
