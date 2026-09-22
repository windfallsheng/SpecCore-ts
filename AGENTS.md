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
| **产出内容** | 跨迭代复用的全局资产（端索引、跨端关联、全局架构、各端技术文档：`platforms/{端}/API_INVENTORY.md` 接口清单 / DATA_MODEL / OVERVIEW / TECH） | 当前迭代专属的分析文档（任务级规格、UI设计、测试用例） |
| **分层** | Layer 1→2→3→4（4a/4b/4c/4d 子层） | Phase 1（综合文档）→ Phase 2（各端专属） |
| **何时执行** | 项目首次接入 / 新增端 / 全局架构变更 | 每个迭代的需求分析阶段 |

**绝对禁止混淆**：
- 全局分析的 `requirements/REQUIREMENT.md`（全局需求总纲）**不等于**迭代层的 `020-specs/overview/REQUIREMENT.md`（迭代专属需求）
- 全局分析的 `platforms/{端}/`（端级技术资产）**不等于**迭代层的 `{端}/`（任务级实现规格）
- 补充全局需求文档时**必须**使用 `--scope global`，不能用迭代层命令替代

## 核心工作方式

- **所有确定性操作通过 `speccore` CLI 完成**（创建目录、读写文件、校验格式）。AI 识别意图后，经 `speccore ask` 引擎自动执行，或看到 `[SPECCORE_EXEC: <cmd>]` 标记时直接 `execute_command`，不要自行用 Write/SearchReplace 改 Spec 文件。
- **代码生成通过宿主 AI 完成**，CLI 负责准备 Spec 上下文和写入文件。
- **代码写到 CONSTITUTION.md / PROJECT.yaml 指定的源码路径**，不要写到迭代目录里。

## 功能单元目录对齐（切分层 ↔ 分析层）

`unitize`（切需求，原 doc2spec --split）切分出的功能单元目录名，是 `analyze` 分析产物的**对齐锚点**，两者必须一致：

| 层 | 目录 | 产出 |
|:---|:---|:---|
| 切分层 | `010-requirements/features/{功能单元}/` | SOURCE.md（需求原文切片，旧版为 README.md） + _matrix.md + CHANGELOG.md（doc2spec 产出） |
| 分析层 | `020-specs/{功能单元}/` | overview/（单元概述）+ {端名}/（TECH/TEST/UI_SPEC） |
| 全局层 | `010-requirements/overview/GLOBAL_CONTEXT-*.md` + `020-specs/overview/` | 非功能全局信息 + FUNCTION_MAP/REQUIREMENT 汇总 |

- **禁止**把 `overview/GLOBAL_CONTEXT-*.md`、`features/{单元}/_matrix.md` 当成功能单元（它们是全局信息/元数据，不是功能单元）。
- **分析产物必须落盘**：`analyze` 后 020-specs 下不得残留 `<!-- SPEC-SKELETON -->` 空模板，否则 taskify/execute 拿空需求会瞎编代码。

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
13. **多任务执行用批次** — `speccore execute --list-pending --batch-size 3` 获取清单，每批完成后开新对话续跑
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
| **任务拆分强制约束** | `.speccore/RULES/TASK_SPLIT.md` | `speccore iteration taskify` |

> **Agent 角色执行前，必须先读取 `.speccore/RULES/` 中 `appliesTo` 匹配当前技术栈的规则，将技术栈专属检查项叠加到通用清单中。** 完整阶段-角色映射见 `.speccore/AGENTS/_INDEX.md`。

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
├── 000-overview/              ← 进度总览（PROJECT_GRAPH / plans / RETRO / PIPELINE_REPORT）
├── 010-requirements/          ← 需求层
│   ├── sources/ converted/    ← [只读] 原始 PRD / doc2spec 转换
│   ├── features/{功能单元}/   ← unitize 切分产出（功能单元目录 = analyze 对齐锚点）
│   ├── bugs/ refactors/ research/  ← 三类需求文档（与任务类型对应）
│   └── CLARIFY_REPORT.md      ← 澄清报告
├── 020-specs/                 ← 需求分析（analyze 输出）
│   ├── overview/              ← [索引类] 功能间关系（FUNCTION_MAP/INTERACTION_MAP/PLATFORMS/DEPENDENCY_MAP/CLARIFY/API_CONTRACT.yaml）
│   ├── {功能模块}/
│   │   ├── overview/          ← [内容类] 功能内部细节（REQUIREMENT/ANALYSIS/INTERACTION/CLARIFY/TECH/RISK/DEPS/MONITOR/BUSINESS_RULES）
│   │   └── {端名}/            ← 端级规格（TECH/TEST/UI_SPEC/DEV_GUIDE）
│   ├── requirements/          ← 黄金需求（clarify 输出，analyze 读取）
│   └── QUALITY_AUDIT.md       ← 质量审计报告
├── 030-tasks/                 ← 开发任务（taskify 输出）
│   └── {类型}/Task-*/         ← 按类型分子目录（feature/bugfix/refactor/research）
│       ├── .meta/             ← 任务元信息（feature/type/status/owner/工时）
│       ├── _shared/           ← 共享契约（API_CONTRACT.yaml + CONTEXT.md）
│       ├── 00-specs/          ← 任务级核心规格（REQ/TECH/DEV_GUIDE，SCHEMA 条件创建）
│       ├── {端名}/{子任务}/   ← 端平铺执行单元（TASK/REQ/TECH 骨架/TEST/REVIEW/ERROR_CODES 等，按类型裁剪；
│       │                         前端多 COMPONENT_TREE/ROUTES/STATE/STYLE_GUIDE/VERIFY_SPEC）
│       └── .issues.md         ← 问题追踪
│   （research 类型为独立结构：RESEARCH.md + COMPARISON.md，无端平铺）
└── STAFFING.md                ← 人员排期
```

> **组织原则**：索引类放 overview（有哪些）、内容类放 {功能模块}/overview（是什么）、端级放 {端}/（怎么做）。
> **⚠️ 代码写入 CONSTITUTION.md/PROJECT.yaml 声明的「源码路径」，禁止写入迭代目录**；子任务目录只存放规格文档。
> 本结构图为快照：实际目录以 CLI 生成为准（speccore taskify/analyze）；子任务文档的完整清单见各子任务 TASK.md 的「产出物」表。

## SpecCore 输出标记

当执行 `speccore ask` 或 `speccore about` 时，会输出以下标记，按优先级处理：

| 标记 | 含义 | 动作 |
|:---|:---|:---|
| `[SPECCORE_ONBOARD: <path>]` | 首次/升级引导页 | **最先处理**，用 present_files 展示 HTML |
| `[SPECCORE_WELCOME: <path>]` | 项目欢迎页 | 用 present_files 展示欢迎页 HTML（`/spec-welcome` 触发） |
| `[SPECCORE_SETUP_GUIDE: <path>]` | 项目配置引导页 | init 后用 present_files 展示，指导用户配置 |
| `[SPECCORE_ABOUT: <path>]` | 版本信息页 | 用 present_files 展示 |
| `[SPECCORE_DASHBOARD: <path>]` | 项目/迭代仪表盘 | 用 present_files 展示仪表盘 HTML |
| `[SPECCORE_RETRO: <path>]` | 迭代复盘报告 | 用 present_files 展示复盘报告 HTML |
| `[SPECCORE_DEV: <path>]` | dev 级联引导页 | 用 present_files 展示 dev 引导页 HTML |
| `[SPECCORE_HELP: <path>]` | 帮助页 | 用 present_files 展示帮助页 HTML |
| `[SPECCORE_PLAN: <path>]` | 计划可视化 | 用 present_files 展示计划可视化 HTML |
| `[SPECCORE_PROMPTS: <path>]` | 提示词库 | 用 present_files 展示提示词库 HTML |
| `[SPECCORE_MODE: <mode>]` | 意图模式 | 识别模式后进入对应流程 |
| `[SPECCORE_EXEC: <cmd>]` | 自动执行命令 | 直接 execute_command |
| `[SPECCORE_INTENT]` | 意图确认块 | 展示给用户确认 |
| `[SPECCORE_PROMPT]` | AI Prompt 块 | 将后续内容作为 Prompt 传给宿主 AI |
| `[SPECCORE_STEP_DONE]` | 步骤完成 | 当前步骤已完成，需新会话继续 |
| `[SPECCORE_NEXT_STEP]` | 下一步指令 | 提示下一步骤和继续命令 |
| `[SPECCORE_SESSION_AGENT]` | 子 Agent 激活 | v8.3.160+: 指定当前步骤的子 Agent 角色和上下文预算 |
| `[SPECCORE_CONTEXT_SNAPSHOT]` | 上下文快照 | 紧凑上下文，供新会话恢复 |
| `[SPECCORE_PIPELINE_NEXT]` | Pipeline 下一步 | ⚠️ 已弃用（v8.3.160+ 使用 STEP_DONE） |
| `[SPECCORE_TASK_SUMMARY]` | 任务总览报告 | 展示任务拆分/执行后的总览报告 |
| `[SPECCORE_NEXT_STEPS]` | 下一步操作 | 展示建议的后续操作步骤 |
| `[SPECCORE_GUIDE]` | 分析指南 | 展示分析阶段的引导指南 |
| `[SPECCORE_CONFIRM_NEEDED]` | 需要确认 | 展示需要用户确认的信息 |
| `[SPECCORE_RESULT]` | 执行结果 | 展示命令执行的结果数据 |
| `[SPECCORE_PHASE1]` / `[SPECCORE_PHASE2]` | 综合文档阶段 | synthesize 的 Phase 1/2 Prompt |
| `[SPECCORE_AI_CONTEXT]` | AI 上下文 | 传递给宿主 AI 的上下文信息 |
| `[SPECCORE_CONTINUE: <path>]` | 批次执行完成，需续批 | **必须开始新对话**，先读取 `<path>` 恢复上下文，再按提示命令继续下一批次 |

## 常用命令速查

```bash
speccore status                          # 当前迭代状态面板
speccore unitize --file <md路径> --iter <迭代名>   # 切分需求文档 → 功能单元（features/）
speccore analyze -I <迭代名> --auto      # 全量分析
speccore taskify -I <迭代名>             # 拆功能单元 → 开发任务（原 split，v8.3.231+ 正名）
speccore execute -i <迭代名> --all       # 执行所有任务
speccore verify                          # 测试验证（冒烟/回归）
speccore pr                              # 代码提交 + 创建 Pull Request
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

## Agent 角色定义（v8.3.160+）

> 唯一权威来源：`.speccore/AGENTS/_INDEX.md`（注册表）+ `.speccore/AGENTS/*.md`（角色定义）。
> 新增角色后，在 _INDEX.md 添加一行即可挂载到对应流程。

### 流程 × 角色映射（实际激活）

| 流程 | 步骤 | 激活角色 |
| :--- | :--- | :--- |
| clarify / analyze | Phase 0 澄清三连 | `product-analyst` → `interaction-designer` → `security-reviewer`（securityLevel > 2 时） |
| analyze | Phase 1 全局索引 / 功能模块分批 | `requirement-analyzer` |
| analyze | Phase 2 逐端分析 | `requirement-analyzer`（端级动态名 `requirement-analyzer-{端名}`，⚠️ AGENTS/ 暂无独立角色文件，Qoder 适配层归一化兜底到基础角色） |
| analyze | 契约先行 | `requirement-analyzer` |
| taskify | 拆分全流程 | `task-decomposer` + `dependency-analyst` + `effort-estimator` |
| plan | 排期规划 | `schedule-planner`（+ `risk-assessor`） |
| execute | 代码生成 | `code-generator` |
| execute | 质量门禁三步 | `compiler`（兼测试）→ `security-reviewer`（兼性能）→ `doc-sync-agent` |
| change | 影响分析 | `impact-analyst` + `regression-tester` |
| pr | 代码审查 | `code-reviewer` + `test-reviewer`（+ `security-reviewer`） |
| global-analyze | 全局分析全流程 | `global-analyzer` |

### 全部角色清单

`.speccore/AGENTS/` 下共 23 个角色文件：

`product-analyst`、`product-analyst-backend`、`product-analyst-frontend`、`interaction-designer`、`security-reviewer`、`security-reviewer-finance`、`requirement-analyzer`、`task-decomposer`、`dependency-analyst`、`effort-estimator`、`schedule-planner`、`risk-assessor`、`code-generator`、`compiler`、`test-engineer`、`doc-sync-agent`、`code-reviewer`、`test-reviewer`、`impact-analyst`、`regression-tester`、`global-analyzer`、`compliance-checker`、`performance-expert`

### 所有 Agent 共用的核心约束

- 不要自己创建目录 — 使用 `speccore` CLI
- 不要写脚本绕过 CLI — 所有操作通过 `speccore` 命令完成
- 代码写到 CONSTITUTION.md 指定的源码路径，不写到迭代目录内
- 迭代内写 Spec，迭代外写代码


<!-- SPECCORE_AUTO_INDEX_END -->
