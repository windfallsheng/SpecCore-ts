# SpecCore — Code by Spec, Not by Vibe

🖥️ Spec-driven development CLI · Requirements to deployment · Environment-driven deploy · Full command Skill coverage · Multi-layer AI architecture

SpecCore drives requirements all the way to deliverable code: import → split into feature units → analyze → taskify → develop → verify → deploy. The whole flow is Spec-driven — AI only steps in where judgment and generation are needed, and critical actions wait for your confirmation.

---

## Quick Start

```bash
npm install -g speccore
speccore init                        # initialize project, generate config guide
```

Four steps through one iteration:

| Step | Command | Description |
|------|---------|-------------|
| ① Import | `speccore doc2spec -f PRD.docx` | Convert source docs to MD, split into feature units |
| ② Analyze | `speccore analyze` | AI generates technical specs |
| ③ Develop | `speccore execute` | Develop code by plan |
| ④ Deliver | `speccore pr` | Summarize changes + commit |

> 💡 **Don't want to memorize?** Use the natural-language entry `speccore ask "build a payment feature"`, and AI orchestrates the pipeline. Or talk to `@spec-ask` in an AI IDE.

---

## Core Pipeline

One `run` command covers the whole flow, using **presets** to start/stop by scenario:

```bash
speccore run --preset develop   # analyze → verify (default)
speccore run --preset spec      # import → taskify (generate Spec to review)
speccore run --preset deploy    # analyze → deploy & verify
speccore run --preset deliver   # execute → submit code
speccore run                    # no args = smart resume (v8.3.290+): detect breakpoints, continue from first unfinished phase
```

### Quick syntax sugar (v8.3.290+, independent of ask engine)

```bash
speccore run develop            # preset by name
speccore run smoke              # single-phase shortcut: verify → deploy (aliases: split/smoke/code/tasks/ship/…)
speccore run split to execute   # range (natural language)
speccore run split..execute     # range (compact)
speccore run "build a points feature"   # one-liner requirement, full flow from demand
speccore analyze -g             # sugar: equals speccore global analyze
speccore unitize prd.md         # file positional arg: equals unitize --file prd.md
speccore verify deploy          # test phase positional arg: equals verify --stage deploy
```

### 8 presets

| preset | range | scenario |
|---|---|---|
| `develop` | analyze → verify | analyze → verify (**default**) |
| `full` | req-doc → spec2doc | full flow (incl. finishing) |
| `import` | doc2spec → pr | import → merge request |
| `spec` | doc2spec → taskify | import → taskify |
| `analyze` | analyze → validate | analyze only |
| `deliver` | execute → pr | execute → submit code |
| `deploy` | analyze → pipeline | analyze → deploy & verify |
| `docs` | analyze → spec2doc | analyze → export docs |

### Precise range control

```bash
speccore run --from split-units --to execute   # from splitting feature units to develop
speccore run --from taskify --to pr            # from taskify to submit
```

### Pipeline stages

```
Requirements entry (pick one)     Structure        Quality (optional)
req-doc ──┐
          ├─→ split-units ──→ clarify (auto/on/off)
doc2spec ─┘                        │
                                   ▼
analyze → validate → taskify → plan → execute → verify
                                                │
               ┌────────────┬──────────┬────────┴─────────┐
               ▼            ▼          ▼                  ▼
           pipeline      pr(submit)  done(archive)    spec2doc(export)
           (deploy)      (independent finishing steps, on demand)
```

**Three gates** (pause for your confirmation in auto mode): Spec finalized → code review → pre-deploy confirm.

### Custom + default pipelines

Define your own named pipelines and set the default in `.speccore.yml`:

```yaml
settings:
  pipelines:
    default: develop
    custom:
      hotfix: execute,verify,pipeline,pr
      quick: analyze,taskify,execute
```

### Configurable steps (tri-state)

Optional steps support `auto / on / off` tri-state — configure defaults, or override per command/natural language:

```yaml
settings:
  optional_steps:
    clarify: auto     # requirement clarification: auto=by professionalism / on=force / off=skip
    verify: auto
    pipeline: auto
    pr: auto
    done: auto
    spec2doc: auto
```

Even when clarification is skipped, a **quality review report** (`010-requirements/QUALITY_REPORT.md`) is still generated, listing issues and concrete fix commands per document.

---

## Common Commands

Can't remember commands? These are the ones that matter:

| Command | Purpose |
|---------|---------|
| `run` | named pipeline entry (preset / range) |
| `ask` | natural-language entry (auto-orchestration) |
| `doc2spec` | import PRD → SpecCore MD |
| `unitize` | split requirement doc → feature units (formerly doc2spec --split) |
| `req-doc` | one-liner requirement → PRD doc |
| `analyze` | AI requirement analysis |
| `taskify` | split requirements into dev tasks |
| `execute` | develop by plan |
| `pr` | summarize changes + commit |
| `spec2doc` | export Word/PDF/HTML |
| `status` | check progress |

> Full list: [Command Reference](docs/command-reference.md), or `speccore help` for categories; every command (including low-frequency/ops/internal) via `speccore help --all`.

---

## Core Capabilities

### 🧠 Natural-language entry

`speccore ask "..."` with four modes: explain / guide / match / orchestrate:

```bash
speccore ask "deploy for me"                    # → run --preset deploy
speccore ask "from analyze to develop"          # → run --from analyze --to execute
```

### ⚡ spec-once single-session end-to-end

One "spec once" phrase packs the whole requirement-to-deploy chain into a single session: entry (feature units / doc path / one-liner) → clarify → analyze → taskify → execute → local smoke → deploy verification. **Dual mode**: interactive by default (pauses at every node); say "full-auto / don't stop" to switch to auto mode (pauses only at three safety points: scope confirmation, quality-gate failure, smoke failure). Unsatisfied with a step? **Roll back and rerun**: re-analyze (`analyze --unit` overwrite + backup), re-taskify (`taskify --modules`), re-execute (`execute` single task), re-unitize (`unitize --on-duplicate`). Best for a few feature units (≤3); larger scope goes through `speccore run`.

### 📊 Dashboard

`speccore dashboard` generates a Jira-standard 7-dimension board.

### 🚀 Environment-driven deploy

`speccore pipeline` with five environment layers (local → dev → test → staging → production):

```bash
speccore pipeline --env staging --all
speccore pipeline --env test --platforms h5,api
```

### 🧪 Quality verification

`speccore verify` layered testing: compile + lint + unit + UI smoke + API contract + performance baseline. Pre-deploy can block; post-deploy only reports.

```bash
speccore verify --stage pr
speccore verify -t Task-001 --ui
```

---

## Core Commands (categorized)

| Category | Commands |
|----------|----------|
| Init / import | `init` `doc2spec` `req-doc` |
| Iteration / task | `iteration` `task` |
| Analyze / plan | `analyze` `plan` |
| Split / export | `unitize` `spec2doc` |
| Execute / deliver | `execute` `verify` `pipeline` `pr` `done` |
| Smart entry | `ask` `run` `next` `dashboard` `status` `about` `help` |

> 🔧 Low-frequency/ops/internal commands (`validate` `change` `sync` and 26 more) stay available but off the panel; see `speccore help --all` for the full list.

---

## Directory Structure

```
Iteration-001-meeting/
├── 000-overview/               ← progress tracking
├── 010-requirements/           ← requirements (by feature)
│   ├── sources/                ← [read-only] original PRD/Word/PDF
│   ├── converted/              ← [auto] doc2spec converted MD
│   ├── features/               ← [manual] split feature units
│   └── QUALITY_REPORT.md       ← [auto] quality review report
├── 020-specs/                  ← analyze output (three-layer)
├── 030-tasks/                  ← taskify dev tasks
└── STAFFING.md                 ← staffing
```

---

## Multi-layer AI Architecture

```
@spec-ask "..."  (AI IDE entry)
  ├─ 🧠 own LLM   → OpenAI / Ollama (SPECCORE_LLM_KEY env)
  ├─ 🤖 host AI   → WorkBuddy / TRAE / Qoder (auto-detect)
  ├─ 📐 rule engine → command KB + predefined workflows (always available)
  └─ 🎭 multi-subagent → per stage/platform/module roles (step isolation)
```

**Zero-config fallback**: no key configured → auto-degrade, features unaffected.

---

## 📖 Documentation

| Doc | Description |
|-----|-------------|
| [Quick Start](docs/quick-start.en.md) | 5 minutes to first task |
| [Commands](docs/command-reference.md) | full command reference (Chinese; run `speccore help` for categorized commands) |
| [Config Reference](docs/config-reference.en.md) | all config fields (incl. pipelines / optional_steps) |
| [Scenarios](docs/scenarios.en.md) | real-world scenarios |
| [SDD](docs/sdd-methodology.en.md) | spec-driven development |
| [Workspace](docs/workspace-organization.en.md) | directory structure |
| [File Editing Guide](docs/usage-guide.en.md) | which files to edit vs. commands |
| [Quick Reference](docs/quick-reference.en.md) | common commands at a glance |
| [Spec Layers](docs/spec-layers.en.md) | GLOBAL/ITERATION/TASK loading |
| [Testing Guide](docs/testing-guide.en.md) | layered testing & quality |
| [CI/CD](docs/ci-cd-spec-integration.en.md) | CI/CD pipeline + @spec annotation |
| [Adapters](docs/tool-adaptation.en.md) | AI tool integration |
| [CHANGELOG](CHANGELOG.en.md) | version history |

---

## License

See the LICENSE file.
