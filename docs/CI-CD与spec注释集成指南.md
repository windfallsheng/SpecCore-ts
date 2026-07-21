# SpecCore CI/CD 与 @spec 注释集成指南

> 适用版本：v5.11.x+ | 难度：入门

---

## 一、CI/CD 集成（三步搭建）

### 1. 安装 Git Hooks（本地）

```bash
speccore hooks install
```

生成 `.git/hooks/pre-commit` 和 `.git/hooks/pre-push`，提交前自动 validate。

### 2. GitHub Actions 配置

创建 `.github/workflows/speccore.yml`：

```yaml
name: SpecCore Validate

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 18

      - run: npm install -g speccore

      - name: Validate Specs
        run: |
          speccore init --force       # 初始化（--force 跳过确认）
          speccore validate --strict  # 严格模式校验

      - name: Health Check
        run: speccore health

      - name: Progress Report
        run: speccore progress --format=json
```

### 3. 各阶段检查项

| CI 阶段 | 检查命令 | 拦截什么 |
| :--- | :--- | :--- |
| Pre-commit | `speccore validate` | REQ.md 格式错误、接口表缺失 |
| Pre-push | `speccore sync --all --detect` | Spec 与代码不一致 |
| PR 检查 | `speccore audit` | 全局合规性 |
| 合并后 | `speccore sync-global --direction=to_global` | 更新视角索引 |
| 发版前 | `speccore dashboard` | 整体进度、健康度一张图 |

### 4. 完整 CI 结构

```
项目根目录/
├── .github/
│   └── workflows/
│       └── speccore.yml        ← CI 配置
├── .speccore/                  ← SpecCore 项目配置
├── src/                        ← 你的代码
└── 期次-Q3/                    ← Spec 文件 + 生成的代码
```

---

## 二、@spec 注释：让 Spec 和代码双向同步

### 原理

```
代码中的 @spec 注释  →  speccore sync --reverse  →  自动更新 Spec 文件
Spec 文件中的定义    →  speccore execute          →  自动生成代码骨架
```

### 后端示例：Java

```java
// src/main/java/com/example/controller/TaskController.java

/**
 * @spec Task-001-任务CRUD / POST /api/v1/tasks
 */
@PostMapping("/tasks")
public Result<Task> createTask(@Valid @RequestBody CreateTaskDTO dto) {
    Task task = taskService.create(dto);
    return Result.success(task);
}

/**
 * @spec Task-001-任务CRUD / GET /api/v1/tasks
 */
@GetMapping("/tasks")
public Result<PageResult<Task>> listTasks(@RequestParam(defaultValue = "1") int page) {
    return Result.success(taskService.list(page));
}
```

运行 `speccore sync --reverse` 后，SpecCore 会：
- 扫描所有 `@spec Task-001-任务CRUD` 注释
- 自动更新 `Task-001-任务CRUD/backend/TASK.md` 标记"已实现"
- 更新 `.speccore/GLOBAL/CODE_INDEX.md` 代码索引

### 前端示例：Vue

```vue
<!-- src/views/tasks/TaskList.vue -->
<!-- @spec Task-001-任务CRUD /web /tasks -->

<template>
  <el-table :data="taskList" v-loading="loading">
    <el-table-column prop="title" label="标题" />
    <el-table-column prop="priority" label="优先级" />
    <el-table-column label="操作">
      <el-button @click="handleEdit(row)">编辑</el-button>
      <el-button @click="handleDelete(row)">删除</el-button>
    </el-table-column>
  </el-table>
</template>
```

### 完整同步流程

```bash
# 1. 写完代码后加 @spec 注释
# 2. 反向同步：代码 → Spec
speccore sync --reverse

# 3. 校验完整性
speccore validate

# 4. 查看 Spec 有哪些还没写的接口
speccore trace --task=Task-001

# 5. 补充缺失的代码...
# 6. 再次反向同步
speccore sync --reverse
```

---

## 三、日常开发工作流

```bash
# 早上一上班
speccore current                    # 看当前关联的任务
speccore progress                   # 看整体进度

# 开始编码
# 在代码中添加 @spec Task-XXX 注释...
git commit -m "feat: 实现任务 CRUD"

# pre-commit hook 自动运行：
# → speccore validate --task=Task-001
# → 不通过则阻止提交

# 提交成功后
speccore sync --reverse             # 反向同步 Spec
speccore update --task=Task-001 --status=completed
speccore progress                   # 确认状态更新
```

---

## 四、常见问题

| 问题 | 解决 |
| :--- | :--- |
| CI 报 `No active iteration` | 确保 `.speccore/` 目录提交了，CI 不需要 `init` |
| sync 找不到代码引用 | 检查 @spec 注释格式：`@spec 任务名 /路径(可选)` |
| hooks 安装失败 | `speccore hooks install` 需要 `.git/` 目录存在 |
| 多人协作 Spec 冲突 | 把 `.speccore/` 加入 `.gitattributes` 用 merge=union |

---

## 五、更多参考

- [25 场景实战](docs/场景实战.md) — 场景十二重点讲 CI/CD
- [命令参考](docs/命令参考.md) — sync/validate/hooks 详细参数
- [examples/task-management](examples/task-management/) — 完整示例项目
