# SpecCore — Command Reference

> ⚠️ **This page is a legacy quick reference (v6.16.0 era).** For the complete, up-to-date command reference, see the Chinese [command-reference.md](command-reference.md) or run `speccore help` (22 core commands) / `speccore help --all` (full list).

> 🔧 Legacy quick commands · v6.16.0 · See [README](../README.en.md)

---

## 💡 Two Ways to Use

Same command, different syntax depending on context. Full classification by category:

### 📋 Common Commands (CLI + AI Chat)

| Feature | 🖥 Terminal CLI | 💬 AI IDE (`@spec-ask`) | Type |
|:---|:---|:---|:---|
| Init | `speccore init` | `/spec-init` | ✅ CLI |
| Import | — | `@spec-ask "import PRD.docx"` | 🔒 AI |
| Split | `speccore iteration taskify -i Q1` | `@spec-ask "taskify Q1"` | 🔒 AI |
| Execute | — | `@spec-ask "execute Task-001"` | 🔒 AI |
| PR | — | `@spec-ask "create PR for Task-001"` | 🔒 AI |
| Done | — | `@spec-ask "archive Task-001"` | 🔒 AI |
| Status | `speccore dashboard` | `/spec-dashboard` | ✅ CLI |
| Change | — | `@spec-ask "change desc for Task-001"` | 🔒 AI |
| Bugfix | `speccore task new -n "name" --type=bugfix` | `/spec-task-create` | ✅ CLI |
| Analyze | — | `@spec-ask "analyze Q1"` | 🔒 AI |
| Plan | — | `@spec-ask "plan Q1"` | 🔒 AI |
| Task new | `speccore task new -n name` | `/spec-task-create` | ✅ CLI |
| Validate | `speccore validate -i Q1` | `/spec-validate Q1` | ✅ CLI |
| Smart entry | — | `@spec-ask "query"` | 🔒 AI |
| Dev | — | `@spec-ask "全自动执行"` | 🔒 AI |
| Rename | `speccore rename --task=ID --name=new` | `/spec-rename` | ✅ CLI |

### 🖥 CLI Only (complex parameters)

| Command | Why |
|:---|:---|
| `execute --verify` | Combined flags (AI-only feature) |
| `dashboard --export --assignee` | Export/filter params |
| `run --preset develop --from=split-units` | Automation pipeline (AI-only) |
| `task new --batch-file --type=bugfix --schedule` | Bulk + scheduling |

### 💬 AI Chat Only (needs AI context)

| Method | Why |
|:---|:---|
| Natural language: "Create a login feature" | AI auto-matches |
| `/spec-analyze` → deep code analysis | Needs AI understanding |
| `/spec-import-analyze` → reverse engineering | Pure AI behavior |

> **Why?** CLI = precision + scripting. AI Chat = natural language + context.
> **Legend**: 🔒 = AI command (requires AI IDE), ✅ = CLI command (works in terminal)

---

## 🧠 Smart Entry

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore ask "<query>"` | — | Natural language intent routing | `"<query>"` |

```bash
speccore ask "create user login feature"
```

---

## 🌐 Init & Import

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore init` | `in` | Initialize SpecCore project | `--update` `--force` `--interactive` |
| `speccore doc2spec` 🔒 | `d2s` | Convert Word (.docx/.doc) → SpecCore Markdown | `--file <path>` `--iteration <name>` `--platform <name>` |

```bash
speccore init
speccore init --force
```

> 💡 After init, a setup guide page is auto-generated at `outputs/speccore-setup-guide.html` with 6-step onboarding (Tech Constitution → Team Config → Create Iteration → Import Requirements → Knowledge Base → Start Development). Open it in browser anytime.

---

## 📋 Iteration Management

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore iteration create` | `it cr` | Create iteration | `--name <name>` `--goal <goal>` |
| `speccore iteration taskify` | `it tf` | Split requirements into tasks | `--iteration <name>` `--dry-run` |
| `speccore iteration-from-global` | `ifg` | Generate iteration from global layer | `--reqs <ids>` `--name <name>` `--project <name>` |

```bash
speccore iteration create --name="2026-07-Meeting" --goal="Meeting booking"
speccore iteration taskify --iteration=2026-07-Meeting --dry-run
speccore iteration-from-global --reqs=REQ-001,REQ-002 --name=2026-07-Meeting
```

---

## 📱 Task Management

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore task new` | `nt` | Create multi-platform task | `--name <name>` `--type <type>` `--platforms <list>` `--backend-only` `--iteration <name>` |
| `speccore task new` | — | Create traditional single task | `--name <name>` `--type <type>` `--desc <desc>` `--iteration <name>` |

```bash
speccore task new --name="User Login" --platforms=web,h5 --type=feature
speccore task new --name="API Endpoint" --backend-only --iteration=2026-07-Meeting
speccore task new --name="Data Export" --type=feature --desc="Excel export"
```

---

## ⚡ Execution & Scheduling 🔒 AI Commands

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore plan` 🔒 | `pl` | Smart scheduling (DAG) | `--iteration <name>` |
| `speccore execute` 🔒 | `ex` | Execute development tasks | `--all` `--task <id>` `--batch-size=<n>` `--resume` `--dry-run` `--force` `--interactive` `--platform <name>` `--iteration <name>` |

```bash
speccore plan --iteration=2026-07-Meeting
speccore execute --task=Task-001 --force
speccore execute --all --batch-size=3 --force      # Batch execution
speccore execute --all --dry-run                    # Preview
speccore execute --resume                           # Resume from interruption
speccore execute --all --interactive                # Interactive selection
```

---

---

## 🔄 Change & Sync 🔒 AI Commands

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore change` 🔒 | `cg` | Requirement change propagation | `--req <id>` `--desc <text>` `--task <id>` |
| `speccore sync` | `sy` | Code ↔ Spec bidirectional sync | `--task <id>` `--iteration <name>` `--dry-run` `--auto` |
| `speccore sync --global` | `sg` | Iteration ↔ Global layer sync | `--iteration <name>` |

```bash
speccore change --req=REQ-001 --desc="Add multi-device login"
speccore sync --dry-run                              # Preview @spec references
speccore sync                                         # Scan code → update TASK.md
speccore sync --global --iteration=2026-07-Meeting
```

---

## ✅ Validate & Review

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore validate` | `rv` | Compliance check | `--task <id>` `--iteration <name>` `--fix` `--format <json>` |
| `speccore status` | `st` | Status dashboard | `--iteration <name>` |
| `speccore dashboard` | `db` | IDE-style dashboard (HTML export) | `--export <md\|html>` |
| `speccore progress` | `pg` | Progress overview | `--iteration <name>` |

```bash
speccore validate --task=Task-001
speccore validate --fix --format=json
speccore status --iteration=2026-07-Meeting
speccore dashboard
speccore progress
```

---

## 🔬 Analysis 🔒 AI Commands

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore analyze` 🔒 | `al` | AI-enhanced analysis: reqs + code + AI context | `-I, --iteration <name>` `-t, --task <id>` `--scope <global\|iteration\|task>` `--src <dirs>` `--req <files>` `-o, --output <file>` `--depth <quick\|normal\|deep>` `--auto` `--platform <platform>` `--interactive` |

```bash
# AI-enhanced analysis — three scopes (default: reads 00-产品需求/)
speccore analyze --scope global --depth deep
speccore analyze -I Q1                                    # Reads 00-产品需求/, outputs to 00-需求文档/
speccore analyze -I Q1 --src backend/src                  # Combined req+code (explicit --src)
speccore analyze --src backend,frontend --req docs/a.md,docs/b.md --scope global

# AI smart split — ANALYSIS.md check + granularity + staffing
speccore iteration taskify -i Q1                            # Auto (reads STAFFING.md, recommends granularity)
speccore iteration taskify -i Q1 -g macro                   # Coarse granularity (1-2 weeks/task)
speccore iteration taskify -i Q1 -g atomic                  # Fine granularity (1-3 days/task)
speccore iteration taskify -i Q1 --force                    # Force re-split (cleans old tasks)

# Execute — auto branch + dependency-aware
speccore execute -i Q1 --all                              # From CONSTITUTION default branch
speccore execute --task Task-001 --base develop             # Explicit base branch
```

---

## 🎯 Scenario Commands

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore task new` | — | Full requirement delivery | `--name <name>` `--desc <text>` `--iteration <name>` |
| `speccore task new` | — | Quick bug fix | `--name <text>` `--desc <text>` `--iteration <name>` `--type=bugfix` |
| `speccore retro` 🔒 | `rt` | Iteration retrospective | `--iteration <name>` |
| `speccore rename` | `rn` | Rename iteration/task | `--target <old>` `--new-name <new>` `--batch` `--pattern <p>` `--replacement <r>` |
| `speccore context` | `ctx` | View task context | `--task <id>` |

```bash
speccore task new --name="Payment Module" --desc="WeChat Pay integration"
speccore task new --name="Login timeout" --desc="Fix token expiry" --type=bugfix
speccore retro --iteration=2026-07-Meeting
speccore rename --target=Task-001 --new-name=Task-001-user-auth
speccore context --task=Task-001
```

---

## 🛠️ Utility Commands

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore done` 🔒 | `ar` | Complete/archive tasks | `--all` `--task <id>` `--iteration <name>` |
| `speccore config` | `cf` | Config management | `--set <key=value>` `--get <key>` |
| `speccore help` | `hp` | Categorized command help | `--category <name>` |
| `speccore welcome` | `wc` | First-use interactive guide | — |
| `speccore search` | `sh` | Search across all Spec files | `<query>` `--task=<id>` `--iteration=<name>` |
| `speccore delete` | `dl` | Delete task/iteration (trash + auto-clean) | `--task=<id>` `--iteration=<name>` `--force` |

```bash
speccore done --task=Task-001
speccore done --all --iteration=2026-07-Meeting
speccore config --set platforms=web,h5
speccore config --get platforms
speccore help --category=execute
speccore welcome
speccore delete --task=Task-005           # Delete task
speccore delete --iteration=2026-07-Sprint --force  # Delete iteration
```

---

## 🆕 v5.22.x

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore update` | `up` | Update task attributes | `--task=<id>` `--status=<s>` `--priority=<p>` `--assignee=<n>` |
| `speccore completion` | `cm` | Generate shell completion | `[bash\|zsh]` |

```bash
# update
speccore update --task=Task-001 --status=completed
speccore update --task=Task-001 --priority=high --assignee=Zhang San


# completion
speccore completion bash > /usr/local/etc/bash_completion.d/speccore




```

---

## Alias Reference

| Alias | Command | Alias | Command |
| :--- | :--- | :--- | :--- |
| `in` | init | `ex` | execute |
| `al` | analyze | `pl` | plan |
| `tn` | task new | `cg` | change |
| `sy` | sync | `sg` | sync --global |
| `ctx` | context | `it cr` | iteration create |
| `it tf` | iteration taskify | `db` | status-panel |
| `ifg` | iteration-from-global | `pg` | status-panel |
| `st` | status | `rv` | validate |
| `rp` | status-panel --export | `ar` | done |
| `rt` | retro | `rn` | rename |
| `cf` | config | `hp` | help |
| `mg` | migrate | `cm` | completion |
| `up` | update | `dl` | delete |
| `sh` | search | `wc` | welcome |

---

## Intent Mapping (27 types) — Internal Reference

| Priority | Intent | Keywords | Command |
| :---: | :--- | :--- | :--- |
| 100 | change | modify, adjust, change | `speccore change` 🔒 |
| 90 | execute | start, run, execute | `speccore execute` 🔒 |
| 88 | bugfix | bug, fix, error | `speccore task new --type=bugfix` ✅ |
| 85 | create | create, build, implement | `speccore task new` ✅ |
| 85 | init | initialize, setup, create | `speccore init` ✅ |
| 84 | new_task | new task, create task | `speccore task new` ✅ |
| 80 | review | review, check, inspect | `speccore validate` ✅ |
| 80 | iter_from_global | generate from global | `speccore iteration-from-global` ✅ |
| 78 | plan | plan, schedule | `speccore plan` 🔒 |
| 78 | rename | rename | `speccore rename` ✅ |
| 75 | archive | archive | `speccore done` 🔒 |
| 70 | progress | progress | `speccore dashboard` ✅ |
| 70 | sync | sync, align | `speccore sync` ✅ |
| 70 | sync_global | sync to global layer | `speccore sync --global` ✅ |
| 68 | status | status | `speccore status` ✅ |
| 60 | retro | retro, review | `speccore retro` 🔒 |
| 60 | config | config, settings | `speccore config` ✅ |
| 60 | context | context | `speccore context` ✅ |
| 55 | dashboard | dashboard, board | `speccore dashboard` ✅ |
| 50 | help | help, how to | `speccore help` ✅ |
| 40 | welcome | guide, intro | `speccore welcome` ✅ |

---

## 📂 Directory Structure (Internal Reference)

```
speccore init                           → .speccore/CONSTITUTION.md (project path, git URL, default branch) ✅
speccore iteration create -n Q1         → 迭代-Q1/ ✅
                                            ├── STAFFING.md (per-iteration staffing)
                                            ├── 00-迭代总览/PROJECT_GRAPH.md (default branch override)
                                            └── 00-产品需求/ (product requirements, read-only)
# 🔒 AI commands below:
speccore analyze -I Q1                  → 迭代-Q1/00-需求文档/  🔒
                                            ├── ANALYSIS.md (change scope, risk matrix, file impact)
                                            ├── TECH/TEST/REVIEW/RISK/DEPS/MONITOR.md
                                            └── .speccore/prompts/analyze-iteration-Q1.md
speccore iteration taskify -i Q1          → reads ANALYSIS.md + STAFFING.md  🔒
                                            ├── Complexity estimation (API/DB/page counts)
                                            ├── Smart priority (high/medium/low)
                                            ├── Semantic dependency detection
                                            ├── Auto-assign from STAFFING.md
                                            └── .speccore/prompts/split-suggestion-Q1.md
speccore execute -i Q1                  → feature/Task-001 (from iteration→CONSTITUTION→git default branch)  🔒
                                            ├── feature/Task-002 (from feature/Task-001 if dependent)
                                            └── Auto switch back to base between tasks
```
