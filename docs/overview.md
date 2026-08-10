# SpecCore 总览

## 是什么

SpecCore 是一个 **规范驱动开发 CLI 工具**。核心理念：**Code by Spec, Not by Vibe**。

- 从需求文档自动生成开发规范
- AI 辅助的需求分析、任务拆分、执行计划
- 全局仪表盘实时追踪项目健康度
- 万能 AI 入口（ask）自动匹配命令

## 核心流程 🔒 AI 命令

```
init → doc2spec → analyze → split → plan → execute → pr → done
✅CLI   🔒AI     🔒AI     🔒AI   🔒AI   🔒AI    🔒AI  🔒AI
```

每个阶段都有对应命令，也可以使用 `@spec-ask "自然语言"` 在 AI IDE 中自动推进。

## 安装

```bash
npm install -g speccore
speccore --version
```

## 三种使用方式

### 1. AI 万能入口（推荐）
```bash
speccore ask "我想做一个登录功能"
speccore ask "查看项目进度"
speccore ask "计划任务，晚8点分批执行"
```

### 2. 单命令执行

```bash
# ✅ CLI 命令（终端直接输入）
speccore init
speccore dashboard --scope global

# 🔒 AI 命令（在 AI IDE 中使用 @spec-ask）
@spec-ask "导入 PRD.docx 到 Q1"
```

### 3. 智能级联 🔒 AI 命令
```bash
# 在 AI IDE 中使用：
@spec-ask "全自动执行"
```

## 关键概念

| 概念 | 说明 |
|------|------|
| **期次 (Iteration)** | 开发迭代，如 Q1/Q2/Q3 |
| **任务 (Task)** | 期次下的独立开发任务 |
| **全量层 (Global)** | 跨项目需求总索引 |
| **Spec** | 需求规格文档 |

## 输出

| 命令 | 终端输出 | AI 输出 | HTML 文件 |
|------|------|------|------|
| ask | Unicode 框线 | HTML 页面 | `speccore-ask-onboarding.html` / `speccore-ask-result.html` / `templates/html/speccore-ask-explain.html` |
| welcome | Unicode 框线 | HTML 页面（彩色卡片） | `deploy/welcome.html` |
| dashboard | 文本 | HTML（Jira 标准 7 维仪表盘） | `deploy/status.html`（--scope global → `deploy/index.html`） |
| dev | 文本 | HTML（Pipeline 可视化） | `speccore-dev.html` |
| help | 文本 | HTML 帮助中心 | `templates/html/speccore-help.html` |
| retro | 文本 | HTML 回顾报告 | `templates/html/speccore-retro-T-001.html` |
| about | 文本 | HTML 关于页 | `speccore-about.html` |
| doc2spec | 文本 | HTML 需求预览 | `templates/html/speccore-ask-result.html` |
| spec2doc | 文本 | HTML 导出预览 | `templates/html/speccore-ask-result.html` |
