# SpecCore File Safety Guide

> What can I edit manually? What requires a command? What to do after editing?

---

## 1. Three-Layer File Overview

### .speccore/ Layer (Global config, created by `init`)

| File | Source | Editable? | After Editing |
| :--- | :--- | :--- | :--- |
| `CONSTITUTION.md` | init auto-gen | ✅ Yes | Read by next execute |
| `SETTINGS.md` | init auto-gen | ✅ Yes | Read by next execute |
| `POST_COMPLETION.md` | init auto-gen | ✅ Yes | Read by next execute |
| `config/platforms.yaml` | init + platform-add | ⚠️ Use `config --set` | Used by task new |
| `local/context.json` | Command-maintained | ❌ No | Commands overwrite it |
| `local/execution-state.json` | execute generates | ❌ No | Batch resume depends on it |
| `.git-mapping.json` | execute/current writes | ❌ No | Branch mapping depends on it |
| `GLOBAL/INDEX.md` | index-update builds | ❌ Use `index-update` | Manual edits overwritten |
| `GLOBAL/REQUIREMENT.md` | Manual + sync-global | ✅ Yes | Run `sync-global` after |
| `GLOBAL/PROJECTS/<name>/` | import fills | ✅ Edit requirements | Run `sync-global` after |
| `GLOBAL/BASELINES/` | baseline creates | ❌ No | Use baseline commands |

### Iteration Layer (`Sprint-xxx/`, created by iteration commands)

| File | Source | Editable? | After Editing |
| :--- | :--- | :--- | :--- |
| `PROJECT_GRAPH.md` | iteration split generates | ❌ **No** | Use `update` / `plan`; CLI overwrites manual changes |

### Task Layer (`Task-xxx/`, created by task new)

| File | Source | Editable? | After Editing |
| :--- | :--- | :--- | :--- |
| `backend/REQ.md` | task new skeleton | ✅ Write freely | Run `speccore sync` |
| `backend/TECH.md` | task new skeleton | ✅ Write freely | No action needed |
| `backend/TASK.md` | task new + sync fills | ✅ Add details | Run `speccore sync` |
| `_shared/API_CONTRACT.yaml` | task new skeleton | ⚠️ YAML-sensitive | Run `speccore validate` |
| `_shared/TRACE.md` | sync auto-generates | ❌ No | sync overwrites |

---

## 2. Safe Zone — Edit Directly

Descriptive text, not structural data.

| File | Safe Content | Why Safe |
| :--- | :--- | :--- |
| `REQ.md` | Requirements, background, business rules | Read as instructions, not parsed structurally |
| `TECH.md` | Technical design, architecture | Documentation for AI and developers |
| `*.md` comments | Notes, TODOs | No workflow impact |
| `CONSTITUTION.md` | Tech standards, coding rules | Read at execute time |
| `SETTINGS.md` | Framework configuration text | Same as above |

---

## 3. Danger Zone — Use Commands

Metadata, state, and relationships — system dependencies.

| File | Manual Edit Consequence |
| :--- | :--- |
| `PROJECT_GRAPH.md` tables | CLI overwrites on next plan/execute |
| `API_CONTRACT.yaml` | Indentation error → validate fails |
| `*.json` data | Typo in enum → ZodError crash |
| `INDEX.md` | index-update overwrites |
| `TRACE.md` | sync overwrites |

```bash
speccore change --req=REQ-001 --desc="Modify description"
speccore update -t T-001 --status=completed
```

---

## 4. Caution Zone — Sync After Edit

| File | Correct Workflow |
| :--- | :--- |
| `GLOBAL/REQUIREMENT.md` | Edit → `speccore sync-global` |
| `API_CONTRACT.yaml` | Edit → `speccore validate` |
| `config/platforms.yaml` | Use `speccore config --set` or `platform-add` |

---

## 5. Quick Reference

| What You Want | ✅ Right Way | ❌ Wrong Way |
| :--- | :--- | :--- |
| Edit requirements | Edit `REQ.md` → `speccore sync` | Edit .json directly |
| Mark task complete | `speccore update -t T-001 --status=completed` | Edit PROJECT_GRAPH.md |
| Add API endpoint | Edit `API_CONTRACT.yaml` → `speccore validate` | Commit without validation |
| Change assignee | `speccore update -t T-001 --assignee=Zhang` | Edit PROJECT_GRAPH.md |
| Add global req | Edit `GLOBAL/REQUIREMENT.md` → `speccore sync-global` | Edit without syncing |
| Delete task | `speccore delete -t T-001` | rm -rf |
| Rename | `speccore rename --target=old --new-name=new` | mv + edit all refs |

---

## 6. Core Principle

```
Edit text for speed → use commands for safety.
Edit Spec → sync back. Edit YAML → validate.
```

The CLI never prevents manual edits. But it WILL overwrite structural metadata (tables, JSON, YAML) on the next command run. Descriptive text (requirements, design, comments) is always safe.

---

## Related Docs

- [Scenarios](scenarios.en.md) — 30 real-world scenarios
- [Command Reference](commands.en.md) — Full command params
- [Quick Start](quick-start.en.md) — Get started
- [README](../README.en.md) — Project overview
