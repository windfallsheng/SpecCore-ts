## 项目结构

```
Iteration-NNN-name/            ← 迭代目录
├── 000-overview/              ← 进度总览
├── 010-requirements/          ← 需求文档（按功能组织）
│   ├── README.md              ← 目录规范说明
│   ├── INDEX.md               ← 需求文档索引
│   ├── sources/               ← [只读] 原始 PRD
│   ├── converted/             ← [自动生成] doc2spec 转换后的 MD
│   ├── features/              ← [手动维护] 按功能模块组织
│   │   └── {feature}/README.md
│   ├── prototypes/            ← 原型（HTML/图片/链接，内容不限）
│   └── assets/                ← doc2spec 提取的图片
├── 020-specs/                 ← 需求分析
├── 030-tasks/                 ← 开发任务
│   └── Task-*/                ← 功能模块分组（聚合相关子任务）
│       ├── _shared/           ← 共享契约（API_CONTRACT.yaml + CONTEXT.md）
│       ├── 00-specs/          ← 模块级核心规格（REQ/TECH/SCHEMA/CHANGELOG）
│       ├── 10-backend/        ← 后端（大类）
│       │   └── {服务名}/      ← 端（如 api）
│       │       └── {子任务}/  ← 执行单元
│       ├── 20-frontend/       ← 前端（大类）
│       │   └── {端名}/        ← 端（如 h5/admin）
│       │       └── {子任务}/  ← 执行单元
│       └── .issues.md         ← 问题追踪
│
│   子任务目录结构（10-backend/{端}/{子任务}/ 或 20-frontend/{端}/{子任务}/）：
│       ├── .meta/             ← 子任务元信息（type/status/owner/created-at）
│       ├── git-config         ← 子任务级 Git 配置
│       ├── TASK.md            ← 子任务追踪
│       ├── src/               ← AI 输出代码
│       ├── tests/             ← AI 输出测试
│       ├── TEST.md            ← 测试用例
│       ├── RISK.md            ← 风险评估
│       ├── DEPS.md            ← 依赖分析
│       ├── MONITOR.md         ← 监控方案
│       ├── REVIEW.md          ← 评审清单
│       ├── DEPLOY.md          ← 部署清单
│       ├── ERROR_CODES.md     ← 错误码
│       └── COMPONENT_TREE.md  ← 组件树（仅前端）
│
│   research 类型任务目录结构（无前后端分层）：
│       ├── _shared/           ← 共享上下文
│       ├── 00-specs/          ← 核心规格（REQ.md/TECH.md）
│       ├── RESEARCH.md        ← 调研报告
│       ├── COMPARISON.md      ← 方案对比
│       └── .issues.md         ← 问题追踪
└── STAFFING.md                ← 人员排期
```
