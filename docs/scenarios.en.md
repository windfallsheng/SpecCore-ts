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

---

## Scenario 13: Clean Up

```bash
# 1. Delete a test task
speccore delete --task=Task-005-test

# 2. Delete entire test iteration (skip confirm)
speccore delete --iteration=2026-07-Test --force

# 3. Recover accidental delete (manual restore)
mv .speccore/trash/2026-07-Test-TIMESTAMP 2026-07-Test
speccore index-update
```

---

## Scenario 14: Requirement Breakdown (Global → Iteration → Tasks)

```bash
# 1. View global requirement pool
speccore global-status
# → REQ-001  User Auth   Planned
# → REQ-002  Messaging   Planned

# 2. Pull requirements → create iteration
speccore iteration-from-global --reqs=REQ-001,REQ-002 --name=2026-Q3-Sprint

# 3. Preview split plan
speccore iteration split --iteration=2026-Q3-Sprint --dry-run

# 4. Execute split (auto-generates Task dirs + Spec stubs)
speccore iteration split --iteration=2026-Q3-Sprint

# 5. Check progress
speccore progress --iteration=2026-Q3-Sprint --detail
```

### Simplified Flow (no global layer)

```bash
# Create iteration → manually add tasks
speccore iteration create --name=2026-07-Sprint --goal="User System"
speccore new-task --name="User Login" --platforms=web,h5 --type=feature
speccore new-task --name="User Register" --platforms=web --type=feature

# After filling REQ.md content, sync to global layer
speccore sync-global --iteration=2026-07-Sprint
```

---

## Scenario 15: Archive & Restore

```bash
# 1. Archive a single task
speccore archive --task=Task-001

# 2. Archive all completed tasks in an iteration
speccore archive --all --iteration=2026-07-Sprint

# 3. List archived tasks
speccore archive --list

# 4. Restore an archived task
speccore archive --restore=Task-001 --iteration=2026-07-Sprint
```

**When to use:** End of iteration cleanup, keeping completed tasks out of progress/execute.

---

## Scenario 16: Mid-development Requirement Changes

```bash
# 1. Create pre-change baseline
speccore baseline --name=before-login-change

# 2. Analyze impact
speccore impact --req=REQ-001
# → Affects: Task-001(Login), Task-003(Permissions)

# 3. Record the change
speccore change --req=REQ-001 --desc="Add SMS verification to login" --task=Task-001

# 4. Manually update affected Spec files
#    Edit Task-001/backend/REQ.md
#    Edit Task-001/_shared/API_CONTRACT.yaml

# 5. Update task status
speccore update --task=Task-001 --status=in_progress

# 6. Re-sync to global layer
speccore sync-global --iteration=2026-07-Sprint

# 7. Compare before/after
speccore diff --source=before-login-change --target=2026-07-Sprint

# 8. Validate
speccore validate
```

### Major Iteration Overhaul

```bash
# 1. Snapshot first
speccore baseline --name=before-refactor

# 2. Process each task with impact → change → edit Spec → validate

# 3. If entire iteration needs a restart
speccore delete --iteration=2026-07-Sprint-old --force
speccore iteration-from-global --reqs=REQ-001,REQ-002 --name=2026-07-Sprint-new
```

**Mantra:** `baseline → impact → change → edit Spec → validate`

---

## Scenario 17: Spec Validation Errors — How to Fix

```bash
# 1. Check entire project
speccore validate
# → ❌ Task-001/backend/REQ.md: Missing "## 3. API Definition" section
# → ❌ Task-002/_shared/API_CONTRACT.yaml: YAML syntax error line 15

# 2. Check specific task
speccore validate --task=Task-001

# 3. Auto-fix (fill missing sections)
speccore validate --task=Task-001 --fix

# 4. JSON output (for CI)
speccore validate --format=json

# 5. Install Git hooks (validate before push)
speccore hooks install
```

**Common errors:**
- REQ.md missing sections (use `--fix` to auto-fill)
- API_CONTRACT.yaml indentation (align to 2 spaces)
- PROJECT_GRAPH.md broken format (don't edit manually, use commands)

---

## Scenario 18: Platform Pitfalls

### Forgot a platform

```bash
# Created with web only, later need h5
speccore new-task --name="User Login" --platforms=web --type=feature

# ❌ Don't delete and recreate — just add the platform
speccore platform-add --name=h5 --tech="H5 Mobile"
# Then manually edit Task-001/_shared/TASK.md for h5 responsibilities
```

### Too many platforms

```bash
# Created with web,h5,miniapp but only doing web
speccore new-task --name="Admin Panel" --platforms=web,h5,miniapp --type=feature

# Just run/filter by web — other platforms are skipped, no errors
speccore execute --platform=web
speccore progress --platform=web
```

### Add new platform to project

```bash
speccore platform-add --name=tablet --description="Tablet UI" --tech="React Native"
# Now new-task can use tablet
speccore new-task --name="xxx" --platforms=web,tablet
```

---

## Scenario 19: File Operation Mistakes

### Manually edited PROJECT_GRAPH.md

```bash
# ❌ Edited PROJECT_GRAPH.md status table directly
# Result: next execute/plan overwrites your manual changes

# ✅ Correct approach
speccore update --task=Task-001 --status=completed
speccore plan --iteration=2026-07-Sprint
```

### Manually edited context.json

```bash
# ❌ Edited .speccore/local/context.json currentTask directly
# Result: next command reads stale values

# ✅ Correct approach
speccore execute --task=Task-003  # Auto-updates currentTask
```

### Manually deleted a Task folder

```bash
# ❌ rm -rf 2026-07-Sprint/Task-005
# Result: orphan references in INDEX.md, wrong context counts

# ✅ Fix
speccore index-update             # Clean index
speccore validate                 # Check consistency

# ✅ Proper way
speccore delete --task=Task-005   # Safe delete
```

---

## Scenario 20: State Recovery

### Lost track of progress

```bash
# 1. View current context
speccore context --task=Task-001

# 2. Overall progress
speccore progress --iteration=2026-07-Sprint --detail

# 3. Health check
speccore health

# 4. Generate handover report
speccore handover --iteration=2026-07-Sprint
speccore report --format=html --output=status.html --team
```

### Git branch confusion

```bash
# Check which task the current branch maps to
speccore current

# Re-associate
git checkout feature/Task-001-user-login
speccore execute --task=Task-001 --force

# Generate correct commit message
speccore current --commit
```

### Suspect Spec vs code mismatch

```bash
# Scan @spec annotations in code
speccore sync --dry-run

# Actual sync
speccore sync

# Verify trace chain
speccore trace --task=Task-001
```

---

## Scenario 21: Cross-Spec Search

```bash
# 1. Search all Specs for a keyword
speccore search "payment"
# → Task-003/backend/REQ.md:12  payment API design
# → .speccore/GLOBAL/INDEX.md:3  REQ-005 payment module

# 2. Limit search to a task
speccore search "authentication" --task=Task-001

# 3. Limit to iteration
speccore search "API" --iteration=2026-07-Sprint
```

---

## Scenario 22: Auto-Validate on Save — `speccore watch`

### Comparison: Manual vs Watch

| | Manual `validate` | `speccore watch` |
| :--- | :--- | :--- |
| **Feedback timing** | Run command after writing | Instant on save |
| **Error discovery** | After the fact (easy to forget) | Immediately (seconds) |
| **YAML indentation** | `--fix` batches | 1st save catches Tab issues |
| **REQ missing sections** | 3-4 errors at once | Each caught separately |
| **Usage** | Type command every time | Open terminal, hands-off |

### Workflow

```bash
# Terminal 1: start watch
speccore watch
# → 👀 Watching Spec files... (Ctrl+C to stop)

# Terminal 2: edit Spec files
vim Task-001/backend/REQ.md

# Every Ctrl+S → Terminal 1 gives instant feedback:
#   ✅ Task-001/backend/REQ.md
#   ⚠️ Task-001/_shared/API_CONTRACT.yaml (tab indentation — use 2 spaces)
#   ⚠️ Task-001/backend/REQ.md (missing: API Definition, Acceptance Criteria)

# Watch specific iteration only
speccore watch --iteration=2026-07-Sprint
```

### Without watch (comparison)

```bash
# Edit Spec... Ctrl+S
# Edit Spec... Ctrl+S
# Edit Spec... Ctrl+S
# (No feedback throughout, no idea if there are issues)

# Run once at the end
speccore validate
# → ❌ 3 errors → fix one by one → run validate again → fix more...
```
