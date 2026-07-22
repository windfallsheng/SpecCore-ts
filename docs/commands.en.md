# SpecCore — Command Reference

> 🔧 Commands: 54 | 🧠 Intent Types: 36 | See [README](../README.en.md)

---

## 💡 Two Usage Modes

| | 🔧 CLI Command | 🤖 AI Slash Command |
| :--- | :--- | :--- |
| **Prefix** | `speccore` | `/spec-` |
| **Example** | `speccore init` | `/spec-init` |
| **Where** | Terminal | AI Tools (WorkBuddy / Cursor etc.) |
| **Mapping** | — | `speccore xxx` ↔ `/spec-xxx` |

---

## 🧠 Smart Entry

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore spec "<query>"` | — | Natural language intent routing | `"<query>"` |

```bash
speccore spec "create user login feature"
```

---

## 🌐 Init & Import

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore init` | `in` | Initialize SpecCore project | `--force` |
| `speccore word2spec` | `w2s` | Convert Word (.docx/.doc) → SpecCore Markdown | `--file <path>` `--iteration <name>` `--platform <name>` |
| `speccore import` | `imp` | Import project to global layer | `--project <name>` `--path <path>` `--type <type>` `--scope <scope>` `--ignore <pkgs>` `--update` |

```bash
speccore init
speccore init --force
speccore import --project=user-service --path=../backend --type=backend
speccore import --project=web --path=../frontend --type=web --update
```

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
| `speccore new-task` | `nt` | Create multi-platform task | `--name <name>` `--type <type>` `--platforms <list>` `--backend-only` `--iteration <name>` |
| `speccore task new` | — | Create traditional single task | `--name <name>` `--type <type>` `--desc <desc>` `--iteration <name>` |

```bash
speccore new-task --name="User Login" --platforms=web,h5 --type=feature
speccore new-task --name="API Endpoint" --backend-only --iteration=2026-07-Meeting
speccore task new --name="Data Export" --type=feature --desc="Excel export"
```

---

## ⚡ Execution & Scheduling

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore plan` | `pl` | Smart scheduling (DAG) | `--iteration <name>` |
| `speccore execute` | `ex` | Execute development tasks | `--all` `--task <id>` `--batch-size=<n>` `--resume` `--dry-run` `--force` `--interactive` `--platform <name>` `--iteration <name>` |

```bash
speccore plan --iteration=2026-07-Meeting
speccore execute --task=Task-001 --force
speccore execute --all --batch-size=3 --force      # Batch execution
speccore execute --all --dry-run                    # Preview
speccore execute --resume                           # Resume from interruption
speccore execute --all --interactive                # Interactive selection
```

---

## 🔄 Change & Sync

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore change` | `cg` | Requirement change propagation | `--req <id>` `--desc <text>` `--task <id>` |
| `speccore sync` | `sy` | Code ↔ Spec bidirectional sync | `--task <id>` `--iteration <name>` `--dry-run` `--auto` |
| `speccore sync-global` | `sg` | Iteration ↔ Global layer sync | `--iteration <name>` |

```bash
speccore change --req=REQ-001 --desc="Add multi-device login"
speccore sync --dry-run                              # Preview @spec references
speccore sync                                         # Scan code → update TASK.md
speccore sync-global --iteration=2026-07-Meeting
```

---

## ✅ Validate & Review

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore validate` | `rv` | Compliance check | `--task <id>` `--iteration <name>` `--fix` `--format <json>` |
| `speccore progress` | `pg` | Progress overview | `--iteration <name>` `--platform <name>` `--detail` `--format <json>` |
| `speccore status` | `st` | Status dashboard | `--iteration <name>` |
| `speccore health` | `hl` | Project health | `--iteration <name>` |
| `speccore report` | `rp` | Generate report | `--iteration <name>` `--format <md\|html\|json>` `--output <path>` `--team` `--risk` |

```bash
speccore validate --task=Task-001
speccore validate --fix --format=json
speccore progress --platform=web --detail
speccore status --iteration=2026-07-Meeting
speccore health
speccore report --format=html --output=report.html --team --risk
```

---

## 🔬 Analysis & Audit

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore impact` | `if` | Change impact analysis | `--req <id>` `--task <id>` |
| `speccore baseline` | `bl` | Version baseline management | `--name <name>` `--compare <name>` `--restore <name>` `--req <id>` |
| `speccore dashboard` | `db` | Visual dashboard (Chart.js) | `--output <path>` |
| `speccore audit` | `ad` | AI smart audit | `--fix` |

```bash
speccore impact --req=REQ-001
speccore baseline --name=v1.0
speccore baseline --compare=v1.0 --name=v1.1
speccore dashboard --output=dashboard.html
speccore audit --fix
```

---

## 🌐 Global Layer

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore global-status` | `gs` | Global layer status overview | — |
| `speccore history` | `hs` | Requirement change history | `--req <id>` `--iteration <name>` |
| `speccore index-update` | `iu` | Rebuild GLOBAL/INDEX | `--dry-run` |

```bash
speccore global-status
speccore history --req=REQ-001
speccore index-update --dry-run
```

---

## 🎯 Scenario Commands

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore goal` | — | Full requirement delivery | `--name <name>` `--desc <text>` `--iteration <name>` |
| `speccore bugfix` | `bf` | Quick bug fix | `--name <text>` `--desc <text>` `--iteration <name>` |
| `speccore research` | `rs` | Technology research | `--topic <text>` `--options <list>` |
| `speccore handover` | `ho` | Generate handover doc | `--iteration <name>` |
| `speccore retro` | `rt` | Iteration retrospective | `--iteration <name>` |
| `speccore rename` | `rn` | Rename iteration/task | `--target <old>` `--new-name <new>` `--batch` `--pattern <p>` `--replacement <r>` |
| `speccore platform-add` | `padd` | Add dynamic platform | `--name <id>` `--description <text>` `--tech <stack>` |
| `speccore context` | `ctx` | View task context | `--task <id>` |

```bash
speccore goal --name="Payment Module" --desc="WeChat Pay integration"
speccore bugfix --name="Login timeout" --desc="Fix token expiry"
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
| `speccore archive` | `ar` | Archive completed tasks | `--all` `--task <id>` `--iteration <name>` |
| `speccore config` | `cf` | Config management | `--set <key=value>` `--get <key>` |
| `speccore help` | `hp` | Categorized command help | `--category <name>` |
| `speccore demo` | `dm` | 5-minute quick demo | — |
| `speccore welcome` | `wc` | First-use interactive guide | — |
| `speccore migrate` | `mg` | Shell v3→CLI v5 migration | `--dry-run` |
| `speccore search` | `sh` | Search across all Spec files | `<query>` `--task=<id>` `--iteration=<name>` |
| `speccore watch` | `wch` | Watch files + auto-validate on save | `--task=<id>` `--iteration=<name>` |
| `speccore delete` | `dl` | Delete task/iteration (trash + auto-clean) | `--task=<id>` `--iteration=<name>` `--force` |

```bash
speccore template-add --name="crud" --type=backend --files="./templates/*"
speccore archive --task=Task-001
speccore archive --all --iteration=2026-07-Meeting
speccore config --set platforms=web,h5
speccore config --get platforms
speccore help --category=execute
speccore demo
speccore welcome
speccore migrate --dry-run
speccore delete --task=Task-005           # Delete task
speccore delete --iteration=2026-07-Sprint --force  # Delete iteration
```

---

## 🆕 v5.18 New Commands

| Command | Alias | Description | Options |
| :--- | :--- | :--- | :--- |
| `speccore update` | `up` | Update task attributes | `--task=<id>` `--status=<s>` `--priority=<p>` `--assignee=<n>` |
| `speccore backup` | `bk` | Backup current state | `--list` `--restore=<name>` |
| `speccore completion` | `cm` | Generate shell completion | `[bash\|zsh]` |
| `speccore hooks` | `hk` | Install Git hooks | — |
| `speccore current` | `cr` | Show branch-task mapping | `--commit` `--pr` |
| `speccore diff` | `df` | Compare iterations/baselines | `--source=<name>` `--target=<name>` |
| `speccore trace` | `tr` | REQ→Task→Code trace chain | `--req=<id>` `--task=<id>` `--full` |

```bash
# update
speccore update --task=Task-001 --status=completed
speccore update --task=Task-001 --priority=high --assignee=Zhang San

# backup
speccore backup
speccore backup --list
speccore backup --restore=2026-07-11T10:00:00

# completion
speccore completion bash > /usr/local/etc/bash_completion.d/speccore

# hooks
speccore hooks install

# current
speccore current
speccore current --commit
speccore current --pr

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
| `imp` | import | `pl` | plan |
| `nt` | new-task | `cg` | change |
| `padd` | platform-add | `sy` | sync |
| `ctx` | context | `sg` | sync-global |
| `iu` | index-update | `if` | impact |
| `it cr` | iteration create | `bl` | baseline |
| `it sp` | iteration split | `db` | dashboard |
| `ifg` | iteration-from-global | `ad` | audit |
| `gs` | global-status | `hs` | history |
| `pg` | progress | `st` | status |
| `hl` | health | `rp` | report |
| `rv` | validate | `ar` | archive |
| `bf` | bugfix | `rs` | research |
| `ho` | handover | `rt` | retro |
| `rn` | rename | `ta` | template-add |
| `cf` | config | `hp` | help |
| `dm` | demo | `wc` | welcome |
| `mg` | migrate | `bk` | backup |
| `cm` | completion | `hk` | hooks |
| `cr` | current | `df` | diff |
| `tr` | trace | `up` | update |
| `dl` | delete | `sh` | search |
| `wch` | watch | | |

---

## Intent Mapping (36 types)

| Priority | Intent | Keywords | Command |
| :---: | :--- | :--- | :--- |
| 100 | change | modify, adjust, change | `speccore change` |
| 90 | execute | start, run, execute | `speccore execute` |
| 88 | bugfix | bug, fix, error | `speccore bugfix` |
| 85 | create | create, build, implement | `speccore goal` |
| 85 | init | initialize, setup, create | `speccore init` |
| 84 | new_task | new task, create task | `speccore new-task` |
| 83 | import_to_global | import project | `speccore import` |
| 82 | import | import, migrate | `speccore import` |
| 80 | review | review, check, inspect | `speccore validate` |
| 80 | research | research, evaluate | `speccore research` |
| 80 | iter_from_global | generate from global | `speccore iteration-from-global` |
| 80 | impact | impact, dependency | `speccore impact` |
| 78 | plan | plan, schedule | `speccore plan` |
| 78 | rename | rename | `speccore rename` |
| 75 | archive | archive | `speccore archive` |
| 75 | reference | example, reference | `speccore demo` |
| 70 | progress | progress | `speccore progress` |
| 70 | sync | sync, align | `speccore sync` |
| 70 | sync_global | sync global | `speccore sync-global` |
| 68 | status | status | `speccore status` |
| 65 | health | health, quality | `speccore health` |
| 65 | handover | handover, delivery | `speccore handover` |
| 65 | global_status | global status | `speccore global-status` |
| 62 | platform_add | add platform | `speccore platform-add` |
| 60 | retro | retro, review | `speccore retro` |
| 60 | config | config, settings | `speccore config` |
| 60 | context | context | `speccore context` |
| 58 | index_update | update index | `speccore index-update` |
| 55 | history | history, change log | `speccore history` |
| 55 | dashboard | dashboard, board | `speccore dashboard` |
| 50 | baseline | baseline, snapshot | `speccore baseline` |
| 50 | audit | audit, scan | `speccore audit` |
| 50 | help | help, how to | `speccore help` |
| 45 | demo | demo, example | `speccore demo` |
| 40 | welcome | guide, intro | `speccore welcome` |
