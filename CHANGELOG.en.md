# SpecCore Changelog

---

> 📌 **Note**: English entries below cover selected releases. For the complete version history (v8.3.194 → v8.3.289), see the Chinese [CHANGELOG.md](CHANGELOG.md).

## v8.3.296 (2026-09-29) — Deploy template/script completion + config example audit + engine path-chain fix

### Added
- **Bare-server Nginx site template** `templates/deploy-nginx/`: nginx-site.conf (SPA fallback/gzip/static cache/API reverse proxy/WebSocket upgrade/healthz passthrough/HTTPS placeholder) + README — complements the Docker-scene nginx.conf for non-containerized Nginx
- **Node backend Dockerfile** `templates/deploy-docker/backend-node.Dockerfile`: multi-stage build + non-root runtime + HEALTHCHECK
- **5 concrete deploy scripts** `templates/deploy-scripts/`: deploy-compose.sh / deploy-ftp.sh (lftp) / deploy-password-ssh.sh (sshpass) / trigger-jenkins.sh / deploy-python.sh (venv+systemd) — `set -euo pipefail`, credentials via env vars only
- **Full main-config example** `templates/speccore-yml-example.yml` (222 lines): covers all current .speccore.yml fields (quality_gates.block_level/verify_ui, arbitration, settings.vision/optional_steps/pipelines/ai/smoke, tests.auth, stages, pipeline.test) with feature-version tags; `init` lands it at examples/config/SPECCORE-YML-EXAMPLE.yml
- **CI example delivery path**: templates/ci/github-actions.yml existed but init never copied it to user projects — now lands at examples/ci/

### Fixed
- **Deploy config path chain break (core bug)**: engine.ts resolved script/pm2_config/manifest/values paths only against the platform cwd, while init-generated examples use project-root-relative paths (.speccore/environments/scripts/...) — broken whenever code_path is set (helm values silently lost -f). New exported `resolveConfigPath` resolves against cwd first, then project root; applied to deployScript/deployK8s/deployHelm/deployPm2

### Enhanced
- **deploy-examples.yaml sections 13/14/15**: nginx_site / go_systemd+go_docker / python_gunicorn — 12 scenes → 15; script comments point to concrete files in templates/deploy-scripts/
- **VERIFY-EXAMPLE data-testid alignment**: login scenario switched to the three-part selector convention ({module}-{page}-{element}); added tests.auth auto-login notes (v8.3.215+)
- **config-reference.md §2 de-duplication**: stale full example (2026-08-28 schema, missing 8 newer fields) replaced with a skeleton overview pointing to the new template
- **staging.yaml.example & update-env-configs.ts**: data-testid three-part convention comment in the auth section

### Verification
- 291 tests green (285 + 6 resolveConfigPath cases); npm pack confirms deploy-scripts/, deploy-nginx/, backend-node.Dockerfile, speccore-yml-example.yml, ci/github-actions.yml all ship in the package

## v8.3.295 (2026-09-29) — Static asset publish chain fixed: onboarding link 404 cured + defensive hardening

### Fixes
- **Onboarding related-page 404 (core bug)**: `templates` was missing from package.json `files` whitelist, and both ask.ts/init.ts resolved templates via `process.cwd()/templates/html` (the user project root, which never exists) — first-ask onboarding never popped and all in-page mode cards / help links 404'd; setup-guide had been silently falling back to a「template missing」placeholder; init's example config copy (DEPLOY-EXAMPLE.yaml etc.) also silently failed. Fix: add `templates` to `files`; resolve template sources inside the package via `join(__dirname, '..', '..', 'templates', 'html')`.
- **Diagnosis: no onboarding after upgrade**: the switch `.speccore/local/.ask-onboarded` compares its recorded version against the CLI runtime version — when the global CLI was not actually upgraded (measured 8.3.282) the versions match and the page never pops; after upgrading, confirm `speccore --version` or run `speccore init` (its upgrade branch resets the marker).

### Hardening
- **generateFlowScenariosFromSpec structure defense**: matchElement/matchPageSelector now check `elementInfo.elements` existence and `pageTestIds` array-ness — malformed external input degrades gracefully instead of throwing TypeError.

### Verification
- 285 tests green; four rounds of targeted verification (spec-generator 10 checks / status --group-by / toSlug composite naming / smoke-engine DOM scan 5 structure points) all PASS
- meeting-system real run: after fix, all five related pages (explain/guide/match/pipeline/help) land in outputs/; `npm pack --dry-run` confirms the tarball ships all templates/html/*.html

## v8.3.294 (2026-09-29) — bugfix composite naming + contract baked into code + smoke selector self-heal hint

### Enhancements
- **bugfix task dir composite naming**: `buildTaskTopic` joins `{module-english}-{bug-english}` (e.g. Task-003-login-flow-timeout-crash) so bugs of the same module sit adjacent under 030-tasks/bugfix/; module name prefers AI `moduleTopic` (prompt-layer translation), falls back to toSlug pinyin for functionalUnit; duplicate-prefix guard when bugSlug already starts with moduleSlug; module segment capped at 15 chars, total under the 40-char nextTaskId limit
- **execute prompt data-testid mandate (two consumers synced)**: prompt-builder frontend requirements and execute.ts buildAgentContext checklist both now require「add data-testid per UI_SPEC element convention ({module}-{page}-{element}, page containers end with xxx-page) — smoke VERIFY_SPEC assertions depend on them」— closing the last broken link in「taskify assembles selector → execute writes attribute」
- **Smoke selector self-heal hint**: failed scenarios scan the page's real data-testid list while the page is still usable (`SmokeResult.domTestIds`, silently skipped when the page is gone); runSmokeTest aggregates a「selector self-heal hint」listing actual testids for fixing VERIFY_SPEC placeholder selectors — config is never auto-rewritten (avoids runtime misjudgment)

### Verification
- Six-branch naming verification (all-English / pinyin fallback / double pinyin / dedupe / no-module degradation / feature unaffected); build + 285 tests green

## v8.3.293 (2026-09-29) — Smoke assembly chain: three broken links fixed (element list extraction + flow scenario assembly + no-source Spec channel)

### New
- **UI_SPEC element list extraction `extractElementTestIds`**: supports three syntaxes (Markdown table with testid column on either side / inline enumeration / code attributes); template placeholders (btn-edit-{id}) auto-skipped; page containers (xxx-page) collected separately into pageTestIds
- **Flow scenario assembly `generateFlowScenariosFromSpec` (rewritten)**: three channels — ① plain flow arrow lines (A → B step chains) ② mermaid stateDiagram transitions (incl. `[*]` initial pseudo-state and self-loop skip) ③ descriptive arrows never mis-collected; section regex accepts Chinese ordinal prefixes (「## 五、交互状态」); matchElement bidirectional containment + token-split matching (「新增/编辑」→「新增按钮」) + shortest-element-name strategy; initial transition preferPage fallback asserts the page container
- **No-source Spec channel `generateSpecFromUiSpec`**: taskify with no source code extracts the element list + business flows from UI_SPEC/TEST and generates VERIFY_SPEC flow scenario skeletons — closing the「analysis-stage element convention → smoke config auto-assembly」loop

### Fixes
- **Root cause of zero flow scenarios**: admin-web-04 UI_SPEC interaction flows live in mermaid stateDiagram blocks under a Chinese-ordinal section header, which the old extractor never recognized — after the rewrite: 8 scenarios with 3 real assemblies (users-page/btn-add-user/dialog-disable)

### Verification
- Three-channel verification (stateDiagram assembly / plain flow lines / h5 descriptive arrows zero false-positive); build + 285 tests green

## v8.3.292 (2026-09-29) — Git config fix + Plan A logical grouping view

### Fixes
- **extractValue line-start anchoring**: regex now anchored with `^` + m flag — 「前缀」no longer misreads the「分支前缀: xxx」line; invalid placeholder values filtered
- **lifecycle board multi-root scan**: collectTasks previously only scanned the 030-tasks root level, missing the 030-tasks/{type}/ (feature/bugfix/refactor) layout — added multi-root scanning

### Enhancements
- **status --group-by feature logical grouping**: groups the task list by `.meta/feature` (module stats + module list two-panel view); `--type bugfix` auto-enables the grouped view; physical flat layout untouched (preserves the CLI's multi-consumer fixed-level scan contract)
- **verify findTaskDir layout compat**: supports both 030-tasks/{type}/ and root-level Task-* layouts

### Verification
- git fixture parse verified; meeting-system status --group-by feature rendered correctly; build + 285 tests green

## v8.3.291 (2026-09-29) — Task dependency chain fixed end-to-end: AI dependency analysis is no longer dropped; plan topology & branch merge finally have real data

### Fixes
- **taskify dropped the `dependencies` field (core bug)**: the AI-returned `dependencies` array was only used for log display, never written to `section._dependsOn` — so TASK.md「依赖任务」was always「无」and plan topology / execute dependency branch merging always got an empty array. Fix: pre-assign task IDs + build an「AI temp id → real taskId」mapping + resolve and write `_dependsOn`; unmappable references keep the original value (execute stage reports a hint)
- **scanTasks hardcoded empty dependencies**: three `dependencies: []` in state.ts never read TASK.md — added `parseDepsFromTaskMd` to parse the「依赖任务」field (both `- **依赖任务**: Task-xxx` and `| 依赖任务 | Task-xxx |` formats, comma/顿号 separated, deduped, non-Task noise filtered), subtask parse failure falls back to parent task
- **findBranchByTaskId parent-ID prefix fallback**: dependencies reference the parent task ID (e.g. Task-002-f1-booking) while git-mapping matches the subtask ID (Task-002-f1-booking-booking-service) — added `info.taskId.startsWith(taskId + '-')` fallback so cross-repo branch lookup no longer misses
- **--help/--version exit code**: exitOverride's commander.helpDisplayed/commander.version exceptions fell through to the default exit 1 (output was fine, but scripts/pipes saw failure) — added early exit 0 for both codes

### Enhancements
- **IMPACT.md「任务声明」dependency rows**: authoritative `_dependsOn` dependencies are listed first (type column marked「任务声明」), coexisting with API-text matching / semantic inference layers
- **Task summary dependency column**: TASK_SUMMARY now reads from resolved `_dependsOn` (previously the raw AI dependencies array, whose IDs didn't match what was persisted)
- **Platform-level analysis templates now require diagrams**: Phase 2 TECH.md skeleton「writing requirements」adds backend「core API sequence diagram or data model ER diagram (Mermaid sequenceDiagram/erDiagram)」and frontend「page route topology (Mermaid graph)」; UI_SPEC.md adds「core page interaction state diagram (Mermaid stateDiagram-v2, covering four states)」; QUALITY_RUBRICS 'UI_SPEC.md' checklist adds the diagram check — fixes functional-unit analysis docs having almost no diagrams (measured 5.4% mermaid coverage in the meeting project)

### Verification
- 285 tests green (7 new state-deps.test.ts cases: two formats / multiple separators / no deps / noise filtering / dedup)
- /tmp project end-to-end: taskify resolved 2 dependencies → TASK.md「依赖任务: Task-002-f1-booking」→ scanTasks read back `["Task-002-f1-booking"]` → plan topology correct (backend Phase 1, two frontends in parallel Phase 2) + Mermaid dependency graph renders correctly

## v8.3.290 (2026-09-28) — Smart resume for bare `run` + syntax sugar: high-frequency ops no longer depend on the ask engine

### New
- **bare `run` = smart resume**: with no args, detect breakpoints via milestone artifacts (9 milestones: import / unitize / analyze / audit / taskify / plan / execute / verify / deploy; predicates reuse PRECONDITIONS and existing analyze detectors), print a「Smart Resume Detection」panel (✅ done / 🔄 partial / ⬜ pending + artifact evidence)
- **Four state branches**: no requirement docs → [SPECCORE_RESUME] panel soft-stop (exit 10) asking the user to pick a requirement entry (import PRD / one-liner); fresh with docs → auto continue split-units → pipeline without asking; partially done → panel soft-stop asking「①continue from breakpoint ②re-unitize ③custom range」(② omitted when breakpoint is split-units); all done → point to wrap-up (run deliver / run docs)
- **hasRequirementDocs promoted to module level**: moved out of the autoPipeline closure (parameterized iterDir), shared by PRECONDITIONS and smart-resume detection
- **run positional grammar (sugar)**: `run <preset>` calls the named pipeline (incl. custom pipelines.custom, takes priority over same-named stage aliases); `run <stage/alias>` single-stage shortcut (continue from that stage to deploy verify, e.g. `run smoke` / `run split`); `run <from> to <to>` / `run <from>..<to>` stage ranges (parsed only when the first token hits a stage/alias, so one-liners like "fix login to support OTP" are not misread); `run <one-liner>` requirement entry; `--demand` escape hatch (explicit when the requirement text is a reserved word)
- **stage alias table as single source of truth**: new src/core/stage-aliases.ts (STAGE_ALIASES + resolveStageToken + parseRunRange + formatStageAliases + validateStageAliases startup self-check); aliases split→split-units, smoke→verify, deploy→pipeline, code→execute, tasks→taskify, ship→pr, archive→done, docs→spec2doc, import→doc2spec, req→req-doc; range parse failure (first token hits but last doesn't) errors with the alias table instead of silently falling back to a one-liner
- **analyze -g/--global**: sugar ≡ speccore global analyze (Layer 1→4 auto-advance)
- **unitize/doc2spec file positional args**: `unitize 需求.md` / `doc2spec PRD.docx` (--file kept for compatibility)
- **verify positional args**: `verify dev|pr|deploy|release` calls the test stage directly (≡ --stage, invalid values error)

### Docs
- spec-run SKILL.md + 6 agent command copies (.claude/.codebuddy/.cursor/.trae/.trae-cn/.windsurf) synced with the「smart resume + positional grammar」playbook: [SPECCORE_RESUME] panel → host AI asks the user via AskUserQuestion → runs the panel's command after user choice; must not auto-resume without confirmation; run grammar forms map to commands directly, not through ask
- `run --help` shows the grammar tree and alias table
- DESIGN.md new appendix「v8.3.290+ run smart resume & syntax sugar design」; README.md core pipeline section; docs/command-reference.md run section; AGENTS.md quick commands; help command run detail; HTML templates regenerated

### Verification
- 278 tests green; end-to-end: meeting project Iteration-014 (partial, features missing) panel honestly marked split-units breakpoint + exit 10; /tmp empty iteration no docs → requirement entry panel; /tmp fresh with docs → auto continue split-units → pipeline; /tmp fully-built iteration → 9/9 ✅ + 🎉 wrap-up pointer + exit 0; 12 run grammar forms tested one by one

---

## v8.3.193 (2026-09-19) — Full rename: iteration taskify

### Command rename
- `iteration split` fully renamed to `iteration taskify` (no transitional alias)
- Synced across: run.ts pipeline cmd/execSync, intent recognition id, ask KB, help/error-diagnosis/doctor/init hints, docs (9 `speccore split` → `speccore iteration taskify`)
- ask now distinguishes: "拆分任务" → `iteration taskify`; "从拆分到开发" → `run --from taskify`; "从切分功能单元到开发" → `run --from split-units`

### Repo sync
- Added GitHub remote `github` (windfallsheng/SpecCore.git), dual-remote sync with gitee

---

## v8.3.191 (2026-09-19) — ask Pipeline Orchestration + Naming Fix + Platform Type Unification

### ask natural-language pipeline orchestration
- run pipeline intent: recognizes preset names + start/end ranges ("from X to Y")
- colloquial stage normalization: 部署→pipeline, 提交→pr, 切分功能单元→split-units, 拆分/任务化→taskify
- run intent with preset/range gets priority (runForced skips ambiguity detection)
- new spec preset (doc2spec→taskify, import requirements → taskify to generate Spec)

### Naming fix: task split renamed split → taskify
- 「切分功能单元」(split-units) and 「拆分任务」(split) were confusing; task split stage key renamed to taskify
- command iteration split kept (alias taskify added); pipeline key/ask normalization/handoff/gate/preset all use taskify

### Platform type unification
- new resolvePlatformType unified entry: PROJECT.yaml type > CONSTITUTION.md platform list > directory-name regex fallback
- removes scattered hardcoded regex detection and inconsistent two-layer detection

### Split vs clarify responsibility separation
- split-units becomes an independent pipeline step; clarify is pure (req-doc no longer splits)

### Command audit & docs polish
- 3 overlapping command groups annotated with hierarchy
- help home highlights 10 core commands, de-emphasizes total count
- README/docs fixed outdated command counts (26+/20) and dev command remnants
- HTML templates cleaned (6 dead templates)
- config-reference added optional_steps tri-state + pipelines named pipelines
- analyze --from-code exposes --out-dir for custom reverse-requirement output dir

## v8.3.190 (2026-09-19) — Clarify Tri-state + Named Pipelines + js-yaml

### Clarify semantics refactor & tri-state switch

- **clarify renamed to req-doc**: clarify semantics reassigned, removing the "clarify = requirement documentation" ambiguity
- **Clarify tri-state switch**: `optional_steps.clarify` supports `auto` (professional-level detection) / `on` (force) / `off` (skip)
- **Three-layer override**: command flag (`--clarify`/`--skip-clarify`) > ask intent > config `optional_steps` > default `auto`
- **Quality report decoupling**: 7-dimension review (`assessRequirementQuality`) generates `QUALITY_REPORT.md` regardless of clarify mode — skipped clarify still leaves a report

### Pipeline refactor & named pipelines

- **dev split into run + next**: `run` = sole execution entry, `next` = progress guidance
- **Named pipeline system**: `init` removed from pipeline; built-in presets (`full`/`import`/`analyze`/`develop`/`deliver`/`deploy`/`docs`); user custom + default (`settings.pipelines`)
- **Default pipeline narrowed**: `pr`/`done`/`spec2doc` are standalone closing ops; default `develop` (analyze→verify)
- **plan single-task skip**: Task ≤ 1 skips plan, multiple tasks trigger planning
- **optional_steps extended**: clarify/verify/pipeline/pr/done/spec2doc six optional steps configurable

### Config parsing fix

- **parseYaml switched to js-yaml**: root-fixes "read-back asymmetry" — flow arrays, list placeholder `- # comment`, empty array `[]` resolved at once (js-yaml for read, handwritten for write to preserve comments)

### Intent recognition & subagent fixes

- Composite intent "analyze + split" now correctly enters pipeline orchestration
- Platform/feature-level subagent mapping gap fixed (`requirement-analyzer-admin-web` normalized mapping)
- req-doc subagent dispatch added

## v8.3.188 (2026-09-19) — Config Upgrade Pipeline Fixes & Diagnostics

### Config upgrade pipeline fixes (5 defects)

- **`detectConfigDiffFromFile`**: reads the on-disk raw YAML to detect missing fields (deep-merge autofill in `loadConfigWithMeta` masked missing fields, so `detectConfigDiff` never saw them)
- **`upgradeConfig`/`upgradeProjectConfig` early-return fix**: no longer return early on schema_version match + empty warnings; now keyed on fileDiff so same-version missing fields get backfilled
- **toYaml array serialization switched to block style**: the flow style `['desktop']` is not recognized by the custom parseYaml, round-tripping to a string and crashing `devices.map`; added `normalizeStringArray` to tolerate legacy dirty data
- **toYaml `pipeline`/`with_code` indentation fix**: were 4-space (nested under `review`), corrected to 2-space
- **toYaml `schema_version` uncommented**: was commented out, causing validateConfig to keep reporting "must be a number"

### Diagnostics

- **`doctor` spec-database consistency check**: upgraded from "directory existence only" to "compare against built-in defaults list", surfacing missing built-in files (e.g. new agents / `_INDEX`) with backfill suggestions
- **`update` stale-CLI warning**: warns when project init version > current CLI version, suggesting a CLI upgrade first

## v8.3.187 (2026-09-19) — Honesty Degradation System & Engineering Hardening

### Universal behavior rules refined (4 → 7)

- **`prompt-builder.ts` extracted `UNIVERSAL_BEHAVIOR_RULES` constant**: expanded from 4 to 7 rules, incorporating industry best practices
  - Added "read before write", "minimal changes", "proactive clarification", "confirm destructive operations"
  - Merged "don't pretend certainty" into "degrade to honesty", upgraded to "fact / inference / guess" confidence tiers
  - Basis: Claude Code official system prompt, Anthropic Prompt Library, Karpathy's 12 rules

### Dead code cleanup

- Removed 8 zero-reference command files (2009 lines): backup/context/current/global-status/health/import/lifecycle/status
- Removed `understandIntent` + `synthesizeIntent` dead code (321 lines; askEngine is the real ask entry point)

### Feature wiring (orphan A-class modules)

- **`refresh` wired `detectStaleGlobalDocs`**: detects stale global docs after refresh (≥1 day), prompts incremental rebuild
- **`search --global` wired `searchGlobalKnowledge`**: global-layer RAG + knowledge-graph semantic retrieval, distinct from keyword search
- **`dev` wired `generateHandoff`**: generates stage handoff summaries after key pipeline stages (13→6 stage mapping)

### Bug fixes (verified on meeting-system)

- **`config --project` option missing**: added to cli.ts, fixes doctor-suggested upgrade command reporting unknown option
- **`detectConfigDiff` open-dict misjudgment**: Record fields like `git.branch_types` no longer flag user-defined keys as removed
- **`detectStaleGlobalDocs` "0 days stale" noise**: only reports docs stale ≥1 day
- **Version comparison false positive**: about/update now use semver comparison, no longer report older versions as "new"

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

