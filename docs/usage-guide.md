# SpecCore 文件编辑指南

> 哪些文件可以手动编辑？哪些必须用命令？编辑后要做什么？

> 💡 **命令类型**：下文 `speccore change` 等为 🔒 AI 命令，需在 AI IDE 中通过 `@spec-ask` 使用。

---

## 1. 三层文件总览

### .speccore/ 层（全局配置，由 `init` 创建）

| 文件 | 来源 | 可编辑？ | 编辑后 |
| :--- | :--- | :--- | :--- |
| `CONSTITUTION.md` | init 自动生成 | ✅ 可 | 下次 execute 读取 |
| `.speccore.yml` | init 自动生成 | ✅ 可 | 下次 execute 读取 |
| `POST_COMPLETION.md` | init 自动生成 | ✅ 可 | 下次 execute 读取 |
| `config/platforms.yaml` | init + platform-add | ⚠️ 用 `config --set` | task new 使用 |
| `local/context.json` | 命令维护 | ❌ 不可 | 命令会覆盖 |
| `local/execution-state.json` | execute 生成 | ❌ 不可 | 断点续跑依赖它 |
| `.git-mapping.json` | execute/current 写入 | ❌ 不可 | 分支映射依赖它 |
| `GLOBAL/INDEX.md` | index-update 构建 | ❌ 用 `index-update` | 手动改会被覆盖 |
| `GLOBAL/REQUIREMENT.md` | 手动 + sync | ✅ 可 | 编辑后跑 `sync --global` |
| `GLOBAL/PROJECTS/<name>/` | import 填充 | ✅ 编辑需求 | 编辑后跑 `sync --global` |
| `GLOBAL/BASELINES/` | baseline 创建 | ❌ 不可 | 用 baseline 命令 |

### 迭代层（`Sprint-xxx/`，由迭代命令创建）

| 文件 | 来源 | 可编辑？ | 编辑后 |
| :--- | :--- | :--- | :--- |
| `PROJECT_GRAPH.md` | iteration taskify 生成 | ❌ **不可** | 用 `update` / `plan`；CLI 会覆盖手动改 |

### 任务层（`Task-xxx/`，由 task new 创建）

| 文件 | 来源 | 可编辑？ | 编辑后 |
| :--- | :--- | :--- | :--- |
| `backend/REQ.md` | task new 骨架 | ✅ 自由编写 | 跑 `speccore sync` |
| `backend/TECH.md` | task new 骨架 | ✅ 自由编写 | 无需操作 |
| `backend/TASK.md` | task new + sync 填充 | ✅ 补充细节 | 跑 `speccore sync` |
| `_shared/API_CONTRACT.yaml` | task new 骨架 | ⚠️ YAML 敏感 | 跑 `speccore validate` |
| `_shared/TRACE.md` | sync 自动生成 | ❌ 不可 | sync 会覆盖 |

---

## 2. 安全区 — 直接编辑

描述性文本，非结构化数据。

| 文件 | 安全内容 | 为什么安全 |
| :--- | :--- | :--- |
| `REQ.md` | 需求、背景、业务规则 | 作为指令读取，非结构化解析 |
| `TECH.md` | 技术设计、架构 | 给 AI 和开发者看的文档 |
| `*.md` 注释 | 备注、TODO | 不影响流程 |
| `CONSTITUTION.md` | 技术规范、编码规则 | execute 时读取 |
| `.speccore.yml` | 统一配置 | 同上 |

---

## 3. 危险区 — 用命令

元数据、状态、关系 —— 系统依赖。

| 文件 | 手动编辑后果 |
| :--- | :--- |
| `PROJECT_GRAPH.md` 表格 | 下次 plan/execute 时 CLI 覆盖 |
| `API_CONTRACT.yaml` | 缩进错误 → validate 失败 |
| `*.json` 数据 | 枚举拼写错 → ZodError 崩溃 |
| `INDEX.md` | index-update 覆盖 |
| `TRACE.md` | sync 覆盖 |

```bash
speccore change --req=REQ-001 --desc="修改描述"
speccore update -t T-001 --status=completed
```

---

## 4. 谨慎区 — 编辑后同步

| 文件 | 正确流程 |
| :--- | :--- |
| `GLOBAL/REQUIREMENT.md` | 编辑 → `speccore sync --global` |
| `API_CONTRACT.yaml` | 编辑 → `speccore validate` |
| `config/platforms.yaml` | 用 `speccore config --set` 或 `platform-add` |

---

## 5. 速查表

| 你想做什么 | ✅ 正确方式 | ❌ 错误方式 |
| :--- | :--- | :--- |
| 编辑需求 | 编辑 `REQ.md` → `speccore sync` | 直接改 .json |
| 标记任务完成 | `speccore update -t T-001 --status=completed` | 改 PROJECT_GRAPH.md |
| 加 API 接口 | 编辑 `API_CONTRACT.yaml` → `speccore validate` | 不校验就提交 |
| 改负责人 | `speccore update -t T-001 --assignee=Zhang` | 改 PROJECT_GRAPH.md |
| 加全局需求 | 编辑 `GLOBAL/REQUIREMENT.md` → `speccore sync --global` | 改了不同步 |
| 删任务 | `speccore delete -t T-001` | rm -rf |
| 重命名 | `speccore rename --target=old --new-name=new` | mv + 改所有引用 |

---

## 6. 核心原则

```
编辑文本求快 → 用命令求安全。
编辑 Spec → 同步回去。编辑 YAML → 校验。
```

CLI 从不阻止手动编辑，但它**会**在下次命令运行时覆盖结构化元数据（表格、JSON、YAML）。描述性文本（需求、设计、注释）永远安全。

---

## 相关文档

- [场景实战](scenarios.md) — 几十个真实场景
- [命令参考](command-reference.md) — 完整命令参数
- [快速开始](quick-start.md) — 上手
- [README](../README.md) — 项目总览
