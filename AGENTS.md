# AGENTS.md — SpecCore 项目规则

> 本文档供 AI 编码工具自动读取（Cursor / Copilot / Windsurf / Codex / Claude Code）。
> 工具会读取本文档理解项目规则，不需要用户重复解释。

## 项目类型
SpecCore 规范驱动开发项目。

## 核心工作方式
- **AI 只拼命令，不执行命令**。识别用户意图后，输出 `speccore` CLI 命令给用户在终端执行。
- **所有确定性操作通过 `speccore` CLI 完成**（创建目录、读写文件、校验格式）。
- **代码生成通过宿主 AI 完成**，CLI 负责准备 Spec 上下文和写入文件。

## 项目结构
```
Iteration-NNN-name/            ← 迭代目录
├── 000-overview/              ← 进度总览
├── 010-requirements/          ← 需求文档（按功能组织）
│   ├── sources/               ← 原始 PRD
│   ├── assets/                ← 素材
│   └── {feature}/README.md    ← 各需求描述
├── 020-specs/                 ← 需求分析（按端输出）
├── 030-tasks/                 ← 开发任务
└── STAFFING.md                ← 人员排期
```

## 核心命令
| 意图 | CLI 命令 |
| :--- | :--- |
| 初始化项目 | `speccore init` |
| 创建迭代 | `speccore iteration create -n <name> --owner <owner>` |
| 导入需求文档 | `speccore doc2spec -f <file> --iter <iter>` |
| **AI 双路导入** | **激活 spec-doc2spec Skill** (AI+Pandoc交叉验证) |
| 分析需求 | `speccore analyze -I <iter>` |
| 拆分任务 | `speccore iteration split -I <iter>` |
| 生成计划 | `speccore plan -I <iter>` |
| 执行任务 | `speccore execute -t <task> --force` |
| 导出文档 | `speccore spec2doc -i <iter> -o <output>` |
| **AI 排版导出** | **激活 spec-spec2doc Skill** (AI排版+Pandoc导出) |
| 查看进度 | `speccore dashboard` |
| 任务回顾 | `speccore retro --task <task>` |
| 需求变更 | `speccore change "<desc>" --task <task>` |
| 智能推进 | `speccore dev` |
| 自然语言入口 | `speccore ask "..."` |

## 行为约束
- **不要自己创建目录** — 用 `speccore iteration create`
- **不要自己解析需求** — 用 `speccore analyze`
- **失败时读取 .issues.md** — 看文件里的问题清单
- **续跑用 --resume** — `speccore execute --resume`

## 上下文文件加载顺序
1. AGENTS.md（本文档）— 项目规则
2. .speccore/CONSTITUTION.md — 技术栈与需求端映射
3. .speccore/local/context.json — 当前活跃迭代
4. .agents/skills/SKILL.md — 技能指令
