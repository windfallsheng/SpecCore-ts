# 任务拆分强制约束

## 拆分粒度控制

- **单次迭代总功能模块数上限 20 个** — 超出必须合并（功能模块 = Task 目录，不是子任务）
- **每个功能模块按涉及的端自动拆分子任务**，每个端默认只创建一个子任务
- **子任务是最终执行单元**（`Task-NNN/{端名}/Task-NNN-{端名}/`），超出默认子任务需用户手动创建
- **禁止跳过任何功能模块** — 即使信息不足，也必须基于已有信息拆分并填充内容

## 字段完整性

- **禁止输出空内容** — `reqContent`、`techContent`、`devGuideContent` 每个字段长度必须 ≥ 200 字符
- **禁止省略字段** — JSON 中必须包含 `reqContent`、`techContent`、`devGuideContent` 三个字段
- **topic 必须是英文短横线格式** — 如 `user-authentication`，用于生成任务目录名
- **scope 必须使用标准端名** — 决定子任务按哪些端创建，端名错误会导致子任务目录错误
- **内容必须从 analyze 产物提取** — `reqContent` 从 `REQUIREMENT.md`，`techContent` 从 `TECH.md`，`devGuideContent` 从 `DEV_GUIDE.md`
