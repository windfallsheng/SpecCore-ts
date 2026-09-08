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

## 分析模式边界（全局 vs 迭代层）

| 维度 | 全局分析 | 迭代层分析 |
|:---|:---|:---|
| **命令** | `speccore analyze --scope global` | `speccore analyze -I <迭代名>` |
| **产出位置** | `.speccore/GLOBAL/` | `Iteration-NNN/020-specs/` |
| **产出内容** | 跨迭代复用的全局资产（端索引、跨端关联、全局架构、各端技术文档） | 当前迭代专属的分析文档（任务级规格、UI设计、测试用例） |
| **分层** | Layer 1→2→3→4（4a/4b/4c/4d 子层） | Phase 1（综合文档）→ Phase 2（各端专属） |
| **何时执行** | 项目首次接入 / 新增端 / 全局架构变更 | 每个迭代的需求分析阶段 |

**绝对禁止混淆**：
- 全局分析的 `requirements/REQUIREMENT.md`（全局需求总纲）**不等于**迭代层的 `020-specs/overview/REQUIREMENT.md`（迭代专属需求）
- 全局分析的 `platforms/{端}/`（端级技术资产）**不等于**迭代层的 `{端}/`（任务级实现规格）
- 补充全局需求文档时**必须**使用 `--scope global`，不能用迭代层命令替代

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
5. **禁止在分析阶段打开浏览器、模拟用户操作或访问 URL** — 所有分析基于直接 Read 源码和结构化数据
6. **禁止直接用 Write 工具写 020-specs/ 或 .speccore/GLOBAL/ 下的文件** — 必须通过 `speccore analyze --apply` 写入，CLI 自动路由到正确子目录

## 项目结构

### 规范数据库（`.speccore/`）
```
.speccore/
├── GLOBAL/                    ← [AI生成] 全局分析产出（跨迭代复用）
│   ├── platforms/             ← 端索引 + 技术资产
│   ├── platforms/_shared/     ← 跨端关联 + 模块清单
│   ├── requirements/          ← 产品视角需求文档
│   ├── overview/              ← 技术视角全局文档
│   └── PATTERNS/              ← [可选] 可复用设计模式
├── ITERATIONS/                ← [CLI生成] 迭代数据
├── PATTERNS/                  ← [AI生成] 跨迭代模式库
├── RULES/                     ← [手动维护] 项目规范（nodejs/react/security 等）
├── AGENTS/                    ← [手动维护] Agent 角色定义
├── CONSTITUTION.md            ← [手动维护] 技术宪法（技术栈、命名规范、端列表）
└── PROJECT.yaml               ← [手动维护] 项目配置（源码路径、Git、环境）
```

### 迭代目录（`Iteration-NNN-name/`）
```
Iteration-NNN-name/            ← [CLI生成] 迭代目录（名称从 context.json 获取）
├── 000-overview/              ← [CLI生成] 进度总览与报告
│   ├── PROJECT_GRAPH.md       ← [CLI生成] 项目任务图谱
│   ├── task-summaries/        ← [AI生成] 任务总览报告
│   ├── plans/                 ← [AI生成] 执行计划
│   ├── RETRO.md               ← [AI生成] 迭代复盘
│   └── PIPELINE_REPORT.md     ← [CLI生成] Pipeline 报告
├── 010-requirements/          ← [混合] 需求文档（按功能组织）
│   ├── README.md              ← [手动维护] 目录规范说明
│   ├── INDEX.md               ← [手动维护] 需求文档索引
│   ├── sources/               ← [只读] 原始 PRD（.docx/.pdf/.md）
│   ├── converted/             ← [CLI生成] doc2spec 转换后的 MD
│   ├── features/              ← [手动维护] 按功能模块组织
│   ├── prototypes/            ← [手动维护] 原型素材
│   ├── assets/                ← [混合] 素材资源
│   │   ├── extracted/         ← [CLI生成] doc2spec 提取的图片/媒体
│   │   ├── prototypes/        ← [手动维护] 产品原型
│   │   ├── designs/           ← [手动维护] UI 设计稿
│   │   └── screenshots/       ← [手动维护] 参考截图
│   └── [bugs/refactors/research/REQUIREMENT.md/CLARIFY_REPORT.md] ← [混合] 可选
├── 020-specs/                 ← [AI生成] 需求分析（analyze 输出）
│   ├── overview/              ← [AI生成] 全局规格（REQ/TECH/DEV_GUIDE）
│   ├── {功能模块}/            ← [AI生成] 按功能模块组织
│   │   └── {端名}/            ← [AI生成] 端级规格（TECH/TEST/UI_SPEC）
│   ├── requirements/          ← [AI生成] 黄金需求（clarify 输出）
│   ├── PLATFORMS.md           ← [CLI生成] 端列表
│   └── QUALITY_AUDIT.md       ← [CLI生成] 质量审计报告
├── 030-tasks/                 ← [CLI生成] 开发任务
│   └── Task-NNN-name/         ← [CLI生成] 功能模块任务
│       ├── .meta/             ← [CLI生成] 任务元信息
│       │   ├── feature        ← [CLI生成] 功能单元名
│       │   ├── type           ← [CLI生成] 任务类型
│       │   ├── status         ← [CLI生成] 状态
│       │   ├── owner          ← [CLI生成] 负责人
│       │   ├── created-at     ← [CLI生成] 创建时间
│       │   └── estimated-hours ← [AI生成] 预估工时
│       ├── _shared/           ← [AI生成] 共享契约（API_CONTRACT.yaml + CONTEXT.md）
│       ├── 00-specs/          ← [AI生成] 模块级核心规格（analyze 写入）
│       │   ├── REQ.md         ← [AI生成] 需求规格
│       │   ├── TECH.md        ← [AI生成] 技术规格
│       │   ├── SCHEMA.md      ← [AI生成] 数据模型
│       │   ├── CHANGELOG.md   ← [AI生成] 变更记录
│       │   └── CONTEXT.md     ← [AI生成] 任务上下文
│       ├── {端名}/            ← [CLI生成] 端平铺（如 booking-service / h5-mobile）
│       │   └── {子任务}/      ← [CLI生成] 执行单元
│       │       ├── .meta/     ← [CLI生成] 子任务元信息
│       │       │   ├── type/status/owner/created-at/estimated-hours/feature/git-config
│       │       ├── TASK.md    ← [AI生成] 子任务追踪
│       │       ├── TEST.md    ← [AI生成] 测试用例
│       │       ├── RISK.md    ← [AI生成] 风险评估
│       │       ├── DEPS.md    ← [AI生成] 依赖分析
│       │       ├── MONITOR.md ← [AI生成] 监控方案
│       │       ├── REVIEW.md  ← [AI生成] 评审清单
│       │       ├── DEPLOY.md  ← [AI生成] 部署清单
│       │       ├── ERROR_CODES.md     ← [AI生成] 错误码定义
│       │       ├── COMPONENT_TREE.md  ← [AI生成] 组件树（仅前端）
│       │       ├── ROUTES.md          ← [AI生成] 路由设计（仅前端）
│       │       └── STATE.md           ← [AI生成] 状态管理（仅前端）
│       └── .issues.md         ← [混合] 问题追踪
└── STAFFING.md                ← [手动维护] 人员排期
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
- **020-specs/ 必须通过 `speccore analyze --apply` 写入** — 禁止直接用 Write 工具写 020-specs/ 下的文件，CLI 会自动路由到正确子目录
- **端名必须使用 CONSTITUTION.md 标准端名** — 禁止用 `api`/`web`/`backend`/`frontend`/`admin`/`h5` 等简写或中文
- **全局分析每层完成后必须自动推进下一层** — 看到 `[SPECCORE_EXEC: speccore analyze --scope global --layer N]` 后必须立即执行，不能等待用户指令
- **Pipeline 标记必须自动执行** — 看到 `[SPECCORE_PIPELINE_NEXT]` / `[SPECCORE_EXEC]` 后必须自动执行，不要询问用户
- **质量门禁拦截后必须修复所有 error** — 不能跳过质量门禁继续推进
- **PATTERNS 只提取真正独特且可复用的模式** — 严禁为每个项目都生成 JWT/Redis/拦截器等框架自带的标准用法说明
- **多任务执行用批次** — `speccore execute --list-pending --batch-size 3` 获取清单，每批完成后开新对话续跑
- **失败时读取 .issues.md 并按流程处理** — 读取问题清单 → 分析根因 → 修复 → 更新 .issues.md 状态 → 重新执行

## 常用命令速查
```bash
speccore status                          # 当前迭代状态面板
speccore analyze -I <迭代名> --auto      # 全量分析
speccore split -I <迭代名>               # 自动拆分任务
speccore execute -i <迭代名> --all       # 执行所有任务
```

## 全局分析质量规范（v8.3.62+）

> 以下规范为框架级约束，具体执行要求见 analyze 命令 Prompt。

### 分层执行原则
- **全局分析必须按 4 层递进执行**，禁止跳过任何一层
- 每层完成后**必须自检**，不通过需补全后再进入下一层
- Layer 4 拆分为 4a(产品文档) → 4b(技术核心) → 4c(技术扩展) → 4d(各端技术) 子步骤执行

### 产出目录结构与文档清单

全局分析产出位于 `.speccore/GLOBAL/`，必须生成以下文档：

```
.speccore/GLOBAL/
├── platforms/                          ← Layer 1/2/3/4d
│   ├── {端名}/
│   │   ├── _INDEX.md                   ← Layer 1: 端索引（≥80行）
│   │   ├── modules/
│   │   │   └── *.md                    ← Layer 3: 功能模块深入文档
│   │   └── [Layer 4d 各端技术文档]
│   └── _shared/
│       ├── _ASSOCIATION.md             ← Layer 2: 跨端关联（≥100行）
│       └── _MODULES.md                 ← Layer 2: 功能模块清单（≥50行）
├── requirements/                       ← Layer 4a
│   ├── REQUIREMENT.md                  ← 全局需求总纲（≥500行）
│   └── {前端端名}/
│       └── REQUIREMENT.md              ← 各端产品视角需求（≥500行）
├── overview/                           ← Layer 4b/4c
│   ├── ARCHITECTURE.md                 ← 4b: 系统架构（≥200行）
│   ├── FUNCTION_MAP.md                 ← 4b: 功能映射（≥50行）
│   ├── API_CONTRACT.yaml               ← 4b: 接口契约
│   ├── INTERACTION_MAP.md              ← 4b: 交互时序（≥50行）
│   ├── SECURITY_AUDIT.md               ← 4c: 安全审计（≥80行）
│   ├── PERFORMANCE_BASELINE.md         ← 4c: 性能基线（≥80行）
│   ├── DATA_FLOW.md                    ← 4c: 数据流转（≥150行）
│   ├── DEPLOYMENT.md                   ← 4c: 部署架构（≥100行）
│   └── CONSISTENCY_CHECK.md            ← 4c: 一致性检查（≥50行）
└── PATTERNS/                           ← 可选: 真正独特且可复用的设计模式
    └── {端名}/
        └── {kebab-case模式名}.md
```

**Layer 4d 各端技术文档**（按端类型区分）：
- **后端端**（匹配 `service|server|api|backend`）:
  - `API_INVENTORY.md`（≥150行）
  - `DATA_MODEL.md`（≥100行）
  - `BUSINESS_RULES.md`
- **前端端**（所有非后端端）:
  - `UI_FLOW.md`（≥100行）
  - `API_CALL_MAP.md`（≥80行）
  - `STATE_MANAGEMENT.md`（≥80行）

### 产出文件最小内容标准
- **所有 Markdown 产出文件必须达到最小行数要求**，严禁生成空壳/占位文档
- **所有技术文档必须包含 Mermaid 图表**，图表语法必须正确可渲染
- **需求文档必须按端类型差异化撰写**，严禁一套模板改端名复用
- **多端项目必须标注功能一致性要求和差异化策略**

### 质量自检要求
- 每层分析完成后，AI 必须执行自检 Checklist
- 自检不通过时，必须补充完善后再提交
- CLI 执行后置校验：文件存在性、行数达标、章节完整

### 质量门禁拦截（v8.3.62+）
- **全局分析 `--apply` 写入后，CLI 自动运行质量门禁**
- **存在严重错误（error）时，自动拦截并输出修复 Prompt**，禁止进入下一层
- **AI 必须修复所有 error 后才能继续**，不能跳过
- 修复方式：读取问题文档 → 补充内容 → `speccore analyze --apply '{"文件路径":"修正内容"}' --scope global` 重新写入

## 迭代层分析强制约束

### 产出目录结构与文档清单

迭代层分析产出位于 `Iteration-NNN/020-specs/` 和 `Task-NNN/00-specs/`，必须生成以下文档：

```
Iteration-NNN/020-specs/
├── overview/                          ← [AI生成] 迭代级全局规格
│   ├── REQUIREMENT.md                 ← 迭代专属需求
│   ├── ANALYSIS.md                    ← 综合分析
│   ├── TECH.md                        ← 技术规格
│   ├── DEV_GUIDE.md                   ← 开发指南
│   └── DEPS.md                        ← 依赖分析
├── {功能模块}/                        ← [AI生成] 按功能模块组织
│   └── {端名}/                        ← [AI生成] 端级规格
│       ├── TECH.md                    ← 技术规格
│       ├── TEST.md                    ← 测试用例
│       ├── UI_SPEC.md                 ← UI 规格（仅前端）
│       └── DEV_GUIDE.md               ← 开发指南
└── requirements/                      ← [AI生成] 黄金需求（clarify 输出）
    └── *.md

Task-NNN/00-specs/                     ← [AI生成] 模块级核心规格
├── REQ.md                             ← 需求规格
├── TECH.md                            ← 技术规格
├── SCHEMA.md                          ← 数据模型（条件创建）
├── CHANGELOG.md                       ← 变更记录
└── CONTEXT.md                         ← 任务上下文
```

### 产出文档完整性
- **每端必须输出 4 份文档**：`TECH.md` + `TEST.md` + `UI_SPEC.md` + `DEV_GUIDE.md`，缺一不可
- **禁止输出空表格** — 每个 Markdown 表格必须有至少 1 行数据，只有表头的表格视为未完成
- **禁止输出占位符** — 不允许写「待填充」、「TODO」、「...」、「xxx」等占位内容
- **自检规则**：生成完成后检查每个文档，如果仍含 `<!-- SPEC-SKELETON -->` 或空表格只有表头 → 必须重新填充

### DEV_GUIDE.md 最低标准
- 改造范围表格 ≥ 3 行（具体到文件/目录路径）
- 实施步骤 ≥ 3 步（按依赖排序，具体到文件/函数级）
- 验证方式表格 ≥ 3 行（可执行的命令/操作 + 通过标准）
- 坑点 ≥ 2 条

### 其他文档要求
- **MONITOR.md**：必须按 Fatal/Critical/Warning/Info 四级定义告警规则，不能只列指标名称
- **REVIEW.md**：安全检查必须逐接口列出鉴权需求，不能笼统写"需要鉴权"

## 执行阶段强制约束

### 执行前必读清单
- **必须阅读子任务 TASK.md** — 了解任务范围和状态
- **必须阅读 00-specs/REQ.md** — 理解需求和验收标准
- **必须阅读 00-specs/TECH.md** — 理解技术方案
- **如涉及 API 变更，确保前后端接口签名一致**

### 代码实现规范
- **代码实现严格遵循 REQ.md 的验收标准和 TECH.md 的技术方案**
- **禁止偏离 REQ.md/TECH.md 的要求自由发挥**
- **禁止生成与规格文档不一致的代码**
- **禁止遗漏 REQ.md 中列出的验收标准**

### 任务完成规范
- **完成后更新 TASK.md 状态**（doing → done）
- **代码写到 CONSTITUTION.md / PROJECT.yaml 指定的源码路径**，禁止写入迭代目录

## 任务拆分强制约束

### 拆分粒度控制
- **单次迭代总功能模块数上限 20 个** — 超出必须合并（功能模块 = Task 目录，不是子任务）
- **每个功能模块按涉及的端自动拆分子任务**，每个端默认只创建一个子任务
- **子任务是最终执行单元**（`Task-NNN/{端名}/Task-NNN-{端名}/`），超出默认子任务需用户手动创建
- **禁止跳过任何功能模块** — 即使信息不足，也必须基于已有信息拆分并填充内容

### 字段完整性
- **禁止输出空内容** — `reqContent`、`techContent`、`devGuideContent` 每个字段长度必须 ≥ 200 字符
- **禁止省略字段** — JSON 中必须包含 `reqContent`、`techContent`、`devGuideContent` 三个字段
- **topic 必须是英文短横线格式** — 如 `user-authentication`，用于生成任务目录名
- **scope 必须使用标准端名** — 决定子任务按哪些端创建，端名错误会导致子任务目录错误
- **内容必须从 analyze 产物提取** — `reqContent` 从 `REQUIREMENT.md`，`techContent` 从 `TECH.md`，`devGuideContent` 从 `DEV_GUIDE.md`

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
