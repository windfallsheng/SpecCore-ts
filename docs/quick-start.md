# SpecCore 快速开始

安装 → 初始化 → 开发 → 发布，21 个命令覆盖完整开发闭环。

## 两种用法

| | 终端 CLI | AI IDE（@spec-ask） |
|:---|:---|:---|
| 初始化 | `speccore init` | `speccore init` |
| 查看状态 | `speccore dashboard` | `speccore dashboard` |
| 创建期次 | `speccore iteration create` | `speccore iteration create` |
| 创建任务 | `speccore task new -n 用户登录` | `speccore task new -n 用户登录` |
| 导入需求 | — | `@spec-ask "导入PRD.docx"` 🔒 |
| 分析需求 | — | `@spec-ask "分析当前迭代需求"` 🔒 |
| 代码分析 | — | `@spec-ask "全局代码健康扫描"` 🔒 |
| 拆分任务 | — | `@spec-ask "拆分为开发任务"` 🔒 |
| 执行开发 | — | `@spec-ask "执行 Task-001"` 🔒 |
| 提交PR | — | `@spec-ask "提交 Task-001 的 PR"` 🔒 |
| 完成归档 | — | `@spec-ask "归档 Task-001"` 🔒 |
| 需求变更 | — | `@spec-ask "把手机号改成国际格式"` 🔒 |

## 安装

```bash
npm install -g speccore
```

## 两种模式

| 模式 | 命令数 | 开启 | 适用 |
| :--- | :--- | :--- | :--- |
| **简洁模式**（默认） | 21 个 | `speccore init` | 日常开发够用 |
| 全量模式 | 55 个 | `speccore init --full` | 高级用户 |

> 💡 切换：随时重新 `speccore init` 即可。

---

## 完整流程

```bash
# ① 初始化项目（CLI 命令）
speccore init

# ② 新建期次（CLI 命令）
speccore iteration create --name=Q1

# ③ 导入需求文档（🔒 AI 命令 — 在 AI IDE 中使用 @spec-ask）
@spec-ask "导入 PRD.md 到 Q1 期次的 backend 平台"

# ④ 需求分析（🔒 AI 命令）
@spec-ask "分析 Q1 期次需求"
@spec-ask "全局代码健康扫描"
@spec-ask "联合分析 backend 和 frontend 代码"

# ⑤ 拆分为原子 Task（🔒 AI 命令）
@spec-ask "拆分 Q1 期次为开发任务"

# ⑥ 生成执行计划（🔒 AI 命令）
@spec-ask "生成 Q1 期次的执行计划"

# ⑦ AI 执行开发（🔒 AI 命令）
@spec-ask "执行 Task-001 的开发"

# ⑧ 提交 PR（🔒 AI 命令）
@spec-ask "提交 Task-001 的 Pull Request"

# ⑨ 完成任务（🔒 AI 命令）
@spec-ask "归档 Task-001"
```

## 交互模式 🔒 AI 命令

复杂场景在 AI IDE 中通过交互式执行实现人机协作：

```bash
@spec-ask "交互式分析 Q1 需求"
@spec-ask "交互式拆分任务"
@spec-ask "交互式生成调度计划"
@spec-ask "交互式变更 Task-001"
```

## 常用操作

```bash
# ── CLI 命令（终端直接输入）──
speccore "帮我分析需求"                         # 自然语言（无需记子命令）
speccore ask "查看进度"
speccore task new --name=用户登录               # 快捷创建 Task
speccore validate --iteration=Q1               # 检查合规
speccore rename --target=Task-001 --new-name=用户认证
speccore ops                                    # 操作历史
speccore dashboard                              # 可视化看板
speccore task new --batch-file=bugs.xlsx --type=bugfix --schedule=night --interactive

# ── 🔒 AI 命令（在 AI IDE 中使用 @spec-ask）──
@spec-ask "把手机号改成国际格式"              # 需求变更
```

## 命令速查

### ✅ CLI 命令（终端直接输入）

```bash
# ── 三种入口 ──
speccore "帮我拆分任务"                 # 直接说人话，无需记命令
speccore ask "分析需求"                 # 显式调用意图识别
speccore help --command=execute        # 查看命令详细参数

# ── 项目初始化 ──
speccore init                          # 初始化（默认简洁模式）

# ── 管理 ──
speccore iteration create -n Q1        # 创建迭代
speccore task new -n 用户登录           # 手动创建 Task
speccore task new --batch-file=bugs.xlsx --type=bugfix --interactive  # 批量Bug
speccore task new --batch-file=bugs.xlsx --type=bugfix --schedule=night # 夜间执行

# ── 查看 ──
speccore dashboard                  # 终端状态面板
speccore dashboard --export=html    # 导出HTML仪表盘
speccore validate -i Q1                # Spec 合规检查
speccore ops                           # 操作历史

# ── 其它 ──
speccore rename --task=Task-001 --name=用户模块
speccore help --examples               # 完整场景示例
```

### 🔒 AI 命令（在 WorkBuddy/Cursor/Trae 中使用 @spec-ask）

```bash
# ── 需求 → 任务 ──
@spec-ask "导入 PRD.docx 到 backend 平台 Q1 期次"
@spec-ask "分析 Q1 需求"
@spec-ask "全局代码健康报告"
@spec-ask "拆分 Q1 迭代为开发任务"
@spec-ask "生成 Q1 执行计划"

# ── 开发 → 上线 ──
@spec-ask "执行 Task-001"
@spec-ask "提交 Task-001 的 PR"
@spec-ask "归档 Task-001"

# ── 变更 ──
@spec-ask "把手机号改成国际格式"

# ── 智能级联 ──
@spec-ask "全自动执行"
```

## 目录结构

```
项目/
├── .speccore/               # 全局配置
│   ├── CONSTITUTION.md      # 技术宪法
│   └── RULES/               # 编码规则
├── 期次-Q1/                  # 迭代期次
│   ├── 00-需求文档/
│   └── Task-001/            # 原子任务
│       ├── backend/{服务}/
│       └── frontend/{平台}/
```

## ⏰ 调度执行

### 指定时间自动执行

`schedule create --at` 直接指定时间，守护进程到点自动跑，不需要先放队列。

```bash
speccore schedule create --at "2026-08-10 02:00:00" --all -i Q1 -a 张三 --batch-size=3
speccore schedule create --at "2026-08-10 21:00:00" -t Task-001
speccore schedule daemon start       # 启动守护进程
speccore schedule list               # 查看排队
speccore schedule detail --id=xxx    # 查看详情(人员/分批/类型)
speccore schedule cancel --id=xxx    # 取消
```

### 批量标记 + 手动触发（轻量方式）

`--schedule=night` 标记任务，通过 AI 命令或手动触发执行。

```bash
speccore task new -n "修复登录超时" --type=bugfix --schedule=night
speccore task new --batch-file=bugs.xlsx --type=bugfix --schedule=night

# 🔒 AI: @spec-ask "执行所有 scheduled 任务"
```

## 下一步

- [全量命令参考](command-reference.md) — 21 个命令完整说明
- [总览](overview.md) — 架构与理念
- [场景实战](scenarios.md) — 35 个真实场景
- [示例](https://github.com/windfallsheng/SpecCore-ts/tree/main/examples/meeting-system)
- [SDD 方法论](sdd-methodology.md)
