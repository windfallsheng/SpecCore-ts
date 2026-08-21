# AGENTS.md — SpecCore 项目规则

> 本文档供 AI 编码工具自动读取（Cursor / Copilot / Windsurf / Codex / Claude Code）。
> 工具会读取本文档理解项目规则，不需要用户重复解释。
> 非核心规范见 `.speccore/` 规范数据库，运行 `speccore update` 自动同步。

## ⛔ 新会话第一步（最高优先级）

**每次新会话开始时，必须先执行以下操作，不要做任何其他事情：**

```
Read .speccore/local/context.json    ← 获取当前活跃迭代
Read .speccore/CONSTITUTION.md       ← 获取项目配置（端名、源码路径等）
```

- `context.json` 中的 `currentIteration` 字段就是当前迭代名
- **绝对不要自己创建迭代目录** — 迭代已存在，读 context.json 就知道了
- **绝对不要写 JS/Python 脚本绕过 CLI** — 所有操作通过 `speccore` CLI 完成

## 项目类型
SpecCore 规范驱动开发项目。

## 核心工作方式
- **AI 只拼命令，不执行命令**。识别用户意图后，输出 `speccore` CLI 命令给用户在终端执行。
- **所有确定性操作通过 `speccore` CLI 完成**（创建目录、读写文件、校验格式）。
- **代码生成通过宿主 AI 完成**，CLI 负责准备 Spec 上下文和写入文件。
- **代码写到 CONSTITUTION.md 指定的源码路径**，不要写到迭代目录里。

## ⛔ 绝对禁止
1. **禁止自己创建迭代目录** — 用 `speccore iteration create`
2. **禁止写脚本绕过 CLI** — 不要写 build-xxx.js / run-xxx.py 等脚本
3. **禁止在迭代目录下创建 10-backend/ 20-frontend/** — 任务目录是端平铺结构
4. **禁止把代码写到迭代目录内** — 代码写到 CONSTITUTION.md 中各工程的「源码路径」

## 行为约束
- **不要自己创建目录** — 用 `speccore iteration create`
- **不要自己解析需求** — 用 `speccore analyze`
- **失败时读取 .issues.md** — 看文件里的问题清单
- **续跑用 --resume** — `speccore execute --resume`
- **多任务执行用批次** — `speccore execute --list-pending --batch-size 3` 先获取清单，每批完成后开新对话

<!-- SPECCORE_AUTO_INDEX_START -->
> 以下内容由 `.speccore/` 规范数据库自动生成，请勿手动编辑此区域

## 编码规范与规则

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
| `[SPECCORE_CONTINUE: <path>]` | 批次执行完成，需续批 | **必须开始新对话**，先读取 `<path>` 恢复上下文，再按提示命令继续下一批次 |

## 常用命令速查

```bash
speccore status                          # 当前迭代状态面板
speccore analyze -I <迭代名> --auto      # 全量分析
speccore split -I <迭代名>               # 自动拆分任务
speccore execute -I <迭代名> --all       # 执行所有任务
```

### 更多规范
- [CODE REVIEW](.speccore/RULES/CODE_REVIEW.md)
- [POST COMPLETION](.speccore/RULES/POST_COMPLETION.md)

<!-- SPECCORE_AUTO_INDEX_END -->
