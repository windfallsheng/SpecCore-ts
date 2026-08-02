# SpecCore — Tool Adaptation Guide

> SpecCore automatically creates AI tool integration files via `speccore init`. This document explains the mechanism and configuration.

---

## 1. Supported AI Tools

| Tool | Region | Integration Method | Status |
| :--- | :--- | :--- | :--- |
| **WorkBuddy** | CN | `.workbuddy/skills/speccore/SKILL.md` + `.workbuddy/memory/MEMORY.md` | ✅ |
| **Qcoder** | CN | Via AI command templates | ✅ |
| **Trae** | CN | Via AI command templates | ✅ |
| **Cursor** | Global | Via AI command templates | ✅ |
| **Claude Code** | Global | Via AI command templates | ✅ |
| **Windsurf** | Global | Via AI command templates | ✅ |
| **Gemini CLI** | Global | Via AI command templates | ✅ |
| **OpenCode** | Global | Via AI command templates | ✅ |

> 💡 SpecCore natively integrates WorkBuddy.

---

## 2. WorkBuddy Integration

`speccore init` automatically creates the following during project initialization:

```
my-project/
├── .workbuddy/
│   ├── memory/
│   │   └── MEMORY.md                    # Project memory (tells WorkBuddy about Speccore structure)
│   └── skills/
│       └── speccore/
│           └── SKILL.md                 # Speccore Skill (all commands and workflows)
└── .speccore/                           # Speccore data (single source of truth)
```

### MEMORY.md

Tells WorkBuddy this is a Speccore project:
- `.speccore/` is the single source of truth for specs
- `speccore` CLI is the authoritative tool
- Key paths (GLOBAL layer, config, patterns)

### SKILL.md (Speccore Skill)

Teaches WorkBuddy Speccore commands and best practices:
- **Command cheat sheet**: 52 commands organized by category
- **Global layer**: GLOBAL/ directory architecture
- **Intent recognition**: Natural language matching rules
- **Directory structure**: Iteration → Task → multi-platform frontend specs
- **Development workflow**: From import to execution
- **Alias reference**: All command shortcuts

---

## 3. How It Works

```
1. User initializes project
   speccore init
        │
        ├→ Creates .speccore/ directory structure
        └→ Creates .workbuddy/ skill + memory files

2. User opens project in WorkBuddy
        │
        └→ WorkBuddy auto-loads .workbuddy/skills/speccore/SKILL.md

3. User chats in WorkBuddy
   "Create a user login feature"
        │
        ├→ Speccore Skill activates
        └→ AI calls: speccore task new --name="UserLogin"

4. CLI executes deterministic operations
        │
        ├→ Creates task directory structure
        ├→ Generates spec template files
        └→ Updates context state
```

---

## 4. CLI ↔ AI Command Mapping

| CLI Command | AI Slash Command | Purpose |
| :--- | :--- | :--- |
| `speccore init` | `/spec-init` | Initialize project |
| `speccore import` | `/spec-import` | Import project |
| `speccore task new` | `/spec-new-task` | Create multi-platform task |
| `speccore iteration create` | `/spec-iteration-create` | Create iteration |
| `speccore execute` | `/spec-execute` | Execute development |
| `speccore progress` | `/spec-progress` | View progress |
| `speccore validate` | `/spec-validate` | Compliance check |
| `speccore impact` | `/spec-impact` | Impact analysis |
| `speccore audit` | `/spec-ai-audit` | AI audit |

---

## 5. Update Mechanism

### Update Speccore CLI

```bash
npm update -g speccore
```

After update, CLI files auto-upgrade. Re-run `speccore init --force` to regenerate WorkBuddy integration files.

### Refresh Skill Files

```bash
# Re-initialize in project directory (overwrites .workbuddy/ skill)
speccore init --force
```

> ⚠️ Note: `--force` regenerates all template files including `.speccore/` content. Back up customizations first.

---

## 6. Security

Speccore CLI generated Skill files follow WorkBuddy security guidelines:
- ✅ No system command injection
- ✅ No access to user personal files
- ✅ Only operates on `.speccore/` data within the project directory
- ✅ All file I/O through `speccore` CLI commands
