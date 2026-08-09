# SpecCore — Quick Start Guide

> Get started with SpecCore. All operations support three entry modes:
> ⌨️ **CLI**: `speccore init` | 🤖 **AI Slash**: `/spec-init` | 💬 **AI Chat**: "Initialize a project"

---

## Prerequisites

- **Node.js**: >= 18.0.0
- **OS**: macOS / Linux / Windows
- **Optional**: pandoc (for `speccore doc2spec` 🔒 Word import; command prompts for auto-install if missing)

## Install

```bash
npm install -g speccore

# Zero-install (npx)
npx speccore --help   # Show help

# Verify
speccore --version
```

---

## 🎬 Zero-Install Experience

Try SpecCore without installing:

```bash
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
# 💬 "Initialize a SpecCore project"
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

### Step 3: Create Iteration

```bash
speccore iteration create --name 2026-07-UserSystem
```

### Step 4: Create Multi-Platform Tasks

```bash
# Multi-platform task
speccore task new --name UserLogin --platforms=web,h5

# Traditional single task
speccore task new --name AuditLog --type feature
```

### Step 5: Check Progress

```bash
# Overall
speccore dashboard

# By platform
speccore dashboard --platform=web

# JSON format
speccore dashboard --format json
```

### Step 6: View Task Context

```bash
speccore context --task=Task-001
```

---

## Smart Entry: Natural Language

**Can't remember commands? Use `speccore ask` + natural language!** 36 intent types, 200+ keywords.

```bash
speccore ask "Create a login feature"       # → matches goal
speccore ask "Start working"                # → matches execute
speccore ask "How's the progress?"          # → matches progress
speccore ask "Change login to use OTP"      # → matches change
speccore ask "Global status"                # → matches global-status
speccore ask "Analyze REQ-001 impact"       # → matches impact
```

---

## Key Scenarios

### Global Layer

```bash
speccore global-status
speccore iteration-from-global --reqs=REQ-001,REQ-002 --name=2026-07-UserSystem
speccore sync --global --iteration=2026-07-UserSystem
```

### Multi-Platform Tasks

```bash
# Create multi-platform task
speccore task new --name UserLogin --platforms=web,h5,miniapp

# Add new platform
speccore platform-add --name=tablet --description="Tablet" --tech="React Native"

# 🔒 AI: Filter by platform (use @spec-ask in AI IDE)
@spec-ask "execute web platform tasks"
speccore dashboard --platform=h5                     # ✅ CLI
```

### Development Execution 🔒 AI Commands

```bash
# Use @spec-ask in AI IDE:
@spec-ask "execute all tasks"
@spec-ask "execute Alice's tasks"  
@spec-ask "execute high priority tasks"
@spec-ask "preview execution plan"
@spec-ask "generate smart scheduling plan"
```

### Change & Sync 🔒 AI Commands

```bash
# Use @spec-ask in AI IDE:
@spec-ask "change REQ-001 to add captcha verification"
speccore sync --task=Task-001                        # ✅ CLI
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
speccore dashboard
```

### Maintenance

```bash
speccore rename --target=old-name --new-name=new-name
speccore rename --batch --pattern="Task-" --replacement="Feature-"
speccore handover --iteration=2026-07-UserSystem      # ✅ CLI

# 🔒 AI: @spec-ask "archive all completed tasks"
```
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
---

## Bidirectional Trace: Code ↔ Spec

Add `@spec` annotations in your code, SpecCore maintains the trace chain:

```java
// @spec Task-001-user-login
@RestController
public class AuthController { ... }
```

```bash
# 🔒 AI: @spec-ask "execute Task-001" (auto-creates Git branch)

# Reverse sync (scan @spec → update TASK.md)
speccore sync --dry-run     # Preview ✅ CLI
speccore sync               # Write ✅ CLI

# View trace chain
speccore trace --req=REQ-001
speccore trace --full
```

---

## 💡 CLI vs AI Commands

| Execute in | Prefix | Example |
| :--- | :--- | :--- |
| ✅ Terminal | `speccore` | `speccore init`、`speccore task new --platforms=web,h5` |
| 🔒 AI IDE | `@spec-ask` | `@spec-ask "execute Task-001"`、`@spec-ask "analyze Q1"` |

> **Note**: `execute`, `analyze`, `plan`, `pr`, `done`, `change`, `retro`, `doc2spec`, `dev` are 🔒 AI commands — use `@spec-ask` in WorkBuddy/Cursor/Trae. Run `speccore init` to set up AI IDE integration.

---

## Next Steps

- [Command Reference](commands.en.md) — Full command list with params and aliases
- [Usage Guide](usage-guide.en.md) — File safety guide: manual edit vs CLI command
- [Workspace Layout](workspace-organization.en.md) — Recommended directory structure
- [Migration Guide](migration-guide.en.md) — Shell v3.x → CLI v5.x
- [SDD Methodology](sdd-methodology.en.md) — What, why, how
- [Tool Adaptation](tool-adaptation.en.md) — WorkBuddy integration details
- [README](../README.en.md) — Back to overview
- [CHANGELOG](../CHANGELOG.en.md) — Version history
- [中文：快速开始](快速开始.md) | [中文：命令参考](命令参考.md) 
