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
- 所有命令（analyze/split/execute）、目录名（020-specs/{端}/）、模板目录（templates/{level}/{端}/）均使用此处声明的端名
- 「项目信息」表格的「对应端」列引用此列表中的端名，每行只填一个

**端发现优先级（统一）**：
```
Layer 0: CONSTITUTION.md「## 端列表」章节 ← v6.46.0+ 全局权威
Layer 1: CONSTITUTION.md「对应端」列 ← 旧版回退
Layer 2: 020-specs/ 子目录扫描 ← 目录回退
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
- 任务分支: feature/{Task-ID}
- 发布分支: release/{version}
- 保护分支: main, master, release/*, production
```

**保护分支规则：**
- 在 CONSTITUTION.md 的「保护分支」字段配置，支持精确匹配和通配符（如 `release/*`）
- 保护分支上禁止直接 commit 和 push，只能通过 PR 合并
- 通过 pre-commit 和 pre-push git hook 自动拦截
- 允许从保护分支创建任务分支，但不允许直接在其上工作

**分支创建策略（懒创建 + 依赖合并）：**
- 每个任务的分支在执行前才创建，确保依赖任务的代码已存在
- 有依赖的任务会 merge 依赖分支，拿到前序任务的代码
- 多依赖时可合并多个分支

```
Task-001 执行前:
  checkout main → 创建 feature/Task-001 → 执行

Task-002 执行前（依赖 Task-001）:
  checkout main → 创建 feature/Task-002 → merge feature/Task-001 → 执行
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

#### 2.4.3 双层架构生成规则

**全局文档（020-specs/ 根目录）**
- 来源：所有跨端通用文档的内容
- 包含：ANALYSIS.md, DEPS.md, RISK.md, MONITOR.md, REVIEW.md
- 用途：建立迭代级基线，供所有端共享

**端专属文档（020-specs/{端}/ 子目录）**
- 来源：该端的专属文档内容 + 全局内容中按端分割的片段
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
6. **子任务目录清理**：移除无用的 `src/` 和 `tests/` 目录

**实现位置**：
- `/ts-cli/src/commands/iteration/split.ts`:
  - `createTaskFromSection()`：创建任务级 `.meta/`
  - `createSubtask()`：创建子任务级 `.meta/` + 文档
  - 所有端统一循环，不再区分前后端
- `/ts-cli/src/core/spec-paths.ts`:
  - `parseProjectInfo()`：解析 CONSTITUTION.md 项目信息表
  - `getProjectPathForPlatform()`：获取实际工程路径
- `/ts-cli/src/commands/execute.ts`:
  - `getPlatformSubtaskDirs()`：扫描平铺端目录
  - `--response` 模式：检查文件路径写入实际工程路径

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
1. 优先读 `020-specs/global/{filename}`（新路径）
2. 回退读 `020-specs/{filename}`（旧路径）
3. 不存在则返回 null

已有迭代（旧结构）不受影响，新迭代使用新结构。

#### 影响范围

- **写入侧**（3 个文件）：analyze-engine.ts、analyze.ts、create.ts
- **读取侧**（10 个文件）：split.ts、prompt-builder.ts、dev.ts、status-panel.ts、cli.ts、iteration-from-global.ts、ai-context-generator.ts、next-steps.ts、quality-audit.ts
- **Prompt 侧**：buildMultiDocPrompt() 更新 AI 写入指令

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
├── 020-specs/                     ← 迭代级 analyze 输出（全局基线，双层架构）
│   ├── REQUIREMENT.md            ← 全局：需求规格汇总（含「涉及端」列）
│   ├── ANALYSIS.md               ← 全局：全量需求分析
│   ├── TECH.md                   ← 全局：技术方案（跨端通用）
│   ├── TEST.md                   ← 全局：测试计划（跨端通用）
│   ├── REVIEW.md                 ← 全局：评审清单
│   ├── RISK.md                   ← 全局：风险评估
│   ├── DEPS.md                   ← 全局：依赖清单
│   ├── MONITOR.md                ← 全局：监控方案
│   ├── {端名}/                    ← 各端专属文档（新路径，如 admin/h5/backend）
│   │   ├── TECH.md               ← 该端技术方案（页面路由/组件/接口设计）
│   │   ├── TEST.md               ← 该端测试计划
│   │   └── UI_SPEC.md            ← 该端 UI 规格（仅前端）
│   ├── features/                  ← 功能类规格（旧路径，兼容）
│   │   ├── ANALYSIS.md / TECH.md / TEST.md / ...  ← 按功能模块拆分
│   │   └── REQUIREMENT.md
│   ├── bugs/                      ← 缺陷修复规格
│   ├── refactors/                 ← 重构规格
│   └── research/                  ← 调研规格
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
| 060 | 日志层（plan/schedule/execute 记录）预留 |

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
| analyze | 010-requirements/ 所有 .md → CONSTITUTION 映射 | `020-specs/` 双层架构（全局文档放根目录 + 各端专属文档放 `{端名}/` 子目录） |
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
```

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
| **✅ 纯 CLI** | `schedule`、`daemon`、`context`、`dashboard` | AI 执行或终端跑都行 |
| **✅ 查看/展示** | `about`、`welcome`、`ask` | AI 执行，用 `file://` 或 `present_files` 展示结果 |

**🚫 绝不输出命令文本让用户复制**——那等于把 AI 踢出循环。

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
| **pipeline** | 复杂编排 | plan + schedule + execute |

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
├── .agents/skills/        ← Skills 技能（14 个）
│   ├── speccore-router/SKILL.md   ← 智能路由器
│   ├── spec-ask/SKILL.md          ← Ask 引擎入口
│   ├── spec-analyze/SKILL.md      ← 需求分析
│   ├── spec-change/SKILL.md       ← 需求变更
│   ├── spec-dev/SKILL.md          ← 开发流水线
│   ├── spec-doc2spec/SKILL.md     ← 文档导入
│   ├── spec-execute/SKILL.md      ← 任务执行
│   ├── spec-iteration-create/SKILL.md ← 迭代创建
│   ├── spec-plan/SKILL.md         ← 计划生成
│   ├── spec-reindex/SKILL.md      ← 索引重建
│   ├── spec-spec2doc/SKILL.md     ← 规格导出
│   ├── spec-split/SKILL.md        ← 任务拆分
│   ├── spec-synthesize/SKILL.md   ← 多端综合
│   └── spec-task-create/SKILL.md  ← 任务创建
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

## 7. 调度与守护进程

调度和守护是 SpecCore CLI 自身的 TypeScript 功能，与宿主 AI 无关。

### 7.1 调度生命周期

```
speccore schedule create --at "20:00" --all
  → 写入 .speccore/local/schedule.json
  → 自动安装系统守护 + 启动 daemon（懒启动）

speccore schedule daemon start
  → 启动 Node.js 守护进程（幂等，已运行则跳过）

speccore schedule retry --id <id> [--at "新时间"]
  → 重新调度失败/未触发的任务

speccore schedule cancel --id <id>
  → 取消调度；pending=0 → 自动停 daemon（懒停止）

到点: daemon → speccore execute → CLI 执行（🔒 AI 命令，通过 Prompt/Apply 循环触发）
```

### 7.2 跨平台守护

| 平台 | 机制 | 触发 |
|:---|:---|:---|
| macOS | LaunchAgent (`~/Library/LaunchAgents/`) | RunAtLoad + KeepAlive |
| Linux | crontab | 每 5 分钟 |
| Windows | Task Scheduler (`schtasks`) | 每 5 分钟 |

- `init` / `init --update` 自动安装
- `schedule create` 自动重装到当前项目目录
- daemon 用 `daemonPid` 记录防多开

### 7.3 懒启动/懒停止

- 创建调度 → 自动启动 daemon
- daemon 每 30s 轮询 → 无 pending 任务 → 自动 exit(0)
- 零空闲资源消耗

---

## 8. 命名规范

| 类型 | 格式 | 示例 |
|------|------|------|
| 迭代 | `Iteration-{ID}-{slug}` | `Iteration-001-ecommerce` |
| 任务 | `Task-{ID}` | `Task-001` |
| 目录 | 3位数字步长10英文 | `000-overview` `010-requirements` |
| 需求端 | 小写英文 | `app` `h5` `miniapp` `admin` |
| 分支 | `feature/Task-{ID}` | CONSTITUTION 定义 |

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

> **最后更新**: 2026-08-16 (v6.51.0) — HTML 页面标记系统全量覆盖 + 业务-代码关联图谱 + 端隔离检索

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

### 13.1 两层调度架构

```
┌──────────────────────────────────────────┐
│  Layer 1: WorkBuddy Automation (宿主)    │
│  cron-like 规则 → 定时触发 Skill          │
│  例: 每天 20:00 触发 spec-dev Skill       │
└──────────────┬───────────────────────────┘
               │ 触发
               ▼
┌──────────────────────────────────────────┐
│  Layer 2: SpecCore schedule CLI (项目)   │
│  speccore schedule create/list/daemon     │
│  例: 创建"夜间批量执行"计划               │
└──────────────┬───────────────────────────┘
               │ 调度
               ▼
┌──────────────────────────────────────────┐
│  Layer 3: spec-dev Skill                 │
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

### 13.3 CLI schedule 命令

```
speccore schedule create --name "夜间批量" --at "20:00" --batch-size 3
speccore schedule list
speccore schedule daemon  # 持续运行，等待时间触发
```

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
- Read global/REQUIREMENT.md + global/TECH.md → 全局上下文
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
- CLI 执行前自动读 CONSTITUTION.md 端列表，预创建 `020-specs/global/` + `020-specs/{端}/` 目录
- prompt 新增第 6 步：功能模块涉及端必填，AI 必须在 `global/REQUIREMENT.md` 功能模块清单表填写「涉及端」列
- 关键函数：`preCreateSpecDirectories()` in `analyze.ts`

#### split 命令（v6.49.14+）
- `tryModuleDrivenSplit()` 优先从 `020-specs/global/REQUIREMENT.md` 解析功能模块清单的「涉及端」列
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
analyze AI → global/REQUIREMENT.md 功能模块清单（含涉及端列）
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
- **Phase 1**：生成全局文档（global/REQUIREMENT.md、ANALYSIS.md、DEPS.md 等），建立跨端统一视角
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
   - AI 读取 prompt，生成 global/REQUIREMENT.md、ANALYSIS.md 等
   - 执行 `speccore analyze --apply '{...}' -I meeting-upgrade`

3. **Apply 模式自动推进**（line 471-508）：
   - 写入文件到 020-specs/global/
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
