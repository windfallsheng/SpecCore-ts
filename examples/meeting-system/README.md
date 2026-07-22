# MeetBook 会议预订系统 — SpecCore E2E 验证项目

## 文件结构

```
examples/meeting-system/
├── README.md                          ← 本文件
├── INDEX.md                           4 端 → 4 文件映射
├── prototype-admin.html               Web 管理端原型（浏览器打开）
├── prototype-h5.html                  H5 移动端原型（浏览器打开）
├── docs/
│   ├── 需求-后台管理端.md               前端任务 → Vue 3 + Element Plus
│   ├── 需求-H5移动端.md                 前端任务 → Vue 3 + Vant UI
│   ├── 需求-会议室管理服务.md            后端任务 → Spring Boot 3 (room-service)
│   ├── 需求-预订订单服务.md              后端任务 → Spring Boot 3 (booking-service)
│   ├── PRD-会议室预订系统v1.0.md         完整 PRD（汇总参考）
│   └── CR-需求变更v1.0→v1.1.md          需求变更文档（模拟上线后变更）
```

## 关键数据

| 文件 | API | 数据表 | 典型风险 |
| :--- | :--- | :--- | :--- |
| 后台管理端 | 11 | — | 🔐 RBAC 权限 |
| H5移动端 | 8 | — | 🟢 CRUD |
| 会议室管理服务 | 6 | 2 (rooms, users) | 🗄️ DB 变更 |
| 预订订单服务 | 7 | 2 (bookings, notifications) | 💰 计费(变更后) |
| **合计** | **32** | **4** | |

## 使用方式

```bash
cd examples/meeting-system

# 1. 初始化
speccore init

# 2. 导入 4 端需求（每个端独立文件）
speccore word2spec --files "docs/需求-后台管理端.md=后台管理端" -i Q1
speccore word2spec --files "docs/需求-H5移动端.md=H5移动端" -i Q1
speccore word2spec --files "docs/需求-会议室管理服务.md=会议室管理服务" -i Q1
speccore word2spec --files "docs/需求-预订订单服务.md=预订订单服务" -i Q1

# 3. 智能引导（自动检测阶段）
speccore dev

# 4. 需求分析
speccore analyze --iteration=001-Q1

# 5. 拆分任务（前后端自动区分）
speccore iteration split --iteration=001-Q1
# → 4 端 = 4+ Task, 前端含 frontend/ 目录, 后端含 backend/ 目录

# 6. 批量执行
speccore execute --all --force --iteration=001-Q1
# → 前端生成 Vue 组件, 后端生成 Spring Controller/Service/Entity

# 7. 查看状态
speccore status-panel
```

## 3 轮验证

| 轮次 | 内容 | 验证命令 |
| :--- | :--- | :--- |
| 第一轮 | v1.0 全流程 | word2spec → analyze → split → execute |
| 第二轮 | 需求变更 | word2spec(变更文档) → analyze → tracker |
| 第三轮 | 高级功能 | dev / status-panel / agent / merge-check |
