# SpecCore 核心架构

> 本文档描述 SpecCore 的组织规范和流程设计，是代码实现的目标态。
> 当前态：v8.3.174 — 路径收敛后唯一正确路径

---

## 1. 全局工程组织

### 1.1 工程级目录结构

```
workspace/
├── .speccore/GLOBAL/              ← 跨工程全局索引（唯一一份）
│   ├── INDEX.md                   ← 所有迭代的摘要索引（自动生成，≤1500字）
│   ├── OVERVIEW.md                ← 项目全景描述
│   ├── ARCHITECTURE.md            ← 跨工程的服务依赖关系
│   ├── TECH_STACK.md              ← 技术栈概览
│   ├── CODE_INDEX.md              ← 代码路径索引
│   ├── GLOSSARY.md                ← 术语定义表
│   ├── CHANGELOG.md               ← 全局变更日志
│   ├── PROTOTYPE_INDEX.md         ← 原型索引
│   ├── PROJECTS/                  ← 各工程独立目录
│   ├── REQUIREMENTS/              ← 跨工程需求合并视图
│   ├── BASELINES/                 ← 基线快照
│   ├── synthesis/                 ← [synthesize --full 生成] 跨端综合文档
│   └── {端名}/                    ← [synthesize --full 生成] 各端分析文档
│
├── project-a/                     ← 独立工程 A
│   ├── .speccore/                 ← 工程自己的配置（独立）
│   │   ├── CONSTITUTION.md        ← 技术栈、工程列表、需求端映射
│   │   └── local/context.json     ← 当前活跃迭代
│   ├── src/                       ← 源码
│   └── Iteration-NNN-name/        ← 期次
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

---

## 2. 规范数据库分层架构（v6.84.0+）

`.speccore/` 目录不仅是配置存储，更是 **AI 可读的规范数据库**。五层规范结构，所有层均在初始化时自动创建，支持用户自定义覆盖。

### 2.1 五层结构

| 层级 | 目录 | 用途 |
|------|------|------|
| **AGENTS** | `.speccore/AGENTS/` | 专业角色定义（产品分析师、安全审查员等） |
| **RULES** | `.speccore/RULES/` | 编码规范（TypeScript、React、API 设计等） |
| **COMMANDS** | `.speccore/COMMANDS/` | 命令模板（PR 审查、变更影响分析等） |
| **SKILLS** | `.speccore/SKILLS/` | 可复用技能（部署、数据库迁移、缓存等） |
| **HOOKS** | `.speccore/HOOKS/` | 生命周期钩子（pre-execute、post-execute） |

### 2.2 AGENTS 层

**职责**：定义各命令/阶段下激活的专业 AI 角色。

**核心机制**：
- **规范数据库**：每个角色是一个 Markdown 文件，含 `activations` frontmatter 定义激活规则
- **混合调度器**：注册表（`_INDEX.md` 显式配置）+ 自描述（`.md` 文件自含激活规则）双轨合并
- **特化版本解析**：`product-analyst` → `product-analyst-backend`（platform）→ `product-analyst-finance`（industry）的回退链

### 2.3 RULES 层

**职责**：按语言/框架分层的编码规范，在 `execute` 阶段按技术栈自动注入 prompt。

**核心机制**：
- **技术栈匹配**：从 `CONSTITUTION.md` 解析 `language`、`framework`、`database`、`cache`、`frontend`，匹配对应规范文件
- **优先级排序**：高优先级规范先注入（如 security=100 > typescript=100 > react=90）
- **用户自定义覆盖**：`.speccore/RULES/` 下的同名文件覆盖内置默认

---

## 3. 迭代目录结构（唯一正确路径）

```
Iteration-NNN-name/
├── 000-overview/                  ← 进度总览
├── 010-requirements/              ← 按功能组织（非按端）
│   ├── sources/                   ← 原始 PRD
│   ├── features/{feature}/README.md  ← 功能需求（每个功能一份，描述所有端）
│   ├── bugs/{bug}.md              ← 扁平缺陷文档
│   ├── refactors/{refactor}.md    ← 扁平重构文档
│   ├── research/{topic}.md        ← 扁平调研文档
│   └── assets/
├── 020-specs/                     ← 迭代级 analyze 输出（全局基线）
│   ├── overview/                  ← 迭代级全局文档
│   │   ├── REQUIREMENT.md
│   │   ├── ANALYSIS.md
│   │   ├── TECH.md
│   │   └── ...
│   ├── {feature}/                 ← 功能模块目录
│   │   ├── overview/
│   │   └── {端名}/                ← 各端专属文档
│   └── PLATFORMS.md               ← 端列表元数据
├── 030-tasks/                     ← 所有开发任务（按类型分层）
│   ├── feature/Task-NNN-slug/
│   ├── bugfix/Task-NNN-slug/
│   ├── refactor/Task-NNN-slug/
│   └── research/Task-NNN-slug/
│       ├── .meta/                 ← 任务元信息
│       ├── _shared/               ← 跨平台共享契约
│       ├── 00-specs/              ← 任务级核心规格
│       ├── {platform}/            ← 所有端平铺
│       └── .issues.md             ← 问题追踪
└── STAFFING.md
```

### 3.1 目录编号

| 编号 | 含义 |
|:--:|------|
| 000 | 总览信息 |
| 010 | 输入层（需求） |
| 020 | 分析层（规约） |
| 030 | 任务层（开发） |

### 3.2 核心原则

**需求按功能组织，分析双层架构（全局+各端），任务按端+功能创建。**

```
文档:  010-requirements/user-auth/README.md
分析:  020-specs/overview/REQUIREMENT.md（全局） + 020-specs/user-auth/{端}/TECH.md（端专属）
任务:  030-tasks/feature/Task-001-user-auth/
       ├── 00-specs/TECH.md ← 从对应端的 TECH.md 提取
       ├── booking-service/  ← 后端子任务（平铺）
       ├── admin-web/        ← 管理端子任务（平铺）
       └── h5-mobile/        ← H5 端子任务（平铺）
```

### 3.3 双层规格解耦

`020-specs/` 是**迭代级全局基线**（双层架构：全局文档 + 各端专属），`Task/00-specs/` 是**任务级切片**。

| 操作 | 写入位置 | 说明 |
|:---|:---|:---|
| 迭代级 `analyze`（无 `--task`） | `020-specs/` | 迭代全量分析，建立基线 |
| 任务级 `analyze --task Task-001` | `Task-001/00-specs/` | 任务独立分析，**不覆盖迭代基线** |
| `split` | `Task-NNN/00-specs/` | 从迭代需求切片，创建任务骨架 |

---

## 4. 临时工作区架构（v8.3.0+）

**解决场景**：用户需要澄清/调研与当前迭代无关的内容，或尚未创建迭代时就需要处理需求。

### 4.1 目录结构

```
.speccore/local/workspace/
├── inbox/                    ← 原始输入暂存
│   └── {YYYY-MM-DD-HHMMSS-xxxx}/
│       ├── source.md
│       └── meta.json
├── clarify/                  ← clarify 产出
│   └── {id}/
│       └── PRD.md
├── research/                 ← research 产出
│   └── {id}/
│       └── REPORT.md
└── index.json                ← 条目索引
```

### 4.2 设计原则

- **不污染迭代目录**：临时内容完全隔离在 `.speccore/local/workspace/`
- **可提升**：确认有价值的临时产出可以通过 `--promote` 提升到迭代层
- **自清理**：`workspace clean` 自动清理过期条目

---

## 5. 命名规范

| 类型 | 格式 | 示例 |
|------|------|------|
| 迭代 | `Iteration-{ID}-{slug}` | `Iteration-001-ecommerce` |
| 任务 | `Task-{ID}` | `Task-001` |
| 目录 | 3位数字步长10英文 | `000-overview` `010-requirements` |
| 需求端 | 小写英文 | `h5-mobile` `admin-web` `booking-service`（由 CONSTITUTION.md 定义） |
| 分支 | `feature/Task-{ID}` | CONSTITUTION 定义 |

---

> 完整历史设计文档见 [DESIGN.md](DESIGN.md)
