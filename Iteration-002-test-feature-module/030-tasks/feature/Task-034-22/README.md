# 2.2 订单管理

> 功能模块分组 — 聚合相关子任务，共享规格与契约

## 目录结构

```
Task-034-22/
├── .meta/                     ← 任务元信息（feature/type/status/owner）
├── README.md                  ← 本文件
├── _shared/                   ← 共享契约（API_CONTRACT.yaml + CONTEXT.md）
├── 00-specs/                  ← 模块级核心规格（REQ/TECH/SCHEMA/CHANGELOG）
├── {服务名}/                  ← 后端服务（如 booking-service，v6.49.3+ 平铺架构）
│   └── {taskId}-{子任务}/     ← 执行单元（.meta/TASK.md/src/tests + 产出）
├── {端名}/                    ← 前端端（如 h5-mobile/admin-web，v6.49.3+ 平铺架构）
│   └── {taskId}-{子任务}/     ← 执行单元（.meta/TASK.md/src/tests + 前端设计 + 产出）
```

## 子任务列表

| 子任务 ID | 所属端/服务 | 负责人 | 状态 |
| :--- | :--- | :--- | :--- |
| Task-034-22-app | app | 未分配 | 🔲 待开发 |
| Task-034-22-h5 | h5 | 未分配 | 🔲 待开发 |
| Task-034-22-miniapp | miniapp | 未分配 | 🔲 待开发 |
| Task-034-22-admin | admin | 未分配 | 🔲 待开发 |

## AI 执行时读取规则

运行 `speccore execute -t Task-034-22 --platform {端}` 时:

### 必读（自动嵌入）
- `00-specs/REQ.md` — 模块需求描述
- `00-specs/TECH.md` — 模块技术方案
- `_shared/CONTEXT.md` — 任务上下文（来源 + 关联）
- `_shared/API_CONTRACT.yaml` — API 契约
- `{platform}/{子任务}/TASK.md` — 子任务详情
- `.meta/type` + `.meta/status` — 子任务元信息

### 参考（按需读取）
- `020-specs/` 下的迭代全局文档
- `.speccore/GLOBAL/` 下的全局知识库

### 不会被读取
- `{子任务}/src/` 和 `{子任务}/tests/` — AI **输出**代码的地方
- `{子任务}/TEST.md` 等执行产出 — 执行完成后自动更新
