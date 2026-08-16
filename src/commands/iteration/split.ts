import { ensureDir, writeFile, pathExists, readFile, readdir, remove } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../../utils/logger';
import { getDefaultIteration, getIterationDir } from '../../core/context';
import { scoreRisk, generateRiskReport } from '../../core/risk-scorer';
import { nextTaskId } from '../../core/global-counters';
import { backupWithTimestamp, isTimestampBackup } from '../../utils/task-utils';

import { showNextSteps } from '../../core/next-steps';
import { createInterface } from 'readline';
import { buildPrompt, formatPrompt } from '../../core/prompt-builder';
import { generatePlatformsRegistry } from '../../core/platform-registry';
import { warnIfIndexStale } from '../../core/index-guard';
import { resolveGlobalSpecPath, GLOBAL_SPECS_DIR, parsePlatformList } from '../../core/spec-paths';
import { buildAutoModeInstruction } from '../../core/questions';

/** 将名称转为目录安全的短 slug（2-4 词） */
function slugify(name: string): string {
  const cleaned = name
    .replace(/[\u4e00-\u9fff]/g, '') // 去掉中文
    .replace(/[^a-zA-Z0-9\s-]/g, '')  // 去特殊字符
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)                       // 最多 3 词
    .join('-')
    .toLowerCase();
  if (cleaned.length > 0) return cleaned;
  // 纯中文/空名称 → 生成短 hash 作为 slug（如 a3f2）
  const hash = Math.abs(name.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7)).toString(36);
  return hash.slice(0, 6);
}

/**
 * 生成子任务全局唯一 ID
 * 格式: Task-{父任务完整名}-{端名}-{hash4}
 * 例: Task-001-user-login-backend-a3f2, Task-001-user-login-web-b7c1
 */
function generateSubtaskId(parentTaskId: string, platform: string): string {
  // v6.49.5+：确定性格式 {taskId}-{platform}，保证全项目唯一
  // 因为每个任务每个端只有一个子任务，所以 {taskId}-{platform} 已经唯一
  return `Task-${parentTaskId}-${platform}`;
}

/** 粒度约束常量 */
const GRANULARITY_RULES = {
  macro:  { label: '粗粒度 (macro)', minHours: 20, maxHours: 80, maxApis: 15, maxTables: 5, maxPages: 5, desc: '每个任务 1-2 周，按业务方向合并' },
  module: { label: '中粒度 (module)', minHours: 12, maxHours: 40, maxApis: 8,  maxTables: 3, maxPages: 3, desc: '每个任务 3-5 天，按功能/端拆分' },
  atomic: { label: '细粒度 (atomic)', minHours: 4,  maxHours: 24, maxApis: 3,  maxTables: 2, maxPages: 1, desc: '每个任务 1-3 天，按接口/表拆分' },
} as const;
type Granularity = keyof typeof GRANULARITY_RULES;

/** 校验任务工时是否在粒度范围内（按单人 max 工时计算） */
function validateGranularity(gran: Granularity, hoursByPlatform: Record<string, number>, apiCount: number, tableCount: number) {
  const rule = GRANULARITY_RULES[gran];
  const warnings: string[] = [];
  const platformEntries = Object.entries(hoursByPlatform);
  const maxPerPerson = platformEntries.length > 0 ? Math.max(...platformEntries.map(([, h]) => h)) : 0;
  const totalHours = platformEntries.reduce((sum, [, h]) => sum + h, 0);
  const maxPlatform = platformEntries.length > 0 ? platformEntries.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : '';

  if (maxPerPerson > rule.maxHours) {
    warnings.push(`⚠️  单人最大工时 ${maxPerPerson}h（${maxPlatform}）超出上限 ${rule.maxHours}h → 建议再拆`);
  } else if (maxPerPerson < rule.minHours) {
    warnings.push(`⚠️  单人最大工时 ${maxPerPerson}h（${maxPlatform}）低于下限 ${rule.minHours}h → 建议合并到关联任务`);
  }
  if (apiCount > rule.maxApis) warnings.push(`⚠️  接口 ${apiCount} 个超出上限 ${rule.maxApis} → 建议按业务领域拆分`);
  if (tableCount > rule.maxTables) warnings.push(`⚠️  数据表 ${tableCount} 张超出上限 ${rule.maxTables} → 建议按数据层拆分`);

  // 返回额外信息供展示
  if (platformEntries.length > 1) {
    const breakdown = platformEntries.map(([p, h]) => `${p}:${h}h`).join(' + ');
    warnings.unshift(`ℹ️  工时分布: ${breakdown} = ${totalHours}h（max per person: ${maxPerPerson}h）`);
  }
  return warnings;
}

/** 根据团队规模推荐粒度 */
function recommendGranularity(teamSize: number): Granularity {
  if (teamSize <= 3) return 'macro';
  if (teamSize <= 8) return 'module';
  return 'atomic';
}

function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${question} `, answer => { rl.close(); resolve(answer.trim()); });
  });
}
export interface IterationSplitOptions {
  file?: string;
  iteration?: string;
  sections?: string;
  target?: string;
  dryRun?: boolean;
  interactive?: boolean;
  platforms?: string;
  strict?: boolean;
  owner?: string;
  prompt?: boolean;     // --prompt: 输出拆分 Prompt
  response?: string;    // --response: 接收 AI 拆分结果创建 Task 目录
  force?: boolean;
  granularity?: 'macro' | 'module' | 'atomic';  // 拆分粒度
}

async function detectPlatforms(iterationDir: string, specified?: string): Promise<string[]> {
  if (specified) return specified.split(',').map(p => p.trim()).filter(Boolean);
  
  // 1. 优先从 CONSTITUTION.md「端列表」章节读取（v6.46.0+ 显式声明）
  const platforms = await parsePlatformList();
  if (platforms.length > 0) return platforms;

  // 2. 回退：扫描 020-specs/ 子目录（排除 global/ 等非端目录）
  const specsDir = join(iterationDir, '020-specs');
  if (await pathExists(specsDir)) {
    const entries = await readdir(specsDir, { withFileTypes: true });
    const knownNonPlatformDirs = new Set(['sources', 'assets', 'prototypes', 'converted', 'features', 'bugs', 'refactors', 'research', 'staging', 'platforms', 'snapshots', GLOBAL_SPECS_DIR]);
    const platforms = entries
      .filter((e: any) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.') && !knownNonPlatformDirs.has(e.name))
      .map((e: any) => e.name);
    if (platforms.length > 0) return platforms;
  }
  
  return ['web']; // 默认
}

export async function iterationSplitCommand(options: IterationSplitOptions): Promise<void> {
  // ── Prompt 模式 ──
  if (options.prompt) {
    const iter = options.iteration || await getDefaultIteration() || '';
    const prompt = await buildPrompt('split', { iteration: iter });
    process.stdout.write(formatPrompt(prompt));
    process.exitCode = 10;
    return;
  }

  // ── Response 模式 ──
  if (options.response) {
    const iter = options.iteration || await getDefaultIteration() || '';
    if (!iter) { logger.error('--response 需要 --iteration'); return; }
    const iterDir = join('Iteration-' + iter, '030-tasks');
    await ensureDir(iterDir);
    const backups: string[] = [];
    // 尝试解析 AI 返回的 JSON Task 列表
    try {
      const tasks = JSON.parse(options.response);
      if (Array.isArray(tasks)) {
        // 获取迭代根目录（createTaskFromSection 需要迭代根路径）
        const iterDirFull = await getIterationDir(iter);
        const allPlatforms = await detectPlatforms(iterDirFull);
        const sections: Section[] = [];

        for (let i = 0; i < tasks.length; i++) {
          const task = tasks[i];

          // 📌 核心原则校验：同一功能单元内的任务是否应该合并
          // 如果 AI 把同一个功能单元拆成过多任务，给出警告
          if (i > 0) {
            const prevTask = tasks[i - 1];
            const sameUnit = (
              (task as any).functionalUnit && (prevTask as any).functionalUnit &&
              (task as any).functionalUnit === (prevTask as any).functionalUnit
            );
            if (sameUnit) {
              logger.warn(`   ⚠️  同一功能单元 "${(task as any).functionalUnit}" 已有多个任务：`);
              logger.warn(`      Task ${i}: ${prevTask.name}`);
              logger.warn(`      Task ${i + 1}: ${task.name}`);
              logger.warn(`      💡 建议：同一功能单元的不同子模块应该尽量合并为一个任务`);
            }
          }

          // 将 AI JSON 转换为 Section，复用 createTaskFromSection 创建完整目录
          const desc = task.description || task.name || '';
          const scopeArr = Array.isArray(task.scope) ? task.scope : [];
          const scope = scopeArr.join(', ');
          const apis = Array.isArray(task.apis) ? task.apis.join('\n') : '';
          const acs = Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria.join('\n') : '';

          let content = desc;
          if (scope) content += `\n\n范围: ${scope}`;
          if (apis) content += `\n\n接口:\n${apis}`;
          if (acs) content += `\n\n验收标准:\n${acs}`;

          // 从 scope 提取平台列表（后端 + 前端各端）
          const taskScopePlatforms: string[] = [];
          const isBackend = scopeArr.some((s: string) => /后端|backend/i.test(s));
          const fePlatforms = scopeArr.filter((s: string) => !/后端|backend/i.test(s)).map((s: string) => s.trim()).filter(Boolean);
          if (isBackend) taskScopePlatforms.push('backend');
          taskScopePlatforms.push(...fePlatforms);

          const section: Section = {
            name: task.name || `Task ${i + 1}`,
            content,
            level: 2,
            platform: isBackend ? 'backend' : (fePlatforms[0] || undefined),
          };
          (section as any)._complexity = {
            estimatedHours: task.estimatedHours || 8,
            hoursByPlatform: (task.hoursByPlatform && typeof task.hoursByPlatform === 'object') ? task.hoursByPlatform : {},
            priority: task.priority || 'medium',
            complexity: task.risk === 'high' ? 'high' : task.risk === 'low' ? 'low' : 'medium',
            apiCount: (task.apis || []).length,
            dbCount: (task.tables || []).length,
            pageCount: 0,
            wordCount: content.length,
          };
          (section as any)._owner = task.owner || '未分配';
          (section as any)._taskType = (task.type && ['feature', 'bugfix', 'refactor', 'research'].includes(task.type)) ? task.type : 'feature';
          // 保存 topic slug，用于生成任务目录名
          (section as any)._topic = task.topic || slugify(task.name || `Task ${i + 1}`);
          // 保存 AI 生成的实际内容（用于写入 REQ.md / TECH.md）
          if (task.reqContent) (section as any)._reqContent = task.reqContent;
          if (task.techContent) (section as any)._techContent = task.techContent;
          if (task.sourceFile) (section as any)._sourceFile = task.sourceFile;
          if (task.functionalUnit) (section as any).functionalUnit = task.functionalUnit;
          if (task.reason) (section as any)._reason = task.reason;
          if (taskScopePlatforms.length > 0) (section as any)._scopePlatforms = taskScopePlatforms;
          sections.push(section);
        }

        // 检测已有任务 + 冲突处理
        const existingTasks = await detectExistingTasks(iterDirFull);
        if (existingTasks.length > 0 && !options.force) {
          logger.warn(`   ⚠️  已有 ${existingTasks.length} 个任务: ${existingTasks.slice(0, 5).join(', ')}...`);
          logger.info('   使用 --force 强制覆盖');
          return;
        }

        // --force 清理旧任务（避免新旧叠加编号暴增）
        if (options.force) {
          const tasksRoot = join(iterDirFull, '030-tasks');
          if (await pathExists(tasksRoot)) {
            const entries = await readdir(tasksRoot, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isDirectory()) {
                await remove(join(tasksRoot, entry.name));
              }
            }
            logger.info(`   🗑  已清理旧任务目录`);
          }
        }

        // 确定粒度
        const staffing2 = readStaffing(iterDirFull);
        const teamSize2 = staffing2 ? staffing2.length : 0;
        const granularity: Granularity = (options.granularity as Granularity) || recommendGranularity(teamSize2);
        const granRule = GRANULARITY_RULES[granularity];
                
        // 🚨 全局任务数硬限制（安全网：防止 AI 输出爆炸）
        const MAX_TASKS_HARD = 20;
        if (sections.length > MAX_TASKS_HARD && !options.force) {
          logger.error(`\n   ❌ 任务数爆炸！AI 输出了 ${sections.length} 个任务（上限 ${MAX_TASKS_HARD}）`);
          logger.error(`   💡 这说明拆分粒度过细，必须合并。请告诉 AI："任务太多，请合并相关功能，总数控制在 ${MAX_TASKS_HARD} 以内"`);
          logger.error(`   🔧 如确实需要，使用 --force 跳过检查（不推荐）`);
          logger.info('\n   ℹ️  如需强制继续，添加 --force 参数');
          return;
        }
        if (sections.length > MAX_TASKS_HARD && options.force) {
          logger.warn(`   ⚠️  任务数 ${sections.length} 超出建议上限 ${MAX_TASKS_HARD}，--force 已启用，继续...`);
        }

        // 🚨 逐功能单元校验：每个功能单元拆出的任务数不超过 3 个
        const MAX_TASKS_PER_UNIT = 3;
        const unitTaskCount: Record<string, number> = {};
        let missingFunctionalUnit = 0;
                
        // 按 functionalUnit 分组统计（AI 在 JSON 中标注所属功能单元）
        for (let i = 0; i < sections.length; i++) {
          const task = tasks[i];
          const unitName = (task as any).functionalUnit;
          if (!unitName) {
            missingFunctionalUnit++;
            unitTaskCount['__missing__'] = (unitTaskCount['__missing__'] || 0) + 1;
          } else {
            unitTaskCount[unitName] = (unitTaskCount[unitName] || 0) + 1;
          }
        }

        // functionalUnit 缺失警告
        if (missingFunctionalUnit > sections.length * 0.5) {
          logger.warn(`   ⚠️  ${missingFunctionalUnit}/${sections.length} 个任务缺少 functionalUnit 字段`);
          logger.warn(`      💡 AI 未按约束填写功能单元，校验可能不准确`);
          logger.warn(`      💡 建议重新执行 split，确保 Prompt 包含 functionalUnit 要求`);
        }
                
        // 检查每个功能单元的任务数
        let hasOverSplit = false;
        for (const [unitName, count] of Object.entries(unitTaskCount)) {
          if (count > MAX_TASKS_PER_UNIT) {
            if (!hasOverSplit) {
              logger.error(`\n   ❌ 检测到过度拆分！某些功能单元拆出过多任务：`);
              hasOverSplit = true;
            }
            const displayName = unitName === '__missing__' ? '(未标注功能单元)' : unitName;
            logger.error(`      📌 "${displayName}" 拆出了 ${count} 个任务（上限 ${MAX_TASKS_PER_UNIT}）`);
          }
        }
                
        if (hasOverSplit) {
          logger.error(`   💡 核心原则：一个功能单元默认 1 个任务，最多 3 个`);
          logger.error(`   🔧 建议操作：`);
          logger.error(`      1. 重新执行 split，并告诉 AI："任务太多，请合并相关功能"`);
          logger.error(`      2. 或者手动编辑 .speccore/prompts/split-suggestion-${iter}.md，明确要求"每个功能单元最多拆 2 个任务"`);
          logger.error(`      3. 如果确实需要这么多任务，使用 --force 跳过检查（不推荐）`);
          if (!options.force) {
            logger.info('\n   ℹ️  如需强制继续，添加 --force 参数');
            return;
          }
          logger.warn('   ⚠️  --force 已启用，继续创建所有任务...');
        }

        // 交互模式判断：显式 --interactive 或 stdin 是 TTY（--force 时跳过交互，直接执行）
        const isInteractive = (options.interactive || process.stdin.isTTY) && !options.force;
        logger.info(`   📏 粒度: ${granRule.label}${options.granularity ? ' (用户指定)' : ` (${teamSize2} 人团队自动推荐)`}`);

        // 非交互模式：显示任务总览摘要
        if (!isInteractive) {
          logger.info(`\n   📋 任务总览（共 ${sections.length} 个）：`);
          const unitSummary: Record<string, string[]> = {};
          for (let i = 0; i < tasks.length; i++) {
            const unit = (tasks[i] as any).functionalUnit || '(未标注)';
            if (!unitSummary[unit]) unitSummary[unit] = [];
            unitSummary[unit].push(tasks[i].name || `Task ${i + 1}`);
          }
          for (const [unit, names] of Object.entries(unitSummary)) {
            logger.info(`      📌 ${unit} (${names.length} 个):`);
            for (const n of names) logger.info(`         - ${n}`);
          }
          logger.info('');
        }

        // 逐任务交互确认
        const createdSections: Section[] = [];
        for (let i = 0; i < sections.length; i++) {
          const sec = sections[i];
          const complexity = (sec as any)._complexity || {};
          const taskType = (sec as any)._taskType || 'feature';
          const deps = (tasks[i].dependencies || []) as string[];
          const acs = (tasks[i].acceptanceCriteria || []) as string[];

          // 展示任务摘要
          logger.info(`\n   ━━━━ 任务 ${i + 1}/${sections.length} ━━━━`);
          logger.info(`   📌 ${sec.name}`);
          logger.info(`   🏷  类型: ${taskType} | 🎯 优先级: ${complexity.priority || 'medium'}`);
          // 按端展示工时分布
          const hbp = complexity.hoursByPlatform || {};
          const hbpEntries = Object.entries(hbp);
          if (hbpEntries.length > 0) {
            const breakdown = hbpEntries.map(([p, h]) => `${p}:${h}h`).join(' + ');
            const maxPerPerson = Math.max(...hbpEntries.map(([, h]) => h as number));
            logger.info(`   ⏱ 工时: ${breakdown} = ${complexity.estimatedHours}h（max per person: ${maxPerPerson}h）`);
          } else {
            logger.info(`   ⏱ 预估: ${complexity.estimatedHours}h`);
          }
          if (complexity.apiCount) logger.info(`   🔌 接口: ${complexity.apiCount} 个 | 🗄 数据表: ${complexity.dbCount || 0} 张`);
          if (deps.length > 0) logger.info(`   🔗 依赖: ${deps.join(', ')}`);
          if (acs.length > 0) {
            logger.info(`   ✅ 验收标准:`);
            for (const ac of acs.slice(0, 5)) logger.info(`      ${ac}`);
          }

          // 粒度校验（按单人 max 工时）
          const warnings = validateGranularity(granularity, hbp, complexity.apiCount || 0, complexity.dbCount || 0);
          if (warnings.length > 0) {
            for (const w of warnings) {
              if (w.startsWith('ℹ️')) logger.info(`   ${w}`);
              else logger.warn(`   ${w}`);
            }
          }

          // 交互确认（仅确认，调整应回到 AI 对话重新生成方案）
          if (isInteractive) {
            const answer = await promptUser(`   确认创建？(y/回车确认，n 调整方案):`);
            if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
              logger.info(`   💡 如需调整，请告诉 AI：`);
              logger.info(`      "把 XX 和 YY 合为一个任务" / "ZZ 任务太大，拆成两个" / "修改工时为 Xh"`);
              logger.info(`      AI 会参考 .speccore/prompts/split-suggestion-${iter}.md 中的规则重新生成`);
              logger.info(`      调整后再次执行本命令即可`);
              return;
            }
          }

          // 使用保存的 topic slug 生成任务ID
          const taskTopic = (sec as any)._topic || slugify(sec.name);
          const { id: taskId } = await nextTaskId(sec.name, taskTopic);
          (sec as any)._taskId = taskId;
          await createTaskFromSection(iterDirFull, taskId, sec, allPlatforms, taskType, sections);
          createdSections.push(sec);
          logger.info(`   ✅ 创建: ${taskId} - [${taskType}] ${sec.name}`);
        }

        if (createdSections.length > 0) {
          await generateImpactGraph(iterDirFull, createdSections, allPlatforms);
          await updateProjectGraph(iterDirFull, createdSections);
          // 生成任务总览报告 → 000-overview/TASK_SUMMARY.md
          const summaryMd = await generateTaskSummary(iterDirFull, tasks, createdSections);
          logger.info(`   📊 任务总览 → 000-overview/task-summaries/TASK_SUMMARY-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16)}.md`);
          // 输出报告到 stdout，供宿主 AI 展示给用户
          process.stdout.write('\n[SPECCORE_TASK_SUMMARY]\n');
          process.stdout.write(summaryMd);
          process.stdout.write('\n[/SPECCORE_TASK_SUMMARY]\n');
          // 输出下一步操作标记：引导宿主 AI 对每个 Task 执行 analyze --task
          outputAnalyzeTaskHints(iter, createdSections);
        }
        logger.success(`✅ 创建了 ${createdSections.length}/${sections.length} 个任务（${sections.length - createdSections.length} 个跳过）`);
      } else {
        logger.warn('AI 返回格式非数组，将作为 Markdown 写入 REQUIREMENT.md');
        const reqPath = join(iterDir, 'REQUIREMENT.md');
        const bk = await backupWithTimestamp(reqPath);
        if (bk) {
          backups.push(bk);
          logger.info(`   📦 旧版已备份: ${bk.split('/').pop()}`);
        }
        await writeFile(reqPath, options.response);
      }
    } catch {
      const reqPath = join(iterDir, 'REQUIREMENT.md');
      const bk = await backupWithTimestamp(reqPath);
      if (bk) {
        backups.push(bk);
        logger.info(`   📦 旧版已备份: ${bk.split('/').pop()}`);
      }
      await writeFile(reqPath, options.response);
    }
    logger.success('✅ 任务已创建');
    
    // 备份汇总
    if (backups.length > 0) {
      logger.info('');
      logger.info(`📦 备份文件 (${backups.length} 个):`);
      for (const bp of backups) {
        logger.info(`   ${bp}`);
      }
      logger.info('   💡 如不再需要可手动删除');
    }

    // 自动刷新知识图谱（v6.49.10+）
    try {
      const { refreshKnowledgeGraph } = await import('../../core/knowledge-graph');
      await refreshKnowledgeGraph(process.cwd(), iter);
      logger.info('🧠 知识图谱已刷新');
    } catch {}
    return;
  }

  // 命令前索引新鲜度检查（非阻塞）
  await warnIfIndexStale(process.cwd(), 'split', options.iteration);

  const spinner = new Spinner('Splitting requirements into tasks');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('No active iteration found. Please specify --iteration or create one first.');
      return;
    }

    const iterationDir = await getIterationDir(iteration);

    // ── v6.49.13+: 模块驱动拆分 — CLI 按功能模块×端创建任务目录，AI 只填充内容 ──
    if (!options.prompt && !options.response) {
      const moduleDrivenResult = await tryModuleDrivenSplit(iteration, iterationDir, options);
      if (moduleDrivenResult) {
        return;
      }
    }

    // ── 1. 检查 ANALYSIS.md + AI 智能拆分建议 ──
    const analysisPath = join(iterationDir, '020-specs', 'ANALYSIS.md');
    if (await pathExists(analysisPath)) {
      const analysis = await readFile(analysisPath, 'utf-8');
      const blockerLines = analysis.split('\n').filter(l => 
        l.includes('🔴') || l.includes('🚫') || l.toLowerCase().includes('blocker')
      );
      
      if (blockerLines.length > 0) {
        spinner.stop();
        logger.warn(`\n⚠️  ANALYSIS.md 检测到 ${blockerLines.length} 个阻断项:`);
        for (const line of blockerLines.slice(0, 5)) {
          logger.warn(`   ${line.trim().slice(0, 80)}`);
        }
        // 自动模式不询问用户，直接继续；交互模式才确认
        if (options.interactive || options.strict) {
          const proceed = await promptUser('\n仍要继续拆分？[y/N] ');
          if (!proceed || proceed.toLowerCase() !== 'y') {
            logger.info('已取消拆分');
            return;
          }
        } else {
          logger.info('   ℹ️  自动模式：跳过阻断项确认，继续拆分（疑问记录到 .speccore/questions/）');
        }
        spinner.start();
      }
      
      // 生成 AI 智能拆分上下文（含完整 Spec 上下文 + 粒度规则）
      const promptsDir = join('.speccore', 'prompts');
      await ensureDir(promptsDir);
      
      // 读取 CONSTITUTION.md（技术宪法）
      const constitutionPath = join('.speccore', 'CONSTITUTION.md');
      let constitutionContent = '';
      if (await pathExists(constitutionPath)) {
        constitutionContent = await readFile(constitutionPath, 'utf-8');
      }
      
      // 读取 020-specs/ 全部文件（完整上下文）
      const specDir2 = join(iterationDir, '020-specs');
      // REQUIREMENT.md 优先从 global/ 读取（v6.41.0+），回退根目录
      const reqPath2 = await resolveGlobalSpecPath(specDir2, 'REQUIREMENT.md') || join(iterationDir, '020-specs', 'REQUIREMENT.md');
      let reqContent2 = '';
      if (await pathExists(reqPath2)) {
        reqContent2 = await readFile(reqPath2, 'utf-8');
      }
            
      const specContents: { name: string; content: string }[] = [];
      // 读取全局层文档（优先 global/ 子目录，回退根目录 — v6.41.0+ 向后兼容）
      for (const f of ['ANALYSIS.md', 'TECH.md', 'RISK.md', 'DEPS.md', 'REVIEW.md', 'MONITOR.md', 'REQUIREMENT.md']) {
        const resolved = await resolveGlobalSpecPath(specDir2, f);
        if (resolved) {
          const content = await readFile(resolved, 'utf-8');
          if (content.trim().length > 50 && !content.trim().match(/^#+\s*待填充|^<!--\s*AI-FILL/m)) {
            specContents.push({ name: f, content });
          }
        }
      }
      // 根目录下的 TEST.md、UI_SPEC.md（端无关模板/回退）
      for (const f of ['TEST.md', 'UI_SPEC.md']) {
        const fp = join(specDir2, f);
        if (await pathExists(fp)) {
          const content = await readFile(fp, 'utf-8');
          if (content.trim().length > 50 && !content.trim().match(/^#+\s*待填充|^<!--\s*AI-FILL/m)) {
            specContents.push({ name: f, content });
          }
        }
      }
      // 读取各端详情（020-specs/{端}/，兼容旧路径 020-specs/platforms/{端}/）
      const platformDirs: string[] = [];
      // 新路径：020-specs/{端}/
      const directPlatformEntries = await readdir(specDir2, { withFileTypes: true });
      for (const e of directPlatformEntries) {
        if (e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.')
          && !['sources', 'assets', 'prototypes', 'converted', 'features', 'bugs', 'refactors', 'research', 'staging', 'platforms', 'snapshots', GLOBAL_SPECS_DIR].includes(e.name)) {
          platformDirs.push(e.name);
        }
      }
      // 旧路径回退：020-specs/platforms/{端}/
      const iterPlatformsDir = join(specDir2, 'platforms');
      if (await pathExists(iterPlatformsDir)) {
        const platformEntries = await readdir(iterPlatformsDir, { withFileTypes: true });
        for (const pe of platformEntries) {
          if (pe.isDirectory() && !pe.name.startsWith('.') && !platformDirs.includes(pe.name)) {
            platformDirs.push(pe.name);
          }
        }
      }
      // 读取每个端目录下的文件
      for (const pName of platformDirs) {
        const pDir = join(specDir2, pName);
        if (!(await pathExists(pDir))) continue;
        const pFiles = await readdir(pDir);
        for (const pf of pFiles.filter((f: string) => f.endsWith('.md'))) {
          const fp = join(pDir, pf);
          const content = await readFile(fp, 'utf-8');
          if (content.trim().length > 50 && !content.trim().match(/^#+\s*\u5f85\u586b\u5145|^<!--\s*AI-FILL/m)) {
            specContents.push({ name: `${pName}/${pf}`, content });
          }
        }
      }
      // 读取功能模块分析（020-specs/features/）
      const iterFeaturesDir = join(specDir2, 'features');
      if (await pathExists(iterFeaturesDir)) {
        const featureEntries = await readdir(iterFeaturesDir, { withFileTypes: true });
        for (const fe of featureEntries) {
          if (!fe.name.startsWith('.') && fe.name.endsWith('.md')) {
            const fp = join(iterFeaturesDir, fe.name);
            const content = await readFile(fp, 'utf-8');
            if (content.trim().length > 50 && !content.trim().match(/^#+\s*\u5f85\u586b\u5145|^<!--\s*AI-FILL/m)) {
              specContents.push({ name: `features/${fe.name}`, content });
            }
          }
        }
      }
      // 读取类型文档分析（020-specs/{bugs,refactors,research}/）
      for (const typeDir of ['bugs', 'refactors', 'research']) {
        const typeDirPath = join(specDir2, typeDir);
        if (!(await pathExists(typeDirPath))) continue;
        const typeEntries = await readdir(typeDirPath, { withFileTypes: true });
        for (const te of typeEntries) {
          if (!te.isFile() || !te.name.endsWith('.md')) continue;
          const fp = join(typeDirPath, te.name);
          const content = await readFile(fp, 'utf-8');
          if (content.trim().length > 50 && !content.trim().match(/^#+\s*\u5f85\u586b\u5145|^<!--\s*AI-FILL/m)) {
            specContents.push({ name: `${typeDir}/${te.name}`, content });
          }
        }
      }
      
      // 粒度推荐（基于 STAFFING 人数）
      const staffing = readStaffing(iterationDir);
      const teamSize = staffing ? staffing.length : 0;
      const recommendedGranularity: Granularity = (options.granularity as Granularity) || recommendGranularity(teamSize);
      const granularityLabel = GRANULARITY_RULES[recommendedGranularity].label;
      const granularityHint = GRANULARITY_RULES[recommendedGranularity].desc;
      
      // 构建完整 prompt
      let splitPrompt = buildSplitPrompt(iteration, constitutionContent, reqContent2, specContents, staffing, teamSize, granularityLabel, granularityHint);

      // 注入全局上下文（INDEX + TOC 目录，AI 自主读取）
      const { loadGlobalContext, formatGlobalContext } = await import('../../core/prompt-builder');
      const globalCtx = await loadGlobalContext(process.cwd(), 'split');
      if (globalCtx.indexSummary || globalCtx.toc.length > 0) {
        splitPrompt += '\n' + formatGlobalContext(globalCtx) + '\n';
      }
      
      await writeFile(join(promptsDir, `split-suggestion-${iteration}.md`), splitPrompt);
      logger.info(`   🤖 AI 拆分建议 → .speccore/prompts/split-suggestion-${iteration}.md`);
      logger.info(`   📏 推荐粒度: ${granularityLabel}${options.granularity ? ' (用户指定)' : ` (基于 ${teamSize} 人团队自动推荐)`}`);
      logger.info(`   📜 上下文: CONSTITUTION + REQUIREMENT + ${specContents.length} 个 Spec 文档`);
    } else {
      logger.info('   ℹ️ 未找到 ANALYSIS.md，建议先运行 speccore analyze');
    }

    const reqFile = join(iterationDir, '020-specs', options.file || 'REQUIREMENT.md');

    if (!(await pathExists(reqFile))) {
      spinner.fail(`Requirement file not found: ${reqFile}`);
      return;
    }

    const content = await readFile(reqFile, 'utf-8');
    const sections = extractSections(content, options.sections);

    if (sections.length === 0) {
      spinner.fail('No sections found to split');
      return;
    }

    const platforms = await detectPlatforms(iterationDir, options.platforms);

    // ── 冲突检测: 检查是否已有 Task 目录 ──
    const existingTasks = await detectExistingTasks(iterationDir);
    if (existingTasks.length > 0 && !options.force) {
      spinner.stop();
      logger.warn(`\n⚠️  检测到已有 ${existingTasks.length} 个任务: ${existingTasks.slice(0,5).join(', ')}${existingTasks.length > 5 ? '...' : ''}`);
      logger.info('   重新 split 会覆盖 TASK.md 中的进度和状态。');
      logger.info('   使用 --force 强制覆盖，或手动删除不需要的任务。\n');
      return;
    }

    // ── 智能分析: 复杂度 + 优先级 + 工时 ──
    const complexities = sections.map(s => estimateSectionComplexity(s));
    for (let i = 0; i < sections.length; i++) {
      (sections[i] as any)._complexity = complexities[i];
    }

    // ── STAFFING 人员排期 ──
    const staffing = readStaffing(iterationDir);
    if (staffing) {
      logger.info(`   👥 STAFFING: ${staffing.map(m => `${m.name}(${m.platforms.join(',')})`).join(', ')}`);
      for (const section of sections) {
        if (!(section as any)._owner) {
          (section as any)._owner = autoAssign(section, platforms, staffing);
        }
      }
    } else {
      logger.info('   ℹ️ 未找到 STAFFING.md，人员分配默认为"未分配"');
    }

    logger.info(`Found ${sections.length} sections to split`);
    logger.info(`Platforms: ${platforms.join(', ')}`);

    // ── 预分配任务 ID（确保所有路径使用计数器，避免编号重复） ──
    for (const section of sections) {
      const topic = slugify(section.name);
      const { id: taskId } = await nextTaskId(section.name, topic);
      (section as any)._taskId = taskId;
    }

    // ── Strict mode: preview + confirm each task's split plan ──
    if (options.strict) {
      const approved = await strictSplitPreview(sections, platforms, iterationDir);
      if (approved.length === 0) {
        spinner.stop('已取消，未创建任何任务');
        return;
      }
      for (const section of approved) {
        const taskId = (section as any)._taskId;
        await createTaskFromSection(iterationDir, taskId, section, platforms, (section as any)._taskType, approved);
      }
      spinner.stop(`✅ 创建了 ${approved.length} 个任务`);
      // 自动刷新知识图谱（v6.49.10+）
      try {
        const { refreshKnowledgeGraph } = await import('../../core/knowledge-graph');
        await refreshKnowledgeGraph(process.cwd(), iteration);
        logger.info('🧠 知识图谱已刷新');
      } catch {}
      return;
    }

    if (options.dryRun) {
      spinner.stop('Dry run complete - no files created');
      for (const section of sections) {
        logger.info(`  Would create: ${section.name}`);
      }
      return;
    }

    // ── Interactive mode: preview → adjust → confirm → create ──
    if (options.interactive) {
      spinner.stop('任务预览');
      logger.info('');
      
      // 依赖关系预览
      const semanticDeps = detectSemanticDependencies(sections);
      if (semanticDeps.size > 0) {
        logger.info('🔗 任务间依赖关系:\n');
        for (const [from, targets] of semanticDeps) {
          logger.info(`   ${from} 依赖 → ${targets.join(', ')}`);
        }
        logger.info('');
      }
      
      logger.info(`📋 共 ${sections.length} 个任务将被创建:\n`);

      for (let i = 0; i < sections.length; i++) {
        const taskId = (sections[i] as any)._taskId;
        const contentPreview = sections[i].content?.split('\n')[0]?.slice(0, 60) || '';
        const c = complexities[i];
        const owner = (sections[i] as any)._owner || '未分配';
        const deps = semanticDeps.get(taskId);
        
        logger.info(`  ${taskId} → ${sections[i].name}`);
        if (contentPreview) logger.info(`       ${contentPreview}`);
        logger.info(`       优先级: ${c.priority} | 工时: ${c.estimatedHours}h | 复杂度: ${c.complexity} | 👤 ${owner}`);
        if (deps) logger.info(`       🔗 依赖: ${deps.join(', ')}`);
        logger.info(`       平台: ${platforms.join(', ')}`);
        logger.info('');
      }

      logger.info('💡 你可以：');
      logger.info('  [y] 确认创建全部  [n] 逐一确认  [q] 取消');
      logger.info('');

      const answer = await promptUser('确认创建？');
      if (answer?.toLowerCase() === 'q') {
        logger.info('已取消');
        return;
      }
      if (answer?.toLowerCase() === 'n') {
        logger.info('进入逐一确认模式...');
        let created = 0;
        for (let i = 0; i < sections.length; i++) {
          const taskId = (sections[i] as any)._taskId;
          const resp = await promptUser(`  创建 ${taskId} - ${sections[i].name}? [y/n/q]`);
          if (resp?.toLowerCase() === 'q') {
            logger.info(`已取消，剩余 ${sections.length - i} 个任务未创建`);
            break;
          }
          if (resp?.toLowerCase() === 'y' || resp === '') {
            await createTaskFromSection(iterationDir, taskId, sections[i], platforms, (sections[i] as any)._taskType, sections);
            created++;
            logger.info(`    ✅ ${taskId}`);
          } else {
            logger.info(`    ⏭️  跳过 ${sections[i].name}`);
          }
        }
        spinner.stop(`创建了 ${created}/${sections.length} 个任务`);
        if (created > 0) {
          await generateImpactGraph(iterationDir, sections.slice(0, created), platforms);
          await updateProjectGraph(iterationDir, sections.slice(0, created));
          // 自动刷新知识图谱（v6.49.10+）
          try {
            const { refreshKnowledgeGraph } = await import('../../core/knowledge-graph');
            await refreshKnowledgeGraph(process.cwd(), iteration);
            logger.info('🧠 知识图谱已刷新');
          } catch {}
        }
        return;
      }

      // Default: create all
      for (let i = 0; i < sections.length; i++) {
        const taskId = (sections[i] as any)._taskId;
        await createTaskFromSection(iterationDir, taskId, sections[i], platforms, (sections[i] as any)._taskType, sections);
      }
      await generateImpactGraph(iterationDir, sections, platforms);
      await generateEnvExample(iterationDir, sections);
      await updateProjectGraph(iterationDir, sections);
      spinner.stop(`✅ 创建了 ${sections.length} 个任务`);
      showNextSteps('split');
      // 自动刷新知识图谱（v6.49.10+）
      try {
        const { refreshKnowledgeGraph } = await import('../../core/knowledge-graph');
        await refreshKnowledgeGraph(process.cwd(), iteration);
        logger.info('🧠 知识图谱已刷新');
      } catch {}
      return;
    }

    // Create tasks（使用预分配的 ID）
    for (let i = 0; i < sections.length; i++) {
      const taskId = (sections[i] as any)._taskId;
      await createTaskFromSection(iterationDir, taskId, sections[i], platforms, (sections[i] as any)._taskType, sections);
    }

    // ── Generate impact graph + risk scores ──
    await generateImpactGraph(iterationDir, sections, platforms);

    // ── Generate .env.example for the iteration ──
    await generateEnvExample(iterationDir, sections);

    // Update PROJECT_GRAPH.md
    await updateProjectGraph(iterationDir, sections);

    // 生成任务总览报告
    const summaryMd = await generateTaskSummary(iterationDir, [], sections);
    logger.info(`📊 任务总览 → 000-overview/task-summaries/`);

    spinner.stop(`Created ${sections.length} tasks from requirements`);
    
    showNextSteps('split');

    // 自动刷新知识图谱（v6.49.10+）
    try {
      const { refreshKnowledgeGraph } = await import('../../core/knowledge-graph');
      await refreshKnowledgeGraph(process.cwd(), iteration);
      logger.info('🧠 知识图谱已刷新');
    } catch {}
  } catch (error) {
    spinner.fail(`Split failed: ${error}`);
    throw error;
  }
}

interface Section {
  name: string;
  content: string;
  level: number;
  platform?: string;  // 继承自 "## {X}端需求" 父章节
}

function extractSections(content: string, sectionFilter?: string): Section[] {
  const sections: Section[] = [];
  let currentPlatform: string | undefined;
  const lines = content.split('\n');
  
  let currentSection: Section | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^(#{2,4})\s+(.+)/);
    if (headerMatch) {
      if (currentSection) {
        currentSection.content = currentContent.join('\n');
        sections.push(currentSection);
      }
      currentSection = {
        name: headerMatch[2].trim(),
        content: '',
        level: headerMatch[1].length
      };
      
      // 检测 "## {X}端需求" 父章节，子章节继承此平台
      const platformMatch = currentSection.name.match(/^(.+)端需求$/);
      if (platformMatch) {
        currentPlatform = platformMatch[1];
        currentSection = null; // 容器章节本身不作为 Task
        continue;
      } else if (currentSection.level === 2) {
        currentPlatform = undefined; // 新的 ## 章节重置平台
      }
      currentSection.platform = currentPlatform;
      while (/端端/.test(currentSection.name)) currentSection.name = currentSection.name.replace('端端', '端');
      
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }

  if (currentSection) {
    currentSection.content = currentContent.join('\n');
    sections.push(currentSection);
  }

  // Filter sections if specified
  if (sectionFilter) {
    return sections.filter(s => {
      const filters = sectionFilter.split(',').map(f => f.trim());
      return filters.some(f => s.name.includes(f));
    });
  }

  // Filter template noise: skip empty/template placeholder sections
  return filterTemplateNoise(sections);
}

const TEMPLATE_PATTERNS = [
  // Section types that should NOT become separate tasks
  /^\d+\.\d+\s*(背景|目标|范围)\s*$/,
  /^\d+\.\d+\s*(性能|安全|兼容性)\s*$/,
  /^\d+\.\s*(需求概述|功能需求|非功能需求|验收标准|附录)\s*$/,
  /^功能模块[一二三四五]\s*$/,
  // Structural PRD headings (not functional requirements)
  /^功能优先级$/,
  /^范围边界$/,
  /^依赖关系$/,
  /^术语表$/,
  /^业务规则$/,
  /^非功能要求?$/,
  /^原型参考$/,
  /^版本历史$/,
  /^项目概述$/,
  /^BDD 验收标准$/,
  // 背景/概述/架构类（非功能内容）
  /项目背景/,
  /项目目标/,
  /系统概述/,
  /系统架构/,
  /技术架构/,
  /整体架构/,
  /名词解释/,
  /术语定义/,
  /参考文献/,
  /修订记录/,
  /变更历史/,
  /文档说明/,
  /编写说明/,
  /阅读指南/,
  /目录$/,
  // 抽象约束类（不是具体功能）
  /^约束条件$/,
  /^假设条件$/,
  /^设计原则$/,
  /^总体目标$/,
  /^建设目标$/,
  /^业务背景$/,
  /^技术背景$/,
];

function filterTemplateNoise(sections: Section[]): Section[] {
  return sections.filter(s => {
    // Skip sections matching template patterns
    for (const pattern of TEMPLATE_PATTERNS) {
      if (pattern.test(s.name)) return false;
    }
    // Skip sections with effectively empty content (< 20 meaningful chars = no real substance)
    const meaningful = (s.content || '').replace(/[\s\n>#*-|]/g, '').length;
    if (meaningful < 20) return false;
    // Skip sections without API tables (structural headings)
    return true;
  });
}

async function createTaskFromSection(iterationDir: string, taskId: string, section: Section, allPlatforms: string[], taskType: string = 'feature', allSections?: Section[]): Promise<void> {
  // taskId 已含 slug（nextTaskId 返回 Task-NNN-slug），直接用
  const taskDir = join(iterationDir, '030-tasks', taskType, taskId);
  
  // 确定任务涉及的端：优先使用 AI 标注的 _scopePlatforms，否则从 020-specs/{端}/TECH.md 是否存在且有内容来推断
  let taskPlatforms: string[];
  if ((section as any)._scopePlatforms && (section as any)._scopePlatforms.length > 0) {
    taskPlatforms = (section as any)._scopePlatforms;
  } else if (section.platform) {
    taskPlatforms = [section.platform];
  } else {
    // 从 020-specs/{端}/TECH.md 推断：文件存在且有实质内容才认为涉及该端
    const specsBase = join(iterationDir, '020-specs');
    taskPlatforms = [];
    for (const platform of allPlatforms) {
      const techPath = join(specsBase, platform, 'TECH.md');
      if (await pathExists(techPath)) {
        const content = await readFile(techPath, 'utf-8');
        // 简单判断：移除模板占位符后长度 > 50 认为有实质内容
        const meaningful = content
          .replace(/_待填充_|_待补充_|_待 AI 分析_|_待定_|_待导入_/g, '')
          .replace(/\|\s*:---[\s|:-]*\|/g, '')
          .replace(/\|\s*\|\s*\|/g, '')
          .replace(/^#+\s.*$/gm, '')
          .replace(/^>.*$/gm, '')
          .replace(/\s/g, '')
          .trim().length;
        if (meaningful > 50) {
          taskPlatforms.push(platform);
        }
      }
    }
    // 如果都没检测到，回退到所有端
    if (taskPlatforms.length === 0) {
      taskPlatforms = allPlatforms;
    }
  }
  
  const complexity = (section as any)._complexity as SectionComplexity || { estimatedHours: 2, priority: 'medium' as const, complexity: 'medium' as const, apiCount: 0, dbCount: 0, pageCount: 0, wordCount: 0 };
  const owner = (section as any)._owner || '未分配';
  const today = new Date().toISOString().split('T')[0];

  // 加载迭代级 analyze 产出（020-specs/），用于填充任务级文件
  const specContents = await loadSpecContents(iterationDir);

  // 预生成所有端的子任务 ID（保证同一端在所有文件中 ID 一致）
  const taskNum = taskId.replace(/^Task-/, '');
  const subtaskIdMap = new Map<string, string>();
  for (const p of taskPlatforms) {
    subtaskIdMap.set(p, generateSubtaskId(taskNum, p));
  }



  // ── 1. 任务目录指引（功能模块分组） ──
  const isResearch = taskType === 'research';
  await writeFile(
    join(taskDir, 'README.md'),
    isResearch
      ? `# ${section.name}

> 技术调研任务 — 产出调研文档，不产出代码

## 目录结构

\`\`\`
${taskId}/
├── .meta/                 ← 任务元信息（feature/type/status/owner）
├── README.md              ← 本文件（调研任务说明）
├── _shared/               ← 共享上下文（CONTEXT.md）
├── 00-specs/              ← 核心规格（REQ.md/TECH.md）
├── RESEARCH.md            ← 调研报告
├── COMPARISON.md          ← 方案对比
└── .issues.md             ← 问题追踪
\`\`\`

## AI 执行时读取规则

运行 \`speccore execute -t ${taskId}\` 时:
- 读取 \`00-specs/REQ.md\` — 调研目标
- 读取 \`_shared/CONTEXT.md\` — 任务上下文
- 产出写入 \`RESEARCH.md\` 和 \`COMPARISON.md\`
`
      : `# ${section.name}

> 功能模块分组 — 聚合相关子任务，共享规格与契约

## 目录结构

\`\`\`
${taskId}/
├── .meta/                     ← 任务元信息（feature/type/status/owner）
├── README.md                  ← 本文件
├── _shared/                   ← 共享契约（API_CONTRACT.yaml + CONTEXT.md）
├── 00-specs/                  ← 模块级核心规格（REQ/TECH/SCHEMA/CHANGELOG）
├── {服务名}/                  ← 后端服务（如 booking-service，v6.49.3+ 平铺架构）
│   └── {taskId}-{子任务}/     ← 执行单元（.meta/TASK.md/src/tests + 产出）
├── {端名}/                    ← 前端端（如 h5-mobile/admin-web，v6.49.3+ 平铺架构）
│   └── {taskId}-{子任务}/     ← 执行单元（.meta/TASK.md/src/tests + 前端设计 + 产出）
\`\`\`

## 子任务列表

| 子任务 ID | 所属端/服务 | 负责人 | 状态 |
| :--- | :--- | :--- | :--- |
${taskPlatforms.map((p: string) => `| ${subtaskIdMap.get(p)} | ${p} | ${owner} | 🔲 待开发 |`).join('\n')}

## AI 执行时读取规则

运行 \`speccore execute -t ${taskId} --platform {端}\` 时:

### 必读（自动嵌入）
- \`00-specs/REQ.md\` — 模块需求描述
- \`00-specs/TECH.md\` — 模块技术方案
- \`_shared/CONTEXT.md\` — 任务上下文（来源 + 关联）
- \`_shared/API_CONTRACT.yaml\` — API 契约
- \`{platform}/{子任务}/TASK.md\` — 子任务详情
- \`.meta/type\` + \`.meta/status\` — 子任务元信息

### 参考（按需读取）
- \`020-specs/\` 下的迭代全局文档
- \`.speccore/GLOBAL/\` 下的全局知识库

### 不会被读取
- \`{子任务}/src/\` 和 \`{子任务}/tests/\` — AI **输出**代码的地方
- \`{子任务}/TEST.md\` 等执行产出 — 执行完成后自动更新
`
  );

  // ── 3. 任务级 .meta/（功能单元标识）+ 共享契约 + 核心规格目录 ──
  await ensureDir(join(taskDir, '.meta'));
  const taskFeatureName = (section as any).functionalUnit || section.name || '未分类';
  await writeFile(join(taskDir, '.meta', 'feature'), taskFeatureName);
  await writeFile(join(taskDir, '.meta', 'type'), taskType);
  await writeFile(join(taskDir, '.meta', 'status'), 'todo');
  await writeFile(join(taskDir, '.meta', 'owner'), owner);
  await writeFile(join(taskDir, '.meta', 'created-at'), today);

  await ensureDir(join(taskDir, '_shared'));
  await ensureDir(join(taskDir, '00-specs'));
  const contractYaml = generateApiContract(section);
  if (contractYaml) {
    await writeFile(join(taskDir, '_shared', 'API_CONTRACT.yaml'), contractYaml);
  }

  // ── 4. 核心规格写入 00-specs/（REQ/TECH/SCHEMA/CHANGELOG） ──

  const acItems = generateAcceptanceCriteria(section);
  const aiReqContent = (section as any)._reqContent;
  // REQ.md: 优先用 AI 生成的实际内容，回退到模板
  if (aiReqContent && aiReqContent.length > 50) {
    await writeFile(
      join(taskDir, '00-specs', 'REQ.md'),
      `# ${section.name}\n\n${aiReqContent}\n\n## 验收标准\n\n${acItems}\n`
    );
  } else {
    await writeFile(
      join(taskDir, '00-specs', 'REQ.md'),
      `# ${section.name}\n\n## 需求描述\n\n${section.content}\n\n## 验收标准\n\n${acItems}\n`
    );
  }

  const apiLines = section.content.split('\n').filter(l => l.includes('| GET') || l.includes('| POST') || l.includes('| PUT') || l.includes('| DELETE') || l.includes('| PATCH'));
  const apiDesc = apiLines.length > 0 ? apiLines.map(l => `- ${l.trim()}`).join('\n') : '- 待补充（从 REQ.md 提取接口列表）';
  const aiTechContent = (section as any)._techContent;
  // 从 analyze TECH.md 提取本任务相关内容
  const specTechContent = extractTaskTechContent(specContents, section);
  // TECH.md: 优先 AI 生成 → 回退 analyze 提取 → 回退模板
  if (aiTechContent && aiTechContent.length > 50) {
    await writeFile(
      join(taskDir, '00-specs', 'TECH.md'),
      `# ${section.name} - 技术方案\n\n${aiTechContent}\n`
    );
  } else if (specTechContent && specTechContent.length > 30) {
    await writeFile(
      join(taskDir, '00-specs', 'TECH.md'),
      `# ${section.name} - 技术方案\n\n> 来源: analyze → TECH.md（自动提取）\n\n${specTechContent}\n`
    );
  } else {
    await writeFile(
      join(taskDir, '00-specs', 'TECH.md'),
      `# ${section.name} - 技术方案

> ⚠️ 本文档由 split 自动生成框架，AI 执行时会自动填充。

## 1. 方案概述
<!-- AI-FILL: 简述本任务的业务背景和技术目标 -->

## 2. 接口设计
<!-- AI-FILL: 根据以下接口列表设计 Controller / Service 分层 -->
${apiDesc}

### 统一响应格式
\`\`\`json
{ "code": 0, "message": "success", "data": {} }
\`\`\`

## 3. 数据模型
<!-- AI-FILL: 分析接口参数，设计 Entity/DTO/VO -->

## 4. 核心逻辑
<!-- AI-FILL: 描述关键业务流程和边界条件 -->

## 5. 测试策略
- 单元测试覆盖核心 Service 逻辑
- 接口测试覆盖正常/异常/边界
- 自动化测试通过后方可提 PR

## 6. 前端 UI 设计
<!-- AI-FILL: 页面结构、组件清单、状态管理、路由设计 -->
### 6.1 页面/路由
<!-- AI-FILL: 路由表 -->

### 6.2 组件清单
<!-- AI-FILL: 组件列表及职责 -->

### 6.3 状态管理
<!-- AI-FILL: 状态字段及枚举值，需与后端保持一致 -->
`
    );
  }

  if (section.content.match(/数据库|数据表|表结构|DDL|ALTER|建表|索引/)) {
    const schemaMaterial = extractRelevantSection(specContents['TECH.md'] || '', section.name, 'DDL 建表 表结构 索引 CREATE TABLE');
    await writeFile(join(taskDir, '00-specs', 'SCHEMA.md'), generateSchemaTemplate(section, schemaMaterial));
  }

  await writeFile(
    join(taskDir, '00-specs', 'CHANGELOG.md'),
    `# ${section.name} - 变更记录

| 时间 | 版本 | 变更内容 | 变更人 |
| :--- | :--- | :--- | :--- |
| ${today} | v1.0 | 初始创建 | CLI |
`
  );

  // API_CONTRACT.yaml 统一放 _shared/
  if (apiLines.length > 0) {
    // 从 section 内容提取每个 API 的请求/响应字段
    const sectionContent = section.content || '';
    const apiFieldMap: Record<string, string[]> = {};
    for (const l of apiLines) {
      const parts = l.split('|').map(p => p.trim()).filter(Boolean);
      const path = parts[1] || '/api/unknown';
      const apiIdx = sectionContent.indexOf(path);
      if (apiIdx >= 0) {
        const after = sectionContent.slice(apiIdx, apiIdx + 800);
        const fields: string[] = [];
        const fieldRegex = /[`']([a-zA-Z]\w{1,25})[`']\s*[（(]?[：:]?\s*(?:类型[：:])?\s*([\u4e00-\u9fa5A-Za-z]+)/g;
        let fm: RegExpExecArray | null;
        while ((fm = fieldRegex.exec(after)) !== null) {
          if (!['api', 'data', 'code', 'message', 'msg', 'status', 'ok', 'err'].includes(fm[1].toLowerCase())) {
            fields.push(`${fm[1]}: ${fm[2]}`);
          }
        }
        if (fields.length > 0) apiFieldMap[path] = fields.slice(0, 10);
      }
    }
    const contracts = apiLines.map(l => {
      const parts = l.split('|').map(p => p.trim()).filter(Boolean);
      const method = (parts[0] || 'GET').toUpperCase();
      const path = parts[1] || '/api/unknown';
      const desc = parts[2] || path;
      let yaml = `  ${path}:\n    ${method}:\n      summary: "${desc}"`;
      if (apiFieldMap[path]) {
        yaml += `\n      fields:`;
        for (const f of apiFieldMap[path]) {
          yaml += `\n        - "${f}"`;
        }
      }
      yaml += `\n      responses:\n        "200":\n          description: Success`;
      return yaml;
    }).join('\n');
    await writeFile(join(taskDir, '_shared', 'API_CONTRACT.yaml'),
      `# ${section.name} - API Contract\n# Auto-generated from split\n\npaths:\n${contracts}\n`
    );
  }

  // ── 4. 子任务目录（按任务类型差异化） ──

  // 预加载执行产出模板材料（每个子任务都需要）
  const testMaterial = extractRelevantSection(specContents['TEST.md'] || '', section.name);
  const riskMaterial = extractRelevantSection(specContents['RISK.md'] || '', section.name);
  const depsMaterial = extractRelevantSection(specContents['DEPS.md'] || '', section.name);
  const monitorMaterial = extractRelevantSection(specContents['MONITOR.md'] || '', section.name);

  // ── 4a. research 类型：不创建平台/子任务目录，直接产出调研文档 ──
  if (isResearch) {
    await writeFile(
      join(taskDir, 'RESEARCH.md'),
      `# ${section.name} — 调研报告

## 调研目标
${section.content}

## 调研结果
<!-- AI-FILL: 调研发现、技术选型分析 -->

## 推荐方案
<!-- AI-FILL: 推荐方案及理由 -->

## 风险与建议
<!-- AI-FILL -->
`
    );
    await writeFile(
      join(taskDir, 'COMPARISON.md'),
      `# ${section.name} — 方案对比

| 维度 | 方案 A | 方案 B | 方案 C |
|:---|:---|:---|:---|
| 技术栈 | | | |
| 开发成本 | | | |
| 性能 | | | |
| 可维护性 | | | |
| 社区生态 | | | |

## 综合评价
<!-- AI-FILL -->
`
    );
  } else {
    // ── 4b. feature/bugfix/refactor：端平铺 → 子任务（v6.49.0+ 统一架构）──
    
    // 创建子任务的通用函数
    const createSubtask = async (
      subtaskDir: string, subtaskId: string, platformName: string,
      platformLabel: string, isBk: boolean, hours: number
    ) => {
      // .meta/
      await ensureDir(join(subtaskDir, '.meta'));
      await writeFile(join(subtaskDir, '.meta', 'type'), taskType);
      await writeFile(join(subtaskDir, '.meta', 'status'), 'todo');
      await writeFile(join(subtaskDir, '.meta', 'owner'), owner);
      await writeFile(join(subtaskDir, '.meta', 'created-at'), today);
      // 功能单元标识（v6.49.2+）：默认取 section 的 functionalUnit 或 section.name
      const featureName = (section as any).functionalUnit || section.name || '未分类';
      await writeFile(join(subtaskDir, '.meta', 'feature'), featureName);

      // git-config
      await writeFile(
        join(subtaskDir, '.meta', 'git-config'),
        `# 子任务级 Git 配置（${platformLabel}）
# 以下配置覆盖迭代级 PROJECT_GRAPH.md，未配置项自动继承上一级。
# 修改时去掉注释符 #，填入具体值即可。

# 源分支: 继承迭代配置
# 分支前缀: 继承迭代配置
# 分支格式: 继承迭代配置
# 自动拉取: 继承迭代配置
# 远程名称: 继承迭代配置
`
      );

      // TASK.md
      await writeFile(
        join(subtaskDir, 'TASK.md'),
        `# ${section.name} — ${platformLabel}

## 子任务信息
- **子任务 ID**: \`${subtaskId}\`
- **所属模块**: \`${taskId}\`
- **功能单元**: ${featureName}
- **端**: ${platformName}
- **负责人**: ${owner}
- **状态**: 待开发
- **预计耗时**: ${hours}h

## 共享规格引用
- REQ.md → ../../../00-specs/REQ.md
- TECH.md → ../../../00-specs/TECH.md

## 产出物
| 产出物 | 状态 | 路径 |
| :--- | :--- | :--- |
| TASK.md | ✅ | ./TASK.md |
| TEST.md | ⏳ | ./TEST.md |
| RISK.md | ⏳ | ./RISK.md |
| 代码 | ⏳ | CONSTITUTION.md 中定义的工程路径 |

> 💡 代码输出位置：execute 命令会读取 CONSTITUTION.md 中的「源码路径」列，将代码写入实际工程目录。

## 变更履历
| 时间 | 变更内容 | 变更人 |
| :--- | :--- | :--- |
| ${today} | 创建子任务 | CLI |
`
      );

      // 前端设计文档（仅非 backend 端）
      if (!isBk) {
        const feContent = extractTaskTechContent(specContents, section, platformName);
        await writeFile(join(subtaskDir, 'COMPONENT_TREE.md'), generateComponentTree(section, platformName, feContent));
        await writeFile(join(subtaskDir, 'ROUTES.md'), generateRoutesDoc(section, platformName, feContent));
        await writeFile(join(subtaskDir, 'STATE.md'), generateStateDoc(section, platformName, feContent));
        await writeFile(join(subtaskDir, 'STYLE_GUIDE.md'), generateStyleGuide(section, platformName, feContent));
      }

      // 执行产出文档
      await writeFile(join(subtaskDir, 'TEST.md'), generateTestOutline(section, testMaterial));
      await writeFile(join(subtaskDir, 'REVIEW.md'), generateReviewChecklist(section));
      await writeFile(join(subtaskDir, 'DEPLOY.md'), generateDeployChecklist(section));
      await writeFile(join(subtaskDir, 'ERROR_CODES.md'), generateErrorCodes(section));
      await writeFile(join(subtaskDir, 'RISK.md'), generateRiskTemplate(section, riskMaterial));
      await writeFile(join(subtaskDir, 'DEPS.md'), generateDepsTemplate(section, depsMaterial));
      await writeFile(join(subtaskDir, 'MONITOR.md'), generateMonitorTemplate(section, monitorMaterial));

      const adr = generateAdr(section);
      if (adr) {
        await writeFile(join(subtaskDir, 'ADR.md'), adr);
      }
    };

    // ── 所有端平铺：{端名}/{子任务}/ （v6.49.2+ 统一架构）──
    // 不再区分前后端，所有端平铺在任务目录下
    // 子任务目录命名规则：{taskId}-{subtaskSlug}（确保多任务同平台不冲突）
    for (const platform of taskPlatforms) {
      const platformDir = join(taskDir, platform);
      const subtaskId = subtaskIdMap.get(platform)!;
      const subtaskSlug = slugify(section.name) || 'impl';
      // 子任务目录名：{taskId}-{subtaskSlug}，确保唯一性
      const subtaskDirName = `${taskId}-${subtaskSlug}`;
      const subtaskDir = join(platformDir, subtaskDirName);
      const subtaskHours = (section as any)._hoursByPlatform?.[platform] || Math.ceil(complexity.estimatedHours / taskPlatforms.length);
      // 判断是否后端（用于生成不同的文档内容）
      const isBk = platform === 'backend' || platform.startsWith('后台') || /-(service|api|server|backend)$/i.test(platform);
      await createSubtask(subtaskDir, subtaskId, platform, isBk ? '后端' : platform, isBk, subtaskHours);
    }
  }

  // 确保至少有 backend 子任务（AI 未输出 backend 时自动补充，仅非 research）
  // v6.48.0+：从 CONSTITUTION.md 端列表查找后端端名，不再硬编码 'backend'
  const hasAnyBackend = taskPlatforms.some((p: string) =>
    p === 'backend' || p.startsWith('后台') || /-(service|api|server|backend)$/i.test(p)
  );
  if (!isResearch && !hasAnyBackend) {
    // 从端列表查找第一个后端端名作为 fallback（v6.48.0+）
    const allPlatforms = await parsePlatformList();
    const fallbackBackend = allPlatforms.find(p =>
      p === 'backend' || p.startsWith('后台') || /-(service|api|server|backend)$/i.test(p)
    ) || 'backend';
    const autoSubtaskDir = join(taskDir, fallbackBackend, `${taskId}-impl`);
    await ensureDir(join(autoSubtaskDir, '.meta'));
    await writeFile(join(autoSubtaskDir, '.meta', 'type'), taskType);
    await writeFile(join(autoSubtaskDir, '.meta', 'status'), 'todo');
    await writeFile(join(autoSubtaskDir, '.meta', 'owner'), owner);
    await writeFile(join(autoSubtaskDir, '.meta', 'created-at'), today);
    // 功能单元标识（v6.49.2+）
    const featureName = (section as any).functionalUnit || section.name || '未分类';
    await writeFile(join(autoSubtaskDir, '.meta', 'feature'), featureName);
    await writeFile(
      join(autoSubtaskDir, '.meta', 'git-config'),
      `# 子任务级 Git 配置（后端）
# 以下配置覆盖迭代级 PROJECT_GRAPH.md，未配置项自动继承上一级。
`
    );
    await writeFile(
      join(autoSubtaskDir, 'TASK.md'),
      `# ${section.name} — ${fallbackBackend}（自动补充）

## 子任务信息
- **子任务 ID**: \`${taskId}-${fallbackBackend}-auto\`
- **所属模块**: \`${taskId}\`
- **功能单元**: ${featureName}
- **端**: ${fallbackBackend}
- **负责人**: ${owner}
- **状态**: 待开发

## 共享规格引用
- REQ.md → ../../../00-specs/REQ.md
- TECH.md → ../../../00-specs/TECH.md
`
    );
    // 自动补充的后端也需要执行产出文档
    await writeFile(join(autoSubtaskDir, 'TEST.md'), generateTestOutline(section, testMaterial));
    await writeFile(join(autoSubtaskDir, 'REVIEW.md'), generateReviewChecklist(section));
    await writeFile(join(autoSubtaskDir, 'DEPLOY.md'), generateDeployChecklist(section));
    await writeFile(join(autoSubtaskDir, 'ERROR_CODES.md'), generateErrorCodes(section));
    await writeFile(join(autoSubtaskDir, 'RISK.md'), generateRiskTemplate(section, riskMaterial));
    await writeFile(join(autoSubtaskDir, 'DEPS.md'), generateDepsTemplate(section, depsMaterial));
    await writeFile(join(autoSubtaskDir, 'MONITOR.md'), generateMonitorTemplate(section, monitorMaterial));
    taskPlatforms.push(fallbackBackend);
    subtaskIdMap.set(fallbackBackend, `${taskId}-${fallbackBackend}-auto`);
  }

  // ─ 5. 任务上下文 CONTEXT.md ─
  const sourceFile = (section as any)._sourceFile || '';
  const topic = (section as any)._topic || slugify(section.name);
  // 推导 010-requirements 源路径
  const reqSourcePath = sourceFile
    ? `010-requirements/${sourceFile}`
    : `010-requirements/${taskType === 'feature' ? 'features' : taskType === 'bugfix' ? 'bugs' : taskType === 'refactor' ? 'refactors' : 'research'}/${topic}.md`;
  // 推导 020-specs 分析文档路径
  const specSourcePath = sourceFile
    ? `020-specs/${sourceFile}`
    : `020-specs/${taskType === 'feature' ? 'features' : taskType === 'bugfix' ? 'bugs' : taskType === 'refactor' ? 'refactors' : 'research'}/${topic}.md`;
  // 任务类型中文标签
  const typeLabels: Record<string, string> = { feature: '功能开发', bugfix: '缺陷修复', refactor: '重构优化', research: '技术调研' };
  const typeLabel = typeLabels[taskType] || taskType;

  // 收集同迭代的其它任务（用于关联关系）
  const relatedTasks = allSections
    ? allSections
        .filter((s: Section) => s !== section)
        .slice(0, 5)
        .map((s: Section, idx: number) => {
          const sId = (s as any)._taskId || `Task-${String(allSections.indexOf(s) + 1).padStart(3, '0')}`;
          const sType = (s as any)._taskType || 'feature';
          return `- \`${sId}\` (${s.name}) — ${typeLabels[sType] || sType}`;
        })
    : [];

  // 提取原始描述摘要（从 REQ.md 内容截取前 500 字）
  const reqMdPath = join(taskDir, '00-specs', 'REQ.md');
  let originalDesc = '';
  if (await pathExists(reqMdPath)) {
    const reqContent = await readFile(reqMdPath, 'utf-8');
    // 跳过标题行，取正文前 500 字
    const body = reqContent.replace(/^#[^\n]*\n/, '').trim();
    originalDesc = body.length > 500 ? body.slice(0, 500) + '...' : body;
  }

  await writeFile(
    join(taskDir, '00-specs', 'CONTEXT.md'),
    `# 任务上下文

## 来源追溯

| 属性 | 值 |
|:---|:---|
| 任务类型 | ${typeLabel}（\`${taskType}\`） |
| 需求文档 | \`${reqSourcePath}\` |
| 分析文档 | \`${specSourcePath}\` |
| 功能单元 | ${(section as any).functionalUnit || section.name} |
| 拆分原因 | ${(section as any)._reason || '—'} |

## 原始描述

${originalDesc || '> 待补充（执行 analyze 后自动生成）'}

## 关联任务

${relatedTasks.length > 0 ? relatedTasks.join('\n') : '> 暂无关联任务（split 时自动填充）'}

## 影响范围

| 端 | 影响说明 |
|:---|:---|
${taskPlatforms.map((p: string) => `| ${p} | 待补充 |`).join('\n')}
`
  );

  // ── 7. 问题追踪 ──
  await writeFile(join(taskDir, '.issues.md'), `# ${section.name} - 问题追踪\n\n> 执行过程中发现的问题记录于此。\n\n`);
}

async function updateProjectGraph(iterationDir: string, sections: Section[]): Promise<void> {
  const graphPath = join(iterationDir, '000-overview', 'PROJECT_GRAPH.md');
  
  let content = '';
  if (await pathExists(graphPath)) {
    content = await readFile(graphPath, 'utf-8');
  }

  for (let i = 0; i < sections.length; i++) {
    const taskId = (sections[i] as any)._taskId || `Task-${String(i + 1).padStart(3, '0')}`;
    let taskName = sections[i].name; while (/端端/.test(taskName)) taskName = taskName.replace('端端', '端');
    
    if (!content.includes(taskId)) {
      const taskEntry = `| ${taskId} | ${taskName} | ${(sections[i] as any)._taskType || 'feature'} | 0% | 🔲 待开发 | |\n`;
      content = content.replace(
        '| 任务编号 | 任务名称 | 类型 | 进度 | 状态 | 负责人 |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n',
        `| 任务编号 | 任务名称 | 类型 | 进度 | 状态 | 负责人 |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n${taskEntry}`
      );
    }
  }

  await writeFile(graphPath, content);
}

/**
 * 根据需求内容自动生成测试用例框架
 */
function generateTestOutline(section: Section, material?: string): string {
  if (material && material.trim().length > 30) {
    return `# ${section.name} — 测试用例\n\n> 来源: analyze → TEST.md（自动提取）\n\n${material.trim()}\n`;
  }
  const name = section.name;
  const content = section.content || '';
  
  const isBackend = section.platform?.startsWith('后台') || false;
  const hasApi = content.includes('/api/') || content.includes('接口');
  const hasDb = content.includes('数据表') || content.includes('数据库') || content.includes('表');
  
  let outline = `# ${name} — 测试用例\n\n`;
  outline += `> 自动生成于 split，请在编码后补充具体用例\n\n`;
  outline += `## 1. 单元测试\n\n`;

  if (isBackend && hasApi) {
    outline += `| 用例 | 接口 | 输入 | 预期 | 状态 |\n`;
    outline += `| :--- | :--- | :--- | :--- | :--- |\n`;
    outline += `| 正常请求 | | | 200 | ⬜ |\n`;
    outline += `| 参数校验 | | | 400 | ⬜ |\n`;
    outline += `| 未授权 | | | 401 | ⬜ |\n`;
  } else {
    outline += `| 用例 | 场景 | 输入 | 预期 | 状态 |\n`;
    outline += `| :--- | :--- | :--- | :--- | :--- |\n`;
    outline += `| 正常渲染 | 默认 | | | ⬜ |\n`;
    outline += `| 空数据 | 无数据 | | | ⬜ |\n`;
  }

  if (hasDb) {
    outline += `\n## 2. 数据库测试\n\n`;
    outline += `| 用例 | 表 | 操作 | 预期 | 状态 |\n`;
    outline += `| :--- | :--- | :--- | :--- | :--- |\n`;
    outline += `| 事务回滚 | | INSERT/UPDATE | 异常时回滚 | ⬜ |\n`;
    outline += `| 唯一约束 | | INSERT 重复 | 约束冲突 | ⬜ |\n`;
  }

  outline += `\n## 3. 集成测试 / E2E\n\n`;
  outline += `| 用例 | 流程 | 预期 | 状态 |\n`;
  outline += `| :--- | :--- | :--- | :--- |\n`;
  outline += `| 正常流程 | 从头到尾走通 | 成功 | ⬜ |\n`;
  outline += `| 异常流程 | 中断/超时 | 优雅降级 | ⬜ |\n`;
  outline += `| 并发 | 多用户同时操作 | 无数据错乱 | ⬜ |\n`;

  outline += `\n## 4. 性能 / 安全\n\n`;
  outline += `| 用例 | 指标 | 阈值 | 状态 |\n`;
  outline += `| :--- | :--- | :--- | :--- |\n`;
  outline += `| 响应时间 | P99 | < 500ms | ⬜ |\n`;
  outline += `| 并发容量 | QPS | 满足预期 | ⬜ |\n`;

  outline += `\n> ⬜ 待编写 | ✅ 通过 | ❌ 失败 | ➖ 不适用\n`;
  return outline;
}

/**
 * 根据需求内容自动生成代码审查清单
 */
function generateReviewChecklist(section: Section): string {
  const name = section.name;
  const content = section.content || '';
  
  const hasApi = content.includes('/api/') || content.includes('接口');
  const hasDb = content.includes('数据库') || content.includes('表');
  const hasBatch = content.includes('批量') || content.includes('导出');
  const hasAuth = content.includes('权限') || content.includes('角色') || content.includes('认证');
  const isBackend = section.platform?.startsWith('后台') || false;

  let checklist = `# ${name} — Code Review Checklist\n\n`;
  checklist += `> 自动生成于 split，请在提交 PR 前逐项确认\n\n`;
  
  checklist += `## 功能正确性\n\n`;
  checklist += `- [ ] 需求覆盖完整，无遗漏\n`;
  checklist += `- [ ] 边界条件处理（空值、极值、特殊字符）\n`;
  checklist += `- [ ] 错误码统一\n\n`;

  checklist += `## 代码质量\n\n`;
  checklist += `- [ ] 零 ` + '`any`' + ` 类型\n`;
  checklist += `- [ ] 无 console.log 残留\n`;
  checklist += `- [ ] 命名清晰、见名知义\n`;
  checklist += `- [ ] 无重复代码（>3 次提取为函数）\n\n`;

  if (isBackend) {
    checklist += `## 后端专项\n\n`;
    checklist += `- [ ] 接口幂等性\n`;
    checklist += `- [ ] 参数校验（@Valid / DTO）\n`;
    checklist += `- [ ] 防 SQL 注入\n`;
    checklist += `- [ ] 日志脱敏（密码/手机号不打日志）\n`;
    if (hasDb) {
      checklist += `- [ ] 数据库事务边界正确\n`;
      checklist += `- [ ] 索引是否匹配查询条件\n`;
    }
    if (hasBatch) {
      checklist += `- [ ] 批量操作有上限限制\n`;
      checklist += `- [ ] 大数据量分页处理\n`;
    }
    if (hasAuth) {
      checklist += `- [ ] 权限校验在每个接口入口（不是中间件漏掉）\n`;
    }
    checklist += `\n`;
  } else {
    checklist += `## 前端专项\n\n`;
    checklist += `- [ ] 组件拆分合理（>200 行考虑拆分）\n`;
    checklist += `- [ ] 无 XSS 漏洞（v-html 审查）\n`;
    checklist += `- [ ] 响应式适配\n`;
    checklist += `- [ ] 加载态 / 空态 / 错误态 / 边界态（四态齐全）\n\n`;
  }

  checklist += `## 测试\n\n`;
  checklist += `- [ ] 核心路径有单元测试\n`;
  checklist += `- [ ] 参照 \`TEST.md\` 逐项验证\n`;
  checklist += `- [ ] \`speccore validate --task=${name}\` 通过\n\n`;

  checklist += `## 自查确认\n\n`;
  checklist += `- [ ] 已在本地完整跑通\n`;
  checklist += `- [ ] 相关的 \`REQ.md\` 已更新（如有变化）\n`;
  checklist += `- [ ] PR 描述写清楚了「做了什么 + 怎么测」\n`;

  return checklist;
}

/**
 * 严格模式：预览拆分方案，逐 section 确认
 */
async function strictSplitPreview(
  sections: Section[],
  platforms: string[],
  iterationDir: string
): Promise<Section[]> {
  const ask = (q: string): Promise<string> => {
    process.stdout.write(q);
    return new Promise((resolve) => {
      process.stdin.resume();
      process.stdin.once('data', (data: Buffer) => {
        process.stdin.pause();
        resolve(data.toString().split('\n')[0].trim());
      });
    });
  };

  logger.info('\n╔══════════════════════════════════════════╗');
  logger.info('║  🔍 Strict Split — 预览拆分方案          ║');
  logger.info('╚══════════════════════════════════════════╝\n');

  logger.info(`检测到 ${sections.length} 个章节，${platforms.length} 个端: ${platforms.join(', ')}\n`);

  const approved: Section[] = [];

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const taskId = (s as any)._taskId || `Task-${String(i + 1).padStart(3, '0')}`;
    
    // Determine target directory
    const target = s.platform
      ? (s.platform.startsWith('后台') ? `backend/${s.platform.replace(/^后台/, '')}` : s.platform)
      : platforms.join(' + ');

    logger.info(`── ${taskId}: ${s.name} ──`);
    logger.info(`   端: ${target}`);
    logger.info(`   内容: ${(s.content || '').slice(0, 60).replace(/\n/g, ' ')}...`);
    
    const answer = (await ask(`   → 保留？[y]确认 [e]编辑名称 [a]分配 [N]跳过 [q]取消: `)).toLowerCase();
    
    if (answer === 'q') { logger.info('  ❌ 取消全部\n'); approved.length = 0; break; }
    if (answer === 'a') {
      const owner = await ask(`   → 分配给谁？（如需要多端，用逗号分隔: 张三(后台),李四(Web)）: `);
      if (owner) {
        // Store owner info for later use
        (s as any)._owner = owner;
        logger.info(`  👤 负责人: ${owner}`);
      }
      approved.push(s);
      logger.info(`  ✅ 保留`);
    } else if (answer === 'e') {
      const newName = await ask(`   → 新名称: `);
      if (newName) { s.name = newName; logger.info(`  📝 已改名: ${newName}`); }
      approved.push(s);
    } else if (answer === 'y' || answer === 'yes') {
      approved.push(s);
      logger.info(`  ✅ 保留`);
    } else {
      logger.info(`  ⏭️  跳过`);
    }
    logger.info('');
  }

  if (approved.length === 0) return [];

  logger.info(`\n  将创建 ${approved.length}/${sections.length} 个任务`);
  const confirm = await ask('  确认创建？[y/N] ');
  logger.info('\n✅ 确认创建...\n');
  showNextSteps('split');

  return approved;
}

/**
 * 生成任务间影响关系图 + 风险评分
 */
async function generateImpactGraph(
  iterationDir: string,
  sections: Section[],
  platforms: string[]
): Promise<void> {
  const deps: { from: string; fromName: string; to: string; toName: string; reason: string }[] = [];

  const sectionApis: { name: string; apis: string[] }[] = sections.map((s, i) => {
    const taskId = (s as any)._taskId || `Task-${String(i + 1).padStart(3, '0')}`;
    const apis = (s.content.match(/\/api\/[a-zA-Z0-9\/-]+/g) || []).map(a => a.trim());
    return { name: taskId, apis };
  });

  for (let i = 0; i < sectionApis.length; i++) {
    for (let j = 0; j < sectionApis.length; j++) {
      if (i === j) continue;
      for (const api of sectionApis[j].apis) {
        if (sections[i].content.includes(api)) {
          deps.push({ from: sectionApis[i].name, fromName: sections[i].name, to: sectionApis[j].name, toName: sections[j].name, reason: api });
          break;
        }
      }
    }
  }

  const seen = new Set<string>();
  const uniqueDeps = deps.filter(d => { const k = d.from + d.to; if (seen.has(k)) return false; seen.add(k); return true; });

  let impact = '# IMPACT.md\n\n> auto-generated by split\n\n## Risk Scores\n\n| Task | Risk | Score | Tags | Reasons |\n| :--- | :--- | ---: | :--- | :--- |\n';

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const taskId = (s as any)._taskId || `Task-${String(i + 1).padStart(3, '0')}`;
    const risk = await scoreRisk(s.content + s.name, s.name, iterationDir);
    impact += `| ${taskId}: ${s.name} | ${risk.level} | ${risk.score} | ${risk.tags.join(' ')} | ${risk.reasons.join('; ')} |\n`;

    const taskType = (s as any)._taskType || 'feature';
    const taskDir = join(iterationDir, '030-tasks', taskType, taskId);
    if (await pathExists(taskDir)) {
      // 生成风险报告并嵌入 00-specs/TECH.md（去重：只写一次）
      const taskMdPath = (await pathExists(join(taskDir, '00-specs', 'TECH.md')))
        ? join(taskDir, '00-specs', 'TECH.md')
        : join(taskDir, '_shared', 'TECH.md');
      const riskReport = generateRiskReport(risk);
      await writeFile(join(taskDir, '.risk'), riskReport);
      if (await pathExists(taskMdPath)) {
        let taskMd = await readFile(taskMdPath, 'utf-8');
        if (!taskMd.includes('## 风险评估')) {
          taskMd += '\n\n## 风险评估\n\n' + riskReport.replace('# 风险评估\n\n', '');
          await writeFile(taskMdPath, taskMd);
        }
      }
    }
  }

  // 语义依赖检测
  const semanticDeps = detectSemanticDependencies(sections);

  impact += '\n## Dependencies\n\n';
  if (uniqueDeps.length > 0 || semanticDeps.size > 0) {
    impact += '| Consumer | -> | Producer | 类型 |\n| :--- | :---: | :--- | :--- |\n';
    // API 依赖
    for (const d of uniqueDeps) impact += `| ${d.from}: ${d.fromName.slice(0,20)} | → | ${d.to}: ${d.toName.slice(0,20)} | API: \`${d.reason}\` |\n`;
    // 语义依赖
    for (const [from, targets] of semanticDeps) {
      for (const target of targets) {
        impact += `| ${from} | → | ${target} | 语义推断 |\n`;
      }
    }
    impact += '\n> Consumer tasks must wait for Producer tasks, or pre-define API contracts.\n';
  } else {
    impact += 'No task dependencies detected — all tasks can be developed in parallel.\n';
  }

  await writeFile(join(iterationDir, 'IMPACT.md'), impact);
  logger.info(`\nImpact analysis: ${iterationDir}/IMPACT.md`);
}

function generateSchemaTemplate(section: Section, material?: string): string {
  const name = section.name;
  if (material && material.trim().length > 30) {
    return `# ${name} — Database Schema\n\n> 来源: analyze → TECH.md（自动提取）\n\n${material.trim()}\n`;
  }
  return `# ${name} — Database Schema

> Auto-generated. Fill in DDL before development.

## Tables

| Table | Purpose | Engine | Charset |
| :--- | :--- | :--- | :--- |
| | | InnoDB | utf8mb4 |

## DDL

\`\`\`sql
-- TODO: Write CREATE TABLE statements

\`\`\`

## Indexes

| Table | Index | Columns | Type |
| :--- | :--- | :--- | :--- |
| | | | BTREE |

## Migration Plan

- [ ] Dev: Write DDL in local
- [ ] Review: DBA reviews schema changes
- [ ] Stage: Run migration on staging
- [ ] Prod: Run migration during deployment window

## Rollback

\`\`\`sql
-- TODO: Write rollback DDL
\`\`\`
`;
}

function generateDeployChecklist(section: Section): string {
  const name = section.name;
  const hasDb = section.content.match(/数据库|数据表|DDL|ALTER/) !== null;
  return `# ${name} — Deployment Checklist

## Pre-Deploy

- [ ] All tests pass (\`speccore lifecycle --task=${name} --check\`)
- [ ] Code review approved (REVIEW.md all checked)
- [ ] PR merged to main
- [ ] CI/CD pipeline green

${hasDb ? '- [ ] DB migration script ready and reviewed\n- [ ] DB backup taken before migration\n' : ''}
## Deploy Steps

1. [ ] Merge to release branch
2. [ ] Tag version: \`git tag vX.Y.Z\`
3. [ ] Deploy to staging
4. [ ] Smoke test on staging
5. [ ] Deploy to production
${hasDb ? '6. [ ] Run DB migration\n7. [ ] Verify data integrity\n' : ''}
## Post-Deploy

- [ ] Monitor error logs (first 30 min)
- [ ] Monitor performance metrics
- [ ] Run \`speccore archive --task=${name}\`

## Rollback Plan

- [ ] \`git revert\` the merge commit
${hasDb ? '- [ ] Run rollback DDL from SCHEMA.md\n' : ''}- [ ] Notify team on rollback
`;
}

async function generateEnvExample(iterationDir: string, sections: Section[]): Promise<void> {
  const envPath = join(iterationDir, '.env.example');
  let env = '# Environment Variables — ' + iterationDir + '\n';
  env += '# Copy to .env and fill in values\n\n';

  const needs: Set<string> = new Set();

  for (const s of sections) {
    const c = s.content + s.name;
    if (c.match(/Redis|缓存/)) needs.add('REDIS_URL=redis://localhost:6379');
    if (c.match(/Kafka|MQ|消息队列/)) needs.add('KAFKA_BROKERS=localhost:9092');
    if (c.match(/MySQL|数据库|JDBC|数据表/)) needs.add('DB_URL=jdbc:mysql://localhost:3306/db\nDB_USER=root\nDB_PASS=');
    if (c.match(/OSS|对象存储|S3|文件上传/)) needs.add('OSS_ENDPOINT=https://oss.example.com\nOSS_KEY=\nOSS_SECRET=');
    if (c.match(/支付|微信|支付宝|wechat|alipay/)) needs.add('PAYMENT_API_KEY=\nPAYMENT_SECRET=');
    if (c.match(/短信|SMS|验证码/)) needs.add('SMS_API_KEY=\nSMS_SECRET=');
    if (c.match(/邮件|email|smtp/)) needs.add('SMTP_HOST=smtp.example.com\nSMTP_PORT=587\nSMTP_USER=\nSMTP_PASS=');
    if (c.match(/token|JWT|OAuth|鉴权|登录/)) needs.add('JWT_SECRET=\nTOKEN_EXPIRE=3600');
  }

  if (needs.size === 0) {
    needs.add('# No extra environment variables detected.');
    needs.add('# Add required variables here.');
  }

  env += [...needs].join('\n') + '\n';

  await writeFile(envPath, env);
  logger.info(`Env example: ${iterationDir}/.env.example`);
}

async function injectTechFromAnalysis(iterationDir: string, taskDir: string, sectionName: string): Promise<void> {
  const analysisPath = join(iterationDir, '020-specs', 'ANALYSIS.md');
  if (!(await pathExists(analysisPath))) return;

  const analysis = await readFile(analysisPath, 'utf-8');
  
  // Extract relevant tech stack section
  const techSection = analysis.match(/### 技术选型[\s\S]*?(?=###|$)/);
  const dbSection = analysis.match(/### 数据库变更[\s\S]*?(?=###|$)/);
  const depSection = analysis.match(/### 接口依赖[\s\S]*?(?=###|$)/);

  if (!techSection && !dbSection && !depSection) return;

  const techPath = (await pathExists(join(taskDir, '00-specs', 'TECH.md')))
    ? join(taskDir, '00-specs', 'TECH.md')
    : join(taskDir, '_shared', 'TECH.md');
  let tech = await readFile(techPath, 'utf-8');

  const note = '\n\n> 以下内容自动从 ANALYSIS.md 注入\n\n';
  
  if (techSection && !tech.includes(techSection[0].trim())) {
    tech += note + techSection[0].trim() + '\n';
  }
  if (dbSection && !tech.includes(dbSection[0].trim())) {
    tech += dbSection[0].trim() + '\n';
  }
  if (depSection && !tech.includes(depSection[0].trim())) {
    tech += depSection[0].trim() + '\n';
  }

  await writeFile(techPath, tech);
}

function generateApiContract(section: Section): string {
  const lines = (section.content || '').split('\n');
  const apis: { method: string; path: string; desc: string }[] = [];
  
  for (const line of lines) {
    const match = line.match(/\|\s*(GET|POST|PUT|DELETE|PATCH)\s*\|\s*(\/[^\s|]+)\s*\|\s*(.*)/i);
    if (match) {
      apis.push({ method: match[1].toUpperCase(), path: match[2].trim(), desc: (match[3] || '').trim() });
    }
  }
  
  if (apis.length === 0) return '';

  // 从 section 内容提取每个 API 的请求/响应字段
  const fullContent = section.content || '';
  const apiFieldMap: Record<string, string[]> = {};
  for (const api of apis) {
    const apiIdx = fullContent.indexOf(api.path);
    if (apiIdx >= 0) {
      const after = fullContent.slice(apiIdx, apiIdx + 800);
      const fields: string[] = [];
      const fieldRegex = /[`']([a-zA-Z]\w{1,25})[`']\s*[（(]?[：:]?\s*(?:类型[：:])?\s*([\u4e00-\u9fa5A-Za-z]+)/g;
      let fm: RegExpExecArray | null;
      while ((fm = fieldRegex.exec(after)) !== null) {
        if (!['api', 'data', 'code', 'message', 'msg', 'status', 'ok', 'err'].includes(fm[1].toLowerCase())) {
          fields.push(`${fm[1]}: ${fm[2]}`);
        }
      }
      if (fields.length > 0) apiFieldMap[api.path] = fields.slice(0, 10);
    }
  }
  
  let yaml = `# ${section.name} — API Contract
# Auto-generated from REQ.md

openapi: "3.0.0"
info:
  title: "${section.name}"
  version: "1.0.0"

paths:
`;
  
  for (const api of apis) {
    const tag = api.path.split('/')[2] || 'default';
    yaml += `  ${api.path}:
    ${api.method.toLowerCase()}:
      tags: [${tag}]
      summary: "${api.desc}"
`;
    // 添加字段定义
    if (apiFieldMap[api.path]) {
      yaml += `      fields:
`;
      for (const f of apiFieldMap[api.path]) {
        yaml += `        - "${f}"
`;
      }
    }
    yaml += `      responses:
        "200":
          description: Success
`;
    if (api.method === 'POST' || api.method === 'PUT') {
      yaml += `        "400":
          description: Bad Request
`;
    }
    if (api.method === 'DELETE') {
      yaml += `        "404":
          description: Not Found
`;
    }
  }
  
  return yaml;
}

function generateErrorCodes(section: Section): string {
  let md = `# ${section.name} — Error Codes\n\n> Auto-generated\n\n`;
  md += `| Code | HTTP | Message | Description |\n`;
  md += `| :--- | :--- | :--- | :--- |\n`;
  
  const content = section.content || '';
  const module = section.name.replace(/[^\w]/g, '_').toUpperCase();
  
  md += `| ${module}_001 | 400 | 参数校验失败 | 请求参数不符合规范 |\n`;
  md += `| ${module}_002 | 404 | 资源不存在 | 请求的资源未找到 |\n`;
  md += `| ${module}_003 | 500 | 服务器内部错误 | 未预期的服务异常 |\n`;
  
  if (content.includes('权限') || content.includes('RBAC')) {
    md += `| ${module}_004 | 403 | 无操作权限 | 当前用户权限不足 |\n`;
  }
  if (content.includes('创建') || content.includes('POST')) {
    md += `| ${module}_005 | 409 | 资源冲突 | 重复创建或状态冲突 |\n`;
  }
  
  return md;
}

function generateAdr(section: Section): string {
  const content = section.content || '';
  
  // Only generate ADR if tech decisions are mentioned
  const hasTech = content.match(/Spring|Vue|React|MySQL|Redis|Kafka|微服务|单体|REST|gRPC/);
  if (!hasTech) return '';
  
  const now = new Date().toISOString().split('T')[0];
  let adr = `# ADR: ${section.name}\n\n`;
  adr += `- **日期**: ${now}\n`;
  adr += `- **状态**: 提议中\n\n`;
  adr += `## 决策\n\n`;
  
  const techStack = content.match(/(Spring|Vue|React|MySQL|Redis|Kafka|微服务|单体|REST|gRPC)[^\n]*/g);
  if (techStack) {
    adr += `基于任务需求，技术选型如下:\n\n`;
    for (const t of [...new Set(techStack)]) {
      adr += `- ${t.trim()}\n`;
    }
  }
  
  adr += `\n## 备选方案\n\n- _待补充_\n`;
  adr += `\n## 后果\n\n- _待补充_\n`;
  
  return adr;
}

// ── AC 自动生成 ──
function generateAcceptanceCriteria(section: Section): string {
  const lines = section.content.split('\n');
  let acs = '';
  let acNum = 1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && (trimmed.includes('GET') || trimmed.includes('POST') || trimmed.includes('PUT') || trimmed.includes('DELETE') || trimmed.includes('PATCH'))) {
      const parts = trimmed.split('|').map(p => p.trim()).filter(Boolean);
      const method = parts[0] || '';
      const path = parts[1] || '';
      const desc = parts[2] || path;
      acs += `- [ ] AC-${acNum++}: \`${method} ${path}\` — ${desc}\n`;
    }
    if (trimmed.startsWith('-') && (trimmed.includes('规则') || trimmed.includes('校验') || trimmed.includes('必须'))) {
      acs += `- [ ] AC-${acNum++}: ${trimmed.replace(/^- /, '')}\n`;
    }
  }

  if (acNum === 1) {
    acs = `- [ ] AC-1: 功能实现与需求描述一致\n- [ ] AC-2: 异常输入有合理的错误处理\n- [ ] AC-3: 核心逻辑有单元测试覆盖\n`;
    acNum = 4;
  }

  acs += `- [ ] AC-${acNum++}: 代码审查通过（REVIEW.md 全部已确认）\n`;
  acs += `- [ ] AC-${acNum++}: 部署清单完成（DEPLOY.md 全部已确认）\n`;

  return acs;
}

// 风险评估
function generateRiskTemplate(section: Section, material?: string): string {
  if (material && material.trim().length > 30) {
    return `# ${section.name} — 风险评估\n\n> 来源: analyze → RISK.md（自动提取）\n\n${material.trim()}\n`;
  }
  return `# ${section.name} — 风险评估\n\n> split | ${new Date().toISOString().split('T')[0]}\n\n## 风险矩阵\n\n| 风险 | 可能 | 影响 | 缓解 |\n| :--- | :--- | :--- | :--- |\n| 兼容性 | 中 | 高 | 版本号+测试 |\n| 性能 | 低 | 中 | 压测+索引 |\n| 依赖故障 | 低 | 高 | 降级方案 |\n\n## 回滚\n\n1. 触发: 线上错误率 > 1%\n2. 步骤: git revert → 重部署\n3. 验证: 冒烟测试 + 监控\n`;
}

// 依赖清单
function generateDepsTemplate(section: Section, material?: string): string {
  if (material && material.trim().length > 30) {
    return `# ${section.name} — 依赖清单\n\n> 来源: analyze → DEPS.md（自动提取）\n\n${material.trim()}\n`;
  }
  return `# ${section.name} — 依赖清单\n\n## 上游依赖\n\n| 服务 | 版本 | 用途 | SLA |\n| :--- | :--- | :--- | :--- |\n| _待补充_ | — | — | — |\n\n## 下游影响\n\n| 服务 | 影响 | 通知 |\n| :--- | :--- | :--- |\n| _待补充_ | — | — |\n`;
}

// 监控指标
function generateMonitorTemplate(section: Section, material?: string): string {
  if (material && material.trim().length > 30) {
    return `# ${section.name} — 监控\n\n> 来源: analyze → MONITOR.md（自动提取）\n\n${material.trim()}\n`;
  }
  return `# ${section.name} — 监控\n\n## 关键指标\n\n| 指标 | 阈值 | 级别 |\n| :--- | :--- | :--- |\n| 成功率 | <99.9% | P1 |\n| P99延迟 | >1000ms | P2 |\n| 错误率 | >0.1% | P0 |\n\n## 关键日志\n\n- 请求入口 (traceId)\n- 业务异常 (上下文)\n- 外部调用 (耗时)\n`;
}

// ═══════════════════════════════════════════════
// 从 analyze 产出中提取任务相关内容
// ═══════════════════════════════════════════════

/** 加载迭代级 020-specs/ 文档内容（包括 global/ 全局文档 + 根目录回退 + 各端子目录文档） */
async function loadSpecContents(iterationDir: string): Promise<Record<string, string>> {
  const specs: Record<string, string> = {};
  const specDir = join(iterationDir, '020-specs');
  if (!(await pathExists(specDir))) return specs;

  // 1. 读取全局文档（优先 global/ 子目录，回退根目录 — v6.41.0+ 向后兼容）
  for (const f of ['REQUIREMENT.md', 'ANALYSIS.md', 'TECH.md', 'RISK.md', 'DEPS.md', 'REVIEW.md', 'MONITOR.md']) {
    const resolved = await resolveGlobalSpecPath(specDir, f);
    if (resolved) {
      const content = await readFile(resolved, 'utf-8');
      if (content.trim().length > 50 && !content.trim().match(/^#+\s*待填充|^<!--\s*AI-FILL/m)) {
        specs[f] = content;
      }
    }
  }
  // 根目录下的 TEST.md、UI_SPEC.md（端无关模板/回退）
  for (const f of ['TEST.md', 'UI_SPEC.md']) {
    const fp = join(specDir, f);
    if (await pathExists(fp)) {
      const content = await readFile(fp, 'utf-8');
      if (content.trim().length > 50 && !content.trim().match(/^#+\s*待填充|^<!--\s*AI-FILL/m)) {
        specs[f] = content;
      }
    }
  }

  // 2. 读取各端子目录文档（如 admin/TECH.md、h5/TECH.md 等）
  const entries = await readdir(specDir, { withFileTypes: true });
  const knownNonPlatformDirs = new Set(['sources', 'assets', 'prototypes', 'converted', 'features', 'bugs', 'refactors', 'research', 'staging', 'platforms', 'snapshots', GLOBAL_SPECS_DIR]);
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.') && !knownNonPlatformDirs.has(e.name)) {
      const platform = e.name;
      const platformDir = join(specDir, platform);
      // 读取该端下的 TECH.md、TEST.md、UI_SPEC.md
      for (const f of ['TECH.md', 'TEST.md', 'UI_SPEC.md']) {
        const fp = join(platformDir, f);
        if (await pathExists(fp)) {
          const content = await readFile(fp, 'utf-8');
          if (content.trim().length > 50 && !content.trim().match(/^#+\s*待填充|^<!--\s*AI-FILL/m)) {
            // 用平台前缀区分：admin/TECH.md → 'admin/TECH.md'
            specs[`${platform}/${f}`] = content;
          }
        }
      }
    }
  }

  return specs;
}

/** 从完整文档中提取与任务名相关的段落 */
function extractRelevantSection(fullContent: string, taskName: string, sectionHint?: string): string {
  if (!fullContent || !taskName) return '';
  const lines = fullContent.split('\n');
  const nameKeywords = new Set<string>();
  for (const m of taskName.matchAll(/[a-zA-Z]+/g)) { if (m[0].length > 1) nameKeywords.add(m[0].toLowerCase()); }
  for (const m of taskName.matchAll(/[\u4e00-\u9fff]+/g)) { if (m[0].length >= 2) nameKeywords.add(m[0]); }
  if (sectionHint) {
    for (const m of sectionHint.matchAll(/[a-zA-Z]+/g)) { if (m[0].length > 1) nameKeywords.add(m[0].toLowerCase()); }
    for (const m of sectionHint.matchAll(/[\u4e00-\u9fff]+/g)) { if (m[0].length >= 2) nameKeywords.add(m[0]); }
  }
  if (nameKeywords.size === 0) return '';
  const kwArray = [...nameKeywords];

  // 按 Markdown 标题拆分，查找包含关键词的完整段落
  const sections: { heading: string; level: number; content: string; headingLine: string }[] = [];
  let cur: { heading: string; level: number; content: string[]; headingLine: string } = { heading: '', level: 0, content: [], headingLine: '' };
  for (const line of lines) {
    const hm = line.match(/^(#{1,4})\s+(.+)/);
    if (hm) {
      if (cur.heading || cur.content.length > 0) sections.push({ heading: cur.heading, level: cur.level, content: cur.content.join('\n'), headingLine: cur.headingLine });
      cur = { heading: hm[2].trim(), level: hm[1].length, content: [], headingLine: line };
    } else {
      cur.content.push(line);
    }
  }
  if (cur.heading || cur.content.length > 0) sections.push({ heading: cur.heading, level: cur.level, content: cur.content.join('\n'), headingLine: cur.headingLine });

  // 匹配：标题或内容包含关键词
  const matched: string[] = [];
  for (const sec of sections) {
    const text = (sec.heading + ' ' + sec.content).toLowerCase();
    const hit = kwArray.some(kw => text.includes(kw));
    if (hit && (sec.heading || sec.content.trim())) {
      const prefix = '#'.repeat(Math.max(sec.level + 1, 2));
      matched.push(`${prefix} ${sec.heading}\n${sec.content.trim()}`);
    }
  }
  if (matched.length > 0) return matched.join('\n\n');

  // 回退：提取包含关键词的连续行
  const fallback: string[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (kwArray.some(kw => lower.includes(kw))) fallback.push(line);
  }
  return fallback.length > 0 ? fallback.join('\n') : '';
}

/** 从 TECH.md 提取前端平台相关内容 */
function extractFrontendContent(techContent: string, taskName: string, platform: string): string {
  if (!techContent) return '';
  // 先提取该前端平台相关的顶层段落（如 "H5移动端"、"后台管理端"）
  const platformLabels: Record<string, string[]> = {
    'h5': ['H5', 'h5', '移动端', 'mobile'],
    'admin': ['admin', '后台', '管理端', 'Admin'],
    'web': ['Web', 'web', '前端', '桌面'],
    'app': ['App', 'app', '客户端'],
    'miniapp': ['小程序', 'miniapp'],
  };
  const platformKws = platformLabels[platform] || [platform];
  const platformSection = extractRelevantSection(techContent, taskName, platformKws.join(' '));
  if (platformSection) return platformSection;
  // 回退：用任务名匹配
  return extractRelevantSection(techContent, taskName);
}

/** 从 specContents 提取任务级 TECH 内容（优先读取对应端的文档） */
function extractTaskTechContent(specContents: Record<string, string>, section: Section, platform?: string): string {
  // 优先读取对应端的 TECH.md
  if (platform) {
    const platformTechKey = `${platform}/TECH.md`;
    const platformTechMd = specContents[platformTechKey];
    if (platformTechMd) {
      // 从该端专属文档中提取
      return extractRelevantSection(platformTechMd, section.name);
    }
  }

  // 回退：尝试从根目录 TECH.md 提取（兼容旧结构或全局文档）
  const techMd = specContents['TECH.md'];
  if (!techMd) return '';
  if (platform && platform !== 'backend') {
    return extractFrontendContent(techMd, section.name, platform);
  }
  // 后端/共享：提取技术方案、架构、接口设计、数据模型等
  const techSection = extractRelevantSection(techMd, section.name, '技术方案 架构 接口设计 数据模型 模块设计');
  return techSection;
}

// 前端专属：组件树
function generateComponentTree(section: Section, platform: string, material?: string): string {
  if (material && material.trim().length > 30) {
    return `# ${section.name} — 组件树 (${platform})\n\n> 来源: analyze → TECH.md（自动提取）\n\n${material.trim()}\n`;
  }
  return `# ${section.name} — 组件树 (${platform})

> split | ${new Date().toISOString().split('T')[0]}

## 页面结构
<!-- 从 analyze TECH.md 自动提取，若无内容则待补充 -->

## 组件清单
| 组件 | 路径 | 类型 | 状态 |
| :--- | :--- | :--- | :--- |
| _待补充_ | — | — | — |

## 共享组件
| 组件 | 来源 | 用途 |
| :--- | :--- | :--- |
| _待补充_ | — | — |
`;
}

// 前端专属：路由
function generateRoutesDoc(section: Section, platform: string, material?: string): string {
  if (material && material.trim().length > 30) {
    return `# ${section.name} — 路由设计 (${platform})\n\n> 来源: analyze → TECH.md（自动提取）\n\n${material.trim()}\n`;
  }
  return `# ${section.name} — 路由设计 (${platform})

> split | ${new Date().toISOString().split('T')[0]}

## 路由表
| 路径 | 组件 | 权限 | 参数 |
| :--- | :--- | :--- | :--- |
| _待AI分析_ | — | — | — |

## 导航结构
<!-- AI-FILL: 面包屑 / 侧栏 / Tab -->
`;
}

// 前端专属：状态管理
function generateStateDoc(section: Section, platform: string, material?: string): string {
  if (material && material.trim().length > 30) {
    return `# ${section.name} — 状态管理 (${platform})\n\n> 来源: analyze → TECH.md（自动提取）\n\n${material.trim()}\n`;
  }
  return `# ${section.name} — 状态管理 (${platform})

> split | ${new Date().toISOString().split('T')[0]}

## 全局状态
| Store | 字段 | 类型 | 持久化 |
| :--- | :--- | :--- | :--- |
| _待AI分析_ | — | — | — |

## 组件状态
| 组件 | 状态 | 来源 |
| :--- | :--- | :--- |
| _待补充_ | — | — |

## 数据流
<!-- AI-FILL: 父→子 props / 子→父 emit / store -->
`;
}

// 前端专属：样式规范
function generateStyleGuide(section: Section, platform: string, material?: string): string {
  if (material && material.trim().length > 30) {
    return `# ${section.name} — 样式规范 (${platform})\n\n> 来源: analyze → TECH.md（自动提取）\n\n${material.trim()}\n`;
  }
  const isH5 = platform.includes('h5') || platform.includes('mobile');
  const isMiniapp = platform.includes('miniapp') || platform.includes('小程序');
  const styleCtx = isH5 ? '移动端 H5，注意触控交互和移动适配' : 
                    isMiniapp ? '小程序，遵守平台组件规范' : '桌面 Web';

  return `# ${section.name} — 样式规范 (${platform})

> ${styleCtx}

## 设计 Token
| Token | 值 | 用途 |
| :--- | :--- | :--- |
| --color-primary | #1677FF | 主色 |
| --spacing-unit | 8px | 间距单位 |
| --radius | ${isH5 ? '12' : '8'}px | 圆角 |

## 响应式断点
${isH5 ? '移动端优先，适配 375/414/768' : 
  isMiniapp ? '小程序 rpx 自适应' : '>=1920 / 1440 / 1024 / 768'}

## 动画
- 页面切换: 300ms ease-in-out
- 加载态: 骨架屏优先
`;
}

// ================================================================
// STAFFING 人员排期 + 智能分配 + 工时/优先级估算
// ================================================================

interface StaffMember {
  name: string;
  platforms: string[];
  capacity: number; // 0-100
}

interface SectionComplexity {
  apiCount: number;
  dbCount: number;
  pageCount: number;
  wordCount: number;
  complexity: 'low' | 'medium' | 'high';
  estimatedHours: number;
  priority: 'high' | 'medium' | 'low';
}

/**
 * 构建完整的 AI 智能拆分 Prompt（含 SpecCore 理念 + 粒度规则 + 完整上下文）
 */
function buildSplitPrompt(
  iteration: string,
  constitutionContent: string,
  reqContent: string,
  specContents: { name: string; content: string }[],
  staffing: StaffMember[] | null,
  teamSize: number,
  granularityLabel: string,
  granularityHint: string,
): string {
  let p = `# SpecCore AI 智能拆分\n\n`;
  p += `> 迭代: ${iteration} | 粒度: ${granularityLabel} | 生成: ${new Date().toISOString().split('T')[0]}\n\n`;

  // 技术宪法
  if (constitutionContent) {
    p += `## 📜 技术宪法 (CONSTITUTION.md)\n\n${constitutionContent.slice(0, 3000)}\n\n---\n\n`;
  }

  // 需求原文
  p += `## 📋 需求原文 (REQUIREMENT.md)\n\n${reqContent.slice(0, 5000) || '_未找到_'}\n\n---\n\n`;

  // 全部 Spec 文档
  for (const spec of specContents) {
    p += `## 📜 ${spec.name}\n\n${spec.content.slice(0, 3000)}\n\n---\n\n`;
  }

  // 团队配置
  if (staffing && staffing.length > 0) {
    p += `## 👥 团队配置 (STAFFING.md)\n\n`;
    p += `| 人员 | 擅长端 | 负荷 |\n| :--- | :--- | :--- |\n`;
    for (const m of staffing) {
      p += `| ${m.name} | ${m.platforms.join(', ')} | ${m.capacity}% |\n`;
    }
    p += `\n检测到 ${teamSize} 人团队，推荐粒度: ${granularityLabel}\n\n---\n\n`;
  }

  // 粒度说明（含硬约束）
  p += `## 🎯 拆分粒度: ${granularityLabel}\n\n`;
  p += `${granularityHint}\n\n`;
  p += `### 当前粒度硬约束（必须严格遵守）\n`;
  p += `> ⚠️ 工时约束按 **max(各端工时)** 计算，即单个开发人员的实际工作量，不是所有端的总和\n\n`;
  if (granularityLabel.includes('粗')) {
    p += `- 每人工时: 20-80h（1-2 周）\n- 接口上限: 15 个/任务\n- 数据表上限: 5 张/任务\n- 页面上限: 5 个/任务\n`;
  } else if (granularityLabel.includes('中')) {
    p += `- 每人工时: 12-40h（3-5 天）\n- 接口上限: 8 个/任务\n- 数据表上限: 3 张/任务\n- 页面上限: 3 个/任务\n`;
  } else {
    p += `- 每人工时: 4-24h（1-3 天）\n- 接口上限: 3 个/任务\n- 数据表上限: 2 张/任务\n- 页面上限: 1 个/任务\n`;
  }
  p += `\n**超出上限必须再拆，低于下限必须合并。**\n\n`;
  p += `用户可通过 --granularity macro|module|atomic 调整全局粒度。\n\n`;

  // SpecCore 拆分原则
  p += `## ⚙️ SpecCore 拆分原则\n\n`;
  p += `SpecCore 核心理念: "Code by Spec, Not by Vibe" — 每个任务必须有对应的 Spec，AI 在 Spec 约束下工作。\n\n`;

  p += `### 原子任务定义\n`;
  p += `一个原子任务 = 一个开发者在指定粒度内可独立完成的、有明确验收标准的最小工作单元。\n`;
  p += `判定标准（全部满足）:\n`;
  p += `- 有独立的输入/输出（API 接口 / 页面 / 数据表）\n`;
  p += `- _shared/ + {端}/TASK.md 能独立写满（REQ.md + TECH.md + 各端子任务）\n`;
  p += `- execute 时不强依赖其他 Task 的运行时状态\n`;
  p += `- 有明确的验收标准（AC 可枚举）\n`;
  p += `- 可独立提 PR、独立 review\n\n`;

  p += `### 合并规则（优先合并，减少任务数）\n`;
  p += `- 同一数据实体的 CRUD → 共享数据模型，合并为 1 个任务\n`;
  p += `- 页面 + 对应后端接口 < 5 个 → 前后端强耦合，一人做效率最高\n`;
  p += `- 纯配置/文案/样式微调 → 不构成独立工作单元\n`;
  p += `- 关联紧密的小功能（如列表页 + 详情页）→ 共享路由和状态\n`;
  p += `- **复杂度判断**：如果一个需求章节接口 ≤ 3、数据表 ≤ 1、预估工时 < 粒度下限 → 必须合并到最相关的任务，不单独拆\n`;
  p += `- **宁少勿多**：任务数越少越好，每个任务应该是真正独立的工作单元。如果两个功能共享数据模型或路由，一人就能做完，不要拆\n\n`;

  p += `### 拆分规则\n`;
  p += `- 超出当前粒度接口上限 → 按业务领域拆\n`;
  p += `- 超出当前粒度数据表上限 → 按数据层拆\n`;
  p += `- 超出当前粒度工时上限 → 必须再拆\n`;
  p += `- 低于当前粒度工时下限 → 合并到关联任务\n`;
  p += `- 跨端功能 → 按端拆（后端 1 个 + 每个前端各 1 个）\n`;
  p += `- 独立第三方集成（支付/短信/OSS）→ 独立任务\n\n`;

  // 聚合度分析（v6.43.0+）
  p += `### 🔍 功能聚合度分析（重要 — 拆分前必须执行）\n\n`;
  p += `对 REQUIREMENT.md 中的每个功能模块，判断它是「聚合的」还是「单端的」：\n\n`;
  p += `**聚合功能**（涉及多个端）：\n`;
  p += `- 判定标准：功能的「涉及端」列包含 2 个以上端，或功能描述中涉及多端交互\n`;
  p += `- 拆分策略：**按端拆分**，每个端一个独立 Task\n`;
  p += `  - 例：「用户登录」涉及 h5 + backend + admin → 拆成 3 个 Task：\n`;
  p += `    - Task-NNN-h5-login（h5 端登录页面 + 交互）\n`;
  p += `    - Task-NNN-backend-login（登录接口 + 鉴权 + 数据模型）\n`;
  p += `    - Task-NNN-admin-login（管理端登录入口）\n`;
  p += `  - 共享契约：\`_shared/API_CONTRACT.yaml\` 定义跨端接口\n`;
  p += `  - 每个 Task 的 scope 只包含该端，不要跨端\n\n`;
  p += `**单端功能**（只涉及一个端）：\n`;
  p += `- 直接生成 1 个 Task，scope 只包含该端\n`;
  p += `- 但仍需检查隐含跨端依赖（如 admin 页面需要 backend 提供新接口）\n`;
  p += `- 如有隐含依赖，在 dependencies 中标注，或在 scope 中加入对应端\n\n`;
  p += `**判断流程**：\n`;
  p += `1. 读 global/REQUIREMENT.md 的功能模块清单 → 查看「涉及端」列\n`;
  p += `2. 读 global/ANALYSIS.md → 确认跨端关联和数据流向\n`;
  p += `3. 读 global/TECH.md → 了解整体架构中的端交互\n`;
  p += `4. 对每个功能模块判定聚合度，决定拆分策略\n\n`;

  // 类型文档 1:1 映射规则
  p += `### 类型文档拆分规则（bugs/refactors/research）\n`;
  p += `与 feature 不同，类型文档采用 **1:1 映射**——每个文档直接对应一个任务，不拆分不合并：\n`;
  p += `- \`bugs/xxx.md\` → 1 个 bugfix 任务（一个 bug 就是一个任务，不要把多个 bug 合并）\n`;
  p += `- \`refactors/xxx.md\` → 1 个 refactor 任务\n`;
  p += `- \`research/xxx.md\` → 1 个 research 任务\n`;
  p += `- \`features/xxx.md\` → 按功能单元拆分规则处理（可能 1~3 个 feature 任务）\n`;
  p += `- **sourceFile 必须填写**：类型文档任务的 sourceFile 就是该文档的相对路径（如 \`bugs/login-timeout.md\`）\n\n`;

  p += `### 依赖关系\n`;
  p += `- 基础模块（认证/数据库/配置）优先拆出，作为第一批任务\n`;
  p += `- 依赖链深度 ≤ 3\n`;
  p += `- 同层级无循环依赖\n\n`;

  p += `### 总量约束（功能单元基准）\n`;
  p += `- 核心原则：以需求的功能单元为基准拆分，而非需求文档的章节划分\n`;
  p += `- 每个功能单元默认 1 个任务，最多 3 个\n`;
  p += `- 单次迭代总任务数**不得超过 20 个**（超出说明粒度过细，必须合并）\n`;
  p += `- 每个任务必须有明确的 owner（对应 STAFFING 中的成员）\n`;
  p += `- 高优先级任务排在前面\n`;
  p += `- 没有实质性功能内容的章节（如背景、概述、架构、术语等）不能作为拆分依据\n\n`;

  // 输出格式
  p += `## 📤 输出格式\n\n`;
  p += `请输出 JSON 数组，每个 Task 包含:\n`;
  p += '```json\n';
  p += `[\n  {\n`;
  p += `    "id": "Task-001",\n`;
  p += `    "functionalUnit": "所属功能单元/影响域（必填！见下方类型规则）",\n`;
  p += `    "name": "任务名称（中文）",\n`;
  p += `    "topic": "english-slug-for-directory",\n`;
  p += `    "type": "feature|bugfix|refactor|research",\n`;
  p += `    "reason": "为什么这样拆分",\n`;
  p += `    "scope": ["后端", "admin"],\n`;
  p += `    "apis": ["POST /api/auth/login"],\n`;
  p += `    "tables": ["users"],\n`;
  p += `    "hoursByPlatform": { "后端": 8, "admin": 8 },\n`;
  p += `    "estimatedHours": 16,\n`;
  p += `    "priority": "high|medium|low",\n`;
  p += `    "dependencies": [],\n`;
  p += `    "acceptanceCriteria": ["AC1: ..."],\n`;
  p += `    "risk": "low|medium|high",\n`;
  p += `    "owner": "建议负责人",\n`;
  p += `    "sourceFile": "来源文档路径（如 bugs/login-timeout.md、features/user-auth.md）",\n`;
  p += `    "reqContent": "需求描述内容（Markdown 格式，写入 REQ.md）",\n`;
  p += `    "techContent": "技术方案内容（Markdown 格式，写入 TECH.md）"\n`;
  p += `  }\n]\n`;
  p += '```\n\n';
  p += `> **functionalUnit 必须填写**：根据任务类型语义不同：\n`;
  p += `>   - feature → 功能模块名（如：用户管理、订单系统、支付模块）\n`;
  p += `>   - bugfix → 受影响组件/流程（如：登录流程、支付回调、数据同步）\n`;
  p += `>   - refactor → 重构目标范围（如：数据库层、API网关、状态管理）\n`;
  p += `>   - research → 研究主题（如：WebSocket方案、缓存策略）\n`;
  p += `> 同一模块/领域的任务填相同的值，用于粒度校验和任务分组\n`;
  p += `> **topic** 必须是英文短横线格式（如 \`user-authentication\`、\`product-crud\`），用于生成任务目录名 Task-NNN-{topic}\n`;
  p += `> **sourceFile** 必须填写：该任务对应的 020-specs 源文档路径（如 \`bugs/login-timeout.md\`、\`features/user-auth.md\`、\`refactors/db-pool.md\`），用于在 CONTEXT.md 中生成来源追溯\n`;
  p += `> **reqContent** 必须填写：该任务的需求描述（含业务规则、数据模型、接口定义），直接写入 REQ.md\n`;
  p += `> **techContent** 必须填写：该任务的技术方案（含架构设计、核心逻辑、测试策略），直接写入 TECH.md\n`;
  p += `> reqContent/techContent 是该任务的**子切面**，只包含该任务负责的部分，不是整个功能单元的内容\n\n`;

  p += `### ⚠️ 工时估算规则（重要）\n\n`;
  p += `- **hoursByPlatform**: 按端分别估算工时，key 对应 scope 中的端名称\n`;
  p += `- **estimatedHours**: 各端工时总和（仅用于展示，不参与粒度校验）\n`;
  p += `- **粒度校验用 max(各端工时)**：衡量「一个开发人员实际干多少」，不是总和\n`;
  p += `- 例：后端 8h + admin 8h = total 16h，但 per-person max = 8h，按 8h 判断粒度\n`;
  p += `- 同一功能的前后端各端工作必须在一个原子任务里，不要按端拆分任务\n\n`;

  // 质量自检
  p += `## ✅ 质量自检（必须全部通过）\n\n`;
  p += `□ 每个任务都满足原子任务定义？\n`;
  p += `□ 每个任务的 estimatedHours 在当前粒度范围内？（不满足 → 合并或再拆）\n`;
  p += `□ 没有循环依赖？\n`;
  p += `□ 基础模块排在前面？\n`;
  p += `□ 同功能单元内的任务没被过度拆分？（每个功能单元 ≤ 3 个任务）\n`;
  p += `□ 总任务数不超过 20 个？\n`;
  p += `□ 没有把非功能章节（背景/概述/架构/术语）作为拆分依据？\n`;
  p += `□ 每个任务都有明确的 owner 和 acceptanceCriteria？\n`;
  p += `□ 每个任务都能独立提 PR、独立 review？\n`;

  // 自动模式指令
  p += `## 🤖 自动模式指令\n\n`;
  p += `本拆分在自动模式下执行，请遵循以下原则:\n`;
  p += `1. **不要询问用户** — 按你的最佳判断直接拆分，不要请求确认或澄清\n`;
  p += `2. **有疑问就记录** — 如果对需求理解、技术选型、任务边界有疑问，不要停下来问，而是:\n`;
  p += `   - 按你的最佳判断继续拆分\n`;
  p += `   - 将疑问写入 \`.speccore/questions/split-{迭代名}-{日期}.md\`\n`;
  p += `   - 格式: \`## 疑问 N
- 问题描述
- 你的判断
- 建议后续动作\`
`;
  p += `3. **遇阻断就跳过** — 如果某个功能模块信息不足无法拆分，跳过它并在疑问清单中记录\n`;
  p += `4. **输出 JSON** — 直接输出拆分结果的 JSON 数组，不要输出其他内容\n`;

  // 持久指令（用户调整时 AI 可回读此文件）
  p += `\n## 🔄 调整指令（持久有效）\n\n`;
  p += `当用户要求调整拆分方案时（如“合并”“拆分”“改工时”“改优先级”）：\n`;
  p += `1. **先重读本文件** — 本文件包含完整的拆分规则、粒度约束、端配置、Spec 上下文\n`;
  p += `2. **在同一套规则下调整** — 合并/拆分/修改都必须遵守粒度硬约束\n`;
  p += `3. **重新输出完整 JSON** — 不要只输出修改的部分，输出调整后的完整数组\n`;
  p += `4. **文件路径**: \`.speccore/prompts/split-suggestion-${iteration}.md\`\n\n`;

  return p;
}

/**
 * 读取迭代的 STAFFING.md 人员排期配置
 */
function readStaffing(iterationDir: string): StaffMember[] | null {
  try {
    const staffingPath = join(iterationDir, 'STAFFING.md');
    if (!require('fs').existsSync(staffingPath)) return null;
    
    const content = require('fs').readFileSync(staffingPath, 'utf-8');
    const members: StaffMember[] = [];
    
    // 解析表格: | 张三 | 后台 | 70% |
    const lines = content.split('\n');
    for (const line of lines) {
      if (!line.startsWith('|') || line.includes(':---')) continue;
      const cols = line.split('|').map((c: string) => c.trim()).filter(Boolean);
      if (cols.length >= 3 && cols[0] !== '人员' && cols[0] !== '成员') {
        const capacity = parseInt(cols[2] || '100') || 100;
        members.push({
          name: cols[0],
          platforms: (cols[1] || '').split(/[,，]/).map((p: string) => p.trim()),
          capacity,
        });
      }
    }
    return members.length > 0 ? members : null;
  } catch {
    return null;
  }
}

/**
 * 根据平台和负荷自动推荐负责人
 */
function autoAssign(section: Section, platforms: string[], staffing: StaffMember[]): string {
  const targetPlatform = section.platform || '';
  if (!targetPlatform || !staffing.length) return '未分配';
  
  // 找到匹配平台的、负荷最低的人
  let best: StaffMember | null = null;
  let bestLoad = Infinity;
  
  for (const m of staffing) {
    const platformMatch = m.platforms.some(p => 
      targetPlatform.includes(p) || p.includes(targetPlatform)
    );
    if (platformMatch && m.capacity < bestLoad) {
      best = m;
      bestLoad = m.capacity;
    }
  }
  
  return best ? best.name : '未分配';
}

/**
 * 分析章节复杂度，决定优先级和工时
 */
function estimateSectionComplexity(section: Section): SectionComplexity {
  const content = section.content || '';
  const name = section.name || '';
  const full = `${name}\n${content}`;
  
  // 统计复杂度指标
  const apiCount = (full.match(/\/api\/|API|接口|endpoint|POST|GET|PUT|DELETE/gi) || []).length;
  const dbCount = (full.match(/数据库|表|DDL|schema|model|entity|索引|字段/gi) || []).length;
  const pageCount = (full.match(/页面|表单|列表|详情|弹窗|modal|dialog/gi) || []).length;
  const wordCount = full.length;
  
  // 判断复杂度
  let complexity: 'low' | 'medium' | 'high' = 'medium';
  let score = apiCount * 3 + dbCount * 2 + pageCount;
  if (score <= 3 && wordCount < 200) complexity = 'low';
  else if (score >= 10 || wordCount > 800) complexity = 'high';
  
  // 工时预估
  const estimatedHours = complexity === 'high' ? 16 : complexity === 'medium' ? 8 : 4;
  
  // 优先级
  let priority: 'high' | 'medium' | 'low' = 'medium';
  if (dbCount >= 3 || apiCount >= 5 || full.includes('核心') || full.includes('基础')) {
    priority = 'high';
  } else if (apiCount === 0 && dbCount === 0 && pageCount <= 1) {
    priority = 'low';
  }
  
  return { apiCount, dbCount, pageCount, wordCount, complexity, estimatedHours, priority };
}

/**
 * 语义依赖检测: 比字符串匹配更准确的任务间关系
 */
function detectSemanticDependencies(sections: Section[]): Map<string, string[]> {
  const deps = new Map<string, string[]>();
  
  // 关键词对: [from, to]
  const semanticPairs: [RegExp, RegExp, string][] = [
    [/订单|支付|交易/, /用户|登录|认证|鉴权/, '需要用户模块'],
    [/管理|后台|admin/, /用户|登录|认证/, '需要登录鉴权'],
    [/列表|查询|搜索/, /数据库|表|DDL|schema/, '依赖数据表'],
    [/页面|界面|UI|表单/, /API|接口|后端/, '依赖后端接口'],
    [/统计|报表|dashboard/, /列表|查询|数据/, '依赖数据查询'],
    [/通知|消息|推送|email/, /用户|人员|member/, '依赖用户数据'],
    [/文件|上传|下载|附件/, /存储|oss|s3|bucket/, '依赖存储服务'],
    [/审批|审核|workflow/, /用户|角色|权限/, '依赖用户角色'],
  ];
  
  for (let i = 0; i < sections.length; i++) {
    const si = sections[i];
    const siContent = `${si.name}\n${si.content || ''}`;
    const taskDeps: string[] = [];
    
    for (let j = 0; j < sections.length; j++) {
      if (i === j) continue;
      const sj = sections[j];
      const sjContent = `${sj.name}\n${sj.content || ''}`;
      
      // 语义匹配
      for (const [fromPat, toPat, reason] of semanticPairs) {
        if (fromPat.test(siContent) && toPat.test(sjContent)) {
          const depLabel = `${(sections[j] as any)._taskId || `Task-${String(j + 1).padStart(3, '0')}`}(${sj.name.slice(0, 10)})`;
          if (!taskDeps.includes(depLabel)) taskDeps.push(depLabel);
          break; // 每对只匹配一次
        }
      }
    }
    
    if (taskDeps.length > 0) {
      deps.set((sections[i] as any)._taskId || `Task-${String(i + 1).padStart(3, '0')}`, taskDeps);
    }
  }
  
  return deps;
}

async function detectExistingTasks(iterDir: string): Promise<string[]> {
  const tasks: string[] = [];
  // 优先从 030-tasks/ 扫描，兼容旧布局（迭代根目录）
  const scanDir = join(iterDir, '030-tasks');
  const targetDir = (await pathExists(scanDir)) ? scanDir : iterDir;
  const scanRecursive = async (dir: string) => {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          if (e.name.startsWith('Task-')) {
            tasks.push(e.name);
          } else if (!e.name.startsWith('.')) {
            // 递归扫描类型子目录（feature/bugfix/refactor/research）
            await scanRecursive(join(dir, e.name));
          }
        }
      }
    } catch {}
  };
  await scanRecursive(targetDir);
  return tasks;
}

/**
 * 生成任务总览报告 → 000-overview/TASK_SUMMARY.md
 * 包含：任务名、功能单元、人工工时、AI工时、优先级、依赖、风险
 */
async function generateTaskSummary(
  iterationDir: string,
  tasks: any[],
  createdSections: Section[],
): Promise<string> {
  const today = new Date().toISOString().split('T')[0];
  let md = `# 任务总览报告\n\n`;
  md += `> 生成时间: ${today} | 任务总数: ${createdSections.length}\n\n`;

  // 汇总表
  md += `## 任务清单\n\n`;
  md += `| # | 任务名 | 功能单元 | 人工工时 | AI工时 | 优先级 | 依赖 | 风险 |\n`;
  md += `| :--- | :--- | :--- | ---: | ---: | :---: | :--- | :---: |\n`;

  let totalHumanHours = 0;
  let totalAiHours = 0;

  for (let i = 0; i < createdSections.length; i++) {
    const task = tasks[i] || {};
    const sec = createdSections[i];
    const taskId = (sec as any)._taskId || `Task-${String(i + 1).padStart(3, '0')}`;
    const name = sec.name || task.name || '';
    const unit = task.functionalUnit || '(未标注)';
    const estimatedHours = task.estimatedHours || (sec as any)._complexity?.estimatedHours || 0;
    // AI 工时 = estimatedHours 中标注为 AI 可自动完成的部分（目前全部算 AI 工时）
    const aiHours = Math.round(estimatedHours * 0.7); // 预估 70% 可由 AI 完成
    const humanHours = estimatedHours - aiHours;
    const priority = task.priority || (sec as any)._complexity?.priority || 'medium';
    const deps = (task.dependencies || []).join(', ') || '-';
    const risk = task.risk || 'medium';

    totalHumanHours += humanHours;
    totalAiHours += aiHours;

    const priorityIcon = priority === 'high' ? '🔴' : priority === 'low' ? '🟢' : '🟡';
    const riskIcon = risk === 'high' ? '🔴' : risk === 'low' ? '🟢' : '🟡';
    md += `| ${taskId} | ${name} | ${unit} | ${humanHours}h | ${aiHours}h | ${priorityIcon} ${priority} | ${deps} | ${riskIcon} ${risk} |\n`;
  }

  // 汇总
  md += `\n## 工时汇总\n\n`;
  md += `| 指标 | 值 |\n| :--- | ---: |\n`;
  md += `| 人工总工时 | **${totalHumanHours}h** |\n`;
  md += `| AI总工时 | **${totalAiHours}h** |\n`;
  md += `| 总预估工时 | **${totalHumanHours + totalAiHours}h** |\n`;
  md += `| AI 占比 | **${totalHumanHours + totalAiHours > 0 ? Math.round(totalAiHours / (totalHumanHours + totalAiHours) * 100) : 0}%** |\n`;

  // 功能单元分布
  const unitCounts: Record<string, number> = {};
  for (const task of tasks.slice(0, createdSections.length)) {
    const unit = task.functionalUnit || '(未标注)';
    unitCounts[unit] = (unitCounts[unit] || 0) + 1;
  }
  md += `\n## 功能单元分布\n\n`;
  md += `| 功能单元 | 任务数 |\n| :--- | ---: |\n`;
  for (const [unit, count] of Object.entries(unitCounts)) {
    md += `| ${unit} | ${count} |\n`;
  }

  // 写入文件（带时间戳，放单独子目录）
  const overviewDir = join(iterationDir, '000-overview', 'task-summaries');
  await ensureDir(overviewDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16); // 2026-08-13T14-30
  const summaryPath = join(overviewDir, `TASK_SUMMARY-${timestamp}.md`);
  await writeFile(summaryPath, md);

  return md;
}

/**
 * 输出 [SPECCORE_NEXT_STEPS] 标记，引导宿主 AI 对每个 Task 执行 analyze --task
 * split 完成后调用，生成任务级 00-specs/ 文档
 */
function outputAnalyzeTaskHints(iteration: string, sections: Section[]): void {
  if (sections.length === 0) return;
  const iterFlag = iteration ? ` -I ${iteration}` : '';
  let md = `\n## 🧠 下一步：任务级 Spec 分析\n\n`;
  md += `拆分完成！每个 Task 需要执行 AI 分析，生成任务级 00-specs/ 文档（REQ.md、TECH.md、TASK.md、SCHEMA.md）。\n\n`;
  md += `AI 会 Read global/ 和 {端}/ 的全局 spec 作为参考，根据本 Task 的原子范围生成针对性分析。\n\n`;
  md += `### 执行命令\n\n`;
  for (const sec of sections) {
    const taskId = (sec as any)._taskId || sec.name;
    md += `\`\`\`bash
speccore analyze --task ${taskId}${iterFlag}
\`\`\`

`;
  }
  md += `> 自动模式可逐个执行，或告诉 AI：“对所有新建 Task 执行 analyze --task”\n`;
  process.stdout.write('\n[SPECCORE_NEXT_STEPS]\n');
  process.stdout.write(md);
  process.stdout.write('\n[/SPECCORE_NEXT_STEPS]\n');
}

// ── v6.49.14+: 模块驱动拆分 — 从 global/REQUIREMENT.md 读取涉及端 ──

/**
 * 从 global/REQUIREMENT.md 解析功能模块清单的「涉及端」列
 * 返回模块列表及其涉及的标准端名
 */
function parseModulePlatforms(content: string, allPlatforms: string[]): { name: string; platforms: string[] }[] {
  const modules: { name: string; platforms: string[] }[] = [];
  const lines = content.split('\n');
  let inFeatureTable = false;
  let platformColIdx = -1;

  for (const line of lines) {
    // 检测功能模块清单表格开始
    if (line.includes('功能模块清单')) {
      inFeatureTable = true;
      continue;
    }
    if (!inFeatureTable) continue;

    // 检测下一个 ## 标题 → 表格结束
    if (line.startsWith('## ') && !line.includes('功能模块清单')) {
      break;
    }

    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;

    // 表头行 → 找到「涉及端」列索引
    if (cells.some(c => c.includes('涉及端'))) {
      platformColIdx = cells.findIndex(c => c.includes('涉及端'));
      continue;
    }
    // 分隔行跳过
    if (cells.every(c => /^[-:]+$/.test(c))) continue;

    // 数据行
    const moduleName = cells[1]; // 第2列通常是模块名
    if (!moduleName || moduleName === '#' || moduleName === '模块') continue;

    if (platformColIdx >= 0 && platformColIdx < cells.length) {
      const raw = cells[platformColIdx];
      if (raw && raw !== '_待 AI 标注_' && raw !== '—' && raw !== '-') {
        const platforms = raw.split(/[,，]/)
          .map(p => p.trim())
          .filter(p => p && allPlatforms.includes(p));
        if (platforms.length > 0) {
          modules.push({ name: moduleName, platforms });
          continue;
        }
      }
    }
    // 涉及端为空或无法解析 → 回退全端
    modules.push({ name: moduleName, platforms: [...allPlatforms] });
  }
  return modules;
}

/**
 * 尝试模块驱动拆分：从功能模块创建任务目录结构
 * 成功返回 true，无功能模块时返回 false（回退到传统流程）
 */
async function tryModuleDrivenSplit(
  iteration: string, iterationDir: string, options: IterationSplitOptions
): Promise<boolean> {
  const reqDir = join(iterationDir, '010-requirements');
  const allPlatforms = await detectPlatforms(iterationDir);

  // 收集功能模块（含涉及端信息）
  const modules: { name: string; slug: string; type: string; sourceFile: string; platforms: string[] }[] = [];

  // 1. 优先从 global/REQUIREMENT.md 读取功能模块清单（含涉及端）
  const globalReqPath = join(iterationDir, '020-specs', GLOBAL_SPECS_DIR, 'REQUIREMENT.md');
  let modulePlatformsParsed = false;
  if (await pathExists(globalReqPath)) {
    try {
      const content = await readFile(globalReqPath, 'utf-8');
      const parsed = parseModulePlatforms(content, allPlatforms);
      if (parsed.length > 0) {
        for (const m of parsed) {
          modules.push({
            name: m.name,
            slug: slugify(m.name),
            type: 'feature',
            sourceFile: 'global/REQUIREMENT.md',
            platforms: m.platforms,
          });
        }
        modulePlatformsParsed = true;
        logger.info(`   📋 从 global/REQUIREMENT.md 读取到 ${parsed.length} 个功能模块（含涉及端）`);
      }
    } catch {}
  }

  // 2. 回退：读取 features/*/README.md（无涉及端信息，使用全端）
  if (!modulePlatformsParsed) {
    const featuresDir = join(reqDir, 'features');
    if (await pathExists(featuresDir)) {
      try {
        const entries = await readdir(featuresDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const readmePath = join(featuresDir, entry.name, 'README.md');
            if (await pathExists(readmePath)) {
              modules.push({
                name: entry.name, slug: slugify(entry.name), type: 'feature',
                sourceFile: `features/${entry.name}/README.md`,
                platforms: [...allPlatforms],
              });
            }
          }
        }
      } catch {}
    }
  }

  // 3. 读取类型文档（bugs/refactors/research）
  for (const typeDir of ['bugs', 'refactors', 'research']) {
    const typeDirPath = join(reqDir, typeDir);
    if (!(await pathExists(typeDirPath))) continue;
    try {
      const entries = await readdir(typeDirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md') && !isTimestampBackup(entry.name)) {
          const slug = slugify(entry.name.replace('.md', ''));
          const taskType = typeDir === 'bugs' ? 'bugfix' : typeDir;
          modules.push({
            name: entry.name.replace('.md', ''), slug, type: taskType,
            sourceFile: `${typeDir}/${entry.name}`,
            platforms: [...allPlatforms],
          });
        }
      }
    } catch {}
  }

  if (modules.length === 0) {
    return false; // 无功能模块，回退到传统流程
  }

  // 检测已有任务
  const existingTasks = await detectExistingTasks(iterationDir);
  if (existingTasks.length > 0 && !options.force) {
    logger.warn(`   ⚠️  已有 ${existingTasks.length} 个任务: ${existingTasks.slice(0, 5).join(', ')}...`);
    logger.info('   使用 --force 强制覆盖');
    return true; // 已处理，不继续传统流程
  }

  // --force 清理旧任务
  if (options.force) {
    const tasksRoot = join(iterationDir, '030-tasks');
    if (await pathExists(tasksRoot)) {
      const entries = await readdir(tasksRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await remove(join(tasksRoot, entry.name));
        }
      }
      logger.info(`   🗑️  已清理旧任务目录`);
    }
  }

  logger.info(`\n📦 模块驱动拆分: ${modules.length} 个功能模块`);
  logger.info(`   全局端列表: ${allPlatforms.join(', ')}`);

  // 逐模块创建任务目录（按模块各自的涉及端）
  const createdSections: Section[] = [];
  for (const mod of modules) {
    const { id: taskId } = await nextTaskId(mod.name, mod.slug);
    const modPlatforms = mod.platforms.length > 0 ? mod.platforms : [...allPlatforms];

    const section: Section = {
      name: mod.name,
      content: '',
      level: 2,
    };
    (section as any)._topic = mod.slug;
    (section as any)._taskType = mod.type;
    (section as any)._sourceFile = mod.sourceFile;
    (section as any)._scopePlatforms = modPlatforms;
    (section as any)._complexity = {
      estimatedHours: 8,
      hoursByPlatform: {},
      priority: 'medium',
      complexity: 'medium',
      apiCount: 0,
      dbCount: 0,
      pageCount: 0,
      wordCount: 0,
    };
    (section as any)._owner = '未分配';
    (section as any)._taskId = taskId;
    (section as any).functionalUnit = mod.name;

    await createTaskFromSection(iterationDir, taskId, section, modPlatforms, mod.type, []);
    createdSections.push(section);
    logger.info(`   ✅ 创建: ${taskId} [${mod.type}] — ${mod.name} (${modPlatforms.length} 个端: ${modPlatforms.join(', ')})`);
  }

  // 生成任务总览
  if (createdSections.length > 0) {
    await generateImpactGraph(iterationDir, createdSections, allPlatforms);
    logger.info(`\n   📊 创建了 ${createdSections.length} 个任务（每端一个子任务）`);

    // 生成内容填充提示
    const fillPrompt = buildContentFillingPrompt(iteration, iterationDir, createdSections, allPlatforms);
    const promptsDir = join('.speccore', 'prompts');
    await ensureDir(promptsDir);
    await writeFile(join(promptsDir, `split-content-${iteration}.md`), fillPrompt);
    logger.info(`   📝 内容填充提示 → .speccore/prompts/split-content-${iteration}.md`);
  }

  logger.success(`✅ 模块驱动拆分完成: ${createdSections.length} 个任务`);

  // 自动刷新知识图谱
  try {
    const { refreshKnowledgeGraph } = await import('../../core/knowledge-graph');
    await refreshKnowledgeGraph(process.cwd(), iteration);
    logger.info('🧠 知识图谱已刷新');
  } catch {}

  return true;
}

/**
 * 生成内容填充 Prompt — AI 为预创建的任务填充 REQ.md/TECH.md
 */
function buildContentFillingPrompt(
  iteration: string,
  iterationDir: string,
  sections: Section[],
  allPlatforms: string[],
): string {
  let p = `# 任务内容填充（模块驱动拆分）\n\n`;
  p += `> 迭代: ${iteration} | 任务数: ${sections.length} | 端: ${allPlatforms.join(', ')}\n\n`;

  p += `## 说明\n\n`;
  p += `CLI 已按功能模块×端创建了任务目录结构。每个任务目录下已有子任务目录（含 .meta/、TASK.md 等）。\n`;
  p += `你的任务是为每个子任务填充 REQ.md 和 TECH.md。\n\n`;

  p += `## 上下文\n\n`;
  p += `1. Read .speccore/CONSTITUTION.md — 项目配置\n`;
  p += `2. Read 020-specs/global/REQUIREMENT.md — 全局需求规格\n`;
  p += `3. Read 020-specs/global/ANALYSIS.md — 全局分析报告\n`;
  p += `4. Read 020-specs/global/TECH.md — 整体技术架构\n`;
  p += `5. Read 020-specs/{端}/TECH.md — 各端专属技术方案\n\n`;

  p += `## 任务清单\n\n`;
  for (const sec of sections) {
    const taskId = (sec as any)._taskId || sec.name;
    const sourceFile = (sec as any)._sourceFile || '';
    const featureName = (sec as any).functionalUnit || sec.name;
    const modPlatforms: string[] = (sec as any)._scopePlatforms || allPlatforms;
    p += `### ${taskId} — ${sec.name}\n`;
    p += `- 功能单元: ${featureName}\n`;
    p += `- 涉及端: ${modPlatforms.join(', ')}\n`;
    if (sourceFile) p += `- 来源: 010-requirements/${sourceFile}\n`;
    p += `- 子任务目录: ${modPlatforms.map(pl => `${pl}/`).join(', ')}\n`;
    p += `- 需要填充:\n`;
    for (const platform of modPlatforms) {
      p += `  - ${platform}/*/REQ.md — 子任务需求规格\n`;
      p += `  - ${platform}/*/TECH.md — 子任务技术方案\n`;
    }
    p += `\n`;
  }

  p += `## 填充规则\n\n`;
  p += `1. 先 Read 子任务目录下的 TASK.md（已有基本信息）和 .meta/feature（功能单元名）\n`;
  p += `2. REQ.md: 根据全局需求文档，撰写本子任务的需求规格（验收标准、业务规则、边界条件）\n`;
  p += `3. TECH.md: 根据全局 TECH.md，细化本子任务的技术方案（接口定义、数据模型、核心逻辑）\n`;
  p += `4. 用 Write 工具直接写入对应路径\n`;
  p += `5. 同一功能模块的各端子任务要保持 API 契约一致\n`;
  p += `6. 禁止产出垃圾内容——每个文件必须有实质性专业内容\n\n`;

  p += `## ⚠️ 绝对禁止\n\n`;
  p += `- 不要创建新目录 — 目录已由 CLI 创建\n`;
  p += `- 不要修改 .meta/ 下的文件\n`;
  p += `- 不要修改 TASK.md（已由 CLI 生成）\n`;
  p += `- 只写 REQ.md 和 TECH.md\n`;

  p += '\n' + buildAutoModeInstruction('split', iteration) + '\n';

  return p;
}
