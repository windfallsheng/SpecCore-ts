## v8.3.221 (2026-09-21) — taskify 骨架硬闸口（堵住「空骨架拆垃圾任务」）

### taskify 骨架硬闸口
- run 流水线 taskify 阶段新增 `detectEmptySkeletonDocs` 检查：020-specs 仍含空骨架时硬停，防止 `--from taskify` 绕过 analyze 闸口后，AI 把「写作要求/质量标准」等骨架文字误当功能模块拆出垃圾任务（假完成）
- `preSplitGate` 的 REQUIREMENT.md、ANALYSIS.md 从 warn 升级为 block（taskify 拆分任务的核心需求上下文，骨架则无法拆分）

### 诊断结论（切分/analyze 断点根因）
- 切分（split-units）逻辑正常（scanUnits 正则能识别功能单元），meeting-system 的 features/ 未产出是「--from taskify 跳过了 split-units」，非切分 bug
- analyze 未落盘根因是 `settings.ai.provider: host`（仅宿主 AI，无自配 LLM）——analyze 在 host 模式依赖宿主 AI 逐文档 `--apply`，全自动流水线无法自动串起落盘循环

---

## v8.3.220 (2026-09-21) — 功能单元来源收敛 + FUNCTION_MAP 依赖降级

### 功能单元权威来源收敛
- 功能单元的权威来源统一为 `010-requirements/features/` 目录（doc2spec --split 产出），FUNCTION_MAP 降为「功能×端映射」参考
- split 的功能单元上下文回退链补 features/ 目录兜底：FUNCTION_MAP → ANALYSIS.md → features/ 目录（三者皆空才无清单）

### FUNCTION_MAP 依赖降级
- `preSplitGate` 的 FUNCTION_MAP 从 block 阻塞降为 warn 警告，缺失/骨架不再阻断 split
- 更新 purpose/impact 注释与骨架说明（「唯一依据」→「参考」）

### 路径 bug 修复
- 修复 2 处 ANALYSIS.md 回退路径漏 `overview/` 目录（`020-specs/ANALYSIS.md` → `020-specs/overview/ANALYSIS.md`），导致骨架场景回退读不到

---

## v8.3.219 (2026-09-21) — 冒烟体系文档沉淀 + 流水线示例补 verify

### 设计文档（docs/DESIGN.md）
- 新增附录章节「冒烟测试体系」：三时机（本地/部署前/部署后）× 范围（full/module）× 配置（settings.smoke）+ 单次 flag
- 覆盖 auth 登录配置、冒烟前自动装配账号、ask 冒烟消歧、测试约定职责归位（需求 vs Spec）等全部技术点

### 说明文档（README.md）
- 「质量验证」章节补充：auth 登录配置、settings.smoke 三时机开关、run/pipeline 单次 flag（--smoke/--skip-smoke/--scope）

### HTML 模板
- 修复 speccore-help / ask-pipeline / ask-guide 里 3 处过时 `speccore split` → `speccore iteration taskify`
- ask-pipeline（5→6 步）、ask-guide（8→9 步）流水线示例在 execute 后补 `verify`（本地冒烟）阶段

---

## v8.3.218 (2026-09-21) — 冒烟意图消歧 + 测试约定归位 Spec

### ask 冒烟节点消歧
- 冒烟不是独立流水线阶段，依附 verify（本地冒烟）/ pipeline（部署前/后冒烟）
- 阶段归一化：本地冒烟/开发完冒烟 → verify；环境冒烟/部署前冒烟/部署后冒烟 → pipeline
- preset develop 关键词补「开发完成/开发完/本地冒烟」，「开发完成，本地冒烟」→ develop（分析→验证）

### 测试约定职责归位（需求 vs 分析）
- 需求文档（PRD）只保留「测试账号」业务约定（账号名+角色），移除 data-testid/seed 等实现细节
- 分析文档（Spec）承载实现约定：TEST.md 骨架补「测试账号约定」，UI_SPEC.md 骨架补「元素标识（data-testid）约定」
- extractTestAccountHint 扫描优先级改为 Spec（020-specs）优先

---

## v8.3.217 (2026-09-21) — 冒烟三时机 × 范围统一设计

### 冒烟测试统一配置（settings.smoke）
- 新增 `settings.smoke` 配置：三时机开关（points.local/pre-deploy/post-deploy）+ 范围（scope）+ 按环境差异化（scope_by_env）
- 三时机对应常规开发流程：①本地冒烟（开发完、提交前）→ ②部署前冒烟（critical 阻断）→ ③环境冒烟（只报告）
- 范围两级：full=全量 / module=当前功能模块（diff 变更级后续）；可按环境差异化（如 production→full、dev→module）

### 三时机接入
- `run` 流水线 verify 阶段接入 points.local 开关 + scope（本地冒烟默认 auto）
- `pipeline` test 阶段接入 points.pre-deploy/post-deploy 开关（build-check 不受冒烟开关影响）

### 单次控制 flag
- `speccore run` / `speccore pipeline` 新增 `--smoke`（强制）/ `--skip-smoke`（跳过）/ `--scope full|module`（单次范围）

### 文档
- config-reference 补 settings.smoke 字段详解

---

## v8.3.216 (2026-09-21) — 冒烟前自动装配登录账号 + 流程级冒烟骨架

### 冒烟前自动装配登录账号（解决「init 时账号还没定」的时序矛盾）
- 账号填充时机从「init 占位」改为「开发完成、即将冒烟」的时间点自动装配，不再要求 init 时就填死账号密码
- 新增 `describeAuthResolution`：冒烟前解析账号/密码来源（环境变量 > 明文 > 需求文档「测试账号」章节），生成「改了什么/缺什么」清单，自动模式同样打印告知用户
- 新增 `extractTestAccountHint`：从需求/Spec 文档「测试账号」章节自动提取账号名（email 优先）
- 装配结果仅内存生效（不落盘、密码不进 git），账号未就绪时冒烟登录自动降级跳过，不阻断页面可达性检查

### 业务流程冒烟骨架自动生成
- `generateFlowScenariosFromSpec`：从需求/Spec 文档「业务流程」章节提取含 `→` 的流程步骤，生成流程级场景骨架（导航 + data-testid 占位断言），精确 fill/click 由 AI/人工补充

### 文档
- testing-guide 补流程级场景骨架生成说明

---

## v8.3.215 (2026-09-21) — 冒烟测试登录账号配置 + 开发完成后自动冒烟

### 冒烟测试登录账号配置（auth）
- 新增 `auth` 测试登录配置：冒烟/视觉测试执行前自动登录，登录态在所有场景间共享
- 支持凭据来源双模式：环境变量引用（`username_env`/`password_env`，推荐，密码不落库）+ 明文兜底
- 可配置登录页、账号/密码/提交按钮选择器、登录成功判定（URL 含片段 / 元素出现）
- 配置位置：测试场景文件（`.speccore/tests/*.yaml`）或环境配置（`.speccore/environments/*.yaml` 的 `tests.auth`），测试配置优先级更高
- 首次开发项目的账号来源约定：PRD 定义测试账号 → 后端 seed 脚本创建默认账号 → 环境配置引用

### 开发完成后自动冒烟
- `run` 流水线 verify 阶段在代码验证（编译+Lint+单测）后，若存在 `.speccore/tests/smoke.yaml` 自动追加 UI 冒烟（local 环境优先，失败降级为 warning 不阻断）

### 元素标识规范
- 文档新增 data-testid 命名规范（`{模块}-{页面}-{元素}`），业务流程验证依赖稳定元素标识
- 环境配置模板（`update-env-configs`）补 `tests.auth` 字段，新项目 init 即带登录配置

### 文档
- testing-guide.md 新增 §4.5 登录账号配置 + §4.6 元素标识规范
- config-reference.md 补 `tests.auth` / `tests.local_urls` 字段详解

---

## v8.3.193 (2026-09-19) — 命令名彻底改名 iteration taskify

### 命令名彻底改名
- `iteration split` 命令名彻底改为 `iteration taskify`（不再保留 split 过渡 alias）
- 同步更新：run.ts 流水线 cmd/execSync、intent 识别 id、ask 知识库、help/error-diagnosis/doctor/init 提示、docs 文档（9 处 `speccore split` → `speccore iteration taskify`）
- ask 识别「拆分任务」→ `iteration taskify`；「从拆分到开发」→ `run --from taskify`；「从切分功能单元到开发」→ `run --from split-units`（两概念彻底区分）

### 仓库同步
- 新增 GitHub 远程 `github`（windfallsheng/SpecCore.git），与 gitee 双远程同步

---

## v8.3.191 (2026-09-19) — ask 流水线编排 + 命名根治 + 端类型统一

### ask 自然语言编排流水线
- run 流水线意图：识别 preset 名（部署/交付/全流程/开发流程等）+ 起止点（"从 X 到 Y"）
- 口语阶段名归一化：部署→pipeline、提交→pr、切分功能单元→split-units、拆分/任务化→taskify
- run 意图带 preset/起止点时优先编排（runForced 跳过歧义检测与中置信度确认）
- 新增 spec preset（doc2spec→taskify，导入需求→任务化生成 Spec）

### 命名根治：拆分任务 split → taskify
- 「切分功能单元」（split-units）与「拆分任务」（split）命名混淆，拆分任务阶段 key 改为 taskify
- 命令 iteration split 保留（加 alias taskify 过渡），流水线 key/ask 归一化/handoff/闸口/preset 全部切 taskify

### 端类型判定统一
- 新增 resolvePlatformType 统一入口，优先级：PROJECT.yaml type > CONSTITUTION.md 端列表 > 目录名正则兜底
- 消除 analyze/spec-skeleton 多处硬编码正则判定与两层判定不一致

### 切分与澄清职责分离
- 切分功能单元独立成流水线步骤（split-units），澄清纯化（req-doc 不再自己切分）

### 命令审计与文档完善
- 命令审计：3 组重叠命令标注层级（status/progress/dashboard、done/archive/retro、impact/merge-check/diff）
- help 首页突出常用命令 10 个，弱化完整命令数
- README/文档修正过时命令数量（26+/20）与 dev 命令残留
- HTML 模板清理（6 个死模板）
- config-reference 补 optional_steps 三态开关 + pipelines 命名流水线
- analyze --from-code 暴露 --out-dir 指定反推需求产出目录

## v8.3.190 (2026-09-19) — 澄清三态开关 + 命名流水线 + js-yaml 根治

### 澄清语义重构与三态开关

- **clarify 改名 req-doc**：澄清语义重新归属，消除「澄清=需求文档化」歧义
- **澄清三态开关**：`optional_steps.clarify` 支持 `auto`（按专业度判定）/ `on`（强制）/ `off`（跳过）
- **三层覆盖**：命令 flag（`--clarify`/`--skip-clarify`）> ask 意图 > 配置 `optional_steps` > 默认 `auto`
- **质量报告解耦**：7 维度审查（`assessRequirementQuality`）无论澄清模式都生成 `QUALITY_REPORT.md` 留痕，跳过澄清也有报告

### 流水线重构与命名流水线

- **dev 拆分为 run + next**：`run`=唯一执行入口，`next`=进度指引（阶段检测 + 下一步 + 闸口提醒）
- **命名流水线体系**：`init` 移出流水线；内置 preset（`full`/`import`/`analyze`/`develop`/`deliver`/`deploy`/`docs`）；用户自定义 + 默认（`settings.pipelines`）
- **默认流水线收窄**：`pr`/`done`/`spec2doc` 为独立收尾操作，默认 `develop`（analyze→verify）
- **plan 单任务跳过**：Task ≤ 1 跳过 plan，多任务才列计划
- **optional_steps 扩展**：clarify/verify/pipeline/pr/done/spec2doc 六个非必要步骤可配置

### 配置解析根治

- **parseYaml 换 js-yaml**：根治「回读不对称」——flow 数组、列表占位项 `- # 注释`、空数组 `[]` 三类序列化 bug 一次性解决（读用 js-yaml、写保留手写注释）

### 意图识别与 subagent 修复

- 复合意图「分析+拆分」正确进入 pipeline 编排
- 端级/功能级 subagent 映射缺口修复（`requirement-analyzer-admin-web` 等归一化映射）
- req-doc 补 subagent 调度

## v8.3.188 (2026-09-19) — 配置升级链路修复与诊断增强

### 配置升级链路修复（5 个缺陷）

- **`detectConfigDiffFromFile`**：新增读磁盘原始 YAML 检测缺失字段（`loadConfigWithMeta` 深度合并补全会掩盖缺失，导致 `detectConfigDiff` 永远看不到磁盘缺的新字段）
- **`upgradeConfig`/`upgradeProjectConfig` 提前返回修复**：不再因 schema_version 匹配 + warnings 空就提前返回，改用 fileDiff 判断，同版本缺失字段也能补全
- **toYaml 数组序列化改用块级写法**：flow 写法 `['desktop']` 自定义 parseYaml 不认识，回读成字符串导致 `devices.map` 崩溃；新增 `normalizeStringArray` 兼容历史脏数据
- **toYaml `pipeline`/`with_code` 缩进修复**：原 4 空格误嵌套进 `review`，改为 2 空格
- **toYaml `schema_version` 取消注释**：原被注释导致 validateConfig 持续报「必须是数字」

### 诊断增强

- **`doctor` 规范库一致性检查**：从「只查目录存在性」升级为「对比内置 defaults 清单」，能发现缺失的内置文件（如新增 agent / `_INDEX`），给出补全建议
- **`update` 版本过旧警告**：检测「项目初始化版本 > 当前 CLI 版本」时警告 CLI 过旧，提示先升级 CLI 再执行 upgrade

## v8.3.187 (2026-09-19) — 诚实降级体系与工程加固

### 通用行为准则优化（4 → 7 条）

- **`prompt-builder.ts` 抽取 `UNIVERSAL_BEHAVIOR_RULES` 常量**：原 4 条硬编码准则扩展为 7 条，融合业界最佳实践
  - 新增「先读后写」「最小改动」「主动澄清」「破坏性操作先确认」
  - 「不假装确定」合并进「降级到诚实」，升级为「事实/推断/猜测」三档置信度
  - 依据：Claude Code 官方系统提示词、Anthropic Prompt Library、Karpathy 12 规则

### 死代码清理

- 删除 8 个零引用命令文件（2009 行）：backup/context/current/global-status/health/import/lifecycle/status
- 删除 `understandIntent` + `synthesizeIntent` 死代码（321 行，askEngine 才是 ask 主入口）

### 功能接线（A 类孤儿模块）

- **`refresh` 接入 `detectStaleGlobalDocs`**：刷新后检测全局文档过期（≥1 天才报告），提示增量重建
- **`search --global` 接入 `searchGlobalKnowledge`**：全局层 RAG+图谱语义检索，区别于关键词搜索
- **`dev` 接入 `generateHandoff`**：13 阶段流水线关键阶段成功后生成阶段交接摘要（13→6 阶段映射）

### bug 修复（meeting-system 实测）

- **`config --project` 选项缺失**：cli.ts 补注册 `--project`，修复 doctor 提示的升级命令报 unknown option
- **`detectConfigDiff` 开放式字典误判**：`git.branch_types` 等 Record 字段不再误报用户自定义键为 removed
- **`detectStaleGlobalDocs` 过期 0 天噪音**：只报告过期 ≥1 天的文档
- **版本比较误报**：about/update 改用 semver 比较，不再把旧版本（如 v8.3.161 < 182）误报为「新版本」

---

## v8.3.182 (2026-09-18) — 文档路由显式化与白名单精细化

### 文档路由表（r4）

- **`analyze.ts` `DOC_ROUTING` 常量**：在代码中显式定义每类文档的归属路径
  - 索引类 → `overview/`（FUNCTION_MAP.md / INTERACTION_MAP.md / PLATFORMS.md / CLARIFY.md / API_CONTRACT.yaml）
  - 内容类 → `{feature}/overview/`（REQUIREMENT.md / ANALYSIS.md / TECH.md / RISK.md / DEPS.md / REVIEW.md / MONITOR.md / DEV_GUIDE.md）
- **迭代层 prompt 新增「文档路由表」章节**：以 Markdown 表格形式明确每类文档的路由目标、文档类型和说明
- **明确 ANALYSIS.md 归属**：属于内容类，严禁放在 `020-specs/overview/` 下

### 白名单分两级（r3）

- **`prompt-builder.ts` 白名单重构**：从单一白名单改为「核心白名单 + 条件白名单」两级结构
  - 核心白名单（CORE_EXTRA_FILES）：CONTEXT.md、ERROR_CODES.md（所有任务都加载）
  - 条件白名单（getPlatformExtraFiles）：按平台类型动态加载（backend → SCHEMA.md；frontend → COMPONENT_TREE.md / ROUTES.md / STATE.md）
- 白名单外文件统一收集后输出 `console.warn` 提示

### 预算调整与报错优化（r5）

- **`CONSTITUTION.md` 预算从 4000 放宽到 6000 字**
- **报错提示优化**：超限报错时给出具体的精简建议（删除过时注释、链接外部文档、使用表格等）

### 模块澄清自动引入全局澄清（r1）

- **`analyze.ts` 上下文加载逻辑**：加载模块澄清时，自动检测并确保全局澄清 `020-specs/overview/CLARIFY.md` 在最前面

---

## v8.3.181 (2026-09-18) — 架构细化与上下文控制加固

### 澄清产出位置：两级澄清结构（f1）

- **`hasValidClarifiedDocs` 修复严重 bug**：删除错误的 `return false;`，恢复 source 更新检测逻辑
- **`analyze.ts` clarify 标记写入逻辑**：支持新路径格式 `[CLARIFY:overview/CLARIFY.md]` 和 `[CLARIFY:{feature}/overview/CLARIFY.md]`，兼容旧格式 `[CLARIFY:requirements/xxx.md]`
- **`analyze.ts` 需求澄清验证**：改用 `hasValidClarifiedDocs()` 统一检测（支持两级路径 + 旧路径兼容）
- **`analyze.ts` 上下文加载**：优先加载 `020-specs/overview/CLARIFY.md`（全局）和 `020-specs/{feature}/overview/CLARIFY.md`（模块），其次兼容旧路径
- **`analyze.ts` prompt 更新**：Phase 0 clarify prompt 和 confirm prompt 中的路径说明更新为新格式
- **`AGENTS.md` 项目结构**：明确 `020-specs/overview/`（索引类）和 `020-specs/{feature}/overview/`（内容类）的职能边界

### 子任务文件白名单（f2）

- **`prompt-builder.ts` `scanUserCustomFiles`**：从“无差别扫描”改为“白名单模式”
- 只加载 `ALLOWED_EXTRA_FILES` 白名单内的文件（SCHEMA.md, TEST.md, REVIEW.md 等）
- 白名单外文件被忽略并输出提示

### 按文件类型细分预算（f4）

- **`prompt-builder.ts` `FILE_BUDGETS`**：按文件类型设置不同预算上限
  - 必须完整（报错不截断）：CONSTITUTION.md(4000), REQ.md(2000), API_CONTRACT.yaml(2000)
  - 可以截断（截断+警告）：TASK.md(1500), TECH.md(3000), DEV_GUIDE.md(2000), 其他(1000)
- **`loadExtraSpecs`** 和 **`loadAllTaskContext`** 中均使用细分预算
- 兜底模式预算放宽到 2 倍

---

## v8.3.180 (2026-09-17) — 文档同步更新

### 设计文档全面同步 v8.3.177-179 架构变更

- **`docs/DESIGN.md` 新增 §1.5.18 上下文控制架构**：
  - 元数据基础设施（`_matrix.md` + `feature-metadata.ts`）
  - 总览两阶段生成（skeleton → full）
  - 计划阶段 CLI 算图（`plan-graph.ts`）
  - 执行阶段只传契约规则 + 阅读清单模式
  - 跨阶段上下文传递（Handoff）+ 会话边界

- **`docs/DESIGN.md` Agent 阶段表**：新增 `overview-skeleton`（6K）和 `overview-full`（8K）

- **`docs/overview.md` 核心流程图**：`analyze → split` 改为 `analyze(overview) → analyze(功能单元) → split`

- **`docs/command-reference.md`**：补充 `analyze --scope=overview --phase=skeleton|full` 和 `plan --prompt` CLI 算图说明

- **`docs/task-directory-design.md`**：功能单元标识章节补充 `_matrix.md` 说明

- **`AGENTS.md` 项目结构**：`features/{feature}/` 下新增 `_matrix.md`

- **`README.md`**：同步更新核心流程图和目录结构

---

## v8.3.179 (2026-09-17) — 兜底模式上下文控制修复

### 修复 `loadAllTaskContext` 过量加载关联任务文档

- **关联任务只传契约**（`src/core/prompt-builder.ts`）：
  - 之前：从知识图谱获取依赖任务后，读取关联任务 `00-specs/` 下**所有 .md 文件**（REQ.md/TECH.md/DEV_GUIDE.md 等）
  - 之后：只读取关联任务的 `API_CONTRACT.yaml`（优先 `_shared/`，回退 `00-specs/`）
  - 上下文减少：关联任务从可能数千行 → 最多 400 行契约

- **020-specs 端规格改为阅读清单**（`src/core/prompt-builder.ts`）：
  - 之前：兜底模式下直接加载 `020-specs/{feature}/{platform}/` 下所有 .md 文件全文
  - 之后：改为阅读清单模式，只列文件路径和 feature 名，不加载全文
  - 避免兜底模式下加载过多其他 feature 的端规格导致上下文爆炸

---

## v8.3.178 (2026-09-17) — 计划阶段 CLI 算图 + 执行阶段只传契约

### 计划阶段增强（上下文控制）

- **新增 `src/core/plan-graph.ts`**：CLI 算图模块
  - `buildPlanGraph()`：扫描任务 → 构建依赖图 → 拓扑排序 → 关键路径
  - `computeBatches()`：按依赖关系分层为执行批次
  - `findCriticalPath()`：计算耗时最长的依赖链
  - `detectResourceConflicts()`：检测同一人在同一批次的资源冲突
  - `generatePlanJson()`：生成 100-200 行结构化 JSON

- **增强 `speccore plan --prompt`**：
  - 任务数 >= 5 时，自动启用 CLI 算图模式
  - CLI 先算图（依赖图、批次、关键路径、冲突检测）
  - 输出结构化 JSON 给 AI，AI 只做判断（优先级冲突、资源冲突、风险）
  - 上下文从 3000+ 行（任务文档）→ 100-200 行（JSON 元数据）

### 执行阶段增强（只传契约，不传实现）

- **修改 `speccore execute --prompt` 的上下文加载**：
  - 同一 Task 的其他端：只加载 `API_CONTRACT.yaml`，不再加载 `REQ.md`/`TECH.md`
  - 上游依赖任务：只加载 `_shared/API_CONTRACT.yaml`（契约），不加载需求文档
  - 本 Task 的共享契约：保持加载 `_shared/API_CONTRACT.yaml`
  - 每个子任务上下文控制在 500-600 行，不累积

### 核心设计原则

- **计划阶段**：CLI 做确定性计算（图算法），AI 做判断（冲突、风险）
- **执行阶段**：只传接口契约，不传代码实现
- **任务间传递**：`API_CONTRACT.yaml` 是唯一的跨任务信息载体

## v8.3.177 (2026-09-17) — 元数据扫描 + 总览生成（上下文控制核心）

### 功能单元元数据基础设施

- **新增 `_matrix.md`**：每个功能单元自动生成端覆盖矩阵
  - 记录 `platforms`（涉及端）、`dependencies`（依赖）、`apis`（接口）
  - 由 `doc2spec --split` 自动创建，支持后续人工调整
  - 作为总览生成的唯一元数据来源

- **新增 `src/core/feature-metadata.ts`**：元数据扫描器
  - `scanFeatureMetadata()`：扫描 `features/` 目录，读取每个单元的 `_matrix.md`
  - `extractSummary()`：只读 `README.md` 前 2 句，不读全文
  - `calculatePlatformCoverage()`：计算端覆盖统计
  - `findCrossFeatureApis()`：识别被多个功能引用的接口

### 总览生成（两阶段）

- **新增 `speccore analyze --scope=overview`**：
  - `--phase=skeleton`（默认）：生成骨架总览
    - 功能地图（Mermaid 依赖图）
    - 端覆盖总览表
    - 功能单元清单确认
    - 输出控制在 40-60 行
  - `--phase=full`：生成完整总览
    - 系统架构图（服务拓扑 + 数据流）
    - 跨功能单元接口清单
    - 实际依赖关系表
    - 输出控制在 60-80 行

- **支持 `--apply` 接收 AI 结果**：自动解析 `[DOC:OVERVIEW]` / `[DOC:ARCHITECTURE]` 标记，写入 `020-specs/overview/`

### 核心设计原则

- 总览只处理 **50-80 行 JSON 元数据**，不碰功能单元完整内容
- CLI 做确定性提取（扫描 `_matrix.md`），AI 做理解性生成（写描述 + 画图）
- 总览是 **关系图 + 索引**，不是内容汇总

## v8.3.176 (2026-09-17) — 功能单元拆分 + 变更追踪 + Handoff 传递摘要

### 功能单元拆分（P2-11 上下文控制基础）

- **新增 `doc2spec --split`**：转换文档后自动按 `##` 标题结构拆分为功能单元
  - 扫描标题结构识别功能单元边界
  - 过滤非功能章节（附录、术语表等）
  - 每个单元写入 `features/{unit}/README.md`
  - 生成 `.meta/source` 来源标记
  - 生成 `features/INDEX.md` 单元索引

### 功能单元管理

- **新增 `speccore units` 命令**：
  - `units --list`：列出所有功能单元（含状态、来源）
  - `units --edit <单元>`：查看单元内容摘要
  - `units --merge "A,B"`：合并多个单元，原单元标记 deprecated
  - `units --delete <单元>`：删除单元（备份到 `.trash/`）

### 变更追踪

- **每个功能单元支持变更履历**：
  - `CHANGELOG.md`：记录每次变更的类型、说明、时间
  - `.meta/versions/`：每次变更前自动备份旧版本
  - 合并/删除操作自动记录变更历史

### Handoff 传递摘要生成器

- **新增 `src/core/handoff-generator.ts`**：
  - `generateHandoff(from, to, iteration)`：阶段完成后生成传递摘要
  - 支持 analyze→split / split→plan / plan→execute / execute→review / review→done
  - 摘要存储在 `.speccore/local/handoffs/`（不提交 Git）
  - 篇幅限制：analyze→split ≤60 行，plan→execute ≤150 行

---

## v8.3.175 (2026-09-16) — 全面清理历史兼容性代码

### 清理目标

- **移除所有版本号注释**：代码中不再出现 `vX.Y.Z+:` 格式的版本标记
- **移除向后兼容描述**：所有"向后兼容""旧版""旧格式""旧结构""旧路径""旧布局"等描述统一清理为当前态表述
- **删除向后兼容命令**：`arch-update`（已合并到 `update --arch`）
- **删除迁移指南**：`docs/migration-guide.md` / `docs/migration-guide.en.md`（无历史包袱，无需迁移）
- **精简 CHANGELOG**：只保留 v8.3.169 及之后的近期版本
- **删除旧 RELEASE 文件**：`RELEASE-v6.89.0.md` / `RELEASE-v8.3.46.md`

### 影响范围

- `src/cli.ts` — 删除版本注释 + 删除 `arch-update` 命令 + 清理 welcome panel 旧路径回退
- `src/commands/` — 清理 analyze.ts / execute.ts / split.ts / change.ts / synthesize.ts / update.ts / init.ts 等文件中的版本注释和向后兼容逻辑
- `src/core/` — 清理 spec-paths.ts / prompt-builder.ts / state.ts / knowledge-graph.ts / verify-engine.ts / task-paths.ts / git-integration.ts 等文件
- `docs/` — 删除 migration-guide.md / migration-guide.en.md
- `RELEASE-*.md` — 删除 v6.89.0 和 v8.3.46 的发布说明

---

## v8.3.174 (2026-09-16) — P1 概念收敛：质量门禁分层 + Subagent 重命名 + 模式参数收敛 + 文档拆分

### P1-4: Subagent 重命名 — SessionAgent 标记统一

- 全局替换 `[SPECCORE_SUBAGENT]` → `[SPECCORE_SESSION_AGENT]`（Headless 标记模式对应 SessionAgent 概念）
- 更新 `agent-adapter.ts` 标记输出、`AGENTS.md` 标记说明
- 保留代码内部变量名不变（内部实现细节）

### P1-5: 分析策略统一

- 新文档 `ARCHITECTURE.md` 只保留三层分析理论模型
- 四层扫描/流式分析合并到 Pipeline 阶段描述中

### P1-6: 模式参数收敛 — 配置优先

- **`execute.ts`**: `strict` / `pipeline` / `withCode` 未传入时从 `.speccore.yml` 读取
- **`unified-config.ts`**: `settings` 新增 `pipeline?: boolean` 和 `with_code?: boolean` 配置项
- CLI `--strict` / `--pipeline` / `--with-code` 保留（向后兼容），配置文件可设置默认值

### P1-7: 质量门禁分层 — 默认4项 + 严格模式12项

- **`verify-engine.ts`**: `runQualityGate()` 新增 `strict?: boolean` 参数
- 默认执行 4 项关键检查：编译检查（阻塞）、单元测试、API 契约合规、规格文档质量
- `strict=true` 时附加 12 项：Lint、依赖完整性、安全扫描、Spec 一致性、DEV_GUIDE 合规、Schema 一致性、测试用例覆盖、评审项合规、部署清单、错误码一致性、知识图谱依赖一致性、代码文件非空
- **`execute.ts`**: 两处 `runQualityGate` 调用传入 `strict: options.strict`
- **`conflict-detector.ts`**: `detectConflicts` 签名更新，支持 `strict` 透传

### P1-8: 配置文件收敛

- `.speccore.yml` 的 `settings` 段扩展：支持 `pipeline` / `with_code` / `validation.strict_mode`
- 模式参数默认值从 CLI 移入配置文件（CLI 仍可覆盖）

### P1-9: 文档拆分

- 新增 `docs/ARCHITECTURE.md`（~205 行）：核心架构当前态（全局组织 + 规范数据库 + 迭代目录 + 命名规范）
- 新增 `docs/COMMANDS.md`（~135 行）：命令参考（流水线 + 速查 + 标记体系）
- `DESIGN.md`（6214 行）保留为历史完整设计文档

---

## v8.3.173 (2026-09-16) — P0 架构收敛：路径回退消除 + 防乱写机制精简

### P0-1: 路径收敛 — 删除所有回退分支

- **`spec-paths.ts`**: `resolveGlobalSpecPath()` 删除 `global/` 和根目录回退，只保留 `overview/`
- **`knowledge-graph.ts`**: 删除 `020-specs/platforms/{端}/` 旧路径兼容扫描
- **`analyze.ts`**: 删除 `docs['FUNCTION_MAP.md'] || docs['overview/'] || docs['global/']` 三重回退
- **`analyze.ts`**: 删除 `sanitizeSpecDirectories` 自动调用（保留函数作为后续 `speccore migrate` 工具）
- **`split.ts`**: 删除 `specContents['DEV_GUIDE.md'] || specContents['overview/DEV_GUIDE.md']` 回退
- **`audit.ts`**: 删除 `apiMap['overview/'] || apiMap['global/'] || apiMap['REQUIREMENT.md']` 三重回退
- **`spec-skeleton.ts`**: 删除旧结构兼容（无功能模块前缀的 platform 文档）
- **`prompt-builder.ts`**: 删除根目录 `.md` 文件读取回退，只读 `overview/`
- **`state.ts`**: 删除迭代根目录旧布局兼容（`030-tasks/` 不存在时回退到迭代根目录）

### P0-2: 防乱写机制收敛 — 简化 Prompt 路径约束

- **`analyze.ts`**: 简化路径提示，从 "不要创建目录 + 写入正确路径 + 不要绕过 --apply" 收敛为 "文件已预创建，只覆盖已有文件"
- **`split.ts`**: 简化 "⚠️ 绝对禁止" 段落为 "⚠️ 约束"，合并路径约束为单条指令

---

## v8.3.171 (2026-09-16) — 补全遗漏项 + SDK 优化

### 补全：change 命令集成 SDK 调度

- **change.ts `--prompt` 模式**：补上 `[SPECCORE_SUBAGENT: impact-analyst]` 标记 + `dispatchSubagent` SDK 调度尝试
- 统一触发条件：非 TTY + Qoder 环境
- 统一失败回退：自动回退到 Prompt 模式

### 优化：Qoder SDK 适配层

- **`buildQoderAgentDefinition` tools 字段**：新增 `'Agent'` 工具，支持子 Agent 递归调度
- **`mapToQoderAgentName` 映射表扩展**：覆盖 SpecCore 核心子 Agent（spec-analyzer、spec-executor、task-decomposer、schedule-planner、impact-analyst、code-reviewer、security-reviewer）→ Qoder 内置 Agent
- **`dispatchSubagent` 单例优化**：QoderSdkAdapter 实例复用，避免每次调用重复动态 import SDK

---

## v8.3.170 (2026-09-16) — SDK 调度覆盖全部 Prompt 模式命令

### 扩展：全部 Prompt 模式命令集成 SDK 调度

- **`execute`**: `runPromptMode` 末尾集成 `dispatchSubagent`，支持 `spec-executor` / `spec-executor-{platform}` 子 Agent SDK 调度
- **`split`**: `--prompt` 模式集成 `dispatchSubagent`，支持 `task-decomposer` 子 Agent SDK 调度
- **`plan`**: `--prompt` 模式集成 `dispatchSubagent`，支持 `schedule-planner` 子 Agent SDK 调度
- **统一模式**：非 TTY + Qoder 环境下触发，失败时无缝回退到 Prompt 模式
- **统一输出**：SDK 成功时输出 `[SPECCORE_RESULT]` + 文件变更列表 + 执行结果摘要

### 说明

- `ask` 命令不直接集成：ask 输出的是 `[SPECCORE_EXEC: speccore xxx]` 命令路由，由目标命令（analyze/split/plan/execute）在执行时自行触发 SDK 调度
- Pipeline 推进点（`[SPECCORE_STEP_DONE]` + `[SPECCORE_NEXT_STEP]`）保持原有标记模式，避免 CLI 内部状态机与 SDK 异步执行冲突

---

## v8.3.169 (2026-09-16) — Qoder Agent SDK 集成：真正的多 Agent 调度

### 新增：Qoder Agent SDK 集成 (`src/core/agent-adapter.ts`)

- **安装**: `@qoder-ai/qoder-agent-sdk` 作为 `optionalDependencies`
- **QoderSdkAdapter 真正实现**（替代之前的空壳预留接口）：
  - 使用动态 `import()` 加载 SDK，未安装时自动回退 Headless
  - `dispatchSubagent()` 通过 `query({ prompt, options })` 直接调用 Qoder Agent
  - 构建 `AgentDefinition` 自定义子 Agent（`spec-analyzer`、`spec-executor` 等映射到 Qoder 子 Agent）
  - 消费 SDK 消息流，收集文本回复和文件变更列表
  - 内置 Agent 名称映射（`general-purpose` / `Explore` / `Plan`）
- **新增 `dispatchSubagent` 统一调度入口**：
  - Qoder 环境 → 调用 `QoderSdkAdapter.dispatchSubagent()`
  - 其他环境 → 返回 `null`（由外层 AI 通过 `[SPECCORE_SUBAGENT]` 标记接管）
- **Headless 始终兜底**：任何 SDK 调用失败自动回退到文本标记模式

### 新增：多工具适配支持 (`src/core/ask-host-ai.ts`)

- **扩展 `HostAiTool`**: 新增 `cursor` / `windsurf` / `claude` / `codebuddy`
- **修复 `detectHostAi`**: `.qoder` 目录现在正确返回 `'qoder'`（之前错误返回 `'trae'`）
- **精确目录映射**: `DIR_TO_TOOL` 按目录名精确映射到对应工具
- **新增 `QODER_SESSION` 环境变量检测**

### Analyze 命令集成 (`src/commands/analyze.ts`)

- **Pipeline 模式 SDK 调度**: 在输出 Prompt 之前，尝试通过 `dispatchSubagent` 直接调度子 Agent
- **仅在非 TTY + Qoder 环境下触发**，失败时无缝回退到 Prompt 模式
- **输出结果摘要**: SDK 执行成功后输出 `[SPECCORE_STEP_DONE]` + `[SPECCORE_RESULT]` + 文件变更列表

### 架构设计

- **AgentAdapterMode 扩展**: `'headless' | 'qoder-sdk' | 'cursor-sdk' | 'windsurf-sdk' | 'claude-sdk' | 'codebuddy-sdk'`
- **AgentAdapter 接口扩展**: 新增可选 `dispatchSubagent()` 方法
- **`createAgentAdapter()` 自动检测**: 根据 `detectHostAi()` 结果自动选择适配器（Qoder → QoderSdkAdapter，其他 → HeadlessAdapter）

---

