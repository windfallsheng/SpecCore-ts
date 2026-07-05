"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.iterationSplitCommand = iterationSplitCommand;
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
const logger_1 = require("../../utils/logger");
const context_1 = require("../../core/context");
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
        if (options.dryRun) {
            spinner.stop('Dry run complete - no files created');
            for (const section of sections) {
                logger_1.logger.info(`  Would create: ${section.name}`);
            }
            return;
        }
        // Create tasks
        for (let i = 0; i < sections.length; i++) {
            const taskId = `Task-${String(i + 1).padStart(3, '0')}`;
            await createTaskFromSection(iterationDir, taskId, sections[i]);
        }
        // Update PROJECT_GRAPH.md
        await updateProjectGraph(iterationDir, sections);
        spinner.stop(`Created ${sections.length} tasks from requirements`);
    }
    catch (error) {
        spinner.fail(`Split failed: ${error}`);
        throw error;
    }
}
function extractSections(content, sectionFilter) {
    const sections = [];
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
    return sections;
}
async function createTaskFromSection(iterationDir, taskId, section) {
    const taskDir = (0, path_1.join)(iterationDir, taskId);
    await (0, fs_extra_1.ensureDir)((0, path_1.join)(taskDir, 'backend'));
    await (0, fs_extra_1.ensureDir)((0, path_1.join)(taskDir, 'frontend'));
    await (0, fs_extra_1.ensureDir)((0, path_1.join)(taskDir, '_shared'));
    // Write task type
    await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, '.task-type'), 'feature');
    // Write REQ.md
    await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', 'REQ.md'), `# ${section.name}

## 需求描述

${section.content}

## 验收标准

- [ ] AC-1: 
- [ ] AC-2: 
- [ ] AC-3: 
`);
    // Write TECH.md
    await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', 'TECH.md'), `# ${section.name} - 技术方案

## 1. 方案概述

## 2. 接口设计

## 3. 数据模型

## 4. 核心逻辑

## 5. 测试策略
`);
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
`);
    // Copy to frontend
    const reqContent = await (0, fs_extra_1.readFile)((0, path_1.join)(taskDir, 'backend', 'REQ.md'), 'utf-8');
    await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'frontend', 'REQ.md'), reqContent);
    const techContent = await (0, fs_extra_1.readFile)((0, path_1.join)(taskDir, 'backend', 'TECH.md'), 'utf-8');
    await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'frontend', 'TECH.md'), techContent);
    const taskContent = await (0, fs_extra_1.readFile)((0, path_1.join)(taskDir, 'backend', 'TASK.md'), 'utf-8');
    await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'frontend', 'TASK.md'), taskContent);
}
async function updateProjectGraph(iterationDir, sections) {
    const graphPath = (0, path_1.join)(iterationDir, '00-期次总览', 'PROJECT_GRAPH.md');
    let content = '';
    if (await (0, fs_extra_1.pathExists)(graphPath)) {
        content = await (0, fs_extra_1.readFile)(graphPath, 'utf-8');
    }
    for (let i = 0; i < sections.length; i++) {
        const taskId = `Task-${String(i + 1).padStart(3, '0')}`;
        const taskName = sections[i].name;
        if (!content.includes(taskId)) {
            const taskEntry = `| ${taskId} | ${taskName} | feature | 0% | 🔲 待开发 | |\n`;
            content = content.replace('| 任务编号 | 任务名称 | 类型 | 进度 | 状态 | 负责人 |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n', `| 任务编号 | 任务名称 | 类型 | 进度 | 状态 | 负责人 |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n${taskEntry}`);
        }
    }
    await (0, fs_extra_1.writeFile)(graphPath, content);
}
//# sourceMappingURL=split.js.map