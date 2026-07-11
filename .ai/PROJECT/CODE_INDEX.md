# 代码索引

> SpecCore 框架仓库本身的代码结构。

## 1. 子工程列表

| 工程名称 | 路径 | 技术栈 | 职责 |
| :--- | :--- | :--- | :--- |
| SpecCore | 根目录 | Markdown + Bash | 框架工程 |

## 2. 目录结构

```
SpecCore/
├── README.md              # 项目说明
├── version.txt            # 版本号
│
├── templates/             # 所有模板（核心资产）
│   ├── commands/            # 15 个 Slash Commands
│   ├── skills/              # Skills 模板
│   ├── rules/               # Rules 模板
│   └── spec/                # Spec 文件模板
│
├── scripts/                 # 辅助脚本
│   ├── init-project.sh      # 项目初始化
│   └── sync-framework.sh    # 框架同步
│
└── docs/                    # 框架文档
    ├── 快速开始.md
    ├── 命令参考.md
    └── 工具适配说明.md
```

## 3. 关键文件位置

| 文件类型 | 位置 | 说明 |
| :--- | :--- | :--- |
| 命令模板 | `templates/commands/` | 15 个 Slash Command |
| Skill 模板 | `templates/skills/` | 前后端开发 Skill |
| Spec 模板 | `templates/spec/` | 全局层 + 期次层 + Feature 层 |
| 初始化脚本 | `scripts/init-project.sh` | 业务项目一键接入 |
