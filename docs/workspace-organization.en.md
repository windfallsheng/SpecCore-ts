# Workspace Organization

> Recommended directory structure and collaboration workflow for SpecCore projects.

---

## 1. Recommended Structure

```
workspace/
├── spec-project/                 # SpecCore Spec repo (independent Git)
│   ├── .speccore/
│   ├── .codebuddy/commands/      # AI commands (symlinked from code repos)
│   ├── Iteration-2026-07-Meeting/
│   └── README.md
│
├── my-backend/                   # Backend code (independent Git)
│   ├── src/
│   └── .codebuddy/commands → ../spec-project/.codebuddy/commands
│
├── my-frontend/                  # Frontend code (independent Git)
│   ├── src/
│   └── .codebuddy/commands → ../spec-project/.codebuddy/commands
│
└── my-miniapp/                   # Mini-app code (independent Git)
    ├── src/
    └── .codebuddy/commands → ../spec-project/.codebuddy/commands
```

---

## 2. Benefits

| Aspect | Description |
| :--- | :--- |
| **Separation of concerns** | Specs and code managed independently |
| **Clear permissions** | Backend team owns code repos; Architect maintains Spec repo |
| **Multi-project sharing** | All code repos share the same Spec source of truth |
| **Command sharing** | AI commands shared via symlink, consistent behavior |
| **Independent versioning** | Specs and code versioned separately |
| **Newcomer friendly** | Clone Spec repo + your code repo and start coding |

---

## 3. Init Flow

### 3.1 Lead Setup

```bash
# 1. Create and init Spec repo
mkdir spec-project && cd spec-project
git init
speccore init

# 2. Import existing projects to global layer
speccore import --project=user-service --path=../my-backend --type=backend
speccore import --project=frontend-web --path=../my-frontend --type=web
speccore import --project=miniapp --path=../my-miniapp --type=miniapp

# 3. Create iteration from global layer
speccore iteration-from-global --reqs=REQ-001,REQ-002 --name=2026-07-Meeting

# 4. Push
git add . && git commit -m "chore: init spec project" && git push
```

### 3.2 Team Member Setup

```bash
# 1. Clone Spec repo
git clone git@github.com:org/spec-project.git

# 2. Clone code repos (sibling directories)
git clone git@github.com:org/my-backend.git
git clone git@github.com:org/my-frontend.git

# 3. Symlink AI commands
cd my-backend
ln -s ../spec-project/.codebuddy/commands .codebuddy/commands
```

---

## 4. Two Work Modes

| Mode | Use Case | How |
| :--- | :--- | :--- |
| **A: Work in Spec repo** | Central spec management, create iterations | Open `spec-project/`, all `/spec-*` commands available |
| **B: Work in code repo** | Writing code with spec commands | Create symlink in code repo, commands also available |

---

## 5. Path Mapping

| Layout | Symlink Command |
| :--- | :--- |
| Sibling | `ln -s ../spec-project/.codebuddy/commands .codebuddy/commands` |
| Nested | `ln -s ../../spec-project/.codebuddy/commands .codebuddy/commands` |

---

## 6. Repo Responsibilities

| Repo | Content | Commit Frequency | Maintainer |
| :--- | :--- | :--- | :--- |
| `spec-project/` | `.speccore/` + iterations + tasks | Per requirement change | Architect / Tech Lead |
| `my-backend/` | Backend code | Per code change | Backend team |
| `my-frontend/` | Frontend code | Per code change | Frontend team |

---

## 7. IDE Config (Optional)

```json
// my-backend/.vscode/settings.json
{
  "speccore.commandsPath": "../spec-project/.codebuddy/commands"
}
```

---

## 8. Alternatives Comparison

| Approach | Pros | Cons | Best For |
| :--- | :--- | :--- | :--- |
| **A: Independent Spec repo (recommended)** | Clean separation, multi-repo sharing | Symlink setup needed | Multi-team, multi-repo |
| **B: Spec inside code repo** | Simple, no setup | Spec tied to one repo | Solo project, prototype |
| **C: Monorepo** | Unified management | Large repo, permission issues | Small team, full-stack |

---

## 9. TL;DR

`spec-project/` serves as the spec hub. All code repos are sibling directories that share AI commands via symlink. Specs and code live separately.

---

## Related Docs

- [Quick Start](quick-start.en.md)
- [Usage Guide](usage-guide.en.md)
- [README](../README.en.md)
