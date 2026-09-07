# SpecCore v8.3.46 Release Notes

## Overview

This release focuses on **AGENTS.md accuracy and self-healing**: fixing 10 structural inconsistencies between documentation and actual code, adding smart obsolescence detection for `update`, and completing the missing SpecCore output markers reference.

---

## What's New

### AGENTS.md Full Rebuild on Update
- `syncAgentsMd()` now accepts `force` parameter; `speccore update` passes `true`
- Upgrade no longer preserves stale manual section content — entire AGENTS.md is regenerated from latest built-in template
- User custom content in manual section needs manual backup before update

### Smart Obsolescence Detection
- `initRulesDir()` now scans `.speccore/RULES/*.inline.md` files for known outdated markers
- Auto-overwrites templates containing old patterns (10-backend/, src/ in subtasks, execute -I, etc.)
- Projects running `speccore update` will automatically get corrected AGENTS.md structures

### SpecCore Output Markers Completion
- Documented 7 previously missing markers from `ask.ts`: `SPECCORE_CONFIRM`, `SPECCORE_EXEC_STATUS`, `SPECCORE_EXEC_ERROR`, `SPECCORE_CONFIRM_STEP`, `SPECCORE_CONFIRM_ASK`, `SPECCORE_STEP_FAIL`, `SPECCORE_AMBIGUOUS`
- AI assistants can now correctly recognize and handle all ask engine outputs

---

## Fixes

### Project Structure Consistency (10 items)
| Area | Fix |
|:---|:---|
| `000-overview/` | Replaced phantom `PROGRESS.md` with actual files: `PROJECT_GRAPH.md`, `task-summaries/`, `plans/`, `RETRO.md`, `PIPELINE_REPORT.md` |
| `010-requirements/` | Added `assets/` subdirs (prototypes/, designs/, screenshots/), optional dirs (bugs/, refactors/, research/) |
| `020-specs/` | Added `{feature}/{platform}/` hierarchy, `requirements/`, `PLATFORMS.md`, `QUALITY_AUDIT.md` |
| `030-tasks/` | Subtask `.meta/` now includes `estimated-hours`, `feature`; `git-config` moved into `.meta/`; frontend adds `ROUTES.md`, `STATE.md` |
| `00-specs/` | Clarified as "analyze phase output", added `[compat] CONTEXT.md` |
| Title | `## Coding Standards and Rules` → `## Standards and Reference` |
| Templates | `010-requirements/README.md` init template synced with actual structure |

---

## Migration Guide

No breaking changes. Existing projects benefit automatically:

```bash
# Update to get corrected AGENTS.md structure
speccore update

# Or force re-init for full template refresh
speccore init --force
```

---

## Stats

- **4 files changed** (init.ts, AGENTS.md, inline templates, package.json)
- **~60 lines added** across documentation and templates
- **1 new core mechanism** (smart obsolescence detection)

---

## Full Changelog

See [CHANGELOG.md](CHANGELOG.md) and [CHANGELOG.en.md](CHANGELOG.en.md).
