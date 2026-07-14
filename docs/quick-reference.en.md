# SpecCore Quick Reference

> Common commands + safety rules + CI template — all on one page.

---

## 🔧 CLI Commands (speccore prefix)

```bash
speccore init                         # Initialize project
speccore import --project=<n> --path=<p>  # Import to global layer
speccore iteration create --name=<n>  # Create iteration
speccore new-task --platforms=web,h5  # Create multi-platform task
speccore execute --all --batch-size=3 # Batch execution
speccore validate                     # Compliance check
speccore progress --platform=web      # View progress
speccore update --task=T-001 --status=completed  # Update status
speccore sync                         # Reverse sync @spec → TASK.md
speccore diff --source=A --target=B   # Compare iterations
speccore trace --req=REQ-001          # Trace chain
speccore backup                       # Backup state
speccore delete --task=Task-005           # Safe delete (trash + clean refs)
speccore search "payment"                 # Cross-spec search
speccore watch                            # Auto-validate on save
speccore current --commit             # Generate commit message
```

## 🤖 AI Commands (/spec prefix, in AI tools)

```
/spec-init  /spec-new-task  /spec-execute  /spec-validate
/spec-progress  /spec-update  /spec-trace  /spec-diff
```

## 📁 File Safety Rules

```
✅ Safe (edit directly)    ❌ Danger (use commands)
REQ.md  requirements       PROJECT_GRAPH.md  tables
TECH.md design             .task-type        type
*.md    comments           API_CONTRACT.yaml API
                           .json  data files
⚠️ Caution (sync after)
GLOBAL/REQUIREMENT.md → speccore sync-global
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
- run: speccore validate --full
- run: speccore health
```

## 🔗 Key Links

- [SDD Methodology](sdd-methodology.en.md)
- [Quick Start](quick-start.en.md)
- [Command Reference](commands.en.md)
- [Usage Guide](usage-guide.en.md)
- [Workspace Layout](workspace-organization.en.md)
