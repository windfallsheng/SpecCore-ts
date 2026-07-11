# SpecCore — Quick Start Guide

> Get started with SpecCore. Read the [README](../README.en.md) first for an overview, then follow this guide.

---

## Prerequisites

- **Node.js**: >= 18.0.0
- **OS**: macOS / Linux / Windows

## Install

```bash
npm install -g speccore

# Zero-install (npx)
npx speccore demo     # Run demo project
npx speccore --help   # Show help

# Verify
speccore --version
```

---

## 🎬 Zero-Install Experience

Try SpecCore without installing:

```bash
# Run demo (5 min)
npx speccore demo

# Init current directory
npx speccore init

# View help
npx speccore --help
```

---

## 5-Minute Quick Start

### Step 1: Initialize

```bash
cd my-project
speccore init
```

Initialization auto-completes:
- ✅ Creates `.speccore/` full directory structure (including GLOBAL layer)
- ✅ Creates `.workbuddy/` WorkBuddy integration (skill + memory)
- ✅ Creates `.speccore/config/platforms.yaml` multi-platform config
- ✅ Updates `.gitignore`

### Step 2: Edit Tech Constitution

Edit `.speccore/CONSTITUTION.md` with your project's tech stack and naming conventions.

```markdown
## Tech Stack

### Backend
- Language: Java / TypeScript / Go
- Framework: Spring Boot / NestJS / Gin
- Database: MySQL / PostgreSQL

### Frontend
- Framework: Vue / React
- UI Library: Element Plus / Ant Design
```

### Step 3: Import Projects to Global Layer

```bash
# Import backend
speccore import --project=user-service --path=./backend --type=backend

# Import frontend
speccore import --project=frontend-web --path=./web --type=web

# Incremental sync
speccore import --project=user-service --path=./backend --update
```

### Step 4: Create Iteration

```bash
speccore iteration create --name 2026-07-UserSystem
```

### Step 5: Create Multi-Platform Tasks

```bash
# Multi-platform task
speccore new-task --name UserLogin --platforms=web,h5

# Traditional single task
speccore task new --name AuditLog --type feature
```

### Step 6: Check Progress

```bash
# Overall
speccore progress

# By platform
speccore progress --platform=web

# JSON format
speccore progress --format json
```

### Step 7: View Task Context

```bash
speccore context --task=Task-001
```

---

## Smart Entry: Natural Language

**Can't remember commands? Use `speccore spec` + natural language!** 31 intent types, 200+ keywords.

```bash
speccore spec "Create a login feature"       # → matches goal
speccore spec "Start working"                # → matches execute
speccore spec "How's the progress?"          # → matches progress
speccore spec "Change login to use OTP"      # → matches change
speccore spec "Global status"                # → matches global-status
speccore spec "Analyze REQ-001 impact"       # → matches impact
```

---

## Key Scenarios

### Global Layer

```bash
speccore global-status
speccore iteration-from-global --reqs=REQ-001,REQ-002 --name=2026-07-UserSystem
speccore sync-global --iteration=2026-07-UserSystem
speccore index-update --dry-run        # Preview
speccore index-update                  # Execute
```

### Multi-Platform Tasks

```bash
# Create multi-platform task
speccore new-task --name UserLogin --platforms=web,h5,miniapp

# Add new platform
speccore platform-add --name=tablet --description="Tablet" --tech="React Native"

# Execute/stat by platform
speccore execute --platform=web
speccore progress --platform=h5
```

### Development Execution

```bash
speccore execute --all
speccore execute --assignee=Alice
speccore execute --priority=high
speccore execute --status=pending
speccore execute --dry-run          # Preview
speccore plan                       # Smart scheduling
```

### Change & Sync

```bash
speccore change --req=REQ-001 --desc="Add captcha verification"
speccore sync --task=Task-001
```

### Analysis & Audit

```bash
speccore impact --req=REQ-001
speccore baseline create --name=2026-Q3-Release
speccore dashboard
speccore audit --strict
```

### Validate & Report

```bash
speccore validate --fix
speccore report --format html --output report.html
```

### Maintenance

```bash
speccore rename --target=old-name --new-name=new-name
speccore rename --batch --pattern="Task-" --replacement="Feature-"
speccore archive --all
speccore handover --iteration=2026-07-UserSystem
```

---

## Directory Structure

```
my-project/
├── .speccore/                     # Project Layer
│   ├── CONSTITUTION.md            # Tech constitution
│   ├── SETTINGS.md                # Framework config
│   ├── GLOBAL/                    # Global Layer (multi-project management)
│   │   ├── INDEX.md               # Requirement index
│   │   ├── OVERVIEW.md            # Project panorama
│   │   ├── ARCHITECTURE.md        # Architecture (Mermaid)
│   │   ├── PROJECTS/              # Per-project requirements
│   │   └── BASELINES/             # Version baselines
│   ├── config/
│   │   └── platforms.yaml         # Multi-platform config
│   ├── PROJECT/                   # Project assets
│   ├── PATTERNS/TEMPLATES/        # Code pattern templates
│   ├── ITERATIONS/                # Iteration index
│   ├── RULES/                     # Review & maintenance rules
│   └── local/
│       └── context.json           # Runtime context
│
├── .workbuddy/                    # WorkBuddy integration
│   ├── skills/speccore/           # Speccore Skill
│   └── memory/MEMORY.md           # Project memory
│
└── Iteration-2026-07-UserSystem/  # Iteration Layer
    ├── 00-Requirements/
    │   └── REQUIREMENT.md
    ├── 00-Tech-Design/
    │   └── ARCHITECTURE.md
    ├── 00-Overview/
    │   └── PROJECT_GRAPH.md
    └── Task-001-UserLogin/        # Task Layer
        ├── _shared/               # Shared (API Contract + business rules)
        ├── backend/               # Backend Specs
        └── frontend/              # Multi-platform frontend Specs
            ├── web/
            ├── h5/
            └── miniapp/
```

---

## 💡 CLI vs AI Commands

| Execute in | Prefix | Example |
| :--- | :--- | :--- |
| 🔧 Terminal | `speccore` | `speccore init`、`speccore new-task --platforms=web,h5` |
| 🤖 AI Tool | `/spec-` | `/spec-init`、`/spec-new-task --platforms=web,h5` |

Both share the same logic. AI commands call CLI commands internally when used in WorkBuddy / Cursor / Claude Code.

---

## Next Steps

- [Command Reference](commands.en.md) — Full command list with params and aliases
- [Usage Guide](usage-guide.en.md) — File safety guide: manual edit vs CLI command
- [Workspace Layout](workspace-organization.en.md) — Recommended directory structure
- [Migration Guide](migration-guide.en.md) — Shell v3.x → CLI v5.x
- [SDD Methodology](sdd-methodology.en.md) — What, why, how
- [Tool Adaptation](tool-adaptation.en.md) — WorkBuddy integration details
- [README](../README.en.md) — Back to overview
- [CHANGELOG](../CHANGELOG.md) — Version history
- [中文：快速开始](快速开始.md) | [中文：命令参考](命令参考.md) | [中文：使用指南](使用指南.md)
