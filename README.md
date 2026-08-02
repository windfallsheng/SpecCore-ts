# SpecCore — Code by Spec, Not by Vibe

SpecCore 是一套面向 AI 原生团队的规范驱动研发工具链。将需求分析、任务拆分、计划编排、代码生成、归档交接串联为可追溯的自动化流程。

---

---

## 两种模式

| | 简洁模式（默认） | 全量模式 |
| :--- | :--- | :--- |
| 命令数 | 17 个核心命令 | 51 全部命令 |
| 适用 | 日常开发够用 | 精细控制 |
| 开启 | `speccore init` | `speccore init --full` |
| 帮助 | `speccore --help` | 同上 |

**简洁模式 17 个命令：**
```
ask  init  iteration  task  doc2spec
analyze  split  plan  execute  pr  done
change  validate  rename  dev  status-panel  ops
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
speccore doc2spec -f PRD.md -p backend -i Q1  # ③ 导入需求文档
speccore analyze -I Q1                 # ④ 需求分析
speccore analyze --scope global --depth deep  # ④ 或：全局代码健康
speccore iteration split -i Q1         # ⑤ 拆分 Task
speccore plan -i Q1                    # ⑥ 执行计划
speccore execute -t Task-001           # ⑦ AI 开发
speccore pr -t Task-001                # ⑧ 提交 PR
speccore done -t Task-001              # ⑨ 完成任务
```


## 两种用法

同一个命令有两种使用场景，写法不同：

| 场景 | 写法 | 示例 |
|:---|:---|:---|
| 🖥 终端 CLI | `speccore <命令>` | `speccore init` `speccore execute -t Task-001 --force` |
| 💬 AI 对话 | 直接说人话 | "帮我创建登录功能" |
| 💬 AI 对话 | `/spec-<命令>` | `/spec-init` `/spec-execute Task-001` |

> 完整对照表（所有 17 个命令的分类说明）→ [命令参考 — 两种使用方式](docs/命令参考.md#-两种使用方式)

## 交互模式

关键步骤支持 `--interactive` 人机协作：

| 命令 | 交互步骤 |
| :--- | :--- |
| `analyze --ask` | AI 提问 → 用户回答 → 调整分析 |
| `split --interactive` | 预览 Task 列表 → 逐一确认/取消 |
| `plan --interactive` | 预览调��方案 → 确认/取消 |
| `change --interactive` | 预览影响范围 → 确认 → 应用 |
| `execute --interactive` | 分步预览变更 → 选择文件 → 确认提交 |

## 智能入口

```bash
speccore                          # 自适应面板：检测当前阶段 → 提示下一步
speccore ask "分析当前需求"        # 自然语言意图识别
speccore "帮我拆分任务"            # 直接输入，无需子命令
speccore dev                      # 一键级联：自动检测并执行下一步
```

## 多端支持

所有步骤原生支持多工程并行：后端多个服务（`backend/room-service/`、`backend/booking-service/`）、前端多个平台（`frontend/web/`、`frontend/h5/`）。

## Bug 修复

`task new --type=bugfix` 创建 Bug 任务，支持单条、批量、调度：

```bash
speccore task new -n "登录超时" -d "Token 过期后未刷新" --type=bugfix        # 单条
speccore task new --batch-file=bugs.xlsx --type=bugfix                        # 批量导入
speccore task new --batch-file=bugs.xlsx --type=bugfix --interactive          # 逐条确认
```

## 调度执行

两种粒度的调度，支持指定任意时间：

```bash
# ── 方式 1: 创建任务时标记 ──
speccore task new -n "修复登录超时" --type=bugfix --schedule=night   # 标记为 queue
speccore execute --all --scheduled                                      # 手动触发所有 queue 任务

# ── 方式 2: 精确时间调度 ──
speccore schedule create --at "2026-08-10 21:00:00" -t Task-001       # 指定时间执行单个 Task
speccore schedule create --at "2026-08-10 02:00:00" --all -i Q1       # 指定时间执行全部
speccore schedule list                                                  # 查看调度队列
speccore schedule cancel --id=sch-xxx                                   # 取消
speccore schedule daemon start                                          # 启动守护进程（自动按时执行）
speccore schedule daemon status                                         # 查看守护进程状态
```

| 方式 | 适用场景 | 时间粒度 |
|:---|:---|:---|
| `--schedule=night` | 白天积攒，晚上批量跑 | 无固定时间，手动触发 |
| `schedule create --at` | 指定精确时间自动执行 | 秒级精度（需开启 daemon） |

> `schedule daemon start` 后，到时间自动执行，无需人工干预。

> `execute --all` 和 `execute --scheduled` 互不影响：前者执行 todo 任务，后者只执行 queue 任务。配合 IDE 自动化（如 WorkBuddy 定时任务），设置每天凌晨自动运行即可。


## 目录结构

```
项目/
├── .speccore/
│   ├── CONSTITUTION.md       # 技术宪法
│   ├── GLOBAL/               # 全局层（架构文档、代码健康报告）
│   └── RULES/                # 编码规则
│
└── 期次-Q1/
    ├── 00-需求文档/           # 需求文档 + ANALYSIS.md
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
| 🔧 [全量命令参考](docs/命令参考.md) | 51 命令完整说明（高级用户） |
| [场景实战](docs/场景实战.md) | 日常开发典型场景 |
| [总览](docs/总览.md) | 架构概览 + 理念 |
| [SDD 方法论](docs/SDD方法论.md) | 规范驱动开发介绍 |
| [Spec 加载机制](docs/Spec三层加载机制.md) | 三层 Spec 协同 |
| [示例项目](examples/meeting-system/README.md) | 会议预订系统完整演示 |
