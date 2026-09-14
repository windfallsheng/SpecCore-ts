# SpecCore v8.3.160 Release Notes

## Overview

This release introduces the **Subagent Isolation Architecture** — a fundamental redesign of how SpecCore Pipeline manages AI context across sessions. By enforcing step-level isolation, controlled context loading, and per-step token budgets, v8.3.160 solves the three core problems of long-running AI workflows: **context drift**, **attention bias**, and **context exhaustion**.

---

## What's New

### Subagent Isolation Architecture

**Default Step Isolation Mode** (`src/core/pipeline-engine.ts`):
- Each Pipeline step now completes with `[SPECCORE_STEP_DONE]` + `[SPECCORE_NEXT_STEP]` markers
- New sessions resume via `--resume`, restoring context from compact `ContextSnapshot` instead of full conversation history
- Eliminates context drift: core constraints from `CONSTITUTION.md` are re-injected at the top of every prompt

**ContextSnapshot** (`src/core/pipeline-engine.ts`):
```typescript
interface ContextSnapshot {
  keyConstraints: string[];      // Core bans re-injected every round
  completedOutputs: string[];    // Generated file paths
  completedSteps: string[];      // Finished step IDs
  techStackSummary?: string;
  iteration: string;
  nextStep?: string;
}
```

**AgentAdapter Layer** (`src/core/agent-adapter.ts`):
- Unified adapter for subagent context preparation
- `HeadlessAdapter`: File/state-machine based simulation (default, no SDK required)
- `QoderSdkAdapter`: SDK deep integration (reserved interface)
- Per-role context loading strategy: tells AI which files to read fully vs. reference by path

### On-Demand REQ.md Loading

**Before**: `buildPrompt` unconditionally loaded full REQ.md content, even when `contextType: 'incremental'`

**After** (`src/core/prompt-builder.ts`):

| contextType | REQ.md Loading | Typical Step |
|:---|:---|:---|
| `full` | Load full text | analyze/phase1, execute/prompt-analysis |
| `incremental` | **Skip** | execute/code-generation (relies on previous output) |
| `platform-only` | **Skip** | analyze/platform-{x} (AI uses platform parameter) |
| `contract-only` | **Skip** | analyze/contract (only API_CONTRACT.yaml loaded) |

**Impact**: Reduces prompt content by 3K-8K tokens for incremental/platform-only/contract-only steps.

### Step-Level Token Budget Optimization

| Step | Old Budget | New Budget |
|:---|:---:|:---:|
| analyze/phase1-prompt | 12K | **10K** |
| execute/prompt-analysis | 12K | **10K** |
| global-analysis | 12K | **10K** |

Four-tier dynamic downgrade in `formatPrompt()`: TOC → extraSpecs (P1/P2/P3 budgets) → taskContext → minimal mode.

### Quality Gate Role Consolidation

**Before**: 5 separate quality-gate steps = 5 session switches

**After** (`src/core/pipeline-engine.ts`):

| Merged Steps | New Step | Role | Budget |
|:---|:---|:---|:---:|
| compiler (6K) + test-engineer (5K) | **quality-gate-build** | compiler (covers tests too) | 8K |
| security-reviewer (4K) + performance-expert (4K) | **quality-gate-nfr** | security-reviewer (covers performance too) | 6K |
| doc-sync-agent (3K) | doc-sync-agent | unchanged | 3K |

**Impact**: Execute Pipeline reduced from 8 steps to 6 steps (-25% session switches).

### Agent Role System Alignment

Aligned three previously divergent naming systems (`_INDEX.md`, `AGENTS.md`, `pipeline-engine.ts`) under `_INDEX.md` as the single source of truth:

- **clarify** split into 3 single-role sub-steps: `clarify-product` → `clarify-interaction` → `clarify-security`
- Each step configured with dedicated `subagent` + `contextBudget` + `contextType`
- 5 new subagent skill templates in `.speccore/SKILLS/` (clarify, analyze, execute, verify, global-analyze)

### buildPrompt Call Chain Fix

Fixed `contextType`/`contextBudget` not being passed in:
- `execute.ts` `runApplyMode` Pipeline advancement
- `split.ts` response mode Pipeline advancement

Ensures Pipeline-configured budgets and loading strategies take effect on all execution paths.

---

## Fixes

### Legacy Marker Cleanup
Replaced all remaining `[SPECCORE_PIPELINE_NEXT]` references with step-isolation semantics:

| File | Lines | Change |
|:---|:---|:---|
| `src/commands/analyze.ts` | 1040-1043 | "自动继续" → "步骤隔离" |
| `src/commands/execute.ts` | (already updated in prior release) | — |
| `src/commands/iteration/split.ts` | 397-400, 421-424 | "自动继续" → "步骤隔离" |
| `src/core/pipeline-engine.ts` | 14-17 | Header comment updated |
| `src/commands/init.ts` | 1473, 1706 | AGENTS.md generation template updated |

`[SPECCORE_PIPELINE_NEXT]` retained as **deprecated** in marker reference table for backward compatibility.

---

## Migration Guide

No breaking changes. Existing projects benefit automatically:

```bash
# Update CLI to v8.3.160
npm install -g speccore@latest

# Or if using local install
npm update speccore

# Verify version
speccore --version
```

Pipeline behavior changes:
- **Before**: AI stays in same conversation, sees `[SPECCORE_PIPELINE_NEXT]`, automatically continues
- **After**: Each step outputs `[SPECCORE_STEP_DONE]`, AI starts **new conversation** with `--resume` command
- Context is preserved via `ContextSnapshot`, not conversation history

---

## Stats

- **8 files changed** in core logic (pipeline-engine.ts, prompt-builder.ts, agent-adapter.ts, analyze.ts, execute.ts, split.ts, init.ts, cli.ts)
- **1 new file** (agent-adapter.ts, 512 lines)
- **5 new skill templates** (.speccore/SKILLS/)
- **~200 lines added** across documentation (DESIGN.md appendix, CHANGELOG.md, AGENTS.md)
- **3 major architectural changes**: step isolation, on-demand loading, role consolidation
