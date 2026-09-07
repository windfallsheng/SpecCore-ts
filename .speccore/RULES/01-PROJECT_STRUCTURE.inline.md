## 项目结构

```
Iteration-NNN-name/            ← 迭代目录
├── 000-overview/              ← 进度总览与报告
│   ├── PROJECT_GRAPH.md       ← 项目任务图谱（split 后生成）
│   ├── task-summaries/        ← 任务总览报告（TASK_SUMMARY-*.md）
│   ├── plans/                 ← 执行计划（PLAN.md + HTML 可视化）
│   ├── RETRO.md               ← 迭代复盘报告（done 后生成）
│   └── PIPELINE_REPORT.md     ← Pipeline 执行报告（dev 后生成）
├── 010-requirements/          ← 需求文档（按功能组织）
│   ├── README.md              ← 目录规范说明
│   ├── INDEX.md               ← 需求文档索引
│   ├── sources/               ← [只读] 原始 PRD（.docx/.pdf/.md）
│   ├── converted/             ← [自动生成] doc2spec 转换后的 MD
│   ├── features/              ← [手动维护] 按功能模块组织
│   │   └── {feature}/
│   │       └── README.md
│   ├── prototypes/            ← 原型（HTML/图片/链接，内容不限）
│   ├── assets/                ← 素材资源
│   │   ├── extracted/         ← doc2spec 提取的图片/媒体
│   │   ├── prototypes/        ← 产品原型
│   │   ├── designs/           ← UI 设计稿
│   │   └── screenshots/       ← 参考截图
│   ├── bugs/                  ← [可选] bug 需求文档
│   ├── refactors/             ← [可选] 重构需求文档
│   ├── research/              ← [可选] 调研需求文档
│   ├── REQUIREMENT.md         ← [可选] 主需求文档
│   └── CLARIFY_REPORT.md      ← [可选] 需求澄清报告
├── 020-specs/                 ← 需求分析（analyze 输出）
│   ├── overview/              ← 全局规格（跨端共享）
│   │   └── REQUIREMENT.md / ANALYSIS.md / TECH.md / DEV_GUIDE.md ...
│   ├── {功能模块}/            ← 按功能模块组织
│   │   └── {端名}/            ← 端级规格
│   │       └── TECH.md / TEST.md / UI_SPEC.md / DEV_GUIDE.md ...
│   ├── requirements/          ← 黄金需求（clarify 输出，analyze 读取）
│   ├── PLATFORMS.md           ← 端列表
│   └── QUALITY_AUDIT.md       ← 质量审计报告
├── 030-tasks/                 ← 开发任务
│   └── Task-*/                ← 功能模块分组（聚合相关子任务）
│       ├── .meta/             ← 任务元信息
│       │   ├── feature        ← 功能单元名
│       │   ├── type           ← 任务类型（feature/bugfix/refactor/research）
│       │   ├── status         ← 状态（todo/doing/done）
│       │   ├── owner          ← 负责人
│       │   ├── created-at     ← 创建时间
│       │   └── estimated-hours ← 预估工时
│       ├── _shared/           ← 共享契约
│       │   ├── API_CONTRACT.yaml
│       │   └── CONTEXT.md
│       ├── 00-specs/          ← 模块级核心规格（analyze 阶段写入）
│       │   ├── REQ.md         ← 需求规格
│       │   ├── TECH.md        ← 技术规格
│       │   ├── SCHEMA.md      ← 数据模型（条件创建）
│       │   ├── CHANGELOG.md   ← 变更记录
│       │   └── CONTEXT.md     ← [兼容] 任务上下文副本
│       ├── {端名}/            ← 端平铺（如 booking-service / h5-mobile / admin-web）
│       │   └── {子任务}/      ← 执行单元
│       │       ├── .meta/     ← 子任务元信息
│       │       │   ├── type
│       │       │   ├── status
│       │       │   ├── owner
│       │       │   ├── created-at
│       │       │   ├── estimated-hours ← 预估工时
│       │       │   ├── feature       ← 功能单元名
│       │       │   └── git-config    ← 子任务级 Git 配置
│       │       ├── TASK.md    ← 子任务追踪
│       │       ├── TEST.md    ← 测试用例
│       │       ├── RISK.md    ← 风险评估
│       │       ├── DEPS.md    ← 依赖分析
│       │       ├── MONITOR.md ← 监控方案
│       │       ├── REVIEW.md  ← 评审清单
│       │       ├── DEPLOY.md  ← 部署清单
│       │       ├── ERROR_CODES.md
│       │       ├── COMPONENT_TREE.md  ← 组件树（仅前端）
│       │       ├── ROUTES.md          ← 路由设计（仅前端）
│       │       └── STATE.md           ← 状态管理（仅前端）
│       └── .issues.md         ← 问题追踪
│
│   > ⚠️ 代码输出位置：AI 生成的代码写入 CONSTITUTION.md/PROJECT.yaml 中声明的「源码路径」，
│   > 禁止写入迭代目录内。子任务目录只存放规格文档（TASK.md/TEST.md/RISK.md 等）。
│
│   research 类型任务目录结构（无前后端分层）：
│       ├── _shared/
│       │   └── CONTEXT.md
│       ├── 00-specs/
│       │   ├── REQ.md
│       │   └── TECH.md
│       ├── RESEARCH.md        ← 调研报告
│       ├── COMPARISON.md      ← 方案对比
│       └── .issues.md         ← 问题追踪
└── STAFFING.md                ← 人员排期
```
