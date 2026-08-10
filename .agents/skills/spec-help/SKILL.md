---
name: spec-help
description: SpecCore help — HTML 展示页
version: 5.69.2
category: display
---

# /spec:help

执行 `speccore help`，生成 HTML 并在 IDE 中直接展示。

## 执行步骤
1. 读取项目根目录 AGENTS.md 了解上下文
2. 执行: `speccore help`
3. 从输出中提取生成的 HTML 文件路径（一般为 `speccore-help.html` 或 `deploy/help.html`）
4. 使用 `present_files` / `file://` 直接打开该 HTML 文件

## 注意
- 不需要终端用户手动操作，AI 直接展示页面
- accept页可直接与用户交互，无需返回文本
