# SpecCore — Code by Spec, Not by Vibe

**SpecCore 是一套面向 AI 原生团队的规范驱动工具链。** 它用「Spec 先行」的方式把需求、拆分、计划、执行、交付串成一个闭环——人和 AI 在每个关键节点预览、调整、确认，生成的代码自然对齐需求。

> v5.25.1 | [更新日志](CHANGELOG.md) | [English](README.en.md)

```
  init → iteration create → doc2spec → analyze → split → plan → execute → pr → done
  🚀初始化  📅创建期次  📝导入需求  🧠AI分析  📦智能拆分  📋计划  💻执行  🔀提交  ✅收尾
```

## 🚀 5 分钟体验

```bash
npm install -g speccore                       # 安装
speccore init                                 # 初始化（CONSTITUTION+Git配置）
speccore iteration create -n Q1 --owner=张三   # 创建期次（自动生成STAFFING.md）
speccore doc2spec -f PRD.docx -I Q1            # 导入需求到 00-产品需求/
speccore analyze -I Q1                         # AI分析（改动范围+风险+变更预测）
speccore iteration split -i Q1 --interactive   # 智能拆分（复杂度+优先级+人员分配）
speccore plan -I Q1                            # 生成执行计划
speccore execute -t Task-001                   # 执行（自动建分支+依赖感知）
speccore done --task=Task-001                  # 收尾归档
```

## 📂 目录结构 (v5.25)

```
项目根/
├── .speccore/CONSTITUTION.md           ← 项目信息 + 技术栈 + Git分支策略
└── 期次-Q1/
    ├── STAFFING.md                     ← 人员排期（每期可不同）
    ├── 00-产品需求/                     ← 产品原始需求（按端分目录，只读）
    │   ├── backend/                    ←   后台端
    │   ├── frontend/Web/               ←   Web端
    │   ├── frontend/小程序/            ←   小程序端
    │   └── _shared/                    ←   跨端共用
    ├── 00-需求文档/                     ← Analyzer 生成（ANALYSIS+TECH+TEST+...）
    ├── 00-期次总览/PROJECT_GRAPH.md    ← 任务总览 + 默认分支
    └── Task-001~004/                   ← 拆分后任务
```

## 🎯 我想...

| 我想... | 用这个 |
|:---|:---|
| **新建项目** | `speccore init --interactive` |
| **导入 PRD 文档** | `speccore doc2spec -f PRD.docx -I Q1` |
| **分析需求 + 代码健康** | `speccore analyze -I Q1` / `--scope global` |
| **拆分需求为 Task** | `speccore iteration split -I Q1 --interactive` |
| **生成执行计划** | `speccore plan -I Q1 --interactive` |
| **查看计划历史** | `speccore plan --list` / `plan --show plan-xxx` |
| **修复一个 Bug** | `speccore task new -n "登录超时" --type=bugfix` |
| **批量修复 Bug** | `speccore task new --batch-file=bugs.xlsx --type=bugfix` |
| **定时自动执行** | `speccore schedule create --at "02:00" --all -I Q1` |
| **AI 自动开发** | `speccore execute -t Task-001` / `--plan=plan-xxx` |
| **创建 Pull Request** | `speccore pr --task=Task-001 --interactive` |
| **收尾归档** | `speccore done --task=Task-001` / `done --all -I Q1 --interactive` |
| **查看到哪了** | `speccore status-panel` 或直接 `speccore` |
| **自然语言说需求** | `speccore ask "帮我分析当前需求"` |

> 📋 全部 44 个命令 → [命令参考手册](docs/命令参考.md)

## 🤝 协作模式

6 个命令支持 `--interactive` 人机协作，预览变更后才确认执行：

| `🧠 analyze --interactive` | `🧠 split --interactive` | `🧠 plan --interactive` |
|:---|:---|:---|
| `🧠 pr --interactive` | `🧠 change --interactive` | `🧠 done --interactive` |

## ⏰ 调度执行

指定时间自动执行。`--all` 会按依赖排序、分批执行当期次所有任务：

```bash
speccore schedule create --at "2026-08-10 02:00:00" --all -I Q1       # 全部任务，自动排序
speccore schedule create --at "2026-08-10 21:00:00" -t Task-001         # 单个任务
speccore schedule create --at "02:00" --all -I Q1 -a 张三 --type=bugfix  # 筛选后执行
speccore schedule daemon start                                           # 启动守护进程
```

> 不需要手动 `plan`——`execute` 自动分析 Task 依赖，按拓扑顺序分批执行。`--batch-size=3` 控制每批数量。

## 📚 了解更多

| 文档 | 内容 |
|:---|:---|
| 🚀 [快速开始](docs/快速开始.md) | 完整安装与使用教程 |
| 🔧 [命令参考](docs/命令参考.md) | 44 个命令完整说明 |
| 🎬 [场景实战](docs/场景实战.md) | 34 个真实开发场景 |
| 🗺 [总览](docs/总览.md) | 架构概览与设计理念 |
| 📝 [SDD 方法论](docs/SDD方法论.md) | 规范驱动开发介绍 |
