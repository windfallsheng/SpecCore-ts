---
name: spec-report
aliases: [spec-rp, spec-rpt]
description: 📊 一键生成项目进展报告（支持 markdown/html/json）
category: SpecCore
suggestions:
  - "--iteration=<期次>  指定期次（默认当前期次）"
  - "--format=html       输出 HTML 格式"
  - "--format=json       输出 JSON 格式"
  - "--output=<路径>     保存到文件"
intent:
  triggers:
    keywords: [报告, 汇报, 生成报告]
    patterns:
      - "生成报告"
      - "汇报"
  params:
    - name: iteration
      extract: "iteration"
      default: "auto"
      description: "期次名称"
    - name: format
      extract: "format"
      default: "markdown"
      description: "输出格式（markdown/html/json）"
  examples:
    - "生成项目报告"
    - "汇报一下项目进展"
    - "生成汇报材料"
---
# /spec-report - 生成项目报告

## 命令说明

一键生成完整的项目进展报告，适合向领导、客户或团队汇报。自动采集项目数据并生成结构化的报告。

## 使用方式

```bash
/spec-report
/spec-report --iteration=2026-07-会议预定
/spec-report --format=html
/spec-report --format=json
/spec-report --output=./报告.md
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| 无参数 | - | 使用当前期次 | `/spec-report` |
| `--iteration=<期次>` | 否 | 指定期次（默认当前活跃期次） | `/spec-report --iteration=2026-07-会议预定` |
| `--format=<格式>` | 否 | 输出格式：markdown/html/json | `/spec-report --format=html` |
| `--output=<路径>` | 否 | 输出文件路径 | `/spec-report --output=./报告.md` |
| `--team` | 否 | 包含团队分析 | `/spec-report --team` |
| `--risk` | 否 | 包含风险分析 | `/spec-report --risk` |
| `--trend` | 否 | 包含趋势对比 | `/spec-report --trend` |

## 支持格式

| 格式 | 用途 | 默认 |
| :--- | :--- | :--- |
| `markdown` | 默认，适合文档、邮件 | ✅ |
| `html` | 适合网页、邮件发送 | - |
| `json` | 适合导入其他系统 | - |

## AI 执行流程

### 第一步：加载上下文

1. 读取 `.speccore/local/context.json` 获取当前上下文
2. 如果未指定 `--iteration`，自动使用 `current_iteration`
3. 如果 `current_iteration` 为空，自动检测活跃期次

### 第二步：数据采集

从以下来源采集数据：
- `PROJECT_GRAPH.md`：任务状态、完成率、依赖关系
- 各 `TASK.md`：产出物、变更履历、验收结果
- `.speccore/PATTERNS/`：模式沉淀数量
- `ITERATIONS/README.md`：期次信息、时间范围
- `.speccore/PROJECT/TEAM.md`：团队成员信息
- `.speccore/SETTINGS.md`：框架配置
- `.speccore/RULES/CODE_REVIEW.md`：审查统计

### 第三步：生成报告

#### Markdown 格式（默认）

```markdown
# 项目进展报告 - {期次名称}

> 生成时间：{YYYY-MM-DD HH:mm:ss}
> 生成工具：SpecCore /spec-report
> 报告期次：{期次名称}

---

## 一、项目概览

| 项目 | 信息 |
| :--- | :--- |
| 项目名称 | {项目名称} |
| 当前期次 | {期次名称} |
| 项目状态 | {开发中/进度正常/延期风险/已完成} |
| 整体进度 | {完成率}% |
| 预计完成 | {预计完成日期} |
| 报告生成时间 | {YYYY-MM-DD HH:mm:ss} |

## 二、本期成果

### 2.1 任务统计

| 指标 | 数值 |
| :--- | :--- |
| 总 Task 数 | {N} 个 |
| 已完成 | {N} 个（{N}%） |
| 进行中 | {N} 个（{N}%） |
| 待开发 | {N} 个（{N}%） |
| 已归档 | {N} 个 |

### 2.2 代码产出

| 指标 | 数值 |
| :--- | :--- |
| 新增代码行数 | +{N} 行 |
| 修改代码行数 | ~{N} 行 |
| 删除代码行数 | -{N} 行 |
| 新增文件 | {N} 个 |
| Bug 修复 | {N} 个 |

### 2.3 模式沉淀

| 新增模式 | 描述 | 复用次数 |
| :--- | :--- | :--- |
| {模式名} | {描述} | {N} |

## 三、团队情况（--team）

| 成员 | 任务数 | 完成数 | 完成率 | 角色 | 主要贡献 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| {姓名} | {N} | {N} | {N}% | {后端/前端/全栈} | {主要工作内容} |

## 四、风险与问题（--risk）

| 风险 | 影响 | 应对措施 | 状态 |
| :--- | :--- | :--- | :--- |
| {描述} | {影响范围} | {措施} | {已解决/进行中/待处理} |

## 五、趋势对比（--trend）

| 指标 | 上期 | 本期 | 变化 |
| :--- | :--- | :--- | :--- |
| 完成率 | {N}% | {N}% | +{N}% |
| 平均完成时间 | {N} 天 | {N} 天 | -{N} 天 |
| Bug 数 | {N} | {N} | -{N} |

## 六、下期计划

| 计划 | 描述 | 负责人 | 预计完成 |
| :--- | :--- | :--- | :--- |
| {计划项} | {描述} | {负责人} | {日期} |

## 七、模式沉淀（可复用资产）

| 模式 | 描述 | 位置 | 复用次数 |
| :--- | :--- | :--- | :--- |
| {模式名} | {描述} | {路径} | {N} |

---

> 📊 报告由 SpecCore 自动生成，数据来自项目 Spec 文件。
> 如需详细信息，请查看对应 TASK.md 和 PROJECT_GRAPH.md。
```

#### HTML 格式

生成可直接打开的 HTML 文件，包含：
- 响应式布局，适合邮件发送
- 图表可视化（进度饼图、任务柱状图）
- 打印友好的样式

#### JSON 格式

```json
{
  "report_meta": {
    "tool": "SpecCore",
    "version": "4.0.0",
    "generated_at": "2026-07-05T14:30:25Z",
    "iteration": "2026-07-会议预定"
  },
  "overview": {
    "project_name": "会议预定系统",
    "status": "开发中",
    "progress_percent": 75,
    "estimated_completion": "2026-07-15"
  },
  "tasks": {
    "total": 10,
    "completed": 7,
    "in_progress": 2,
    "pending": 1,
    "archived": 3
  },
  "code_metrics": {
    "lines_added": 1200,
    "lines_modified": 300,
    "lines_deleted": 150,
    "files_added": 8,
    "bugs_fixed": 2
  },
  "team": [
    {
      "name": "张三",
      "task_count": 3,
      "completed": 3,
      "completion_rate": 100,
      "role": "后端"
    }
  ],
  "risks": [
    {
      "description": "Task-003 会议预定延期 2 天",
      "impact": "前后端联调阻塞",
      "mitigation": "安排专人对接联调",
      "status": "进行中"
    }
  ],
  "patterns": [
    {
      "name": "CRUD Controller",
      "description": "标准 CRUD 控制器模板",
      "path": ".speccore/PATTERNS/TEMPLATES/crud/controller.tmpl",
      "reuse_count": 3
    }
  ]
}
```

### 第四步：保存输出

1. 如果指定了 `--output`，保存到指定文件
2. 如果未指定 `--output`，输出到对话框
3. 如果指定 `--format=html`，同时生成 `.html` 文件

## 示例

### 生成完整报告（Markdown）

```bash
/spec-report
```

### 生成 HTML 报告

```bash
/spec-report --format=html --output=./报告.html
```

生成一个可直接打开的 HTML 文件，适合邮件发送或网页展示。

### 生成 JSON 报告（导入其他系统）

```bash
/spec-report --format=json --output=./report.json
```

### 生成包含团队和风险分析的报告

```bash
/spec-report --team --risk --trend
```
