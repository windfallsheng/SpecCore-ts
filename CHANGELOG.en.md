# SpecCore Changelog

---

## v6.49.10 (2026-08-16) — Knowledge Graph Auto-Refresh Completion

### Fixes

- **analyze.ts**: Main analysis flow (`--apply` mode) now auto-refreshes knowledge graph after completion
- **split.ts**: All split modes (`--response`/`--strict`/`--interactive`/default) now auto-refresh knowledge graph after completion

### Notes

Previously only `--feature` and `--doc` local modes refreshed the knowledge graph; main flows were missing this. Now the full analyze → split pipeline automatically updates the knowledge graph.

## v6.49.9 (2026-08-16) — Full Migration to Flat Platform Architecture: Clean Up 10-backend/20-frontend References

### Core Changes

- **execute.ts**: scaffold mode, filterByPlatform, readiness checks, self-repair loop all use flat platform dir scanning; added `getPlatformSubtaskDirs()` helper
- **analyze.ts**: TEST.md/REVIEW.md completion and missing file creation use flat platform dir scanning; added `getSubtaskDirs()` helper
- **prompt-builder.ts**: platform file loading uses flat structure; CODEGEN_EXCLUDE_DIRS adds `00-specs`/`_shared`
- **status-panel.ts**: person-platform mapping and health checks use flat platform dir scanning; added `taskHasFile()` helper
- **split.ts**: comment path references updated
- **init.ts**: directory structure templates updated to flat platform architecture
- **analyze.ts**: file header comment updated

### Documentation Updates

- **docs/task-directory-design.md**: Fully rewritten to reflect v6.49.x flat platform + feature unit + project path awareness architecture
- **docs/DESIGN.md**: Updated task directory architecture evolution section, reflecting v6.40.0 → v6.49.1 changes

### Design Principles

- All old structure references preserved as fallback compatibility code for seamless transition
- New structure: `{platform}/{taskId}-{subtaskSlug}/` unifies subtask directory format across all platforms

---

## v6.49.8 (2026-08-16) — Project Info Table Parsing: Support Project Type Column

### Fixes

- **`parseProjectInfo()` supports "Project Type" column**: `ProjectInfo` interface adds `projectType` field
- **Prompt project paths table includes project type**: execute command's Prompt displays project type to help AI understand platform characteristics
- **Dynamic column index matching**: supports multiple header variations like "工程类型", "类型"

---

## v6.49.7 (2026-08-16) — Subtask Directory Cleanup: Remove Unused src/ and tests/

### Fixes

- **Remove `src/` and `tests/` directory creation**: Code now writes to actual project paths specified in CONSTITUTION.md, so `src/` and `tests/` in subtask directories are no longer used
- **TASK.md deliverables table updated**: Removed `src/` and `tests/` entries, added "Code" entry pointing to project paths defined in CONSTITUTION.md
- **split.ts and task/new.ts synced**: Both files no longer create empty `src/` and `tests/` directories

---

## v6.49.6 (2026-08-16) — Project Path Awareness: Code Writes to CONSTITUTION-Specified Locations

### Core Fixes

- **`parseProjectInfo()` function**: Parses project info table from CONSTITUTION.md, returns Map<project identifier, { projectName, srcPath, gitRepo, branch, platform }>
- **`getProjectPathForPlatform()` function**: Gets actual project path by platform name, supports exact match and "corresponding platform" column matching
- **execute command project path awareness**: `--response` mode now checks if file path starts with platform name, if so writes to actual project path defined in CONSTITUTION.md
- **prompt builder injects project paths**: execute command's Prompt includes project path table, telling AI where to write code

### Issues Fixed

- Previously code was written to iteration directory (e.g., `Iteration-011/10-backend/`), not actual project paths defined in CONSTITUTION.md (e.g., `../outputs-project/backend/booking-service`)
- Git branch logic failed because code wasn't in actual repositories

---

## v6.49.5 (2026-08-16) — Deterministic Subtask ID Format

### Fixes

- **Subtask ID format simplified**: Changed from `{taskId}-{platform}-{hash}` to `{taskId}-{platform}`, ensuring global uniqueness and determinism
- **Random hash removed**: No longer uses `Date.now()` and `Math.random()`, subtask IDs are now predictable
- **Uniqueness guaranteed**: Each task has only one subtask per platform, so `{taskId}-{platform}` is already unique

---

## v6.49.4 (2026-08-16) — Task-Level Feature Unit Identification

### New Features

- **Task-level `.meta/feature`**: Task directory itself now has feature unit identification (e.g., `Task-001/.meta/feature`), defaulting to `functionalUnit` or task name
- **Task-level `.meta/` complete attributes**: `feature`/`type`/`status`/`owner`/`created-at`, consistent with subtask level
- **README.md updated**: Directory structure documentation now includes `.meta/` directory
- **task/new sync**: `task new` command also writes task-level `.meta/feature`

---

## v6.49.3 (2026-08-16) — Subtask Directory Naming + task/new Sync

### Fixes

- **Subtask directory naming rule**: `{taskId}-{subtaskSlug}` (e.g., `Task-001-booking-order-mgmt/`), ensuring no conflicts when multiple tasks share the same platform
- **task/new sync**: `task new` command now uses the new flat structure (`{platform}/{taskId}-impl/`), no longer uses `10-backend/` or `20-frontend/` prefixes
- **fallback sync**: Auto-supplemented backend subtasks also use `{taskId}-impl` naming

---

## v6.49.2 (2026-08-16) — Subtask Feature Unit Identification

### New Features

- **`.meta/feature` file**: Each subtask directory now includes a feature unit identification file, defaulting to AI-generated `functionalUnit` or `section.name`
- **TASK.md enhanced**: Subtask info now includes "Feature Unit" field for easier tracking and statistics
- **Fallback compatible**: Auto-supplemented backend subtasks also include feature unit identification

---

## v6.49.1 (2026-08-16) — Task Directory Structure Simplification: Flat Platforms

### Fixes

- **Task directory structure simplified**: No longer distinguishes backend/frontend categories; all platforms are flat under task directory (e.g., `Task-001/booking-service/impl/`, `Task-001/h5-mobile/impl/`)
- **Redundant variables removed**: Removed `backendPlatforms`, `frontendPlatforms`, `getServiceName()` and other backend/frontend classification logic
- **Unified loop**: All platforms use a single loop to create subtasks, using `isBk` to determine if backend for generating different document content

---

## v6.49.0 (2026-08-16) — Platform Type Recognition + AI Smart Analysis

### New Features

- **Platform Type column**: CONSTITUTION.md platform list now includes "工程类型" column (e.g., Java服务, H5微信公众号, Android移动端)
- **AI Smart Analysis**: analyze command reads platform types and automatically applies corresponding professional dimensions for targeted content generation
- **Platform Type Enum**: Java服务/Node服务/Go服务/Python服务, H5微信公众号/H5移动端, Android/iOS移动端, 微信/支付宝小程序, Web管理后台, 桌面应用
- **`parsePlatformTypes()` function**: Dynamically parses platform type column from platform list, returns Map<platform, type>

---

## v6.48.1 (2026-08-16) — Platform List Parsing Enhancement + Column Name Optimization

### Improvements

- **`parsePlatformList()` dynamic column lookup**: no longer hardcodes column 1; parses header first to find "工程标识/端名/平台名" column index, works regardless of column position
- **Column name optimized**: `端名` → `工程标识`, clearer semantics (both platform identifier and project/directory name)
- **init template synced**: CONSTITUTION.md template and project config both updated to "工程标识"

---

## v6.48.0 (2026-08-16) — Backend Platform Detection + Dual-Layer Directories + Name Consistency

### Core Fixes

- **`isBackendPlatform()` enhanced**: supports `-service`/`-api`/`-server`/`-backend` suffixes, fixing `booking-service` being misclassified as frontend
- **split fallback platform consistency**: auto-supplemented backend subtasks now use actual backend platform names from CONSTITUTION.md, no longer hardcoded `api/impl`
- **`GLOBAL_SPEC_FILES`精简**: TECH/RISK/REVIEW/MONITOR no longer forced into `global/`, now support per-platform directories (e.g. `020-specs/booking-service/TECH.md`)
- **analyze prompt enforces dual-layer**: explicitly instructs AI to create `020-specs/{platform}/` subdirectories, each platform calls `--apply --platform` separately
- **code-scanner platform consistency**: `detectEndpoint()` now prioritizes CONSTITUTION.md platform list, falls back to generic patterns (frontend/backend/mobile)

---

## v6.47.0 (2026-08-16) — Verification Fixes + Documentation

### Bug Fixes

- **loadUserTemplates priority fix**: high-priority directory writes first, low-priority does not overwrite (first-write-wins)
- **Redundant require removed**: loadUserTemplates no longer re-requires 'fs' internally
- **JSON template format fix**: chain generation apply command JSON keys now properly quoted

### Documentation

- **DESIGN.md**: New chapter 8 "Task-level Deep Analysis + User Templates + Chain Generation" (v6.44-6.46 architecture changes)
- **DESIGN.md 2.1**: Rewritten as "Platform List (Global Authority)" with 1:1 mapping principle + discovery priority
- **command-reference.md**: analyze command updated with --task usage + deep analysis docs + platform discovery

---

## v6.46.1 (2026-08-16) — Platform List Consistency Fix

- Column name unified: "对应需求端" → "对应端" (template + migration + output text)
- Parsing compatibility: all parsing functions recognize both "对应端" and "对应需求端"
- Template fix: default "对应端" column shows "待填写" (no longer pre-filled with multiple platform names)
- Example fix: multi-project example updated to 1:1 mapping (admin-web→admin, h5-app→h5 ...)

---

## v6.46.0 (2026-08-16) — Explicit Platform List (Plan A)

### Key Changes

- **CONSTITUTION.md adds "Platform List" section**: platform = project name, 1:1 mapping, project-wide unique identifier
- **`parsePlatformList()` shared function**: reads "Platform List" section first, falls back to "Corresponding Platform" column
- **Unified platform discovery**: split/analyze/analyze-engine all prioritize "Platform List" section
- **init template updated**: new projects automatically include "Platform List" section

---

## v6.45.0 (2026-08-16) — User Custom Templates + Chain Generation

### Key Changes

- **User custom templates**: `.speccore/templates/{global|iteration|task}/` — same-name files override built-in templates, new files add custom documents
- **Template lookup priority**: type/platform/ > type/ > _shared/ > root custom > built-in
- **Chain generation**: documents generated sequentially, each reads previous outputs for consistency
- **Hybrid mode**: user templates used as reference when present, AI decides structure when absent

---

## v6.44.0 (2026-08-16) — Analyze --task Task-Level Deep Analysis

### Key Changes

- **Apply write path fix**: Task-level spec files now write to `Task/00-specs/` instead of `Task/_shared/`
- **Task-level document set override**: 00-specs/ uses task-specific document set (REQ.md/TECH.md/TASK.md/SCHEMA.md) per task type
- **Task-level deep analysis prompt**: AI Reads existing 00-specs + global/ context + platform-specific context to regenerate deep analysis
- **Task-level templates**: Each document has targeted writing requirements (function/interface/component level)

---

## v6.43.0 (2026-08-16) — Split Aggregation Analysis + Task-Level Spec Analysis Guidance

### Key Changes

- **Split prompt enhancement: feature aggregation analysis** — AI analyzes whether features are aggregated (cross-platform) or single-platform before splitting
- **Post-split `[SPECCORE_NEXT_STEPS]` marker** — lists `analyze --task` commands for each created task
- **next-steps.ts updated**: `analyze --task` is now the first step after split

---

## v6.42.0 (2026-08-16) — Analyze Two-Phase Analysis Architecture

### Key Changes

- **`--phase` option for analyze command**: Supports two-phase analysis workflow
  - `--phase 1`: Global docs — REQUIREMENT.md, ANALYSIS.md, TECH.md (overall architecture), RISK.md, DEPS.md, REVIEW.md, MONITOR.md + PLATFORMS.md discovery
  - `--phase 2`: Per-platform docs — Reads Phase 1 global outputs as context, generates TECH.md, TEST.md, UI_SPEC.md for each platform
  - Default mode (no --phase): Full mode with two-phase recommendation in prompt
- **TECH.md dual-layer design**: `global/TECH.md` (cross-platform architecture) + `{platform}/TECH.md` (platform-specific)
- **Prompt architecture upgrade**: Phase 1 prompt (platform discovery + global docs) → Phase 2 prompt (read global context → per-platform docs → consistency check)

---

## v6.41.0 (2026-08-17) — 020-specs/ Global Document Directory Refactoring

### Core Changes

- **New `src/core/spec-paths.ts`**: Centralized path helper module
  - `resolveGlobalSpecPath()`: Read-side fallback (global/ → root → null)
  - `globalSpecWritePath()`: Write-side always uses global/ with auto ensureDir
  - `GLOBAL_SPEC_FILES`: Global document file list
- **020-specs/ directory structure evolution**:
  - Global docs (REQUIREMENT.md, ANALYSIS.md, RISK.md, DEPS.md, REVIEW.md, MONITOR.md) moved to `global/` subdirectory
  - Platform-specific docs (TECH.md, TEST.md, UI_SPEC.md) remain in platform directories
  - PLATFORMS.md stays at root (metadata)
- **Write-side refactoring**: analyze-engine.ts, analyze.ts, create.ts
- **Read-side refactoring** (all with backward-compatible fallback): split.ts, prompt-builder.ts, dev.ts, status-panel.ts, cli.ts, iteration-from-global.ts, ai-context-generator.ts, next-steps.ts
- **AI Prompt update**: `buildMultiDocPrompt()` directory structure instructions updated

---

## v6.40.2 (2026-08-16) — Platform Discovery Refactoring + --auto Mode AI-ification

### Core Changes

- **analyze-engine.ts**: Three-layer platform detection architecture refactoring
  - **Removed hardcoded default platform list** `['app', 'h5', 'miniapp', 'admin']` → returns empty array
  - **New Layer 2**: Tech stack header parsing `### Chinese Name (English Name)`
  - **New functions**: `parseTechStackHeaders()` + `buildDynamicAliasesFromTechStack()`
  - **Fixed `normalizeToStandardPlatform()`**: Two-phase longest-match strategy
    - Phase 1 exact match, Phase 2 contains match, prevents short alias mis-matching
    - Fixed "后台服务端" → admin (should be backend), "移动端" → app (should be h5)
  - **Enhanced `inferPlatformFromPathOrContent()`**: Merges static mapping + CONSTITUTION.md dynamic aliases

- **analyze.ts**: --auto mode refactoring + platform filtering
  - **--auto no longer skips AI**: Removed `runAnalysis()` + `generateSpecsFromRequirements()` calls
  - Now sets `options.prompt = true`, falls through to prompt generation for host AI analysis
  - **Iteration-level --platform filtering**: Prompt includes platform filtering instructions
  - **AI platform discovery instructions**: Prompt step 5 guides AI to discover platforms from CONSTITUTION.md + requirements
  - AI writes discovered platform list to `020-specs/PLATFORMS.md`

- **cli.ts**: Registered `--platform` option for analyze command

### Design Principles

- ✅ **Platform list determined by AI**: CLI only does deterministic detection (table + headers), uncertain cases delegated to AI
- ✅ **--auto must go through AI**: Auto mode means non-interactive, not skip AI
- ✅ **Dynamic project adaptation**: No hardcoded platform lists, each project's platforms determined by AI based on actual content

---

## v6.38.0 (2026-08-15) — Design Doc Update + Code Sync

### Core Changes

- **DESIGN.md**: Added "2026-08-15 Analyze Generates Platform-Specific Docs + Split Smart Splits" section, documenting architectural changes from v6.31.0-v6.37.0
  - Analyze --auto dual-layer doc architecture (global + per-platform separation)
  - REQUIREMENT.md feature platform annotation
  - Analyze --prompt directory structure guidance
  - Split platform inference logic refactoring (three-tier priority)
  - Split reads per-platform subdirectory docs (dual-layer reading)
  - Path adaptation strategy (new path priority + legacy fallback)
  - Complete data flow example
- **Version history table**: Added changelog entries for v6.31.0-v6.37.0 (7 versions total)

## v6.37.0 (2026-08-15) — Split Reads Per-Platform Subdirectory Docs + Prioritizes Platform-Specific Extraction

### Core Changes

- **split.ts**: `loadSpecContents()` refactored to read "root-level global docs + per-platform subdirectory docs"
  - Root: TECH.md, TEST.md, RISK.md, DEPS.md, MONITOR.md, ANALYSIS.md, REQUIREMENT.md, UI_SPEC.md
  - Per-platform: `{platform}/TECH.md`, `{platform}/TEST.md`, `{platform}/UI_SPEC.md`
  - Distinguished by platform prefix: `admin/TECH.md` → key is `'admin/TECH.md'`
- **split.ts**: `extractTaskTechContent()` prioritizes reading corresponding platform's TECH.md, falls back to root TECH.md (backward compatible)

## v6.36.0 (2026-08-15) — Analyze Marks Feature Platforms + Split Smartly Splits by Platform

### Core Changes

- **analyze-engine.ts**: `buildRequirementSpec()` adds "涉及端" (involved platforms) column to feature module list, defaulting to "_待 AI 标注_" for subsequent AI or manual annotation
- **split.ts**: `createTaskFromSection()` refactors platform inference logic:
  - Priority: Use AI-annotated `_scopePlatforms`
  - Fallback: Infer from whether `020-specs/{platform}/TECH.md` has substantial content
  - Final fallback: All platforms (backward compatible)

## v6.35.0 (2026-08-15) — Analyze --auto Generates Platform-Specific Docs (Global + Per-Platform Separation)

### Core Changes

- **analyze-engine.ts**: `generateSpecsFromRequirements()` refactored to "global docs + per-platform docs" dual-layer architecture
  - **Global docs** (cross-platform): REQUIREMENT.md, ANALYSIS.md, DEPS.md, RISK.md, MONITOR.md, REVIEW.md
  - **Per-platform docs**: Generate TECH.md, TEST.md, UI_SPEC.md (frontend only) under `020-specs/{platform}/`
  - Added `buildTechSpecForPlatform()`, `buildTestSpecForPlatform()`, `buildUISpecForPlatform()` three platform-specific builders
  - Added `isBackendPlatform()` helper function to identify backend platforms

## v6.34.0 (2026-08-15) — Split/Prompt-Builder/Knowledge-Graph Adapt to New Platform Directory Path

### Core Changes

- **split.ts**: `loadSpecContents()` now reads platform-level analysis docs from `020-specs/{platform}/` (fallback to `020-specs/platforms/{platform}/`), fixing the issue where split couldn't find platform content after analyze switched to per-platform directories
- **prompt-builder.ts**: Platform spec file path changed from `020-specs/platforms/{platform}/` to prefer `020-specs/{platform}/`, with legacy fallback
- **knowledge-graph.ts**: Knowledge graph scanning changed from `020-specs/platforms/{platform}/` to `020-specs/{platform}/`, with legacy fallback

## v6.33.0 (2026-08-15) — Analyze Prompt Adds Directory Structure Guidance

### Core Changes

- **analyze.ts**: `--prompt` mode now includes "Directory Structure" step (step 5), explicitly instructing AI to create per-platform subdirectories (`020-specs/{platform}/`) instead of flat files in root
  - Reads platform list from CONSTITUTION.md
  - Each platform directory contains platform-specific analysis docs
  - Root directory only holds cross-platform documents

## v6.32.0 (2026-08-15) — Onboarding Page Force-Display Fix (All Platforms)

### Core Changes

- **speccore-router/SKILL.md**: `[SPECCORE_ONBOARD]` handling changed from conditional ("platforms supporting present_files → display") to imperative ("**immediately execute** present_files"), eliminating AI selective-ignore loophole
- **7 platform spec-ask.md** (.claude/.codebuddy/.cursor/.qoder/.trae/.trae-cn/.windsurf): Added "Onboarding Force Display" section, synced with SKILL.md rules
- **init.ts**: spec-ask command template now includes onboarding force-display rule, ensuring new projects after `speccore init --update` also show the page correctly

## v6.31.0 (2026-08-15) — CONSTITUTION Section Diff on Upgrade + Update Sync Summary

### Core Changes

- **init.ts**: `checkUpgradeHints` now detects missing sections in existing CONSTITUTION.md compared to latest template (project info/tech stack/naming conventions/error codes/git branch strategy), prompts user to fill gaps
- **init.ts**: Removed deprecated `generateConstitutionTemplate()` function (superseded by template files)
- **update.ts**: When command files are unchanged, now displays synced file list (skills/AGENTS.md/SETTINGS.md/AI-RULES.md) for clear confirmation

## v6.30.0 (2026-08-15) — Full-Chain Path Consistency Fix + CONTEXT.md Migration

### Core Changes

- **spec-merger.ts**: 5 `_shared/` primary paths unified to `readTaskSpecByFilename` (`00-specs/` first, `_shared/` fallback)
- **context-output.ts**: `backend/` legacy path changed to `00-specs/` first + `backend/` fallback
- **status-panel.ts**: Platform detection adapted for `10-backend/` + `20-frontend/` new directory names, legacy fallback retained
- **split.ts**: CONTEXT.md write path migrated from `_shared/` to `00-specs/`
- **rag-engine.ts**: RAG index candidates added `00-specs/CONTEXT.md`, `_shared/CONTEXT.md` demoted to fallback

## v6.29.0 (2026-08-15) — File-as-Memory + [SPECCORE_CONTINUE] Auto-Continuation Mechanism

### Core Changes

- **execution-state.ts**: New TaskSummary interface + addTaskSummary/generateContextSummary/writeContextSummaryFile
  - Write task summary after each task completes (name/type/outputs/dependencies)
  - Generate compact context summary (~1K tokens) at batch end, written to `.speccore/local/execution-summary.md`
  - New sessions only need to read the summary file to quickly restore global context
- **execute.ts**: processBatch records summary after each task; writes summary file at batch end
  - Prompt mode outputs `[SPECCORE_CONTINUE: <path>]` marker at batch end (replaces `[SPECCORE_BATCH_COMPLETE]`)
- **AGENTS.md + init.ts**: Marker table updated to `[SPECCORE_CONTINUE: <path>]`
- **spec-execute SKILL.md**: Batch execution step 3 updated to auto-continuation flow
- clearExecutionState also clears summary file

## v6.28.0 (2026-08-15) — task/new + next-steps + spec-merger Path Adaptation for Three-Level Nesting

### Core Changes

- **task/new.ts**: Manual task creation fully adapted to three-level nesting
  - `_shared/` → `00-specs/` (core spec write paths)
  - Removed `99-artifacts/` creation
  - `backend/` → `10-backend/api/impl/` (with .meta/src/tests/TASK.md)
  - `frontend/` → `20-frontend/web/impl/` (with .meta/src/tests/TASK.md)
  - research type skips platform subtask directories
- **next-steps.ts**: lifecycle suggestions changed from `99-artifacts/TEST.md` to "subtask directory/TEST.md"
- **spec-merger.ts**: readTaskSpecByFilename priority corrected to `00-specs/` > `_shared/` > `99-artifacts/`

## v6.27.1 (2026-08-15) — Remove Numeric Prefix from Subtask Directory Names

### Core Changes

- **split.ts**: Subtask directory name changed from `01-{slug}` to `{slug}` (e.g., `login-api/` instead of `01-login-api/`)
- **prompt-builder.ts**: Loading subtask files now dynamically scans the first subtask under the service directory, no longer hardcoded `01-impl`

## v6.27.0 (2026-08-15) — Three-Level Nesting Associated Fix: Full-Chain Path Adaptation

### Core Changes

- **verify-engine.ts**: Quality gate (TEST.md/REVIEW.md/DEPLOY.md) scans subtask directories; report written to task root
- **execute.ts**: Verify flow, compliance checks, quality gates all scan subtask directories; `_shared/` path priority adjusted to `00-specs/` first
- **analyze.ts**: Document augmentation (TEST.md/REVIEW.md/RISK.md/DEPS.md/MONITOR.md) scans subtask directories
- **retro.ts**: VERIFY_REPORT.md lookup path adapted (task root first, 99-artifacts/ fallback)
- **knowledge-graph.ts**: Knowledge graph scanning adapted for three-level nesting (scanTasks + scanTaskSpecs)
- **init.ts + create.ts**: Directory tree templates updated to three-level nesting structure
- All changes retain legacy structure fallback for backward compatibility

## v6.26.0 (2026-08-15) — Three-Level Task Nesting + Task Type Differentiation

### Core Changes

- **Three-level task directory nesting**: Changed from flat `10-{platform}/` to `10-backend/{service}/{subtask}/`
  - Level 1: Backend/Frontend category (`10-backend/` / `20-frontend/`)
  - Level 2: Platform/Service (`api/` / `h5/` / `admin/`)
  - Level 3: Subtask (`01-xxx/` — real execution unit)
- **Task type differentiation**:
  - **feature/bugfix/refactor**: Full three-level nesting, backend/frontend split → platforms → subtasks
  - **research**: No platform nesting, directly produces research docs (RESEARCH.md + COMPARISON.md)
- **split.ts refactor**: Platform classification into backend/frontend, three-level directory creation; research type skips platform directories
- **execute.ts adaptation**: Scans subtask dirs under `10-backend/*/` and `20-frontend/*/`, with legacy structure fallback
- **rag-engine.ts fix**: `indexTaskDocuments` candidate paths updated to new structure, dynamic subtask document scanning
- **prompt-builder.ts fix**: `loadExtraSpecs` paths updated; `loadAllTaskContext` exclusion rules correctly match category directories
- **AGENTS.md update**: Directory structure docs reflect three-level nesting + research type

## v6.25.0 (2026-08-15) — Subtask Refactor: Subtasks Become Real Work Units

### Core Changes

- **Fundamental task directory restructuring**: Parent Task changed from "execution unit" to "feature module grouping", subtasks become the real work units
  - **Parent Task (Task-NNN-slug)**: Only keeps shared content (`00-specs/` + `_shared/` + `.issues.md`)
  - **Subtasks (10-{service}/, 20-{platform}/)**: Each subtask has independent `.meta/` (type/status/owner), `git-config`, `TASK.md`, `src/`, `tests/` + execution artifacts (TEST/RISK/DEPS/MONITOR/REVIEW/DEPLOY/ERROR_CODES/ADR)
  - **Removed `99-artifacts/`**: Execution artifact docs moved into each subtask directory
  - **Removed parent-level `.meta/`**: Metadata moved into each subtask directory
- **split.ts refactored**: Platform loop changed to subtask loop, each subtask generates complete document set
- **execute.ts adapted**: Scans `10-*/`/`20-*/` directories instead of hardcoded `10-backend/`/`20-frontend/`
- **AGENTS.md updated**: Directory structure docs reflect new design

## v6.24.0 (2026-08-15) — Split Task Directory Structure Standardization

### Core Changes

- **Split command directory structure aligned with AGENTS.md design**: Fixed Task directories generated by split not matching the design spec
  - Added `00-specs/` directory: REQ.md, TECH.md, SCHEMA.md, CHANGELOG.md moved from `_shared/` into `00-specs/`
  - `_shared/` slimmed down to shared contracts: only `API_CONTRACT.yaml` + `CONTEXT.md`
  - Platform directories prefixed: `backend/` → `10-backend/`, `{platform}/` → `20-frontend/{platform}/`
  - README template updated to reflect new directory structure
- **Backward compatible**: execute.ts already has `_shared/` → `00-specs/` fallback logic, old tasks unaffected

## v6.23.0 (2026-08-15) — GLOBAL Directory Cleanup + PROJECTS/BASELINES Removed

### Core Changes

- **GLOBAL/ directory simplified**: Removed 7 empty template files + 3 empty directories, kept only 3-layer core structure
  - Removed: `OVERVIEW.md`, `ARCHITECTURE.md`, `TECH_STACK.md`, `CODE_INDEX.md`, `PROTOTYPE_INDEX.md`, `CHANGELOG.md` (all empty placeholders, never populated)
  - Removed: `PROJECTS/` entire directory (including `_template/` and 3 empty subdirectories)
  - Removed: `REQUIREMENTS/`, `BASELINES/` empty directories
  - Kept: `INDEX.md` (navigation entry) + `GLOSSARY.md` (glossary) + `synthesis/` + `platforms/`
- **INDEX.md rewritten**: Simplified from complex requirement index table to clean navigation entry pointing to synthesis/ and platforms/
- **analyze prompt unified**: `PROJECTS/{project}/` → `platforms/{platform}/`, aligned with synthesize output paths
- **prompt-builder cleanup**: Removed root-level empty file reading, FILE_DESC only keeps files actually generated by synthesis/
- **Fixed duplicate entries**: ERROR_CODES/DEPENDENCY_GRAPH/CODE_INDEX each appeared twice in analyze prompt, removed duplicates

### Simplified GLOBAL Structure

```
.speccore/GLOBAL/
├── INDEX.md                ← Global knowledge base navigation entry
├── GLOSSARY.md             ← Cross-project unified glossary
├── synthesis/              ← Cross-platform synthesis (synthesize Phase 2)
│   ├── ARCHITECTURE.md
│   ├── TECH_FULL.md
│   └── CROSS_PLATFORM.md
└── platforms/              ← Per-platform analysis (synthesize Phase 1 / analyze)
    └── {platform}/
```

---

## v6.22.0 (2026-08-15) — Requirements Directory Simplification + Prototypes Promoted to Top-Level

### Core Changes

- **010-requirements/ directory simplified**:
  - Removed `assets/screenshots/`, `assets/designs/` — zero code references, unused
  - `assets/prototypes/` promoted to top-level `prototypes/` — prototypes (HTML/images/links, any content)
  - `assets/` now only contains `extracted/` subdirectory — doc2spec extracted images
  - `assets/images/` merged into `assets/extracted/` — unified Excel image extraction path

- **analyze prototype reading enhanced**:
  - analyze prompt updated: must actively Read prototype files linked from requirement documents
  - analyze-engine.ts exclusion list added `prototypes` to prevent misidentification as feature directory

- **Templates synced**: init.ts, create.ts, AGENTS.md all directory structure descriptions updated uniformly

### New Directory Structure

```
010-requirements/
├── sources/        ← Original PRD archive
├── converted/      ← doc2spec converted MD (per-platform docs)
├── features/       ← Changes/supplementary requirements
├── prototypes/     ← Prototypes (HTML/images/links, any content)
└── assets/
    └── extracted/  ← doc2spec extracted images
```

---

## v6.21.0 (2026-08-15) — Synthesize Architecture Refactor: Phase 2 Reads PRD Directly + Phase 3 Changed to Index Generation

### Core Changes

- **Phase 2 Refactor**: Changed from reading Phase 1 analysis results to reading PRD source directly
  - Input sources: converted/ + REQUIREMENT.md + features/
  - Prompt changed from "analysis" to "extraction": explicitly marked "extract, don't infer"
  - Extraction targets: interface mapping table, shared data models, data flow diagrams, cross-platform call graphs, platform-specific feature lists
  - Phase 2 no longer depends on Phase 1, can run independently

- **Phase 3 Simplification**: Changed from "functional unit synthesis" to "global index generation"
  - Removed 152 lines of merge logic (runPhase3 + buildPhase3Prompt)
  - Added generatePhase3Index(): generates GLOBAL/INDEX.md
  - Index content: project list + per-platform analysis docs + cross-platform synthesis docs + source requirement docs navigation + usage guide

### Architecture Improvement

**Before**:
```
PRD → Phase 1 (per-platform analysis) → Phase 2 (analyze Phase 1 results) → Phase 3 (merge into REQUIREMENT.md)
```

**Now**:
```
PRD ─┬→ Phase 1 (per-platform professional analysis) → GLOBAL/platforms/{platform}/
     └→ Phase 2 (directly extract cross-platform relationships) → GLOBAL/synthesis/
     └→ Phase 3 (generate index) → GLOBAL/INDEX.md
```

### Design Principles

- **Extraction over inference**: Phase 2 extracts existing information from PRD, no secondary analysis
- **Platform independence**: Per-platform documents remain independent, don't force-merge differentiated features
- **Index navigation**: Phase 3 generates index for AI navigation, not merged documents

## v6.20.0 (2026-08-15) — Full-Pipeline Platform-Specific Prompt Enhancement + Template Completion

### Added

- **4 missing templates**: TEST-template.md / REVIEW-template.md / MONITOR-template.md / UI_SPEC-template.md
  - TEST: Backend API tests + Frontend page tests + E2E tests + Four-state tests (loading/empty/error/boundary)
  - REVIEW: Per-platform sections (backend security/transactions/performance + frontend compatibility/UX/performance)
  - MONITOR: Backend metrics (QPS/latency/error rate) + Frontend metrics (FCP/LCP/CLS/JS error rate) + Alert levels
  - UI_SPEC: Route table + Component list + Field→UI mapping + State enums + Interaction design + Responsive adaptation

### Fixed

- **Platform classification bug**: `classifyPlatform('app-android')` was misclassified as backend → Frontend keywords now matched first
- **Execute prompt was backend-only**: Added frontend code generation guidance (field→UI mapping/routes/state enums/four-states/responsive)

### Enhanced

- **Analyze platform constraints aligned with synthesize Phase 1**: Backend/Web Admin/H5/MiniApp each have independent required content checklists
- **REQUIREMENT.md prompt**: Added per-platform differentiation requirements
- **ANALYSIS.md prompt**: Added per-platform analysis + cross-platform association requirements
- **REVIEW.md prompt**: Per-platform sections (backend security/transactions + frontend compatibility/UX)
- **MONITOR.md prompt**: Backend metrics + Frontend Core Web Vitals + Alert level classification
- **templateMap references**: TEST/REVIEW/MONITOR/UI_SPEC now have explicit frontend template references

---

## v6.19.0 (2026-08-15) — Platform-Specific Quality Assurance

### New

- **Quality Audit System (quality-audit.ts)**: Auto-checks AI-generated Spec documents for platform-specific completeness
  - Backend checks: API definitions, request/response fields, data models, business rules, error codes
  - Frontend checks: page routes, component inventory, field→UI mappings, status enums, interaction design, responsive adaptation
  - General checks: content substance, document structure, placeholder detection, table usage
  - Outputs `QUALITY_AUDIT.md` with score, fix suggestions, recommended fix rounds
- **`--audit-fix` option**: Reads quality audit report and generates fix instructions, max 2 rounds
  - Usage: `speccore analyze -I <iteration> --audit-fix --prompt`
- **Frontend-specific template (TECH-FRONTEND-template.md)**: Covers page routes, component design, state management, request encapsulation, styling, build/deploy, field→UI mapping

### Improved

- **writePerPlatform platform-specific extraction**: No longer writes identical report to all platform directories; now extracts platform-differentiated content using keyword matching
- **analyze prompt platform constraints**: New "Platform Specificity Constraints" section requiring backend to have API/data model, frontend to have pages/components/field mappings
- **validate platform-specific checks**: Validates backend TECH.md contains API definitions and data model, frontend TECH.md contains field mappings and status enums

---

## v6.18.4 (2026-08-15) — Batch Execution Enabled by Default

### Change

- **Prompt mode batches by default**: Automatically outputs batch metadata when multiple tasks exist (default 3 tasks/batch), no need for `--batch-size`
- Outputs `[SPECCORE_BATCH_COMPLETE]` signal + next task command when batch ends
- No batch info for single tasks (zero overhead)

---

## v6.18.3 (2026-08-15) — Prompt Slimming: Phase-Based Loading

### Optimization

- **Exclude self-check files during code generation**: `loadAllTaskContext` now excludes TEST.md / SCHEMA.md / REVIEW.md / CHANGELOG.md / DEPLOY.md / .issues.md and 99-artifacts/ directory
- **~3-5K tokens saved per task**: Self-check/review/artifact files deferred to verify phase; code gen only loads essential context
- **Impact**: 7-task projects may fit in a single conversation (previously overflowed at 6 tasks)

---

## v6.18.2 (2026-08-15) — AI Mode Batch Execution + Task Status Tracking

### New Features

- **`--list-pending` lists pending tasks**: Outputs JSON task list (topological sort + batch grouping) for host AI to get full task overview
- **`--batch-size` batch metadata**: Prompt mode outputs batch info (current batch/total/next task), outputs `[SPECCORE_BATCH_COMPLETE]` signal when batch ends to guide host AI to start new conversation
- **Task status auto-tracking**: Prompt mode marks `in_progress` before prompt, marks `completed` after response write (via `.meta/status` file)

### Problem Solved

AI mode (`execute --prompt`) accumulates context across multiple tasks in same conversation, causing overflow. Batch execution solves this by:
1. 3 tasks per batch (configurable)
2. Signal to start new conversation after batch completes
3. New conversation resumes from breakpoint

---

## v6.18.1 (2026-08-15) — Fix execute --prompt Branch Creation

### Bug Fix

- **execute --prompt now creates task branches**: Previously AI mode (--prompt/--response) didn't create branches, all code was written to current branch. Now consistent with direct execution mode - each task gets its own branch, and AI is told which branch to work on
- **Dependency merging**: AI mode also supports dependency branch merging (for serial dependencies, branches from completed task's branch)

---

## v6.18.0 (2026-08-15) — Auto Pipeline Anti-Block + Protected Branch Unified Check

### Pipeline Anti-Blocking Fixes

- **split --force anti-block**: `isInteractive` adds `&& !options.force`, fixing dev --auto pipeline blocking due to TTY inheritance causing split to enter interactive mode
- **pr --force non-interactive auto-commit**: New `--force` mode for automatic `git add -A` + commit + push without user interaction
- **pr protected branch unified check**: 3 hardcoded `branch !== 'main' && branch !== 'master'` replaced with `isProtectedBranch()`, consistent with CONSTITUTION.md config (supports wildcards like release/*)

### Protected Branch Auto-Migration

- **CONSTITUTION.md template enhanced**: New files now include `保护分支: main, master, release/*, production` config line
- **Upgrade auto-migration**: `checkUpgradeHints()` detects missing `保护分支` config in existing files with `Git 分支策略` section and auto-appends it
- **Three-layer protection**: Config declaration (CONSTITUTION.md) → Runtime check (isProtectedBranch) → Git Hook interception (pre-commit/pre-push)

---

## v6.17.0 (2026-08-15) — Pipeline Fix: analyze --auto Generates Full Spec Files

### P0: analyze --auto Full Spec Generation

- **analyze --auto now generates all spec files**: Previously only generated ANALYSIS.md, leaving other spec files as empty templates. Now extracts APIs, features, data models, and business rules from requirements to generate substantive spec files
- **New `generateSpecsFromRequirements()`**: 438 lines in analyze-engine.ts with information extraction + 7 spec file builders
- **Smart overwrite**: Files with existing content (>50 non-template chars) are preserved; empty templates replaced
- **Complete data flow**: init → analyze --auto → split → execute

### P1: Document Quality

- **ANALYSIS.md deduplication**: Fixed duplicate warnings in scanCompleteness()
- **doc2spec filename fix**: `requirementsrequirements.md` → `requirements.md`

### P2: Pipeline & Documentation

- **dev pipeline content validation**: doc2spec/analyze stages check for actual content
- **Documentation**: command-reference.md, spec-layers.md, knowledge-base-design.md, quick-start.md updated

---

## v6.16.0 (2026-08-15) — Command Consolidation

### Refactor: Command Merging

- **synthesize → analyze --full**: synthesize kept as backward-compat alias, main entry unified to `analyze --full`
- **sync-global → sync --global**: sync command adds `--global` option, sync-global kept as alias
- **tracker → track**: tracker marked as backward-compat alias, unified to track
- **arch-update → update --arch**: update command adds `--arch` option, arch-update kept as alias
- **schedule deprecated**: Scheduled tasks replaced by WorkBuddy Automations, command kept but marked deprecated

### Ask Engine Updates

- analyze KB: added `--full`/`--phase` params and synthesize-related triggers
- sync KB: added `--global` option and sync-to-global triggers
- track KB: added tracker alias and triggers
- schedule KB: marked as deprecated
- SYNONYM_MAP: added synthesize/sync-global synonyms → route to analyze/sync
- intent-recognition.ts: synthesize intent → analyze, sync-global intent → sync

### Documentation

- README.md: tagline 22 → 20 commands
- help-panel.ts: removed synthesize/schedule entries
- help.ts: analyze params updated, categories adjusted
- All docs unified to 20 commands

---

## v6.15.0 (2026-08-15) — Remove Simple/Full Mode Concept

### Refactor: Unified Command System

- **Remove mode distinction**: Delete `readMode()`, `SIMPLE_COMMANDS`, `filterCommands`, `configureHelp` logic
- **Simplify init command**: Remove `--full` option, interactive init no longer asks for mode selection
- **Simplify help command**: Remove simple mode title and `--full` parameter description
- **Documentation update**: README, quick-start, scenarios, command-reference all remove "simple/full mode" concept

### Files Changed

- `src/cli.ts` — Delete mode detection and command filtering logic (-32 lines)
- `src/commands/init.ts` — Remove mode selection interaction (-4 lines)
- `src/commands/help.ts` — Remove simple mode title and parameters (-3 lines)
- `README.md` — Delete "Two Modes" section
- `docs/quick-start.md` — Delete "Two Modes" table
- `docs/scenarios.md` — Update titles and comments
- `docs/command-reference.md` — Subcommand title removes "Full Mode"

---

## v6.10.0 (2026-08-14) — Smart Document Classification + Task Context Traceability + Multi-Type Task Support

### Smart Document Classification (doc2spec --classify)

- **Overview**: Import any documents (security reports, performance analysis, user feedback) via AI-powered classification
- **Two-step interaction**: `--prompt` outputs classification Prompt → AI returns JSON with intent → `--response` writes to staging/
- **AI intent understanding**: AI first determines document nature (e.g., "security vulnerability"), then maps to task type
  - Security/defects → bugfix | New features → feature | Performance → refactor | Research → research
- **staging/ temp directory**: YAML frontmatter with type/nature/title/source/created
- **analyze routing**: Reads type frontmatter from staging/ files, routes to `020-specs/{features,bugs,refactors,research}/`
- **nature field passthrough**: Analyzed spec files preserve AI's intent description

### Multi-Type Task Support

- **Flat document directories**: `010-requirements/{bugs,refactors,research}/` for direct type-specific documents
- **1:1 mapping rule**: bugs/refactors/research docs each map to exactly one task (no split/merge)
- **features split/merge**: Split by functional unit (1-3 tasks), with granularity validation
- **split prompt enhancement**: New sourceFile/functionalUnit/reason fields for source tracing

### Task Context (CONTEXT.md)

- **`_shared/CONTEXT.md`**: Auto-generated source traceability document in each task directory
  - Source trace table: 010-requirements → 020-specs full path chain
  - Original description summary: First 500 chars of requirement doc
  - Related tasks list: Other tasks in the same iteration
  - Impact scope: AI-analyzed impact description
- **sourceFile field**: AI outputs source document path per task during split
- **RAG/prompt integration**: CONTEXT.md included in RAG index candidates and prompt-builder loading list

### Ask Engine Enhancement

- **COMMAND_KB update**: doc2spec entry now includes --classify description/usage/examples/triggers
- **SYNONYM_MAP expansion**: Added smart classification/classify/extract requirements/import docs → doc2spec
- **Interaction mode**: classify triggers match to doc2spec command only, no pipeline auto-execution

---

## v6.6.0 (2026-08-14) — Knowledge Base System Comprehensive Fix (13 issues)

### P0 Critical Fixes
- **Subtask context chain**: `getTaskContext()` now follows subtask_of → parent → implements to find upstream requirements
- **Staleness detection**: `isGraphStale()` now recursively scans file mtimes instead of directory mtime
- **Decay detection paths**: Added basename fallback matching for path format inconsistencies

### P1 Important Fixes
- **Requirement ID uniqueness**: Path-based fallback ID prevents entity collision
- **Spec→requirement relations**: `inferRelations()` now reads spec file content to extract REQ-xxx references
- **Iteration design docs visibility**: `loadExtraSpecs()` loads 020-specs/DESIGN.md into AI prompt
- **Platform registry**: Added cwd parameter to `parseGlobalPlatforms()`/`resolvePlatform()`
- **Context builder**: `saveContextMarkdown()` uses `getIterationDir()` for consistent paths
- **Reindex engine**: `getFileDescription()` now calls `extractFileDescription()` for real titles

### P2 Other Fixes
- **Task paths**: `getTaskPath()`/`getTasksRoot()` accept cwd parameter
- **Timestamp backup filtering**: Knowledge graph scans now filter timestamp backup files

---

## v6.5.1 (2026-08-14) — Auto Knowledge Graph Update

- **Lazy loading**: prompt-builder auto-detects stale graph and rebuilds on-the-fly
- **Staleness check**: `isGraphStale()` compares graph generation time vs directory mtime
- **Auto refresh**: `refreshKnowledgeGraph()` silently rebuilds without blocking main flow
- After users create tasks/update docs, next execute automatically sees updated context chain

---

## v6.5.0 (2026-08-14) — Knowledge Graph + Decay Detection + AI Context Chain

- **New `knowledge-graph.ts`**: Knowledge graph builder
  - Scans requirements/specs/tasks/subtasks, extracts entities and relations
  - Auto-matches requirement→task by number
  - Subtask→parent task relation tracking
  - User custom file discovery and tagging
  - Outputs `knowledge-graph.json` (machine-readable)
- **New `decay-detector.ts`**: Knowledge decay detection
  - Compares against integrity snapshot to detect content changes
  - Downstream stale detection: upstream req changed but task not synced
  - Orphan detection: entity in graph but file no longer exists
- **New `context-builder.ts`**: Compact context generator
  - Generates CONTEXT.md (requirement→task trace table + decay report + user files)
  - `buildCompactContext()` generates < 500 tokens context chain for prompts
- **Integrated prompt-builder.ts**: Auto-inject task context chain during execute/split
  - AI sees: upstream requirement, sibling subtask progress, platform status
- **Integrated reindex**: `speccore reindex` auto-builds graph + decay detection + CONTEXT.md

---

## v6.4.0 (2026-08-14) — Full Index Rebuild & Consistency Check

- **New `reindex` command**: Scan global/iteration layers, detect stale links, discover new files, rebuild indexes
  - `speccore reindex` — Full rebuild of all layer indexes
  - `speccore reindex --check` — Check consistency only, no fixes
  - `speccore reindex -i Q2` — Specify iteration
- **New `reindex-engine.ts`**: Core scanning engine
  - Global: scan `.speccore/GLOBAL/` .md files, check INDEX.md stale links, find unindexed files
  - Iteration: scan `010-requirements/`, `020-specs/`, `030-tasks/`, verify PROJECT_GRAPH.md task references
  - PLATFORMS.md consistency: check sub-task status vs actual TASK.md
  - Auto-rebuild: `GLOBAL/INDEX.md`, `020-specs/INDEX.md`
  - Integrity snapshot: save `.speccore/cache/integrity.json` for next comparison

---

## v6.3.1 (2026-08-14) — Full Pipeline Verification: 5 Bug Fixes

- **Bug#1**: `generateSubtaskId` called multiple times producing different IDs → pre-generate ID map, consistent across README/TASK.md/PLATFORMS.md
- **Bug#2**: execute pre-check only looked at `00-specs/` → added `_shared/REQ.md`, `_shared/TECH.md` fallback
- **Bug#3**: `resolveTaskDir` didn't support type subdirectories → now uses `findTaskDir()` for recursive lookup
- **Bug#4**: `loadExtraSpecs` didn't read platform sub-task files → loads `{platform}/TASK.md` etc. when `--platform` specified
- **Bug#5**: `filterByPlatform` path construction skipped type subdirectories → uses fixed `resolveTaskDir`
- **Extra**: `generateTaskSkeleton` and batch execution logs also get `_shared/` path fallback

---

## v6.3.0 (2026-08-14) — Platform Registry + Fuzzy Matching + Per-Platform Analysis

- **New `platform-registry.ts`**: Unified platform name resolution module
  - `parseGlobalPlatforms()`: Parse global platform names from CONSTITUTION.md "对应需求端" column
  - `fuzzyMatchPlatform()`: Fuzzy matching (exact → prefix → contains)
  - `resolvePlatform()`: Unified entry point for commands, lists available platforms on error
  - `generatePlatformsRegistry()`: Auto-generate `_shared/PLATFORMS.md` during split
- **split auto-generates platform registry**: Writes `_shared/PLATFORMS.md` after task creation with platform names/sub-task IDs/assignees/command references
- **analyze `--platform`**: Analyze only one platform, writes to `{platform}/` directory without affecting others
- **execute `--platform` fuzzy matching**: Input `back` auto-matches `backend`, friendly error on mismatch
- **Three-layer platform consistency**: CONSTITUTION.md (global authority) → PLATFORMS.md (task-level) → fuzzy matching (command layer)

---

## v6.2.0 (2026-08-14) — Sub-task Discovery & Filtering: scanTasks Expansion + Platform/Assignee Filter

- **`scanTasks` restructured**: Auto-discover per-platform sub-tasks, expand to independent TaskState
  - New structure: Scan `{platform}/TASK.md`, extract sub-task ID, assignee, status
  - Backward compatible: Fall back to parent task level when no sub-tasks
  - TaskState adds `platform` and `parentTaskId` fields
- **`--platform` filter enhanced**: Supports new `{platform}/` + legacy `frontend/{platform}/`
- **`--assignee` filter**: Now correctly matches per-platform sub-task owners
- **TASK.md path compatibility**: `_shared/TASK.md` → `00-specs/TASK.md` fallback

---

## v6.1.1 (2026-08-14) — Sub-task Naming Rule: Full Parent Task Name

- **Sub-task ID format change**: From `Task-{number}-{platform}-{hash}` to `Task-{full-parent-name}-{platform}-{hash}`
  - Old: `Task-001-backend-a3f2`
  - New: `Task-001-user-login-backend-a3f2`
- Parent name includes number + slug for easy traceability

---

## v6.1.0 (2026-08-14) — Task Directory Restructure: _shared/ + Platform Nesting + Sub-task Naming

- **Task directory restructure**: From flat `00-specs/` to `_shared/` + `{platform}/` nesting
  - `_shared/` — Shared specs (REQ/TECH/SCHEMA/CHANGELOG/API_CONTRACT)
  - `{platform}/` — Per-platform sub-tasks (TASK.md + src/tests)
  - `99-artifacts/` — Execution artifacts (unchanged)
- **Sub-task global naming**: `Task-{parent}-{platform}-{hash4}` format, e.g. `Task-001-backend-a3f2`
- **Scheme C mixed**: Iteration 020-specs/ supports global + platforms/ dual-layer structure
- **Split command rework**: Functional units as modules, per-platform sub-tasks with independent owners
- **Backward compatible**: analyze/execute/prompt-builder support `_shared/` → `00-specs/` fallback
- **Init templates updated**: New task directory structure templates

---

## v6.0.1 (2026-08-14) — TOC Entry Enhancement: Summary/Platforms/LineCount/Tags

- **`TOCEntry` interface enhanced**: Added 4 new fields
  - `summary` — First paragraph summary (≤200 chars)
  - `platforms` — Involved platforms (auto-detected from path/content)
  - `lineCount` — File line count (helps AI estimate reading cost)
  - `tags` — Keyword tags (extracted from ## headings, stop words removed)
- **New extraction functions**: `extractSummary()` / `extractPlatforms()` / `extractTags()`
- **New `buildTOCEntry()`**: Unified TOC entry builder, avoids code duplication
- **New `formatTOCEntry()`**: Formats single TOC entry with all enhanced fields
- **AI decision support**: Tags for semantic matching, platforms for relevance, lineCount for cost estimation

---

## v6.0.0 (2026-08-14) — Global Knowledge Base TOC Full Coverage: PATTERNS + RULES + PROJECTS + Flat Files

- **`buildGlobalTOC()` expanded**: From 2 directories to 6 sources
  - synthesis/ — Cross-platform synthesis docs (existing)
  - platforms/ — Per-platform analysis docs (existing)
  - PROJECTS/ — Per-project analysis docs (new)
  - GLOBAL flat files — ARCHITECTURE/CODE_INDEX/GLOSSARY/OVERVIEW/TECH_STACK etc. (new)
  - PATTERNS/TEMPLATES/ — Spec writing templates (new, AI can reference when writing Specs)
  - RULES/ — Code review rules + completion checklist (new)
- **`formatGlobalContext()`**: Extracted as shared function for formatPrompt and split.ts
- **TOC grouped display**: 6 groups (📚Cross-platform / 📱Per-platform / 🏗Projects / 📖Reference / ✏️Templates / 📏Rules)
- **Path hints**: Clear base paths for GLOBAL/PATTERNS/RULES
- **FILE_DESC expanded**: Added CODE_INDEX/GLOSSARY/OVERVIEW/TECH_STACK/CHANGELOG/PROTOTYPE_INDEX descriptions
- **RULES_DESC**: New rules file description mapping

---

## v5.99.2 (2026-08-14) — Verification Fixes + Design Doc Update

- **Fix**: `buildGlobalTOC()` filters timestamp backup files (`isTimestampBackup`)
- **Fix**: `generateGlobalIndex()` also filters backup files
- **Fix**: `buildPrompt()` global context condition (skip empty section)
- **Fix**: `readdir` changed from dynamic import to top-level import (Node 16 compat)
- **Docs**: `spec-layers.md` fully updated, new Layer 0 global knowledge base + smart injection

---

## v5.99.1 (2026-08-14) — Global Knowledge Base as TOC Directory: AI Decides What to Read

- **Refactor GlobalContext**: From pre-fetched content to TOC directory structure (`TOCEntry` interface)
- **`buildGlobalTOC()`**: Scans GLOBAL directory, extracts ## heading lines without reading full content
- **`loadGlobalContext()`**: Mandatory INDEX.md injected directly + rest only as directory listing
- **`formatPrompt()` global knowledge section**: Split into "📌 Must Read (injected)" and "📂 Optional (Read on demand)"
- **Platform-grouped display**: Documents grouped by platform, current platform marked with ⬅ arrow
- **split.ts**: Synced to use TOC directory injection
- **Removed old functions**: `extractArchConstraints()` / `extractTechConstraints()` keyword matching removed
- **Core concept**: CLI provides the map + marks must-reads, AI decides which files to read

---

## v5.99.0 (2026-08-14) — Smart Global Context Injection: split/execute/analyze Auto-Reference Global Knowledge

- **prompt-builder.ts**: New `loadGlobalContext()` function with smart injection per command type
- **execute/plan**: Auto-inject architecture constraints + tech constraints + platform-specific rules (GLOBAL/platforms/{platform}/)
- **split**: Auto-inject cross-platform relationship summary + global index
- **analyze**: Auto-inject architecture summary
- **synthesize Phase 2**: Auto-generate `GLOBAL/INDEX.md` lightweight index after apply
- **Summary extraction**: `extractSummary()` takes first 3 lines per section, `extractArchConstraints()` extracts by keywords
- **Global context output**: `formatPrompt()` adds `## 🌐 Global Context` section for AI code generation

---

## v5.98.0 (2026-08-14) — Phase 1 Platform Type Auto-Detection + Platform-Specific Professional Dimensions

- Phase 1 Prompt adds platform type identification rules (Backend/Web Admin/Mobile H5/Mini Program/Native App)
- Common 10 dimensions + platform-specific dimensions layered design
- Backend: database design, caching, concurrency, message queues, logging/monitoring
- Web Admin: complex components, permission UI, data visualization, accessibility
- Mobile H5: viewport adaptation, touch interaction, first-screen performance, weak network optimization
- Mini Program: package size constraints, platform APIs, rendering limitations, sub-package strategy
- Native App: native bridge, push notifications, offline capability, app store compliance
- Output format adds Chapter 11 "Platform-Specific Professional Dimensions"

---

## v5.97.0 (2026-08-14) — Synthesize Three-Phase Prompts Upgraded to Professional-Grade

- **Phase 1 Per-Platform Analysis**: Upgraded from 5 items to 10 dimensions (feature list + user stories, API specs, data model, business rules, security analysis, performance characteristics, error handling, testing strategy, third-party dependencies, cross-platform associations)
- **Phase 2 Cross-Platform Synthesis**: CROSS_PLATFORM adds data flow / transaction consistency; ARCHITECTURE adds ADR / security architecture / monitoring / disaster recovery; TECH_FULL adds API versioning / capacity planning / data consistency
- **Phase 3 Functional Unit Synthesis**: Adds user stories (Given/When/Then), data dictionary, state machines, non-functional requirements, test points
- **User document support**: Each phase automatically reads user-placed documents from GLOBAL directories as supplementary input
- **Prompt notes**: AI is instructed not to overwrite existing user documents and to prioritize them

---

## v5.96.2 (2026-08-14) — Synthesize Global-Level Write Path Migration

- Phase 1/2 output migrated from `Iteration-NNN/020-specs/` to `.speccore/GLOBAL/`
- Phase 1 → `.speccore/GLOBAL/platforms/{endpoint}/`
- Phase 2 → `.speccore/GLOBAL/synthesis/` (CROSS_PLATFORM + ARCHITECTURE + TECH_FULL)
- Snapshot archival → `.speccore/GLOBAL/snapshots/`
- Phase 3 output remains at iteration level `010-requirements/REQUIREMENT.md`
- Phase 3 read logic collects input from both GLOBAL and iteration layers

---

## v5.96.1 (2026-08-14) — Synthesize Directory Organization Optimization

- Phase 1 output: `per-platform/` → `platforms/` (per-endpoint subdirectories)
- Phase 2 output: scattered files → `synthesis/` subdirectory (CROSS_PLATFORM.md + ARCHITECTURE.md + TECH_FULL.md)
- New `snapshots/` directory: auto-archive old Phase 2 results on re-run
- Phase 2 apply now parses `===MARKER===` separators into individual files
- Phase 1/3 read logic adapted to new directory structure

---

## v5.96.0 (2026-08-14) — Synthesize Multi-Platform Full Analysis & Synthesis (Three-Phase Automated Pipeline)

- **Phase 1: Per-platform analysis** — Reads CONSTITUTION project list, generates independent specs per platform
- **Phase 2: Cross-platform synthesis** — Aggregates all platform specs, identifies cross-platform business relationships, generates CROSS_PLATFORM.md + ARCHITECTURE.md + TECH_FULL.md
- **Phase 3: Functional unit synthesis** — Organizes requirement docs by functional unit, each unit containing all platforms' requirements
- **`--full` mode**: Fully automated three-phase pipeline, no manual intervention
- **`--phase N` mode**: Single-phase manual execution
- **`--apply-phase N` mode**: Receives AI results for a specific phase
- Original simple synthesis mode preserved for backward compatibility
- DESIGN.md updated with multi-platform full analysis & synthesis design section

---

## v5.95.1 (2026-08-13) — TASK_SUMMARY Report Path Optimization

- Reports in dedicated subdirectory `000-overview/task-summaries/`
- Filename includes timestamp: `TASK_SUMMARY-2026-08-13T14-30.md`
- Multiple splits won't overwrite each other

---

## v5.95.0 (2026-08-13) — Task Summary Report: TASK_SUMMARY.md

- **New task summary report**: auto-generated `000-overview/TASK_SUMMARY.md` after split
- **Report contents**: task name, functional unit, human hours, AI hours, priority, dependencies, risk
- **Hours summary**: total human hours, total AI hours, total estimated hours, AI percentage
- **Functional unit distribution**: task count per functional unit
- **stdout output**: `[SPECCORE_TASK_SUMMARY]` marker wrapping report for host AI to display to user
- Supports both `--response` path and regular split path

---

## v5.94.0 (2026-08-13) — Split AI Content Generation: Tasks with Actual REQ.md / TECH.md Content

- **JSON schema extended**: Each task now includes `reqContent` / `techContent` fields
- **REQ.md actual content**: AI generates requirement description (business rules, data models, API definitions), written directly to REQ.md
- **TECH.md actual content**: AI generates technical plan (architecture, core logic, test strategy), written directly to TECH.md
- **Fallback mechanism**: Falls back to original template (`<!-- AI-FILL -->`) when AI doesn't provide content
- **Sub-facet principle**: Content is task-level, not a repeat of the entire functional unit
- All quantity constraints preserved (functional unit ≤ 3, total ≤ 20, non-functional section filtering, etc.)

---

## v5.93.1 (2026-08-13) — Topic Slug Fallback Fix

- **slugify fallback improvement**: pure Chinese names now generate short hash slug (e.g. `a3f2`) instead of meaningless `'task'`
- **Regular path passes topic**: `nextTaskId` now receives slugified topic in regular path too
- Result: `Task-001-a3f2` instead of `Task-001-task` or `Task-001`

---

## v5.93.0 (2026-08-13) — Split Guards: Global Hard Limit + functionalUnit Validation + Non-Functional Section Filter

- **Global task count hard limit**: MAX_TASKS_HARD = 20, terminates on overflow (`--force` to bypass)
- **functionalUnit field enforced**: buildSplitPrompt JSON schema now requires `functionalUnit` field
- **functionalUnit missing warning**: warns when >50% tasks lack the field
- **Non-TTY task summary**: shows functional-unit-grouped task overview in non-interactive mode
- **TEMPLATE_PATTERNS expanded**: 24 new non-functional section filters (background/overview/architecture/terms/goals etc.)
- **Content threshold raised**: filterTemplateNoise minimum content from 3 to 20 chars
- **Removed section fallback**: per-unit validation no longer falls back to section name

---

## v5.92.0 (2026-08-13) — Split Constraint Redesign: Functional Unit Basis

- **Split constraint system redesign**: from global limit / section-based to **functional unit basis**
- Core principle: split based on functional units, not document chapter structure
- Each functional unit defaults to 1 task, max 3 (code-level hard enforcement)
- JSON output adds `functionalUnit` field for AI to annotate each task's functional unit
- Code layer validates by `functionalUnit` grouping, terminates on overflow (`--force` to bypass)
- Removed global task count limit (was MAX_TASKS_HARD_LIMIT = 20)
- Warning when adjacent tasks belong to same functional unit
- Prompt fully unified from "章节" to "功能单元"
- DESIGN.md / command-reference.md updated with functional unit constraint docs
- help.html card width adjusted to 960px
- `cleanupStaleFiles` adds cleanup for `-old` / `-backup` suffix legacy backup files

---

## v5.91.0 (2026-08-13) — Legacy Backup Cleanup + Params Reference Optimization

- `cleanupStaleFiles` adds cleanup logic: auto-remove `-old` / `-backup` suffix legacy backup files (created before v5.87.2)
- Cleanup scope covers: all AI platform commands/skills directories + project root
- help.html core params reference streamlined: removed low-frequency params (--web/--export/--scope), added high-frequency params (--platforms/--type/--force)
- help.html card width adjusted to 960px, consistent with setup-guide

---

## v5.90.0 (2026-08-13) — help.html Comprehensive Optimization

- Welcome page button text color fix: all three button descriptions unified to white `rgba(255,255,255,.85)`
- help.html structural upgrade: added intro card (SDD methodology + core principles), quick-start 4-step flow, common parameters reference table (8 core params)
- help.html title glow effect: h1 adds `animation:titleGlow` + `background-clip:text`, following gradient text inline declaration spec
- help.html glow shifted left: `.card-bg` radial gradient center changed from `50% 10%` to `30% 10%`, breathing animation `cardGlow`
- help.html width unified: card max-width adjusted from `900px` to `800px`, consistent with welcome/setup-guide pages
- Tips section: four tip cards — prefer ask / search commands / view detailed params / HTML help page

---

## v5.89.0 (2026-08-13) — Smart Split Overhaul

- Granularity hard constraints: three tiers (macro 20-80h / module 12-40h / atomic 4-24h) with API/table/page limits
- **Per-developer hours**: granularity validation uses `max(hoursByPlatform)`, not total
- AI output adds `hoursByPlatform` (per-platform estimation) and `topic` (English slug for directory naming)
- `validateGranularity()` warns by per-person max hours, identifies which platform exceeds
- `recommendGranularity(teamSize)` auto-recommends granularity based on STAFFING.md team size
- AI prompt merge tendency: forces merge when complexity below granularity lower bound, "less is more" principle
- Same feature across all platforms must be in one atomic task, not split by platform
- Simplified interaction: show task summary → y confirms and auto-advances / n exits with adjustment hints
- Persistent adjustment instructions: prompt file includes "Adjustment Guide" for AI to re-read when adjusting
- CONSTITUTION.md platform detection: `detectPlatforms()` reads global platform config first
- Scope → platform mapping fix: correctly extracts backend + frontend platforms for directory creation
- Backend directory nesting fix: `platform === 'backend'` creates `10-backend/src/` directly
- Task type subdirectories verified: feature/bugfix/refactor/research based on AI's `type` field
- Task summary shows per-platform hours: `backend:16h + admin:12h + app:12h = 40h (max per person: 16h)`
- Design docs updated: DESIGN.md adds granularity rules + per-platform hours + AI output field table
- Command docs updated: command-reference.md with full split parameter/granularity/interaction docs

---

## v5.87.2 (2026-08-13) — Upgrade Safety Optimization

- `init --update` no longer skips on same version; always runs cleanup and file refresh (legacy format cleanup works without `--force`)
- `init --force` confirmation prompt enhanced: explicitly lists counter/INDEX/config loss risks, guides users to `--update --force` for safe upgrade

---

## v5.87.1 (2026-08-13) — Qoder Legacy Cleanup Fix

- Fixed reversed cleanup logic in update.ts: was incorrectly deleting `spec-` (new format), now correctly cleans `spec:` (old format)
- Legacy command cleanup now checks both `spec:` and `spec-` prefixes

---

## v5.87.0 (2026-08-13) — Unified Timestamp Conflict Handling + Backup Summaries

- `*-old` naming style fully replaced with timestamp format `{name}-{YYYYMMDDHHmmss}.md`
- Removed `.speccore-backup` overall backup mechanism (init --force no longer backs up entire .speccore/)
- New `backupDirWithTimestamp` directory-level timestamp backup function (task-utils.ts)
- All `--force` operation paths now have timestamp protection: import / pattern / migrate
- All backup operations output unified summary: backup file paths + diff commands + cleanup hints
- `_updateConflicts` structure upgraded to `{file, backup}[]` for diff comparison prompts
- Removed dead code: `writeAgentsMdWithOld`, all `*-old` cleanup logic
- init --force never touches Iteration-*/ user directories; conflicting files auto-renamed with user notification

---

## v5.86.0 (2026-08-13) — ID Safety System + Plan Subdirectories + Backup Filtering

- Plan files in subdirectories: `000-overview/plans/Plan-NNN-slug/` (PLAN.md + HTML), no more duplicate MD files
- analyze command generates REQUIREMENT.md (JSON multi-doc mode + DOC_MATRIX feature 8 docs)
- split --response creates full task directories (23-27 files, reuses createTaskFromSection)
- Global counter protection: `getCounters()` scans actual directories for `max(stored, scanned)`, prevents ID collision on counters.json loss
- All split modes (default/strict/interactive/--response) use pre-allocated `_taskId`, eliminating hardcoded IDs
- `updateProjectGraph`/`generateImpactGraph`/`detectSemanticDependencies` use pre-allocated IDs
- task new `--id` now increments counter even with manual ID, preventing auto-ID rollback
- doc2spec CSV batch import, iteration-from-global auto-split now use `nextTaskId`
- search.ts / analyze-engine.ts / synthesize.ts / spec2doc.ts filter timestamp backup files (`isTimestampBackup`)
- CLI options registered: split `--force`, task new `--id`
- Removed dead code `generateTaskId`

---

## v5.85.0 (2026-08-12) — Prompt Library Feature

- New `prompts` command (alias `pt`): Prompt library management
- 19 built-in prompt templates (4 categories: iteration/analysis/execute/change)
- Search, category filter, CRUD, one-click copy
- Custom modal replaces native prompt, real-time preview
- Auto-add `/spec-ask` prefix when copying
- User data stored in `.speccore/prompts/user/` + localStorage dual backup
- Simple mode command count 19 → 20

---

## v5.84.3 (2026-08-12) — Command Registration Consistency Fix + Symlink Safety

- Removed duplicate command-writing loop in update.ts, unified via createToolIntegrations
- Added missing trae-cn tool and spec-help command to update.ts
- Auto-cleanup legacy spec- prefix files during Qoder upgrade (migrate to spec: format)
- Fixed root cause: symlinked commands directories causing cross-tool file deletion
- cleanupStaleFiles now skips symlinked directories to prevent shared target corruption

---

## v5.84.2 (2026-08-12) — Qoder Command Format Fix

- Fixed update command Qoder commands from `.qoder/commands/spec/ask.md` to `.qoder/commands/spec:ask.md`
- Aligned with init: flat directory + `spec:` prefix naming
- Auto-cleanup legacy `spec/` subdirectory

---

## v5.84.1 (2026-08-12) — migrate Command Enhancement

- Added .task-type file detection (takes priority over TASK.md)
- Auto-cleanup legacy Task-* directories under 030-tasks/ root after migration
- Fixed issue where old structure directories remained after migration

---

## v5.84.0 (2026-08-12) — migrate Command + --tools Parameter Fix

- Fixed --tools parameter name mismatch in init/update (tool → tools)
- Added migrate command: auto-migrate task directories to 030-tasks/<type>/
- update.ts: Auto-detect and migrate legacy Task-* directories during upgrade
- Supports --dry-run preview, --force overwrite, --iteration targeting

---

## v5.83.0 (2026-08-12) — --force Mode Auto Backup

- init.ts: --force mode auto backs up .speccore/ + Iteration-*/ + inbox/ + questions/
- init.ts: Backup output uses logger.info for clear backup path and restore instructions
- init.ts: Provides cp -r restore command examples, users can manually delete backup directory when done

---

## v5.82.0 (2026-08-12) — update/init Command Output Improvements

- update.ts: Version match now uses logger.info for clear output (no longer spinner.stop)
- update.ts: Added progress indicators and target tools display during upgrade
- update.ts: Unified output format with separators and structured reports
- init.ts: Delegated existing .speccore update path to updateCommand, eliminated ~50 lines of duplicate code
- init.ts: Removed hardcoded 'new features' list, replaced with concise extra update notes

---

## v5.81.1 (2026-08-12) — Documentation Updates

- command-reference.md: Added setup guide note to init section
- commands.en.md: init section added setup guide note

---

## v5.81.0 (2026-08-12) — Setup Guide Visual Enhancements

### 🌟 Card-bg Glow Effect
- Added radial-gradient glow inside container (matching onboarding page)
- cardGlow 3s breathing animation, cyan glow扩散 from top
- Step card glow enhanced: box-shadow 15px→20px, hover 25px→30px

### 🔗 Start Button Navigation
- Changed from `<div onclick>` to `<a href="speccore-ask-onboarding.html">`
- Click navigates to ask onboarding page
- Added hover effect: glow增强 + translateY(-1px)

### 📐 Container Width
- 860px → 960px, better for wider screens

---

## v5.80.0 (2026-08-12) — Setup Guide Full Restructure

### 📋 Setup Guide Restructure (init.ts — writeSetupGuide)
- **Problem**: Original 5-step guide written from experienced user perspective; new users confused about "import requirements" scope (global vs iteration)
- **Solution**: Restructured from new user perspective into 6 steps, added "Create Iteration" step

### 🔄 Step Order Changes (5 → 6 steps)
| Step | Before | After |
|:---|:---|:---|
| 1 | Tech Constitution | Tech Constitution + **Global Analysis section** |
| 2 | Team Scheduling | Team Config (STAFFING notes "generated after step 3") |
| 3 | — | **🆕 Create Iteration** (explains concept + CLI command template + params) |
| 4 | Import Requirements | Import Requirements (references iteration from step 3) |
| 5 | Knowledge Base & Rules | Knowledge Base & Rules |
| 6 | Start Pipeline | **Start Development** (dual-card: intent + Skill commands) |

### 🤖 AI Commands Unified to Skill Command Format
- All AI commands changed from CLI internal format to Skill commands
- `speccore analyze --prompt` → `/spec-analyze`
- `speccore split --prompt` → `/spec-split`
- `speccore execute --prompt` → `/spec-execute`
- `speccore done --prompt` → `/spec-done`
- `speccore dev` → `/spec-dev`
- `--prompt` built into Skill, no manual addition needed

### ⚡ Automation Mode Documentation
- New three-card section: Full Confirm (default) / Semi-Auto / Full-Auto
- Each mode shows both intent and explicit commands (`/spec-dev -i my-iter --auto-steps` / `--auto`)
- Explains `speccore dev` as pipeline controller

### 🛠️ Other Improvements
- Version number dynamic from package.json instead of hardcoded
- Removed internal command terminology (analyze/split/execute → natural language)
- Added "re-view guide" entry
- Added setup guide screenshots to docs/screenshots/

---

## v5.73.0 (2026-08-11) — Onboarding Page Refactor + Visual Enhancements

### 🎨 Onboarding Page Structure Refactor
- **Title converted to HTML**: SVG title → `<h1>` + titleGlow glow animation (40px Orbitron gradient font)
- **SVG retains only four cards**: connecting lines + center circle + mode cards, everything else is HTML
- **Bottom bar HTML-ized**: unified entry `/spec-ask` text moved to HTML `bottom-bar`
- **SVG coordinates corrected**: all y-coords shifted -60px for compact layout

### 🔗 Auto Template Copy
- **ask command** now automatically copies related template pages from `templates/html/` to `outputs/`
- No more manual `cp`, 5 template pages (explain/guide/match/pipeline/help) auto-synced

### ✨ Visual Details
- **Title glow**: all pages titleGlow unified to `filter:drop-shadow()` (compatible with gradient text)
- **Pipeline cards**: flow-step padding 18→28px, dot-to-text gap 6→12px
- **Tag text centered**: knowledge base / workflow tags moved inside background rects
- **Copy command updated**: clipboard copy changed from `speccore ask` → `/spec-ask`

---

## v5.72.0 (2026-08-11) — Impact Analysis + Quality Gate + Unified Resolver + Clarification Persistence

### 🎯 Structured Impact Analysis (ImpactReport)
- **Three-tier classification**: 🔴direct / 🟡indirect / 🟢unaffected
- **`analyzeImpact` replaces `smartMatchTasks`**: reads REQ + TECH + TASK + status for full analysis
- **Bidirectional dependency graph**: forward + reverse dependency tracking

### 📝 Clarification Persistence
- Clarification = requirement analysis, results now persisted to files
- New requirement → structured REQ.md
- Changes → `020-specs/CHANGE_SUMMARY.md`

### 🚧 Post-Execute Quality Gate
- **Mandatory**: runs automatically after execute, cannot be skipped
- **6 checks**: compile (blocking) + lint + test + deps + security + spec consistency (warnings)
- **4 languages**: Node.js / Java / Go / Python
- **Fix loop**: compile failure → AI fix → re-check → max 3 rounds
- **`speccore verify`**: standalone verification command

### 🔍 Unified Smart Matching (resolver.ts)
- All commands share `resolveTask()` / `resolveIteration()`
- Three-level matching: exact → prefix → keyword search
- Multi-match hinting instead of silent first-pick

---

## v5.22.0 (2026-08-03) — Latest

### 🚀 Analyze Engine Expansion
- **Unified analysis engine**: requirements + code, 3 scopes (`global`/`iteration`/`task`)
- **New flags**: `--scope`, `--src <dirs>`, `--req <files>`, `--depth <quick|normal|deep>`
- **`-I` flag**: iteration selection (capital i), alias `al`
- **`--ask`**: interactive Q&A mode (replaces `--interactive` on analyze only)
- **`speccore status-panel`** replaces dashboard/progress/report
- **`speccore done`** replaces archive
- **`speccore ops`** replaces history
- **Commands**: 52 total (19 in simple mode)

## v5.21.1 (2026-07-28)

### 🔴 Bug Fixes
- Alias table corrected: dashboard→status-panel, history→ops, archive→done
- Intent mapping realigned with consolidated commands
- Doc counts synced across CN + EN

## v5.21.0 (2026-07-25)

### 🔄 Command Consolidation
- `status-panel` now covers dashboard, progress, and report use cases
- `done` replaces archive as the standard completion command
- `ops` replaces history for requirement change tracking

## v5.6.0 (2026-07-14)

## v5.6.1 (2026-07-14)

### 🔴 Bug Fixes
- search: positional arg action signature fixed
- platform-add: --no-sync field name aligned
- update: null iteration early return
- 4 dead code cleanups

## v5.6.2 (2026-07-14)

### 🔴 Bug Fixes
- goal/bugfix/research: --id→--task-id CLI option alignment
- task new: double Task- prefix fixed
- execute: resume null state check added
- 8 error swallowing fixes

## v5.6.3 (2026-07-14)

### 🧹 Mass Cleanup
- 5 dead modules removed (file/git/safe-write/tx-wrapper/task-lock)
- 18 unused imports removed
- Unused dependency glob removed
- rv alias --format option added

## v5.6.4 (2026-07-14)

### 📝 Docs
- Scenario count 12/20→22 unified
- 30 CN/EN doc inconsistencies fixed

## v5.6.5 (2026-07-14)

### 🔴 Bug Fixes
- i18n: locale JSON copy in build script
- Iteration name: auto-strip duplicate 期次- prefix

## v5.6.6 (2026-07-14)

### 🔧 UX
- execute: short --task=Task-001 auto-matches full name

## v5.6.7 (2026-07-14)

### 🔴 Bug Fixes
- handover/retro: missing 期次- prefix crash fixed
- change: --req option added

## v5.6.8 (2026-07-14)

### 🆕 i18n
- Full i18n coverage + t() helper function
- en-US.json: 120+ translation keys
- search/delete/execute bilingual verified

## v5.6.9 (2026-07-14) — Latest

### 🔴 Root Cause Fix
- Double prefix fixed at source: context stores raw name
- Verified: trace/delete/handover/retro all correct


### 🆕 Added
- **`speccore delete`**: Safe task/iteration deletion (trash + auto-clean INDEX/context/git-mapping)
- Supports `--task=<id>` `--iteration=<name>` `--force`
- Supports manual recovery (mv back + index-update)

### 📝 Docs
- Command reference / quick reference / scenarios updated with delete command
- Command count: 46→47


### 🔴 Bidirectional Trace
- **Reverse sync**: `speccore sync` scans `@spec` annotations in code, auto-updates TASK.md
- **Auto-generated TRACE.md**: `_shared/TRACE.md` records code→Spec trace chain
- **Code scanner**: `src/core/reverse-sync.ts` supports 9 languages

### 🔴 Git Integration
- **Auto branch**: `speccore execute --task=Task-001` auto-creates `feature/Task-001-xxx`
- **Branch mapping**: auto-writes `.speccore/.git-mapping.json`

### 🔴 Bug Fixes
- 14 audit findings fixed (Zod Schema / dead code / null safety / regex compat)

### 📝 Docs
- Quick Start / Quick Reference updated with bidirectional trace guides

---

## v5.3.0 (2026-07-11)

### 🆕 Added
- **`speccore diff`**: Compare iterations/baselines for task differences
- **`speccore trace`**: REQ → Task → Code traceability chain visualization
- **CI/CD template**: `templates/ci/github-actions.yml` GitHub Actions integration

### 📝 Docs
- `docs/quick-reference.en.md`: One-page command + safety + CI reference
- 4 new English docs: SDD methodology, Usage guide, Quick reference, Migration guide

### 📊
- **Commands**: 44

---

## v5.2.0 (2026-07-11)

### 🔴 Security
- **All 35 command files now import FileTransaction**: complete coverage
- Fixed relative paths for nested `commands/iteration/` and `commands/task/`
- **Zod runtime validation**: `init.ts` validates context.json via `ContextSchema.safeValidate`

---

## v5.1.0 (2026-07-11)

### 🔴 Core Upgrade
- **`speccore execute` real code generation**: Java Controller/Service/Repository + Vue component scaffolding from Specs
- **`speccore sync` content analysis**: Validates section completeness and API definitions, not just file existence
- **Shared utilities**: `src/utils/task-utils.ts` (generateTaskId, findProjectRoot, scanIterationTasks)

### 🟡 Testing
- **Command integration tests**: `tests/unit/commands/init.test.ts` (6 tests)
- **Total**: 10 files / 148 tests

---

## v5.0.0 (2026-07-11)

### 🏗️ Hardening
- **Safe write wrappers**: `src/core/safe-write.ts` + `src/core/tx-wrapper.ts`
- **Doc-parameter alignment**: 9 corrections across CN + EN command references
- `goal.ts`: FileTransaction integration + deduplicated generateTaskId

---

## v4.9.0 (2026-07-11)

### 🆕 Added
- **`speccore update`**: Update task attributes (status/priority/assignee), transaction-protected
- **Interactive confirmation**: `execute --interactive` with real inquirer prompts
- **SDD methodology doc**: `docs/SDD方法论.md` (CN), `docs/sdd-methodology.en.md` (EN)

### 📝 Docs
- English workspace layout: `docs/workspace-organization.en.md`
- Zero-install experience: `npx speccore` documented in Quick Start (CN + EN)

---

## v4.8.0 (2026-07-11)

### 🆕 Added
- **Batch execution**: `speccore execute --all --batch-size=3` with context isolation
- **Resume**: `speccore execute --resume` continues from last interruption
- **Execution state tracking**: `.speccore/local/execution-state.json`
- **Git workflow integration**: `speccore current` — branch↔task mapping, commit/PR generation
- **Git hooks**: `speccore hooks install` — pre-commit + pre-push
- **Task locking**: `src/core/task-lock.ts` — 30-min auto-timeout

---

## v4.7.0 (2026-07-11)

### 🆕 Added
- **Progress feedback**: real-time progress bar + task status + elapsed time
- **Friendly errors**: Zod errors → actionable messages (`src/core/error-feedback.ts`)
- **Operation logging**: `.speccore/logs/` records who/when/what
- **Auto backup**: `speccore backup` (create/list/restore)
- **Shell completion**: `speccore completion [bash|zsh]`

---

## v4.6.0 (2026-07-11)

### 🆕 Added
- **Migration command**: `speccore migrate` Shell v3.x → CLI v5.x
- **Migration guide**: `docs/migration-guide.md` (CN + EN)

---

## v4.5.0 (2026-07-11)

### 🆕 Added
- **i18n engine**: `SPEC_LOCALE=en-US` for English output, default Chinese
- **Locale resources**: `src/locales/zh-CN.json` + `en-US.json`
- **CLI global option**: `speccore --lang=en-US`

---

## v4.4.0 (2026-07-11)

### 🔄 Enhanced
- **Full transaction support**: execute/plan/archive/sync/change transaction-protected
- 5 critical write commands with transactional guarantees

---

## v4.3.0 (2026-07-11)

### 🆕 Added
- **FileTransaction module**: atomic write/delete/move + commit/rollback
- **sync/change transactionized**: auto-rollback on multi-file write failures

---

## v4.2.0 (2026-07-11)

### 🆕 Tests
- yaml-parser tests: 22 tests, 96.42% pure-function coverage
- Core module test extensions: global-layer +11 / validator +9
- **Total**: 7 files / 123 tests

---

## v4.1.0 (2026-07-11)

### 🏗️ Infrastructure
- **Vitest test framework**: replaced Jest, 8 files / 133 tests
- **Zod data models**: Task / Iteration / Platform / Context Schema

---

## v4.0.0 (2026-07-09)

### 🆕 Added
- Multi-platform task management: `speccore new-task --platforms=web,h5,miniapp`
- Dynamic platform addition: `speccore platform-add`
- Context viewer: `speccore context --task=Task-001`
- Auto index update: `speccore index-update`
- Platform config: `.speccore/config/platforms.yaml`
- WorkBuddy integration: auto-creates `.workbuddy/` on init

### 📊
- **Commands**: 39

---

## v3.0.0 (2026-07-05)

### 🆕 Added
- **Global Layer**: cross-project requirement index (GLOBAL/)
- **Full traceability**: Req → Task → Code bidirectional chain
- **P0/P1/P2 features**: impact / dashboard / baseline / audit
- **rename command**: batch rename + auto-update references

### 📊
- **Commands**: 35

---

## v2.0.0 (2026-07-05)

### 🆕 Added
- **Intent recognition engine**: 12 intent types, 100+ keyword matches
- **12 new commands**: spec / goal / bugfix / research / change / sync, etc.
- **Context awareness**: auto-reads context.json for smart defaults

### 📊
- **Commands**: 26

---

## v1.0.0 (2026-07-05)

### 🆕 Initial Release
- **14 core commands**: init / import / iteration / task / plan / execute / validate / archive, etc.
- **Core engines**: context / state / yaml-parser / template-engine / validator
- **Built-in templates**: Spring Boot / NestJS Controller
- **npm**: `npm install -g speccore`

---

## Versioning

| Type | Rule |
| :--- | :--- |
| Major | Architecture change or feature overhaul |
| Minor | New commands or modules |
| Patch | Bug fixes or doc updates |

Current: **v5.22.0**
