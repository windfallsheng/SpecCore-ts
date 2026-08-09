# 人员分工 — Iteration-001: Meeting System

## 团队组成

| 角色 | 姓名 | 职责 |
|------|------|------|
| 项目经理 | 赵经理 | 进度把控、需求协调 |
| 后端开发 | 钱开发 | Task-001 (Room Service) 负责人 |
| 后端开发 | 孙开发 | Task-002 (Booking Service) 负责人 |
| 前端开发 | 李前端 | Task-003 (Admin Dashboard) 负责人 |
| 前端开发 | 周前端 | Task-004 (H5 Mobile) 负责人 |
| 测试 | 吴测试 | 全流程测试 |
| 产品 | 郑产品 | 需求确认、验收 |

## 任务分配

### Sprint 1 — 后端核心 (Week 1 - Week 2)

| 任务 | 负责人 | 预估工时 | 备注 |
|------|--------|---------|------|
| Task-001: Room Service | 钱开发 | 5 人天 | 含认证和用户管理 |
| Task-002: Booking Service | 孙开发 | 6 人天 | 依赖 Task-001 完成 |
| 后端联调 | 钱+孙 | 1 人天 | Sprint 1 结束前 |

### Sprint 2 — 前端展示 (Week 3 - Week 4)

| 任务 | 负责人 | 预估工时 | 备注 |
|------|--------|---------|------|
| Task-003: Admin Dashboard | 李前端 | 5 人天 | 依赖后端 API 就绪 |
| Task-004: H5 Mobile | 周前端 | 5 人天 | 可并行开发 |
| 前后端联调 | 全体 | 2 人天 | Sprint 2 结束前 |
| 集成测试 | 吴测试 | 2 人天 | 联调完成后 |

## 协作规范

### 代码评审
- 所有 PR 需要至少 1 名同领域同事 Code Review
- 后端 PR → 钱开发或孙开发 Review
- 前端 PR → 李前端或周前端 Review

### 每日站会
- 时间: 每天 9:30
- 内容: 昨日进展、今日计划、阻塞项

### 分支管理
```
feature/task-001-room-service    → 钱开发
feature/task-002-booking-service → 孙开发
feature/task-003-admin-dashboard → 李前端
feature/task-004-h5-mobile       → 周前端
```

### 提测流程
1. 功能开发完成，自测通过
2. 提交 PR，通过 Code Review
3. 合并到 `develop` 分支
4. CI/CD 自动构建部署到测试环境
5. 通知吴测试进行功能测试

## 里程碑

| 里程碑 | 日期 | 交付物 |
|--------|------|--------|
| Sprint 1 完成 | Week 2 周五 | 后端 API 全部可用，Swagger 文档完整 |
| Sprint 2 完成 | Week 4 周五 | 前后端对接完成，功能测试通过 |
| 发布上线 | Week 5 周三 | 生产环境部署，监控就绪 |
