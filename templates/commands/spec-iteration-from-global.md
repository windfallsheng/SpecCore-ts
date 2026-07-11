---
name: spec-iteration-from-global
aliases: [spec-ifg, spec-iter-global]
description: 🧩 从全量层选择需求，生成新的期次
category: SpecCore
intent:
  triggers:
    keywords: [从全量生成, 基于全局创建, 选择需求生成期次]
    patterns:
      - "从全量(.*)生成期次"
      - "基于全局(.*)创建期次"
      - "选择(.*)需求生成期次"
  params:
    - name: reqs
      extract: "reqs"
      required: true
      description: "需求 ID 列表，逗号分隔"
    - name: name
      extract: "name"
      required: true
      description: "期次名称"
  examples:
    - "从全量选择 REQ-001,REQ-002,REQ-003 生成期次 2026-07-会议预定"
    - "基于全局创建期次 2026-08-订单系统，包含 REQ-004,REQ-005"
    - "选择 REQ-001,REQ-002,REQ-003,REQ-004 生成期次"
---

# /spec-iteration-from-global - 从全量层生成期次

## 命令说明

从 `GLOBAL/INDEX.md` 查找指定需求 ID，定位到对应的项目需求文件，提取需求内容，生成新的期次。

**索引驱动查找流程**：
1. 查 `GLOBAL/INDEX.md` → 获取需求 ID 对应的项目名称和文件路径
2. 读 `GLOBAL/PROJECTS/{project}/REQUIREMENT.md` → 提取需求详情
3. 生成期次 → 写入 `期次-{name}/00-需求文档/REQUIREMENT.md`
4. 更新 `GLOBAL/INDEX.md` 中的「关联期次」「关联 Task」字段

**核心价值**：多项目统一管理全量需求，按业务需要选取部分需求生成期次，避免一次导入全部内容。

## 使用方式

### 标准命令格式
```bash
/spec-iteration-from-global --reqs=REQ-001,REQ-002,REQ-003 --name=2026-07-会议预定
```

### 自然语言格式
```bash
从全量选择 REQ-001,REQ-002,REQ-003 生成期次 2026-07-会议预定
基于全局创建期次 2026-08-订单系统，包含 REQ-004,REQ-005
选择 REQ-001,REQ-002,REQ-003,REQ-004 生成期次
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `--reqs=<列表>` | 是 | 需求 ID 列表，逗号分隔 | `--reqs=REQ-001,REQ-002` |
| `--name=<名称>` | 是 | 期次名称 | `--name=2026-07-会议预定` |

## AI 执行流程

### 第一步：查询索引

读取 `GLOBAL/INDEX.md`，查找指定需求 ID：
```markdown
🔍 查询需求索引...

| 需求 ID | 项目 | 需求名称 | 状态 | 文件路径 |
| :--- | :--- | :--- | :--- | :--- |
| REQ-001 | user-service | 用户登录 | 📦 已有实现 | `PROJECTS/user-service/REQUIREMENT.md` |
| REQ-002 | user-service | 用户权限管理 | 📦 已有实现 | `PROJECTS/user-service/REQUIREMENT.md` |
| REQ-003 | meeting-service | 会议室管理 | 📦 已有实现 | `PROJECTS/meeting-service/REQUIREMENT.md` |

找到 3 个需求，来自 2 个项目。
```

若需求 ID 不存在：
```markdown
❌ 需求 REQ-XXX 不存在

在 GLOBAL/INDEX.md 中未找到该需求 ID。

请先运行 /spec-global-status 查看可用需求列表，或 /spec-import 导入项目。
```

### 第二步：读取需求详情

从各项目的 `PROJECTS/{project}/REQUIREMENT.md` 中提取完整的需求详情。

### 第三步：预览生成方案
```markdown
📋 准备生成期次

期次名称：2026-07-会议预定

选择需求（3 条）：
┌──────────┬──────────────┬──────────────┬──────────┬──────────┐
│ 需求 ID  │ 需求名称     │ 来源项目     │ 优先级   │ 状态     │
├──────────┼──────────────┼──────────────┼──────────┼──────────┤
│ REQ-001  │ 用户登录     │ user-service │ 高       │ 📦 已有  │
│ REQ-002  │ 用户权限管理 │ user-service │ 中       │ 📦 已有  │
│ REQ-003  │ 会议室管理   │ meeting-svc  │ 高       │ 📦 已有  │
└──────────┴──────────────┴──────────────┴──────────┴──────────┘

依赖分析：
- REQ-001：无依赖 → 可首先执行
- REQ-002：依赖 REQ-001
- REQ-003：依赖 REQ-001

将生成 3 个 Task。

是否确认生成？
```

### 第四步：执行生成

1. 创建 `期次-{name}/` 目录结构
2. 创建 `00-需求文档/REQUIREMENT.md`，内容从各项目的 `REQUIREMENT.md` 中提取合并
3. 创建 `00-技术文档/ARCHITECTURE.md`（从全量层 `ARCHITECTURE.md` 继承相关部分）
4. 创建 `00-期次总览/PROJECT_GRAPH.md`
5. 自动执行 `/spec-iteration-split` 拆分为 Task
6. 更新 `GLOBAL/INDEX.md`：
   - 需求索引：更新「关联期次」「状态」字段
   - 期次关联：追加新记录
7. 更新 `.speccore/ITERATIONS/README.md`

### 第五步：输出结果
```markdown
✅ 期次生成完成！

📁 期次：期次-2026-07-会议预定
📋 包含需求：REQ-001, REQ-002, REQ-003

📊 生成 Task（3 个）：
┌──────────┬──────────────┬──────────┬──────────────┐
│ Task     │ 名称         │ 来源     │ 依赖         │
├──────────┼──────────────┼──────────┼──────────────┤
│ Task-001 │ 用户登录     │ REQ-001  │ 无           │
│ Task-002 │ 用户权限管理 │ REQ-002  │ Task-001     │
│ Task-003 │ 会议室管理   │ REQ-003  │ Task-001     │
└──────────┴──────────────┴──────────┴──────────────┘

📋 全量索引已更新：
- REQ-001 → 关联期次：2026-07-会议预定 → Task-001
- REQ-002 → 关联期次：2026-07-会议预定 → Task-002
- REQ-003 → 关联期次：2026-07-会议预定 → Task-003

📋 下一步：
- /spec-plan 生成调度方案
- /spec-execute 开始开发
- 需求变更时运行 /spec-sync-global 同步回全量层
```
