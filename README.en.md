# SpecCore — Code by Spec, Not by Vibe

**SpecCore is not a code generator — it's a human-AI collaboration operating system.** It turns requirements, splitting, planning, execution, and delivery into a closed loop — every step previewable and adjustable, ensuring human and AI reach consensus before a single line of code is written.

> Juggling 5 microservices and 3 frontend platforms? SpecCore turns requirements → splits → plans → code → delivery into a traceable, automated pipeline.

```
  init → doc2spec → analyze → split → plan → execute → pr → done
  🚀Setup   📝Import   🧠Analyze  📦Split  📋Plan  💻Build  🔀PR  ✅Archive
```

## 🚀 5 Minutes to First Task

```bash
npm install -g speccore
speccore init
speccore doc2spec -f requirements.docx --iter=Q1   # Import PRD
speccore analyze -I Q1                          # AI analysis + code health
speccore iteration split -I Q1                  # Split into tasks
speccore plan -I Q1                             # Generate plan
speccore execute -t Task-001                    # AI-powered development
speccore done --task=Task-001                       # Validate → archive
```

## 🎯 What do you want to do?

| I want to... | Command |
|:---|:---|
| **Start a new project** | `speccore init --interactive` |
| **Import a PRD document** | `speccore doc2spec -f PRD.docx -I Q1` |
| **Analyze requirements + code health** | `speccore analyze -I Q1` |
| **Split requirements into tasks** | `speccore iteration split -I Q1 --interactive` |
| **Fix a bug** | `speccore task new -n "Login timeout" --type=bugfix` |
| **Batch fix bugs** | `speccore task new --batch-file=bugs.xlsx --type=bugfix` |
| **Schedule overnight execution** | `speccore schedule create --at "02:00" --all -I Q1` |
| **AI auto-development** | `speccore execute -t Task-001` |
| **Create a Pull Request** | `speccore pr --task=Task-001 --interactive` |
| **Archive a completed task** | `speccore done --task=Task-001 --interactive` |
| **Check project status** | `speccore` or `speccore status-panel` |
| **Natural language queries** | `speccore ask "analyze current requirements"` |

> 📋 Full command reference → [Command Reference](docs/commands.en.md) | 中文文档 → [README.zh.md](README.md)

## 🤝 Interactive Mode

6 commands support `--interactive` — preview changes before confirming:

| `🧠 analyze --interactive` | `🧠 split --interactive` | `🧠 plan --interactive` |
|:---|:---|:---|
| `🧠 pr --interactive` | `🧠 change --interactive` | `🧠 done --interactive` |

## ⏰ Scheduled Execution

```bash
speccore task new -n "Data migration" --schedule=night         # Queue for night
speccore execute --all --scheduled                              # Run all queued
speccore schedule create --at "2026-08-10 02:00" --all -I Q1   # Exact time
speccore schedule daemon start                                   # Auto-execute on schedule
```

## 📚 Documentation

| Doc | Content |
|:---|:---|
| 🚀 [Quick Start](docs/quick-start.en.md) | Full tutorial |
| 🔧 [Command Reference](docs/commands.en.md) | All 44 commands |
| 🎬 [Scenarios](docs/scenarios.en.md) | Real-world examples |
| 🗺 [Overview](docs/总览.md) | Architecture & philosophy |
| 📝 [SDD Methodology](docs/sdd-methodology.en.md) | Spec-driven development |
