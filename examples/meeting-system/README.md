# 会议预订系统 — SpecCore 示例项目

> 基于 SpecCore v5.22.x | 51 命令 | 简洁模式 17 命令

完整演示：原始需求文档 → speccore init → doc2spec → analyze → split → 前后端一体化 Task

---

## 项目结构

```
meeting-system/
├── docs/                                 ← 原始需求文档 (4 份)
│   ├── PRD-会议室预订系统v1.0.md
│   ├── 需求-会议室管理服务.md
│   ├── 需求-预订订单服务.md
│   ├── 需求-后台管理端.md
│   ├── 需求-H5移动端.md
│   └── CR-需求变更v1.0→v1.1.md
├── prototype-admin.html / prototype-h5.html  ← 原型

├── .speccore/                            ← speccore init 生成
│   ├── CAPABILITIES.md                   ← 项目能力注册表
│   ├── CONSTITUTION.md                   ← 全局技术宪法
│   ├── GLOBAL/INDEX.md                   ← 全量需求索引
│   └── config/mode.json                  ← 简洁/全量模式选择

└── 期次-Q1/                              ← speccore doc2spec + split 生成
    ├── 00-期次总览/
    │   ├── METADATA.md                   ← 期次元数据(时间+负责人+里程碑)
    │   └── PROJECT_GRAPH.md              ← 任务总览
    ├── 00-需求文档/                       ← 结构化需求 + 分析
    │   ├── REQUIREMENT.md
    │   ├── ANALYSIS.md
    │   ├── backend需求.md
    │   ├── frontend-web需求.md
    │   └── frontend-h5需求.md
    │
    ├── Task-001-会议室管理/               ← 前后端一体化 Task
    │   ├── TASK.md
    │   ├── backend/
    │   │   └── room-service/             ← 后端服务
    │   │       ├── TASK.md REQ.md TECH.md
    │   │       ├── TEST.md REVIEW.md DEPLOY.md
    │   │       ├── API_CONTRACT.yaml SCHEMA.md ERROR_CODES.md
    │   │       ├── RISK.md DEPS.md MONITOR.md ADR.md
    │   └── frontend/
    │       └── web/                      ← Web 管理端
    │           ├── TASK.md REQ.md TEST.md REVIEW.md
    │           ├── COMPONENT_TREE.md ROUTES.md
    │           ├── STATE.md STYLE_GUIDE.md
    │
    └── Task-002-预订管理/                 ← 双前端 Task
        ├── TASK.md
        ├── backend/booking-service/      ← 后端
        └── frontend/
            ├── web/                      ← Web
            └── h5/                       ← H5 移动端
```

---

## Task 概览

| Task | 后端服务 | 前端 | 负责人 | 状态 |
|:---|:---|:---|:---|:---|
| Task-001 会议室管理 | room-service | web | 张三 | 已完成 |
| Task-002 预订管理 | booking-service | web + h5 | 李四 | 已完成 |

---

## Q1 时间线

| 里程碑 | 日期 | 状态 |
|:---|:---|:---|
| 开发开始 | 2026-07-22 | |
| 提测 | 2026-07-28 | |
| SIT | 2026-07-30 | |
| UAT | 2026-08-01 | |
| 上线 | 2026-08-02 | |

延期: 2026-07-29 会议室管理API联调延期1天

---

## 每个 Task 的标准文件 (13 个后端 + 9 个前端)

**后端**: TASK.md + REQ.md + TECH.md + TEST.md + REVIEW.md + DEPLOY.md + API_CONTRACT.yaml + SCHEMA.md + ERROR_CODES.md + RISK.md + DEPS.md + MONITOR.md + ADR.md

**前端**: TASK.md + REQ.md + TEST.md + REVIEW.md + COMPONENT_TREE.md + ROUTES.md + STATE.md + STYLE_GUIDE.md + API_CONTRACT.yaml(共享)

---

## SpecCore 命令流程

```bash
speccore init                                              # 初始化项目
speccore doc2spec -f docs/PRD.md -p backend --iter=Q1      # 导入需求文档
speccore analyze -I Q1                                     # AI 分析需求
speccore iteration split -i Q1                             # 拆分为 Task
speccore plan -I Q1                                        # 生成执行计划
speccore execute -t Task-001 --force                       # AI 开发
speccore pr --task=Task-001                                # 推送 + 创建 PR
speccore done --task=Task-001                              # 完成归档
speccore status-panel                                      # 查看状��看板
```

---

## 设计亮点

| 特性 | 说明 |
|:---|:---|
| 前后端一体化 | 后端+前端同在一个 Task，按 backend/frontend 分层 |
| 完整 Spec 体系 | 后端 13 文件 + 前端 9 文件，覆盖需求到部署全链路 |
| 时间追踪 | AI时间 + 人工时间 + Review时间 + 延期记录 |
| 里程碑管理 | 提测/SIT/UAT/上线 四阶段 + Delay 追踪 |
| 人员分配 | 按人员分组统计，前端/后端分开排序 |
| 拼音排序 | 100+ 常见姓氏拼音映射 |
