# Project — Code Knowledge Graph Report

> Generated at: 2026-11-03T07:17:18.869Z
> Scanned: 266 files | 17554 nodes | 4195 edges
> Confidence: 3184 EXTRACTED | 1011 INFERRED

## 🔥 God Nodes (Most Connected)

- **path** (variable) — degree: 290, file: `src/utils/task-utils.ts`
- **execute.ts** (module) — degree: 155, file: `src/commands/execute.ts`
- **taskify.ts** (module) — degree: 138, file: `src/commands/iteration/taskify.ts`
- **analyze.ts** (module) — degree: 122, file: `src/commands/analyze.ts`
- **analyze-engine.ts** (module) — degree: 89, file: `src/core/analyze-engine.ts`
- **verify.ts** (module) — degree: 84, file: `src/commands/verify.ts`
- **doc2spec.ts** (module) — degree: 82, file: `src/commands/doc2spec.ts`
- **prompt-builder.ts** (module) — degree: 81, file: `src/core/prompt-builder.ts`
- **change.ts** (module) — degree: 75, file: `src/commands/change.ts`
- **init.ts** (module) — degree: 68, file: `src/commands/init.ts`
- **plan.ts** (module) — degree: 55, file: `src/commands/plan.ts`
- **knowledge-graph.ts** (module) — degree: 51, file: `src/core/knowledge-graph.ts`
- **code-scanner.ts** (module) — degree: 49, file: `src/core/code-scanner.ts`
- **update.ts** (module) — degree: 46, file: `src/commands/update.ts`
- **verify-engine.ts** (module) — degree: 46, file: `src/core/verify-engine.ts`

## 🏘️ Communities (Auto-detected Subsystems)

### Community 3: src/commands/analyze.ts
- Nodes: 723 | Density: 0.0%
- Key members: analyze.ts, writeFile, pathExists, ensureDir, rename, stat, join, dirname...

### Community 25: src/commands/iteration/taskify.ts
- Nodes: 694 | Density: 0.1%
- Key members: taskify.ts, ensureDir, writeFile, pathExists, readFile, readdir, remove, rename...

### Community 18: src/commands/execute.ts
- Nodes: 558 | Density: 0.1%
- Key members: execute.ts, pathExists, readFile, writeFile, ensureDir, readdir, remove, join...

### Community 61: src/core/analyze-engine.ts
- Nodes: 457 | Density: 0.1%
- Key members: analyze-engine.ts, readFile, writeFile, pathExists, readdir, ensureDir, join, relative...

### Community 77: src/core/code-graph
- Nodes: 456 | Density: 0.1%
- Key members: visualizer.ts, readFile, pathExists, writeFile, join, CodeGraph, CodeNode, ReqCodeLink...

### Community 146: src/core/prompt-builder.ts
- Nodes: 453 | Density: 0.1%
- Key members: prompt-builder.ts, readFile, pathExists, readdir, stat, join, dirname, relative...

### Community 182: src/core/ui-verify
- Nodes: 423 | Density: 0.1%
- Key members: visual-model-client.ts, logger, VisualModelConfig, VisualModelResult, callVisualModel, provider, callQwenVL, apiKey...

### Community 15: src/commands/doc2spec.ts
- Nodes: 392 | Density: 0.1%
- Key members: doc2spec.ts, logger, Spinner, pinyin, execSync, createHash, pathExists, ensureDir...

### Community 2: src/commands/analyze
- Nodes: 357 | Density: 0.1%
- Key members: units.ts, join, dirname, basename, relative, writeFile, pathExists, ensureDir...

### Community 124: src/core/knowledge-graph.ts
- Nodes: 339 | Density: 0.1%
- Key members: knowledge-graph.ts, readFile, writeFile, pathExists, readdir, ensureDir, stat, join...

## 🔗 Cross-Community Bridges

- `readFileSync` [imports] → `fs` (EXTRACTED)
- `existsSync` [imports] → `fs` (EXTRACTED)
- `join` [imports] → `path` (EXTRACTED)
- `resolve` [imports] → `path` (EXTRACTED)
- `cli.ts` [calls] → `verifyCommand` (INFERRED)
- `cli.ts` [calls] → `readdirSync` (INFERRED)
- `cli.ts` [calls] → `statSync` (INFERRED)
- `cli.ts` [calls] → `isTaskModuleDirName` (INFERRED)
- `task-utils.ts` [calls] → `isTaskModuleDirName` (INFERRED)
- `task-utils.ts` [calls] → `createInterface` (INFERRED)
- `logger.ts` [calls] → `dirname` (INFERRED)
- `logger.ts` [calls] → `writeFile` (INFERRED)
- `existsSync` [imports] → `fs` (EXTRACTED)
- `readFileSync` [imports] → `fs` (EXTRACTED)
- `join` [imports] → `path` (EXTRACTED)

## ❓ Suggested Questions

- "How does `src/commands/analyze.ts` subsystem interact with other modules?"
- "What depends on `path` and why is it a god node?"
- "Explain the architecture of `src/core/agents/engine`"
- "Find the shortest path from entry point to database layer"

## 索引维护

图谱索引由 `speccore reindex` 全量重建（analyze 阶段自动增量维护）。
