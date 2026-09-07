# AGENTS.md — SpecCore 项目规则

> 本文档供 AI 编码工具自动读取（Cursor / Copilot / Windsurf / Codex / Claude Code）。
> 工具会读取本文档理解项目规则，不需要用户重复解释。

## ⛔ 新会话第一步（最高优先级）

**每次新会话开始时，必须先执行以下操作，不要做任何其他事情：**

```
Read .speccore/local/context.json    ← 获取当前活跃迭代
Read .speccore/CONSTITUTION.md       ← 获取技术宪法（技术栈、命名规范）
Read .speccore/PROJECT.yaml          ← 获取项目配置（端列表、源码路径、Git）
```

- `context.json` 中的 `currentIteration` 字段就是当前迭代名
- **绝对不要自己创建迭代目录** — 迭代已存在，读 context.json 就知道了
- **绝对不要写 JS/Python 脚本绕过 CLI** — 所有操作通过 `speccore` CLI 完成

## 项目类型
SpecCore 规范驱动开发项目。

## 核心工作方式
- **AI 只拼命令，不执行命令**。识别用户意图后，输出 `speccore` CLI 命令给用户在终端执行。
- **所有确定性操作通过 `speccore` CLI 完成**（创建目录、读写文件、校验格式）。
- **代码生成通过宿主 AI 完成**，CLI 负责准备 Spec 上下文和写入文件。
- **代码写到 CONSTITUTION.md / PROJECT.yaml 指定的源码路径**，不要写到迭代目录里。

## ⛔ 绝对禁止

1. **禁止自己创建迭代目录** — 用 `speccore iteration create`（通常迭代已存在）
2. **禁止写脚本绕过 CLI** — 不要写 build-xxx.js / run-xxx.py 等脚本
3. **禁止在任务目录（Task-*/）下创建 10-backend/ 20-frontend/ 分类层** — 任务目录是端平铺结构，端直接平铺在 Task 下
4. **禁止把代码写到迭代目录内** — 代码写到 CONSTITUTION.md / PROJECT.yaml 中各工程的「源码路径」

## 项目结构
```
Iteration-NNN-name/            ← 迭代目录（名称从 context.json 获取）
├── 000-overview/              ← 进度总览与报告
│   ├── PROJECT_GRAPH.md       ← 项目任务图谱
│   ├── task-summaries/        ← 任务总览报告
│   ├── plans/                 ← 执行计划
│   ├── RETRO.md               ← 迭代复盘
│   └── PIPELINE_REPORT.md     ← Pipeline 报告
├── 010-requirements/          ← 需求文档（按功能组织）
│   ├── README.md              ← 目录规范说明
│   ├── INDEX.md               ← 需求文档索引
│   ├── sources/               ← [只读] 原始 PRD
│   ├── converted/             ← [自动生成] doc2spec 转换
│   ├── features/              ← [手动维护] 按功能模块组织
│   ├── prototypes/            ← 原型素材
│   ├── assets/                ← 素材资源（extracted/prototypes/designs/screenshots）
│   └── [bugs/refactors/research/REQUIREMENT.md/CLARIFY_REPORT.md] ← 可选
├── 020-specs/                 ← 需求分析（analyze 输出）
│   ├── overview/              ← 全局规格
│   ├── {功能模块}/{端名}/      ← 端级规格
│   ├── requirements/          ← 黄金需求
│   ├── PLATFORMS.md           ← 端列表
│   └── QUALITY_AUDIT.md       ← 质量审计
├── 030-tasks/                 ← 开发任务
│   └── Task-NNN-name/         ← 功能模块任务
│       ├── .meta/             ← 任务元信息
│       │   ├── feature        ← 功能单元名
│       │   ├── type           ← 任务类型
│       │   ├── status         ← 状态
│       │   ├── owner          ← 负责人
│       │   ├── created-at     ← 创建时间
│       │   └── estimated-hours ← 预估工时
│       ├── _shared/           ← 共享契约（API_CONTRACT.yaml + CONTEXT.md）
│       ├── 00-specs/          ← 模块级核心规格（analyze 写入）
│       ├── {platform}/        ← 端平铺
│       │   └── {subtask}/     ← 执行单元（.meta/ + 规格文档）
│       │       └── [ROUTES.md/STATE.md] ← 仅前端
│       └── .issues.md         ← 问题追踪
└── STAFFING.md                ← 人员排期
```

## SpecCore 输出标记
当执行 `speccore ask` 或 `speccore about` 时，会输出以下标记，按优先级处理：
| 标记 | 含义 | 动作 |
|:---|:---|:---|
| `[SPECCORE_ONBOARD: <path>]` | 首次/升级引导页 | **最先处理**，用 present_files 展示 HTML |
| `[SPECCORE_SETUP_GUIDE: <path>]` | 项目配置引导页 | init 后用 present_files 展示，指导用户配置 |
| `[SPECCORE_ABOUT: <path>]` | 版本信息页 | 用 present_files 展示 |
| `[SPECCORE_MODE: <mode>]` | 意图模式 | 识别模式后进入对应流程 |
| `[SPECCORE_EXEC: <cmd>]` | 自动执行命令 | 直接 execute_command |
| `[SPECCORE_CONFIRM]` | 执行前确认 | 需用户确认后再执行（副作用命令） |
| `[SPECCORE_EXEC_STATUS: ok\|fail(<code>)]` | 命令执行结果 | 检查执行是否成功 |
| `[SPECCORE_EXEC_ERROR: <msg>]` | 命令执行异常 | 查看错误详情 |
| `[SPECCORE_INTENT]` | 意图确认块 | 展示给用户确认 |
| `[SPECCORE_CONFIRM_STEP: <order>/<total>] <cmd>` | Pipeline 步骤信息 | 展示当前步骤详情 |
| `[SPECCORE_CONFIRM_ASK: ...]` | Pipeline 步骤询问 | 等待用户输入 y（确认）/ s（跳过）/ q（停止） |
| `[SPECCORE_STEP_FAIL: <cmd>]` | Pipeline 步骤失败 | 提示用户选择重试/跳过/停止 |
| `[SPECCORE_AMBIGUOUS: <cmd1> \| <cmd2>]` | 意图模糊 | 展示匹配选项让用户选择 |
| `[SPECCORE_CONTINUE: <path>]` | 批次执行完成，需续批 | **必须开始新对话**，先读取 `<path>` 恢复上下文，再按提示命令继续下一批次 |

## 行为约束
- **不要自己创建目录** — 用 `speccore iteration create`
- **不要自己解析需求** — 用 `speccore analyze`
- **失败时读取 .issues.md** — 看文件里的问题清单
- **续跑用 --resume** — `speccore execute --resume`
- **配置变更用 --upgrade** — `speccore config --upgrade`（`.speccore.yml` / `PROJECT.yaml` 结构升级）

## 常用命令速查
```bash
speccore status                          # 当前迭代状态面板
speccore analyze -I <迭代名> --auto      # 全量分析
speccore split -I <迭代名>               # 自动拆分任务
speccore execute -i <迭代名> --all       # 执行所有任务
```

<!-- SPECCORE_AUTO_INDEX_START -->
> 以下内容由 `.speccore/` 规范数据库自动生成，请勿手动编辑此区域

## 角色与职责

### 更多角色
- [code reviewer](.speccore/AGENTS/code-reviewer.md)
- [compiler](.speccore/AGENTS/compiler.md)
- [compliance checker](.speccore/AGENTS/compliance-checker.md)
- [dependency analyst](.speccore/AGENTS/dependency-analyst.md)
- [doc sync agent](.speccore/AGENTS/doc-sync-agent.md)
- [impact analyst](.speccore/AGENTS/impact-analyst.md)
- [interaction designer](.speccore/AGENTS/interaction-designer.md)
- [performance expert](.speccore/AGENTS/performance-expert.md)
- [product analyst backend](.speccore/AGENTS/product-analyst-backend.md)
- [product analyst frontend](.speccore/AGENTS/product-analyst-frontend.md)
- [product analyst](.speccore/AGENTS/product-analyst.md)
- [regression tester](.speccore/AGENTS/regression-tester.md)
- [risk assessor](.speccore/AGENTS/risk-assessor.md)
- [schedule planner](.speccore/AGENTS/schedule-planner.md)
- [security reviewer finance](.speccore/AGENTS/security-reviewer-finance.md)
- [security reviewer](.speccore/AGENTS/security-reviewer.md)
- [task decomposer](.speccore/AGENTS/task-decomposer.md)
- [test engineer](.speccore/AGENTS/test-engineer.md)
- [test reviewer](.speccore/AGENTS/test-reviewer.md)

## 规范与参考

## 项目结构

```
Iteration-NNN-name/            ← 迭代目录
├── 000-overview/              ← 进度总览与报告
│   ├── PROJECT_GRAPH.md       ← 项目任务图谱（split 后生成）
│   ├── task-summaries/        ← 任务总览报告（TASK_SUMMARY-*.md）
│   ├── plans/                 ← 执行计划（PLAN.md + HTML 可视化）
│   ├── RETRO.md               ← 迭代复盘报告（done 后生成）
│   └── PIPELINE_REPORT.md     ← Pipeline 执行报告（dev 后生成）
├── 010-requirements/          ← 需求文档（按功能组织）
│   ├── README.md              ← 目录规范说明
│   ├── INDEX.md               ← 需求文档索引
│   ├── sources/               ← [只读] 原始 PRD（.docx/.pdf/.md）
│   ├── converted/             ← [自动生成] doc2spec 转换后的 MD
│   ├── features/              ← [手动维护] 按功能模块组织
│   │   └── {feature}/
│   │       └── README.md
│   ├── prototypes/            ← 原型（HTML/图片/链接，内容不限）
│   ├── assets/                ← 素材资源
│   │   ├── extracted/         ← doc2spec 提取的图片/媒体
│   │   ├── prototypes/        ← 产品原型
│   │   ├── designs/           ← UI 设计稿
│   │   └── screenshots/       ← 参考截图
│   ├── bugs/                  ← [可选] bug 需求文档
│   ├── refactors/             ← [可选] 重构需求文档
│   ├── research/              ← [可选] 调研需求文档
│   ├── REQUIREMENT.md         ← [可选] 主需求文档
│   └── CLARIFY_REPORT.md      ← [可选] 需求澄清报告
├── 020-specs/                 ← 需求分析（analyze 输出）
│   ├── overview/              ← 全局规格（跨端共享）
│   │   └── REQUIREMENT.md / ANALYSIS.md / TECH.md / DEV_GUIDE.md ...
│   ├── {功能模块}/            ← 按功能模块组织
│   │   └── {端名}/            ← 端级规格
│   │       └── TECH.md / TEST.md / UI_SPEC.md / DEV_GUIDE.md ...
│   ├── requirements/          ← 黄金需求（clarify 输出，analyze 读取）
│   ├── PLATFORMS.md           ← 端列表
│   └── QUALITY_AUDIT.md       ← 质量审计报告
├── 030-tasks/                 ← 开发任务
│   └── Task-*/                ← 功能模块分组（聚合相关子任务）
│       ├── .meta/             ← 任务元信息
│       │   ├── feature        ← 功能单元名
│       │   ├── type           ← 任务类型（feature/bugfix/refactor/research）
│       │   ├── status         ← 状态（todo/doing/done）
│       │   ├── owner          ← 负责人
│       │   ├── created-at     ← 创建时间
│       │   └── estimated-hours ← 预估工时
│       ├── _shared/           ← 共享契约
│       │   ├── API_CONTRACT.yaml
│       │   └── CONTEXT.md
│       ├── 00-specs/          ← 模块级核心规格（analyze 阶段写入）
│       │   ├── REQ.md         ← 需求规格
│       │   ├── TECH.md        ← 技术规格
│       │   ├── SCHEMA.md      ← 数据模型（条件创建）
│       │   ├── CHANGELOG.md   ← 变更记录
│       │   └── CONTEXT.md     ← [兼容] 任务上下文副本
│       ├── {端名}/            ← 端平铺（如 booking-service / h5-mobile / admin-web）
│       │   └── {子任务}/      ← 执行单元
│       │       ├── .meta/     ← 子任务元信息
│       │       │   ├── type
│       │       │   ├── status
│       │       │   ├── owner
│       │       │   ├── created-at
│       │       │   ├── estimated-hours ← 预估工时
│       │       │   ├── feature       ← 功能单元名
│       │       │   └── git-config    ← 子任务级 Git 配置
│       │       ├── TASK.md    ← 子任务追踪
│       │       ├── TEST.md    ← 测试用例
│       │       ├── RISK.md    ← 风险评估
│       │       ├── DEPS.md    ← 依赖分析
│       │       ├── MONITOR.md ← 监控方案
│       │       ├── REVIEW.md  ← 评审清单
│       │       ├── DEPLOY.md  ← 部署清单
│       │       ├── ERROR_CODES.md
│       │       ├── COMPONENT_TREE.md  ← 组件树（仅前端）
│       │       ├── ROUTES.md          ← 路由设计（仅前端）
│       │       └── STATE.md           ← 状态管理（仅前端）
│       └── .issues.md         ← 问题追踪
│
│   > ⚠️ 代码输出位置：AI 生成的代码写入 CONSTITUTION.md/PROJECT.yaml 中声明的「源码路径」，
│   > 禁止写入迭代目录内。子任务目录只存放规格文档（TASK.md/TEST.md/RISK.md 等）。
│
│   research 类型任务目录结构（无前后端分层）：
│       ├── _shared/
│       │   └── CONTEXT.md
│       ├── 00-specs/
│       │   ├── REQ.md
│       │   └── TECH.md
│       ├── RESEARCH.md        ← 调研报告
│       ├── COMPARISON.md      ← 方案对比
│       └── .issues.md         ← 问题追踪
└── STAFFING.md                ← 人员排期
```

## SpecCore 输出标记

当执行 `speccore ask` 或 `speccore about` 时，会输出以下标记，按优先级处理：

| 标记 | 含义 | 动作 |
|:---|:---|:---|
| `[SPECCORE_ONBOARD: <path>]` | 首次/升级引导页 | **最先处理**，用 present_files 展示 HTML |
| `[SPECCORE_SETUP_GUIDE: <path>]` | 项目配置引导页 | init 后用 present_files 展示，指导用户配置 |
| `[SPECCORE_ABOUT: <path>]` | 版本信息页 | 用 present_files 展示 |
| `[SPECCORE_MODE: <mode>]` | 意图模式 | 识别模式后进入对应流程 |
| `[SPECCORE_EXEC: <cmd>]` | 自动执行命令 | 直接 execute_command |
| `[SPECCORE_INTENT]` | 意图确认块 | 展示给用户确认 |
| `[SPECCORE_CONTINUE: <path>]` | 批次执行完成，需续批 | **必须开始新对话**，先读取 `<path>` 恢复上下文，再按提示命令继续下一批次 |

## 常用命令速查

```bash
speccore status                          # 当前迭代状态面板
speccore analyze -I <迭代名> --auto      # 全量分析
speccore split -I <迭代名>               # 自动拆分任务
speccore execute -i <迭代名> --all       # 执行所有任务
```

### 更多规范
- [CODE REVIEW](.speccore/RULES/CODE_REVIEW.md)
- [POST COMPLETION](.speccore/RULES/POST_COMPLETION.md)
- [api design](.speccore/RULES/api-design.md)
- [database](.speccore/RULES/database.md)
- [frontend common](.speccore/RULES/frontend-common.md)
- [nodejs](.speccore/RULES/nodejs.md)
- [react](.speccore/RULES/react.md)
- [security](.speccore/RULES/security.md)
- [testing](.speccore/RULES/testing.md)
- [typescript](.speccore/RULES/typescript.md)

## Agent 角色定义（v6.99.0+）

> 来源：`.agents/agents/`，项目级专用 Agent 角色定义

| Agent | 职责 | 核心能力 |
| :--- | :--- | :--- |
| spec-analyzer | SpecCore 需求分析与任务规划 Agent | 需求分析、功能识别 |
| spec-architect | SpecCore 架构守护与演进 Agent | 架构一致性检查、技术债务识别 |
| spec-change-detector | SpecCore 变更感知与影响分析 Agent | 变更监听、影响分析 |
| spec-clarifier | SpecCore 需求澄清 Agent | 模糊点识别、缺失信息检测 |
| spec-executor | SpecCore 开发执行与交付 Agent | 读取规格、代码生成 |
| spec-gatekeeper | SpecCore 质量门禁 Agent | 编译检查、测试检查 |
| spec-global-analyzer | SpecCore 全局源码分析 Agent | 源码扫描、跨端关联 |
| spec-knowledge-curator | SpecCore 知识沉淀与维护 Agent | 模式更新、术语维护 |
| spec-reviewer | SpecCore 代码审查与质量验证 Agent | Spec 符合性检查、代码质量检查 |
| spec-security-auditor | SpecCore 安全审计 Agent | 代码安全扫描、敏感数据处理 |
| spec-tester | SpecCore 测试专项 Agent | 测试策略设计、测试用例生成 |

### 所有 Agent 共用的核心约束

- 不要自己创建目录 — 使用 `speccore` CLI
- 不要写脚本绕过 CLI — 所有操作通过 `speccore` 命令完成
- 代码写到 CONSTITUTION.md 指定的源码路径，不写到迭代目录内
- 迭代内写 Spec，迭代外写代码


<!-- SPECCORE_AUTO_INDEX_END -->
