# Project — Code Knowledge Graph Report

> Generated at: 2026-08-20T07:21:52.860Z
> Scanned: 99 files | 5287 nodes | 9930 edges
> Confidence: 2826 EXTRACTED | 7104 INFERRED

## 🔥 God Nodes (Most Connected)

- **analyze-engine.ts** (module) — degree: 1065, file: `src/core/analyze-engine.ts`
- **prompt-builder.ts** (module) — degree: 559, file: `src/core/prompt-builder.ts`
- **knowledge-graph.ts** (module) — degree: 531, file: `src/core/knowledge-graph.ts`
- **verify-engine.ts** (module) — degree: 349, file: `src/core/verify-engine.ts`
- **ask-engine.ts** (module) — degree: 322, file: `src/core/ask-engine.ts`
- **code-scanner.ts** (module) — degree: 318, file: `src/core/code-scanner.ts`
- **spec-merger.ts** (module) — degree: 263, file: `src/core/spec-merger.ts`
- **requirement-clarifier.ts** (module) — degree: 245, file: `src/core/requirement-clarifier.ts`
- **rag-engine.ts** (module) — degree: 242, file: `src/core/rag-engine.ts`
- **ai-impact-analyzer.ts** (module) — degree: 218, file: `src/core/ai-impact-analyzer.ts`
- **reindex-engine.ts** (module) — degree: 178, file: `src/core/reindex-engine.ts`
- **inbox.ts** (module) — degree: 140, file: `src/core/inbox.ts`
- **global-layer.ts** (module) — degree: 139, file: `src/core/global-layer.ts`
- **incremental-analyzer.ts** (module) — degree: 130, file: `src/core/incremental-analyzer.ts`
- **quality-audit.ts** (module) — degree: 129, file: `src/core/quality-audit.ts`

## 🏘️ Communities (Auto-detected Subsystems)

### Community 0: src/core
- Nodes: 1082 | Density: 0.4%
- Key members: yaml-parser.ts, pathExists, readFile, verify-engine.ts, execSync, join, pathExists, readFile...

### Community 2: src/core
- Nodes: 44 | Density: 0.0%
- Key members: logger, logger, logger, logger, logger, logger, logger, logger...

### Community 11: src/core/code-graph
- Nodes: 27 | Density: 0.0%
- Key members: CodeGraph, CodeGraph, CodeGraph, CodeNode, CodeEdge, GraphQueryResult, CodeNode, CodeEdge...

### Community 5: src/core
- Nodes: 19 | Density: 10.5%
- Key members: PipelineEngine, state, steps, iteration, name, cwd, stateFilePath, defineSteps...

### Community 3: src/core
- Nodes: 9 | Density: 22.2%
- Key members: FileTransaction, operations, committed, write, delete, move, commit, rollback...

### Community 4: src/core
- Nodes: 6 | Density: 33.3%
- Key members: TemplateEngine, templatesDir, render, renderString, renderToFile, listTemplates

### Community 6: src/core
- Nodes: 6 | Density: 0.0%
- Key members: AskResult, COMMAND_KB, WORKFLOWS, classifyMode, AskResult, PipelinePlan

### Community 7: src/core/schemas
- Nodes: 5 | Density: 0.0%
- Key members: z, z, z, z, z

### Community 9: src/core
- Nodes: 4 | Density: 0.0%
- Key members: extractAnnotations, buildModuleGroups, matchModule, discoverProjectRoots

### Community 12: src/core/code-graph
- Nodes: 4 | Density: 50.0%
- Key members: UnionFind, parent, find, union

## 🔗 Cross-Community Bridges

No significant cross-community bridges detected.

## ❓ Suggested Questions

- "How does `src/core` subsystem interact with other modules?"
- "What depends on `analyze-engine.ts` and why is it a god node?"
- "Explain the architecture of `src/core/agents/engine`"
- "Find the shortest path from entry point to database layer"

## 🛠️ Query Examples

```bash
# Explain a concept
speccore knowledge explain "analyze-engine.ts"

# Trace path between two concepts
speccore knowledge path "analyze-engine.ts" "prompt-builder.ts"

# Natural language query
speccore knowledge query "How is authentication handled?"
```
