# Project Memory — Speccore Managed

This project uses **SpecCore** (`speccore` CLI) for spec-driven development.

## Key Paths

| Path | Purpose |
|------|---------|
| `.speccore/` | All SpecCore data — **source of truth for requirements** |
| `.speccore/GLOBAL/INDEX.md` | Multi-project requirement catalog |
| `.speccore/CONSTITUTION.md` | Tech stack and naming conventions |
| `.speccore/SETTINGS.md` | Framework configuration |
| `.speccore/local/context.json` | Runtime context (current iteration, task) |
| `.speccore/PATTERNS/TEMPLATES/` | Code pattern templates |

## Workflow

1. `speccore init` — first-time setup (already done)
2. `speccore import --project=<name>` — import source code
3. `speccore goal` — create requirements
4. `speccore iteration create` — start iteration
5. `speccore spec "<query>"` — smart entry via intent recognition

## Important Conventions

- All requirements live in `.speccore/`, not in `.workbuddy/`
- `speccore` CLI is the authoritative tool for spec management
- Use `speccore spec "..."` for natural language command matching
- The GLOBAL layer enables cross-project requirement tracking
