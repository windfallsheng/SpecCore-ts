# SpecCore Changelog

---


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

Current: **v5.6.9**
