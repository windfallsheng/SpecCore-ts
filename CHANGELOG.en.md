# SpecCore Changelog

---

## v8.3.182 (2026-09-18) — Explicit Document Routing & Refined Whitelist

### Document Routing Table (r4)

- **`analyze.ts` `DOC_ROUTING` constant**: Explicitly defines document destination paths in code
  - Index class → `overview/` (FUNCTION_MAP.md / INTERACTION_MAP.md / PLATFORMS.md / CLARIFY.md / API_CONTRACT.yaml)
  - Content class → `{feature}/overview/` (REQUIREMENT.md / ANALYSIS.md / TECH.md / RISK.md / DEPS.md / REVIEW.md / MONITOR.md / DEV_GUIDE.md)
- **Iteration-level prompt adds "Document Routing Table" section**: Markdown table explicitly showing routing target, document type, and description for each document
- **Explicit ANALYSIS.md classification**: Belongs to content class, strictly prohibited from being placed under `020-specs/overview/`

### Two-Tier Whitelist (r3)

- **`prompt-builder.ts` whitelist refactor**: Changed from single whitelist to "core whitelist + conditional whitelist" two-tier structure
  - Core whitelist (CORE_EXTRA_FILES): CONTEXT.md, ERROR_CODES.md (loaded for all tasks)
  - Conditional whitelist (getPlatformExtraFiles): Dynamically loaded by platform type (backend → SCHEMA.md; frontend → COMPONENT_TREE.md / ROUTES.md / STATE.md)
- Files outside whitelist are collected and output via `console.warn`

### Budget Adjustment & Error Message Improvement (r5)

- **`CONSTITUTION.md` budget relaxed from 4000 to 6000 characters**
- **Improved error messages**: When budget exceeded, provides concrete suggestions for trimming (remove outdated comments, link to external docs, use tables, etc.)

### Module Clarification Auto-Imports Global Clarification (r1)

- **`analyze.ts` context loading logic**: When loading module clarifications, automatically detects and ensures global clarification `020-specs/overview/CLARIFY.md` is placed first

---

## v8.3.181 (2026-09-18) — Architecture Refinement & Context Control Hardening

### Clarification Output: Two-Level Clarification Structure (f1)

- **`hasValidClarifiedDocs` critical bug fix**: Removed erroneous `return false;`, restored source update detection logic
- **`analyze.ts` clarify marker write logic**: Supports new path formats `[CLARIFY:overview/CLARIFY.md]` and `[CLARIFY:{feature}/overview/CLARIFY.md]`, backward compatible with `[CLARIFY:requirements/xxx.md]`
- **`analyze.ts` requirement clarification validation**: Now uses `hasValidClarifiedDocs()` for unified detection (supports two-level paths + backward compatibility)
- **`analyze.ts` context loading**: Prioritizes `020-specs/overview/CLARIFY.md` (global) and `020-specs/{feature}/overview/CLARIFY.md` (module), falls back to legacy paths
- **`analyze.ts` prompt updates**: Phase 0 clarify prompt and confirm prompt path instructions updated to new format
- **`AGENTS.md` project structure**: Clarified functional boundaries between `020-specs/overview/` (index/relationship) and `020-specs/{feature}/overview/` (content/detail)

### Subtask File Whitelist (f2)

- **`prompt-builder.ts` `scanUserCustomFiles`**: Changed from "scan all" to "whitelist mode"
- Only loads files within `ALLOWED_EXTRA_FILES` whitelist (SCHEMA.md, TEST.md, REVIEW.md, etc.)
- Files outside whitelist are ignored with console warnings

### Per-File-Type Budget Segmentation (f4)

- **`prompt-builder.ts` `FILE_BUDGETS`**: Different budget limits per file type
  - Must be complete (error, no truncation): CONSTITUTION.md(4000), REQ.md(2000), API_CONTRACT.yaml(2000)
  - Can be truncated (truncate + warning): TASK.md(1500), TECH.md(3000), DEV_GUIDE.md(2000), others(1000)
- Applied in both **`loadExtraSpecs`** and **`loadAllTaskContext`**
- Fallback mode budgets relaxed to 2x

---

## v8.3.180 (2026-09-17) — Documentation Sync Update

### Comprehensive Design Document Sync for v8.3.177-179 Architecture Changes

- **`docs/DESIGN.md` New §1.5.18 Context Control Architecture**:
  - Metadata infrastructure (`_matrix.md` + `feature-metadata.ts`)
  - Overview two-phase generation (skeleton → full)
  - Plan phase CLI graph computation (`plan-graph.ts`)
  - Execute phase contract-only rules + reading list mode
  - Cross-phase context handoff + session boundaries

- **`docs/DESIGN.md` Agent Phase Table**: Added `overview-skeleton` (6K) and `overview-full` (8K)

- **`docs/overview.md` Core Flow Diagram**: `analyze → split` changed to `analyze(overview) → analyze(feature-unit) → split`

- **`docs/command-reference.md`**: Added `analyze --scope=overview --phase=skeleton|full` and `plan --prompt` CLI graph descriptions

- **`docs/task-directory-design.md`**: Added `_matrix.md` description to feature unit section

- **`AGENTS.md` Project Structure**: Added `_matrix.md` under `features/{feature}/`

- **`README.md`**: Synced core flow diagram and directory structure

---

## v8.3.179 (2026-09-17) — Fallback Mode Context Control Fix

### Fix `loadAllTaskContext` Overloading Related Task Documents

- **Related tasks contract-only** (`src/core/prompt-builder.ts`):
  - Before: After getting dependent tasks from knowledge graph, read **all .md files** under related task `00-specs/` (REQ.md/TECH.md/DEV_GUIDE.md etc.)
  - After: Only read related task's `API_CONTRACT.yaml` (prefer `_shared/`, fallback to `00-specs/`)
  - Context reduction: Related tasks from potentially thousands of lines → max 400 lines of contract

- **020-specs platform specs changed to reading list** (`src/core/prompt-builder.ts`):
  - Before: In fallback mode, directly loaded full content of all .md files under `020-specs/{feature}/{platform}/`
  - After: Changed to reading list mode, only listing file paths and feature names, not loading full text
  - Prevents loading too many other feature's platform specs in fallback mode causing context explosion

---

## v8.3.178 (2026-09-17) — Plan Phase CLI Graph + Execute Phase Contract-Only

### Plan Phase Enhancement (Context Control)

- **New `src/core/plan-graph.ts`**: CLI graph computation module
  - `buildPlanGraph()`: Scans tasks → builds dependency graph → topological sort → critical path
  - `computeBatches()`: Groups tasks into execution batches by dependency level
  - `findCriticalPath()`: Computes longest dependency chain (duration)
  - `detectResourceConflicts()`: Detects when same assignee has multiple tasks in one batch
  - `generatePlanJson()`: Generates 100-200 line structured JSON

- **Enhanced `speccore plan --prompt`**:
  - Auto-enables CLI graph mode when task count >= 5
  - CLI computes graph first (dependencies, batches, critical path, conflicts)
  - Outputs structured JSON to AI, AI only makes judgments (priority/resource conflicts, risks)
  - Context reduced from 3000+ lines (task docs) → 100-200 lines (JSON metadata)

### Execute Phase Enhancement (Contract-Only, No Implementation)

- **Modified `speccore execute --prompt` context loading**:
  - Other platforms in same Task: only loads `API_CONTRACT.yaml`, no longer loads `REQ.md`/`TECH.md`
  - Upstream dependency tasks: only loads `_shared/API_CONTRACT.yaml` (contract), not requirement docs
  - Shared task contract: continues loading `_shared/API_CONTRACT.yaml`
  - Each subtask context controlled to 500-600 lines, no accumulation

### Core Design Principles

- **Plan phase**: CLI does deterministic computation (graph algorithms), AI does judgment (conflicts, risks)
- **Execute phase**: Only pass interface contracts, never pass code implementation
- **Cross-task communication**: `API_CONTRACT.yaml` is the only information carrier between tasks

## v8.3.177 (2026-09-17) — Metadata Scanner + Overview Generation (Context Control Core)

### Feature Unit Metadata Infrastructure

- **New `_matrix.md`**: Auto-generated platform coverage matrix for each feature unit
  - Records `platforms` (involved ends), `dependencies`, `apis`
  - Created by `doc2spec --split`, supports manual adjustment
  - Serves as the sole metadata source for overview generation

- **New `src/core/feature-metadata.ts`**: Metadata scanner
  - `scanFeatureMetadata()`: Scans `features/` directory, reads each unit's `_matrix.md`
  - `extractSummary()`: Reads only first 2 sentences of `README.md`, never full content
  - `calculatePlatformCoverage()`: Computes platform coverage statistics
  - `findCrossFeatureApis()`: Identifies APIs referenced by multiple features

### Overview Generation (Two-Phase)

- **New `speccore analyze --scope=overview`**:
  - `--phase=skeleton` (default): Generates skeleton overview
    - Feature map (Mermaid dependency graph)
    - Platform coverage summary table
    - Feature unit inventory confirmation
    - Output controlled to 40-60 lines
  - `--phase=full`: Generates complete overview
    - System architecture diagram (service topology + data flow)
    - Cross-feature API inventory
    - Actual dependency relationship table
    - Output controlled to 60-80 lines

- **Supports `--apply` receiving AI results**: Auto-parses `[DOC:OVERVIEW]` / `[DOC:ARCHITECTURE]` markers, writes to `020-specs/overview/`

### Core Design Principles

- Overview only processes **50-80 lines of JSON metadata**, never touches full feature unit content
- CLI handles deterministic extraction (scanning `_matrix.md`), AI handles generative work (descriptions + diagrams)
- Overview is a **relationship map + index**, not a content summary

## v8.3.176 (2026-09-17) — Feature Unit Split + Change Tracking + Handoff Summary

### Feature Unit Split (P2-11 Context Control Foundation)

- **New `doc2spec --split`**: Automatically splits converted documents into feature units by `##` heading structure
  - Scans heading structure to identify feature unit boundaries
  - Filters non-feature sections (appendix, glossary, etc.)
  - Writes each unit to `features/{unit}/README.md`
  - Generates `.meta/source` origin marker
  - Generates `features/INDEX.md` unit index

### Feature Unit Management

- **New `speccore units` command**:
  - `units --list`: List all feature units (with status, origin)
  - `units --edit <unit>`: View unit content summary
  - `units --merge "A,B"`: Merge multiple units, mark originals as deprecated
  - `units --delete <unit>`: Delete unit (backup to `.trash/`)

### Change Tracking

- **Each feature unit supports change history**:
  - `CHANGELOG.md`: Records change type, description, time
  - `.meta/versions/`: Auto-backup old version before each change
  - Merge/delete operations automatically record change history

### Handoff Summary Generator

- **New `src/core/handoff-generator.ts`**:
  - `generateHandoff(from, to, iteration)`: Generate handoff summary after each stage
  - Supports analyze→split / split→plan / plan→execute / execute→review / review→done
  - Summaries stored in `.speccore/local/handoffs/` (not committed to Git)
  - Size limits: analyze→split ≤60 lines, plan→execute ≤150 lines

---

## v8.3.175 (2026-09-16) — Comprehensive Cleanup of Legacy Compatibility Code

### Cleanup Goals

- **Remove all version number comments**: No more `vX.Y.Z+:` markers in code
- **Remove backward compatibility descriptions**: All "backward compatible", "legacy", "old format", "old structure", "old path", "old layout" descriptions cleaned to current-state wording
- **Delete backward compatible commands**: `arch-update` (merged into `update --arch`)
- **Delete migration guides**: `docs/migration-guide.md` / `docs/migration-guide.en.md` (no legacy users, no migration needed)
- **Trim CHANGELOG**: Only keep v8.3.169 and later recent versions
- **Delete old RELEASE files**: `RELEASE-v6.89.0.md` / `RELEASE-v8.3.46.md`

### Scope

- `src/cli.ts` — Removed version comments + deleted `arch-update` command + cleaned welcome panel old path fallbacks
- `src/commands/` — Cleaned version comments and backward compatibility logic in analyze.ts / execute.ts / split.ts / change.ts / synthesize.ts / update.ts / init.ts etc.
- `src/core/` — Cleaned spec-paths.ts / prompt-builder.ts / state.ts / knowledge-graph.ts / verify-engine.ts / task-paths.ts / git-integration.ts etc.
- `docs/` — Deleted migration-guide.md / migration-guide.en.md
- `RELEASE-*.md` — Deleted v6.89.0 and v8.3.46 release notes

---

## v8.3.174 (2026-09-16) — P1 Concept Convergence: Quality Gate Layering + Subagent Rename + Mode Parameter Consolidation + Doc Split

### P1-4: Subagent Rename — SessionAgent Marker Unification

- Global replace `[SPECCORE_SUBAGENT]` → `[SPECCORE_SESSION_AGENT]` (Headless marker mode corresponds to SessionAgent concept)
- Updated `agent-adapter.ts` marker output, `AGENTS.md` marker documentation
- Preserved internal code variable names (implementation detail)

### P1-5: Analysis Strategy Unification

- New `ARCHITECTURE.md` retains only the three-layer analysis theoretical model
- Four-layer scanning / streaming analysis merged into Pipeline stage descriptions

### P1-6: Mode Parameter Convergence — Config First

- **`execute.ts`**: `strict` / `pipeline` / `withCode` read from `.speccore.yml` when not passed via CLI
- **`unified-config.ts`**: `settings` adds `pipeline?: boolean` and `with_code?: boolean` options
- CLI `--strict` / `--pipeline` / `--with-code` preserved (backward compatible), config file can set defaults

### P1-7: Quality Gate Layering — Default 4 + Strict Mode 12

- **`verify-engine.ts`**: `runQualityGate()` adds `strict?: boolean` parameter
- Default 4 critical checks: compile (blocking), unit test, API contract compliance, spec doc quality
- `strict=true` adds 12 checks: Lint, dependency integrity, security scan, Spec consistency, DEV_GUIDE compliance, Schema consistency, test coverage, review compliance, deploy checklist, error code consistency, knowledge graph dependency consistency, code file non-empty
- **`execute.ts`**: two `runQualityGate` calls pass `strict: options.strict`
- **`conflict-detector.ts`**: `detectConflicts` signature updated to support `strict` passthrough

### P1-8: Config File Convergence

- `.speccore.yml` `settings` section extended: supports `pipeline` / `with_code` / `validation.strict_mode`
- Mode parameter defaults moved from CLI to config file (CLI can still override)

### P1-9: Documentation Split

- Added `docs/ARCHITECTURE.md` (~205 lines): core architecture current state (global org + spec DB + iteration dirs + naming conventions)
- Added `docs/COMMANDS.md` (~135 lines): command reference (pipeline + quick reference + marker system)
- `DESIGN.md` (6214 lines) preserved as historical complete design document

---

## v8.3.173 (2026-09-16) — P0 Architecture Convergence: Path Fallback Removal + Anti-Mess Mechanism Simplification

### P0-1: Path Convergence — Remove All Fallback Branches

- **`spec-paths.ts`**: `resolveGlobalSpecPath()` removed `global/` and root directory fallbacks, only `overview/` remains
- **`knowledge-graph.ts`**: removed `020-specs/platforms/{platform}/` legacy path compatibility scanning
- **`analyze.ts`**: removed `docs['FUNCTION_MAP.md'] || docs['overview/'] || docs['global/']` triple fallback
- **`analyze.ts`**: removed `sanitizeSpecDirectories` auto-calls (function preserved for future `speccore migrate` tool)
- **`split.ts`**: removed `specContents['DEV_GUIDE.md'] || specContents['overview/DEV_GUIDE.md']` fallback
- **`audit.ts`**: removed `apiMap['overview/'] || apiMap['global/'] || apiMap['REQUIREMENT.md']` triple fallback
- **`spec-skeleton.ts`**: removed legacy structure compatibility (platform docs without feature module prefix)
- **`prompt-builder.ts`**: removed root `.md` file reading fallback, only reads `overview/`
- **`state.ts`**: removed iteration root directory old layout compatibility

### P0-2: Anti-Mess Mechanism Convergence — Simplify Prompt Path Constraints

- **`analyze.ts`**: simplified path hints from "don't create dirs + write correct path + don't bypass --apply" to "files pre-created, only overwrite existing files"
- **`split.ts`**: simplified "⚠️ Absolute Prohibition" section to "⚠️ Constraints", merged path constraints into single instruction

---

## v8.3.171 (2026-09-16) — Missing Items Fix + SDK Optimization

### Fixed: change Command SDK Dispatch Integration

- **change.ts `--prompt` mode**: added `[SPECCORE_SUBAGENT: impact-analyst]` marker + `dispatchSubagent` SDK dispatch attempt
- Unified trigger condition: non-TTY + Qoder environment
- Unified failure fallback: automatic fallback to Prompt mode

### Optimized: Qoder SDK Adapter Layer

- **`buildQoderAgentDefinition` tools field**: added `'Agent'` tool to support subagent recursive dispatch
- **`mapToQoderAgentName` mapping table expansion**: covers SpecCore core subagents (spec-analyzer, spec-executor, task-decomposer, schedule-planner, impact-analyst, code-reviewer, security-reviewer) → Qoder built-in agents
- **`dispatchSubagent` singleton optimization**: QoderSdkAdapter instance reuse, avoids repeated dynamic SDK imports on each call

---

## v8.3.170 (2026-09-16) — SDK Dispatch Coverage for All Prompt Mode Commands

### Extended: SDK Dispatch in All Prompt Mode Commands

- **`execute`**: `runPromptMode` integrates `dispatchSubagent`, supports `spec-executor` / `spec-executor-{platform}` subagent SDK dispatch
- **`split`**: `--prompt` mode integrates `dispatchSubagent`, supports `task-decomposer` subagent SDK dispatch
- **`plan`**: `--prompt` mode integrates `dispatchSubagent`, supports `schedule-planner` subagent SDK dispatch
- **Unified pattern**: triggers in non-TTY + Qoder environment, seamless fallback to Prompt mode on failure
- **Unified output**: on SDK success, outputs `[SPECCORE_RESULT]` + file change list + execution result summary

### Notes

- `ask` command not directly integrated: ask outputs `[SPECCORE_EXEC: speccore xxx]` command routing, target commands (analyze/split/plan/execute) trigger SDK dispatch themselves when executed
- Pipeline advancement points (`[SPECCORE_STEP_DONE]` + `[SPECCORE_NEXT_STEP]`) keep existing marker mode to avoid conflicts between CLI internal state machine and SDK async execution

---

## v8.3.169 (2026-09-16) — Qoder Agent SDK Integration: Real Multi-Agent Dispatch

### Qoder Agent SDK Integration (`src/core/agent-adapter.ts`)

- **Package**: `@qoder-ai/qoder-agent-sdk` as `optionalDependencies`
- **Real `QoderSdkAdapter` implementation** (replaces previous stub):
  - Dynamic `import()` loading with automatic Headless fallback
  - `dispatchSubagent()` calls `query({ prompt, options })` to invoke Qoder Agent directly
  - Builds `AgentDefinition` for custom subagents (`spec-analyzer`, `spec-executor`, etc.)
  - Consumes SDK message stream, collects text responses and file changes
  - Built-in agent name mapping (`general-purpose` / `Explore` / `Plan`)
- **New `dispatchSubagent` unified dispatch entry**:
  - Qoder environment → `QoderSdkAdapter.dispatchSubagent()`
  - Other environments → `null` (outer AI takes over via `[SPECCORE_SUBAGENT]` marker)
- **Headless always as fallback**: any SDK failure auto-falls back to text marker mode

### Multi-Tool Adapter Support (`src/core/ask-host-ai.ts`)

- **Extended `HostAiTool`**: added `cursor` / `windsurf` / `claude` / `codebuddy`
- **Fixed `detectHostAi`**: `.qoder` directory now correctly returns `'qoder'` (was incorrectly `'trae'`)
- **Precise directory mapping**: `DIR_TO_TOOL` maps each directory to its exact tool
- **Added `QODER_SESSION` env detection**

### Analyze Command Integration (`src/commands/analyze.ts`)

- **Pipeline mode SDK dispatch**: before outputting Prompt, attempts `dispatchSubagent` direct dispatch
- **Only triggers in non-TTY + Qoder environment**, seamless fallback to Prompt mode on failure
- **Result summary**: outputs `[SPECCORE_STEP_DONE]` + `[SPECCORE_RESULT]` + file change list on SDK success

### Architecture

- **Extended `AgentAdapterMode`**: `'headless' | 'qoder-sdk' | 'cursor-sdk' | 'windsurf-sdk' | 'claude-sdk' | 'codebuddy-sdk'`
- **Extended `AgentAdapter` interface**: added optional `dispatchSubagent()` method
- **`createAgentAdapter()` auto-detection**: selects adapter based on `detectHostAi()` (Qoder → QoderSdkAdapter, others → HeadlessAdapter)

---

