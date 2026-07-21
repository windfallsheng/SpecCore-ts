# SpecCore 迁移指南：Shell v3.x → CLI v5.x

> 从 Shell 版 Speccore 迁移到 CLI 版的完整指南。

---

## 自动迁移（推荐）

```bash
# 在现有 Speccore 项目目录中执行
cd my-speccore-project
speccore migrate

# 预览模式（不实际修改）
speccore migrate --dry-run
```

`speccore migrate` 自动完成以下操作：
1. 检测 Shell 版本号
2. 统计现有期次和任务数量
3. 补充缺失的 GLOBAL/ 全量层目录
4. 创建 `.speccore/config/platforms.yaml` 多平台配置
5. 更新 `context.json` 到 v5 格式（保留已有数据）
6. 创建/更新 `.gitignore`

---

## 手动迁移步骤

### 1. 安装 CLI 版

```bash
npm install -g speccore
speccore --version   # 应显示 v4.x
```

### 2. 运行迁移

```bash
cd your-speccore-project
speccore migrate
```

### 3. 验证迁移

```bash
speccore validate
speccore global-status
```

### 4. 重新初始化（可选）

```bash
speccore init --force
```

---

## 迁移前后对比

| 方面 | Shell 版 (v3.x) | CLI 版 (v5.x) |
| :--- | :--- | :--- |
| 安装方式 | git clone + PATH | `npm install -g speccore` |
| CLI 命令 | 3 个脚本 | 54 个命令 |
| 测试覆盖 | 无 | 148 个测试用例 |
| 数据模型 | 无 | Zod Schema |
| 文件操作 | 直接写入 | 事务保护 |
| 国际化 | 仅中文 | 中英双语 |
| 多平台 | 不支持 | `--platforms=web,h5` |

---

## 常见问题

### Q: 迁移会丢失数据吗？

A: 不会。迁移命令有事务保护，任何操作失败会自动回滚。建议先用 `--dry-run` 预览。

### Q: Shell 版和 CLI 版可以共存吗？

A: 可以。CLI 版兼容 Shell 版的目录结构，可以在同一项目中按需使用。

### Q: 迁移后还需要 Shell 版吗？

A: 不需要。CLI 版包含了 Shell 版的所有功能并大幅增强。
