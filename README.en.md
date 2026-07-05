# SpecCore

> **Code by Spec, Not by Vibe.**

[![npm version](https://img.shields.io/npm/v/speccore.svg)](https://www.npmjs.com/package/speccore)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

SpecCore is the official command-line tool for the [SpecCore](https://github.com/spec-core/spec-core) specification-driven development framework. It decouples deterministic operations (file creation, directory management, format validation, status statistics) from AI, executing them directly through code to improve efficiency and reduce Token consumption.

---

## One Minute Overview

| Question | Answer |
| :--- | :--- |
| **What is this?** | CLI tool for SpecCore framework, deterministic operations executed by code, intelligent decisions handled by AI |
| **What problem does it solve?** | AI file operations are error-prone, high Token consumption, context window waste |
| **What do I need to install?** | Node.js >= 18, run `npm install -g speccore` |
| **Relationship with Slash Commands?** | CLI is the underlying execution engine for Slash Commands, AI makes decisions, CLI executes |

---

## Feature Highlights

- **🚀 Quick Initialization**: Initialize a complete SpecCore project structure with one command
- **📁 Smart Directory Management**: Auto-create iterations, tasks, shared resource directories following specifications
- **✅ Auto Compliance Check**: Scan all Spec files, check required fields and formats
- **📊 Real-time Progress Tracking**: Auto-identify active iterations, calculate task completion rates
- **🏥 Health Dashboard**: Evaluate project health with 4 dimensions and 12 metrics
- **📈 One-click Reporting**: Support Markdown/HTML/JSON format output for project reports
- **🧠 Context Awareness**: Auto-read `.speccore/local/context.json`, intelligently fill default values
- **🔄 Deterministic Execution**: File operations, format validation, status statistics all executed locally with zero Token consumption

---

## Design Philosophy

SpecCore adopts an architecture that **decouples deterministic logic from intelligent logic**:

| Logic Type | Responsibility | Executor | Example |
| :--- | :--- | :--- | :--- |
| **Deterministic Logic** | Structured operations | CLI code | Create directories, move files, parse YAML, validate formats, count status |
| **Intelligent Logic** | Understanding & Decision | AI | Understand requirements, split tasks, generate code, review outputs |

```
User Input (Slash Command)
        │
        ▼
┌───────────────────────────────────────┐
│   AI Layer (Intelligent Decision)     │
│   - Understand user intent            │
│   - Decide which operations to execute│
│   - Generate code content             │
└───────────────────────────────────────┘
        │ Call CLI Commands
        ▼
┌───────────────────────────────────────┐
│   CLI Layer (Deterministic Execution) │
│   - Create directory structure        │
│   - Read/write files                  │
│   - Parse YAML                        │
│   - Validate formats                  │
│   - Output JSON results               │
└───────────────────────────────────────┘
```

**Core Benefit**: Directory checking, YAML parsing, and status statistics are executed deterministically by code. AI only interprets results and formats outputs, significantly reducing Token consumption.

---

## Requirements

- **Node.js**: >= 18.0.0
- **Operating System**: macOS / Linux / Windows

---

## Installation

```bash
# Global installation (recommended)
npm install -g speccore

# Or use npx (no installation required, always use latest version)
npx speccore --version

# Or install specific version
npm install -g speccore@1.0.0
```

---

## Quick Start

### 1. Initialize Project

```bash
# Enter your project directory
cd my-project

# Initialize SpecCore
speccore init --mode fresh

# Or migrate existing project
speccore init --mode migration
```

After execution, the following structure will be generated:

```
.speccore/                          # Global configuration directory
├── CONSTITUTION.md                 # Technical Constitution (tech stack, standards)
├── SETTINGS.md                     # Framework configuration (switches, modes)
├── ITERATIONS/                     # Iteration records
├── PATTERNS/                       # Pattern library
├── PROJECT/                        # Project-level assets
│   ├── OVERVIEW.md
│   ├── TEAM.md
│   └── ...
├── RULES/                          # Adjudication rules
└── local/                          # Local state
    └── context.json                # Current context (iteration, task, user)
```

### 2. Create Iteration

```bash
speccore iteration create --name 2026-07-User-System
```

Generates `Iteration-2026-07-User-System/` directory containing:
- `00-Requirements/REQUIREMENT.md`
- `00-Technical-Design/ARCHITECTURE.md`
- `00-Iteration-Overview/PROJECT_GRAPH.md`

### 3. Create Tasks

```bash
speccore task new --name User-Login --type feature
speccore task new --name Phone-Registration --type feature
speccore task new --name Password-Reset --type bugfix
```

### 4. View Progress

```bash
# View overall progress
speccore progress

# JSON format output (suitable for CI/CD)
speccore progress --format json

# View detailed progress
speccore progress --detail
```

### 5. Validate Compliance

```bash
# Validate all tasks
speccore validate

# Auto-fix fixable issues
speccore validate --fix

# JSON format output (AI can read directly)
speccore validate --format json
```

### 6. Generate Report

```bash
# Markdown format (default)
speccore report

# HTML format (suitable for email)
speccore report --format html --output ./report.html

# JSON format (suitable for import into other systems)
speccore report --format json

# Include team analysis and risk analysis
speccore report --team --risk
```

---

## Full Command List

### Initialization & Import

| Command | Description | Corresponding Slash Command | Deterministic |
| :--- | :--- | :--- | :--- |
| `speccore init` | Initialize SpecCore project | `/spec-init` | ✅ |
| `speccore import` | Import existing project | `/spec-import` | ✅ |

### Iteration Management

| Command | Description | Corresponding Slash Command | Deterministic |
| :--- | :--- | :--- | :--- |
| `speccore iteration create` | Create iteration | `/spec-iteration-create` | ✅ |
| `speccore iteration split` | Requirement splitting (requires AI task list) | `/spec-iteration-split` | ⚠️ |

### Task Management

| Command | Description | Corresponding Slash Command | Deterministic |
| :--- | :--- | :--- | :--- |
| `speccore task new` | Create atomic task | `/spec-new-task` | ✅ |

### Execution & Scheduling

| Command | Description | Corresponding Slash Command | Deterministic |
| :--- | :--- | :--- | :--- |
| `speccore plan` | Generate scheduling plan (DAG analysis) | `/spec-plan` | ✅ |
| `speccore execute` | Execute task (requires AI collaboration) | `/spec-execute` | ⚠️ |

### Validation & Review

| Command | Description | Corresponding Slash Command | Deterministic |
| :--- | :--- | :--- | :--- |
| `speccore validate` | Compliance check | `/spec-validate` | ✅ |
| `speccore progress` | View progress | `/spec-progress` | ✅ |
| `speccore status` | Project status | `/spec-status` | ✅ |
| `speccore health` | Health dashboard (4 dimensions, 12 metrics) | `/spec-health` | ✅ |
| `speccore report` | Generate project report | `/spec-report` | ✅ |

### Archive & Configuration

| Command | Description | Corresponding Slash Command | Deterministic |
| :--- | :--- | :--- | :--- |
| `speccore archive` | Archive task | `/spec-archive` | ✅ |
| `speccore config` | Configuration management | `/spec-config` | ✅ |

- **✅** Pure deterministic logic, fully executable by code
- **⚠️** Requires AI participation for understanding/generation (e.g., requirement splitting, code generation)

---

## Project Structure

```
speccore/
├── package.json
├── tsconfig.json
├── README.md
├── bin/
│   └── speccore                    # CLI entry script
├── src/
│   ├── index.ts                    # Entry file
│   ├── cli.ts                      # CLI command registration (Commander.js)
│   │
│   ├── commands/                   # All CLI command implementations
│   │   ├── init.ts                 # Initialize project
│   │   ├── import.ts               # Import existing project
│   │   ├── iteration/
│   │   │   ├── create.ts           # Create iteration
│   │   │   └── split.ts            # Requirement splitting
│   │   ├── task/
│   │   │   └── new.ts              # Create task
│   │   ├── plan.ts                 # Generate scheduling plan
│   │   ├── execute.ts              # Execute task
│   │   ├── validate.ts             # Compliance check
│   │   ├── archive.ts              # Archive task
│   │   ├── progress.ts             # View progress
│   │   ├── status.ts               # Project status
│   │   ├── health.ts               # Health dashboard
│   │   ├── report.ts               # Generate report
│   │   └── config.ts               # Configuration management
│   │
│   ├── core/                       # Core engine
│   │   ├── context.ts              # Context management (read context.json)
│   │   ├── state.ts                # State management (read PROJECT_GRAPH.md)
│   │   ├── yaml-parser.ts          # YAML parsing
│   │   ├── template-engine.ts      # Template rendering (Handlebars)
│   │   └── validator.ts            # Compliance check engine
│   │
│   ├── templates/                  # Built-in templates
│   │   ├── spec/                   # Spec file templates
│   │   │   └── project-readme.md
│   │   └── code/                   # Code generation templates
│   │       ├── spring-controller.java
│   │       ├── spring-service.java
│   │       ├── spring-test.java
│   │       └── nest-controller.ts
│   │
│   └── utils/
│       ├── file.ts                 # File utilities
│       ├── git.ts                  # Git utilities (get username, etc.)
│       └── logger.ts               # Logger (with progress bar, Spinner)
│
└── dist/                           # Compiled output (TypeScript → JavaScript)
```

---

## Development Guide

```bash
# Clone repository
git clone https://github.com/windfallsheng/SpecCore-ts.git
cd SpecCore-ts

# Install dependencies
npm install

# Compile TypeScript
npm run build

# Development mode (watch for file changes and auto-compile)
npm run watch

# Local testing
node bin/speccore --version

# Link to global (development testing)
npm link
speccore --version
```

---

## Related Projects

| Project | Description | GitHub | Gitee |
| :--- | :--- | :--- | :--- |
| **SpecCore** | Specification-driven development framework (methodology + file templates + Slash Commands) | [windfallsheng/SpecCore](https://github.com/windfallsheng/SpecCore) | [windfullsheng/spec-core](https://gitee.com/windfullsheng/spec-core) |
| **SpecCore** | CLI tool (deterministic operation execution engine) | [windfallsheng/SpecCore-ts](https://github.com/windfallsheng/SpecCore-ts) | [windfullsheng/spec-core-ts](https://gitee.com/windfullsheng/spec-core-ts) |

---

## FAQ

### Q: Command not found after installation?

A: Ensure npm global bin directory is in PATH:

```bash
# Check global installation path
npm bin -g

# Add to PATH (macOS/Linux)
export PATH="$(npm bin -g):$PATH"
```

### Q: How to update to latest version?

```bash
npm update -g speccore
```

### Q: How to uninstall?

```bash
npm uninstall -g speccore
```

### Q: How to integrate with AI tools?

A: AI tools (like WorkBuddy) execute deterministic operations by calling CLI commands. For example:

```bash
# When AI executes /spec-validate, it internally calls:
speccore validate --json

# AI reads JSON results and generates user-friendly reports
```

---

## Contributing

Welcome to submit Issues and Pull Requests!

1. Fork this repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -m 'feat: add some feature'`
4. Push branch: `git push origin feature/my-feature`
5. Create Pull Request

---

## Changelog

### v1.0.0 (2026-07-05)

- Initial release
- Supports 14 CLI commands
- Core engine: context management, state management, YAML parsing, template rendering, compliance checking
- Built-in templates: Spring Boot Controller/Service/Test, NestJS Controller
- Support JSON/Markdown/HTML multi-format output

---

## License

[MIT](https://opensource.org/licenses/MIT)

---

<p align="center">Built with ❤️ by the SpecCore Team</p>