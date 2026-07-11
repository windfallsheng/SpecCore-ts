---
name: spec-new-task
aliases: [spec-nt, spec-task]
description: ✨ 创建单个原子任务，支持多平台
category: SpecCore
intent:
  triggers:
    keywords: [创建一个, 新增一个, 做一个, 开发一个, 实现]
    patterns:
      - "创建(.*)任务"
      - "新增(.*)任务"
      - "做一个(.*)"
      - "开发(.*)"
      - "实现(.*)"
  params:
    - name: name
      extract: "name"
      required: true
      description: "任务名称"
    - name: type
      extract: "type"
      default: "auto"
      description: "任务类型"
    - name: desc
      extract: "desc"
      default: ""
      description: "任务描述"
    - name: platforms
      extract: "platforms"
      default: "all"
      description: "前端平台列表（逗号分隔）"
    - name: backend_only
      extract: "backend_only"
      default: false
      description: "仅创建后端"
    - name: frontend_only
      extract: "frontend_only"
      default: false
      description: "仅创建前端"
  examples:
    - "创建一个登录任务 --platforms=web,h5,miniapp"
    - "修复登录超时"
    - "做一个会议室管理 --platforms=web,miniapp"
    - "调研 OAuth2"
---

# /spec-new-task - 创建原子任务（多平台支持）

## 命令说明
创建单个原子任务，支持指定任务类型和前端平台。默认读取 `platforms.yaml` 确定平台列表。

## 使用方式

```bash
/spec-new-task --name=支付功能 --platforms=web,h5,miniapp
/spec-new-task --name=登录功能 --platforms=all
/spec-new-task --name=支付功能 --backend-only
/spec-new-task --name=前端页面 --frontend-only --platforms=web
```

## 参数说明

| 参数 | 说明 | 示例 |
| :--- | :--- | :--- |
| `--name=<名称>` | 必填，任务名称 | `--name=支付功能` |
| `--type=<类型>` | 任务类型，默认自动推断 | `--type=feature` |
| `--platforms=<列表>` | 前端平台，默认 all | `--platforms=web,h5,miniapp` |
| `--backend-only` | 仅创建后端 | `--backend-only` |
| `--frontend-only` | 仅创建前端 | `--frontend-only` |

## 平台列表说明

| 值 | 说明 |
| :--- | :--- |
| `all` | 所有 `platforms.yaml` 中已声明的平台（默认） |
| `web,h5` | 只创建指定平台 |
| `web,h5,miniapp,tablet` | 创建多个平台 |

## 任务类型选项

| 类型 | 说明 |
| :--- | :--- |
| `feature` | 新功能开发 |
| `bugfix` | Bug 修复 |
| `research` | 技术调研 |
| `optimization` | 性能优化 |
| `migration` | 数据迁移 |
| `document` | 文档编写 |

## AI 执行流程

### 第一步：读取平台配置

读取 `.speccore/config/platforms.yaml`，确定要创建的平台列表。

### 第二步：创建目录结构
```text
Task-XXX-{name}/
├── _shared/
│   ├── API_CONTRACT.yaml
│   └── business-rules.md
├── backend/
│   ├── REQ.md
│   ├── TECH.md
│   └── TASK.md
└── frontend/
    ├── web/           ← 从 platforms.yaml 读取
    │   ├── REQ.md
    │   ├── TECH.md
    │   └── TASK.md
    ├── h5/
    │   └── ...
    └── miniapp/
        └── ...
```

### 第三步：生成各端 Spec

每个平台独立生成 REQ.md、TECH.md、TASK.md。`_shared/` 目录的文件所有平台共享。

### 第四步：更新 PROJECT_GRAPH.md
```markdown
✅ Task-005-支付功能 创建完成！

📁 已创建目录：
- Task-005-支付功能/（feature）
- backend/ REQ.md TECH.md TASK.md
- frontend/web/ REQ.md TECH.md TASK.md
- frontend/h5/ REQ.md TECH.md TASK.md
- frontend/miniapp/ REQ.md TECH.md TASK.md

📋 下一步：/spec-execute --task=Task-005 开始开发
```
