---
name: spec-dashboard
aliases: [spec-dash, spec-board]
description: 📊 生成可视化仪表盘：全量层总览、期次燃尽图、项目依赖图
category: SpecCore
intent:
  triggers:
    keywords: [仪表盘, 看板, 可视化, 总览图]
    patterns:
      - "仪表盘"
      - "看板"
      - "可视化"
      - "生成.*总览"
  params:
    - name: output
      extract: "output"
      default: "./speccore-dashboard.html"
      description: "输出文件路径"
  examples:
    - "生成仪表盘"
    - "可视化看板"
    - "项目总览图"
---

# /spec-dashboard - 生成可视化仪表盘

## 命令说明

基于全量层数据生成一个静态 HTML 仪表盘，可直接在浏览器中打开，无需任何服务器。

**包含内容**：
1. 统计卡片：总需求数、已实现、进行中、待开发
2. 需求状态分布（饼图）
3. 项目需求分布（柱状图）
4. 项目列表（含状态）
5. 当前期次 Task 状态

**技术栈**：纯静态 HTML + Chart.js（CDN 加载），开箱即用。

## 使用方式

### 标准命令格式
```bash
/spec-dashboard
/spec-dashboard --output=./reports/dashboard.html
```

### 自然语言格式
```bash
生成仪表盘
可视化看板
项目总览图
```

## AI 执行流程

### 第一步：采集数据

从以下位置采集数据：
- `GLOBAL/INDEX.md` → 全量需求状态、项目列表
- `GLOBAL/ARCHITECTURE.md` → 服务依赖关系
- `期次-XXX/00-期次总览/PROJECT_GRAPH.md` → Task 状态
- `.speccore/local/context.json` → 当前上下文

### 第二步：生成 HTML

使用内置仪表盘模板，填充采集到的数据。

### 第三步：输出结果
```markdown
✅ 仪表盘已生成！

📁 输出文件：./speccore-dashboard.html

📊 包含内容：
  - 需求状态分布图（饼图）
  - 项目需求分布（柱状图）
  - Task 完成情况（条形图）
  - 项目详细列表

💡 在浏览器中打开即可查看。
   支持移动端自适应布局。
```
