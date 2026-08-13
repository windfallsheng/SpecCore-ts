# SpecCore Changelog

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
