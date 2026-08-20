# SpecCore v6.89.0 Release Notes

## Overview

This release introduces the **Unified Injection Framework (ContextInjector)**, completing the five-layer specification database architecture that aligns SpecCore with modern AI coding assistant standards.

---

## What's New

### v6.85.0 — RULES Coding Standards Library
- **8 built-in coding standards**: TypeScript, React, Vue, Node.js, API Design, Testing, Security, Database, Frontend Common
- **Auto-injection by tech stack**: `execute` phase automatically loads matching rules from `CONSTITUTION.md`
- **User overrides**: Place custom `.md` files in `.speccore/RULES/` to override built-ins

### v6.86.0 — AGENTS Extended to All Phases
- **11 new professional roles**: task-decomposer, dependency-analyst, schedule-planner, risk-assessor, impact-analyst, code-reviewer, test-reviewer, regression-tester, compliance-checker, performance-expert, doc-sync-agent
- **Phase coverage**: analyze → split → plan → execute → change → pr → audit
- **Hybrid scheduler**: Registry (`_INDEX.md`) + Self-describing (`.md` frontmatter) merged

### v6.87.0 — COMMANDS Template System
- **3 built-in templates**: pr-review, change-impact, refactor
- **Variable substitution**: `{{key}}` syntax for dynamic prompt generation
- **Fallback strategy**: Templates missing → hard-coded prompts automatically

### v6.88.0 — SKILLS + HOOKS
- **4 built-in skills**: deployment, db-migration, caching, logging
- **2 built-in hooks**: pre-execute (branch protection), post-execute (quality gate)
- **Lifecycle interception**: `BLOCK:` marker in hooks can stop command execution

### v6.89.0 — Unified Injection Framework
- **Single API**: `injectAll()` composes all five layers on demand
- **Simplified APIs**: `injectAgents()`, `injectRules()` for quick access
- **Build fix**: `build-post.js` ensures `.md` assets are copied to `dist/`

---

## Migration Guide

No breaking changes. Existing projects continue to work. To opt-in:

```bash
# Re-init to get new directories
speccore init --force

# Or manually create directories
mkdir -p .speccore/{AGENTS,RULES,COMMANDS,SKILLS,HOOKS}
```

---

## Stats

- **83 files changed**
- **5,227 lines added**
- **5 new core modules**
- **39 new default specification files**

---

## Full Changelog

See [CHANGELOG.md](CHANGELOG.md) and [CHANGELOG.en.md](CHANGELOG.en.md).
