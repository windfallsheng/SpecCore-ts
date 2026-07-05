import { ensureDir, writeFile, pathExists, readFile, copy } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../utils/logger';
import { updateContext } from '../core/context';

export interface InitOptions {
  mode?: string;
  force?: boolean;
}

export async function initCommand(options: InitOptions): Promise<void> {
  const spinner = new Spinner('Initializing SpecCore');
  spinner.start();

  try {
    const projectRoot = process.cwd();
    const speccoreDir = join(projectRoot, '.speccore');

    // Check if already initialized
    if (await pathExists(speccoreDir)) {
      if (!options.force) {
        spinner.fail('SpecCore already initialized. Use --force to overwrite.');
        return;
      }
      spinner.stop('Overwriting existing configuration...');
    }

    // Create directory structure
    await ensureDir(join(speccoreDir, 'PROJECT'));
    await ensureDir(join(speccoreDir, 'PATTERNS'));
    await ensureDir(join(speccoreDir, 'ITERATIONS'));
    await ensureDir(join(speccoreDir, 'RULES'));
    await ensureDir(join(speccoreDir, 'local'));

    // Create default files
    await createDefaultFiles(speccoreDir);

    // Create context.json
    await writeFile(
      join(speccoreDir, 'local', 'context.json'),
      JSON.stringify({
        currentIteration: '',
        currentTask: '',
        currentAssignee: '',
        lastUpdated: '',
        history: []
      }, null, 2)
    );

    // Create .gitignore entry
    await updateGitignore(projectRoot);

    // Update context
    await updateContext({ lastUpdated: new Date().toISOString() });

    spinner.stop('SpecCore initialized successfully!');
    logger.info('');
    logger.info('Next steps:');
    logger.info('  1. Edit .speccore/CONSTITUTION.md to define your tech stack');
    logger.info('  2. Edit .speccore/PROJECT/TEAM.md to add team members');
    logger.info('  3. Run: speccore iteration create --name <name>');
  } catch (error) {
    spinner.fail(`Initialization failed: ${error}`);
    throw error;
  }
}

async function createDefaultFiles(speccoreDir: string): Promise<void> {
  // CONSTITUTION.md
  await writeFile(
    join(speccoreDir, 'CONSTITUTION.md'),
    `# 技术宪法

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
`
  );

  // PROJECT files
  await writeFile(
    join(speccoreDir, 'PROJECT', 'INDEX.md'),
    `# 项目索引

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
`
  );

  await writeFile(
    join(speccoreDir, 'PROJECT', 'TEAM.md'),
    `# 团队与 Git 映射

| 成员 | Git 用户名 | 角色 | 技术栈 | 负责模块 |
| :--- | :--- | :--- | :--- | :--- |
| | | | | |
`
  );

  // ITERATIONS/README.md
  await writeFile(
    join(speccoreDir, 'ITERATIONS', 'README.md'),
    `# 期次索引

| 期次名称 | 时间范围 | 状态 | 负责人 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| | | | | |
`
  );

  // SETTINGS.md
  await writeFile(
    join(speccoreDir, 'SETTINGS.md'),
    `# 框架配置

## 功能开关
| 配置项 | 值 | 说明 |
| :--- | :--- | :--- |
| assignee.enabled | true | 是否启用执行人追踪 |
| assignee.mode | loose | 执行人追踪强制程度 |
`
  );

  // CODE_REVIEW.md
  await writeFile(
    join(speccoreDir, 'RULES', 'CODE_REVIEW.md'),
    `# 代码审查规则

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
`
  );
}

async function updateGitignore(projectRoot: string): Promise<void> {
  const gitignorePath = join(projectRoot, '.gitignore');
  const entry = '# SpecCore local config\n.speccore/local/\n期次-*/.local/\n';

  if (await pathExists(gitignorePath)) {
    const content = await readFile(gitignorePath, 'utf-8');
    if (!content.includes('.speccore/local/')) {
      await writeFile(gitignorePath, content + '\n' + entry);
    }
  } else {
    await writeFile(gitignorePath, entry);
  }
}
