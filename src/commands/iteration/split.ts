import { ensureDir, writeFile, pathExists, readFile, readdir, remove } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../../utils/logger';
import { getDefaultIteration, getIterationDir } from '../../core/context';
import { scoreRisk, generateRiskReport } from '../../core/risk-scorer';
import { nextTaskId } from '../../core/global-counters';
import { backupWithTimestamp } from '../../utils/task-utils';

import { showNextSteps } from '../../core/next-steps';
import { createInterface } from 'readline';
import { buildPrompt, formatPrompt } from '../../core/prompt-builder';

/** 将名称转为目录安全的短 slug（2-4 词） */
function slugify(name: string): string {
  return name
    .replace(/[\u4e00-\u9fff]/g, '') // 去掉中文
    .replace(/[^a-zA-Z0-9\s-]/g, '')  // 去特殊字符
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)                       // 最多 3 词
    .join('-')
    .toLowerCase() || 'task';
}

/** 粒度约束常量 */
const GRANULARITY_RULES = {
  macro:  { label: '粗粒度 (macro)', minHours: 20, maxHours: 80, maxApis: 15, maxTables: 5, maxPages: 5, desc: '每个任务 1-2 周，按业务方向合并' },
  module: { label: '中粒度 (module)', minHours: 12, maxHours: 40, maxApis: 8,  maxTables: 3, maxPages: 3, desc: '每个任务 3-5 天，按功能/端拆分' },
  atomic: { label: '细粒度 (atomic)', minHours: 4,  maxHours: 24, maxApis: 3,  maxTables: 2, maxPages: 1, desc: '每个任务 1-3 天，按接口/表拆分' },
} as const;
type Granularity = keyof typeof GRANULARITY_RULES;

/** 校验任务工时是否在粒度范围内 */
function validateGranularity(gran: Granularity, hours: number, apiCount: number, tableCount: number) {
  const rule = GRANULARITY_RULES[gran];
  const warnings: string[] = [];
  if (hours > rule.maxHours) warnings.push(`⚠️  工时 ${hours}h 超出上限 ${rule.maxHours}h → 建议再拆`);
  else if (hours < rule.minHours) warnings.push(`⚠️  工时 ${hours}h 低于下限 ${rule.minHours}h → 建议合并到关联任务`);
  if (apiCount > rule.maxApis) warnings.push(`⚠️  接口 ${apiCount} 个超出上限 ${rule.maxApis} → 建议按业务领域拆分`);
  if (tableCount > rule.maxTables) warnings.push(`⚠️  数据表 ${tableCount} 张超出上限 ${rule.maxTables} → 建议按数据层拆分`);
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
  
  // 1. 优先从 CONSTITUTION.md 读取「对应需求端」配置
  const constitutionPath = join('.speccore', 'CONSTITUTION.md');
  if (await pathExists(constitutionPath)) {
    const content = await readFile(constitutionPath, 'utf-8');
    const lines = content.split('\n');
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('对应需求端')) { headerIdx = i; break; }
    }
    if (headerIdx >= 0) {
      const headers = lines[headerIdx].split('|').map(h => h.trim()).filter(Boolean);
      const platformColIdx = headers.findIndex(h => h.includes('对应需求端'));
      if (platformColIdx >= 0) {
        const platforms = new Set<string>();
        for (let i = headerIdx + 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line.startsWith('|') || line.match(/^\|\s*[-:]/)) continue;
          const cells = line.split('|').map(c => c.trim()).filter(Boolean);
          if (cells[platformColIdx]) {
            cells[platformColIdx].split(',').forEach((p: string) => {
              const trimmed = p.trim();
              if (trimmed && !trimmed.startsWith('>')) platforms.add(trimmed);
            });
          }
        }
        if (platforms.size > 0) return [...platforms];
      }
    }
  }

  // 2. 回退：扫描 020-specs/ 子目录
  const specsDir = join(iterationDir, '020-specs');
  if (await pathExists(specsDir)) {
    const entries = await readdir(specsDir, { withFileTypes: true });
    const platforms = entries
      .filter((e: any) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
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
            priority: task.priority || 'medium',
            complexity: task.risk === 'high' ? 'high' : task.risk === 'low' ? 'low' : 'medium',
            apiCount: (task.apis || []).length,
            dbCount: (task.tables || []).length,
            pageCount: 0,
            wordCount: content.length,
          };
          (section as any)._owner = task.owner || '未分配';
          (section as any)._taskType = (task.type && ['feature', 'bugfix', 'refactor', 'research'].includes(task.type)) ? task.type : 'feature';
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
        const isInteractive = process.stdin.isTTY; // 非 TTY（管道调用）时自动确认
        logger.info(`   📏 粒度: ${granRule.label}${options.granularity ? ' (用户指定)' : ` (${teamSize2} 人团队自动推荐)`}`);
        if (!isInteractive) logger.info('   ℹ️  非交互终端，自动确认所有任务');

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
          logger.info(`   🏷  类型: ${taskType} | ⏱ 预估: ${complexity.estimatedHours}h | 🎯 优先级: ${complexity.priority || 'medium'}`);
          if (complexity.apiCount) logger.info(`   🔌 接口: ${complexity.apiCount} 个 | 🗄 数据表: ${complexity.dbCount || 0} 张`);
          if (deps.length > 0) logger.info(`   🔗 依赖: ${deps.join(', ')}`);
          if (acs.length > 0) {
            logger.info(`   ✅ 验收标准:`);
            for (const ac of acs.slice(0, 5)) logger.info(`      ${ac}`);
          }

          // 粒度校验
          const warnings = validateGranularity(granularity, complexity.estimatedHours || 8, complexity.apiCount || 0, complexity.dbCount || 0);
          if (warnings.length > 0) {
            for (const w of warnings) logger.warn(`   ${w}`);
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

          const { id: taskId } = await nextTaskId(sec.name);
          (sec as any)._taskId = taskId;
          await createTaskFromSection(iterDirFull, taskId, sec, allPlatforms, taskType);
          createdSections.push(sec);
          logger.info(`   ✅ 创建: ${taskId} - [${taskType}] ${sec.name}`);
        }

        if (createdSections.length > 0) {
          await generateImpactGraph(iterDirFull, createdSections, allPlatforms);
          await updateProjectGraph(iterDirFull, createdSections);
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
    return;
  }

  const spinner = new Spinner('Splitting requirements into tasks');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('No active iteration found. Please specify --iteration or create one first.');
      return;
    }

    const iterationDir = await getIterationDir(iteration);

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
      const reqPath2 = join(iterationDir, '020-specs', 'REQUIREMENT.md');
      let reqContent2 = '';
      if (await pathExists(reqPath2)) {
        reqContent2 = await readFile(reqPath2, 'utf-8');
      }
      
      const specDir2 = join(iterationDir, '020-specs');
      const specContents: { name: string; content: string }[] = [];
      for (const f of ['ANALYSIS.md', 'TECH.md', 'TEST.md', 'REVIEW.md', 'RISK.md', 'DEPS.md', 'MONITOR.md']) {
        const fp = join(specDir2, f);
        if (await pathExists(fp)) {
          const content = await readFile(fp, 'utf-8');
          if (content.trim().length > 50 && !content.trim().match(/^#+\s*\u5f85\u586b\u5145|^<!--\s*AI-FILL/m)) {
            specContents.push({ name: f, content });
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
      const { id: taskId } = await nextTaskId(section.name);
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
        await createTaskFromSection(iterationDir, taskId, section, platforms, (section as any)._taskType);
      }
      spinner.stop(`✅ 创建了 ${approved.length} 个任务`);
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
            await createTaskFromSection(iterationDir, taskId, sections[i], platforms, (sections[i] as any)._taskType);
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
        }
        return;
      }

      // Default: create all
      for (let i = 0; i < sections.length; i++) {
        const taskId = (sections[i] as any)._taskId;
        await createTaskFromSection(iterationDir, taskId, sections[i], platforms, (sections[i] as any)._taskType);
      }
      await generateImpactGraph(iterationDir, sections, platforms);
      await generateEnvExample(iterationDir, sections);
      await updateProjectGraph(iterationDir, sections);
      spinner.stop(`✅ 创建了 ${sections.length} 个任务`);
      showNextSteps('split');
      return;
    }

    // Create tasks（使用预分配的 ID）
    for (let i = 0; i < sections.length; i++) {
      const taskId = (sections[i] as any)._taskId;
      await createTaskFromSection(iterationDir, taskId, sections[i], platforms, (sections[i] as any)._taskType);
    }

    // ── Generate impact graph + risk scores ──
    await generateImpactGraph(iterationDir, sections, platforms);

    // ── Generate .env.example for the iteration ──
    await generateEnvExample(iterationDir, sections);

    // Update PROJECT_GRAPH.md
    await updateProjectGraph(iterationDir, sections);

    spinner.stop(`Created ${sections.length} tasks from requirements`);
    
    showNextSteps('split');
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
];

function filterTemplateNoise(sections: Section[]): Section[] {
  return sections.filter(s => {
    // Skip sections matching template patterns
    for (const pattern of TEMPLATE_PATTERNS) {
      if (pattern.test(s.name)) return false;
    }
    // Skip sections with effectively empty content
    const meaningful = (s.content || '').replace(/[\s\n>#*-|]/g, '').length;
    if (meaningful < 3) return false;
    // Skip sections without API tables (structural headings)
    return true;
  });
}

async function createTaskFromSection(iterationDir: string, taskId: string, section: Section, allPlatforms: string[], taskType: string = 'feature'): Promise<void> {
  // taskId 已含 slug（nextTaskId 返回 Task-NNN-slug），直接用
  const taskDir = join(iterationDir, '030-tasks', taskType, taskId);
  const taskPlatforms = (section as any)._scopePlatforms || (section.platform ? [section.platform] : allPlatforms);
  const complexity = (section as any)._complexity as SectionComplexity || { estimatedHours: 2, priority: 'medium' as const, complexity: 'medium' as const, apiCount: 0, dbCount: 0, pageCount: 0, wordCount: 0 };
  const owner = (section as any)._owner || '未分配';
  const today = new Date().toISOString().split('T')[0];

  // ── 1. 元信息目录 ──
  await ensureDir(join(taskDir, '.meta'));
  await writeFile(join(taskDir, '.meta', 'type'), taskType);
  await writeFile(join(taskDir, '.meta', 'status'), 'todo');
  await writeFile(join(taskDir, '.meta', 'owner'), owner);
  await writeFile(join(taskDir, '.meta', 'created-at'), today);

  // ── 2. 任务目录指引 ──
  await writeFile(
    join(taskDir, 'README.md'),
    `# ${section.name}

> 任务目录使用指引

## 目录结构

\`\`\`
${taskId}/
├── README.md              <-- 本文件（目录指引）
├── .meta/                 <-- 任务元信息（type/status/owner/created-at）
├── _shared/               <-- 共享契约（API_CONTRACT.yaml）
├── 00-specs/              <-- 执行前核心规格（AI 执行时必读）
│   ├── REQ.md             <-- 需求描述（API + 数据模型 + 业务规则）
│   ├── TECH.md            <-- 技术方案（架构/接口设计/数据模型/核心逻辑）
│   ├── TASK.md            <-- 任务执行追踪（状态/负责人/产出物清单）
│   ├── SCHEMA.md          <-- 数据库设计（Entity/DDL/索引）
│   └── CHANGELOG.md       <-- 变更记录
├── 10-backend/            <-- 后端实现（src/tests）
├── 20-frontend/           <-- 前端实现（{platform}/src/tests）
├── 99-artifacts/          <-- 执行产出
│   ├── 🔒 自检门禁（verify 自动读取验证）
│   │   ├── TEST.md         <-- 测试用例（verify 检查覆盖率）
│   │   ├── REVIEW.md       <-- 评审清单（verify 检查合规性）
│   │   ├── DEPLOY.md       <-- 部署清单（verify 检查部署项）
│   │   └── ERROR_CODES.md  <-- 错误码表（verify 检查一致性）
│   └── 📚 参考文档（AI/人参考，不参与自动验证）
│       ├── RISK.md         <-- 风险评估
│       ├── DEPS.md         <-- 依赖清单
│       ├── MONITOR.md      <-- 监控配置
│       └── ADR.md          <-- 架构决策记录
└── .issues.md             <-- 问题追踪
\`\`\`

## AI 执行时读取规则

运行 \`speccore execute -t ${taskId}\` 时，AI 会按以下顺序读取本文档：

### 必读文件（自动嵌入 AI Prompt）

| 文件 | 用途 |
|:---|:---|
| \`00-specs/REQ.md\` | 需求描述、API 列表、数据模型、业务规则 |
| \`00-specs/TECH.md\` | 技术方案、架构设计、接口分层、核心逻辑 |
| \`00-specs/TASK.md\` | 任务信息、状态追踪、产出物清单 |
| \`00-specs/SCHEMA.md\` | 数据库表结构、字段、索引（如有） |
| \`.speccore/CONSTITUTION.md\` | 技术栈、命名规范、异常码体系 |

### 参考文件（AI 按需查阅）

| 文件 | 用途 | verify 自检？ |
|:---|:---|:---|
| \`99-artifacts/TEST.md\` | 测试计划（用例/边界/集成） | ✅ 检查用例覆盖率 |
| \`99-artifacts/REVIEW.md\` | 评审清单（安全/质量/性能） | ✅ 检查评审项合规 |
| \`99-artifacts/RISK.md\` | 风险评估 | ❌ 仅参考 |
| \`_shared/API_CONTRACT.yaml\` | API 契约（OpenAPI 格式） | ❌ 仅参考 |
| \`.issues.md\` | 已知问题和约束 | ❌ 仅参考 |

### 不会被 AI 读取的文件

- \`10-backend/\` 和 \`20-frontend/\` 下的源码 —— 这是 AI **输出**代码的地方
- \`99-artifacts/DEPLOY.md\`、\`ERROR_CODES.md\` 等 —— 执行完成后自动更新

## 如何让 AI 读到你补充的文档？

**推荐做法：** 把你的补充内容写到对应的规范文件里：

- 补充需求细节 → 写到 \`00-specs/REQ.md\`
- 补充技术方案 → 写到 \`00-specs/TECH.md\`
- 补充数据库设计 → 写到 \`00-specs/SCHEMA.md\`
- 记录已知问题/约束 → 写到 \`.issues.md\`

AI 执行时会自动读取这些文件，作为生成代码的依据。
`
  );

  // ── 3. 共享契约 ──
  await ensureDir(join(taskDir, '_shared'));
  const contractYaml = generateApiContract(section);
  if (contractYaml) {
    await writeFile(join(taskDir, '_shared', 'API_CONTRACT.yaml'), contractYaml);
  }

  // ── 3. 执行前核心规格 00-specs/ ──
  await ensureDir(join(taskDir, '00-specs'));

  const acItems = generateAcceptanceCriteria(section);
  await writeFile(
    join(taskDir, '00-specs', 'REQ.md'),
    `# ${section.name}

## 需求描述

${section.content}

## 验收标准

${acItems}
`
  );

  const apiLines = section.content.split('\n').filter(l => l.includes('| GET') || l.includes('| POST') || l.includes('| PUT') || l.includes('| DELETE') || l.includes('| PATCH'));
  const apiDesc = apiLines.length > 0 ? apiLines.map(l => `- ${l.trim()}`).join('\n') : '- 待补充（从 REQ.md 提取接口列表）';
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
`
  );

  if (section.content.match(/数据库|数据表|表结构|DDL|ALTER|建表|索引/)) {
    await writeFile(join(taskDir, '00-specs', 'SCHEMA.md'), generateSchemaTemplate(section));
  }

  await writeFile(
    join(taskDir, '00-specs', 'TASK.md'),
    `# ${section.name}

## 任务信息
- 类型: ${taskType}
- 状态: 🔲 待开发
- 优先级: ${complexity.priority}
- 负责人: ${owner}
- 预计耗时: ${complexity.estimatedHours}h${complexity.complexity !== 'medium' ? ` (${complexity.complexity === 'high' ? '高复杂度' : '低复杂度'})` : ''}
- 复杂度: API ${complexity.apiCount} | DB ${complexity.dbCount} | 页面 ${complexity.pageCount}

## 变更履历
| 时间 | 变更内容 | 变更人 |
| :--- | :--- | :--- |
| ${today} | 创建任务 | CLI |

## 产出物清单
| 产出物 | 状态 | 路径 | verify 自检？ |
| :--- | :--- | :--- | :--- |
| REQ.md | ✅ | ./00-specs/REQ.md | ✅ Spec 一致性 |
| TECH.md | ✅ | ./00-specs/TECH.md | — |
| TASK.md | ✅ | ./00-specs/TASK.md | — |
| SCHEMA.md | ⏳ | ./00-specs/SCHEMA.md | — |
| API_CONTRACT.yaml | ✅ | ./_shared/API_CONTRACT.yaml | — |
| TEST.md | ⏳ | ./99-artifacts/TEST.md | ✅ 用例覆盖率 |
| REVIEW.md | ⏳ | ./99-artifacts/REVIEW.md | ✅ 评审项合规 |
| DEPLOY.md | ⏳ | ./99-artifacts/DEPLOY.md | ✅ 部署项检查 |
| ERROR_CODES.md | ⏳ | ./99-artifacts/ERROR_CODES.md | ✅ 错误码一致性 |
| ADR.md | ⏳ | ./99-artifacts/ADR.md | ❌ 仅参考 |
| RISK.md | ⏳ | ./99-artifacts/RISK.md | ❌ 仅参考 |
| DEPS.md | ⏳ | ./99-artifacts/DEPS.md | ❌ 仅参考 |
| MONITOR.md | ⏳ | ./99-artifacts/MONITOR.md | ❌ 仅参考 |
| CHANGELOG.md | ✅ | ./00-specs/CHANGELOG.md | — |
`
  );

  await writeFile(
    join(taskDir, '00-specs', 'CHANGELOG.md'),
    `# ${section.name} - 变更记录

| 时间 | 版本 | 变更内容 | 变更人 |
| :--- | :--- | :--- | :--- |
| ${today} | v1.0 | 初始创建 | CLI |
`
  );

  // API_CONTRACT.yaml（按接口）统一放 _shared/
  if (apiLines.length > 0) {
    const contracts = apiLines.map(l => {
      const parts = l.split('|').map(p => p.trim()).filter(Boolean);
      const method = (parts[0] || 'GET').toUpperCase();
      const path = parts[1] || '/api/unknown';
      const desc = parts[2] || path;
      return `  ${path}:\n    ${method}:\n      summary: "${desc}"\n      description: "<!-- AI-FILL -->"`;
    }).join('\n');
    await writeFile(join(taskDir, '_shared', 'API_CONTRACT.yaml'),
      `# ${section.name} - API Contract\n# Auto-generated from split\n\npaths:\n${contracts}\n`
    );
  }

  // ── 4. 执行产出 99-artifacts/ ──
  await ensureDir(join(taskDir, '99-artifacts'));
  await writeFile(join(taskDir, '99-artifacts', 'TEST.md'), generateTestOutline(section));
  await writeFile(join(taskDir, '99-artifacts', 'REVIEW.md'), generateReviewChecklist(section));
  await writeFile(join(taskDir, '99-artifacts', 'DEPLOY.md'), generateDeployChecklist(section));
  await writeFile(join(taskDir, '99-artifacts', 'ERROR_CODES.md'), generateErrorCodes(section));
  await writeFile(join(taskDir, '99-artifacts', 'RISK.md'), generateRiskTemplate(section));
  await writeFile(join(taskDir, '99-artifacts', 'DEPS.md'), generateDepsTemplate(section));
  await writeFile(join(taskDir, '99-artifacts', 'MONITOR.md'), generateMonitorTemplate(section));

  const adr = generateAdr(section);
  if (adr) {
    await writeFile(join(taskDir, '99-artifacts', 'ADR.md'), adr);
  }

  // ── 5. 实现目录 10-backend/ 20-frontend/ ──
  for (const platform of taskPlatforms) {
    if (platform === 'backend') {
      // 纯后端任务：直接创建 10-backend/src/ 和 10-backend/tests/
      await ensureDir(join(taskDir, '10-backend', 'src'));
      await ensureDir(join(taskDir, '10-backend', 'tests'));
    } else if (platform.startsWith('后台')) {
      // 后台服务任务：创建 10-backend/{service}/src/ 和 tests/
      const service = platform.replace(/^后台/, '').trim() || 'default';
      await ensureDir(join(taskDir, '10-backend', service, 'src'));
      await ensureDir(join(taskDir, '10-backend', service, 'tests'));
    } else {
      // 前端任务：创建 20-frontend/{platform}/src/ 和 tests/
      await ensureDir(join(taskDir, '20-frontend', platform, 'src'));
      await ensureDir(join(taskDir, '20-frontend', platform, 'tests'));
    }
  }
  if (!taskPlatforms.some((p: string) => p === 'backend' || p.startsWith('后台'))) {
    await ensureDir(join(taskDir, '10-backend', 'src'));
    await ensureDir(join(taskDir, '10-backend', 'tests'));
  }

  // ── 6. 平台目录内复制核心规格 ──
  const reqContent = await readFile(join(taskDir, '00-specs', 'REQ.md'), 'utf-8');
  const techContent = await readFile(join(taskDir, '00-specs', 'TECH.md'), 'utf-8');
  const taskContent = await readFile(join(taskDir, '00-specs', 'TASK.md'), 'utf-8');
  const testContent = await readFile(join(taskDir, '99-artifacts', 'TEST.md'), 'utf-8');
  const reviewContent = await readFile(join(taskDir, '99-artifacts', 'REVIEW.md'), 'utf-8');

  for (const platform of taskPlatforms) {
    if (platform === 'backend') {
      // 纯后端任务：规格写入 10-backend/ 根目录
      await writeFile(join(taskDir, '10-backend', 'REQ.md'), reqContent);
      await writeFile(join(taskDir, '10-backend', 'TECH.md'), techContent);
      await writeFile(join(taskDir, '10-backend', 'TASK.md'), taskContent);
      await writeFile(join(taskDir, '10-backend', 'TEST.md'), testContent);
      await writeFile(join(taskDir, '10-backend', 'REVIEW.md'), reviewContent);
    } else if (platform.startsWith('后台')) {
      // 后台服务任务：规格写入 10-backend/{service}/
      const service = platform.replace(/^后台/, '').trim() || platform;
      const svcDir = join(taskDir, '10-backend', service);
      await ensureDir(svcDir);
      await writeFile(join(svcDir, 'REQ.md'), reqContent);
      await writeFile(join(svcDir, 'TECH.md'), techContent);
      await writeFile(join(svcDir, 'TASK.md'), taskContent);
      await writeFile(join(svcDir, 'TEST.md'), testContent);
      await writeFile(join(svcDir, 'REVIEW.md'), reviewContent);
    } else {
      // 前端任务：规格写入 20-frontend/{platform}/
      const feDir = join(taskDir, '20-frontend', platform);
      await ensureDir(feDir);
      await writeFile(join(feDir, 'REQ.md'), reqContent);
      await writeFile(join(feDir, 'TASK.md'), taskContent);
      await writeFile(join(feDir, 'TEST.md'), testContent);
      await writeFile(join(feDir, 'REVIEW.md'), reviewContent);
      await writeFile(join(feDir, 'README.md'), `# ${section.name} - ${platform}\n\n前端实现目录。\n`);
      await writeFile(join(feDir, 'COMPONENT_TREE.md'), generateComponentTree(section, platform));
      await writeFile(join(feDir, 'ROUTES.md'), generateRoutesDoc(section, platform));
      await writeFile(join(feDir, 'STATE.md'), generateStateDoc(section, platform));
      await writeFile(join(feDir, 'STYLE_GUIDE.md'), generateStyleGuide(section, platform));
    }
  }

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
function generateTestOutline(section: Section): string {
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
      ? (s.platform.startsWith('后台') ? `backend/${s.platform.replace(/^后台/, '')}` : `20-frontend/${s.platform}`)
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
      // 生成风险报告并嵌入 TASK.md（去重：只写一次）
      const taskMdPath = join(taskDir, '00-specs', 'TASK.md');
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

function generateSchemaTemplate(section: Section): string {
  const name = section.name;
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

  const techPath = join(taskDir, '00-specs', 'TECH.md');
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
      responses:
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
function generateRiskTemplate(section: Section): string {
  return `# ${section.name} — 风险评估\n\n> split | ${new Date().toISOString().split('T')[0]}\n\n## 风险矩阵\n\n| 风险 | 可能 | 影响 | 缓解 |\n| :--- | :--- | :--- | :--- |\n| 兼容性 | 中 | 高 | 版本号+测试 |\n| 性能 | 低 | 中 | 压测+索引 |\n| 依赖故障 | 低 | 高 | 降级方案 |\n\n## 回滚\n\n1. 触发: 线上错误率 > 1%\n2. 步骤: git revert → 重部署\n3. 验证: 冒烟测试 + 监控\n`;
}

// 依赖清单
function generateDepsTemplate(section: Section): string {
  return `# ${section.name} — 依赖清单\n\n## 上游依赖\n\n| 服务 | 版本 | 用途 | SLA |\n| :--- | :--- | :--- | :--- |\n| _待补充_ | — | — | — |\n\n## 下游影响\n\n| 服务 | 影响 | 通知 |\n| :--- | :--- | :--- |\n| _待补充_ | — | — |\n`;
}

// 监控指标
function generateMonitorTemplate(section: Section): string {
  return `# ${section.name} — 监控\n\n## 关键指标\n\n| 指标 | 阈值 | 级别 |\n| :--- | :--- | :--- |\n| 成功率 | <99.9% | P1 |\n| P99延迟 | >1000ms | P2 |\n| 错误率 | >0.1% | P0 |\n\n## 关键日志\n\n- 请求入口 (traceId)\n- 业务异常 (上下文)\n- 外部调用 (耗时)\n`;
}

// 前端专属：组件树
function generateComponentTree(section: Section, platform: string): string {
  return `# ${section.name} — 组件树 (${platform})

> split | ${new Date().toISOString().split('T')[0]}

## 页面结构
<!-- AI-FILL: 根据需求描述页面的组件层级 -->

## 组件清单
| 组件 | 路径 | 类型 | 状态 |
| :--- | :--- | :--- | :--- |
| _待AI分析_ | — | — | — |

## 共享组件
| 组件 | 来源 | 用途 |
| :--- | :--- | :--- |
| _待补充_ | — | — |
`;
}

// 前端专属：路由
function generateRoutesDoc(section: Section, platform: string): string {
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
function generateStateDoc(section: Section, platform: string): string {
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
function generateStyleGuide(section: Section, platform: string): string {
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
  if (granularityLabel.includes('粗')) {
    p += `- 每任务工时: 20-80h（1-2 周）\n- 接口上限: 15 个/任务\n- 数据表上限: 5 张/任务\n- 页面上限: 5 个/任务\n`;
  } else if (granularityLabel.includes('中')) {
    p += `- 每任务工时: 12-40h（3-5 天）\n- 接口上限: 8 个/任务\n- 数据表上限: 3 张/任务\n- 页面上限: 3 个/任务\n`;
  } else {
    p += `- 每任务工时: 4-24h（1-3 天）\n- 接口上限: 3 个/任务\n- 数据表上限: 2 张/任务\n- 页面上限: 1 个/任务\n`;
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
  p += `- 00-specs/ 三件套能独立写满（REQ.md + TECH.md + TASK.md）\n`;
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

  p += `### 依赖关系\n`;
  p += `- 基础模块（认证/数据库/配置）优先拆出，作为第一批任务\n`;
  p += `- 依赖链深度 ≤ 3\n`;
  p += `- 同层级无循环依赖\n\n`;

  p += `### 总量约束\n`;
  p += `- 单次迭代总任务数: 3-15 个（超出说明粒度不合适）\n`;
  p += `- 每个任务必须有明确的 owner（对应 STAFFING 中的成员）\n`;
  p += `- 高优先级任务排在前面\n\n`;

  // 输出格式
  p += `## 📤 输出格式\n\n`;
  p += `请输出 JSON 数组，每个 Task 包含:\n`;
  p += '```json\n';
  p += `[\n  {\n`;
  p += `    "id": "Task-001",\n`;
  p += `    "name": "任务名称",\n`;
  p += `    "type": "feature|bugfix|refactor|research",\n`;
  p += `    "reason": "为什么这样拆分",\n`;
  p += `    "scope": ["后端", "admin"],\n`;
  p += `    "apis": ["POST /api/auth/login"],\n`;
  p += `    "tables": ["users"],\n`;
  p += `    "estimatedHours": 8,\n`;
  p += `    "priority": "high|medium|low",\n`;
  p += `    "dependencies": [],\n`;
  p += `    "acceptanceCriteria": ["AC1: ..."],\n`;
  p += `    "risk": "low|medium|high",\n`;
  p += `    "owner": "建议负责人"\n`;
  p += `  }\n]\n`;
  p += '```\n\n';

  // 质量自检
  p += `## ✅ 质量自检（必须全部通过）\n\n`;
  p += `□ 每个任务都满足原子任务定义？\n`;
  p += `□ 每个任务的 estimatedHours 在当前粒度范围内？（不满足 → 合并或再拆）\n`;
  p += `□ 没有循环依赖？\n`;
  p += `□ 基础模块排在前面？\n`;
  p += `□ 同领域功能没被过度拆分？（同一数据实体的 CRUD 必须合并）\n`;
  p += `□ 总任务数在 3-15 个范围内？\n`;
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
