# SpecCore 架构设计

> **锁定期望效果**。本文档描述 SpecCore 的组织规范和流程设计，是代码实现的目标态。

---

## 1. 全局工程组织

### 1.1 工程级

```
workspace/
├── .speccore/GLOBAL/              ← 跨工程全局索引（唯一一份）
│   ├── INDEX.md                   ← 所有迭代的摘要索引（自动生成，≤1500字）
│   ├── OVERVIEW.md               ← 项目全景描述
│   ├── ARCHITECTURE.md           ← 跨工程的服务依赖关系
│   ├── TECH_STACK.md             ← 技术栈概览
│   ├── CODE_INDEX.md             ← 代码路径索引
│   ├── GLOSSARY.md               ← 术语定义表
│   ├── CHANGELOG.md              ← 全局变更日志
│   ├── PROTOTYPE_INDEX.md        ← 原型索引
│   ├── PROJECTS/                 ← 各工程独立目录
│   │   └── {project}/            ← 工程级需求/元数据
│   ├── REQUIREMENTS/             ← 跨工程需求合并视图
│   ├── BASELINES/                ← 基线快照
│   ├── synthesis/                ← [synthesize --full 生成] 跨端综合文档
│   │   ├── CROSS_PLATFORM.md    ← 跨端业务关系 + 接口映射
│   │   ├── ARCHITECTURE.md      ← 全量架构文档
│   │   └── TECH_FULL.md         ← 全量技术方案
│   └── {端名}/                  ← [synthesize --full 生成] 各端分析文档（新路径）
│       └── {platform}/           ← 端名来自 CONSTITUTION（如 admin/h5/backend）
│
├── project-a/                     ← 独立工程 A
│   ├── .speccore/                 ← 工程自己的配置（独立）
│   │   ├── CONSTITUTION.md       ← 技术栈、工程列表、需求端映射
│   │   └── local/context.json    ← 当前活跃迭代
│   ├── src/                      ← 源码
│   └── Iteration-NNN-name/       ← 期次
│
└── project-b/                     ← 独立工程 B
    ├── .speccore/CONSTITUTION.md  ← 不同技术栈
    └── ...
```

### 1.2 分层规则

| 层级 | 职责 | 共享 |
|------|------|:--:|
| **GLOBAL** | 需求合并视图、跨工程索引、服务依赖、跨端综合、各端分析 | 一份 |
| **工程 .speccore/** | 技术栈、规范、平台映射、活跃迭代 | 每工程独立 |
| **工程 Iteration-*/** | 需求文档、分析、任务、进度 | 每迭代独立 |

### 1.3 全局同步

```
工程 A: done/retro → GLOBAL/INDEX.md: Iteration-001: status=70%, features=[auth✓,catalog✓]
工程 B: done/retro → 同文件追加: Iteration-002: status=100%, features=[payment✓]
```

**GLOBAL 存指针，不存副本。**

### 1.4 全局分析产物归类规则（PATTERNS 目录）

全局分析（`speccore analyze --scope global`）除了生成 GLOBAL/ 下的标准文档外，还会从源码中识别可复用模式，沉淀到 **`.speccore/PATTERNS/`** 目录。这是跨迭代、跨工程复用的核心资产。

#### 目录结构（分类 × 端 双层组织）

```
PATTERNS/
├── architecture/          ← 跨端通用架构模式
├── data-model/            ← 跨端通用数据模型模式
├── api-contract/          ← 跨端通用 API 契约模式
├── security/              ← 跨端通用安全模式
├── performance/           ← 跨端通用性能模式
├── shared/                ← 跨端共享模式（v8.3.0+：前后端同名组件自动识别）
├── {端名}/                ← 端专属模式（如 backend/ h5/ admin/）
│   ├── architecture/
│   ├── data-model/
│   ├── api-contract/
│   ├── security/
│   └── performance/
└── TEMPLATES/             ← 写作模板（已有，勿动）
```

#### 五大分类说明

| 分类 | 存放内容 | 触发时机 | 示例 |
|:---|:---|:---|:---|
| **architecture** | 项目结构、模块划分、服务拓扑、分层架构 | Layer 1 扫描发现独特目录组织 | 微服务网关模式、DDD 聚合根设计 |
| **data-model** | 表设计、字段命名、关联关系、索引策略 | Layer 2/3 发现通用字段组合 | 软删除通用字段、多租户数据隔离 |
| **api-contract** | 接口规范、错误码体系、响应格式、版本策略 | Layer 2 发现跨端通用契约格式 | 统一分页响应、标准错误包装 |
| **security** | 鉴权、授权、输入校验、敏感数据处理 | Layer 3 发现可复用安全组件 | JWT 鉴权中间件、RBAC 权限模型 |
| **performance** | 缓存策略、批量处理、异步化、限流降级 | Layer 3 发现性能优化手段 | 多级缓存设计、接口批量查询 |
| **shared** | 跨端共享组件（前后端同名导出） | `pattern-detector.ts` 跨端同名检测 | DTO/VO 映射、统一错误处理 |

#### 文件命名规则

- **通用模式**（不绑定特定端）: `{分类}/{kebab-case模式名}.md`
  - 例: `architecture/microservice-gateway.md`
  - 例: `security/jwt-auth.md`
- **端专属模式**（绑定特定端）: `{端名}/{分类}/{kebab-case模式名}.md`
  - 例: `backend/security/jwt-auth.md`
  - 例: `h5/performance/virtual-scroll.md`

#### 文件内容格式

每个模式文件必须包含以下章节：

```markdown
# {模式名}

> 来源: {工程名} | 端: {端名或"跨端"} | 发现时间: YYYY-MM-DD
> 分类: {architecture|data-model|api-contract|security|performance}

## 适用场景
什么情况下应该使用这个模式。

## 核心实现
```{语言}
// 最小可复用的代码片段（不是完整文件）
```

## 使用示例
如何在实际场景中应用这个模式。

## 注意事项
- 边界条件、限制、依赖
- 与相似模式的区别

## 反例
不要这样用（常见错误写法）。
```

#### 更新规则

1. **追加不覆盖**: 同一模式的新变体在文件末尾追加，用 `---` 分隔
2. **手动编辑允许**: 支持人工补充、修正、合并
3. **自动发现**: 全局分析时自动从源码中识别并生成
4. **端差异处理**: 同一模式在多个端出现时，优先写入通用分类，端差异用段落标注
5. **跨端共享自动识别** (v8.3.0+): `pattern-detector.ts` 在检测阶段自动识别同名模式跨端出现的情况，将 `platform` 从 `backend`/`frontend` 提升为 `shared`，并存入 `shared/` 分类

---

## 1.5 规范数据库分层架构（v6.84.0+ — v6.91.0+）

`.speccore/` 目录不仅是配置存储，更是 **AI 可读的规范数据库**。从 v6.84.0 开始，建立了与 Codex `.codex/` 对齐的五层规范结构，所有层均在初始化时自动创建，支持用户自定义覆盖。

### 1.5.1 五层结构对照

| 层级 | 目录 | 用途 | 对应 Codex | 版本 |
|------|------|------|-----------|------|
| **AGENTS** | `.speccore/AGENTS/` | 专业角色定义（产品分析师、安全审查员等） | `.codex/agents/` | v6.84.0 |
| **RULES** | `.speccore/RULES/` | 编码规范（TypeScript、React、API 设计等） | `.codex/rules/` | v6.85.0 |
| **COMMANDS** | `.speccore/COMMANDS/` | 命令模板（PR 审查、变更影响分析等） | `.codex/commands/` | v6.87.0 |
| **SKILLS** | `.speccore/SKILLS/` | 可复用技能（部署、数据库迁移、缓存等） | `.codex/skills/` | v6.88.0 |
| **HOOKS** | `.speccore/HOOKS/` | 生命周期钩子（pre-execute、post-execute） | `.codex/hooks/` | v6.88.0 |

### 1.5.2 AGENTS 层（v6.84.0+）

**职责**：定义各命令/阶段下激活的专业 AI 角色。

**核心机制**：
- **规范数据库**：每个角色是一个 Markdown 文件，含 `activations` frontmatter 定义激活规则
- **混合调度器**：注册表（`_INDEX.md` 显式配置）+ 自描述（`.md` 文件自含激活规则）双轨合并
- **特化版本解析**：`product-analyst` → `product-analyst-backend`（platform）→ `product-analyst-finance`（industry）的回退链
- **条件过滤**：支持简单表达式（`project.securityLevel > 2`、`project.industry == 'finance'`）

**已覆盖阶段**：
| 命令 | 阶段 | 角色 |
|------|------|------|
| `analyze` | clarify | product-analyst、interaction-designer、security-reviewer |
| `analyze` | confirm-check | product-analyst |
| `split` | default | task-decomposer、dependency-analyst、effort-estimator |
| `plan` | default | schedule-planner、risk-assessor |
| `execute` | quality-gate | compiler、test-engineer、security-reviewer、performance-expert、doc-sync-agent |
| `change` | impact | impact-analyst、regression-tester |
| `pr` | review | code-reviewer、security-reviewer、test-reviewer |
| `audit` | default | security-reviewer、compliance-checker、performance-expert |

### 1.5.3 RULES 层（v6.85.0+）

**职责**：按语言/框架分层的编码规范，在 `execute` 阶段按技术栈自动注入 prompt。

**核心机制**：
- **技术栈匹配**：从 `CONSTITUTION.md` 解析 `language`、`framework`、`database`、`cache`、`frontend`，匹配对应规范文件
- **优先级排序**：高优先级规范先注入（如 security=100 > typescript=100 > react=90）
- **用户自定义覆盖**：`.speccore/RULES/` 下的同名文件覆盖内置默认

**内置规范**：
- `typescript.md` — 类型安全、命名规范、模块组织
- `react.md` / `vue.md` — 组件设计、Hooks 规范、状态管理
- `nodejs.md` — RESTful API、错误处理、依赖注入、数据访问
- `api-design.md` — 幂等性、版本控制、分页、统一响应格式
- `testing.md` — 测试金字塔、单元/集成测试规范
- `security.md` — 输入验证、认证授权、数据保护、OWASP 防护
- `database.md` — 命名规范、表设计、查询规范、迁移规范
- `frontend-common.md` — 响应式、a11y、i18n、性能

### 1.5.4 COMMANDS 层（v6.87.0+）

**职责**：为 CLI 命令提供可配置的 prompt 模板，替换硬编码流程。

**核心机制**：
- **模板变量替换**：支持 `{{key}}` 格式变量注入
- **命令级加载**：`pr.ts` 加载 `pr-review` 模板，`change.ts` 加载 `change-impact` 模板
- **回退策略**：模板不存在时自动回退到硬编码 prompt

### 1.5.5 SKILLS 层（v6.88.0+）

**职责**：按任务关键词匹配的可复用技能指南。

**核心机制**：
- **标签匹配**：每个技能文件含 `tags` frontmatter，与任务关键词模糊匹配
- **按需注入**：execute 阶段根据任务内容选择性注入相关技能

### 1.5.6 HOOKS 层（v6.88.0+）

**职责**：命令执行前后的生命周期检查。

**核心机制**：
- **命名约定**：`pre-{command}.md` / `post-{command}.md`
- **拦截能力**：钩子内容含 `BLOCK:` 标记时可拦截命令执行
- **执行结果**：返回 `{ blocked, reason, messages }`

### 1.5.7 统一注入框架（v6.89.0+）

**`ContextInjector`** 将五层注入统一到一个入口：

```typescript
const injected = await injectAll(basePrompt, {
  projectRoot,
  command: 'execute',
  phase: 'code-gen',
  techStack: { language: 'typescript', framework: 'react' },
  agentContext: { iteration: 'Iteration-001' },
  taskKeywords: ['deploy', 'api'],
  commandTemplate: { name: 'pr-review', vars: { changedFiles: '...' } },
});
```

### 1.5.8 代码知识图谱（v6.90.0+）

**借鉴 Graphify 核心设计**，将项目代码结构化为可查询的知识图谱，替代传统的 RAG 向量索引。

**核心机制**：
- **本地 AST 解析**：基于 TypeScript 编译器 API，零 LLM Token 消耗，代码不出本机
- **真正的图结构**：节点（函数/类/模块/接口/变量/枚举/属性/方法）+ 边（调用/导入/导出/继承/实现/引用/包含/类型）
- **边置信度标签**：`EXTRACTED` = 源码明确写出；`INFERRED` = 分析推断得出
- **社区检测**：Union-Find + 目录结构启发式，自动划分子系统
- **God nodes 识别**：按度数排序，前 10% 标记为核心节点

**输出产物**：
| 文件 | 说明 |
|------|------|
| `graph.json` | 完整图谱数据（节点+边+社区+元数据） |
| `GRAPH_REPORT.md` | 自动报告：God nodes、社区分布、跨社区桥梁、建议问题 |
| `graph.html` | vis-network 力导向图可视化（社区着色、EXTRACTED/INFERRED 线型区分） |

**CLI 集成**：
```bash
speccore code-index --graph --scope src     # 构建图谱
speccore knowledge-explain <node>            # 解释节点
speccore knowledge-path <from> <to>          # 最短路径 BFS
speccore knowledge-query <question>          # 关键词匹配查询
```

### 1.5.9 图谱深度整合（v6.91.0+）

**analyze 阶段注入**：`prompt-builder.ts` 在 analyze 命令时自动读取 `graph.json`，将子系统列表、God nodes、跨社区桥梁注入 prompt，使 AI 分析需求时优先理解现有代码结构。

**PATTERNS 置信度标签**：引入 `EXTRACTED` / `INFERRED` 标签，区分从源码明确提取的模式和分析推断得出的模式。

**MODULE_MAP 自动生成**：社区检测结果自动写入 `MODULE_MAP.json`，包含每个社区的文件路径、God nodes、桥梁节点、跨社区边。

**多模态图谱**：API Contract（OpenAPI/YAML）和 SQL Schema 纳入图谱，生成 `api_endpoint` / `db_table` 节点，自动关联代码中的 handler/controller/entity/repository。

### 1.5.10 统一图谱查询（v7.0.0+）

**融合知识图谱 + 代码图谱的统一查询入口**：

```bash
speccore graph query "订单相关代码"     # 自然语言查询两种图谱
speccore graph entity SRC:auth-AuthCtrl  # 查询特定实体详情
speccore graph related Task-001          # 查询一阶邻居
speccore graph path Task-001 Task-002    # 查找最短路径
speccore graph stats                     # 统计信息
```

**查询机制**：
- 知识图谱匹配：语义标签 / 业务角色 / 描述 / 标题 / ID
- 代码图谱匹配：节点名 / 代码片段 / JSDoc 注释
- 结果融合展示，按综合得分排序

### 1.5.11 语义级节点标签（v7.0.0+）

**让图谱理解代码意图，而不只是记录结构**：

**本地零 Token 提取**（`extractSemanticFromCode()`）：
- JSDoc/TSDoc 注释 → `description`（函数/类的用途说明）
- 文件名/路径关键词映射 → `semanticTags`（25+ 业务域规则：auth→认证授权, order→订单交易）
- 导出名称后缀推断 → `businessRole`（Controller/Service/Repository/Hook 等 12 类）

**AI 增强标注**（全局分析 Prompt 要求）：
- Layer 1 扫描时提取每个源码文件的语义标签
- Layer 3 功能模块分析后补充模块级语义标注
- 输出到 `.speccore/cache/semantic-tags.json`

### 1.5.12 知识图谱 ↔ RAG 索引联动（v7.0.0+）

**双向增强的检索架构**：

```
知识图谱构建完成
    │
    ▼
自动同步 → kg-rag-index.json（每个实体转为 RAG 文档块）
    │
    ▼
RAG 检索时注入图谱上下文
    │
    ▼
retrieveWithGraphContext()：
  Step 1: 关键词搜索知识图谱相关实体
  Step 2: 收集一阶邻居扩展上下文
  Step 3: RAG 索引检索基础结果
  Step 4: 图谱匹配 chunk 获得加分
```

### 1.5.13 LLM 语义增强查询（v7.1.0+）

**从"关键词匹配"升级为"语义理解"**：

**查询词语义扩展**：
- LLM 理解 "订单相关代码" → 扩展为 ["order", "booking", "purchase", "交易", "下单", "订单号"]
- 覆盖 15+ 业务域同义词（订单/用户/支付/内容/消息/数据/搜索/配置/监控/安全/性能/测试/部署）
- `--fast` 模式零 Token，降级到本地规则扩展

**候选结果语义排序**：
- 本地关键词匹配后取 Top 20 候选
- LLM 对候选做语义相关性评分（0-100）
- 综合得分 = 本地得分 × 0.4 + 语义得分 × 0.6
- LLM 给出匹配理由（如"该文件处理订单状态流转，与查询高度相关"）

### 1.5.14 Mermaid 图表渲染（v7.1.0+）

**将分析产物中的 Mermaid 图表渲染为可视化 HTML**：

```bash
speccore graph render diagrams/arch.mmd      # 渲染单个 .mmd
speccore graph render --all                   # 批量渲染 diagrams/ 目录
speccore graph render --extract ARCHITECTURE.md  # 从 Markdown 提取
```

**技术实现**：
- HTML 模板使用 CDN 加载 Mermaid.js（支持离线缓存）
- 响应式布局 + 打印优化
- 自动推断图表类型（时序图/流程图/状态图/类图/ER 图）
- 元信息展示：来源文件、图表类型、生成时间

### 1.5.15 全局分析产物图表化（v7.1.0+）

**分析文档从纯文本升级为"文本 + 图表"双模态**：

**各层级强制图表要求**：

| 层级 | 文档 | 图表类型 | Mermaid 语法 |
|------|------|----------|-------------|
| Layer 2 | `_ASSOCIATION.md` | 模块关系图 + 接口依赖图 | `graph LR/TD` |
| Layer 2 | `_MODULES.md` | 模块全景图 | `graph LR` |
| Layer 3 | 功能模块文档 | 时序图 + 流程图 + 状态图 | `sequenceDiagram/flowchart/stateDiagram` |
| Layer 4 | `INTERACTION_MAP.md` | 跨端交互时序图 | `sequenceDiagram` |
| Layer 4 | `ARCHITECTURE.md` | 架构拓扑图 + 依赖关系图 | `graph TB/LR` |
| Layer 4 | `DATA_FLOW.md` | 数据流图 | `flowchart LR` |
| Layer 4 | `DEPLOYMENT.md` | CI/CD 流程图 | `flowchart LR` |

**图表质量规范**：
- 节点命名用中文业务术语，不用文件名/类名
- 边标注调用关系（调用/依赖/推送/订阅）
- 颜色区分端（前端=blue, 后端=green, 数据库=gray, 第三方=orange）
- 独立 `.mmd` 文件输出到 `diagrams/` 目录，便于批量渲染

### 1.5.16 分析引擎深度增强体系（v7.2.0+）

**核心问题**：AI 生成的分析文档往往只有框架（标题 + 空表格 + 占位符），缺乏实质内容。
**解决方案**：结构化提取 → 上下文注入 → 迭代生成 → 质量门禁 → 交叉引用 → 变更感知的六维增强体系。

#### 结构化数据提取（零 Token）

`src/core/structured-extractor.ts` 基于 TypeScript 编译器 API 本地解析源码，无需 LLM：

| 数据类型 | 提取内容 | 用途 |
|----------|----------|------|
| API 端点 | HTTP 方法、路径、Handler 函数 | 注入分析 Prompt，确保不遗漏接口 |
| Entity 定义 | 类名、字段、类型、关系 | 生成数据模型文档时引用 |
| 路由表 | 路由路径 → 组件/页面 映射 | 前端架构分析 |
| React 组件 | 组件名、Props、Hooks 使用 | 前端组件分析 |
| SQL/Prisma | 表名、字段、索引、外键 | 数据层分析 |

提取结果保存为 `.speccore/structured-data.json`，分析时自动注入 Prompt。

#### 迭代式生成（--iterative）

两阶段生成解决「内容空洞」问题：

```
Phase 1: 生成大纲（章节结构 + 每节核心论点）
Phase 2: 逐节填充（每节独立调用 LLM，携带前文上下文）
```

- 每节有独立的字数目标和内容深度要求
- 前文摘要自动注入，保证跨节一致性
- 支持中断续写（保存 outline + 已填充章节）

#### 单文档深度模式（--deep）

针对单个目标文档的深度分析：
- 字数要求翻倍（标准 2000 字 → 深度 4000 字）
- 图表要求翻倍（标准 2 个 → 深度 4 个）
- 结构化数据全量注入（不采样，不截断）
- 要求包含实现细节（代码片段、配置示例、边界条件）

#### 文档质量门禁

`src/core/doc-quality-gate.ts` 自动生成质量报告：

| 检查项 | 规则 | 权重 |
|--------|------|------|
| 占位符检测 | `待导入|待补充|待填写|TODO|FIXME|XXX` | 25% |
| 字数检查 | <200 字 error，<500 字 warning | 20% |
| 空表格检测 | `\|.*\|.*\|` 行但无数据 | 20% |
| 图表检查 | 必须含 Mermaid 代码块 | 20% |
| 章节检查 | 标准章节缺失 | 15% |

评分 <60 为不合格，需重新生成；60-80 为警告，建议补充；≥80 为优秀。

#### 代码质量门禁（v8.3.0+）

`src/core/verify-engine.ts` 执行后自动运行 16 项检查，三层验证架构：

**L1 结构化检查（确定性，解析文档表格/YAML）**

| 检查项 | 解析源 | 验证内容 |
|--------|--------|----------|
| DEV_GUIDE 合规 | `00-specs/DEV_GUIDE.md` | 改造范围清单 → 文件存在性；接口契约表 → 路由实现 |
| API 契约合规 | `_shared/API_CONTRACT.yaml` | paths 中的接口 → 代码路由匹配（Express/Fastify/Koa/装饰器） |
| Schema 一致性 | `00-specs/SCHEMA.md` | 表结构字段 → 实体类属性匹配（snake/camel 双模式） |
| 依赖一致性 | `knowledge-graph.json` | 上游依赖任务 → 代码中 import/require/调用引用 |

**L2 语义匹配（智能，代码结构分析）**

| 检查项 | 技术方案 | 改进点 |
|--------|----------|--------|
| Spec 一致性 | `extractCodeStructure()` 提取函数/类/路由，与 REQ.md 验收标准做语义匹配 | 从纯关键词匹配升级为「动词+名词→函数名」组合匹配，假阴性大幅降低 |

**L3 启发式检查（兜底，保留原有能力）**

编译检查（阻塞）、Lint、单元测试、依赖完整性、安全扫描（npm audit）、测试用例覆盖、评审项合规、部署清单、错误码一致性、规格文档质量、代码文件非空。

**核心设计原则**：质量门禁必须利用 analyze/split 阶段已精准拆分的文档，而不是重新做全局搜索。每个检查只读本任务目录下的文档（`00-specs/REQ.md`、`DEV_GUIDE.md` 等），确保验证粒度与文档粒度对齐。

#### 契约冲突裁决模型（v8.3.24+）

质量门禁的升级形态。将 16 项检查按影响维度重新组织为三层契约体系，每层对应不同的裁决机制：

```
┌─────────────────────────────────────────────────────────────┐
│                    契约冲突裁决架构                           │
├─────────────────────────────────────────────────────────────┤
│  L1 机器契约          L2 规范契约           L3 架构契约      │
│  (3 项)               (9 项)                (4 项)           │
│                                                             │
│  ⚙️ 编译通过            🤖 Spec 一致性        👤 安全合规    │
│  ⚙️ 单元测试通过        🤖 API 契约合规       👤 依赖完整性  │
│  ⚙️ 代码文件存在        🤖 Schema 一致性      👤 知识图谱一致│
│                        🤖 Lint 合规          👤 部署清单检查 │
│                        🤖 DEV_GUIDE 合规                     │
│                        🤖 测试用例覆盖                       │
│                        🤖 评审项合规                         │
│                        🤖 错误码一致性                       │
│                        🤖 规格文档质量                       │
├─────────────────────────────────────────────────────────────┤
│  裁决机制                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ L1-Auto     │  │ L2-AI       │  │ L3-Human            │ │
│  │ 自动裁决    │  │ 辅助裁决    │  │ 最终裁决            │ │
│  │ fatal→reject│  │ pending-fix │  │ pending-review      │ │
│  │ warn→pass   │  │ 生成修复建议│  │ 执行 verdict 命令   │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**三档配置模式**（`.speccore.yml`）：

| 模式 | L1 | L2 | L3 | 阻断执行？ | 适用场景 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `full` | 自动裁决 + 阻断 | AI 辅助 + 等待确认 | 人工最终 + 阻断 | L1 fatal / L3 pending | 标准开发 |
| `l1-only` | 自动裁决 + 阻断 | 仅报告，不阻塞 | 仅报告，不阻塞 | 仅 L1 fatal | 快速迭代 |
| `report-only` | 仅报告 | 仅报告 | 仅报告 | 永不阻断 | CI 试点 |

**裁决书**：每个任务执行后自动生成 `ARBITRATION_REPORT.md`，含三层契约的完整裁决记录、汇总统计、人工裁决入口。

**`speccore verdict` 命令**：
- `--list`：列出所有待裁决冲突（L2 pending-fix + L3 pending-review）
- `--conflict <id> --decide <outcome> --reason <说明>`：进行人工裁决
- `--report <Task-ID>`：查看指定任务的裁决书

#### UI 质量门禁（v8.3.47+）

在代码质量门禁之外，SpecCore 提供独立的 UI 验证体系，覆盖端到端冒烟测试、视觉回归检查和 API 契约测试。

**三层使用模式**：

| 模式 | 命令 | 场景 |
|:---|:---|:---|
| 独立模式 | `speccore verify --ui --url=https://example.com --spec=./test.yaml` | 任意系统验收，零门槛 |
| 项目内独立 | `speccore verify --ui` | 项目级回归，不绑任务 |
| 任务绑定 | `speccore verify -t Task-001 --ui` | 规范驱动，测试是验收标准 |

**四层验证能力**：

1. **冒烟测试（Smoke Test）**：基于 Playwright 无头浏览器执行结构化操作流程（fill/click/navigate/screenshot 等），断言 DOM 状态（visible/text/url 等）。
2. **视觉检查（Visual Check）**：调用视觉模型对比基准图与当前截图，检测布局偏移、元素缺失、颜色变化、文字变动等。支持多模型切换（Qwen-VL/OpenAI/Anthropic/本地模型）。
3. **单图质量扫描（First-run）**：无基准图时，视觉模型对单张截图做通用 UI 质量检查（白屏/布局崩坏/文字重叠/裂图/弹窗报错等）。
4. **API 契约测试（v8.3.49+）**：读取 `API_CONTRACT.yaml`，批量发送 HTTP 请求并校验 status/jsonPath/header/body 断言。

**视觉模型配置体系（v8.3.50+）**：

```yaml
# .speccore.yml
quality_gates:
  verify_ui:
    enabled: true
    threshold: normal          # strict | normal | loose
    devices: [desktop]         # desktop | mobile | tablet
    browsers: [chromium]       # chromium | firefox | webkit
    visual_model:
      provider: qwen-vl        # qwen-vl(默认) | openai | anthropic | local
      model: qwen-vl-max
      # apiKey: ${DASHSCOPE_API_KEY}
      # endpoint: https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
      # timeout: 60000
```

四层配置优先级：命令行 `--visual-model` → 任务级 `quality-gate.yaml` → 项目级 `.speccore.yml` → 默认 `qwen-vl`。

**报告输出**：
- 任务级：`Task-001/99-artifacts/ui-verify-report.html`（含截图对比、执行步骤、问题列表）
- 迭代级：`000-overview/quality-report.html`（全局汇总 + 按功能模块 + 按端 + 任务明细）

#### Pipeline 内置测试节点（v8.3.60+）

在环境驱动部署流水线中，测试作为独立节点嵌入 build 和 deploy 之间，按严重程度决定是否阻断部署。

**五层测试类型**：

| 类型 | 说明 | 阻断 deploy？ |
|:---|:---|:---:|
| `build-check` | 编译检查 + Lint + 单元测试 | critical |
| `smoke` | Playwright 无头浏览器页面可达性 | critical |
| `visual` | AI 视觉模型截图对比分析 | warning |
| `api` | API_CONTRACT.yaml 结构验证 | warning |
| `all` | 全部测试类型依次执行 | 按子类型 |

**测试时机**：

| stage | 执行时机 | 阻断 deploy？ | 适用场景 |
|:---|:---|:---:|:---|
| `pre-deploy`（默认） | build 后、deploy 前 | critical 阻断 | 构建产物检查、基础门禁 |
| `post-deploy` | deploy 后 | 不阻断，只报告 | 端到端验收、线上监控 |
| `both` | 前后都测 | pre 阻断 / post 不阻断 | 完整质量闭环 |

**严重程度分级**：

| 严重程度 | 触发条件 | 行为 |
|:---|:---|:---|
| **critical** | build-check 失败、HTTP 5xx、连接失败 | 阻断 deploy，输出 `[SPECCORE_PIPELINE_TEST_FAIL]` |
| **warning** | visual 差异、api 契约差异、HTTP 404 | 不阻断，先 deploy，输出 `[SPECCORE_PIPELINE_TEST_DEFERRED]` |

**配置示例**：

```yaml
# .speccore/environments/staging.yaml
pipeline:
  test:
    enabled: true
    type: smoke
    stage: pre-deploy
    fail_on_error: true
    auto_fix: true
    max_retries: 3
```

**执行流程**：

```
pipeline --env staging --all
    │
    ▼
Step 1: checkout → pull → merge
    │
    ▼
Step 2: build（各端并行）
    │
    ▼
Step 3: test（Pipeline 内置测试节点）
    │    ├─ 测试类型：smoke/visual/api/build-check/all
    │    ├─ 测试时机：pre-deploy / post-deploy / both
    │    ├─ 严重程度：critical（阻断）/ warning（不阻断）
    │    └─ auto_fix：失败时输出 AI 自动修复标记
    │
    ▼
Step 4: deploy（测试通过或 warning 级别时继续）
```

#### 分层测试策略（v8.3.60+）

四层阶段映射，一键执行对应层级的测试组合：

```
开发阶段                PR 阶段                部署阶段                发布阶段
    │                     │                     │                     │
    ▼                     ▼                     ▼                     ▼
┌─────────┐         ┌─────────┐         ┌─────────┐         ┌─────────┐
│ 编译检查 │         │ 代码质量 │         │ 构建检查 │         │ 全量回归 │
│  Lint   │   →    │ 冒烟测试 │   →    │ 冒烟测试 │   →    │ 视觉回归 │
│ 单元测试 │         │ API契约 │         │         │         │ API契约 │
└─────────┘         └─────────┘         └─────────┘         │ 性能基线 │
                                                            └─────────┘
```

**阶段映射**：

| stage | 自动参数 | 覆盖范围 | 推荐耗时 |
|:---|:---|:---|:---:|
| `dev` | `--type all` | 编译 + Lint + 单元测试 | 2-3m |
| `pr` | `--type all --ui --smoke-only --api-contract` | 代码质量 + 关键页面冒烟 + API 契约 | 5-10m |
| `deploy` | `--ui --smoke-only` | 仅 UI 冒烟测试 | 2-5m |
| `release` | `--ui --api-contract --perf` | 全量 UI + API + 性能 | 15-30m |

**配置驱动**：

```yaml
# .speccore/environments/staging.yaml
stages:
  dev:
    config: null                        # 使用内置代码质量验证
  pr:
    config: .speccore/tests/pr.yaml     # PR 阶段测试场景
  deploy:
    config: .speccore/tests/smoke.yaml  # 冒烟测试场景
  release:
    config: .speccore/tests/release.yaml # 全量回归场景
```

**快捷命令**：

```bash
speccore verify --stage dev      # 开发阶段
speccore verify --stage pr       # PR 阶段
speccore verify --stage deploy   # 部署阶段
speccore verify --stage release  # 发布阶段
```

#### 语义定位引擎

`src/core/semantic-locator.ts` 支持自然语言定位功能单元：

```
用户输入: "分析 TECH.md 中的订单模块"
↓
意图识别: docName=TECH.md, featureName=订单
↓
关键词扩展: 订单 → [order, booking, purchase, 交易, 下单, 订单管理, ...]
↓
文档定位: 在 TECH.md 中搜索含关键词的章节
↓
代码关联: 在 structured-data.json 中搜索匹配的 API/Entity/Component
↓
全局扫描: 在 GLOBAL/ 文档中搜索相关背景信息
↓
上下文构建: 整合所有定位结果生成注入 Prompt
```

#### 变更驱动的增量更新

`src/core/change-impact-global.ts` 基于 Git diff 检测文档 freshness：

```
1. 读取文档头部的 `last-analyzed: <commit>`
2. git diff <commit>..HEAD --stat
3. 映射变更文件 → 受影响的端/模块/文档
4. 在文档头部添加 stale 标记和重新分析建议
```

#### 迭代分析临时缓存

`.speccore/cache/iterations/{name}/` 目录结构：

```
cache/iterations/Q2/
├── context/          # 每次分析的上下文摘要（JSON）
├── locations/        # 语义定位结果（Markdown）
├── snapshots/        # 代码结构化数据快照
└── outlines/         # 迭代生成的大纲和中间产物
```

缓存策略：
- 自动写入：每次分析自动保存上下文和定位结果
- 手动清理：`speccore analyze --clear-cache`
- 过期清理：超过 30 天的缓存自动删除

### 1.5.12 用户自定义文档模板层（v8.3.41+）

**职责**：允许用户用自己的文档模板覆盖或扩展 `analyze` 命令生成的规格文档风格。

**核心机制**：
- **三级目录**：`.speccore/templates/{global|iteration|task}/` 分别对应全局分析、迭代分析、任务分析
- **同名覆盖**：用户模板与系统文档同名时，完全替换系统模板内容（如 `TECH.md`）
- **异名追加**：用户模板为系统未定义的文档名时，追加到生成列表（如 `MY_CUSTOM.md`）
- **分层查找（task 级别）**：`type/platform/` > `type/` > `_shared/` > 根目录 > 内置模板

**目录结构**：

```
.speccore/templates/
├── global/          ← 全局分析文档模板（REQUIREMENT.md、TECH.md、FUNCTION_MAP.md 等）
├── iteration/       ← 迭代级文档模板（各端的 TECH.md、TEST.md、UI_SPEC.md 等）
└── task/            ← 任务级文档模板（RISK.md、DEPS.md、MONITOR.md、REVIEW.md 等）
    ├── feature/
    │   ├── api/     ← 仅 api 端的功能任务
    │   └── _shared/ ← 所有 feature 类型任务通用
    ├── bugfix/
    └── _shared/     ← 所有任务类型通用
```

**Prompt 注入方式**：
`analyze.ts` 在构建 prompt 时调用 `loadUserTemplates()` 读取用户模板，将模板内容注入到 `## 📄 用户自定义模板` 章节，并附加指令：
> 检测到 `.speccore/templates/{level}/` 下有用户自定义模板，**必须按这些模板的章节结构和风格生成文档**。

**初始化行为**：
`speccore init` 自动创建 `.speccore/templates/{global,iteration,task}/` 三个空目录，并写入 `README.md` 说明用法。

---

## 1.6 临时工作区架构（v8.3.0+）

**解决场景**：用户需要澄清/调研与当前迭代无关的内容，或尚未创建迭代时就需要处理需求。

**传统问题**：`clarify` 命令强制绑定迭代，独立内容没有存放位置。

### 1.6.1 目录结构

```
.speccore/local/workspace/
├── inbox/                    ← 原始输入暂存
│   └── {YYYY-MM-DD-HHMMSS-xxxx}/
│       ├── source.md         ← 用户原始输入
│       └── meta.json         ← 条目元信息
├── clarify/                  ← clarify 产出
│   └── {id}/
│       └── PRD.md
├── research/                 ← research 产出
│   └── {id}/
│       └── REPORT.md
└── index.json                ← 条目索引
```

### 1.6.2 核心流程

```
用户输入内容
    │
    ▼
stageContent() ──→ inbox/{id}/source.md
    │
    ▼
AI 处理（宿主 AI 直接处理，或 speccore clarify --apply）
    │
    ▼
writeWorkspaceOutput() ──→ clarify/{id}/PRD.md
    │
    ▼
确认无误后
    │
    ▼
promoteToIteration() ──→ Iteration-xxx/020-specs/requirements/
```

### 1.6.3 CLI 命令

```bash
# 创建临时条目（clarify --local 自动调用）
speccore clarify "需求描述" --local
speccore clarify --from notes.md --local --prompt

# 管理临时工作区
speccore workspace list                    # 列出所有条目
speccore workspace list --type clarify     # 按类型过滤
speccore workspace show <entryId>          # 查看详情和原始输入
speccore workspace clean --days 30         # 清理旧条目

# 提升到迭代层
speccore clarify --promote <entryId> --to <iteration>
```

### 1.6.4 与 Ask 引擎的集成

当 Ask 引擎识别到 `clarify` / `research` 意图但缺少迭代上下文时：

1. **确认提示**：展示两种处理方式（speccore 流程 vs 普通 AI 对话）
2. **默认本地模式**：用户选择 speccore 流程但未指定迭代时，自动附加 `--local`
3. **闭环提示**：`--prompt` 模式下输出 Prompt 的同时创建工作区条目，提示后续 `--apply --local` 命令

### 1.6.5 设计原则

- **不污染迭代目录**：临时内容完全隔离在 `.speccore/local/workspace/`
- **可提升**：确认有价值的临时产出可以通过 `--promote` 提升到迭代层
- **自清理**：`workspace clean` 自动清理过期条目，避免无限膨胀
- **索引化**：`index.json` 跟踪所有条目状态（pending/done/promoted）

---

## 2. CONSTITUTION.md 设计

### 2.1 端列表（全局权威，v6.46.0+）

CONSTITUTION.md 的「## 端列表」章节是全项目唯一的端名来源：

```markdown
## 端列表（全局权威）

| 端名 | 描述 | 类型 |
| :--- | :--- | :--- |
| backend | 后台服务 | backend |
| h5 | 移动 H5 端 | frontend |
| admin | 后台管理端 | frontend |
```

**核心原则：端名 = 工程名，一一对应。**

- 端名是全项目唯一的标识符
- 所有命令（analyze/split/execute）、目录名（020-specs/{feature}/{端}/）、模板目录（templates/{level}/{端}/）均使用此处声明的端名
- 「项目信息」表格的「对应端」列引用此列表中的端名，每行只填一个

**端发现优先级（统一）**：
```
Layer 0: CONSTITUTION.md「## 端列表」章节 ← v6.46.0+ 全局权威
Layer 1: CONSTITUTION.md「对应端」列
Layer 2: 020-specs/{feature}/ 下的子目录扫描 ← 从功能模块目录中收集端名
Layer 3: 默认 ['web']
```

**跨端需求处理链路**：
```
需求（可能跨端）→ analyze 分析文档（综合内容 + 按端分章节）
               → split 按端拆 Task（每个 Task 对应一个工程）
               → execute 在各自工程目录生成代码（物理隔离）
```

### 2.1.1 项目信息表（工程→端映射）

```markdown
| 工程 | 项目名称 | 源码路径 | Git 仓库 | 默认分支 | 对应端 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| admin-web | 后台管理端 | ./packages/admin | git@xxx/admin.git | main | admin |
| h5-app | 移动H5端 | ./packages/h5 | git@xxx/h5.git | main | h5 |
| backend-service | 后台服务 | ./packages/backend | git@xxx/backend.git | main | backend |
```

一一对应：每行一个工程对应一个端名（不填多个）。

### 2.2 技术栈

```markdown
## 技术栈
### 后端: 语言 / 框架 / 数据库 / 缓存
### 前端: 框架 / 状态管理 / UI 组件
```

### 2.3 Git 分支策略

```markdown
- 默认分支: main
- 父任务分支: feature/{Task-ID}
- 子任务分支: feature/{Task-ID}-{platform}（v8.3.10+，与任务 ID 保持一致，无随机 hash）
- 发布分支: release/{version}
- 保护分支: main, master, release/*, production
```

**保护分支规则：**
- 在 CONSTITUTION.md 的「保护分支」字段配置，支持精确匹配和通配符（如 `release/*`）
- 保护分支上禁止直接 commit 和 push，只能通过 PR 合并
- 通过 pre-commit 和 pre-push git hook 自动拦截
- 允许从保护分支创建任务分支，但不允许直接在其上工作

**分支创建策略（懒创建 + 依赖合并，v8.3.8+）：**
- 每个子任务的分支在执行前才创建，确保依赖任务的代码已存在
- 依赖来源优先从 `task.dependencies` 读取，回退 IMPACT.md
- 依赖分支查找三层回退：1) 当前会话已创建分支  2) `.git-mapping.json` 历史记录  3) `git branch -a` 列表
- 多依赖时依次合并多个分支，冲突提示手动解决
- 分支名默认格式：`{type}/{prefix}{taskId}`，支持自定义 `branchFormat`

```
Task-001-booking-service 执行前:
  checkout main → 创建 feature/Task-001-booking-service → 执行

Task-002-h5-mobile 执行前（依赖 Task-001-booking-service）:
  checkout main → 创建 feature/Task-002-h5-mobile
  → merge feature/Task-001-booking-service（三层查找）→ 执行
```

**计划自动生成策略：**
- 用户执行 `speccore plan` 时始终生成 `PLAN.md` + `speccore-plan.html`
- 用户执行 `speccore execute` 多任务时（>1 个任务），自动生成计划文件到 `000-overview/plans/`
- 计划包含：依赖拓扑图（Mermaid）、甘特图（实际日期）、执行概览表、任务详情、风险评估、里程碑、回滚方案
- `generatePlan()` 按依赖感知分阶段：每阶段放入当前可并行的任务（依赖已完成的优先）

### 2.4 智能端识别与双层架构

**核心原则：一份需求文档对应一个端，跨端通用文档单独标识。**

#### 2.4.1 三层推断机制

`analyze` 命令通过以下优先级自动识别需求文档所属的端：

**第一层：文件路径推断（优先级最高）**
```typescript
// 目录名包含端名
010-requirements/app/REQUIREMENT.md      → app 端
010-requirements/h5/login.md             → h5 端

// 文件名前缀/后缀包含端名
app-requirement.md                       → app 端
requirement-admin.md                     → admin 端
```

**第二层：文件内容推断**
扫描文档前 50 行，匹配以下模式：
```markdown
## APP 端需求              → app 端
### H5端登录流程            → h5 端
> Admin 端平台说明          → admin 端
```

**第三层：智能默认策略（无法推断时）**
| 文档类型 | 判断依据 | 处理方式 |
|:--|:--|:--|
| **跨端通用文档** | REQUIREMENT.md / INDEX.md / PRD.md | ✅ 加入全局分析<br>✅ 用于生成全局基线文档 |
| **其他未识别文档** | 既无端名也非通用名 | ⚠️ 输出警告提示<br>→ 端专属文档使用占位符 |

#### 2.4.2 数据处理流程

```
需求文档输入
    ↓
┌─────────────────────────┐
│  inferPlatformFromPathOrContent()  │
│  - 检查文件路径           │
│  - 扫描文档内容           │
└──────────┬──────────────┘
           ↓
    ┌──────────────┐
    │ 能推断出端？   │
    └──┬───────┬───┘
       YES     NO
        ↓       ↓
   端专属文档  跨端通用？
   (不加入全局)  YES → 加入全局
                 NO  → 警告 + 占位符
```

#### 2.4.3 三层架构生成规则（v8.3.17+）

**全局文档（020-specs/overview/）**
- 来源：所有跨端通用文档的内容
- 包含：ANALYSIS.md, DEPS.md, RISK.md, MONITOR.md, REVIEW.md, FUNCTION_MAP.md
- 用途：建立迭代级基线，供所有端共享

**功能模块文档（020-specs/{feature}/overview/）**
- 来源：该功能模块的综合分析内容
- 包含：REQUIREMENT.md, ANALYSIS.md, TECH.md, TEST.md, UI_SPEC.md
- 用途：按功能模块组织规格，便于按需查阅和后续变更定位

**端专属文档（020-specs/{feature}/{端}/ 子目录）**
- 来源：该端在该功能模块下的专属文档内容
- 包含：TECH.md, TEST.md, UI_SPEC.md
- 用途：指导各端差异化实现

**数据隔离保证：**
```typescript
// ❌ 错误：端专属内容污染全局分析
if (inferredPlatform) {
  allContent.push(content);  // 不要这样做
}

// ✅ 正确：端专属内容只用于该端
if (inferredPlatform) {
  platformFileMap[inferredPlatform].push(filePath);
  // 不加入 allContent
} else if (isGlobalDoc) {
  allContent.push(content);  // 只有跨端文档才加入全局
}
```

#### 2.4.4 实现位置

- **端推断函数**：`src/core/analyze-engine.ts::inferPlatformFromPathOrContent()`
- **内容分割函数**：`src/core/analyze-engine.ts::splitContentByPlatform()`
- **端专属文档生成**：`src/core/analyze-engine.ts::buildTechSpecForPlatform()`
- **调用入口**：`src/core/analyze-engine.ts::generateSpecsFromRequirements()`

### 2.5 端名语义映射与目录层级简化（v6.39.1+ / v6.40.0+）

#### 2.5.1 端名语义映射（v6.39.1+）

**问题背景**：
CONSTITUTION.md 中定义的端名可能是中文（如 `H5移动端`、`后台管理端`），而需求文档中的写法也可能不一致（如 `H5 移动端` vs `h5`）。之前的精确匹配逻辑导致无法识别。

**解决方案**：
引入 `PLATFORM_ALIAS_MAP` 语义映射表，支持多种写法自动映射到标准端名。

```typescript
const PLATFORM_ALIAS_MAP: Record<string, string[]> = {
  'h5': ['h5', 'h5移动端', 'h5移动', 'mobile', '移动端', '手机浏览器'],
  'admin': ['admin', '后台管理端', '后台', '管理端', 'web', 'pc', '桌面端'],
  'app': ['app', '客户端', 'ios', 'android', 'native', '原生'],
  'miniapp': ['miniapp', '小程序', '微信小程序', '支付宝小程序'],
  'backend': ['backend', '后端', '服务', 'api', 'server', '服务端']
};
```

**推断优先级**：
1. 文件路径推断（不变）
2. **语义映射匹配（新增）** ← 关键改进
   - 扫描需求文档前 50 行
   - 匹配别名列表中的任意写法
   - 输出日志：`🔄 语义映射: "H5 移动端" → "h5"`
3. 精确匹配标准端名（不变）

**效果验证**：
```bash
# 需求文档中包含 "H5 移动端"
$ speccore analyze --auto -I 011-meeting-upgrade
[INFO] 🔄 语义映射: "H5 移动端" → "h5"
[INFO] 🔍 已按端分割需求内容: 1 个端有专属内容

# 生成端子目录
$ ls Iteration-011-meeting-upgrade/020-specs/
analysis.md  h5/  admin/  app/  miniapp/
```

#### 2.5.2 任务目录架构演进（v6.40.0 → v6.49.1）

**架构演进**：

| 版本 | 目录结构 | 特点 |
|:--|:--|:--|
| v6.24.0-v6.39.0 | `Task-001/10-backend/{服务名}/{子任务}/` | 3 层，前后端大类分层 |
| v6.40.0-v6.49.0 | `Task-001/{服务名}/{子任务}/` | 2 层，但仍有前后端分类变量 |
| **v6.49.1+** | `Task-001/{platform}/{taskId}-{subtaskSlug}/` | **端平铺 + 确定性命名** ✅ |

**旧架构（10-backend/ 和 20-frontend/ 分层）**：
```
Task-001-feature-login/
├── .meta/
├── _shared/
├── 00-specs/
├── 10-backend/              ← 类型前缀（冗余）
│   └── api/
│       └── impl/
├── 20-frontend/             ← 类型前缀（冗余）
│   └── h5/
│       └── impl/
└── 99-artifacts/
```

**新架构（v6.49.1+ 端平铺）**：
```
Task-001-feature-login/
├── .meta/                   ← 任务级元信息（含 feature）
├── _shared/
├── 00-specs/
├── booking-service/         ← 所有端平铺 ✅
│   └── Task-001-booking-order/  ← {taskId}-{subtaskSlug}
│       ├── .meta/           ← 子任务元信息（含 feature）
│       ├── TASK.md
│       ├── TEST.md / REVIEW.md / ...
│       └── （代码写入 CONSTITUTION 指定路径）
├── h5-mobile/               ← 所有端平铺 ✅
│   └── Task-001-login-page/
│       ├── .meta/
│       ├── TASK.md
│       ├── COMPONENT_TREE.md / ROUTES.md / ...
│       └── ...
└── .issues.md
```

**v6.49.x 关键改进**：
1. **端平铺**：删除 `backendPlatforms`/`frontendPlatforms` 分类变量，所有端统一循环
2. **功能单元标识**：任务级和子任务级都有 `.meta/feature`
3. **确定性命名**：`{taskId}-{subtaskSlug}` 确保全项目唯一
4. **子任务 ID 确定性**：`Task-{taskId}-{platform}` 格式，不使用随机 hash
5. **工程路径感知**：execute 命令写入 CONSTITUTION.md 指定的实际工程路径

**v8.3.9+ 子任务扫描与分支名改进**：
1. **子任务目录扫描修复**：`scanTasks` 和 `findTaskDir` 支持 `Task-001/{platform}/{subtaskId}/` 新结构（split.ts 生成的平铺架构），子任务不再被遗漏
2. **分支名与 taskId 对齐**：默认 `branchFormat` 从 `'{type}/{prefix}{name}-{hash4}'` 改为 `'{type}/{prefix}{taskId}'`，分支名直接对应子任务全局唯一 ID，无需随机 hash
3. **单任务执行名字修复**：`executeSingleTask` 从 `.meta/name` 或 `TASK.md` 读取真实任务名，不再用 Task ID 当分支名
4. **工时数据链路打通**：`TaskState.estimatedHours` + `.meta/estimated-hours` + `buildTaskPlan` 联动，计划和状态面板显示真实工时
5. **git-config 自动填充**：split 时自动写入迭代级/全局级实际配置值，不再生成全注释空模板
6. **依赖分支合并修复**：`prepareTaskBranch` 优先从 `task.dependencies` 读取依赖，依赖分支查找扩展为三层回退（当前会话 → git-mapping → git branch）

**v8.3.77+ 任务命名策略改进（中文任务名支持）**：

问题：原 `slugify()` 实现先 `.replace(/[\u4e00-\u9fff]/g, '')` 去掉所有中文，纯中文任务名变成空字符串后 fallback 到 hash，导致目录名无意义（如 `Task-001-a3f2b1`）。

修复方案：
1. **slugify() 英文优先提取**：不再直接去掉中文，而是优先提取连续的英文/数字片段（`/[a-zA-Z0-9]+/g`），如 `"User管理"` → `"user"`，`"API网关"` → `"api"`
2. **extractTopic() 四层 fallback**：① AI 提供的合法 topic（`^[a-z0-9-]+$`）② `functionalUnit` 中的英文 ③ `name` 中的英文 ④ hash fallback（确保不重复）
3. **toSlug() 同步修复**：迭代目录命名采用同样策略，`"我的项目"` → `"iter-3f2a"`（hash），`"My项目"` → `"my"`
4. **task new name 参与 slug**：修复 `nextTaskId(options.topic)` 只传 topic 的 bug，改为 `nextTaskId(options.name, options.topic)`，让 `--name` 作为 `--topic` 的 fallback

**v8.3.79+ ask 引擎路径识别**：

`ask-engine.ts` 中 `deepDocMatch` 正则从 `[A-Z_\-]+\.md` 扩展为 `[a-zA-Z0-9_\-/]+\.md`，支持用户自然语言描述中带路径的文档名：
- `"全局深度分析 overview/ARCHITECTURE.md"` → `--deep overview/ARCHITECTURE.md`
- `"详细分析 020-specs/overview/TECH.md"` → `--deep 020-specs/overview/TECH.md`

**实现位置**：
- `/ts-cli/src/commands/iteration/split.ts`:
  - `createTaskFromSection()`：创建任务级 `.meta/`
  - `createSubtask()`：创建子任务级 `.meta/` + 文档 + git-config
  - 所有端统一循环，不再区分前后端
- `/ts-cli/src/core/spec-paths.ts`:
  - `parseProjectInfo()`：解析 CONSTITUTION.md 项目信息表
  - `getProjectPathForPlatform()`：获取实际工程路径
- `/ts-cli/src/core/state.ts`:
  - `scanTasks()`：扫描任务和子任务，支持 `{platform}/{subtaskId}/` 新结构
- `/ts-cli/src/core/task-paths.ts`:
  - `findTaskDir()`：递归查找子任务目录
- `/ts-cli/src/core/git-integration.ts`:
  - `createTaskBranch()`：按配置格式生成分支名，默认 `{type}/{prefix}{taskId}`
  - `loadGitConfig()`：三级回退（子任务 → 迭代 → 全局 → 默认）
  - `findBranchByTaskId()`：三层查找已创建分支
- `/ts-cli/src/commands/execute.ts`:
  - `prepareTaskBranch()`：懒创建 + 依赖合并
  - `executeSingleTask()`：单任务执行，读取真实任务名

### 2.6 端发现机制重构与 --auto 模式 AI 化（v6.40.2）

#### 2.6.1 问题背景

v6.40.0 之前的 `detectPlatformsFromConstitution()` 存在三个核心问题：

1. **硬编码默认值**：Layer 3 回退到 `['app', 'h5', 'miniapp', 'admin']`，不同项目的端完全不同
2. **无 AI 参与**：全靠正则匹配，准确率有限
3. **--auto 模式跳过 AI**：直接调用代码分析生成空模板

#### 2.6.2 新的三层端发现架构

| 层级 | 执行者 | 数据来源 | 说明 |
|:--|:--|:--|:--|
| Layer 1 | CLI | CONSTITUTION.md 表格「对应需求端」列 | 用户显式声明，跳过「待填写」占位符 |
| Layer 2 | CLI | CONSTITUTION.md 技术栈标题 `### 中文端名 (English Name)` | 自动提取端名，构建动态别名 |
| Layer 3 | **AI** | CONSTITUTION.md + 需求文档内容 | AI 语义判断，结果写入 `020-specs/PLATFORMS.md` |

**关键设计决策**：
- Layer 1+2 无法检测时返回**空数组**（不再硬编码默认值）
- AI 在 prompt 指导下自主发现端列表（第 5 步端发现指令）
- AI 将发现的端列表写入 `020-specs/PLATFORMS.md`，后续流程（split 等）可读取

#### 2.6.3 技术栈标题解析（Layer 2）

新增两个函数从 CONSTITUTION.md 技术栈章节提取端名：

```typescript
// 解析: ### 后台管理端 (Admin Dashboard) → { chinese: '后台管理端', english: 'Admin Dashboard' }
function parseTechStackHeaders(content: string): Array<{ chinese; english; fullTitle }>

// 将解析结果合并到动态别名映射，供 inferPlatformFromPathOrContent 使用
function buildDynamicAliasesFromTechStack(entries): Record<string, string[]>
```

#### 2.6.4 两阶段最长匹配策略

`normalizeToStandardPlatform()` 采用两阶段匹配，避免短别名误匹配：

| 阶段 | 策略 | 示例 |
|:--|:--|:--|
| Phase 1 | 精确匹配（`name === alias`），最长优先 | `"后台管理端"` → admin |
| Phase 2 | 包含匹配（`name.includes(alias)`），最长优先 | `"后台服务端"` → backend（不是 admin） |

**修复的误匹配问题**：
- `"后台服务端"` → ~~admin~~ → backend（"后台"短别名不再先匹配）
- `"移动端"` → ~~app~~ → h5（"移动端app"长别名不再误包含）

#### 2.6.5 --auto 模式重构

**修改前**：
```
--auto → 代码分析 → 生成空模板 → 返回（无 AI）
```

**修改后**：
```
--auto → 收集文档 → 设置 options.prompt = true → fall through 到 prompt 生成
       → 宿主 AI 分析 → --apply 写回
```

**核心改变**：`--auto` 只是「不交互」，不是「跳过 AI」。

#### 2.6.6 --platform 端过滤支持

迭代级分析现在支持 `--platform` 过滤：

```bash
# 只分析 admin 端
speccore analyze -I 011-meeting-upgrade --auto --platform admin
```

Prompt 会指示 AI：
- 只生成指定端的专属文档
- 写入 `020-specs/{端名}/` 目录
- 不生成其他端的子目录

#### 2.6.7 AI 端发现指令（Prompt 第 5 步）

```
5. **端发现（重要）**：先确定项目有哪些端，再按端组织文档
   - 第 1 步：Read .speccore/CONSTITUTION.md
   - 第 2 步：从表格「对应需求端」列提取端列表
   - 第 3 步：如果表格列为空或「待填写」，从技术栈章节标题提取
   - 第 4 步：如果以上都无法确定，根据需求文档内容判断
   - 第 5 步：将发现的端列表写入 020-specs/PLATFORMS.md
```

**实现位置**：
- `src/cli.ts`: `--platform` 选项注册
- `src/commands/analyze.ts`: `--auto` 重构 + `buildMultiDocPrompt()` 端过滤 + 端发现指令
- `src/core/analyze-engine.ts`: `detectPlatformsFromConstitution()` 重构 + `normalizeToStandardPlatform()` 两阶段匹配 + `inferPlatformFromPathOrContent()` 动态别名合并

### 2.7 020-specs/ 全局文档目录重构（v6.41.0）

#### 背景

v6.40.2 及之前版本，`020-specs/` 根目录混合存放全局文档和端专属目录，结构不清晰：

```
020-specs/           ← 全局文档和端目录混在一起
├── REQUIREMENT.md   ← 全局
├── ANALYSIS.md      ← 全局
├── admin/           ← 端专属
└── h5/
```

#### 新结构

全局文档独立到 `global/` 子目录，端专属文档保持不变：

```
020-specs/
├── PLATFORMS.md              ← 端发现元数据（留在根目录）
├── global/                   ← 迭代级全局文档（新）
│   ├── REQUIREMENT.md
│   ├── ANALYSIS.md
│   ├── RISK.md
│   ├── DEPS.md
│   ├── REVIEW.md
│   └── MONITOR.md
├── admin/                    ← 端专属文档
│   ├── ANALYSIS.md
│   ├── TECH.md
│   ├── TEST.md
│   └── UI_SPEC.md
└── h5/
    └── ...
```

**关键决策**：
- TECH.md 采用双层设计：`global/TECH.md` 写整体技术架构（跨端交互、中间件选型），`{端}/TECH.md` 写该端专属技术方案
- PLATFORMS.md 留在根目录（它是元数据，不是分析文档）
- TEST.md、UI_SPEC.md 是端专属文档，放在各端目录中

#### 路径辅助模块

新增 `src/core/spec-paths.ts`，提供统一的路径解析：

| 函数 | 用途 |
|:---|:---|
| `resolveGlobalSpecPath(specDir, filename)` | 读取侧：优先 `global/`，回退根目录 |
| `globalSpecWritePath(specDir, filename)` | 写入侧：始终使用 `global/`，自动 ensureDir |
| `GLOBAL_SPEC_FILES` | 全局文档文件名列表 |

#### 向后兼容策略

所有读取路径统一采用三级回退：
1. 优先读 `020-specs/overview/{filename}`（新路径，v6.78.0+）
2. 回退读 `020-specs/global/{filename}`（v6.41.0-v6.77.0 路径）
3. 回退读 `020-specs/{filename}`（旧路径）
4. 不存在则返回 null

已有迭代（旧结构）不受影响，新迭代使用新结构。

#### 影响范围

- **写入侧**（3 个文件）：analyze-engine.ts、analyze.ts、create.ts
- **读取侧**（10 个文件）：split.ts、prompt-builder.ts、dev.ts、status-panel.ts、cli.ts、iteration-from-global.ts、ai-context-generator.ts、next-steps.ts、quality-audit.ts
- **Prompt 侧**：buildMultiDocPrompt() 更新 AI 写入指令

### 2.8 020-specs/ 功能模块级目录重构（v8.3.17+）

#### 背景

v6.41.0-v8.3.16 期间，`020-specs/` 采用「端平铺」结构：全局文档放在 `overview/`，各端专属文档直接放在 `020-specs/{端}/`。这种结构在需求复杂、功能模块多的项目中存在两个问题：

1. **难以按功能查阅**：当项目有 10+ 个功能模块时，所有端的文档混在一起，无法快速定位「订单模块」相关的所有规格
2. **变更影响域不清晰**：需求变更时，需要遍历所有端目录才能确定受影响范围

#### 新结构

`020-specs/` 按需求文档名（即功能模块名）组织，每个功能模块目录下包含 `overview/` 综合文档和各端专属子目录：

```
020-specs/
├── overview/                        ← 迭代级全局文档
│   ├── REQUIREMENT.md
│   ├── ANALYSIS.md
│   ├── FUNCTION_MAP.md
│   ├── RISK.md
│   ├── DEPS.md
│   └── MONITOR.md
├── 用户认证/                        ← 功能模块 1
│   ├── overview/                    ← 功能模块综合文档
│   │   ├── REQUIREMENT.md
│   │   ├── ANALYSIS.md
│   │   └── TECH.md
│   ├── api/                         ← 后端服务端
│   │   ├── TECH.md
│   │   └── TEST.md
│   └── h5/                          ← 前端端
│       ├── TECH.md
│       ├── TEST.md
│       └── UI_SPEC.md
├── 订单管理/                        ← 功能模块 2
│   ├── overview/
│   └── ...
└── PLATFORMS.md                     ← 端发现元数据
```

**关键决策**：
- **功能模块 = 需求文档名**：从 `010-requirements/features/` 或 `010-requirements/` 根目录扫描 `.md` 文件提取功能模块列表
- **三层架构**：`overview/`（全局）→ `{feature}/overview/`（模块综合）→ `{feature}/{platform}/`（端专属）
- **骨架生成按功能模块**：`computeFeatureBasedAnalyzeManifest()` 为每个功能模块 + 每个端生成 TECH.md/TEST.md/UI_SPEC.md 骨架
- **sanitizeSpecDirectories() 允许功能模块目录存在**：清理逻辑只归档纯数字或特殊符号目录

#### 移除向后兼容（v8.3.21+）

由于项目暂无外部用户，v8.3.21 彻底移除了所有旧结构兼容逻辑：
- 不再检测 `020-specs/` 是否为旧结构（移除 `isLegacySpecDir()` 调用）
- 所有命令统一按功能模块级结构处理
- `resolveGlobalSpecPath()` 中的根目录回退已移除，统一从 `overview/` 读取

**适配的文件**：
- `analyze.ts`：骨架创建、apply 模式路由、sanitize 逻辑
- `split.ts`：detectPlatforms、上下文加载、loadSpecContents、preSplitGate
- `prompt-builder.ts`：loadExtraSpecs、execute 分支扫描
- `execute.ts`：UI_SPEC 检查、任务过滤、子任务扫描
- `plan.ts`：RISK.md/DEPS.md 路径
- `dev.ts`、`status-panel.ts`、`quality-audit.ts`：全局文档路径

---

## 3. 迭代目录结构

```
Iteration-NNN-name/
├── 000-overview/                  ← 进度总览
├── 010-requirements/              ← 按功能组织（非按端）
│   ├── sources/                  ← 原始 PRD（待分类文档也放这里）
│   ├── staging/                  ← [临时] doc2spec --classify 分类产物（分析后可清理）
│   ├── features/{feature}/README.md  ← 功能需求（每个功能一份，描述所有端）
│   ├── bugs/{bug}.md             ← 扁平缺陷文档（1 文件 = 1 bugfix 任务）
│   ├── refactors/{refactor}.md   ← 扁平重构文档（1 文件 = 1 refactor 任务）
│   ├── research/{topic}.md       ← 扁平调研文档（1 文件 = 1 research 任务）
│   └── assets/{prd,prototypes,designs}/
├── 020-specs/                     ← 迭代级 analyze 输出（全局基线，三层架构 v8.3.17+）
│   ├── overview/                  ← 迭代级全局文档
│   │   ├── REQUIREMENT.md         ← 需求规格汇总（含「涉及端」列）
│   │   ├── ANALYSIS.md            ← 全量需求分析
│   │   ├── DEPS.md                ← 依赖清单
│   │   ├── FUNCTION_MAP.md        ← 功能地图
│   │   ├── INTERACTION_MAP.md     ← 交互地图
│   │   ├── API_CONTRACT.yaml      ← API 契约
│   │   ├── TECH.md                ← 技术方案（跨端通用）
│   │   ├── TEST.md                ← 测试计划
│   │   ├── REVIEW.md              ← 评审清单
│   │   ├── RISK.md                ← 风险评估
│   │   └── MONITOR.md             ← 监控方案
│   ├── {feature}/                 ← 功能模块目录（如 用户认证/订单管理）
│   │   ├── overview/              ← 功能模块综合文档
│   │   │   ├── REQUIREMENT.md
│   │   │   ├── ANALYSIS.md
│   │   │   └── TECH.md
│   │   └── {端名}/                ← 各端专属文档（如 api/h5/admin）
│   │       ├── TECH.md            ← 该端在该模块下的技术方案
│   │       ├── TEST.md            ← 该端测试计划
│   │       └── UI_SPEC.md         ← 该端 UI 规格（仅前端）
│   └── PLATFORMS.md               ← 端列表元数据
├── 030-tasks/                     ← 所有开发任务（按类型分层）
│   ├── feature/                   ← 功能类任务
│   │   └── Task-NNN-slug/
│   ├── bugfix/                    ← 缺陷修复任务
│   ├── refactor/                  ← 重构类任务
│   └── research/                  ← 调研类任务
│       └── Task-NNN-slug/
│           ├── .meta/                 ← 任务元信息（type/status/owner）
│           ├── _shared/               ← 跨平台共享契约
│           │   ├── API_CONTRACT.yaml
│           │   └── CONTEXT.md         ← 来源追溯 + 关联任务 + 影响范围
│           ├── 00-specs/              ← 任务级核心规格（执行前必读）
│           │   ├── REQ.md             ← 需求切片 + 验收标准
│           │   ├── TECH.md            ← 技术方案
│           │   ├── TASK.md            ← 任务履历 + 产出物清单
│           │   ├── SCHEMA.md          ← 数据库 Schema（可选）
│           │   └── CHANGELOG.md       ← 需求变更记录
│           ├── {platform}/            ← 所有端平铺（v6.49.1+）
│           │   └── {taskId}-{subtask}/ ← 子任务（含 .meta/ + 文档）
│           ├── 99-artifacts/          ← 执行产出（TEST/REVIEW/RISK/DEPS/...）
│           └── .issues.md             ← 问题追踪
└── STAFFING.md
```

### 目录编号

| 编号 | 含义 |
|:--:|------|
| 000 | 总览信息 |
| 010 | 输入层（需求） |
| 020 | 分析层（规约） |
| 030 | 任务层（开发） |
| 050 | 导出层（dashboard/spec2doc/retro 产出）预留 |
| 060 | 日志层（plan/execute 记录）预留 |

### 核心原则

**需求按功能组织，分析双层架构（全局+各端），任务按端+功能创建。**

```
文档:  010-requirements/user-auth/README.md
分析:  020-specs/REQUIREMENT.md（全局） + 020-specs/admin/TECH.md（管理端专属） + 020-specs/h5/TECH.md（H5 端专属）
任务:  030-tasks/feature/Task-001-user-auth/
       ├── 00-specs/TECH.md ← 从对应端的 TECH.md 提取
       ├── backend/          ← 后端子任务（平铺）
       ├── admin/            ← 管理端子任务（平铺）
       └── h5/               ← H5 端子任务（平铺）
```

端名称来自 CONSTITUTION.md「对应需求端」列（如 app/h5/miniapp/admin），split 时自动读取并创建对应前端子目录。

### 双层规格解耦

`020-specs/` 是**迭代级全局基线**（双层架构：全局文档 + 各端专属），`Task/00-specs/` 是**任务级切片**。

```
020-specs/（全局视角，双层架构）
    │
    ├── REQUIREMENT.md（全局需求规格，含「涉及端」列）
    ├── TECH.md（跨端通用技术方案）
    ├── admin/TECH.md（管理端专属技术方案）
    ├── h5/TECH.md（H5 端专属技术方案）
    └── backend/TECH.md（后端专属技术方案）
    │
    │  split 读取 REQUIREMENT.md 按章节拆分
    │  从对应端的 TECH.md 提取该端内容
    ▼
030-tasks/Task-001/00-specs/（切片视角）
├── REQ.md    ← 从需求文档切出的片段 + 自动生成的验收标准
├── TECH.md   ← 从 020-specs/{端}/TECH.md 提取该端内容
└── ...
```

**解耦规则：**

| 操作 | 写入位置 | 说明 |
|:---|:---|:---|
| 迭代级 `analyze`（无 `--task`） | `020-specs/` | 迭代全量分析，建立基线 |
| 任务级 `analyze --task Task-001` | `Task-001/00-specs/` | 任务独立分析，**不覆盖迭代基线** |
| `split` | `Task-NNN/00-specs/` | 从迭代需求切片，创建任务骨架 |

- 两层完全独立，互不覆盖
- 任务重新分析时，从原始需求（`010-requirements/`）重新读取，不回读 `020-specs/` 已有内容
- 任务级原型/图片/设计稿统一放在迭代级 `010-requirements/assets/`，任务通过相对路径引用

### 智能文档分类摄入（doc2spec --classify）

支持将任意文档（安全报告、性能分析、用户反馈等）通过 AI 智能理解后分类导入。

#### 流程

```
sources/（原始文档）
    ↓  doc2spec --classify --prompt
AI 理解意图（nature）+ 映射类型（type）
    ↓  doc2spec --classify --response
staging/（带 frontmatter 的分类产物）
    ↓  analyze
020-specs/{features,bugs,refactors,research}/（按类型写入）
    ↓  split
030-tasks/{type}/Task-NNN-slug/（按规则拆分）
```

#### AI 意图理解

AI 先判断文档**实际上在说什么**（nature），再映射到任务类型（type）：

| nature（文档实际意图） | type（映射任务类型） | 示例 |
|:---|:---|:---|
| 新功能、功能需求、产品规格 | feature | "用户需要扫码登录" |
| 缺陷、故障、异常、安全问题 | bugfix | "登录超时页面卡死"、"SQL注入漏洞" |
| 技术债、架构改进、性能优化 | refactor | "数据库连接池过小"、"首页加载超 3 秒" |
| 调研、选型、方案对比 | research | "WebSocket vs SSE 对比" |

#### staging/ 文件格式

```yaml
---
type: bugfix
nature: 安全漏洞
title: XSS 反射型漏洞修复
source: sources/
created: 2026-08-14
---
```

- `type`: 映射后的任务类型（feature/bugfix/refactor/research）
- `nature`: AI 理解的文档实际意图（如"安全漏洞"、"性能瓶颈"）
- staging/ 是临时目录，analyze 完成后可清理

#### 拆分规则

| 文档类型 | 拆分规则 | 说明 |
|:---|:---|:---|
| features/ | 按功能单元拆合（1~3 个任务） | 功能可拆分、可合并 |
| bugs/ | 1:1 映射（1 文件 = 1 bugfix 任务） | 每个 bug 独立修复 |
| refactors/ | 1:1 映射 | 每个重构项独立执行 |
| research/ | 1:1 映射 | 每个调研主题独立进行 |

### 任务上下文（CONTEXT.md）

每个任务目录的 `_shared/CONTEXT.md` 提供来源追溯和关联信息：

```markdown
## 来源追溯
| 层级 | 路径 |
|:---|:---|
| 需求文档 | 010-requirements/bugs/login-timeout.md |
| 规格文档 | 020-specs/bugs/login-timeout.md |

## 原始描述摘要
（需求文档前 500 字）

## 关联任务
- Task-002-xxx（同一迭代的其他任务）

## 影响范围
（AI 分析的影响描述）
```

- 来源路径支持 `sourceFile` 字段（AI 提供）和回退规则（type + topic）
- execute 时自动加载 CONTEXT.md，AI 可追溯需求源头
- RAG 索引和 prompt-builder 均将 CONTEXT.md 作为候选文件

### 拆分粒度规则

split 的核心原则：**1 人 × N 天 = 1 个可独立验收的交付单元**。

> ⚠️ **工时约束按单人计算**：每个任务包含多个端（backend + admin + app 等），粒度校验用 `max(各端工时)`，即单个开发人员的实际工作量，不是所有端的总和。

#### 三档粒度

| 粒度 | 每人工时 | 接口上限 | 数据表上限 | 页面上限 | 适用团队 |
|:--|:--|:--|:--|:--|:--|
| macro（粗） | 20-80h (1-2周) | 15 | 5 | 5 | 1-3 人 |
| module（中，默认） | 12-40h (3-5天) | 8 | 3 | 3 | 3-8 人 |
| atomic（细） | 4-24h (1-3天) | 3 | 2 | 1 | 8+ 人 |

粒度由 STAFFING.md 团队规模自动推荐，用户可通过 `--granularity macro|module|atomic` 手动覆盖。

#### 按端工时估算

AI 拆分时按端分别估算工时（`hoursByPlatform`），示例：

```
任务: 用户认证
工时分布: backend:16h + admin:12h + app:12h = 40h（max per person: 16h）
粒度校验: 16h < 20h (macro 下限) → 警告「建议合并」
```

**原则**：同一功能的前后端各端工作必须在一个原子任务里，不按端拆分任务。每个端对应一个开发人员，工时约束衡量的是「一个人干多少」。

#### 原子任务判定标准（全部满足）

- 有独立的输入/输出（API 接口 / 页面 / 数据表）
- 00-specs/ 三件套能独立写满（REQ.md + TECH.md + TASK.md）
- execute 时不强依赖其他 Task 的运行时状态
- 有明确的验收标准（AC 可枚举）
- 可独立提 PR、独立 review

#### 合并规则（不拆）

- 同一数据实体的 CRUD → 共享数据模型，合并为 1 个任务
- 页面 + 对应后端接口 < 5 个 → 前后端强耦合，一人做效率最高
- 纯配置/文案/样式微调 → 不构成独立工作单元
- 关联紧密的小功能（如列表页 + 详情页）→ 共享路由和状态
- **同一功能的前后端各端** → 必须在一个原子任务里，不按端拆
- **复杂度判断**：接口 ≤ 3、数据表 ≤ 1、单人工时 < 粒度下限 → 必须合并到关联任务
- **宁少勿多**：任务数越少越好，共享数据模型/路由的不拆

#### 拆分规则（必拆）

- 超出当前粒度单人工时上限 → 必须再拆
- 超出当前粒度接口/数据表上限 → 按业务领域或数据层拆
- 低于当前粒度单人工时下限 → 合并到关联任务
- 独立第三方集成（支付/短信/OSS）→ 独立任务

#### 总量约束（功能单元基准）

- **核心原则：以需求的功能单元为基准拆分**，而非需求文档的章节划分
- **功能单元** = 一个独立的功能模块，由 AI 根据语义判断（如“用户管理”、“订单系统”）
- **每个功能单元默认 1 个任务，最多 3 个**
- 章节划分可能很粗（“系统管理”包含多个功能）或很细（“用户管理-创建”单独一章），不应机械依赖
- 每个任务必须有明确的 owner（对应 STAFFING 中的成员）
- 依赖链深度 ≤ 3，同层级无循环依赖

**示例：**
- ✅ “用户管理”章节包含用户 CRUD + 权限管理 → 拆成 2 个功能单元（用户管理 + 权限管理）
- ✅ “用户管理-创建”和“用户管理-删除”各一个章节 → 合并为 1 个功能单元（都是用户管理功能）
- ❌ 把“用户管理的增删改查”拆成 4 个任务 → 过度拆分
- ❌ 把“系统管理”章节的所有功能合并成 1 个任务 → 拆分不足

#### 交互流程

split 默认采用逐任务交互确认：

```
AI 输出 JSON 拆分方案 → CLI 逐任务展示摘要 → 用户确认(y/回车) 或 n 退出调整 → 创建目录
```

每个任务创建前展示：名称、类型、**各端工时分布**、优先级、接口数、依赖、验收标准。粒度不达标时自动警告。

用户可选操作：
- `y`/回车 — 确认创建，自动下一个
- `n` — 退出并提示调整方式，用户回到 AI 对话用自然语言调整，AI 重新生成方案后再次执行

**调整方案的正确方式：** 回到宿主 AI 对话，用自然语言告诉 AI 如何调整（如“拆太细了，合并为一个”），AI 在同一套拆分规则下重新生成 JSON，CLI 再次展示确认，循环直到满意。

#### AI 输出字段说明

| 字段 | 说明 |
|:--|:--|
| `name` | 任务名称（中文） |
| `topic` | 英文短横线 slug，用于目录命名（如 `user-auth`） |
| `type` | feature/bugfix/refactor/research，决定类型子目录 |
| `scope` | 涉及的端（如 `["后端", "admin"]`） |
| `hoursByPlatform` | 按端分别估算工时（如 `{ "后端": 8, "admin": 8 }`） |
| `estimatedHours` | 各端工时总和（仅展示，不参与粒度校验） |

---

## 4. 核心命令流水线

```
init → doc2spec → analyze → split → plan → execute → pr → done → spec2doc
```

### 各阶段职责

| 阶段 | 输入 | 输出 |
|------|------|------|
| init | - | `.speccore/` + `Iteration-sample/` + AGENTS.md |
| doc2spec | Word/MD PRD | `010-requirements/{feature}/README.md`；`--classify` 模式：sources/ → staging/ → 020-specs/{type}/ |
| analyze | 010-requirements/ 所有 .md → CONSTITUTION 映射 | `020-specs/` 三层架构（overview/ 全局 + `{feature}/overview/` 模块综合 + `{feature}/{端}/` 端专属） |
| split | 020-specs/ + CONSTITUTION.md 端配置 | `030-tasks/{type}/Task-NNN-slug/`，按端智能推断涉及的端并拆分子任务 |
| plan | 任务列表 + STAFFING | `PLAN.md` + `speccore-plan.html` + `plan.json` |
| execute | REQ.md + TECH.md → AI 生成代码 | 源码 + .issues.md + 多任务时自动生成 `PLAN.md` |
| pr | git branch | Git PR |
| done | Task 完成归档 | GLOBAL/INDEX 更新 |
| spec2doc | 020-specs/ | Word/PDF/HTML |

### 多端全量分析与合成（全自动三阶段）

> 当 CONSTITUTION.md 配置了多个工程/多端时，`synthesize --full` 自动执行三阶段流程。
> 整个过程全部自动完成，无需人工干预。

```
Phase 1: 逐端分析（per-platform analysis）
  ├── 后端工程 → analyze → .speccore/GLOBAL/backend/ANALYSIS.md + TECH.md
  ├── Web 前端 → analyze → .speccore/GLOBAL/web/ANALYSIS.md + TECH.md
  ├── Admin 端  → analyze → .speccore/GLOBAL/admin/ANALYSIS.md + TECH.md
  └── App 端    → analyze → .speccore/GLOBAL/app/ANALYSIS.md + TECH.md

Phase 2: 跨端综合（cross-platform synthesis）
  ├── 汇总各端 specs
  ├── 识别跨端业务关系（如 Web 用户列表 → 后端用户查询 API）
  └── 输出:
      ├── .speccore/GLOBAL/synthesis/CROSS_PLATFORM.md    ← 跨端关系图 + 接口映射
      ├── .speccore/GLOBAL/synthesis/ARCHITECTURE.md      ← 全量架构文档
      └── .speccore/GLOBAL/synthesis/TECH_FULL.md         ← 全量技术方案

Phase 3: 按功能单元合成需求文档（functional-unit synthesis）
  ├── 从 GLOBAL 层 + 迭代层的结果中提取功能单元
  ├── 每个功能单元聚合所有端的需求（后端 API + 前端页面 + 管理端操作）
  └── 输出:
      └── Iteration-NNN/010-requirements/REQUIREMENT.md ← 按功能单元组织的完整需求文档
```

**核心原则：**
- 功能单元是分组概念，不是内容容器。内容在任务级别
- 一个功能单元的需求文档包含该功能关联的所有端的需求
- 结构清晰：每个功能单元独立章节，内含各端子节
- 公共逻辑只写一次，端差异用子标题标注

**目录结构示例：**
```markdown
# REQUIREMENT.md（按功能单元组织）

## 1. 用户管理
> 公共逻辑：用户 CRUD、权限校验
### 1.1 后端
- API: POST /api/users, GET /api/users/:id
- 数据模型: users, roles 表
### 1.2 Web 前端
- 页面: 用户列表、用户详情
- 组件: UserTable, UserForm
### 1.3 Admin 端
- 页面: 用户审核、角色分配

## 2. 订单系统
> 公共逻辑：订单生命周期管理
### 2.1 后端
### 2.2 Web 前端
### 2.3 App 端
```

**命令入口：**
```bash
# 全自动三阶段（推荐）
speccore synthesize --full -I <迭代名>

# 单阶段手动执行
speccore synthesize --phase 1 -I <迭代名>   # 只跑逐端分析
speccore synthesize --phase 2 -I <迭代名>   # 只跑跨端综合
speccore synthesize --phase 3 -I <迭代名>   # 只跑需求合成

# 原有模式（向后兼容）
speccore synthesize -I <迭代名>             # 只做需求合成（无全量分析）
```

**自动化流水线：**
```
用户: speccore synthesize --full -I Q2
  → CLI Phase 1: 读取 CONSTITUTION 工程列表
    → 逐端输出 [SPECCORE_PROMPT] → AI 分析各端
    → CLI 收集各端结果 → .speccore/GLOBAL/{端名}/
  → CLI Phase 2: 汇总各端 specs
    → 输出 [SPECCORE_PROMPT] → AI 跨端综合
    → CLI 写入 .speccore/GLOBAL/synthesis/（旧版归档到 snapshots/）
  → CLI Phase 3: 按功能单元合成
    → 输出 [SPECCORE_PROMPT] → AI 按功能单元组织需求
    → CLI 写入 REQUIREMENT.md（--apply 回写）
  → 完成 ✅
```

### 环境驱动部署流水线（v8.3.60+）

> **设计理念**：环境（env）是部署的第一公民，分支从环境配置中读取，而非手动指定。

#### 五层环境模型

| 环境 | 分支示例 | 用途 | pipeline 行为 |
|:---|:---|:---|:---|
| `local` | — | 本地开发调试 | 不执行 merge，直接 build+deploy |
| `dev` | `develop` | 开发联调 | merge 当前分支 → develop |
| `test` | `release/test` | 测试 / QA / SIT | merge 当前分支 → release/test |
| `staging` | `staging` | 预发布 / 准生产 | merge 当前分支 → staging |
| `production` | `main` | 线上生产 | merge 当前分支 → main |

> 支持任意数量的自定义环境：复制 `.speccore/environments/staging.yaml` 修改 `env` 和 `branch` 即可。

#### 配置覆盖优先级

```
环境文件 (.speccore/environments/{env}.yaml)
  > PROJECT.yaml 中的 deploy/build 配置
  > 内置默认值
```

#### Pipeline 执行流程

```
speccore pipeline --env staging --all
  → 读取 .speccore/environments/staging.yaml
  → 获取 branch = "staging"
  → 获取当前 Git 分支（如 feature/login-optimization）
  → 对每个端：
      1. checkout staging
      2. pull origin staging
      3. git merge feature/login-optimization --no-edit
      4. build（叠加环境配置中的 build_cmd）
      5. deploy（叠加环境配置中的 deploy 参数）
  → 汇总报告（成功/失败 + 各步骤状态）
```

#### 核心设计决策

| 决策 | 说明 |
|:---|:---|
| **环境驱动** | `--env` 替代 `--from`/`--to`，降低认知负担 |
| **自动 merge** | 当前分支自动合并到环境分支，避免手动操作 |
| **单端/多端** | `--platforms h5,api` 或 `--all` 灵活选择 |
| **dry-run** | `--dry-run` 预览完整流程，不实际执行 |
| **失败不阻断** | 某端失败继续处理其他端，最后统一汇总 |
| **分支回退提示** | Pipeline 完成后提示用户当前在目标分支，可手动切回 |

#### 配置文件示例

```yaml
# .speccore/environments/staging.yaml
env: staging
branch: staging

defaults:
  build_cmd: npm run build:staging

platforms:
  h5:
    build_cmd: npm run build:h5:staging
    deploy:
      type: static
      output_dir: dist
      target: s3://mybucket-staging/h5/

tests:
  base_urls:
    h5: https://staging.example.com/h5
  visual_model:
    provider: qwen-vl
    timeout: 60000
```

### 错误处理

```
execute --all → 部分失败 → .issues.md + .needs-retry → --resume 续跑
```

### 回顾复盘 🔒 AI 命令

```bash
# 🔒 AI 命令（在 AI IDE 中使用 @spec-ask）
speccore retro --task Task-001        ← 单个
speccore retro --all                  ← 全部
speccore retro --all --owner 张三     ← 按人
speccore retro --all --type bugfix    ← 按类型
---

### 2026-08-18 analyze→split→execute 四层模式统一架构（v6.71.0 → v6.71.3）

#### 背景
随着 SpecCore 在多端项目中的深度使用，发现分析流程存在三个结构性问题：
1. **全局分析按端顺序扫描** → 后端改完前端改，AI 无法建立跨端关联认知
2. **迭代分析与全局层脱节** → 每个迭代"从零开始"分析，不利用全局层已有产物
3. **任务执行是孤岛** → 执行单个任务时不读相邻任务，导致接口不一致、状态枚举冲突

#### v6.71.0: 跨端交互图谱 + 自动模式

**跨端交互图谱（INTERACTION_MAP.md）**
- **位置**: `src/commands/analyze.ts` → 迭代分析 prompt
- **生成时机**: REQUIREMENT.md 和 FUNCTION_MAP.md 完成后
- **内容**: 按功能单元组织，每个功能单元一个 Mermaid sequenceDiagram
  - 用户操作 → 前端处理 → 后端调用 → 数据返回
  - 箭头标注接口路径，标注 `[contract]` 表示接口在 API_CONTRACT.yaml 中有定义
  - 附「接口契约索引」表格和「状态流转」表格
- **用途**: 补全产品文档中隐含的技术交互，是前后端开发者的共同参考

**自动模式（--auto）**
- **位置**: `src/commands/analyze.ts`
- **行为**: Phase 1 完成后不询问用户确认，AI 直接推断执行 Phase 2
- **Prompt 指令**: `请在生成全局文档后，直接继续生成各端专属文档（Phase 2）`

#### v6.71.1: 前后端分析视角分离

**问题**: 原来所有端的 TECH.md 都用同一套模板，后端写了用户旅程（不该写的），前端没写页面清单（该写的）。

**后端端（*service）— 纯技术视角**
- API 接口定义（路径/方法/参数/响应/状态码/错误码）
- 数据库表结构（字段/类型/索引/约束）
- 业务规则（含边界条件和异常流）
- 缓存/并发/消息队列/安全/性能
- **禁止**写用户旅程、业务场景（这些在 global/REQUIREMENT.md 中）

**前端端（h5 / admin-web / miniapp）— 产品+技术双视角**
- **产品视角（主要）**: 用户旅程、页面清单、交互设计、字段展示、权限控制
- **技术视角（辅助）**: 页面路由表、API 调用清单、状态管理、适配/性能/安全

**新增全局层前端文档**
- `FEATURES.md`: 产品视角功能清单（页面+交互+API调用链）
- `UI_FLOW.md`: 页面流转图、用户操作流程
- `API_CALL_MAP.md`: 页面 → 接口 → 后端服务 映射表

#### v6.71.2: 全局分析架构重构 — 双层扫描 → 四层扫描 + 功能模块驱动

**旧模式（问题）**
```
按端顺序分析:
  → 先分析 backend-service（读全部代码，写 API_INVENTORY.md）
  → 再分析 admin-web（读全部代码，写 FEATURES.md）
  → 最后全局汇总
问题: AI 分析 backend 时不知道 frontend 需要什么接口；分析 frontend 时 backend 已经"写死"了
```

**新模式（四层扫描）**
```
Layer 1: 快速扫描所有端（并行，只提取索引）
  ├── 后端: Controller/Entity/Service 目录列表 → _INDEX.md
  ├── 前端: router/pages/store 目录列表 → _INDEX.md
  └── 依赖: pom.xml/package.json → 公共服务候选

Layer 2: 跨端关联分析（基于 Layer 1 的索引）
  ├── 匹配前后端接口（前端 API 调用路径 vs 后端接口路径）
  │   ├── 匹配上 → 建立「页面 → API 调用 → 后端接口 → 服务」链路
  │   ├── 前端有、后端没有 → 「接口缺口」
  │   └── 后端有、前端没调 → 「未使用接口」
  ├── 识别公共服务（被 2+ 端调用的服务）
  └── 归纳功能模块（页面聚类 vs 接口聚类 → 交叉验证）
  └── 输出: _ASSOCIATION.md + _MODULES.md

Layer 3: 按功能模块深入分析（不是按端）
  ├── 基于 _MODULES.md，逐个功能模块深入
  ├── 「会议预订」功能模块:
  │   ├── 涉及端: h5-mobile, booking-service, room-service
  │   ├── 读取 h5-mobile: BookingForm.vue, BookingList.vue（详细逻辑）
  │   ├── 读取 booking-service: BookingController, BookingService（详细逻辑）
  │   └── 关联验证: 前端字段 vs 后端 DTO 字段是否一致

Layer 4: 全局汇总（所有功能模块分析完成后）
  ├── 一致性校验 → CONSISTENCY_CHECK.md
  ├── 生成全局文档: REQUIREMENT.md / FUNCTION_MAP.md / INTERACTION_MAP.md / API_CONTRACT.yaml / ARCHITECTURE.md
  └── 生成各端详细文档:
      ├── 后端: API_INVENTORY.md / DATA_MODEL.md / BUSINESS_RULES.md
      └── 前端: FEATURES.md / UI_FLOW.md / API_CALL_MAP.md
```

**关键变化**
- 分析单位从"端"变为"功能模块"
- AI 在 Layer 2 就建立了跨端关联认知，Layer 3 验证一致性
- 输出从"各端独立文档"变为"功能模块驱动 + 全局汇总"

#### v6.71.3: 四层模式统一映射 — 全局→迭代→任务

**核心洞察**: 全局分析的四层模式可以映射到迭代分析和任务执行，形成统一的心理模型。

| 层级 | 全局分析（--global --withCode） | 迭代分析（analyze -I xxx） | 任务执行（execute -t xxx） |
|:---|:---|:---|:---|
| **Layer 1** | 快速扫描所有端 → `_INDEX.md` | 读取全局层产物 → 建立全局视角 | 上下文扫描 → 任务概览 |
| **Layer 2** | 跨端关联分析 → `_ASSOCIATION.md` + `_MODULES.md` | 需求 vs 全局层关联 → 标注新增/扩展/重构/复用 | 相邻任务关联 → 契约验证 |
| **Layer 3** | 按功能模块深入 → 详细技术文档 | 按功能单元深入 → 迭代级文档 | 深入实现 → 代码生成 |
| **Layer 4** | 全局汇总 → `ARCHITECTURE.md` 等 | 迭代汇总 → `020-specs/` + `030-tasks/` | 验证汇总 → 测试 + 状态更新 |

**迭代分析增强（Layer 1 + Layer 2）**
- **Layer 1**: 读取全局层产物（REQUIREMENT.md / FUNCTION_MAP.md / API_CONTRACT.yaml / ARCHITECTURE.md / platforms/_INDEX.md）
- **Layer 2**: 迭代需求 vs 全局层关联分析
  - 功能模块清单新增「全局对比」列: 新增 / 扩展 / 重构 / 复用
  - 识别冲突: 迭代需求修改了全局层已有接口 → RISK.md 标注
  - 识别依赖: 新功能依赖全局层功能 → FUNCTION_MAP.md「依赖任务」标注

**任务执行增强（Layer 2）**
- **相邻任务关联**:
  - 读取前置任务: `_shared/CONTEXT.md` + `00-specs/REQ.md` + `_shared/API_CONTRACT.yaml`
  - 读取并行任务: `_shared/CONTEXT.md`
- **契约验证**:
  - 本任务接口定义 vs 前置任务输出是否一致？
  - 本任务数据模型 vs 并行任务数据模型是否一致？
  - 本任务状态枚举 vs 全局 API_CONTRACT.yaml 是否一致？

#### 完整数据流（v6.71.3）

```
全局层（analyze --global --withCode）
  ├── Layer 1: 扫描 → .speccore/GLOBAL/platforms/{端}/_INDEX.md
  ├── Layer 2: 关联 → .speccore/GLOBAL/platforms/_shared/_ASSOCIATION.md + _MODULES.md
  ├── Layer 3: 深入 → 功能模块级详细分析
  └── Layer 4: 汇总 → REQUIREMENT.md + FUNCTION_MAP.md + INTERACTION_MAP.md + API_CONTRACT.yaml

迭代层（analyze -I xxx）
  ├── Layer 1: 读全局层 → 了解系统已有功能
  ├── Layer 2: 关联 → 标注「新增/扩展/重构/复用」
  ├── Layer 3: 深入 → 020-specs/overview/ + 020-specs/{端}/
  └── Layer 4: 汇总 → 030-tasks/（split 按 FUNCTION_MAP.md 拆分）

任务层（execute -t xxx）
  ├── Layer 1: 读任务上下文 + 全局层
  ├── Layer 2: 读相邻任务 + 契约验证
  ├── Layer 3: 深入实现 → 代码生成
  └── Layer 4: 验证 → 测试 + 文档更新
```

#### 全局分析路径路由与文档规范（v8.3.51+）

**路径路由三层前缀支持**：

全局分析生成的文档通过 `analyze --scope global --apply` 写入 `.speccore/GLOBAL/` 时，支持三种路径前缀：

| 前缀 | 存放内容 | 示例 |
|:---|:---|:---|
| `platforms/{端}/` | 各端技术文档 | `platforms/admin-web/_INDEX.md` |
| `requirements/` | 产品需求文档 | `requirements/REQUIREMENT.md`、`requirements/h5-mobile/REQUIREMENT.md` |
| `overview/` | 全局技术文档 | `overview/ARCHITECTURE.md`、`overview/FUNCTION_MAP.md` |

**路由规则**：
- JSON 多文档写入和 `[DOC:xxx]` 标记解析两种输入格式，统一按前缀路由
- `overview/` 前缀的文件直接写入 `GLOBAL/overview/`，不再被错误路由到 `platforms/overview/`
- 无前缀的文件按白名单判断：全局技术文档入 `overview/`，需求文档入 `requirements/`

**多前端项目需求独立成文规范（v8.3.52+）**：

Layer 4 汇总 prompt 强制规则：
- 系统包含多个前端项目（如 h5-mobile + admin-web）时，**必须**为每个前端项目独立生成需求文档
- `requirements/REQUIREMENT.md` 总纲只保留全局业务视角（愿景/用户画像/场景地图/优先级矩阵）
- **严禁**将前端项目的页面布局、交互流程、业务规则合并到总纲中
- 前端需求独立存放：`requirements/h5-mobile/REQUIREMENT.md`、`requirements/admin-web/REQUIREMENT.md`

#### 全局分析质量保障体系重构（v8.3.62+）

**背景**：全局分析在实际运行中出现三个系统性质量问题：
1. **Layer 4 缺失**：Layer 3 完成后 AI 不知道要继续执行 Layer 4，导致只生成 modules/ 内容
2. **内容空洞**：AI 生成的文档只有标题和空表格，缺乏实质内容
3. **全局 vs 迭代层混淆**：AI 补充全局需求文档时误用迭代层命令

**解决方案**：子层拆分 + 自动链式推进 + 质量门禁拦截 + 分层约束策略

##### Layer 4 子层拆分（4a/4b/4c/4d）

将原来的单层 Layer 4 汇总拆分为 4 个子步骤，逐层递进：

| 子层 | 产出位置 | 产出文档 | 最小行数 |
|:---|:---|:---|:---|
| **4a** | `requirements/` | 全局需求总纲 + 各前端端需求 | 500 行 |
| **4b** | `overview/` | ARCHITECTURE.md + FUNCTION_MAP.md + API_CONTRACT.yaml + INTERACTION_MAP.md | 200/50/-/- 行 |
| **4c** | `overview/` | SECURITY_AUDIT.md + PERFORMANCE_BASELINE.md + DATA_FLOW.md + DEPLOYMENT.md + CONSISTENCY_CHECK.md | 80/80/150/100/50 行 |
| **4d** | `platforms/{端}/` | 后端: API_INVENTORY.md + DATA_MODEL.md + BUSINESS_RULES.md；前端: UI_FLOW.md + API_CALL_MAP.md + STATE_MANAGEMENT.md | 150/100/-/100/80/80 行 |

每个子层完成后才进入下一子层，子层内部通过 `SUB_LAYER_DOCS` 动态检测缺失文档，一次只聚焦生成一份缺失文档。

##### 自动链式推进机制

**问题**：Prompt 中虽然写了 `[SPECCORE_EXEC]`，但 AI 经常不输出，导致流程中断。

**方案**：CLI 层面兜底，在 `--apply` 处理完后主动输出 `[SPECCORE_EXEC]`：

```
Layer N --apply 写入完成
  → CLI 检测进度（detectGlobalLayerProgress）
  → 如果 completedLayer < 4
    → 输出 [SPECCORE_EXEC: speccore analyze --scope global --layer N+1]
    → AI 收到后自动执行下一层
```

双重保险：Prompt 中要求 AI 输出 `[SPECCORE_EXEC]` + CLI 层面主动输出 `[SPECCORE_EXEC]`。

##### 质量门禁拦截机制

**问题**：`doc-quality-gate.ts` 只打印报告，不阻止不合格文档进入下一层。

**方案**：`--apply` 写入后，质量门禁检测到 `error` 时自动拦截：

```
--apply 写入完成
  → runGlobalQualityGate() 运行质量检查
  → 如果有 criticalErrors
    → 不输出 [SPECCORE_EXEC]（不推进）
    → 输出 [SPECCORE_PROMPT] 修复任务
    → AI 修复后重新 --apply
  → 如果无 error
    → 输出 [SPECCORE_EXEC] 推进下一层
```

质量门禁检查项：占位符、行数达标、空表格、Mermaid 语法、关键章节缺失。

##### AGENTS.md 与 Prompt 的分层约束策略

**设计决策**：框架级约束放 AGENTS.md，执行级约束放 Prompt。

| 约束层级 | 载体 | 覆盖范围 | 约束力 |
|:---|:---|:---|:---|
| **框架级** | AGENTS.md | 所有 AI 工具可见 | 广而浅 |
| **执行级** | analyze Prompt | 执行时注入 | 深而强 |

AGENTS.md 负责：目录结构、禁止事项、工作方式、产出清单
Prompt 负责：当前 Layer 的具体任务、行数要求、自检 Checklist、写入方式

两者互补不重复，Prompt 的约束更具体、更难被遗忘。

---

## 5. Skill + CLI 架构

### 5.1 核心理念

**CLI 输出标签 → AI 执行命令 → CLI 输出下一标签。标签驱动的闭环，AI 和 CLI 交替协作，不输出命令文本给用户复制。**

```
用户自然语言
  → AI 执行 speccore ask
    → CLI 输出 [SPECCORE_EXEC: analyze --prompt]
      → AI 执行 analyze
        → CLI 输出 [SPECCORE_PROMPT]... → AI 生成内容
        → CLI 输出 [SPECCORE_EXEC: plan --prompt]
          → AI 执行 plan...
```

### 5.2 命令分类与执行原则

| 类型 | 示例 | 执行方式 |
|:---|:---|:---|
| **🔒 需 AI 参与** | `analyze --prompt`、`plan --prompt`、`execute --prompt` | 必须走 `[SPECCORE_EXEC]` 标签，AI 用 `execute_command` 执行 |
| **✅ 纯 CLI** | `context`、`dashboard` | AI 执行或终端跑都行 |
| **✅ 查看/展示** | `about`、`welcome`、`ask` | AI 执行，用 `file://` 或 `present_files` 展示结果 |

**🚫 绝不输出命令文本让用户复制**——那等于把 AI 踢出循环。

#### CLI 启动稳定性：Heavy Dependency 动态导入（v8.3.51+）

**问题**：`verify` 命令依赖 Playwright（含 native binary），`cli.ts` 顶部静态导入 `verifyCommand` 导致：
- 即使执行 `analyze`、`status`、`dashboard` 等不依赖 Playwright 的命令，也会在 Node.js 16 环境下崩溃
- Playwright 的 native binary 与部分 Node.js 版本不兼容

**修复**：`verifyCommand` 改为动态导入：

```typescript
// cli.ts: 移除顶部静态导入
// import { verifyCommand } from './commands/verify';  // ❌ 删除

// 命令注册时使用动态导入
program
  .command('verify')
  .action(async (options: any) => {
    const { verifyCommand } = await import('./commands/verify');  // ✅ 按需加载
    return verifyCommand(options);
  });
```

**设计原则**：
- 含 heavy native dependency 的命令，一律使用动态导入
- CLI 初始化时只加载轻量级命令，确保启动速度和兼容性
- 命令首次执行时才加载对应依赖，实现按需初始化

### 5.2 路由器 Skill

统一入口 `.agents/skills/speccore-router/SKILL.md`，83 条同义词映射覆盖 25+ 个命令：

| 用户说 | 输出 | 类型 |
|------|------|:---:|
| "开发 Task-001" | `speccore execute -t Task-001 --force` | 🔒 AI |
| "分析 Q1" | `speccore analyze -I Q1` | 🔒 AI |
| "拆分任务" | `speccore iteration split -I Q1` | 🔒 AI |
| "查看进度" | `speccore dashboard` | ✅ CLI |
| 复杂意图 | `speccore ask "用户原话"` ← fallback | 🔒 AI |

### 5.3 ask 引擎四大模式

| 模式 | 场景 | 识别方式 |
|------|------|------|
| **explain** | 解释命令 | 知识库匹配 |
| **guide** | 流程指引 | 工作流生成 |
| **match** | 意图匹配 | 直接映射命令 |
| **pipeline** | 复杂编排 | plan + execute |

### 5.4 意图合成（synthesizeIntent）

三层分析链路：
```
输入 → ① 参数提取(时间/类型/优先级/名称) 
     → ② 上下文补全(迭代/批次从context.json)
     → ③ 命令自检(遗漏检查+置信度评分)
     → ④ 仅歧义时确认
```

### 5.5 双模式确认

| 用户表述 | 模式 | 行为 |
|:---|:---|:---|
| 未说自主/一键 | **交互模式** | 展示理解 → 等用户确认 → 执行 |
| 说了"自主/一键" | **自主模式** | 展示理解 → 确认一次 → 全自动执行 |
| 纯单命令 | **跳过确认** | 简单无歧义直接执行 |

### 5.6 HTML 页面输出规范

所有 HTML 页面（引导页、about 等）同时输出两种格式：
- `file://` 链接：用户可直接点击打开
- `[SPECCORE_xxx: path]` 标签：WorkBuddy 走 `present_files` 展示

### 5.7 Ask 引擎 v2.0 — 三段式动态路由

> 设计原则：**本地优先、AI 补位、缓存固化、渐进智能**

#### 5.7.1 四层路由架构

```
用户输入
  │
  ▼
┌─────────────────┐     ┌─────────────────┐
│ 第零层: 确定性   │────→│ 切上下文/直接路由 │ ← 零成本，最高优先级
└─────────────────┘     └─────────────────┘
  │ 不匹配
  ▼
┌─────────────────┐     ┌─────────────────┐
│ 第一层: 意图缓存 │────→│ 精确/模糊命中即返 │ ← 零成本，越用越快
└─────────────────┘     └─────────────────┘
  │ 未命中
  ▼
┌─────────────────┐     ┌─────────────────┐
│ 第二层: 本地引擎 │────→│ 关键词+正则+上下文 │ ← 零成本，毫秒响应
└─────────────────┘     └─────────────────┘
  │
  ▼ 三段式动态路由
  ├─ 高分区 ≥70 ──→ 本地直接执行（不打扰 AI）
  ├─ 中分区 45~69 ─→ 双路并行，取更优结果
  └─ 低分区 <45 ──→ 直接交给 AI，本地只提取参数
  │
  ▼
┌─────────────────┐     ┌─────────────────┐
│ 第三层: 宿主AI   │────→│ 语义理解+RichContext│ ← IDE 自带，免费
└─────────────────┘     └─────────────────┘
  │ 不可用
  ▼
┌─────────────────┐     ┌─────────────────┐
│ 第四层: 自有LLM  │────→│ 多Provider冗余路由 │ ← 用户自配，默认禁用
└─────────────────┘     └─────────────────┘
  │ 全失败
  ▼
┌─────────────────┐
│ 兜底: 本地结果   │
└─────────────────┘
```

#### 5.7.2 三段式动态路由策略

| 置信度区间 | 行为 | 成本 |
|:---|:---|:---|
| **≥ highThreshold (70)** | 本地引擎直接执行，不打扰 AI | 零 |
| **lowThreshold ~ high (45~69)** | 中置信度确认：展示匹配意图 + 备选方案，等待用户确认后再执行 | 零 |
| **< lowThreshold (45)** | 直接交给 AI，本地引擎仅负责提取参数（通过 `candidates` 传入 Rich Context） | 零或低 |

**`--rules` 强制开关**：命令行传入 `--rules` 或配置 `forceHostAi: true` 时，无论置信度多少，强制走 AI 路径。

#### 5.7.2a 语境加成/减分机制（置信度校准）

> 设计目标：**不设门槛，只调分数。该放的放，该拦的拦。**

触发词匹配只看"说了什么词"，不看"在什么语境下说的"。为解决"帮我改一下文档里的错别字"被误判为 `change` 命令等问题，在基础匹配分之上增加语境加成/减分：

| 语境信号 | 分值 | 示例 |
|:---|:---|:---|
| **开发术语加成** (+10) | 输入含功能/模块/接口/需求/迭代/任务/代码/登录/支付/API/前端/后端/部署/测试/PR/分支/合并/发布/组件/页面/路由/状态/模型/规格/架构/方案/设计 | "改一下登录功能的接口" → +10 |
| **speccore 专有词加成** (+10) | 输入含 speccore/Task-\d/Iteration-/Q\d/需求文档/规格文档/功能模块/知识图谱/衰减检测/analyze/split/execute/dashboard | "创建迭代 Q3" → +10 |
| **域外信号减分** (-30) | 输入含错别字/拼写/语法错误/word文件/excel/表格/PPT/演示文稿/邮件/日程/翻译文档/排版/格式调整/字体/字号文档/打印/导出pdf/导出word | "帮我改一下文档里的错别字" → -30 |

**效果示例：**

| 输入 | 基础分 | 语境调整 | 最终分 | 行为 |
|:---|:---|:---|:---|:---|
| "帮我改一下文档里的错别字" | 75 | -30 (域外) | **45** | 中置信度 → 询问确认 ✅ |
| "帮我分析一下" | 55 | +0 | **55** | 中置信度 → 询问确认 ✅ |
| "改一下登录功能的接口" | 75 | +10 (开发术语) | **85** | 高分区 → 直接执行 ✅ |
| "创建迭代 Q3" | 86 | +10 (speccore词) | **96** | 高分区 → 直接执行 ✅ |
| "帮我翻译一下这个文档" | 55 | -30 (域外) | **25** | 低分区 → 交给 AI ✅ |

#### 5.7.2b 中置信度确认机制

当本地引擎匹配到意图但置信度处于中分区（45~69）时，不直接执行，而是展示确认界面：

```
🤔 我理解你想做这个，但不太确定，请确认:

🎯 我的理解: change (50%)
📋 建议命令: speccore change

其他可能:
  • analyze (45%) — speccore analyze

输入 y/回车 确认执行，或重新描述你的需求。
```

**设计原则：**
- 高分区（≥70）：用户意图明确，直接执行不打扰
- 中分区（45~69）：匹配到了但不确定，询问用户确认
- 低分区（<45）：本地无法判断，交给 AI 语义理解

#### 5.7.3 意图缓存与自学习

```
精确匹配 ──→ 相同输入直接命中返回
    │
归一化匹配 ──→ 去停用词+排序后的语义匹配（v1.1 新增）
    │
模糊匹配 ──→ 编辑距离 ≤2 也命中（容错拼写错误）
    │
命中统计 ──→ 记录命中次数、最后使用时间
    │
缓存固化 ──→ 命中次数 ≥ cacheMinHits (默认3) 视为高频意图，持久化到磁盘
```

**缓存版本**: v1.1（新增归一化语义匹配层）

缓存文件：`.speccore/local/intent-cache.json`

**归一化策略（v1.1）**：
- 提取输入中的实词（去停用词：`的`、`了`、`the`、`and` 等）
- 按字母/拼音排序后取前 6 个词，用 `|` 拼接为 `normalizedInput`
- 示例：`"帮我分析一下登录需求"` → `"分析|登录|需求"`
- 示例：`"分析下登录的需求"` → `"分析|登录|需求"`（同一归一化键，命中同一缓存）

#### 5.7.4 Rich Context 构建器

为宿主AI / LLM 提供决策所需的完整上下文，而非让AI"盲猜"：

| 上下文维度 | 内容 | 用途 |
|:---|:---|:---|
| **候选意图** | 本地引擎 Top-3 意图 + 置信度 | 让AI做"选择题"而非"填空题" |
| **项目阶段** | 当前生命周期（init/plan/execute/done） | AI 知道该推荐什么命令 |
| **活跃迭代** | 当前上下文中的 iteration + task | 精准定位操作目标 |
| **历史命令** | 最近 10 条命令的时间序列 | 行为模式推断 |
| **知识图谱关联** | 当前 task 的上游需求、兄弟子任务、依赖任务 | AI 理解任务在全局中的位置 |

输出标记：`[SPECCORE_AI_CONTEXT]...[/SPECCORE_AI_CONTEXT]`

**宿主AI协议（非TTY优化）**：
- TTY 模式：输出标记后等待 15 秒文件协议响应（供人工终端使用）
- 非TTY模式（AI Agent）：输出 `[SPECCORE_AI_CONTEXT]` 标记后直接返回，不阻塞等待文件协议
- AI Agent 可直接从 stdout 提取上下文，接管后续决策

#### 5.7.5 多 LLM 冗余路由（默认禁用）

用户可在 `.speccore/config/ask.json` 中配置自有 LLM Provider：

```json
{
  "llmProviders": [
    { "name": "ollama-local", "enabled": false, "type": "ollama", "priority": 1 },
    { "name": "openai-compatible", "enabled": false, "type": "openai", "priority": 2 }
  ]
}
```

- 按 `priority` 排序，依次尝试
- 全部失败时回退宿主AI → 本地兜底
- 默认全部 `enabled: false`，零成本

#### 5.7.6 配置体系

配置优先级：**环境变量 > `.speccore/config/ask.json` > 内置默认值**

```json
{
  "routing": {
    "mode": "hybrid",
    "highThreshold": 70,
    "lowThreshold": 45,
    "autoHostAi": true,
    "cacheEnabled": true,
    "cacheMinHits": 3
  },
  "rules": {
    "forceHostAi": false
  }
}
```

| 配置项 | 说明 |
|:---|:---|
| `mode` | `hybrid`(混合) / `local-only`(纯本地) / `ai-first`(AI优先) |
| `highThreshold` | 本地直接执行阈值 |
| `lowThreshold` | AI 接管阈值 |
| `autoHostAi` | 中低分区是否自动调用宿主AI |
| `cacheEnabled` | 是否启用意图缓存 |
| `cacheMinHits` | 缓存固化阈值 |
| `forceHostAi` | 等价于命令行 `--rules` |

### 5.8 全命令 Skill 覆盖（v8.3.60+）

> **设计目标**：每个 CLI 命令都有对应的 `/命令 + 自然语言` 快捷入口，AI 窗口中一键触发。

#### 两层路由架构

```
用户输入：/deploy 把当前功能发布到测试环境，只看 H5
           │        └────────────────────────────────┘
           │                      │
           ▼                      ▼
      精确匹配                 AI 语义分析
     （触发 Skill）         （窄域意图识别）
```

**第一层：精确入口** — `/deploy`、`/verify`、`/build` 等斜杠命令精确匹配到对应 Skill，零误判。

**第二层：语义分析** — Skill 内部由 AI 理解自然语言，提取参数：

| 用户说法 | AI 理解 | 生成的命令 |
|:---|:---|:---|
| "部署到测试环境" | `pipeline --env test --all` | `speccore pipeline --env test --all` |
| "发布到测试环境" | "发布"≈"部署" | `speccore pipeline --env test --all` |
| "只看 H5" | `--platforms h5` | `speccore pipeline --env test --platforms h5` |
| "预览一下" | `--dry-run` | `speccore pipeline --env test --all --dry-run` |

#### Skill 清单（v8.3.60+）

| Skill | 命令 | 自然语言示例 |
|:---|:---|:---|
| `spec-init` | `speccore init` | `/init 初始化项目` |
| `spec-welcome` | `speccore welcome` | `/welcome 查看欢迎页` |
| `spec-help` | `speccore help` | `/help 有哪些命令` |
| `spec-dashboard` | `speccore dashboard` | `/dashboard 查看进度` |
| `spec-doc2spec` | `speccore doc2spec` | `/doc2spec 导入需求文档` |
| `spec-analyze` | `speccore analyze` | `/analyze 分析 Q1 迭代` |
| `spec-split` | `speccore split` | `/split 拆分任务` |
| `spec-plan` | `speccore plan` | `/plan 制定执行计划` |
| `spec-execute` | `speccore execute` | `/execute 开发 Task-001` |
| `spec-pr` | `speccore pr` | `/pr 提交代码` |
| `spec-done` | `speccore done` | `/done 归档任务` |
| `spec-spec2doc` | `speccore spec2doc` | `/spec2doc 导出规格` |
| `spec-change` | `speccore change` | `/change 需求变更` |
| `spec-validate` | `speccore validate` | `/validate 验证合规性` |
| `spec-search` | `speccore search` | `/search 登录相关文档` |
| `spec-track` | `speccore track` | `/track 追踪 REQ-001` |
| `spec-sync` | `speccore sync` | `/sync 同步代码和 Spec` |
| `spec-rename` | `speccore rename` | `/rename 把 Q1 改成 Q2` |
| `spec-retro` | `speccore retro` | `/retro 复盘 Task-001` |
| `spec-context` | `speccore context` | `/context 切换到 Q1` |
| `spec-ops` | `speccore ops` | `/ops 查看操作历史` |
| `spec-deploy` | `speccore pipeline` | `/deploy 部署到测试环境` |
| `spec-verify` | `speccore verify` | `/verify 跑冒烟测试` |

#### 与 `speccore ask` 的区别

| 特性 | `/命令 + 自然语言` | `speccore ask` |
|:---|:---|:---|
| 入口 | `/deploy`、`/verify` 等精确命令 | 通用自然语言 |
| 意图域 | 窄域（仅限该命令的参数） | 全命令域 |
| 触发速度 | 立即（精确匹配） | 需意图识别 |
| 适用场景 | 明确知道要做什么，但懒得打字 | 不确定该用哪个命令 |

#### 设计原则

1. **精确入口 + 语义理解**：`/命令` 精确路由到 Skill，后续自然语言由 AI 在窄域内解析
2. **不影响 ask 能力**：Skill 只预处理参数，最终仍调用 `speccore ask` 执行
3. **全命令覆盖**：26+ 个命令全部有 Skill，无一遗漏
4. **双模式支持**：自然语言为主（最友好），显式参数为辅（最精确）

---

## 6. 全平台 AI 适配矩阵

### 6.1 生成的文件

`speccore init` 自动生成：

```
项目根目录/
├── AGENTS.md              ← 通用标准（Cursor/Copilot/Windsurf/Codex）
├── CLAUDE.md              ← Claude Code 引用 @AGENTS.md
├── .qoder/rules/          ← Qoder 规则
│   └── speccore.md
├── .qoder/commands/       ← Qoder 斜杠命令（spec-*.md 格式）
├── .agents/skills/        ← Skills 技能（26+ 个，v8.3.60+ 全命令覆盖）
│   ├── speccore-router/SKILL.md   ← 智能路由器
│   ├── spec-ask/SKILL.md          ← Ask 引擎入口
│   ├── spec-analyze/SKILL.md      ← 需求分析
│   ├── spec-change/SKILL.md       ← 需求变更
│   ├── spec-context/SKILL.md      ← 上下文切换
│   ├── spec-dashboard/SKILL.md    ← 仪表盘
│   ├── spec-deploy/SKILL.md       ← 部署流水线（build/deploy/pipeline）
│   ├── spec-dev/SKILL.md          ← 开发流水线
│   ├── spec-doc2spec/SKILL.md     ← 文档导入
│   ├── spec-done/SKILL.md         ← 任务归档
│   ├── spec-execute/SKILL.md      ← 任务执行
│   ├── spec-help/SKILL.md         ← 帮助中心
│   ├── spec-init/SKILL.md         ← 项目初始化
│   ├── spec-iteration-create/SKILL.md ← 迭代创建
│   ├── spec-ops/SKILL.md          ← 操作历史
│   ├── spec-plan/SKILL.md         ← 计划生成
│   ├── spec-pr/SKILL.md           ← PR 提交
│   ├── spec-reindex/SKILL.md      ← 索引重建
│   ├── spec-rename/SKILL.md       ← 重命名
│   ├── spec-retro/SKILL.md        ← 回顾复盘
│   ├── spec-search/SKILL.md       ← 全文搜索
│   ├── spec-spec2doc/SKILL.md     ← 规格导出
│   ├── spec-split/SKILL.md        ← 任务拆分
│   ├── spec-sync/SKILL.md         ← 双向同步
│   ├── spec-synthesize/SKILL.md   ← 多端综合
│   ├── spec-task-create/SKILL.md  ← 任务创建
│   ├── spec-track/SKILL.md        ← 全链路追踪
│   ├── spec-validate/SKILL.md     ← 合规验证
│   ├── spec-verify/SKILL.md       ← 测试验证
│   └── spec-welcome/SKILL.md      ← 欢迎页
├── .claude/commands/      ← Claude Code 斜杠命令
├── .codebuddy/commands/   ← CodeBuddy 斜杠命令
├── .trae/commands/        ← TRAE 斜杠命令
├── .trae-cn/commands/     ← TRAE-CN 斜杠命令
└── .windsurf/commands/    ← Windsurf 斜杠命令
```

### 6.2 覆盖矩阵

| 工具 | 机制 | 自动 |
|------|------|:--:|
| WorkBuddy | `.speccore/` + CONSTITUTION.md | ✅ |
| Cursor/Copilot/Windsurf | `AGENTS.md` | ✅ |
| Codex | `AGENTS.md` | ✅ |
| Claude Code | `CLAUDE.md` → `@AGENTS.md` + `.claude/commands/` | ✅ |
| CodeBuddy | `.codebuddy/commands/` | ✅ |
| Qoder | `.qoder/rules/` + `.qoder/commands/spec-*.md` | ✅ |
| TRAE | `.agents/skills/` + `.trae/commands/` | ✅ |
| TRAE-CN | `.trae-cn/commands/` | ✅ |

### 6.3 HTML 页面视觉规范

所有 HTML 展示页面（about / dev / welcome / ask / help / retro 等 20 页）统一遵循以下规范。

#### 光晕效果

单卡页面头部叠加 `card-bg` 光晕层：
```css
.card-bg {
  position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background: radial-gradient(ellipse at 50% 10%, rgba(14,165,233,.25) 0%, transparent 70%);
  animation: cardGlow 3s ease-in-out infinite;
  transform-origin: top center;
}
@keyframes cardGlow {
  0%, 100% { opacity: .5; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.6); }
}
```
光晕圆心位于卡片顶部 10%（标题文字下方），水平居中，呼吸扩张方向锚定顶部。

#### 标题发光

所有 `<h1>`/`<h2>` 统一呼吸发光：
```css
h1, h2 {
  text-shadow: 0 0 20px rgba(14,165,233,.4), 0 0 60px rgba(14,165,233,.15);
  animation: titleGlow 3s ease-in-out infinite;
}
@keyframes titleGlow {
  0%, 100% { text-shadow: 0 0 20px rgba(14,165,233,.4), 0 0 60px rgba(14,165,233,.15); }
  50% { text-shadow: 0 0 30px rgba(14,165,233,.7), 0 0 80px rgba(14,165,233,.3); }
}
```

#### 四边扫描线

每张卡片叠加横向脉冲（`card::before`/`card::after`）+ 纵向脉冲（`vline.l`/`vline.r`）。

#### ask 页面特殊规则

- 标题用 HTML `<h1>` + `<div class="sub">`，自动继承发光；SVG 仅承载下方流程图
- SVG viewBox 裁掉顶部空白：`0 80 680 420`
- 底部 badge-line + footer 在卡片内部
- 所有 `speccore ask` 文字统一为 `/spec-ask`

#### HTML 文件与功能对应

| 文件路径 | 功能 | CLI 命令 |
|:---|:---|:---|
| `speccore-about.html` | 关于页面：版本、GitHub、维护状态 | `speccore about` |
| `speccore-ask-onboarding.html` | Ask 首次引导页：4 模式流程图 | `speccore ask "…"` (无高速?缓存时) |
| `speccore-ask-result.html` | Ask 结果展示 | `speccore ask` |
| `speccore-dev.html` | 开发者工作台 | `speccore dev` |
| `speccore-setup-guide.html` | 项目配置引导页：6 步引导新用户完成初始化 | `speccore init` 后自动生成 |
| `deploy/welcome.html` | 项目名片/欢迎页 | `speccore welcome` |
| `deploy/index.html` | 全局看板（所有项目聚合） | `speccore dashboard --scope global` |
| `deploy/status.html` | 迭代数据看板（当前迭代） | `speccore dashboard` / `speccore status-panel` |
| `templates/html/speccore-*.html` | Ask 模式子页 + help/retro/demo 模板 | `speccore ask` 内部路由 / `speccore help` / `speccore retro` |


#### 版本号同步

| 页面类型 | 版本来源 |
|:---|:---|
| 静态 HTML | `npm run build` → `sync-version.js` 从 package.json 自动同步 |
| 动态渲染（plan/dashboard） | 运行时从 package.json 读取 |


---

## 7. 守护进程清理（v8.3.60+）

> ⚠️ `schedule` 和 `watch` 命令已在 v8.3.60 彻底移除。定时调度由 WorkBuddy Automations 替代，文件监听由宿主 IDE 原生支持替代。

### 7.1 自动清理机制

`speccore update` 升级时自动检测并终止遗留守护进程：

```
speccore update
  → 检测 speccore.*schedule / speccore.*daemon / speccore.*watch 进程
  → macOS/Linux: SIGTERM → 500ms → SIGKILL
  → Windows: taskkill /F
  → 清理 .speccore/local/schedule.json
  → 继续升级流程
```

### 7.2 跨平台残留检测

| 平台 | 检测方式 | 终止方式 |
|:---|:---|:---|
| macOS | `ps aux` + `grep` | `kill` → `kill -9` |
| Linux | `ps aux` + `grep` | `kill` → `kill -9` |
| Windows | `wmic process` | `taskkill /F /PID` |

### 7.3 手动清理

如 `speccore update` 无法清理（如 speccore 本身损坏）：

**macOS/Linux：**
```bash
pkill -f "speccore.*schedule"
pkill -f "speccore.*daemon"
pkill -f "speccore.*watch"
```

**Windows（PowerShell 管理员）：**
```powershell
Get-WmiObject Win32_Process | Where-Object {
  $_.CommandLine -like "*speccore*schedule*" -or
  $_.CommandLine -like "*speccore*daemon*" -or
  $_.CommandLine -like "*speccore*watch*"
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

---

## 8. 命名规范

| 类型 | 格式 | 示例 |
|------|------|------|
| 迭代 | `Iteration-{ID}-{slug}` | `Iteration-001-ecommerce` |
| 任务 | `Task-{ID}` | `Task-001` |
| 目录 | 3位数字步长10英文 | `000-overview` `010-requirements` |
| 需求端 | 小写英文 | `app` `h5` `miniapp` `admin` |
| 分支 | `feature/Task-{ID}` | CONSTITUTION 定义 |

#### CLI 命令命名规范（v8.3.54+）

**命令名**：全拼英文单词，语义清晰
**别名**：2-3 字母缩写，便于快速输入

| 命令 | 别名 | 说明 |
|:---|:---|:---|
| `doctor` | `dr` | 项目健康度诊断 |
| `dashboard` | `db` | 项目仪表盘 |
| `history` | `hi` | 历史记录（操作日志 + 需求变更） |
| `status` | `st` | 状态面板 |

**命名原则**：
- 主命令使用完整英文单词，避免缩写（如 `history` 而非 `ops`）
- 别名使用业界通用缩写（`dr`、`db`、`hi`、`st`）
- 同一命令的多个功能通过参数区分（如 `history` 默认显示操作日志，`--req` 查看需求历史）

---

## 9. 版本记录

| 版本 | 日期 | 关键变更 |
|------|------|------|
| v5.27.25 | 08-06 | 强化 TRAE skill 反绕过、pandoc 多路径检测 |
| v5.27.26 | 08-07 | 需求按功能组织、analyze 按需求×端、split 扫描 020-specs |
| v5.27.27 | 08-07 | Skill+CLI 输出模式、统一路由器 Skill |
| v5.27.28 | 08-07 | AGENTS.md + CLAUDE.md 全平台适配 |
| v5.27.29 | 08-07 | Qoder .qoder/rules/ 自动生成 |
| v5.27.34 | 08-07 | Prompt 架构落地: Skill→CLI→AI→CLI 协作循环 |
| v5.27.35 | 08-07 | CONSTITUTION 增加"项目名称"列、init 残留清理、意图识别平台参数 |
| v5.30.0 | 08-07 | 可执行编排引擎 v4 + 升级提示 + 数据保护 + 管道传递 |
| v5.32.0 | 08-07 | 强制分析保护：任务无 ANALYSIS.md 禁止 execute |
| v5.56.0 | 08-08 | Daemon 懒启动/懒停止、跨平台守护安装(LaunchAgent/cron/schtasks) |
| v5.58.0 | 08-08 | Ask 双模式(自主/交互)、plan --select 多选 |
| v5.59.0 | 08-08 | 意图加权得分系统(替代关键词硬匹配) |
| v5.60.0 | 08-08 | 意图确认步骤(SPECCORE_INTENT + SPECCORE_CONFIRM_NEEDED) |
| v5.63.0 | 08-08 | synthesizeIntent 智能意图合成(参数提取+补全+自检) |
| v5.64.0 | 08-08 | speccore about 版本信息页、引导页 file:// 链接 |
| v5.65.0 | 08-08 | schedule retry/多调度管理、引导页优先输出 |
| v5.69.0 | 08-10 | HTML 视觉规范统一：全页面光晕+标题呼吸发光+四边扫描线；ask onboarding SVG→HTML标题重构；/spec-ask 文案统一；Qoder 命令 spec:X.md 格式；sync-version.js 版本自动同步 |
| v5.73.0 | 08-11 | Onboarding 页面重构 + 全平台引导页强制展示 + 模板自动复制 |
| v5.78.0 | 08-12 | 质量门禁从 6 项扩展到 10 项（TEST/REVIEW/DEPLOY/ERROR_CODES） |
| v5.79.0 | 08-12 | 需求确认循环 + 项目配置引导页初版 |
| v5.80.0 | 08-12 | 引导页全面重构：6步流程 + Skill命令格式 + 自动化模式 + 参数说明 |
| v5.81.0 | 08-12 | 引导页视觉增强：card-bg光晕 + 按钮跳转ask + 容器宽度调整 |
| v5.81.1 | 08-12 | 文档补充：command-reference/commands.en init引导页说明 |
| v5.82.0 | 08-12 | update/init命令输出改进：版本相同明确提示 + 消除重复代码 |
| v5.83.0 | 08-12 | --force模式自动备份：.speccore/ + Iteration-*/ + inbox/ + questions/ |
| v6.0.0 | 08-14 | 全局知识库 TOC 全覆盖：PATTERNS + RULES + PROJECTS + 扁平文件 |
| v6.1.0 | 08-14 | 任务目录结构重构：_shared/ + 按端嵌套 + 子任务命名 |
| v6.2.0 | 08-14 | 子任务发现与筛选：scanTasks 展开各端 + 按端/责任人过滤 |
| v6.3.0 | 08-14 | 端注册表 + 模糊匹配 + 按端分析 |
| v6.4.0 | 08-14 | 全量索引重建与一致性检查（reindex 命令） |
| v6.5.0 | 08-14 | 知识图谱 + 衰减检测 + AI 关联链注入 |
| v6.6.0 | 08-14 | 知识库系统全面修复（13 项问题修复） |
| v6.7.0 | 08-14 | 知识图谱深度集成 + 意图缓存增强 + 宿主AI协议优化 |
| v6.8.0 | 08-14 | 代码索引智能增强 + RAG 检索 + 统一检索层 + Prompt 性能优化 |
| v6.9.0 | 08-14 | 全局知识沉淀 + 检索层深度检查修复（7 bug）+ 文档同步 |
| v6.10.0 | 08-14 | 智能文档分类摄入（doc2spec --classify）+ nature/type 两步分类 + CONTEXT.md 来源追溯 + 多类型任务支持 |
| v6.31.0 | 08-15 | init.ts CONSTITUTION 升级章节对比 + update.ts 同步文件清单增强 |
| v6.32.0 | 08-15 | 引导页强制展示修复（全平台）：speccore-router + 7 平台 command + init 模板全部改为强制式措辞 |
| v6.33.0 | 08-15 | analyze --prompt 新增目录结构指导（第 5 步），要求 AI 按端创建子目录 |
| v6.34.0 | 08-15 | split/prompt-builder/knowledge-graph 适配端级目录新路径（优先 020-specs/{端}/，回退 platforms/） |
| v6.35.0 | 08-15 | analyze --auto 双层文档架构（全局+各端分离）：全局放根目录，各端专属放 {端}/ 子目录 |
| v6.36.0 | 08-15 | REQUIREMENT.md 功能涉及端标注 + split 三级推断逻辑（_scopePlatforms → TECH.md 内容检测 → 回退所有端） |
| v6.37.0 | 08-15 | split 读取各端子目录文档 + 优先提取端专属内容（loadSpecContents 双层读取 + extractTaskTechContent 优先匹配） |
| v6.49.13 | 08-16 | CLI 控制目录结构：analyze 预创建 020-specs/ + split 模块驱动拆分 + 内容填充 Prompt |
| v6.49.14 | 08-16 | split 从 global/REQUIREMENT.md 读取涉及端，按模块精确创建端目录 |
| v6.49.15–v6.49.17 | 08-16 | 文档更新 + prompt 编号修复 + 功能模块来源链接 + 链式生成→图谱 RAG 检索纠正 |
| v6.50.0 | 08-16 | 业务-代码关联图谱：business_module 实体 + scanBusinessCodeMappings() + 开放关系类型 |
| v6.50.1–v6.50.2 | 08-16 | CONTEXT.md 业务映射按端隔离 + 知识图谱可视化 business_module 过滤按钮 |
| v6.50.3 | 08-16 | 正则 m 标志 bug 修复 + prompt 缩进统一 + Phase 2 关系类型示例补充 |
| v6.51.0 | 08-16 | HTML 页面 present_files 全量覆盖：10 个标记 + 7 平台 command + Skill + init 模板同步 |
| v6.84.0 | 08-20 | AGENTS 规范数据库：`.speccore/AGENTS/` 目录 + 混合调度器（注册表+自描述）+ 端/领域特化 |
| v6.85.0 | 08-20 | RULES 编码规范库：8 个内置规范 + 按技术栈自动注入 + 用户自定义覆盖 |
| v6.86.0 | 08-20 | AGENTS 全阶段扩展：11 个新角色 + split/plan/change/pr 全阶段覆盖 |
| v6.87.0 | 08-20 | COMMANDS 命令模板系统：3 个内置模板 + `{{变量}}` 替换 + 回退策略 |
| v6.88.0 | 08-20 | SKILLS 可复用技能库 + HOOKS 生命周期钩子：4 技能 + 2 钩子 |
| v6.89.0 | 08-20 | 统一注入框架 ContextInjector：`injectAll()` 统一五层注入 API |
| v6.90.0 | 08-20 | 代码知识图谱 Code Knowledge Graph：本地 AST 解析 + 社区检测 + God nodes + 可视化 |
| v6.91.0 | 08-20 | 图谱深度整合：analyze 阶段注入 + PATTERNS 置信度标签 + MODULE_MAP + 多模态图谱 |
| v6.91.1 | 08-20 | 流程修复：analyze 图谱注入修复 + PipelineEngine 状态同步 + dev.ts plan 跳过检查 + 僵尸选项清理 |
| v7.0.0 | 08-21 | 统一图谱查询 `speccore graph` + 语义级节点标签提取 + 知识图谱↔RAG 索引联动 |
| v7.1.0 | 08-21 | LLM 语义增强查询（语义扩展+语义排序）+ Mermaid 图表渲染 `graph render` + 全局分析产物图表化（Layer 2/3/4 强制图表要求）+ Ask 意图完善 |
| v8.3.47 | 09-04 | UI 质量门禁：三层使用模式、四层验证能力、Playwright 冒烟测试 |
| v8.3.50 | 09-04 | 视觉模型可配置切换：Qwen-VL(默认)/OpenAI/Anthropic/本地模型，四层配置优先级 |
| v8.3.51 | 09-04 | 健壮性修复：analyze.ts overview 路径路由错误修复 + Playwright 动态导入避免 CLI 启动崩溃 |
| v8.3.52 | 09-04 | Prompt 规范增强：Layer 4 强制规则，多前端项目需求必须独立成文 |
| v8.3.53 | 09-04 | 健壮性综合修复包：汇总 v8.3.51 + v8.3.52 全部修复 |
| v8.3.54 | 09-04 | CLI 命令命名规范化：`ops` → `history`，统一全拼+缩写规范；history 合并操作日志+需求变更历史 |
| v8.3.60 | 09-07 | 环境驱动部署流水线：`pipeline --env` 自动读取环境配置 branch，自动 merge 当前分支 → build → deploy；五层环境模型（local/dev/test/staging/production）；全命令 Skill 覆盖（26+ 个 `/命令 + 自然语言` 快捷入口）；`verify --env-file` 支持环境配置合并测试参数 |

> **最后更新**: 2026-09-07 (v8.3.60) — 环境驱动部署 + 全命令 Skill 覆盖

---
## 10. 可执行编排引擎（spec-ask v4）

### 10.1 五分支决策树

```
用户输入 → 步骤0 判断类型 → 步骤1 意图识别 [SPECCORE_MODE] → 分支选择

分支 A: match    → 补参 → 确认 → --prompt → 自己生成 → 校验 → --response
分支 B: ambiguous → 展示候选人 → 用户选 → 分支A
分支 C: explain  → 直接回答，不调CLI
分支 D: pipeline  → 展示≤5步 → 逐步确认 → 产物传递
分支 E: guide    → 展示流程 → 进D或结束
```

### 10.2 协作协议

| exitCode | 含义 | 标准行为 |
| :--- | :--- | :--- |
| 0 | 确定性操作完成 | 展示结果 → 推荐下一步 |
| 10 | 需要 AI | 提取 [SPECCORE_PROMPT] → 自己生成 → --apply |
| 11 | 缺参数 | 展示 [SPECCORE_NEEDS_INFO] 参数表 → 用户补 |

### 10.3 管道传递

```
Write /tmp/speccore-resp.json
cat /tmp/speccore-resp.json | speccore execute --response - -t Task-001
```

---

## 11. 升级与数据保护

### 11.1 文件保护策略

| 文件 | 策略 |
| :--- | :--- |
| CONSTITUTION.md | 永远不覆盖 → 生成 UPGRADE.md 对比文件 |
| context.json | 永远不覆盖 |
| Iteration-*/ | 永远不覆盖 |
| AI-RULES/AGENTS/Skills/模板 | 自动更新 + 输出清单 |

### 11.2 升级提示机制

每次 init 对比 `last-init-version.txt`，检测模板变化：
1. CONSTITUTION 缺新字段 → 生成 `.speccore/local/UPGRADE.md`
2. 输出自动更新文件清单
3. AI 模式：用户说"升级" → AI 智能合并
4. 手动模式：对照 UPGRADE.md 自行修改

#### 11.2.1 `speccore update` 全面升级检查框架（v8.3.25+）

`update` 命令从仅对比版本号 + 更新命令文件，升级为**覆盖所有必要文件的全面健康检查**：

**检查范围**：

| 文件/目录 | 检查内容 | 问题类型 | 自动修复 |
|:---|:---|:---|:---:|
| `.speccore.yml` | 与默认配置的结构差异 | `structural-diff` | ❌ |
| `.speccore/PROJECT.yaml` | 与默认配置的结构差异 | `structural-diff` | ❌ |
| `.speccore/local/context.json` | 必填字段完整性 | `missing-field` | ❌ |
| `.speccore/AI-RULES.md` | 文件存在性 | `missing-file` | ✅ |
| `.speccore/{AGENTS,RULES,COMMANDS,SKILLS,HOOKS}/` | 目录完整性 | `missing-dir` | ✅ |
| `Iteration-*/` | 旧版 Task-NNN 平铺结构 | `format-deprecated` | ✅ |
| `.speccore/CONSTITUTION.md` | 格式自动迁移 + 章节对比 | `format-deprecated` | 部分 |

**架构设计**：

```
┌─────────────────────────────────────────────────────────────┐
│  checkAllUpgradeIssues(projectRoot)                         │
│  ├── 系统配置检查 (.speccore.yml)                           │
│  ├── 项目配置检查 (PROJECT.yaml)                            │
│  ├── 上下文配置检查 (context.json)                          │
│  ├── 规范数据库完整性检查 (AGENTS/RULES/...)               │
│  ├── AI 参考手册存在性检查 (AI-RULES.md)                    │
│  └── 迭代结构 deprecated 检测 (Iteration-*/Task-NNN)        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  UpgradeCheckResult                                         │
│  ├── hasIssues: boolean                                     │
│  ├── issues: UpgradeIssue[]  (5 种类型)                     │
│  └── reports: {file, path}[]  (差异报告文件路径)            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  update.ts 报告输出                                          │
│  ├── 过滤 auto-fix 类型 (missing-dir / missing-file)        │
│  ├── 按文件分组展示                                          │
│  ├── 附处理建议 (💡)                                         │
│  └── 结构性差异 → 自动生成 .speccore/config/upgrade-diff.md │
└─────────────────────────────────────────────────────────────┘
```

**关键设计决策**：
- **单一检查函数**：`checkAllUpgradeIssues()` 可被 `update`、`doctor`、`status` 等命令复用，避免检查逻辑分散
- **类型化问题**：`UpgradeIssue.type` 支持 5 种类型，调用方可按需过滤（如 update 过滤 auto-fix 类型）
- **报告与修复分离**：检查只发现问题，不修改文件；修复由调用方根据场景决定（update 自动修复部分问题，doctor 只报告不修复）
- **差异报告持久化**：结构性差异自动生成 Markdown 报告到 `.speccore/config/upgrade-diff-*.md`，供用户离线查阅

### 11.3 低置信拒绝与歧义检测

- confidence < 45% → 拒绝匹配
- best.confidence - second.confidence < 15% → ambiguous 模式

---

## 12. Skill + CLI + AI 协作架构（Prompt/Apply 模式）

### 12.1 核心原则

```
CLI 只做确定性操作，不做内容生成。
代码/分析/拆分等创造性工作完全由宿主 AI 完成。
```

**角色分工**：
| 角色 | 职责 | 示例 |
| :--- | :--- | :--- |
| Skill（.agents/skills/） | 编排流程、调用 CLI、触发 AI | `spec-execute` Skill |
| CLI（speccore） | 读写文件、构建 Prompt、写入结果 | `speccore execute --prompt` 🔒 |
| 宿主 AI（Qoder/Trae/Claude） | 语义理解、内容生成、代码编写 | 根据 Spec 生成 Java 代码 |

### 12.2 Prompt/Apply 协作循环

```
┌──────────────────────────────────────────────────────────────┐
│  SpecCore Prompt/Apply 协作循环                               │
│                                                               │
│  Skill                    CLI                   宿主 AI       │
│    │                       │                       │          │
│    │ ① execute_command ──▶│                       │          │
│    │    --prompt           │ ② 读 Spec             │          │
│    │                       │ ③ 输出 Prompt ──────▶│          │
│    │    ◀── capture stdout │                       │          │
│    │                       │                       │ ④ 生成   │
│    │  ⑤ extract prompt ──────────────────────────▶│          │
│    │                       │      ◀── ⑥ 返回代码 ─│          │
│    │                       │                       │          │
│    │  ⑦ execute_command ──▶│                       │          │
│    │    --response         │ ⑧ 解析 JSON           │          │
│    │                       │ ⑨ 写入文件            │          │
│    │                       │ ⑩ 更新状态            │          │
│    │    ◀── ✅ done        │                       │          │
└──────────────────────────────────────────────────────────────┘
```

**步骤说明**（🔒 AI 命令，通过 Skill → CLI → AI 协作执行）：
1. Skill 调用 `speccore execute --prompt -t Task-001`
2. CLI 读取 Task 的 REQ.md、TECH.md、CONSTITUTION.md
3. CLI 构建结构化 Prompt，输出到 stdout（`[SPECCORE_PROMPT]...[/SPECCORE_PROMPT]`）
4. Skill 通过 `execute_command` 工具返回值捕获 stdout
5. Skill 提取 Prompt 内容，作为上下文传给宿主 AI
6. 宿主 AI 返回 JSON：`{"files": [{"path": "...", "content": "..."}]}`
7. Skill 调用 `speccore execute --response '{json}' -t Task-001`
8. CLI 解析 JSON，写入文件，更新 PROJECT_GRAPH 状态

### 12.3 Prompt 结构化格式

```
[SPECCORE_PROMPT]
# 任务: execute — Task-001

## 技术栈
- 语言: Java
- 框架: Spring Boot 3.x
- 数据库: MySQL 8.0

## API 接口定义
| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| POST | /api/auth/login | 登录 |

## 数据模型
### User (users)
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | bigint | 主键 |

## 业务规则和约束
- 接口: /api/v1/{模块}/{操作}
- 错误码: 4 位数字，按模块划分

## 输出格式要求
请返回格式: {"files": [{"path": "相对路径", "content": "代码内容"}]}

## 执行指令
请根据以上 Spec 生成代码。要求: ...
[/SPECCORE_PROMPT]
```

### 12.4 适用的命令列表

| 命令 🔒 | --prompt 做什么 | --response/--apply 做什么 |
| :--- | :--- | :--- |
| `execute` | 读 Spec → 输出代码生成 Prompt | 接收 AI 代码 → 写入文件 |
| `analyze` | 读需求 → 输出分析 Prompt | 接收 AI 分析 → 写入 ANALYSIS.md |
| `split` | 读分析结果 → 输出拆分 Prompt | 接收 AI 拆分 → 创建 Task 目录 |
| `plan` | 读 Task 列表 → 输出排程 Prompt | 接收 AI 计划 → 写入 plan.json |
| `doc2spec` | 读原始文档 → 输出验证 Prompt；`--classify` 模式：读 sources/ → 输出分类 Prompt（AI 理解意图 nature + 映射类型 type） | 接收 AI 修正 → 更新 MD；`--classify`：接收 JSON → 写入 staging/（带 frontmatter） |

---

## 13. 定时调度机制

### 13.1 自动化调度架构（v8.3.60+）

> ⚠️ `speccore schedule` 和 `speccore watch` 命令已在 v8.3.60 彻底移除。定时调度由 WorkBuddy Automations 替代，文件监听由宿主 IDE 原生支持替代。

```
┌──────────────────────────────────────────┐
│  Layer 1: WorkBuddy Automation (宿主)    │
│  cron-like 规则 → 定时触发 Skill          │
│  例: 每天 20:00 触发 spec-dev Skill       │
└──────────────┬───────────────────────────┘
               │ 触发
               ▼
┌──────────────────────────────────────────┐
│  Layer 2: spec-dev Skill                 │
│  检测当前阶段 → 拼命令 → 执行              │
└──────────────────────────────────────────┘
```

### 13.2 定时场景示例

```
场景: 每晚 8 点自动检查迭代进度并执行待办任务

1. 用户在 WorkBuddy 中创建自动化:
   - 名称: "夜间进度检查"
   - 时间: RRULE FREQ=DAILY BYHOUR=20
   - 提示词: "检查所有迭代进度，执行待办的开发任务"

2. WorkBuddy 到时间后触发 spec-dev Skill
3. spec-dev 读取 context.json → 发现阶段: execute
4. Skill 拼命令: speccore execute --all --force  🔒 AI 命令
5. CLI 走 Prompt/Apply 协作循环完成开发
```

### 13.3 历史说明

`schedule` 和 `watch` 命令在 v8.3.60 之前存在，用于：
- `schedule create` — 创建定时执行计划
- `schedule daemon` — 启动 Node.js 守护进程轮询触发
- `watch` — 监听文件变更自动执行 validate

由于守护进程模式在跨平台环境（尤其是 Windows）下存在稳定性问题，且与宿主 IDE 的文件监听功能重复，v8.3.60 彻底移除。遗留守护进程会在 `speccore update` 时自动检测并终止。

---

## 14. 与 OpenSpec 等行业工具的对比

### 14.1 相同的核心机制

SpecCore 的 Prompt/Apply 模式与以下工具的原理完全一致：

| 工具 | 确定性操作 | AI 生成 | 协作方式 |
| :--- | :--- | :--- | :--- |
| **OpenSpec** | CLI 读写文件、解析 Spec | AI 读 Spec 生成代码 | Tool Call → stdout → AI |
| **Claude Code** | 内置工具(Bash/Read/Write) | Claude 生成内容 | MCP/工具调用 |
| **Cursor Agent** | Terminal/File 操作 | GPT-4 生成代码 | agentic loop |
| **GitHub Copilot** | 文件读写、Git 操作 | 代码补全/生成 | inline suggestion |
| **SpecCore** | speccore CLI 确定性操作 | 宿主 AI(Qoder/Trae) | execute_command → stdout → AI |

### 14.2 关键差异 — SpecCore 的优势

| 维度 | OpenSpec/Claude Code | SpecCore |
| :--- | :--- | :--- |
| Prompt 构建 | AI 自己推断上下文 | CLI 程序化构建，100% 确定性 |
| Spec 规范 | 无强制格式 | CONSTITUTION.md 强制约束 |
| 跨迭代追踪 | 无 | GLOBAL 层 + PROJECT_GRAPH |
| 版本管理 | 无 | 基线 + 变更历史 |
| 质量验证 | 依赖 AI | 内置 doc-validator 6 维检测 |
| 多平台适配 | 单一工具 | Claude/Cursor/Trae/Windsurf/Qoder |
| 命令防绕过 | LLM 可能忽略 | Skill 拼命令 + CLI 执行 = 100% 可靠 |

### 14.3 技术可行性

Prompt/Apply 模式依赖的唯一前提是：**宿主 AI 环境提供 `execute_command` 工具调用能力**。

Qoder、Trae、Claude Code、Cursor 均支持此能力。因此：
- ✅ 技术上无风险
- ✅ 不需要 CLI 内置 LLM/API Key
- ✅ 不依赖特定 IDE 的通信协议
- ✅ 标准化的 `stdout` 传递，跨所有工具通用

---

### 2026-08-15 analyze 按端生成专属文档 + split 智能拆分

#### 1. analyze --auto 双层文档架构（全局+各端分离）
- **位置**: `src/core/analyze-engine.ts` → `generateSpecsFromRequirements()`
- **设计哲学**: 迭代内全局文档放跨端通用内容，各端子目录放该端专属内容
- **全局文档**（放在 `020-specs/` 根目录）:
  - `REQUIREMENT.md` — 业务需求规格（功能模块、API、数据模型、业务规则）
  - `ANALYSIS.md` — 需求分析报告（完整性检查、架构影响、待确认清单）
  - `DEPS.md` — 依赖清单（公共依赖）
  - `RISK.md` — 风险评估（全局风险）
  - `MONITOR.md` — 监控指标（全局监控方案）
  - `REVIEW.md` — 评审清单（全局评审项）
- **各端专属文档**（放在 `020-specs/{端}/` 子目录）:
  - `TECH.md` — 该端技术方案（后端是接口设计+数据模型，前端是页面路由+组件+状态管理）
  - `TEST.md` — 该端测试计划（后端是接口测试，前端是页面流转+交互测试）
  - `UI_SPEC.md` — 该端 UI 规格（仅前端，包含路由表+组件清单+字段映射）
- **新增构建函数**:
  - `buildTechSpecForPlatform()` — 按端生成技术方案
  - `buildTestSpecForPlatform()` — 按端生成测试计划
  - `buildUISpecForPlatform()` — 按端生成 UI 规格
  - `isBackendPlatform()` — 判断是否为后端平台（backend/后台/服务）

#### 2. REQUIREMENT.md 功能涉及端标注
- **位置**: `src/core/analyze-engine.ts` → `buildRequirementSpec()`
- **功能模块清单新增「涉及端」列**: `| # | 功能模块 | 描述 | 涉及端 |`
- **默认值**: `_待 AI 标注_`，供后续 AI 或人工补充
- **用途**: split 命令据此推断任务涉及的端，只生成对应端的子任务

#### 3. analyze --prompt 目录结构指导
- **位置**: `src/commands/analyze.ts` line 1076+
- **Prompt 第 5 步新增指令**:
  ```
  5. **目录结构**：必须按端创建子目录，不要全部扁平放在 020-specs/ 根目录
     - 从 CONSTITUTION.md 的「对应需求端」列读取端列表
     - 在 020-specs/ 下创建 {端名}/ 子目录
     - 每个端目录下写入该端专属的分析文档
     - 根目录只放跨端通用文档
  ```
- **效果**: `--prompt` 和 `--auto` 两种模式都会按端分目录，保持一致性

#### 4. split 端推断逻辑重构
- **位置**: `src/commands/iteration/split.ts` → `createTaskFromSection()`
- **三级推断优先级**:
  1. **优先使用 AI 标注的 `_scopePlatforms`**（AI 在 JSON 里标注该功能涉及哪些端）
  2. **否则从 `020-specs/{端}/TECH.md` 是否有实质内容推断**:
     - 文件存在且移除模板占位符后长度 > 50 字符 → 认为涉及该端
     - 模板占位符包括：`_待填充_`、`_待补充_`、`_待 AI 分析_`、`_待定_`、`_待导入_`
  3. **都没检测到时回退到所有端**（兼容旧行为）
- **核心原则**: 一个功能涉及哪些端由 AI 智能分析决定，不是固定写死

#### 5. split 读取各端子目录文档
- **位置**: `src/commands/iteration/split.ts` → `loadSpecContents()`
- **重构为双层读取**:
  - **第一层**: 读取根目录全局文档（TECH.md、TEST.md、RISK.md、DEPS.md、MONITOR.md、ANALYSIS.md、REQUIREMENT.md、UI_SPEC.md）
  - **第二层**: 读取各端子目录文档（`{端}/TECH.md`、`{端}/TEST.md`、`{端}/UI_SPEC.md`）
  - **key 命名规则**: 用平台前缀区分，如 `admin/TECH.md` → key 为 `'admin/TECH.md'`
- **提取函数优化**:
  - `extractTaskTechContent()` 优先读取对应端的 TECH.md（如 `admin/TECH.md`）
  - 回退到根目录 TECH.md（兼容旧结构或全局文档）
  - `extractFrontendContent()` 作为最终回退（从全局 TECH.md 中按关键词提取）

#### 6. 路径适配策略（新路径优先 + 旧路径回退）
- **位置**: `split.ts`、`prompt-builder.ts`、`knowledge-graph.ts`
- **路径规则**:
  1. **优先读取新路径**: `020-specs/{端名}/` (如 `020-specs/admin/`)
  2. **若不存在则回退到旧路径**: `020-specs/platforms/{端名}/` (如 `020-specs/platforms/admin/`)
- **设计原则**:
  - 向后兼容：已有项目使用旧路径不会受影响
  - 渐进迁移：新项目自动使用新路径，旧项目逐步过渡
  - 容错机制：避免单点故障导致整个分析流程失败
- **数据流**:
  ```
  analyze --prompt → 写入 020-specs/{端}/
                  ↓
  split/prompt-builder/knowledge-graph → 优先读 {端}/，失败则读 platforms/{端}/
                  ↓
  任务执行 → 读取端级分析内容
  ```

#### 7. 完整数据流示例
```
用户: speccore analyze --auto -I meeting-upgrade
  ↓
analyze 阶段:
  ├── 读取 010-requirements/ 下的需求文档
  ├── 生成全局文档 → 020-specs/REQUIREMENT.md（含「涉及端」列）
  ├── 生成各端专属文档 → 020-specs/admin/TECH.md、020-specs/h5/TECH.md 等
  └── 功能模块清单标注「涉及端」（默认 _待 AI 标注_）
  ↓
用户: speccore iteration split -I meeting-upgrade
  ↓
split 阶段:
  ├── 读取 020-specs/ 下的文档（根目录 + 各端子目录）
  ├── 对每个功能模块:
  │   ├── 优先使用 AI 标注的 _scopePlatforms
  │   ├── 否则检查 020-specs/{端}/TECH.md 是否有实质内容
  │   └── 确定该功能涉及的端列表
  ├── 为每个功能创建一个 Task-NNN-slug
  └── 在该 Task 下按端拆分子任务（默认一个端一个子任务）
  ↓
任务目录结构:
  030-tasks/feature/Task-001-meeting-create/
  ├── .meta/
  ├── _shared/
  │   ├── API_CONTRACT.yaml
  │   └── CONTEXT.md
  ├── 00-specs/
  │   ├── REQ.md          ← 从 020-specs/REQUIREMENT.md 切出该功能的片段
  │   ├── TECH.md         ← 从 020-specs/{端}/TECH.md 提取该端内容
  │   └── TASK.md
  ├── {platform}/              ← 所有端平铺（v6.49.1+）
  │   └── {taskId}-{subtask}/  ← 子任务
  └── .issues.md
```

---



## 15. 强制分析保护

### 15.1 核心规则

任务必须先分析才能执行，且分析文件必须有实质内容。空文件/TODO 占位符视为无效。

**有效性校验**:
- ANALYSIS.md > 200 字符
- 包含 API 定义、数据模型、业务规则、风险/架构等实质内容
- 不是纯 TODO/TBD 占位符

```
if ANALYSIS.md 不存在 → exitCode 11 → 必须 analyze
if ANALYSIS.md 无效(<200字/仅TODO) → exitCode 11 → 必须重新 analyze
if ANALYSIS.md 有效 → 正常执行
```

依据: 没有有效 Spec，AI 就没有生成代码的依据。Code by Spec, Not by Vibe。

```
创建任务 → 分析 (analyze --prompt) → 计划 (plan --prompt) → 执行 (execute --prompt)
     ↓
  只建不推 → 推荐后续步骤
```
> 🔒 以上均为 AI 命令，通过 Prompt/Apply 模式由 AI IDE 执行

### 15.2 execute 前置检查 🔒 AI 命令

```
execute --prompt 执行前:
  → 检查 ANALYSIS.md 或 REQUIREMENT.md 是否存在
  → 不存在 → exitCode 11 + 提示 "请先执行: speccore analyze --prompt"（🔒 AI 命令）
  → 存在 → 正常生成 Prompt
```

### 15.3 Pipeline 展示规则

- `task new` 开头的工作流 → 只展示第 1 步为"立即执行"，其余为"建议后续"
- 其他工作流 → 完整展示所有步骤

---

### 2026-08-09 设计决策汇总

#### 1. AI命令 vs CLI命令的严格分离
- CLI 命令（用户终端直接输入）: init, iteration create/list, task new/list, context, dashboard, welcome, validate, archive, config
- AI 命令（需通过 @spec-ask 路由，不能直接CLI输入）: analyze, plan, execute, split, doc2spec, spec2doc, retro, change, pr, done, dev
- 所有用户文档中 AI 命令统一用 `@spec-ask "..."` 格式，CLI 命令用 `speccore xxx`
- 各级 AGENTS.md 和 SKILL.md 中的命令表必须标注类型列（CLI/🔒 AI）

#### 2. 多文档协议（7 种 Spec 文档 × 10 种任务类型）
- iteration 范围: feature 类型 → 7 个全量文档（ANALYSIS/TECH/TEST/REVIEW/RISK/DEPS/MONITOR）
- task 范围: 按任务类型矩阵动态生成
  - feature: 7 篇
  - refactor: 5 篇 (ANALYSIS+TECH+TEST+REVIEW+RISK)
  - bugfix: 3 篇 (ANALYSIS+TECH+TEST)
  - research/review/test/docs/deploy/security/performance 各有不同组合
- --prompt 输出多文档模板，--apply 接受 JSON `{"FILENAME.md":"content"}` 一次性写入
- 实现位置: analyze.ts → buildMultiDocPrompt + DOC_MATRIX

#### 3. 自动模式分级
- 手动模式（默认）: 每步确认
- 部分自动: 用户指定"analyze+plan 自动，execute 前确认" → 前N步连续跑
- 全自动: "全自动执行" → 全部不等确认
- 触发词: "手动/默认" | "auto:step1-2" | "全自动/一键完成"

#### 4. 命名规则（--topic 强制）
- 迭代创建: `speccore iteration create -n Q1 --topic meeting-system`
- 任务创建: `speccore task new -n "用户登录" --topic user-login -i meeting-system`
- 计划文件: `PLAN-{timestamp}-{topic}.md`
- getIterationDir 同时接受短名（meeting-system）和完整名（Iteration-001-meeting-system）

#### 5. 升级检测修复
- init --update 写入 version.json 和 last-init-version.txt 两个文件
- checkUpgradeHints 读取 last-init-version.txt 判断是否需要升级提示
- 修复两个文件不同步导致的误报

#### 6. 文档双语结构
- docs/ 目录同时维护 .md（中文）和 .en.md（英文）文件
- README.md 文档表三栏: 中文 | English | 说明
- 所有文档内部链接使用实际文件名（英文），不出现中文文件名 404

---

### 2026-08-12 ask 引擎三层增强 + HTML 弹出修复

#### 1. 同义词表（SYNONYM_MAP）
- **位置**: `src/core/ask-engine.ts`
- **作用**: 扩展 KB 匹配覆盖面，纯数据不改架构
- **匹配顺序**: 命令名精确匹配 → **同义词表** → 触发词（同义词表优先，避免“改名”被“改”触发词截胡）
- **覆盖**: 50+ 口语化表达 → 20 个命令，包括看板/dashboard、提交代码/pr、改名/rename 等
- **效果**: 用户说“看板”“新手”“提交代码”等口语化表达均可直接匹配到对应命令

#### 2. 端配额（Endpoint Quota）
- **位置**: `src/core/code-scanner.ts` → `findRelevantCode`
- **作用**: 每个 endpoint 最多占 limit 的 40%，保证多端多样性
- **算法**: 按端分组 → 组内排序 → 轮询取结果（每端每轮取一个）
- **效果**: 避免单端文件垄断结果，前后端/移动端均有代表

#### 3. API 契约关联查询
- **位置**: `src/core/code-scanner.ts` → `loadContractApiPaths`
- **作用**: 加载项目中的 API_CONTRACT.yaml，命中契约路径的文件加分
- **搜索范围**: `.speccore/**/API_CONTRACT.yaml` + `Iteration-*/**/API_CONTRACT.yaml`
- **加分规则**: API 路径匹配 +15，关键词命中契约描述 +3
- **效果**: 需求提到某个 API 时，实现该 API 的文件排名提升

#### 4. HTML 弹出标记统一
- **问题**: welcome/help/dev 只输出 `file://` 路径，AI 宿主无法识别并用 present_files 展示
- **修复**: 三个命令均新增 `[SPECCORE_WELCOME/HELP/DEV: path]` 标记
- **welcome TTY 分支**: 3 个退出路径（未初始化/无迭代/正常）均输出标记，确保每次执行都弹出
- **AGENTS.md 更新**: 标记表新增 4 行（WELCOME/HELP/DEV/ABOUT）

#### 5. 置信度计算修复
- **问题**: KB 匹配成功但意图识别为空时，置信度默认 55，被路由到宿主 AI；同义词匹配时 `recognizeIntent` 只给 32%，拖低整体置信度
- **修复**: KB 匹配成功给予 **75** 基础分（高分区），用 `Math.max()` 确保同义词匹配的置信度不被低分拖塾
- **效果**: 同义词匹配本地直接执行，不触发宿主 AI 调用，消除 15 秒超时

---

### 2026-08-14 知识图谱深度集成 + 系统加固

#### 1. Ask 引擎知识图谱增强层
- **位置**: `src/core/ask-engine.ts`
- **架构**: 在本地引擎结果之后、计算置信度之前，插入 `enrichWithKG()` 调用
- **功能**:
  - `tryMatchEntityFromKG()`: 加载 `knowledge-graph.json`，优先精确匹配实体 ID（`Task-xxx`/`REQ-xxx`），其次对 title 做关键词相似度匹配（≥0.6 命中）
  - `enrichWithKG()`: 当命令需要 task 参数且缺失时，调用 KG 匹配并注入 `--task <id>` 到 `autoExec.args`
  - `commandNeedsTask()`: 白名单判断哪些命令需要 task 参数（execute/analyze/validate/verify/trace 等）
- **效果**: 解决知识图谱"建而不用"的核心架构断层，用户说"执行登录任务"时自动推断出 Task-001

#### 2. 宿主 AI 协议非TTY优化
- **位置**: `src/core/ask-host-ai.ts`
- **问题**: AI Agent 调用 `speccore ask` 时，`tryHostAi()` 输出上下文后阻塞 15 秒等待文件协议响应，但 AI Agent 不会写那个文件
- **修复**: 非 TTY 模式下输出 `[SPECCORE_AI_CONTEXT]` 标记后直接返回 `null`，不再阻塞
- **效果**: AI Agent 可直接从 stdout 提取上下文并接管，消除 15 秒无效等待

#### 3. 意图缓存归一化（v1.1）
- **位置**: `src/core/intent-cache.ts`
- **新增字段**: `CachedIntent.normalizedInput: string`
- **归一化算法**: `normalizeInput()` 去停用词 → 排序 → 取前 6 个词用 `|` 拼接
- **匹配层级**: 精确匹配 → 归一化语义匹配 → 模糊匹配（编辑距离≤2）
- **效果**: `"分析登录需求"` 和 `"分析下登录的需求"` 共享同一缓存条目

#### 4. 知识图谱实体 ID 去重
- **位置**: `src/core/knowledge-graph.ts` → `buildKnowledgeGraph()`
- **问题**: 不同文件可能生成相同 ID（如两个目录下的 `REQ-001`），后写入覆盖前者
- **修复**: 用 `idRemap` Map 检测冲突，冲突时生成 `${e.id}@${e.file.replace(/\//g, '-')}` 唯一 ID，并同步重写所有关系的 from/to

#### 5. 关系推断扩展
- **位置**: `src/core/knowledge-graph.ts` → `inferRelations()`
- **新增推断**:
  - 任务目录下 `_shared/REQ.md` → 建立 `implements` 关系到对应需求
  - 规格文件中 `SPEC:xxx` 引用 → 建立 `references` 关系
  - `API_CONTRACT.yaml` 存在 → 建立 `depends_on` 关系到任务

#### 6. 衰减检测变更程度分级
- **位置**: `src/core/decay-detector.ts`
- **severity 扩展**: `'warning' | 'critical'` → `'info' | 'warning' | 'critical'`
- **分级逻辑**: 按文件大小变化比例判断
  - `sizeChangeRatio > 0.5` → major → critical
  - `sizeChangeRatio > 0.1` → moderate → warning
  - 其他 → minor → info
- **效果**: typo 修复、注释修改不再误报 downstream_stale，只有实质性变更才触发级联警告

#### 7. 代码索引 ↔ 知识图谱打通（v6.8.0 已完成）

**架构升级：统一检索层（Unified Retrieval Layer）**

```
┌─────────────────────────────────────────────────────────────────────┐
│                     统一检索层 (unified-retrieval.ts)                  │
│                                                                      │
│   用户查询 ──▶ unifiedSearch(query)                                  │
│                │                                                     │
│    ├──────────┼──────────┬─────────────────┐                        │
│    ▼          ▼          ▼                 ▼                        │
│  文档 RAG   代码切片    知识图谱          组装                        │
│  rag-engine sliceCodeFile knowledge-graph  assemble                   │
│    │          │          │                 │                        │
│    ▼          ▼          ▼                 ▼                        │
│  Top-5      Top-5       关联实体链      统一上下文                    │
│  chunks     slices      + 关系图        (60%+20%+20%)               │
│                                                                      │
│  assembleUnifiedContext() ──▶ 注入 Prompt                            │
│  🔍 统一检索: 3 文档块 + 5 代码切片 + 2 实体 | ~4200 tokens          │
└─────────────────────────────────────────────────────────────────────┘
```

**已实现的能力：**

| 设计目标 | 实现方式 | 版本 |
|---------|---------|------|
| 代码索引 ↔ 知识图谱打通 | `findRelevantCode()` 加载知识图谱关联文件 + `@spec` 注释扫描 + Git 联动 | v6.8.0 |
| 关键词语义扩展 | `expandKeywords()` 中英双语映射 + 停用词过滤 | v6.8.0 |
| 代码新鲜度检查 | execute 前对比 `code-structure.json` 与源码 mtime | v6.8.0 |
| 需求分析默认关联代码 | `analyzeRequirements` 默认调用 `findRelevantCode` | v6.8.0 |
| 函数级代码索引 | `sliceCodeFile()` 按 `export function/class/interface` 切分 | v6.8.0 |
| 文档 RAG 检索 | `rag-engine.ts` 按标题分块 + 摘要提取 + 关键词标签 | v6.8.0 |
| 增量刷新 | `checkRagIndexFreshness()` mtime 检测 + 只重建变更文件 | v6.8.0 |
| 统一检索层 | `unified-retrieval.ts` 一次查询三源合并 | v6.8.0 |
| 全局知识沉淀 | `global-knowledge.ts` sync-global 后自动聚合 specs | v6.8.0 |
| 手动刷新命令 | `speccore rag-index` / `speccore refresh` | v6.8.0 |

---

### 2026-08-14 统一检索层 + RAG 检索 + 全局知识沉淀

#### 1. 统一检索层架构
- **位置**: `src/core/unified-retrieval.ts`
- **三层协作**:
  1. **文档 RAG** (`rag-engine.ts`): 按 Markdown 标题分块 → 提取结构化摘要 → 关键词标签 → 相关性评分检索
  2. **代码切片** (`sliceCodeFile()`): 按 `export function/class/interface/type/enum/const` 正则切分，每片含 JSDoc + 签名 + 前 50 行实现
  3. **知识图谱** (`knowledge-graph.ts`): 实体匹配 + 关系链推断
- **组装策略**: 文档占 60% + 代码 20% + 图谱 20%，统一输出为 Prompt 注入格式
- **日志**: `🔍 统一检索: 3 文档块 + 5 代码切片 + 2 实体 | ~4200 tokens`

#### 2. RAG 轻量级检索（无向量数据库）
- **分块策略**: 按 `##`/`###`/`####` 标题分块，不是硬截断
- **摘要提取**: 表格 → 表头+前3行 / 列表 → 前5项 / 段落 → 前2句 / 代码 → 函数签名
- **关键词标签**: 中文 2-4 字词 + 英文标识符 + CamelCase 拆分 + 语义扩展
- **相关性评分**: 标题匹配 +3 分/词，摘要 +2 分，关键词 +2.5 分，内容 +1 分
- **索引生命周期**: analyze 阶段生成 → buildPrompt 阶段消费 → `.speccore/cache/rag-index*.json`
- **Scope 隔离**: task `rag-index.json` / iteration `rag-index-{name}.json` / global `rag-index-global.json`

#### 3. 增量刷新机制
- **检测**: 对比源文件 mtime 与索引缓存中记录的 mtime
- **重建**: 只重建有变更的文件 chunk，未变更的保留
- **新增文件**: `scanForNewFiles()` 递归扫描目录，检测索引中不存在的 .md 文件
- **触发点**: analyze 阶段自动检测、手动 `speccore rag-index --refresh`、统一 `speccore refresh`

#### 4. 代码切片（函数级索引）
- **切分规则**: `export (async )?(function|class|interface|type|enum|const)` 正则匹配
- **每片内容**: JSDoc 注释（保留缩进）+ 完整签名 + 前 50 行实现
- **相关性评分**: 名称命中 +5 分，路径/签名/注释匹配 +1 分
- **与代码索引的关系**: `code-scanner.ts` 负责"找哪些文件"，代码切片负责"文件中哪段代码最相关"

#### 5. 全局知识沉淀
- **位置**: `src/core/global-knowledge.ts`
- **触发**: `sync-global to_global` 完成后自动调用
- **流程**: 扫描迭代所有 specs → 建全局 RAG 索引 → 生成 `GLOBAL/SUMMARY.md` → 刷新知识图谱
- **设计哲学**: 不追求完美文档，追求"能检索到"。支持手动编辑，下次 sync-global 覆盖更新
- **SUMMARY.md 内容**: 功能清单 + 技术要点 + API 概览 + 已知问题

#### 6. 新 CLI 命令
- `speccore rag-index` — 显示所有索引文件状态（task/iteration/global）
- `speccore rag-index --refresh --task Task-001` — 增量刷新
- `speccore rag-index --full --task Task-001` — 全量重建
- `speccore refresh` — 一键刷新所有检索层（代码索引 + 文档 RAG + 知识图谱）
- `speccore refresh --code` / `--rag` / `--graph` — 分别刷新

#### 7. Prompt 构建性能优化
- **REQ.md 统一读取**: `loadReqContent()` 一次读取，三个函数共用缓存（减少 2 次 I/O）
- **进程级文件缓存**: `cachedRead()` 按 mtime 缓存，文件未变时直接返回内存对象
- **ExtraSpecs 大小限制**: 单文件 2000 chars / 总量 8000 chars，超限截断并标注
- **TOC + TechStack 缓存**: `techStackCache`/`tocCache`/`constitutionCache` 多次 buildPrompt 间共享
- **分析引擎去重读**: `AIContextInput.reqContents` 避免同一份文档被 readFile 两次
- **知识图谱进程缓存**: `kgCache` 避免每次 ask 都 JSON.parse 数万节点
- **动态 Prompt 裁剪**: `formatPrompt()` 12000 tokens 预算，超限时逐级简化

#### 8. 深度检查修复的 Bug
- **P0-1**: RAG 索引文件 scope 间互相覆盖 → 分文件存储（task/iteration/global 各独立）
- **P0-2**: `sliceCodeFile` JSDoc 提取不匹配空格前缀注释 → `trimStart().startsWith('*')`
- **P0-3**: `sliceCodeFile` 字符串转义判断 `indexOf` 只找第一个 → `for` 遍历逐字符判断
- **P1-4**: `checkRagIndexFreshness` 不检测新增文件 → 新增 `scanForNewFiles()`
- **P1-5**: `global-knowledge.ts` 动态导入冗余 → 静态导入
- **P1-6**: `refresh.ts` 重复调用 `checkRagIndexFreshness` → before/after 对比 `updatedAt`
- **编译错误**: `indexDirectoryDocuments` 未导入 → 添加静态导入

---

### 2026-08-14 智能文档分类摄入 + 多类型任务支持

#### 1. doc2spec --classify 两步分类 Prompt
- **位置**: `src/commands/doc2spec.ts`
- **设计**: AI 先理解文档实际意图（nature），再映射到任务类型（type）
- **nature 字段**: 文档实际意图的简短描述（如"安全漏洞"、"性能瓶颈"、"新功能需求"）
- **type 字段**: 映射后的任务类型（feature/bugfix/refactor/research）
- **映射规则**:

| nature（文档实际意图） | type（映射任务类型） | 示例 |
|:---|:---|:---|
| 新功能、功能需求、产品规格 | feature | "用户需要扫码登录" |
| 缺陷、故障、异常、安全问题 | bugfix | "登录超时"、"SQL注入漏洞" |
| 技术债、架构改进、性能优化 | refactor | "数据库连接池过小" |
| 调研、选型、方案对比 | research | "WebSocket vs SSE 对比" |
| 安全审计、渗透测试、合规检查 | bugfix | "XSS 漏洞报告" |
| 性能瓶颈、响应慢、资源浪费 | refactor | "首页加载超 3 秒" |

#### 2. staging/ 文件格式
```yaml
---
type: bugfix
nature: 安全漏洞
title: XSS 反射型漏洞修复
source: sources/
created: 2026-08-14
---
```
- staging/ 是临时目录，analyze 完成后可清理
- analyze 读取 frontmatter 中的 type 和 nature，写入 `020-specs/{type}/` 并在 header 标注 `> 意图: {nature}`

#### 3. nature 透传链路
```
doc2spec --classify --prompt → AI 输出 nature + type
doc2spec --classify --response → staging/{slug}.md（frontmatter 含 nature）
analyze → 020-specs/{type}/{slug}.md（header 含 `> 意图: {nature}`）
split → Task/_shared/CONTEXT.md（来源追溯）
```

#### 4. 非 pipeline 交互决策
- **问题**: classify 相关输入（"分类文档""classify sources"）是否触发 smart intake pipeline？
- **决策**: 不触发。classify 只是 doc2spec 的一个模式，用户逐步交互
- **实现**: `handleGuide` 中 classify 触发词返回 null（不匹配 pipeline），`matchWorkflow` 中也删除 classify 触发词
- **效果**: 用户说"帮我分类导入的文档" → 只匹配到 doc2spec 命令，mode=match，hasPipeline=false

#### 5. 多类型任务拆分规则
| 文档类型 | 拆分规则 | 说明 |
|:---|:---|:---|
| features/ | 按功能单元拆合（1~3 个任务） | 功能可拆分、可合并 |
| bugs/ | 1:1 映射（1 文件 = 1 bugfix 任务） | 每个 bug 独立修复 |
| refactors/ | 1:1 映射 | 每个重构项独立执行 |
| research/ | 1:1 映射 | 每个调研主题独立进行 |

#### 6. CONTEXT.md 来源追溯
- **位置**: `src/commands/iteration/split.ts` → `generateContextMd()`
- **内容**: 来源追溯表 + 原始描述摘要 + 关联任务 + 影响范围
- **来源路径**: 支持 `sourceFile` 字段（AI 提供）和回退规则（type + topic）
- **注入时机**: execute 时自动加载，AI 可追溯需求源头

---

## 8. 任务级深度分析 + 用户自定义模板 + 链式生成（v6.44.0-v6.46.0）

### 8.1 完整数据流

```
analyze (Phase 1 + 2) → 全局知识库（global/ + {端}/）
       ↓
split (聚合度分析) → Task 目录结构 + 底料（机械提取）
       ↓
analyze --task (深度分析 + 链式生成) → 00-specs/ 深度文档
       ↓
execute → 开发实现
```

**双层解耦**：分析结果写入 Task/00-specs/，不覆盖 020-specs/（迭代基线）。

### 8.2 任务级深度分析（v6.44.0+）

split 已在 00-specs/ 中生成了基础内容（机械提取），`analyze --task` AI Read 这些内容 + 全局上下文，重新生成任务级深度分析。

**任务级文档集（按任务类型区分）**：
| 任务类型 | 文档集 |
|:---|:---|
| feature | REQ.md, TECH.md, TASK.md, SCHEMA.md |
| refactor | REQ.md, TECH.md, TASK.md |
| bugfix | REQ.md, TECH.md |
| research | REQ.md |

**深度分析上下文**：
- Read Task/00-specs/ → 本任务的需求切片（split 产出）
- Read overview/REQUIREMENT.md + overview/TECH.md → 全局上下文
- Read {端}/TECH.md → 该端专属技术方案

### 8.3 用户自定义模板（v6.45.0+）

**目录约定**：`.speccore/templates/{global|iteration|task}/`

```
.speccore/templates/
├── global/              ← 全局分析模板
├── iteration/           ← 迭代级分析模板
│   └── {端}/            ← 端专属模板（用户自建，端名匹配 CONSTITUTION 端列表）
└── task/                ← 任务级分析模板
    ├── feature/         ← feature 类型
    │   └── {端}/        ← 类型 + 端组合（最高优先级）
    ├── _shared/         ← 所有任务类型共享
    └── {自定义}.md      ← 自定义文档
```

**查找优先级**：type/platform/ > type/ > _shared/ > 根目录自定义 > 内置模板

**核心规则**：
- 零配置：无需 manifest，纯目录约定
- 同名覆盖：用户模板替换内置模板作为参考
- 新名追加：用户自定义文档追加到文档集
- 没放用户模板 = 用内置默认

### 8.4 链式生成 + 图谱 RAG 智能检索（v6.45.0+）

文档按依赖顺序逐个生成，**不是无脑全读前序产出，而是通过知识图谱 + RAG 智能检索相关内容**：

```
REQ.md (无依赖，直接生成)
  ↓ refreshKnowledgeGraph()
TECH.md (图谱 RAG 检索 REQ 相关内容 → 基于需求做设计)
  ↓ refreshKnowledgeGraph()
SCHEMA.md (图谱 RAG 检索 REQ + TECH 相关内容 → 提取数据模型)
  ↓ refreshKnowledgeGraph()
TASK.md (图谱 RAG 检索前三者相关内容 → 制定实施步骤)
```

**智能检索机制**：
- `unifiedSearch()` 从 RAG 索引检索相关 chunk（topK=8, minScore=0.15, maxTotalChars=8000）
- `buildCompactContext()` 从知识图谱获取关联链（<500 tokens）
- 分层索引：task 级、iteration 级、global 级分开，按需加载
- 每步完成后 `refreshKnowledgeGraph()` 刷新图谱，确保后续检索基于最新数据

**混合模式**：有用户模板时参考其结构/风格，无用户模板时 AI 根据目标自行组织。

### 8.5 统一端发现（v6.46.0+）

**共享函数**：`parsePlatformList()` in `src/core/spec-paths.ts`

所有端发现统一调用此函数：
- `split.ts::detectPlatforms()` → 优先 `parsePlatformList()`
- `analyze-engine.ts::detectPlatformsFromConstitution()` → Layer 0 调用 `parsePlatformList()`
- `analyze.ts` prompt 文本 → 引用「## 端列表」章节

**解析兼容**：同时识别「对应端」和「对应需求端」两种列名，确保旧项目无缝升级。

### 8.6 CLI 控制目录 + AI 填内容（v6.49.13+）

**核心原则**：CLI 控制所有目录创建（确定性操作），AI 只负责内容生成（智能操作）。

#### analyze 命令
- CLI 执行前自动读 CONSTITUTION.md 端列表，预创建 `020-specs/overview/` + `020-specs/{端}/` 目录
- prompt 新增第 6 步：功能模块涉及端必填，AI 必须在 `overview/REQUIREMENT.md` 功能模块清单表填写「涉及端」列
- 关键函数：`preCreateSpecDirectories()` in `analyze.ts`

#### split 命令（v6.49.14+）
- `tryModuleDrivenSplit()` 优先从 `020-specs/overview/REQUIREMENT.md` 解析功能模块清单的「涉及端」列
- 新增 `parseModulePlatforms()` 函数：解析 Markdown 表格，提取每个模块的涉及端
- 每个模块只创建涉及的端目录（不是全端）
- 回退机制：REQUIREMENT.md 无表时回退到 `010-requirements/features/`（使用全端）
- 内容填充 Prompt 按模块显示各自的涉及端

#### 「涉及端」定义
- **涉及 = 该端在本模块中有新开发工作**（新接口/新页面/新逻辑）
- **不涉及 = 只是提到、调用已有接口、纯展示**
- 端名必须与 CONSTITUTION.md「端列表」中的标准端名完全匹配

#### 数据流
```
analyze AI → overview/REQUIREMENT.md 功能模块清单（含涉及端列）
    ↓ split CLI 读取
每个模块 → 只创建涉及的端目录
    ↓ AI 填充
每个端子任务的 REQ.md + TECH.md
    ↓ analyze --task 深度分析
子任务级深度文档
    ↓ execute
代码实现
```

#### 关键特性
- 人工修改 REQUIREMENT.md 后 split 能读到最新内容（运行时读文件）
- analyze --task 深度分析逻辑完全保留不受影响
- 子任务作为执行上下文：每个端的 REQ.md/TECH.md 只含本端内容，AI 不分心

### 8.7 图谱 RAG 跨层智能检索（核心机制）

**核心原则**：所有分析都不是基于单一文档，而是在知识图谱上智能检索相关内容综合分析。

#### 检索范围
- 不同层的文档（global/、{端}/、00-specs/）
- 代码切片（业务实现逻辑）
- 需求文档（原始 PRD）
- 知识图谱关联链（上游需求、依赖任务、关联子任务）

#### 关键节点图谱刷新
| 命令 | 刷新时机 | 函数 |
|:--|:--|:--|
| `analyze` | 分析完成后 | `refreshKnowledgeGraph()` |
| `split` | 拆分完成后 | `refreshKnowledgeGraph()` |
| `done` | 任务完成后 | `refreshKnowledgeGraph()` |
| `change` | 变更完成后 | `refreshKnowledgeGraph()` |

#### 检索流程
```
步骤 N 生成内容
    ↓ refreshKnowledgeGraph()
图谱更新 + RAG 索引更新
    ↓
步骤 N+1 开始分析
    ↓ unifiedSearch()
    → 从 RAG 索引检索相关 chunk（topK=8, minScore=0.15）
    → 从知识图谱获取关联链（<500 tokens）
    → 从代码索引检索相关代码切片
    → 按相关性排序，只注入 ~8000 字符最相关内容
    ↓
AI 综合分析，生成新内容
```

#### 分层索引
- **global 级**：`rag-index-global.json` — 全局文档索引
- **iteration 级**：`rag-index-{iteration}.json` — 迭代级文档索引
- **task 级**：`rag-index.json` — 任务级文档索引
- 按需加载：task 查询加载 task + iteration 级；iteration 查询加载 iteration + global 级

### 8.8 业务-代码关联图谱（v6.50.0+）

**核心能力**：知识图谱新增 `business_module` 实体类型，支持从 TECH.md 提取业务模块→代码实体的映射关系。

#### 设计原则
- **开放实体类型**：不预设固定类型，AI 根据技术栈自主决定（如 api_controller、page、component、route、middleware、interceptor、gateway 等）
- **按端隔离**：每端从自己的 TECH.md 提取，不会混
- **增量更新**：复用现有的 `refreshKnowledgeGraph()` 机制
- **灵活扩展**：关系类型是开放字符串，支持任意自定义类型

#### 期望的 TECH.md 格式
```markdown
## 业务-代码映射

| 业务模块 | 代码实体 | 关系类型 | 说明 |
|:--|:--|:--|:--|
| 会议室档案 | backend/RoomController.java | api_controller | REST 控制器 |
| 会议室档案 | table-meeting_room | uses_table | 主数据表 |
| 会议室档案 | admin-web/src/pages/RoomList.vue | page | 列表页 |
```

#### 数据流
```
analyze AI → TECH.md（含「业务-代码映射」表格）
    ↓ refreshKnowledgeGraph()
scanBusinessCodeMappings() 扫描 TECH.md
    ↓ 提取
business_module 实体 + code 实体 + 关系
    ↓ 写入图谱
knowledge-graph.json 自动包含业务-代码映射
    ↓ CONTEXT.md
展示业务-代码映射表（按端分组）
    ↓ unifiedSearch()
检索时自动包含业务模块相关信息
```

#### CONTEXT.md 端隔离（v6.50.2+）
- CONTEXT.md 中的「业务-代码映射」章节按当前端过滤，不再展示所有端的映射
- 避免浪费 token（如前端分析时读到后端的业务映射）
- 通过 `options.currentPlatform` 参数控制过滤

#### 关键代码位置
- `src/core/knowledge-graph.ts`: `scanBusinessCodeMappings()` 函数
- `src/commands/analyze.ts`: prompt 中「业务-代码映射」指导
- `src/core/context-builder.ts`: CONTEXT.md 中展示业务-代码映射表（按端过滤）

### 8.9 HTML 页面标记系统（present_files 协议）

**核心机制**：CLI 生成 HTML 页面后输出 `[SPECCORE_*: <path>]` 标记，AI 平台识别标记后调用 `present_files(<path>)` 展示页面。

#### 设计原则
- **CLI 只输出标记，不直接展示**：CLI 无法控制 AI 平台的 UI，只能通过标记通知
- **AI 平台通过标记触发**：不猜测文件路径，严格按标记执行
- **全量覆盖**：所有生成 HTML 的命令都必须输出对应标记

#### 标记清单（v6.51.0+，共 10 个）
| 标记 | 命令 | 触发时机 |
|:--|:--|:--|
| `[SPECCORE_ONBOARD: <path>]` | `ask` | 首次/升级引导页 |
| `[SPECCORE_SETUP_GUIDE: <path>]` | `init` | 项目配置引导页 |
| `[SPECCORE_ABOUT: <path>]` | `about` | 版本信息页 |
| `[SPECCORE_HELP: <path>]` | `help` | 帮助中心页 |
| `[SPECCORE_WELCOME: <path>]` | `welcome` | 项目名片页 |
| `[SPECCORE_DEV: <path>]` | `dev` | 流水线页 |
| `[SPECCORE_KNOWLEDGE: <path>]` | `knowledge` | 知识图谱页 |
| `[SPECCORE_PLAN: <path>]` | `plan` | 执行计划页 |
| `[SPECCORE_RETRO: <path>]` | `retro` | 回顾报告页 |
| `[SPECCORE_DASHBOARD: <path>]` | `dashboard` | 仪表盘页 |

#### 注册点（确保标记被处理）
- `.agents/skills/speccore-router/SKILL.md`：路由器 Skill，10 个标记全部注册
- `.agents/skills/spec-ask/SKILL.md`：ask Skill，同步注册
- 7 个平台 command 文件（`.claude/.codebuddy/.cursor/.qoder/.trae/.trae-cn/.windsurf/commands/spec-ask.md`）
- `init.ts` 模板：`init --update` 自动传播到已有项目

#### 数据流
```
CLI 命令执行 → 生成 HTML 到 outputs/
    ↓ process.stdout.write
输出 [SPECCORE_XXX: /path/to/page.html]
    ↓ AI 平台识别
present_files(<path>) → 用户在预览面板看到 HTML 页面
```

### 8.10 Phase 1/Phase 2 自动触发机制（v6.59.0-v6.64.0）

**核心问题**：analyze 命令采用分阶段分析架构（Phase 1 生成全局文档 → Phase 2 生成各端专属文档），但旧版需要用户手动执行两次命令，用户体验差。

#### 设计原则

**为什么必须分阶段？**
- **Phase 1**：生成全局文档（overview/REQUIREMENT.md、ANALYSIS.md、DEPS.md 等），建立跨端统一视角
- **Phase 2**：生成各端专属文档（{端}/TECH.md、TEST.md、UI_SPEC.md 等），参考全局上下文后注入端专属专业维度
  - 后端服务 → API 设计、数据库、缓存、消息队列
  - Web 管理端 → 页面路由、组件拆分、权限控制
  - H5/小程序 → 页面结构、平台 API 适配、性能约束

**为什么不合并为一次性生成？**
- Token 消耗过大（同时处理 10+ 个文档）
- 文档质量下降（AI 注意力分散）
- 无法充分利用链式生成优势（Read 前序产出再生成下一个）

#### 自动触发机制

**触发条件**：
```typescript
if (platforms.length >= 2) {
  // 多端项目：自动触发 Phase 2
} else if (platforms.length === 0) {
  // 无端列表：输出警告
}
// platforms.length === 1: 单端项目，Phase 1 已完成，无需 Phase 2
```

**工作流程**：
```bash
# 用户执行一次命令
speccore analyze --prompt -I meeting-upgrade

# CLI 输出 Phase 1 prompt → AI 生成全局文档 → AI 通过 --apply 写回
# CLI 检测到 Phase 1 完成 + 有多个端 → 自动输出 Phase 2 prompt
# AI 生成各端专属文档 → AI 通过 --apply 写回
# 完成！
```

**关键代码位置**：
- `src/commands/analyze.ts` lines 450-485：Apply 模式结尾的 Phase 2 自动触发逻辑
- `src/commands/analyze.ts` lines 1230-1260：Phase 2 prompt 构建（指导 AI Read Phase 1 产出并生成各端专属文档）

#### 图谱 & RAG 刷新保证

**每次分析前**：
- `buildMultiDocPrompt()` → 调用 `unifiedSearch()` 检索项目关联内容
  - 从 RAG 索引中检索相关 chunk（topK=8, minScore=0.15）
  - 从知识图谱中获取关联链（<500 tokens）
  - 注入到 prompt 中作为上下文

**每次分析后**：
- Apply 模式完成后 → 调用 `refreshKnowledgeGraph()`
  - 重建当前 iteration 的知识图谱
  - 更新 RAG 索引
  - 确保下一阶段能看到最新的分析结果

**Phase 1 → Phase 2 的上下文传递**：
1. Phase 1 完成后刷新图谱
2. Phase 2 的 prompt 中能检索到 Phase 1 的产出
3. AI Read 全局文档再生成各端专属文档

### 8.11 Pipeline 引擎架构设计（v6.67.0-v6.68.0）

**核心问题**：analyze 命令需要分两阶段执行（Phase 1 全局文档 → Phase 2 各端专属文档），但 CLI 无法在一次调用中连续执行两个阶段，因为 apply 命令和 prompt 命令是独立的 CLI 调用。

**历史尝试及失败原因**：
- **v6.61.0-v6.64.0**: CLI 在 apply 模式完成后自动输出 Phase 2 prompt → **失败**：AI 不读取新的 `[SPECCORE_PROMPT]`
- **v6.65.0**: CLI 输出提示信息到 stdout → **失败**：AI 看不到终端输出
- **v6.66.0**: prompt 结尾要求 AI 主动询问用户 → **效果不佳**：AI 可能忽略指令
- **v6.67.0**: prompt 开头明确完整工作流程 → **过渡方案**：依赖 AI 遵守指令

**最终方案（v6.68.0）**：完整的 Pipeline 引擎实现，采用状态机设计 + 自动推进机制。

#### Pipeline 引擎核心设计

**状态机架构**：
```typescript
class PipelineEngine {
  private state: PipelineState | null;
  private steps: Map<string, PipelineStepDef>;
  
  async init(firstStepId: string): Promise<void>;
  async advance(): Promise<{ nextStepId: string | null; isComplete: boolean }>;
  async isActive(): Promise<boolean>;
  async getState(): Promise<PipelineState | null>;
}

interface PipelineState {
  currentStep: string;
  steps: string[];
  completedSteps: string[];
  iteration: string;
  name: string;
  platforms?: string[];
}
```

**状态流转**（analyze 两阶段分析）：
```
init → phase1-prompt → (AI --apply) → phase1-done
  → 检测多端 → phase2-prompt → (AI --apply) → done
```

**关键代码位置**：
- `src/core/pipeline-engine.ts`: PipelineEngine 核心类（274 行）
- `src/commands/analyze.ts` lines 313-332: Pipeline 模式初始化（prompt 模式）
- `src/commands/analyze.ts` lines 471-508: Pipeline 自动推进（apply 模式）

#### 工作流程详解

**用户执行**：
```bash
speccore analyze --prompt --pipeline -I meeting-upgrade
```

**CLI 处理流程**：
1. **Prompt 模式初始化**（line 313-332）：
   - 检测 `--pipeline` 选项
   - 调用 `createAnalyzePipeline()` 创建 Pipeline 实例
   - 调用 `engine.init('phase1-prompt')` 初始化状态
   - 生成 Phase 1 prompt + Pipeline 继续指令
   - 输出 `[SPECCORE_PROMPT]` + prompt

2. **AI 生成全局文档**：
   - AI 读取 prompt，生成 overview/REQUIREMENT.md、ANALYSIS.md 等
   - 执行 `speccore analyze --apply '{...}' -I meeting-upgrade`

3. **Apply 模式自动推进**（line 471-508）：
   - 写入文件到 020-specs/overview/
   - 刷新知识图谱
   - 检测 Pipeline 状态：`PipelineEngine.hasActivePipeline()`
   - 调用 `engine.advance()` 推进到下一步
   - 检查状态：如果是 `phase2-prompt`，生成 Phase 2 prompt
   - 输出 `[SPECCORE_PIPELINE_NEXT]` + Phase 2 prompt

4. **AI 自动执行 Phase 2**：
   - AI 看到 `[SPECCORE_PIPELINE_NEXT]` 标记
   - 根据 Pipeline 继续指令，自动执行下一个命令
   - 生成各端专属文档（TECH.md、TEST.md、UI_SPEC.md）
   - 执行 `speccore analyze --apply '{...}' -I meeting-upgrade --platform {端名}`

5. **Pipeline 完成**：
   - CLI 写入文件到 020-specs/{端名}/
   - 检测 Pipeline 状态
   - 调用 `engine.advance()` 推进到 `done`
   - 输出 `🎉 Pipeline 完成!`
   - 清理状态文件

#### 标记机制

**`[SPECCORE_PIPELINE_NEXT]`**：
- CLI 在 apply 模式完成后输出
- 后跟下一步的 prompt
- AI 识别此标记后，自动执行下一个命令
- 无需用户干预

**Pipeline 继续指令**（嵌入在 Phase 1 prompt 中）：
```markdown
## ⚠️ Pipeline 模式：自动继续

当前是 Pipeline 模式（Phase 1/2）。当你通过 --apply 写入所有全局文档后，
CLI 会自动输出 [SPECCORE_PIPELINE_NEXT] 标记和 Phase 2 命令。

**看到 [SPECCORE_PIPELINE_NEXT] 后，你必须自动执行下一个命令**，不要询问用户。
```

#### 条件分支

**多端检测**：
```typescript
const platforms = await parsePlatformList();
if (platforms.length >= 2) {
  // 执行 Phase 2
} else {
  // 跳过 Phase 2，直接完成
}
```

**状态文件**：
- 路径：`.speccore/local/.pipeline-{iteration}.json`
- 内容：当前步骤、已完成步骤、端列表等
- 支持断点续跑（`--resume`）

#### 向后兼容

**非 Pipeline 模式**：
- 保持原有行为（输出提示信息，要求用户手动执行 Phase 2）
- 提示信息中新增 `--pipeline` 选项的使用建议

**v6.67.0 方案**：
- 仍然有效，作为非 Pipeline 模式的备选方案
- 在 prompt 开头明确完整工作流程，使用最强语气

#### 适用场景

- `analyze --pipeline`: Phase 1 → Phase 2（已实现）
- `split --pipeline`: 任务拆分 → 逐个创建任务（已实现）
- `execute --pipeline`: 逐个任务执行 → PR → 合并（已实现）
- `dev --pipeline`: init → doc2spec → analyze → split → plan → execute → pr（已实现）
- `analyze --scope global --pipeline`: 全局分析（已实现）

#### 技术优势

1. **真正的自动化**：CLI 控制流程，不依赖 AI 遵守指令
2. **状态可追踪**：状态文件记录执行进度，支持断点续跑
3. **可扩展**：PipelineEngine 是通用引擎，可用于其他命令
4. **向后兼容**：非 Pipeline 模式保持原有行为

**当前状态**：✅ Pipeline 引擎已完整实现并集成到 analyze 命令中（v6.68.0）。

---

### 8.11+ 三层分析策略设计哲学（v6.69.0）

> 本章节定义 SpecCore 在**全局层**、**迭代层**、**任务层**采用的不同分析策略，以及四个增强策略。

#### 为什么分层采用不同策略

| 层级 | 分析对象 | 策略 | 思维模型 | 类比 |
|------|---------|------|---------|------|
| **全局层** | 已有代码库 | **先分后总**（归纳法） | 从事实提炼规律 | 侦探破案：先收集各端证据，再拼出全貌 |
| **迭代层** | 需求文档（PRD） | **先总后分**（演绎法） | 从目标分解执行 | 建筑师设计：先画总蓝图，再出各施工图纸 |
| **任务层** | 单个开发任务 | **向上追溯**（聚焦法） | 从当下追溯根源 | 医生问诊：先看病灶，再查病史 |

三种不同的思维模型对应三种不同的分析策略，这是 SpecCore 规范驱动开发的精髓所在。

#### 全局层 — 先分后总（归纳法）

```
各端源码事实 → 跨端关系 → 全局架构
(backend代码)   (API调用)    (ARCHITECTURE.md)
(frontend代码)  (数据流向)   (TECH_FULL.md)
(admin代码)     (共享模型)   (INDEX.md)
```

- 全局分析的对象是**已有代码**（归纳性质）
- 不先扫描各端，就不知道整体架构长什么样
- 所以必须先分后总
- **代码实现**：`synthesize --full` Phase 1→2→3 已完整实现

#### 迭代层 — 先总后分（演绎法）

```
整体需求 → 业务分析 → 各端技术方案
(PRD文档)   (ANALYSIS.md)  (backend/TECH.md)
            (global/)      (h5/UI_SPEC.md)
                           (admin/TECH.md)
```

- 迭代分析的对象是**需求文档**（演绎性质）
- PRD 本身描述的是整体业务，天然是"总"
- 分析完总体后，再拆给各端做技术实现方案
- 所以必须先总后分
- **代码实现**：`analyze --pipeline` Phase 1→2 已实现

#### 任务层 — 向上追溯（聚焦法）

```
任务自身规格 ← 迭代级上下文 ← 全局级上下文
Task-001/     020-specs/      .speccore/
REQ.md        DESIGN.md       CONSTITUTION.md
TECH.md       global/         GLOBAL/
API_CONTRACT   platforms/
```

- 任务执行时需要**精确上下文**，不是越多越好
- 从自身出发向上追溯，按需加载：
  - 必须：自己的 REQ/TECH/API_CONTRACT
  - 需要时：迭代级 DESIGN.md、各端 SPEC.md
  - 必要时：全局级 CONSTITUTION、GLOBAL INDEX
- 避免了一次性加载全部迭代文档导致的上下文溢出
- **代码实现**：`execute` 的 `loadExtraSpecs()` 已实现分层加载

#### 四个增强策略

在三层基础策略之上，引入四个增强策略解决实际工程痛点：

**增强策略一：迭代层引入「契约先行」**

在"总需求"和"各端方案"之间插入契约定义阶段：

```
需求总纲 → 关键路径识别 → 跨端契约定义(API_CONTRACT) → 各端并行技术方案
```

- 契约确定后，**各端分析可以并行进行**
- 契约作为"中间件"，隔离各端分析的细节依赖
- 执行阶段直接复用契约文件，不再重复推理接口

**增强策略二：全局层引入「变更感知」**

全局层改为增量/差量分析：

```
Git diff 识别变更范围 → 仅分析受影响端 → 跨端影响评估 → 更新全局索引
```

- 避免重复分析未变更的端，大幅节省时间
- 跨端影响评估能发现"改 A 端导致 B 端契约失效"的隐性风险
- 全局索引始终保持最新，但不需要全量重建

**增强策略三：迭代层引入「关键路径优先」**

在"总需求分析"后增加关键路径识别，然后按优先级分阶段分析：

```
需求总纲 → 关键路径识别(核心业务流程) → 深度分析核心路径 → 简化分析边缘功能 → 各端方案
```

- 确保 AI **最大的上下文容量用在最重要的功能上**
- 核心功能（如支付流程、用户认证）得到充分分析
- 边缘功能（如帮助页面、关于我们）可以走简化模板

**增强策略四：任务层引入「横向关联」**

任务执行前增加横向依赖检查：

```
自身规格加载 → 横向检查(依赖任务是否已完成？契约是否对齐？) → 迭代上下文 → 全局规则 → 执行
```

- 避免执行时才发现依赖任务的接口还没定义
- 自动检测"契约漂移"（依赖任务的实现和契约不一致）
- 为分支合并策略提供依据（知道需要 merge 哪些前置分支）

#### 综合最优策略框架

| 层级 | 核心策略 | 增强策略 | 思维模型 |
|------|---------|---------|---------|
| **全局层** | 先分后总 | + **变更感知**（差量分析） | 归纳 + 增量 |
| **迭代层** | 先总后分 | + **契约先行**（并行分析）<br>+ **关键路径优先**（资源聚焦） | 演绎 + 解耦 |
| **任务层** | 向上追溯 | + **横向关联**（依赖检查） | 聚焦 + 验证 |

#### 代码实现状态（v6.69.0+）

| 层级 | 设计思路 | 代码实现 | 状态 |
|------|---------|---------|------|
| **全局层** | 先分后总 | `synthesize --full` Phase 1→2→3；`analyze --scope global --pipeline` 接入 `createGlobalAnalyzePipeline` | ✅ 已完成 |
| **迭代层** | 先总后分 | `analyze --pipeline` Phase 1→契约先行→逐端推进（每端独立步骤） | ✅ 已完成 |
| **任务层** | 向上追溯 | `execute` 的 `loadExtraSpecs()` 分层加载；`checkCrossTaskDependencies()` 横向依赖检查 | ✅ 已完成 |

**增强策略实现状态**：

| 增强策略 | 代码实现 | 状态 |
|---------|---------|------|
| **契约先行**（迭代层） | `createAnalyzePipeline` 插入 `contract-prompt` 步骤；`buildContractFirstPrompt()` 生成跨端契约 | ✅ 已完成 |
| **变更感知**（全局层） | `detectAffectedPlatforms()` 通过 Git diff + CONSTITUTION.md 源码路径映射检测受影响端；**v6.69.1** 修正对比基准为默认分支；新增快照持久化支持增量分析 | ✅ 已完成 |
| **关键路径优先**（迭代层） | `detectPlatformPriorityOrder()` 按任务优先级统计排序端；Pipeline 按优先级生成步骤 | ✅ 已完成 |
| **横向关联**（任务层） | `checkCrossTaskDependencies()` 检查依赖任务状态和契约对齐；`traceDependencyChain()` 追踪完整依赖链路 | ✅ 已完成 |
| **知识图谱链路补全** | `inferRelations()` 从 IMPACT.md 补充 `depends_on`；`getFullTaskContext()` 包含上下游任务和依赖链路 | ✅ 已完成 |

#### 技术架构详解

**变更感知模块（`src/core/change-detection.ts`）**

```
对比基准：CONSTITUTION.md「默认分支」（如 main）← v6.69.1 修正，原为 HEAD
        ↓
git diff --name-only <defaultBranch> → 变更文件列表
        ↓
CONSTITUTION.md「项目信息」表格 → 源码路径 → 端映射
        ↓
路径匹配算法：
  - 010-requirements/、020-specs/、.speccore/CONSTITUTION.md → 全局变更（所有端）
  - srcPath/*.ts → 匹配对应端
        ↓
输出：受影响的端名列表 [backend, h5]
```

**分析快照持久化（v6.69.1+）**

```
分析/执行完成后 → recordAnalysisSnapshot(scope)
        ↓
写入 .speccore/cache/analysis-snapshots.json
  { "Iteration-Q2": { "lastCommit": "abc123", "analyzedAt": "...", "branch": "main" } }
        ↓
下次增量分析 → getIncrementalChangedFiles(scope)
        ↓
git diff <lastCommit>..HEAD --name-only → 仅检测新增变更
```

- **全量模式**：与默认分支对比（适合首次分析）
- **增量模式**：与上次分析的 commit 对比（适合后续迭代，避免重复分析已处理过的变更）
- **scope 标识**：`global`（全局层）、`Iteration-{name}`（迭代层）、`Task-{id}`（任务层）

**关键路径优先排序算法**

```
scanTasks(iteration) → 所有子任务 TaskState[]
        ↓
按 platform 分组统计：
  backend: { high: 3, medium: 2, low: 1 }
  h5:      { high: 1, medium: 4, low: 2 }
  admin:   { high: 0, medium: 1, low: 3 }
        ↓
排序规则：high 降序 → medium 降序 → low 降序
输出：['backend', 'h5', 'admin']
```

**Pipeline 引擎增强（`src/core/pipeline-engine.ts`）**

`createAnalyzePipeline()` 新增 `options` 参数：
- `affectedPlatforms?: string[]` — 变更感知过滤，在 `parsePlatformList()` 后过滤 platforms
- `platformOrder?: string[]` — 关键路径优先排序，在过滤后对 platforms 排序

步骤生成逻辑（以 3 个端为例）：
```
phase1-prompt → phase1-done → contract-prompt → contract-done
    → platform-backend-prompt → platform-backend-done
    → platform-h5-prompt → platform-h5-done
    → platform-admin-prompt → platform-admin-done
    → done
```

如果 `affectedPlatforms = ['backend', 'h5']`，过滤后：
```
... contract-done → platform-backend-prompt → ... → platform-h5-prompt → ... → done
```

如果 `platformOrder = ['h5', 'backend', 'admin']`，排序后：
```
... contract-done → platform-h5-prompt → ... → platform-backend-prompt → ... → platform-admin-prompt → ...
```

**知识图谱链路追踪（`src/core/knowledge-graph.ts`）**

`traceDependencyChain(graph, taskId, maxDepth=5)`：
- 递归追踪所有上游关系（`implements` / `references` / `depends_on`）
- 使用 `visited` Set 防止循环依赖
- 返回每条路径的完整实体列表和关系列表

`getFullTaskContext(graph, taskId)`：
- 复用 `getTaskContext()` 的基础能力（上游需求、兄弟子任务、父任务、关联规格）
- 增加 `dependencyChain`: 完整依赖链路
- 增加 `downstreamTasks`: 依赖于本任务的下游任务（通过反向查找 `depends_on` 关系）

#### 文档质量加固（v6.69.2+）

**问题根因**：AI 生成的 020-specs/ 文档存在以下质量问题：
1. 非法目录创建（如 `1001/`、`错误码/`、`.../`）
2. 枚举值跨文档不一致（如 REQUIREMENT.md 定义 `status=0,1`，TECH.md 却使用 `status=2`）
3. 接口路径不统一（如全局用 `/checkin`，端文档用 `/check-in`）
4. 功能覆盖不完整（遗漏页面、接口、业务规则）

**三层防护策略**：

| 层级 | 机制 | 实现位置 | 作用时机 |
|:---|:---|:---|:---|
| **生成前** | 强制自检清单（5 项必检） | `buildMultiDocPrompt()` 末尾 | AI 生成文档后、--apply 写入前 |
| **写入时** | 端名白名单校验 | `analyze.ts` apply 阶段 | CLI 接收 --apply JSON 时 |
| **写入后** | `audit --specs` 自动审计 | `audit.ts` `auditSpecsCommand()` | 用户主动执行或 CI 集成 |

**端名白名单校验逻辑**：
```
--apply JSON 键名: "admin-web/TECH.md"
        ↓
提取目录前缀: "admin-web"
        ↓
比对合法端列表: ["global", "admin-web", "h5-mobile", "booking-service", ...]
        ↓
合法 → 正常写入 020-specs/admin-web/TECH.md
非法 → 跳过写入，输出警告: "⚠️ 跳过非法端目录: 1001（文件: 1001/TECH.md）"
```

**强制自检清单内容**：
1. 功能覆盖完整性 — 对比原始需求功能清单
2. 枚举值一致性 — 跨文档状态/类型枚举必须一致
3. 接口路径统一性 — 全局与各端路径、方法一致
4. 跨文档引用一致性 — UI 字段 ↔ API 响应、TEST ↔ 验收标准
5. 目录结构合法性 — JSON 键名不含非法目录

**`audit --specs` 审计维度**：

| 检查项 | 严重级别 | 说明 |
|:---|:---|:---|
| 目录结构合法性 | 🔴 | 检测纯数字、纯点、中文目录名 |
| 枚举一致性 | 🔴 | 跨文档提取 key=value 枚举，标记不一致 |
| API 路径一致性 | 🟡 | 全局 REQUIREMENT.md vs 各端 TECH.md |
| 覆盖完整性 | 🟡 | 检查 REQUIREMENT.md、API_CONTRACT.md、各端 TECH.md |

---

#### Split 命令质量修复（v6.69.3+）

**问题根因**：`speccore split` 生成 030-tasks/ 时存在多个质量问题：

| 问题 | 影响 | 示例 |
|:---|:---|:---|
| AI 使用中文简写作为 scope | 端目录名错误 | `web/`、`api/` 而不是 `admin-web/`、`booking-service/` |
| 子任务命名无意义 | 目录可读性差 | `Task-004-impl` 而不是 `approval-flow-booking-service` |
| CONTEXT.md 位置错误 | 不符合规范 | `00-specs/CONTEXT.md` 而不是 `_shared/CONTEXT.md` |
| reqContent/techContent 模板化 | 执行时无有效输入 | 只有 `<!-- AI-FILL -->` 占位符 |

**端名映射修复**：

```
AI 返回 scope: ["后端", "admin", "h5"]
        ↓
normalizeScopePlatforms(standardPlatforms = ["booking-service", "admin-web", "h5-mobile"])
        ↓
"后端" → 匹配 /-(service|api|server|backend)$/ → "booking-service"
"admin" → 模糊匹配 "admin-web" → "admin-web"
"h5" → 关键词映射 → "h5-mobile"
        ↓
标准化后: ["booking-service", "admin-web", "h5-mobile"]
```

**子任务命名修复**：

```
// 旧命名
{platformDir}/Task-004-impl/

// 新命名
{platformDir}/{功能单元slug}-{端名}/
例: booking-service/approval-flow-booking-service/
    admin-web/approval-flow-admin-web/
```

**Prompt 质量加固**：
1. 在 prompt 开头注入标准端名列表，明确要求 AI 使用标准端名
2. scope 示例从 `["后端", "admin"]` 改为 `["booking-service", "admin-web"]`
3. reqContent/techContent 增加"质量红线"：禁止模板化占位符

---

### 8.12 spec-ask onboarding 强制展示修复（v6.63.0）

**问题根因**：`.qoder/commands/spec-ask.md` 只有 8 行简单指令，没有包含「引导页强制展示规则」，导致 AI 忽略 `[SPECCORE_ONBOARD: <path>]` 标记。

**修复方案**：在 `init.ts` 第 910-925 行为 spec-ask command 添加引导页规则：
```markdown
## 🚨 引导页强制展示规则

执行 `speccore ask` 后，检查 stdout 中的 `[SPECCORE_ONBOARD: <path>]` 标记：
- **如果检测到该标记，必须立即执行** `present_files(<path>)` 展示 HTML 引导页
- ❌ **禁止**只说“检测到引导页”而不执行展示动作 — 说了不等于做了
- ❌ **禁止**用文字描述引导页内容代替实际展示 — 必须让用户看到 HTML 页面
- **展示完成后**，再继续处理其他输出
```

**用户操作**：
```bash
# 1. 更新 command 文件
speccore init --update --tools qoder

# 2. 删除旧标识（强制重新触发 onboarding）
rm .speccore/local/.ask-onboarded

# 3. 测试
speccore ask "测试"
```

---

## 9. 流式分析与增量分析架构（v6.74.0 - v6.76.0）

### 9.1 流式全局分析（Streaming Global Analysis，v6.74.0）

将传统的"四层批处理"（Layer 1→4）升级为"七阶段流处理"（Phase 0→6），每个阶段产出写入文件，作为后续阶段的输入。

#### 七阶段架构

| Phase | 名称 | 目标 | 产出 |
| :--- | :--- | :--- | :--- |
| Phase 0 | 快速全局扫描 | 所有端并行索引 | `platforms/{端}/_INDEX.md` |
| Phase 1 | 后端深度分析 | 拓扑排序，从依赖源头开始 | `platforms/{后端端}/API_INVENTORY.md`, `DATA_MODEL.md`, ... |
| Phase 2 | 全局实时更新 | 后端完成后更新全局文档 | `global/API_CONTRACT.yaml`, `ARCHITECTURE.md`, ... |
| Phase 3 | 前端深度分析 | 对齐后端契约 | `platforms/{前端端}/FEATURES.md`, `UI_SPEC.md`, ... |
| Phase 4 | 横向关联检查 | 前后端字段/接口一致性 | `global/CROSS_CHECK.md` |
| Phase 5 | 纵向关联检查 | 功能模块跨端完整性 | `global/VERTICAL_CHECK.md` |
| Phase 6 | 最终核对检查 | 完整性+一致性+遗漏检测 | `global/FINAL_AUDIT.md` |

#### 核心机制

**后端优先分析**：
- 读取 `CONSTITUTION.md` 获取端类型
- 后端端按依赖拓扑排序（从被依赖到依赖者）
- 先分析底层服务（如 user-service），再分析上层服务（如 order-service）

**实时关联调整（Backtracking）**：
- Phase 1 完成后：检测后端深入分析发现的接口/实体是否在 Phase 0 的 `_INDEX.md` 中缺失
- Phase 3 完成后：检测前端调用的接口是否在所有后端端中都找不到定义
- 发现问题时，在日志中输出需要回退修正的文档列表

**端类型针对性分析**：
- **Java 后端**：Spring Boot + JPA/Hibernate + 缓存策略 + 事务边界
- **Node 后端**：NestJS + TypeORM/Prisma + 中间件链 + 异常过滤
- **Go 后端**：Gin + GORM + 并发模式 + 错误处理
- **Python 后端**：FastAPI + SQLAlchemy + 异步 + 类型注解
- **微信端**：JS-SDK + OAuth + 分享 + 支付 + 模板消息
- **小程序端**：包体积 + 平台 API + setData 优化 + 页面栈
- **H5 端**：响应式 + 触摸交互 + 弱网优化 + 首屏性能
- **Web/管理端**：复杂表单 + 数据表格 + 权限 UI + 状态管理

**最终核对检查（Final Audit）**：
- 检查全局文档完整性（`API_CONTRACT.yaml`, `ARCHITECTURE.md`, `FUNCTION_MAP.md`）
- 检查端文档完整性（后端：`API_INVENTORY.md`, `DATA_MODEL.md`, `BUSINESS_RULES.md`；前端：`FEATURES.md`, `UI_FLOW.md`, `API_CALL_MAP.md`, `UI_SPEC.md`）
- 检查内容占位符（`待填充`, `_待定_`, `TBD`, `TODO`, `FIXME`）

#### CLI 使用

```bash
# 完整流式分析（Phase 0→6）
speccore analyze --prompt -I <迭代> --global --with-code --streaming

# 指定阶段分析
speccore analyze --prompt -I <迭代> --global --with-code --streaming-phase phase1-backend
```

#### 代码实现

- `src/core/streaming-analyzer.ts`：流式分析引擎（Phase Prompt 生成 + 回退检测 + 最终核对）
- `src/commands/analyze.ts`：`--streaming` / `--streaming-phase` 集成

### 9.2 增量分析（Incremental Analysis，v6.75.0）

解决"上次分析不满意，或需求有变更，不需要全部重读"的场景。

#### 核心能力

**变更检测**：
- 对比 `.speccore/cache/last-analysis-snapshot.json` 检测：
  - 需求文档变更（mtime + content hash）
  - 源码文件变更（如果 `--with-code`）
  - 新增/删除端

**智能复用**：
- 未变更的内容在 prompt 中标注为「已有内容，请复用/校验」
- 只重新分析变更部分

**遗漏检查**：
- 自动检测上次分析的功能模块遗漏
- 检查文档缺失、占位符残留

#### CLI 使用

```bash
# 增量分析模式
speccore analyze --prompt -I <迭代> --incremental

# 同义词
speccore analyze --prompt -I <迭代> --reanalyze
```

#### 代码实现

- `src/core/incremental-analyzer.ts`：增量分析引擎（变更检测 + 快照管理 + 遗漏检查）

### 9.3 新增端分析（New Platform Addition，v6.75.0）

解决"迭代中新增了一个端"的场景。

#### 核心能力

**单独分析新端**：
- 读取新端源码，建立索引
- 按端类型生成针对性分析产出

**跨端关系自动识别**：
- 检测新端与已有端的 API 调用关系
- 检测数据依赖、认证依赖

**全局文档自动更新**：
- 自动规划 `FUNCTION_MAP` / `API_CONTRACT` / `ARCHITECTURE` / `INTERACTION_MAP` 的更新内容

#### CLI 使用

```bash
speccore analyze --prompt -I <迭代> --add-platform admin-web
```

#### 代码实现

- `src/core/platform-addition.ts`：新增端分析引擎

### 9.4 上下文爆炸防护（Context Guard，v6.75.0）

解决"分析内容过多，上下文容易爆炸"的问题。

#### 预估模型

| 维度 | 预估 Tokens |
|------|------------|
| 基础 overhead | 每个 prompt 模板 ~2K |
| 每端 overhead | 读取索引 + 分析指令 ~3K |
| 每模块 overhead | 需求文档 + 关联代码 ~5K |
| 每功能单元 overhead | 详细设计 ~8K |
| 全局文档 overhead | FUNCTION_MAP + API_CONTRACT ~4K |

#### 四级分段策略

| 级别 | 预估 Tokens | 推荐策略 |
|------|------------|---------|
| small | < 8K | 一次性分析 |
| medium | 8K - 15K | 按端分批 |
| large | 15K - 25K | 按模块分批 |
| xlarge | > 25K | 按功能单元分批 + 强制交互确认 |

#### CLI 使用

```bash
# 只输出预估报告
speccore analyze --prompt -I <迭代> --estimate-only

# 启用上下文防护（交互模式下提示确认）
speccore analyze --prompt -I <迭代> --context-guard
```

#### 代码实现

- `src/core/analyze-context-guard.ts`：上下文防护引擎（大小预估 + 分段策略 + 交互确认）

### 9.5 功能模块级全局分析（Module Analysis，v6.76.0）

解决"在全局层对单个功能模块进行再次/新增分析"的需求。

#### 与 `--feature` 的区别

| 维度 | `--feature` (局部分析) | `--module` (全局模块分析) |
|------|----------------------|-------------------------|
| 分析范围 | 单个功能模块的需求 → 规格 | 模块 + 跨端关联 + 全局影响 |
| 全局文档 | 不更新 | **更新** FUNCTION_MAP / INTERACTION_MAP / API_CONTRACT |
| 各端文档 | 不更新 | **更新** 各端 TECH.md / API_INVENTORY / FEATURES |
| 适用场景 | 新增功能模块的初次规格定义 | 已有模块重新分析、跨端一致性校验 |

#### 三种处理场景

**模块已存在**：
1. 读取 `FUNCTION_MAP` / `INTERACTION_MAP` 中的当前定义
2. 对比最新需求识别变更点
3. 生成 3-phase 精准更新 prompt（只更新该模块相关内容）

**模块不存在但在需求文档中**：
1. 从 `010-requirements/features/` 提取该模块需求
2. 按全局标准分析（缩小版的全局分析）
3. 生成插入 prompt（指导 AI 在全局文档中新增该模块）

**模块完全不存在**：
- 提示用户先提供需求文档或先用 `--feature` 分析

#### 3-Phase 分析流程

```
Phase 1: 需求层提取/校验
  → 读取已有模块定义或从需求文档提取
  → 识别变更点或缺失内容

Phase 2: 各端关联分析
  → 识别模块涉及的端
  → 分析各端当前实现与需求的差异
  → 输出各端文档更新指令

Phase 3: 全局文档更新
  → 更新 FUNCTION_MAP（增删改功能单元）
  → 更新 INTERACTION_MAP（调整时序图）
  → 更新 API_CONTRACT（增删改接口）
  → 更新 REQUIREMENT（补充模块需求）
```

#### CLI 使用

```bash
# 模块已存在 → 重新分析
speccore analyze --prompt -I <迭代> --module "订单管理"

# 模块不存在 → 从需求提取并分析
speccore analyze --prompt -I <迭代> --module "消息推送"
```

#### 代码实现

- `src/core/module-analyzer.ts`：模块级分析引擎（模块检测 + 更新计划 + Prompt 生成）

---

## 12. Skill 专属逻辑架构（v6.77.0+）

### 12.1 架构定位

Skill 是 Qoder AI 助手的**快捷命令预处理层**，位于用户输入和 `speccore ask` 引擎之间：

```
用户输入 /split --platforms api
        │
        ▼
┌─────────────────────────────────────────┐
│ spec-split Skill（专属预处理层）          │
│   Step 1: 参数提取（platforms=api）        │
│   Step 2: 前置校验（analyze完成？端有效？） │
│   Step 3: 上下文准备（扫描已有Task结构）    │
│   Step 4: 生成加工 Prompt                  │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│ speccore ask 引擎（意图执行层）           │
│   接收加工 Prompt → 直接执行（无需意图识别）│
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│ speccore CLI（底层操作层）               │
│   文件读写、目录创建、Git 操作             │
└─────────────────────────────────────────┘
```

### 12.2 三层分工

| 层级 | 负责方 | 职责 | 举例 |
|:---|:---|:---|:---|
| **专属预处理层** | `spec-split` / `spec-plan` / `spec-execute` 等 Skill | 参数校验、环境检测、上下文读取、交互提示 | 检查 analyze 是否完成、扫描已有 Task、读取 context.json |
| **意图执行层** | `speccore ask` 引擎 | 意图理解、Prompt 生成、AI 交互、CLI 命令生成 | 根据 Prompt 生成 `speccore iteration split ...` 命令 |
| **底层操作层** | `speccore` CLI 命令 | 文件读写、目录创建、Git 操作 | 实际创建 `030-tasks/Task-001/` 目录 |

### 12.3 设计原则

1. **不影响 ask 意图识别**：自然语言输入仍走 `speccore-router` → `speccore ask` 的原有流程
2. **Skill 只做预处理**：参数校验、上下文准备，不做意图识别和 Prompt 生成
3. **最终仍调 ask**：所有 Skill 最终调用 `speccore ask`，不绕过核心引擎
4. **参数缺失时交互提示**：不直接报错，输出参数说明 + 使用示例

### 12.4 Skill 分类

| 类型 | Skill | 专属逻辑 | 状态 |
|:---|:---|:---|:---|
| 核心引擎 | `speccore-router` | 意图识别 + 参数提取 + Skill 匹配 | 保持原样 |
| 核心引擎 | `spec-ask` | 意图理解 + Prompt 生成 + AI 交互 | 保持原样 |
| 已增强 | `spec-analyze` | 需求专业度检测、端列表读取、apply 文件校验 | ✅ 改造完成 |
| 已增强 | `spec-split` | 增量拆分上下文、变更检测、已有 Task 扫描 | ✅ 改造完成 |
| 已增强 | `spec-plan` | 任务依赖检测、拓扑排序、执行顺序优化 | ✅ 改造完成 |
| 已增强 | `spec-execute` | 任务状态检查、代码模式读取、上游变更检测 | ✅ 改造完成 |
| 已增强 | `spec-change` | 变更类型判断、影响范围扫描、附件检测 | ✅ 改造完成 |
| 已增强 | `spec-doc2spec` | 文件格式检测、迭代存在性校验 | ✅ 改造完成 |
| 已增强 | `spec-spec2doc` | 输出格式校验、Task/迭代存在性检查 | ✅ 改造完成 |
| 已增强 | `spec-task-create` | 英文主题词提取、命名冲突检测、批量模式 | ✅ 改造完成 |
| 已增强 | `spec-iteration-create` | 迭代名冲突检测、主题词提取、owner 补全 | ✅ 改造完成 |
| 已删除 | ~~`spec-dev`~~ | 纯路由型，功能已合并到 ask | 🗑️ 删除 |
| 已删除 | ~~`spec-synthesize`~~ | 纯路由型，功能已合并到 `analyze --full` | 🗑️ 删除 |

### 12.5 统一结构

每个改造后的 Skill 遵循统一模板：

```markdown
---
name: xxx
description: >
  xxx 专属 Skill。参数提取 + 前置校验 + 交互提示。
  不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

# xxx — xxx（专属逻辑）

> **定位**：`/xxx` 快捷入口的专属预处理层
> **原则**：不影响 speccore ask 的意图识别能力

## 调用方式
## 执行流程（ASCII 流程图）
## Step 1: 参数提取（表格）
## Step 2: 参数缺失 → 交互式提示（含当前环境 + 参数说明 + 示例）
## Step 3: 前置校验（分点说明）
## Step 4: 调用 speccore ask

> ⚠️ 最终仍然调用 speccore ask，不要绕过 ask 引擎。
```

### 12.6 交互式提示规范

当用户调用 `/xxx` 但没有提供足够参数时，Skill 输出统一格式的提示：

```
🎯 speccore xxx — 功能名称

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 当前环境
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
迭代: Iteration-XXX（从 context.json 读取）
...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📖 可用参数
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  -I, --iteration <name>    目标迭代（默认: 当前迭代）
  ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 使用示例
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /xxx ...
  ...

请补充参数后重新调用，或直接调用 /xxx 使用默认设置。
```

## 13. AI 文件写入防护与目录校验机制（v7.2.1+）

### 13.1 问题背景

SpecCore 采用「CLI 控制流程 + AI 生成内容」架构。AI 通过 `--apply` 将内容交给 CLI 写入文件，CLI 负责路由到正确目录。但实际运行中发现：

1. **Prompt 路径过时**：`GLOBAL_SPECS_DIR` 从 `global` 改为 `overview` 后，prompt 中 5 处仍写 `global/`，AI 忠实执行了错误指令
2. **AI 绕过 --apply**：AI 直接用 Write 工具写文件，跳过 CLI 的白名单校验和路由逻辑，导致非法目录（`1001/`、`工程标识/`）和文件散落
3. **跨 AI 工具不一致**：不同 AI 工具（WorkBuddy、Qoder、Cursor）对同一指令的执行行为不同

### 13.2 三层防护架构

```
┌─────────────────────────────────────────┐
│  Layer 1: AGENTS.md 全局约束        │
│  所有 AI 工具启动时读取，硬性禁止        │
│  直接用 Write 写 020-specs/ 下的文件    │
├─────────────────────────────────────────┤
│  Layer 2: Prompt 指令引导            │
│  analyze --prompt 输出明确的目录结构    │
│  和写入方式指导（--apply 用法）          │
├─────────────────────────────────────────┤
│  Layer 3: CLI 事后校验（兜底）        │
│  sanitizeSpecDirectories() 自动检测    │
│  并修复非法目录、遗留文件、路径过时      │
└─────────────────────────────────────────┘
```

### 13.3 sanitizeSpecDirectories() 设计

**触发时机**：`speccore analyze --apply` 完成后自动执行。

**校验规则**：

| 检测项 | 处理方式 | 示例 |
|:---|:---|:---|
| 遗留 `global/` 目录 | 文件迁移到 `overview/`，空目录归档 | `global/ANALYSIS.md` → `overview/ANALYSIS.md` |
| 非法子目录 | 重命名为 `{name}.invalid-{timestamp}` 归档 | `1001/` → `1001.invalid-1724.../` |
| 根目录散落 `.md` 文件 | 移入 `overview/`，重复的归档 | `020-specs/TECH.md` → `overview/TECH.md` |

**白名单来源**：
- `GLOBAL_SPECS_DIR`（常量 `'overview'`）
- `parsePlatformList()`（从 CONSTITUTION.md 端列表解析）
- `GLOBAL_SPEC_FILES`（综合文档文件名列表）

**设计原则**：不删除任何文件，只重命名归档。用户可随时恢复。

### 13.4 路径常量统一规范

所有引用 `020-specs/` 综合文档目录的位置，必须使用 `GLOBAL_SPECS_DIR` 常量而非硬编码字符串：

```typescript
// ✅ 正确
logger.info(`📁 已预创建: ${GLOBAL_SPECS_DIR}/`);
prompt += `写入 ${GLOBAL_SPECS_DIR}/ 子目录`;

// ❌ 错误
logger.info(`📁 已预创建: global/`);
prompt += `写入 global/ 子目录`;
```

### 13.5 跨 AI 工具一致性策略

| 策略 | 实现方式 | 可靠性 |
|:---|:---|:---|
| AGENTS.md 硬约束 | 所有 AI 工具启动时读取，明确禁止项 | 高（工具层面强制执行） |
| Prompt 路径引导 | `--prompt` 输出正确路径和示例 | 中（AI 可能忽略） |
| CLI 事后校验 | `sanitizeSpecDirectories()` 自动修复 | 高（不依赖 AI 行为） |
| `--apply` 白名单 | 拒绝非法端名目录写入 | 高（仅对走 --apply 的生效） |

**核心思路**：不追求 100% 阻止 AI 犯错（不可能），而是确保犯错后能自动恢复（可做到）。

## 14. 骨架优先架构（Skeleton-First Architecture，v8.0.0+）

### 14.1 问题背景

v6.33 至 v7.5.1 期间，同类问题反复出现 5+ 轮：

| 版本 | 问题表现 | 修复方式 |
|:---|:---|:---|
| v6.33 | analyze 文档全部扁平放在根目录 | 加 prompt 路径指令 |
| v6.49.16 | AI 创建 `1001/`、`错误码/` 等垃圾目录 | 加「禁止自创目录」指令 |
| v7.2.1 | TECH/RISK 等散落根目录 | 加 sanitize 白名单 |
| v7.5.0 | 各端目录为空、split 未按功能单元拆分 | 加 detectIterationDocsStatus + parseAnalysisFunctionalUnits |
| v7.5.1 | sanitize 误删合法目录、白名单不全 | 改 parsePlatformList + 补齐 GLOBAL_SPEC_FILES |

**根因**：SpecCore 让 AI 同时决定「内容」和「文件路径」。AI 擅长内容生成，但不擅长确定性路径决策。

### 14.2 核心原则变更

```
旧架构: CLI → prompt → AI 决定内容+路径 → 文件落盘 → sanitize 清理（永远不完整）
新架构: CLI → 预创建文件骨架 → AI 只覆盖内容 → 文件已在正确位置（不需要清理）
```

**关键洞察**：文件路径是确定性决策，不该让 AI 做。业界成熟框架（Rails Generators / Django startapp / Yeoman / OpenAPI Generator）统一用确定性层控制结构，内容层只填充内容。

### 14.3 核心模块：`src/core/spec-skeleton.ts`

所有骨架逻辑集中在此模块，analyze/split 共用。

#### 类型定义

```typescript
interface SpecFileEntry {
  relPath: string;       // 相对 020-specs/ 的路径，如 "overview/ANALYSIS.md"
  category: 'overview' | 'platform';
  platform?: string;     // 端名（仅 platform 类）
  docName: string;       // 文件名
  placeholder: string;   // 占位内容（含写作指引）
}

interface SkeletonResult {
  created: string[];     // 新创建的骨架文件
  skipped: string[];     // 已存在（保留原内容）
}

interface ProgressResult {
  filled: string[];      // 已填充（非骨架）
  unfilled: string[];    // 仍为骨架
  nextUnfilled: SpecFileEntry | null;
  filledCount: number;
  totalCount: number;
}
```

#### 核心函数

| 函数 | 职责 |
|:---|:---|
| `computeAnalyzeManifest(platforms, phase, iteration)` | 计算 analyze 命令的文件清单（Phase 1: 8 个全局文档，Phase 2: 各端 3 个文档） |
| `computeTaskManifest(taskName, platforms)` | 计算 split 命令的任务文件清单（每端 3 个文档） |
| `generateSkeleton(specDir, entries)` | 预创建文件骨架（文件不存在→创建，已存在→跳过） |
| `validateFilled(specDir, entries)` | 检测哪些骨架已被 AI 填充（不含 `<!-- SPEC-SKELETON -->` 标记 = 已填充） |
| `detectSkeletonProgress(specDir, entries)` | 检测骨架填充进度，返回下一个需要生成的文件 |
| `buildSkeletonFileList(entries, specDir)` | 生成注入 prompt 的骨架文件列表 |

#### 骨架标记机制

```typescript
export const SKELETON_MARKER = '<!-- SPEC-SKELETON -->';
```

- 骨架文件第一行包含此标记
- `validateFilled()` 通过检测此标记判断文件是否已被 AI 覆盖
- AI 用 Write 工具覆盖文件时，标记自然被替换

### 14.4 analyze 命令改造

**替换关系**：

| 旧函数 | 新函数 | 差异 |
|:---|:---|:---|
| `preCreateSpecDirectories()` | `computeAnalyzeManifest()` + `generateSkeleton()` | 旧版只建目录，新版建目录+文件骨架 |
| `sanitizeSpecDirectories()` | 不再需要（保留为旧项目迁移辅助） | 骨架确保路径正确，不需要事后清理 |
| `detectIterationDocsStatus()` | `detectSkeletonProgress()` | 旧版检测文件是否存在，新版检测骨架是否被填充 |

**Prompt 简化**：

```
旧 prompt（~20 行警告）:
  "不要创建目录" / "不要直接用 Write" / "必须走 --apply" / ...

新 prompt（~5 行文件列表）:
  "以下文件已创建（含占位内容），请逐个用 Write 工具覆盖："
  {动态生成骨架文件列表}
  "只覆盖已存在的文件，不要创建新文件"
```

### 14.5 split 命令改造

**新增**：子任务目录预创建 REQ.md 和 TECH.md 骨架文件。

```
旧流程: CLI 建目录 → AI 自行创建 REQ.md/TECH.md（路径不确定）
新流程: CLI 建目录 + 预创建骨架 → AI 只覆盖已有文件（路径确定）
```

### 14.6 向后兼容策略

1. **旧项目首次运行**：骨架生成器检测到已有文件 → 跳过，不覆盖
2. **旧项目散落文件**：`sanitizeSpecDirectories()` 仍作为一次性迁移工具保留
3. **`--apply` 模式**：保留但简化，不再作为唯一正确路径
4. **死代码标注**：`preCreateSpecDirectories()` 和 `detectIterationDocsStatus()` 标注 `@deprecated`

### 14.7 设计哲学：CLI 做计算，AI 做内容

| 决策类型 | 谁来做 | 为什么 |
|:---|:---|:---|
| 文件路径 | CLI（确定性） | 路径是结构决策，不需要智能 |
| 目录结构 | CLI（确定性） | 目录结构由 manifest 定义 |
| 文件内容 | AI（智能性） | 内容需要专业分析和创造 |
| 进度追踪 | CLI（确定性） | 通过骨架标记检测，不依赖 AI 报告 |

**核心原则**：对于结构性决策，应尽可能用 CLI 读取预定义字段或执行确定性操作，而不是让 AI 判断。AI 适合做「内容生成」，不适合做「结构决策」。

---

## 15. 统一配置版本化（v8.3.25+）

### 15.1 问题背景

在 v8.3.24 之前，项目配置分散在多个文件中：
- `.speccore/CONSTITUTION.md` — 端列表、技术栈、命名规范（Markdown 表格，机器解析脆弱）
- `.speccore/SETTINGS.md`（已废弃）— 运行时行为配置（键值对表格，无结构校验）
- `.speccore/config/ask.json` — Ask 引擎路由和 LLM Provider（JSON，与 CLI 风格不一致）
- `.speccore.yml`（早期设计）— 仅包含项目信息、Git、质量门禁，配置域不完整

**问题**：
1. 配置分散，新用户不知道去哪里修改
2. 无结构校验，拼写错误或类型错误导致运行时异常
3. CLI 升级新增配置项时，旧项目静默缺失新功能
4. Markdown/JSON/YAML 三种格式并存，维护成本高

### 15.2 设计目标

1. **单一配置入口**：`.speccore.yml` 成为唯一配置文件
2. **版本化**：`schema_version` 字段标记配置结构版本，CLI 升级时自动检测
3. **结构校验**：加载时自动校验字段类型和枚举值，错误即时报告
4. **自动补全**：缺失字段自动填充默认值，不因配置不完整而阻塞
5. **自动升级**：`speccore config --upgrade` 一键补全新字段、更新版本号

### 15.3 配置结构

```yaml
schema_version: 1

project:
  name: spec-core-ts-cli
  description: ...
  version: 8.3.25

tech_stack:
  backend: TypeScript / NestJS
  frontend: Vue / React

team:
  members:
    - name: luzhaosheng
      role: lead

platforms:
  - name: app
    type: frontend
    code_path: ./packages/app
    git_repo: git@xxx/app.git

git:
  default_base: main
  branch_prefix: feature/
  protected_branches: [main, master]

code_scope: [src/]

conventions:
  commit: conventional-commits
  naming:
    interface: /api/v1/{module}/{operation}
    database: snake_case

error_codes:
  - code: 1001
    meaning: 用户不存在

quality_gates:
  enforce_testing: true
  enforce_review: true
  require_pr: true

arbitration:
  enabled: true
  mode: full

settings:
  assignee: { enabled: true, mode: loose }
  trace: { enabled: true, auto_annotate: true }
  archive: { auto_cleanup: false }
  plan: { parallel_suggest: true }
  validation: { strict_mode: false }
  sync: { auto_check: true }
  patterns: { auto_save: smart }
  review: { check_assignee: false }

ask:
  routing:
    mode: hybrid
    high_threshold: 70
    low_threshold: 45
    auto_host_ai: true
    cache_enabled: true
  llm_providers: []

config_history:
  - date: 2026-08-28
    change: 升级到 schema_version=1
```

### 15.4 版本化机制

**Schema 版本号**：
- `CURRENT_SCHEMA_VERSION = 1`（代码常量，随 CLI 版本递增）
- `.speccore.yml` 中 `schema_version` 字段标记项目配置版本

**加载时检测**：
```typescript
if (config.schema_version < CURRENT_SCHEMA_VERSION) {
  warn('配置结构已过期，建议运行: speccore config --upgrade');
} else if (config.schema_version > CURRENT_SCHEMA_VERSION) {
  warn('CLI 版本可能过旧，建议升级 CLI');
}
```

**自动补全**：
```typescript
const merged = deepMerge(DEFAULT_CONFIG, parsed);
// DEFAULT_CONFIG 包含所有字段的默认值
// 用户配置缺失的字段自动使用默认值
```

**升级命令**：
```bash
speccore config --upgrade
```
- 补全缺失字段（deepMerge）
- 更新 `schema_version = CURRENT_SCHEMA_VERSION`
- 追加升级记录到 `config_history`
- 重写 `.speccore.yml`

### 15.5 配置差异检测与交互式升级

**五类差异检测**：

| 差异类型 | 检测逻辑 | 自动/手动 |
|----------|----------|-----------|
| **新增字段** | 目标 schema 有，当前配置没有 | 自动补全默认值 |
| **删除字段** | 当前配置有，目标 schema 没有 | **需用户确认** |
| **类型变更** | 同路径字段类型不同（`typeof`） | **需用户确认** |
| **枚举值非法** | 字符串值不在 `ENUM_CONSTRAINTS` 合法列表中 | **需用户确认** |
| **结构变更** | 对象↔数组、数组元素类型变化 | **需用户确认** |

**枚举约束定义**（`ENUM_CONSTRAINTS`）：
```typescript
const ENUM_CONSTRAINTS = {
  'platforms.*.type': ['frontend', 'backend', 'infra'],
  'arbitration.mode': ['full', 'l1-only', 'report-only'],
  'settings.assignee.mode': ['strict', 'loose', 'off'],
  'settings.patterns.auto_save': ['off', 'smart', 'aggressive'],
  'ask.routing.mode': ['hybrid', 'cli-only', 'host-ai-only'],
  'ask.llm_providers.*.type': ['ollama', 'openai', 'anthropic', 'custom'],
};
```

支持通配符 `*` 的路径遍历（`getValuesAtPath`），如 `platforms.*.type` 自动匹配 `platforms[0].type`、`platforms[1].type` 等。

**交互式升级流程**：
```
speccore config --upgrade
    ↓
detectConfigDiff(current, DEFAULT_CONFIG)
    ↓
requiresUserConfirmation(diff)?
    ├── 是 → 生成 .speccore/config/upgrade-diff.md
    │         输出差异报告到终端
    │         中止升级，提示用户手动处理
    │         用户修改后重新运行 --upgrade
    └── 否 → 执行迁移（MIGRATIONS）
              补全缺失字段（deepMerge）
              更新 schema_version
              记录升级历史
              重写 .speccore.yml
```

**差异报告文件**（`.speccore/config/upgrade-diff.md`）：
- 生成时间、当前/目标 schema_version
- 五类差异的详细列表
- 每项差异的处理建议
- 修改完成后重新运行的命令

**全链路检测**：
- `speccore config --upgrade` — 升级前强制检测
- `speccore doctor` — 健康诊断时检测（即使 schema_version 匹配也检测结构性差异）
- `speccore status` — 状态面板中显示差异警告

### 15.6 结构校验

自定义校验器覆盖：
- `schema_version` 必须是数字
- `platforms[].type` 必须是 `frontend/backend/infra`
- `arbitration.mode` 必须是 `full/l1-only/report-only`
- `settings.patterns.auto_save` 必须是 `off/smart/aggressive`
- `quality_gates.*` 必须是布尔值
- `git.protected_branches` 必须是数组

校验失败时：
1. 报告具体错误（字段路径 + 期望类型）
2. 用默认值兜底，尽量继续运行
3. 在 `speccore doctor` 中显示配置健康度

### 15.7 健康检查集成

**doctor 命令**：
- `.speccore.yml` 是否存在
- `schema_version` 是否匹配当前 CLI
- `platforms` 是否非空
- 校验警告数量
- 是否发生过自动补全
- **配置差异检测**（v8.3.25+）：即使版本匹配，也检测删除/类型/枚举/结构差异

**status 命令**：
- 面板末尾显示配置版本状态
- 过期时提示升级命令
- **配置差异警告**（v8.3.25+）：版本匹配时检测结构性差异

### 15.8 不迁移的内容

以下文件保持独立，不纳入 `.speccore.yml`：

| 文件 | 原因 |
|------|------|
| `.speccore/local/context.json` | 运行时状态，非配置 |
| `.speccore/PATTERNS/` | 自动沉淀的资产，非配置 |
| `.speccore/GLOBAL/` | 自动生成的全局索引 |
| `.speccore/cache/` | 缓存，不应手动维护 |
| `.speccore/ITERATIONS/` | 迭代数据，随业务变化 |

### 15.9 向后兼容策略（项目内）

`loadConfig()` 保持返回 `SpecConfig`（兼容所有现有调用者）：
```typescript
// 旧代码
const config = await loadConfig();
config.project.name; // 直接访问

// 新代码
const { config, warnings, migrated } = await loadConfigWithMeta();
// warnings: 配置警告列表
// migrated: 是否发生过自动补全或版本迁移
```

`getConfig()` 作为 `loadConfig()` 的别名保留，供旧代码使用。

---

## 附录：v8.3.93+ Prompt 构建层增强设计

### A.1 Markdown 链接自动展开（v8.3.93）

**问题**：specs 文档中 `[文本](路径)` 链接指向的上下文文件不会被 AI 读取，AI 只能看到路径文本，无法获取链接内容。

**设计原则**：
- 在 prompt 构建阶段（`prompt-builder.ts`）而非文件写入阶段处理
- 递归展开，但严格限深（默认 2 层），防止内容爆炸
- 防循环检测（`seenPaths` Set），避免 A→B→A 死循环
- 单个链接内容截断（默认 1500 字符），防止单链接占用过多 token

**技术实现**：
```
loadExtraSpecs / loadAllTaskContext
    ↓
processMarkdownContent(content, filePath, seenPaths, visionConfig, options)
    ↓
expandMarkdownLinks(content, baseDir, seenPaths, maxDepth=2, currentDepth=0, maxChars=1500)
    ↓
逐链接读取 → HTML 提取文本 → 截断 → inline 到 prompt
```

**Edge Case 处理**：
- 外部链接（http/mailto/#）自动跳过
- 文件不存在或读取失败静默忽略
- 循环引用（已访问路径）自动跳过
- 内容过短（≤30 字符）不展开

### A.2 图片理解与视觉模型（v8.3.94）

**问题**：`![alt](path)` 图片对 AI 不可见（纯文本 prompt），设计稿截图等信息丢失。

**分层策略**：

| 图片类型 | 处理方式 | 成本 |
|----------|----------|------|
| SVG | 直接 inline XML 文本 | 零 |
| PNG/JPG/GIF/WebP | 视觉模型生成描述文本 | 按次计费 |

**视觉模型引擎设计**（`vision-engine.ts`）：
- **Provider 抽象**：qwen-vl / openai (gpt-4o) / anthropic (claude-3) / local (ollama)
- **成本控制**：每个 prompt 默认最多处理 10 张图片，超过自动回退到 alt+路径信息
- **大小限制**：默认 2048 KB，超过则跳过
- **配置入口**：`.speccore.yml` 中 `settings.vision`（优先）或 `quality_gates.verify_ui.visual_model`（兼容回退）
- **默认关闭**：未配置时完全跳过，零成本

**Prompt 集成**：
```
inlineMarkdownImages(content, baseDir, seenPaths, visionConfig)
    ↓
对于每张位图图片：
    if visionConfig.enabled && visionCallCount < maxImagesPerPrompt
        → 调用 describeImage() → 注入 "[图片内容] 描述文本"
    else
        → 注入 "图片: alt | 路径: path | 大小: xKB"
```

### A.3 多子任务批量分析（v8.3.94）

**问题**：`speccore analyze --task` 只支持单个子任务，无法一次性分析多个相关任务。

**设计决策**：
- `--prompt` 模式支持批量：生成合并 prompt，AI 可一次性分析所有任务
- `--apply` 模式保持单任务：批量写入涉及文件路由和覆盖逻辑，暂不支持

**过滤系统**：
```
--filter status:doing     → 扫描 .meta/status 文件
--filter owner:张三        → 扫描 .meta/owner 文件
--filter type:feature     → 扫描 .meta/type 文件
--filter platform:web     → 扫描端目录名
--filter keyword:auth     → 扫描任务名/feature/REQ.md 内容
```

**实现要点**：
- 过滤基于文件系统扫描（`.meta/` 目录），不依赖外部数据库
- 多个过滤条件可以组合（逻辑 AND）
- 未匹配到任务时优雅降级为迭代级分析

### A.4 Playwright 浏览器检测（v8.3.94）

**问题**：`playwright` npm 包安装后，浏览器二进制文件需额外 `npx playwright install` 下载。用户直接运行冒烟测试时遇到晦涩的原生错误。

**设计**：在 `launchBrowser()` 中先调用 `browserType.executablePath()` 检测浏览器是否存在，不存在时抛出带安装指引的友好错误：
```
Playwright 浏览器 "chromium" 未安装。

请执行以下命令安装（一次性）：
  npx playwright install chromium

或安装所有浏览器：
  npx playwright install
```

**原则**：在错误发生点给出可操作的修复指引，而非让原生错误层层上抛。

---

## 附录：v8.3.95 冒烟测试引擎设计

### A.5 Playwright 内网兼容与浏览器自动探测

**问题**：内网环境无法连接 Playwright CDN 下载浏览器二进制，`npx playwright install` 永远超时。

**设计决策**：
- 三层探测策略（优先级递减）：
  1. `SPECCORE_BROWSER_PATH` 环境变量（用户手动指定）
  2. Playwright 自带浏览器（已执行 `npx playwright install`）
  3. 本机系统浏览器（自动探测 Chrome/Edge）
- 按平台维护候选路径列表（Windows/macOS/Linux）
- 探测失败时给出三种可操作的修复方案（在线安装 / 系统浏览器 / 离线搬运）

**实现**：`launchBrowser()` 中先调用 `browserType.executablePath()` 检测自带浏览器，失败则调用 `findSystemBrowser()` 扫描候选路径。

### A.6 有头模式 `--headed`

**问题**：无头模式下调试困难，用户看不到浏览器实际执行过程。

**设计**：CLI 新增 `--headed` 选项，通过 `headless: !options.headed` 传入 `launchBrowser()`。默认保持无头（CI 友好）。

### A.7 声明式操作扩展（cookie / localStorage / script / scroll / upload）

**设计原则**：所有操作保持声明式 YAML 配置，无需用户编写 JS。

| 操作 | 用途 | 关键字段 |
|------|------|----------|
| `cookie` | 注入登录态 Cookie | selector=name, value, domain, path, secure, httpOnly |
| `localStorage` | 注入 Token | selector=key, value |
| `script` | 执行自定义 JS（验证码绕过等） | value=JS 代码 |
| `scroll` | 滚动到元素/位置 | selector 或 value（像素/bottom） |
| `upload` | 文件上传 | selector=input[type=file], value=文件路径 |

**实现要点**：
- `cookie` → `page.context().addCookies()`
- `localStorage` → `page.evaluate()` 注入 `window.localStorage.setItem()`
- `script` → `page.evaluate()` 执行 `eval(code)`
- `scroll` → `page.evaluate()` 调用 `scrollIntoView()` 或 `window.scrollTo()`
- `upload` → `page.locator().setInputFiles()`

### A.8 样式断言 `style`

**问题**：需要验证按钮禁用状态、错误提示颜色等 CSS 样式变化，原有断言无法覆盖。

**设计**：新增 `style` 断言类型，通过 `window.getComputedStyle()` 获取实际计算样式，支持 `value` 精确匹配和 `contains` 包含匹配。

**示例**：
```yaml
- type: style
  selector: '.submit-btn'
  style: background-color
  contains: 'rgb(255, 0, 0)'
```

### A.9 能力矩阵

| 场景 | 操作/断言 | 状态 |
|------|----------|------|
| 页面加载 | navigate + wait + visible | ✅ |
| 表单交互 | fill / click / select / check | ✅ |
| 登录态注入 | cookie / localStorage | ✅ |
| 验证码绕过 | script | ✅ |
| 长列表滚动 | scroll | ✅ |
| 文件上传 | upload | ✅ |
| 样式验证 | style | ✅ |
| 视觉回归 | visual | ✅ |
| iframe 内操作 | iframe | ✅ |
| 网络请求等待 | waitForRequest / waitForResponse | ✅ |
| 拖拽排序 | drag | ✅ |
| 键盘组合键 | press (Control+a 等) | ✅ |

**覆盖结论**：后台管理系统（缴费/表单/列表/上传/弹窗/iframe/拖拽）的常规功能已全部覆盖。
