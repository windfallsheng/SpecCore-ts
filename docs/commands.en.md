# SpecCore — Command Reference

> 🔧 Commands: 22 | 🧠 Intent Types: 41 | v6.15.0 | See [README](../README.en.md)

---

## 💡 Two Ways to Use

Same command, different syntax depending on context. Full classification by category:

### 📋 Common Commands (CLI + AI Chat)

| Feature | 🖥 Terminal CLI | 💬 AI IDE (`@spec-ask`) | Type |
|:---|:---|:---|:---|
| Init | `speccore init` | `/spec-init` | ✅ CLI |
| Import | — | `@spec-ask "import PRD.docx"` | 🔒 AI |
| Split | `speccore iteration split -i Q1` | `@spec-ask "split Q1"` | 🔒 AI |
| Execute | — | `@spec-ask "execute Task-001"` | 🔒 AI |
| PR | — | `@spec-ask "create PR for Task-001"` | 🔒 AI |
| Done | — | `@spec-ask "archive Task-001"` | 🔒 AI |
| Status | `speccore dashboard` | `/spec-status-panel` | ✅ CLI |
| Change | — | `@spec-ask "change desc for Task-001"` | 🔒 AI |
| Bugfix | `speccore task new -n "name" --type=bugfix` | `/spec-bugfix` | ✅ CLI |
| Analyze | — | `@spec-ask "analyze Q1"` | 🔒 AI |
| Plan | — | `@spec-ask "plan Q1"` | 🔒 AI |
| Task new | `speccore task new -n name` | `/spec-task-new` | ✅ CLI |
| Validate | `speccore validate -i Q1` | `/spec-validate Q1` | ✅ CLI |
| Smart entry | — | `@spec-ask "query"` | 🔒 AI |
| Dev | — | `@spec-ask "全自动执行"` | 🔒 AI |
| Ops | `speccore ops` | `/spec-ops` | ✅ CLI |
| Rename | `speccore rename --task=ID --name=new` | `/spec-rename` | ✅ CLI |

### 🖥 CLI Only (complex parameters)

| Command | Why |
|:---|:---|
| `execute --verify` | Combined flags (AI-only feature) |
| `dashboard --export --assignee` | Export/filter params |
| `dev --auto --from=split` | Automation pipeline (AI-only) |
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
| `speccore iteration split` | `it sp` | Split requirements into tasks | `--iteration <name>` `--dry-run` |
| `speccore iteration-from-global` | `ifg` | Generate iteration from global layer | `--reqs <ids>` `--name <name>` `--project <name>` |

```bash
speccore iteration create --name="2026-07-Meeting" --goal="Meeting booking"
speccore iteration split --iteration=2026-07-Meeting --dry-run
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

## ⏰ Scheduled Execution

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore schedule create` | — | Create scheduled execution | `--at <datetime>` `--task <id>` `--all` `--iteration <name>` |
| `speccore schedule list` | — | View schedule queue | — |
| `speccore schedule cancel` | — | Cancel a schedule | `--id <sch-id>` |
| `speccore schedule daemon start` | — | Start daemon process | — |
| `speccore schedule daemon status` | — | Check daemon status | — |

```bash
# Method 1: Mark tasks for nightly queue, trigger via AI
speccore task new -n "Fix login timeout" --type=bugfix --schedule=night   # Mark as queue
# 🔒 AI: @spec-ask "run all scheduled tasks"

# Method 2: Precise time scheduling
speccore schedule create --at "2026-08-10 21:00:00" -t Task-001           # Schedule single task
speccore schedule create --at "2026-08-10 02:00:00" --all -i Q1           # Schedule all tasks
speccore schedule list                                                      # View schedule queue
speccore schedule cancel --id=sch-xxx                                       # Cancel
speccore schedule daemon start                                              # Start daemon (auto-execute)
speccore schedule daemon status                                             # Check daemon status
```

| Method | Use Case | Granularity |
|:---|:---|:---|
| `--schedule=night` | Queue during day, batch at night | Manual trigger |
| `schedule create --at` | Precise auto-execution | Second-level (requires daemon) |

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
| `speccore status-panel` | `pg` | Progress overview | `--iteration <name>` `--platform <name>` `--detail` `--format <json>` |
| `speccore status` | `st` | Status dashboard | `--iteration <name>` |
| `speccore health` | `hl` | Project health | `--iteration <name>` |
| `speccore status-panel --export` | `rp` | Generate report | `--iteration <name>` `--format <md\|html\|json>` `--output <path>` `--team` `--risk` |

```bash
speccore validate --task=Task-001
speccore validate --fix --format=json
speccore status-panel --platform=web --detail
speccore status --iteration=2026-07-Meeting
speccore health
speccore status-panel --export --format=html --output=report.html --team --risk
```

---

## 🔬 Analysis & Audit 🔒 AI Commands

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore analyze` 🔒 | `al` | AI-enhanced analysis: reqs + code + AI context | `-I, --iteration <name>` `-t, --task <id>` `--scope <global\|iteration\|task>` `--src <dirs>` `--req <files>` `-o, --output <file>` `--depth <quick\|normal\|deep>` `--auto` `--interactive` |
| `speccore impact` | `if` | Change impact analysis | `--req <id>` `--task <id>` |
| `speccore baseline` | `bl` | Version baseline management | `--name <name>` `--compare <name>` `--restore <name>` `--req <id>` |
| `speccore audit` | `ad` | AI smart audit | `--fix` |

```bash
# AI-enhanced analysis — three scopes (default: reads 00-产品需求/)
speccore analyze --scope global --depth deep
speccore analyze -I Q1                                    # Reads 00-产品需求/, outputs to 00-需求文档/
speccore analyze -I Q1 --src backend/src                  # Combined req+code (explicit --src)
speccore analyze --src backend,frontend --req docs/a.md,docs/b.md --scope global

# AI smart split — ANALYSIS.md check + granularity + staffing
speccore iteration split -i Q1                            # Auto (reads STAFFING.md, recommends granularity)
speccore iteration split -i Q1 -g macro                   # Coarse granularity (1-2 weeks/task)
speccore iteration split -i Q1 -g atomic                  # Fine granularity (1-3 days/task)
speccore iteration split -i Q1 --force                    # Force re-split (cleans old tasks)

# Execute — auto branch + dependency-aware
speccore execute -i Q1 --all                              # From CONSTITUTION default branch
speccore execute --task Task-001 --base develop             # Explicit base branch

speccore impact --req=REQ-001
speccore baseline --name=v1.0
speccore audit --fix
```

---

## 🌐 Global Layer

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore global-status` | `gs` | Global layer status overview | — |
| `speccore ops` | `hs` | Requirement change history | `--req <id>` `--iteration <name>` |

```bash
speccore global-status
speccore ops --req=REQ-001
```

---

## 🎯 Scenario Commands

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore task new` | — | Full requirement delivery | `--name <name>` `--desc <text>` `--iteration <name>` |
| `speccore task new` | — | Quick bug fix | `--name <text>` `--desc <text>` `--iteration <name>` `--type=bugfix` |
| `speccore research` | `rs` | Technology research | `--topic <text>` `--options <list>` |
| `speccore handover` | `ho` | Generate handover doc | `--iteration <name>` |
| `speccore retro` 🔒 | `rt` | Iteration retrospective | `--iteration <name>` |
| `speccore rename` | `rn` | Rename iteration/task | `--target <old>` `--new-name <new>` `--batch` `--pattern <p>` `--replacement <r>` |
| `speccore platform-add` | `padd` | Add dynamic platform | `--name <id>` `--description <text>` `--tech <stack>` |
| `speccore context` | `ctx` | View task context | `--task <id>` |

```bash
speccore task new --name="Payment Module" --desc="WeChat Pay integration"
speccore task new --name="Login timeout" --desc="Fix token expiry" --type=bugfix
speccore research --topic="Message queue comparison" --options="Kafka,RabbitMQ"
speccore handover --iteration=2026-07-Meeting
speccore retro --iteration=2026-07-Meeting
speccore rename --target=Task-001 --new-name=Task-001-user-auth
speccore platform-add --name=tablet --tech="React Native" --description="Tablet UI"
speccore context --task=Task-001
```

---

## 🛠️ Utility Commands

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore template-add` | `ta` | Add code template | `--name <name>` `--type <type>` `--files <files>` |
| `speccore done` 🔒 | `ar` | Complete/archive tasks | `--all` `--task <id>` `--iteration <name>` |
| `speccore config` | `cf` | Config management | `--set <key=value>` `--get <key>` |
| `speccore help` | `hp` | Categorized command help | `--category <name>` |
| `speccore welcome` | `wc` | First-use interactive guide | — |
| `speccore search` | `sh` | Search across all Spec files | `<query>` `--task=<id>` `--iteration=<name>` |
| `speccore watch` | `wch` | Watch files + auto-validate on save | `--task=<id>` `--iteration=<name>` |
| `speccore delete` | `dl` | Delete task/iteration (trash + auto-clean) | `--task=<id>` `--iteration=<name>` `--force` |

```bash
speccore template-add --name="crud" --type=backend --files="./templates/*"
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
| `speccore config` | `hk` | Install Git hooks | — |
| `speccore diff` | `df` | Compare iterations/baselines | `--source=<name>` `--target=<name>` |
| `speccore trace` | `tr` | REQ→Task→Code trace chain | `--req=<id>` `--task=<id>` `--full` |

```bash
# update
speccore update --task=Task-001 --status=completed
speccore update --task=Task-001 --priority=high --assignee=Zhang San

# backup

# completion
speccore completion bash > /usr/local/etc/bash_completion.d/speccore

# hooks
speccore config install

# current

# diff
speccore diff --source=2026-07-Meeting --target=2026-08-Meeting

# trace
speccore trace --req=REQ-001
speccore trace --task=Task-001
speccore trace --full
```

---

## Alias Reference

| Alias | Command | Alias | Command |
| :--- | :--- | :--- | :--- |
| `in` | init | `ex` | execute |
| `al` | analyze | `pl` | plan |
| `tn` | task new | `cg` | change |
| `padd` | platform-add | `sy` | sync |
| `ctx` | context | `sg` | sync --global |
| `iu` | index-update | `if` | impact |
| `it cr` | iteration create | `bl` | baseline |
| `it sp` | iteration split | `db` | status-panel |
| `ifg` | iteration-from-global | `ad` | audit |
| `gs` | global-status | `hs` | ops |
| `pg` | status-panel | `st` | status |
| `hl` | health | `rp` | status-panel --export |
| `rv` | validate | `ar` | done |
| `rs` | research | `ho` | handover |
| `rt` | retro | `rn` | rename |
| `ta` | template-add | `cf` | config |
| `hp` | help | `dm` | demo |
| `mg` | migrate | `bk` | backup |
| `cm` | completion | `hk` | hooks |
| `cr` | current | `df` | diff |
| `tr` | trace | `up` | update |
| `dl` | delete | `sh` | search |
| `wc` | welcome | `wch` | watch |

---

## Intent Mapping (36 types) — Internal Reference

| Priority | Intent | Keywords | Command |
| :---: | :--- | :--- | :--- |
| 100 | change | modify, adjust, change | `speccore change` 🔒 |
| 90 | execute | start, run, execute | `speccore execute` 🔒 |
| 88 | bugfix | bug, fix, error | `speccore task new --type=bugfix` ✅ |
| 85 | create | create, build, implement | `speccore task new` ✅ |
| 85 | init | initialize, setup, create | `speccore init` ✅ |
| 84 | new_task | new task, create task | `speccore task new` ✅ |
| 80 | review | review, check, inspect | `speccore validate` ✅ |
| 80 | research | research, evaluate | `speccore research` ✅ |
| 80 | iter_from_global | generate from global | `speccore iteration-from-global` ✅ |
| 80 | impact | impact, dependency | `speccore impact` ✅ |
| 78 | plan | plan, schedule | `speccore plan` 🔒 |
| 78 | rename | rename | `speccore rename` ✅ |
| 75 | archive | archive | `speccore done` 🔒 |
| 70 | progress | progress | `speccore dashboard` ✅ |
| 70 | sync | sync, align | `speccore sync` ✅ |
| 70 | sync_global | sync to global layer | `speccore sync --global` ✅ |
| 68 | status | status | `speccore status` ✅ |
| 65 | health | health, quality | `speccore health` ✅ |
| 65 | handover | handover, delivery | `speccore handover` ✅ |
| 65 | global_status | global status | `speccore global-status` ✅ |
| 62 | platform_add | add platform | `speccore platform-add` ✅ |
| 60 | retro | retro, review | `speccore retro` 🔒 |
| 60 | config | config, settings | `speccore config` ✅ |
| 60 | context | context | `speccore context` ✅ |
| 55 | history | history, change log | `speccore ops` ✅ |
| 55 | dashboard | dashboard, board | `speccore dashboard` ✅ |
| 50 | baseline | baseline, snapshot | `speccore baseline` ✅ |
| 50 | audit | audit, scan | `speccore audit` ✅ |
| 50 | help | help, how to | `speccore help` ✅ |
| 40 | welcome | guide, intro | `speccore welcome` ✅ |

---

## 📂 Directory Structure (Internal Reference)

```
speccore init                           → .speccore/CONSTITUTION.md (project path, git URL, default branch) ✅
speccore iteration create -n Q1         → 期次-Q1/ ✅
                                            ├── STAFFING.md (per-iteration staffing)
                                            ├── 00-期次总览/PROJECT_GRAPH.md (default branch override)
                                            └── 00-产品需求/ (product requirements, read-only)
# 🔒 AI commands below:
speccore analyze -I Q1                  → 期次-Q1/00-需求文档/  🔒
                                            ├── ANALYSIS.md (change scope, risk matrix, file impact)
                                            ├── TECH/TEST/REVIEW/RISK/DEPS/MONITOR.md
                                            └── .speccore/prompts/analyze-iteration-Q1.md
speccore iteration split -i Q1          → reads ANALYSIS.md + STAFFING.md  🔒
                                            ├── Complexity estimation (API/DB/page counts)
                                            ├── Smart priority (high/medium/low)
                                            ├── Semantic dependency detection
                                            ├── Auto-assign from STAFFING.md
                                            └── .speccore/prompts/split-suggestion-Q1.md
speccore execute -i Q1                  → feature/Task-001 (from iteration→CONSTITUTION→git default branch)  🔒
                                            ├── feature/Task-002 (from feature/Task-001 if dependent)
                                            └── Auto switch back to base between tasks
```
