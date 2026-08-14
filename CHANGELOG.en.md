# SpecCore Changelog

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
