import { ensureDir, writeFile, pathExists, readFile, readdir, copy, unlink, rename } from 'fs-extra';
import { join, basename } from 'path';
import { logger, Spinner } from '../utils/logger';
import { version as PKG_VERSION } from '../../package.json';
import { createInterface } from 'readline';
import { updateContext } from '../core/context';
import { SVG_ONBOARD } from './ask';
// v6.84.0+: AGENTS 规范数据库
import {
  getBuiltinAgentContents,
  getBuiltinRegistryContent,
  getBuiltinTemplateContent,
} from '../core/agents';
// v6.85.0+: RULES 规范库
import { getBuiltinRuleContents } from '../core/rule-loader';
// v6.87.0+: COMMANDS 命令模板
import { getBuiltinCommandContents } from '../core/command-loader';
// v6.88.0+: SKILLS + HOOKS
import { getBuiltinSkillContents } from '../core/skill-loader';
import { getBuiltinHookContents } from '../core/hook-runner';

// ── 升级冲突追踪 ── 覆盖前旧文件重命名为时间戳格式，汇总提示用户对比
export const _updateConflicts: { file: string; backup: string }[] = [];

/** 生成时间戳后缀：YYYYMMDDHHmmss */
function timestampSuffix(): string {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/** 写入前检查冲突：内容不同则 rename 旧文件为 {name}-{timestamp}.{ext} */
export async function safeWriteWithBackup(filePath: string, newContent: string): Promise<void> {
  if (await pathExists(filePath)) {
    const existing = await readFile(filePath, 'utf-8');
    if (existing.trim() !== newContent.trim()) {
      const ts = timestampSuffix();
      const backupPath = filePath.replace(/\.(md|json|txt|yaml)$/, `-${ts}.$1`);
      await rename(filePath, backupPath);
      _updateConflicts.push({ file: filePath, backup: backupPath });
    }
  }
  await writeFile(filePath, newContent);
}

/** 目录复制前，对每个有差异的文件做时间戳重命名 */
export async function safeCopyDirWithBackup(srcDir: string, destDir: string): Promise<void> {
  if (!(await pathExists(srcDir))) return;
  // 源和目标相同则跳过（CLI 自身项目运行时）
  const { realpath } = require('fs-extra');
  try {
    if (await pathExists(destDir)) {
      const realSrc = await realpath(srcDir);
      const realDest = await realpath(destDir);
      if (realSrc === realDest) return;
    }
  } catch {}
  const { copy } = require('fs-extra');
  const { readdir: rd } = require('fs-extra');
  const walk = async (src: string, dest: string) => {
    if (!(await pathExists(src))) return;
    const entries = await rd(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);
      if (entry.isDirectory()) {
        await walk(srcPath, destPath);
      } else if (entry.isFile()) {
        if (await pathExists(destPath)) {
          const oldContent = await readFile(destPath, 'utf-8');
          const newContent = await readFile(srcPath, 'utf-8');
          if (oldContent.trim() !== newContent.trim()) {
            const ts = timestampSuffix();
            const backupPath = destPath.replace(/\.(md|json|txt|yaml)$/, `-${ts}.$1`);
            await rename(destPath, backupPath);
            _updateConflicts.push({ file: destPath, backup: backupPath });
          }
        }
      }
    }
  };
  await walk(srcDir, destDir);
  await copy(srcDir, destDir, { overwrite: true });
}

export interface InitOptions {
  mode?: string;
  force?: boolean;
  interactive?: boolean;
  update?: boolean;
  tools?: string;  // CLI 参数是 --tools（复数）
}

export async function initCommand(options: InitOptions): Promise<void> {
  // ── 增量升级模式 ──
  if (options.update) {
    const { updateCommand } = await import('./update');
    await updateCommand({ force: options.force, tool: options.tools });
    return;
  }

  // ── Interactive mode ──
  if (options.interactive) {
    await interactiveInitFlow(options);
    return;
  }
  await doInit(process.cwd(), options, new Spinner('Initializing SpecCore'));
}

async function doInit(projectRoot: string, options: InitOptions, spinner: Spinner): Promise<void> {
  spinner.start();

  try {
    const projectRoot = process.cwd();
    const speccoreDir = join(projectRoot, '.speccore');

    // Check if already initialized
    if (await pathExists(speccoreDir)) {
      // 先检查升级提示（即使不 --force 也要提示）
      await checkUpgradeHints(projectRoot, speccoreDir);

      // --update 模式：跳过迭代检查，直接更新 Skill/命令文件
      // 非 --update 模式：检查是否有迭代目录
      if (!options.update) {
        const iterRoot = projectRoot;
        const hasIteration = (await pathExists(iterRoot)) && (await import('fs-extra')).readdirSync(iterRoot).filter((n: string) => n.startsWith('Iteration-')).length > 0;
        if (!hasIteration && !options.force) {
          spinner.stop('⚠️  未检测到任何迭代，请运行: speccore iteration create -n Q1 --topic meeting-system');
          logger.info('  然后再跑 speccore init --update 升级');
          return;
        }
      }

      if (!options.force) {
        spinner.stop('更新命令文件和配置...');
        // 委托给 updateCommand 统一处理（避免重复代码）
        const { updateCommand } = await import('./update');
        await updateCommand({ force: true, tool: options.tools });

        // init 额外步骤（updateCommand 不覆盖的）
        await createWorkBuddyFiles(projectRoot);

        // 更新 Spec 文档模板 — 有差异的旧文件重命名为时间戳格式
        const specsSrc = join(__dirname, '..', '..', '.speccore', 'PATTERNS', 'TEMPLATES', 'specs');
        const specsDest = join(speccoreDir, 'PATTERNS', 'TEMPLATES', 'specs');
        if (await pathExists(specsSrc)) {
          await ensureDir(specsDest);
          await safeCopyDirWithBackup(specsSrc, specsDest);
        }

        // 更新版本号（last-init-version.txt 同步）
        const lastInitFile = join(speccoreDir, 'local', 'last-init-version.txt');
        await writeFile(lastInitFile, PKG_VERSION);

        // 重置 onboard 标记，确保升级后首次 ask 展示引导页
        try { await unlink(join(speccoreDir, 'local', '.ask-onboarded')); } catch {}

        // 生成升级欢迎页
        await writeUpgradePage(projectRoot, PKG_VERSION, speccoreDir);

        logger.info('');
        logger.info('📋 init 额外更新:');
        logger.info('   ✅ WorkBuddy 配置');
        logger.info('   ✅ Spec 文档模板');
        logger.info('   ✅ 升级欢迎页: speccore-upgrade.html');
        logger.info('');
        logger.info('💡 强制重置: speccore init --force');
        logger.info('');

        // 检查全局 CLI 是否需要更新
        try {
          const { execSync } = require('child_process');
          const globalVer = execSync('speccore --version 2>/dev/null || echo "0.0.0"', { encoding: 'utf-8', timeout: 3000 }).trim();
          const projectVer = PKG_VERSION;
          if (globalVer !== projectVer && globalVer !== '0.0.0') {
            logger.warn(`⚠️  全局 speccore CLI 版本: ${globalVer}，项目要求: ${projectVer}`);
            logger.warn(`   👉 请执行: npm update -g speccore`);
            logger.warn(`   否则 AI 运行的 analyze/split/plan 等命令会使用旧版本，导致结果异常`);
          }
        } catch { /* non-critical */ }
        return;
      }
      
      // ── 二次确认 ──
      spinner.stop();
      logger.warn('⚠️  --force 将完全重置 .speccore/ 配置！');
      logger.info('');
      logger.warn('   ❌ 计数器 (counters.json) 将丢失 → 可能导致编号重复');
      logger.warn('   ❌ INDEX.md / 需求数据将丢失');
      logger.warn('   ❌ 项目配置 (PROJECT/*.md) 将重置为模板');
      logger.info('');
      logger.info('   💡 升级请用: speccore init --update --force（保留计数器和数据）');
      logger.info('');
      const answer = await askUser('确认完全重置？(y/N): ');
      if (!answer.toLowerCase().startsWith('y')) {
        logger.info('已取消');
        logger.info('💡 安全升级: speccore init --update');
        return;
      }

      // ── 冲突提示（不备份，init 只写 .speccore/ 和自动生成文件）──
      // Iteration-*/ 等用户目录 init 不会触碰，无需备份
      logger.info('');
      
      spinner.start();
    }

    // Create directory structure
    await ensureDir(join(speccoreDir, 'PROJECT'));
    await ensureDir(join(speccoreDir, 'PATTERNS'));
    await ensureDir(join(speccoreDir, 'ITERATIONS'));
    await ensureDir(join(speccoreDir, 'RULES'));
    await ensureDir(join(speccoreDir, 'local'));
    await ensureDir(join(speccoreDir, 'local', 'locks'));
    await ensureDir(join(speccoreDir, 'local', 'notifications'));
    await ensureDir(join(speccoreDir, 'config'));
    await ensureDir(join(speccoreDir, 'GLOBAL'));
    await ensureDir(join(speccoreDir, 'GLOBAL', 'PROJECTS'));
    await ensureDir(join(speccoreDir, 'GLOBAL', 'PROJECTS', '_template'));
    await ensureDir(join(speccoreDir, 'PATTERNS', 'TEMPLATES', 'crud'));
    await ensureDir(join(speccoreDir, 'PATTERNS', 'TEMPLATES', 'auth'));
    await ensureDir(join(speccoreDir, 'PATTERNS', 'TEMPLATES', 'export'));
    await ensureDir(join(speccoreDir, 'PATTERNS', 'TEMPLATES', 'report'));
    await ensureDir(join(speccoreDir, 'PATTERNS', 'TEMPLATES', 'specs'));
    await ensureDir(join(speccoreDir, 'inbox'));
    await ensureDir(join(speccoreDir, 'questions'));
    // v6.94.0+: 代码知识图谱目录
    await ensureDir(join(speccoreDir, 'code-graph'));

    // Create default files
    await createDefaultFiles(projectRoot, speccoreDir);

    // Create GLOBAL layer files
    await createGlobalFiles(speccoreDir);

    // Create .workbuddy integration files for WorkBuddy IDE
    await createWorkBuddyFiles(projectRoot);

    // Create tool integration files (Claude, CodeBuddy, Cursor, Trae, WindSurf, QCoder)
    await createToolIntegrations(projectRoot, options.tools);

    // Create sample iteration（已存在则跳过）
    if (!await pathExists(join(projectRoot, 'Iteration-sample'))) {
      await createSampleIteration(projectRoot);
    }

    // Create context.json（已存在则跳过）
    const ctxPath = join(speccoreDir, 'local', 'context.json');
    if (!await pathExists(ctxPath)) {
      await writeFile(ctxPath,
      JSON.stringify({
        currentIteration: '',
        currentTask: '',
        currentAssignee: '',
        lastUpdated: new Date().toISOString(),
        lastAction: '',
        lastIntent: '',
        interruptedAt: '',
        iterationStatus: '',
        pendingTasks: 0,
        inProgressTasks: 0,
        completedTasks: 0,
        blockedTasks: 0,
        customAliases: {},
        history: []
      }, null, 2)
    );
    } // if context.json 不存在

    // 写入版本号追踪
    await writeFile(
      join(speccoreDir, 'local', 'version.json'),
      JSON.stringify({ version: PKG_VERSION, createdAt: new Date().toISOString() }, null, 2)
    );

    // Create .gitignore entry
    await updateGitignore(projectRoot);

    // ── AI 使用规则 ──
    await writeFile(join(projectRoot, '.speccore', 'AI-RULES.md'), generateAIRulesContent());
    logger.info('   🤖 已生成 AI 使用规则: .speccore/AI-RULES.md');

    // ── AGENTS.md + 工具适配（Cursor/Windsurf/Claude 等）──
    await writeAgentsMd(projectRoot);
    // CLAUDE.md 指向 AGENTS.md
    await writeFile(join(projectRoot, 'CLAUDE.md'), `<!-- 规则请参考 AGENTS.md -->\n\n@AGENTS.md\n`);

    // v6.84.0+: AGENTS 规范数据库 — 初始化默认角色
    await initAgentsDir(projectRoot);

    // v6.85.0+: RULES 规范库 — 初始化默认编码规范
    await initRulesDir(projectRoot);

    // v6.87.0+: COMMANDS 命令模板 — 初始化默认模板
    await initCommandsDir(projectRoot);

    // v6.88.0+: SKILLS 可复用技能库
    await initSkillsDir(projectRoot);

    // v6.88.0+: HOOKS 生命周期钩子
    await initHooksDir(projectRoot);

    // v6.99.0+: AGENTS 专用角色定义目录
    await ensureDir(join(projectRoot, '.agents', 'agents'));

    // v6.98.0+: 同步 AGENTS.md — 将 .speccore/ 规范数据库投影到 AGENTS.md
    await syncAgentsMd(projectRoot);

    // Update context
    await updateContext({ lastUpdated: new Date().toISOString() });

    spinner.stop('SpecCore initialized successfully!');
    logger.info('');
    logger.info('Next steps:');
    logger.info('  1. Edit .speccore/CONSTITUTION.md to define your tech stack');
    logger.info('  2. Edit .speccore/PROJECT/TEAM.md to add team members');
    logger.info('  3. Run: speccore analyze --scope global to analyze your codebase');
    logger.info('  4. Run: speccore iteration create --name=Q1 to start an iteration');
    logger.info('  5. Run: speccore doc2spec -f requirements.docx to import docs');
    logger.info('');
    logger.info('💡 WorkBuddy Integration: .workbuddy/ files created.');
    logger.info('   Reopen this project in WorkBuddy to enable Speccore commands.');

    // ── 生成项目配置引导页（首次 init）──
    try {
      const guidePath = await writeSetupGuide(projectRoot, speccoreDir);
      logger.info('');
      logger.info(`📋 项目配置引导页已生成: ${guidePath}`);
      logger.info('   打开查看配置步骤和用法');
      // AI 平台标记：触发 present_files 弹出引导页
      console.log(`[SPECCORE_SETUP_GUIDE: ${guidePath}]`);
    } catch { /* 引导页生成失败不阻断 init */ }
  } catch (error) {
    spinner.fail(`Initialization failed: ${error}`);
    throw error;
  }
}

async function createDefaultFiles(projectRoot: string, speccoreDir: string): Promise<void> {
  // CONSTITUTION.md — 自动检测项目信息（已存在则跳过，保护用户配置）
  if (await pathExists(join(speccoreDir, 'CONSTITUTION.md'))) {
    logger.info('   🛡️ CONSTITUTION.md 已存在，跳过（保护用户配置）');
  } else {
    const projectName = require('path').basename(projectRoot);
    const gitUrl = detectGitUrl(projectRoot);
    await writeFile(
    join(speccoreDir, 'CONSTITUTION.md'),
    `# 技术宪法

> 本文档是 SpecCore 与 AI 的**最高优先级契约**。analyze/split/execute 均据此执行。
> AI 读取顺序：CONSTITUTION → context.json → 迭代目录

## 端列表（全局权威）

> ⚠️ **工程标识是全项目唯一的端标识符**，所有命令（analyze/split/execute）、目录名（020-specs/{端}/）、模板目录（templates/{level}/{端}/）均使用此处声明的端名。

| 工程标识 | 描述 | 工程类型 |
| :--- | :--- | :--- |
| app | 移动端 APP | Android移动端 |
| h5 | 移动 H5 端 | H5移动端 |
| miniapp | 小程序端 | 微信小程序 |
| admin | 后台管理端 | Web管理后台 |

> **端名规则**：
> - 工程标识 = 工程名，一一对应（一个端 = 一个完整的服務/应用 = 一个 git 仓库）
> - 全小写、无空格、用短横线分隔（如 order-service）
> - 工程类型：AI 据此生成针对性内容（见下方工程类型枚举）
> - 此列表是 analyze/split/execute 的唯一端名来源
> - 「对应端」列引用此列表中的工程标识，每行只填一个

> **工程类型枚举**（可自定义）：
> - 后端：Java服务 / Node服务 / Go服务 / Python服务
> - 前端：H5微信公众号 / H5移动端 / Web管理后台 / 桌面应用
> - 移动端：Android移动端 / iOS移动端
> - 小程序：微信小程序 / 支付宝小程序

## 项目信息

| 工程标识 | 项目名称 | 源码路径 | Git 仓库 | 默认分支 | 对应端 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| ${projectName} | 待填写 | ./ | ${gitUrl || '待配置'} | main | 待填写 |

> ⚠️ **项目名称** 是给人和 AI 看的业务名称（如"食堂后台管理"、"商户入驻系统"），不同于技术上的工程标识。
>   AI 会据此理解项目业务范围，在分析/拆分/生成代码时作为上下文参考。

> 多工程示例（每个端 = 一个独立工程）:
>
> | 工程标识 | 项目名称 | 源码路径 | Git 仓库 | 默认分支 | 对应端 |
> | :--- | :--- | :--- | :--- | :--- | :--- |
> | admin-web | 后台管理端 | ./packages/admin | git@xxx/admin.git | main | admin |
> | h5-app | 移动H5端 | ./packages/h5 | git@xxx/h5.git | main | h5 |
> | android-app | Android端 | ./packages/android | git@xxx/android.git | main | android |
> | backend-service | 后台服务 | ./packages/backend | git@xxx/backend.git | main | backend |
>
> **关键规则**：
> - 「对应端」列的值必须引用「端列表」中已声明的端名
> - 一一对应：每行一个工程对应一个端名（不填多个）
> - 如果一个服务拆成多个工程（如 user-service + order-service 都属于 backend），应在「端列表」中分别声明

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

## Git 分支策略
- 默认分支: main  (可选: master / develop / trunk / release)
- 任务分支: feature/{Task-ID}
- 发布分支: release/{version}
- 保护分支: main, master, release/*, production
  > 保护分支上禁止直接 commit 和 push，只能通过 PR 合并
  > 支持精确匹配和通配符（如 release/*）
`
  );
  } // if CONSTITUTION.md 不存在

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
    `# 迭代索引

| 迭代名称 | 时间范围 | 状态 | 负责人 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| | | | | |
`
  );

  // SETTINGS.md
  await writeFile(
    join(speccoreDir, 'SETTINGS.md'),
    generateSettingsContent()
  );

  // Ask 引擎配置
  await writeFile(
    join(speccoreDir, 'config', 'ask.json'),
    JSON.stringify({
      routing: {
        mode: 'hybrid',
        highThreshold: 70,
        lowThreshold: 45,
        autoHostAi: true,
        cacheEnabled: true,
        cacheMinHits: 3,
      },
      rules: {
        forceHostAi: false,
      },
      llmProviders: [
        {
          name: 'ollama-local',
          enabled: false,
          type: 'ollama',
          endpoint: 'http://localhost:11434',
          model: 'qwen2.5:7b',
          priority: 1,
        },
        {
          name: 'openai-compatible',
          enabled: false,
          type: 'openai',
          endpoint: 'https://api.openai.com/v1/chat/completions',
          model: 'gpt-4o-mini',
          priority: 2,
        },
      ],
      _example: {
        description: '以下是 AI 响应 JSON 格式示例与 Provider 配置示例（供参考，不会实际生效）',
        aiResponseFormat: {
          intent: 'execute',
          command: 'execute',
          args: { task: 'Task-001', batchSize: '3' },
          confidence: 92,
          reasoning: "用户说'把登录做了'，当前迭代有 Task-001-用户登录，且项目已进入 execute 阶段",
          needsConfirm: true,
        },
        providerConfigExample: {
          name: 'your-custom-provider',
          enabled: true,
          type: 'openai',
          endpoint: 'https://your-api.com/v1/chat/completions',
          model: 'gpt-4o',
          apiKey: '${SPECCORE_LLM_KEY}',
          priority: 1,
        },
      },
    }, null, 2)
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

  // POST_COMPLETION.md (Feature 完成后的维护流程)
  await writeFile(
    join(speccoreDir, 'RULES', 'POST_COMPLETION.md'),
    `# Feature 完成后的维护流程

> 当 Feature 已签署 ✅ 已完成 后，本文件定义其线上运行与维护期的标准流程。

## 1. Feature 状态扩展

| 状态 | 图标 | 含义 | 触发条件 |
| :--- | :--- | :--- | :--- |
| 已完成 | ✅ | Spec 与代码完全对齐，已上线 | 开发完成 + 验收通过 |
| 待反向同步 | ⚠️ | 代码已改但 Spec 未同步 | 紧急补丁后 |
| 维护中 | 🔄 | 正在回归或功能增强 | 分配维护任务后 |
| 已废弃 | 🚫 | 功能下线，不再维护 | 业务下线 + 代码移除 |

## 2. 补丁反向同步流程（⚠️ → ✅）

1. AI 读取当前代码，对比 Spec 文件，生成差异报告
2. 逐项更新：REQ.md、API_CONTRACT.yaml、TASK.md
3. 更新变更履历
4. 更新 PROJECT_GRAPH.md 状态

## 3. Bug 修复流程（✅ → 🔄 → ✅）

1. 标记状态为 🔄 维护中
2. 根因分析 → 追加到 TASK.md「线上问题记录」
3. 沉淀到 PATTERNS/ 模式库
4. 回归验证 → 恢复状态到 ✅

## 4. 功能增强流程（✅ → 🔄 → ✅）

1. 标记状态为 🔄 维护中
2. 在 REQ.md 追加新需求
3. 更新 API_CONTRACT.yaml
4. 更新 TASK.md 和 E2E-TEST-SPEC.md
5. 完成后改回 ✅

## 5. 功能下线流程（✅ → 🚫）

1. 状态改为 🚫 已废弃
2. PATTERNS/ 标记相关模式为「仅作历史参考」
3. 代码保留至少一个迭代周期
4. 最后一个周期后删除代码和 Spec

## 6. 维护检查清单

- [ ] 是否已更新所有受影响的 Spec 文件？
- [ ] 是否已在变更履历中追加记录？
- [ ] 是否已更新 PROJECT_GRAPH.md 状态？
- [ ] 是否已沉淀到 PATTERNS/ 模式库？
- [ ] 是否已回归 E2E-TEST-SPEC.md 测试场景？

若有任何一项为"否"，不得将状态改回 ✅ 已完成。
`
  );
}

async function updateGitignore(projectRoot: string): Promise<void> {
  const gitignorePath = join(projectRoot, '.gitignore');
  const entry = '# SpecCore local config\n.speccore/local/\nIteration-*/.local/\n# SpecCore generated AI skills\n.agents/\n';

  if (await pathExists(gitignorePath)) {
    const content = await readFile(gitignorePath, 'utf-8');
    if (!content.includes('.speccore/local/')) {
      await writeFile(gitignorePath, content + '\n' + entry);
    }
  } else {
    await writeFile(gitignorePath, entry);
  }
}

/**
 * 创建 GLOBAL 全量层目录和模板文件
 */
async function createGlobalFiles(speccoreDir: string): Promise<void> {
  const globalDir = join(speccoreDir, 'GLOBAL');

  // GLOBAL/INDEX.md - 全局知识库索引（导航入口）
  await writeFile(
    join(globalDir, 'INDEX.md'),
    `# 全局知识库索引

> 本文件是全局知识库的导航入口。由 \`speccore synthesize --phase 3\` 自动更新。
> 各端分析文档见 \`platforms/\`，跨端综合文档见 \`synthesis/\`。

## 跨端综合文档（synthesis/）

| 文档 | 说明 |
| :--- | :--- |
| _等待 synthesize 生成_ | 跨端架构、技术方案、业务关系 |

## 各端分析文档（platforms/）

| 端 | 文档 | 说明 |
| :--- | :--- | :--- |
| _等待 synthesize 生成_ | — | 各端独立分析 |

## 术语表

- [GLOSSARY.md](./GLOSSARY.md) — 跨项目统一术语定义
`
  );

  // GLOBAL/GLOSSARY.md - 全量术语表
  await writeFile(
    join(globalDir, 'GLOSSARY.md'),
    `# 全量术语表

> 本文档是跨项目统一术语定义，确保团队对核心概念的理解一致。

## 业务术语

| 术语 | 英文 | 定义 | 使用场景 | 相关需求 |
| :--- | :--- | :--- | :--- | :--- |
| _待补充_ | - | - | - | - |

## 技术术语

| 术语 | 英文 | 定义 | 使用场景 | 相关项目 |
| :--- | :--- | :--- | :--- | :--- |
| _待补充_ | - | - | - | - |

## 缩写对照

| 缩写 | 全称 | 说明 |
| :--- | :--- | :--- |
| _待补充_ | - | - |
`
  );
}

/**
 * 创建 .workbuddy/ 集成文件，让 WorkBuddy IDE 自动识别 Speccore 项目
 * 包括项目记忆文件和 Speccore skill
 */
async function createWorkBuddyFiles(projectRoot: string): Promise<void> {
  const workbuddyDir = join(projectRoot, '.workbuddy');

  // .workbuddy/memory/MEMORY.md — 项目记忆（告诉 WorkBuddy 这是 Speccore 项目）
  await ensureDir(join(workbuddyDir, 'memory'));
  await writeFile(
    join(workbuddyDir, 'memory', 'MEMORY.md'),
    `# Project Memory — Speccore Managed

This project uses **SpecCore** (\`speccore\` CLI) for spec-driven development.

## Key Paths

| Path | Purpose |
|------|---------|
| \`.speccore/\` | All SpecCore data — **source of truth for requirements** |
| \`.speccore/GLOBAL/INDEX.md\` | Multi-project requirement catalog |
| \`.speccore/CONSTITUTION.md\` | Tech stack and naming conventions |
| \`.speccore/SETTINGS.md\` | Framework configuration |
| \`.speccore/local/context.json\` | Runtime context (current iteration, task) |
| \`.speccore/PATTERNS/TEMPLATES/\` | Code pattern templates |

## Workflow

1. \`speccore init\` — first-time setup (already done)
2. \`speccore import --project=<name>\` — import source code
3. \`speccore goal\` — create requirements
4. \`speccore iteration create\` — start iteration
5. \`speccore spec "<query>"\` — smart entry via intent recognition

## Important Conventions

- All requirements live in \`.speccore/\`, not in \`.workbuddy/\`
- \`speccore\` CLI is the authoritative tool for spec management
- Use \`speccore spec "..."\` for natural language command matching
- The GLOBAL layer enables cross-project requirement tracking
`
  );

  // .workbuddy/skills/speccore/SKILL.md — Speccore skill（让 WorkBuddy 掌握 speccore 命令）
  await ensureDir(join(workbuddyDir, 'skills', 'speccore'));
  await writeFile(
    join(workbuddyDir, 'skills', 'speccore', 'SKILL.md'),
    `---
name: speccore
description: SpecCore spec-driven development CLI integration. Detects .speccore/ projects and enables AI-powered requirements, iteration management, global architecture layer, and intent recognition.
version: 1.0.0
triggers:
  - speccore
  - spec
  - 需求
  - 迭代
  - 规格
  - 全量层
  - 意图识别
  - requirement
  - iteration
  - global layer
  - 变更影响
  - 基线
  - 审计
---

# SpecCore — Spec-Driven Development CLI

This skill activates when the user opens a project containing a \`.speccore/\` directory, or when they mention spec-driven development, requirement management, or any Speccore command.

## Project Detection

A project is a Speccore project if \`.speccore/\` exists in the project root. Key files:
- \`.speccore/CONSTITUTION.md\` — tech stack constitution
- \`.speccore/SETTINGS.md\` — framework configuration
- \`.speccore/GLOBAL/INDEX.md\` — multi-project global requirement index
- \`.speccore/PROJECT/INDEX.md\` — local project index
- \`.speccore/PROJECT/TEAM.md\` — team members & git mapping
- \`.speccore/ITERATIONS/README.md\` — iteration index
- \`.speccore/RULES/POST_COMPLETION.md\` — post-completion maintenance rules
- \`.speccore/local/context.json\` — runtime context (current iteration, task, assignee)

## Multi-Project Global Layer

\`\`\`
.speccore/GLOBAL/
├── INDEX.md          # Universal requirement catalog
├── OVERVIEW.md       # Cross-project panorama
├── ARCHITECTURE.md   # System architecture (mermaid)
├── TECH_STACK.md     # Unified tech stack registry
├── CODE_INDEX.md     # Code path mappings
├── GLOSSARY.md       # Cross-project glossary
├── PROTOTYPE_INDEX.md
├── CHANGELOG.md      # Global change log
├── BASELINES/        # Version baselines
└── PROJECTS/{proj}/  # Per-project requirements
\`\`\`

## Speccore Commands Quick Reference

### Setup & Import
- \`speccore init\` — Initialize (already done)
- \`speccore import --project=<name> [--type=backend|web|...] --path=<path>\` — Import source code
- \`speccore global-status\` — View multi-project overview

### Spec-Driven Development
- \`speccore spec "<natural language>"\` — Smart entry via intent recognition
- \`speccore goal --name="<name>" [--iteration=<it>]\` — Create new requirement

### Iteration Management
- \`speccore iteration create --name="<name>" [--goal=<goal>]\` — Start iteration
- \`speccore iteration-from-global [--project=<name>]\` — Generate from global layer
- \`speccore sync-global [--iteration=<name>]\` — Sync back to global

### Analysis & Quality
- \`speccore impact --req=<id>\` — Change impact analysis
- \`speccore audit [--strict]\` — Quality audit (duplicates, conflicts)
- \`speccore dashboard\` — HTML dashboard
- \`speccore history [--req=<id>]\` — Change history

### Maintenance
- \`speccore bugfix --title="<desc>"\` — Quick bug fix
- \`speccore change --req=<id> --desc="<desc>"\` — Requirement change
- \`speccore handover [--iteration=<name>]\` — Handover document
- \`speccore retro [--iteration=<name>]\` — Retrospective
- \`speccore rename --target=<old> --new-name=<new>\` — Rename
- \`speccore baseline create --name=<name>\` — Version snapshot

## Working with Speccore Projects

1. **Always read \`.speccore/local/context.json\` first** to understand current state
2. **Before creating specs**, read \`.speccore/CONSTITUTION.md\` for conventions
3. **For multi-project work**, check \`.speccore/GLOBAL/INDEX.md\`
4. **Run commands directly** using \`speccore\` CLI
5. **After changes**, suggest running sync or audit

## Quick Aliases

| Alias | Command |
|-------|---------|
| in | init |
| imp | import |
| it | iteration |
| ex | expand |
| pl | plan |
| pg | program |
| ch | create |
| if | impact |
| bl | baseline |
| db | dashboard |
| ad | audit |
| sg | sync-global |
| gs | global-status |
| hs | history |
| ifg | iteration-from-global |
`
  );
}

// ── 交互式初始化 ──
async function interactiveInitFlow(options: InitOptions): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(`${q} `, a => r(a.trim())));

  logger.info('\n SpecCore 初始化向导\n');

  logger.info(`\n📁 .speccore/ + .workbuddy/ 集成文件`);

  const confirm = await ask('\n确认初始化？ [y/n]: ');
  rl.close();
  if (confirm !== 'y') { logger.info('已取消'); return; }

  await doInit(process.cwd(), options, new Spinner('Initializing SpecCore'));
}

/**
 * 为各 AI 工具创建适配文件 (Claude, CodeBuddy, Cursor, Trae, WindSurf, QCoder)
 */
async function askUser(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, (ans: string) => { rl.close(); resolve(ans); }));
}

export const TOOL_COMMANDS: [string, string, string][] = [
  ['spec-ask', 'SpecCore AI Router', '##  核心铁律\n1. 用户说"重新/再/重跑"禁止用"未变/已完成"拒绝\n2. 分析结果必须落盘 020-specs/，禁止只输出聊天文字\n3. 全流程（analyze→split→plan→execute）必须自动继续\n4. 复杂流程先展示执行计划页面再执行\n5. 用户说"自主/全自动"，展示计划后直接执行，禁止每步确认\n\n## 🎯 HTML 页面强制展示\n\n执行任何 `speccore` 命令后，检查 stdout 中的标记，**立即执行** `present_files(<path>)`：\n- `[SPECCORE_ONBOARD: <path>]` → 引导页（🚨 最先处理，禁止跳过）\n- `[SPECCORE_SETUP_GUIDE: <path>]` → 配置引导页\n- `[SPECCORE_ABOUT: <path>]` → 版本信息页\n- `[SPECCORE_HELP: <path>]` → 帮助中心页\n- `[SPECCORE_WELCOME: <path>]` → 项目名片页\n- `[SPECCORE_DEV: <path>]` → 开发流程页\n- `[SPECCORE_KNOWLEDGE: <path>]` → 知识图谱页\n- `[SPECCORE_PLAN: <path>]` → 执行计划页\n- `[SPECCORE_RETRO: <path>]` → 回顾报告页\n- `[SPECCORE_DASHBOARD: <path>]` → 仪表盘页\n\n❌ 禁止只说"检测到"而不执行展示\n❌ 禁止用文字描述代替实际展示\n\n## 执行\n1. Read CONITUTION.md + context.json\n2. 识别意图，展示执行计划\n3. speccore ask "${1:描述你的需求}"'],
  ['spec-welcome', '显示项目名片（HTML页面）', 'speccore welcome'],
  ['spec-help', '显示命令帮助中心（HTML页面）', 'speccore help'],
  ['spec-dashboard', '显示全局仪表盘（HTML页面）', 'speccore dashboard --scope global'],
  ['spec-init', '初始化项目 或 升级命令文件: --update', 'speccore init'],
  ['spec-doc2spec', '导入需求文档: 文件=${1:PRD.docx} 迭代=${2:Q1}', 'speccore doc2spec -f ${1:PRD.docx} --iter ${2:Q1}'],
  ['spec-analyze', 'SpecCore Analysis', '直接执行: execute_command("speccore ask \'用户原话\'")\n\n不要输出命令文本，不要分析意图，一切交给 speccore ask。'],
  ['spec-split', 'SpecCore Task Split', '## ⛔ 铁律: 分析完成后必须拆分，禁止跳过\n1. Read 020-specs/ for analysis docs\n2. Dry-run split and show preview\n3. Execute: speccore iteration split -i ${1:Q1} --owner ${2|张三,李四,王五|}'],
  ['spec-execute', 'SpecCore Execute', '## ⛔ 铁律: 有任务就执行，禁止说"已完成"跳过\n1. Read Task REQ.md + TECH.md\n2. Show plan then execute: speccore execute -i ${1:Q1} -t ${2:Task-001} --force'],
  ['spec-plan', '生成并展示执行计划可视化页面', '1. 仅生成并展示计划页面，不执行代码修复\n2. speccore plan -I ${1:Q1} --owner ${2|张三,李四,王五|} --html\n3. 打开 speccore-plan.html'],
  ['spec-pr', '创建PR: 任务=${1:Task-001}', 'speccore pr --task=${1:Task-001}'],
  ['spec-done', '任务归档: 任务=${1:Task-001}', 'speccore done --task=${1:Task-001}'],
  ['spec-spec2doc', '导出文档: 迭代=${1:Q1} 格式=${2|需求.docx,方案.pdf|}', 'speccore spec2doc -i ${1:Q1} -o ${2|需求.docx,方案.pdf|}'],

  ['spec-change', '需求变更: 描述=${1:变更描述} 任务=${2:Task-001}', 'speccore change "${1:变更描述}" --task=${2:Task-001} --type ${3|feature,bugfix|}'],
  ['spec-validate', '合规验证: 迭代=${1:Q1}', 'speccore validate --iteration=${1:Q1}'],
  ['spec-search', '全文搜索: ${1:关键词}', 'speccore search ${1:关键词}'],
  ['spec-track', '全链路追踪: 需求=${1:REQ-001}', 'speccore track --req=${1:REQ-001}'],
  ['spec-sync', '双向同步全局', 'speccore sync --global'],
  ['spec-rename', '重命名: 旧名=${1:Q1} 新名=${2:Q2}', 'speccore rename --iteration ${1:Q1} ${2:Q2}'],
  ['spec-iteration-create', '创建迭代: 名称=${1:Q2} 负责人=${2|张三,李四,王五|}', 'speccore iteration create -n ${1:Q2} --owner=${2|张三,李四,王五|}'],
  ['spec-task-create', '创建任务: 交互式需求澄清 → 生成 REQUIREMENT.md', 'speccore task new --name ${1:任务名称}'],
  ['spec-retro', '回顾报告: 任务=${1:Task-001} 可批量 --all', 'speccore retro --task ${1:Task-001}'],
  ['spec-context', '切换上下文: 迭代=${1:Q1}', 'speccore context --set --iteration ${1:Q1}'],
  ['spec-ops', '操作历史', 'speccore ops'],
];

export async function createToolIntegrations(projectRoot: string, toolFilter?: string): Promise<void> {
  const commands = TOOL_COMMANDS;

  const allTools = ['claude', 'codebuddy', 'cursor', 'trae', 'trae-cn', 'windsurf'];
  const filter = toolFilter ? toolFilter.split(',').map(t => t.trim()) : null;
  const tools = filter ? allTools.filter(t => filter.includes(t) || filter.includes(t.replace('-cn', ''))) : allTools;
  for (const tool of tools) {
    const toolDir = join(projectRoot, '.' + tool, 'commands');
    // 解析符号链接：如果 commands 是符号链接，替换为真实目录
    try {
      const stat = await require('fs-extra').lstat(toolDir);
      if (stat.isSymbolicLink()) {
        await require('fs-extra').remove(toolDir);
        await ensureDir(toolDir);
      }
    } catch {}
    await ensureDir(toolDir);
    for (const [name, desc, cmd] of commands) {
      // v6.77.2+: 所有有 SKILL.md 的命令使用动态路由格式（走 speccore ask 引擎）
      const isDynamicRouting = ['spec-analyze', 'spec-ask', 'spec-change', 'spec-doc2spec', 'spec-done', 'spec-execute', 'spec-iteration-create', 'spec-plan', 'spec-pr', 'spec-spec2doc', 'spec-split', 'spec-task-create'].includes(name);
      const content = isDynamicRouting
        ? '---\nname: ' + name + '\ndescription: ' + desc + '\n---\n\n' + cmd
        : '---\nname: ' + name + '\ndescription: ' + desc + '\n---\n' + cmd;
      await writeFile(join(toolDir, name + '.md'), content);
    }
    // 清理该工具目录下的废弃命令文件
    const validNames = new Set(commands.map(([n]) => n + '.md'));
    try {
      const existing = await readdir(toolDir);
      for (const f of existing) {
        if (f.endsWith('.md') && !validNames.has(f)) { await require('fs-extra').unlink(join(toolDir, f)); }
      }
    } catch {}
  }
  const hasQoder = !filter || filter.includes("qoder");
  if (hasQoder) {
  // QCoder: 项目级指令路径 = .qoder/commands/，使用 spec: 前缀扁平命名
  const qoderCommandsDir = join(projectRoot, '.qoder', 'commands');
  // 解析符号链接
  try {
    const stat = await require('fs-extra').lstat(qoderCommandsDir);
    if (stat.isSymbolicLink()) {
      await require('fs-extra').remove(qoderCommandsDir);
      await ensureDir(qoderCommandsDir);
    }
  } catch {}
  await ensureDir(qoderCommandsDir);
  for (const [name, desc, cmd] of commands) {
    // Qoder 统一使用 spec-analyze 格式（跨平台安全，Linux 不支持冒号）
    // v6.54.0+: 使用动态路由格式，调用 speccore ask 引擎
    let content = '---\nname: ' + name + '\ndescription: ' + desc + '\n---\n\n直接执行: execute_command("speccore ask \'用户原话\'")\n\n不要输出命令文本，不要分析意图，一切交给 speccore ask。';
    
    // v6.62.0+: spec-ask 必须包含引导页强制展示规则
    if (name === 'spec-ask') {
      content += '\n\n## 🚨 引导页强制展示规则\n\n';
      content += '执行 `speccore ask` 后，检查 stdout 中的 `[SPECCORE_ONBOARD: <path>]` 标记：\n';
      content += '- **如果检测到该标记，必须立即执行** `present_files(<path>)` 展示 HTML 引导页\n';
      content += '- ❌ **禁止**只说“检测到引导页”而不执行展示动作 — 说了不等于做了\n';
      content += '- ❌ **禁止**用文字描述引导页内容代替实际展示 — 必须让用户看到 HTML 页面\n';
      content += '- **展示完成后**，再继续处理其他输出\n';
    }
    
    await writeFile(join(qoderCommandsDir, name + '.md'), content);
  }
  // 清理 Qoder 目录：废弃文件 + 旧格式残留
  const validQoderNames = new Set(commands.map(([n]) => n + '.md'));
  try {
    const existing = await readdir(qoderCommandsDir);
    for (const f of existing) {
      const fp = join(qoderCommandsDir, f);
      // 清理旧版 spec: 前缀文件（已改用 spec- 前缀）
      if (f.startsWith('spec:') && f.endsWith('.md')) { await require('fs-extra').unlink(fp); continue; }
      // 清理已废弃的命令文件
      if (f.startsWith('spec') && f.endsWith('.md') && !validQoderNames.has(f)) { await require('fs-extra').unlink(fp); }
    }
  } catch {}
  
  // 清理旧的不规范目录 (.qcoder/)
  const legacyQcoderDir = join(projectRoot, '.qcoder');
  try {
    if (await pathExists(legacyQcoderDir)) {
      await require('fs-extra').remove(legacyQcoderDir);
    }
  } catch { /* ignore */ }
  
  // Qoder rules — AI 自动读取
  const qoderRulesDir = join(projectRoot, '.qoder', 'rules');
  await ensureDir(qoderRulesDir);
  await writeFile(join(qoderRulesDir, 'speccore.md'), `# SpecCore 规则
- 必须用 execute_command 执行 CLI 命令，决不要输出命令文本给用户复制
- 所有确定性操作通过 speccore CLI 完成
- 详细规则见 AGENTS.md
`);
  } // if hasQoder

  // Skill files — 从 CLI 自身的 .agents/skills/ 读取并复制到项目
  // 这样 Skill 文件有单一事实来源，修改 Skills 后无需同步修改 init.ts
  const cliSkillsDir = join(__dirname, '..', '..', '.agents', 'skills');
  const projectSkillsDir = join(projectRoot, '.agents', 'skills');
  
  // 需要部署的 Skill 列表（按依赖顺序）
  const skillNames = [
    'speccore-router',
    'spec-ask',
    'spec-welcome',
    'spec-help',
    'spec-dashboard',
    'spec-task-create',
    'spec-iteration-create',
    'spec-analyze',
    'spec-split',
    'spec-execute',
    'spec-plan',
    'spec-change',
    'spec-doc2spec',
    'spec-spec2doc',
    'spec-pr',
    'spec-done',
  ];
  
  let skillsCopied = 0;
  for (const name of skillNames) {
    const srcDir = join(cliSkillsDir, name);
    const destDir = join(projectSkillsDir, name);
    try {
      if (await pathExists(srcDir)) {
        // 复制整个 Skill 目录（包括 SKILL.md + references/ + scripts/）— 直接覆盖
        const { copy } = require('fs-extra');
        await copy(srcDir, destDir, { overwrite: true });
        skillsCopied++;
      } else {
        logger.info(`   ⚠️ Skill 源文件不存在，跳过: ${name}`);
      }
    } catch (e) {
      logger.info(`   ⚠️ 无法复制 Skill ${name}: ${e}`);
    }
  }
  
  logger.info(`   🤖 已部署 ${skillsCopied}/${skillNames.length} 个 Skill`);
  logger.info('   🤖 已适配: Claude / CodeBuddy / Cursor / Trae / WindSurf / QCoder');

  // ── 清理旧版本残留文件 ──
  await cleanupStaleFiles(projectRoot, commands, skillNames);
}

/**
 * 清理旧版本残留的命令文件和 Skill 目录。
 * 遍历所有工具目录和 .agents/skills/，移除当前版本不存在的文件。
 */
export async function cleanupStaleFiles(
  projectRoot: string,
  commands: [string, string, string][],
  skillNames: string[]
): Promise<void> {
  const allTools = ['claude', 'codebuddy', 'cursor', 'trae', 'trae-cn', 'windsurf'];
  const validCmdNames = new Set(commands.map(([name]) => name + '.md'));
  let cleanedCount = 0;

  // 0. 清理旧版 -old 后缀备份文件（v5.87.2 之前创建的）
  const oldSuffixPatterns = ['-old', '-backup'];
  for (const tool of [...allTools, 'qoder']) {
    const dirs = [
      join(projectRoot, '.' + tool, 'commands'),
      join(projectRoot, '.' + tool, 'skills'),
    ];
    if (tool === 'qoder') {
      dirs.push(join(projectRoot, '.qoder', 'commands'));
    }
    for (const dir of dirs) {
      try {
        if (!await pathExists(dir)) continue;
        const files = await readdir(dir);
        for (const f of files) {
          if (oldSuffixPatterns.some(p => f.includes(p))) {
            await require('fs-extra').unlink(join(dir, f));
            cleanedCount++;
          }
        }
      } catch { /* ignore */ }
    }
  }
  // 也清理项目根目录下的 -old 文件
  try {
    const rootFiles = await readdir(projectRoot);
    for (const f of rootFiles) {
      if (oldSuffixPatterns.some(p => f.endsWith(p) || f.includes('-old.'))) {
        const filePath = join(projectRoot, f);
        const stat = await require('fs-extra').lstat(filePath);
        if (stat.isFile()) {
          await require('fs-extra').unlink(filePath);
          cleanedCount++;
        }
      }
    }
  } catch { /* ignore */ }

  // 1. 清理各工具的 commands 目录下 stale 文件
  for (const tool of allTools) {
    const cmdDir = join(projectRoot, '.' + tool, 'commands');
    try {
      if (!await pathExists(cmdDir)) continue;
      // 跳过符号链接目录（避免误删共享目标文件）
      const stat = await require('fs-extra').lstat(cmdDir);
      if (stat.isSymbolicLink()) continue;
      const files = await readdir(cmdDir);
      for (const f of files) {
        if (!validCmdNames.has(f) && f.endsWith('.md')) {
          await require('fs-extra').unlink(join(cmdDir, f));
          cleanedCount++;
        }
      }
    } catch { /* ignore missing dirs */ }
  }

  // 2. 清理 .agents/skills/ 下 stale Skill 目录
  const skillsDir = join(projectRoot, '.agents', 'skills');
  try {
    if (await pathExists(skillsDir)) {
      const entries = await readdir(skillsDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !skillNames.includes(e.name)) {
          await require('fs-extra').remove(join(skillsDir, e.name));
          cleanedCount++;
        }
      }
    }
  } catch { /* ignore */ }

  // 3. 清理旧版 .codebuddy/skills/ 和 .trae/skills/ 下的 stale 文件
  for (const tool of ['codebuddy', 'trae']) {
    const toolSkillsDir = join(projectRoot, '.' + tool, 'skills');
    try {
      if (!await pathExists(toolSkillsDir)) continue;
      const entries = await readdir(toolSkillsDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !skillNames.includes(e.name)) {
          await require('fs-extra').remove(join(toolSkillsDir, e.name));
          cleanedCount++;
        }
      }
    } catch { /* ignore */ }
  }

  if (cleanedCount > 0) {
    logger.info(`   🧹 已清理 ${cleanedCount} 个旧版本残留文件`);
  }
}

/**
 * 创建示例迭代，展示标准目录结构
 */

/**
 * 生成 AGENTS.md — 跨工具通用上下文文件。
 * Cursor / Copilot / Windsurf / Codex 原生支持，Claude Code 通过 CLAUDE.md 引用。
 */
async function writeAgentsMd(projectRoot: string): Promise<void> {
  const { writeFile: wf, pathExists } = require('fs-extra');
  const content = `# AGENTS.md — SpecCore 项目规则

> 本文档供 AI 编码工具自动读取（Cursor / Copilot / Windsurf / Codex / Claude Code）。
> 工具会读取本文档理解项目规则，不需要用户重复解释。

## ⛔ 新会话第一步（最高优先级）

**每次新会话开始时，必须先执行以下操作，不要做任何其他事情：**

\`\`\`
Read .speccore/local/context.json    ← 获取当前活跃迭代
Read .speccore/CONSTITUTION.md       ← 获取项目配置（端名、源码路径等）
\`\`\`

- \`context.json\` 中的 \`currentIteration\` 字段就是当前迭代名
- **绝对不要自己创建迭代目录** — 迭代已存在，读 context.json 就知道了
- **绝对不要写 JS/Python 脚本绕过 CLI** — 所有操作通过 \`speccore\` CLI 完成

## 项目类型
SpecCore 规范驱动开发项目。

## 核心工作方式
- **AI 只拼命令，不执行命令**。识别用户意图后，输出 \`speccore\` CLI 命令给用户在终端执行。
- **所有确定性操作通过 \`speccore\` CLI 完成**（创建目录、读写文件、校验格式）。
- **代码生成通过宿主 AI 完成**，CLI 负责准备 Spec 上下文和写入文件。
- **代码写到 CONSTITUTION.md 指定的源码路径**，不要写到迭代目录里。

## ⛔ 绝对禁止

1. **禁止自己创建迭代目录** — 用 \`speccore iteration create\`（通常迭代已存在）
2. **禁止写脚本绕过 CLI** — 不要写 build-xxx.js / run-xxx.py 等脚本
3. **禁止在迭代目录下创建 10-backend/ 20-frontend/** — 任务目录是端平铺结构
4. **禁止把代码写到迭代目录内** — 代码写到 CONSTITUTION.md 中各工程的「源码路径」

## 项目结构
\`\`\`
Iteration-NNN-name/            ← 迭代目录（名称从 context.json 获取）
├── 000-overview/              ← 进度总览
├── 010-requirements/          ← 需求文档（按功能组织）
│   ├── INDEX.md               ← 需求文档索引
│   ├── sources/               ← [只读] 原始 PRD
│   └── features/              ← [手动维护] 按功能模块组织
├── 020-specs/                 ← 需求分析（全局文档在 global/ 子目录）
├── 030-tasks/                 ← 开发任务
│   └── Task-NNN-name/         ← 功能模块任务
│       ├── .meta/             ← 任务元信息
│       ├── {platform}/        ← 所有端平铺（如 booking-service/h5-mobile）
│       │   └── {subtask}/     ← 子任务（代码写到 CONSTITUTION 源码路径）
│       └── .issues.md         ← 问题追踪
└── STAFFING.md                ← 人员排期
\`\`\`

## SpecCore 输出标记
当执行 \`speccore ask\` 或 \`speccore about\` 时，会输出以下标记，按优先级处理：
| 标记 | 含义 | 动作 |
|:---|:---|:---|
| \`[SPECCORE_ONBOARD: <path>]\` | 首次/升级引导页 | **最先处理**，用 present_files 展示 HTML |
| \`[SPECCORE_SETUP_GUIDE: <path>]\` | 项目配置引导页 | init 后用 present_files 展示，指导用户配置 |
| \`[SPECCORE_ABOUT: <path>]\` | 版本信息页 | 用 present_files 展示 |
| \`[SPECCORE_MODE: <mode>]\` | 意图模式 | 识别模式后进入对应流程 |
| \`[SPECCORE_EXEC: <cmd>]\` | 自动执行命令 | 直接 execute_command |
| \`[SPECCORE_INTENT]\` | 意图确认块 | 展示给用户确认 |
| \`[SPECCORE_CONTINUE: <path>]\` | 批次执行完成，需续批 | **必须开始新对话**，先读取 \`<path>\` 恢复上下文，再按提示命令继续下一批次 |

## 行为约束
- **不要自己创建目录** — 用 \`speccore iteration create\`
- **不要自己解析需求** — 用 \`speccore analyze\`
- **失败时读取 .issues.md** — 看文件里的问题清单
- **续跑用 --resume** — \`speccore execute --resume\`

## 常用命令速查
\`\`\`bash
speccore status                          # 当前迭代状态面板
speccore analyze -I <迭代名> --auto      # 全量分析
speccore split -I <迭代名>               # 自动拆分任务
speccore execute -I <迭代名> --all       # 执行所有任务
\`\`\`
`;

  await wf(require('path').join(projectRoot, 'AGENTS.md'), content);
}

/**
 * v6.84.0+: 初始化 AGENTS 规范数据库
 * 将内置默认角色复制到 .speccore/AGENTS/ 目录
 * 用户可在此目录下自定义角色或新增角色
 */
export async function initAgentsDir(projectRoot: string): Promise<void> {
  const agentsDir = join(projectRoot, '.speccore', 'AGENTS');
  await ensureDir(agentsDir);

  // 复制内置默认角色（不覆盖用户已自定义的）
  const agents = await getBuiltinAgentContents();
  for (const agent of agents) {
    const destPath = join(agentsDir, `${agent.name}.md`);
    if (!(await pathExists(destPath))) {
      await writeFile(destPath, agent.content);
    }
  }

  // 复制注册表（不覆盖用户已自定义的）
  const registryContent = await getBuiltinRegistryContent();
  if (registryContent) {
    const registryPath = join(agentsDir, '_INDEX.md');
    if (!(await pathExists(registryPath))) {
      await writeFile(registryPath, registryContent);
    }
  }

  // 复制模板（不覆盖用户已自定义的）
  const templateContent = await getBuiltinTemplateContent();
  if (templateContent) {
    const templatePath = join(agentsDir, '_TEMPLATE.md');
    if (!(await pathExists(templatePath))) {
      await writeFile(templatePath, templateContent);
    }
  }

  logger.info('   🤖 已初始化 AGENTS 规范数据库: .speccore/AGENTS/');
}

/**
 * v6.85.0+: 初始化 RULES 规范库
 * 将内置默认编码规范复制到 .speccore/RULES/ 目录
 */
export async function initRulesDir(projectRoot: string): Promise<void> {
  const rulesDir = join(projectRoot, '.speccore', 'RULES');
  await ensureDir(rulesDir);

  // 复制内置默认规范（不覆盖用户已自定义的）
  const rules = await getBuiltinRuleContents();
  for (const rule of rules) {
    const destPath = join(rulesDir, `${rule.name}.md`);
    if (!(await pathExists(destPath))) {
      await writeFile(destPath, rule.content);
    }
  }

  // v6.98.0+: 创建 AGENTS.md 投影用的 .inline.md 文件（不覆盖用户已自定义的）
  const inlineTemplates = [
    {
      name: '01-PROJECT_STRUCTURE.inline.md',
      content: `## 项目结构

\`\`\`
Iteration-NNN-name/            ← 迭代目录
├── 000-overview/              ← 进度总览
├── 010-requirements/          ← 需求文档（按功能组织）
│   ├── README.md              ← 目录规范说明
│   ├── INDEX.md               ← 需求文档索引
│   ├── sources/               ← [只读] 原始 PRD
│   ├── converted/             ← [自动生成] doc2spec 转换后的 MD
│   ├── features/              ← [手动维护] 按功能模块组织
│   │   └── {feature}/README.md
│   ├── prototypes/            ← 原型（HTML/图片/链接，内容不限）
│   └── assets/                ← doc2spec 提取的图片
├── 020-specs/                 ← 需求分析
├── 030-tasks/                 ← 开发任务
│   └── Task-*/                ← 功能模块分组（聚合相关子任务）
│       ├── _shared/           ← 共享契约（API_CONTRACT.yaml + CONTEXT.md）
│       ├── 00-specs/          ← 模块级核心规格（REQ/TECH/SCHEMA/CHANGELOG）
│       ├── 10-backend/        ← 后端（大类）
│       │   └── {服务名}/      ← 端（如 api）
│       │       └── {子任务}/  ← 执行单元
│       ├── 20-frontend/       ← 前端（大类）
│       │   └── {端名}/        ← 端（如 h5/admin）
│       │       └── {子任务}/  ← 执行单元
│       └── .issues.md         ← 问题追踪
│
│   子任务目录结构（10-backend/{端}/{子任务}/ 或 20-frontend/{端}/{子任务}/）：
│       ├── .meta/             ← 子任务元信息（type/status/owner/created-at）
│       ├── git-config         ← 子任务级 Git 配置
│       ├── TASK.md            ← 子任务追踪
│       ├── src/               ← AI 输出代码
│       ├── tests/             ← AI 输出测试
│       ├── TEST.md            ← 测试用例
│       ├── RISK.md            ← 风险评估
│       ├── DEPS.md            ← 依赖分析
│       ├── MONITOR.md         ← 监控方案
│       ├── REVIEW.md          ← 评审清单
│       ├── DEPLOY.md          ← 部署清单
│       ├── ERROR_CODES.md     ← 错误码
│       └── COMPONENT_TREE.md  ← 组件树（仅前端）
│
│   research 类型任务目录结构（无前后端分层）：
│       ├── _shared/           ← 共享上下文
│       ├── 00-specs/          ← 核心规格（REQ.md/TECH.md）
│       ├── RESEARCH.md        ← 调研报告
│       ├── COMPARISON.md      ← 方案对比
│       └── .issues.md         ← 问题追踪
└── STAFFING.md                ← 人员排期
\`\`\``,},
    {
      name: '02-OUTPUT_MARKERS.inline.md',
      content: `## SpecCore 输出标记

当执行 \`speccore ask\` 或 \`speccore about\` 时，会输出以下标记，按优先级处理：

| 标记 | 含义 | 动作 |
|:---|:---|:---|
| \`[SPECCORE_ONBOARD: <path>]\` | 首次/升级引导页 | **最先处理**，用 present_files 展示 HTML |
| \`[SPECCORE_SETUP_GUIDE: <path>]\` | 项目配置引导页 | init 后用 present_files 展示，指导用户配置 |
| \`[SPECCORE_ABOUT: <path>]\` | 版本信息页 | 用 present_files 展示 |
| \`[SPECCORE_MODE: <mode>]\` | 意图模式 | 识别模式后进入对应流程 |
| \`[SPECCORE_EXEC: <cmd>]\` | 自动执行命令 | 直接 execute_command |
| \`[SPECCORE_INTENT]\` | 意图确认块 | 展示给用户确认 |
| \`[SPECCORE_CONTINUE: <path>]\` | 批次执行完成，需续批 | **必须开始新对话**，先读取 \`<path>\` 恢复上下文，再按提示命令继续下一批次 |`,},
    {
      name: '03-COMMAND_CHEATSHEET.inline.md',
      content: `## 常用命令速查

\`\`\`bash
speccore status                          # 当前迭代状态面板
speccore analyze -I <迭代名> --auto      # 全量分析
speccore split -I <迭代名>               # 自动拆分任务
speccore execute -I <迭代名> --all       # 执行所有任务
\`\`\``,},
  ];
  for (const tpl of inlineTemplates) {
    const destPath = join(rulesDir, tpl.name);
    if (!(await pathExists(destPath))) {
      await writeFile(destPath, tpl.content);
    }
  }

  logger.info('   📋 已初始化 RULES 规范库: .speccore/RULES/');
}

/**
 * v6.87.0+: 初始化 COMMANDS 命令模板
 * 将内置默认命令模板复制到 .speccore/COMMANDS/ 目录
 */
export async function initCommandsDir(projectRoot: string): Promise<void> {
  const commandsDir = join(projectRoot, '.speccore', 'COMMANDS');
  await ensureDir(commandsDir);

  // 复制内置默认模板（不覆盖用户已自定义的）
  const commands = await getBuiltinCommandContents();
  for (const cmd of commands) {
    const destPath = join(commandsDir, `${cmd.name}.md`);
    if (!(await pathExists(destPath))) {
      await writeFile(destPath, cmd.content);
    }
  }

  logger.info('   📜 已初始化 COMMANDS 命令模板: .speccore/COMMANDS/');
}

/**
 * v6.88.0+: 初始化 SKILLS 可复用技能库
 */
export async function initSkillsDir(projectRoot: string): Promise<void> {
  const skillsDir = join(projectRoot, '.speccore', 'SKILLS');
  await ensureDir(skillsDir);

  const skills = await getBuiltinSkillContents();
  for (const skill of skills) {
    const destPath = join(skillsDir, `${skill.name}.md`);
    if (!(await pathExists(destPath))) {
      await writeFile(destPath, skill.content);
    }
  }

  logger.info('   🛠️  已初始化 SKILLS 技能库: .speccore/SKILLS/');
}

/**
 * v6.88.0+: 初始化 HOOKS 生命周期钩子
 */
export async function initHooksDir(projectRoot: string): Promise<void> {
  const hooksDir = join(projectRoot, '.speccore', 'HOOKS');
  await ensureDir(hooksDir);

  const hooks = await getBuiltinHookContents();
  for (const hook of hooks) {
    const destPath = join(hooksDir, `${hook.name}.md`);
    if (!(await pathExists(destPath))) {
      await writeFile(destPath, hook.content);
    }
  }

  logger.info('   🔗 已初始化 HOOKS 钩子: .speccore/HOOKS/');
}

// ── v6.98.0+: AGENTS.md 规范数据库投影 ──

const AUTO_START = '<!-- SPECCORE_AUTO_INDEX_START -->';
const AUTO_END = '<!-- SPECCORE_AUTO_INDEX_END -->';

/**
 * 同步 AGENTS.md — 将 .speccore/AGENTS/ 和 .speccore/RULES/ 下的规范投影到 AGENTS.md
 *
 * 文件名约定：
 * - `*.inline.md` → 内容内联到 AGENTS.md
 * - `*.md` → 只生成索引链接
 */
export async function syncAgentsMd(projectRoot: string): Promise<void> {
  const agentsMdPath = join(projectRoot, 'AGENTS.md');

  // 1. 读取现有 AGENTS.md，提取手动区（AUTO_START 之前的部分）
  let manualPart = '';
  if (await pathExists(agentsMdPath)) {
    const content = await readFile(agentsMdPath, 'utf-8');
    const startIdx = content.indexOf(AUTO_START);
    if (startIdx >= 0) {
      manualPart = content.slice(0, startIdx).trimEnd();
    } else {
      manualPart = content.trimEnd();
    }
  }

  // 2. 收集自动区内容
  const sections: string[] = [];

  // 2a. 扫描 .speccore/AGENTS/
  const agentsDir = join(projectRoot, '.speccore', 'AGENTS');
  const agentInlines: string[] = [];
  const agentLinks: string[] = [];
  if (await pathExists(agentsDir)) {
    const files = (await readdir(agentsDir))
      .filter(f => f.endsWith('.md') && !f.startsWith('_') && !f.startsWith('.'))
      .sort();
    for (const f of files) {
      if (f.endsWith('.inline.md')) {
        const content = await readFile(join(agentsDir, f), 'utf-8');
        agentInlines.push(content.trim());
      } else {
        const name = f.replace(/\.md$/, '').replace(/[-_]/g, ' ');
        agentLinks.push(`- [${name}](.speccore/AGENTS/${f})`);
      }
    }
  }
  const agentParts: string[] = [];
  if (agentInlines.length > 0) agentParts.push(...agentInlines);
  if (agentLinks.length > 0) agentParts.push('### 更多角色\n' + agentLinks.join('\n'));
  if (agentParts.length > 0) {
    sections.push('## 角色与职责\n\n' + agentParts.join('\n\n'));
  }

  // 2b. 扫描 .speccore/RULES/
  const rulesDir = join(projectRoot, '.speccore', 'RULES');
  const ruleInlines: string[] = [];
  const ruleLinks: string[] = [];
  if (await pathExists(rulesDir)) {
    const files = (await readdir(rulesDir))
      .filter(f => f.endsWith('.md') && !f.startsWith('_') && !f.startsWith('.'))
      .sort();
    for (const f of files) {
      if (f.endsWith('.inline.md')) {
        const content = await readFile(join(rulesDir, f), 'utf-8');
        ruleInlines.push(content.trim());
      } else {
        const name = f.replace(/\.md$/, '').replace(/[-_]/g, ' ');
        ruleLinks.push(`- [${name}](.speccore/RULES/${f})`);
      }
    }
  }
  const ruleParts: string[] = [];
  if (ruleInlines.length > 0) ruleParts.push(...ruleInlines);
  if (ruleLinks.length > 0) ruleParts.push('### 更多规范\n' + ruleLinks.join('\n'));
  if (ruleParts.length > 0) {
    sections.push('## 编码规范与规则\n\n' + ruleParts.join('\n\n'));
  }

  // 2c. 扫描 .agents/agents/（v6.99.0+: Agent 角色定义投影）
  const projectAgentsDir = join(projectRoot, '.agents', 'agents');
  const agentRoles: { name: string; description: string; duties: string[] }[] = [];
  if (await pathExists(projectAgentsDir)) {
    const files = (await readdir(projectAgentsDir))
      .filter(f => f.endsWith('.md') && !f.startsWith('_') && !f.startsWith('.') && f !== 'README.md')
      .sort();
    for (const f of files) {
      const content = await readFile(join(projectAgentsDir, f), 'utf-8');
      // 提取 YAML frontmatter 中的 name 和 description
      const nameMatch = content.match(/^name:\s*(.+)$/m);
      const descMatch = content.match(/^description:\s*(.+)$/m);
      // 提取职责范围（前3条）
      const duties: string[] = [];
      const dutiesMatch = content.match(/## 职责范围\s*\n([\s\S]*?)(?=## |\n## |\n---|$)/);
      if (dutiesMatch) {
        const dutyLines = dutiesMatch[1].match(/^\d+\.\s*\*\*(.+?)\*\*/gm);
        if (dutyLines) {
          duties.push(...dutyLines.slice(0, 3).map(l => l.replace(/^\d+\.\s*\*\*(.+?)\*\*/, '$1')));
        }
      }
      agentRoles.push({
        name: nameMatch ? nameMatch[1].trim() : f.replace(/\.md$/, ''),
        description: descMatch ? descMatch[1].trim() : '',
        duties,
      });
    }
  }
  if (agentRoles.length > 0) {
    let agentSection = '## Agent 角色定义（v6.99.0+）\n\n';
    agentSection += '> 来源：`.agents/agents/`，项目级专用 Agent 角色定义\n\n';
    agentSection += '| Agent | 职责 | 核心能力 |\n';
    agentSection += '| :--- | :--- | :--- |\n';
    for (const agent of agentRoles) {
      const dutyStr = agent.duties.slice(0, 2).join('、') || agent.description;
      agentSection += `| ${agent.name} | ${agent.description} | ${dutyStr} |\n`;
    }
    agentSection += '\n### 所有 Agent 共用的核心约束\n\n';
    agentSection += '- 不要自己创建目录 — 使用 `speccore` CLI\n';
    agentSection += '- 不要写脚本绕过 CLI — 所有操作通过 `speccore` 命令完成\n';
    agentSection += '- 代码写到 CONSTITUTION.md 指定的源码路径，不写到迭代目录内\n';
    agentSection += '- 迭代内写 Spec，迭代外写代码\n';
    sections.push(agentSection);
  }

  // 3. 组合新内容
  let newContent = manualPart;
  if (sections.length > 0) {
    newContent += '\n\n' + AUTO_START + '\n';
    newContent += '> 以下内容由 `.speccore/` 规范数据库自动生成，请勿手动编辑此区域\n\n';
    newContent += sections.join('\n\n');
    newContent += '\n\n' + AUTO_END;
  }
  newContent += '\n';

  await writeFile(agentsMdPath, newContent);
}

async function createSampleIteration(projectRoot: string): Promise<void> {
  const iterDir = join(projectRoot, 'Iteration-sample');
  await ensureDir(iterDir);
  
  // 030-tasks/ — 所有开发任务（由 split 创建）
  await ensureDir(join(iterDir, '030-tasks'));

  // STAFFING.md
  await writeFile(join(iterDir, 'STAFFING.md'), [
    '# 示例 人员排期配置',
    '',
    '| 成员 | 平台方向 | 投入比例 |',
    '| :--- | :--- | :--- |',
    '| 张三 | APP, H5 | 80% |',
    '| 李四 | admin, 小程序 | 70% |',
    '',
    '> 编辑此文件后重新运行 split 即可更新默认分配',
  ].join('\n'));

  // 010-requirements/ — 按需求组织（非按端），analyze 自动提取端相关内容
  const prdDir = join(iterDir, '010-requirements');
  await ensureDir(join(prdDir, 'sources'));
  await ensureDir(join(prdDir, 'converted'));
  await ensureDir(join(prdDir, 'features'));
  await ensureDir(join(prdDir, 'assets', 'extracted'));     // PRD 提取的图片
  await ensureDir(join(prdDir, 'assets', 'prototypes'));    // 产品原型
  await ensureDir(join(prdDir, 'assets', 'designs'));       // UI 设计稿
  await ensureDir(join(prdDir, 'assets', 'screenshots'));   // 参考截图

  await writeFile(join(prdDir, 'sources', 'README.md'), '# 原始文档与素材\n\n请将产品提供的 Word/PDF/原型图 放在此处。');

  // 010-requirements/README.md — 目录规范说明
  await writeFile(join(prdDir, 'README.md'), [
    '# 需求文档目录规范',
    '',
    '> 本目录存放本期迭代的全部需求相关文档与素材',
    '',
    '## 目录结构',
    '',
    '```',
    '010-requirements/',
    '├── README.md              ← 本文件',
    '├── INDEX.md               ← 需求文档索引（自动生成/维护）',
    '├── sources/               ← [只读] 原始 PRD/Word/PDF，任何人不得修改',
    '├── converted/             ← [自动生成] doc2spec 转换后的 Markdown 规格',
    '├── features/              ← [手动维护] 按功能模块组织的需求补充',
    '│   └── {feature}/',
    '│       └── README.md',
    '├── prototypes/            ← 原型（HTML/图片/链接，内容不限）',
    '└── assets/',
    '    └── extracted/         ← doc2spec 提取的图片/媒体文件',
    '```',
    '',
    '## 使用规范',
    '',
    '1. **sources/** — 放产品提供的原始文档，不要直接编辑',
    '2. **converted/** — doc2spec 命令自动输出转换后的 MD，人工不修改',
    '3. **features/** — 按功能模块手动补充需求细节，每个模块一个子目录',
    '4. **prototypes/** — 原型文件，HTML/图片/链接均可，需求文档中链接到原型的会被主动读取',
    '5. **assets/extracted/** — doc2spec 自动提取的图片，人工不修改',
  ].join('\n'));

  // 010-requirements/INDEX.md — 需求文档索引
  await writeFile(join(prdDir, 'INDEX.md'), [
    '# 本期需求文档索引',
    '',
    '> 迭代：示例迭代',
    '> 更新：' + new Date().toISOString().split('T')[0],
    '',
    '## 文档清单',
    '',
    '| 类型 | 路径 | 状态 | 说明 |',
    '| :--- | :--- | :--- | :--- |',
    '| 原始文档 | sources/ | 待补充 | 放 PRD/Word/PDF |',
    '| 转换规格 | converted/ | 待生成 | doc2spec 输出 |',
    '| 功能补充 | features/ | 已示例 | user-auth/ 为示例 |',
    '| 原型素材 | prototypes/ | 待补充 | 原型（HTML/图片/链接） |',
    '',
    '## 分析配置',
    '',
    '- **默认读取**：converted/*.md + features/*/README.md',
    '- **指定文档**：speccore analyze -I sample --req converted/login.md',
    '- **全部文档**：speccore analyze -I sample --scope all',
  ].join('\n'));

  // 示例需求目录（按需求功能组织，非按端）
  const sampleFeature = join(prdDir, 'features', 'user-auth');
  await ensureDir(sampleFeature);
  await writeFile(join(sampleFeature, 'README.md'), [
    '# 用户登录与认证',
    '',
    '## 概述',
    '实现统一登录认证，支持 APP/H5/管理后台。',
    '',
    '## 涉及的端',
    '- **app**: 手机号+验证码登录，生物识别',
    '- **h5**: 微信授权登录',
    '- **admin**: 账号密码登录，权限控制',
    '',
    '## 核心功能',
    '- 登录/注册/找回密码',
    '- Token 管理',
    '- 权限校验',
    '',
    '## 涉及的 API',
    '| 方法 | 路径 | 说明 |',
    '| :--- | :--- | :--- |',
    '| POST | /api/auth/login | 登录 |',
    '| POST | /api/auth/register | 注册 |',
    '| GET | /api/auth/me | 当前用户信息 |',
  ].join('\n'));

  // 020-specs/ — analyze 自动按端生成子目录，不再预创建平台目录
  const specDir = join(iterDir, '020-specs');
  await ensureDir(specDir);

  // 00-迭代总览/
  const overviewDir = join(iterDir, '000-overview');
  await ensureDir(overviewDir);
  await writeFile(join(overviewDir, 'PROJECT_GRAPH.md'), [
    '# 示例任务总览',
    '> 迭代：示例 | 默认分支: main',
    '| 任务编号 | 任务名称 | 类型 | 状态 | 负责人 |',
    '| :--- | :--- | :--- | :--- | :--- |',
    '| Task-001 | APP核心功能 | feature | 待开发 | 张三 |',
    '| Task-002 | H5核心功能 | feature | 待开发 | 张三 |',
    '| Task-003 | 小程序核心功能 | feature | 待开发 | 李四 |',
    '| Task-004 | admin功能 | feature | 待开发 | 李四 |',
  ].join('\n'));

  logger.info('   📂 示例迭代: Iteration-sample/ (按端区分: APP/H5/小程序/admin)');
}

/**
 * 检查受保护文件是否需要升级提示。
 * 文件已存在时不覆盖，但告诉用户模板有什么新变化。
 */
export async function checkUpgradeHints(projectRoot: string, speccoreDir: string): Promise<void> {
  const versionFile = join(speccoreDir, 'local', 'last-init-version.txt');
  let lastVersion = '';
  try { lastVersion = await readFile(versionFile, 'utf-8').then(v => v.trim()); } catch {}

  const constitutionPath = join(speccoreDir, 'CONSTITUTION.md');
  const hasConstitution = await pathExists(constitutionPath);

  // ── CONSTITUTION.md 格式迁移检测（不受版本限制，只要旧格式存在就迁移）──
  if (hasConstitution) {
    const content = await readFile(constitutionPath, 'utf-8');
    let updated = content;
    const migrations: string[] = [];

    // ── 自动迁移：补充缺失的"项目名称"列 ──
    // 精确匹配表头格式：| 工程 | 源码路径 |（旧5列）→ 需要补列
    // 不能用 includes('项目名称')，因为说明文字/示例中可能已出现该词
    const hasOldHeader = /\|\s*工程\s*\|\s*源码路径\s*\|/.test(updated);
    const hasNewHeader = /\|\s*工程\s*\|\s*项目名称\s*\|\s*源码路径\s*\|/.test(updated);
    if (hasOldHeader && !hasNewHeader) {
      // 表头: | 工程 | 源码路径 | → | 工程 | 项目名称 | 源码路径 |
      updated = updated.replace(
        /\|\s*工程\s*\|\s*源码路径\s*\|/,
        '| 工程 | 项目名称 | 源码路径 |'
      );
      // 分隔行: 5列 → 6列（加一个 |:--- |）
      updated = updated.replace(
        /\|\s*:---\s*\|\s*:---\s*\|\s*:---\s*\|\s*:---\s*\|\s*:---\s*\|/,
        '| :--- | :--- | :--- | :--- | :--- |'
      );
      // 数据行: | xxx | ./ | → | xxx | 待填写 | ./ |
      updated = updated.replace(
        /^(\|\s*\S+\s*)\|(\s*\.\/)/gm,
        '$1| 待填写 |$2'
      );
      // monorepo 示例行也处理
      updated = updated.replace(
        /^(\|\s*\S+-service\s*)\|(\s*\.\/packages)/gm,
        '$1| 待填写 |$2'
      );
      migrations.push('自动补充「项目名称」列（值暂填"待填写"，请后续修改）');
    }

    // ── 自动迁移：旧版"项目标识"纵向表 → 新版"项目信息"横向表 ──
    const hasOldFormat = /##\s*项目标识/.test(updated) && /\|\s*属性\s*\|\s*值\s*\|/.test(updated);
    const hasNewFormat = /##\s*项目信息/.test(updated) && /\|\s*工程\s*\|/.test(updated);
    if (hasOldFormat && !hasNewFormat) {
      // 提取旧表数据
      const extractField = (key: string): string => {
        const m = updated.match(new RegExp(`\\|\\s*${key}\\s*\\|\\s*([^|]+?)\\s*\\|`));
        return m ? m[1].trim() : '待填写';
      };
      const projName = extractField('项目名');
      const projShort = extractField('项目短名');
      const repo = extractField('代码仓库');

      // 替换整个"项目标识"章节为"项目信息"（从 ## 项目标识 到下一个 ## 之间）
      updated = updated.replace(
        new RegExp('##\\s*\u9879\u76ee\u6807\u8bc6[\\s\\S]*?(?=##\\s|\\Z)'),
        `## 项目信息\n\n| 工程 | 项目名称 | 源码路径 | Git 仓库 | 默认分支 | 对应端 |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n| ${projShort} | ${projName} | ./ | ${repo} | main | 待填写 |\n`
      );
      migrations.push(`旧版「项目标识」纵向表 → 新版「项目信息」横向表（项目名称: ${projName}）`);
    }

    // ── 自动迁移：补充缺失的「保护分支」配置 ──
    const hasBranchSection = /##\s*Git\s*分支策略/.test(updated);
    const hasProtectedBranch = /保护分支/.test(updated);
    if (hasBranchSection && !hasProtectedBranch) {
      // 在「发布分支」行后追加保护分支配置
      updated = updated.replace(
        /(-\s*发布分支[：:].*)/,
        `$1\n- 保护分支: main, master, release/*, production\n  > 保护分支上禁止直接 commit 和 push，只能通过 PR 合并\n  > 支持精确匹配和通配符（如 release/*）`
      );
      migrations.push('自动补充「保护分支」配置（保护分支禁止直接 commit/push）');
    }

    // ── 通用章节对比：检测新版模板新增的章节 ──
    const expectedSections = [
      '项目信息',
      '技术栈',
      '命名规范',
      '异常码体系',
      'Git 分支策略',
    ];
    const userSections = Array.from(content.matchAll(/^##\s+(.+)$/gm)).map(m => m[1].trim());
    const missingSections = expectedSections.filter(s => !userSections.some(us => us.includes(s)));

    if (migrations.length > 0) {
      // 旧文件时间戳备份
      if (content.trim() !== updated.trim()) {
        const ts = timestampSuffix();
        const backupPath = constitutionPath.replace(/\.md$/, `-${ts}.md`);
        await rename(constitutionPath, backupPath);
        _updateConflicts.push({ file: constitutionPath, backup: backupPath });
      }
      await writeFile(constitutionPath, updated);

      logger.info('');
      logger.info('━'.repeat(50));
      logger.info(`🔄 CONSTITUTION.md 自动升级`);
      logger.info('');
      for (const m of migrations) logger.info(`   ✅ ${m}`);
      logger.info('');
      logger.info('   💡 旧版已备份，请补充「项目名称」列的实际值');
      logger.info('━'.repeat(50));
      logger.info('');
    } else if (missingSections.length > 0) {
      // 没有特定迁移，但有新版章节 → 提示用户手动补充
      logger.info('');
      logger.info('━'.repeat(50));
      logger.info(`📋 CONSTITUTION.md 章节对比`);
      logger.info('');
      logger.info(`   当前文件已有: ${userSections.join(', ') || '(无)'}`);
      logger.info(`   新版模板新增: ${missingSections.join(', ')}`);
      logger.info('');
      logger.info('   💡 建议手动补充缺失章节，或在全新目录执行 speccore init 查看最新模板');
      logger.info('━'.repeat(50));
      logger.info('');
    }
  }

  // 版本跳跃提示 — 列出自动更新了的文件
  if (lastVersion && lastVersion !== PKG_VERSION) {
    logger.info(`📋 已自动更新的文件 (${lastVersion} → ${PKG_VERSION}):`);
    logger.info('   ✅ AI-RULES.md — 命令参考表');
    logger.info('   ✅ AGENTS.md — 项目规则');
    logger.info('   ✅ .speccore/AGENTS/ — 规范数据库（v6.84.0+）');
    logger.info('   ✅ SETTINGS.md — 框架配置');
    logger.info('   ✅ .agents/skills/ — Skill 全量更新');
    logger.info('   ✅ .claude/ / .codebuddy/ 等 — 命令模板');
    logger.info('');
  }

  await writeFile(versionFile, PKG_VERSION);
}


/** SETTINGS.md 模板内容 */
export function generateSettingsContent(): string {
  return `# SpecCore 框架配置

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
| \`review.check_assignee\` | \`true\`/\`false\` | \`false\` | 审查时是否检查执行人签名 |

## 4. 配置变更记录

| 日期 | 变更项 | 旧值 | 新值 | 变更人 |
| :--- | :--- | :--- | :--- | :--- |
`;
}

/** AI-RULES.md 模板内容 */
export function generateAIRulesContent(): string {
  return [
    '# AI 使用 SpecCore 的规则',
    '',
    '> 本文档帮助 AI 代理（TRAE/Claude/Qoder等）正确使用 SpecCore 命令。',
    '',
    '## 核心原则',
    '',
    '1. **/spec:ask 是智能路由入口** — 用户说"新建迭代"、"分析需求" → 调用 `speccore ask`，不要自己写 mkdir/analyze',
    '2. **不要跨命令猜测** — 每个斜杠命令只做它描述的事，不要自动级联后续步骤',
    '3. **参数从命令描述获取** — /spec:execute 的描述中有完整的参数说明',
    '4. **上下文不足时读取文件** — 查看 .speccore/CONSTITUTION.md、STAFFING.md 等',
    '',
    '## 核心流水线',
    '',
    '```',
    'init → doc2spec → analyze → split → plan → execute → pr → done → spec2doc',
    '```',
    '',
    '## 命令快速参考',
    '',
    '| 命令 | 作用 | 参数 | 上游依赖 | 下游产出 |',
    '| :--- | :--- | :--- | :--- | :--- |',
    '| init | 初始化项目 | --interactive/--force/--update | 无 | .speccore/ + 工具集成 |',
    '| doc2spec | Word→Spec MD (CLI) | -f <文件> --iter <迭代> | PRD/Word | 010-requirements/*.md |',
    '| **spec-doc2spec** | **AI+Pandoc 双路交叉验证导入** | **(Skill 自动触发)** | PRD原文 | REQUIREMENT.md + VALIDATION.md |',
    '| analyze | 需求分析 | -I <迭代> --task <任务> | 010-requirements/ | 020-specs/ANALYSIS.md |',
    '| split | 拆分任务 | -i <迭代> --owner <人> | 020-specs/ | Task-001~NNN/ |',
    '| plan | 执行计划 | -I <迭代> --owner <人> | Task 列表 | plan.json |',
    '| execute | 执行开发 | -i <迭代> -t <任务> --type <类型> | REQ.md/TECH.md | 代码 + .issues.md |',
    '| pr | 创建PR | --task <任务> | 代码提交 | Pull Request |',
    '| done | 归档收尾 | --task <任务> | 全部完成 | .verification |',
    '| spec2doc | Spec→文档导出 (CLI) | -i <迭代> -o <文件> -f <格式> | 020-specs/ | Word/PDF/HTML |',
    '| **spec-spec2doc** | **AI排版+Pandoc导出+验证** | **(Skill 自动触发)** | SpecCore文档 | 精美排版文档 |',
    '| retro | 任务回顾 | --task/--all/--owner/--type | done后 | 回顾报告 |',
    '| change | 需求变更 | <描述> --task <任务> --type | 进行中任务 | 变更记录 |',
    '| dev | 智能级联 | --auto/--from/--to | 全部阶段 | 自动全流程 |',
    '',
    '## AI Skills（.agents/skills/）',
    '',
    '项目包含 10 个高阶 Skill，AI 工具自动加载：',
    '',
    '| Skill | 能力 | 激活方式 |',
    '| :--- | :--- | :--- |',
    '| speccore-router | 中文意图→CLI命令（20+映射） | "分析需求"/"创建迭代" |',
    '| spec-doc2spec | **AI语义提取+Pandoc机械转换+交叉验证** | "帮我分析这个PRD"/"导入需求文档" |',
    '| spec-spec2doc | **AI内容编排+Pandoc格式转换+质量验证** | "导出文档"/"生成交付文档" |',
    '| spec-analyze | 深度需求分析（拆解→映射→风险） | "分析需求" |',
    '| spec-split | 智能任务拆分（分组→分配→依赖） | "拆分任务" |',
    '| spec-execute | 代码生成+编译+测试+修复循环 | "开发Task-001" |',
    '| spec-plan | 排程+里程碑+并行策略 | "生成计划" |',

    '| spec-change | 变更记录+影响分析+代码更新 | "需求变更" |',
    '| spec-ask | 自然语言引擎（四大模式） | "怎么做"/"流程是什么" |',
    '',
    '## 目录结构',
    '',
    '```',
    'Iteration-xxx/',
    '├── 000-overview/     ← 进度跟踪',
    '├── 010-requirements/     ← 需求文档（按功能组织）',
    '│   ├── README.md       ← 目录规范说明',
    '│   ├── INDEX.md        ← 需求文档索引',
    '│   ├── sources/        ← [只读] 原始 PRD/Word/PDF',
    '│   ├── converted/      ← [自动生成] doc2spec 转换后的 MD',
    '│   ├── features/       ← [手动维护] 按功能模块组织',
    '│   │   └── {feature}/README.md',
    '│   ├── prototypes/        ← 原型（HTML/图片/链接，内容不限）',
    '│   └── assets/            ← doc2spec 提取的图片',
    '├── 020-specs/     ← analyze 输出',
    '├── 030-tasks/     ← 开发任务',
    '│   └── Task-*/',
    '│       ├── .meta/         ← 任务元信息（type/status/owner/created-at）',
    '│       ├── 00-specs/      ← 核心规格（REQ/TECH/TASK/SCHEMA/CHANGELOG）',
    '│       ├── {platform}/    ← 所有端平铺（如 booking-service/h5-mobile）',
    '│       │   └── {subtask}/ ← 子任务（TASK.md + .meta/）',
    '│       └── .issues.md     ← 问题追踪',
    '├── STAFFING.md      ← 人员排期',
    '```',
    '',
    '## AI 行为约束',
    '',
    '- **不要自己创建目录** — 用 `speccore iteration create -n <名称>`',
    '- **不要自己解析需求** — 用 `speccore analyze -I <迭代>`',
    '- **失败时读取 .issues.md** — 不要猜测，看文件里的问题清单',
    '- **续跑用 --resume** — `speccore execute --resume` 自动扫描 .needs-retry',
  ].join('\n');
}

async function writeUpgradePage(projectRoot: string, version: string, speccoreDir: string): Promise<void> {
  const name = basename(projectRoot);
  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>SpecCore ${version} — 升级完成</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;background:#0a1628;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:20px;font-family:monospace;overflow-x:hidden;position:relative}
.scanlines{position:fixed;top:0;left:0;width:100%;height:100%;background:repeating-linear-gradient(0deg,rgba(14,165,233,.03),rgba(14,165,233,.03) 1px,transparent 1px,transparent 3px);pointer-events:none;z-index:0}
.card{max-width:800px;width:100%;background:rgba(13,31,56,.95);border:1px solid rgba(14,165,233,.15);border-radius:16px;padding:24px;position:relative;z-index:1}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#0ea5e9,transparent);animation:scanX 3s linear infinite}
h1{font-size:18px;color:#0ea5e9;text-align:center;margin-bottom:8px;font-weight:500}h2{font-size:13px;color:#5b7fa5;text-align:center;margin-bottom:20px;font-weight:400}
.section{background:rgba(14,165,233,.06);border:1px solid rgba(14,165,233,.1);border-radius:12px;padding:16px;margin-bottom:14px}
.section h3{font-size:14px;color:#14b8a6;margin-bottom:10px;font-weight:500}
.section li{color:#94a3b8;font-size:12px;line-height:1.8;list-style:none;padding-left:16px;position:relative}
.section li::before{content:'>';position:absolute;left:0;color:#0ea5e9}
.badge{display:inline-block;background:rgba(14,165,233,.15);color:#0ea5e9;padding:4px 12px;border-radius:6px;font-size:12px;margin:4px 4px 4px 0}
.ft{text-align:center;color:#3b5370;font-size:10px;margin-top:20px}
@keyframes scanX{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
.grid-pattern{position:fixed;inset:0;pointer-events:none;z-index:0;background-image:linear-gradient(rgba(14,165,233,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(14,165,233,.03) 1px,transparent 1px);background-size:60px 60px}
@keyframes cardGlow{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.6)}}
.card-bg{position:absolute;inset:0;pointer-events:none;z-index:0;background:radial-gradient(ellipse at 50% 10%,rgba(14,165,233,.25) 0%,transparent 70%);animation:cardGlow 3s ease-in-out infinite;transform-origin:top center}
@keyframes titleGlow{0%,100%{text-shadow:0 0 20px rgba(14,165,233,.4),0 0 60px rgba(14,165,233,.15)}50%{text-shadow:0 0 30px rgba(14,165,233,.7),0 0 80px rgba(14,165,233,.3)}}
h1,h2{text-shadow:0 0 20px rgba(14,165,233,.4),0 0 60px rgba(14,165,233,.15);animation:titleGlow 3s ease-in-out infinite}
</style></head><body><div class="scanlines"></div><div class="grid-pattern"></div><div class="card">
<div class="card-bg"></div>
<div style="display:block;width:100%">${SVG_ONBOARD}</div>
<h1>SpecCore 已升级到 v${version}</h1>
<h2>项目: ${name} | 升级完成</h2>
<div class="section"><h3>本次更新</h3>
<ul><li>可执行编排引擎 v4 — 五分支决策树</li>
<li>Prompt/Apply 协作架构 — 全命令覆盖</li>
<li>管道传递 + 参数缺省智能补充</li>
<li>升级保护 — CONSTITUTION 不覆盖</li>
<li>10 个高阶 Skill 全量更新</li></ul></div>
<div class="section"><h3>新功能</h3>
<span class="badge">spec-ask</span><span class="badge">歧义检测</span><span class="badge">升级提示</span><span class="badge">管道传递</span><span class="badge">低置信拒绝</span>
</div>
<div class="section"><h3>下一步</h3>
<ul><li>speccore ask "查看项目进度" — 体验新的意图识别</li>
<li>speccore init --help — 查看完整命令列表</li></ul></div>
<div class="ft">SpecCore ${version} — 升级完成</div>
</div></body></html>`;
  await ensureDir(join(projectRoot, 'outputs'));
  await writeFile(join(projectRoot, 'outputs', 'speccore-upgrade.html'), html);
}

function detectGitUrl(root: string): string | undefined {
  try {
    const url = require('child_process').execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf-8', cwd: root }).trim();
    return url || undefined;
  } catch { return undefined; }
}

/**
 * 生成项目配置引导页 — 首次 init 后展示
 * v7.1.1+: 改为读取静态模板，只替换少量变量
 * 指导用户填写 CONSTITUTION.md、配置团队、导入需求、开始流水线
 */
async function writeSetupGuide(projectRoot: string, _speccoreDir: string): Promise<string> {
  const name = basename(projectRoot);
  const pkgVersion = await readFile(join(projectRoot, 'package.json'), 'utf-8').then(s => JSON.parse(s).version).catch(() => '0.0.0');

  // 读取静态模板
  const templatePath = join(projectRoot, 'templates', 'html', 'speccore-setup-guide.html');
  let template: string;
  if (await pathExists(templatePath)) {
    template = await readFile(templatePath, 'utf-8');
  } else {
    // 降级：如果模板不存在，使用内置简短提示（不应该发生）
    template = '<!DOCTYPE html><html><body><h1>SpecCore 配置引导</h1><p>模板文件缺失，请检查 templates/html/speccore-setup-guide.html</p></body></html>';
  }

  // 替换变量
  const html = template
    .replace(/\{\{PROJECT_NAME\}\}/g, name)
    .replace(/\{\{VERSION\}\}/g, pkgVersion);

  const outputPath = join(projectRoot, 'outputs', 'speccore-setup-guide.html');
  await ensureDir(join(projectRoot, 'outputs'));
  await writeFile(outputPath, html);
  return outputPath;
}
