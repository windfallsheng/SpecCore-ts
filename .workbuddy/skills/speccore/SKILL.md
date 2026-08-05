---
name: speccore
description: SpecCore spec-driven development CLI integration. Detects .speccore/ projects and enables AI-powered requirements, iteration management, global architecture layer, and intent recognition.
version: 1.0.0
triggers:
  - speccore
  - spec
  - 需求
  - 迭代
  - 规格
  - 全量层
  - 意图识别
  - requirement
  - iteration
  - global layer
  - 变更影响
  - 基线
  - 审计
---

# SpecCore — Spec-Driven Development CLI

This skill activates when the user opens a project containing a `.speccore/` directory, or when they mention spec-driven development, requirement management, or any Speccore command.

## Project Detection

A project is a Speccore project if `.speccore/` exists in the project root. Key files:
- `.speccore/CONSTITUTION.md` — tech stack constitution
- `.speccore/SETTINGS.md` — framework configuration
- `.speccore/GLOBAL/INDEX.md` — multi-project global requirement index
- `.speccore/PROJECT/INDEX.md` — local project index
- `.speccore/PROJECT/TEAM.md` — team members & git mapping
- `.speccore/ITERATIONS/README.md` — iteration index
- `.speccore/RULES/POST_COMPLETION.md` — post-completion maintenance rules
- `.speccore/local/context.json` — runtime context (current iteration, task, assignee)

## Multi-Project Global Layer

```
.speccore/GLOBAL/
├── INDEX.md          # Universal requirement catalog
├── OVERVIEW.md       # Cross-project panorama
├── ARCHITECTURE.md   # System architecture (mermaid)
├── TECH_STACK.md     # Unified tech stack registry
├── CODE_INDEX.md     # Code path mappings
├── GLOSSARY.md       # Cross-project glossary
├── PROTOTYPE_INDEX.md
├── CHANGELOG.md      # Global change log
├── BASELINES/        # Version baselines
└── PROJECTS/{proj}/  # Per-project requirements
```

## Speccore Commands Quick Reference

### Setup & Import
- `speccore init` — Initialize (already done)
- `speccore import --project=<name> [--type=backend|web|...] --path=<path>` — Import source code
- `speccore global-status` — View multi-project overview

### Spec-Driven Development
- `speccore spec "<natural language>"` — Smart entry via intent recognition
- `speccore goal --name="<name>" [--iteration=<it>]` — Create new requirement

### Iteration Management
- `speccore iteration create --name="<name>" [--goal=<goal>]` — Start iteration
- `speccore iteration-from-global [--project=<name>]` — Generate from global layer
- `speccore sync-global [--iteration=<name>]` — Sync back to global

### Analysis & Quality
- `speccore impact --req=<id>` — Change impact analysis
- `speccore audit [--strict]` — Quality audit (duplicates, conflicts)
- `speccore dashboard` — HTML dashboard
- `speccore history [--req=<id>]` — Change history

### Maintenance
- `speccore bugfix --title="<desc>"` — Quick bug fix
- `speccore change --req=<id> --desc="<desc>"` — Requirement change
- `speccore handover [--iteration=<name>]` — Handover document
- `speccore retro [--iteration=<name>]` — Retrospective
- `speccore rename --target=<old> --new-name=<new>` — Rename
- `speccore baseline create --name=<name>` — Version snapshot

## Working with Speccore Projects

1. **Always read `.speccore/local/context.json` first** to understand current state
2. **Before creating specs**, read `.speccore/CONSTITUTION.md` for conventions
3. **For multi-project work**, check `.speccore/GLOBAL/INDEX.md`
4. **Run commands directly** using `speccore` CLI
5. **After changes**, suggest running sync or audit

## Quick Aliases

| Alias | Command |
|-------|---------|
| in | init |
| imp | import |
| it | iteration |
| ex | expand |
| pl | plan |
| pg | program |
| ch | create |
| if | impact |
| bl | baseline |
| db | dashboard |
| ad | audit |
| sg | sync-global |
| gs | global-status |
| hs | history |
| ifg | iteration-from-global |
