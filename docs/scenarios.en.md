# SpecCore Scenario Guide

> Real-world development scenarios with step-by-step workflows.

---

## Scenario 1: Start a New Project

```bash
# 1. Initialize
cd my-project
speccore init

# 2. Import existing code to global layer
speccore import --project=backend --path=./src --type=backend
speccore import --project=frontend --path=./web --type=web

# 3. Create first iteration
speccore iteration create --name="2026-07-Auth" --goal="User auth system"

# 4. Create tasks
speccore new-task --name="User Login" --platforms=web,h5 --type=feature
speccore new-task --name="User Register" --platforms=web,h5 --type=feature
speccore new-task --name="Password Reset" --platforms=web --type=feature

# 5. Check progress
speccore progress --detail
```

---

## Scenario 2: Daily Development

```bash
# 1. View task plan and dependencies
speccore plan --iteration=2026-07-Auth

# 2. Start a task (auto-creates Git branch)
speccore execute --task=Task-001 --force
# → 🌿 Created branch: feature/Task-001-user-login

# 3. Check branch mapping
speccore current
speccore current --commit    # Generate commit message

# 4. Add @spec annotations in code
# // @spec Task-001-user-login
# @RestController
# public class AuthController { ... }

# 5. Reverse sync (code → Spec)
speccore sync --dry-run       # Preview
speccore sync                 # Write to TASK.md

# 6. View trace chain
speccore trace --task=Task-001

# 7. Mark complete
speccore update --task=Task-001 --status=completed

# 8. Archive
speccore archive --task=Task-001
```

---

## Scenario 3: Bug Fix

```bash
# 1. Create bug fix task
speccore bugfix --name="Login timeout" --desc="Token expiry causes 401"

# 2. Start fixing
speccore execute --task=Task-004 --force

# 3. Fix code + @spec annotation
# // @spec Task-004-login-timeout
# if (token.isExpired()) refreshToken();

# 4. Reverse sync
speccore sync

# 5. Record change
speccore change --req=REQ-001 --desc="Fix token expiry logic" --task=Task-004

# 6. Complete
speccore update --task=Task-004 --status=completed
```

---

## Scenario 4: Team Collaboration

```bash
# 1. Architect creates iteration and tasks
speccore iteration create --name="2026-07-Sprint"
speccore new-task --name="User Login" --platforms=web,h5
speccore new-task --name="User Register" --platforms=web,h5

# 2. Backend dev claims task
git checkout -b feature/Task-001   # or: speccore execute --task=Task-001 --force
speccore update --task=Task-001 --assignee=Zhang
speccore execute --task=Task-001 --force

# 3. Frontend dev claims task
git checkout -b feature/Task-002
speccore update --task=Task-002 --assignee=Li
speccore execute --task=Task-002 --force

# 4. Team progress
speccore progress --detail
speccore health

# 5. Impact analysis
speccore impact --req=REQ-001
# → Affects: Task-001, Task-002

# 6. Generate handover doc
speccore handover --iteration=2026-07-Sprint
```

---

## Scenario 5: Requirement Change

```bash
# 1. Analyze impact
speccore impact --req=REQ-001
# → Scope: Task-001(Login), Task-002(Register)

# 2. Create baseline (pre-change snapshot)
speccore baseline --name=before-change

# 3. Describe change
speccore change --req=REQ-001 --desc="Add SMS verification to login"

# 4. Update affected tasks
speccore update --task=Task-001 --status=in_progress

# 5. Compare before/after
speccore diff --source=before-change --target=current

# 6. Validate
speccore validate --iteration=2026-07-Sprint
```

---

## Scenario 6: Long Task Chain (Batch)

```bash
# 12 tasks, 3 per batch
speccore execute --all --batch-size=3 --dry-run    # Preview
speccore execute --all --batch-size=3 --force      # Execute

# Interrupted at batch 2...
# → Resume from batch 3
speccore execute --resume

# Interactive: manually select tasks
speccore execute --all --interactive
```

---

## Scenario 7: CI/CD Integration

```yaml
# .github/workflows/speccore-ci.yml
name: SpecCore Validate

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install SpecCore
        run: npm install -g speccore
      - name: Validate Specs
        run: speccore validate --full
      - name: Check Health
        run: speccore health
      - name: Progress Report
        run: speccore progress --format=json > progress.json
```

```bash
# Install Git hooks locally
speccore hooks install
# → pre-commit: check @spec annotations
# → pre-push: run speccore validate
```

---

## Scenario 8: Global Layer Management

```bash
# 1. View organization-wide requirements
speccore global-status

# 2. Pull from global pool to create iteration
speccore iteration-from-global --reqs=REQ-001,REQ-002,REQ-003 --name=2026-Q3-Sprint

# 3. Sync back after development
speccore sync-global --iteration=2026-Q3-Sprint

# 4. Track requirement change history
speccore history --req=REQ-001

# 5. Periodically rebuild index
speccore index-update
```

---

## Scenario 9: Shell v3 Migration

```bash
# 1. Install CLI
npm install -g speccore

# 2. Preview migration
cd old-speccore-project
speccore migrate --dry-run

# 3. Execute migration
speccore migrate

# 4. Verify
speccore validate
speccore global-status
```

---

## Scenario 10: Technology Research

```bash
# 1. Create research task
speccore research --topic="Message queue comparison" --options="Kafka,RabbitMQ,Pulsar"

# 2. Fill research doc (edit Task-xxx/backend/REQ.md + TECH.md)

# 3. Complete and archive
speccore update --task=Task-005 --status=completed
speccore archive --task=Task-005
```

---

## Scenario 11: Health Check

```bash
# 1. Overall health
speccore health

# 2. Platform-specific progress
speccore progress --platform=web --detail
speccore progress --platform=h5 --detail

# 3. Generate report
speccore report --format=html --output=report.html --team --risk

# 4. Visual dashboard
speccore dashboard --output=dashboard.html
```

---

## Scenario 12: Establish Baselines

```bash
# 1. Create baseline before release
speccore baseline --name=v2.0-release

# 2. Continue development for v2.1...

# 3. Compare versions
speccore diff --source=v2.0-release --target=2026-07-Sprint

# 4. Restore requirement if needed
speccore baseline --restore=v2.0-release --req=REQ-005

# 5. List baselines
speccore baseline --list
```

---

## Quick Reference

| Scenario | First Command | Core Flow |
| :--- | :--- | :--- |
| New Project | `speccore init` | `init → import → iteration create → new-task` |
| Daily Dev | `speccore execute --task=T-001` | `execute → sync → trace → update` |
| Bug Fix | `speccore bugfix --name="xxx"` | `bugfix → execute → sync → change` |
| Change Mgmt | `speccore impact --req=REQ-001` | `impact → baseline → change → validate` |
| Team Collab | `speccore progress --detail` | `update --assignee → execute → handover` |
| Long Chain | `speccore execute --all --batch-size=3` | `execute --resume` |
| CI/CD | `speccore hooks install` | hooks + GitHub Actions |
| Global Layer | `speccore global-status` | `iteration-from-global → sync-global` |
| Migration | `speccore migrate --dry-run` | migrate → validate |
| Health Check | `speccore health` | `progress → report → dashboard` |
