# SpecCore Scenario Guide

> Real-world development scenarios with step-by-step workflows.

## ⚠️ Command Types

Commands in this document fall into two categories:

| Mark | Type | How to Run | Examples |
|:---:|:---|:---|:---|
| ✅ | **CLI Commands** | Terminal: `speccore xxx` | `speccore init`, `speccore task new` |
| 🔒 | **AI Commands** | AI IDE: `@spec-ask "description"` | `execute`, `analyze`, `plan`, `pr`, `done`, `change` |

> 💡 **Important**: `speccore execute`, `speccore pr`, `speccore done`, `speccore change`, `speccore retro`, `speccore analyze`, `speccore plan`, `speccore doc2spec`, `speccore run` are 🔒 AI commands — **cannot run directly in terminal**. Use `@spec-ask` in WorkBuddy/Cursor/Trae instead.

---

## Scenario 1: Start a New Project

```bash
# 1. Initialize
cd my-project
speccore init

# 2. Create first iteration
speccore iteration create --name="2026-07-Auth" --goal="User auth system"

# 3. Create tasks
speccore task new --name="User Login" --platforms=web,h5 --type=feature
speccore task new --name="User Register" --platforms=web,h5 --type=feature
speccore task new --name="Password Reset" --platforms=web --type=feature

# 4. Check progress
speccore status
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

# 4. Add @spec annotations in code
# // @spec Task-001-user-login
# @RestController
# public class AuthController { ... }

# 5. Reverse sync (code → Spec)
speccore sync --dry-run       # Preview
speccore sync                 # Write to TASK.md

# 6. Verify spec-code links
speccore sync --detect

# 7. Mark complete
speccore update --task=Task-001 --status=completed

# 8. Archive
speccore done --task=Task-001
```

---

## Scenario 3: Bug Fix

```bash
# 1. Create bug fix task
speccore task new --name="Login timeout" --desc="Token expiry causes 401" --type=bugfix

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
speccore task new --name="User Login" --platforms=web,h5
speccore task new --name="User Register" --platforms=web,h5

# 2. Backend dev claims task
git checkout -b feature/Task-001   # or: speccore execute --task=Task-001 --force
speccore update --task=Task-001 --assignee=Zhang
speccore execute --task=Task-001 --force

# 3. Frontend dev claims task
git checkout -b feature/Task-002
speccore update --task=Task-002 --assignee=Li
speccore execute --task=Task-002 --force

# 4. Team progress
speccore status
```

---

## Scenario 5: Requirement Change

```bash
# 1. Describe change
speccore change --req=REQ-001 --desc="Add SMS verification to login"

# 2. Update affected tasks
speccore update --task=Task-001 --status=in_progress

# 3. Validate
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
        run: speccore validate --all
      - name: Check Health
        run: speccore dashboard --health
      - name: Progress Report
        run: speccore dashboard --export json > progress.json
```

```bash
# Install Git hooks locally
speccore config install
# → pre-commit: check @spec annotations
# → pre-push: run speccore validate
```

---

## Scenario 8: Global Layer Management

```bash
# 1. View organization-wide requirements
speccore status --scope global

# 2. Pull from global pool to create iteration
speccore iteration-from-global --reqs=REQ-001,REQ-002,REQ-003 --name=2026-Q3-Sprint

# 3. Sync back after development
speccore sync --global --iteration=2026-Q3-Sprint

# 4. Track requirement change history
speccore change -r REQ-001

# 5. Periodically rebuild index
```

---

## Scenario 9: Shell v3 Migration

```bash
# 1. Install CLI
npm install -g speccore

# 2. Preview migration
cd old-speccore-project

# 3. Execute migration

# 4. Verify
speccore validate
speccore status --scope global
```

---

## Scenario 10: Technology Research

```bash
# 1. Create research task
speccore task new --name="Message queue comparison" --type=research

# 2. Fill research doc (edit Task-xxx/backend/REQ.md + TECH.md)

# 3. Complete and archive
speccore update --task=Task-005 --status=completed
speccore done --task=Task-005
```

---

## Scenario 11: Health Check

```bash
# 1. Overall health
speccore dashboard --health

# 2. Platform-specific progress
speccore status --platform=web --detail
speccore status --platform=h5 --detail

# 3. Generate report
speccore dashboard --export html

# 4. Visual dashboard
speccore status
# Or one command:
speccore done --task=Task-001 --output=dashboard.html
```

---

---

## Quick Reference

| Scenario | First Command | Core Flow |
| :--- | :--- | :--- |
| New Project | `speccore init` | `init → iteration create → task new` |
| Daily Dev | `speccore execute -t Task-001` | `execute → verify → pr` |
| Bug Fix | `speccore task new --name="xxx" --type=bugfix` | `bugfix → execute → sync → change` |
| Change Mgmt | `speccore change --req=REQ-001` | `change → update → validate` |
| Team Collab | `speccore execute --assignee 张三` | `execute → sync` |
| Long Chain | `speccore execute --all --batch-size=3` | `execute --resume` |
| CI/CD | `speccore init` | hooks + GitHub Actions |
| Global Layer | `speccore iteration-from-global` | `iteration-from-global → sync --global` |
| Health Check | `speccore doctor` | `doctor` |

---

## Scenario 13: Clean Up

```bash
# 1. Delete a test task
speccore delete --task=Task-005-test

# 2. Delete entire test iteration (skip confirm)
speccore delete --iteration=2026-07-Test --force

# 3. Recover accidental delete (manual restore)
mv .speccore/trash/2026-07-Test-TIMESTAMP 2026-07-Test
```

---

## Scenario 14: Requirement Breakdown (Global → Iteration → Tasks)

```bash
# 1. View global requirement pool
speccore status --scope global
# → REQ-001  User Auth   Planned
# → REQ-002  Messaging   Planned

# 2. Pull requirements → create iteration
speccore iteration-from-global --reqs=REQ-001,REQ-002 --name=2026-Q3-Sprint

# 3. Preview taskify plan
speccore iteration taskify
# Strict: speccore iteration taskify --strict  (preview each section)
# Outputs: IMPACT.md (risk + dependencies), .env.example --iteration=2026-Q3-Sprint --dry-run

# 4. Execute taskify (auto-generates Task dirs + Spec stubs)
speccore iteration taskify --iteration=2026-Q3-Sprint

# 5. Check progress
speccore status --iteration=2026-Q3-Sprint --detail
```

### Simplified Flow (no global layer)

```bash
# Create iteration → manually add tasks
speccore iteration create --name=2026-07-Sprint --goal="User System"
speccore task new --name="User Login" --platforms=web,h5 --type=feature
speccore task new --name="User Register" --platforms=web --type=feature

# After filling REQ.md content, sync to global layer
speccore sync --global --iteration=2026-07-Sprint
```

---

## Scenario 15: Archive & Restore

```bash
# 1. Archive a single task
speccore done --task=Task-001

# 2. Archive all completed tasks in an iteration
speccore done --all --iteration=2026-07-Sprint

# 3. List archived tasks
speccore done --list

# 4. Restore an archived task
speccore done --restore=Task-001 --iteration=2026-07-Sprint
```

**When to use:** End of iteration cleanup, keeping completed tasks out of progress/execute.

---

## Scenario 16: Mid-development Requirement Changes

```bash
# 1. Record the change
speccore change --req=REQ-001 --desc="Add SMS verification to login" --task=Task-001

# 2. Manually update affected Spec files
#    Edit Task-001/backend/REQ.md
#    Edit Task-001/_shared/API_CONTRACT.yaml

# 3. Update task status
speccore update --task=Task-001 --status=in_progress

# 4. Re-sync to global layer
speccore sync --global --iteration=2026-07-Sprint

# 5. Validate
speccore validate
```

### Major Iteration Overhaul

```bash
# 1. Process each task: change → edit Spec → validate

# 2. If entire iteration needs a restart
speccore delete --iteration=2026-07-Sprint-old --force
speccore iteration-from-global --reqs=REQ-001,REQ-002 --name=2026-07-Sprint-new
```

**Mantra:** `change → edit Spec → validate`

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
speccore config install
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
speccore task new --name="User Login" --platforms=web --type=feature

# ❌ Don't delete and recreate — add the platform in .speccore/PROJECT.yaml
#    (platforms list), then re-run taskify for the module.
# Then manually edit Task-001/_shared/TASK.md for h5 responsibilities
```

### Too many platforms

```bash
# Created with web,h5,miniapp but only doing web
speccore task new --name="Admin Panel" --platforms=web,h5,miniapp --type=feature

# Just run/filter by web — other platforms are skipped, no errors
speccore execute --platform=web
speccore status --platform=web
```

### Add new platform to project

```bash
# Add the platform in .speccore/PROJECT.yaml (platforms list)
# Now task new can use tablet
speccore task new --name="xxx" --platforms=web,tablet
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
speccore status --iteration=2026-07-Sprint --detail

speccore dashboard --export html
```

### Git branch confusion

```bash
# Check which task the current branch maps to

# Re-associate
git checkout feature/Task-001-user-login
speccore execute --task=Task-001 --force

# Generate correct commit message
```

### Suspect Spec vs code mismatch

```bash
# Scan @spec annotations in code
speccore sync --dry-run

# Actual sync
speccore sync

# Verify trace chain
speccore sync --detect
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

## Scenario 22: Auto-Validate on Save — `speccore watch` [已废弃]

> ⚠️ `speccore watch` 命令已在 v8.3.60 彻底移除。文件变更监听由宿主 IDE（Qoder/Trae/Cursor 等）的原生文件监听功能替代。

### 替代方案

使用宿主 IDE 的文件保存钩子或终端手动运行：

```bash
# 手动运行 validate（推荐）
speccore validate

# 批量修复
speccore validate --fix
```

### 历史说明

`watch` 命令在 v8.3.60 之前使用 Node.js `fs.watch` 监听文件变更并自动触发 `validate`。由于跨平台兼容性问题（不同 OS 的 fs.watch 行为不一致）以及与宿主 IDE 功能重复，该命令已移除。

---

## Scenario 23: Requirement Import (Word + Markdown)

**Background**: PM provides requirements in various formats — Word (.docx/.doc) and Markdown (.md), for different platforms and backend services.

### Word Conversion

```bash
# Batch: one command, all files
speccore doc2spec --files \
  "backend-prd.docx=backend-admin,backend-api.docx=backend-h5,web.docx=web,mobile.docx=mobile" \
  -i Q3
```

### Markdown Direct Import

```bash
# .md files — no pandoc needed
speccore doc2spec --files \
  "api-docs.md=backend-admin,web-pages.md=web,mobile-screens.md=mobile" \
  -i Q3

# Mix Word + Markdown
speccore doc2spec --files "backend.docx=backend-admin,web.md=web" --iter=Q3
```

### Generated File Structure

| File | Type | Purpose |
| :--- | :--- | :--- |
| `{platform}-requirements.md` | Manual | Per-platform standalone requirement doc |
| `REQUIREMENT.md` | **Auto-generated** | Aggregated view for `iteration taskify` |
| `INDEX.md` | **Auto-generated** | Platform index for automatic detection |

### When Requirements Change

| Source | Action |
| :--- | :--- |
| New Word doc from PM | Re-run `doc2spec --files` (overwrites per-platform + refreshes REQUIREMENT.md) |
| Minor dev tweak | Use `speccore change --task=Task-001 --desc="xxx"` |
| Adjust platform split | Edit `{platform}-requirements.md`, then re-`doc2spec` |
| Sync to global | `speccore sync --global` |

> ⚠️ `REQUIREMENT.md` and `INDEX.md` are derived files — next `doc2spec` will overwrite them. **Do not manually edit.**

---

## Scenario 24: Task Lifecycle

```bash
speccore status --lifecycle                  # Show task lifecycle board
speccore dashboard                           # Kanban board
speccore task new --name=Task-001-fix --type=bugfix  # Create fix task
speccore status                              # Check TEST/REVIEW progress
```

## Scenario 25: Task Output Files

Each task now generates 8 files:

| File | Purpose | When |
| :--- | :--- | :--- |
| REQ.md | Requirements | Always |
| TECH.md | Tech plan | Always |
| TASK.md | Task tracking | Always |
| TEST.md | Test outline | Always |
| REVIEW.md | Review checklist | Always |
| SCHEMA.md | DB DDL/indexes | Only DB-related |
| DEPLOY.md | Deploy checklist | Always |
| .risk | Risk score | Always |

Iteration outputs: IMPACT.md (risk + deps), .env.example

## Scenario 26: Multi-Developer Parallel Work

**Background**: Alice works on Task-001, Bob works on Task-002 — need conflict-free parallel development.

**Steps**:
```bash
# Alice
git checkout -b 260715-order-management-alice
vim iteration-Q3/Task-001-OrderManagement/backend/REQ.md
speccore execute --task=Task-001 --force
speccore sync --task=Task-001 --detect

# Bob (simultaneously)
git checkout -b 260715-user-auth-bob
vim iteration-Q3/Task-002-UserAuth/backend/REQ.md
speccore execute --task=Task-002 --force
speccore sync --task=Task-002 --detect
```

**Key Rules**:

| Rule | Note |
| :--- | :--- |
| Different Tasks | No conflicts, fully parallel |
| Same Task | Never edit the same platform (backend/frontend) simultaneously |
| Global config | Coordinate when changing GLOBAL/* or CONSTITUTION |
| Before PR merge | Each runs `speccore sync --detect` to confirm consistency |

**Verify**:
```bash
speccore status              # Overall progress
speccore doctor --task=Task-001  # Health check
```

---

## Scenario 25: Task Wrap-Up

**Background**: Task development complete, PR merged. Run the full wrap-up pipeline.

**Steps**:
```bash
# 1. Final consistency check
speccore sync --task=Task-001 --detect
speccore validate

# 2. Archive (close task, clean hotfix flags)
speccore done --task=Task-001

# 4. Sync iteration requirements to global
speccore sync --global --iteration=Q3 --direction=to_global

# 5. Update context (mark as done)

# 6. View final dashboard
speccore dashboard
# Or one command:
speccore done --task=Task-001
```

**AI dialog equivalent**:
```
"Wrap up Task-001"
"Archive and sync to global"
```

---

## Scenario 26: Troubleshooting

### Corrupted/Lost context.json

```bash
# Symptom: every command reports "cannot find current iteration"
# Fix
# 💬 "Relocate current iteration"
```

### Corrupted .speccore/ Configuration

```bash
# Symptom: all commands fail with strange errors
# Fix: reinitialize (does not delete existing data)
speccore init --force               # Force rebuild .speccore/
# 💬 "Reinitialize SpecCore"
```

### Git Conflicts in Spec Files

```bash
# Symptom: git merge conflicts in .md files
# Fix: SpecCore files use timestamps — keep the newer one
speccore validate --fix             # Auto-fix common format issues
# 💬 "Validate and fix Spec format issues"
```

## Scenario 29: Dependent Task Branching

When tasks depend on each other, branch from the dependency to avoid entity duplication.

```bash
# 1. Check dependencies
cat iteration-001-Q3/IMPACT.md
# | Task-002: OrderQuery | -> | Task-001: UserMgmt | `/api/users` |

# 2. Execute dependency-free task first
speccore execute --task=Task-001 --force
# -> 🌿 Created branch: feature/Task-001-UserMgmt

# 3. Execute dependent task (auto-detect base)
speccore execute --task=Task-002 --force
# -> 🔗 Dependency detected -> 🎯 Branching from Task-001
# -> 🌿 Created branch: feature/Task-002-OrderQuery (from feature/Task-001-UserMgmt)
```

**Result**: Task-002 inherits Task-001's entities. Merge produces incremental changes only.

**Custom base branch** in `.speccore.yml`:
```yaml
git:
  default_base: develop
```

## Scenario 30: Post-Execution Question Review

After `analyze`, `execute`, or `done`, SpecCore extracts pending questions from ANALYSIS.md and shows a checklist:

```bash
speccore execute --task=Task-001 --force
# -> Execution complete!
# -> ╔══════════════════════════════════════════╗
# -> ║  📋 Post-Execution Review (14 items)     ║
# -> ╚══════════════════════════════════════════╝
# -> 🟡 Pending:
# ->   - API table definition missing
# ->   - Data model not described
# ->   - Source code mapping not found
# -> 💡 Tip: Confirm all items before speccore done
```

This is especially useful in non-strict mode where AI may have skipped uncertain parts.
