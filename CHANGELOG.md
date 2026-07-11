# SpecCore 版本历史

---

## v4.9.0 (2026-07-11) — 最新

### 🆕 新增
- **`speccore update`**：更新 Task 属性（status/priority/assignee），事务保护
- **交互模式升级**：`--interactive` 接入 inquirer 真实交互（模式选择/任务多选/确认）
- **SDD 方法论文档**：`docs/SDD方法论.md` — 痛点分析/TDD-BDD对比/五大实践/完整工作流
- **英文工作空间指南**：`docs/workspace-organization.en.md`
- **集成测试**：`tests/unit/core/integration.test.ts` — 7 个真实文件系统测试案例

### 📝 文档
- 命令参考手册中英文同步更新（42 命令 + 5 个 v4.7~v4.8 新增命令说明）

### 📊
- **命令总数**：43 个（新增 update）
- **测试**：9 文件 / 140 用例

---

## v4.8.0 (2026-07-11)

### 🆕 新增
- **分批执行**：`speccore execute --all --batch-size=3` 自动分批 + 上下文隔离
- **断点续传**：`speccore execute --resume` 从上次中断处继续
- **执行状态追踪**：`.speccore/local/execution-state.json` 批次进度持久化
- **Git 工作流整合**：`speccore current` 分支↔任务映射、Commit/PR 生成
- **Git Hooks**：`speccore hooks install` 安装 pre-commit + pre-push
- **协作锁**：`src/core/task-lock.ts` 30 分钟超时

### 📝 文档
- 新增 `docs/工作空间组织.md`：目录结构 + 多工程协作指南

---

## v4.7.0 (2026-07-11)

### 🆕 新增
- **交互式确认**：`speccore execute --interactive`
- **进度反馈**：实时进度条 + 任务状态 + 耗时统计
- **Zod 错误友好翻译**：`src/core/error-feedback.ts`
- **操作日志**：`.speccore/logs/` 记录所有关键命令
- **自动备份**：`speccore backup` (create/list/restore)
- **Shell 补全**：`speccore completion [bash/zsh]`

---

## v4.6.0 (2026-07-11)

### 🆕 新增
- **迁移命令**：`speccore migrate` Shell v3.x → CLI v4.x 自动迁移（检测/补充全量层/platforms.yaml/context.json升级）
- **迁移指南**：`docs/migration-guide.md` 迁移步骤 + 前后对比

### 📝 文档
- 新增 `docs/使用指南.md`：文件操作安全指南（安全区/高风险区/慎改区 + 实用速查表）

### 📊 统计
- **命令总数**：40 个（新增 migrate）
- **测试**：8 文件 / 133 用例

---

## v4.5.0 (2026-07-11)

### 🆕 新增
- **i18n 国际化引擎**：`SPEC_LOCALE=en-US` 中英切换，默认中文
- **语言资源**：`src/locales/zh-CN.json` + `en-US.json`（9 模块 + 通用词条）
- **CLI 全局选项**：`speccore --lang=en-US init`

---

## v4.4.0 (2026-07-11)

### 🔄 增强
- **全部命令事务化**：`execute`、`plan`、`archive` 使用 FileTransaction 保护多文件操作
- 5 个关键写操作命令（sync/change/execute/plan/archive）全部具备事务性保证

---

## v4.3.0 (2026-07-11)

### 🆕 新增
- **FileTransaction 模块**：write/delete/move 原子操作 + commit/rollback
- **sync/change 事务化**：多文件修改失败自动回滚

---

## v4.2.0 (2026-07-11)

### 🆕 新增
- **yaml-parser 测试**：22 tests，纯函数覆盖率 96.42%
- **核心模块测试扩展**：global-layer +11 / validator +9

### 📊 统计
- 6 文件 / 104 用例 → 7 文件 / 123 用例

---

## v4.1.0 (2026-07-11)

### 🆕 新增
- **Vitest 测试框架**：替代 Jest，8 文件 133 用例
- **Zod 数据模型**：Task / Iteration / Platform / Context Schema（100% 覆盖率）

---

## v4.0.0 (2026-07-09)

### 🆕 新增功能
- **多平台任务管理**：`speccore new-task --platforms=web,h5,miniapp`
- **动态平台添加**：`speccore platform-add --name=tablet --tech="React Native"`
- **上下文查看**：`speccore context --task=Task-001` 查看 Spec 文件加载状态和依赖链
- **索引自动更新**：`speccore index-update` 扫描需求文档重建 GLOBAL/INDEX
- **平台配置**：`.speccore/config/platforms.yaml`，由 `init` 自动创建
- **WorkBuddy 集成**：`speccore init` 自动创建 `.workbuddy/skills/speccore/SKILL.md` 和项目记忆文件

### 🔄 增强
- `speccore execute`：新增 `--platform=<name>` 按前端平台过滤
- `speccore progress`：新增 `--platform=<name>` 按平台统计
- `speccore import`：新增 `--scope=<all|core|api>` `--ignore=<pkgs>` `--update`
- `speccore init`：新增 `platforms.yaml` 配置创建，增强 WorkBuddy 集成
- 意图识别引擎：31 种意图类型（新增 new_task / platform_add / index_update / context）

### 📝 文档
- 新增 `docs/快速开始.md`：5 分钟上手 + 场景速查 + 目录结构
- 新增 `docs/命令参考.md`：39 个命令完整参数 + 31 种意图映射 + 别名速查
- 新增 `docs/工具适配说明.md`：WorkBuddy 集成原理 + 工作流程 + 安全检查
- 新增 `CHANGELOG.md`：完整版本历史
- README 重构：精简结构 + 引用 docs/ 详细文档

### 📊 统计
- **命令总数**：39 个（原 35 + 新增 4）
- **意图类型**：31 种（原 27 + 新增 4）
- **发布包**：212 个文件，154.3 kB

---

## v3.0.0 (2026-07-05)

### 🆕 新增功能
- **多项目全量层（Global Layer）**：GLOBAL/ 目录管理跨项目需求索引、架构、技术栈
  - GLOBAL/INDEX.md — 全量需求索引（需求 ID + 项目 + 状态 + 版本 + 关联期次）
  - GLOBAL/OVERVIEW.md / ARCHITECTURE.md / TECH_STACK.md / GLOSSARY.md 等
  - GLOBAL/PROJECTS/ — 按项目隔离的需求文档
- **全链路可追溯**：需求→Task→代码双向追踪，变更历史追加模式
- **P0/P1/P2 高级功能**：
  - P0：`speccore impact` — 变更影响分析
  - P1：`speccore dashboard` — 可视化仪表盘（Chart.js HTML），`speccore baseline` — 版本基线管理
  - P2：`speccore audit` — AI 智能审计（重复/歧义/冲突/孤立需求检测）
- **rename 命令**：`speccore rename` 重命名期次/任务，自动更新所有关联引用

### 🔄 增强
- `speccore import`：重构支持 `--project --type --path`，扫描代码填充 GLOBAL/PROJECTS/
- `speccore init`：新增 GLOBAL/ 全量层 8 个模板文件 + PROJECTS/_template
- 新增 4 个全量层命令：iteration-from-global / sync-global / global-status / history
- 意图识别引擎：新增 10 种意图类型（全量层 + P0/P1/P2 + rename）

### 📊 统计
- **命令总数**：35 个（原 26 + 新增 4 个全量层 + 4 个 P0/P1/P2 + rename）

---

## v2.0.0 (2026-07-05)

### 🆕 新增功能
- **意图识别引擎**：12 种意图类型，100+ 关键词匹配，置信度分级
- **智能入口**：`speccore spec "<自然语言>"` — 自动识别意图并路由到对应命令
- **12 个新命令**：spec / goal / bugfix / research / change / sync / handover / retro / template-add / help / demo / welcome
- **上下文感知**：自动读取 `.speccore/local/context.json`，智能填充期次/执行人/当前任务

### 🔄 增强
- 所有命令添加别名（ex/pl/ch/cg/sy/st/hl/rp/ta/hp/dm/wc 等）
- `speccore execute`：执行预览 + `--force` 跳过
- `speccore progress`：按人员/Task/类型统计
- `speccore init`：增强 SETTINGS.md 模板，新增 POST_COMPLETION.md 规则文件
- 上下文接口扩展：新增 9 个字段（iterationStatus / pendingTasks / customAliases 等）

### 📊 统计
- **命令总数**：26 个（原 14 + 新增 12）

---

## v1.0.0 (2026-07-05)

### 🆕 初始版本
- **14 个核心命令**：init / import / iteration create / iteration split / task new / plan / execute / validate / archive / progress / status / health / report / config
- **核心引擎**：context（上下文管理）/ state（状态管理）/ yaml-parser（YAML 解析）/ template-engine（模板渲染）/ validator（合规检查）
- **内置模板**：Spring Boot Controller/Service/Test、NestJS Controller
- **多格式输出**：JSON / Markdown / HTML
- **npm 发布**：全局安装 `npm install -g speccore`

---

## 版本号说明

- **主版本号**：重大架构变更或功能重构
- **次版本号**：新增命令或功能模块
- **修订版本号**：Bug 修复或小幅增强

当前版本：**v4.9.0**
