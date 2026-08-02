"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.iterationSplitCommand = iterationSplitCommand;
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
const logger_1 = require("../../utils/logger");
const context_1 = require("../../core/context");
const risk_scorer_1 = require("../../core/risk-scorer");
const global_counters_1 = require("../../core/global-counters");
const next_steps_1 = require("../../core/next-steps");
const readline_1 = require("readline");
function promptUser(question) {
    const rl = (0, readline_1.createInterface)({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(`${question} `, answer => { rl.close(); resolve(answer.trim()); });
    });
}
async function detectPlatforms(iterationDir, specified) {
    if (specified)
        return specified.split(',').map(p => p.trim()).filter(Boolean);
    // Auto-detect from INDEX.md (populated by doc2spec)
    const indexPath = (0, path_1.join)(iterationDir, '00-需求文档', 'INDEX.md');
    if (await (0, fs_extra_1.pathExists)(indexPath)) {
        const content = await (0, fs_extra_1.readFile)(indexPath, 'utf-8');
        // Parse table rows: skip header and separator lines
        const lines = content.split('\n');
        const platforms = new Set();
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
        if (filtered.length > 0)
            return filtered;
    }
    return ['web']; // default
}
async function iterationSplitCommand(options) {
    const spinner = new logger_1.Spinner('Splitting requirements into tasks');
    spinner.start();
    try {
        const iteration = await (0, context_1.getDefaultIteration)(options.iteration);
        if (!iteration) {
            spinner.fail('No active iteration found. Please specify --iteration or create one first.');
            return;
        }
        const iterationDir = `期次-${iteration}`;
        const reqFile = (0, path_1.join)(iterationDir, '00-需求文档', options.file || 'REQUIREMENT.md');
        if (!(await (0, fs_extra_1.pathExists)(reqFile))) {
            spinner.fail(`Requirement file not found: ${reqFile}`);
            return;
        }
        const content = await (0, fs_extra_1.readFile)(reqFile, 'utf-8');
        const sections = extractSections(content, options.sections);
        if (sections.length === 0) {
            spinner.fail('No sections found to split');
            return;
        }
        logger_1.logger.info(`Found ${sections.length} sections to split`);
        const platforms = await detectPlatforms(iterationDir, options.platforms);
        logger_1.logger.info(`Platforms: ${platforms.join(', ')}`);
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
                logger_1.logger.info(`  Would create: ${section.name}`);
            }
            return;
        }
        // ── Interactive mode: preview → adjust → confirm → create ──
        if (options.interactive) {
            spinner.stop('任务预览');
            logger_1.logger.info('');
            logger_1.logger.info(`📋 共 ${sections.length} 个任务将被创建:\n`);
            for (let i = 0; i < sections.length; i++) {
                const taskId = `Task-${String(i + 1).padStart(3, '0')}`;
                const contentPreview = sections[i].content?.split('\n')[0]?.slice(0, 60) || '';
                logger_1.logger.info(`  ${taskId} → ${sections[i].name}`);
                if (contentPreview)
                    logger_1.logger.info(`       ${contentPreview}`);
                logger_1.logger.info(`       平台: ${platforms.join(', ')}`);
                logger_1.logger.info('');
            }
            logger_1.logger.info('💡 你可以：');
            logger_1.logger.info('  [y] 确认创建全部  [n] 逐一确认  [q] 取消');
            logger_1.logger.info('');
            const answer = await promptUser('确认创建？');
            if (answer?.toLowerCase() === 'q') {
                logger_1.logger.info('已取消');
                return;
            }
            if (answer?.toLowerCase() === 'n') {
                logger_1.logger.info('进入逐一确认模式...');
                let created = 0;
                for (let i = 0; i < sections.length; i++) {
                    const taskId = `Task-${String(i + 1).padStart(3, '0')}`;
                    const resp = await promptUser(`  创建 ${taskId} - ${sections[i].name}? [y/n/q]`);
                    if (resp?.toLowerCase() === 'q') {
                        logger_1.logger.info(`已取消，剩余 ${sections.length - i} 个任务未创建`);
                        break;
                    }
                    if (resp?.toLowerCase() === 'y' || resp === '') {
                        await createTaskFromSection(iterationDir, taskId, sections[i], platforms);
                        created++;
                        logger_1.logger.info(`    ✅ ${taskId}`);
                    }
                    else {
                        logger_1.logger.info(`    ⏭️  跳过 ${sections[i].name}`);
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
            (0, next_steps_1.showNextSteps)('split');
            return;
        }
        // Create tasks
        for (let i = 0; i < sections.length; i++) {
            const { id: taskId } = await (0, global_counters_1.nextTaskId)(sections[i].name);
            await createTaskFromSection(iterationDir, taskId, sections[i], platforms);
        }
        // ── Generate impact graph + risk scores ──
        await generateImpactGraph(iterationDir, sections, platforms);
        // ── Generate .env.example for the iteration ──
        await generateEnvExample(iterationDir, sections);
        // Update PROJECT_GRAPH.md
        await updateProjectGraph(iterationDir, sections);
        spinner.stop(`Created ${sections.length} tasks from requirements`);
        (0, next_steps_1.showNextSteps)('split');
    }
    catch (error) {
        spinner.fail(`Split failed: ${error}`);
        throw error;
    }
}
function extractSections(content, sectionFilter) {
    const sections = [];
    let currentPlatform;
    const lines = content.split('\n');
    let currentSection = null;
    let currentContent = [];
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
            }
            else if (currentSection.level === 2) {
                currentPlatform = undefined; // 新的 ## 章节重置平台
            }
            currentSection.platform = currentPlatform;
            while (/端端/.test(currentSection.name))
                currentSection.name = currentSection.name.replace('端端', '端');
            currentContent = [];
        }
        else if (currentSection) {
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
function filterTemplateNoise(sections) {
    return sections.filter(s => {
        // Skip sections matching template patterns
        for (const pattern of TEMPLATE_PATTERNS) {
            if (pattern.test(s.name))
                return false;
        }
        // Skip sections with effectively empty content
        const meaningful = (s.content || '').replace(/[\s\n>#*-|]/g, '').length;
        if (meaningful < 3)
            return false;
        // Skip sections without API tables (structural headings)
        return true;
    });
}
async function createTaskFromSection(iterationDir, taskId, section, allPlatforms) {
    const taskDir = (0, path_1.join)(iterationDir, taskId);
    // 如果 section 有指定平台则只创建该平台，否则创建全部平台
    const taskPlatforms = section.platform ? [section.platform] : allPlatforms;
    await (0, fs_extra_1.ensureDir)((0, path_1.join)(taskDir, '_shared'));
    // Create per-platform directories: backend services under backend/, frontend under frontend/
    for (const platform of taskPlatforms) {
        if (platform.startsWith('后台') || platform === 'backend') {
            // Backend service: e.g., 后台管理端 → backend/管理端
            const service = platform.replace(/^后台/, '').trim() || 'default';
            await (0, fs_extra_1.ensureDir)((0, path_1.join)(taskDir, 'backend', service || platform));
        }
        else {
            await (0, fs_extra_1.ensureDir)((0, path_1.join)(taskDir, 'frontend', platform));
        }
    }
    // Always create a common backend directory for shared backend specs
    if (!taskPlatforms.some(p => p.startsWith('后台'))) {
        await (0, fs_extra_1.ensureDir)((0, path_1.join)(taskDir, 'backend'));
    }
    // Write task type
    await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, '.task-type'), 'feature');
    // Write TEST.md — auto-generated test outline
    await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', 'TEST.md'), generateTestOutline(section));
    // Write REVIEW.md — auto-generated code review checklist
    await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', 'REVIEW.md'), generateReviewChecklist(section));
    // Write SCHEMA.md — DB schema template (only if DB content detected)
    if (section.content.match(/数据库|数据表|表结构|DDL|ALTER|建表|索引/)) {
        await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', 'SCHEMA.md'), generateSchemaTemplate(section));
    }
    // Write DEPLOY.md — deployment checklist
    await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', 'DEPLOY.md'), generateDeployChecklist(section));
    // Generate API_CONTRACT.yaml in _shared/
    const contractYaml = generateApiContract(section);
    if (contractYaml) {
        await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, '_shared', 'API_CONTRACT.yaml'), contractYaml);
    }
    // Generate ERROR_CODES.md
    await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', 'ERROR_CODES.md'), generateErrorCodes(section));
    // Generate ADR.md (only if tech stack detected)
    const adr = generateAdr(section);
    if (adr) {
        await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', 'ADR.md'), adr);
    }
    // Generate RISK.md — risk assessment + rollback
    await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', 'RISK.md'), generateRiskTemplate(section));
    // Generate DEPS.md — dependency manifest
    await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', 'DEPS.md'), generateDepsTemplate(section));
    // Generate MONITOR.md — monitoring points
    await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', 'MONITOR.md'), generateMonitorTemplate(section));
    // Write REQ.md（含自动生成的 AC）
    const acItems = generateAcceptanceCriteria(section);
    await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', 'REQ.md'), `# ${section.name}

## 需求描述

${section.content}

## 验收标准

${acItems}
`);
    // Write TECH.md（根据 section 内容注入框架）
    const apiLines = section.content.split('\n').filter(l => l.includes('| GET') || l.includes('| POST') || l.includes('| PUT') || l.includes('| DELETE') || l.includes('| PATCH'));
    const apiDesc = apiLines.length > 0 ? apiLines.map(l => `- ${l.trim()}`).join('\n') : '- 待补充（从 REQ.md 提取接口列表）';
    await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', 'TECH.md'), `# ${section.name} - 技术方案

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
`);
    // Write API_CONTRACT.yaml if APIs detected
    if (apiLines.length > 0) {
        const contracts = apiLines.map(l => {
            const parts = l.split('|').map(p => p.trim()).filter(Boolean);
            const method = (parts[0] || 'GET').toUpperCase();
            const path = parts[1] || '/api/unknown';
            const desc = parts[2] || path;
            return `  ${path}:\n    ${method}:\n      summary: "${desc}"\n      description: "<!-- AI-FILL -->"`;
        }).join('\n');
        await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', 'API_CONTRACT.yaml'), `# ${section.name} - API Contract\n# Auto-generated from split\n\npaths:\n${contracts}\n`);
    }
    // Write TASK.md
    await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', 'TASK.md'), `# ${section.name}

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
`);
    // Copy to each platform directory (backend services + frontend platforms)
    const reqContent = await (0, fs_extra_1.readFile)((0, path_1.join)(taskDir, 'backend', 'REQ.md'), 'utf-8');
    const techContent = await (0, fs_extra_1.readFile)((0, path_1.join)(taskDir, 'backend', 'TECH.md'), 'utf-8');
    const taskContent = await (0, fs_extra_1.readFile)((0, path_1.join)(taskDir, 'backend', 'TASK.md'), 'utf-8');
    const testContent = await (0, fs_extra_1.readFile)((0, path_1.join)(taskDir, 'backend', 'TEST.md'), 'utf-8');
    const reviewContent = await (0, fs_extra_1.readFile)((0, path_1.join)(taskDir, 'backend', 'REVIEW.md'), 'utf-8');
    for (const platform of taskPlatforms) {
        if (platform.startsWith('后台') || platform === 'backend') {
            const service = platform.replace(/^后台/, '').trim() || platform;
            await (0, fs_extra_1.ensureDir)((0, path_1.join)(taskDir, 'backend', service));
            await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', service, 'REQ.md'), reqContent);
            await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', service, 'TECH.md'), techContent);
            await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', service, 'TASK.md'), taskContent);
            await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', service, 'TEST.md'), testContent);
            await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', service, 'REVIEW.md'), reviewContent);
        }
        else {
            await (0, fs_extra_1.ensureDir)((0, path_1.join)(taskDir, 'frontend', platform));
            await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'frontend', platform, 'REQ.md'), reqContent);
            await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'frontend', platform, 'TECH.md'), techContent);
            await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'frontend', platform, 'TASK.md'), taskContent);
            await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'frontend', platform, 'TEST.md'), testContent);
            await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'frontend', platform, 'REVIEW.md'), reviewContent);
        }
    }
}
async function updateProjectGraph(iterationDir, sections) {
    const graphPath = (0, path_1.join)(iterationDir, '00-期次总览', 'PROJECT_GRAPH.md');
    let content = '';
    if (await (0, fs_extra_1.pathExists)(graphPath)) {
        content = await (0, fs_extra_1.readFile)(graphPath, 'utf-8');
    }
    for (let i = 0; i < sections.length; i++) {
        const { id: taskId } = await (0, global_counters_1.nextTaskId)(sections[i].name);
        let taskName = sections[i].name;
        while (/端端/.test(taskName))
            taskName = taskName.replace('端端', '端');
        if (!content.includes(taskId)) {
            const taskEntry = `| ${taskId} | ${taskName} | feature | 0% | 🔲 待开发 | |\n`;
            content = content.replace('| 任务编号 | 任务名称 | 类型 | 进度 | 状态 | 负责人 |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n', `| 任务编号 | 任务名称 | 类型 | 进度 | 状态 | 负责人 |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n${taskEntry}`);
        }
    }
    await (0, fs_extra_1.writeFile)(graphPath, content);
}
/**
 * 根据需求内容自动生成测试用例框架
 */
function generateTestOutline(section) {
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
    }
    else {
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
function generateReviewChecklist(section) {
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
    }
    else {
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
async function strictSplitPreview(sections, platforms, iterationDir) {
    const ask = (q) => {
        process.stdout.write(q);
        return new Promise((resolve) => {
            process.stdin.resume();
            process.stdin.once('data', (data) => {
                process.stdin.pause();
                resolve(data.toString().split('\n')[0].trim());
            });
        });
    };
    logger_1.logger.info('\n╔══════════════════════════════════════════╗');
    logger_1.logger.info('║  🔍 Strict Split — 预览拆分方案          ║');
    logger_1.logger.info('╚══════════════════════════════════════════╝\n');
    logger_1.logger.info(`检测到 ${sections.length} 个章节，${platforms.length} 个端: ${platforms.join(', ')}\n`);
    const approved = [];
    for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        const taskId = `Task-${String(i + 1).padStart(3, '0')}`;
        // Determine target directory
        const target = s.platform
            ? (s.platform.startsWith('后台') ? `backend/${s.platform.replace(/^后台/, '')}` : `frontend/${s.platform}`)
            : platforms.join(' + ');
        logger_1.logger.info(`── ${taskId}: ${s.name} ──`);
        logger_1.logger.info(`   端: ${target}`);
        logger_1.logger.info(`   内容: ${(s.content || '').slice(0, 60).replace(/\n/g, ' ')}...`);
        const answer = (await ask(`   → 保留？[y]确认 [e]编辑名称 [a]分配 [N]跳过 [q]取消: `)).toLowerCase();
        if (answer === 'q') {
            logger_1.logger.info('  ❌ 取消全部\n');
            approved.length = 0;
            break;
        }
        if (answer === 'a') {
            const owner = await ask(`   → 分配给谁？（如需要多端，用逗号分隔: 张三(后台),李四(Web)）: `);
            if (owner) {
                // Store owner info for later use
                s._owner = owner;
                logger_1.logger.info(`  👤 负责人: ${owner}`);
            }
            approved.push(s);
            logger_1.logger.info(`  ✅ 保留`);
        }
        else if (answer === 'e') {
            const newName = await ask(`   → 新名称: `);
            if (newName) {
                s.name = newName;
                logger_1.logger.info(`  📝 已改名: ${newName}`);
            }
            approved.push(s);
        }
        else if (answer === 'y' || answer === 'yes') {
            approved.push(s);
            logger_1.logger.info(`  ✅ 保留`);
        }
        else {
            logger_1.logger.info(`  ⏭️  跳过`);
        }
        logger_1.logger.info('');
    }
    if (approved.length === 0)
        return [];
    logger_1.logger.info(`\n  将创建 ${approved.length}/${sections.length} 个任务`);
    const confirm = await ask('  确认创建？[y/N] ');
    logger_1.logger.info('\n✅ 确认创建...\n');
    (0, next_steps_1.showNextSteps)('split');
    return approved;
}
/**
 * 生成任务间影响关系图 + 风险评分
 */
async function generateImpactGraph(iterationDir, sections, platforms) {
    const deps = [];
    const sectionApis = sections.map((s, i) => {
        const taskId = `Task-${String(i + 1).padStart(3, '0')}`;
        const apis = (s.content.match(/\/api\/[a-zA-Z0-9\/-]+/g) || []).map(a => a.trim());
        return { name: taskId, apis };
    });
    for (let i = 0; i < sectionApis.length; i++) {
        for (let j = 0; j < sectionApis.length; j++) {
            if (i === j)
                continue;
            for (const api of sectionApis[j].apis) {
                if (sections[i].content.includes(api)) {
                    deps.push({ from: sectionApis[i].name, fromName: sections[i].name, to: sectionApis[j].name, toName: sections[j].name, reason: api });
                    break;
                }
            }
        }
    }
    const seen = new Set();
    const uniqueDeps = deps.filter(d => { const k = d.from + d.to; if (seen.has(k))
        return false; seen.add(k); return true; });
    let impact = '# IMPACT.md\n\n> auto-generated by split\n\n## Risk Scores\n\n| Task | Risk | Score | Tags | Reasons |\n| :--- | :--- | ---: | :--- | :--- |\n';
    for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        const taskId = `Task-${String(i + 1).padStart(3, '0')}`;
        const risk = await (0, risk_scorer_1.scoreRisk)(s.content + s.name, s.name, iterationDir);
        impact += `| ${taskId}: ${s.name} | ${risk.level} | ${risk.score} | ${risk.tags.join(' ')} | ${risk.reasons.join('; ')} |\n`;
        const taskDir = (0, path_1.join)(iterationDir, taskId);
        if (await (0, fs_extra_1.pathExists)(taskDir)) {
            // 生成风险报告并嵌入 TASK.md
            const taskMdPath = (0, path_1.join)(taskDir, 'backend', 'TASK.md');
            const riskReport = (0, risk_scorer_1.generateRiskReport)(risk);
            await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, '.risk'), riskReport);
            if (await (0, fs_extra_1.pathExists)(taskMdPath)) {
                let taskMd = await (0, fs_extra_1.readFile)(taskMdPath, 'utf-8');
                if (!taskMd.includes('## 风险评估')) {
                    taskMd += '\n\n## 风险评估\n\n' + riskReport.replace('# 风险评估\n\n', '');
                    await (0, fs_extra_1.writeFile)(taskMdPath, taskMd);
                }
            }
            // Inject risk section into TASK.md if it exists
            const riskTaskPath = (0, path_1.join)(taskDir, 'backend', 'TASK.md');
            if (await (0, fs_extra_1.pathExists)(riskTaskPath)) {
                let taskMd = await (0, fs_extra_1.readFile)(riskTaskPath, 'utf-8');
                if (!taskMd.includes('## 风险评估')) {
                    taskMd += '\n\n## 风险评估\n\n' + riskReport.replace('# 风险评估\n\n', '');
                    await (0, fs_extra_1.writeFile)(riskTaskPath, taskMd);
                }
            }
        }
    }
    impact += '\n## Dependencies\n\n';
    if (uniqueDeps.length > 0) {
        impact += '| Consumer | -> | Producer | API |\n| :--- | :---: | :--- | :--- |\n';
        for (const d of uniqueDeps)
            impact += `| ${d.from}: ${d.fromName} | -> | ${d.to}: ${d.toName} | \`${d.reason}\` |\n`;
        impact += '\n> Consumer tasks must wait for Producer tasks, or pre-define API contracts.\n';
    }
    else {
        impact += 'No task dependencies detected — all tasks can be developed in parallel.\n';
    }
    await (0, fs_extra_1.writeFile)((0, path_1.join)(iterationDir, 'IMPACT.md'), impact);
    logger_1.logger.info(`\nImpact analysis: ${iterationDir}/IMPACT.md`);
}
function generateSchemaTemplate(section) {
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
function generateDeployChecklist(section) {
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
async function generateEnvExample(iterationDir, sections) {
    const envPath = (0, path_1.join)(iterationDir, '.env.example');
    let env = '# Environment Variables — ' + iterationDir + '\n';
    env += '# Copy to .env and fill in values\n\n';
    const needs = new Set();
    for (const s of sections) {
        const c = s.content + s.name;
        if (c.match(/Redis|缓存/))
            needs.add('REDIS_URL=redis://localhost:6379');
        if (c.match(/Kafka|MQ|消息队列/))
            needs.add('KAFKA_BROKERS=localhost:9092');
        if (c.match(/MySQL|数据库|JDBC|数据表/))
            needs.add('DB_URL=jdbc:mysql://localhost:3306/db\nDB_USER=root\nDB_PASS=');
        if (c.match(/OSS|对象存储|S3|文件上传/))
            needs.add('OSS_ENDPOINT=https://oss.example.com\nOSS_KEY=\nOSS_SECRET=');
        if (c.match(/支付|微信|支付宝|wechat|alipay/))
            needs.add('PAYMENT_API_KEY=\nPAYMENT_SECRET=');
        if (c.match(/短信|SMS|验证码/))
            needs.add('SMS_API_KEY=\nSMS_SECRET=');
        if (c.match(/邮件|email|smtp/))
            needs.add('SMTP_HOST=smtp.example.com\nSMTP_PORT=587\nSMTP_USER=\nSMTP_PASS=');
        if (c.match(/token|JWT|OAuth|鉴权|登录/))
            needs.add('JWT_SECRET=\nTOKEN_EXPIRE=3600');
    }
    if (needs.size === 0) {
        needs.add('# No extra environment variables detected.');
        needs.add('# Add required variables here.');
    }
    env += [...needs].join('\n') + '\n';
    await (0, fs_extra_1.writeFile)(envPath, env);
    logger_1.logger.info(`Env example: ${iterationDir}/.env.example`);
}
async function injectTechFromAnalysis(iterationDir, taskDir, sectionName) {
    const analysisPath = (0, path_1.join)(iterationDir, '00-需求文档', 'ANALYSIS.md');
    if (!(await (0, fs_extra_1.pathExists)(analysisPath)))
        return;
    const analysis = await (0, fs_extra_1.readFile)(analysisPath, 'utf-8');
    // Extract relevant tech stack section
    const techSection = analysis.match(/### 技术选型[\s\S]*?(?=###|$)/);
    const dbSection = analysis.match(/### 数据库变更[\s\S]*?(?=###|$)/);
    const depSection = analysis.match(/### 接口依赖[\s\S]*?(?=###|$)/);
    if (!techSection && !dbSection && !depSection)
        return;
    const techPath = (0, path_1.join)(taskDir, 'backend', 'TECH.md');
    let tech = await (0, fs_extra_1.readFile)(techPath, 'utf-8');
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
    await (0, fs_extra_1.writeFile)(techPath, tech);
}
function generateApiContract(section) {
    const lines = (section.content || '').split('\n');
    const apis = [];
    for (const line of lines) {
        const match = line.match(/\|\s*(GET|POST|PUT|DELETE|PATCH)\s*\|\s*(\/[^\s|]+)\s*\|\s*(.*)/i);
        if (match) {
            apis.push({ method: match[1].toUpperCase(), path: match[2].trim(), desc: (match[3] || '').trim() });
        }
    }
    if (apis.length === 0)
        return '';
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
function generateErrorCodes(section) {
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
function generateAdr(section) {
    const content = section.content || '';
    // Only generate ADR if tech decisions are mentioned
    const hasTech = content.match(/Spring|Vue|React|MySQL|Redis|Kafka|微服务|单体|REST|gRPC/);
    if (!hasTech)
        return '';
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
function generateAcceptanceCriteria(section) {
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
function generateRiskTemplate(section) {
    return `# ${section.name} — 风险评估\n\n> split | ${new Date().toISOString().split('T')[0]}\n\n## 风险矩阵\n\n| 风险 | 可能 | 影响 | 缓解 |\n| :--- | :--- | :--- | :--- |\n| 兼容性 | 中 | 高 | 版本号+测试 |\n| 性能 | 低 | 中 | 压测+索引 |\n| 依赖故障 | 低 | 高 | 降级方案 |\n\n## 回滚\n\n1. 触发: 线上错误率 > 1%\n2. 步骤: git revert → 重部署\n3. 验证: 冒烟测试 + 监控\n`;
}
// 依赖清单
function generateDepsTemplate(section) {
    return `# ${section.name} — 依赖清单\n\n## 上游依赖\n\n| 服务 | 版本 | 用途 | SLA |\n| :--- | :--- | :--- | :--- |\n| _待补充_ | — | — | — |\n\n## 下游影响\n\n| 服务 | 影响 | 通知 |\n| :--- | :--- | :--- |\n| _待补充_ | — | — |\n`;
}
// 监控指标
function generateMonitorTemplate(section) {
    return `# ${section.name} — 监控\n\n## 关键指标\n\n| 指标 | 阈值 | 级别 |\n| :--- | :--- | :--- |\n| 成功率 | <99.9% | P1 |\n| P99延迟 | >1000ms | P2 |\n| 错误率 | >0.1% | P0 |\n\n## 关键日志\n\n- 请求入口 (traceId)\n- 业务异常 (上下文)\n- 外部调用 (耗时)\n`;
}
//# sourceMappingURL=split.js.map