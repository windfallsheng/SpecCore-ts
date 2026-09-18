# SpecCore 命令参考

> 核心命令流水线与常用命令速查

---

## 1. 核心命令流水线

```
init → doc2spec → analyze → split → plan → execute → pr → done → spec2doc
```

### 各阶段职责

| 阶段 | 输入 | 输出 |
|------|------|------|
| init | - | `.speccore/` + `Iteration-sample/` + AGENTS.md |
| doc2spec | Word/MD PRD | `010-requirements/{feature}/README.md` |
| analyze | 010-requirements/ 所有 .md → CONSTITUTION 映射 | `020-specs/` 三层架构（overview/ 全局 + `{feature}/overview/` 模块综合 + `{feature}/{端}/` 端专属） |
| split | 020-specs/ + CONSTITUTION.md 端配置 | `030-tasks/{type}/Task-NNN-slug/`，按端智能推断涉及的端并拆分子任务 |
| plan | 任务列表 + STAFFING | `PLAN.md` + `speccore-plan.html` + `plan.json` |
| execute | REQ.md + TECH.md → AI 生成代码 | 源码 + .issues.md + 多任务时自动生成 `PLAN.md` |
| pr | git branch | Git PR |
| done | Task 完成归档 | GLOBAL/INDEX 更新 |
| spec2doc | 020-specs/ | Word/PDF/HTML |

---

## 2. 常用命令速查

### 2.1 迭代管理

```bash
speccore iteration create -n <name> --topic <topic>    # 创建迭代
speccore iteration split -i <iteration>                # 拆分任务
speccore iteration list                                # 列出迭代
```

### 2.2 需求分析

```bash
speccore analyze -I <迭代名> --auto                    # 全量分析（自动模式）
speccore analyze -I <迭代名> --prompt                  # 输出结构化 Prompt
speccore analyze --scope global --with-code            # 全局分析（携带源码）
```

### 2.3 任务执行

```bash
speccore execute -i <迭代名> --all                     # 执行所有待执行任务
speccore execute -i <迭代名> -t <task> --prompt        # 单任务 Prompt 模式
speccore execute --resume                              # 续跑中断任务
speccore execute --list-pending --batch-size 3         # 列出待执行清单
```

### 2.4 验证与审查

```bash
speccore verify -t <task>                              # 代码验证（编译+测试+Lint）
speccore validate -i <迭代名>                          # Spec 完整性验证
speccore review -I <迭代名>                            # Spec 自审
```

### 2.5 部署与流水线

```bash
speccore pipeline --env staging --all                  # 环境驱动部署流水线
speccore build -p <platform>                           # 按端构建
speccore deploy -p <platform> -e <env>                 # 部署到指定环境
```

### 2.6 状态与报告

```bash
speccore status                                        # 当前迭代状态
speccore dashboard                                     # 项目仪表盘
speccore doctor                                        # 项目健康度诊断
speccore retro --all                                   # 迭代复盘
```

---

## 3. 多端全量分析与合成（全自动三阶段）

```bash
# 全自动三阶段（推荐）
speccore synthesize --full -I <迭代名>

# 单阶段手动执行
speccore synthesize --phase 1 -I <迭代名>   # 只跑逐端分析
speccore synthesize --phase 2 -I <迭代名>   # 只跑跨端综合
speccore synthesize --phase 3 -I <迭代名>   # 只跑需求合成
```

---

## 4. 环境驱动部署流水线（v8.3.60+）

### 五层环境模型

| 环境 | 分支示例 | 用途 |
|:---|:---|:---|
| `local` | — | 本地开发调试 |
| `dev` | `develop` | 开发联调 |
| `test` | `release/test` | 测试 / QA / SIT |
| `staging` | `staging` | 预发布 / 准生产 |
| `production` | `main` | 线上生产 |

### Pipeline 执行流程

```bash
speccore pipeline --env staging --all
  → 读取 .speccore/environments/staging.yaml
  → 获取 branch = "staging"
  → 获取当前 Git 分支
  → 对每个端：checkout → pull → merge → build → deploy
```

---

## 5. 输出标记体系

| 标记 | 含义 | 动作 |
|:---|:---|:---|
| `[SPECCORE_EXEC: <cmd>]` | 自动执行命令 | 直接 execute_command |
| `[SPECCORE_STEP_DONE]` | 步骤完成 | 当前步骤已完成，需新会话继续 |
| `[SPECCORE_NEXT_STEP]` | 下一步指令 | 提示下一步骤和继续命令 |
| `[SPECCORE_SESSION_AGENT: <name>]` | 会话 Agent 激活 | 指定当前步骤的 Agent 角色和上下文预算 |
| `[SPECCORE_CONTEXT_SNAPSHOT]` | 上下文快照 | 紧凑上下文，供新会话恢复 |
| `[SPECCORE_PROMPT]` | AI Prompt 块 | 将后续内容作为 Prompt 传给宿主 AI |
| `[SPECCORE_RESULT]` | 执行结果 | 展示命令执行的结果数据 |

---

> 完整历史设计文档见 [DESIGN.md](DESIGN.md)
