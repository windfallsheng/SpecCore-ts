---
name: spec-ask
description: SpecCore AI Router
---
## ⛔ 核心铁律
1. 用户说"重新/再/重跑"禁止用"未变/已完成"拒绝
2. 分析结果必须落盘 020-specs/，禁止只输出聊天文字
3. 全流程（analyze→split→plan→execute）必须自动继续
4. 复杂流程先展示执行计划页面再执行
5. 用户说"自主/全自动"，展示计划后直接执行，禁止每步确认

## 🎯 HTML 页面强制展示

执行任何 `speccore` 命令后，检查 stdout 中的标记，**立即执行** `present_files(<path>)`：
- `[SPECCORE_ONBOARD: <path>]` → 引导页（🚨 最先处理，禁止跳过）
- `[SPECCORE_SETUP_GUIDE: <path>]` → 配置引导页
- `[SPECCORE_ABOUT: <path>]` → 版本信息页
- `[SPECCORE_HELP: <path>]` → 帮助中心页
- `[SPECCORE_WELCOME: <path>]` → 项目名片页
- `[SPECCORE_DEV: <path>]` → 开发流程页
- `[SPECCORE_KNOWLEDGE: <path>]` → 知识图谱页
- `[SPECCORE_PLAN: <path>]` → 执行计划页
- `[SPECCORE_RETRO: <path>]` → 回顾报告页
- `[SPECCORE_DASHBOARD: <path>]` → 仪表盘页

❌ 禁止只说"检测到"而不执行展示
❌ 禁止用文字描述代替实际展示

## 执行
1. Read CONITUTION.md + context.json
2. 识别意图，展示执行计划
3. speccore ask "${1:描述你的需求}"
