# SpecCore 版本历史

---

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

当前版本：**v5.11.0**
