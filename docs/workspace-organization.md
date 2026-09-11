# 项目工作空间组织方式

> 本文档说明 SpecCore 项目与代码工程的推荐目录结构及协作方式。

---

## 一、推荐目录结构

```
workspace/
├── spec-project/                 # SpecCore 规范仓库（独立 Git 仓库）
│   ├── .speccore/
│   │   ├── CONSTITUTION.md       # 技术宪法（技术栈、命名规范、端列表）
│   │   ├── PROJECT.yaml          # 项目配置（工程映射、Git、代码路径）
│   │   ├── GLOBAL/               # 全局分析产出（跨迭代复用）
│   │   │   ├── INDEX.md          # 全局索引
│   │   │   ├── platforms/        # 各端技术资产
│   │   │   │   └── {端名}/
│   │   │   │       ├── _INDEX.md
│   │   │   │       └── BUSINESS_RULES.md  # 端级业务规则（可选）
│   │   │   └── BUSINESS_RULES/   # 通用业务规则目录（v8.3.132+）
│   │   │       ├── 01-common.md  # 通用规则（所有端自动加载）
│   │   │       └── {端名}.md     # 端级规则（仅该端加载）
│   │   ├── RULES/                # 项目规范（代码约束，自动注入 Prompt，v8.3.134+）
│   │   ├── SKILLS/               # 技术能力库（最佳实践，按需查阅，v8.3.134+）
│   │   ├── PATTERNS/             # 可复用模式（全局分析时参考，v8.3.134+）
│   │   ├── examples/             # 配置示例（init 自动生成）
│   │   │   ├── CONSTITUTION-EXAMPLE.md
│   │   │   ├── PROJECT-EXAMPLE.yaml
│   │   │   ├── BUSINESS-RULES-EXAMPLE/     # 业务规则模板（v8.3.132+）
│   │   │   ├── API-DESIGN-EXAMPLE.md       # API 规范示例（v8.3.130+）
│   │   │   ├── DATABASE-EXAMPLE.md         # 数据库规范示例（v8.3.130+）
│   │   │   └── SECURITY-EXAMPLE.md         # 安全规范示例（v8.3.130+）
│   │   └── local/
│   │       └── context.json      # 当前活跃迭代
│   ├── .codebuddy/commands/      # AI 命令（软链接到 speccore 模板）
│   ├── 期次-2026-07-会议预定/
│   └── README.md
│
├── my-backend/                    # 后端代码工程（独立 Git 仓库）
│   ├── src/
│   └── .codebuddy/commands → ..speccore project/.codebuddy/commands
│
├── my-frontend/                   # 前端代码工程（独立 Git 仓库）
│   ├── src/
│   └── .codebuddy/commands → ..speccore project/.codebuddy/commands
│
└── my-miniapp/                    # 小程序工程（独立 Git 仓库）
    ├── src/
    └── .codebuddy/commands → ..speccore project/.codebuddy/commands
```

---

## 二、这种结构的优势

| 维度 | 说明 |
| :--- | :--- |
| **职责分离** | 规范（Spec）和代码分开管理，各司其职 |
| **权限清晰** | 后端团队只负责代码仓库，架构师维护 Spec 仓库 |
| **多工程共享** | 所有代码工程共用同一份 Spec，保证需求理解一致 |
| **命令共享** | 每个代码工程通过软链接共享 Spec 的命令，AI 行为一致 |
| **版本独立** | Spec 和代码各自独立发版 |
| **新人友好** | 新人只需克隆 Spec 仓库 + 自己负责的代码工程即可开始 |

---

## 三、初始化流程

### 3.1 负责人初始化

```bash
# 1. 创建并初始化 Spec 仓库
mkdir spec-project && cd spec-project
git init
speccore init

# 2. 从全量层生成期次
speccore iteration-from-global --reqs=REQ-001,REQ-002 --name=2026-07-会议预定

# 3. 推送到远程
git add .
git commit -m "chore: 初始化 Spec 项目"
git push
```

### 3.2 团队成员拉取

```bash
# 1. 克隆 Spec 仓库
git clone git@github.com:your-orgspeccore project.git

# 2. 克隆自己负责的代码工程（平级目录）
git clone git@github.com:your-org/my-backend.git
git clone git@github.com:your-org/my-frontend.git

# 3. 在代码工程中配置 AI 命令（软链接）
cd my-backend
ln -s ..speccore project/.codebuddy/commands .codebuddy/commands
```

---

## 四、两种工作方式

| 方式 | 适用场景 | 操作 |
| :--- | :--- | :--- |
| **A：在 Spec 仓库中工作** | 集中管理 Spec、创建期次、同步全量层 | 打开 `spec-project/`，所有 `speccore *` 命令可用 |
| **B：在代码工程中开发** | 编写代码时使用 Spec 命令 | 在代码工程中创建软链接，命令同样可用 |

---

## 五、路径映射

如果代码工程和 Spec 工程不在同一层级，调整软链接路径：

| 布局 | 软链接命令 |
| :--- | :--- |
| 平级 | `ln -s ..speccore project/.codebuddy/commands .codebuddy/commands` |
| 嵌套 | `ln -s ../..speccore project/.codebuddy/commands .codebuddy/commands` |

---

## 六、各仓库职责

| 仓库 | 内容 | 提交频率 | 维护者 |
| :--- | :--- | :--- | :--- |
| `spec-project/` | `.speccore/` + 期次 + Task | 每次需求变更 | 架构师 / Tech Lead |
| `my-backend/` | 后端代码 | 每次代码变更 | 后端团队 |
| `my-frontend/` | 前端代码 | 每次代码变更 | 前端团队 |

---

## 七、IDE 配置（可选）

在代码工程中配置 IDE，指向 Spec 仓库的命令目录：

```json
// my-backend/.vscode/settings.json
{
  "speccore.commandsPath": "..speccore project/.codebuddy/commands"
}
```

---

## 八、备选方案对比

| 方案 | 优点 | 缺点 | 适用场景 |
| :--- | :--- | :--- | :--- |
| **A：Spec 独立仓库（推荐）** | 职责分离、多工程共享 | 需配置软链接 | 多团队协作、多代码工程 |
| **B：Spec 放在代码工程内** | 简单直接 | Spec 被某个工程"绑定" | 单项目、原型验证 |
| **C：Monorepo** | 统一管理 | 仓库大、权限难控 | 小团队、全栈项目 |

---

## 九、一句话总结

`spec-project/` 作为规范中心，各代码工程平级部署并通过软链接共享 AI 命令，实现规范与代码的职责分离。

---

## 相关文档

- [快速开始指南](quick-start.md) — 从零上手 SpecCore

- [命令参考手册](command-reference.md) — 完整命令参数
- [README](../README.md) — 项目概述
