## v6.92.0 (2026-08-20) — 稳定性：测试覆盖 + Doctor 诊断

### 新增

- **项目健康度诊断命令** `speccore doctor`
  - 检查 `.speccore/` 核心目录结构完整性
  - 检查 `CONSTITUTION.md` 格式（端列表、技术栈章节）
  - 检查 `local/context.json` 有效性和当前迭代设置
  - 检查规范数据库五层（AGENTS/RULES/COMMANDS/SKILLS/HOOKS）初始化状态
  - 检查 `graph.json` 时效性（对比源码修改时间）
  - 检查迭代目录健康度（是否存在 030-tasks/）
  - 检查 PATTERNS/README.md 置信度规范
  - 汇总输出：通过/待修复项，附带修复建议

- **code-graph/ 模块单元测试**
  - `builder.test.ts`: 7 个测试用例（元数据、度数、God nodes、裸名修复、社区检测、空图、孤立节点）
  - `query.test.ts`: 11 个测试用例（explainNode、findPath BFS、queryGraph 关键词匹配）
  - `reporter.test.ts`: 6 个测试用例（报告头、元数据、God nodes、社区、桥梁、建议问题）

### 工程

- `package.json` 添加 `vitest` 为 devDependency

---

## v6.91.2 (2026-08-20) — 文档同步与架构设计补充

### 文档

- **README.md**
  - 版本号同步：v6.71.3 → v6.91.1
  - `knowledge` 命令描述更新：加入代码知识图谱功能说明
  - 新增代码知识图谱使用示例（code-index --graph / knowledge-explain / knowledge-path / knowledge-query）

- **docs/DESIGN.md**
  - 1.5 节标题更新：v6.84.0+ — v6.91.0+
  - 新增 1.5.8「代码知识图谱（v6.90.0+）」：架构设计、核心机制、输出产物、CLI 集成
  - 新增 1.5.9「图谱深度整合（v6.91.0+）」：analyze 注入、PATTERNS 置信度、MODULE_MAP、多模态
  - 版本历史补充 v6.84.0–v6.91.1 完整记录

- **docs/command-reference.md**
  - `knowledge` 命令说明更新，加入代码知识图谱查询示例

---

## v6.91.1 (2026-08-20) — 流程修复与稳定性改进

### 修复

- **【严重】analyze 阶段 graph.json 注入不生效**
  - `analyze.ts`: 修复 `buildMultiDocPrompt` 缺少 `codeGraphSummary` 参数，注入的图谱摘要未实际传入 prompt
  - `prompt-builder.ts`: `codeGraphSummary` 参数现为可选字符串，兼容旧调用

- **【中】PipelineEngine 与 autoPipeline 状态不同步**
  - `pipeline-engine.ts`: 新增 `saveProgress()` 每阶段保存 `pipeline-progress.json`
  - `ask.ts`: 修复 `--resume` 后 PipelineEngine 状态未恢复，导致从已完成的阶段重新执行

- **【中】dev.ts plan 阶段无条件执行，缺少跳过检查**
  - `dev.ts`: 修复 plan 阶段未检查 `plan.json` 是否已存在，每次 --auto 都重新执行 plan

- **【中】僵尸 --auto 选项**
  - `cli.ts`: 移除 `pattern`、`rename`、`delete`、`iteration-from-global` 命令上未使用的 `--auto` 选项

- **【轻】ask.ts spawnSync 超时过短**
  - 超时从 60s 延长至 300s（5分钟），避免 execute/split 等长命令被中断

- **【轻】analyze --auto 描述不准确**
  - CLI help 描述从 "直接生成报告" 改为 "生成结构化分析 Prompt，由 AI 执行分析"

---

## v6.91.0 (2026-08-20) — 图谱深度整合：analyze 注入 + 多模态 + MODULE_MAP

### 新增

- **analyze 阶段代码知识图谱摘要注入**
  - `prompt-builder.ts`: analyze 命令自动读取 `.speccore/code-graph/graph.json`
  - 注入内容：子系统列表（社区检测）、God nodes、跨社区桥梁边、建议问题
  - AI 分析需求时优先理解现有代码结构，避免与已有设计冲突

- **PATTERNS/ 目录引入 EXTRACTED/INFERRED 置信度标签**
  - `.speccore/PATTERNS/README.md`: 文件格式规范新增 `> 置信度: EXTRACTED | INFERRED`
  - `pattern.ts`: `PatternOptions` 新增 `confidence` 字段，默认 `EXTRACTED`
  - `cli.ts`: `speccore pattern` 新增 `--confidence` 选项
  - EXTRACTED = 从源码明确提取，INFERRED = 分析推断（需人工复核）

- **社区检测结果自动写入 MODULE_MAP**
  - `code-graph/index.ts`: 构建图谱后额外输出 `MODULE_MAP.json`
  - 包含：每个社区的 ID/标签/节点数/文件路径/密度/God nodes/桥梁节点
  - 跨社区边列表（最多 50 条），用于识别子系统耦合点

- **多模态：API_CONTRACT + SQL Schema 纳入图谱**
  - 新增 `code-graph/multimodal.ts`: 多模态解析器
  - 扫描 `API_CONTRACT.yaml` / `openapi.yaml` / 迭代目录 `_shared/API_CONTRACT.yaml`
  - 扫描 `.sql` 文件，正则解析 `CREATE TABLE` 语句
  - API 端点 → `api_endpoint` 节点，数据库表 → `db_table` 节点
  - 自动关联：API 与 handler/controller（路径/命名匹配），DB 表与 entity/repository（命名匹配）
  - 关联边标记为 `INFERRED` 置信度

---

## v6.90.0 (2026-08-20) — 代码知识图谱 Code Knowledge Graph

### 新增

- **代码知识图谱模块** `src/core/code-graph/`
  - `parser.ts`: 基于 TypeScript 编译器 API 的本地 AST 解析（零 Token，代码不出本机）
  - `builder.ts`: 图谱构建 + 社区检测（Union-Find + 目录结构启发式）+ God nodes 识别
  - `query.ts`: 支持 explain（节点解释）、path（最短路径 BFS）、query（关键词匹配）
  - `reporter.ts`: 自动生成 `GRAPH_REPORT.md`（God nodes、社区、跨社区桥梁、建议问题）
  - `visualizer.ts`: 生成 `graph.html`（vis-network 力导向图，社区着色，EXTRACTED/INFERRED 线型区分）
  - `index.ts`: 一键构建 API `buildCodeKnowledgeGraph()`，输出三产物

- **CLI 命令增强**
  - `speccore code-index --graph`: 构建代码知识图谱
  - `speccore knowledge-explain <node>`: 解释节点及其连接
  - `speccore knowledge-path <from> <to>`: 查找最短路径
  - `speccore knowledge-query <question>`: 自然语言查询图谱

### 借鉴 Graphify 的核心设计

- 本地 AST 解析替代 RAG 向量索引（零 LLM Token）
- EXTRACTED / INFERRED 边置信度标签
- 社区检测自动划分子系统
- 三产物输出：graph.json + GRAPH_REPORT.md + graph.html
- 持久化图谱：一次构建，多次查询

---

## v6.89.0 (2026-08-20) — 统一注入框架 ContextInjector

### 新增

- **统一注入框架** `src/core/context-injector.ts`
  - 将 RULES / AGENTS / COMMANDS / SKILLS / HOOKS 五层注入统一到一个 API：`injectAll()`
  - 支持按需组合注入：技术栈 → 规范，命令/阶段 → 角色，任务关键词 → 技能
  - 提供简化版 `injectAgents()`、`injectRules()` 供快速调用
  - 未来新命令无需重复实现注入逻辑

### 构建

- **post-build 脚本** `build-post.js`
  - TypeScript 编译后自动复制 `.md` 资源到 `dist/`
  - 确保内置默认的 AGENTS / RULES / COMMANDS / SKILLS / HOOKS 文件在发布包中存在

---

## v6.88.0 (2026-08-20) — SKILLS 可复用技能库 + HOOKS 生命周期钩子

### 新增

- **SKILLS 技能库** `src/core/skill-loader.ts`
  - 扫描 `.speccore/SKILLS/` 目录，按任务关键词（tags）匹配技能
  - 内置 4 个技能：deployment、db-migration、caching、logging
  - execute 阶段可按任务内容选择性注入

- **HOOKS 钩子系统** `src/core/hook-runner.ts`
  - 支持 `pre-{command}` 和 `post-{command}` 两种钩子
  - 命名约定驱动的钩子发现：`pre-execute.md`、`post-execute.md`
  - 支持 `BLOCK:` 标记拦截命令执行
  - 内置 2 个钩子：pre-execute（分支检查）、post-execute（质量门禁）

- **初始化集成**
  - `speccore init` 自动创建 `.speccore/SKILLS/` 和 `.speccore/HOOKS/`

---

## v6.87.0 (2026-08-20) — COMMANDS 命令模板系统

### 新增

- **命令模板加载器** `src/core/command-loader.ts`
  - 扫描 `.speccore/COMMANDS/` 目录加载模板
  - 支持 `{{变量}}` 替换
  - 用户自定义模板覆盖内置默认

- **内置模板**
  - `pr-review.md` — PR 审查流程（commit 信息生成、分析对齐检查）
  - `change-impact.md` — 变更影响分析流程
  - `refactor.md` — 重构标准流程

### 修改

- **`pr.ts`**：`--prompt` 模式优先加载 `pr-review` 模板，不存在时回退到硬编码
- **`change.ts`**：`--prompt` 模式追加 `change-impact` 模板
- **`init.ts`**：初始化时自动创建 `.speccore/COMMANDS/`

---

## v6.86.0 (2026-08-20) — AGENTS 调度器扩展到全阶段

### 新增

- **11 个角色定义文件**
  - task-decomposer、dependency-analyst、effort-estimator（split 阶段）
  - schedule-planner、risk-assessor（plan 阶段）
  - impact-analyst、regression-tester（change 阶段）
  - code-reviewer、test-reviewer（pr 阶段）
  - compiler、test-engineer、performance-expert、doc-sync-agent（execute quality-gate）
  - compliance-checker（audit 阶段，finance 行业条件激活）

- **AGENTS 注册表更新** `_INDEX.md`
  - 新增 `split / default`、`plan / default` 阶段配置

### 修改

- **`prompt-builder.ts`**：split / plan 命令构建 prompt 时自动注入对应角色
- **`change.ts`**：change/impact 阶段注入 impact-analyst、regression-tester
- **`pr.ts`**：pr/review 阶段注入 code-reviewer、security-reviewer、test-reviewer

---

## v6.85.0 (2026-08-20) — RULES 编码规范库 + 按技术栈自动注入

### 新增

- **规范库加载器** `src/core/rule-loader.ts`
  - 扫描 `.speccore/RULES/` 目录
  - 从 frontmatter 解析 `appliesTo` 和 `priority`
  - 按技术栈标识符匹配适用规范

- **8 个内置编码规范**
  - `typescript.md` — 类型安全、命名规范、模块组织
  - `react.md` — 组件设计、Hooks 规范、状态管理
  - `vue.md` — 组合式 API、响应式规范
  - `nodejs.md` — RESTful API、错误处理、依赖注入
  - `api-design.md` — 幂等性、版本控制、分页
  - `testing.md` — 测试金字塔、覆盖率目标
  - `security.md` — 输入验证、认证授权、OWASP 防护
  - `database.md` — 命名规范、表设计、查询优化
  - `frontend-common.md` — 响应式、a11y、i18n、性能

### 修改

- **`prompt-builder.ts`**：execute 阶段从 `CONSTITUTION.md` 解析技术栈，自动注入匹配规范到 prompt
- **`init.ts`**：初始化时自动创建 `.speccore/RULES/`，复制默认规范（不覆盖用户自定义）

---

## v6.77.6 (2026-08-19) — 修复"全局"概念混淆：迭代层 vs 全局层

### Bug 修复

- **意图识别层去混淆**
  - `intent-recognition.ts`: `analyze` triggers 移除 `'全局分析'`、`'分析全局'`、`'全局(.+)分析'`
  - 新增迭代层专属触发词：`'迭代分析'`、`'分析迭代'`、`'本迭代分析'`、`'当前迭代分析'`、`'迭代(.+)分析'`、`'本迭代(.+)分析'`
  - `ask-engine.ts` COMMAND_KB: `analyze` triggers 同步移除 `'全局分析'`、`'分析全局'`，增加 `'迭代分析'`、`'分析迭代'`

- **迭代层 prompt 用词统一**
  - `analyze.ts` 中所有迭代分析 prompt 的"全局文档"改为"**综合文档**"（指 020-specs/global/ 下的跨端通用文档）
  - "Phase 1/3: 全局文档" → "Phase 1/3: 迭代综合文档"
  - "Phase 1 全局分析已完成" → "Phase 1 迭代分析已完成"
  - 进度标签、注释、prompt 文字全部同步更新

### 概念澄清

| 层级 | 正确称呼 | CLI 命令 | 输出目录 |
|:---|:---|:---|:---|
| **全局层** | 全局分析 / 全量分析 | `speccore analyze --scope global` | `.speccore/GLOBAL/` |
| **迭代层** | 迭代分析 / 本迭代分析 | `speccore analyze -I <迭代名>` | `Iteration-XXX/020-specs/` |
| **迭代综合文档** | 跨端通用文档 | Phase 1 生成 | `020-specs/global/` |
| **端专属文档** | 各端技术方案 | Phase 2 生成 | `020-specs/{端名}/` |

## v6.77.5 (2026-08-19) — PATTERNS 目录结构与沉淀机制

### 新增

- **PATTERNS 分类目录结构**: `.speccore/PATTERNS/` 下建立五大分类目录
  - `architecture/` — 跨端通用架构模式
  - `data-model/` — 跨端通用数据模型模式
  - `api-contract/` — 跨端通用 API 契约模式
  - `security/` — 跨端通用安全模式
  - `performance/` — 跨端通用性能模式
  - 每个分类含 README.md（沉淀时机 + 示例模式）
  - 根目录 README.md（完整目录结构 + 文件命名规则 + 内容格式 + 更新规则）

- **全局分析 prompt 增强**: Layer 4 汇总阶段的 PATTERNS 沉淀指令大幅扩展
  - 明确目录结构（分类 × 端 双层组织）
  - 明确触发条件（Layer 1/2/3 各阶段何时生成）
  - 明确文件命名规则（通用 vs 端专属）
  - 明确文件内容格式（适用场景 + 核心实现 + 使用示例 + 注意事项 + 反例）
  - 明确写入方式（追加不覆盖）

- **prompt-builder.ts 扫描逻辑升级**
  - 从仅扫描 `PATTERNS/TEMPLATES/` 扩展到扫描整个 `PATTERNS/` 目录
  - TEMPLATES 文件仍标记为"写作模板"，其他标记为"可复用模式"
  - TOC 显示按子目录分组（architecture/ data-model/ security/ 等）
  - 组标题从"写作模板"改为"可复用模式与模板"

- **DESIGN.md 新增章节**: "1.4 全局分析产物归类规则（PATTERNS 目录）"
  - 完整目录结构说明
  - 五大分类对照表（分类 × 存放内容 × 触发时机 × 示例）
  - 文件命名规则（通用模式 vs 端专属模式）
  - 文件内容格式规范
  - 更新规则（追加不覆盖、手动编辑、自动发现、端差异处理）

## v6.77.4 (2026-08-19) — 修复 ask 引擎全局分析 scope 参数丢失

### Bug 修复

- **intent-recognition.ts**: `extractParams` 新增 `scope` 参数提取
  - 支持关键词：全局、所有工程、全部工程、所有项目、全部项目、整个项目、全量、整体、全部
  - 识别后设置 `params.scope = 'global'`

- **ask-engine.ts**: `handleMatch` 新增 `scope` 参数拼接
  - KB 匹配分支：输出 `--scope global`
  - 意图匹配分支：输出 `--scope global`
  - 修复 "全局分析所有工程源码" 被错误路由到迭代分析的问题

## v6.77.3 (2026-08-19) — 高频命令 Skill 补齐

### 新增 Skill

- **`spec-welcome`** — 欢迎页专属 Skill
  - 前置校验：检测项目是否已初始化（.speccore/ 目录存在性）
  - 未初始化时引导用户执行 `speccore init`

- **`spec-help`** — 帮助中心专属 Skill
  - 前置校验：检测 CLI 版本与项目记录版本差异
  - 发现新版本时提示更新

- **`spec-dashboard`** — 仪表盘专属 Skill
  - 前置校验：检测 context.json 中是否有活跃迭代
  - 无迭代时引导用户创建或切换迭代

### 架构改进

- Skill 部署列表从 13 个扩展到 16 个
- 高频纯展示命令也有 `/` 斜杠快捷触发能力

## v6.77.2 (2026-08-19) — init/update 命令列表修复

### 修复

- **`spec-create-iteration` → `spec-iteration-create`** — 统一命令名与 Skill 目录名，避免 init 生成 `spec-create-iteration.md` 但 Skill 目录为 `spec-iteration-create/` 的混乱
- **`init.ts` / `update.ts` 命令列表统一** — `update.ts` 不再单独维护 `ALL_COMMANDS`，改为从 `init.ts` 导入 `TOOL_COMMANDS`，消除两套列表不一致导致的清理误删问题
- **添加 `spec-task-create`** — commands 数组和 Skill 部署列表中补充此前缺失的 `spec-task-create`
- **扩展 `isDynamicRouting`** — 所有有 SKILL.md 的命令（spec-ask/spec-change/spec-doc2spec/spec-done/spec-execute/spec-iteration-create/spec-plan/spec-pr/spec-spec2doc/spec-split/spec-task-create）在非 Qoder 工具中也使用动态路由格式

### 架构改进

- `init.ts` 的 `commands` 数组改为模块级导出的 `TOOL_COMMANDS`，成为单一事实来源
- `update.ts` 直接导入 `TOOL_COMMANDS`，消除重复定义

## v6.77.1 (2026-08-19) — 流水线 Skill 补齐：pr + done

### 新增 Skill

- **`spec-pr`** — 代码提交与 PR 专属 Skill
  - 前置校验：分支安全检查（阻止 main/master 直接提交）、未提交变更检测、ANALYSIS.md 路径校验、冲突检测
  - 参数提取：task, iteration, base, draft, title, commit, force, confirm, prompt, response
  - 交互式提示：当前分支、保护分支、未提交文件数

- **`spec-done`** — 任务归档收尾专属 Skill
  - 前置校验：Task 存在性、依赖任务完成性、feature 分支合并状态、代码提交状态
  - 参数提取：task, iteration, all, skipValidate, skipSync, interactive, prompt, response
  - 交互式提示：已完成任务数、待归档任务数、执行流程（validate→archive→merge→sync→audit）

### 清理

- 删除 `.agents/skills/spec-dev/` 和 `.agents/skills/spec-synthesize/` 空目录
- `init.ts` Skill 部署列表添加 `spec-pr` 和 `spec-done`

---

## v6.77.0 (2026-08-19) — Skill 专属逻辑架构 + 需求澄清 + 变更检测

### Skill 专属逻辑架构（重大改进）

**核心理念**：Skill 从"纯路由"升级为"参数校验 + 上下文准备 + 交互提示"的专属预处理层。

- **9 个 Skill 全面增强**：
  - `spec-analyze`: 需求专业度检测、端列表读取、apply 文件校验
  - `spec-split`: 增量拆分上下文、变更检测、已有 Task 扫描
  - `spec-plan`: 任务依赖检测、拓扑排序、执行顺序优化
  - `spec-execute`: 任务状态检查、代码模式读取、上游变更检测
  - `spec-change`: 变更类型判断、影响范围扫描、附件检测
  - `spec-doc2spec`: 文件格式检测、迭代存在性校验
  - `spec-spec2doc`: 输出格式校验、Task/迭代存在性检查
  - `spec-task-create`: 英文主题词提取、命名冲突检测、批量模式
  - `spec-iteration-create`: 迭代名冲突检测、主题词提取、owner 补全

- **统一 Skill 结构**：所有 Skill 遵循"参数提取 → 交互提示 → 前置校验 → 调用 ask"四步流程
- **交互式提示规范**：参数缺失时输出"当前环境 + 参数说明 + 使用示例"，不直接报错
- **三层架构明确**：专属预处理层（Skill）→ 意图执行层（ask）→ 底层操作层（CLI）

### 新增命令

- **`speccore clarify`** — 需求澄清命令：将口语化需求整理为 PRD 级专业文档
  - `speccore clarify --to <iteration> --prompt` — 生成整理 Prompt
  - `speccore clarify --to <iteration> --apply <json>` — 应用 AI 整理结果
  - 输出位置：`010-requirements/converted/clarified-{feature}.md`
  - 专业度检测指标：口语化表达、结构化标题、验收标准、技术约束、错误处理、数据模型

### 新增参数

- **`speccore analyze --clarify`** — 检测需求文档专业度，口语化时自动触发澄清流程
- **`speccore analyze --dev-guide`** — 分析同时生成 DEV_GUIDE.md 三级开发者实现指南（全局级/端级/任务级）
- **`speccore iteration split --modules <names>`** — 只拆分指定功能模块（如 `"购物车,订单"`）
- **`speccore iteration split --platforms <list>`** — 只拆分指定端（如 `api,h5`）
- **`speccore iteration split --prune`** — 清理不匹配的旧任务
- **`speccore iteration split --dev-guide`** — 生成任务级 DEV_GUIDE.md
- **`speccore iteration split --ignore-specs-update`** — 跳过 020-specs/ 变更检测
- **`speccore execute --ignore-upstream-update`** — 跳过上游 020-specs/ 变更检测
- **`--apply @file.json`** — Windows 兼容方式，从文件读取 JSON 避免 shell 转义问题

### 新增核心模块

- **`src/core/change-detector.ts`** — 变更检测引擎
  - `detectSpecChangesBeforeSplit()` — 拆分前检测 020-specs/ 是否有更新
  - `detectUpstreamChangesBeforeExecute()` — 执行前检测上游文档是否更新
  - 基于文件 mtime 比较，轻量高效

- **`src/core/requirement-clarifier.ts`** — 需求专业化引擎
  - `detectProfessionalLevel()` — 六维专业度检测（口语化、结构、验收标准、技术约束、错误处理、数据模型）
  - `buildClarifyPrompt()` — 生成整理 Prompt

### 增量拆分支持

- `scanExistingTaskStructure()` — 扫描已有 Task 的端结构
- 增量拆分规则：功能单元匹配已有 Task → 复用 Task ID，只追加新端
- API 契约在增量拆分中保持完整

### 删除的 Skill

- ~~`spec-dev`~~ — 纯路由型，功能已合并到 ask
- ~~`spec-synthesize`~~ — 纯路由型，功能已合并到 `analyze --full`

### 文档更新

- `docs/DESIGN.md` — 新增第 12 章"Skill 专属逻辑架构"
- `docs/command-reference.md` — 新增 clarify 命令、所有新参数说明

---

## v6.76.1 (2026-08-19) — 验证修复：路径统一 + async filter + 检测函数调用

### 修复内容

- **streaming-analyzer.ts 全局文档路径统一**：
  - `detectBacktrackingNeeds()` 和 `runFinalAudit()` 原使用 `.speccore/GLOBAL/`（项目级）
  - 修正为优先检查 `020-specs/global/`（迭代级），回退 `.speccore/GLOBAL/`
  - 新增 `resolveGlobalDir()` 辅助函数统一路径解析
- **`--apply` 模式集成自动检查**：
  - 当 `--streaming-phase phase1-backend` / `phase3-frontend` 时，自动调用 `detectBacktrackingNeeds()` 检测回退需求
  - 当 `--streaming-phase phase6-final-audit` 时，自动调用 `runFinalAudit()` 执行最终核对
- **修复 `Array.prototype.filter(async)` 运行时 bug**：
  - `streaming-analyzer.ts` line 583：`platforms.filter(async p => ...)` → 提前 `await parsePlatformTypes()`，filter 内改为同步 predicate
  - `analyze-context-guard.ts` line 286：同样修复
  - 影响：原 bug 导致所有平台被误认为后端平台（Promise 永远 truthy）

---

## v6.76.0 (2026-08-18) — 功能模块级全局分析（--module）

### 与 --feature 的区别

| 维度 | `--feature` (局部分析) | `--module` (全局模块分析) |
|:---|:---|:---|
| 分析范围 | 单个功能模块的需求 → 规格 | 单个功能模块 + 跨端关联 + 全局影响 |
| 全局文档 | ❌ 不更新 | ✅ 更新 FUNCTION_MAP / INTERACTION_MAP / API_CONTRACT / REQUIREMENT |
| 各端文档 | ❌ 不更新 | ✅ 更新各端 TECH.md / API_INVENTORY / FEATURES / UI_SPEC |
| 适用场景 | 新增功能模块的初次规格定义 | 已有模块的重新分析、跨端一致性校验 |

### 模块已存在时的处理

- **读取当前全局文档**：找到该模块在 FUNCTION_MAP / INTERACTION_MAP / API_CONTRACT / REQUIREMENT 中的当前定义
- **对比最新需求**：识别变更点（字段增删、端增删、接口变更）
- **精准更新**：只更新该模块相关的全局层章节和各端相关内容，不影响其他模块
- **跨端一致性校验**：检查该模块涉及的所有端之间的字段映射、枚举值、接口路径一致性

### 模块不存在时的处理

- **从需求文档提取**：搜索 `010-requirements/features/{name}/README.md`、`converted/*.md`、`REQUIREMENT.md`
- **按全局标准分析**：功能描述、用户故事、验收标准、涉及端、API 契约、跨端时序
- **全局层追加**：在 FUNCTION_MAP 中追加新行、在 INTERACTION_MAP 中追加时序图、在 API_CONTRACT 中追加接口
- **各端追加**：在涉及的各端 TECH.md 中追加该模块的技术设计
- **智能提示**：如果需求文档中找不到该模块，提示用户确认模块名或创建需求文档

### 新增模块

| 文件 | 职责 |
|:---|:---|
| `src/core/module-analyzer.ts` | 模块级全局分析引擎：模块查找、全局更新规划、跨端一致性检查 |

### CLI 新增参数

| 参数 | 说明 |
|:---|:---|
| `--module <name>` | 功能模块级全局分析（更新全局层+各端文档） |

---

## v6.75.0 (2026-08-18) — 增量分析 + 新增端分析 + 上下文爆炸防护

### 增量分析模式（--incremental / --reanalyze）

- **变更检测**: 对比上次分析快照，检测需求文档变更、源码变更、端列表变更
- **智能复用**: 未变更的内容标注为「已有内容，请复用/校验」，只重新分析变更部分
- **遗漏检查**: 自动检测上次分析的功能模块遗漏、文档缺失、占位符残留
- **快照机制**: `.speccore/cache/last-analysis-snapshot.json` 记录上次分析状态

### 新增端分析模式（--add-platform <端名>）

- **单独分析新端**: 读取新端源码，建立索引，深入分析（后端/前端各有不同产出）
- **跨端关系自动识别**: 检测新端与已有端的 API 调用关系、数据依赖、认证依赖
- **全局文档自动更新**: 自动规划 FUNCTION_MAP / API_CONTRACT / ARCHITECTURE / INTERACTION_MAP 的更新内容
- **一致性检查**: 检查新端与已有端的 API 路径规范、枚举值、数据模型、认证机制一致性

### 上下文爆炸防护（--context-guard / --estimate-only）

- **智能预估**: 基于端数量、模块数量、文档大小、源码量预估分析所需 tokens
- **四级分段策略**:
  - small (< 8K): 一次性分析
  - medium (8K-16K): 按端分段
  - large (16K-32K): 按功能模块分段
  - xlarge (> 32K): 按功能单元分段
- **分段计划生成**: 自动生成分段执行计划，含依赖拓扑排序
- **只预估模式**: `--estimate-only` 输出预估报告和分段建议，不执行分析

### 新增模块

| 文件 | 职责 |
|:---|:---|
| `src/core/incremental-analyzer.ts` | 增量分析引擎：变更检测、快照管理、遗漏检查 |
| `src/core/platform-addition.ts` | 新增端分析引擎：跨端关系识别、全局文档更新规划 |
| `src/core/analyze-context-guard.ts` | 上下文防护引擎：大小预估、分段策略、交互确认 |

### CLI 新增参数

| 参数 | 说明 |
|:---|:---|
| `--incremental` | 增量分析模式（基于上次分析，只分析变更/遗漏） |
| `--reanalyze` | 重新分析（同 --incremental） |
| `--add-platform <端名>` | 新增端分析（单独分析新端，更新全局文档） |
| `--context-guard` | 启用上下文爆炸防护（预估大小+智能分段） |
| `--estimate-only` | 只输出上下文预估报告，不执行分析 |

---

## v6.74.0 (2026-08-18) — 流式全局分析：Phase 0→6 + 实时关联调整 + 端针对性 + 核对检查

### 核心架构：从"四层批处理"升级为"七阶段流处理"

- **Phase 0: 快速全局扫描** — 所有端并行索引，产出 `platforms/{端}/_INDEX.md`
- **Phase 1: 后端深度分析** — 拓扑排序，从依赖源头服务开始逐个深入分析
  - 产出：API_INVENTORY.md / DATA_MODEL.md / BUSINESS_RULES.md / TECH_STACK.md
  - 端类型针对性：Java→Spring Boot/JPA/缓存/消息队列；Node→NestJS/TypeORM/异步处理；Go→Gin/GORM/协程；Python→FastAPI/SQLAlchemy/Celery
- **Phase 2: 全局实时更新** — 后端完成后立即更新全局文档
  - 产出：API_CONTRACT.yaml / ARCHITECTURE.md / FUNCTION_MAP.md / CONSISTENCY_CHECK.md
- **Phase 3: 前端深度分析** — 对齐后端契约，逐个前端端分析
  - 产出：FEATURES.md / UI_FLOW.md / API_CALL_MAP.md / UI_SPEC.md / TECH_STACK.md
  - 端类型针对性：微信→JS-SDK/OAuth/支付；H5→响应式/触摸/弱网；小程序→包体积/setData；Web→表单/表格/权限UI；Android→生命周期/权限/推送；iOS→Swift/App Store规范
- **Phase 4: 横向关联检查** — 前后端字段/接口/状态一致性
  - 产出：global/CROSS_CHECK.md
- **Phase 5: 纵向关联检查** — 功能模块跨端完整性
  - 产出：global/VERTICAL_CHECK.md
- **Phase 6: 最终核对检查** — 完整性+一致性+遗漏检测
  - 产出：global/FINAL_AUDIT.md

### 实时关联调整机制

- **后端分析中发现冲突**：当前端数据模型与已分析端冲突 → 回退修正已分析端
- **前端分析中发现缺失**：前端需要的接口在后端不存在 → 回退补充后端 API
- **自动检测**：`detectBacktrackingNeeds()` 自动扫描前后端文档的不一致
- **修正流程**：标注冲突点 → 输出修正列表 → `speccore analyze --apply` 更新 → 重新验证

### 端类型针对性分析

- 后端端按技术栈生成专属分析维度（Java/Node/Go/Python 各有不同侧重点）
- 前端端按平台类型生成专属分析维度（微信/H5/小程序/Web/Android/iOS/桌面各有不同）
- 在 Prompt 中自动注入端类型 → 分析侧重点映射表

### 新增模块

| 文件 | 职责 |
|:---|:---|
| `src/core/streaming-analyzer.ts` | 流式分析引擎：Phase Prompt 生成、实时关联调整检测、最终核对检查 |

### CLI 新增参数

| 参数 | 说明 |
|:---|:---|
| `--streaming` | 启用流式全局分析（替代传统 Layer 1-4） |
| `--streaming-phase <phase>` | 指定流式分析阶段（phase0-scan ~ phase6-final-audit） |

---

## v6.73.0 (2026-08-18) — 变更驱动工作流 v2：语义检索 + AI 影响分析 + 变更收件箱

### 核心架构：分层 AI + 知识图谱联动

- **语义检索替代关键词匹配** (`ai-impact-analyzer.ts`): 变更影响分析从关键词计数升级为 `unifiedSearch` 语义检索
  - 文档 RAG 检索：按相关度排序的任务文档 chunk
  - 代码切片检索：`--with-code` 启用时自动检索相关代码
  - 知识图谱联动：查询匹配任务的上下游依赖关系
- **AI 单次调用生成影响分析 + 实施计划**：
  - LLM 推理层：基于检索结果判断直接影响/间接影响/代码级变更/全局层刷新
  - LLM 生成层：自动生成 `CHANGE_TODO.md`（代码变更清单 + 回归验证 + 实施步骤）
  - 降级策略：LLM 不可用时自动回退到语义相关度阈值分级

### 二级意图分类

- **变更类别细分** (`change-parser.ts`): `field-change` / `api-change` / `flow-change` / `ui-change` / `logic-change` / `config-change`
- **新增类别细分**: `feature` / `endpoint` / `integration`
- **规则层快速分类** + **精确层 AI 澄清**（模糊描述时触发）

### 变更收件箱（Change Inbox）

- **独立目录**: `.speccore/changes/pending/`（与 `.speccore/inbox/` 需求收件箱分离）
- **多种输入方式**:
  - `speccore change "描述"` — 直接描述
  - `speccore change --file change.md` — 指定文件
  - `speccore change --dir ./changes/` — 指定目录（批量）
  - `speccore change --inbox` — 读取默认变更收件箱
  - `speccore change`（无参数）— 自动检查变更收件箱
- **文件格式支持**: `.md` / `.txt` / `.json` / `.yaml` / `.xlsx`
- **处理后清理**: 默认归档到 `processed/YYYY-MM-DD/`，可选 `--delete-after-process` 直接删除
- **清单追踪**: `manifest.json` 记录每个文件的处理状态、关联任务、变更 ID

### 新增需求增强

- **结构化解析**: JSON/YAML 格式的变更需求自动解析为 `ChangeRequest`
- **增强版 handleNewRequirementV2**: 支持从结构化数据创建任务（标题/优先级/验收标准）

---

## v6.72.0 (2026-08-18) — 流水线链路全面优化

### P0: 全局层自动刷新 + FUNCTION_MAP 自检

- **全局层刷新提示** (`execute.ts`): 执行完成后检测接口/实体变更，自动提示 `speccore analyze --global --withCode` 刷新全局层
- **FUNCTION_MAP.md 自检** (`analyze.ts`): apply 阶段自动校验 FUNCTION_MAP.md
  - 校验表头完整性（功能单元、涉及端、全局对比）
  - 校验涉及端是否在已知端列表中
  - 校验全局对比是否为标准值（新增/扩展/重构/复用）
  - 校验依赖任务格式（Task-NNN）

### P1: 一致性校验消费 + 变更状态重评估

- **CONSISTENCY_CHECK.md 注入执行** (`prompt-builder.ts`): execute 时自动读取并注入迭代级/全局级 CONSISTENCY_CHECK.md，让 AI 在编码时知晓前后端不一致项
- **变更后任务状态自动重评估** (`change.ts`):
  - 直接受影响任务：状态统一标记为 `needs-rework`，TASK.md 状态同步更新
  - 间接影响任务（done 状态）：自动回退为 `needs-rework`，TASK.md 追加回归验证记录
  - 支持 `.meta/status` 和 `.task-status` 双格式
- **Prompt 文档长度自适应** (`analyze.ts`): 需求文档超过 5000 字时，AI 先扫描目录再深入关键章节

### P2: 相邻任务强制 + 智能清理 + 模式自动提取

- **相邻任务读取强制化** (`prompt-builder.ts`): execute 指令增加强制要求
  - 必须先 Read 相邻任务文档再编码
  - 找不到时必须在代码注释中标注「未验证：相邻任务文档缺失」
- **split --prune 智能清理** (`iteration/split.ts` + `cli.ts`):
  - `--prune` 选项：只清理与当前 FUNCTION_MAP.md 功能单元不匹配的旧任务
  - 旧任务移动到 `030-tasks/.archive/YYYY-MM-DD/`（安全归档，不直接删除）
  - 与 `--force`（全部删除）形成互补
- **PATTERNS/ 自动提取支持** (`analyze.ts`): apply 阶段支持 `PATTERNS/*.md` 文件
  - AI 返回 `PATTERNS/{分类}-{模式名}.md` 时，自动追加到 `.speccore/PATTERNS/`
  - 采用追加模式（不覆盖，合并内容）

---

## v6.71.3 (2026-08-18) — 四层模式统一映射到迭代分析和任务执行

### 迭代分析增强（`analyze.ts`）

- **增加全局层产物读取**：迭代分析在读取需求文档之前，先读取全局层产物
  - `.speccore/GLOBAL/REQUIREMENT.md` → 系统已有功能清单
  - `.speccore/GLOBAL/FUNCTION_MAP.md` → 已有功能单元和涉及端
  - `.speccore/GLOBAL/API_CONTRACT.yaml` → 已有接口契约
  - `.speccore/GLOBAL/ARCHITECTURE.md` → 全局架构
  - `.speccore/GLOBAL/platforms/{端}/_INDEX.md` → 各端已有页面和接口索引
  - `.speccore/GLOBAL/platforms/_shared/_ASSOCIATION.md` → 前后端关联矩阵
  - `.speccore/GLOBAL/platforms/_shared/_MODULES.md` → 功能模块候选

- **增加「全局对比」列**：功能模块清单和 FUNCTION_MAP.md 增加「全局对比」列
  - 「新增」：全局层不存在，本迭代全新开发
  - 「扩展」：全局层已有基础功能，本迭代增加新字段/新接口/新页面
  - 「重构」：全局层已有，本迭代修改实现方式
  - 「复用」：全局层已有，本迭代直接使用

- **增加迭代需求与全局层关联分析**：
  - 对比迭代需求中的功能模块 vs 全局层 FUNCTION_MAP.md 中的功能单元
  - 识别冲突：如迭代需求修改了全局层已有接口的字段/路径 → 在 RISK.md 中标注
  - 识别依赖：如迭代的新功能依赖全局层的某个功能 → 在 FUNCTION_MAP.md「依赖任务」中标注

### 任务执行增强（`prompt-builder.ts`）

- **增加相邻任务关联（Layer 2）**：execute 指令增加相邻任务读取步骤
  - 读取前置任务（本任务依赖的任务）：_shared/CONTEXT.md + 00-specs/REQ.md + _shared/API_CONTRACT.yaml
  - 读取并行任务（同一功能单元的其他端任务）：_shared/CONTEXT.md
  - 契约验证：接口定义一致性、数据模型一致性、状态枚举一致性

### 架构统一

- **全局→迭代→任务 四层模式映射统一**：
  - 全局分析：Layer 1 快速扫描 → Layer 2 关联分析 → Layer 3 功能模块深入 → Layer 4 全局汇总
  - 迭代分析：Layer 1 全局层读取 → Layer 2 需求 vs 全局关联 → Layer 3 功能单元深入 → Layer 4 迭代汇总
  - 任务执行：Layer 1 上下文扫描 → Layer 2 相邻任务关联 → Layer 3 深入实现 → Layer 4 验证汇总

## v6.71.2 (2026-08-18) — 双层扫描 + 功能模块驱动（全局分析架构重构）

### 架构重构

- **全局分析从「按端顺序」重构为「双层扫描 + 功能模块驱动」**（`analyze.ts`）：
  - **Layer 1: 快速扫描所有端（并行）** — 只提取索引，不深入代码逻辑
    - 后端端：扫描 Controller/Entity/Service 目录文件列表 + 依赖项列表
    - 前端端：扫描路由配置 + 页面目录 + API 调用模式 + 状态管理目录
    - 输出：每个端一个 `_INDEX.md`（只含名称和路径列表）
  - **Layer 2: 跨端关联分析** — 基于 Layer 1 的索引建立关联
    - 匹配前后端接口：前端 API 调用 vs 后端接口路径 → 建立完整链路
    - 识别「接口缺口」（前端有、后端没有）和「未使用接口」（后端有、前端没调）
    - 识别公共服务：被 2+ 个端调用的服务 → 公共服务候选
    - 归纳功能模块：从页面聚类 + 从接口聚类 → 交叉验证确定功能模块边界
    - 输出：`_ASSOCIATION.md`（关联矩阵）+ `_MODULES.md`（功能模块候选清单）
  - **Layer 3: 按功能模块深入分析** — 不是按端，而是按功能模块
    - 每个功能模块涉及哪些端，就读取那些端的详细源码
    - 示例：「会议预订」功能 → 同时深入分析 h5 + booking-service + room-service
    - 关联验证：前端字段 vs 后端 DTO、前端状态 vs 后端枚举
    - 输出：功能模块级别的详细文档（后端 API/数据模型 + 前端页面/交互 + 跨端时序图）
  - **Layer 4: 全局汇总** — 所有功能模块分析完成后统一汇总
    - 一致性校验：字段一致性、状态一致性、接口缺口/未使用接口清单
    - 生成全局文档：REQUIREMENT.md + FUNCTION_MAP.md + INTERACTION_MAP.md + API_CONTRACT.yaml + ARCHITECTURE.md + CONSISTENCY_CHECK.md
    - 生成各端文档：前端端（FEATURES.md + UI_FLOW.md + API_CALL_MAP.md）+ 后端端（API_INVENTORY.md + DATA_MODEL.md + BUSINESS_RULES.md）

### 新增产物

- `ARCHITECTURE.md`：全局架构文档（服务拓扑、数据流、部署关系）
- `CONSISTENCY_CHECK.md`：一致性校验报告（前后端字段/状态/接口缺口）
- `_INDEX.md`：各端目录索引（Layer 1 中间产物）
- `_ASSOCIATION.md`：前后端关联矩阵（Layer 2 中间产物）
- `_MODULES.md`：功能模块候选清单（Layer 2 中间产物）
- `API_CALL_MAP.md`：前端端专属 — 页面 → 接口 → 后端服务 映射表

### 优化

- 文档输出列表重新组织：分为「Layer 中间产物」「全局最终产物」「各端最终产物」三类
- 全局分析产物从 12 个/端技术文档 → 精简为各端核心文档 + 全局产品视角文档

## v6.71.1 (2026-08-18) — 前后端分析差异化 + 前端代码扫描 + 产品视角功能清单

### 新增

- **前端代码扫描指令**（`analyze.ts` `--global --withCode`）：
  - 路由配置扫描：提取所有页面路径、页面名称、组件名
  - API 调用扫描：搜索 axios/fetch/$.ajax/uni.request，提取接口路径、HTTP 方法、调用位置
  - 状态管理扫描：提取全局状态、actions
  - 页面组件扫描：提取页面名称、主要功能

- **前后端关联分析**（`analyze.ts`）：
  - 将前端扫描到的 API 调用路径与后端 API_INVENTORY.md 中的接口路径匹配
  - 建立「前端页面 → 前端 API 调用 → 后端接口 → 后端服务」的完整链路
  - 输出关联矩阵表，作为 FEATURES.md 的基础

- **前端端专属文档**（`analyze.ts`）：
  - `FEATURES.md`：产品视角功能清单（页面+交互+API调用链），仅前端端生成
  - `UI_FLOW.md`：页面流转图、用户操作流程、状态变化，仅前端端生成
  - 后端端不需要 FEATURES.md（功能清单在全局 REQUIREMENT.md 中）

### 改进

- **前后端文档差异化**（`analyze.ts`）：
  - 后端端（*service）TECH.md：纯技术视角 — 接口设计+数据模型+架构+性能
  - 前端端（h5/admin-web/miniapp）TECH.md：产品+技术双视角 — 用户旅程+页面清单+交互流程+API调用链
  - 端专业性约束重新组织：合并 Web/H5/小程序为统一的「前端端」模板，突出产品视角

- **TECH.md 模板差异化**（`analyze.ts`）：
  - 后端端模板：API、数据库、缓存、安全、性能，明确标注「不要写用户旅程、业务场景」
  - 前端端模板：用户旅程、页面清单、交互设计、字段展示、权限控制、API调用清单

## v6.71.0 (2026-08-18) — 产品视角需求文档 + 跨端交互图谱 + 自动模式推断

### 新增

- **跨端交互图谱 INTERACTION_MAP.md**（`analyze.ts`、`spec-paths.ts`）：
  - analyze 阶段新增 `INTERACTION_MAP.md` 作为全局分析产物
  - 按功能单元组织，每个功能单元一个 Mermaid `sequenceDiagram`
  - 展示完整业务交互时序：用户操作 → 前端处理 → 后端调用 → 数据返回
  - 明确标出后端服务之间的内部调用（产品文档写"系统处理"的地方）
  - 箭头标注接口路径，标注 `[contract]` 表示接口在 `API_CONTRACT.yaml` 中有定义
  - 序列图后附「接口契约索引」表格和「状态流转」表格
  - 补全产品文档中隐含的技术交互，作为前后端开发者的共同参考

### 改进

- **REQUIREMENT.md 产品视角化**（`analyze.ts`）：
  - 全局需求文档要求以产品/用户视角撰写，按业务场景/用户旅程组织章节
  - 不再按端分章节（如"H5端需求"、"后端需求"）
  - 每个场景描述：用户操作 → 系统响应 → 业务规则 → 边界条件
  - 技术实现细节留在 `TECH.md` 和各端专属文档中
  - 端的信息只在「功能模块清单」表格中标注

- **自动模式跳过人工确认**（`analyze.ts`）：
  - `--auto` 模式下，AI 直接推断执行 Phase 2，无需等待用户确认
  - 提示中增加「自动模式说明」，引导 AI 直接继续生成各端专属文档

### 架构

- **文档生成顺序调整**：链式生成顺序改为 `REQUIREMENT.md` → `FUNCTION_MAP.md` → `INTERACTION_MAP.md` → `API_CONTRACT.yaml` → `ANALYSIS.md` → ...
- **GLOBAL_SPEC_FILES 扩展**：注册 `INTERACTION_MAP.md` 到全局文档白名单

## v6.70.0 (2026-08-18) — 跨端功能映射表 + 全局契约先行 + 确定性拆分

### 新增

- **跨端功能映射表 FUNCTION_MAP.md**（`analyze.ts`）：
  - analyze 阶段新增 `FUNCTION_MAP.md` 作为分析产物之一
  - 表格格式：`# | 功能单元 | 涉及端 | 共享能力 | 依赖任务 | 说明`
  - 功能单元与 REQUIREMENT.md 功能模块清单一一对应，不允许合并
  - 明确标注每个功能单元涉及哪些端、是否依赖共享能力、依赖哪些其他任务
  - 作为 split 阶段的核心输入，替代 AI 推断跨端关系

- **全局 API 契约 YAML 化**（`analyze.ts`、`spec-paths.ts`）：
  - `buildContractFirstPrompt` 输出从 Markdown 改为标准 YAML 格式（`API_CONTRACT.yaml`）
  - YAML 结构：`paths`、`components/schemas`、`enums`、`events`、`dependencies`
  - 每个接口标注 `consumers`（消费者端列表）和 `provider`（提供者端）
  - 全局契约作为单一真相源，split 时复制到每个任务的 `_shared/API_CONTRACT.yaml`

- **确定性拆分架构**（`split.ts`）：
  - 新增 `parseFunctionMap()` 函数解析 `FUNCTION_MAP.md`
  - `tryModuleDrivenSplit()` 优先读取 `FUNCTION_MAP.md`，严格按表创建任务
  - 回退链：`FUNCTION_MAP.md` → `REQUIREMENT.md` 功能模块清单 → `features/*/README.md`
  - 解决 AI "智能合并"导致的错误（如审批流程 + 定时任务被合并）

### 改进

- **子任务 TASK.md 内容增强**（`split.ts`）：
  - 添加「跨端关联」章节：共享能力、依赖任务、跨端说明
  - 添加「工作清单」四阶段模板：需求确认 → 技术方案 → 开发实施 → 验收交付
  - 后端端显示「接口清单」，前端端显示「页面清单」（从 section content 提取）
  - 共享规格引用增加 `API_CONTRACT.yaml` 和 `CONTEXT.md`

- **CONTEXT.md 丰富化**（`split.ts`）：
  - 新增「跨端关联」章节，显示 FUNCTION_MAP.md 中的共享能力、依赖任务、说明

- **全局 Spec 文件列表扩展**（`spec-paths.ts`）：
  - `GLOBAL_SPEC_FILES` 新增 `FUNCTION_MAP.md` 和 `API_CONTRACT.yaml`
  - 确保 apply 路由将这两个文件正确写入 `020-specs/global/`

### 修复

- **子任务命名回归项目约定**：使用 `generateSubtaskId()` 生成 `Task-{num}-{platform}` 格式

---

## v6.69.3 (2026-08-17) — Split 命令修复：端名映射 + 子任务命名 + 内容质量

### 修复

- **端名白名单映射**（`split.ts` scope 解析）：
  - 新增 `normalizeScopePlatforms()` 函数，将 AI 返回的中文简写（如 `"后端"`、`"admin"`、`"web"`）映射到 CONSTITUTION.md 标准端名
  - 映射规则：精确匹配 → 后端模糊匹配 → 前端模糊匹配 → 关键词映射 → 保留原值
  - 解决 `web/`、`api/` 等非法端目录问题，确保生成 `admin-web/`、`booking-service/` 等正确目录

- **子任务目录命名**（`split.ts` 子任务创建）：
  - 从 `Task-004-impl` 改为 `{功能单元slug}-{端名}`，如 `approval-flow-booking-service`
  - 使用 `functionalUnit` 或 `section.name` 生成有意义的 slug，避免无意义的 "impl"

- **CONTEXT.md 位置**：
  - 从 `00-specs/CONTEXT.md` 修正为 `_shared/CONTEXT.md`（符合 AGENTS.md 规范）
  - 保留 `00-specs/CONTEXT.md` 副本供兼容

### 改进

- **Split Prompt 注入标准端名列表**：在 prompt 开头注入项目端列表，明确告知 AI 必须使用标准端名
- **Split Prompt scope/API 示例修正**：示例从 `["后端", "admin"]` 改为 `["booking-service", "admin-web"]`
- **reqContent/techContent 质量红线**：prompt 中明确要求 AI 生成具体内容，禁止模板化占位符
- **buildSplitPrompt 签名扩展**：新增 `standardPlatforms` 参数，用于 prompt 注入

---

## v6.69.2 (2026-08-17) — 文档质量加固：白名单校验 + 自检 Prompt + 自动审计

### 修复

- **端名白名单校验**（`analyze.ts` apply 阶段）：
  - JSON 多文档写入时，解析文件名中的目录前缀（如 `admin-web/TECH.md`）
  - 与 `parsePlatformList()` 返回的合法端列表比对，非法端名直接跳过并告警
  - 防止 AI 输出非法目录（如 `1001/`、`错误码/`、`.../`）导致目录结构污染

### 新增

- **强制自检清单**（`buildMultiDocPrompt` 末尾）：
  - 功能覆盖完整性检查：对比原始需求，确认无遗漏
  - 枚举值一致性检查：跨文档状态/类型枚举必须完全一致
  - 接口路径统一性检查：全局与各端接口路径、方法必须一致
  - 跨文档引用一致性检查：UI 字段映射 ↔ API 响应、TEST ↔ 验收标准、各端 ↔ 全局架构
  - 目录结构合法性检查：确认 `--apply` JSON 键名不含非法目录
- **`speccore audit --specs` 自动审计命令**：
  - 扫描 `020-specs/` 下所有 `.md` 文档
  - **目录结构检查**：检测纯数字、纯点、中文等非法目录名
  - **枚举一致性检查**：跨文档提取 `key=value` 格式枚举，标记不一致
  - **接口路径一致性检查**：对比全局 REQUIREMENT.md 与各端 TECH.md 的 API 路径和方法
  - **覆盖完整性检查**：检查 REQUIREMENT.md、API_CONTRACT.md、各端 TECH.md 是否存在
  - 输出分级报告（🔴严重 / 🟡警告 / 🟢提示）

---

## v6.69.1 (2026-08-17) — 变更感知修复：默认分支 + 分析快照

### 修复

- **对比基准修正**：`getChangedFiles()` 默认对比基准从 `HEAD` 改为 CONSTITUTION.md 配置的**默认分支**（如 `main`）
  - 新增 `getDefaultBaseRef()` 函数，通过 `loadGitConfig()` 读取配置并缓存
  - 解决 feature 分支上变更检测不准确的问题

### 新增

- **分析快照持久化**（`.speccore/cache/analysis-snapshots.json`）：
  - `recordAnalysisSnapshot(scope)` — 分析/执行完成后记录当前 commit hash、分支、时间
  - `getIncrementalChangedFiles(scope)` — 基于上次分析的 commit 做 `git diff <last>..HEAD` 增量检测
  - `readAnalysisSnapshots()` / `writeAnalysisSnapshots()` — 快照读写
  - `clearAnalysisSnapshot(scope?)` — 清除指定或全部快照
  - `getCurrentCommitHash()` / `getCurrentBranch()` — Git 信息获取
- **增量分析集成**：
  - `detectAffectedPlatforms()` 新增 `options: { scope?, incremental? }` 参数
  - `analyze.ts` Pipeline 完成时自动记录快照（scope = `global` 或 `Iteration-{name}`）
  - `execute.ts` 任务完成时自动记录快照（scope = `Task-{id}`）

---

## v6.69.0 (2026-08-17) — 三层分析策略 + 四个增强策略

### 核心功能

- **三层分析策略设计哲学**：全局层（先分后总/归纳法）、迭代层（先总后分/演绎法）、任务层（向上追溯/聚焦法）
- **四个增强策略**：
  - **契约先行**（迭代层）：Phase 1 后插入跨端 API 契约定义阶段，隔离各端分析依赖
  - **变更感知**（全局层）：Git diff 自动检测受影响端，Pipeline 仅分析变更端
  - **关键路径优先**（迭代层）：按任务优先级自动排序端，核心路径端先分析
  - **横向关联**（任务层）：执行前检查依赖任务状态和契约对齐
- **知识图谱链路补全**：
  - 从 IMPACT.md Dependencies 表格补充 `depends_on` 关系
  - 新增 `traceDependencyChain()` 递归追踪 `implements → references → depends_on` 完整链路
  - 新增 `getFullTaskContext()` 扩展版上下文查询（含上下游任务）

### 新增模块

- **change-detection.ts**（变更感知模块）：
  - `getChangedFiles()` / `getUntrackedFiles()` — Git 变更检测
  - `loadSourcePathMap()` — 读取 CONSTITUTION.md 源码路径 → 端映射
  - `detectAffectedPlatforms()` — 核心函数，自动识别受影响端
  - `detectPlatformPriorityOrder()` — 按任务优先级统计排序端

### Pipeline 引擎增强

- `createAnalyzePipeline()` 新增 `options: { affectedPlatforms?, platformOrder? }` 参数
  - `affectedPlatforms`：变更感知过滤，仅生成受影响端的步骤
  - `platformOrder`：关键路径优先排序，按优先级生成步骤顺序
- `analyze --scope global --pipeline` 接入 `createGlobalAnalyzePipeline`
- Pipeline 推进逻辑同步支持全局/迭代层双模式

### 任务执行增强

- `execute.ts` 新增 `checkCrossTaskDependencies()` 函数：
  - 检查依赖任务是否已完成
  - 检查 API_CONTRACT.yaml 中的 dependsOn 与 TaskState.dependencies 一致性
  - 检查依赖任务的契约文件是否存在

---

## v6.68.0 (2026-08-17) — Pipeline 引擎完整实现

### 核心功能

- **pipeline-engine.ts**: 完整的 Pipeline 引擎实现（状态机设计）
  - 支持多步骤流水线，每步等待 AI 通过 --apply 写回
  - 支持条件分支（如多端才执行 Phase 2）
  - 支持断点续跑（--resume）
  - 支持错误恢复和重试
  - 状态文件追踪当前步骤（.speccore/local/.pipeline-{iteration}.json）

- **analyze.ts**: 集成 Pipeline 引擎
  - 新增 `--pipeline` 选项：启用流水线模式，自动执行 Phase 1 → Phase 2
  - Prompt 模式：初始化 Pipeline 状态，输出 Phase 1 prompt + Pipeline 继续指令
  - Apply 模式：写入文件后自动推进到下一步，输出 `[SPECCORE_PIPELINE_NEXT]` 标记和 Phase 2 prompt
  - AI 看到标记后自动执行下一个命令，无需用户干预

### 工作流程

```bash
# 用户执行 Pipeline 模式
speccore analyze --prompt --pipeline -I meeting-upgrade

# CLI 初始化 Pipeline 状态 → 输出 Phase 1 prompt
# AI 生成全局文档 → --apply
# CLI 写入文件 → 自动推进到 Phase 2 → 输出 [SPECCORE_PIPELINE_NEXT] + Phase 2 prompt
# AI 看到标记 → 自动执行 Phase 2 → 生成各端文档 → --apply
# CLI 写入文件 → 标记完成 → Pipeline 结束
```

### 技术实现

- **状态机设计**: PipelineEngine 类管理步骤状态（phase1-prompt → phase1-done → phase2-prompt → done）
- **自动推进**: Apply 模式完成后检查 Pipeline 状态，自动调用 advance() 推进到下一步
- **标记机制**: 输出 `[SPECCORE_PIPELINE_NEXT]` 标记，AI 识别后自动执行下一个命令
- **条件分支**: 检测端数量，只有多端项目（≥2 个端）才执行 Phase 2

### 向后兼容

- 非 Pipeline 模式保持原有行为（输出提示信息，要求用户手动执行 Phase 2）
- 提示信息中新增 `--pipeline` 选项的使用建议

## v6.67.0 (2026-08-16) — 在 prompt 开头明确完整工作流程

### 核心修复

- **analyze.ts**: 在 Phase 1 prompt 的**最开头**就明确说明完整工作流程（两阶段分析）
- **analyze.ts**: 检测到多端项目(≥2 个端)时,在 prompt 中嵌入强制要求:"Phase 1 完成后立即执行 Phase 2"
- **analyze.ts**: 使用最强语气:"这是强制要求，不是可选操作。不要等待用户确认，直接执行上述命令。"

### 问题根因

之前的方案(v6.61.0-v6.66.0)都失败了,原因:
1. **CLI 自动输出 Phase 2 prompt**(v6.61.0-v6.64.0): AI 不读取新的 `[SPECCORE_PROMPT]`
2. **CLI 输出提示信息**(v6.65.0): AI 看不到终端 stdout 的输出
3. **prompt 结尾要求 AI 主动询问**(v6.66.0): AI 可能忽略这条指令

**根本原因**: CLI 无法控制 AI 的行为,AI 可以选择性地忽略 prompt 中的指令。

### 修复方案

**在 prompt 的最开头就明确完整工作流程**,让 AI 从一开始就知道需要执行两阶段:

```markdown
## 📋 完整工作流程（两阶段分析）

本项目检测到有 4 个端(admin-web、booking-service、h5-mobile、room-service)，需要分两阶段执行：

**Phase 1（当前阶段）**: 生成全局文档(global/REQUIREMENT.md、ANALYSIS.md、DEPS.md 等)
**Phase 2（下一阶段）**: 生成各端专属文档({端}/TECH.md、TEST.md、UI_SPEC.md 等)

## ⚠️ 强制要求：Phase 1 完成后立即执行 Phase 2

当你通过 --apply 写入所有全局文档后，**必须立即执行**以下命令进入 Phase 2：

```bash
speccore analyze --prompt -I Iteration-011-meeting-upgrade --phase 2
```

**这是强制要求，不是可选操作**。不要等待用户确认，直接执行上述命令。
```

### 关键设计原则

1. **位置优先**: 放在 prompt 的**最开头**,确保 AI 第一时间看到
2. **语气最强**: 使用"强制要求"、"必须"、"不要等待"等强制性词汇
3. **明确命令**: 直接给出完整的 bash 命令,不需要 AI 自己构造
4. **消除歧义**: 明确说明"不是可选操作",避免 AI 理解为建议

### 核心修复

- **analyze.ts**: 在 Phase 1 prompt 结尾添加明确指令，要求 AI 在通过 --apply 写入全局文档后主动询问用户是否继续 Phase 2
- **analyze.ts**: 新增提示文本："✅ Phase 1 已完成...检测到项目有 X 个端，需要继续执行 Phase 2 生成各端专属文档吗？"
- **analyze.ts**: 明确告诉 AI "不要等待 CLI 的提示信息，CLI 的输出你可能看不到。你需要主动询问用户。"

### 问题根因

v6.65.0 移除了自动输出 Phase 2 prompt 的逻辑，改为在 apply 模式完成后输出提示信息。但实际效果是：
1. CLI 确实输出了提示信息："⚠️ 请手动执行以下命令以生成各端专属文档"
2. 但 AI 在通过 --apply 写回文件后，认为任务已完成，**不会读取 CLI 的输出信息**
3. 导致 AI 直接等待用户的下一个指令，而不是继续执行 Phase 2

**根本原因**：AI 的工作流限制 —— AI 在一次命令调用完成后，不会继续读取 CLI 的输出，而是认为任务已结束。

### 修复方案

**不再依赖 CLI 的提示信息**，而是在 **prompt 中明确要求 AI 主动询问用户**：
1. 当 AI 通过 --apply 写入所有全局文档后
2. CLI 检测到项目有多个端（≥2 个端）
3. **AI 需要主动询问用户**："✅ Phase 1 已完成...需要继续执行 Phase 2 吗？"
4. 如果用户确认，AI 再执行 `speccore analyze --prompt -I <iteration> --phase 2`

### 工作流程

```bash
# Step 1: 用户执行 Phase 1
speccore analyze --prompt -I meeting-upgrade
# AI 生成全局文档，通过 --apply 写回
# AI 主动询问："✅ Phase 1 已完成，检测到项目有 4 个端，需要继续执行 Phase 2 吗？"

# Step 2: 用户确认后，AI 自动执行 Phase 2
用户输入："继续"
AI 执行：speccore analyze --prompt -I meeting-upgrade --phase 2
# AI 基于全局上下文生成各端专属文档
```

### 版本历史
- v6.61.0: 实现 CLI 自动循环机制（在 apply 模式内输出 Phase 2 prompt）→ 失败
- v6.62.0-v6.64.0: 修正 Phase 2 触发条件 → 仍然失败
- v6.65.0: 移除自动输出 prompt，改为 CLI 输出提示信息 → 仍然失败（AI 不读取）
- **v6.66.0: 在 prompt 中要求 AI 主动询问用户** ← 当前版本

### 核心修复

- **analyze.ts**: 移除 apply 模式内部自动输出 Phase 2 prompt 的逻辑
- **analyze.ts**: 改为输出明确的提示信息，指导用户手动执行 Phase 2 命令
- **analyze.ts**: 新增说明：为什么需要手动执行（apply 和 prompt 是两个独立调用）

### 问题根因

v6.61.0-v6.64.0 尝试在 apply 模式完成后自动输出 Phase 2 prompt，但实际效果是：
1. CLI 确实输出了 `[SPECCORE_PROMPT]` + Phase 2 prompt
2. 但 AI 在 apply 命令完成后认为任务已结束，不会继续读取 stdout 中的新 prompt
3. 导致会议项目只生成了 global/ 的文档，没有生成各端专属文档

**根本原因**：apply 命令和 prompt 命令是两个独立的 CLI 调用，AI 不会在 apply 命令完成后自动等待下一个 prompt。

### 修复方案

**不再尝试自动输出 Phase 2 prompt**，而是：
1. 在 apply 模式完成后，输出明确的提示信息
2. 告诉用户需要手动执行 `speccore analyze --prompt -I <iteration> --phase 2`
3. 解释为什么需要手动执行（apply 和 prompt 是独立调用）

### 工作流程

```bash
# Step 1: 用户执行 Phase 1
speccore analyze --prompt -I meeting-upgrade
# AI 生成全局文档，通过 --apply 写回
# CLI 输出提示："请手动执行以下命令以生成各端专属文档"

# Step 2: 用户确认 Phase 1 结果满意后，手动执行 Phase 2
speccore analyze --prompt -I meeting-upgrade --phase 2
# AI 基于全局上下文生成各端专属文档
```

### 版本历史
- v6.61.0: 实现 CLI 自动循环机制（在 apply 模式内输出 Phase 2 prompt）
- v6.62.0: 强化 Phase 2 强制触发保证（platforms.length > 0）
- v6.63.0: 修复 spec-ask command 引导页问题
- v6.64.0: 修正 Phase 2 触发条件（platforms.length >= 2）
- **v6.65.0: 移除自动输出 prompt，改为手动执行提示** ← 当前版本

### 核心修复

- **analyze.ts**: 修改 Phase 2 触发条件：从 `platforms.length > 0` 改为 `platforms.length >= 2`
- **analyze.ts**: 新增注释说明：单端项目不需要分阶段，global/TECH.md 本身就是该端的专属文档
- **analyze.ts**: 保留无端列表时的警告输出

### 问题根因

v6.62.0 把触发条件改为 `platforms.length > 0`，导致单端项目也会触发 Phase 2。但这是错误的：
- **单端项目**：Phase 1 生成的 global/TECH.md 本身就是该端的专属文档，不需要再生成 {端}/TECH.md（会重复）
- **多端项目**：需要分两阶段，Phase 1 生成全局文档，Phase 2 生成各端专属文档

### 修复方案

**正确的逻辑**:
```typescript
if (platforms.length >= 2) {
  // 多端项目：自动触发 Phase 2
} else if (platforms.length === 0) {
  // 无端列表：输出警告
} 
// platforms.length === 1: 单端项目，Phase 1 已完成，无需 Phase 2
```

**保证效果**:
- ✅ 多端项目(≥2 个端)：自动触发 Phase 2
- ✅ 单端项目(=1 个端)：不触发 Phase 2（避免重复）
- ✅ 无端列表(=0 个端)：输出警告，指导用户修复

---

## v6.63.0 (2026-08-16) — spec-ask command 引导页强制展示规则

### 核心修复

- **init.ts**: 在 Qoder spec-ask command 模板中添加「引导页强制展示规则」章节
- **init.ts**: 明确指导 AI:检测到 `[SPECCORE_ONBOARD: <path>]` 必须立即执行 `present_files(<path>)`
- **init.ts**: 添加两条禁止规则：❌ 禁止只说检测到而不执行、❌ 禁止用文字描述代替实际展示

### 问题根因

用户升级后首次使用 `speccore ask`，没有弹出 HTML 引导页。原因：
1. `.qoder/commands/spec-ask.md` 只有 8 行简单指令，没有引导页规则
2. AGENTS.md 虽有规则，但 AI 可能优先读取 command 文件
3. init.ts 生成的 spec-ask command 模板太简单，缺少强制性指令

### 修复方案

在 init.ts 第 910-915 行，为 spec-ask command 添加引导页规则：
```markdown
## 🚨 引导页强制展示规则

执行 `speccore ask` 后，检查 stdout 中的 `[SPECCORE_ONBOARD: <path>]` 标记：
- **如果检测到该标记，必须立即执行** `present_files(<path>)` 展示 HTML 引导页
- ❌ **禁止**只说“检测到引导页”而不执行展示动作 — 说了不等于做了
- ❌ **禁止**用文字描述引导页内容代替实际展示 — 必须让用户看到 HTML 页面
- **展示完成后**，再继续处理其他输出
```

### 用户操作

会议项目需要重新运行：
```bash
speccore init --update --tools qoder
```

这会更新 `.qoder/commands/spec-ask.md`，添加引导页规则。

然后删除旧标识：
```bash
rm .speccore/local/.ask-onboarded
```

再执行：
```bash
speccore ask "测试"
```

这次应该会弹出 HTML 引导页。

---

## v6.62.0 (2026-08-16) — Phase 2 强制触发保证机制

### 核心修复

- **analyze.ts**: 修改 Phase 2 触发条件：从 `platforms.length > 1` 改为 `platforms.length > 0`
- **analyze.ts**: 新增警告日志：如果未检测到端列表，输出明确警告和建议
- **analyze.ts**: 注释说明：即使只有 1 个端，也需要生成该端的专属文档（TECH.md、TEST.md 等）

### 问题根因

v6.61.0 的触发条件是 `if (platforms.length > 1)`，导致：
1. **单端项目不会触发 Phase 2**：但单端项目仍然需要生成该端的专属文档
2. **无端列表时静默失败**：如果 CONSTITUTION.md 没有配置端列表，CLI 不会输出任何提示，用户不知道需要手动执行 Phase 2

### 修复方案

**强制保证机制**:
```typescript
// 旧版：只有多端才触发
if (platforms.length > 1) { ... }

// 新版：只要有端就触发（无论数量）
if (platforms.length > 0) {
  // 自动触发 Phase 2
} else {
  // 输出警告，指导用户检查 CONSTITUTION.md
  logger.warn('⚠️ 未检测到端列表，请检查 .speccore/CONSTITUTION.md');
}
```

**保证效果**:
- ✅ 多端项目：自动触发 Phase 2
- ✅ 单端项目：也会触发 Phase 2（生成该端的专属文档）
- ✅ 无端列表：输出明确警告，指导用户修复

---

## v6.61.0 (2026-08-16) — CLI 自动循环执行 Phase 1 → Phase 2

### 核心修复

- **analyze.ts**: 恢复 Phase 1/Phase 2 分步逻辑，但 CLI 在 Phase 1 完成后自动触发 Phase 2
- **analyze.ts**: 在 apply 模式结尾添加检测逻辑：如果刚完成 Phase 1 且有多个端，自动输出 Phase 2 prompt
- **analyze.ts**: 新增 Phase 2 prompt 代码块（指导 AI Read Phase 1 产出并生成各端专属文档）
- **analyze.ts**: 删除 v6.60.0 的"一次性生成所有文档"逻辑

### 问题根因

v6.60.0 移除了 Phase 1/Phase 2 分步逻辑，改为一次性生成所有文档。但这导致:
1. AI Token 消耗过大(同时处理 10+ 个文档)
2. 文档质量下降(AI 注意力分散)
3. 无法充分利用"链式生成"的优势(Read 前一个文档再生成下一个)
4. 各端文档无法参考全局上下文(global/TECH.md 等)

### 修复方案

**保留分阶段的优势**:
- Phase 1: 生成全局文档(global/REQUIREMENT.md、ANALYSIS.md、DEPS.md 等)
- Phase 2: 生成各端专属文档({端}/TECH.md、TEST.md、UI_SPEC.md 等)，参考 Phase 1 产出

**但改进用户体验**:
- CLI 在 Phase 1 完成后自动检测端数量
- 如果有多个端，自动输出 Phase 2 prompt，无需用户手动执行第二次命令
- 用户只需要执行一次 `speccore analyze --prompt -I iter`，CLI 自动完成 Phase 1 → Phase 2 流转

### 工作流程

```bash
# 用户执行一次命令
speccore analyze --prompt -I meeting-upgrade

# CLI 输出 Phase 1 prompt → AI 生成全局文档 → AI 通过 --apply 写回
# CLI 检测到 Phase 1 完成 + 有多个端 → 自动输出 Phase 2 prompt
# AI 生成各端专属文档 → AI 通过 --apply 写回
# 完成！
```

---

## v6.60.0 (2026-08-16) — 移除 Phase 1/Phase 2 分步逻辑，一次性生成所有文档

### 核心修复

- **analyze.ts**: 移除 Phase 1/Phase 2 分步执行逻辑，改为一次性生成 global/ 和 {端}/ 的所有文档
- **analyze.ts**: 删除 `GLOBAL_DOCS` 和 `PLATFORM_DOCS` 常量，不再根据 phase 过滤文档
- **analyze.ts**: 删除 Phase 2 的 prompt 代码块（第 1198-1224 行）
- **analyze.ts**: 删除两阶段分析提示（第 1355-1361 行）
- **analyze.ts**: 简化 TECH.md 模板逻辑，不再区分 Phase 1/Phase 2

### 问题根因

旧版设计是分两步执行：
1. Phase 1: 生成全局文档(global/REQUIREMENT.md、ANALYSIS.md 等)
2. Phase 2: 生成各端专属文档({端}/TECH.md、TEST.md 等)

但问题是 CLI 在执行完 Phase 1 后，没有自动触发 Phase 2。AI 看到 Phase 1 完成后，认为任务已结束，不会自己继续执行 Phase 2。

这导致会议项目只生成了 global/ 的 10 份文档，但没有生成各端的专属文档。

### 修复方案

移除 Phase 1/Phase 2 的分步逻辑，让 AI 在一次执行中同时生成 global/ 和 {端}/ 的所有文档。这样用户只需要执行一次 `speccore analyze --prompt -I iter`，AI 就会：
1. 先读取需求文档和全局上下文
2. 生成 global/REQUIREMENT.md、ANALYSIS.md、DEPS.md 等全局文档
3. 同时生成 {端}/TECH.md、TEST.md、UI_SPEC.md 等各端专属文档
4. 通过 `--apply` 一次性写入所有文档

### 优势

1. **更简单**：不需要修改 CLI 逻辑来自动触发 Phase 2
2. **更高效**：AI 可以一次性看到全局上下文和各端需求，生成的文档更一致
3. **用户体验更好**：用户只需要执行一次命令，不需要多次交互

---

## v6.59.0 (2026-08-16) — analyze prompt 最强警告：禁止自创目录

### 核心修复

- **analyze.ts**: 在 prompt 最开头新增「 最高优先级警告」章节，用最强语气禁止 AI 创建额外目录和直接 Write 文件
- **analyze.ts**: 明确列出错误行为（创建 1001/、错误码/等垃圾目录）和正确行为（只使用 global/ 和 {端名}/ 目录）
- **analyze.ts**: 给出正确的目录结构示例，明确每个端目录下只有该端的专属文档

### 问题根因

旧版 prompt 虽有「禁止自创目录」指令，但放在后面，AI 可能忽略或没注意到。导致会议项目仍然创建 `1001/`、`1002/`、`错误码/` 等垃圾目录，且所有文档都写入 global/ 而非按端拆分。

### 修复方案

在 prompt 第 1137 行之后（任务标题之后）立即插入最强警告章节：
```markdown
##  最高优先级警告（违反将导致分析失败）

### ⛔ 绝对禁止创建任何额外目录
- ❌ 错误行为：创建 020-specs/1001/、020-specs/1002/、020-specs/错误码/、020-specs/工程标识/ 等垃圾目录
- ✅ 正确行为：只使用 CLI 预创建的 global/ 和 {端名}/ 目录
- ⚠️ 后果：如果创建额外目录，会导致后续 split/execute 命令找不到文件，整个工作流失败

###  绝对禁止直接用 Write 工具写文件
- ❌ 错误行为：Write("020-specs/global/ANALYSIS.md", content)
- ✅ 正确行为：必须通过 `speccore analyze --apply '{"global/ANALYSIS.md":"...","admin-web/TECH.md":"..."}' -I iter` 写入
- ⚠️ 原因：--apply 会让 CLI 自动路由文件到正确的子目录

### ✅ 正确的目录结构
```
020-specs/
├── global/          ← REQUIREMENT.md, ANALYSIS.md, DEPS.md（跨端通用）
├── admin-web/       ← TECH.md, TEST.md, UI_SPEC.md（Admin 端专属）
├── booking-service/ ← TECH.md, TEST.md（后端服务专属）
├── h5-mobile/       ← TECH.md, TEST.md, UI_SPEC.md（H5 端专属）
└── room-service/    ← TECH.md, TEST.md（后端服务专属）
```
```

---

## v6.58.0 (2026-08-16) — split prompt 按端拆分强化

### 核心修复

- **split.ts**: split prompt 中新增「错误示例 + 正确做法」对比，明确禁止跨端功能未拆分的任务命名（如 Task-116-approval-scheduler）
- **split.ts**: 强调聚合功能必须按端拆分成多个独立 Task（Task-NNN-{端名}-{功能}），每个 Task 的 scope 只包含该端

### 问题根因

旧版 split prompt 虽有「按端拆分」指令，但 AI 可能忽略或理解不清，导致跨端功能（如审批调度器、计费系统）生成单个 Task，未按端拆分。

### 修复方案

在 split prompt 第 2493-2494 行新增错误示例和正确做法对比：
```markdown
- ❌ 错误示例：Task-116-approval-scheduler（跨端功能未拆分）
- ✅ 正确做法：Task-116-approval-backend + Task-117-approval-admin + Task-118-approval-h5
```

---

## v6.57.0 (2026-08-16) — update.ts 统计逻辑修复

### 核心修复

- **update.ts**: 删除无意义的 `added/updated/cleaned` 统计变量和数组,因为 `createToolIntegrations()` 返回 `Promise<void>` 且不返回计数
- **update.ts**: 简化升级完成日志输出,直接显示「以下文件已同步到最新版本」,不再显示「命令文件内容未变化」

### 问题根因

旧版 `update.ts` 定义了 `added/updated/cleaned` 变量和对应的数组,但 `createToolIntegrations()` 没有更新这些变量,导致它们始终是 0。当用户运行 `speccore init --update --tools qoder` 时,输出显示「命令文件内容未变化(命令模板无更新)」,误导用户认为文件没有被更新。

实际上 `createToolIntegrations()` 会直接覆盖写入所有 command 文件,只是 `update.ts` 的统计逻辑是残缺的。

### 修复方案

删除所有引用 `added/updated/cleaned/addedFiles/updatedFiles/cleanedFiles` 的代码,简化日志输出为:
```
📦 以下文件已同步到最新版本:
   ✅ .agents/skills/ — Skill 全量更新
   ✅ AGENTS.md — 项目规则
   ✅ SETTINGS.md — 框架配置
   ✅ AI-RULES.md — AI 参考手册
```

---

## v6.56.0 (2026-08-16) — 全平台 command 动态路由修复

### 核心修复

- **init.ts**: `ALL_COMMANDS` 中 `spec-analyze` 的 cmd 从静态指令文本改为动态路由格式
- **init.ts**: 其他平台（Claude、CodeBuddy、Windsurf、Trae）的 command 生成逻辑也支持动态路由格式（spec-analyze/spec-dev/spec-execute/spec-split）

### 影响范围

之前只修复了 Qoder 平台，现在所有平台都使用动态路由格式：
- `.claude/commands/spec-analyze.md`
- `.codebuddy/commands/spec-analyze.md`
- `.windsurf/commands/spec-analyze.md`
- `.trae/commands/spec-analyze.md`
- `.trae-cn/commands/spec-analyze.md`
- `.qoder/commands/spec-analyze.md`

### 解决的问题

旧版静态模板导致 AI 绕过 CLI 路径路由，直接 Write 文件到 `020-specs/` 根目录。新版动态路由格式确保 AI 走 `--apply` 路径，CLI 自动路由到 `global/` 或 `{端}/` 子目录。

---

## v6.55.0 (2026-08-16) — Qoder command 动态路由修复

### 核心修复

- **init.ts**: Qoder command 模板从静态命令文本改为动态路由格式（调用 `execute_command("speccore ask '用户原话'")`），解决 AI 绕过 CLI 路径路由的问题

### 问题根因

旧版 `.qoder/commands/spec-analyze.md` 是静态模板：
```markdown
执行命令: `speccore analyze --prompt -I ${1:Q1} --type feature`
```

AI 看到后直接执行 `speccore analyze --prompt`，然后看到 CLI 输出的 `[SPECCORE_PROMPT]`。但 prompt 中虽有「禁止直接 Write」指令，AI 仍可能忽略，直接用 Write 工具写文件到 `020-specs/` 根目录，导致：
- 所有文档扁平在根目录（没有进入 `global/` 或 `{端}/`）
- 多余目录（如 `1001/`、`错误码/` 等，AI 把需求文档中的编号章节误当成目录）

新版动态路由格式：
```markdown
直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。
```

这样 AI 会调用 `speccore ask` → `speccore-router` → `execute_command("speccore analyze ...")` → CLI 输出 `[SPECCORE_PROMPT]` → AI 捕获 prompt → 走 `--apply` 路径 → CLI 自动路由到 `global/` 或 `{端}/` 子目录。

### 影响范围

- 新项目：`speccore init` 生成动态路由格式的 command 文件
- 旧项目：`speccore init --update` 更新 command 文件为动态路由格式

---

## v6.54.0 (2026-08-16) — analyze 阶段知识图谱注入修复

### 核心修复

- **unified-retrieval.ts**: 修复 `if (graph && taskId)` 条件，去掉 taskId 限制，让 analyze 阶段也能加载知识图谱上下文
- **context-builder.ts**: `buildCompactContext()` 新增无 taskId 分支，返回业务模块摘要（业务-代码映射图谱），解决 analyze 阶段看不到「业务模块 → 代码实体」关联的问题

### 效果

analyze 阶段现在会注入三层关联内容：
1. **文档 RAG** — 历史分析文档的相关片段
2. **代码切片** — 源码中相关的函数/类/接口
3. **知识图谱** — 业务模块及其关联的代码实体列表（最多 10 个模块，每模块最多 5 个代码实体）

AI 在分析需求时能看到项目中已有的业务-代码映射关系，生成的技术方案会更贴合现有架构。

---

## v6.53.0 (2026-08-16) — analyze 阶段图谱 RAG 增强 + --apply 路径强制

### 核心改进

- **analyze 阶段注入图谱 RAG 上下文**：`buildMultiDocPrompt()` 中调用 `unifiedSearch()` 检索项目知识图谱、代码索引和文档 RAG，将关联内容注入 prompt，AI 分析时可参考现有代码架构和历史文档
- **强制 AI 走 --apply 路径写文件**：修正 prompt 中「直接用 Write 工具写入即可」的错误指令，改为「必须通过 --apply 写入，CLI 自动路由到 global/ 或 {端名}/ 子目录」，解决 AI 绕过 CLI 导致文档扁平在根目录的问题

### 技术细节

- `src/commands/analyze.ts`: 新增 `unifiedSearch` + `formatUnifiedContext` 导入，在 prompt 末尾注入「项目关联上下文」章节
- `src/commands/analyze.ts`: 目录结构指令从「Write 到」改为「通过 --apply 写入，CLI 自动路由到」，新增禁止直接 Write 的警告

---

## v6.52.0 (2026-08-16) — 文档全面更新 + HTML 帮助中心补全

### 设计文档

- **DESIGN.md**: 新增 8.9「HTML 页面标记系统（present_files 协议）」章节，包含 10 个标记清单、注册点、数据流
- **DESIGN.md**: 8.8 业务-代码关联图谱补充 CONTEXT.md 端隔离说明（v6.50.2+）
- **DESIGN.md**: 版本记录补充 v6.49.15–v6.51.0 共 6 条变更日志

### 说明文档

- **README.md**: 目录结构更新为扁平端架构（v6.49.x+），移除旧的 10-backend/20-frontend 结构
- **README.md**: 知识图谱描述更新，新增 business_module 实体类型 + 业务-代码关联图谱 + 类型过滤
- **README.md**: 版本号从 v6.14.0 更新到 v6.52.0
- **command-reference.md**: 版本号从 v6.16.0 更新到 v6.52.0

### HTML 页面

- **help.ts**: 帮助中心动态页面补充 `retro`（同步与变更分类）和 `knowledge`（查看与验证分类）命令
- **speccore-help.html**: 静态模板同步补充 `retro` 和 `knowledge` 命令

---

## v6.51.0 (2026-08-16) — HTML 页面 present_files 全量覆盖 + 命令标记补全

### 新功能

- **dashboard 命令**: 新增 `[SPECCORE_DASHBOARD]` 标记，迭代看板和全局仪表盘生成后自动触发 present_files
- **retro 命令**: 新增 `[SPECCORE_RETRO]` 标记，回顾报告生成后自动触发 present_files
- **plan 命令**: 新增 `[SPECCORE_PLAN]` 标记，执行计划页面生成后自动触发 present_files

### 修复

- **speccore-router/SKILL.md**: 新增 10 个 HTML 页面标记的 present_files 指令（ONBOARD/SETUP_GUIDE/ABOUT/HELP/WELCOME/DEV/KNOWLEDGE/PLAN/RETRO/DASHBOARD）
- **spec-ask/SKILL.md**: 同步新增 10 个 HTML 页面标记
- **7 个平台 command 文件**: 全部更新为「HTML 页面强制展示」章节，覆盖所有标记
- **init.ts 模板**: spec-ask 命令模板更新，确保 `init --update` 后新项目自动继承

### 设计原则

- 所有生成 HTML 页面的命令都必须输出对应的 `[SPECCORE_*: <path>]` 标记
- AI 平台通过标记触发 `present_files` 展示，不依赖文件路径猜测

---

## v6.50.3 (2026-08-16) — 正则匹配修复 + prompt 格式统一

### 修复

- **knowledge-graph.ts**: 移除正则 `m` 标志，修复 `$` 在 multiline 模式下匹配行尾导致「业务-代码映射」章节只能匹配到标题行的 bug
- **analyze.ts**: 默认模式 prompt 缩进从 4 空格统一为 2 空格，与 Phase 2 保持一致
- **analyze.ts**: Phase 2 prompt 补充关系类型示例（api_controller/page/component 等）和表格示例

---

## v6.50.2 (2026-08-16) — CONTEXT.md 业务-代码映射端隔离

### 修复

- **context-builder.ts**: CONTEXT.md 业务-代码映射章节现在按当前端过滤，不再展示所有端的映射关系，避免前端分析时读后端的业务映射浪费 token

---

## v6.50.1 (2026-08-16) — 业务-代码映射图谱增强修复 + 文档更新

### 修复

- **context-builder.ts**: 新增「业务-代码映射」章节展示，按端分组显示业务模块及其关联的代码实体
- **speccore-knowledge-graph.html**: 新增 `business_module` 实体类型的过滤按钮、CSS 样式、类型标签

### 文档

- **DESIGN.md**: 新增 8.8 节「业务-代码关联图谱」，说明设计原则、期望格式、数据流
- **command-reference.md**: 更新 analyze 命令描述，说明链式生成使用图谱 RAG 智能检索 + 业务-代码映射

---

## v6.50.0 (2026-08-16) — 业务-代码关联图谱增强

### 新功能

- **知识图谱新增业务模块实体类型**：`business_module` 类型，支持从 TECH.md 提取业务模块→代码实体的映射关系
- **灵活扩展的关系类型**：GraphRelation.type 支持 `maps_to`、`uses_table`、`calls_api`、`affects` 等自定义关系类型，不再限制于固定枚举
- **图谱新增 `scanBusinessCodeMappings()` 扫描器**：自动扫描各端 TECH.md 中的「业务-代码映射」章节，提取业务模块实体和代码实体，建立关联关系
- **analyze prompt 增强**：指导 AI 在 TECH.md 末尾添加「业务-代码映射」表格，关系类型由 AI 根据技术栈自主决定（如 api_controller、page、component、route、middleware、interceptor、gateway 等）
- **GraphStats 新增 `businessModules` 统计**

### 设计原则

- **开放实体类型**：不预设固定类型，AI 看到什么技术栈就提取什么实体类型
- **按端隔离**：每端从自己的 TECH.md 提取，不会混
- **增量更新**：复用现有的 `refreshKnowledgeGraph()` 机制

---

## v6.49.17 (2026-08-16) — 链式生成机制修正为图谱 RAG 智能检索 + 功能模块来源链接

### 改动

- **DESIGN.md 修正链式生成描述**：从"Read 前序产出"改为"图谱 RAG 智能检索相关内容"，新增 8.7 节详细说明检索机制
- **analyze prompt: 功能模块来源链接**：表格新增「来源」列，用 Markdown 链接指向需求文档具体位置
- **analyze-engine.ts: 模板更新**：功能模块清单表格格式更新为 | # | 功能模块 | 涉及端 | 来源 | 说明 |
- **记忆更新**：修正链式生成机制描述，强调图谱 RAG 智能检索而非无脑全读

---

## v6.49.16 (2026-08-16) — analyze prompt 文件分配规则明确 + 禁止 AI 自创目录

### 改动

- **analyze prompt: 文件分配规则明确**：明确列出 global/ 只放 REQUIREMENT.md/ANALYSIS.md/DEPS.md，其余 6 个文件（TECH/TEST/UI_SPEC/RISK/REVIEW/MONITOR）放 {端名}/ 目录
- **analyze prompt: 禁止自创目录**：新增指令禁止 AI 在 020-specs/ 下创建额外子目录（如数字编号、中文名称等）
- **文档与端对应关系更新**：移除过时的 global/TECH.md 引用，改为各端专属

---

## v6.49.15 (2026-08-16) — 文档更新 + prompt 编号修复

### 改动

- **analyze prompt 编号修复**：修复步骤编号冲突（两个步骤 6），目录结构步骤改为动态编号（7 或 8）
- **DESIGN.md**：新增 8.6 节「CLI 控制目录 + AI 填内容」，包含架构设计、数据流、涉及端定义
- **command-reference.md**：更新 split 命令描述为「模块驱动拆分」

---

## v6.49.14 (2026-08-16) — split 从 global/REQUIREMENT.md 读取涉及端，按模块精确创建端目录

### 改动

- **analyze prompt: 功能模块涉及端必填**：新增第 6 步指令，要求 AI 在 `global/REQUIREMENT.md` 的功能模块清单表中必须填写「涉及端」列
- **split: 从 global/REQUIREMENT.md 解析涉及端**：新增 `parseModulePlatforms()` 函数，解析功能模块清单表的「涉及端」列，每个模块只创建涉及的端目录
- **split: 回退机制**：如果 REQUIREMENT.md 无功能模块表，回退到 `features/*/README.md`（使用全端）
- **split: 内容填充 Prompt 按模块显示涉及端**：每个任务显示其各自的涉及端，不再显示全局端列表

### 涉及端定义

- **涉及 = 该端在本模块中有新开发工作**（新接口/新页面/新逻辑）
- **不涉及 = 只是提到、调用已有接口、纯展示**
- 端名必须与 CONSTITUTION.md「端列表」中的标准端名完全匹配

### 数据流

```
analyze AI → global/REQUIREMENT.md 功能模块清单（含涉及端列）
    ↓
split CLI → 读取涉及端列 → 只创建涉及的端目录
    ↓
AI 填充 → 每个端子任务的 REQ.md + TECH.md
```

---

## v6.49.13 (2026-08-16) — CLI 控制目录结构：analyze 预创建 + split 模块驱动拆分

### 新增

- **analyze: CLI 预创建 020-specs/ 目录结构**：执行 analyze 前自动读取 CONSTITUTION.md 端列表，预创建 `global/` 和各端目录，AI 无法写错位置
- **analyze: prompt 简化**：目录结构指令从“调用 --apply”简化为“直接用 Write 工具写入预创建目录”，消除 AI 绕过 CLI 的可能
- **split: 模块驱动拆分**：新增 `tryModuleDrivenSplit()`，从 `010-requirements/features/` 读取功能模块，每个模块×端创建一个子任务，CLI 控制任务数量
- **split: 内容填充 Prompt**：模块驱动拆分后自动生成 `split-content-{iteration}.md`，AI 只需为预创建的任务填充 REQ.md/TECH.md

### 核心原则

- **CLI 控制目录（确定性操作），AI 只填内容（智能操作）**
- analyze：CLI 创建 `020-specs/global/` + `020-specs/{端}/`，AI 用 Write 写入
- split：CLI 按功能模块×端创建任务目录，AI 填充 REQ.md/TECH.md
- 任务数 = 功能模块数 × 涉及端数，不可能爆炸

---

## v6.49.12 (2026-08-16) — AGENTS.md 模板强化：新会话上下文加载 + 绝对禁止清单

### 修复

- **AGENTS.md 模板**：新增「⛔ 新会话第一步」置顶章节，强制要求先读 context.json + CONSTITUTION.md
- **AGENTS.md 模板**：新增「⛔ 绝对禁止」清单（禁止自创建迭代/禁止写脚本绕过 CLI/禁止旧目录结构/禁止代码写错位置）
- **AGENTS.md 模板**：项目结构更新为端平铺架构 + 常用命令速查
- **meeting-system 项目**：清理 3 个垃圾迭代目录 + 46 个临时文件 + 旧结构目录，重写 AGENTS.md

### 背景

新会话 AI 不读 context.json 导致不知道当前迭代，然后自己创建错误目录、写脚本绕过 CLI、把代码写到迭代目录里。通过在 AGENTS.md 顶部强制「新会话第一步」和明确「绝对禁止」清单防止此类问题。

## v6.49.11 (2026-08-16) — 知识图谱/RAG 触发时机全面审计与补全

### 修复

- **execute.ts**：主流程/恢复模式/批量模式 3 个退出路径均新增知识图谱自动刷新
- **change.ts**：新增需求创建 + 变更应用 2 个退出路径均新增知识图谱自动刷新
- **done.ts**：新增 `warnIfIndexStale` 命令前检查 + `refreshKnowledgeGraph` 命令后刷新

### 审计结果

| 命令 | 命令前检查 | 知识图谱刷新 |
|:------|:------:|:------:|
| analyze | ✅ | ✅ |
| split | ✅ | ✅ |
| execute | ✅ | ✅ 补全 |
| change | ✅ | ✅ 补全 |
| done | ✅ 补全 | ✅ 补全 |

## v6.49.10 (2026-08-16) — 知识图谱自动刷新补全

### 修复

- **analyze.ts**：主分析流程（`--apply` 模式）完成后自动刷新知识图谱
- **split.ts**：所有拆分模式（`--response`/`--strict`/`--interactive`/默认）完成后自动刷新知识图谱

### 说明

之前只有 `--feature` 和 `--doc` 局部模式会刷新知识图谱，主流程遗漏。现在 analyze → split 全链路执行后，知识图谱自动更新。

## v6.49.9 (2026-08-16) — 全面迁移端平铺架构：清理 10-backend/20-frontend 旧引用

### 核心改造

- **execute.ts**：scaffold 模式、filterByPlatform、readiness 检查、自检修复循环全部改用平铺端目录扫描，新增 `getPlatformSubtaskDirs()` 辅助函数
- **analyze.ts**：TEST.md/REVIEW.md 补全和缺失文件创建改用平铺端目录扫描，新增 `getSubtaskDirs()` 辅助函数
- **prompt-builder.ts**：平台文件加载改用平铺结构，CODEGEN_EXCLUDE_DIRS 增加 `00-specs`/`_shared`
- **status-panel.ts**：人员平台映射和健康度检查改用平铺端目录扫描，新增 `taskHasFile()` 辅助函数
- **split.ts**：注释中的路径引用更新
- **init.ts**：目录结构模板更新为端平铺架构
- **analyze.ts**：文件头注释更新

### 文档更新

- **docs/task-directory-design.md**：全面重写，反映 v6.49.x 端平铺 + 功能单元标识 + 工程路径感知架构
- **docs/DESIGN.md**：更新任务目录架构演进章节，反映 v6.40.0 → v6.49.1 变化

### 设计原则

- 所有旧结构引用保留为回退兼容代码，确保旧项目无缝过渡
- 新结构：`{platform}/{taskId}-{subtaskSlug}/` 统一所有端的子任务目录格式

---

## v6.49.8 (2026-08-16) — 项目信息表解析增强：支持工程类型列

### 修复

- **`parseProjectInfo()` 支持「工程类型」列**：`ProjectInfo` 接口新增 `projectType` 字段
- **Prompt 工程路径表增加工程类型**：execute 命令的 Prompt 中显示工程类型，帮助 AI 理解各端特征
- **动态列索引匹配**：支持「工程类型」「类型」等多种表头写法

---

## v6.49.7 (2026-08-16) — 子任务目录清理：移除无用的 src/ 和 tests/

### 修复

- **移除 `src/` 和 `tests/` 目录创建**：代码现在写入 CONSTITUTION.md 指定的实际工程路径，子任务目录中的 `src/` 和 `tests/` 不再使用
- **TASK.md 产出物表更新**：移除 `src/` 和 `tests/` 条目，新增「代码」条目，指向 CONSTITUTION.md 中定义的工程路径
- **split.ts 和 task/new.ts 同步**：两个文件都不再创建空的 `src/` 和 `tests/` 目录

---

## v6.49.6 (2026-08-16) — 工程路径感知：代码写入 CONSTITUTION 指定位置

### 核心修复

- **`parseProjectInfo()` 函数**：从 CONSTITUTION.md 解析项目信息表，返回 Map<工程标识, { projectName, srcPath, gitRepo, branch, platform }>
- **`getProjectPathForPlatform()` 函数**：根据端名获取实际工程路径，支持精确匹配和「对应端」列匹配
- **execute 命令工程路径感知**：`--response` 模式现在检查文件路径是否以端名开头，如果是则写入 CONSTITUTION.md 中定义的实际工程路径
- **prompt builder 注入工程路径**：execute 命令的 Prompt 中包含工程路径表，告诉 AI 代码应该写到哪里

### 修复的问题

- 之前代码被写入迭代目录（如 `Iteration-011/10-backend/`），而不是 CONSTITUTION.md 中定义的实际工程路径（如 `../outputs-project/backend/booking-service`）
- Git 分支逻辑失效，因为代码不在实际仓库中

---

## v6.49.5 (2026-08-16) — 子任务 ID 确定性格式

### 修复

- **子任务 ID 格式简化**：从 `{taskId}-{platform}-{hash}` 改为 `{taskId}-{platform}`，保证全项目唯一且确定
- **移除随机 hash**：不再使用 `Date.now()` 和 `Math.random()`，子任务 ID 可预测
- **唯一性保证**：每个任务每个端只有一个子任务，所以 `{taskId}-{platform}` 已经唯一

---

## v6.49.4 (2026-08-16) — 任务级功能单元标识

### 新功能

- **任务级 `.meta/feature`**：Task 目录本身也有功能单元标识（如 `Task-001/.meta/feature`），默认取 `functionalUnit` 或任务名称
- **任务级 `.meta/` 完整属性**：`feature`/`type`/`status`/`owner`/`created-at`，与子任务级保持一致
- **README.md 更新**：目录结构说明中增加 `.meta/` 目录
- **task/new 同步**：`task new` 命令也写入任务级 `.meta/feature`

---

## v6.49.3 (2026-08-16) — 子任务目录命名规则 + task/new 同步

### 修复

- **子任务目录命名规则**：`{taskId}-{subtaskSlug}`（如 `Task-001-booking-order-mgmt/`），确保多任务同平台不冲突
- **task/new 同步**：`task new` 命令也使用新平铺结构（`{端名}/{taskId}-impl/`），不再用 `10-backend/`、`20-frontend/` 前缀
- **fallback 同步**：自动补充的后端子任务也使用 `{taskId}-impl` 命名

---

## v6.49.2 (2026-08-16) — 子任务功能单元标识

### 新功能

- **`.meta/feature` 文件**：每个子任务目录下新增功能单元标识文件，默认取 AI 生成的 `functionalUnit` 或 `section.name`
- **TASK.md 增强**：子任务信息中新增「功能单元」字段，方便统计和追溯
- **fallback 兼容**：自动补充的后端子任务也包含功能单元标识

---

## v6.49.1 (2026-08-16) — 任务目录结构简化：端平铺

### 修复

- **任务目录结构简化**：不再区分前后端大类，所有端平铺在任务目录下（如 `Task-001/booking-service/impl/`、`Task-001/h5-mobile/impl/`）
- **删除冗余变量**：移除 `backendPlatforms`、`frontendPlatforms`、`getServiceName()` 等前后端分类逻辑
- **统一循环**：所有端使用同一个循环创建子任务，通过 `isBk` 判断是否后端来生成不同的文档内容

---

## v6.49.0 (2026-08-16) — 工程类型识别 + AI 智能分析

### 新功能

- **工程类型列**：CONSTITUTION.md 端列表新增「工程类型」列（如 Java服务、H5微信公众号、Android移动端）
- **AI 智能分析**：analyze 命令读取工程类型，自动应用对应的专业维度生成针对性内容
- **工程类型枚举**：Java服务/Node服务/Go服务/Python服务、H5微信公众号/H5移动端、Android/iOS移动端、微信/支付宝小程序、Web管理后台、桌面应用
- **`parsePlatformTypes()` 函数**：动态解析端列表中的工程类型列，返回 Map<端名, 工程类型>

---

## v6.48.1 (2026-08-16) — 端列表解析增强 + 列名优化

### 改进

- **`parsePlatformList()` 动态列查找**：不再硬编码第 1 列，先解析表头找到"工程标识/端名/平台名"列索引，列位置换了也能正确解析
- **列名优化**：`端名` → `工程标识`，语义更清晰（既是端的标识符，也是工程/目录名）
- **init 模板同步**：CONSTITUTION.md 模板和项目自身配置均更新为"工程标识"

---

## v6.48.0 (2026-08-16) — 后端端名识别 + 双层目录强制 + 端名一致性

### 核心修复

- **`isBackendPlatform()` 增强识别**：支持 `-service`/`-api`/`-server`/`-backend` 后缀，修复 `booking-service` 等端名被误判为前端的问题
- **split fallback 端名一致**：自动补充后端子任务时使用 CONSTITUTION.md 端列表中的实际后端端名，不再硬编码 `api/impl`
- **`GLOBAL_SPEC_FILES` 精简**：TECH/RISK/REVIEW/MONITOR 不再强制写入 `global/`，支持按端分目录（如 `020-specs/booking-service/TECH.md`）
- **analyze prompt 强制双层目录**：明确指导 AI 必须创建 `020-specs/{端名}/` 子目录，每个端单独调用 `--apply --platform`
- **code-scanner 端名一致**：`detectEndpoint()` 优先匹配 CONSTITUTION.md 端列表，回退通用模式（frontend/backend/mobile）

---

## v6.47.0 (2026-08-16) — 验证修复 + 文档补充

### Bug 修复

- **loadUserTemplates 优先级修复**：高优先级目录先写入，低优先级不覆盖（首次写入胜出）
- **冗余 require 移除**：loadUserTemplates 内部不再重复 require('fs')
- **JSON 模板格式修正**：链式生成 apply 命令的 JSON key 补全引号

### 文档补充

- **DESIGN.md**：新增第 8 章「任务级深度分析 + 用户自定义模板 + 链式生成」（v6.44-6.46 架构变更）
- **DESIGN.md 2.1**：重写为「端列表（全局权威）」，更新一一对应原则 + 端发现优先级
- **command-reference.md**：analyze 命令补充 --task 用法 + 任务级深度分析说明 + 端发现说明

---

## v6.46.1 (2026-08-16) — 端列表一致性修复

- 列名统一：「对应需求端」→「对应端」（模板 + 迁移 + 输出文本）
- 解析兼容：所有解析函数同时识别「对应端」和「对应需求端」
- 模板修正：项目信息表格默认「对应端」列填「待填写」（不再预填多个端名）
- 示例修正：多工程示例改为一一对应示范（admin-web→admin, h5-app→h5 ...)

---

## v6.46.0 (2026-08-16) — 端列表显式声明（方案 A）

### 核心变更

- **CONSTITUTION.md 增加「端列表」章节**：端名 = 工程名，一一对应，全项目唯一标识符
- **`parsePlatformList()` 共享函数**：优先读「端列表」章节，回退「对应需求端」列
- **统一端发现逻辑**：split/analyze/analyze-engine 全部优先使用「端列表」章节
- **init 模板更新**：新建项目的 CONSTITUTION.md 自动包含「端列表」章节

### 端发现优先级（统一）

```
Layer 0: CONSTITUTION.md「## 端列表」章节 ← v6.46.0+ 全局权威
Layer 1: CONSTITUTION.md「对应需求端」列 ← 旧版回退
Layer 2: 020-specs/ 子目录扫描 ← 目录回退
Layer 3: 默认 ['web']
```

### 改动文件

- `src/core/spec-paths.ts` — 新增 `parsePlatformList()`
- `src/commands/iteration/split.ts` — `detectPlatforms()` 优先用 `parsePlatformList()`
- `src/core/analyze-engine.ts` — `detectPlatformsFromConstitution()` 增加 Layer 0
- `src/commands/analyze.ts` — prompt 文本统一引用「端列表」章节
- `src/commands/init.ts` — CONSTITUTION 模板增加「端列表」章节

---

## v6.45.0 (2026-08-16) — 用户自定义模板 + 链式生成

### 核心变更

- **用户自定义模板**：`.speccore/templates/{global|iteration|task}/` 目录，用户放同名文件覆盖内置模板，放新文件追加自定义文档
- **模板查找优先级**：type/platform/ > type/ > _shared/ > 根目录自定义 > 内置模板
- **链式生成**：文档按依赖顺序逐个生成，后一个 Read 前序产出，确保文档间一致性
- **混合模式**：有用户模板时参考其结构/风格，无用户模板时 AI 根据目标自行组织

### 目录约定

```
.speccore/templates/
├── global/              ← 全局分析模板
├── iteration/           ← 迭代级分析模板
│   └── {端}/            ← 端专属模板（用户自建）
└── task/                ← 任务级分析模板
    ├── feature/         ← feature 类型
    │   └── {端}/        ← 端专属（用户自建）
    ├── bugfix/
    └── _shared/         ← 所有任务类型共享
```

---

## v6.44.0 (2026-08-16) — analyze --task 任务级深度分析

### 核心变更

- **apply 写入路径修复**：任务级规格文件从 `Task/_shared/` 统一写入 `Task/00-specs/`
- **任务级文档集覆盖**：00-specs/ 使用任务级专属文档集（REQ.md/TECH.md/TASK.md/SCHEMA.md），按任务类型区分
- **任务级深度分析 prompt**：AI Read 已有 00-specs 内容 + global/ 全局上下文 + {端}/ 专属上下文，重新生成深度分析
- **任务级模板**：每个文档都有针对性的写作要求（函数/接口/组件级别）

### 数据流完善

```
analyze (Phase 1 + 2) → 全局知识库
split (聚合度分析) → Task 目录结构 + 底料
analyze --task (深度分析) → 00-specs/ 深度文档
execute → 开发实现
```

---

## v6.43.0 (2026-08-16) — split 聚合度分析 + 任务级 spec 分析引导

### 核心变更

- **split prompt 增强：功能聚合度分析**
  - AI 拆分前先判断每个功能是「聚合的」（跨多端）还是「单端的」
  - 聚合功能按端拆分：每端一个独立 Task，共享契约写入 `_shared/API_CONTRACT.yaml`
  - 单端功能检查隐含跨端依赖，在 dependencies 中标注
- **split 完成后输出 `[SPECCORE_NEXT_STEPS]` 标记**
  - 列出每个 Task 的 `speccore analyze --task` 命令
  - 引导宿主 AI 对每个 Task 执行任务级 spec 分析
- **next-steps.ts 更新**：split 后续步骤新增 `analyze --task` 为第一步

### 数据流完善

```
analyze (Phase 1 + 2) → 全局知识库
split (聚合度分析) → Task 目录结构
analyze --task (自动引导) → 每个 Task 的 00-specs/ 文档
execute → 开发实现
```

---

## v6.42.0 (2026-08-16) — analyze 两阶段分析架构

### 核心变更

- **analyze 命令新增 `--phase` 选项**：支持两阶段分析流程
  - `--phase 1`：全局文档阶段 — 生成 REQUIREMENT.md、ANALYSIS.md、TECH.md（整体架构）、RISK.md、DEPS.md、REVIEW.md、MONITOR.md + PLATFORMS.md 端发现
  - `--phase 2`：各端专属阶段 — Read Phase 1 全局产出作为上下文，为每个端生成 TECH.md、TEST.md、UI_SPEC.md
  - 默认模式（不指定 --phase）：全量模式，prompt 中推荐分两阶段执行
- **TECH.md 双层设计**：
  - `global/TECH.md`：整体技术架构（跨端交互、中间件选型、整体分层）
  - `{端}/TECH.md`：各端专属技术方案（后端：接口+数据模型；前端：页面+组件）
- **Prompt 架构升级**：
  - Phase 1 prompt：端发现 + 全局文档撰写 + 端专业性约束
  - Phase 2 prompt：Read 全局上下文 → 逐端撰写 → 一致性检查
  - 默认模式：包含两阶段流程引导说明

### 设计理由

单次 prompt 让 AI 同时生成全局文档和各端专属文档存在循环依赖：
- global/TECH.md（整体架构）需要知道各端做什么
- {端}/TECH.md（端方案）需要对齐整体架构

两阶段分析让 Phase 2 的 AI 能真正 Read global/ 下的文档作为上下文，而不是靠“脑中记忆”。

### 相关文件

- `src/commands/analyze.ts`: `--phase` 选项 + `buildMultiDocPrompt()` 两阶段拆分
- `src/core/spec-paths.ts`: `GLOBAL_SPEC_FILES` 增加 TECH.md
- `docs/DESIGN.md`: 2.7 章节 TECH.md 双层设计说明

---

## v6.41.0 (2026-08-17) — 020-specs/ 全局文档目录重构

### 核心变更

- **新增 `src/core/spec-paths.ts`**: 全局文档路径辅助模块
  - `resolveGlobalSpecPath()`: 读取侧三级回退（global/ → 根目录 → null）
  - `globalSpecWritePath()`: 写入侧始终使用 global/，自动 ensureDir
  - `GLOBAL_SPEC_FILES`: 全局文档文件名列表
- **020-specs/ 目录结构演进**:
  - 全局文档（REQUIREMENT.md、ANALYSIS.md、RISK.md、DEPS.md、REVIEW.md、MONITOR.md）迁移到 `global/` 子目录
  - 端专属文档（TECH.md、TEST.md、UI_SPEC.md）保持在各端目录
  - PLATFORMS.md 留在根目录（元数据）
- **写入侧重构**:
  - `analyze-engine.ts`: `generateSpecsFromRequirements()` 全局文件写入 `global/`
  - `analyze.ts`: `--apply` 模式全局文档路由到 `global/`，端文档路由到 `{端}/`
  - `analyze.ts`: `generateIterationSpecDocs()` 模板文件分流到 `global/`
  - `create.ts`: 迭代创建时创建 `global/` 目录 + REQUIREMENT.md 写入 `global/`
- **读取侧重构**（全部加 backward-compatible 回退）:
  - `split.ts`: `loadSpecContents()` + `detectPlatforms()` + 第二读取点
  - `prompt-builder.ts`: 迭代规格扫描增加 `global/` 子目录
  - `dev.ts` / `status-panel.ts` / `cli.ts`: ANALYSIS.md + REQUIREMENT.md 路径回退
  - `iteration-from-global.ts`: REQUIREMENT.md 写入 `global/`
  - `ai-context-generator.ts` / `next-steps.ts`: 字符串路径引用更新
- **AI Prompt 更新**: `buildMultiDocPrompt()` 目录结构指令更新，指导 AI 写入 `global/`
- **质量审计**: `quality-audit.ts` 导入改为从 `spec-paths.ts`

### 设计原则

- 全局文档与端专属文档物理分离，结构更清晰
- 所有读取路径向后兼容，旧迭代不受影响
- 路径辅助集中管理，避免散落各处的硬编码路径

---

## v6.40.2 (2026-08-16) — 端发现机制重构 + --auto 模式 AI 化

### 核心变更

- **analyze-engine.ts**: 端检测三层架构重构
  - **删除硬编码默认端列表** `['app', 'h5', 'miniapp', 'admin']` → 返回空数组
  - **新增 Layer 2**: 技术栈标题解析 `### 中文端名 (English Name)`
  - **新增函数**: `parseTechStackHeaders()` + `buildDynamicAliasesFromTechStack()`
  - **修复 `normalizeToStandardPlatform()`**: 两阶段最长匹配策略
    - Phase 1 精确匹配，Phase 2 包含匹配，避免短别名误匹配
    - 修复「后台服务端」→ admin（应为 backend）、「移动端」→ app（应为 h5）
  - **增强 `inferPlatformFromPathOrContent()`**: 合并静态映射 + CONSTITUTION.md 动态别名
  - **表格解析修复**: 非表格行 `break` 终止（不再误读技术栈表格）

- **analyze.ts**: --auto 模式重构 + 端过滤支持
  - **--auto 不再跳过 AI**: 移除 `runAnalysis()` + `generateSpecsFromRequirements()` 调用
  - 改为设置 `options.prompt = true`，fall through 到 prompt 生成，宿主 AI 执行专业分析
  - **迭代级 --platform 过滤**: prompt 中新增端过滤指令，只生成指定端的文档
  - **AI 端发现指令**: prompt 第 5 步指导 AI 从 CONSTITUTION.md + 需求文档发现端列表
  - AI 将发现的端列表写入 `020-specs/PLATFORMS.md`

- **cli.ts**: 补注册 `--platform` 选项
  - analyze 命令的 `--platform` 选项之前在代码中实现但未在 cli.ts 注册

### 设计原则

- ✅ **端列表由 AI 判断**: CLI 只做确定性检测（表格 + 标题），不确定时交给 AI
- ✅ **--auto 必须经过 AI**: 自动模式只是不交互，不是跳过 AI
- ✅ **动态适配项目**: 不再硬编码端列表，每个项目的端由 AI 根据实际内容判断

---

## v6.40.0 (2026-08-16) — 目录层级简化 + 语义映射增强

### 核心变更

- **split.ts**: 任务目录结构简化（v6.40.0+）
  - **去掉 `10-backend/` 和 `20-frontend/` 类型前缀层级**
  - 直接使用工程名：`{服务名}/{子任务}/` 和 `{端名}/{子任务}/`
  - README 模板同步更新，标注 v6.40.0+ 简化架构
  - **效果**：目录层级从 3 层减少到 2 层，结构更扁平

- **analyze-engine.ts**: 智能端识别增强（v6.39.1+）
  - **新增 `PLATFORM_ALIAS_MAP` 语义映射表**
  - 支持中文端名到标准端名的自动映射
  - 例如：`H5 移动端` → `h5`、`后台管理端` → `admin`、`后端` → `backend`
  - 输出日志：`🔄 语义映射: "H5 移动端" → "h5"`

- **DESIGN.md**: 新增「2.5 端名语义映射与目录层级简化」章节
  - 详细描述语义映射的工作原理和别名列表
  - 对比旧架构（3层）vs 新架构（2层）的目录结构
  - 说明设计原则：扁平化优先、语义清晰、向后兼容

### 技术亮点

- ✅ **目录结构更扁平**：减少一个层级，提升导航效率
- ✅ **零配置智能识别**：中文端名自动映射，无需手动统一
- ✅ **向后兼容**：execute.ts 已有回退逻辑，旧任务不受影响

---

## v6.39.0 (2026-08-15) — 智能端识别 + 双层架构完善

### 核心变更

- **analyze-engine.ts**：实现智能端识别机制，自动推断需求文档所属的端
  - **三层推断逻辑**：
    1. 文件路径推断（优先级最高）：`app/REQUIREMENT.md` → app 端
    2. 文件内容推断：扫描前 50 行匹配 `## APP 端需求` 等标题
    3. 智能默认策略：REQUIREMENT.md / INDEX.md / PRD.md → 跨端通用文档
  - **数据隔离保证**：端专属文档不加入全局分析，避免污染
  - **新增函数**：`inferPlatformFromPathOrContent()`、`splitContentByPlatform()`
  - **修复问题**：合并端专属文件内容到 `platformContents`，确保端专属文档能正确生成
  
- **DESIGN.md**：新增「2.4 智能端识别与双层架构」章节
  - 详细描述三层推断机制的工作原理
  - 绘制数据处理流程图
  - 说明双层架构生成规则和数据隔离保证
  - 标注关键实现位置和函数签名

- **版本记录表**：补充 v6.35.0-v6.37.0 的双层架构演进历程

### 技术亮点

- ✅ **零配置智能识别**：无需用户手动标注，AI 自动从文件名/路径/内容推断
- ✅ **数据隔离保证**：端专属内容与全局内容严格分离，避免交叉污染
- ✅ **友好降级策略**：无法识别时给出明确提示和填充指引
- ✅ **完整设计文档**：所有改造都有详细的设计说明和代码示例

---

## v6.38.0 (2026-08-15) — 设计文档补充 + 代码同步

### 核心变更

- **DESIGN.md**：新增「2026-08-15 analyze 按端生成专属文档 + split 智能拆分」章节，详细记录 v6.31.0-v6.37.0 的架构改造
  - analyze --auto 双层文档架构（全局+各端分离）
  - REQUIREMENT.md 功能涉及端标注
  - analyze --prompt 目录结构指导
  - split 端推断逻辑重构（三级优先级）
  - split 读取各端子目录文档（双层读取）
  - 路径适配策略（新路径优先 + 旧路径回退）
  - 完整数据流示例
- **版本记录表**：新增 v6.31.0-v6.37.0 共 7 个版本的变更记录

## v6.37.0 (2026-08-15) — split 读取各端子目录文档 + 优先提取端专属内容

### 核心变更

- **split.ts**：`loadSpecContents()` 重构为读取「根目录全局文档 + 各端子目录文档」
  - 根目录：TECH.md、TEST.md、RISK.md、DEPS.md、MONITOR.md、ANALYSIS.md、REQUIREMENT.md、UI_SPEC.md
  - 各端子目录：`{端}/TECH.md`、`{端}/TEST.md`、`{端}/UI_SPEC.md`
  - 用平台前缀区分：`admin/TECH.md` → key 为 `'admin/TECH.md'`
- **split.ts**：`extractTaskTechContent()` 优先读取对应端的 TECH.md，回退到根目录 TECH.md（兼容旧结构）

## v6.36.0 (2026-08-15) — analyze 标注功能涉及端 + split 按端智能拆分

### 核心变更

- **analyze-engine.ts**：`buildRequirementSpec()` 在功能模块清单新增「涉及端」列，默认填「_待 AI 标注_」，供后续 AI 或人工补充
- **split.ts**：`createTaskFromSection()` 重构端推断逻辑：
  - 优先使用 AI 标注的 `_scopePlatforms`
  - 否则从 `020-specs/{端}/TECH.md` 是否有实质内容推断该功能是否涉及该端
  - 都没检测到时回退到所有端（兼容旧行为）

## v6.35.0 (2026-08-15) — analyze --auto 按端生成专属文档（全局+各端分离）

### 核心变更

- **analyze-engine.ts**：`generateSpecsFromRequirements()` 重构为「全局文档 + 各端专属文档」双层架构
  - **全局文档**（跨端通用）：REQUIREMENT.md、ANALYSIS.md、DEPS.md、RISK.md、MONITOR.md、REVIEW.md
  - **各端专属文档**：在 `020-specs/{端}/` 下生成 TECH.md、TEST.md、UI_SPEC.md（仅前端）
  - 新增 `buildTechSpecForPlatform()`、`buildTestSpecForPlatform()`、`buildUISpecForPlatform()` 三个按端构建函数
  - 新增 `isBackendPlatform()` 辅助函数判断后端平台

## v6.34.0 (2026-08-15) — split/prompt-builder/knowledge-graph 适配端级目录新路径

### 核心变更

- **split.ts**：`loadSpecContents()` 从 `020-specs/{端}/` 读取端级分析文档（兼容旧路径 `020-specs/platforms/{端}/`），解决 analyze 按端分目录后 split 读不到端级内容的问题
- **prompt-builder.ts**：端级规格文件路径从 `020-specs/platforms/{端}/` 改为优先 `020-specs/{端}/`，旧路径回退
- **knowledge-graph.ts**：知识图谱扫描从 `020-specs/platforms/{端}/` 改为 `020-specs/{端}/`，旧路径回退

## v6.33.0 (2026-08-15) — analyze prompt 增加目录结构指导

### 核心变更

- **analyze.ts**：`--prompt` 模式新增「目录结构」步骤（第 5 步），明确要求 AI 按端创建子目录（`020-specs/{端名}/`），而非全部扁平放在根目录
  - 从 CONSTITUTION.md 读取端列表
  - 每个端目录下写入该端专属分析文档
  - 根目录只放跨端通用文档

## v6.32.0 (2026-08-15) — 引导页强制展示修复（全平台）

### 核心变更

- **speccore-router/SKILL.md**：`[SPECCORE_ONBOARD]` 处理规则从条件式（"支持 present_files 的平台 → 展示"）改为强制式（"**立即执行** present_files"），消除 AI 选择性忽略的漏洞
- **7 个平台 spec-ask.md**（.claude/.codebuddy/.cursor/.qoder/.trae/.trae-cn/.windsurf）：新增「引导页强制展示」章节，与 SKILL.md 规则同步
- **init.ts**：spec-ask 命令模板新增引导页强制展示规则，确保 `speccore init --update` 后新项目也能正确展示

## v6.31.0 (2026-08-15) — CONSTITUTION 升级章节对比 + update 同步清单增强

### 核心变更

- **init.ts**：`checkUpgradeHints` 新增通用章节对比逻辑 — 检测新版 CONSTITUTION.md 模板中新增的章节（项目信息/技术栈/命名规范/异常码体系/Git 分支策略），提示用户补充缺失章节
- **init.ts**：清理废弃的 `generateConstitutionTemplate()` 函数（已被模板文件替代）
- **update.ts**：命令文件无变化时，显示已同步文件清单（skills/AGENTS.md/SETTINGS.md/AI-RULES.md），用户可直观确认同步状态

## v6.30.0 (2026-08-15) — 全链路路径一致性修复 + CONTEXT.md 路径迁移

### 核心变更

- **spec-merger.ts**：5 处 `_shared/` 主路径统一改为 `readTaskSpecByFilename`（`00-specs/` 优先，`_shared/` 回退）
- **context-output.ts**：`backend/` 旧路径改为 `00-specs/` 优先 + `backend/` 回退
- **status-panel.ts**：平台检测适配 `10-backend/` + `20-frontend/` 新目录名，保留旧结构回退
- **split.ts**：CONTEXT.md 写入路径从 `_shared/` 迁移到 `00-specs/`
- **rag-engine.ts**：RAG 索引候选路径新增 `00-specs/CONTEXT.md`，`_shared/CONTEXT.md` 降为回退

## v6.29.0 (2026-08-15) — 文件即记忆 + [SPECCORE_CONTINUE] 自动续批机制

### 核心变更

- **execution-state.ts**：新增 TaskSummary 接口 + addTaskSummary/generateContextSummary/writeContextSummaryFile
  - 每个任务完成后写入摘要（任务名/类型/产出/依赖）
  - 批次结束时生成紧凑上下文摘要（~1K tokens），写入 `.speccore/local/execution-summary.md`
  - 新会话只需读取摘要文件即可快速恢复全局视角
- **execute.ts**：processBatch 中每个任务完成后记录摘要；批次结束写入摘要文件
  - prompt 模式批次完成时输出 `[SPECCORE_CONTINUE: <path>]` 标记（替代 `[SPECCORE_BATCH_COMPLETE]`）
- **AGENTS.md + init.ts**：标记表更新为 `[SPECCORE_CONTINUE: <path>]`
- **spec-execute SKILL.md**：批次执行步骤 3 更新为自动续批流程
- clearExecutionState 同时清除摘要文件

## v6.28.0 (2026-08-15) — task/new + next-steps + spec-merger 路径适配三级嵌套

### 核心变更

- **task/new.ts**：手动新建任务全面适配三级嵌套目录结构
  - `_shared/` → `00-specs/`（核心规格写入路径）
  - 删除 `99-artifacts/` 创建
  - `backend/` → `10-backend/api/impl/`（含 .meta/src/tests/TASK.md）
  - `frontend/` → `20-frontend/web/impl/`（含 .meta/src/tests/TASK.md）
  - research 类型跳过平台子任务目录
- **next-steps.ts**：lifecycle 阶段提示从 `99-artifacts/TEST.md` 改为「子任务目录/TEST.md」
- **spec-merger.ts**：readTaskSpecByFilename 路径优先级修正为 `00-specs/` > `_shared/` > `99-artifacts/`

## v6.27.1 (2026-08-15) — 子任务目录名去除数字前缀

### 核心变更

- **split.ts**：子任务目录名从 `01-{slug}` 改为 `{slug}`（如 `login-api/` 而非 `01-login-api/`）
- **prompt-builder.ts**：加载子任务文件改为动态扫描服务目录下第一个子任务，不再硬编码 `01-impl`

## v6.27.0 (2026-08-15) — 三级嵌套关联修复：全链路路径适配

### 核心变更

- **verify-engine.ts**：质量门禁（TEST.md/REVIEW.md/DEPLOY.md）扫描子任务目录，报告写入任务根目录
- **execute.ts**：verify 流程、合规检查、质量门禁全部扫描子任务目录；`_shared/` 路径优先级调整为 `00-specs/` 优先
- **analyze.ts**：文档补全（TEST.md/REVIEW.md/RISK.md/DEPS.md/MONITOR.md）扫描子任务目录
- **retro.ts**：VERIFY_REPORT.md 查找路径适配（任务根优先，99-artifacts/ 回退）
- **knowledge-graph.ts**：知识图谱扫描逻辑适配三级嵌套（scanTasks + scanTaskSpecs 两处）
- **init.ts + create.ts**：目录树模板更新为三级嵌套结构
- 所有修改均保留旧结构回退，兼容已有项目

## v6.26.0 (2026-08-15) — 任务目录三级嵌套 + 任务类型差异化

### 核心变更

- **任务目录三级嵌套**：从扁平的 `10-{端}/` 改为 `10-backend/{服务名}/{子任务}/` 三级嵌套
  - 第一层：前后端大类（`10-backend/` / `20-frontend/`）
  - 第二层：端/服务（`api/` / `h5/` / `admin/`）
  - 第三层：子任务（`01-xxx/` — 真正执行单元）
- **任务类型差异化**：
  - **feature/bugfix/refactor**：完整三级嵌套，前后端分开 → 各端 → 各子任务
  - **research**：无前后端分层，直接产出调研文档（RESEARCH.md + COMPARISON.md）
- **split.ts 重构**：平台分类为后端/前端，创建三级目录结构；research 类型跳过平台目录
- **execute.ts 适配**：扫描 `10-backend/*/` 和 `20-frontend/*/` 下的子任务目录，保留旧结构回退
- **rag-engine.ts 修复**：`indexTaskDocuments` 候选路径更新为新结构，动态扫描子任务文档
- **prompt-builder.ts 修复**：`loadExtraSpecs` 路径更新；`loadAllTaskContext` 排除规则正确匹配大类目录
- **AGENTS.md 更新**：目录结构文档反映三级嵌套 + research 类型

## v6.25.0 (2026-08-15) — 子任务重构：子任务成为真正的工作单元

### 核心变更

- **任务目录结构根本性重构**：父 Task 从"执行单元"变为"功能模块分组"，子任务成为真正的工作单元
  - **父任务（Task-NNN-slug）**：只保留共享内容（`00-specs/` + `_shared/` + `.issues.md`）
  - **子任务（10-{服务名}/、20-{端名}/）**：每个子任务有独立的 `.meta/`（type/status/owner）、`git-config`、`TASK.md`、`src/`、`tests/` + 执行产出文档（TEST/RISK/DEPS/MONITOR/REVIEW/DEPLOY/ERROR_CODES/ADR）
  - **删除 `99-artifacts/`**：执行产出文档移到各子任务目录下
  - **删除父任务级 `.meta/`**：元信息移到各子任务目录下
- **split.ts 重构**：平台循环改为子任务循环，每个子任务独立生成完整文档集
- **execute.ts 适配**：扫描 `10-*/`/`20-*/` 目录替代硬编码的 `10-backend/`/`20-frontend/`
- **AGENTS.md 更新**：目录结构文档反映新设计

## v6.24.0 (2026-08-15) — split 任务目录结构标准化

### 核心变更

- **split 命令目录结构对齐设计**：修复 split 生成的 Task 目录不符合 AGENTS.md 设计的问题
  - 新增 `00-specs/` 目录：REQ.md、TECH.md、SCHEMA.md、CHANGELOG.md 从 `_shared/` 移入
  - `_shared/` 精简为共享契约：仅保留 `API_CONTRACT.yaml` + `CONTEXT.md`
  - 平台目录加数字前缀：`backend/` → `10-backend/`，`{端}/` → `20-frontend/{端}/`
  - README 模板同步更新，反映新目录结构
- **向后兼容**：execute.ts 已有 `_shared/` → `00-specs/` 的回退逻辑，旧任务不受影响

## v6.23.0 (2026-08-15) — 全局层目录精简 + PROJECTS/BASELINES 废弃

### 核心变更

- **GLOBAL/ 目录精简**：删除 7 个空模板文件 + 3 个空目录，只保留三层核心结构
  - 删除：`OVERVIEW.md`、`ARCHITECTURE.md`、`TECH_STACK.md`、`CODE_INDEX.md`、`PROTOTYPE_INDEX.md`、`CHANGELOG.md`（全部空占位，从未被填充）
  - 删除：`PROJECTS/` 整个目录（含 `_template/`、3 个空子目录）
  - 删除：`REQUIREMENTS/`、`BASELINES/` 空目录
  - 保留：`INDEX.md`（导航入口）+ `GLOSSARY.md`（术语表）+ `synthesis/` + `platforms/`
- **INDEX.md 重写**：从复杂的需求索引表简化为清晰的导航入口（指向 synthesis/ 和 platforms/）
- **analyze prompt 统一**：`PROJECTS/{工程}/` → `platforms/{端}/`，与 synthesize 产出路径一致
- **prompt-builder 清理**：去掉根目录空文件的读取，FILE_DESC 只保留 synthesis/ 实际生成的文件
- **修复重复条目**：analyze prompt 中 ERROR_CODES/DEPENDENCY_GRAPH/CODE_INDEX 各出现两次，删除重复

### 修改文件

- `src/commands/init.ts` — 删除 ~340 行空模板创建代码，重写 INDEX.md，删除 BASELINES ensureDir
- `src/core/prompt-builder.ts` — 去掉根目录 ARCHITECTURE/TECH_STACK 读取，清理 FILE_DESC，删除 PROJECTS TOC 分组
- `src/commands/analyze.ts` — PROJECTS/{工程}/ → platforms/{端}/，删除重复条目
- `src/commands/global-status.ts` — 更新路径显示
- `src/commands/import.ts` — 更新路径引用和日志输出
- `src/commands/iteration-from-global.ts` — 更新模板文本

### 精简后的 GLOBAL 结构

```
.speccore/GLOBAL/
├── INDEX.md                ← 全局知识库导航入口
├── GLOSSARY.md             ← 跨项目统一术语表
├── synthesis/              ← 跨端综合文档（synthesize Phase 2 生成）
│   ├── ARCHITECTURE.md     ← 全量技术架构
│   ├── TECH_FULL.md        ← 全量技术方案
│   └── CROSS_PLATFORM.md   ← 跨端关系图
└── platforms/              ← 各端分析文档（synthesize Phase 1 / analyze 生成）
    └── {端名}/             ← 如 admin/ h5/ backend/
```

---

## v6.22.0 (2026-08-15) — 需求目录精简 + 原型提升为顶层目录

### 核心变更

- **010-requirements/ 目录精简**：
  - 删除 `assets/screenshots/`、`assets/designs/` — 代码零引用，无用
  - `assets/prototypes/` 提升为顶层 `prototypes/` — 原型（HTML/图片/链接，内容不限）
  - `assets/` 仅保留 `extracted/` 子目录 — doc2spec 提取的图片
  - `assets/images/` 合并到 `assets/extracted/` — Excel 图片提取路径统一

- **analyze 原型读取增强**：
  - analyze prompt 更新：需求文档中链接到原型的，必须主动 Read 该原型文件
  - analyze-engine.ts 排除列表加入 `prototypes`，避免被误识别为 feature 目录

- **模板同步更新**：init.ts、create.ts、AGENTS.md 所有目录结构描述统一更新

### 新目录结构

```
010-requirements/
├── sources/        ← 原始 PRD 存档
├── converted/      ← doc2spec 转换后的 MD（各端文档）
├── features/       ← 变更/补充需求
├── prototypes/     ← 原型（HTML/图片/链接，内容不限）
└── assets/
    └── extracted/  ← doc2spec 提取的图片
```

---

## v6.21.0 (2026-08-15) — synthesize 架构重构：Phase 2 直接读 PRD + Phase 3 改为索引生成

### 核心变更

- **Phase 2 重构**：从读取 Phase 1 分析结果改为直接读取 PRD 原文
  - 输入源：converted/ + REQUIREMENT.md + features/
  - Prompt 从"分析"改为"提取"：明确标注"提取，不是推断"
  - 提取目标：接口映射表、共享数据模型、数据流向图、跨端调用关系图、端专属功能清单
  - Phase 2 不再依赖 Phase 1，可独立运行

- **Phase 3 简化**：从"功能单元合成"改为"生成全局索引"
  - 删除 152 行合并逻辑（runPhase3 + buildPhase3Prompt）
  - 新增 generatePhase3Index()：生成 GLOBAL/INDEX.md
  - 索引内容：工程列表 + 各端分析文档 + 跨端综合文档 + 原始需求文档导航 + 使用指南

### 架构改进

**之前**：
```
PRD → Phase 1（逐端分析）→ Phase 2（分析 Phase 1 结果）→ Phase 3（合并为 REQUIREMENT.md）
```

**现在**：
```
PRD ─┬→ Phase 1（逐端专业分析）→ GLOBAL/platforms/{端}/
     └→ Phase 2（直接提取跨端关系）→ GLOBAL/synthesis/
     └→ Phase 3（生成索引）→ GLOBAL/INDEX.md
```

### 设计原则

- **提取优于推断**：Phase 2 从 PRD 直接提取已有信息，不做二次分析
- **端独立性**：各端文档保持独立，不强行合并不同端的差异化功能
- **索引导航**：Phase 3 生成索引供 AI 导航，而非合并文档

## v6.20.0 (2026-08-15) — 全链路端专业性提示词优化 + 模板补全

### 新增

- **4 个缺失模板补全**: TEST-template.md / REVIEW-template.md / MONITOR-template.md / UI_SPEC-template.md
  - TEST: 后端接口测试 + 前端页面测试 + E2E 测试 + 四态测试（加载/空/错误/边界）
  - REVIEW: 按端分章节（后端安全/事务/性能 + 前端兼容/体验/性能）
  - MONITOR: 后端指标(QPS/延迟/错误率) + 前端指标(FCP/LCP/CLS/JS错误率) + 告警分级
  - UI_SPEC: 路由表 + 组件清单 + 字段→UI 映射 + 状态枚举 + 交互设计 + 响应式适配

### 修复

- **端分类 Bug**: `classifyPlatform('app-android')` 被误判为后端 → 前端关键词优先匹配
- **execute 提示词纯后端导向**: 新增前端代码生成指引（字段→UI 映射/路由/状态枚举/四态/响应式）

### 优化

- **analyze 端专业性约束对齐 synthesize Phase 1**: 后端/Web管理端/H5/小程序各有独立的必含内容清单
- **REQUIREMENT.md 写作提示**: 新增各端差异化需求说明
- **ANALYSIS.md 写作提示**: 新增按端分析 + 跨端关联要求
- **REVIEW.md 写作提示**: 按端分章节（后端安全/事务 + 前端兼容/体验）
- **MONITOR.md 写作提示**: 后端指标 + 前端 Core Web Vitals + 告警分级
- **templateMap 引用补全**: TEST/REVIEW/MONITOR/UI_SPEC 都有明确的前端模板引用指引

---

## v6.19.0 (2026-08-15) — 端专业性质量保障体系

### 新增

- **质量核验系统 (quality-audit.ts)**: AI 生成 Spec 文档后自动检查各端内容完整性
  - 后端检查: API 接口定义、请求/响应字段、数据模型、业务规则、错误码
  - 前端检查: 页面路由、组件清单、字段→UI 映射、状态枚举、交互设计、响应式适配
  - 通用检查: 内容充实度、文档结构化、占位符检测、表格使用
  - 输出 `QUALITY_AUDIT.md` 质量报告，含评分、修复建议、推荐修复轮次
- **`--audit-fix` 选项**: 读取质量审计报告并生成修复指令，最多 2 轮自动修复
  - 用法: `speccore analyze -I <迭代> --audit-fix --prompt`
- **前端专属模板 (TECH-FRONTEND-template.md)**: 覆盖页面路由、组件设计、状态管理、请求封装、样式方案、构建部署、字段→UI 映射

### 优化

- **writePerPlatform 按端提取**: 不再将同一份报告原封不动写到所有端目录，改为按端关键词提取差异化内容
- **analyze prompt 端专业约束**: 新增“端专业性约束”章节，明确要求后端必须有 API/数据模型，前端必须有页面/组件/字段映射
- **validate 端针对性检查**: 验证时检查后端 TECH.md 是否含 API 定义和数据模型，前端 TECH.md 是否含字段映射和状态枚举

---

## v6.18.4 (2026-08-15) — 批次执行默认开启

### 变更

- **Prompt 模式默认分批执行**: 多任务时自动输出批次元数据（默认 3 任务/批），无需手动指定 `--batch-size`
- 批次完成时输出 `[SPECCORE_BATCH_COMPLETE]` 信号 + 下一任务命令
- 单任务时不输出批次信息（无额外开销）

---

## v6.18.3 (2026-08-15) — Prompt 瘦身：分阶段加载

### 优化

- **代码生成阶段排除自检文件**: `loadAllTaskContext` 全量兜底时排除 TEST.md / SCHEMA.md / REVIEW.md / CHANGELOG.md / DEPLOY.md / .issues.md 以及 99-artifacts/ 目录
- **每任务 prompt 减少 ~3-5K tokens**: 自检/审查/产出文件留到 verify 阶段加载，代码生成阶段只加载必需上下文
- **效果**: 7 个任务的项目可能一个对话就能完成（优化前 6 个任务就溢出）

### 涉及文件

- `src/core/prompt-builder.ts` — `loadAllTaskContext` 新增 `CODEGEN_EXCLUDE_DIRS` + `CODEGEN_EXCLUDE_FILES` 排除列表

---

## v6.18.2 (2026-08-15) — AI 模式批次执行 + 任务状态追踪

### 新增功能

- **`--list-pending` 列出待执行任务**: 输出 JSON 格式任务清单（拓扑排序 + 批次分组），便于宿主 AI 获取完整任务列表
- **`--batch-size` 批次元数据**: prompt 模式中输出批次信息（当前批次/总批次/下一任务），批次完成时输出 `[SPECCORE_BATCH_COMPLETE]` 信号指导宿主 AI 开新对话
- **任务状态自动追踪**: prompt 模式执行前标记 `in_progress`，response 写入后标记 `completed`（通过 `.meta/status` 文件）

### 解决什么问题？

AI 模式（`execute --prompt`）在同一对话中执行多个任务时，上下文会累积导致溢出。批次执行通过：
1. 每批 3 个任务（可配置）
2. 批次完成后提示开新对话
3. 新对话从断点继续

### 涉及文件

- `src/commands/execute.ts` — 新增 `listPendingTasks()` + `runPromptMode` 批次元数据 + 状态追踪
- `src/cli.ts` — 新增 `--list-pending` 选项
- `AGENTS.md` — 新增 `[SPECCORE_BATCH_COMPLETE]` 标记 + 批次执行约束
- `.agents/skills/spec-execute/SKILL.md` — 新增批次执行模式指南

---

## v6.18.1 (2026-08-15) — 修复 execute --prompt 模式分支创建

### 问题修复

- **execute --prompt 模式现在会创建任务分支**: 原来 AI 模式（--prompt/--response）不创建分支，所有代码写在当前分支。现在与直接执行模式保持一致，每个任务创建独立分支，并告诉 AI 在哪个分支上工作
- **依赖合并**: AI 模式也支持依赖任务分支合并（串行依赖时从上个任务分支拉取）

### 涉及文件

- `src/commands/execute.ts` — runPromptMode 新增 prepareTaskBranch 调用 + prompt 追加分支信息

---

## v6.18.0 (2026-08-15) — 自动化流水线防阻塞 + 保护分支统一检查

### 流水线防阻塞修复

- **split --force 防阻塞**: `isInteractive` 增加 `&& !options.force`，修复 dev --auto 流水线因 TTY 继承导致 split 进入交互模式阻塞的问题
- **pr --force 非交互自动提交**: 新增 `--force` 模式，自动 `git add -A` + commit + push，无需用户交互
- **pr 保护分支统一检查**: 3 处硬编码 `branch !== 'main' && branch !== 'master'` 替换为 `isProtectedBranch()`，与 CONSTITUTION.md 配置保持一致（支持 release/* 等通配符）

### 保护分支自动迁移

- **CONSTITUTION.md 模板完善**: 新建时即包含「保护分支: main, master, release/*, production」配置行
- **升级自动迁移**: `checkUpgradeHints()` 新增检测：有「Git 分支策略」章节但缺「保护分支」配置时，自动在「发布分支」行后追加保护分支配置
- **三层防护闭环**: 配置声明（CONSTITUTION.md）→ 运行时校验（isProtectedBranch）→ Git Hook 拦截（pre-commit/pre-push）

### 涉及文件

- `src/commands/iteration/split.ts` — isInteractive 增加 `&& !options.force`
- `src/commands/pr.ts` — 新增 --force 模式 + 3 处硬编码替换为 isProtectedBranch()
- `src/commands/dev.ts` — pr 阶段改用 `pr --force`
- `src/commands/init.ts` — 模板补充保护分支行 + checkUpgradeHints 新增保护分支迁移检测

---

## v6.17.0 (2026-08-15) — 流程链路修复：analyze --auto 生成全套 Spec 文件

### P0 修复：analyze --auto 全流程数据流修复

- **analyze --auto 现在生成全套 Spec 文件**: 原来只生成 ANALYSIS.md，其他 spec 文件（TECH/TEST/REVIEW/RISK/DEPS/MONITOR/REQUIREMENT）保持空模板。现在 analyze --auto 会从需求内容中提取 API、功能模块、数据模型、业务规则等结构化信息，自动生成有实质内容的 spec 文件
- **新增 `generateSpecsFromRequirements()` 函数**: analyze-engine.ts 新增 438 行，包含信息提取（API/功能/数据模型/业务规则）+ 7 个 Spec 文件内容构建器
- **智能覆盖策略**: 已有实质内容的文件不会被覆盖（>50 非模板字符即跳过），空模板会被替换为有内容的版本
- **数据流完整打通**: init → analyze --auto（生成全套 spec）→ split（从 spec 提取内容填充任务文件）→ execute

### P1 修复：文档内容质量

- **ANALYSIS.md 去重**: 修复 scanCompleteness() 在多文档内容重复时产生重复告警的问题（同一 message 只保留首次出现）
- **doc2spec 文件名修复**: 未指定 --platform 时，输出文件名从 `requirementsrequirements.md` 修正为 `requirements.md`

### P2 修复：流水线与文档

- **dev 流水线内容验证**: doc2spec 阶段检查需求文档是否有实质内容（不是空文件）；analyze 阶段检查 TECH.md 是否有实质内容（不只是空模板），否则重新执行分析
- **command-reference.md**: schedule 命令标记为已废弃，analyze 命令新增 --full/--auto 说明，sync 命令新增 --global 说明
- **spec-layers.md**: synthesize 引用更新为 analyze --full
- **knowledge-base-design.md**: sync-global 引用更新为 sync --global
- **quick-start.md**: schedule 章节标记为已废弃，引导至 WorkBuddy Automations
- **about.ts**: sync-global 引用更新为 sync --global

### 涉及文件

- `src/core/analyze-engine.ts` — 新增 generateSpecsFromRequirements + 信息提取 + 7 个 Spec 构建器 + scanCompleteness 去重
- `src/commands/analyze.ts` — --auto 模式调用 generateSpecsFromRequirements
- `src/commands/dev.ts` — doc2spec/analyze 阶段内容验证
- `src/commands/doc2spec.ts` — 修复 requirementsrequirements.md 文件名异常
- `src/commands/about.ts` — sync-global → sync --global
- `docs/command-reference.md` — schedule 废弃 + analyze/sync 新选项说明
- `docs/spec-layers.md` — synthesize → analyze --full
- `docs/knowledge-base-design.md` — sync-global → sync --global
- `docs/quick-start.md` — schedule 废弃

---

## v6.16.0 (2026-08-15) — 命令整合优化

### 重构：命令合并与精简

- **synthesize → analyze --full**: synthesize 保留为向后兼容别名，主入口统一为 `analyze --full`
- **sync-global → sync --global**: sync 命令新增 `--global` 选项，sync-global 保留为别名
- **tracker → track**: tracker 标记为向后兼容别名，统一使用 track
- **arch-update → update --arch**: update 命令新增 `--arch` 选项，arch-update 保留为别名
- **schedule 废弃**: 定时调度已由 WorkBuddy Automations 替代，保留命令注册但标记为废弃

### ask 引擎更新

- analyze KB 新增 `--full`/`--phase` 参数说明和 synthesize 相关触发词
- sync KB 新增 `--global` 选项和同步全量触发词
- track KB 新增 tracker 别名和触发词
- schedule KB 标记为已废弃
- SYNONYM_MAP 新增合成需求/同步全量同义词 → 路由到 analyze/sync
- intent-recognition.ts: synthesize intent → analyze, sync-global intent → sync

### 文档更新

- README.md: tagline 22 → 20 命令
- help-panel.ts: 移除 synthesize 独立条目和 schedule 条目
- help.ts: analyze 命令新增 --full/--phase 参数，分类移除 synthesize
- 全部文档统一命令数量为 20（README/docs/about.ts/commands.en.md 等）

### 涉及文件

- `src/cli.ts` — sync/update 命令新增选项，synthesize/tracker/sync-global/arch-update 改为别名，schedule 废弃
- `src/core/help-panel.ts` — 移除 synthesize/schedule 条目
- `src/commands/help.ts` — analyze 参数更新，分类调整
- `src/core/ask-engine.ts` — KB/SYNONYM_MAP/triggerPatterns 更新
- `src/core/intent-recognition.ts` — synthesize→analyze, sync-global→sync 路由
- `src/commands/about.ts` — 22 → 20 命令
- `docs/*.md` — 统一命令数量 22 → 20

---

## v6.15.0 (2026-08-15) — 移除简洁模式/全量模式概念

### 重构：统一命令体系

- **移除模式区分**: 删除 `readMode()`、`SIMPLE_COMMANDS`、`filterCommands`、`configureHelp` 逻辑
- **init 命令简化**: 移除 `--full` 选项，交互式初始化不再询问模式选择
- **help 命令简化**: 移除简洁模式标题和 `--full` 参数说明
- **文档更新**: README、quick-start、scenarios、command-reference 全面移除「简洁模式/全量模式」概念

### 涉及文件

- `src/cli.ts` — 删除模式检测、命令过滤逻辑（-32 行）
- `src/commands/init.ts` — 移除模式选择交互（-4 行）
- `src/commands/help.ts` — 移除简洁模式标题和参数（-3 行）
- `README.md` — 删除「两种模式」章节
- `docs/quick-start.md` — 删除「两种模式」表格
- `docs/scenarios.md` — 更新标题和注释
- `docs/command-reference.md` — 子命令标题移除「全量模式」

---

## v6.11.0 (2026-08-15) — 知识图谱可视化增强 + 意图识别语境校准

### 知识图谱可视化增强

- **项目名自动检测**: 三级兜底（project.json → package.json → 目录名），标题不再显示默认 "Project"
- **UI 优化**: 设置按钮下移（top: 120px）、节点放大（+30%）、文字放大（11→13px）
- **物理参数调优**: 节点间距适中（gravitationalConstant -70, centralGravity 0.005, springLength 180）
- **术语统一**: HTML 展示层统一使用"功能模块"（task）和"任务"（subtask）
- **模板保存**: HTML 示例保存到 `templates/html/speccore-knowledge-graph.html`
- **截图文档**: 知识图谱截图添加到 `docs/screenshots/knowledge-graph-full.png` + `knowledge-graph-zoom.png`

### 意图识别语境校准

- **语境加成/减分机制**: 在基础匹配分之上增加语境信号调整
  - 开发术语（功能/模块/接口/需求/代码/登录...）→ +10
  - speccore 专有词（Task-/Iteration-/speccore/analyze...）→ +10
  - 域外信号（错别字/翻译/排版/表格/word文件...）→ -30
- **中置信度确认机制**: 45~69 分区间不直接执行，展示匹配意图 + 备选方案，等待用户确认
- **设计原则**: 不设门槛，只调分数。该放的放，该拦的拦

### RAG 检索优化

- **检索兜底机制**: 检索内容 < 3000 字符时触发 loadAllTaskContext() 全量兜底
- **RAG 门槛降低**: minScore 0.3→0.15, topK 5→8, maxTotalChars 5000→8000
- **generous 模式**: assembleUnifiedContext 宽松模式（去掉文档 60% 占比限制，代码截断 600→1500）

### 涉及文件

- `src/core/intent-recognition.ts` — 语境加成/减分机制（+24 行）
- `src/core/ask-engine.ts` — 中置信度确认机制（+21 行）
- `src/core/knowledge-visualizer.ts` — UI 优化 + 物理参数调优
- `src/core/knowledge-graph.ts` — 源码语义集成增强
- `src/core/context-builder.ts` — 术语统一（任务→功能模块）
- `src/core/prompt-builder.ts` — RAG 上下文构建增强
- `src/core/unified-retrieval.ts` — 检索兜底机制
- `src/commands/knowledge.ts` — 项目名多源兜底
- `templates/html/speccore-knowledge-graph.html` — 新增模板
- `docs/screenshots/knowledge-graph-full.png` + `knowledge-graph-zoom.png` — 新增截图
- `README.md` — 新增 knowledge 命令说明 + 截图
- `docs/DESIGN.md` — 新增语境校准设计说明
- `docs/command-reference.md` — 新增 knowledge 命令参考

## v6.10.0 (2026-08-14) — 智能文档分类摄入 + 任务上下文追溯 + 多类型任务支持

### 智能文档分类摄入（doc2spec --classify）

- **功能概述**: 支持将任意文档（安全报告、性能分析、用户反馈等）通过 AI 智能理解后分类导入
- **两步交互**: `--prompt` 输出分类 Prompt → AI 理解意图返回 JSON → `--response` 写入 staging/
- **AI 意图理解**: AI 先判断文档实际意图（nature），再映射到任务类型（type）
  - 安全漏洞/缺陷 → bugfix | 新功能 → feature | 性能优化 → refactor | 调研 → research
- **staging/ 临时目录**: 带 YAML frontmatter（type/nature/title/source/created）
- **analyze 路由**: 读取 staging/ 文件的 type frontmatter，分发到 `020-specs/{features,bugs,refactors,research}/`
- **nature 字段透传**: analyze 生成的规格文件保留 AI 理解的意图描述

### 多类型任务支持

- **扁平文档目录**: `010-requirements/{bugs,refactors,research}/` 支持直接放入对应类型文档
- **1:1 映射规则**: bugs/refactors/research 文档每个直接对应一个任务，不拆分不合并
- **features 拆合规则**: 按功能单元拆分（1~3 个任务），保持原有粒度校验
- **split prompt 增强**: 新增 sourceFile/functionalUnit/reason 字段，AI 输出来源追溯信息

### 任务上下文（CONTEXT.md）

- **`_shared/CONTEXT.md`**: 每个任务目录自动生成来源追溯文档
  - 来源追溯表：010-requirements → 020-specs 完整路径链
  - 原始描述摘要：需求文档前 500 字
  - 关联任务列表：同一迭代的其他任务
  - 影响范围：AI 分析的影响描述
- **sourceFile 字段**: split 时 AI 输出每个任务的来源文档路径，支持精确追溯
- **RAG/prompt 集成**: CONTEXT.md 纳入 RAG 索引候选和 prompt-builder 加载列表

### ask 引擎增强

- **COMMAND_KB 更新**: doc2spec 条目新增 --classify 描述/用法/示例/triggers
- **SYNONYM_MAP 扩展**: 新增智能分类/classify/分类文档/提取需求/导入文档 → doc2spec
- **交互模式**: classify 触发词只匹配到 doc2spec 命令，不触发 pipeline，每步人机交互

### 涉及文件

- `src/commands/doc2spec.ts` — 新增 classifySources() 函数（~180 行）
- `src/commands/analyze.ts` — 收集 staging/ + typed 目录
- `src/core/analyze-engine.ts` — writePerTypedDoc staging 路由 + nature 透传
- `src/commands/iteration/split.ts` — CONTEXT.md 生成 + 1:1 规则 + sourceFile
- `src/core/ask-engine.ts` — KB/SYNONYM_MAP 更新 + classify 触发词
- `src/core/prompt-builder.ts` — CONTEXT.md 纳入加载列表
- `src/core/rag-engine.ts` — CONTEXT.md 纳入索引候选
- `src/commands/execute.ts` — CONTEXT.md 纳入摘要展示
- `src/cli.ts` — 注册 --classify 选项
- `.agents/skills/spec-ask/SKILL.md` — 命令表新增 doc2spec 条目
- `docs/DESIGN.md` — 新增智能分类摄入 + CONTEXT.md 章节
- `docs/command-reference.md` — doc2spec 新增 --classify 参数说明

---

## v6.8.0 (2026-08-14) — 代码索引智能增强 + 衰减检测影响链推断 + RAG 检索增强

### RAG 轻量级检索增强（新增）

- **文档分块引擎**: `src/core/rag-engine.ts`（新增）
  - 按 Markdown 标题（`##`/`###`/`####`）自动分块，不是硬截断
  - 每块提取结构化摘要：表格 → 表头+前3行 / 列表 → 前5项 / 段落 → 前2句 / 代码 → 函数签名
  - 关键词标签提取：中文2-4字词 + 英文标识符 + CamelCase 拆分 + 语义扩展
- **相关性检索**: `retrieveRelevantChunks()`
  - 标题匹配 +3 分/词，摘要匹配 +2 分，关键词匹配 +2.5 分，内容匹配 +1 分
  - 按 task/需求关键词检索，只取 Top-5 最相关块注入 Prompt
  - 总字数控制在 6000 以内，超出时用摘要版替代
- **索引生命周期**: `analyze` 阶段生成 → `buildPrompt` 阶段消费
  - `analyze-engine.ts`: task 模式分析完成后自动调用 `indexTaskDocuments()` 建索引
  - `prompt-builder.ts`: `buildPrompt()` 优先加载 RAG 索引，无索引时回退到传统截断模式
  - 索引缓存：`.speccore/cache/rag-index.json`，scope 变化时自动重建
- **增量刷新**: `checkRagIndexFreshness()` + `refreshRagIndex()`
  - 对比源文件 mtime 与索引缓存，检测变更文件列表
  - 只重建有变更的文件 chunk，未变更的 chunk 保留，避免全量重建
  - analyze 阶段自动检测，过期时提示 `🔄 RAG 索引已增量刷新 (N 个文件更新)`
- **统一检索层**: `src/core/unified-retrieval.ts`（新增）
  - 一次查询同时检索三个来源：文档 RAG + 代码切片 + 知识图谱
  - `unifiedSearch()` → `assembleUnifiedContext()` → 注入 Prompt
  - 日志统一输出：`🔍 统一检索: 3 文档块 + 5 代码切片 | ~4200 tokens`
- **代码切片**: `sliceCodeFile()`
  - 按 `export function/class/interface/type/enum/const` 切分源码
  - 每片包含：JSDoc 注释 + 签名 + 前 50 行实现
  - 轻量级正则分片，不需要 AST 解析器
  - 相关性评分：名称命中 +5 分，路径/签名/注释匹配 +1 分
- **RAG 索引 CLI 命令**: `speccore rag-index`（新增）
  - `speccore rag-index` — 显示当前索引状态（文件列表、块数、新鲜度）
  - `speccore rag-index --refresh --task Task-001` — 增量刷新（只重建变更文件）
  - `speccore rag-index --full --task Task-001` — 全量重建（删除旧索引重新扫描）
  - 状态检测：过期文件标 ⚠️，新鲜文件标 ✅
  - 解决用户手动修改文档后无法刷新索引的问题
- **统一刷新命令**: `speccore refresh`（新增）
  - `speccore refresh` — 一键刷新所有检索层（代码索引 + 文档 RAG + 知识图谱）
  - `speccore refresh --code` — 只刷新代码索引
  - `speccore refresh --rag --task Task-001` — 只刷新文档 RAG
  - `speccore refresh --graph` — 只刷新知识图谱
  - 自动推断当前任务（从已有 RAG 索引的 scope 解析），无需手动指定
  - 汇总输出：✅ 成功 / ⏭️ 跳过 / ❌ 失败，一目了然
- **analyze 阶段自动刷新所有检索层**
  - 无论什么 scope（task/iteration/global），analyze 完成后统一刷新三层索引
  - task scope: 刷新任务目录 RAG + 代码索引 + 知识图谱
  - iteration scope: 为 020-specs/ 目录新建迭代级 RAG 索引 + 刷新代码索引 + 知识图谱
  - global scope: 为全局 specs 目录新建全局 RAG 索引 + 刷新代码索引 + 知识图谱
  - 新增 `indexDirectoryDocuments()` 通用函数：可为任意目录递归扫描 .md 文件建 RAG 索引
- **sync-global 全局知识沉淀**（新增）
  - 设计哲学：不追求完美文档，追求"能检索到"
  - sync-global 完成后自动触发：扫描迭代所有 specs → 建全局 RAG 索引 → 生成 SUMMARY.md → 刷新知识图谱
  - `src/core/global-knowledge.ts`: 全局知识沉淀引擎
    - 聚合所有迭代的 020-specs/ + 任务 00-specs/ + _shared/ 文档
    - 生成 `.speccore/GLOBAL/SUMMARY.md`: 轻量级全局概览（功能清单 + 技术要点 + API + 已知问题）
    - 支持手动编辑，不完美没关系，下次 sync-global 会覆盖更新
    - 全局 RAG 索引 scope: `GLOBAL_all_{iteration}_aggregated`

### Bug 修复（深度检查）

- **P0-1: RAG 索引文件互相覆盖** — task/iteration/global 共用 `rag-index.json`，后建的覆盖先建的
  - 修复：每个 scope 分配独立文件
    - task: `rag-index.json`（默认，兼容已有）
    - iteration: `rag-index-{iteration}.json`
    - global: `rag-index-global.json`
  - `saveRagIndex` / `loadRagIndex` / `checkRagIndexFreshness` 支持可选 `fileName` 参数
  - `unifiedSearch` 根据查询参数（taskId/iteration）加载对应索引文件，合并去重后返回
  - `rag-index` 命令显示所有索引文件状态，`refresh` 命令刷新所有层级
- **P0-2: sliceCodeFile JSDoc 提取 bug** — `cl.startsWith('*')` 不会匹配有空格前缀的注释行（如 ` * @param`）
  - 修复：改用 `cl.trimStart().startsWith('*')`，保留原始缩进格式
- **P0-3: sliceCodeFile 字符串转义判断 bug** — `bl[bl.indexOf(ch) - 1] !== '\\'` 中 `indexOf` 只会找到第一个匹配位置
  - 修复：改用 `for (let ci = 0; ci < bl.length; ci++)` 遍历，用 `bl[ci - 1]` 判断当前字符前一个是否为转义符
- **P1-4: checkRagIndexFreshness 不检测新增文件** — 只对比已有文件的 mtime，新增 .md 文件被忽略
  - 修复：新增 `scanForNewFiles()` 递归扫描，返回 `{ fresh, staleFiles, newFiles }`
- **P1-5: global-knowledge.ts 动态导入冗余** — `await import('./rag-engine')` 改为静态导入
- **P1-6: refresh.ts 重复调用 checkRagIndexFreshness** — 外部调用一次 + refreshRagIndex 内部又调用一次
  - 修复：改为 before/after 对比 `updatedAt` 判断是否有变更

### 代码索引智能增强（P0-1 ~ P0-3）

- **findRelevantCode 接入知识图谱**: `code-scanner.ts`
  - 新增 `iteration`/`taskId` 参数，自动加载知识图谱关联的代码文件
  - 依赖任务（`depends_on`）关联的代码文件也纳入匹配范围
- **@spec 注释扫描加分**: 扫描代码中的 `@spec Task-XXX` 注释
  - 命中当前 taskId 的文件 +50 分，命中依赖任务 +30 分
  - 支持前缀匹配：`Task-001` 可匹配 `Task-001-user-login-backend-a3f2`
- **Git 联动加分**: 命中文件 A 时，A 常一起变更的文件组（correlations）中的 B/C 也 +10 分
  - 解决"改了 Controller 但没改 Service"的遗漏问题
- **关键词语义扩展**: `expandKeywords()` 自动扩展同义词
  - 支持中英双语语义映射：`login` → `auth/session/token`，`权限` → `rbac/acl`
  - 停用词过滤：去除 `功能/实现/需要/the/and` 等噪声词
- **execute 前代码新鲜度检查**: `execute.ts`
  - 执行前自动检查 `code-structure.json` 索引是否过期
  - 对比源码最新 mtime 与索引 updatedAt，5 分钟容差
  - 过期时警告并列出最近修改的文件，提示运行 `speccore code-index`
- **需求分析默认关联代码**: `analyze-engine.ts`
  - `analyzeRequirements` 默认调用 `findRelevantCode` 读取关联源码（`readSource !== false`）
  - 利用知识图谱 + 语义扩展，根据需求内容自动匹配相关代码文件
  - 报告新增「关联代码现状」章节，展示代码预览供技术方案参考
  - 避免"分析只看文档、执行又重复读代码"的 token 浪费

### Prompt 构建性能优化（v6.8.0 补充）

- **REQ.md 统一读取去重**: `prompt-builder.ts`
  - `loadApiSpecs`/`loadDataModels`/`loadBusinessRules` 各自独立读取 REQ.md → 统一为 `loadReqContent()` 一次读取，三个函数共用缓存
  - 减少 2 次重复 I/O + 引入进程级文件缓存（`cachedRead`），文件 mtime 未变时直接返回内存缓存
- **ExtraSpecs 大小限制**: `loadExtraSpecs()` 新增 `maxCharsPerFile`（默认 2000）+ `maxTotalChars`（默认 8000）
  - 单文件超限截断并标注，总大小超限停止加载更多文件
  - 防止 TECH.md/TASK.md/SCHEMA.md 等大文件把 prompt 撑爆
- **TOC + TechStack 进程缓存**: `loadGlobalContext()` / `loadTechStack()` 引入 `techStackCache`/`tocCache`/`constitutionCache`
  - 多次 buildPrompt 调用之间共享缓存，避免重复扫描目录和重复读取 CONSTITUTION.md
- **分析引擎去重读**: `analyze-engine.ts` + `ai-context-generator.ts`
  - `AIContextInput` 新增 `reqContents` 字段
  - `analyzeRequirements` / `analyzeCombined` 将已读取的需求内容直接传给 `generateAIContext`，避免同一份文档被 readFile 两次
- **知识图谱进程缓存**: `knowledge-graph.ts`
  - `loadKnowledgeGraph()` 引入 `kgCache`，文件 mtime 未变时直接返回已解析的图对象
  - 避免每次 ask 都重新 JSON.parse 数万节点的知识图谱
- **动态 Prompt 裁剪**: `prompt-builder.ts` `formatPrompt()`
  - 默认预算 12000 tokens，超出时按优先级逐级简化：隐藏全局目录 → 压缩 extraSpecs → 隐藏任务关联链 → 极简模式
  - 适配不同模型上下文窗口（gpt-4 32k / Claude 100k 等）

### 衰减检测影响链推断（P0-4）

- **代码→Task→Spec 漂移检测**: `decay-detector.ts` 新增 `detectCodeSpecDrift()`
  - 扫描 `@spec` 注释建立 code-file → taskId 映射
  - 对比 code-index 的 `lastModified` 与当前文件 mtime
  - 代码已变更但关联 Task/Spec 未更新时，生成 `code_ahead_of_spec` 类型告警
  - 通过知识图谱推断完整影响链：`Task → implements → Req` / `Task → references → Spec` / `Task → depends_on → Task`
  - 报告格式新增「📝 代码先行」章节，展示影响链

---

## v6.7.0 (2026-08-14) — 知识图谱深度集成 + 意图缓存增强 + 宿主AI协议优化

### 核心架构增强

- **Ask 引擎接入知识图谱**: `ask-engine.ts` 新增 `tryMatchEntityFromKG()` + `enrichWithKG()`
  - 本地引擎结果后自动加载 `knowledge-graph.json`，优先匹配 `Task-xxx`/`REQ-xxx` 实体 ID
  - 对 title 做关键词相似度匹配（≥0.6 命中），命令需要 task 参数且缺失时自动注入 `--task <id>`
  - 解决知识图谱"建而不用"的核心架构断层
- **宿主 AI 协议可用化**: `ask-host-ai.ts` 非 TTY 模式输出上下文后直接返回，不再阻塞 15 秒等待文件协议
  - AI agent 调用 `speccore ask` 时，上下文通过 `[SPECCORE_AI_CONTEXT]` 标记输出到 stdout 后直接接管
- **意图缓存归一化**: `intent-cache.ts` 升级到 v1.1
  - 新增 `normalizedInput` 字段：去停用词 → 排序 → 取前 6 个词拼接
  - 第二层"归一化语义匹配"：同义不同形的输入也能命中缓存
  - 解决意图缓存"同义不同形"无法命中的问题

### 知识图谱加固

- **实体 ID 冲突去重**: `buildKnowledgeGraph()` 中用路径前缀作为 fallback ID，不同文件的同名实体自动区分
  - 冲突时生成 `${e.id}@${e.file.replace(/\//g, '-')}` 唯一 ID
- **关系推断扩展**: `inferRelations()` 新增三类推断
  - 任务目录下 `_shared/REQ.md` → 需求(`implements`)
  - `SPEC:xxx` 引用 → 规格(`references`)
  - `API_CONTRACT.yaml` → `depends_on`
- **getTaskContext 索引优化**: 预建 `parentTaskId` Map，兄弟子任务查找从 O(n) 降至 O(1)
  - 返回类型新增 `relatedSpecs` 和 `dependsOn` 字段
- **isGraphStale 性能优化**: `MAX_FILES_PER_DIR = 100` 限制扫描文件数 + 单目录 200ms 超时保护
  - 解决大项目下 prompt 构建被阻塞的问题

### 衰减检测增强

- **变更程度分级**: `decay-detector.ts` severity 扩展为 `info | warning | critical`
  - minor（改注释/格式化）→ info，不触发 downstream_stale
  - moderate（改逻辑/加字段）→ warning
  - major（改接口/删表）→ critical
  - 解决 typo 修复误报 downstream_stale 的问题

### 上下文构建增强

- **taskContext 增强**: `context-builder.ts` 的 `buildCompactContext()` 和 `buildContextMarkdown()`
  - 新增"关联规格"输出：`relatedSpecs.map(s => s.id)`
  - 新增"依赖任务"输出：`dependsOn.map(d => d.id)`

### 平台注册表精确化

- **refreshPlatformsStatus 精确化**: `platform-registry.ts` 从全文关键词搜索改为精确正则匹配 `**状态**:` 字段
  - 只判断状态字段值，不再因正文中出现"已完成"等词而误判

---

## v6.6.0 (2026-08-14) — 知识库系统全面修复（13 项问题修复）

### P0 严重修复
- **子任务关联链修复**: `getTaskContext()` 子任务现在能通过父任务找到上游需求
  - 之前: execute --task Task-001-web-a1b2 → 看不到上游需求 ❌
  - 现在: 自动沿 subtask_of → parent → implements 链路找到 REQ-001 ✅
- **过期检测修复**: `isGraphStale()` 改为递归扫描文件 mtime
  - 之前: 用目录 mtime，修改文件内容不触发更新 ❌
  - 现在: 递归检查所有文件的最新 mtime ✅
- **衰减检测路径修复**: 增加 basename 回退匹配，应对路径格式不一致

### P1 重要修复
- **需求 ID 唯一性**: 用路径前缀作为 fallback ID，避免不同文件覆盖同一实体
- **spec→需求关联**: `inferRelations()` 现在读取 spec 文件内容提取 REQ-xxx 引用
  - 之前: spec 关联推断什么都没做 ❌
  - 现在: 自动建立 spec → requirement 的 `specifies` 关系 ✅
- **迭代级设计文档可见**: `loadExtraSpecs()` 加载 020-specs/DESIGN.md 到 AI prompt
  - 填补了迭代层上下文断裂（断裂 1 + 断裂 4）
- **platform-registry**: `parseGlobalPlatforms()`/`resolvePlatform()` 加 cwd 参数
- **context-builder**: `saveContextMarkdown()` 改用 `getIterationDir()` 保证路径一致
- **reindex-engine**: `getFileDescription()` 改为调用 `extractFileDescription()` 提取真实标题

### P2 其他修复
- **task-paths**: `getTaskPath()`/`getTasksRoot()` 支持 cwd 参数，不再硬编码 process.cwd()
- **时间戳备份过滤**: 知识图谱扫描时过滤时间戳备份文件（需求目录 + 平台子目录）

---

## v6.5.1 (2026-08-14) — 知识图谱自动更新机制

- **懒加载**: prompt-builder 加载图谱时自动检测过期，过期则自动重建
- **过期检测**: `isGraphStale()` 对比图谱生成时间 vs 需求/规格/任务目录 mtime
- **自动刷新**: `refreshKnowledgeGraph()` 静默重建图谱，不影响主流程
- 用户新建任务/更新文档后，下次 execute 自动看到最新的关联链

---

## v6.5.0 (2026-08-14) — 知识图谱 + 衰减检测 + AI 关联链注入

- **新增 `knowledge-graph.ts`**: 知识图谱构建引擎
  - 扫描需求/规格/任务/子任务，提取实体和关联关系
  - 需求→任务自动匹配（按编号关联）
  - 子任务→父任务关系追踪
  - 用户自定义文件发现与标记
  - 输出 `knowledge-graph.json`（机器读）
- **新增 `decay-detector.ts`**: 知识衰减检测
  - 对比上次完整性快照（integrity.json）检测内容变更
  - 下游过期检测：上游需求变更但关联任务未同步
  - 孤立实体检测：图谱中有引用但文件已不存在
- **新增 `context-builder.ts`**: 紧凑上下文生成器
  - 生成 CONTEXT.md（需求→任务追踪表 + 衰减报告 + 用户文件清单）
  - `buildCompactContext()` 为 prompt 生成 < 500 tokens 关联链
- **集成 prompt-builder.ts**: execute/split 时自动注入任务关联链
  - AI 执行任务时自动看到：上游需求、兄弟子任务进度、各端状态
- **集成 reindex**: `speccore reindex` 自动构建图谱 + 衰减检测 + 生成 CONTEXT.md

---

## v6.4.0 (2026-08-14) — 全量索引重建与一致性检查

- **新增 `reindex` 命令**: 全量扫描全局层/迭代层，检测死链、发现新文件、重建索引
  - `speccore reindex` — 全量重建所有层级索引
  - `speccore reindex --check` — 只检查一致性，不修复
  - `speccore reindex -i Q2` — 指定迭代
- **新增 `reindex-engine.ts`**: 核心扫描引擎
  - 全局层: 扫描 `.speccore/GLOBAL/` 下所有 .md，检查 INDEX.md 死链，发现未索引文件
  - 迭代层: 扫描 `010-requirements/`、`020-specs/`、`030-tasks/`，检查 PROJECT_GRAPH.md 任务引用有效性
  - PLATFORMS.md 一致性: 检查子任务状态是否与实际 TASK.md 一致
  - 自动重建: `GLOBAL/INDEX.md`、`020-specs/INDEX.md`
  - 完整性快照: 保存 `.speccore/cache/integrity.json` 供下次对比

---

## v6.3.1 (2026-08-14) — 全链路验证修复：5 个 Bug 修复

- **Bug#1 修复**: `generateSubtaskId` 多次调用产生不同 ID → 预生成 ID map，README/TASK.md/PLATFORMS.md 保持一致
- **Bug#2 修复**: execute 前置检查只查 `00-specs/` → 添加 `_shared/REQ.md`、`_shared/TECH.md` 回退
- **Bug#3 修复**: `resolveTaskDir` 不支持类型子目录 → 改用 `findTaskDir()` 递归查找
- **Bug#4 修复**: `loadExtraSpecs` 不读平台端子任务文件 → 按端执行时加载 `{platform}/TASK.md` 等
- **Bug#5 修复**: `filterByPlatform` 路径拼接不经过类型子目录 → 使用修复后的 `resolveTaskDir`
- **额外修复**: `generateTaskSkeleton` 和批量执行日志也添加 `_shared/` 路径回退

---

## v6.3.0 (2026-08-14) — 端注册表 + 模糊匹配 + 按端分析

- **新增 `platform-registry.ts`**: 统一端名解析模块
  - `parseGlobalPlatforms()`: 从 CONSTITUTION.md「对应需求端」列解析全局端名
  - `fuzzyMatchPlatform()`: 模糊匹配（精确 → 前缀 → 包含）
  - `resolvePlatform()`: 命令层统一入口，错误时列出可用端
  - `generatePlatformsRegistry()`: split 自动生成 `_shared/PLATFORMS.md`
- **split 自动生成端注册表**: 任务创建后写入 `_shared/PLATFORMS.md`，列出端名/子任务 ID/负责人/命令参考
- **analyze `--platform`**: 支持只分析某端，写入 `{platform}/` 目录，不影响其他端
- **execute `--platform` 模糊匹配**: 输入 `back` 自动匹配 `backend`，错误时友好提示
- **三层端名一致性**: CONSTITUTION.md（全局权威）→ PLATFORMS.md（任务级）→ 模糊匹配（命令层）

---

## v6.2.0 (2026-08-14) — 子任务发现与筛选：scanTasks 展开各端 + 按端/责任人过滤

- **`scanTasks` 重构**: 自动发现各端子任务，展开为独立 TaskState
  - 新结构: 扫描 `{platform}/TASK.md`，提取子任务 ID、负责人、状态
  - 旧结构兼容: 无子任务时回退到父任务级别
  - TaskState 新增 `platform` 和 `parentTaskId` 字段
- **`--platform` 筛选增强**: 支持新结构 `{platform}/` + 旧结构 `frontend/{platform}/`
- **`--assignee` 筛选**: 现在能正确匹配各端子任务的负责人
- **TASK.md 路径兼容**: `_shared/TASK.md` → `00-specs/TASK.md` 回退

---

## v6.1.1 (2026-08-14) — 子任务命名规则调整：父任务完整名

- **子任务 ID 格式变更**: 从 `Task-{编号}-{端名}-{hash}` 改为 `Task-{父任务完整名}-{端名}-{hash}`
  - 旧: `Task-001-backend-a3f2`
  - 新: `Task-001-user-login-backend-a3f2`
- 父级名字包含编号 + slug，一眼可溯源码

---

## v6.1.0 (2026-08-14) — 任务目录结构重构：_shared/ + 按端嵌套 + 子任务命名

- **Task 目录结构重构**: 从扁平 `00-specs/` 改为 `_shared/` + `{端}/` 嵌套
  - `_shared/` — 共享规格（REQ/TECH/SCHEMA/CHANGELOG/API_CONTRACT）
  - `{端}/` — 各端独立子任务（TASK.md + src/tests）
  - `99-artifacts/` — 执行产出（不变）
- **子任务全局命名**: `Task-{父编号}-{端名}-{hash4}` 格式，如 `Task-001-backend-a3f2`
- **方案 C 混合**: 迭代层 020-specs/ 支持全局 + platforms/ 双层结构
- **split 命令改造**: 功能单元为模块，按端生成子任务，各端独立负责人
- **向后兼容**: analyze/execute/prompt-builder 支持 `_shared/` → `00-specs/` 回退
- **init 模板更新**: 新任务目录结构模板

---

## v6.0.1 (2026-08-14) — TOC 条目增强：摘要/端/行数/标签

- **`TOCEntry` 接口增强**: 新增 4 个字段
  - `summary` — 首段摘要（标题后第一段非空内容，≤200字）
  - `platforms` — 涉及的端列表（从路径/内容自动推断）
  - `lineCount` — 文件行数（AI 判断阅读成本）
  - `tags` — 关键词标签（从 ## 标题提取核心词，去停用词）
- **新增提取函数**: `extractSummary()` / `extractPlatforms()` / `extractTags()`
- **新增 `buildTOCEntry()`**: 统一构建 TOC 条目，避免重复代码
- **新增 `formatTOCEntry()`**: 格式化单个 TOC 条目（含所有增强字段）
- **AI 决策辅助**: 标签帮语义匹配、端标记帮判断相关性、行数帮估算阅读成本

---

## v6.0.0 (2026-08-14) — 全局知识库 TOC 全覆盖：PATTERNS + RULES + PROJECTS + 扁平文件

- **`buildGlobalTOC()` 扩展**: 从 2 个目录扩展到 6 个来源
  - synthesis/ — 跨端综合文档（原有）
  - platforms/ — 各端分析文档（原有）
  - PROJECTS/ — 工程级分析文档（新增）
  - GLOBAL 扁平文件 — ARCHITECTURE/CODE_INDEX/GLOSSARY/OVERVIEW/TECH_STACK 等（新增）
  - PATTERNS/TEMPLATES/ — Spec 写作模板（新增，AI 写 Spec 时可参考格式）
  - RULES/ — 代码审查规则 + 完成检查清单（新增）
- **`formatGlobalContext()`**: 提取为公共函数，formatPrompt 和 split.ts 共用
- **TOC 分组显示**: 6 组（📚跨端综合 / 📱各端分析 / 🏗工程级 / 📖参考文档 / ✏️写作模板 / 📏规则）
- **路径提示**: 明确 GLOBAL/PATTERNS/RULES 各自的基础路径
- **FILE_DESC 扩展**: 新增 CODE_INDEX/GLOSSARY/OVERVIEW/TECH_STACK/CHANGELOG/PROTOTYPE_INDEX 描述
- **RULES_DESC**: 新增规则文件描述映射

---

## v5.99.2 (2026-08-14) — 验证修复 + 设计文档更新

- **修复**: `buildGlobalTOC()` 过滤时间戳备份文件（`isTimestampBackup`）
- **修复**: `generateGlobalIndex()` 同步过滤备份文件
- **修复**: `buildPrompt()` 全局上下文条件判断（无内容时不注入空段）
- **修复**: `readdir` 从动态导入改为顶层导入（兼容 Node 16）
- **文档**: `spec-layers.md` 全面更新，新增 Layer 0 全局知识库 + 智能注入机制

---

## v5.99.1 (2026-08-14) — 全局知识库目录化：AI 自主决定读什么

- **重构 GlobalContext**: 从预取内容改为 TOC 目录结构（`TOCEntry` 接口）
- **`buildGlobalTOC()`**: 扫描 GLOBAL 目录，提取每个文件的 ## 标题行，不读正文
- **`loadGlobalContext()`**: 必读的 INDEX.md 直接注入 + 其余文件只给目录
- **`formatPrompt()` 全局知识库段**: 分“📌 必读（已注入）”和“📂 可选参考（按需 Read）”
- **各端文档分组**: 按端类型分组显示，当前端标记 ⬅ 箭头
- **split.ts**: 同步改用 TOC 目录方式注入全局上下文
- **删除旧函数**: `extractArchConstraints()` / `extractTechConstraints()` 关键词匹配已移除
- **核心理念**: CLI 给地图 + 标必读物，AI 自己看目录决定读哪些文件

---

## v5.99.0 (2026-08-14) — 智能全局上下文注入：split/execute/analyze 自动参考全局知识

- **prompt-builder.ts**: 新增 `loadGlobalContext()` 函数，按命令类型智能注入全局上下文
- **execute/plan**: 自动注入架构约束 + 技术方案约束 + 端专属规则（GLOBAL/platforms/{端}/）
- **split**: 自动注入跨端关系摘要 + 全局索引
- **analyze**: 自动注入架构摘要
- **synthesize Phase 2**: apply 后自动生成 `GLOBAL/INDEX.md` 轻量索引
- **摘要提取**: `extractSummary()` 取每章节前 3 行，`extractArchConstraints()` 按关键词精准提取
- **全局上下文输出**: `formatPrompt()` 新增 `## 🌐 全局上下文` 段，AI 生成代码时自动参考

---

## v5.98.0 (2026-08-14) — Phase 1 端类型自动识别 + 端专属专业维度

- Phase 1 Prompt 新增端类型识别规则（后端/Web管理端/移动H5/小程序/原生App）
- 通用 10 维度 + 端专属维度分层设计
- 后端：数据库设计/缓存/并发/消息队列/日志监控
- Web管理端：复杂组件/权限UI/数据可视化/无障碍
- 移动H5：viewport适配/触摸交互/首屏性能/弱网优化
- 小程序：包体积约束/平台API/渲染限制/分包策略
- 原生App：原生桥接/推送/离线能力/应用商店合规
- 输出格式新增第 11 章「端类型专业维度」

---

## v5.97.0 (2026-08-14) — synthesize 三阶段 Prompt 全面升级为业内专业级

- **Phase 1 各端分析**：从 5 项升级到 10 大维度（功能清单+用户故事、接口定义、数据模型、业务规则、安全分析、性能特征、错误处理、测试策略、第三方依赖、跨端关联）
- **Phase 2 跨端综合**：CROSS_PLATFORM 补数据流向/事务一致性；ARCHITECTURE 补 ADR/安全架构/监控告警/容灾方案；TECH_FULL 补 API 版本策略/容量规划/数据一致性
- **Phase 3 功能单元合成**：补用户故事(Given/When/Then)、数据字典、状态机、非功能需求、测试要点
- **用户自建文档支持**：各阶段读取时自动合并 GLOBAL 目录下用户放置的文档作为补充输入
- **Prompt 注意项**：明确告知 AI 用户已有文档时不要覆盖，优先参考

---

## v5.96.2 (2026-08-14) — synthesize 全局层写入路径迁移

- Phase 1/2 输出从 `Iteration-NNN/020-specs/` 迁移到 `.speccore/GLOBAL/`
- Phase 1 → `.speccore/GLOBAL/platforms/{端名}/`
- Phase 2 → `.speccore/GLOBAL/synthesis/`（CROSS_PLATFORM + ARCHITECTURE + TECH_FULL）
- 快照归档 → `.speccore/GLOBAL/snapshots/`
- Phase 3 输出仍在迭代层 `010-requirements/REQUIREMENT.md`
- Phase 3 读取逻辑同时从 GLOBAL 层 + 迭代层收集输入

---

## v5.96.1 (2026-08-14) — synthesize 目录组织优化

- Phase 1 输出: `per-platform/` → `platforms/`（按端分目录）
- Phase 2 输出: 散落文件 → `synthesis/` 子目录（CROSS_PLATFORM.md + ARCHITECTURE.md + TECH_FULL.md）
- 新增 `snapshots/` 目录：Phase 2 重复执行时旧版自动归档
- Phase 2 apply 支持解析 `===MARKER===` 分隔标记，写入独立文件
- Phase 1/3 读取逻辑适配新目录结构

---

## v5.96.0 (2026-08-14) — synthesize 多端全量分析与合成（三阶段全自动流程）

- **Phase 1: 逐端分析** — 读取 CONSTITUTION 工程列表，各端独立生成 specs
- **Phase 2: 跨端综合** — 汇总各端 specs，识别跨端业务关系，生成 CROSS_PLATFORM.md + ARCHITECTURE.md + TECH_FULL.md
- **Phase 3: 功能单元合成** — 按功能单元组织需求文档，每个单元包含所有端的需求
- **`--full` 模式**：全自动三阶段流水线，无需人工干预
- **`--phase N` 模式**：单阶段手动执行
- **`--apply-phase N` 模式**：接收某阶段 AI 结果写入文件
- 原有简单合成模式向后兼容
- DESIGN.md 新增多端全量分析与合成设计章节

---

## v5.95.1 (2026-08-13) — TASK_SUMMARY 报告路径优化

- 报告放单独子目录 `000-overview/task-summaries/`
- 文件名带时间戳：`TASK_SUMMARY-2026-08-13T14-30.md`
- 多次拆分不会互相覆盖

---

## v5.95.0 (2026-08-13) — 任务总览报告：TASK_SUMMARY.md

- **新增任务总览报告**：拆分完成后自动生成 `000-overview/TASK_SUMMARY.md`
- **报告内容**：任务名、功能单元、人工工时、AI工时、优先级、依赖、风险
- **工时汇总**：人工总工时、AI总工时、总预估工时、AI 占比
- **功能单元分布**：每个功能单元的任务数统计
- **stdout 输出**：`[SPECCORE_TASK_SUMMARY]` 标记包裹报告，供宿主 AI 展示给用户
- 同时支持 `--response` 路径和常规拆分路径

---

## v5.94.0 (2026-08-13) — split AI 内容生成：任务自带 REQ.md / TECH.md 实际内容

- **JSON schema 扩展**：AI 拆分时每个任务新增 `reqContent` / `techContent` 字段
- **REQ.md 实际内容**：AI 生成需求描述（业务规则、数据模型、接口定义），直接写入 REQ.md
- **TECH.md 实际内容**：AI 生成技术方案（架构设计、核心逻辑、测试策略），直接写入 TECH.md
- **回退机制**：AI 未提供内容时回退到原模板（`<!-- AI-FILL -->`）
- **子切面原则**：内容是任务级别的，不是整个功能单元的重复
- 所有数量约束保持不变（功能单元 ≤ 3、总数 ≤ 20、非功能章节过滤等）

---

## v5.93.1 (2026-08-13) — topic slug 回退修复

- **slugify 回退改进**：纯中文名称生成短 hash 作为 slug（如 `a3f2`），不再回退到无意义的 `'task'`
- **常规路径传 topic**：`nextTaskId` 在常规路径也传入 slugified topic
- 效果：`Task-001-a3f2` 而非 `Task-001-task` 或 `Task-001`

---

## v5.93.0 (2026-08-13) — split 防护补全：全局硬限制 + functionalUnit 校验 + 非功能章节过滤

- **全局任务数硬限制**：MAX_TASKS_HARD = 20，超出即终止（`--force` 可跳过）
- **functionalUnit 字段强制**：buildSplitPrompt JSON schema 新增 `functionalUnit` 必填字段
- **functionalUnit 缺失警告**：超过 50% 任务缺少时输出警告
- **非 TTY 任务总览**：非交互模式下按功能单元分组显示任务摘要
- **TEMPLATE_PATTERNS 扩展**：新增 24 个非功能章节过滤模式（背景/概述/架构/术语/目标等）
- **内容阈值提升**：filterTemplateNoise 最低内容量从 3 字符提升到 20 字符
- **移除 section 回退**：per-unit 校验不再回退到 section 名（避免每个任务独占一个“单元”）

---

## v5.92.0 (2026-08-13) — split 约束重构：功能单元基准

- **split 约束体系重构**：从全局上限/章节基准改为**功能单元基准**
- 核心原则：以需求的功能单元为基准拆分，而非需求文档的章节划分
- 每个功能单元默认 1 个任务，最多 3 个（代码层硬拦截）
- JSON 输出新增 `functionalUnit` 字段，AI 标注每个任务所属功能单元
- 代码层按 `functionalUnit` 分组校验，超限终止（`--force` 可跳过）
- 移除全局任务数上限（原 MAX_TASKS_HARD_LIMIT = 20）
- 相邻任务同属一个功能单元时输出警告
- Prompt 全面统一“章节”为“功能单元”
- DESIGN.md / command-reference.md 同步更新拆分约束说明
- help.html 卡片宽度调整为 960px
- `cleanupStaleFiles` 新增清理 `-old` / `-backup` 后缀旧版备份文件

---

## v5.91.0 (2026-08-13) — 清理旧版备份文件 + 参数速查优化

- `cleanupStaleFiles` 新增清理逻辑：自动删除 `-old` / `-backup` 后缀的旧版备份文件（v5.87.2 之前创建）
- 清理范围覆盖：各 AI 平台 commands/skills 目录 + 项目根目录
- help.html 核心参数速查精简：去掉低频参数（--web/--export/--scope），添加高频参数（--platforms/--type/--force）
- help.html 卡片宽度调整为 960px，与 setup-guide 保持一致

---

## v5.90.0 (2026-08-13) — help.html 全面优化

- welcome 页按钮文字颜色修复：三个按钮描述文字统一为白色 `rgba(255,255,255,.85)`
- help.html 结构化升级：新增介绍卡片(SDD方法论+核心原则)、快速开始4步流程、常用参数速查表格(8个核心参数)
- help.html 标题发光效果：h1 添加 `animation:titleGlow` + `background-clip:text`，遵循渐变文字内联声明规范
- help.html 光晕偏左：`.card-bg` 径向渐变中心从 `50% 10%` 改为 `30% 10%`，呼吸动画 `cardGlow`
- help.html 宽度统一：卡片最大宽度从 `900px` 调整为 `800px`，与 welcome/setup-guide 等页面保持一致
- 使用技巧模块：优先使用 ask / 搜索命令 / 查看详细参数 / HTML 帮助页 四个技巧卡片

---

## v5.89.0 (2026-08-13) — split 智能拆分全面升级

- 粒度硬约束量化：三档粒度（macro 20-80h / module 12-40h / atomic 4-24h）含接口/数据表/页面上限
- **工时约束按单人计算**：粒度校验用 `max(各端工时)`，不是所有端总和
- AI 输出新增 `hoursByPlatform` 按端分别估算工时，`topic` 英文 slug 用于目录命名
- `validateGranularity()` 校验函数：按单人 max 工时警告，指出具体哪个端超标
- `recommendGranularity(teamSize)` 根据 STAFFING.md 团队规模自动推荐粒度
- AI prompt 合并倾向加强：复杂度低于粒度下限时强制合并，「宁少勿多」原则
- 同一功能的前后端各端必须在一个原子任务里，不按端拆分
- 交互流程简化：逐任务展示摘要 → y 确认自动推进 / n 退出提示调整方式
- 持久化调整指令：prompt 文件末尾含「调整指令」，AI 调整时回读文件保持规则
- CONSTITUTION.md 端配置读取：`detectPlatforms()` 优先读全局「对应需求端」列
- scope → 平台映射修复：正确提取 backend + 各前端平台，创建对应目录
- 后端目录嵌套修复：`platform === 'backend'` 直接 `10-backend/src/`，不嵌套
- 任务类型子目录验证通过：feature/bugfix/refactor/research 按 AI 返回的 type 分类
- 任务摘要展示各端工时分布：`backend:16h + admin:12h + app:12h = 40h（max per person: 16h）`
- 设计文档更新：DESIGN.md 新增拆分粒度规则章节 + 按端工时说明 + AI 输出字段表
- 命令文档更新：command-reference.md 完整 split 参数/粒度/交互文档

---

## v5.87.2 (2026-08-13) — 升级安全优化

- `init --update` 不再因版本相同跳过，始终执行清理和文件刷新（旧格式文件无需 `--force` 即可清理）
- `init --force` 确认提示增强：明确列出计数器/INDEX/项目配置丢失风险，引导用户使用 `--update --force` 安全升级

---

## v5.87.1 (2026-08-13) — Qoder 旧格式清理逻辑修复

- 修复 update.ts Qoder 清理逻辑反向的 bug：原来误删 `spec-` 新格式，现改为正确清理 `spec:` 旧格式
- 废弃命令清理同时检查 `spec:` 和 `spec-` 两种前缀

---

## v5.87.0 (2026-08-13) — 冲突处理统一时间戳 + 备份汇总

- `*-old` 命名风格全面替换为时间戳格式 `{name}-{YYYYMMDDHHmmss}.md`
- 删除 `.speccore-backup` 整体备份机制（init --force 不再备份整个 .speccore/ 目录）
- 新增 `backupDirWithTimestamp` 目录级时间戳备份函数（task-utils.ts）
- 所有 `--force` 操作路径补上时间戳保护：import / pattern / migrate
- 所有备份操作统一输出汇总：列出备份文件路径 + diff 命令 + 清理提示
- `_updateConflicts` 结构升级为 `{file, backup}[]`，支持 diff 对比提示
- 删除死代码：`writeAgentsMdWithOld`、所有 `*-old` 清理逻辑
- init --force 不碰 Iteration-*/ 用户目录，冲突文件自动重命名并告知用户

---

## v5.86.0 (2026-08-13) — 编号安全体系 + 计划子目录化 + 备份过滤

- 计划文件子目录化：`000-overview/plans/Plan-NNN-slug/`（PLAN.md + HTML），消除重复 MD 文件
- analyze 命令增加 REQUIREMENT.md 生成（JSON 多文档模式 + DOC_MATRIX feature 8 文档）
- split --response 创建完整任务目录（23-27 个文件，复用 createTaskFromSection）
- 全局计数器保护机制：`getCounters()` 扫描实际目录取 `max(存储值, 扫描值)`，防止 counters.json 丢失导致编号重复
- split 所有模式（默认/strict/interactive/--response）统一预分配 `_taskId`，消除硬编码
- `updateProjectGraph`/`generateImpactGraph`/`detectSemanticDependencies` 改用预分配 ID
- task new `--id` 手动指定时也递增计数器，避免后续自动编号回退
- doc2spec CSV 批量导入、iteration-from-global 自动拆分改用 `nextTaskId`
- search.ts / analyze-engine.ts / synthesize.ts / spec2doc.ts 备份文件过滤（`isTimestampBackup`）
- CLI 选项补注册：split `--force`、task new `--id`
- 清理死代码 `generateTaskId`

---

## v5.85.0 (2026-08-12) — 提示词库功能

- 新增 `prompts` 命令（简写 `pt`）：提示词库管理
- 19 个预置提示词模板（迭代/分析/执行/变更四大类）
- 支持搜索、分类筛选、CRUD、一键复制
- 自定义弹框替换原生 prompt，实时预览提示词内容
- 复制时自动添加 `/spec-ask` 前缀
- 用户数据存储在 `.speccore/prompts/user/` + localStorage 双备份
- 简洁模式命令数 19 → 20

---

## v5.84.3 (2026-08-12) — 命令注册一致性修复 + 符号链接安全

- update.ts 去除重复命令写入循环，统一由 createToolIntegrations 处理
- 补全 update.ts 缺失的 trae-cn 工具和 spec-help 命令
- Qoder 升级时自动清理旧版 spec- 前缀文件（迁移到 spec: 格式）
- 修复符号链接 commands 目录导致跨工具误删的根因问题
- cleanupStaleFiles 跳过符号链接目录，避免误删共享目标文件

---

## v5.84.2 (2026-08-12) — Qoder 命令格式修复

- update 命令 Qoder 命令从 `.qoder/commands/spec/ask.md` 改为 `.qoder/commands/spec:ask.md`
- 与 init 保持一致：扁平目录 + `spec:` 前缀命名
- 自动清理旧版 `spec/` 子目录

---

## v5.84.1 (2026-08-12) — migrate 命令增强

- 新增 .task-type 文件检测（优先于 TASK.md）
- 迁移后自动清理 030-tasks/ 根目录下的旧版 Task-* 目录
- 修复迁移后残留的旧结构目录未被删除的问题

---

## v5.84.0 (2026-08-12) — migrate 命令 + --tools 参数修复

- 修复 init/update 中 --tools 参数名不匹配（tool → tools）
- 新增 migrate 命令：支持任务目录自动迁移到 030-tasks/<type>/
- update.ts: 升级时自动检测并迁移旧版 Task-* 目录
- 支持 --dry-run 预览、--force 强制覆盖、--iteration 指定迭代

---

## v5.83.0 (2026-08-12) — --force 模式自动备份

- init.ts: --force 模式自动备份 .speccore/ + Iteration-*/ + inbox/ + questions/
- init.ts: 备份输出改用 logger.info，明确显示备份路径和恢复指令
- init.ts: 提供 cp -r 恢复命令示例，用户可自行删除备份目录

---

## v5.82.0 (2026-08-12) — update/init 命令输出改进

- update.ts: 版本相同时改用 logger.info 明确输出（不再用 spinner.stop）
- update.ts: 升级过程增加进度提示和目标工具显示
- update.ts: 统一输出格式，增加分隔线和结构化报告
- init.ts: 已有 .speccore 时的更新路径委托给 updateCommand，消除 ~50 行重复代码
- init.ts: 移除硬编码的'新能力'列表，改为简洁的额外更新说明

---

## v5.81.1 (2026-08-12) — 文档补充

- command-reference.md: init 章节补充引导页说明
- commands.en.md: init section added setup guide note

---

## v5.81.0 (2026-08-12) — 引导页视觉增强

### 🌟 新增 card-bg 光晕效果
- 容器内新增 radial-gradient 径向渐变光晕（参考 onboarding 页面）
- cardGlow 3s 呼吸动画，从顶部向下扩散青色光晕
- 步骤卡片光晕增强：box-shadow 15px→20px，hover 25px→30px

### 🔗 “开始使用” 按钮跳转
- 从 `<div onclick>` 改为 `<a href="speccore-ask-onboarding.html">`
- 点击直接跳转到 ask 引导页
- 新增 hover 效果：光晕增强 + 上移 1px

### 📐 容器宽度调整
- 860px → 960px，适配更宽屏幕

---

## v5.80.0 (2026-08-12) — 引导页全面重构

### 📋 项目配置引导页重构（init.ts — writeSetupGuide）
- **问题**: 原 5 步引导从老用户视角写，新用户看不懂「导入需求」是全局还是迭代级
- **方案**: 从全新用户视角重构为 6 步，新增「创建迭代」步骤

### 🔄 步骤顺序调整（5 步 → 6 步）
| 步骤 | 修改前 | 修改后 |
|:---|:---|:---|
| 1 | 技术宪法 | 技术宪法 + **全局分析说明区块** |
| 2 | 团队排期 | 团队配置（STAFFING 标注「步骤 3 后生成」） |
| 3 | — | **🆕 创建迭代**（解释迭代概念 + CLI 命令模板 + 参数说明） |
| 4 | 导入需求文档 | 导入需求（明确引用步骤 3 创建的迭代） |
| 5 | 知识库与规则 | 知识库与规则 |
| 6 | 开始流水线 | **开始开发**（双列方式卡片：意图式 + Skill 命令） |

### 🤖 AI 命令统一改为 Skill 命令格式
- 引导页中所有 AI 命令从 CLI 内部写法改为 Skill 命令
- `speccore analyze --prompt` → `/spec-analyze`
- `speccore split --prompt` → `/spec-split`
- `speccore execute --prompt` → `/spec-execute`
- `speccore done --prompt` → `/spec-done`
- `speccore dev` → `/spec-dev`
- `--prompt` 已内置在 Skill 中，无需手动添加

### 📝 命令示例参数说明补全
- 所有显式命令改为 `<参数>` 模板形式
- 每个命令后附参数说明表（如 `-I <迭代名> — analyze 用大写 -I，其余用小写 -i`）
- 全局分析区块补充 `--scope global` 参数解释

### ⚡ 自动化模式说明
- 新增三列卡片：全程确认（默认）/ 半自动 / 全自动
- 每种模式同时展示意图式和显式命令（`/spec-dev -i my-iter --auto-steps` / `--auto`）
- 补充 `speccore dev` 作为流水线控制器的说明

### 🛠️ 其它改进
- 版本号从硬编码改为动态读取 package.json
- 去掉内部命令术语（analyze/split/execute → 需求分析/任务拆分/代码生成）
- 新增「重新查看指南」入口
- 新增引导页截图到 docs/screenshots/

---

## v5.79.0 (2026-08-12) — 需求确认循环 + 项目配置引导页

### 🔄 需求变更确认循环（Skill 层）
- **问题**: change 命令澄清后直接持久化，用户没有机会确认/修改
- **方案**: spec-change SKILL.md 新增澄清→展示→确认→修改循环
- 路由器同步更新：change 意图走 spec-change Skill 的澄清流程
- 各平台命令文件（cursor/claude/trae/windsurf/codebuddy）同步更新

### 📋 项目配置引导页（init 后）
- **问题**: 首次 init 后只输出 5 行简单提示，用户不知道填什么、怎么填
- **方案**: 新增 `writeSetupGuide()` 生成 HTML 引导页，包含 5 步引导：
  1. 填写技术宪法（必填）— CONSTITUTION.md 各字段说明 + 作用解释
  2. 配置团队排期（可选）— STAFFING.md 格式 + 粒度联动说明
  3. 导入需求文档（必填）— 4 种导入方式对比
  4. 知识库与规则（按需）— PATTERNS/RULES/PROJECT 说明
  5. 开始流水线 — 完整 5 步流程 + 命令示例
- init.ts: 首次 init 完成后自动生成并提示

---

## v5.78.0 (2026-08-12) — 门禁文件用起来：质量门禁从 6 项扩展到 10 项

### 🔒 质量门禁扩展（verify-engine.ts）
- **问题**: 99-artifacts/ 下生成的 TEST.md / REVIEW.md / DEPLOY.md / ERROR_CODES.md 只作为 AI 参考，verify 自检时完全不读
- **方案**: 新增 4 项启发式检查，读取门禁文件中的条目与代码关键词对比

### 🆕 新增 4 项自检检查
| 检查项 | 读取文件 | 检查内容 |
|:---|:---|:---|
| 测试用例覆盖 | TEST.md | 提取测试用例 → 检查代码中是否有关键词对应 |
| 评审项合规 | REVIEW.md | 提取评审检查项 → 检查代码中是否有对应实现 |
| 部署项检查 | DEPLOY.md | 提取部署条目 → 检查代码中是否有关联 |
| 错误码一致性 | ERROR_CODES.md | 提取错误码 → 检查代码中是否使用 |

### 🛠️ 代码重构
- 抽取 `scanCodeFiles()` 共享函数：避免 checkSpecConsistency / checkTestCoverage / checkReviewCompliance 重复扫描
- 抽取 `extractCheckItems()` 通用提取器：支持 `- [ ]` / `⬜` / `✅` / `❌` / 表格行多种 Markdown 格式
- 新增 `checkArtifactConsistency()` 通用检查函数：用于 DEPLOY.md / ERROR_CODES.md 等文件
- `checkSpecConsistency()` 重构为使用共享函数，减少 14 行重复代码

### 📝 AI 修复引导增强
- `generateFixPrompt()` 新增 TEST.md / REVIEW.md 修复指引：AI 修复时会自动检查未覆盖用例和未合规评审项

### 📚 文档分类更新
- split.ts: 任务目录结构展示 99-artifacts 分为「自检门禁」和「参考文档」两类
- split.ts: 产出物清单表格新增 `verify 自检？` 列
- init.ts: 目录结构说明更新为「自检门禁 + 参考文档」

### 质量门禁完整清单（10 项）
| # | 检查项 | 阻塞？ | 数据来源 |
|:---|:---|:---|:---|
| 1 | 编译检查 | ✅ 阻塞 | 项目构建命令 |
| 2 | Lint 检查 | ❌ 非阻塞 | 项目 lint 命令 |
| 3 | 单元测试 | ❌ 非阻塞 | 项目测试命令 |
| 4 | 依赖完整性 | ❌ 非阻塞 | package.json / go.mod 等 |
| 5 | 安全扫描 | ❌ 非阻塞 | npm audit |
| 6 | Spec 一致性 | ❌ 非阻塞 | REQ.md 验收标准 |
| 7 | 测试用例覆盖 | ❌ 非阻塞 | **TEST.md** ← 新增 |
| 8 | 评审项合规 | ❌ 非阻塞 | **REVIEW.md** ← 新增 |
| 9 | 部署项检查 | ❌ 非阻塞 | **DEPLOY.md** ← 新增 |
| 10 | 错误码一致性 | ❌ 非阻塞 | **ERROR_CODES.md** ← 新增 |

## v5.77.0 (2026-08-12) — AI 智能拆分增强：三档粒度 + 完整上下文

### 🤖 split 命令 AI 智能拆分增强
- **问题**: 原 split 的 `--prompt` 模式只给 AI 薄弱的上下文（需求原文 + 分析摘要），无法基于 SpecCore 理念做智能拆分
- **方案**: 重写 split prompt，注入完整 Spec 上下文 + 原子任务原则 + 三档粒度控制

### 📏 三档粒度控制
- **`--granularity macro`**: 粗粒度，每个任务 1-2 周，按业务方向合并（适合 1-3 人独立项目）
- **`--granularity module`**: 中粒度，每个任务 3-5 天，按功能/端拆分（适合 4-8 人标准团队，默认）
- **`--granularity atomic`**: 细粒度，每个任务 1-3 天，按接口/表拆分（适合 8+ 人大团队）
- **STAFFING 联动**: 自动读取 STAFFING.md 团队配置，根据人数推荐最佳粒度
- **用户可覆盖**: `--granularity` 参数覆盖自动推荐

### 📜 完整 AI 上下文
- **CONSTITUTION.md**: 技术宪法（技术栈、命名规范、异常码体系）
- **020-specs/ 全部文件**: ANALYSIS.md + TECH.md + TEST.md + REVIEW.md + RISK.md + DEPS.md + MONITOR.md
- **STAFFING.md**: 团队人员配置（影响任务分配和粒度）
- **原子任务定义**: 独立输入输出 / 00-specs 三件套 / 独立 execute / 明确 AC / 独立 PR
- **合并规则**: 同一实体 CRUD / 页面+接口<5 / 配置微调 / 紧密小功能
- **拆分规则**: 接口>8 / 新表>3 / 超出粒度上限 / 跨端 / 第三方集成
- **依赖关系**: 基础模块优先 / 链深≤3 / 无循环
- **JSON 输出格式**: id/name/type/reason/scope/apis/tables/estimatedHours/priority/dependencies/acceptanceCriteria/risk/owner
- **质量自检**: 6 项自查清单

---

## v5.76.0 (2026-08-12) — 全局分析冲突处理

### 🧠 全局分析 *-old 冲突机制
- **问题**: `analyze --scope global` 从源码反推需求文档时，会覆盖已有的 GLOBAL/ 文件
- **方案**: 与升级冲突一致 — 旧文件重命名为 `*-old.md`，新文件用原名
- **自动检测文件** (TECH_STACK/CODE_INDEX/REQUIREMENT): `global-artifacts.ts` 用 `safeWrite` 写入，内容不同则自动 *-old
- **AI 分析文件** (API_INVENTORY/DATA_MODEL 等 12 个/工程): AI prompt 中加入冲突处理指令，AI 写入前自动检查+*-old
- **PATTERNS/*.md**: 追加不覆盖，不生成 *-old（知识积累型文件）
- **冲突汇总**: AI 写完所有文件后输出冲突清单 + diff 命令

---

## v5.75.0 (2026-08-12) — 升级冲突 *-old 重命名机制

### 🔄 升级冲突处理机制改造
- **旧方案**: 备份到 `.speccore-backup-{timestamp}/` 目录，用户需手动查找
- **新方案**: 冲突文件原地重命名为 `*-old`，新文件用原名，用户直接 `diff` 对比
- **覆盖范围**: AGENTS.md、工具命令文件（.claude/.codebuddy/.cursor/.trae/.windsurf）、Skill 文件、Spec 模板
- **智能判断**: 只有内容真正不同的文件才会生成 *-old，内容相同则静默覆盖
- **清理保护**: `cleanupStaleFiles` 不会删除 *-old 文件，用户合并后手动删除
- **汇总输出**: 升级完成后列出所有冲突文件 + diff 命令，一目了然

---

## v5.74.0 (2026-08-12) — ask 引擎三层增强 + HTML 弹出修复

### 🧠 L1: 同义词表（SYNONYM_MAP）
- **纯数据层**：50+ 口语化表达 → 23 个命令，不改架构
- **匹配顺序**：命令名精确匹配 → **同义词表** → 触发词（同义词表优先于触发词，避免“改名”被“改”触发词截胡到 change）
- **覆盖示例**：看板/dashboard、提交代码/pr、改名/rename、新手/welcome、审计/analyze
- **效果**：用户说“看板”“提交代码”等口语均可直接匹配到对应命令

### 🔀 L2: 端配额（Endpoint Quota）
- `findRelevantCode` 按端分组 → 每端最多占 limit 的 40% → 轮询取结果
- 避免单端文件垄断搜索结果，前后端/移动端均有代表

### 📝 L3: API 契约关联查询
- 新增 `loadContractApiPaths`：加载项目中的 API_CONTRACT.yaml
- 命中契约路径的文件加 15 分，关键词命中契约描述加 3 分
- 搜索范围：`.speccore/**/API_CONTRACT.yaml` + `Iteration-*/**/API_CONTRACT.yaml`

### 🖥️ HTML 弹出修复
- welcome/help/dev 三个命令新增 `[SPECCORE_WELCOME/HELP/DEV: path]` 标记
- **welcome TTY 分支全路径覆盖**：3 个退出路径（未初始化/无迭代/正常）均输出标记
- AI 宿主（Qoder/Trae/Cursor 等）可识别并用 present_files 展示 HTML 页面
- AGENTS.md 标记表新增 4 行（WELCOME/HELP/DEV/ABOUT）

### 🐛 置信度计算修复
- KB 匹配成功（含同义词表）置信度从 55 提升到 **75**（高分区），本地直接执行
- 用 `Math.max()` 确保同义词匹配的置信度不被 `recognizeIntent` 的低分拖塾
- 避免同义词匹配被误路由到宿主 AI，节省 token 并消除 15 秒超时

---

## v5.73.0 (2026-08-11) — Onboarding 页面重构 + 视觉增强

### 🎨 Onboarding 页面结构重构
- **标题改为 HTML**：SVG 标题 → `<h1>` + titleGlow 发光动画（40px Orbitron 渐变字体）
- **SVG 只保留四卡片**：连线 + 中央圆圈 + 四个模式卡片，其余全部 HTML 化
- **底部横栏 HTML 化**：统一入口 `/spec-ask` 文字改为 HTML `bottom-bar`
- **SVG 坐标准确**：所有元素 y 坐标 -60px 紧凑布局，消除顶部空白

### 🔗 模板自动复制
- **ask 命令生成引导页时**自动从 `templates/html/` 复制关联页面到 `outputs/`
- 不再需要手动 `cp`，5 个模板页面（explain/guide/match/pipeline/help）自动同步

### ✨ 视觉细节
- **标题发光**：所有页面 titleGlow 统一使用 `filter:drop-shadow()`（兼容渐变文字）
- **流水线卡片**：flow-step 左右内边距 18→28px，圆圈与文字间距 6→12px
- **标签文字居中**：知识库匹配/工作流生成等标签文字移入背景矩形内
- **复制命令更新**：点击复制从 `speccore ask` → `/spec-ask`

---

## v5.72.0 (2026-08-11) — 影响分析 + 质量门禁 + 统一匹配 + 澄清持久化

### 🎯 结构化影响分析（ImpactReport）
- **三级影响分类**：🔴直接影响 / 🟡间接影响 / 🟢无影响
- **`analyzeImpact` 替代 `smartMatchTasks`**：读取 REQ.md + TECH.md + TASK.md + .task-status 全量分析
- **双向依赖图**：正向 findDependentTasks + 反向 findReverseDependencies
- **`buildTaskDetails`**：为澄清 Prompt 收集每个任务的完整上下文

### 📝 澄清结果持久化
- **澄清 = 需求分析**，结果写入文件而非用完即丢
- 新增需求 → 结构化 REQ.md（描述 + 要点 + 验收标准）
- 需求变更 → `020-specs/CHANGE_SUMMARY.md`（影响报告 + 受影响任务）
- 任务级变更也记录到 CHANGE_SUMMARY.md

### 🚧 执行后质量门禁
- **强制运行**：execute 后自动触发，不可跳过
- **6 项检查**：编译(阻塞) + Lint + 测试 + 依赖 + 安全 + Spec一致性(警告)
- **4 语言支持**：Node.js / Java / Go / Python
- **失败修复循环**：编译失败 → AI 修复 → 再检查 → 最多 3 轮
- **`speccore verify`** 独立命令：可单独跑验证

### 🔍 统一智能匹配（resolver.ts）
- **所有命令共用** `resolveTask()` / `resolveIteration()`
- **三级匹配**：精确 → 前缀 → 关键词搜索（任务名 + REQ.md）
- **多匹配提示**：列出候选让用户选择，不再静默取第一个
- **已接入**：change / execute / lifecycle / validate / verify

### 🎨 HTML 页面统一
- retro 页面：宽度 560→800px + 发光效果 + 质量门禁结果展示
- welcome/about/init 页面：统一 card 800px + cardGlow/titleGlow/grid-pattern

### 📦 新增文件
- `src/core/verify-engine.ts` — 代码验证引擎 + 质量门禁
- `src/core/resolver.ts` — 统一智能匹配模块
- `src/commands/verify.ts` — verify 命令入口
- `docs/change-and-new-requirement-design.md` — 需求变更/新增设计文档

---

## v5.71.0 (2026-08-11) — Task 目录结构重构 + 文档截图 + README 更新

### 📁 Task 目录结构重构（破坏性变更）
- **新增 `.meta/`**：统一存放任务元信息（type/status/owner/created-at）
- **新增 `00-specs/`**：执行前核心规格（REQ/TECH/TASK/SCHEMA/CHANGELOG）
- **新增 `10-backend/`**：后端实现代码目录（src/tests）
- **新增 `20-frontend/`**：前端实现代码目录（{platform}/src/tests）
- **新增 `99-artifacts/`**：执行产出（TEST/REVIEW/DEPLOY/RISK/DEPS/MONITOR/ADR）
- **预创建 `.issues.md`**：问题追踪文件
- **change 命令增强**：自动更新 CHANGELOG.md，done 状态回退为 needs-rework
- **全量路径迁移**：28 个文件中的 backend/ → 00-specs/10-backend/，frontend/ → 20-frontend/

### 📸 文档视觉化
- 为所有 HTML 页面生成截图（about/dashboard/dev/welcome/ask-pipeline/retro/help）
- README.md 嵌入截图，提升视觉吸引力
- 新增设计文档 `docs/task-directory-design.md`

### 📝 文档更新
- README.md 目录结构更新为最新规范
- 版本号同步更新

---

## v5.70.0 (2026-08-11) — Ask 引擎 v2.0：三段式动态路由 + 意图缓存 + 宿主AI增强

### 🧠 Ask 引擎 v2.0 架构重构
- **三段式动态路由**：高分区(≥70)本地直出 / 中分区(45~69)双路并行取优 / 低分区(<45)AI接管
- **四层路由体系**：确定性路由 → 意图缓存 → 本地引擎 → 宿主AI → 自有LLM冗余 → 兜底
- **意图缓存与自学习**：精确匹配 + 模糊匹配(编辑距离≤2) + 命中统计固化
- **Rich Context 构建器**：为宿主AI提供候选意图/项目阶段/活跃迭代/历史命令完整上下文
- **多 LLM 冗余路由**：Ollama / OpenAI 兼容 Provider，按优先级排序，默认全部禁用
- **统一配置体系**：`.speccore/config/ask.json` + 环境变量覆盖，支持 `highThreshold` / `lowThreshold` / `forceHostAi`
- **`--rules` 强制开关**：命令行显式触发或配置持久化，强制所有 ask 走 AI 语义增强

### 🛠 新增核心模块
- `src/core/ask-config.ts` — Ask 引擎统一配置管理（环境变量 > ask.json > 默认值）
- `src/core/intent-cache.ts` — 意图缓存与自学习引擎
- `src/core/ask-context.ts` — Rich Context 构建器

### 🐛 代码审查问题修复（15项）
- **Critical**: 严格模式预检缺失、重复 `--only` 过滤、move 事务 rollback 不完整
- **Major**: 错误码误用、函数名歧义、路径匹配缺陷、路径遍历防护、禁用命令描述、引号正则修复
- **Minor**: 重复 return、API 文档解析、硬编码前缀、动态 require、统一参数解析

### 🗑 清理
- 删除冗余目录 `.speccore-backup-*` / `test-trae/`
- `.gitignore` 增加 `test-trae/` 排除规则

---

## v5.67.55 (2026-08-09) — AI 行为约束 + 自动模式分级 + examples 完善

### 🧠 AI 行为约束
- **Skill 重写**：spec-ask SKILL.md 从旧版（含 schedule 示例）重写为严格约束版
- **禁止 schedule**：所有 Skill 显式禁止 schedule 命令，定时需求改为立即执行
- **强制 --topic**：迭代/任务创建必须带英文主题词
- **每步确认**：非自动模式下每步展示结果等用户确认

### 🤖 自动模式分级
- **PARTIAL_AUTO**: 用户指定自动范围（如 "analyze 和 plan 自动，execute 前确认"）
- **FULL_AUTO**: 用户说"全自动/一键完成"时全流程自动

### 🐛 修复
- `getIterationDir` 同时接受短名和完整名（修复迭代双前缀 bug）
- `task list` / `iteration list` 新增子命令（修复 ExitCode 1）
- `init --update` 无迭代时给出明确提示

### 📦 examples 项目完善
- `examples/meeting-system/` 完整示例：28 个文件，含完整需求、分析、任务
- README 含技术栈、快速开始、命令示例、自动模式说明

---

## v5.67.51 (2026-08-08) — 架构重构：宿主 AI 语义分析 + 全局路径修复

### 🔄 架构变更
- **撤销 CLI 关键词匹配**：`askEngine` 不再做规则引擎意图识别，输出 KB 交给宿主 AI 自主分析
- **保留 LLM/host AI 层**：自有 LLM（需 `SPECCORE_LLM_KEY`）+ 文件协议，仅通过 `--rules` 显式触发
- **默认走宿主 AI 语义分析**：`speccore ask` 输出命令知识库 + 工作流模板，AI 自行判断并拼命令

### 🐛 路径修复
- **迭代目录路径**：所有命令（analyze🔒/plan🔒/execute🔒/split🔒/task create）写入 `.speccore/ITERATIONS/Iteration-NNN-name/` 而非项目根目录
- **新增 `getIterationDir()` 公共函数**：自动查找迭代目录，向后兼容 fallback

### ✨ 新功能
- **`--topic` 英文主题词**：iteration create / task new 支持 AI 提取英文关键词（如 `meeting-system`/`user-login`）
- **迭代目录结构完善**：新增 `sources`/`materials`/`prototypes`/`converted`/`images`/`plans` 默认子目录
- **升级首次引导页**：`init --update` 重置 onboard 标记，下次 ask 弹出 HTML

### 🗑️ 移除
- **daemon 调度引擎**：删除 `schedule-engine.ts`/`schedule-store.ts`，schedule 命令回归轻量 CRUD
- **废弃命令黑名单**：AGENTS.md 明确标记 `schedule daemon`/`execute --auto --force`

### 🎯 交互确认
- **管道模式每步确认**：非自动模式下每步输出 `[SPECCORE_CONFIRM_STEP]` 等待用户
- **自动模式仍全跑**：用户说了"一键/全自动"时跳过确认

---

## v5.65.0 (2026-08-08) — 智能意图合成 + 定时调度完善 + about 页面

### 🧠 Ask 引擎：synthesizeIntent
- 参数提取→上下文补全→命令自检→精准提问 四步链路
- 加权得分系统替代硬关键词匹配
- 双模式：自主(确认后全自动) / 交互(分步确认)
- SPECCORE_INTENT 意图确认块 + SPECCORE_CONFIRM_NEEDED

### ⏰ 调度增强
- 懒启动/懒停止：有调度才运行，无 pending 自停
- 跨平台 daemon：macOS LaunchAgent / Linux crontab / Windows Task Scheduler
- schedule retry 重调度、多调度并存管理
- `init`/`init --update` 自动安装系统守护
- `schedule create` 自动重装 daemon 到当前项目

### 📖 speccore about
- 版本信息 HTML 页：功能概览+近期亮点+里程碑+文档链接
- `file://` 链接直接可点开 + SPECCORE 标签供 WorkBuddy

### 🪟 引导页
- init/update 后重置标记，首次 ask 输出引导页
- `file://` 链接 + SPECCORE_ONBOARD 标签双输出

### 📋 plan --select + 文档更新
- plan --select 任务多选模式
- DESIGN.md + command-reference.md 补充全部功能设计

---

## v5.51.0 (2026-08-07)## v5.64.0 (2026-08-08)

### 🧠 智能意图合成 `synthesizeIntent`

Ask 引擎核心升级 — 理解→补全→自检→引导：

- **参数提取**: 时间/类型/优先级/批次/名称 自动从输入提取
- **上下文补全**: iteration/batch/daemon 自动从当前项目补全
- **自我检查**: 命令验证 + 置信度计算 + 遗漏检测
- **精准提问**: AI 能推断的自动补；仅真正歧义时才确认
- **双模式**: "自主"→确认后全自动；未说明→分步确认

### ⚡ 意图得分系统

关键词硬匹配 → 加权得分：
动作词(定时+40/分批+30) + 上下文(计划+20/任务+15) + 复杂度判定

### ⏰ Daemon 定时调度修复

- **BUG**: `interval.unref()` 进程立即退出 → LaunchAgent 频繁重启
- **BUG**: `--all` 调度未传参数给 execute → 命令失败
- **BUG**: daemon WorkingDirectory 指向旧项目 → 读错 schedule.json
- **修复**: 删除 unref() + 自动安装 LaunchAgent + 创建时重指向当前项目

### 🖥️ Windows 跨平台

pgrep → `findDaemonPids()` 跨平台；`schtasks` 转义 → `spawnSync` 直接传参

### 🪟 懒启动 + 📋 Plan 增强 + 📖 `speccore about`

daemon 随用随启/用完自停；`plan --select` 多选；about 版本信息 HTML 页

---

## v5.51.0 (2026-08-07)

### 🏗️ OpenSpec 标准 Skill 体系重构

**AGENTS.md 路由表** — 62 行决策表，AI 始终加载：
- 🚫 核心禁止规则 × 5
- 📋 Skill 路由表 × 12（`| 用户说 | → | 动作 |`）
- 🔄 退出码 → 下一个 Skill 交接

**12 个 Skill 统一格式**：
- YAML frontmatter（name + description + allowed-tools）
- 🚫 禁止规则（每个 3-6 条）
- `execute_command` 100% 覆盖
- 4 个 `references/` 模板目录

### ⚡ Ask 引擎全面升级

- `autoExec` 字段：pipeline/guide/match 三种模式全部自动执行
- `handleMatch` 正确拼子命令（`task new -n "..."`）
- 模板变量替换：`{time}` → 完整时间格式
- `extractPlanSlug`：任务名关键词拼入计划文件名

### 🖥️ 全平台调度

- macOS LaunchAgent / Linux crontab / **Windows Task Scheduler**
- `schedule daemon install` 三端统一

### 📋 Plan 命令增强

- 文件命名：`PLAN-{ts}-{slug}.md`，统一在 `000-overview/plans/`
- Mermaid 依赖图 + 甘特图
- 8 章 PMBOK 精简结构（风险评估/里程碑/回滚方案）
- 10 种任务类型（feature/bugfix/review/test/docs/refactor/deploy/security/performance）

### 🎉 升级仪式感

- 首次使用/版本升级 → ask 先输出 onboarding HTML → 再执行任务

### 🐛 修复

- 移除全部 "输出命令给用户复制" 残留
- `speccore-router` 核心原则：不执行 → 必须执行
- `doc2spec` AI 上下文自动安装 pandoc
- 分支名与任务目录名保持一致

---

## v5.28.0 (2026-08-06)

- Prompt/Apply 架构
- ask 引擎四模式路由
- 调度守护进程

## v5.37.1 (2026-08-07) — "全类型任务 + 调度自动执行"

### 🎯 10 种任务类型
- feature / bugfix / research / review / test / docs / refactor / deploy / security / performance
- spec-task-create: 类型选择器 + 上下文主动建议
- spec-analyze: 每种类型独立分析模板（自动+交互双模式）
- spec-execute: 代码生成交互确认

### ⏰ 调度自动执行
- daemon 写 trigger 文件 → AI Skill 自动检测 → 完整 Prompt/Apply
- 中断恢复: context.json 追踪 + 重开自动继续
- `schedule daemon install`: macOS LaunchAgent / Linux crontab 开机自启

### 🔧 其他
- 分支名 = 任务目录名（feature/Task-001-name）
- execute 前置检查: ANALYSIS.md/REQUIREMENT.md 内容有效性校验
- Excel/CSV Bug 列表导入 + 图片提取
- spec-iteration-create + spec-task-create 智能命名
- 12 个 Skill 全部高阶标准

## v5.30.0 (2026-08-07) — "数据保护 + 智能升级"

### 🛡️ 升级保护

- **CONSTITUTION.md**: 永远不覆盖，已存在时跳过
- **context.json**: 永远不覆盖
- **Iteration-sample/**: 永远不覆盖
- **UPGRADE.md**: 检测模板变化时自动生成，含 before/after 对比
- **last-init-version.txt**: 追踪上次初始化版本

### 📋 升级提示

- init 无 --force 时也显示升级提示
- 自动更新文件清单（AI-RULES/AGENTS/Skills/模板）
- AI 模式 + 手动模式双路径

### 🔌 管道传递

- `execute --response -` 支持 stdin 管道（`cat file | speccore execute --response -`）

### 🧠 spec-ask v4

- 五分支决策树（match/ambiguous/explain/pipeline/guide）
- 低置信拒绝（<45%）+ 歧义检测（gap <15%）
- [SPECCORE_MODE] 标记供 Skill 解析
- 全部 10 个 Skill 达到高阶标准

### 📖 设计文档

- DESIGN.md 新增第 13-14 章（编排引擎 + 升级保护）

---

## v5.29.0 (2026-08-07) — "可执行编排引擎"

### 🧠 spec-ask: 从操作手册到可执行编排器

- **5 分支精确指令**: match/ambiguous/explain/pipeline/guide，每个分支精确到工具调用和参数
- **[SPECCORE_MODE] 标记**: ask 命令始终第一行输出模式，Skill 可精确解析
- **歧义检测**: confidence gap < 15% → ambiguous 模式，展示候选项让用户选择
- **低置信拒绝**: confidence < 45% → 拒绝匹配，提示重新描述
- **AI 60s 超时**: 防止 LLM 无响应卡死
- **临时文件传递**: AI 返回内容通过 /tmp 文件传递，避免 shell 引号断裂
- **Pipeline 产物传递**: 每步完成后自动 Read 文件获取下一步参数

### 🔧 修复

- onboarding 页面卡片布局（SVG + badge + ft 垂直排列）
- 移除已废弃的 import 意图
- 所有 HTML 页面统一 body/card 居中布局

---

## v5.28.0 (2026-08-07) — "Prompt/Apply 协作架构"

### 🏗️ 重大架构: Skill + CLI + AI 协作循环

- **Prompt 标准化引擎** `src/core/prompt-builder.ts`
  - 统一的 Spec → AI Prompt 构建器，支持 execute/analyze/split/plan 四种类型
  - 自动读取 CONSTITUTION.md + REQ.md + 数据模型，构建结构化上下文
  - 标准化输出格式: `[SPECCORE_PROMPT]...[/SPECCORE_PROMPT]`
  - AI 返回解析: `parseAiResponse()` 提取 `{"files":[...]}`

- **execute 命令 🔒 AI**: `--prompt` 输出代码生成 Prompt，`--response` 接收 AI 代码写文件
- **analyze 命令 🔒 AI**: `--prompt` 输出分析 Prompt，`--apply` 接收分析写入 ANALYSIS.md
- **split 命令 🔒 AI**: `--prompt` 输出拆分 Prompt，`--response` 接收 Task 列表创建目录
- **plan 命令 🔒 AI**: `--prompt` 输出排程 Prompt，`--response` 接收计划写入 plan.json

### 📋 CONSTITUTION 增强

- 新增"项目名称"列（业务名，如"食堂后台管理"），与工程名分离
- AI 据此理解业务范围，analyze/split 时作为上下文参考

### 🧹 质量治理

- **init 自动清理**: `cleanupStaleFiles()` 移除旧版本残留命令文件和 Skill 目录
- **移除 import 意图**: 已不存在的命令从意图识别中移除
- **ask 引擎增强**: 
  - 平台参数提取（"初始化tae"→`--tool=trae`）
  - match 模式增加完整命令展示和确认交互
  - KB 匹配时整合 extractedParams
- **doc-validator**: 6 维文档质量检测（编码/结构/表格/API/图片/内容），自动生成 VALIDATION.md

### 📖 文档

- `docs/DESIGN.md` 新增第 10/11/12 章：
  - Prompt/Apply 协作循环完整流程图
  - 两层调度机制 (WorkBuddy Automation + CLI schedule)
  - 与 OpenSpec/Claude Code/Cursor 横向对比

---

## v5.26.0 (2026-08-05) — "AI 万能入口 + 视觉化看板"

### v5.26.1 (2026-08-05)

- 🐛 `welcome` 命令加入简洁模式 help 列表
- 🆕 `help` 命令支持 TTY 自动检测，AI 模式输出 HTML 分类卡片
- 📄 保存 help HTML 模板到 templates/html/

### v5.26.3 (2026-08-05) — "Qoder 全命令注册 + 文档清理"

- 🐛 init 注册 20 个 Qoder/TRAE/Claude 命令（之前仅 10 个），含 welcome/ask/dashboard 等
- 🐛 修复 dev 无期次时的友好提示，区分未初始化 vs 无期次
- 🧹 统一 5 个工具目录各 20 个命令文件，清理残留旧文件
- 🧹 修复 help.ts/场景实战/迁移指南中过时引用（status-panel→dashboard, 17→20, 45→55）
- 📖 README 新增 11 个文档链接 + 三层 AI 架构图

### v5.26.2 (2026-08-05) — "三层 AI 架构 + Dev 流水线"

#### 🤖 三层 AI 架构
- **自有 LLM** (OpenAI/Ollama) — 环境变量配置，零代码
- **宿主 AI** (WorkBuddy/TRAE/Qoder) — 自动检测，文件协议通信
- **规则引擎** — 18 条命令 KB，永远可用兜底

#### 🔄 Dev Pipeline AI 引导
- `dev` 命令 AI 模式输出交互 HTML 页面
- 前端 `devAI()` 引擎：8 命令 KB + 6 意图模式 + 300ms AI 思考动画
- 5 个快捷按钮 + 7 阶段跳转 + 自然语言输入
- 服务端 `devAiGuide()` + `dev-llm.ts` 三层 AI 调用

#### 🎨 页面统一
- 所有页面四边脉冲扫描线 + Ocean 商务主题
- Footer 版本号统一 (`package.json` 自动读取)
- Light 模式边框适配
- Header 飘动文字 + 全屏按钮

### 🧠 ask — 万能 AI 入口重构
- **4 模式引擎**: 📖命令解释 / 🗺️任务指引 / 🎯意图匹配 / ⚡复杂编排
- **18 条命令知识库**: 完整用法、示例、关联命令
- **4 种预定义工作流**: 新功能全流程、Bug修复、批量执行、代码审查
- **Unicode 框线美化终端输出**: 四模式色彩高亮
- **TTY 智能适配**: 终端→框线，AI调用→HTML页面

### 📊 dashboard — 全局仪表盘
- `--scope global` 全量视图，7 大 Jira 标准维度
- 项目健康度评分 + Created vs Resolved + 迭代进度
- 9 套主题 + 中英文 i18n + Hybrid/Orbit/Mono 字体
- S/M/L/XL 字号调节 + F 键全屏 + 四边脉冲扫描线
- Light 模式完整边框适配 + 需求详情表内滚动

### 🏷️ welcome — 项目名片
- 彩色架构卡片 + 4 模式 Ask 引导
- 确认 CTA 按钮 + 流水线可视化
- TTY/HTML 双模式

### 🔄 dev — Pipeline HTML
- 7 阶段流水线可视化 + 当前阶段高亮
- TTY 终端 + HTML 页面双模式

### ⚙️ 命令重构
- 所有 19 条命令描述统一中文
- `global-status` → 重定向到 `dashboard --scope global`
- `track` 合并 `trace` + `tracker`
- 简洁模式 +sync/search/track

---

## v5.25.3 (2026-08-05)

### 🐛 Qcoder 集成修复
- **目录名修正**: `.qcoder/` → `.qoder/`（匹配 Qoder 官方规范）
- **补齐 `commands/` 子目录**: Qoder 项目级指令路径应为 `.qoder/commands/`
- **层级化结构**: 命令文件移至 `.qoder/commands/spec/`，输入 `/spec` 即可浏览 10 条子命令
- **格式适配**: 使用 Qoder 原生 Markdown 格式（无需 YAML frontmatter），旧 `.qcoder/` 自动清理

### 🐛 ask 命令修复
- **注册 `iteration create` 子命令**: 之前只有 import 没有 `.command()` 注册，导致 `speccore ask "创建期次"` 选择后执行失败
- **注册 `task new` 子命令**: 同上，补全 `taskCmd.command('new')` 注册
- **输入校验**: 用户输入 `3.1` 等无效序号时给出友好提示（而非静默执行错误命令）
- **显示优化**: 子步骤编号改用 `▸` 前缀，避免和选项序号混淆
- **错误提示增强**: 命令执行失败时显示具体错误信息和直接运行的提示
- **命令总数更新**: 51 → 58（+ `iteration create` + `task new` + `progress` + `report` + `archive` + `dashboard` + `sync-global`）

### 🐛 补注册 5 个漏掉的命令
全面排查发现 5 个命令有完整实现但从未在 CLI 注册：
- `progress` — 查看期次进度（任务完成率 + 各阶段统计）
- `report` — 生成项目报告（团队/风险/趋势分析）
- `archive` — 归档任务（移至 archive/ 或从归档恢复）
- `dashboard` — 全量层可视化仪表盘（Chart.js HTML）
- `sync-global` — 期次 ↔ 全量层双向同步

---

## v5.25.2 (2026-08-04)

### 🚀 AI 上下文增强
- **N:M 端↔工程映射**: CONSTITUTION 新增「对应需求端」列，一个工程可对应多个需求端
- **AI Prompt 注入配置**: AI 上下文自动读取 CONSTITUTION 项目信息 + 端工程映射表

---

## v5.25.0 (2026-08-04)

### 🚀 核心架构升级
- **AI 上下文引擎**: 替代关键词匹配，支持纯需求/纯代码/联合三种模式
- **00-产品需求/**: 产品原始需求按端分目录(APP/H5/小程序/管理后台)，递归扫描
- **智能拆分**: 复杂度估算 + STAFFING人员排期 + 语义依赖 + 动态优先级
- **多工程 CONSTITUTION**: 表格化项目信息，支持多工程 Git 分支独立配置

### 🔧 增强
- 全局分析增强: 自动检测技术栈,生成 CODE_INDEX/REQUIREMENT
- 意图识别 +6: 创建期次/分析需求/拆分任务/提交PR/完成任务
- ask 选择后自动执行命令
- 分支管理: 四级降级(期次→CONSTITUTION→git→本地)
- 6工具适配: QCoder/Claude/CodeBuddy/Cursor/Trae/WindSurf

### 🐛 修复
- dev: 路径检测 + ANSI渲染
- split: 冲突检测 + --force
- doc2spec → 00-产品需求/
- logger中文终端

---

## v5.22.0 (2026-08-02)

### 🚀 analyze 命令全面升级 — 统一分析引擎

`analyze` 从单纯的「需求分析」扩展为「需求+代码」统一分析引擎。

**三种输入模式:**
- 纯需求: `--req docs/a.md` — 完整性扫描 + 架构影响
- 纯代码: `--src backend,frontend` — 代码健康 + 复杂度 + 依赖分析
- 联合分析: `--src backend --req docs/req.md` — 需求-代码对标

**三种输出范围:**
| `--scope global` | `.speccore/GLOBAL/` | 全局代码健康 + 架构审查 |
| `--scope iteration` (默认) | `期次-XX/00-需求文档/` | 期次需求分析 + 代码对标 |
| `--scope task` | `期次-XX/Task-NN/` | 任务分析 + 文档补全 |

**代码分析能力:**
- 语言/目录/文件统计、API 接口清单(自动提取)、复杂度热点(>800行/ TODO/FIXME)
- 依赖分析(循环依赖检测+核心模块识别)、最大文件 TOP 10

**新增/修改文件:**
- `src/core/analyze-engine.ts` — 统一分析引擎 (~1100行)
- `src/commands/analyze.ts` — 重构为瘦编排层
- `src/cli.ts` — 新增 `--src`/`--req`/`--scope`/`--depth` 参数

**CLI 示例:**
```bash
speccore analyze --scope global --depth deep              # 全局代码健康
speccore analyze --src backend,frontend -I Q1             # 多目录联合分析
speccore analyze --scope task -t Task-01 -I Q1            # 任务级分析+补全
speccore analyze --src backend --req docs/login.md --scope global  # 全模式
```

## v5.11.0 (2026-07-21)

### 🆕 word2spec — Word 需求文档一键导入
- `speccore word2spec` 命令 (.docx/.doc → SpecCore Markdown)
- 图片自动提取到 `期次/00-需求文档/images/`
- Task 共享引用路径: `../../00-需求文档/images/`
- .doc 旧格式自动升级 (via LibreOffice)
- INDEX.md 自动生成 + 接口表格智能检测

### 📦 word2spec / word2md Skills
- 对话式: "把 Q3 的 PRD 转成 Spec"
- Shell 脚本: `scripts/convert.sh` 可独立运行
- word2md: 纯格式转换（无 SpecCore 依赖）

### 🐛 Bug 修复
- Controller body 与返回类型一致 (Result<?> → Result.error())
- 口语标准化「修了个bug」→「修复: bug」等 3 处修复
- any 类型 28→6，未使用 import 全面清理

## v5.10.0 (2026-07-21)

### 🆕 备份与回滚
- `speccore rollback` 命令：从 .bak 恢复 Spec 文件
- `--list` 列出备份 / `--confirm` 确认恢复
- CONSTITUTION.md AI 规则：修改 Spec 前自动创建 .bak

### 📐 AI 操作规则
- 两阶段确认流程（变更分析 → 执行计划）
- 变更履历自动追加
- 影响范围自动评估

## v5.9.2 (2026-07-21)

### 🔧 config 增强
- `--rule <name> --set <value>` → 写入 CONSTITUTION.md spec-rule
- `--tech <target> --set <value>` → 写入 TECH_STACK.md
- 口语自动标准化

## v5.9.1 (2026-07-21)

### 🔧 iteration create 增强
- 自动更新 GLOBAL/INDEX.md 期次关联表格

## v5.9.0 (2026-07-20)

### 🆕 sync --detect
- 扫描代码 vs REQ.md 差异检测
- 报告: + 代码有 Spec 没有 / - Spec 有代码没有

### 🆕 pattern save
- 三种输入: --task / --content / --file
- 自动占位符 {{Entity}} 替换

## v5.8.1 (2026-07-20)

### 📐 TECH_STACK.md 解析
- `loadTechStack()` 检测语言/框架
- execute 显示当前技术栈

## v5.8.0 (2026-07-20)

### 🆕 三层 Spec 协同
- CONSTITUTION.md spec-rule 区块解析
- 规则自动注入代码生成（异常/返回/ORM/校验）
- 新增 `src/core/spec-rules.ts`

## v5.7.2 (2026-07-20)

### 🔧 change 增强
- 口语描述自动标准化
- 短 Task ID 支持

## v5.7.1 (2026-07-19)

### 🔧 execute 代码生成优化
- Java 包名/类名修复
- REQ.md 接口表格 → 方法骨架自动生成

## v5.7.0 (2026-07-19)

### 🆕 Hotfix 例外流程
- `execute --hotfix`: 30min 宽限 + 24h 强制补录
- validate/progress 显示 hotfix 状态

## v5.6.3 (2026-07-14)

### 🧹 大规模清理
- 删除 5 个死模块 (file/git/safe-write/tx-wrapper/task-lock)
- 18 处未使用导入清理
- 移除无用依赖 glob
- rv 别名补充 --format 选项

## v5.6.4 (2026-07-14)

### 📝 文档
- 场景数引用 12/20→22 统一
- 中英文 30 处错误修复

## v5.6.5 (2026-07-14)

### 🔴 Bug 修复
- i18n: 翻译键显示修复 (build 脚本拷贝 locale JSON)
- 迭代名: 自动去除多余 期次- 前缀

## v5.6.6 (2026-07-14)

### 🔧 体验增强
- execute: --task=Task-001 短 ID 自动前缀匹配全名

## v5.6.7 (2026-07-14)

### 🔴 Bug 修复
- handover/retro: 路径缺少 期次- 前缀导致崩溃
- change: 补充 --req 选项

## v5.6.8 (2026-07-14)

### 🆕 国际化
- i18n 翻译全覆盖 + t() 辅助函数
- en-US.json 120+ 翻译键
- search/delete/execute 双语验证通过

## v5.6.9 (2026-07-14) — 最新

### 🔴 根源修复
- 迭代名双重前缀根治: context 存储 raw name, 目录构建加前缀
- 验证: trace/delete/handover/retro 全部正确


### 🆕 新增
- **`speccore delete`**: 安全删除 Task/期次，移至 .speccore/trash/ 并自动清理 INDEX / context / git-mapping
- 支持 `--task=<id>` `--iteration=<name>` `--force`
- 支持手动恢复（mv 回原位 + index-update）

### 📝 文档
- 命令参考/速查卡/场景实战中英文同步补充 delete 命令
- 命令数更新: 46→47


### 🔴 双向追溯
- **反向同步**：`speccore sync` 扫描代码中 `@spec` 注释，自动更新 TASK.md 产出物清单
- **自动生成 TRACE.md**：`_shared/TRACE.md` 记录代码→Spec 追溯链
- **代码扫描**：`src/core/reverse-sync.ts` 支持 .ts/.java/.py/.go/.vue 等 9 种语言

### 🔴 Git 集成
- **自动分支**：`speccore execute --task=Task-001` 自动创建 `feature/Task-001-xxx` 分支
- **分支映射**：自动写入 `.speccore/.git-mapping.json`

### 🔴 缺陷修复
- 深度审计 14 项代码缺陷全部修复（Zod Schema / 死代码 / 空值保护 / 正则兼容）

### 📝 文档
- 快速开始/速查卡中英文补充反向同步使用说明

---

## v5.3.0 (2026-07-11)

### 🆕 新增
- **`speccore diff`**：对比两个期次/基线的任务差异
- **`speccore trace`**：REQ → Task → Code 双向追溯链可视化
- **CI/CD 模板**：`templates/ci/github-actions.yml` GitHub Actions 集成配置

### 📝 文档
- 新增 `docs/速查卡.md`：一页掌握命令 + 安全口诀 + CI 模板
- 新增 4 份英文文档：SDD 方法论 / 使用指南 / 速查卡 / 迁移指南
- README 中英文文档索引纯净分离

### 📊 统计
- **命令总数**：44 个

---

## v5.2.0 (2026-07-11)

### 🔴 安全性
- **全部 35 个命令文件接入 FileTransaction import**：批量完成 tx 导入覆盖
- 修复嵌套目录 `commands/iteration/` 和 `commands/task/` 子目录的相对路径
- **Zod 运行时验证**：`init.ts` 通过 `ContextSchema.safeValidate` 校验 context.json

---

## v5.1.0 (2026-07-11)

### 🔴 核心升级
- **`speccore execute` 真实代码生成**：从 Spec 生成 Java Controller/Service/Repository + Vue 组件骨架
- **`speccore sync` 内容分析**：不再仅检查文件存在性，新增章节完整性和 API 定义验证
- **共享工具提取**：`src/utils/task-utils.ts`（generateTaskId / findProjectRoot / scanIterationTasks）

### 🟡 测试
- **命令层集成测试**：`tests/unit/commands/init.test.ts` 6 个集成测试
- **测试总数**：10 文件 / 148 用例

---

## v5.0.0 (2026-07-11)

### 🏗️ 架构硬化
- **安全写入包装**：`src/core/safe-write.ts` + `src/core/tx-wrapper.ts`
- **文档参数对齐**：命令参考中英文 9 处参数名修正
- `goal.ts`：接入 FileTransaction + 消除重复 generateTaskId

---

## v4.9.0 (2026-07-11)

### 🆕 新增
- **`speccore update`**：更新 Task 属性（status/priority/assignee），事务保护
- **交互式确认**：`execute --interactive` 接入 inquirer 真实命令行交互
- **SDD 方法论文档**：`docs/SDD方法论.md`

### 🟡 测试
- **集成测试**：`tests/unit/core/integration.test.ts` 真实文件系统测试

### 📝 文档
- **英文版工作空间组织**：`docs/workspace-organization.en.md`
- **零安装体验**：快速开始中英文补充 `npx speccore` 说明

---

## v4.8.0 (2026-07-11)

### 🆕 新增
- **分批执行**：`speccore execute --all --batch-size=3` 自动分批 + 上下文隔离
- **断点续传**：`speccore execute --resume` 从上次中断处继续
- **执行状态追踪**：`.speccore/local/execution-state.json` 批次进度持久化
- **Git 工作流整合**：`speccore current` 分支↔任务映射 / Commit 消息 / PR 描述生成
- **Git Hooks**：`speccore hooks install` 安装 pre-commit + pre-push
- **协作锁**：`src/core/task-lock.ts` 防止多人同时修改同一 Task

### 📝 文档
- 新增 `docs/工作空间组织.md`：目录结构 + 多工程协作指南

---

## v4.7.0 (2026-07-11)

### 🆕 新增
- **进度反馈**：实时进度条 + 任务状态 + 耗时统计
- **错误友好提示**：Zod 错误 → 中文可操作建议（`src/core/error-feedback.ts`）
- **操作日志**：`.speccore/logs/` 记录所有关键操作（谁/何时/做了什么）
- **自动备份**：`speccore backup`（create/list/restore）
- **Shell 补全**：`speccore completion [bash|zsh]`

---

## v4.6.0 (2026-07-11)

### 🆕 新增
- **迁移命令**：`speccore migrate` Shell v3.x → CLI v5.x 自动迁移
- **迁移指南**：`docs/migration-guide.md`

---

## v4.5.0 (2026-07-11)

### 🆕 新增
- **i18n 国际化引擎**：`SPEC_LOCALE=en-US` 中英切换，默认中文
- **语言资源**：`src/locales/zh-CN.json` + `en-US.json`
- **CLI 全局选项**：`speccore --lang=en-US`

---

## v4.4.0 (2026-07-11)

### 🔄 增强
- **全部命令事务化**：execute/plan/archive/sync/change 事务保护
- 5 个关键写操作命令具备事务性保证

---

## v4.3.0 (2026-07-11)

### 🆕 新增
- **FileTransaction 模块**：write/delete/move 原子操作 + commit/rollback
- **sync/change 事务化**：多文件修改失败自动回滚

---

## v4.2.0 (2026-07-11)

### 🆕 测试
- **yaml-parser 测试**：22 tests，纯函数覆盖率 96.42%
- **核心模块测试扩展**：global-layer +11 / validator +9
- **测试总数**：7 文件 / 123 用例

---

## v4.1.0 (2026-07-11)

### 🏗️ 基础设施
- **Vitest 测试框架**：替代 Jest，8 文件 / 133 用例
- **Zod 数据模型**：Task / Iteration / Platform / Context Schema

---

## v4.0.0 (2026-07-09)

### 🆕 新增功能
- **多平台任务管理**：`speccore new-task --platforms=web,h5,miniapp`
- **动态平台添加**：`speccore platform-add --name=tablet --tech="React Native"`
- **上下文查看**：`speccore context --task=Task-001`
- **索引自动更新**：`speccore index-update`
- **平台配置**：`.speccore/config/platforms.yaml`
- **WorkBuddy 集成**：`speccore init` 自动创建 `.workbuddy/`

### 🔄 增强
- execute / progress 支持 `--platform=<name>`
- import 新增 `--scope` `--ignore` `--update`
- 意图识别引擎：31 种意图类型

### 📊 统计
- **命令总数**：39 个（原 35 + 新增 4）

---

## v3.0.0 (2026-07-05)

### 🆕 新增功能
- **多项目全量层（Global Layer）**：GLOBAL/ 跨项目需求索引
- **全链路可追溯**：需求→Task→代码双向追踪
- **P0/P1/P2 高级功能**：impact / dashboard / baseline / audit
- **rename 命令**：批量重命名 + 自动更新引用

### 📊 统计
- **命令总数**：35 个（原 26 + 新增 9）

---

## v2.0.0 (2026-07-05)

### 🆕 新增功能
- **意图识别引擎**：12 种意图类型，100+ 关键词匹配
- **12 个新命令**：spec / goal / bugfix / research / change / sync 等
- **上下文感知**：自动读取 context.json 智能填充

### 📊 统计
- **命令总数**：26 个（原 14 + 新增 12）

---

## v1.0.0 (2026-07-05)

### 🆕 初始版本
- **14 个核心命令**：init / import / iteration / task / plan / execute / validate / archive 等
- **核心引擎**：context / state / yaml-parser / template-engine / validator
- **内置模板**：Spring Boot / NestJS Controller
- **npm 发布**：`npm install -g speccore`

---

## 版本号说明

| 版本类型 | 规则 |
| :--- | :--- |
| 主版本号 | 重大架构变更或功能重构 |
| 次版本号 | 新增命令或功能模块 |
| 修订版本号 | Bug 修复或文档增强 |

当前版本：**v5.20.0**

## v5.20.0 (2026-07-31)

### 🎯 双模式初始化
- `speccore init` 默认简洁模式（19 命令）
- `speccore init --full` 全量模式（79+ 命令）
- `.speccore/config/mode.json` 持久化用户选择

### 🔄 交互式协作
- `--interactive` 支持：import / split / plan / analyze / change / done
- 自动模式（默认）+ 交互模式（--interactive）共存

### 📥 存量项目导入
- `import` 支持 .xlsx / .csv 文件导入需求
- 覆盖检测：--update 增量 / --force 覆盖 / --interactive 选择
- `ANALYSIS_PROMPT.md` + `/spec-import-analyze` AI 反工程分析

### 🐛 Bug 批量处理
- `bugfix --batch` 批量导入 + 交互确认
- `bugfix --batch-file` 支持 .xlsx 文件
- `bugfix --schedule night` 夜间执行标记

### 🔧 命令优化
- `spec → ask` 自然语言入口
- `word2spec → doc2spec` 多格式导入
- `task new` 别名 `add → tn`
- 移除重复 `new-task` 命令

### 🚀 智能入口
- `speccore` 直输自然语言触发意图识别
- 帮助横幅升级为 9 步完整闭环

### 📖 文档
- README 重写：简洁模式为主
- 竞品对比章节移除

## v5.21.0 (2026-08-02)

### 🎨 仪表盘升级
- 9 种主题色 (深海蓝/赛博/亮色/灰度/GitHub/SynthWave/琥珀/樱花/森林)
- SVG 饼图 + 圆环图 + 燃尽图 + 甘特图
- 全屏查看 (F键/ESC) + 流动边框动效
- 按后端/前端平台分组展示 + 拼音姓氏排序

### 📊 数据统计增强
- 人员多维统计卡片 (任务/功能/Bug/工时)
- 每人任务清单 (可折叠,默认预览)
- AI时间/人工时间/Review时间追踪
- 期次里程碑 (提测/SIT/UAT/上线) + 延期记录

### 🔧 命令精简
- 70 → 45 命令 (去重 + 合并冗余)
- 简洁模式保持 19 个
- 移除: new/create/dashboard/progress/report/archive/history/goal/hooks

### 📖 文档全量修正
- 25 份文档同步: 命令名/版本/计数全统一
- spec→ask, new-task→task new, 计数同步52
- 示例项目完善至 61 文件

### 🐛 关键修复
- JS 括号失衡→全屏/折叠失效
- 模板语法 ${{x}} → ${x}
- setTimeout 缺闭合
- 意图识别 goal→task new
- ask 增强: 猜不准时带详细步骤推荐

## v5.21.1 (2026-08-02)

### 📖 文档结构化
- 两种用法主表移至命令参考 (17通用+5CLI+3AI)
- README/快速开始引用链接, 单向维护
- 快速开始新增命令速查表 (19命令全覆盖)
- Slash Command 清理: spec→ask, 移除 dashboard/health

### 🐛 修复
- collapsible-body 多余</div>导致折叠无效
- setTimeout 缺闭合 JS 括号失衡
- 全屏 content 可滚动 + 主题切换隐藏
- 中文姓氏拼音排序 (100+映射)
