import { ensureDir, writeFile, pathExists, readFile } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../../utils/logger';
import { getDefaultIteration } from '../../core/context';
import { scoreRisk, generateRiskReport } from '../../core/risk-scorer';
import { nextTaskId } from '../../core/global-counters';

import { showNextSteps } from '../../core/next-steps';
export interface IterationSplitOptions {
  file?: string;
  iteration?: string;
  sections?: string;
  target?: string;
  dryRun?: boolean;
  platforms?: string;
  strict?: boolean;
}

async function detectPlatforms(iterationDir: string, specified?: string): Promise<string[]> {
  if (specified) return specified.split(',').map(p => p.trim()).filter(Boolean);
  
  // Auto-detect from INDEX.md (populated by word2spec)
  const indexPath = join(iterationDir, '00-需求文档', 'INDEX.md');
  if (await pathExists(indexPath)) {
    const content = await readFile(indexPath, 'utf-8');
    // Parse table rows: skip header and separator lines
    const lines = content.split('\n');
    const platforms = new Set<string>();
    let inTable = false;
    for (const line of lines) {
      if (line.startsWith('|') && !line.includes(':---')) {
        const cols = line.split('|').map(c => c.trim()).filter(Boolean);
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

    logger.info(`Found ${sections.length} sections to split`);
    
    const platforms = await detectPlatforms(iterationDir, options.platforms);
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

  // Write REQ.md
  await writeFile(
    join(taskDir, 'backend', 'REQ.md'),
    `# ${section.name}

## 需求描述

${section.content}

## 验收标准

- [ ] AC-1: 
- [ ] AC-2: 
- [ ] AC-3: 
`
  );

  // Write TECH.md
  await writeFile(
    join(taskDir, 'backend', 'TECH.md'),
    `# ${section.name} - 技术方案

## 1. 方案概述

## 2. 接口设计

## 3. 数据模型

## 4. 核心逻辑

## 5. 测试策略
`
  );

  // Write TASK.md
  await writeFile(
    join(taskDir, 'backend', 'TASK.md'),
    `# ${section.name}

## 任务信息
- 类型: feature
- 状态: 🔲 待开发
- 优先级: medium
- 预计耗时: 2h

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
      await writeFile(join(taskDir, 'frontend', platform, 'TECH.md'), techContent);
      await writeFile(join(taskDir, 'frontend', platform, 'TASK.md'), taskContent);
      await writeFile(join(taskDir, 'frontend', platform, 'TEST.md'), testContent);
      await writeFile(join(taskDir, 'frontend', platform, 'REVIEW.md'), reviewContent);
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

  impact += '\n## Dependencies\n\n';
  if (uniqueDeps.length > 0) {
    impact += '| Consumer | -> | Producer | API |\n| :--- | :---: | :--- | :--- |\n';
    for (const d of uniqueDeps) impact += `| ${d.from}: ${d.fromName} | -> | ${d.to}: ${d.toName} | \`${d.reason}\` |\n`;
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
