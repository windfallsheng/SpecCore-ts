# SpecCore AI 分析上下文

> 自动生成 | 2026-08-15 | Scope: 迭代 001-ecommerce-test | Depth: normal

---

## 🏗 项目工程配置 (CONSTITUTION.md)

## 项目信息
| 工程 | 项目名称 | 源码路径 | Git 仓库 | 默认分支 | 对应需求端 |
| :--- | :--- | :--- | :--- | :--- |
| ts-cli | 待填写 | ./ | git@gitee.com:windfullsheng/spec-core-ts.git | main | app, h5, miniapp, admin |
>
>
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

> 以上为项目配置信息。AI 应据此处配置判断各需求端（APP/H5/小程序/admin）对应哪个工程源码。

---


## 🔗 端 ↔ 工程对应关系

> 以下映射来自 CONSTITUTION.md「项目信息」表格的「对应需求端」列

| 工程源码 | 默认分支 | 对应需求端 |
| :--- | :--- | :--- |
| `./` | main | app, h5, miniapp, admin |
| `场景` | main | — |
| `登录时手机号未注册` | main | — |
| `登录密码不匹配` | main | — |
| `...` | main | — |

> **跨端需求**: `_shared/` 或标记为多端共用的需求，AI 分析时应覆盖所有相关工程。
> **调整方式**: 编辑 CONSTITUTION.md → 「项目信息」表格的「对应需求端」列，用逗号分隔多个端。

> 以上为"产品需求端目录"与"工程源码路径"的对应关系。分析时请按此映射对标。

---


## 📋 需求文档

## 来源: INDEX.md

# 本期需求文档索引

> doc2spec 自动生成

| 端 | 文件 | 转换时间 | 来源 |
| :--- | :--- | :--- | :--- |
| requirements | requirementsrequirements.md | 2026-08-07 | test-prd.md |


---

## 来源: REQUIREMENT.md

# 电商系统迭代需求

> 迭代: 001-ecommerce-test  
> 生成时间: 2026-08-15

## 功能模块清单

| # | 功能模块 | 描述 | 涉及端 |
| :--- | :--- | :--- | :--- |
| 1 | 用户认证 | 手机号验证码登录、密码登录、第三方登录 | app, h5, miniapp, admin |
| 2 | 商品浏览 | 商品列表、详情、搜索、分类筛选 | app, h5, miniapp |
| 3 | 购物车 | 添加/删除商品、数量调整、批量结算 | app, h5, miniapp |
| 4 | 订单管理 | 下单、支付、退款、物流跟踪 | app, h5, miniapp, admin |
| 5 | 后台管理 | 商品上架/下架、订单审核、数据统计 | admin |

## APP 端需求

### 1. 用户登录
- **功能**：手机号验证码登录、指纹/面容 ID 快速登录
- **交互**：原生动画过渡、离线缓存用户信息
- **接口**：POST /api/v1/auth/login, POST /api/v1/auth/biometric

### 2. 商品浏览
- **功能**：瀑布流展示、图片懒加载、下拉刷新
- **性能**：首屏加载 < 2s，滑动帧率 ≥ 60fps
- **接口**：GET /api/v1/products?page=1&size=20

## H5 端需求

### 1. 用户登录
- **功能**：手机号验证码登录、微信一键登录
- **适配**：响应式布局，支持手机/平板横竖屏
- **接口**：POST /api/v1/auth/login, GET /api/v1/auth/wechat-oauth

### 2. 商品浏览
- **功能**：无限滚动、骨架屏、图片 CDN 加速
- **SEO**：SSR 渲染商品详情页
- **接口**：GET /api/v1/products?category=electronics

## MiniApp 端需求

### 1. 用户登录
- **功能**：微信授权登录、手机号一键获取
- **限制**：包体积 < 2MB，首屏加载 < 1.5s
- **接口**：POST /api/v1/auth/miniprogram-login

### 2. 商品浏览
- **功能**：虚拟列表、图片压缩、分享卡片
- **体验**：页面切换动画流畅，无白屏
- **接口**：GET /api/v1/products?platform=miniprogram

## Admin 端需求

### 1. 用户管理
- **功能**：用户列表、封禁/解封、行为日志
- **权限**：RBAC 角色控制（超级管理员/运营/客服）
- **接口**：GET /api/v1/admin/users, POST /api/v1/admin/users/{id}/ban

### 2. 商品管理
- **功能**：批量上架/下架、库存预警、价格调整
- **数据**：Excel 导入导出、实时库存同步
- **接口**：POST /api/v1/admin/products/batch-upload, GET /api/v1/admin/products/low-stock

## 后端接口设计

### 认证模块
```yaml
POST /api/v1/auth/login:
  request:
    phone: string
    code: string
  response:
    token: string
    user: { id, name, avatar }

POST /api/v1/auth/wechat-oauth:
  request:
    code: string  # 微信授权码
  response:
    token: string
    openid: string
```

### 商品模块
```yaml
GET /api/v1/products:
  query:
    page: number
    size: number
    category: string
  response:
    total: number
    items: [{ id, name, price, cover }]

GET /api/v1/products/{id}:
  response:
    id: string
    name: string
    price: number
    stock: number
    images: string[]
```

### 订单模块
```yaml
POST /api/v1/orders:
  request:
    items: [{ productId, quantity }]
    addressId: string
  response:
    orderId: string
    amount: number

GET /api/v1/orders/{id}:
  response:
    id: string
    status: pending | paid | shipped | completed
    items: [...]
    logistics: { company, trackingNo }
```

## 数据模型

### 用户表 (users)
```sql
CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  phone VARCHAR(11) UNIQUE,
  name VARCHAR(50),
  avatar VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 商品表 (products)
```sql
CREATE TABLE products (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(200),
  price DECIMAL(10,2),
  stock INT DEFAULT 0,
  category_id VARCHAR(36),
  status TINYINT DEFAULT 1, -- 1:上架 0:下架
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 订单表 (orders)
```sql
CREATE TABLE orders (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36),
  amount DECIMAL(10,2),
  status VARCHAR(20), -- pending/paid/shipped/completed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```


---

## 🗂 源码结构

`src/`
  - index.ts (typescript)
  - cli.ts (typescript)

`src/commands/`
  - about.ts (typescript)
  - archive.ts (typescript, exports: ArchiveOptions)
  - ask.ts (typescript, exports: SVG_ONBOARD)
  - audit.ts (typescript, exports: AuditOptions)
  - backup.ts (typescript, exports: BackupOptions)
  - baseline.ts (typescript, exports: BaselineOptions)
  - change.ts (typescript, exports: ChangeOptions)
  - code-index.ts (typescript, exports: CodeIndexOptions, registerCodeIndexCommand)
  - completion.ts (typescript, exports: completionCommand)
  - config.ts (typescript, exports: ConfigOptions, installHooks)
  - context.ts (typescript, exports: ContextOptions)
  - current.ts (typescript, exports: CurrentOptions, currentCommand)
  - dashboard.ts (typescript, exports: DashboardOptions, generateDashboardHtml)
  - delete.ts (typescript, exports: DeleteOptions)
  - diff.ts (typescript, exports: DiffOptions)
  - done.ts (typescript, exports: DoneOptions)
  - handover.ts (typescript, exports: HandoverOptions)
  - health.ts (typescript, exports: HealthOptions)
  - help.ts (typescript, exports: HelpOptions)
  - history.ts (typescript, exports: HistoryOptions)
  - impact.ts (typescript, exports: ImpactOptions)
  - knowledge.ts (typescript, exports: KnowledgeOptions)
  - lifecycle.ts (typescript, exports: LifecycleOptions)
  - merge-check.ts (typescript)
  - migrate.ts (typescript, exports: MigrateOptions)
  - pattern.ts (typescript, exports: PatternOptions)
  - plan.ts (typescript, exports: PlanOptions, TaskPlan, PlanEntry)
  - progress.ts (typescript, exports: ProgressOptions)
  - prompts.ts (typescript, exports: PromptsOptions, PromptTemplate, PromptParam)
  - rag-index.ts (typescript, exports: RagIndexOptions, registerRagIndexCommand)
  - refresh.ts (typescript, exports: RefreshOptions, registerRefreshCommand)
  - reindex.ts (typescript, exports: ReindexOptions)
  - rename.ts (typescript, exports: RenameOptions)
  - report.ts (typescript, exports: ReportOptions)
  - rollback.ts (typescript, exports: RollbackOptions)
  - schedule.ts (typescript, exports: ScheduleCreateOptions)
  - search.ts (typescript, exports: SearchOptions)
  - spec2doc.ts (typescript, exports: Spec2DocOptions)
  - status.ts (typescript, exports: StatusOptions)
  - sync-global.ts (typescript, exports: SyncGlobalOptions)
  - sync.ts (typescript, exports: SyncOptions)
  - trace.ts (typescript, exports: TraceOptions)
  - tracker.ts (typescript)
  - validate.ts (typescript, exports: ValidateOptions)
  - verify.ts (typescript)
  - watch.ts (typescript, exports: WatchOptions)
  - welcome.ts (typescript, exports: WelcomeOptions, renderWelcomeHtml)
  - analyze.ts (typescript, exports: AnalyzeOptions)
  - context-output.ts (typescript, exports: ContextOptions)
  - dev.ts (typescript)
  - doc2spec.ts (typescript)
  - execute.ts (typescript, exports: ExecuteOptions)
  - global-status.ts (typescript, exports: GlobalStatusOptions)
  - import.ts (typescript, exports: ImportOptions)
  - init.ts (typescript, exports: _updateConflicts, InitOptions, generateSettingsContent)
  - iteration-from-global.ts (typescript, exports: IterationFromGlobalOptions)
  - pr.ts (typescript, exports: PrOptions)
  - retro.ts (typescript, exports: renderRetroHtml)
  - status-panel.ts (typescript, exports: StatusPanelOptions)
  - synthesize.ts (typescript, exports: SynthesizeOptions)
  - update.ts (typescript)

`src/commands/iteration/`
  - list.ts (typescript)
  - create.ts (typescript, exports: IterationCreateOptions)
  - split.ts (typescript, exports: IterationSplitOptions)

`src/commands/task/`
  - list.ts (typescript, exports: TaskListOptions)
  - new.ts (typescript, exports: TaskNewOptions)

`src/core/`
  - ask-config.ts (typescript, exports: AskConfig, LlmProviderConfig, DEFAULT_ASK_CONFIG)
  - ask-context.ts (typescript, exports: AskContext, LocalCandidate, ProjectContext)
  - ask-engine.ts (typescript, exports: CommandKnowledge, PipelineStep, PipelinePlan)
  - ask-host-ai.ts (typescript, exports: isAiContext, detectHostAi, emitWorkBuddySignal)
  - ask-llm.ts (typescript)
  - capabilities.ts (typescript, exports: progressiveSpecGuide)
  - code-index-markdown.ts (typescript)
  - code-scanner.ts (typescript, exports: CodeFile, EndpointInfo, ModuleInfo, APIs: 1)
  - constitution-builder.ts (typescript)
  - context-builder.ts (typescript, exports: buildContextMarkdown, buildCompactContext)
  - context.ts (typescript, exports: Context, HotfixEntry, ContextHistoryEntry)
  - decay-detector.ts (typescript, exports: DecayReport, DecayItem, formatDecayReport)
  - dev-llm.ts (typescript, exports: DevPhase, DevPipelineState, DevActionResult)
  - doc-validator.ts (typescript, exports: ValidationIssue, ValidationReport, generateReport)
  - error-feedback.ts (typescript, exports: FriendlyError, translateZodError, formatFriendlyErrors)
  - git-integration.ts (typescript, exports: GitConfig, TASK_TYPE_TO_BRANCH_TYPE, createTaskBranch)
  - global-artifacts.ts (typescript)
  - global-counters.ts (typescript)
  - global-knowledge.ts (typescript, exports: GlobalKnowledgeOptions)
  - global-layer.ts (typescript, exports: ReqIndexEntry, ProjectEntry, IterationLink)
  - help-panel.ts (typescript, exports: HELP_PANEL)
  - inbox.ts (typescript, exports: InboxFileEntry, InboxScanResult, ManifestEntry)
  - index-guard.ts (typescript, exports: IndexFreshnessResult, LayerStatus)
  - index.ts (typescript)
  - intent-ai.ts (typescript, exports: AiIntentResult)
  - intent-cache.ts (typescript, exports: CachedIntent, IntentCache)
  - intent-recognition.ts (typescript, exports: IntentResult, CommandMapping, getConfidenceLevel)
  - issue-tracker.ts (typescript, exports: IssueEntry)
  - knowledge-visualizer.ts (typescript, exports: KnowledgeVisualizationData, buildKnowledgeHtml)
  - name-validator.ts (typescript)
  - operation-log.ts (typescript, exports: logOperation, logCommand)
  - plan-html.ts (typescript, exports: PlanHtmlTask, PlanHtmlOptions, generatePlanHtml)
  - plan-store.ts (typescript, exports: ExecutionPlan)
  - platform-registry.ts (typescript, exports: fuzzyMatchPlatform)
  - question-checklist.ts (typescript, exports: Question, showQuestionChecklist)
  - questions.ts (typescript, exports: QuestionItem, QuestionContext, isAutoMode)
  - reindex-engine.ts (typescript, exports: ReindexResult, LayerResult, FileEntry)
  - requirement-tracker.ts (typescript, exports: ReqEntry)
  - resolver.ts (typescript, exports: ResolveResult, formatResolveResult)
  - reverse-sync.ts (typescript)
  - risk-scorer.ts (typescript, exports: RiskItem, RiskScore, generateRiskReport)
  - session-state.ts (typescript, exports: CommandSession)
  - short-id.ts (typescript, exports: shortId, iterationId, taskId)
  - spec-annotations.ts (typescript, exports: SpecAnnotation, ModuleGroup, buildModuleGroups)
  - spec-rules.ts (typescript, exports: SpecRules, generateImports, getReturnType)
  - state.ts (typescript, exports: TaskState, IterationState, calculateCompletionRate)
  - task-paths.ts (typescript, exports: TASKS_DIR, TASK_TYPES, getTaskPath)
  - template-engine.ts (typescript, exports: TemplateData, TemplateEngine, templateEngine)
  - transaction.ts (typescript, exports: FileTransaction)
  - unified-config.ts (typescript, exports: SpecConfig)
  - unified-retrieval.ts (typescript, exports: CodeSlice, UnifiedQuery, UnifiedResult)
  - yaml-parser.ts (typescript, exports: ParseResult, validateApiContract, yamlToJson)
  - ai-context-generator.ts (typescript, exports: AIContextInput, AIContextResult)
  - execution-state.ts (typescript, exports: TaskSummary, ExecutionState, BatchStatus)
  - knowledge-graph.ts (typescript, exports: KnowledgeGraph, GraphEntity, GraphRelation)
  - next-steps.ts (typescript, exports: showNextSteps)
  - prompt-builder.ts (typescript, exports: TechStack, ApiSpec, DataModel)
  - quality-audit.ts (typescript, exports: AuditDimension, PlatformAudit, QualityAuditResult)
  - rag-engine.ts (typescript, exports: DocumentChunk, RagIndex, RetrievalOptions)
  - spec-merger.ts (typescript, exports: MarkdownSection, AffectedFeature, MergeResult)
  - validator.ts (typescript, exports: ValidationError, ValidationResult, TaskValidationResult)
  - verify-engine.ts (typescript, exports: CheckResult, VerifyReport, generateReportMarkdown)
  - analyze-engine.ts (typescript, exports: AnalyzeInput, AnalysisResult, SupplementResult)

`src/core/schemas/`
  - context.schema.ts (typescript, exports: HistoryEntrySchema, ContextSchema, DEFAULT_CONTEXT)
  - index.ts (typescript)
  - iteration.schema.ts (typescript, exports: IterationStatusSchema, IterationGoalSchema, IterationStatsSchema)
  - platform.schema.ts (typescript, exports: PlatformConfigSchema, PlatformsConfigSchema, DEFAULT_PLATFORMS)
  - task.schema.ts (typescript, exports: TaskStatusSchema, TaskTypeSchema, PlatformSchema)

`src/i18n/`
  - index.ts (typescript, exports: i18n)
  - t.ts (typescript, exports: t)

`src/utils/`
  - logger.ts (typescript, exports: Logger, logger, ProgressBar)
  - task-utils.ts (typescript, exports: findProjectRoot, ensureProjectRoot, getIterationDir)

### API 清单

- `/api/xxx`


### 模块分组

**Other** (125 文件):
- `src/commands/about.ts`
- `src/commands/archive.ts`
- `src/commands/ask.ts`
- `src/commands/audit.ts`
- `src/commands/backup.ts`
- `src/commands/baseline.ts`
- `src/commands/change.ts`
- `src/commands/code-index.ts`
- `src/commands/completion.ts`
- `src/commands/context.ts`
- `src/commands/current.ts`
- `src/commands/dashboard.ts`
- `src/commands/delete.ts`
- `src/commands/diff.ts`
- `src/commands/done.ts`
- `src/commands/handover.ts`
- `src/commands/health.ts`
- `src/commands/help.ts`
- `src/commands/history.ts`
- `src/commands/impact.ts`
- `src/commands/iteration/list.ts`
- `src/commands/knowledge.ts`
- `src/commands/lifecycle.ts`
- `src/commands/merge-check.ts`
- `src/commands/migrate.ts`
- `src/commands/pattern.ts`
- `src/commands/plan.ts`
- `src/commands/progress.ts`
- `src/commands/prompts.ts`
- `src/commands/rag-index.ts`
- `src/commands/refresh.ts`
- `src/commands/reindex.ts`
- `src/commands/rename.ts`
- `src/commands/report.ts`
- `src/commands/rollback.ts`
- `src/commands/schedule.ts`
- `src/commands/search.ts`
- `src/commands/status.ts`
- `src/commands/sync-global.ts`
- `src/commands/sync.ts`
- `src/commands/task/list.ts`
- `src/commands/trace.ts`
- `src/commands/tracker.ts`
- `src/commands/validate.ts`
- `src/commands/verify.ts`
- `src/commands/watch.ts`
- `src/commands/welcome.ts`
- `src/core/ask-context.ts`
- `src/core/ask-engine.ts`
- `src/core/ask-host-ai.ts`
- `src/core/ask-llm.ts`
- `src/core/capabilities.ts`
- `src/core/code-index-markdown.ts`
- `src/core/code-scanner.ts`
- `src/core/constitution-builder.ts`
- `src/core/context-builder.ts`
- `src/core/context.ts`
- `src/core/decay-detector.ts`
- `src/core/dev-llm.ts`
- `src/core/doc-validator.ts`
- `src/core/error-feedback.ts`
- `src/core/git-integration.ts`
- `src/core/global-artifacts.ts`
- `src/core/global-counters.ts`
- `src/core/global-knowledge.ts`
- `src/core/global-layer.ts`
- `src/core/help-panel.ts`
- `src/core/inbox.ts`
- `src/core/index-guard.ts`
- `src/core/index.ts`
- `src/core/intent-ai.ts`
- `src/core/intent-cache.ts`
- `src/core/intent-recognition.ts`
- `src/core/issue-tracker.ts`
- `src/core/knowledge-visualizer.ts`
- `src/core/name-validator.ts`
- `src/core/operation-log.ts`
- `src/core/plan-html.ts`
- `src/core/plan-store.ts`
- `src/core/platform-registry.ts`
- `src/core/question-checklist.ts`
- `src/core/questions.ts`
- `src/core/reindex-engine.ts`
- `src/core/requirement-tracker.ts`
- `src/core/resolver.ts`
- `src/core/reverse-sync.ts`
- `src/core/risk-scorer.ts`
- `src/core/session-state.ts`
- `src/core/short-id.ts`
- `src/core/state.ts`
- `src/core/task-paths.ts`
- `src/core/template-engine.ts`
- `src/core/transaction.ts`
- `src/core/unified-retrieval.ts`
- `src/core/yaml-parser.ts`
- `src/i18n/index.ts`
- `src/i18n/t.ts`
- `src/index.ts`
- `src/cli.ts`
- `src/commands/analyze.ts`
- `src/commands/context-output.ts`
- `src/commands/dev.ts`
- `src/commands/execute.ts`
- `src/commands/global-status.ts`
- `src/commands/import.ts`
- `src/commands/init.ts`
- `src/commands/iteration/create.ts`
- `src/commands/iteration/split.ts`
- `src/commands/iteration-from-global.ts`
- `src/commands/pr.ts`
- `src/commands/retro.ts`
- `src/commands/status-panel.ts`
- `src/commands/synthesize.ts`
- `src/commands/task/new.ts`
- `src/commands/update.ts`
- `src/core/ai-context-generator.ts`
- `src/core/execution-state.ts`
- `src/core/knowledge-graph.ts`
- `src/core/next-steps.ts`
- `src/core/prompt-builder.ts`
- `src/core/quality-audit.ts`
- `src/core/rag-engine.ts`
- `src/core/validator.ts`
- `src/core/verify-engine.ts`
- `src/core/analyze-engine.ts`

**Config** (3 文件):
- `src/commands/config.ts`
- `src/core/ask-config.ts`
- `src/core/unified-config.ts`

**Tests** (5 文件):
- `src/commands/spec2doc.ts`
- `src/core/spec-annotations.ts`
- `src/core/spec-rules.ts`
- `src/commands/doc2spec.ts`
- `src/core/spec-merger.ts`

**Models** (5 文件):
- `src/core/schemas/context.schema.ts`
- `src/core/schemas/index.ts`
- `src/core/schemas/iteration.schema.ts`
- `src/core/schemas/platform.schema.ts`
- `src/core/schemas/task.schema.ts`

**Utils** (2 文件):
- `src/utils/logger.ts`
- `src/utils/task-utils.ts`

---

## 🤖 AI 分析任务

请对以上需求和源码进行以下分析，并将结果写入对应的分析文档:

### 1. 需求完整性分析
- 逐条检查需求是否覆盖所有功能点、边界条件、异常处理
- 是否有遗漏的非功能需求（性能指标、安全性、兼容性、可维护性）
- 产品需求中模糊或矛盾的表述，提出澄清建议

### 2. 改动范围分析 ⭐
- **功能改动**: 列出每个功能点涉及的具体模块/服务
- **文件级变更**: 预测需要修改的源码文件（从以下模块中识别）:
  - Other: src/commands/about.ts, src/commands/archive.ts, src/commands/ask.ts, src/commands/audit.ts, src/commands/backup.ts, src/commands/baseline.ts, src/commands/change.ts, src/commands/code-index.ts, src/commands/completion.ts, src/commands/context.ts, src/commands/current.ts, src/commands/dashboard.ts, src/commands/delete.ts, src/commands/diff.ts, src/commands/done.ts, src/commands/handover.ts, src/commands/health.ts, src/commands/help.ts, src/commands/history.ts, src/commands/impact.ts, src/commands/iteration/list.ts, src/commands/knowledge.ts, src/commands/lifecycle.ts, src/commands/merge-check.ts, src/commands/migrate.ts, src/commands/pattern.ts, src/commands/plan.ts, src/commands/progress.ts, src/commands/prompts.ts, src/commands/rag-index.ts, src/commands/refresh.ts, src/commands/reindex.ts, src/commands/rename.ts, src/commands/report.ts, src/commands/rollback.ts, src/commands/schedule.ts, src/commands/search.ts, src/commands/status.ts, src/commands/sync-global.ts, src/commands/sync.ts, src/commands/task/list.ts, src/commands/trace.ts, src/commands/tracker.ts, src/commands/validate.ts, src/commands/verify.ts, src/commands/watch.ts, src/commands/welcome.ts, src/core/ask-context.ts, src/core/ask-engine.ts, src/core/ask-host-ai.ts, src/core/ask-llm.ts, src/core/capabilities.ts, src/core/code-index-markdown.ts, src/core/code-scanner.ts, src/core/constitution-builder.ts, src/core/context-builder.ts, src/core/context.ts, src/core/decay-detector.ts, src/core/dev-llm.ts, src/core/doc-validator.ts, src/core/error-feedback.ts, src/core/git-integration.ts, src/core/global-artifacts.ts, src/core/global-counters.ts, src/core/global-knowledge.ts, src/core/global-layer.ts, src/core/help-panel.ts, src/core/inbox.ts, src/core/index-guard.ts, src/core/index.ts, src/core/intent-ai.ts, src/core/intent-cache.ts, src/core/intent-recognition.ts, src/core/issue-tracker.ts, src/core/knowledge-visualizer.ts, src/core/name-validator.ts, src/core/operation-log.ts, src/core/plan-html.ts, src/core/plan-store.ts, src/core/platform-registry.ts, src/core/question-checklist.ts, src/core/questions.ts, src/core/reindex-engine.ts, src/core/requirement-tracker.ts, src/core/resolver.ts, src/core/reverse-sync.ts, src/core/risk-scorer.ts, src/core/session-state.ts, src/core/short-id.ts, src/core/state.ts, src/core/task-paths.ts, src/core/template-engine.ts, src/core/transaction.ts, src/core/unified-retrieval.ts, src/core/yaml-parser.ts, src/i18n/index.ts, src/i18n/t.ts, src/index.ts, src/cli.ts, src/commands/analyze.ts, src/commands/context-output.ts, src/commands/dev.ts, src/commands/execute.ts, src/commands/global-status.ts, src/commands/import.ts, src/commands/init.ts, src/commands/iteration/create.ts, src/commands/iteration/split.ts, src/commands/iteration-from-global.ts, src/commands/pr.ts, src/commands/retro.ts, src/commands/status-panel.ts, src/commands/synthesize.ts, src/commands/task/new.ts, src/commands/update.ts, src/core/ai-context-generator.ts, src/core/execution-state.ts, src/core/knowledge-graph.ts, src/core/next-steps.ts, src/core/prompt-builder.ts, src/core/quality-audit.ts, src/core/rag-engine.ts, src/core/validator.ts, src/core/verify-engine.ts, src/core/analyze-engine.ts
  - Config: src/commands/config.ts, src/core/ask-config.ts, src/core/unified-config.ts
  - Tests: src/commands/spec2doc.ts, src/core/spec-annotations.ts, src/core/spec-rules.ts, src/commands/doc2spec.ts, src/core/spec-merger.ts
  - Models: src/core/schemas/context.schema.ts, src/core/schemas/index.ts, src/core/schemas/iteration.schema.ts, src/core/schemas/platform.schema.ts, src/core/schemas/task.schema.ts
  - Utils: src/utils/logger.ts, src/utils/task-utils.ts
- **数据库变更**: 是否需要新增/修改表结构
- **接口变更**: 新增/修改的 API 端点
- **配置变更**: 环境变量、配置文件、CI/CD 改动

### 3. 风险评估 ⭐
按以下维度详细评估:
| 风险类型 | 具体风险 | 可能性 | 影响 | 缓解措施 |
| :--- | :--- | :--- | :--- | :--- |
| 技术风险 | | | | |
| 业务风险 | | | | |
| 依赖风险 | | | | |
| 安全风险 | | | | |
| 性能风险 | | | | |

### 4. 架构影响评估
- 需求变更对现有架构的影响范围（模块间耦合分析）
- 是否需要新增模块/服务/中间件
- 数据库/接口变更的级联影响

### 5. 需求-代码对标
- 将每个需求功能点映射到具体的代码模块和文件
- 标记需要修改的文件、函数、类型定义
- 识别可能产生冲突的现有逻辑
### 6. 任务拆分建议
- 推荐的任务拆解粒度（建议每个 Task 1-3 天完成）
- 任务间的依赖关系（哪些必须先做完）
- 预估工时参考

### 7. 验收标准建议
- 每个功能点的验收条件
- 回归测试范围

---

## 📝 输出格式

请将分析结果写入以下文件:
- **Iteration-001-ecommerce-test/020-specs/ANALYSIS.md**

同时参考填充同目录下的 TECH.md、TEST.md、REVIEW.md、RISK.md、DEPS.md、MONITOR.md、UI_SPEC.md 模板文件。
