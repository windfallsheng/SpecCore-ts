# SpecCore — Code by Spec, Not by Vibe

SpecCore 是一套面向 AI 原生团队的规范驱动研发工具链。将需求分析、任务拆分、计划编排、代码生成、归档交接串联为可追溯的自动化流程。

---

## 两种模式

| | 简洁模式（默认） | 全量模式 |
| :--- | :--- | :--- |
| 命令数 | 19 个核心命令 | 52 全部命令 |
| 适用 | 日常开发够用 | 精细控制 |
| 开启 | `speccore init` | `speccore init --full` |
| 帮助 | `speccore --help` | 同上 |

**简洁模式 19 个命令：**
```
ask  init  import  iteration  task  doc2spec
analyze  split  plan  execute  pr  done
change  validate  rename  dev  status-panel  ops  bugfix
```

---

## 安装

```bash
npm install -g speccore
```

## 核心流程

```bash
speccore init                          # ① 初始化
speccore iteration create --name=Q1    # ② 新建期次
speccore import --project=backend      # ③ 导入存量项目（可选）
speccore doc2spec -f PRD.md -p backend -i Q1  # ④ 导入需求
speccore analyze --iteration=Q1        # ⑤ 需求分析
speccore iteration split -i Q1         # ⑥ 拆分 Task
speccore plan --iteration=Q1           # ⑦ 执行计划
speccore execute --task=Task-001       # ⑧ AI 开发
speccore pr --task=Task-001            # ⑨ 提交 PR
speccore done --task=Task-001          # ⑩ 完成任务
```

## 交互模式

关键步骤支持 `--interactive` 人机协作：

| 命令 | 交互步骤 |
| :--- | :--- |
| `import --interactive` | 预览扫描结果 → 确认/跳 API/取消 |
| `analyze --interactive` | AI 提问 → 用户回答 → 调整分析 |
| `split --interactive` | 预览 Task 列表 → 逐一确认/取消 |
| `plan --interactive` | 预览调度方案 → 确认/取消 |
| `change --interactive` | 预览影响范围 → 确认 → 应用 |

## 智能入口

```bash
speccore                          # 自适应面板：检测当前阶段 → 提示下一步
speccore ask "分析当前需求"        # 自然语言意图识别
speccore "帮我拆分任务"            # 直接输入，无需子命令
speccore dev                      # 一键级联：自动检测并执行下一步
```

## 多端支持

所有步骤原生支持多工程并行：后端多个服务（`backend/room-service/`、`backend/booking-service/`）、前端多个平台（`frontend/web/`、`frontend/h5/`）。

## 存量项目导入

```bash
# 源码工程 → 自动扫描 API、识别技术栈、生成需求
speccore import --project=backend --path=./src --type=backend

# Excel 需求表 → 一行一个需求
speccore import --project=meeting --path=reqs.xlsx  （也支持 .csv）

# 导入后触发 AI 分析
# 在 IDE 中运行 /spec-import-analyze 即可
```

## Bug 批量处理

```bash
# 从 Excel 批量导入 → 交互确认 → 标记夜间执行
speccore bugfix --batch-file=bugs.xlsx --schedule=night --interactive
```


## 夜间调度执行

白日创建任务队列 → 夜间自动执行 → 晨间验证结果。

```bash
# 白天：标记任务进入夜间队列
speccore bugfix --batch-file=bugs.xlsx --schedule=night --interactive
speccore task new --name=数据迁移 --type=feature

# 夜间：自动化定时执行（需在 WorkBuddy 中设置自动化）
# 或手动触发：
speccore execute --all --scheduled
```

自动化设置：在 WorkBuddy 中创建定时任务，每天凌晨 2:00 执行。
配置：`/.speccore/config/automation.json`


## 目录结构

```
项目/
├── .speccore/
│   ├── CONSTITUTION.md       # 技术宪法
│   ├── GLOBAL/               # 全局层：跨项目复用
│   │   ├── PROJECTS/         # 各工程独立需求
│   │   ├── INDEX.md
│   │   └── OVERVIEW.md
│   └── RULES/                # 编码规则
│
└── 期次-Q1/
    ├── 00-需求文档/           # 结构化需求 + 分析报告
    ├── Task-001/
    │   ├── TASK.md
    │   ├── backend/{服务名}/  # 按服务分目录
    │   │   ├── TASK.md
    │   │   └── API_CONTRACT.yaml
    │   └── frontend/{平台}/   # 按平台分目录
    │       └── TASK.md
    └── Task-002/
```

---

## 文档

| 文档 | 内容 |
| :--- | :--- |
| 🚀 [快速开始](docs/快速开始.md) | 完整安装 → 使用教程 |
| 🔧 [全量命令参考](docs/命令参考.md) | 52 命令完整说明（高级用户） |
| [场景实战](docs/场景实战.md) | 日常开发典型场景 |
| [总览](docs/总览.md) | 架构概览 + 理念 |
| [SDD 方法论](docs/SDD方法论.md) | 规范驱动开发介绍 |
| [Spec 加载机制](docs/Spec三层加载机制.md) | 三层 Spec 协同 |
| [示例项目](examples/meeting-system/README.md) | 会议预订系统完整演示 |
