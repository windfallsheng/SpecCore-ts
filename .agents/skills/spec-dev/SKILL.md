# SpecCore Pipeline — 智能级联推进

> **定位**：自动检测当前迭代所处阶段，展示完成状态，推荐并执行下一步命令。
> **核心原则**：一次只推进一步，不自动连续执行多个命令。

---

## 工作流程

```
加载上下文 → 阶段检测 → 状态展示 → 推荐下一步
```

---

## 详细步骤

### Step 1: 加载上下文
```
1. 读取 .speccore/local/context.json
   - currentIteration（当前迭代）
   - currentTask（当前任务）
   - lastAction（上次操作）
   - iterationStatus（迭代状态）

2. 读取 PROJECT_GRAPH.md
   - 所有 Task 的状态（completed/in_progress/pending/blocked）
   - 完成进度百分比

3. 检测各阶段文件
   - 010-requirements/ 是否存在需求文档
   - 020-specs/ 是否存在分析文档
   - 030-tasks/ 是否存在 Task 目录
   - PROJECT_GRAPH.md 中 Task 的完成状态
```

### Step 2: 阶段检测与状态展示
```
根据文件存在状态判断当前阶段：

┌──────────────────────────────────────────────────────┐
│  📊 SpecCore 迭代状态 — {迭代名}                      │
├──────────────────────────────────────────────────────┤
│                                                       │
│  Init ──→ Import ──→ Analyze ──→ Split ──→ Execute   │
│    ✅        ⬜         ▶           ⬜         ⬜       │
│                                                       │
│  状态: 需求已导入，等待分析                            │
│  进度: 2/7 阶段完成 (29%)                             │
│                                                       │
│  📋 Task 进度:                                        │
│  ████████░░░░░░░░░░░░░░  2/6 完成                    │
│                                                       │
│  ✅ 已完成: init, doc2spec                            │
│  ▶ 下一步: speccore analyze -I {iter}                │
│  ⬜ 待执行: split → plan → execute → done             │
│                                                       │
└──────────────────────────────────────────────────────┘
```

### Step 3: 推荐下一步
```
根据当前阶段推荐命令：

| 当前阶段 | 下一步命令 | 说明 |
| :--- | :--- | :--- |
| 未初始化 | speccore init | 项目初始化 |
| 已初始化 | speccore doc2spec -f {file} | 导入需求 |
| 需求就绪 | speccore analyze -I {iter} | 需求分析 |
| 分析完成 | speccore iteration split -I {iter} | 拆分任务 |
| 任务就绪 | speccore plan -I {iter} | 生成计划 |
| 计划就绪 | speccore execute -t {task} --force | 执行开发 |
| 开发完成 | speccore pr --task {task} | 创建 PR |
| PR 合并 | speccore done --task {task} | 归档 |

特殊状态：
| 状态 | 处理方式 |
| :--- | :--- |
| 有失败任务 | 展示 .issues.md，建议 speccore execute --resume |
| 有阻塞任务 | 展示阻塞原因，建议先解除阻塞 |
| 全部完成 | 展示完成摘要，建议 speccore spec2doc 导出文档 |
```

---

## 安全规则

1. **一次只输出一个命令** — 不要自动级联多个命令
2. **用户确认后再执行** — 每次暂停，等待用户说"继续"
3. **处理错误不跳过** — 遇到失败不要直接跳下一步
4. **展示完整状态** — 让用户看到全景再决策

---

## 输出 CLI 命令

```bash
speccore dev [-i {迭代名}] [--auto]
```

`--auto` 模式下，会自动执行当前阶段的命令（不等待确认）。
