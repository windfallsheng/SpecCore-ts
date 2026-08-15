# AI 使用 SpecCore 的规则

> 本文档帮助 AI 代理（TRAE/Claude/Qoder等）正确使用 SpecCore 命令。

## 核心原则

1. **/spec:ask 是智能路由入口** — 用户说"新建迭代"、"分析需求" → 调用 `speccore ask`，不要自己写 mkdir/analyze
2. **不要跨命令猜测** — 每个斜杠命令只做它描述的事，不要自动级联后续步骤
3. **参数从命令描述获取** — /spec:execute 的描述中有完整的参数说明
4. **上下文不足时读取文件** — 查看 .speccore/CONSTITUTION.md、STAFFING.md 等

## 核心流水线

```
init → doc2spec → analyze → split → plan → execute → pr → done → spec2doc
```

## 命令快速参考

| 命令 | 作用 | 参数 | 上游依赖 | 下游产出 |
| :--- | :--- | :--- | :--- | :--- |
| init | 初始化项目 | --interactive/--force/--update | 无 | .speccore/ + 工具集成 |
| doc2spec | Word→Spec MD (CLI) | -f <文件> --iter <迭代> | PRD/Word | 010-requirements/*.md |
| **spec-doc2spec** | **AI+Pandoc 双路交叉验证导入** | **(Skill 自动触发)** | PRD原文 | REQUIREMENT.md + VALIDATION.md |
| analyze | 需求分析 | -I <迭代> --task <任务> | 010-requirements/ | 020-specs/ANALYSIS.md |
| split | 拆分任务 | -i <迭代> --owner <人> | 020-specs/ | Task-001~NNN/ |
| plan | 执行计划 | -I <迭代> --owner <人> | Task 列表 | plan.json |
| execute | 执行开发 | -i <迭代> -t <任务> --type <类型> | REQ.md/TECH.md | 代码 + .issues.md |
| pr | 创建PR | --task <任务> | 代码提交 | Pull Request |
| done | 归档收尾 | --task <任务> | 全部完成 | .verification |
| spec2doc | Spec→文档导出 (CLI) | -i <迭代> -o <文件> -f <格式> | 020-specs/ | Word/PDF/HTML |
| **spec-spec2doc** | **AI排版+Pandoc导出+验证** | **(Skill 自动触发)** | SpecCore文档 | 精美排版文档 |
| retro | 任务回顾 | --task/--all/--owner/--type | done后 | 回顾报告 |
| change | 需求变更 | <描述> --task <任务> --type | 进行中任务 | 变更记录 |
| dev | 智能级联 | --auto/--from/--to | 全部阶段 | 自动全流程 |

## AI Skills（.agents/skills/）

项目包含 10 个高阶 Skill，AI 工具自动加载：

| Skill | 能力 | 激活方式 |
| :--- | :--- | :--- |
| speccore-router | 中文意图→CLI命令（20+映射） | "分析需求"/"创建迭代" |
| spec-doc2spec | **AI语义提取+Pandoc机械转换+交叉验证** | "帮我分析这个PRD"/"导入需求文档" |
| spec-spec2doc | **AI内容编排+Pandoc格式转换+质量验证** | "导出文档"/"生成交付文档" |
| spec-analyze | 深度需求分析（拆解→映射→风险） | "分析需求" |
| spec-split | 智能任务拆分（分组→分配→依赖） | "拆分任务" |
| spec-execute | 代码生成+编译+测试+修复循环 | "开发Task-001" |
| spec-plan | 排程+里程碑+并行策略 | "生成计划" |
| spec-dev | 阶段检测+状态展示+推荐下一步 | "推进项目" |
| spec-change | 变更记录+影响分析+代码更新 | "需求变更" |
| spec-ask | 自然语言引擎（四大模式） | "怎么做"/"流程是什么" |

## 目录结构

```
Iteration-xxx/
├── 000-overview/     ← 进度跟踪
├── 010-requirements/     ← 需求文档（按功能组织）
│   ├── README.md       ← 目录规范说明
│   ├── INDEX.md        ← 需求文档索引
│   ├── sources/        ← [只读] 原始 PRD/Word/PDF
│   ├── converted/      ← [自动生成] doc2spec 转换后的 MD
│   ├── features/       ← [手动维护] 按功能模块组织
│   │   └── {feature}/README.md
│   └── assets/         ← 素材（prd/prototypes/designs/screenshots）
├── 020-specs/     ← analyze 输出
├── 030-tasks/     ← 开发任务
│   └── Task-*/
│       ├── .meta/         ← 任务元信息（type/status/owner/created-at）
│       ├── _shared/       ← 共享规格（REQ/TECH/SCHEMA/CHANGELOG/API_CONTRACT）
│       ├── backend/       ← 后端子任务（TASK.md + src/tests）
│       ├── web/           ← Web前端子任务（TASK.md + src/tests）
│       ├── 99-artifacts/  ← 执行产出（自检门禁 + 参考文档）
│       └── .issues.md     ← 问题追踪
├── STAFFING.md      ← 人员排期
```

## AI 行为约束

- **不要自己创建目录** — 用 `speccore iteration create -n <名称>`
- **不要自己解析需求** — 用 `speccore analyze -I <迭代>`
- **失败时读取 .issues.md** — 不要猜测，看文件里的问题清单
- **续跑用 --resume** — `speccore execute --resume` 自动扫描 .needs-retry