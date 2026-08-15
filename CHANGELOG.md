## v6.11.0 (2026-08-15) — 知识图谱可视化增强 + 意图识别语境校准

### 知识图谱可视化增强

- **项目名自动检测**: 三级兜底（project.json → package.json → 目录名），标题不再显示默认 "Project"
- **UI 优化**: 设置按钮下移（top: 120px）、节点放大（+30%）、文字放大（11→13px）
- **物理参数调优**: 节点间距适中（gravitationalConstant -70, centralGravity 0.005, springLength 180）
- **术语统一**: HTML 展示层统一使用"功能模块"（task）和"任务"（subtask）
- **模板保存**: HTML 示例保存到 `templates/html/speccore-knowledge-graph.html`
- **截图文档**: 知识图谱截图添加到 `docs/screenshots/knowledge-graph.png`

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
- `docs/screenshots/knowledge-graph.png` — 新增截图
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
