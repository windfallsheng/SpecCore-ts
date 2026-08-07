import { ensureDir, writeFile, pathExists, readFile, readdir, copy } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../utils/logger';
import { createInterface } from 'readline';
import { updateContext } from '../core/context';

export interface InitOptions {
  mode?: string;
  force?: boolean;
  interactive?: boolean;
  update?: boolean;
  tool?: string;
}

export async function initCommand(options: InitOptions): Promise<void> {
  // ── 增量升级模式 ──
  if (options.update) {
    const { updateCommand } = await import('./update');
    await updateCommand({ force: options.force, tool: options.tool });
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

      if (!options.force) {
        spinner.stop('更新命令文件和配置...');
        // 安全更新：只更新可自动生成的文件，不碰用户数据
        await createWorkBuddyFiles(projectRoot);
        await createToolIntegrations(projectRoot, options.tool);
        
        // 更新技能文件（Skill）
        const skillsSrc = join(__dirname, '..', '..', '.agents', 'skills');
        const skillsDest = join(projectRoot, '.agents', 'skills');
        if (await pathExists(skillsSrc)) {
          await require('fs-extra').copy(skillsSrc, skillsDest, { overwrite: true });
        }

        // 更新版本号
        const verFile = join(speccoreDir, 'local', 'version.json');
        await writeFile(verFile, JSON.stringify({ version: require('../../package.json').version, updatedAt: new Date().toISOString() }, null, 2));

        spinner.stop('命令文件已更新到最新版本 ✅');
        logger.info('');
        logger.info('📋 已更新:');
        logger.info('   ✅ .claude/ / .codebuddy/ — 命令模板');
        logger.info('   ✅ .agents/skills/ — 技能文件');
        logger.info('   ✅ AI-RULES.md / AGENTS.md — 项目规则');
        logger.info('');
        logger.info('   🛡️ CONSTITUTION.md / context.json 保持不变');
        logger.info('');
        logger.info('💡 如需强制重置所有配置: speccore init --force');
        return;
      }
      
      // ── 二次确认 ──
      spinner.stop();
      logger.warn('⚠️  --force 将重置所有配置文件！');
      logger.info('');
      const answer = await askUser('确认重置？现有的 INDEX.md/需求数据将丢失 (y/N): ');
      if (!answer.toLowerCase().startsWith('y')) {
        logger.info('已取消');
        logger.info('💡 建议使用 speccore update 安全升级');
        return;
      }
      spinner.start();

      // ── 备份现有配置 ──
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupDir = join(projectRoot, `.speccore-backup-${ts}`);
      await copy(speccoreDir, backupDir);
      spinner.stop(`已备份到 ${backupDir}`);
      logger.info('  (不需要时可手动删除)');
      logger.info('');
      spinner.stop('重置配置...');
    }

    // Create directory structure
    await ensureDir(join(speccoreDir, 'PROJECT'));
    await ensureDir(join(speccoreDir, 'PATTERNS'));
    await ensureDir(join(speccoreDir, 'ITERATIONS'));
    await ensureDir(join(speccoreDir, 'RULES'));
    await ensureDir(join(speccoreDir, 'local'));
    await ensureDir(join(speccoreDir, 'GLOBAL'));
    await ensureDir(join(speccoreDir, 'GLOBAL', 'PROJECTS'));
    await ensureDir(join(speccoreDir, 'GLOBAL', 'PROJECTS', '_template'));
    await ensureDir(join(speccoreDir, 'PATTERNS', 'TEMPLATES', 'crud'));
    await ensureDir(join(speccoreDir, 'PATTERNS', 'TEMPLATES', 'auth'));
    await ensureDir(join(speccoreDir, 'PATTERNS', 'TEMPLATES', 'export'));
    await ensureDir(join(speccoreDir, 'PATTERNS', 'TEMPLATES', 'report'));
    await ensureDir(join(speccoreDir, 'GLOBAL', 'BASELINES'));

    // Create default files
    await createDefaultFiles(projectRoot, speccoreDir);

    // Create GLOBAL layer files
    await createGlobalFiles(speccoreDir);

    // Create .workbuddy integration files for WorkBuddy IDE
    await createWorkBuddyFiles(projectRoot);

    // Create tool integration files (Claude, CodeBuddy, Cursor, Trae, WindSurf, QCoder)
    await createToolIntegrations(projectRoot, options.tool);

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
    const { version } = require('../../package.json');
    await writeFile(
      join(speccoreDir, 'local', 'version.json'),
      JSON.stringify({ version, createdAt: new Date().toISOString() }, null, 2)
    );

    // Create .gitignore entry
    await updateGitignore(projectRoot);

    // ── AI 使用规则 ──
    await writeFile(join(projectRoot, '.speccore', 'AI-RULES.md'), [
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
      '| spec-dev | 阶段检测+状态展示+推荐下一步 | "推进项目" |',
      '| spec-change | 变更记录+影响分析+代码更新 | "需求变更" |',
      '| spec-ask | 自然语言引擎（四大模式） | "怎么做"/"流程是什么" |',
      '',
      '## 目录结构',
      '',
      '```',
      'Iteration-xxx/',
      '├── 000-overview/     ← 进度跟踪',
      '├── 010-requirements/     ← 按需求功能（user-auth/ etc）',
      '│   ├── sources/        ← 原始文档',
      '│   ├── assets/         ← 素材（prd/prototypes/designs）',
      '│   └── {feature}/README.md',
      '├── 020-specs/     ← analyze 输出',
      '├── 030-tasks/     ← 开发任务',
      '│   └── Task-*/    ← split 拆分（含 .issues.md .needs-retry）',
      '├── STAFFING.md      ← 人员排期',
      '```',
      '',
      '## AI 行为约束',
      '',
      '- **不要自己创建目录** — 用 `speccore iteration create -n <名称>`',
      '- **不要自己解析需求** — 用 `speccore analyze -I <迭代>`',
      '- **失败时读取 .issues.md** — 不要猜测，看文件里的问题清单',
      '- **续跑用 --resume** — `speccore execute --resume` 自动扫描 .needs-retry',
    ].join('\n'));
    logger.info('   🤖 已生成 AI 使用规则: .speccore/AI-RULES.md');

    // ── AGENTS.md + 工具适配（Cursor/Windsurf/Claude 等）──
    await writeAgentsMd(projectRoot);
    // CLAUDE.md 指向 AGENTS.md
    await writeFile(join(projectRoot, 'CLAUDE.md'), `<!-- 规则请参考 AGENTS.md -->\n\n@AGENTS.md\n`);

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

## 项目信息

> ⚠️ **所有需求端名称（app/h5/miniapp/admin）必须与 010-requirements/ 子目录名严格一致**

| 工程 | 项目名称 | 源码路径 | Git 仓库 | 默认分支 | 对应需求端 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| ${projectName} | 待填写 | ./ | ${gitUrl || '待配置'} | main | app, h5, miniapp, admin |

> ⚠️ **项目名称** 是给人和 AI 看的业务名称（如"食堂后台管理"、"商户入驻系统"），不同于技术上的工程名。
>   AI 会据此理解项目业务范围，在分析/拆分/生成代码时作为上下文参考。

> 多工程示例（monorepo）:
>
> | 工程 | 项目名称 | 源码路径 | Git 仓库 | 默认分支 | 对应需求端 |
> | :--- | :--- | :--- | :--- | :--- | :--- |
> | order-service | 订单服务 | ./packages/order | git@xxx/order.git | master | app, admin |
> | payment-service | 支付服务 | ./packages/payment | git@xxx/pay.git | main | h5, miniapp |
>
> **关键规则**：
> 「项目名称」列方便人和 AI 通过业务名称理解和检索项目。
> 「对应需求端」列的值决定了：
> 1. 读取哪个 010-requirements/{端}/ 的需求文档
> 2. 分析结果写入 020-specs/{端}/
> 3. split 时按端创建 Task 并过滤对应的 API

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
| \`review.check_assignee\` | \`true\`/\`false\` | \`false\` | 审查时是否检查执行人签名 |

## 4. 配置变更记录

| 日期 | 变更项 | 旧值 | 新值 | 变更人 |
| :--- | :--- | :--- | :--- | :--- |
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

  // GLOBAL/INDEX.md - 全量需求索引
  await writeFile(
    join(globalDir, 'INDEX.md'),
    `# 全量需求索引（Global Catalog）

> 本文件是需求定位的"地图"。具体需求内容请查看各项目的 \`PROJECTS/{项目名}/REQUIREMENT.md\`。
> 本文件由 \`speccore import\` 和 \`speccore sync-global\` 自动维护，请勿手动编辑。

---

## 需求索引

| 需求 ID | 项目 | 需求名称 | 状态 | 版本 | 关联迭代 | 关联 Task | 文件路径 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| _暂无需求_ | - | - | - | - | - | - | - |

---

## 项目列表

| 项目名称 | 项目类型 | 需求数 | 已实现 | 进行中 | 待开发 | 最后导入 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| _暂无项目_ | - | - | - | - | - | - |

---

## 迭代关联

| 迭代名称 | 包含需求 | 状态 | 创建日期 |
| :--- | :--- | :--- | :--- |
| _暂无迭代_ | - | - | - |

---

## 版本信息

| 版本 | 日期 | 变更说明 |
| :--- | :--- | :--- |
| v1.0 | ${new Date().toISOString().split('T')[0]} | 初始创建 |
`
  );

  // GLOBAL/OVERVIEW.md - 全量项目全景
  await writeFile(
    join(globalDir, 'OVERVIEW.md'),
    `# 全量项目全景

> 本文档是从全局视角描述所有项目的全景视图，跨项目、跨系统的统一入口。

## 项目列表

| 项目名称 | 类型 | 状态 | 描述 |
| :--- | :--- | :--- | :--- |
| _待导入_ | - | - | - |

## 迭代索引

| 迭代名称 | 关联需求 | 状态 | 创建时间 |
| :--- | :--- | :--- | :--- |
| _暂无迭代_ | - | - | - |

## 版本信息

- 全量层版本：v1.0
- 最后更新：${new Date().toISOString().split('T')[0]}
`
  );

  // GLOBAL/ARCHITECTURE.md - 全量技术架构
  await writeFile(
    join(globalDir, 'ARCHITECTURE.md'),
    `# 全量技术架构

> 本文档描述所有项目的整体技术架构，是跨项目、跨系统的全量视图。

## 系统架构图

\`\`\`mermaid
flowchart TB
    subgraph "服务层"
        direction LR
        SVC1[服务A]
        SVC2[服务B]
        SVC3[服务C]
    end

    subgraph "前端层"
        direction LR
        WEB[Web 应用]
        H5[H5 应用]
        MP[小程序]
    end

    subgraph "数据层"
        direction LR
        DB1[(数据库A)]
        DB2[(数据库B)]
    end

    WEB --> SVC1
    WEB --> SVC2
    H5 --> SVC1
    H5 --> SVC2
    MP --> SVC1
    MP --> SVC2
    SVC1 --> DB1
    SVC2 --> DB2
\`\`\`

## 服务列表

| 服务名称 | 类型 | 技术栈 | 端口 | 描述 |
| :--- | :--- | :--- | :--- | :--- |
| _待导入_ | - | - | - | - |

## 服务间调用关系

| 调用方 | 被调用方 | 通信方式 | 说明 |
| :--- | :--- | :--- | :--- |
| _待导入_ | - | - | - |

## 跨服务数据模型

| 模型名称 | 所属服务 | 被依赖服务 | 说明 |
| :--- | :--- | :--- | :--- |
| _待导入_ | - | - | - |

## 外部依赖

| 依赖名称 | 用途 | 版本 | 说明 |
| :--- | :--- | :--- | :--- |
| _待导入_ | - | - | - |
`
  );

  // GLOBAL/TECH_STACK.md - 全量技术栈
  await writeFile(
    join(globalDir, 'TECH_STACK.md'),
    `# 全量技术栈

> 本文档汇总所有项目的技术栈信息，跨项目统一管理版本和依赖。

## 后端技术栈

| 项目名称 | 语言/框架 | ORM | 数据库 | 缓存 | 消息队列 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| _待导入_ | - | - | - | - | - |

## 前端技术栈

| 项目名称 | 平台类型 | 框架 | 状态管理 | UI 库 | 构建工具 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| _待导入_ | - | - | - | - | - |

## 中间件与基础设施

| 组件 | 版本 | 用途 | 使用项目 |
| :--- | :--- | :--- | :--- |
| _待导入_ | - | - | - |

## 版本兼容性矩阵

| 组件 | 当前版本 | 最新版本 | 升级建议 |
| :--- | :--- | :--- | :--- |
| _待导入_ | - | - | - |
`
  );

  // GLOBAL/CODE_INDEX.md - 全量代码索引
  await writeFile(
    join(globalDir, 'CODE_INDEX.md'),
    `# 全量代码索引

> 本文档是多工程代码路径映射，将所有项目的代码路径统一索引。

## 工程映射

| 工程名称 | 类型 | 本地路径 | Git 仓库 | 分支 |
| :--- | :--- | :--- | :--- | :--- |
| _待导入_ | - | - | - | - |

## 关键目录说明

| 工程名称 | 目录 | 说明 |
| :--- | :--- | :--- |
| _待导入_ | - | - |

## 跨工程引用

| 引用方 | 被引用方 | 引用方式 | 说明 |
| :--- | :--- | :--- | :--- |
| _待导入_ | - | - | - |
`
  );

  // GLOBAL/PROTOTYPE_INDEX.md - 全量原型索引
  await writeFile(
    join(globalDir, 'PROTOTYPE_INDEX.md'),
    `# 全量原型索引

> 本文档按平台分类管理所有设计原型。

## Web 端

| 原型名称 | 位置 | 关联需求 | 说明 |
| :--- | :--- | :--- | :--- |
| _待导入_ | - | - | - |

## H5 端

| 原型名称 | 位置 | 关联需求 | 说明 |
| :--- | :--- | :--- | :--- |
| _待导入_ | - | - | - |

## miniapp

| 原型名称 | 位置 | 关联需求 | 说明 |
| :--- | :--- | :--- | :--- |
| _待导入_ | - | - | - |
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

  // GLOBAL/CHANGELOG.md - 全量变更日志
  await writeFile(
    join(globalDir, 'CHANGELOG.md'),
    `# 全量变更日志

> 本文档记录全量层的所有变更操作（导入、同步、手动修改）。

## 变更记录

| 日期 | 版本 | 操作 | 描述 | 操作者 |
| :--- | :--- | :--- | :--- | :--- |
| ${new Date().toISOString().split('T')[0]} | v1.0 | 创建 | 全量层模板初始化 | SpecCore |

## 版本说明

- **版本格式**：v{主版本}.{次版本}
- **主版本变更**：新增/删除项目、大范围需求重构
- **次版本变更**：需求条目增删改、同步操作
`
  );

  // GLOBAL/PROJECTS/_template/REQUIREMENT.md
  await writeFile(
    join(globalDir, 'PROJECTS', '_template', 'REQUIREMENT.md'),
    `# {项目名称} - 需求文档

> 本文件仅包含本项目需求。跨项目引用请通过 \`GLOBAL/INDEX.md\` 映射。
> 最后更新：{日期}

---

## 项目信息

| 属性 | 值 |
| :--- | :--- |
| 项目名称 | {project} |
| 项目类型 | {type} |
| 技术栈 | {tech_stack} |
| 负责人 | {owner} |

---

## 需求列表

_暂无需求，等待 \`speccore import\` 导入_

---

## 已废弃需求

<!-- 已废弃的需求条目移动到这里，保留完整历史 -->
`
  );

  // GLOBAL/PROJECTS/_template/METADATA.md
  await writeFile(
    join(globalDir, 'PROJECTS', '_template', 'METADATA.md'),
    `# {项目名称} - 元数据

| 属性 | 值 |
| :--- | :--- |
| 项目名称 | {project} |
| 项目类型 | {type} |
| 技术栈 | {tech_stack} |
| 版本 | {version} |
| 负责人 | {owner} |
| 代码仓库 | {repo_url} |
| 最后扫描 | {date} |

## 依赖关系

| 依赖项目 | 依赖方式 | 说明 |
| :--- | :--- | :--- |
| _待填写_ | - | - |
`
  );

    // GLOBAL/BASELINES/README.md - 基线索引
  await writeFile(
    join(globalDir, 'BASELINES', 'README.md'),
    `# 基线索引

> 本文件记录所有创建的基线版本。

| 基线名称 | 创建时间 | 需求数 | 项目数 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| _暂无基线_ | - | - | - | - |
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

  logger.info('\n🧭 SpecCore 初始化向导\n');
  const modeAns = await ask('选择模式 [1]简洁(17个核心命令) [2]全量(51个命令) (默认:1): ');
  if (modeAns === '2') options.mode = 'full';

  logger.info(`\n📁 .speccore/ + .workbuddy/ 集成文件`);
  logger.info(`   模式: ${options.mode === 'full' ? '全量 (51命令)' : '简洁 (17命令)'}`);

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

async function createToolIntegrations(projectRoot: string, toolFilter?: string): Promise<void> {
  const commands: [string, string, string][] = [
    ['spec-ask', 'SpecCore AI Router', '1. Read .speccore/CONSTITUTION.md for project context\n2. Read .speccore/local/context.json for current iteration\n3. Execute: speccore ask "${1:描述你的需求}"'],
    ['spec-welcome', '显示项目名片（HTML页面）', 'speccore welcome'],
    ['spec-help', '显示命令帮助中心（HTML页面）', 'speccore help'],
    ['spec-dashboard', '显示全局仪表盘（HTML页面）', 'speccore dashboard --scope global'],
    ['spec-init', '初始化项目 或 升级命令文件: --update', 'speccore init'],
    ['spec-doc2spec', '导入需求文档: 文件=${1:PRD.docx} 迭代=${2:Q1}', 'speccore doc2spec -f ${1:PRD.docx} --iter ${2:Q1}'],
    ['spec-analyze', 'SpecCore Analysis', '1. Read 010-requirements/ for all platform docs\n2. Ask user for iteration name if not provided\n3. Execute: speccore analyze -I ${1:Q1} --task ${2:Task-001}\n4. Present analysis report and ask for confirmation'],
    ['spec-split', 'SpecCore Task Split', '1. Read 020-specs/ for analysis docs\n2. Read STAFFING.md for team allocation\n3. Dry-run split and show preview\n4. Ask user to confirm before creating tasks\n5. Execute: speccore iteration split -i ${1:Q1} --owner ${2|张三,李四,王五|}'],
    ['spec-execute', 'SpecCore Execute', '1. Read Task REQ.md and TECH.md for completeness\n2. Check .needs-retry for previous failures\n3. Show execution plan and batch info\n4. Execute: speccore execute -i ${1:Q1} -t ${2:Task-001} --type ${3|feature,bugfix,research|} --force\n5. If failed, write .issues.md and suggest --resume'],
    ['spec-plan', '生成计划: 迭代=${1:Q1} 责任人=${2|张三,李四,王五|}', 'speccore plan -I ${1:Q1} --owner ${2|张三,李四,王五|}'],
    ['spec-pr', '创建PR: 任务=${1:Task-001}', 'speccore pr --task=${1:Task-001}'],
    ['spec-done', '任务归档: 任务=${1:Task-001}', 'speccore done --task=${1:Task-001}'],
    ['spec-spec2doc', '导出文档: 迭代=${1:Q1} 格式=${2|需求.docx,方案.pdf|}', 'speccore spec2doc -i ${1:Q1} -o ${2|需求.docx,方案.pdf|}'],
    ['spec-dev', 'SpecCore Smart Pipeline', '1. Read .speccore/local/context.json for current state\n2. Read 000-overview/PROJECT_GRAPH.md for progress\n3. Present current phase and recommend next step\n4. Execute: speccore dev -i ${1:Q1} ${2|,--auto|}'],
    ['spec-change', '需求变更: 描述=${1:变更描述} 任务=${2:Task-001}', 'speccore change "${1:变更描述}" --task=${2:Task-001} --type ${3|feature,bugfix|}'],
    ['spec-validate', '合规验证: 迭代=${1:Q1}', 'speccore validate --iteration=${1:Q1}'],
    ['spec-search', '全文搜索: ${1:关键词}', 'speccore search ${1:关键词}'],
    ['spec-track', '全链路追踪: 需求=${1:REQ-001}', 'speccore track --req=${1:REQ-001}'],
    ['spec-sync', '双向同步全局', 'speccore sync --global'],
    ['spec-rename', '重命名: 旧名=${1:Q1} 新名=${2:Q2}', 'speccore rename --iteration ${1:Q1} ${2:Q2}'],
    ['spec-create-iteration', '创建迭代: 名称=${1:Q2} 负责人=${2|张三,李四,王五|}', 'speccore iteration create -n ${1:Q2} --owner=${2|张三,李四,王五|}'],
    ['spec-retro', '回顾报告: 任务=${1:Task-001} 可批量 --all', 'speccore retro --task ${1:Task-001}'],
    ['spec-context', '切换上下文: 迭代=${1:Q1}', 'speccore context --set --iteration ${1:Q1}'],
    ['spec-ops', '操作历史', 'speccore ops'],
  ];

  const allTools = ['claude', 'codebuddy', 'cursor', 'trae', 'trae-cn', 'windsurf'];
  const filter = toolFilter ? toolFilter.split(',').map(t => t.trim()) : null;
  const tools = filter ? allTools.filter(t => filter.includes(t) || filter.includes(t.replace('-cn', ''))) : allTools;
  for (const tool of tools) {
    const toolDir = join(projectRoot, '.' + tool, 'commands');
    await ensureDir(toolDir);
    for (const [name, desc, cmd] of commands) {
      const content = '---\nname: ' + name + '\ndescription: ' + desc + '\n---\n' + cmd;
      await writeFile(join(toolDir, name + '.md'), content);
    }
  }
  const hasQoder = !filter || filter.includes("qoder");
  if (hasQoder) {
  // QCoder: 项目级指令路径 = .qoder/commands/，支持子目录分类
  const qoderCommandsDir = join(projectRoot, '.qoder', 'commands', 'spec');
  await ensureDir(qoderCommandsDir);
  for (const [name, desc, cmd] of commands) {
    // 去掉 spec- 前缀作为文件名，放在 spec/ 子目录下 → 用户输入 /spec 可浏览子命令
    const shortName = name.replace(/^spec-/, '');
    const content = desc + '\n\n执行命令: `' + cmd + '`';
    await writeFile(join(qoderCommandsDir, shortName + '.md'), content);
  }
  // 清理旧版本残留的 orphan 文件
  const validNames = new Set(commands.map(([name]) => name.replace(/^spec-/, '') + '.md'));
  try {
    const existing = await readdir(qoderCommandsDir);
    for (const f of existing) {
      if (!validNames.has(f)) {
        await require('fs-extra').unlink(join(qoderCommandsDir, f));
        logger.info(`  清理旧文件: ${f}`);
      }
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
- 只输出 CLI 命令，不自行执行
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
    'spec-analyze',
    'spec-split', 
    'spec-execute',
    'spec-plan',
    'spec-dev',
    'spec-change',
    'spec-doc2spec',
    'spec-spec2doc',
  ];
  
  let skillsCopied = 0;
  for (const name of skillNames) {
    const srcFile = join(cliSkillsDir, name, 'SKILL.md');
    const destDir = join(projectSkillsDir, name);
    try {
      if (await pathExists(srcFile)) {
        await ensureDir(destDir);
        await copy(srcFile, join(destDir, 'SKILL.md'));
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
async function cleanupStaleFiles(
  projectRoot: string,
  commands: [string, string, string][],
  skillNames: string[]
): Promise<void> {
  const allTools = ['claude', 'codebuddy', 'cursor', 'trae', 'trae-cn', 'windsurf'];
  const validCmdNames = new Set(commands.map(([name]) => name + '.md'));
  let cleanedCount = 0;

  // 1. 清理各工具的 commands 目录下 stale 文件
  for (const tool of allTools) {
    const cmdDir = join(projectRoot, '.' + tool, 'commands');
    try {
      if (!await pathExists(cmdDir)) continue;
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

## 项目类型
SpecCore 规范驱动开发项目。

## 核心工作方式
- **AI 只拼命令，不执行命令**。识别用户意图后，输出 \`speccore\` CLI 命令给用户在终端执行。
- **所有确定性操作通过 \`speccore\` CLI 完成**（创建目录、读写文件、校验格式）。
- **代码生成通过宿主 AI 完成**，CLI 负责准备 Spec 上下文和写入文件。

## 项目结构
\`\`\`
Iteration-NNN-name/            ← 迭代目录
├── 000-overview/              ← 进度总览
├── 010-requirements/          ← 需求文档（按功能组织）
│   ├── sources/               ← 原始 PRD
│   ├── assets/                ← 素材
│   └── {feature}/README.md    ← 各需求描述
├── 020-specs/                 ← 需求分析（按端输出）
├── 030-tasks/                 ← 开发任务
└── STAFFING.md                ← 人员排期
\`\`\`

## 核心命令
| 意图 | CLI 命令 |
| :--- | :--- |
| 初始化项目 | \`speccore init\` |
| 创建迭代 | \`speccore iteration create -n <name> --owner <owner>\` |
| 导入需求文档 | \`speccore doc2spec -f <file> --iter <iter>\` |
| 分析需求 | \`speccore analyze -I <iter>\` |
| 拆分任务 | \`speccore iteration split -I <iter>\` |
| 执行任务 | \`speccore execute -t <task> --force\` |
| 查看进度 | \`speccore dashboard\` |
| 任务回顾 | \`speccore retro --task <task>\` |

## 行为约束
- **不要自己创建目录** — 用 \`speccore iteration create\`
- **不要自己解析需求** — 用 \`speccore analyze\`
- **失败时读取 .issues.md** — 看文件里的问题清单
- **续跑用 --resume** — \`speccore execute --resume\`

## 上下文文件加载顺序
1. AGENTS.md（本文档）— 项目规则
2. .speccore/CONSTITUTION.md — 技术栈与需求端映射
3. .speccore/local/context.json — 当前活跃迭代
4. .agents/skills/SKILL.md — 技能指令
`;

  await wf(require('path').join(projectRoot, 'AGENTS.md'), content);
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
  // 源文件/ 存放原始文档与素材  各端/ 存放转换后的 MD
  const prdDir = join(iterDir, '010-requirements');
  // 源文件/ 存放原始文档  素材/ 存放共享图片、原型（跨端引用）
  await ensureDir(join(prdDir, 'sources'));
  await ensureDir(join(prdDir, 'assets', 'extracted'));     // PRD 提取的图片
  await ensureDir(join(prdDir, 'assets', 'prototypes'));    // 产品原型
  await ensureDir(join(prdDir, 'assets', 'designs'));  // UI 设计稿
  
  await writeFile(join(prdDir, 'sources', 'README.md'), '# 原始文档与素材\n\n请将产品提供的 Word/PDF/原型图 放在此处。');

  // 示例需求目录（按需求功能组织，非按端）
  const sampleFeature = join(prdDir, 'user-auth');
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
async function checkUpgradeHints(projectRoot: string, speccoreDir: string): Promise<void> {
  const { version } = require('../../package.json');
  const versionFile = join(speccoreDir, 'local', 'last-init-version.txt');
  let lastVersion = '';
  try { lastVersion = await readFile(versionFile, 'utf-8').then(v => v.trim()); } catch {}

  const constitutionPath = join(speccoreDir, 'CONSTITUTION.md');
  const hasConstitution = await pathExists(constitutionPath);

  if (hasConstitution && lastVersion !== version) {
    const content = await readFile(constitutionPath, 'utf-8');
    const hints: string[] = [];
    let newTemplate = '';

    // 检出缺失的新版字段
    if (!content.includes('项目名称')) {
      hints.push('表头新增 "项目名称" 列');
      newTemplate = generateConstitutionTemplate(projectRoot);
    }

    if (hints.length > 0) {
      const upgradeDir = join(speccoreDir, 'local');
      const upgradeFile = join(upgradeDir, 'UPGRADE.md');
      
      // 生成升级指南（供用户手动参考 或 AI 处理）
      const guide = [
        `# CONSTITUTION.md 升级指南`,
        '',
        `> Speccore ${lastVersion || '旧版'} → ${version}`,
        '',
        '## 变更内容',
        ...hints.map(h => `- ${h}`),
        '',
        '## 当前文件（你的）',
        '```',
        content.slice(0, 2000), // 截取前 2000 字符
        '```',
        '',
        '## 新版模板（参考）',
        '```',
        newTemplate.slice(0, 2000),
        '```',
        '',
        '## 操作方式',
        '',
        '### 方式 A: AI 智能合并（推荐）',
        '在 WorkBuddy 中说: "帮我根据 UPGRADE.md 升级 CONSTITUTION.md"',
        '',
        '### 方式 B: 手动修改',
        '1. 打开 .speccore/CONSTITUTION.md',
        `2. 参考上方新版模板，在表头添加 "项目名称" 列`,
        '3. 保存后运行 speccore init 确认',
        '',
      ].join('\n');

      await writeFile(upgradeFile, guide);

      logger.info('');
      logger.info('━'.repeat(50));
      logger.info(`🔄 CONSTITUTION.md 模板有更新 (${lastVersion || '旧版'} → ${version})`);
      logger.info('');
      for (const h of hints) logger.info(`   📝 ${h}`);
      logger.info('');
      logger.info('   📄 升级指南: .speccore/local/UPGRADE.md');
      logger.info('   🤖 AI 模式: 说 "帮我升级 CONSTITUTION.md"');
      logger.info('   ✋ 手动模式: 对照 UPGRADE.md 自行修改');
      logger.info('━'.repeat(50));
      logger.info('');
    }
  }

  // 版本跳跃提示 — 列出自动更新了的文件
  if (lastVersion && lastVersion !== version) {
    logger.info(`📋 已自动更新的文件 (${lastVersion} → ${version}):`);
    logger.info('   ✅ AI-RULES.md — 命令参考表（新增 Prompt 模式）');
    logger.info('   ✅ AGENTS.md — 项目规则（新增 Skill 描述）');
    logger.info('   ✅ .agents/skills/ — 10 个 Skill 全量更新');
    logger.info('   ✅ .claude/ / .codebuddy/ — 命令模板更新');
    logger.info('');
  }

  await writeFile(versionFile, version);
}

function generateConstitutionTemplate(projectRoot: string): string {
  const projectName = require('path').basename(projectRoot);
  const gitUrl = detectGitUrl(projectRoot);
  return `# 技术宪法

> 本文档是 SpecCore 与 AI 的**最高优先级契约**。analyze/split/execute 均据此执行。

## 项目信息

| 工程 | 项目名称 | 源码路径 | Git 仓库 | 默认分支 | 对应需求端 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| ${projectName} | 待填写 | ./ | ${gitUrl || '待配置'} | main | app, h5, miniapp, admin |
`;

}

function detectGitUrl(root: string): string | undefined {
  try {
    const url = require('child_process').execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf-8', cwd: root }).trim();
    return url || undefined;
  } catch { return undefined; }
}
