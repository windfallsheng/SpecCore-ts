# SDD: Spec-Driven Development

> Write Specs first, then let AI execute under their constraints.

---

## 1. What is SDD

SDD (Spec-Driven Development) is a methodology for AI-native teams. Core principle:

**Every line of code has a corresponding line of Spec. AI works within Spec constraints.**

Traditional TDD says "write tests first, then code." SDD says "write Specs first, let AI understand and execute them, then verify output against Specs."

---

## 2. Why SDD

### 2.1 The Four Pain Points of AI Coding

| Pain Point | Description | SDD Solution |
| :--- | :--- | :--- |
| **Context drift** | AI forgets Task-01's architecture by Task-15 | Reload Specs per batch (batch execution + context isolation) |
| **Style inconsistency** | Same feature, different coding styles across sessions | CONSTITUTION.md defines tech standards globally |
| **Lost traceability** | Code changes with no link to requirements | Req → Task → Code bidirectional chain |
| **Token waste** | AI spends tokens on directory creation, file I/O | CLI handles deterministic ops, AI focuses on decisions |

### 2.2 Architecture: Deterministic Logic vs Intelligent Logic

```
User Input (Natural Language / Slash Command)
        │
        ▼
┌───────────────────────────────────────────┐
│   AI Layer (Intelligent Decisions)         │  ← AI Tools
│   - Understand intent                      │
│   - Decide what to execute                 │
│   - Generate code content                  │
└───────────────────────────────────────────┘
        │ Calls CLI commands
        ▼
┌───────────────────────────────────────────┐
│   CLI Layer (Deterministic Execution)      │  ← SpecCore CLI
│   - Create directory structure             │
│   - Read/write config and Spec files       │
│   - Parse YAML                             │
│   - Compliance validation                  │
│   - Transaction protection (auto rollback) │
└───────────────────────────────────────────┘
```

**Result**: 50%+ Token reduction, 100% file operation reliability (code-guaranteed).

---

## 3. SDD vs TDD vs BDD

| Dimension | TDD | BDD | SDD |
| :--- | :--- | :--- | :--- |
| **Core artifact** | Test cases | Behavior scenarios | Specification documents |
| **Driver** | Developer | PM/QA | AI + Developer |
| **Validation target** | Code correctness | Business behavior | Requirement completeness + code correctness |
| **AI compatibility** | Medium | Low | High |
| **Phase** | Coding | Requirements | Full lifecycle |

SDD doesn't replace TDD — it fronts it: ensure AI and humans agree on requirements before tests.

---

## 4. Five Core Practices

### 4.1 Spec First
Before any code, create Spec docs (REQ.md + TECH.md + TASK.md + API_CONTRACT.yaml).

### 4.2 Command-Driven
```bash
speccore init                           # One-command project setup
speccore new-task --platforms=web,h5   # Multi-platform task creation
speccore execute --all --batch-size=3  # Batch execution with isolation
speccore validate                      # Spec compliance check
```

### 4.3 Transaction Protection
All write operations are transaction-protected. No partial failures.

### 4.4 Bidirectional Traceability
Requirement → Iteration → Task → Code. Every line traces back.

```bash
speccore trace --req=REQ-001   # Trace from requirement
speccore impact --req=REQ-001  # Impact analysis
```

### 4.5 Separation of Specs and Code
Specs in independent repo, code repos as siblings. Clean permissions, independent versioning.

---

## 5. SDD Workflow

```
1. Requirement Analysis
   └→ Create iteration: speccore iteration create
   └→ Write REQ.md

2. Task Breakdown
   └→ Create tasks: speccore new-task
   └→ Complete TECH.md / TASK.md / API_CONTRACT.yaml

3. Execute Development
   └→ AI reads Specs → generates code
   └→ speccore execute --all --batch-size=3

4. Verify
   └→ speccore validate
   └→ speccore sync --reverse

5. Archive
   └→ speccore archive --all
   └→ speccore backup
```

---

## 6. TL;DR

**SDD = Drive AI with Specs, guarantee determinism with CLI, protect data with transactions.**
