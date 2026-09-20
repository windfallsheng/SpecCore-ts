# SpecCore CI/CD & @spec Annotation Integration Guide

> Applicable: v6.15.x+ | Level: beginner

> 💡 **Command types**: `speccore execute` below is a 🔒 AI command — use `@spec-ask` in an AI IDE.

---

## 1. CI/CD Integration (3 steps)

### 1. Install Git Hooks (local)

```bash
speccore config hooks
```

Generates `.git/hooks/pre-commit` and `.git/hooks/pre-push`, auto-validating before commit.

### 2. GitHub Actions config

Create `.github/workflows/speccore.yml`:

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
          speccore init --force       # init (--force skips confirm)
          speccore validate --strict  # strict validation

      - name: Health Check
        run: speccore doctor

      - name: Progress Report
        run: speccore dashboard --format=json
```

### 3. Per-stage checks

| CI stage | Check command | What it blocks |
| :--- | :--- | :--- |
| Pre-commit | `speccore validate` | REQ.md format errors, missing API tables |
| Pre-push | `speccore sync --all --detect` | Spec/code mismatch |
| PR check | `speccore audit` | Global compliance |
| Post-merge | `speccore sync --global` | Update global index |
| Pre-release | `speccore dashboard` | Progress & health overview |

### 4. Full CI structure

```
project root/
├── .github/
│   └── workflows/speccore.yml   ← CI config
├── .speccore/                   ← SpecCore project config
├── src/                         ← your code
└── Iteration-Q3/                ← Spec files + generated code
```

---

## 2. @spec Annotation: bidirectional sync

### Principle

```
@spec annotations in code  →  speccore sync (auto reverse sync)  →  updates Spec files
Definitions in Spec files  →  speccore execute                  →  generates code skeleton
```

### Backend example: Java

```java
/**
 * @spec Task-001-task-CRUD / POST /api/v1/tasks
 */
@PostMapping("/tasks")
public Result<Task> createTask(@Valid @RequestBody CreateTaskDTO dto) {
    Task task = taskService.create(dto);
    return Result.success(task);
}
```

After `speccore sync`, SpecCore reverse-syncs: scans all `@spec` annotations, marks `TASK.md` as "implemented", updates `CODE_INDEX.md`.

### Frontend example: Vue

```vue
<!-- src/views/tasks/TaskList.vue -->
<!-- @spec Task-001-task-CRUD /web /tasks -->

<template>
  <el-table :data="taskList" v-loading="loading">
    <el-table-column prop="title" label="Title" />
    <el-table-column prop="priority" label="Priority" />
  </el-table>
</template>
```

### Full sync flow

```bash
# 1. Add @spec annotations after coding
# 2. Sync (auto reverse sync: code → Spec)
speccore sync --task=Task-001

# 3. Validate completeness
speccore validate

# 4. Preview sync result (no actual changes)
speccore sync --task=Task-001 --dry-run

# 5. Fill in missing code...
# 6. Sync again
speccore sync --task=Task-001
```

---

## 3. Daily Workflow

```bash
# Start of day
speccore dashboard                   # view overall progress

# Start coding (add @spec Task-XXX annotations)
git commit -m "feat: implement task CRUD"

# pre-commit hook auto-runs:
# → speccore validate --task=Task-001
# → blocks commit if it fails

# After commit
speccore sync --task=Task-001    # sync Spec (auto reverse sync)
speccore done --task=Task-001    # archive
speccore dashboard               # confirm status update
```

---

## 4. FAQ

| Problem | Solution |
| :--- | :--- |
| CI reports `No active iteration` | Ensure `.speccore/` is committed; CI doesn't need `init` |
| sync finds no code references | Check annotation format: `@spec task-name /path(optional)` |
| hooks install fails | `speccore config hooks` requires `.git/` to exist |
| Multi-dev Spec conflicts | Add `.speccore/` to `.gitattributes` with `merge=union` |

---

## 5. More References

- [Scenarios](scenarios.en.md) — CI/CD scenarios
- [Command Reference](commands.en.md) — sync/validate/hooks params
- [examples/task-management](examples/task-management/) — full example project
