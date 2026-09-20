# SpecCore Configuration Reference

> v8.3.25+ splits config into two files: system config `.speccore.yml` + project config `.speccore/PROJECT.yaml`. Quick lookup: `speccore config --list` / `speccore config --list --project`.

---

## 1. Why Two Files

v8.3.25+ splits configuration into **system config** and **project config** to satisfy two independent needs:

| File | Type | Manages | Change frequency | Upgrade trigger |
|------|------|---------|------------------|-----------------|
| `.speccore.yml` | System config | CLI runtime behavior, quality gates, arbitration, Ask engine | With CLI version | On CLI upgrade |
| `.speccore/PROJECT.yaml` | Project config | Project mapping, platforms, Git, code scope | With project evolution | On project structure change |

**Independent upgrades**: a CLI upgrade may change `.speccore.yml` structure without forcing project config to change. Each file has its own `schema_version`, upgraded independently.

**Separate diff reports**:
- System config diff → `.speccore/config/upgrade-diff-system.md`
- Project config diff → `.speccore/config/upgrade-diff-project.md`

Before v8.3.24, config was scattered across multiple files:

| Old file | Content | Problem |
|----------|---------|---------|
| `.speccore/CONSTITUTION.md` | Platforms, tech stack, naming | Markdown tables, fragile machine parsing |
| `.speccore/SETTINGS.md` (deprecated) | Runtime behavior | Key-value tables, no validation |
| `.speccore/config/ask.json` | Ask routing, LLM providers | JSON, inconsistent with CLI style |
| `.speccore.yml` (early) | Project info, Git, quality gates | Incomplete domains |

---

## 2. Full Config Example

```yaml
schema_version: 1

project:
  name: my-project
  description: Example project
  version: 1.0.0

tech_stack:
  backend: TypeScript / NestJS
  frontend: Vue 3 / Element Plus
  database: PostgreSQL
  cache: Redis
  mq: RabbitMQ

team:
  members:
    - name: alice
      role: lead
      assignee: true
    - name: bob
      role: developer
      assignee: true

platforms:
  - name: app
    type: frontend
    description: Mobile app
    code_path: ./packages/app
    git_repo: git@github.com:my-org/app.git
    default_branch: main
  - name: admin
    type: frontend
    description: Admin console
    code_path: ./packages/admin
    git_repo: git@github.com:my-org/admin.git
    default_branch: main
  - name: api
    type: backend
    description: Backend API service
    code_path: ./packages/api
    git_repo: git@github.com:my-org/api.git
    default_branch: main

git:
  default_base: main
  branch_prefix: feature/
  protected_branches:
    - main
    - master
    - release/*
    - production

code_scope:
  - src/
  - packages/*/src/

conventions:
  commit: conventional-commits
  naming:
    interface: /api/v1/{module}/{operation}
    error_code: 4-digit-by-module
    database: snake_case
    code: camelCase / PascalCase
  review: true

error_codes:
  - code: 1001
    meaning: User not found
    scenario: Login with unregistered phone number
  - code: 1002
    meaning: Wrong password
    scenario: Password mismatch on login

quality_gates:
  enforce_testing: true
  enforce_review: true
  require_pr: true

arbitration:
  enabled: true
  mode: full

settings:
  assignee:
    enabled: true
    mode: loose
  trace:
    enabled: true
    auto_annotate: true
  archive:
    auto_cleanup: false
  plan:
    parallel_suggest: true
  validation:
    strict_mode: false
  sync:
    auto_check: true
  patterns:
    auto_save: smart
  review:
    check_assignee: false

ask:
  routing:
    mode: hybrid
    high_threshold: 70
    low_threshold: 45
    auto_host_ai: true
    cache_enabled: true
    cache_min_hits: 3
  rules:
    force_host_ai: false
  llm_providers:
    - name: ollama-local
      enabled: false
      type: ollama
      endpoint: http://localhost:11434
      model: qwen2.5:7b
      priority: 1

config_history:
  - date: 2026-08-28
    change: Initial config
    changed_by: alice
```

---

## 3. Config Fields

### 3.1 schema_version

**Type**: `number` · **Default**: `1`

Config schema version. CLI compares against built-in `CURRENT_SCHEMA_VERSION` on load:
- `< CURRENT_SCHEMA_VERSION`: stale config, warns to run `speccore config --upgrade`
- `> CURRENT_SCHEMA_VERSION`: CLI too old, suggests upgrade
- `=`: normal

### 3.2 project

**Type**: `object` — project metadata for reports, dashboards, doc generation.

| Field | Type | Required | Description |
|------|------|:--:|------|
| `name` | `string` | ✅ | Project name (affects dir name, report titles) |
| `description` | `string` | — | Description (≤100 chars) |
| `version` | `string` | — | Semantic version |

### 3.3 tech_stack

**Type**: `object` — tech stack, used by AI to choose solutions during analysis/generation.

| Field | Type | Description |
|------|------|------|
| `backend` | `string` | Backend language/framework (e.g. `Java / Spring Boot`) |
| `frontend` | `string` | Frontend framework (e.g. `Vue 3`, `React 18`) |
| `database` | `string` | Database (e.g. `MySQL`, `PostgreSQL`, `MongoDB`) |
| `cache` | `string` | Cache (e.g. `Redis`) |
| `mq` | `string` | Message queue (e.g. `RabbitMQ`, `Kafka`) |

> All optional. If omitted, AI infers from requirements and code.

### 3.4 team

**Type**: `object` — team members, for assignee tracking, task assignment, review.

| Field | Type | Description |
|------|------|------|
| `members` | `array` | Member list |
| `members[].name` | `string` | Name (matches Git username) |
| `members[].role` | `string` | Role (`lead`, `developer`, `qa`, `devops`) |
| `members[].assignee` | `boolean` | Whether usable as task assignee |

### 3.5 platforms

**Type**: `array` — platform list, the **single source of platform names** for analyze/taskify/execute. **Names must be globally unique**.

| Field | Type | Required | Values | Description |
|------|------|:--:|:------:|------|
| `name` | `string` | ✅ | — | Platform name (lowercase, hyphen-separated, e.g. `order-service`) |
| `type` | `string` | — | `frontend` / `backend` / `infra` | Platform type |
| `description` | `string` | — | — | Description |
| `code_path` | `string` | — | — | Source relative path (e.g. `./packages/app`) |
| `git_repo` | `string` | — | — | Git repo URL |
| `default_branch` | `string` | — | — | Default branch (default `main`) |
| `deploy` | `object` | — | — | Per-environment deploy config |

**Name rules**: lowercase, no spaces, hyphen-separated; platform name = project name (1:1); a service split into multiple repos should be declared separately.

**deploy** (organized by environment name like `staging`/`production`):

| Field | Type | Required | Description |
|------|------|:--:|------|
| `type` | `string` | ✅ | Deploy type: `ssh` `sftp` `static` `script` `docker` `pm2` `k8s` `helm` `vercel` `serverless` |
| `build_cmd` | `string` | — | Build command, e.g. `npm run build` |
| `output_dir` | `string` | — | Build output dir, default `dist` |
| `host` | `string` | ssh/sftp/docker | Server `user@host:port` |
| `key` | `string` | — | SSH private key path |
| `password` | `string` | — | SSH/SFTP password (requires `sshpass`) |
| `remote_dir` | `string` | ssh/sftp | Server deploy dir |
| `script` | `string` | — | Post-deploy command/script |
| `pre_deploy` | `string[]` | — | Pre-deploy commands |
| `post_deploy` | `string[]` | — | Post-deploy commands |

### 3.6 git

**Type**: `object` — Git config, affects branch strategy, PR flow, protected-branch checks.

| Field | Type | Default | Description |
|------|------|--------|------|
| `default_base` | `string` | `main` | Default base branch |
| `branch_prefix` | `string` | `feature/` | Feature branch prefix |
| `protected_branches` | `string[]` | `["main", "master"]` | Protected branches, supports `*` wildcard |

### 3.7 code_scope

**Type**: `string[]` · **Default**: `["src/"]` — code scan scope, affects `code-index`, `code-graph`, etc.

### 3.8 conventions

**Type**: `object` — project conventions, AI follows them for naming/commit/review.

| Field | Type | Description |
|------|------|------|
| `commit` | `string` | Commit convention (e.g. `conventional-commits`) |
| `naming` | `string \| object` | Naming convention |
| `review` | `boolean \| string` | Review convention |

### 3.9 error_codes

**Type**: `array` — error code system, injected into AI context during analyze for consistent codes.

| Field | Type | Description |
|------|------|------|
| `code` | `string \| number` | Error code |
| `meaning` | `string` | Meaning |
| `scenario` | `string` | Trigger scenario |

### 3.10 quality_gates

**Type**: `object` — quality gates, controls post-execute checks.

| Field | Type | Default | Description |
|------|------|--------|------|
| `enforce_testing` | `boolean` | `true` | Require TEST.md |
| `enforce_review` | `boolean` | `true` | Require REVIEW.md |
| `require_pr` | `boolean` | `true` | Require PR merge |

**verify_ui** (v8.3.95+) — controls `speccore verify --ui` defaults:

| Field | Type | Default | Description |
|------|------|--------|------|
| `enabled` | `boolean` | `false` | Enable UI verification |
| `smoke_test` | `boolean` | `true` | Enable smoke test |
| `visual_check` | `boolean` | `true` | Enable visual check |
| `threshold` | `string` | `normal` | `strict` / `normal` / `loose` |
| `devices` | `string[]` | `['desktop']` | `desktop` / `mobile` / `tablet` |
| `browsers` | `string[]` | `['chromium']` | `chromium` / `firefox` / `webkit` |
| `timeout` | `number` | `30000` | Operation timeout (ms) |
| `headed` | `boolean` | `false` | Show browser window |
| `visual_model` | `object` | — | Visual model config |

### 3.11 arbitration

**Type**: `object` — contract conflict arbitration (v8.3.24+), replaces traditional gates with L1/L2/L3 arbitration.

| Field | Type | Default | Values | Description |
|------|------|--------|--------|------|
| `enabled` | `boolean` | `true` | — | Master switch |
| `mode` | `enum` | `full` | `full` / `l1-only` / `report-only` | Arbitration depth |

| Mode | L1 machine | L2 spec | L3 architecture | Use case |
|------|:---:|:---:|:---:|------|
| `full` | auto | AI-assisted | human final | **Default, full flow** |
| `l1-only` | auto | report-only | report-only | Fast iteration |
| `report-only` | report | report | report | Compatible with legacy gates |

### 3.12 settings

**Type**: `object` — runtime behavior switches.

**assignee** — `enabled` (default `true`), `mode` (`strict`/`loose`/`off`, default `loose`).

**trace** — `enabled` (`true`), `auto_annotate` (`true`, auto-add `@spec` comments).

**archive** — `auto_cleanup` (`false`).

**plan** — `parallel_suggest` (`true`).

**validation** — `strict_mode` (`false`).

**sync** — `auto_check` (`true`).

**patterns** — `auto_save` (`off`/`smart`/`aggressive`, default `smart`).

**review** — `check_assignee` (`false`).

**vision** (v8.3.94+) — visual model for image understanding in specs (bitmaps → text descriptions). Fields: `enabled` (`false`), `provider` (`qwen-vl`/`openai`/`anthropic`/`local`), `model`, `apiKey` (supports `${ENV_VAR}`), `endpoint`, `timeout` (`60000`), `maxImagesPerPrompt` (`10`), `imageMaxSizeKb` (`2048`).

**optional_steps** — tri-state switches for optional pipeline steps (`auto`/`on`/`off`):

| Field | Default | Description |
|------|--------|------|
| `clarify` | `auto` | Requirement clarification: auto=by professionalism / on=force / off=skip |
| `verify` | `auto` | Code verification |
| `pipeline` | `auto` | Deploy |
| `pr` | `auto` | Merge request |
| `done` | `auto` | Archive |
| `spec2doc` | `auto` | Export docs |

Three-layer override (high→low): command flag (`--clarify`/`--skip-clarify`) > ask natural language > config > default `auto`.

**pipelines** — named pipelines:

| Field | Default | Description |
|------|--------|------|
| `default` | `develop` | Default pipeline name |
| `custom` | `{}` | Custom named pipelines: name → comma-separated stage string |

Built-in presets: `full` (req-doc→spec2doc), `import` (doc2spec→pr), `spec` (doc2spec→taskify), `analyze` (analyze→validate), `develop` (analyze→verify, default), `deliver` (execute→pr), `deploy` (analyze→pipeline), `docs` (analyze→spec2doc).

Stage keys (for `--from`/`--to` and `custom`): `req-doc`, `doc2spec`, `split-units`, `analyze`, `validate`, `taskify`, `plan`, `execute`, `verify`, `pipeline`, `pr`, `done`, `spec2doc`.

### 3.13 ask

**Type**: `object` — Ask engine config.

**routing** — `mode` (`hybrid`/`cli-only`/`host-ai-only`, default `hybrid`), `high_threshold` (`70`), `low_threshold` (`45`), `auto_host_ai` (`true`), `cache_enabled` (`true`), `cache_min_hits` (`3`).

**rules** — `force_host_ai` (`false`).

**llm_providers** — array, supports multi-provider failover:

| Field | Type | Required | Values | Description |
|------|------|:--:|:------:|------|
| `name` | `string` | ✅ | — | Unique provider name |
| `enabled` | `boolean` | — | — | Enabled |
| `type` | `enum` | ✅ | `ollama`/`openai`/`anthropic`/`custom` | Provider type |
| `endpoint` | `string` | ✅ | — | API endpoint URL |
| `model` | `string` | ✅ | — | Model name |
| `apiKey` | `string` | — | — | API key, `${ENV_VAR}` syntax |
| `priority` | `number` | — | — | Lower = higher priority |

### 3.14 config_history

**Type**: `array` — auto-maintained by `speccore config --upgrade`. Fields: `date` (`YYYY-MM-DD`), `change`, `changed_by` (optional).

### 3.15 tests

**Type**: `object` — test infra, links with `verify` and `pipeline`. Fields: `base_urls` (map: platform name → URL), `visual_model`.

### 3.16 stages

**Type**: `object` — layered test stages, links with `verify --stage`. Stages: `dev`/`pr`/`deploy`/`release`, each with `config` (scenario file path or `null` for built-in checks).

### 3.17 pipeline.test

**Type**: `object` — pipeline built-in test node, runs before/after deploy.

| Field | Type | Default | Values | Description |
|------|------|--------|--------|------|
| `enabled` | `boolean` | `false` | — | Enable pipeline test |
| `type` | `enum` | `build-check` | `build-check`/`smoke`/`visual`/`api`/`all` | Test type |
| `stage` | `enum` | `pre-deploy` | `pre-deploy`/`post-deploy`/`both` | Test timing |
| `config` | `string` | — | — | Custom scenario file |
| `fail_on_error` | `boolean` | `true` | — | Block deploy on failure |
| `auto_fix` | `boolean` | `true` | — | Output AI fix markers |
| `max_retries` | `number` | `3` | — | Auto-fix max retries |

---

## 4. Enum Values

### 4.1 platforms[].type
| Value | Description |
|----|------|
| `frontend` | Frontend (app, H5, mini-program, admin) |
| `backend` | Backend (API, microservice) |
| `infra` | Infrastructure (gateway, config center, monitoring) |

### 4.2 arbitration.mode
| Value | Description |
|----|------|
| `full` | Full three-level arbitration |
| `l1-only` | L1 auto only |
| `report-only` | Report only |

### 4.3 settings.assignee.mode
| Value | Description |
|----|------|
| `strict` | Strict check, block on mismatch |
| `loose` | Auto-fill, warn only |
| `off` | No tracking |

### 4.4 settings.patterns.auto_save
| Value | Description |
|----|------|
| `off` | Prompt only |
| `smart` | Auto-save high-confidence |
| `aggressive` | Auto-save all |

### 4.5 ask.routing.mode
| Value | Description |
|----|------|
| `hybrid` | Hybrid routing |
| `cli-only` | CLI only |
| `host-ai-only` | Host AI only |

### 4.6 ask.llm_providers[].type
| Value | Description |
|----|------|
| `ollama` | Ollama local model |
| `openai` | OpenAI-compatible API |
| `anthropic` | Anthropic Claude |
| `custom` | Custom provider |

---

## 5. Upgrade Guide

### 5.1 When to upgrade
1. `speccore status` shows config version ⚠️ after CLI upgrade
2. `speccore doctor` reports `schema_version` mismatch
3. New features unavailable (missing config fields)

### 5.2 Upgrade flow
```bash
speccore doctor           # 1. Check config health
speccore config --upgrade # 2. Upgrade config structure
speccore status           # 3. Confirm result
```

### 5.3 Auto-handled changes
| Change | Auto behavior |
|----------|-------------|
| New field | Auto-fill from `DEFAULT_CONFIG` |
| Removed field | Kept but no longer read (compat) |
| Renamed field | Auto-migrated in `upgradeConfig()` |
| Invalid enum | Validator errors, fallback to default |
| schema_version bump | Auto-updated to `CURRENT_SCHEMA_VERSION` |

### 5.4 Structural changes (interactive)
Structural changes **abort upgrade** and prompt for manual handling: removed field, type change, invalid enum, structure change. CLI generates `.speccore/config/upgrade-diff.md` with details, suggestions, and re-run command.

Detection entry points: `speccore config --upgrade`, `speccore doctor`, `speccore status`.

### 5.5 Post-upgrade checks
1. New field defaults match expectation
2. Platform list complete
3. LLM providers updated

---

## 6. Version History

### schema_version = 1 (v8.3.25+)
Added domains: `schema_version`, `project`, `platforms`, `tech_stack`, `team`, `git`, `code_scope`, `conventions`, `error_codes`, `quality_gates`, `arbitration`, `settings`, `ask`, `config_history`.

Deprecated: `.speccore/CONSTITUTION.md`, `.speccore/SETTINGS.md`, `.speccore/config/ask.json` (all migrated into `.speccore.yml`). Old files kept as backup, no longer read.

---

## 7. FAQ

### Q1: `.speccore.yml` conflicts with legacy `CONSTITUTION.md` / `SETTINGS.md`?
v8.3.25+ only reads `.speccore.yml`. `CONSTITUTION.md` is kept as human reference; `SETTINGS.md` is deprecated. Run `speccore config --upgrade` to ensure completeness.

### Q2: What happens on validation failure?
1. CLI prints specific error (field path + expected type)
2. Falls back to defaults, keeps running
3. `speccore doctor` shows config health as failed
4. Suggest `speccore config --upgrade`

### Q3: Can I edit `.speccore.yml` manually?
Yes. It's plain YAML. Changes take effect on the next command. Run `speccore doctor` after editing to check syntax.

### Q4: Can I edit `schema_version` manually?
Not recommended. It's CLI-maintained. Use `speccore config --upgrade`.

### Q5: How to configure monorepo?
Declare a platform per repo with its own `code_path` and `git_repo` in `platforms`.

### Q6: How to store `apiKey` securely?
Use env var reference syntax:
```yaml
ask:
  llm_providers:
    - name: openai
      apiKey: ${OPENAI_API_KEY}
```
Two syntaxes: `${VAR}` (kept as-is if unset) and `${VAR:-default}` (fallback). Applies to all string fields in `.speccore.yml`. Never write secrets directly; use env vars, `.env`, or CI/CD secrets.

### Q7: How to disable a feature?
Set its `enabled` field to `false` (e.g. `arbitration.enabled: false`, `settings.assignee.enabled: false`).
