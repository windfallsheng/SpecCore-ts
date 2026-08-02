# SpecCore — Code by Spec, Not by Vibe

SpecCore is a specification-driven development toolkit for AI-native teams. It orchestrates the full cycle: requirement analysis → task splitting → plan scheduling → code generation → archival handoff — all traceable and automated.

---

## Two Modes

| | Simple (default) | Full |
| :--- | :--- | :--- |
| Commands | 17 core | 51 all |
| For | Daily development | Fine-grained control |
| Enable | `speccore init` | `speccore init --full` |

**Simple mode commands:** `ask init iteration task doc2spec analyze split plan execute pr done change validate rename dev status-panel ops`

---

---

## Quick Start

```bash
npm install -g speccore
speccore init                          # Initialize
speccore iteration create --name=Q1    # Create iteration
speccore doc2spec -f PRD.md -p backend -i Q1  # Import requirements
speccore analyze -I Q1                 # Analyze (req+code, 3 scopes)
speccore iteration split -i Q1         # Split into tasks
speccore plan --iteration=Q1           # Generate plan
speccore execute --task=Task-001       # AI development
speccore pr --task=Task-001            # Create PR
speccore done --task=Task-001          # Complete
```


## Two Ways to Use

Same command, different syntax depending on context:

| Context | Syntax | Example |
|:---|:---|:---|
| 🖥 Terminal CLI | `speccore <command>` | `speccore init` `speccore execute -t Task-001 --force` |
| 💬 AI Chat | Natural language | "Create a login feature" |
| 💬 AI Chat | `/spec-<command>` | `/spec-init` `/spec-execute Task-001` |

> Full reference (all 17 commands classified) → [Commands Reference — Two Ways to Use](docs/commands.en.md#-two-ways-to-use)

## Interactive Mode

Key steps support `--interactive` for human-AI collaboration:
`analyze --ask` `split --interactive` `plan --interactive` `change --interactive`

## Smart Entry

```bash
speccore                   # Adaptive panel
speccore "analyze specs"   # Natural language (no subcommand needed)
speccore dev               # Auto-detect phase + cascade execute
```

## Multi-Platform

All steps support parallel multi-project: backend services (`backend/room-service/`) and frontend platforms (`frontend/web/`, `frontend/h5/`).

## Bug Fix

```bash
speccore task new --name="Login timeout" --desc="Token expiry" --type=bugfix              # Single
speccore task new --batch-file=bugs.xlsx --type=bugfix                                    # Batch import
speccore task new --batch-file=bugs.xlsx --type=bugfix --interactive                      # Confirm each
```

## Scheduled Execution

```bash
# Method 1: Mark tasks for queue, trigger manually
speccore task new -n "Fix login timeout" --type=bugfix --schedule=night   # Mark as queue
speccore execute --all --scheduled                                        # Run all queued tasks

# Method 2: Precise time scheduling
speccore schedule create --at "2026-08-10 21:00:00" -t Task-001          # Schedule single task
speccore schedule create --at "2026-08-10 02:00:00" --all -i Q1          # Schedule all tasks
speccore schedule list                                                     # View schedule queue
speccore schedule cancel --id=sch-xxx                                      # Cancel
speccore schedule daemon start                                             # Start daemon (auto-execute)
speccore schedule daemon status                                            # Check daemon status
```

## Documentation

| Doc | Content |
| :--- | :--- |
| 🚀 [Quick Start](docs/快速开始.md) | Full tutorial |
| 🔧 [Full Command Reference](docs/命令参考.md) | 51 commands |
| [Scenarios](docs/场景实战.md) | Typical use cases |
| [Overview](docs/总览.md) | Architecture + concepts |
| [SDD Methodology](docs/SDD方法论.md) | Why Spec-Driven Development |
| [Examples](examples/meeting-system/README.md) | Meeting booking system demo |
