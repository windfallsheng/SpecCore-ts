# 会议室预订系统 — SpecCore 示例项目

> v5.25.2 | 展示完整的 spec 驱动开发工作流

## 项目结构

```
meeting-system/
├── .speccore/CONSTITUTION.md              # 项目宪法：技术栈、Git配置、命名规范
└── 期次-Q1/
    ├── STAFFING.md                        # 人员排期（每期可不同）
    ├── 00-产品需求/                        # 产品原始需求（按端分目录，只读）
    │   ├── backend/                       #   后台端需求
    │   │   ├── 会议室管理服务.md
    │   │   ├── 预订管理服务.md
    │   │   └── 通知服务.md
    │   ├── frontend/                      #   前端需求
    │   │   ├── Web/会议室列表页.md
    │   │   └── 小程序/快速预订.md
    │   └── _shared/通用业务规则.md        #   跨端共用规则
    ├── 00-需求文档/                        # Analyzer 生成的 Spec 规范文档
    │   ├── ANALYSIS.md                    #   AI 分析报告（改动范围+风险+变更预测）
    │   ├── TECH.md                        #   技术方案
    │   ├── TEST.md                        #   测试计划
    │   ├── REVIEW.md                      #   Code Review 清单
    │   ├── RISK.md                        #   风险评估
    │   ├── DEPS.md                        #   依赖清单
    │   └── MONITOR.md                     #   监控指标
    ├── 00-期次总览/PROJECT_GRAPH.md       # 任务总览 + 默认分支 + 依赖图谱
    ├── Task-001/                          # 拆分后的任务（platform=后台）
    │   ├── backend/TASK.md                #   含优先级、工时、复杂度、负责人
    │   └── ...
    └── ...
```

## 工作流模拟

### 1. 项目初始化
```bash
speccore init
# → .speccore/CONSTITUTION.md（填写项目信息、Git仓库、默认分支）
```

### 2. 创建期次
```bash
speccore iteration create -n Q1 --owner=赵六 --from=2026-04-01 --to=2026-06-30
# → 期次-Q1/ 含 STAFFING.md(人员排期) + PROJECT_GRAPH.md
```

### 3. 导入产品需求
```bash
speccore doc2spec -f PRD-会议室预订.docx
# → 00-产品需求/backend/、frontend/Web/、frontend/小程序/、_shared/
```

### 4. AI 分析 + 生成 Spec
```bash
speccore analyze -I Q1
# → 递归读 00-产品需求/*.md
# → 00-需求文档/ANALYSIS.md（改动范围、风险矩阵、变更预测）
# → 00-需求文档/TECH/TEST/REVIEW/RISK/DEPS/MONITOR.md
# → .speccore/prompts/analyze-iteration-Q1.md（供WorkBuddy分析）
```

### 5. 智能拆分任务
```bash
speccore iteration split -i Q1 --interactive
# → 读 ANALYSIS.md（有阻断项则警告）
# → 读 STAFFING.md（自动分配负责人）
# → 复杂度估算（API/DB/页面数）→ 动态优先级 + 工时
# → 语义依赖检测 → 依赖关系展示
# → 生成 Task-001 ~ Task-004
```

### 6. 执行开发
```bash
speccore execute -i Q1 --all
# → 四级默认分支检测（期次→CONSTITUTION→git→local）
# → feature/Task-001 (from main)
# → feature/Task-002 (from feature/Task-001) ← 依赖感知
```

## 关键技术点

| 特性 | 说明 |
|------|------|
| **产品需求分端** | 后台/Web/小程序各自独立存放，`_shared/` 放通用规则 |
| **AI 上下文** | analyze 生成结构化 prompt，供 WorkBuddy 深度分析 |
| **智能拆分** | 复杂度评估、语义依赖、动态优先级、自动分配 |
| **分支管理** | 四级降级（期次→全局→git→本地），支持依赖分支 |
| **交互模式** | 拆分时可预览依赖关系和每个任务的详细信息 |
