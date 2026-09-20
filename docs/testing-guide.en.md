# SpecCore Testing Guide

> v8.3.60+ full testing coverage: code quality → UI smoke → visual regression → API contract → performance baseline

---

## 1. Testing Overview

SpecCore provides full-chain testing from code to deployment:

```
Dev stage               PR stage               Deploy stage            Release stage
    │                      │                      │                      │
    ▼                      ▼                      ▼                      ▼
┌─────────┐          ┌─────────┐          ┌─────────┐          ┌─────────┐
│ Compile  │          │ Quality  │          │ Build    │          │ Full     │
│ Lint     │   →     │ Smoke    │   →     │ Smoke    │   →     │ Visual   │
│ Unit     │          │ API      │          │          │          │ API      │
└─────────┘          └─────────┘          └─────────┘          │ Perf     │
                                                               └─────────┘
```

### 1.1 Capability matrix

| Capability | Command | Description | Time |
|:---|:---|:---|:---:|
| Compile | `speccore verify --type compile` | TS/JS compile | ~30s |
| Lint | `speccore verify --type lint` | ESLint/Prettier | ~20s |
| Unit test | `speccore verify --type test` | Jest/Vitest | ~1-2m |
| UI smoke | `speccore verify --ui --smoke-only` | Playwright headless reachability | ~2-5m |
| Visual regression | `speccore verify --ui --visual-only` | AI vision model screenshot comparison | ~5-10m |
| API contract | `speccore verify --api-contract` | API_CONTRACT.yaml validation | ~1m |
| Performance | `speccore verify --perf` | Lighthouse Web Vitals | ~2-3m |

---

## 2. Layered Testing Strategy

### 2.1 Four-stage shortcuts

v8.3.60+ adds `--stage` to run the matching layer:

```bash
speccore verify --stage dev      # dev: compile + lint + unit
speccore verify --stage pr       # pr: quality + key smoke + API contract
speccore verify --stage deploy   # deploy: smoke only (fast gate)
speccore verify --stage release  # release: full UI + API + perf
```

### 2.2 Stage mapping

| stage | auto args | coverage | time |
|:---|:---|:---|:---:|
| `dev` | `--type all` | compile + lint + unit | 2-3m |
| `pr` | `--type all --ui --smoke-only --api-contract` | quality + smoke + contract | 5-10m |
| `deploy` | `--ui --smoke-only` | UI smoke only | 2-5m |
| `release` | `--ui --api-contract --perf` | full UI + API + perf | 15-30m |

### 2.3 Config-driven testing (recommended)

```bash
speccore verify --config .speccore/tests/smoke.yaml --env-file staging
speccore verify --config .speccore/tests/pr.yaml --env-file staging
speccore verify --config .speccore/tests/release.yaml --env-file production
```

---

## 3. Test Configuration

### 3.1 Test infra in environment config

```yaml
# .speccore/environments/staging.yaml
env: staging

tests:
  base_urls:
    h5: https://staging.example.com/h5
    admin: https://admin-staging.example.com
    api: https://api-staging.example.com
  visual_model:
    provider: qwen-vl        # qwen-vl / openai / anthropic / local
    model: qwen-vl-max
    timeout: 60000

stages:
  dev:    { config: null }
  pr:     { config: .speccore/tests/pr.yaml }
  deploy: { config: .speccore/tests/smoke.yaml }
  release:{ config: .speccore/tests/release.yaml }

pipeline:
  test:
    enabled: true
    type: smoke             # build-check / smoke / visual / api / all
    stage: pre-deploy       # pre-deploy / post-deploy / both
    fail_on_error: true
    auto_fix: true
    max_retries: 3
```

### 3.2 Config fields

| Field | Type | Default | Description |
|:---|:---|:---|:---|
| `tests.base_urls` | `object` | — | Per-platform test base URLs |
| `tests.visual_model` | `object` | — | Visual model provider config |
| `stages.{stage}.config` | `string\|null` | — | Scenario file path per stage |
| `pipeline.test.enabled` | `boolean` | `false` | Enable pipeline test |
| `pipeline.test.type` | `enum` | `build-check` | Test type |
| `pipeline.test.stage` | `enum` | `pre-deploy` | Test timing |
| `pipeline.test.fail_on_error` | `boolean` | `true` | Block deploy on failure |
| `pipeline.test.auto_fix` | `boolean` | `true` | Trigger AI auto-fix markers |

---

## 4. Test Scenario YAML

### 4.1 File structure

```yaml
# .speccore/tests/smoke.yaml
name: Standard smoke test

target:
  base_url: https://staging.example.com

endpoints:
  h5: https://staging.example.com/h5
  admin: https://admin-staging.example.com

tests:
  - name: Homepage load check
    type: smoke            # smoke / visual / api
    routes: [/]
    threshold: normal      # strict / normal / loose
    devices: [desktop, mobile]
    browsers: [chromium]

  - name: Login visual check
    type: visual
    routes: [/login]
    threshold: normal

  - name: API contract
    type: api
    scenarios:
      - User login
      - List orders

visual_model:
  provider: qwen-vl
  model: qwen-vl-max
  timeout: 30000

output: ./reports/smoke-test-report.html
```

### 4.2 Scenario fields

| Field | Type | Required | Description |
|:---|:---|:---:|:---|
| `name` | `string` | ✅ | Scenario name |
| `type` | `enum` | ✅ | `smoke` / `visual` / `api` |
| `routes` | `array` | — | Route paths to test |
| `scenarios` | `array` | — | API scenario names |
| `threshold` | `enum` | — | `strict` / `normal` / `loose` |
| `devices` | `array` | — | `desktop` / `mobile` / `tablet` |
| `browsers` | `array` | — | `chromium` / `firefox` / `webkit` |

---

## 5. VERIFY_SPEC.yaml

Task-level UI test spec, auto-generated at taskify, editable manually:

```yaml
# Task-001/h5-mobile/VERIFY_SPEC.yaml
name: Order module UI verification
platform: h5-mobile
url: https://staging.example.com

scenarios:
  - name: Order list page render
    actions:
      - type: navigate
      - type: wait
        delay: 1000
      - type: screenshot
    assertions:
      - type: visible
        selector: "[data-testid='order-orderlist-page']"
      - type: visual
        threshold: normal
```

### 5.1 Action types

| Type | Params | Description |
|:---|:---|:---|
| `navigate` | `value?: url` | Navigate to URL |
| `fill` | `selector`, `value` | Type text |
| `click` | `selector` | Click element |
| `select` | `selector`, `value` | Select dropdown |
| `check` / `uncheck` | `selector` | Toggle checkbox |
| `hover` | `selector` | Hover |
| `press` | `key` | Keyboard press |
| `wait` | `delay?` / `selector?` / `waitFor?` | Wait |
| `screenshot` | — | Screenshot (auto at scenario end) |

### 5.2 Assertion types

| Type | Params | Description |
|:---|:---|:---|
| `visible` / `hidden` | `selector` | Element visible/hidden |
| `text` | `selector`, `contains?` / `equals?` | Text match |
| `value` | `selector`, `value?` | Input value match |
| `url` | `contains?` / `equals?` | URL match |
| `count` | `selector`, `count` | Element count |
| `attribute` | `selector`, `attribute`, `value?` | Attribute match |
| `visual` | `threshold?` | Trigger visual check |

---

## 6. Pipeline Test Node

### 6.1 Timing

| stage | Timing | Block deploy? | Use case |
|:---|:---|:---:|:---|
| `pre-deploy` (default) | after build, before deploy | critical blocks | build artifact check, base gate |
| `post-deploy` | after deploy | ❌ report only | e2e acceptance, live monitor |
| `both` | before & after | pre blocks / post not | full quality loop |

### 6.2 Severity

| Severity | Condition | Block deploy? | Fix marker |
|:---|:---|:---:|:---|
| **critical** | build-check fail, HTTP 5xx/connection fail | ✅ block | `[SPECCORE_PIPELINE_TEST_FAIL]` |
| **warning** | visual diff, contract diff, HTTP 404 | ❌ deploy first | `[SPECCORE_PIPELINE_TEST_DEFERRED]` |

### 6.3 Recommended config

```yaml
# Lightweight deploy gate
pipeline:
  test:
    enabled: true
    type: smoke
    stage: pre-deploy
    fail_on_error: true
    auto_fix: true

# Full quality loop
pipeline:
  test:
    enabled: true
    type: all
    stage: both
    fail_on_error: true
    auto_fix: true
```

---

## 7. Testing External Projects

```bash
speccore verify --project-dir ~/projects/other-app --config ./tests/smoke.yaml
speccore pipeline --project-dir ~/projects/other-app --env staging --all
```

Minimal external config:

```yaml
# ~/my-test-projects/minimal/.speccore/environments/test.yaml
env: test
tests:
  base_urls:
    h5: https://example.com
```

---

## 8. FAQ

### Q1: Smoke fails but service is actually fine?
Check `tests.base_urls` points to the right environment. Add `wait` delay if the service needs warm-up.

### Q2: Visual model call fails?
Check: 1) `DASHSCOPE_API_KEY`/`OPENAI_API_KEY` env set; 2) `visual_model.provider` correct; 3) network reachable.

### Q3: How to test dynamic routes?
Manually specify concrete paths (e.g. `/order/123` for `/order/:id`).

### Q4: How to configure custom frontend router paths?
Three-level priority: 1) `--router-file` flag; 2) `PROJECT.yaml` `verify.router_file`; 3) auto-scan standard paths.

### Q5: VERIFY_SPEC.yaml not generated at taskify?
Check: 1) platform has `code_path`; 2) recognizable router config exists; 3) scan failure silently skips (doesn't block).

### Q6: `data-testid` selector not working?
Auto-generated specs use `data-testid` selectors. Ensure page root elements carry matching `data-testid` attributes.
