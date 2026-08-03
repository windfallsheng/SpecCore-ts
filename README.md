# SpecCore — Code by Spec, Not by Vibe

> 同时维护 5 个微服务和 3 个前端平台？SpecCore 把「需求 → 拆分 → 计划 → 执行 → 交付」串成一条可追溯的自动化流水线。

```
  init → doc2spec → analyze → split → plan → execute → pr → done
  🚀初始化   📝导入需求   🧠分析   📦拆分   📋计划   💻执行   🔀提交   ✅收尾
```

## 🚀 5 分钟体验

```bash
npm install -g speccore                 # 安装
speccore init                           # 初始化项目
speccore doc2spec -f PRD.docx -i Q1     # 导入需求文档
speccore analyze -I Q1                  # AI 分析需求 + 代码检查
speccore iteration split -I Q1          # 拆分为独立 Task
speccore plan -I Q1                     # 生成执行计划
speccore execute -t Task-001            # AI 自动开发
speccore done -t Task-001               # 收尾归档
```

## 🎯 我想...

| 我想... | 用这个 |
|:---|:---|
| **新建项目** | `speccore init --interactive` |
| **导入 PRD 文档** | `speccore doc2spec -f PRD.docx -I Q1` |
| **分析需求 + 代码健康** | `speccore analyze -I Q1` / `--scope global` |
| **拆分需求为 Task** | `speccore iteration split -I Q1 --interactive` |
| **修复一个 Bug** | `speccore task new -n "登录超时" --type=bugfix` |
| **批量修复 Bug** | `speccore task new --batch-file=bugs.xlsx --type=bugfix` |
| **定时执行所有任务** | `speccore schedule create --at "02:00" --all -I Q1` |
| **AI 自动开发** | `speccore execute -t Task-001` |
| **创建 Pull Request** | `speccore pr -t Task-001 --interactive` |
| **收尾归档** | `speccore done -t Task-001 --interactive` |
| **查看到哪了** | `speccore status-panel` 或直接 `speccore` |
| **自然语言说需求** | `speccore ask "帮我分析当前需求"` |

> 📋 全部 51 个命令 → [命令参考手册](docs/命令参考.md)

## 🤝 协作模式

6 个命令支持 `--interactive` 人机协作，预览变更后才确认执行：

| `🧠 analyze --ask` | `🧠 split --interactive` | `🧠 plan --interactive` |
|:---|:---|:---|
| `🧠 pr --interactive` | `🧠 change --interactive` | `🧠 done --interactive` |

## ⏰ 调度执行

指定时间自动执行：

```bash
speccore schedule create --at "2026-08-10 02:00:00" --all -I Q1       # 指定时间执行全部
speccore schedule create --at "2026-08-10 21:00:00" -t Task-001         # 指定时间执行单个
speccore schedule daemon start                                           # 启动守护进程
```

> `--schedule=night` 是另一种轻量方式：标记任务为 queue，之后 `execute --all --scheduled` 手动批量触发，不设具体时间。

## 📚 了解更多

| 文档 | 内容 |
|:---|:---|
| 🚀 [快速开始](docs/快速开始.md) | 完整安装与使用教程 |
| 🔧 [命令参考](docs/命令参考.md) | 51 个命令完整说明 |
| 🎬 [场景实战](docs/场景实战.md) | 33 个真实开发场景 |
| 🗺 [总览](docs/总览.md) | 架构概览与设计理念 |
| 📝 [SDD 方法论](docs/SDD方法论.md) | 规范驱动开发介绍 |
