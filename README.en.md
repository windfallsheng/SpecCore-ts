# SpecCore — Code by Spec, Not by Vibe

SpecCore is a specification-driven development toolkit for AI-native teams. It orchestrates the full cycle: requirement analysis → task splitting → plan scheduling → code generation → archival handoff — all traceable and automated.

---

## Two Modes

| | Simple (default) | Full |
| :--- | :--- | :--- |
| Commands | 19 core | 52 all |
| For | Daily development | Fine-grained control |
| Enable | `speccore init` | `speccore init --full` |

**Simple mode commands:** `ask init import iteration task doc2spec analyze split plan execute pr done change validate rename dev status-panel ops bugfix`

---

## Two Ways to Use

The same feature has different syntax in terminal CLI vs AI chat, depending on context:

### Common Commands (work in both)

| Feature | 🖥 Terminal CLI | 💬 AI Chat | Notes |
|:---|:---|:---|:---|
| Init | `speccore init` | `/spec-init` | — |
| Import | `speccore doc2spec -f PRD.docx -p backend` | `/spec-doc2spec PRD.docx` | CLI uses `-f` for file path |
| Split | `speccore iteration split -i Q1` | `/spec-split Q1` | CLI uses `-i` for iteration |
| Execute | `speccore execute -t Task-001 --force` | `/spec-execute Task-001` | CLI uses `-t` for task |
| PR | `speccore pr -t Task-001` | `/spec-pr Task-001` | — |
| Status | `speccore status-panel` | `/spec-status-panel` | — |
| Change | `speccore change "desc" -t Task-001` | `/spec-change Task-001` or natural language | — |
| Bugfix | `speccore bugfix -n "name" -d "desc"` | `/spec-bugfix` or natural language | — |

### CLI Only (complex parameters, not suited for chat)

| Command | Usage | Why CLI only |
|:---|:---|:---|
| `import` | `speccore import --project=xx --path=./src --type=backend --force` | Many params, CLI for precision |
| `execute --verify` | `speccore execute -t Task-001 --force --verify` | Needs combined flags |
| `status-panel --export` | `speccore status-panel --export=html --assignee=John` | Export/filter params |
| `dev --auto` | `speccore dev --auto --from=split` | Full automation pipeline |

### AI Chat Only (natural language, not suited for CLI)

| Method | Example | Why chat only |
|:---|:---|:---|
| Natural language | "Create a login feature" "Show progress" | AI auto-matches the right command |
| Deep analysis | `/spec-analyze Q1` → AI reads code and fills Specs | Needs AI context understanding |
| Reverse engineering | `/spec-import-analyze` → AI infers requirements from code | Pure AI behavior |

> **Why the difference?** CLI excels at precision and scripting with explicit flags. AI chat excels at understanding natural language and project context. Complex parameters work best in CLI; deep project analysis works best in chat.

---

## Quick Start

```bash
npm install -g speccore
speccore init                          # Initialize
speccore iteration create --name=Q1    # Create iteration
speccore doc2spec -f PRD.md -p backend -i Q1  # Import requirements
speccore analyze --iteration=Q1        # Analyze
speccore iteration split -i Q1         # Split into tasks
speccore plan --iteration=Q1           # Generate plan
speccore execute --task=Task-001       # AI development
speccore pr --task=Task-001            # Create PR
speccore done --task=Task-001          # Complete
```

## Interactive Mode

Key steps support `--interactive` for human-AI collaboration:
`import --interactive` `analyze --interactive` `split --interactive` `plan --interactive` `change --interactive`

## Smart Entry

```bash
speccore                   # Adaptive panel
speccore "analyze specs"   # Natural language (no subcommand needed)
speccore dev               # Auto-detect phase + cascade execute
```

## Multi-Platform

All steps support parallel multi-project: backend services (`backend/room-service/`) and frontend platforms (`frontend/web/`, `frontend/h5/`).

## Legacy Import

```bash
speccore import --project=backend --type=backend  # From source code
speccore import --project=meeting --path=reqs.xlsx  (also .csv)  # From Excel
# Then run /spec-import-analyze in your AI IDE for deep analysis
```

## Bug Batch

```bash
speccore bugfix --batch-file=bugs.xlsx --schedule=night --interactive
```

## Documentation

| Doc | Content |
| :--- | :--- |
| 🚀 [Quick Start](docs/快速开始.md) | Full tutorial |
| 🔧 [Full Command Reference](docs/命令参考.md) | 52 commands |
| [Scenarios](docs/场景实战.md) | Typical use cases |
| [Overview](docs/总览.md) | Architecture + concepts |
| [SDD Methodology](docs/SDD方法论.md) | Why Spec-Driven Development |
| [Examples](examples/meeting-system/README.md) | Meeting booking system demo |
