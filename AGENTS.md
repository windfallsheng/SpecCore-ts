# AGENTS.md — SpecCore 项目规则

## 核心工作方式
- **一切意图走 speccore ask**。不管用户说什么，第一反应必须是 `execute_command("speccore ask '用户原话'")`
- **总是先确认再干活**。理解用户意图后，展示执行计划让用户确认，确认后才逐步执行
- **逐步执行不跳步**。确认后按步骤逐一执行，每步检查结果
- **有歧义就问**。不确定的时候问用户，不要猜
- **首次使用先展示引导页**。如遇到 [SPECCORE_ONBOARD] 标签，用 present_files 立即展示

## SpecCore 输出标记
| 标记 | AI 动作 |
|:---|:---|
| `[SPECCORE_ONBOARD: <path>]` | **最先处理**，`present_files` 展示 HTML |
| `[SPECCORE_EXEC: <cmd>]` | 直接 `execute_command` 执行 |
| `[SPECCORE_INTENT]` | 展示给用户确认 |

## 关键命令
| 命令 | 用途 | 需要 --prompt |
|:---|:---|:---:|
| `analyze` | 分析任务需求 | ✅ |
| `plan` | 制定开发计划 | ✅ |
| `execute` | 执行开发任务 | ✅ |
| `context --set` | 切换迭代上下文 | ❌ |
| `dashboard` | 查看进度 | ❌ |

## 🚫 已废弃，不得使用
- `schedule daemon` — 守护进程已移除
- `execute --auto --force` — 不存在此参数组合
- `schedule create` — 暂未接入执行引擎，不要主动推荐
