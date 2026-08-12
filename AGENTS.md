# AGENTS.md — SpecCore 项目规则

## 核心工作方式
- **一切意图走 speccore ask**。不管用户说什么，第一反应必须是 `execute_command("speccore ask '用户原话'")`
- **总是先确认再干活**。理解用户意图后，展示执行计划让用户确认，确认后才逐步执行
- **逐步执行不跳步**。确认后按步骤逐一执行，每步检查结果
- **有歧义就问**。不确定的时候问用户，不要猜
- **首次使用先展示引导页（仪式感，不可跳过）**。如遇到 [SPECCORE_ONBOARD] 标签：支持 present_files 的立即展示；不支持的输出提示“🎉 首次使用！请先打开引导页：`<path>`”让用户自行打开，确认后再继续

## SpecCore 输出标记
| 标记 | AI 动作 |
|:---|:---|
| `[SPECCORE_ONBOARD: <path>]` | **🚨 必须最先处理，不可跳过**：支持 present_files → 立即展示；不支持 → 输出文件路径提示用户打开，确认后再继续 |
| `[SPECCORE_WELCOME: <path>]` | 用 present_files 展示欢迎页 HTML |
| `[SPECCORE_HELP: <path>]` | 用 present_files 展示帮助页 HTML |
| `[SPECCORE_DEV: <path>]` | 用 present_files 展示 dev 引导页 HTML |
| `[SPECCORE_SETUP_GUIDE: <path>]` | 用 present_files 展示项目配置引导页 HTML（init 后首次展示） |
| `[SPECCORE_ABOUT: <path>]` | 用 present_files 展示关于页 HTML |
| `[SPECCORE_EXEC: <cmd>]` | 直接 `execute_command` 执行 |
| `[SPECCORE_INTENT]` | 展示给用户确认 |

## 关键命令
| 命令 | 用途 | 类型 | 说明 |
|:---|:---|:---|:---|
| `analyze --prompt` | 分析任务需求 | **AI** | 需要宿主 AI 交互，不能直接在终端运行 |
| `plan --prompt` | 制定开发计划 | **AI** | 需要宿主 AI 交互，不能直接在终端运行 |
| `execute --prompt` | 执行开发任务 | **AI** | 需要宿主 AI 交互，不能直接在终端运行 |
| `split --prompt` | 拆分任务 | **AI** | 需要宿主 AI 交互，不能直接在终端运行 |
| `context --set` | 切换迭代上下文 | **CLI** | 可在终端直接输入 |
| `dashboard` | 查看进度 | **CLI** | 可在终端直接输入 |

## 🚫 已废弃，不得使用
- `schedule`, `schedule create`, `schedule daemon` — **全部废弃**，任何场景都不要推荐
- `execute --auto --force` — 不存在此参数组合
- `execute --auto` — 仅限用户明确说"自动"时使用

## ⚠️ 注意事项
- `-i` / `-I` 参数传**短名**（如 `meeting-system`），不要传完整名（会自动补 `Iteration-`）
- 管道中**禁止加入 schedule 步骤**，用户说定时执行时直接告诉他不支持，改为立即执行
- `task new -i` 也要用短名，配合 `--topic` 英文主题词
