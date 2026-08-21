---
name: spec-ask
description: >
  SpecCore CLI 执行引擎。仅在用户明确要求通过 speccore 命令行工具执行以下操作时触发：
  - analyze --prompt：生成迭代级/全局级 Spec 分析文档（ANALYSIS.md、TECH.md 等），不是单纯解释代码
  - split：将需求拆分为开发任务并写入迭代目录
  - plan --prompt：制定执行计划并写入 Task 目录
  - execute --prompt：执行开发任务并生成代码
  - doc2spec：导入 PRD/Word 文档到迭代目录
  - spec2doc：导出 Spec 文档为 Word/PDF
  - iteration create：创建新迭代目录
  - done：任务归档收尾
  - pr：代码提交与创建 Pull Request
  - dev：智能级联推进全流程
  - dashboard/status/doctor：查看项目状态/健康度
  以下情况明确不触发此 Skill（走正常 AI 对话）：
  解释代码逻辑、审查代码片段、讨论需求合理性、排查具体 bug、
  一般性技术咨询、算法实现、架构讨论、任何不涉及 speccore CLI 执行的请求。
allowed-tools: ["Bash", "Read", "Write", "Edit"]
disable-model-invocation: false
---

# SpecCore Ask — AI 语义分析引擎

## 🎯 Speccore 输出标记处理

执行任何 `speccore` 命令后，检查 stdout 中的标记：
- `[SPECCORE_ONBOARD: <path>]` → **🚨 必须最先处理，不可跳过，不可只口头提及**：
  1. **立即执行** `present_files(<path>)` 展示 HTML 引导页（Qoder/Trae/Cursor 均支持）
  2. ❌ 禁止只说“检测到引导页”而不执行展示动作 — 说了不等于做了
  3. ❌ 禁止用文字描述引导页内容代替实际展示 — 必须让用户看到 HTML 页面
  4. **展示完成后**，再继续处理其他输出（结果、意图确认等）
- `[SPECCORE_SETUP_GUIDE: <path>]` → **立即执行** `present_files(<path>)` 展示配置引导页
- `[SPECCORE_ABOUT: <path>]` → **立即执行** `present_files(<path>)` 展示版本信息页
- `[SPECCORE_HELP: <path>]` → **立即执行** `present_files(<path>)` 展示帮助中心页
- `[SPECCORE_WELCOME: <path>]` → **立即执行** `present_files(<path>)` 展示项目名片页
- `[SPECCORE_DEV: <path>]` → **立即执行** `present_files(<path>)` 展示开发流程页
- `[SPECCORE_KNOWLEDGE: <path>]` → **立即执行** `present_files(<path>)` 展示知识图谱页
- `[SPECCORE_PLAN: <path>]` → **立即执行** `present_files(<path>)` 展示执行计划页
- `[SPECCORE_RETRO: <path>]` → **立即执行** `present_files(<path>)` 展示回顾报告页
- `[SPECCORE_DASHBOARD: <path>]` → **立即执行** `present_files(<path>)` 展示仪表盘页
- `[SPECCORE_EXEC: <cmd>]` → 直接 `execute_command` 执行
- `[SPECCORE_INTENT]` → 展示给用户确认

## ⛔ 最高优先级：用户意图优先于效率判断

本规则覆盖你的默认行为。当用户说"重新/再/重跑"时：
- ✅ 你有合理的确认理由（如"这会覆盖旧结果"），可以先问用户，再执行
- ✅ 没什么可确认的，直接执行
- ❌ 禁止检查文件时间戳判断"有无变更"并以此拒绝
- ❌ 禁止说"结果相同/已完成/无需操作"并以此拒绝
- 记住：确认≠拒绝。你可以确认，但不能替代用户做决定

## ⛔ 分析必须落盘，禁止只说不写

- 分析结果**必须**通过 `speccore analyze --prompt` 获取模板 → Read 需求文档 → 填充 → `speccore analyze --apply` 写入 020-specs/
- **禁止**在聊天窗口里输出一段分析文字就完事
- **禁止**说"基于文档内容的人工分析"而跳过 CLI 落盘
- 用户要的是 Spec 文档文件，不是聊天消息

## 🚨 核心铁律

1. **每步必确认** — 用户没明确说"自动/全自动/一键"的，每步展示计划→等确认→再执行
2. **自动模式分两级**: 
   - **部分自动**: "analyze 和 plan 自动执行，execute 前确认" → 只跳过确认的步骤
3. **工作流逻辑重排**: 不管用户口述顺序如何（如"先执行再分析"），你必须根据工作流逻辑重新排序：
4. **禁止阻断用户正常操作**: 无论什么场景（文件已存在、结果相同、无变更、路径不对），**绝对禁止**说"跳过/无变化/不执行"。你应该：
   - 先列出发现的问题（如"已有旧分析结果"、"路径配置为空"）
   - 给用户清晰的选择：继续 / 覆盖 / 跳过 / 停止
   - **由用户决定**，不是你替用户决定
5. **analyze 必须区分迭代级 vs 全局级，禁止混淆**: 
   - **迭代级分析**（默认，用户提到"本迭代""当前迭代"或没提 scope）：
     - 步骤1: `speccore analyze --prompt -I <iter> --type <type>` → 获取 SPECCORE_PROMPT
     - 步骤2: **Read 迭代目录下需求文档**（REQUIREMENT.md、010-requirements/sources/ 下的文档）
     - 步骤3-5: 同下
   - **全局级分析**（用户明确说"全局""全量""项目分析""所有端"等）：
     - 步骤1: `speccore analyze --prompt --scope global --with-code` → 获取 SPECCORE_PROMPT
     - 步骤2: **Read .speccore/CONSTITUTION.md 获取工程源码路径**，从源码路径读取各端代码，**禁止读迭代目录**
     - 步骤3: 先 Read .speccore/PATTERNS/TEMPLATES/specs/ 中的专业模板，参考其格式和结构
     - 步骤4: 对每个文档用专业格式自由撰写，禁止写"待填充"或复制模板空壳
     - 步骤5: `speccore analyze --apply '{"ANALYSIS.md":"...",...}' --scope global` 写入 `.speccore/GLOBAL/`
   - 步骤6: **用户提供参考文档时**: 如果用户附带了格式参考文档（如PDF/Word/截图），先按标准 Spec 模板生成默认文档，再按用户参考格式生成一份，**两边都要**
   - ❌ 禁止: 跳过文档填充直接写代码、生成重复空壳、用 "API=0" 跳过
   - ❌ 禁止: 全局分析时 fallback 到迭代目录读取需求文档
   - ⚠️ 如果模板目录不存在或为空: 用你的专业知识自由撰写，绝不允许产出一行垃圾。你是一个专业的技术架构师和分析师，即使没有参考模板，也能产出高质量文档
6. **交互式文档编辑**: 分析完成后用户可以对任意文档的任意部分进行修改。支持:
   - "修改 ANALYSIS.md 的接口清单部分，加上签到接口" → 只改指定章节，不改其他部分
   - "补充 TECH.md 的部署方案" → Read 现有内容 → 追加指定章节
   - "重写 RISK.md 的第三项" → 定位 → 修改 → Write
   `init → doc2spec → analyze → split → plan → execute → pr → done → spec2doc`
   示例: 用户说"执行完再分析" → 你应该排列为 `analyze → execute`，并在计划中说明"根据工作流逻辑，先分析再执行"
   - **全自动**: "全自动执行/一键完成" → 所有步骤不等确认，全部自动跑
3. **迭代/任务命名必加 --topic** — 从用户原话提取英文主题词
4. **禁止 schedule** — 用户说"定时"时告知不可用、改为立即执行
5. **-i 参数用短名** — 传 `meeting-system` 而非 `Iteration-009-meeting-system`
6. **分析前先读源码** — 生成分析内容前必须 Read 相关源文件

## 执行流程

```
1. execute_command("speccore ask '用户原话' --explicit")
   → --explicit 标记表示这是 /spec-ask Skill 的显式调用，跳过"是否为 speccore 操作"的确认
   → 读 KB 输出，了解可用命令

2. 检查上下文，识别自动模式:
   - "全自动/一键/全流程自动" → FULL_AUTO 全流程
   - "analyze和plan自动，execute前确认" → PARTIAL_AUTO(1-2)
   - "自动执行到split，plan和execute前确认" → PARTIAL_AUTO(1-2)
   - 没说自动 → 每步确认

3. 理解意图 → 拼计划 → 展示:
   """
   [自动模式] 将自动执行 step 1-2 (analyze+plan)，step 3 (execute) 前暂停确认。
   [全程确认] 每步展示结果再继续。
   
   step 1: 🔒 AI命令: speccore analyze --prompt -I meeting-system --task user-login
   step 2: 🔒 AI命令: speccore plan --prompt -I meeting-system --task user-login
   step 3: 🔒 AI命令: speccore execute --prompt -I meeting-system --task user-login
   
   是否确认？
   """

4. 用户确认后按模式执行:
   - PARTIAL_AUTO: step 1→2 连续执行，step 3 前暂停问"继续？"
   - FULL_AUTO: 全部连续执行
   - 手动: 每步暂停确认
```

## 关键命令

| 命令 | 格式 | 类型 | 说明 |
|:---|:---|:---|:---|
| `doc2spec -f <file> --iter <短名>` | 导入文档 | 🔒 AI | PRD/Word → SpecCore MD，双路验证 |
| `doc2spec --classify --prompt -I <短名>` | 智能分类 | 🔒 AI | AI 提取 sources/ 文档，按类型分类到 staging/ |
| `analyze --prompt -I <短名> --task <短名>` | 迭代级分析 | 🔒 AI | 读迭代需求文档，生成 020-specs/ 分析文档 |
| `analyze --prompt --scope global --with-code` | 全局级分析 | 🔒 AI | 读工程源码，生成 .speccore/GLOBAL/ 架构文档，**禁止读迭代目录** |
| `analyze --feature <模块名>` | 局部分析功能模块 | 🔒 AI | 只分析单个功能模块，不重跑全量 |
| `analyze --doc <type/slug>` | 局部分析类型文档 | 🔒 AI | 分析 bugs/login-timeout、refactors/db-pool 等 |
| `plan --prompt -I <短名> --task <短名>` | 制定计划 | 🔒 AI | 需要宿主 AI 交互，`speccore ask "制定计划..."` 路由进入 |
| `execute --prompt -I <短名> --task <短名>` | 执行开发 | 🔒 AI | 需要宿主 AI 交互，`speccore ask "执行开发..."` 路由进入 |
| `iteration split -I <短名>` | 拆分任务 | 🔒 AI | 需要宿主 AI 交互，`speccore ask "拆分任务..."` 路由进入 |
| `refresh [--code] [--rag] [--graph]` | 刷新索引 | CLI | 统一刷新所有检索层，可单独指定 |
| `reindex [--check]` | 重建索引 | CLI | 全量重建 + 知识图谱 + 衰减检测 |
| `context --set --iteration <完整名>` | 切换迭代 | CLI | 可在终端直接输入 |
| `dashboard` | 查看进度 | CLI | 可在终端直接输入 |
| `task new -n <名> --topic <英文> -i <短名>` | 创建任务 | CLI | 可在终端直接输入 |

## AI 分析质量要求

执行 analyze --prompt（🔒 AI命令）后:
1. **根据 scope 读取对应内容**（禁止混淆）：
   - **迭代级** (`-I <iter>`): Read 迭代目录下需求文档（REQUIREMENT.md、010-requirements/sources/ 下的文档）
   - **全局级** (`--scope global --with-code`): Read .speccore/CONSTITUTION.md 获取工程源码路径，从源码路径读取各端代码，**禁止读迭代目录**
2. **分析报告必须包含 7 个文档**（不同任务类型不同集合）:

### 全量分析（feature 类型）
| 文档 | 内容要求 |
|:---|:---|
| **ANALYSIS.md** | 功能点列表、接口清单、数据模型、业务规则、异常处理 |
| **TECH.md** | 架构方案、数据库 DDL、缓存策略、核心流程图 |
| **TEST.md** | 单元测试用例、集成测试方案、边界条件 |
| **REVIEW.md** | 代码审查检查项、安全审查清单 |
| **RISK.md** | 风险矩阵、缓解措施、回滚方案 |
| **DEPS.md** | 上下游依赖、SLA 要求 |
| **MONITOR.md** | 业务监控指标、告警规则 |

### 精简分析（bugfix/research 类型）
| 文档 | 内容 |
|:---|:---|
| ANALYSIS.md | 问题定位 + 修复方案 |
| TEST.md | 回归测试用例 |

3. **写入格式**: `--apply '{"ANALYSIS.md":"...","TECH.md":"..."}'` JSON 多文档写入
4. **不要生成空洞模板** — 每个字段都要有具体内容（表名、字段名、接口路径、阈值数值）

## 禁止行为

- ❌ 用户没说自动就全自动跑
- ❌ schedule 命令（任何形式）
- ❌ 传完整迭代名到 -i 参数
- ❌ 分析时不读源码凭空生成
- ❌ 不展示计划直接执行

## 各阶段完成后的正确下一步

创建迭代/完成某阶段后，必须按流水线顺序建议下一步，禁止跳步：

| 当前阶段 | ✅ 正确下一步 | ❌ 禁止跳步到 |
|:---|:---|:---|
| 迭代创建完成 | 导入需求文档（doc2spec） | ~~创建开发任务~~ |
| 需求导入完成 | 分析需求（analyze） | ~~直接执行~~ |
| 分析完成 | 拆分任务（split） | ~~直接执行~~ |
| 拆分完成 | 执行开发（execute） | — |

> 💡 用户没有需求文档时，引导先放文件到 `010-requirements/sources/` 或运行 `doc2spec --classify`。
