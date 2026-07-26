# Q1 — 会议预订系统 MVP

> 期次: Q1 | 时间: 2026-07-22 ~ 2026-07-26 | 状态: ✅ 已完成

---

## 需求概述

企业内部会议预订系统 MVP 版本，覆盖四个核心模块：

| 模块 | Task | 平台 | 说明 |
| :--- | :--- | :--- | :--- |
| 会议室管理 | Task-001 | backend | 增删改查 + 分页筛选 |
| 预订订单 | Task-002 | backend | 创建/取消 + 冲突检测 |
| 后台管理 | Task-003 | frontend-web | Vue3 + Element Plus 管理界面 |
| 移动端 | Task-004 | frontend-h5 | Vue3 + Vant4 员工预订 |

---

## 验收标准

- [ ] 管理员可通过 Web 端管理会议室（增删改查）
- [ ] 员工可通过 H5 端查看会议室并预订
- [ ] 系统自动检测时间冲突，不允许重复预订
- [ ] 预订成功后发送通知（企业微信）
- [ ] 管理员可取消违规预订

---

## 技术约束

- 后端统一返回 `{ code, message, data }` 格式
- 前端 API 调用封装在 `src/api/` 目录
- 所有接口遵循 `.speccore/CONSTITUTION.md` 中定义的规范

---

## 关联资源

- PRD: [PRD/PRD.md](../PRD/PRD.md)
- 原型: [PRD/prototype-admin.html](../PRD/prototype-admin.html) | [PRD/prototype-h5.html](../PRD/prototype-h5.html)
- 宪法: [.speccore/CONSTITUTION.md](../.speccore/CONSTITUTION.md)
