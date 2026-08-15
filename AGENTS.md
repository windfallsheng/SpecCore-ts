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
│   ├── README.md              ← 目录规范说明
│   ├── INDEX.md               ← 需求文档索引
│   ├── sources/               ← [只读] 原始 PRD
│   ├── converted/             ← [自动生成] doc2spec 转换后的 MD
│   ├── features/              ← [手动维护] 按功能模块组织
│   │   └── {feature}/README.md
│   └── assets/                ← 素材（extracted/prototypes/designs/screenshots）
├── 020-specs/                 ← 需求分析
├── 030-tasks/                 ← 开发任务
│   └── Task-*/
│       ├── .meta/             ← 任务元信息（type/status/owner/created-at）
│       ├── _shared/           ← 共享契约（API_CONTRACT.yaml）
│       ├── 00-specs/          ← 执行前核心规格（REQ/TECH/TASK/SCHEMA/CHANGELOG）
│       ├── 10-backend/        ← 后端实现（src/tests）
│       ├── 20-frontend/       ← 前端实现（{platform}/src/tests）
│       ├── 99-artifacts/      ← 执行产出（自检门禁 + 参考文档）
│       └── .issues.md         ← 问题追踪
└── STAFFING.md                ← 人员排期
```

## SpecCore 输出标记
当执行 `speccore ask` 或 `speccore about` 时，会输出以下标记，按优先级处理：
| 标记 | 含义 | 动作 |
|:---|:---|:---|
| `[SPECCORE_ONBOARD: <path>]` | 首次/升级引导页 | **最先处理**，用 present_files 展示 HTML |
| `[SPECCORE_SETUP_GUIDE: <path>]` | 项目配置引导页 | init 后用 present_files 展示，指导用户配置 |
| `[SPECCORE_ABOUT: <path>]` | 版本信息页 | 用 present_files 展示 |
| `[SPECCORE_MODE: <mode>]` | 意图模式 | 识别模式后进入对应流程 |
| `[SPECCORE_EXEC: <cmd>]` | 自动执行命令 | 直接 execute_command |
| `[SPECCORE_INTENT]` | 意图确认块 | 展示给用户确认 |
| `[SPECCORE_BATCH_COMPLETE]` | 批次执行完成 | **必须开始新对话**，按提示命令继续下一批次 |

## 行为约束
- **不要自己创建目录** — 用 `speccore iteration create`
- **不要自己解析需求** — 用 `speccore analyze`
- **失败时读取 .issues.md** — 看文件里的问题清单
- **续跑用 --resume** — `speccore execute --resume`
- **多任务执行用批次** — `speccore execute --list-pending --batch-size 3` 先获取清单，每批完成后开新对话

## 上下文文件加载顺序
1. AGENTS.md（本文档）— 项目规则
2. .speccore/CONSTITUTION.md — 技术栈与需求端映射
3. .speccore/local/context.json — 当前活跃迭代
4. .agents/skills/SKILL.md — 技能指令
