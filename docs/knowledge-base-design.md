# SpecCore 知识库设计方案

> 参考淘天物流团队《复杂业务团队的 AI Coding 交付实践》设计
> 文章地址： [https://mp.weixin.qq.com/s/aopO-3KO9lenKF5WHhBD7w](https://mp.weixin.qq.com/s/aopO-3KO9lenKF5WHhBD7w) 
> 状态：设计阶段，待实现

---

## 一、核心理念

**不追求 100% 全 AI 交付**，而是让 AI 负责分析实现、人聚焦关键判断。

知识库的价值：让团队经验从 owner 脑子里、历史 PRD 里、聊天记录里、线上问题里，逐步变成可检索、可路由、可验证的知识资产。

---

## 二、与现有机制的区别

| 机制 | 什么时候产生 | 内容 | 谁写 |
|------|------|------|------|
| Constitution | init 时手动填 | 技术栈、命名规范 | 人一次性写 |
| Templates | 写需求时用 | 格式模板、pattern | 人写，偶尔更新 |
| Retro（踩坑） | done 后自动生成 | "这个任务哪里做得好/不好" | AI 分析 + 人 review |
| **知识库** | 持续积累 | "这个业务域是干什么的、有什么坑" | 人写骨架 → AI 回补 |

---

## 三、目录结构

```
.speccore/knowledge/
├── ROUTING.md              # 顶层关键词 → 知识入口映射表
├── main/                   # 全局业务通用知识
│   ├── INDEX.md
│   ├── order-lifecycle.md
│   ├── payment-states.md
│   └── reconcile-rules.md
├── applications/           # 应用范围内的知识
│   ├── payment/
│   │   ├── INDEX.md        # 应用导航
│   │   ├── application-payment.md   # 应用总览
│   │   ├── domain/
│   │   │   └── product/
│   │   │       └── reconcile.md     # 对账主干流程
│   │   ├── base/
│   │   │   ├── apis.md
│   │   │   ├── messages.md
│   │   │   └── models.md
│   │   └── tech/
│   │       └── constraints.md
│   └── order/
│       └── INDEX.md
├── candidate/              # 候选知识暂存区（待 review 确认）
│   └── reconcile-v2-dependency.md
├── personal/               # 个人研发经验和踩坑记录
└── template/               # 强约束的写作模板
    ├── app-tmpl.md
    ├── flow-tmpl.md
    ├── rule-tmpl.md
    └── tech-tmpl.md
```

---

## 四、ROUTING.md 设计（核心）

### 格式

```markdown
# 知识库路由表

| 关键词 | 知识入口 | 类型 | 优先级 |
|--------|---------|------|-------|
| 支付 | applications/payment/INDEX.md | app | 1 |
| 对账 | payment/domain/product/reconcile.md | domain | 2 |
| 订单 | main/order-lifecycle.md | global | 1 |
| reconcile | payment/domain/product/reconcile.md | domain | 2 |
| 退款 | payment/domain/product/refund.md | domain | 1 |
```

### 匹配规则

1. 从 ask 输入中提取中/英文关键词
2. 遍历 ROUTING.md 表格，匹配优先级最高、关键词最长的条目
3. 若命中 app 类型 → 先读 INDEX.md 再读具体文件
4. 若命中 domain/global 类型 → 直接读具体文件

---

## 五、渐进式加载流程

```
speccore ask "做支付对账"
  │
  ├─ ① 提取关键词: [支付, 对账, reconcile]
  │
  ├─ ② 查 ROUTING.md
  │     "支付" → applications/payment/INDEX.md
  │     "对账" → payment/domain/product/reconcile.md
  │
  ├─ ③ 读层级 INDEX.md 确认文件列表
  │     payment/INDEX.md → [app-overview.md, apis.md, domain/...]
  │
  └─ ④ 只加载命中文件的内容（通常 < 3000 tokens）
        加载: payment/app-overview.md + reconcile-flow.md
        不加载: order/, inventory/, shipping/（无关）
```

---

## 六、知识回补流程

### 从哪里来

| 来源 | 触发时机 | 内容 |
|------|------|------|
| Retro 分析 | done 后自动 | "这个任务踩了什么坑，怎么避" |
| Issue 记录 | execute 中遇到 | 技术/需求层面的阻塞问题 |
| PR Review | PR 合并后 | 代码层面的最佳实践 |
| 人工录入 | 任何时间 | 团队经验总结 |

### 流转路径

```
retro/issue/pr 中发现
  → AI 生成 candidate/{name}.md
    → 标注: 可信度/来源/关联需求/待确认项
    → 人工 review
      ├─ 确认 → 合并到 main/ 或 applications/
      ├─ 修改 → 更新 candidate 后重新 review
      └─ 拒绝 → 删除或移到 personal/
```

---

## 七、与 ask 引擎集成

当前 ask 引擎的 Command KB 是硬编码的——改为：

```
先 ROUTING 定位 → 读取命中知识片段 → 动态注入 prompt 上下文
```

AI 框架指令示例：

```
你是 SpecCore AI 助手。当前项目中：
- 支付应用承担: 收单、对账、退款（详见 payment/INDEX.md）
- 对账流程: 双阶段异步架构，前置校验必须放在主流程入口（详见 reconcile-flow.md）
- 当前期次: Iteration-001-电商平台V1

请基于以上上下文回答用户问题。
```

---

## 八、知识库的三种生成方式

### 1. 人工初始化

```bash
speccore knowledge init
  → 问: "这个项目有哪些应用？各自负责什么？"
  → 生成 applications/xxx/INDEX.md 骨架
```

### 2. AI 回补（自动）

每次 `done` → `retro` 发现值得记录的经验：
- 对账接口依赖 payment-gateway 的 v2，v1 已废弃
- 订单状态从 FEATURE_ORDER_STATE_100 取，不能自己算

AI 写入 `candidate/`，人工 review 确认后合并。

### 3. 代码扫描（辅助）

```bash
speccore knowledge scan --from-code
  → 提取 API 路由、数据模型、消息队列 topic
  → 写入 apps/xxx/base/ 作为接口索引
```

---

## 九、实施计划

| 阶段 | 内容 | 优先级 | 状态 |
|------|------|:--:|:--:|
| P0 | 创建 `.speccore/knowledge/` 骨架目录 + ROUTING.md | 🔴 | 待实现 |
| P0 | `speccore knowledge init` 交互式初始化 | 🔴 | 待实现 |
| P1 | ask 引擎接入 ROUTING，动态注入知识到 prompt | 🔴 | **已完成**（v6.7.0 改为接入知识图谱） |
| P1 | retro 自动回补到 candidate/ | 🟡 | 待实现 |
| P2 | `speccore knowledge scan --from-code` | 🟡 | 部分完成（code-index 已存在） |
| P2 | candidate → official review 流程 | 🟡 | 待实现 |

## 十、知识图谱实现（v6.5.0 ~ v6.7.0）

> 知识库设计的最初设想是 `.speccore/knowledge/` 人工维护的知识体系，实际落地时先用**知识图谱**（自动从文件系统构建）实现了类似能力。

### 已实现的机制

| 设计目标 | 实现方式 | 版本 |
|---------|---------|------|
| 业务知识可检索 | `knowledge-graph.json` 自动扫描需求/规格/任务 | v6.5.0 |
| 知识关联可路由 | 实体关系：`implements`/`specifies`/`subtask_of`/`depends_on`/`references` | v6.5.0 |
| Ask 引擎动态注入 | `enrichWithKG()` 在本地引擎后加载图谱匹配实体 | v6.7.0 |
| 知识过期检测 | `decay-detector.ts` 对比 `integrity.json` 快照 | v6.5.0 |
| 经验自动回补 | retro → candidate/（设计阶段，待实现） | — |

### 与代码索引的关系（v6.8.0 已打通）

```
知识图谱（knowledge-graph.ts）          代码索引（code-scanner.ts）
    │                                        │
    ├─ 需求实体 REQ-001                      ├─ 源码文件 auth/login.ts
    ├─ 规格实体 SPEC-001                     ├─ API 路径 /api/auth/login
    ├─ 任务实体 Task-001                     ├─ 导出函数 validateCredential
    └─ 关系: Task-001 implements REQ-001     └─ Git: auth 模块常与 user 模块联动
         │                                        │
         └────────── ✅ v6.8.0 已打通 ─────────────┘
              findRelevantCode() 加载知识图谱关联的代码文件
              + @spec 注释扫描 + Git 联动 + 关键词语义扩展
```

### 统一检索层（v6.8.0 新增）

```
                    用户查询（自然语言/关键词）
                           │
                    unifiedSearch(query)
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   文档 RAG            代码切片            知识图谱
   rag-engine.ts       unified-retrieval.ts knowledge-graph.ts
        │                  │                  │
        ▼                  ▼                  ▼
   Top-5 chunks      Top-5 slices       关联实体链
   + 结构化摘要      + JSDoc+签名       + 关系图
        │                  │                  │
        └──────────────────┼──────────────────┘
                           ▼
                    assembleUnifiedContext()
                           │
                           ▼
                    统一 Prompt 注入格式
                    (文档60% + 代码20% + 图谱20%)
```

### 检索层三层对比

| 维度 | 文档 RAG | 代码切片 | 知识图谱 |
|------|---------|---------|---------|
| **数据来源** | `010-requirements/` `020-specs/` | `src/**/*.ts` | 文件系统扫描 |
| **粒度** | 标题级 chunk (~200-500字) | 函数/类级 slice (~50行) | 实体级 (REQ/SPEC/Task) |
| **检索方式** | 关键词相关性评分 | 名称+签名匹配 | 实体ID+关系链 |
| **何时构建** | analyze 阶段 | 实时切片（不缓存） | reindex / sync --global |
| **何时消费** | buildPrompt | unifiedSearch | ask 引擎补参 |
| **优势** | 语义相关、有摘要 | 精准到函数、有注释 | 关系推断、影响链 |

## 十一、RAG 轻量级检索（v6.8.0）

> 不引入向量数据库，纯关键词 + 结构化摘要实现轻量级 RAG。

### 核心设计

| 组件 | 实现 | 说明 |
|------|------|------|
| **分块** | `chunkByHeaders()` | 按 `##`/`###`/`####` 标题分块，保留上下文 |
| **摘要** | `extractSummary()` | 表格→表头+前3行 / 列表→前5项 / 段落→前2句 |
| **关键词** | `extractKeywords()` | 中文2-4字词 + 英文标识符 + CamelCase拆分 + 语义扩展 |
| **评分** | `scoreChunk()` | 标题+3分/词 / 摘要+2分 / 关键词+2.5分 / 内容+1分 |
| **索引** | `saveRagIndex()` | `.speccore/cache/rag-index*.json`，scope 隔离 |
| **刷新** | `refreshRagIndex()` | mtime 检测 + 增量重建 + 新增文件扫描 |

### Scope 隔离

| Scope | 索引文件 | 覆盖范围 | 触发时机 |
|-------|---------|---------|---------|
| Task | `rag-index.json` | 任务目录 `00-specs/` `_shared/` | `analyze --task` |
| Iteration | `rag-index-{name}.json` | `020-specs/` | `analyze --iteration` |
| Global | `rag-index-global.json` | 所有迭代 specs + GLOBAL/ | `sync --global` |

### 与代码索引的协作

```
文档检索（RAG）              代码检索（切片）
    │                            │
    ├─ "登录功能技术方案"         ├─ "export function login()"
    ├─ "用户认证接口设计"         ├─ "export class AuthService"
    └─ "权限校验规则"             └─ "export interface LoginDTO"
         │                            │
         └────── 统一检索层 ──────────┘
                    │
                    ▼
            "登录功能" 查询
            → 返回: 技术方案 + 代码实现 + 关联任务
```

## 十二、全局知识沉淀（v6.8.0）

### 设计哲学

**不追求完美文档，追求"能检索到"。**

- 迭代完成后自动聚合所有 specs 到全局索引
- 生成轻量级 `GLOBAL/SUMMARY.md`（功能清单 + 技术要点 + API + 已知问题）
- 支持手动编辑，不完美没关系，下次 sync --global 覆盖更新
- 全局 RAG 索引使跨迭代查询成为可能

### 触发流程

```
sync --global --direction to_global
    │
    ▼
syncGlobalKnowledge()
    │
    ├── 扫描所有迭代的 020-specs/
    ├── 扫描所有任务的 00-specs/ + _shared/
    ├── buildRagIndex() → rag-index-global.json
    ├── generateGlobalSummary() → GLOBAL/SUMMARY.md
    └── buildKnowledgeGraph() → knowledge-graph.json (刷新)
```

### SUMMARY.md 结构

```markdown
# 全局知识概览

## 功能清单
- 用户认证系统（v6.8.0）
- 订单管理系统（v6.8.0）

## 技术要点
- 后端: NestJS + TypeORM + PostgreSQL
- 前端: React + Zustand + Ant Design

## API 概览
- POST /api/auth/login
- GET /api/orders

## 已知问题
- 订单并发锁待优化（Issue #42）
```
