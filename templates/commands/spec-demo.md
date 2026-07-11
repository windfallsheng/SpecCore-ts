---
name: spec-demo
aliases: [spec-dm]
description: 🚀 快速体验模式：5 分钟体验完整示例项目
category: SpecCore
intent:
  triggers:
    keywords: [示例, 体验, 试一下, demo]
    patterns:
      - "示例"
      - "体验"
      - "试一下"
      - "demo"
  params:
    - name: project
      extract: "project"
      default: "book"
      description: "示例项目类型"
  examples:
    - "体验一下"
    - "试一下示例"
    - "跑个 demo"
---
# /spec-demo - 快速体验

## 命令说明
5 分钟快速体验 SpecCore 完整流程，内置示例项目。

**适用场景**：评估框架、快速上手、演示

**核心理念**：让用户在 5 分钟内看到「这个框架能产出什么」。

## 使用方式
```
/spec-demo
/spec-demo --project=book
/spec-demo --project=todo
/spec-demo --project=blog
```

## 支持的示例项目

| 示例 | 标识 | 说明 | 包含功能 |
| :--- | :--- | :--- | :--- |
| 图书管理系统 | `book` | 默认，图书 CRUD + 借阅管理 | 用户认证、图书管理、借阅管理 |
| 待办事项管理 | `todo` | 任务管理 | 任务创建、状态流转、分类 |
| 博客系统 | `blog` | 内容管理 | 文章发布、评论管理、分类 |

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| 无参数 | - | 使用默认示例（book） | `/spec-demo` |
| `--project=<标识>` | 否 | 指定示例类型 | `/spec-demo --project=todo` |
| `--list` | 否 | 列出所有可用示例 | `/spec-demo --list` |

## AI 执行流程

### 第一步：选择示例
```text
📚 快速体验模式

我将为你生成一个完整的示例项目，包含：
  - 完整的需求文档
  - 自动拆分的 Task
  - 生成的代码（含 @spec 注释）
  - 完整的 Spec 追溯链

可选示例：
  1. 📖 图书管理系统（默认）- 包含 CRUD + 借阅管理
  2. ✅ 待办事项管理 - 包含任务创建、状态流转
  3. 📝 博客系统 - 包含文章发布、评论功能

请输入序号选择（默认 1）：
```

用户选择后，AI 加载对应的示例数据。

### 第二步：生成示例

AI 自动执行：
1. 创建 `期次-demo-{示例名称}/` 目录
2. 生成 `00-需求文档/REQUIREMENT.md`（预填充示例需求）
3. 运行 `/spec-iteration-split` 拆分为 Task
4. 生成完整的 Spec 文件（REQ.md、TECH.md、TASK.md）
5. 生成示例代码文件（含 `@spec` 注释）
6. 生成 `PROJECT_GRAPH.md`
7. 生成 `.task-type` 文件

**示例数据结构（图书管理系统）**：

| Task | 名称 | 类型 | 依赖 |
| :--- | :--- | :--- | :--- |
| Task-001 | 用户认证 | feature | 无 |
| Task-002 | 图书管理 | feature | Task-001 |
| Task-003 | 借阅管理 | feature | Task-001, Task-002 |

### 第三步：展示成果
```text
✅ 示例项目生成完成！

📁 位置：期次-demo-book/

📋 包含内容：
  - 3 个 Task（用户管理、图书管理、借阅管理）
  - 8 个 Spec 文件
  - 6 个代码文件（含 @spec 注释）
  - 完整的追溯链
  - 1 个 API_CONTRACT.yaml

📊 示例数据统计：
  - 需求文档：3 个功能模块
  - Task：3 个
  - 代码文件：6 个
  - 总代码行数：~200 行

💡 你可以：
  - 运行 /spec-status 查看任务状态
  - 运行 /spec-review Task-001 审查单个任务
  - 运行 /spec-progress 查看整体进度
  - 运行 /spec-trace Task-001 查看双向追溯

📋 下一步：
  - 修改示例代码，适配你的业务
  - 运行 /spec-archive --all 归档示例
  - 或直接开始开发你的项目：/spec-goal "你的需求"
```

## 示例数据详细内容

### 图书管理系统需求

```markdown
# 图书管理系统 - 需求文档

## 1. 项目背景
管理图书馆的图书和借阅记录。

## 2. 功能模块

### 2.1 用户认证
- 用户注册：手机号 + 密码
- 用户登录：返回 Token
- 密码错误 5 次锁定 15 分钟

### 2.2 图书管理
- 图书 CRUD：标题、作者、ISBN、库存
- 图书搜索：按标题/作者搜索

### 2.3 借阅管理
- 借阅图书：用户借书，库存 -1
- 归还图书：用户还书，库存 +1
- 借阅记录：查询历史借阅
```
