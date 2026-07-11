# 技术栈详情

> SpecCore 框架本身的技术栈（非业务项目技术栈）。

## 1. 框架技术栈

| 组件 | 技术选型 | 版本 | 说明 |
| :--- | :--- | :--- | :--- |
| 文档格式 | Markdown | — | 纯文本，不挑工具 |
| 配置格式 | YAML | — | 接口契约 |
| 脚本 | Bash | — | 初始化与同步 |
| 辅助脚本 | Python | 3.x | 项目扫描与宪法生成 |
| 版本控制 | Git | — | 天然支持 |

## 2. 框架运行环境

- 任何支持文件读写的 AI 工具
- WorkBuddy / Qcoder / Trae / Cursor
- 不依赖特定操作系统

## 3. 与业务项目技术栈的关系

SpecCore 框架本身不限制业务项目的技术栈。业务项目的技术栈记录在：
- `.ai/PROJECT/TECH_STACK.md`（全局）
- `期次-XXX/00-技术文档/ARCHITECTURE.md`（期次级）
- `Feature-XXX/backend/TECH.md`（Feature 级）
