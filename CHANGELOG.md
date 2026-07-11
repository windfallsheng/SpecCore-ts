# SpecCore 版本历史

---

## v5.3.0 (2026-07-11) — 最新

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

当前版本：**v5.3.1**
