# 知识资产与检索架构（现状实现）

> 本文档描述 SpecCore **当前实现**中六类知识资产的边界、消费矩阵与源码进入 AI 上下文的路径。
> 与 [knowledge-base-design.md](./knowledge-base-design.md)（.speccore/knowledge/ 设计方案，待实现）不同，
> 本文是已落地机制的现状说明。版本基线：v8.3.366。

---

## 1. 核心原则：源码从不「全量注入」

AI 上下文中的源码只经四条「窄门」进入，全部是裁剪后的产物：

| 窄门 | 产物 | 消费阶段 | 规模上限 |
|:---|:---|:---|:---|
| 事实卡片 | `structured-data.json`（API/Entity/Route/Component 卡片） | execute 注入 | API≤8 / Entity≤6 / Component 等分档 |
| 符号索引 | `code-structure.json`（文件树 + API 清单 + 模块分组） | analyze generateAIContext | 目录级清单，无函数体 |
| 语义检索 | `findRelevantCode`（KG 实体/语义标签/@spec/符号多路融合） | execute 拼原文 / analyze 阅读清单 | ≤20 文件（execute）/ 8~30 清单（analyze） |
| 图谱摘要 | AST 图谱社区 / God nodes / 最短路径 | analyze 插件 | 社区前 8 / God 前 10 / 1 条路径 |

其余内容 AI 通过「阅读清单」自行 Read 原文。CLI 拼「地图和摘抄」，AI 自己翻书。

---

## 2. 六类资产消费矩阵

| 资产 | 文件 | 性质 | 主要消费点 |
|:---|:---|:---|:---|
| **code-structure.json** | `.speccore/cache/` | 符号索引（文件/API/模块目录） | `ai-context-generator.generateAIContext`（analyze） |
| **structured-data.json** | `.speccore/cache/` | 结构化事实卡片（API/Entity/Route/Component + filePath 溯源） | `prompt-builder.shouldInjectCode`（execute）、`buildLayer3ModuleContext`（global analyze Layer 3） |
| **code-graph** | `.speccore/cache/` | AST 源码图谱（符号/依赖关系） | `analyze-graph-plugin`（社区/God/路径摘要） |
| **KG（knowledge-graph）** | 迭代 `_shared/` 等 | spec 文档图（任务/文档/实体关系） | `findRelevantCode` P0 关联、`getFullTaskContext`（execute 任务上下文）、`unifiedSearch.graphContext` |
| **rag-index-*** | `.speccore/cache/` | 文档 RAG（Markdown 标题分块） | `unifiedSearch` 3.1（analyze/change）、`collectKnowledgeContext`（analyze-engine 报告） |
| **TOC** | `.speccore/cache/` | L1 目录（.md 摘要/标签/章节） | `loadGlobalContext` L1（让 AI 知道有哪些文件） |

**边界备忘**（避免重复建设）：

- **code-structure vs structured-data**：前者是「目录 + 符号名」索引（轻、快、全），后者是「带路径/参数/描述的卡片」（重、可注入）。符号检索用前者，卡片注入用后者。
- **findRelevantCode vs unifiedSearch**：前者是代码检索唯一入口（多路融合评分），后者是统一检索层（文档 RAG + 代码切片 + 图谱上下文的门面）。unifiedSearch 的代码支路内部先调 findRelevantCode 定位文件，再对命中文件做切片评分——**切片是 findRelevantCode 的细粒度补充，不是第二条检索线**。
- **KG vs code-graph**：前者是 spec 文档图（任务→文档→实体，人工/分析沉淀），后者是 AST 源码图（符号→依赖，机器扫描）。双轨并存，互不替代。
- **关键词提取唯一真源**：`code-scanner.extractKeywords`（SEMANTIC_MAP 双向扩展 + utils/synonyms 中英映射）。`rag-engine` 已改为复用（v8.3.366），**不得再维护独立词表**——历史教训：独立词表只有中文→中文同义，缺中英映射，中文 query 命中不了英文代码符号。

---

## 3. 各命令的源码消费路径

| 命令 | 拼进 prompt 的源码材料 | AI 自读通道 |
|:---|:---|:---|
| **analyze**（迭代层） | 需求全文（v8.3.366 起 40K 字符配额）+ 符号清单 + RAG 文档块 + 图谱摘要 | findRelevantCode 阅读清单（8~30 文件，不拼原文）+ RAG 命中的代码切片（≤8） |
| **analyze**（全局层） | structured-data 卡片 + Layer 3 模块切片（v8.3.366 起含函数体） | prompt 指令：按模块 Read 源文件函数体 |
| **execute** | 事实卡片注入 + findRelevantCode 命中文件（≤20）拼原文 + KG 任务上下文 | 其余关联文件 Read |
| **taskify/plan/change** | RAG 文档块 + 图谱上下文 | 阅读清单 |

---

## 4. 检索质量的三道防线

1. **中英映射**（utils/synonyms + SEMANTIC_MAP）：中文需求词（登录/订单/库存）→ 英文代码符号（login/order/stock）。
2. **KG 语义标签**（scoreCodeSlices tagSet）：图谱 source-file 实体的 semanticTags 高权重加分。
3. **@spec 注释与 Spec 技术关键词**（findRelevantCode P0）：任务级锚点直连代码。

**已知边界**：检索是符号/关键词匹配（正则 + 同义词扩展），不是真向量语义。对「同义改写跨度大」的查询（如「用户抱怨商品看不到」→ 库存服务）召回有限，靠图谱语义标签与阅读清单兜底。
