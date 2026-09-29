# SpecCore Quick Reference

> Common commands + safety rules + CI template — all on one page.

---

## 🔧 CLI Commands (speccore prefix, terminal-safe)

```bash
speccore init                         # Initialize project
speccore iteration create --name=<n>  # Create iteration
speccore task new --platforms=<p1>,<p2>  # Create multi-platform task
speccore run                          # Smart resume (v8.3.290+): detect breakpoint, continue from first unfinished phase
speccore run develop                  # preset by name
speccore run split to execute         # phase range (natural language)
speccore run split..execute           # phase range (compact)
speccore run "build a points feature" # one-liner requirement
speccore validate                     # Compliance check
speccore dashboard                    # View progress
speccore sync                         # Reverse sync @spec → TASK.md
speccore diff --source=A --target=B   # Compare iterations
speccore track --req=REQ-001          # Trace chain
speccore delete -t Task-005           # Safe delete (trash + clean refs)
speccore search "payment"             # Cross-spec search
```

## 🔒 AI Commands (use @spec-ask in AI IDE: WorkBuddy/Cursor/Trae)

```bash
@spec-ask "execute all tasks with batch size 3"
@spec-ask "analyze Q1 requirements"
@spec-ask "plan execution schedule"
@spec-ask "create PR for Task-001"
@spec-ask "archive completed tasks"
```

## 📁 File Safety Rules

```
✅ Safe (edit directly)    ❌ Danger (use commands)
REQ.md  requirements       PROJECT_GRAPH.md  tables
TECH.md design             .task-type        type
*.md    comments           API_CONTRACT.yaml API
                           .json  data files
⚠️ Caution (sync after)
GLOBAL/REQUIREMENT.md → speccore sync --global
```

## 🏗️ Workspace

```
workspace/
├── spec-project/       ← Spec repo (independent)
├── my-backend/         ← Code repo (sibling)
│   └── .codebuddy/commands → ../spec-project/.codebuddy/commands
└── my-frontend/
```

## 📊 CI/CD

```yaml
# .github/workflows/speccore-ci.yml
- run: npm install -g speccore
- run: speccore validate --all
- run: speccore doctor
```

## 🔗 Key Links

- [SDD Methodology](sdd-methodology.en.md)
- [Quick Start](quick-start.en.md)
- [Command Reference](commands.en.md)
- [Usage Guide](usage-guide.en.md)
- [Workspace Layout](workspace-organization.en.md)
