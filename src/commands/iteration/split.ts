import { ensureDir, writeFile, pathExists, readFile } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../../utils/logger';
import { getDefaultIteration } from '../../core/context';
import { scoreRisk, generateRiskReport } from '../../core/risk-scorer';
import { nextTaskId } from '../../core/global-counters';

import { showNextSteps } from '../../core/next-steps';
import { createInterface } from 'readline';

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
}

async function detectPlatforms(iterationDir: string, specified?: string): Promise<string[]> {
  if (specified) return specified.split(',').map(p => p.trim()).filter(Boolean);
  
  // Auto-detect from INDEX.md (populated by doc2spec)
  const indexPath = join(iterationDir, '00-需求文档', 'INDEX.md');
  if (await pathExists(indexPath)) {
    const content = await readFile(indexPath, 'utf-8');
    // Parse table rows: skip header and separator lines
    const lines = content.split('\n');
    const platforms = new Set<string>();
    let inTable = false;
    for (const line of lines) {
      if (line.startsWith('|') && !line.includes(':---')) {
        const cols = line.split('|').map((c: string) => c.trim()).filter(Boolean);
        // First column is platform name, skip header row
        if (cols[0] && cols[0] !== '端' && !String(cols[0]).includes('文件')) {
          platforms.add(cols[0]);
          inTable = true;
        }
      }
    }
    // Also check for common date patterns in first col and filter them
    const filtered = [...platforms].filter(p => !/^\d{4}-\d{2}-\d{2}$/.test(p));
    if (filtered.length > 0) return filtered;
  }
  
  return ['web']; // default
}

export async function iterationSplitCommand(options: IterationSplitOptions): Promise<void> {
  const spinner = new Spinner('Splitting requirements into tasks');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('No active iteration found. Please specify --iteration or create one first.');
      return;
    }

    const iterationDir = `期次-${iteration}`;

    // ── 1. 检查 ANALYSIS.md + AI 智能拆分建议 ──
    const analysisPath = join(iterationDir, '00-需求文档', 'ANALYSIS.md');
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
        const proceed = await promptUser('\n仍要继续拆分？[y/N] ');
        if (!proceed || proceed.toLowerCase() !== 'y') {
          logger.info('已取消拆分');
          return;
        }
        spinner.start();
      }
      
      // 生成 AI 拆分建议上下文
      const promptsDir = join('.speccore', 'prompts');
      await ensureDir(promptsDir);
      
      const reqPath2 = join(iterationDir, '00-需求文档', 'REQUIREMENT.md');
      let reqContent2 = '';
      if (await pathExists(reqPath2)) {
        reqContent2 = await readFile(reqPath2, 'utf-8');
      }
      
      const specDir2 = join(iterationDir, '00-需求文档');
      const specs: string[] = [];
      for (const f of ['TECH.md', 'TEST.md', 'REVIEW.md', 'RISK.md', 'DEPS.md']) {
        if (await pathExists(join(specDir2, f))) specs.push(f);
      }
      
      const splitPrompt = `# SpecCore AI 智能拆分建议\n\n> 期次: ${iteration} | 生成: ${new Date().toISOString().split('T')[0]}\n\n---\n\n## 📋 需求原文\n\n${reqContent2.slice(0, 5000) || '_未找到_'}\n\n---\n\n## 📊 分析结果\n\n${analysis.slice(0, 3000)}\n\n${specs.length > 0 ? '## 📄 已有 Spec 文档\n' + specs.map(f => '- ' + f).join('\n') + '\n\n---\n\n' : ''}## 🤖 任务\n\n根据以上需求和 AI 分析，请建议：任务粒度（复杂拆分/简单合并）、优先级分配、任务间依赖关系、风险标记。直接回复给用户决策。`;
      
      await writeFile(join(promptsDir, `split-suggestion-${iteration}.md`), splitPrompt);
      logger.info(`   🤖 AI 拆分建议 → .speccore/prompts/split-suggestion-${iteration}.md`);
    } else {
      logger.info('   ℹ️ 未找到 ANALYSIS.md，建议先运行 speccore analyze');
    }

    const reqFile = join(iterationDir, '00-需求文档', options.file || 'REQUIREMENT.md');

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

    // ── Strict mode: preview + confirm each task's split plan ──
    if (options.strict) {
      const approved = await strictSplitPreview(sections, platforms, iterationDir);
      if (approved.length === 0) {
        spinner.stop('已取消，未创建任何任务');
        return;
      }
      for (const section of approved) {
        const idx = sections.indexOf(section);
        const taskId = `Task-${String(idx + 1).padStart(3, '0')}`;
        await createTaskFromSection(iterationDir, taskId, section, platforms);
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
        const taskId = `Task-${String(i + 1).padStart(3, '0')}`;
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
          const taskId = `Task-${String(i + 1).padStart(3, '0')}`;
          const resp = await promptUser(`  创建 ${taskId} - ${sections[i].name}? [y/n/q]`);
          if (resp?.toLowerCase() === 'q') {
            logger.info(`已取消，剩余 ${sections.length - i} 个任务未创建`);
            break;
          }
          if (resp?.toLowerCase() === 'y' || resp === '') {
            await createTaskFromSection(iterationDir, taskId, sections[i], platforms);
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
        const taskId = `Task-${String(i + 1).padStart(3, '0')}`;
        await createTaskFromSection(iterationDir, taskId, sections[i], platforms);
      }
      await generateImpactGraph(iterationDir, sections, platforms);
      await generateEnvExample(iterationDir, sections);
      await updateProjectGraph(iterationDir, sections);
      spinner.stop(`✅ 创建了 ${sections.length} 个任务`);
      showNextSteps('split');
      return;
    }

    // Create tasks
    for (let i = 0; i < sections.length; i++) {
      const { id: taskId } = await nextTaskId(sections[i].name);
      await createTaskFromSection(iterationDir, taskId, sections[i], platforms);
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

async function createTaskFromSection(iterationDir: string, taskId: string, section: Section, allPlatforms: string[]): Promise<void> {
  const taskDir = join(iterationDir, taskId);
  
  // 如果 section 有指定平台则只创建该平台，否则创建全部平台
  const taskPlatforms = section.platform ? [section.platform] : allPlatforms;
  
  await ensureDir(join(taskDir, '_shared'));

  // Create per-platform directories: backend services under backend/, frontend under frontend/
  for (const platform of taskPlatforms) {
    if (platform.startsWith('后台') || platform === 'backend') {
      // Backend service: e.g., 后台管理端 → backend/管理端
      const service = platform.replace(/^后台/, '').trim() || 'default';
      await ensureDir(join(taskDir, 'backend', service || platform));
    } else {
      await ensureDir(join(taskDir, 'frontend', platform));
    }
  }
  
  // Always create a common backend directory for shared backend specs
  if (!taskPlatforms.some(p => p.startsWith('后台'))) {
    await ensureDir(join(taskDir, 'backend'));
  }

  // Write task type
  await writeFile(join(taskDir, '.task-type'), 'feature');

  // Write TEST.md — auto-generated test outline
  await writeFile(join(taskDir, 'backend', 'TEST.md'), generateTestOutline(section));

  // Write REVIEW.md — auto-generated code review checklist
  await writeFile(join(taskDir, 'backend', 'REVIEW.md'), generateReviewChecklist(section));

  // Write SCHEMA.md — DB schema template (only if DB content detected)
  if (section.content.match(/数据库|数据表|表结构|DDL|ALTER|建表|索引/)) {
    await writeFile(join(taskDir, 'backend', 'SCHEMA.md'), generateSchemaTemplate(section));
  }

  // Write DEPLOY.md — deployment checklist
  await writeFile(join(taskDir, 'backend', 'DEPLOY.md'), generateDeployChecklist(section));

  // Generate API_CONTRACT.yaml in _shared/
  const contractYaml = generateApiContract(section);
  if (contractYaml) {
    await writeFile(join(taskDir, '_shared', 'API_CONTRACT.yaml'), contractYaml);
  }

  // Generate ERROR_CODES.md
  await writeFile(join(taskDir, 'backend', 'ERROR_CODES.md'), generateErrorCodes(section));

  // Generate ADR.md (only if tech stack detected)
  const adr = generateAdr(section);
  if (adr) {
    await writeFile(join(taskDir, 'backend', 'ADR.md'), adr);
  }

  // Generate RISK.md — risk assessment + rollback
  await writeFile(join(taskDir, 'backend', 'RISK.md'), generateRiskTemplate(section));

  // Generate DEPS.md — dependency manifest
  await writeFile(join(taskDir, 'backend', 'DEPS.md'), generateDepsTemplate(section));

  // Generate MONITOR.md — monitoring points
  await writeFile(join(taskDir, 'backend', 'MONITOR.md'), generateMonitorTemplate(section));

  // Write REQ.md（含自动生成的 AC）
  const acItems = generateAcceptanceCriteria(section);
  await writeFile(
    join(taskDir, 'backend', 'REQ.md'),
    `# ${section.name}

## 需求描述

${section.content}

## 验收标准

${acItems}
`
  );

  // Write TECH.md（根据 section 内容注入框架）
  const apiLines = section.content.split('\n').filter(l => l.includes('| GET') || l.includes('| POST') || l.includes('| PUT') || l.includes('| DELETE') || l.includes('| PATCH'));
  const apiDesc = apiLines.length > 0 ? apiLines.map(l => `- ${l.trim()}`).join('\n') : '- 待补充（从 REQ.md 提取接口列表）';
  
  await writeFile(
    join(taskDir, 'backend', 'TECH.md'),
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

  // Write API_CONTRACT.yaml if APIs detected
  if (apiLines.length > 0) {
    const contracts = apiLines.map(l => {
      const parts = l.split('|').map(p => p.trim()).filter(Boolean);
      const method = (parts[0] || 'GET').toUpperCase();
      const path = parts[1] || '/api/unknown';
      const desc = parts[2] || path;
      return `  ${path}:\n    ${method}:\n      summary: "${desc}"\n      description: "<!-- AI-FILL -->"`;
    }).join('\n');
    
    await writeFile(join(taskDir, 'backend', 'API_CONTRACT.yaml'),
      `# ${section.name} - API Contract\n# Auto-generated from split\n\npaths:\n${contracts}\n`
    );
  }

  // Write TASK.md
  const complexity = (section as any)._complexity as SectionComplexity || { estimatedHours: 2, priority: 'medium' as const, complexity: 'medium' as const, apiCount: 0, dbCount: 0, pageCount: 0, wordCount: 0 };
  const owner = (section as any)._owner || '未分配';
  await writeFile(
    join(taskDir, 'backend', 'TASK.md'),
    `# ${section.name}

## 任务信息
- 类型: feature
- 状态: 🔲 待开发
- 优先级: ${complexity.priority}
- 负责人: ${owner}
- 预计耗时: ${complexity.estimatedHours}h${complexity.complexity !== 'medium' ? ` (${complexity.complexity === 'high' ? '高复杂度' : '低复杂度'})` : ''}
- 复杂度: API ${complexity.apiCount} | DB ${complexity.dbCount} | 页面 ${complexity.pageCount}

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
| TEST.md | ✅ | ./TEST.md |
| REVIEW.md | ✅ | ./REVIEW.md |
| API_CONTRACT.yaml | ✅ | ./_shared/API_CONTRACT.yaml |
| DEPLOY.md | ✅ | ./DEPLOY.md |
| SCHEMA.md | ✅ | ./SCHEMA.md |
| ERROR_CODES.md | ✅ | ./ERROR_CODES.md |
| ADR.md | ✅ | ./ADR.md |
| RISK.md | ✅ | ./RISK.md |
| DEPS.md | ✅ | ./DEPS.md |
| MONITOR.md | ✅ | ./MONITOR.md |
`
  );

  // Copy to each platform directory (backend services + frontend platforms)
  const reqContent = await readFile(join(taskDir, 'backend', 'REQ.md'), 'utf-8');
  const techContent = await readFile(join(taskDir, 'backend', 'TECH.md'), 'utf-8');
  const taskContent = await readFile(join(taskDir, 'backend', 'TASK.md'), 'utf-8');
  const testContent = await readFile(join(taskDir, 'backend', 'TEST.md'), 'utf-8');
  const reviewContent = await readFile(join(taskDir, 'backend', 'REVIEW.md'), 'utf-8');
  
  for (const platform of taskPlatforms) {
    if (platform.startsWith('后台') || platform === 'backend') {
      const service = platform.replace(/^后台/, '').trim() || platform;
      await ensureDir(join(taskDir, 'backend', service));
      await writeFile(join(taskDir, 'backend', service, 'REQ.md'), reqContent);
      await writeFile(join(taskDir, 'backend', service, 'TECH.md'), techContent);
      await writeFile(join(taskDir, 'backend', service, 'TASK.md'), taskContent);
      await writeFile(join(taskDir, 'backend', service, 'TEST.md'), testContent);
      await writeFile(join(taskDir, 'backend', service, 'REVIEW.md'), reviewContent);
    } else {
      await ensureDir(join(taskDir, 'frontend', platform));
      await writeFile(join(taskDir, 'frontend', platform, 'REQ.md'), reqContent);
      await writeFile(join(taskDir, 'frontend', platform, 'TASK.md'), taskContent);
      await writeFile(join(taskDir, 'frontend', platform, 'TEST.md'), testContent);
      await writeFile(join(taskDir, 'frontend', platform, 'REVIEW.md'), reviewContent);
      // 前端专属文件
      await writeFile(join(taskDir, 'frontend', platform, 'COMPONENT_TREE.md'), generateComponentTree(section, platform));
      await writeFile(join(taskDir, 'frontend', platform, 'ROUTES.md'), generateRoutesDoc(section, platform));
      await writeFile(join(taskDir, 'frontend', platform, 'STATE.md'), generateStateDoc(section, platform));
      await writeFile(join(taskDir, 'frontend', platform, 'STYLE_GUIDE.md'), generateStyleGuide(section, platform));
    }
  }
}

async function updateProjectGraph(iterationDir: string, sections: Section[]): Promise<void> {
  const graphPath = join(iterationDir, '00-期次总览', 'PROJECT_GRAPH.md');
  
  let content = '';
  if (await pathExists(graphPath)) {
    content = await readFile(graphPath, 'utf-8');
  }

  for (let i = 0; i < sections.length; i++) {
    const { id: taskId } = await nextTaskId(sections[i].name);
    let taskName = sections[i].name; while (/端端/.test(taskName)) taskName = taskName.replace('端端', '端');
    
    if (!content.includes(taskId)) {
      const taskEntry = `| ${taskId} | ${taskName} | feature | 0% | 🔲 待开发 | |\n`;
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
    const taskId = `Task-${String(i + 1).padStart(3, '0')}`;
    
    // Determine target directory
    const target = s.platform
      ? (s.platform.startsWith('后台') ? `backend/${s.platform.replace(/^后台/, '')}` : `frontend/${s.platform}`)
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
    const taskId = `Task-${String(i + 1).padStart(3, '0')}`;
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
    const taskId = `Task-${String(i + 1).padStart(3, '0')}`;
    const risk = await scoreRisk(s.content + s.name, s.name, iterationDir);
    impact += `| ${taskId}: ${s.name} | ${risk.level} | ${risk.score} | ${risk.tags.join(' ')} | ${risk.reasons.join('; ')} |\n`;

    const taskDir = join(iterationDir, taskId);
    if (await pathExists(taskDir)) {
      // 生成风险报告并嵌入 TASK.md
      const taskMdPath = join(taskDir, 'backend', 'TASK.md');
      const riskReport = generateRiskReport(risk); await writeFile(join(taskDir, '.risk'), riskReport);
      if (await pathExists(taskMdPath)) {
        let taskMd = await readFile(taskMdPath, 'utf-8');
        if (!taskMd.includes('## 风险评估')) {
          taskMd += '\n\n## 风险评估\n\n' + riskReport.replace('# 风险评估\n\n', '');
          await writeFile(taskMdPath, taskMd);
        }
      }
      // Inject risk section into TASK.md if it exists
      const riskTaskPath = join(taskDir, 'backend', 'TASK.md');
      if (await pathExists(riskTaskPath)) {
        let taskMd = await readFile(riskTaskPath, 'utf-8');
        if (!taskMd.includes('## 风险评估')) {
          taskMd += '\n\n## 风险评估\n\n' + riskReport.replace('# 风险评估\n\n', '');
          await writeFile(riskTaskPath, taskMd);
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
  const analysisPath = join(iterationDir, '00-需求文档', 'ANALYSIS.md');
  if (!(await pathExists(analysisPath))) return;

  const analysis = await readFile(analysisPath, 'utf-8');
  
  // Extract relevant tech stack section
  const techSection = analysis.match(/### 技术选型[\s\S]*?(?=###|$)/);
  const dbSection = analysis.match(/### 数据库变更[\s\S]*?(?=###|$)/);
  const depSection = analysis.match(/### 接口依赖[\s\S]*?(?=###|$)/);

  if (!techSection && !dbSection && !depSection) return;

  const techPath = join(taskDir, 'backend', 'TECH.md');
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
 * 读取期次的 STAFFING.md 人员排期配置
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
          const depLabel = `Task-${String(j + 1).padStart(3, '0')}(${sj.name.slice(0, 10)})`;
          if (!taskDeps.includes(depLabel)) taskDeps.push(depLabel);
          break; // 每对只匹配一次
        }
      }
    }
    
    if (taskDeps.length > 0) {
      deps.set(`Task-${String(i + 1).padStart(3, '0')}`, taskDeps);
    }
  }
  
  return deps;
}
