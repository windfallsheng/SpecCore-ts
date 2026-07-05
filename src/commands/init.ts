import { ensureDir, writeFile, pathExists, readFile } from 'fs-extra';
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
    await ensureDir(join(speccoreDir, 'GLOBAL'));
    await ensureDir(join(speccoreDir, 'GLOBAL', 'PROJECTS'));
    await ensureDir(join(speccoreDir, 'GLOBAL', 'PROJECTS', '_template'));
    await ensureDir(join(speccoreDir, 'PATTERNS', 'TEMPLATES', 'crud'));
    await ensureDir(join(speccoreDir, 'PATTERNS', 'TEMPLATES', 'auth'));
    await ensureDir(join(speccoreDir, 'PATTERNS', 'TEMPLATES', 'export'));
    await ensureDir(join(speccoreDir, 'PATTERNS', 'TEMPLATES', 'report'));
    await ensureDir(join(speccoreDir, 'GLOBAL', 'BASELINES'));

    // Create default files
    await createDefaultFiles(speccoreDir);

    // Create GLOBAL layer files
    await createGlobalFiles(speccoreDir);

    // Create context.json
    await writeFile(
      join(speccoreDir, 'local', 'context.json'),
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

    // Create .gitignore entry
    await updateGitignore(projectRoot);

    // Update context
    await updateContext({ lastUpdated: new Date().toISOString() });

    spinner.stop('SpecCore initialized successfully!');
    logger.info('');
    logger.info('Next steps:');
    logger.info('  1. Edit .speccore/CONSTITUTION.md to define your tech stack');
    logger.info('  2. Edit .speccore/PROJECT/TEAM.md to add team members');
    logger.info('  3. Run: speccore import --project=<name> --path=<path> to import projects');
    logger.info('  4. Run: speccore global-status to view global layer');
    logger.info('  5. Run: speccore iteration-from-global to generate iteration from requirements');
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

| 需求 ID | 项目 | 需求名称 | 状态 | 版本 | 关联期次 | 关联 Task | 文件路径 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| _暂无需求_ | - | - | - | - | - | - | - |

---

## 项目列表

| 项目名称 | 项目类型 | 需求数 | 已实现 | 进行中 | 待开发 | 最后导入 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| _暂无项目_ | - | - | - | - | - | - |

---

## 期次关联

| 期次名称 | 包含需求 | 状态 | 创建日期 |
| :--- | :--- | :--- | :--- |
| _暂无期次_ | - | - | - |

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

## 期次索引

| 期次名称 | 关联需求 | 状态 | 创建时间 |
| :--- | :--- | :--- | :--- |
| _暂无期次_ | - | - | - |

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

## 小程序端

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
