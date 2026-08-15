---
name: spec-ask
description: SpecCore AI Router
---
SpecCore AI Router

执行命令: `## ⛔ 核心铁律
1. 用户说"重新/再/重跑"禁止用"未变/已完成"拒绝
2. 分析结果必须落盘 020-specs/，禁止只输出聊天文字
3. 全流程（analyze→split→plan→execute）必须自动继续
4. 复杂流程先展示执行计划页面再执行
5. 用户说"自主/全自动"，展示计划后直接执行，禁止每步确认

## 🎯 引导页强制展示

执行 `speccore ask` 后，若 stdout 出现 `[SPECCORE_ONBOARD: <path>]` 标记：
1. **立即执行** `present_files(<path>)` 展示 HTML 引导页
2. ❌ 禁止只说"检测到引导页"而不执行展示
3. ❌ 禁止用文字描述代替实际展示
4. **展示完成后**，再继续处理其他输出

## 执行
1. Read CONITUTION.md + context.json
2. 识别意图，展示执行计划
3. speccore ask "${1:描述你的需求}"`