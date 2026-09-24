# AGENTS.md — SpecCore 项目规则

> 本文档供 AI 编码工具自动读取（Cursor / Copilot / Windsurf / Codex / Claude Code）。
> 工具会读取此文档理解项目规则，不需要用户重复解释。

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
- **业务规则**：如存在 `.speccore/GLOBAL/BUSINESS_RULES/` 目录，执行 analyze/execute 前需读取其中规则文件（`01-common.md` 通用规则 + `{工程标识}.md` 端级规则，文件名必须与 CONSTITUTION.md 端列表中的工程标识完全一致）

## 规范数据库四层覆盖架构（v8.3.134+）

`.speccore/` 下的知识资产按四层架构确保 AI 可见性，每层解决不同场景：

| 层级 | 机制 | 覆盖目录 | 解决什么问题 |
|:---|:---|:---|:---|
| **L1 TOC 目录** | `buildGlobalTOC` 扫描所有 `.md` 文件，生成带摘要/标签/章节的目录 | GLOBAL/、PATTERNS/、RULES/、SKILLS/ | AI **知道有这些文件**，按需 Read |
| **L2 自动注入** | `loadGlobalContext` 将关键文件全文注入 Prompt | BUSINESS_RULES/（4000 字符/文件）、RULES/（2000 字符/文件，按 priority 排序，总量 ≤8000） | **关键规则必达**，不依赖 AI 主动 Read |
| **L3 RAG 语义检索** | `indexDirectoryDocuments` 索引所有 `.md`，支持语义召回 | GLOBAL/ + RULES/ + SKILLS/ + PATTERNS/ | AI **忘了文件名也能通过语义找到** |
| **L4 阅读清单** | Prompt 中附带"何时该读什么"指引 | 全量 | 告诉 AI **什么场景下该读哪个目录** |

### 阅读清单（何时该读什么）

| 场景 | 推荐读取 | 原因 |
|:---|:---|:---|
| **编写代码前** | `RULES/` 中 `appliesTo` 匹配当前技术栈的规则 | 确保代码符合项目规范 |
| **设计 API/数据库** | `RULES/api-design.md` + `RULES/database.md` | 统一接口格式和表设计 |
| **实现复杂功能** | `SKILLS/` 中 tags 匹配当前场景的技能文档 | 参考最佳实践，避免踩坑 |
| **全局分析阶段** | `PATTERNS/` 中通用分类 + 当前端专属模式 | 复用已沉淀的架构模式 |
| **排查性能问题** | `SKILLS/caching.md` + `PATTERNS/performance/` | 缓存策略和性能优化模式 |
| **代码审查前** | `RULES/CODE_REVIEW.md` | 对照检查清单逐项核对 |

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

## 功能单元目录对齐（切分层 ↔ 分析层）

`unitize`（切需求，原 doc2spec --split）切分出的功能单元目录名，是 `analyze` 分析产物的**对齐锚点**，两者必须一致：

| 层 | 目录 | 产出 |
|:---|:---|:---|
| 切分层 | `010-requirements/features/{功能单元}/` | SOURCE.md（需求原文切片，旧版为 README.md） + _matrix.md + CHANGELOG.md（doc2spec 产出） |

> **功能单元命名（v8.3.271+）**：目录名 = `{文档/端}-{序号}-{英文slug}`（中文标题转全拼，如 `admin-web-01-yudingguanli`）；中文显示名保留在 SOURCE.md 标题与 `_matrix.md` 的 `feature` 字段。旧迭代中文目录名兼容不迁移。
| 分析层 | `020-specs/{功能单元}/` | overview/（单元概述）+ {端名}/（TECH/TEST/UI_SPEC） |
| 全局层 | `010-requirements/overview/GLOBAL_CONTEXT-*.md` + `020-specs/overview/` | 非功能全局信息 + FUNCTION_MAP/REQUIREMENT 汇总 |

- **禁止**把 `overview/GLOBAL_CONTEXT-*.md`、`features/{单元}/_matrix.md` 当成功能单元（它们是全局信息/元数据，不是功能单元）。
- **分析产物必须落盘**：`analyze` 后 020-specs 下不得残留 `<!-- SPEC-SKELETON -->` 空模板，否则 taskify/execute 拿空需求会瞎编代码。

## 核心工作方式

- **所有确定性操作通过 `speccore` CLI 完成**（创建目录、读写文件、校验格式）。AI 识别意图后，经 `speccore ask` 引擎自动执行，或看到 `[SPECCORE_EXEC: <cmd>]` 标记时直接 `execute_command`，不要自行用 Write/SearchReplace 改 Spec 文件。
- **代码生成通过宿主 AI 完成**，CLI 负责准备 Spec 上下文和写入文件。
- **代码写到 CONSTITUTION.md / PROJECT.yaml 指定的源码路径**，不要写到迭代目录里。

## ⛔ 核心禁令

1. **禁止自己创建迭代目录** — 用 `speccore iteration create`（通常迭代已存在）
2. **禁止写脚本绕过 CLI** — 不要写 build-xxx.js / run-xxx.py 等脚本
3. **禁止在任务目录（Task-*/）下创建 10-backend/ 20-frontend/ 分类层** — 任务目录是端平铺结构，端直接平铺在 Task 下
4. **禁止把代码写到迭代目录内** — 代码写到 CONSTITUTION.md / PROJECT.yaml 中各工程的「源码路径」
5. **禁止在分析阶段打开浏览器、模拟用户操作或访问 URL** — 所有分析基于直接 Read 源码和结构化数据
6. **禁止直接用 Write 工具写 020-specs/ 或 .speccore/GLOBAL/ 下的文件** — 必须通过 `speccore analyze --apply` 写入，CLI 自动路由到正确子目录
7. **不要自己解析需求** — 用 `speccore analyze`
8. **端名必须使用 CONSTITUTION.md 标准端名** — 禁止用 `api`/`web`/`backend`/`frontend`/`admin`/`h5` 等简写或中文
9. **全局分析每层完成后必须自动推进下一层** — 看到 `[SPECCORE_EXEC: speccore analyze --scope global --layer N]` 后必须立即执行，不能等待用户指令
10. **步骤隔离模式** — v8.3.160+ 默认步骤隔离，每步完成后输出 `[SPECCORE_STEP_DONE]` + `[SPECCORE_NEXT_STEP]`，新会话通过 `--resume` 继续。看到 `[SPECCORE_EXEC]` 后自动执行
11. **质量门禁拦截后必须修复所有 error** — 不能跳过质量门禁继续推进
12. **PATTERNS 只提取真正独特且可复用的模式** — 严禁为每个项目都生成 JWT/Redis/拦截器等框架自带的标准用法说明
13. **多任务执行用批次** — `speccore execute --list-pending --batch-size 3` 获取清单，每批完成后优先在同一会话继续下一批（CLI 会输出 `[SPECCORE_CONTINUE]` 与下一任务命令）；仅当上下文紧张时开新对话，先读摘要文件再续跑
14. **失败时读取 .issues.md 并按流程处理** — 读取问题清单 → 分析根因 → 修复 → 更新 .issues.md 状态 → 重新执行
15. **续跑用 --resume** — `speccore execute --resume`
16. **配置变更用 --upgrade** — `speccore config --upgrade`（`.speccore.yml` / `PROJECT.yaml` 结构升级）
17. **禁止 AI 直接修改配置文件** — `.speccore.yml`、`.speccore/CONSTITUTION.md`、`.speccore/PROJECT.yaml` 等配置必须通过 `speccore config --upgrade` 修改，禁止用 Write/SearchReplace 工具直接编辑（防止 schema_version 等关键字段被破坏）
18. **禁止单会话内连续执行多步骤** — analyze → apply → analyze → taskify → execute 等 Pipeline 步骤必须分会话执行，每步完成后输出 `[SPECCORE_STEP_DONE]`，新会话读取 context snapshot 后 `--resume` 继续。严禁在单会话内循环执行多个 CLI 命令

## 详细规范索引

以下详细规范已从 AGENTS.md 迁移到 `.speccore/RULES/` 目录，执行对应阶段前请读取：

| 规范 | 文件路径 | 适用阶段 |
|:---|:---|:---|
| **全局分析质量规范** | `.speccore/RULES/ANALYSIS_QUALITY.md` | `speccore analyze --scope global` |
| **迭代层分析强制约束** | `.speccore/RULES/ITERATION_QUALITY.md` | `speccore analyze -I <迭代名>` |
| **执行阶段强制约束** | `.speccore/RULES/EXECUTION.md` | `speccore execute` |
| **任务拆分强制约束** | `.speccore/RULES/TASK_SPLIT.md` | `speccore taskify` |

> **Agent 角色执行前，必须先读取 `.speccore/RULES/` 中 `appliesTo` 匹配当前技术栈的规则，将技术栈专属检查项叠加到通用清单中。** 完整阶段-角色映射见 `.speccore/AGENTS/_INDEX.md`。

<!-- SPECCORE_AUTO_INDEX_START -->
> 以下内容由 `.speccore/` 规范数据库自动生成，请勿手动编辑此区域

## 角色与职责

| 角色 | 职责 |
| :--- | :--- |
| [`code-generator`](.speccore/AGENTS/code-generator.md) 代码生成专家 | 根据 TASK.md 和技术规格，生成符合项目规范的代码实现；遵循 CONSTITUTION.md 的命名规范、端名标准和错误码体系 |
| [`code-reviewer`](.speccore/AGENTS/code-reviewer.md) 代码审查员 | 审查代码质量、可读性、可维护性；检查是否符合项目编码规范 |
| [`compiler`](.speccore/AGENTS/compiler.md) 构建质量检查员 | 检查代码编译可行性；识别语法错误和类型错误 |
| [`compliance-checker`](.speccore/AGENTS/compliance-checker.md) 合规审查员 | 审查项目是否符合行业合规要求；识别合规风险和缺失项 |
| [`dependency-analyst`](.speccore/AGENTS/dependency-analyst.md) 依赖关系分析师 | 识别任务间的依赖关系（数据依赖、接口依赖、时序依赖）；构建任务依赖图，发现循环依赖 |
| [`doc-sync-agent`](.speccore/AGENTS/doc-sync-agent.md) 文档同步检查员 | 检查代码与文档的一致性；确保 API 文档与实际接口匹配 |
| [`effort-estimator`](.speccore/AGENTS/effort-estimator.md) 工时估算专家 | 根据任务复杂度和历史数据估算工时；考虑技术难度、依赖关系、风险因素 |
| [`global-analyzer`](.speccore/AGENTS/global-analyzer.md) 全局分析专家 | 分析跨迭代的依赖关系和架构一致性；识别全局技术债务和重复实现 |
| [`impact-analyst`](.speccore/AGENTS/impact-analyst.md) 影响范围分析师 | 分析变更对现有代码、文档、测试的影响范围；识别需要同步修改的关联模块 |
| [`interaction-designer`](.speccore/AGENTS/interaction-designer.md) 交互设计师 | 设计清晰直观的页面信息架构；定义完整的交互状态和状态流转 |
| [`performance-expert`](.speccore/AGENTS/performance-expert.md) 性能专家 | 检查代码性能瓶颈；识别 N+1 查询、内存泄漏、不必要的重渲染 |
| [`product-analyst-backend`](.speccore/AGENTS/product-analyst-backend.md) 后端产品分析师 | 以资深后端产品经理视角深度分析后端需求文档；关注数据一致性、幂等性、事务边界、API 版本 |
| [`product-analyst-frontend`](.speccore/AGENTS/product-analyst-frontend.md) 前端产品分析师 | 以资深前端产品经理视角深度分析前端需求文档；关注状态管理、路由守卫、组件复用、响应式断点 |
| [`product-analyst`](.speccore/AGENTS/product-analyst.md) 产品分析师 | 业务流程完整性审查；需求遗漏识别 |
| [`regression-tester`](.speccore/AGENTS/regression-tester.md) 回归测试专家 | 评估变更对现有功能的影响；制定回归测试计划 |
| [`requirement-analyzer`](.speccore/AGENTS/requirement-analyzer.md) 需求分析专家 | 根据需求文档和跨端契约，为指定端生成完整技术规格；设计 API 接口、数据模型、业务规则 |
| [`risk-assessor`](.speccore/AGENTS/risk-assessor.md) 风险评估师 | 识别开发计划中的技术风险和进度风险；评估风险影响程度和发生概率 |
| [`schedule-planner`](.speccore/AGENTS/schedule-planner.md) 排期规划师 | 根据任务依赖关系和工时估算制定开发计划；识别并行开发机会，缩短总工期 |
| [`security-reviewer-finance`](.speccore/AGENTS/security-reviewer-finance.md) 金融安全审查员 | 金融行业专项安全审查；PCI-DSS、等保三级、央行支付安全规范合规检查 |
| [`security-reviewer`](.speccore/AGENTS/security-reviewer.md) 非功能质量检查员 | 识别需求/代码中的安全风险；检查认证、授权、输入验证、数据保护 |
| [`task-decomposer`](.speccore/AGENTS/task-decomposer.md) 任务拆分专家 | 将功能模块拆分为原子级开发任务；确保每个任务可独立执行、可验收 |
| [`test-engineer`](.speccore/AGENTS/test-engineer.md) 测试工程师 | 执行单元测试和集成测试；检查测试覆盖率 |
| [`test-reviewer`](.speccore/AGENTS/test-reviewer.md) 测试审查员 | 审查测试用例的完整性和有效性；检查测试覆盖率 |


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
│   │       ├── SOURCE.md      ← [自动生成] 需求原文切片（旧版为 README.md）
│   │       ├── _matrix.md     ← [自动生成] 端覆盖矩阵（platforms/dependencies/apis）
│   │       └── CHANGELOG.md   ← [自动生成] 单元变更记录
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
| `[SPECCORE_CONTINUE: <path>]` | 批次执行完成，需续批 | **优先在同一会话继续**（按标记中的命令执行下一批）；上下文紧张时开新对话，先读取 `<path>` 恢复上下文再续批 |

## 常用命令速查

```bash
speccore status                          # 当前迭代状态面板
speccore analyze --scope global --layer 1-4 # 全局层源码分析（四层推进，产物 .speccore/GLOBAL/）
speccore global from-source --src <dirs> # 全局层源码反推需求文档
speccore unitize --file <md路径> --iter <迭代名>   # 切分需求文档 → 功能单元（features/）
speccore unitize --on-duplicate overwrite ...      # 同名单元三选一（skip/overwrite 备份可回滚/rename/abort）
speccore analyze -I <迭代名> --auto      # 迭代层全量分析（产物 020-specs/）
speccore taskify -i <迭代名>             # 拆功能单元 → 开发任务（v8.3.231+ 替代 split）
speccore taskify -i <迭代名> --modules "模块A"   # 只重建指定模块（旧任务自动备份 .backup-*，其余保留）
speccore execute -i <迭代名> --all       # 执行所有任务
speccore verify                          # 测试验证（冒烟/回归）
speccore pr                              # 代码提交 + 创建 Pull Request
```

### 更多规范
- [ANALYSIS QUALITY](.speccore/RULES/ANALYSIS_QUALITY.md)
- [CODE REVIEW](.speccore/RULES/CODE_REVIEW.md)
- [EXECUTION](.speccore/RULES/EXECUTION.md)
- [ITERATION QUALITY](.speccore/RULES/ITERATION_QUALITY.md)
- [POST COMPLETION](.speccore/RULES/POST_COMPLETION.md)
- [TASK SPLIT](.speccore/RULES/TASK_SPLIT.md)
- [api design](.speccore/RULES/api-design.md)
- [database](.speccore/RULES/database.md)
- [frontend common](.speccore/RULES/frontend-common.md)
- [nodejs](.speccore/RULES/nodejs.md)
- [react](.speccore/RULES/react.md)
- [security](.speccore/RULES/security.md)
- [testing](.speccore/RULES/testing.md)
- [typescript](.speccore/RULES/typescript.md)

## 核心约束

- 不要自己创建目录 — 使用 `speccore` CLI
- 不要写脚本绕过 CLI — 所有操作通过 `speccore` 命令完成
- 代码写到 CONSTITUTION.md 指定的源码路径，不写到迭代目录内
- 迭代内写 Spec，迭代外写代码

<!-- SPECCORE_AUTO_INDEX_END -->
