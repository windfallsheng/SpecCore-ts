/**
 * welcome - 首次使用引导命令
 * 交互式引导新用户完成第一个完整功能开发
 */

import { logger, Spinner } from '../utils/logger';
import { ensureDir, writeFile, pathExists, readFile } from 'fs-extra';
import { FileTransaction } from '../core/transaction';
import { join } from 'path';

export interface WelcomeOptions {
  force?: boolean;
}

export async function welcomeCommand(options: WelcomeOptions): Promise<void> {
  logger.info('👋 欢迎使用 SpecCore！');
  logger.info('');
  logger.info('SpecCore 是一个面向 AI 原生团队的规范驱动研发工程框架。');
  logger.info('核心理念：Code by Spec, Not by Vibe.');
  logger.info('');

  const spinner = new Spinner('正在检测项目状态...');
  spinner.start();

  try {
    const isInitialized = await checkInitialization();

    if (!isInitialized || options.force) {
      spinner.stop('项目未初始化，开始引导设置...');
      await guideInit();
    } else {
      spinner.stop('项目已初始化。');
    }

    // Step 2: 引导创建期次
    logger.info('');
    logger.info('📋 第二步：创建你的第一个期次');
    logger.info('');
    logger.info('期次是 SpecCore 的项目管理单元，通常按时间或功能划分。');
    logger.info('例如: 期次-2026-07-会议预定');
    logger.info('');
    logger.info('运行以下命令创建期次:');
    logger.info('  $ speccore iteration create --name "<期次名称>"');
    logger.info('');

    // Step 3: 引导创建任务
    logger.info('📝 第三步：创建开发任务');
    logger.info('');
    logger.info('使用智能入口创建任务:');
    logger.info('  $ speccore spec "做一个用户登录功能，支持手机号+密码"');
    logger.info('');
    logger.info('或直接创建:');
    logger.info('  $ speccore task new --name "用户登录" --desc "手机号+密码登录"');
    logger.info('');

    // Step 4: 引导查看和开发
    logger.info('⚡ 第四步：查看进度并开始开发');
    logger.info('');
    logger.info('查看项目状态:');
    logger.info('  $ speccore progress');
    logger.info('  $ speccore status');
    logger.info('');
    logger.info('生成执行计划:');
    logger.info('  $ speccore plan');
    logger.info('');

    // Step 5: 审查和归档
    logger.info('✅ 第五步：审查和归档');
    logger.info('');
    logger.info('审查代码产出:');
    logger.info('  $ speccore validate');
    logger.info('');
    logger.info('归档已完成任务:');
    logger.info('  $ speccore archive --all');
    logger.info('');

    // 常用命令速查
    logger.info('---');
    logger.info('📖 常用命令速查:');
    logger.info('');
    logger.info('| 场景 | 命令 |');
    logger.info('| :--- | :--- |');
    logger.info('| 自然语言入口 | speccore spec "<描述>" |');
    logger.info('| 查看进度 | speccore progress |');
    logger.info('| 创建任务 | speccore task new --name "<名称>" |');
    logger.info('| Bug 修复 | speccore bugfix --name "<Bug>" |');
    logger.info('| 需求变更 | speccore change --task=<Task> --desc="<描述>" |');
    logger.info('| 生成报告 | speccore report --format=html |');
    logger.info('| 查看帮助 | speccore help |');
    logger.info('');

    logger.info('💡 提示: 使用 speccore spec 可以通过自然语言描述自动执行！');
    logger.info('   例如: speccore spec "查看进度"');
    logger.info('   例如: speccore spec "开始干活"');
  } catch (error) {
    spinner.fail(`引导初始化失败: ${error}`);
    throw error;
  }
}

async function checkInitialization(): Promise<boolean> {
  return await pathExists(join(process.cwd(), '.speccore'));
}

async function guideInit(): Promise<void> {
  logger.info('');
  logger.info('🔧 正在初始化 SpecCore 项目...');

  const speccoreDir = join(process.cwd(), '.speccore');
  await ensureDir(join(speccoreDir, 'PROJECT'));
  await ensureDir(join(speccoreDir, 'PATTERNS'));
  await ensureDir(join(speccoreDir, 'ITERATIONS'));
  await ensureDir(join(speccoreDir, 'RULES'));
  await ensureDir(join(speccoreDir, 'local'));

  // 创建基础配置
  const context = {
    currentIteration: '',
    currentTask: '',
    currentAssignee: '',
    lastUpdated: new Date().toISOString(),
    history: [],
  };
  await writeFile(join(speccoreDir, 'local', 'context.json'), JSON.stringify(context, null, 2));

  // 创建 SETTINGS.md
  await writeFile(
    join(speccoreDir, 'SETTINGS.md'),
    `# SpecCore 框架配置

> 修改后，AI 将在下一次执行命令时自动生效。

---

## 1. 执行人追踪（Assignee Tracking）

| 配置项 | 可选值 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| \`assignee.enabled\` | \`true\`/\`false\` | \`true\` | 是否启用执行人追踪 |
| \`assignee.mode\` | \`strict\`/\`loose\`/\`off\` | \`loose\` | 强制程度 |

### 模式说明
| 模式 | 行为 |
| :--- | :--- |
| **\`strict\`** | 校验执行人与 Git 提交者，不一致时阻断命令执行 |
| **\`loose\`** | 自动填写 Git 提交者，仅发出警告（推荐） |
| **\`off\`** | 不读取、不校验、不推荐任何人 |

## 2. 双向追溯配置

| 配置项 | 可选值 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| \`trace.enabled\` | \`true\`/\`false\` | \`true\` | 是否启用双向追溯 |
| \`trace.auto_annotate\` | \`true\`/\`false\` | \`true\` | 生成代码时是否自动添加 @spec 注释 |

## 3. 其他配置

| 配置项 | 可选值 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| \`archive.auto_cleanup\` | \`true\`/\`false\` | \`false\` | 归档时是否自动清理未使用的资源 |
| \`plan.parallel_suggest\` | \`true\`/\`false\` | \`true\` | 是否自动推荐并行开发策略 |
| \`validation.strict_mode\` | \`true\`/\`false\` | \`false\` | 合规性检查是否为严格模式 |
| \`sync.auto_check\` | \`true\`/\`false\` | \`true\` | 开发完成后是否自动检查反向同步 |

## 4. 配置变更记录

| 日期 | 变更项 | 旧值 | 新值 | 变更人 |
| :--- | :--- | :--- | :--- | :--- |
`
  );

  // 创建 ITERATIONS/README.md
  await writeFile(
    join(speccoreDir, 'ITERATIONS', 'README.md'),
    `# 期次索引

| 期次名称 | 时间范围 | 状态 | 负责人 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
`
  );

  // 创建 PROJECT/TEAM.md
  await writeFile(
    join(speccoreDir, 'PROJECT', 'TEAM.md'),
    `# 团队与 Git 映射

| 成员 | Git 用户名 | 角色 | 技术栈 | 负责模块 |
| :--- | :--- | :--- | :--- | :--- |
`
  );

  logger.success('项目初始化完成！');
}
