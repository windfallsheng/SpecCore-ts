# SpecCore File Safety Guide

> Which files are safe to edit manually? Which require CLI commands?

---

## ✅ Safe Zone — Edit Directly

These are "descriptive text" files. CLI won't overwrite them.

| File | Content | After Edit |
| :--- | :--- | :--- |
| `REQ.md` | Requirements, background, business rules | `speccore sync --reverse --task=xxx` to sync to DB |
| `TECH.md` | Technical design, architecture | Edit directly — no sync needed |
| `GLOSSARY.md` | Terminology definitions | `speccore sync --reverse` to update index |
| `*.md` comments | Notes, TODOs | Safe, no impact on workflows |

---

## ❌ Danger Zone — Use CLI Commands

These are "metadata/state/relationships." Manual edits get overwritten or cause parse failures.

| File | Consequence of Manual Edit | Correct Way |
| :--- | :--- | :--- |
| `PROJECT_GRAPH.md` tables | CLI overwrites on next plan/execute | `speccore plan --assignee=John` |
| `.task-type` | Wrong type breaks lifecycle | `speccore new-task --type=feature` |
| `API_CONTRACT.yaml` | Indentation error → validation failure | Edit then `speccore validate` |
| `.speccore/data/*.json` | Typo in enum → ZodError crash | `speccore change Task-001 "desc"` |

---

## ⚠️ Caution Zone — Sync Immediately After Edit

| File | Correct Workflow |
| :--- | :--- |
| `GLOBAL/REQUIREMENT.md` | Edit → `speccore sync-global` |
| `CHANGELOG.md` | Prefer `speccore change` auto-append |

---

## Quick Decision Table

| Category | Rule | Action |
| :--- | :--- | :--- |
| ✅ Safe | Human-readable text — descriptions, notes, guides | Edit directly, then `speccore sync --reverse` |
| ❌ Danger | Machine-readable structure — YAML, JSON, table status columns | Use `speccore` commands |
| ⚠️ Caution | Global docs, indexes | Edit then immediately `speccore sync-global` |

---

## Reference

| Task | Right Way | Wrong Way |
| :--- | :--- | :--- |
| Edit requirement text | Open `REQ.md`, then `speccore sync --reverse` | Edit .json directly |
| Mark task as "completed" | `speccore change Task-001 "done"` | Edit PROJECT_GRAPH.md table |
| Add API endpoint | Edit `API_CONTRACT.yaml`, then `speccore validate` | Commit without validation |
| Change assignee | `speccore plan --assignee=John` | Edit PROJECT_GRAPH.md table |
| Add global requirement | Edit `GLOBAL/REQUIREMENT.md`, then `speccore sync-global` | Edit without sync |
| Edit tech approach | Edit `TECH.md` directly | — |

---

**Core philosophy: Edit text freely for speed; use commands for structure safety.**
