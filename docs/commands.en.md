# SpecCore CLI — Command Reference

> 🔧 CLI Commands: 39 | 🧠 Intent Types: 31 | See [README](../README.en.md)

---

## 💡 Two Ways to Use

| | 🔧 Terminal | 🤖 AI Slash Command |
| :--- | :--- | :--- |
| **Prefix** | `speccore` | `/spec-` |
| **Example** | `speccore init` | `/spec-init` |
| **Where** | Terminal | AI tools (WorkBuddy / Cursor etc.) |
| **Mapping** | — | `speccore xxx` ↔ `/spec-xxx` |

---

## 🧠 Smart Entry (1)

| Command | Alias | Function | Parameters |
| :--- | :--- | :--- | :--- |
| `speccore spec "<query>"` | — | Natural language intent recognition | `"<query>"` NL description |

---

## 🌐 Initialization & Import (2)

| Command | Alias | Function | Parameters |
| :--- | :--- | :--- | :--- |
| `speccore init` | `in` | Initialize Speccore project | `--force` |
| `speccore import` | `imp` | Import project to global layer | `--project <name>` `--path <path>` `--type <type>` `--scope <scope>` `--ignore <pkgs>` `--update` |

---

## 📋 Iteration Management (3)

| Command | Alias | Function | Parameters |
| :--- | :--- | :--- | :--- |
| `speccore iteration create` | `it cr` | Create iteration | `--name <name>` `--goal <goal>` |
| `speccore iteration split` | `it sp` | Split requirements into tasks | `--iteration <name>` `--dry-run` |
| `speccore iteration-from-global` | `ifg` | Generate iteration from global layer | `--reqs <ids>` `--name <name>` `--project <name>` |

---

## 📱 Task Management (2)

| Command | Alias | Function | Parameters |
| :--- | :--- | :--- | :--- |
| `speccore new-task` | `nt` | Create multi-platform task | `--name <name>` `--type <type>` `--platforms <list>` `--backend-only` `--frontend-only` `--iteration <name>` |
| `speccore task new` | — | Create traditional single task | `--name <name>` `--type <type>` `--desc <desc>` `--iteration <name>` |

---

## ⚡ Execution & Scheduling (2)

| Command | Alias | Function | Parameters |
| :--- | :--- | :--- | :--- |
| `speccore plan` | `pl` | Smart scheduling (DAG analysis) | `--iteration <name>` |
| `speccore execute` | `ex` | Execute development tasks | `--all` `--task <id>` `--assignee <name>` `--type <type>` `--priority <p>` `--status <s>` `--platform <name>` `--backend` `--frontend` `--iteration <name>` `--dry-run` `--force` |

---

## 🔄 Change & Sync (3)

| Command | Alias | Function | Parameters |
| :--- | :--- | :--- | :--- |
| `speccore change` | `cg` | Requirement change cascade | `--req <id>` `--desc <text>` `--task <id>` |
| `speccore sync` | `sy` | Reverse sync (code → spec) | `--task <id>` `--iteration <name>` |
| `speccore sync-global` | `sg` | Bidirectional global layer sync | `--iteration <name>` |

---

## ✅ Validation & Review (5)

| Command | Alias | Function | Parameters |
| :--- | :--- | :--- | :--- |
| `speccore validate` | `rv` | Compliance check | `--task <id>` `--iteration <name>` `--strict` `--fix` `--format <json>` |
| `speccore progress` | `pg` | Progress overview | `--iteration <name>` `--assignee <name>` `--type <type>` `--task <id>` `--platform <name>` `--detail` `--format <json>` |
| `speccore status` | `st` | Status dashboard | `--iteration <name>` |
| `speccore health` | `hl` | Project health (4D/12 metrics) | `--iteration <name>` |
| `speccore report` | `rp` | Generate project report | `--iteration <name>` `--format <md\|html\|json>` `--output <path>` `--team` `--risk` |

---

## 🔬 Analysis & Audit (4)

| Command | Alias | Function | Parameters |
| :--- | :--- | :--- | :--- |
| `speccore impact` | `if` | Change impact analysis | `--req <id>` `--task <id>` |
| `speccore baseline` | `bl` | Version baseline management | `create --name <name>` `list` `compare --name <name>` `restore --name <name> --req <id>` |
| `speccore dashboard` | `db` | Visual dashboard (Chart.js) | `--iteration <name>` `--output <path>` |
| `speccore audit` | `ad` | AI smart audit | `--strict` `--fix` |

---

## 🌐 Global Layer (3)

| Command | Alias | Function | Parameters |
| :--- | :--- | :--- | :--- |
| `speccore global-status` | `gs` | Global layer status overview | — |
| `speccore history` | `hs` | Requirement change history | `--req <id>` `--iteration <name>` |
| `speccore index-update` | `iu` | Scan & rebuild GLOBAL/INDEX | `--dry-run` |

---

## 🎯 Scenario Commands (8)

| Command | Alias | Function | Parameters |
| :--- | :--- | :--- | :--- |
| `speccore goal` | — | End-to-end requirement delivery | `--name <name>` `--desc <text>` `--iteration <name>` |
| `speccore bugfix` | `bf` | Quick bug fix | `--title <text>` `--desc <text>` `--iteration <name>` |
| `speccore research` | `rs` | Technology research | `--topic <text>` `--criteria <list>` |
| `speccore handover` | `ho` | Generate handover document | `--iteration <name>` |
| `speccore retro` | `rt` | Iteration retrospective | `--iteration <name>` |
| `speccore rename` | `rn` | Rename | `--target <old>` `--new-name <new>` `--batch` `--pattern <p>` `--replacement <r>` `--force` |
| `speccore platform-add` | `padd` | Add platform type | `--name <id>` `--description <text>` `--tech <stack>` |
| `speccore context` | `ctx` | View task context | `--task <id>` |

---

## 🛠️ Tools (6)

| Command | Alias | Function | Parameters |
| :--- | :--- | :--- | :--- |
| `speccore template-add` | `ta` | Add code template | `--name <name>` `--type <type>` `--path <path>` |
| `speccore archive` | `ar` | Archive completed tasks | `--all` `--task <id>` `--iteration <name>` |
| `speccore config` | `cf` | Framework configuration | `--set <key=value>` `--get <key>` |
| `speccore help` | `hp` | Categorized help | `--category <name>` |
| `speccore demo` | `dm` | Quick demo | — |
| `speccore welcome` | `wc` | First-time guide | — |

---

## Alias Quick Reference

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

---

## Natural Language Intent Mapping (31 types)

| Pri | Intent | Keywords | Maps To |
| :---: | :--- | :--- | :--- |
| 100 | change | modify, adjust, change | `speccore change` |
| 90 | execute | start, run, execute | `speccore execute` |
| 88 | bugfix | fix, bug, error | `speccore bugfix` |
| 85 | create | create, build, implement | `speccore goal` |
| 85 | init | initialize, setup | `speccore init` |
| 84 | new_task | new task, create task | `speccore new-task` |
| 83 | import_to_global | import project | `speccore import` |
| 82 | import | import, migrate | `speccore import` |
| 80 | review | review, check, inspect | `speccore validate` |
| 80 | research | research, evaluate | `speccore research` |
| 80 | iter_from_global | from global | `speccore iteration-from-global` |
| 80 | impact | impact, depend | `speccore impact` |
| 78 | plan | plan, schedule | `speccore plan` |
| 78 | rename | rename, change name | `speccore rename` |
| 75 | archive | archive, clean | `speccore archive` |
| 75 | reference | reference, example | `speccore demo` |
| 70 | progress | progress, status | `speccore progress` |
| 70 | sync | sync, align | `speccore sync` |
| 70 | sync_global | sync global | `speccore sync-global` |
| 68 | status | status, situation | `speccore status` |
| 65 | health | health, quality | `speccore health` |
| 65 | handover | handover, deliver | `speccore handover` |
| 65 | global_status | global status | `speccore global-status` |
| 62 | platform_add | add platform | `speccore platform-add` |
| 60 | retro | retro, review | `speccore retro` |
| 60 | config | config, settings | `speccore config` |
| 60 | context | context | `speccore context` |
| 58 | index_update | update index | `speccore index-update` |
| 55 | history | history, changelog | `speccore history` |
| 55 | dashboard | dashboard, board | `speccore dashboard` |
| 50 | baseline | baseline, snapshot | `speccore baseline` |
| 50 | audit | audit, scan | `speccore audit` |
| 50 | help | help, how to | `speccore help` |
| 45 | demo | demo, try | `speccore demo` |
| 40 | welcome | guide, intro | `speccore welcome` |
