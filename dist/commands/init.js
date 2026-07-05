"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initCommand = initCommand;
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
const logger_1 = require("../utils/logger");
const context_1 = require("../core/context");
async function initCommand(options) {
    const spinner = new logger_1.Spinner('Initializing SpecCore');
    spinner.start();
    try {
        const projectRoot = process.cwd();
        const speccoreDir = (0, path_1.join)(projectRoot, '.speccore');
        // Check if already initialized
        if (await (0, fs_extra_1.pathExists)(speccoreDir)) {
            if (!options.force) {
                spinner.fail('SpecCore already initialized. Use --force to overwrite.');
                return;
            }
            spinner.stop('Overwriting existing configuration...');
        }
        // Create directory structure
        await (0, fs_extra_1.ensureDir)((0, path_1.join)(speccoreDir, 'PROJECT'));
        await (0, fs_extra_1.ensureDir)((0, path_1.join)(speccoreDir, 'PATTERNS'));
        await (0, fs_extra_1.ensureDir)((0, path_1.join)(speccoreDir, 'ITERATIONS'));
        await (0, fs_extra_1.ensureDir)((0, path_1.join)(speccoreDir, 'RULES'));
        await (0, fs_extra_1.ensureDir)((0, path_1.join)(speccoreDir, 'local'));
        // Create default files
        await createDefaultFiles(speccoreDir);
        // Create context.json
        await (0, fs_extra_1.writeFile)((0, path_1.join)(speccoreDir, 'local', 'context.json'), JSON.stringify({
            currentIteration: '',
            currentTask: '',
            currentAssignee: '',
            lastUpdated: '',
            history: []
        }, null, 2));
        // Create .gitignore entry
        await updateGitignore(projectRoot);
        // Update context
        await (0, context_1.updateContext)({ lastUpdated: new Date().toISOString() });
        spinner.stop('SpecCore initialized successfully!');
        logger_1.logger.info('');
        logger_1.logger.info('Next steps:');
        logger_1.logger.info('  1. Edit .speccore/CONSTITUTION.md to define your tech stack');
        logger_1.logger.info('  2. Edit .speccore/PROJECT/TEAM.md to add team members');
        logger_1.logger.info('  3. Run: speccore iteration create --name <name>');
    }
    catch (error) {
        spinner.fail(`Initialization failed: ${error}`);
        throw error;
    }
}
async function createDefaultFiles(speccoreDir) {
    // CONSTITUTION.md
    await (0, fs_extra_1.writeFile)((0, path_1.join)(speccoreDir, 'CONSTITUTION.md'), `# 技术宪法

> 本项目遵循 SpecCore 框架规范

## 技术栈

### 后端
- 语言：Java / TypeScript / Go / Python
- 框架：Spring Boot / NestJS / Gin / FastAPI
- 数据库：MySQL / PostgreSQL / MongoDB
- 缓存：Redis

### 前端
- 框架：Vue / React / Angular
- 状态管理：Pinia / Redux / NgRx
- UI 组件：Element Plus / Ant Design

## 命名规范
- 接口：/api/v1/{模块}/{操作}
- 错误码：4 位数字，按模块划分
- 数据库：snake_case
- 代码：camelCase / PascalCase

## 异常码体系
| 错误码 | 含义 | 场景 |
| :--- | :--- | :--- |
| 1001 | 用户不存在 | 登录时手机号未注册 |
| 1002 | 密码错误 | 登录密码不匹配 |
| ... | ... | ... |
`);
    // PROJECT files
    await (0, fs_extra_1.writeFile)((0, path_1.join)(speccoreDir, 'PROJECT', 'INDEX.md'), `# 项目索引

## 项目概览
- 项目名称：
- 项目代号：
- 创建日期：

## 目录结构
- [OVERVIEW.md](OVERVIEW.md) - 项目全景
- [REQUIREMENT.md](REQUIREMENT.md) - 项目级需求
- [ARCHITECTURE.md](ARCHITECTURE.md) - 项目级架构
- [TEAM.md](TEAM.md) - 团队与 Git 映射
- [GLOSSARY.md](GLOSSARY.md) - 术语表
`);
    await (0, fs_extra_1.writeFile)((0, path_1.join)(speccoreDir, 'PROJECT', 'TEAM.md'), `# 团队与 Git 映射

| 成员 | Git 用户名 | 角色 | 技术栈 | 负责模块 |
| :--- | :--- | :--- | :--- | :--- |
| | | | | |
`);
    // ITERATIONS/README.md
    await (0, fs_extra_1.writeFile)((0, path_1.join)(speccoreDir, 'ITERATIONS', 'README.md'), `# 期次索引

| 期次名称 | 时间范围 | 状态 | 负责人 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| | | | | |
`);
    // SETTINGS.md
    await (0, fs_extra_1.writeFile)((0, path_1.join)(speccoreDir, 'SETTINGS.md'), `# 框架配置

## 功能开关
| 配置项 | 值 | 说明 |
| :--- | :--- | :--- |
| assignee.enabled | true | 是否启用执行人追踪 |
| assignee.mode | loose | 执行人追踪强制程度 |
`);
    // CODE_REVIEW.md
    await (0, fs_extra_1.writeFile)((0, path_1.join)(speccoreDir, 'RULES', 'CODE_REVIEW.md'), `# 代码审查规则

## 审查维度
1. 规范遵循
2. 代码质量
3. 测试覆盖
4. 性能指标
5. 安全性

## 评分标准
| 等级 | 分数 | 说明 |
| :--- | :--- | :--- |
| A | 90-100 | 优秀 |
| B | 75-89 | 良好 |
| C | 60-74 | 合格 |
| D | <60 | 不合格 |
`);
}
async function updateGitignore(projectRoot) {
    const gitignorePath = (0, path_1.join)(projectRoot, '.gitignore');
    const entry = '# SpecCore local config\n.speccore/local/\n期次-*/.local/\n';
    if (await (0, fs_extra_1.pathExists)(gitignorePath)) {
        const content = await (0, fs_extra_1.readFile)(gitignorePath, 'utf-8');
        if (!content.includes('.speccore/local/')) {
            await (0, fs_extra_1.writeFile)(gitignorePath, content + '\n' + entry);
        }
    }
    else {
        await (0, fs_extra_1.writeFile)(gitignorePath, entry);
    }
}
//# sourceMappingURL=init.js.map