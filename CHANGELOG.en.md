# SpecCore Changelog

---

## v8.3.373 (2026-11-03) — Clarification outputs aligned to feature units + 3-tier priority reading + precise downstream consumption

- **Clarification drop aligned to feature units**: analyze clarification responses now drop to `020-specs/requirements/unit-{feature}.md` (unit-level, one-to-one with feature units), `020-specs/requirements/global-clarified.md` (global-level), with `{slug}-clarified.md` retained as fallback (doc-level). Previously, when one source doc was split into multiple feature units, clarification outputs couldn't map back to individual units.
- **3-tier priority reading**: analyze reads clarification outputs with priority: unit-level > global-level > doc-level fallback. When unit-level coverage is sufficient, doc-level is skipped to avoid duplicate injection; when coverage < 50%, doc-level fallback activates. Legacy projects without split anchors maintain original full-read behavior.
- **Downstream precise consumption**: `extractOverviewContext` adds step 0 — reads `unit-{unitName}.md` full-text injection first (unit-level precise), then falls back to overview/REQUIREMENT.md keyword matching. taskify prompt document list adds "Unit-level golden requirements" section, guiding AI to read raw clarification docs when overview aggregation lacks detail.
- **collectUnitClarifyDocs restored**: fallback function accidentally deleted during previous rename is restored — when `020-specs/requirements/` is empty, falls back to reading `020-specs/{feature}/overview/CLARIFY.md` scripts, preventing legacy projects from losing clarification work.

---

## v8.3.372 (2026-11-03) — User-specified iteration naming: explicit name extraction, numeric-ID sequencing, dead branch revival

- **Accurate "名字/名为 X" extraction (user intent wins)**: "创建一个迭代名字 261115，主要功能是支付" used to be greedily captured by `创建(.+)迭代` as name="一个", losing the user-specified name entirely. Added explicit-name extraction (名字/名为/编号 X) and topic extraction (主要功能是/主题 X → `--topic`), scoped to the iteration_create intent; filler words (一个/个/新) no longer qualify as iteration names.
- **Pure numeric names become the iteration sequence**: `nextIterationId` honors user-specified numbers (e.g. 261115) → `Iteration-261115-{slug}`, no longer overridden by the global counter; on collision with an existing directory a content-based md5 hash is appended (same input, same hash — idempotent). Custom IDs do not advance the counter: scanMaxIds reads the max from the directory, so auto-numbering aligns naturally.
- **Chinese topic translation layered**: CLI falls back to pinyin (「支付」→ zhi-fu); the spec-iteration-create skill script now instructs the host AI to translate a Chinese `--topic` to English (payment) before executing.
- **ask dead branch revived + dead option removed**: the `best.command === 'iteration-create'` (hyphenated) check never matched mapping.id's spaced version 'iteration create' — a dead branch; name/topic assembly actually fell through to the else branch, which also appended the dead `--iteration` option (not registered by iteration create) causing fail(1). Fixed: branch check aligned to the spaced version; in iteration_create sentences "迭代" is the command object and is no longer extracted as params.iteration.

---

## v8.3.371 (2026-11-03) — Final polish of the inventory tool: entity/term signal-to-noise, knowledge-graph entity count, clarify-stage wording

- **DATA_MODEL / GLOSSARY signal-to-noise filtering**: the old heuristics listed `generateGraphReport` (a function) as an Entity and `core`/`commands`/`index.ts` (dir/file names) as glossary terms. Fixed: path regex tightened with word boundaries (the old `/po|vo/` matched re**po**rt/com**po**nents); added `isBusinessEntitySymbol` (excludes lowercase functions, ALL-CAPS constants, Config/Options/Report meta-types, verb prefixes) and `isGlossaryCandidate` (excludes file names/path fragments/lowercase variables/XxxOptions option interfaces), keeping only PascalCase domain nouns. On-disk: DATA_MODEL converges to 16 real Schema entities, GLOSSARY to 18 real domain terms.
- **Knowledge-graph "undefined entities" fix**: `entities` is a `Record<string, GraphEntity>` (object), so the old `graph.entities.length` yielded undefined. Changed to `Object.keys(graph.entities).length`; on-disk it now shows the real count (162).
- **Clarify-stage wording split**: when features is empty the old "no requirement documents detected" misled users into thinking the import failed. Fixed: probe converted/sources for requirement docs; when present show "detected N requirement documents not yet unitized", keep the old wording only when truly none exist.

## v8.3.370 (2026-11-03) — Clarify-chain walkthrough fixes: double-frontmatter stripping + CLARIFY_REPORT breakage fix

A real end-to-end walkthrough of the clarify chain (doc2spec → --clarify → [CLARIFY:] apply-back) surfaced and fixed two broken links:

- **Double-frontmatter stripping**: the host AI's apply-back blocks carry their own source/status frontmatter (as taught by the clarify playbook), while the CLI unconditionally prepends its system header — producing double-frontmatter files. Added `stripLeadingFrontmatter` utility (strips the leading --- block; content without a closing --- is returned untouched so body dividers are not harmed), applied before header assembly in the clarifyBlocks path.
- **CLARIFY_REPORT breakage fix**: the clarify report refresh was only wired to the tail of the JSON branch, so plain-text [CLARIFY:] apply-backs never reached it — the report was never written. Now refreshed immediately after clarify artifacts land (idempotent: skips writing when content is unchanged).

## v8.3.369 (2026-11-03) — From "inventory tool" to "document generator": TECH_STACK detection rewrite + API extractor wiring + AI relay loop + 4b/4c skeleton consolidation

Benchmarked against industry best practice (GitHub Linguist detection strategy / ts-morph AST route extraction / LangChain structured handoff), all three paths are implemented: both fact-layer defects fixed, the semantic layer gains a closed AI relay loop, and the two parallel doc systems converge into one generator.

- **TECH_STACK detection rewrite (Linguist-style dual track)**: the old logic only looked for `{dir}/package.json` (always misses when pointed at a source subdirectory — hence the on-disk "not detected"), rewritten to: marker-file upward search ≤6 levels for the project root (package.json/pom.xml/go.mod/requirements.txt/Cargo.toml/Gemfile) → dependency-table framework detection (16 frameworks, Next/Nuxt/Nest prioritized by specificity) → extension-statistics fallback (15 languages), plus TypeScript detection via deps.typescript.
- **API extractor wired (fixes empty API_INVENTORY)**: new `extractApiDetails` extracts "METHOD /path" entries (Express/Koa `router.get('/p')` across all three quote styles + NestJS `@Controller` prefix merging + Java `@*Mapping`), backfilling the always-empty `apiDetails` from the tree-sitter branch — API_INVENTORY.md and API_CONTRACT.yaml now get real data.
- **AI relay loop (--prompt/--apply extended)**: the global-artifacts line gains a semantic relay — the CLI generates deterministic skeletons plus a `_DOCS_PLAYBOOK.md` relay playbook (placeholder inventory dynamically derived from the on-disk docs, with material pointers); `--prompt` emits the relay prompt, `--apply '<JSON>'` merges the host AI's semantic content into skeletons by heading targeting (YAML uses the `"description 字段"` mapping), with unmatched placeholders reported individually for correction and resend.
- **System convergence (one concept, one generator)**: the 4b/4c nine documents (FUNCTION_MAP/API_CONTRACT.yaml/INTERACTION_MAP + security/performance/data-flow/deployment/consistency) were previously checked but never generated; they are now skeletoned by generateGlobalArtifacts (deterministic facts + `_AI 填写` placeholders), so the global analyze Layer 4 check passes naturally and the host AI fills semantics per the playbook.
- **Pure-function backfill engine**: `mergeSectionIntoText` (heading-targeted replacement) + `fillYamlDescriptions` (YAML description matching) exported for unit tests; 6 regression tests green.

## v8.3.368 (2026-11-03) — GLOBAL directory cleanup: timestamp backups archived, top-level files regrouped, reverse-requirement domain isolated (requirements/ ↔ _reverse/)

All three hard problems from the previous audit are fixed: timestamp backup files proliferating across four directory layers and polluting indexes, CODE_INDEX/TECH_STACK misplaced at the GLOBAL root, and REQUIREMENT.md being overwritten by two competing pipelines.

- **safeWrite archiving**: the old "content changed → rename in place" behavior (creating tombstones like CODE_INDEX-20260923065735.md — 21 found) is replaced by archiving into a per-directory `.history/` subdirectory — the main directory always holds only the canonical file; `.history/` starts with a dot so reindex skips it automatically, keeping INDEX/TOC/RAG clean of stale backups.
- **Top-level files regrouped into overview/**: CODE_INDEX.md / TECH_STACK.md moved from the GLOBAL root into overview/ (alongside ARCHITECTURE/API_INVENTORY); the config.ts consumer already defined the overview paths, so writers and readers are now aligned.
- **reindex excludes timestamp tombstones**: `scanMarkdownFiles` now skips the `-\d{14}.md` pattern (pre-existing tombstones), so INDEX.md no longer lists backups as canonical documents.
- **Reverse-requirement domain isolated (GLOBAL/_reverse/)**: the default output directory for reverse-derived requirements (REQUIREMENT.md / REVERSE_PROMPT.md / _ir / _qa) moves from requirements/ to _reverse/, fully separating it from the global-analysis pipeline (generateGlobalArtifacts writes requirements/) — the REQUIREMENT.md double-pipeline conflict is eliminated. The QA loop (--verify/--review/--revise) follows automatically; when --out-dir is omitted and the new domain has no artifacts but the legacy domain does, the legacy domain is auto-adopted with a migration hint (backward compatible for pre-v8.3.368 projects).
- **No more pre-created empty dirs**: requirements/images and requirements/prototypes had zero writers; both pre-creation sites (analyze and generateGlobalArtifacts) removed.
- **On-disk migration**: this project's .speccore/GLOBAL was cleaned up in one pass — all 21 tombstones archived into per-directory .history/, reverse artifacts moved into _reverse/, and after re-running reindex, INDEX.md shrank from 32 entries (21 of them tombstones) to a clean 24-entry index.

## v8.3.367 (2026-11-03) — Reverse-requirement QA loop: aligned with industry-best recipe-reverse-engineer five stages (verify→review→revise)

Per the user's directive "implement reverse-requirement the industry-best way, copying is fine", SpecCore now fully transplants the recipe-reverse-engineer five-stage recipe (discover→generate→verify→review→revision) from shinpr/claude-code-workflows, completing the three missing stages:

- **Verification loop upgrade (--verify)**: new completeness baseline `checkInventoryCoverage` (recipe's Quality Gate counts balance) — UR source anchors vs IR unit inventory; uncovered modules = unaccounted items become review evidence; zero filled anchors → blocked. New `_qa/INVENTORY.md` report + `_qa/VERIFY_PLAYBOOK.md` code-verifier playbook + `_qa/verify.json` structured verification template (status: verified/needs_review/inconsistent/unverified; never overwrites host-AI-filled results).
- **Semantic review (--review, new)**: document-reviewer playbook `_qa/REVIEW_PLAYBOOK.md` with six review dimensions (completeness / correctness / testability / translation-leak / granularity / traceability), using verify.json as verification evidence (recipe: review input = Step 3 output); `_qa/review.json` findings template with Review Resolution dispositions (apply/decline).
- **Conditional revision (--revise, new)**: Review Resolution Gate — unresolved findings (pending>0) refuse to proceed; decline-only passes the Unit Completion Gate; apply findings generate `_qa/REVISION_PLAYBOOK.md` revision playbook (apply findings verbatim as the revision scope, Operation Mode: update) + `_qa/REVISION_LOG.md` round records + re-validation guidance (--verify→--review→--revise until no apply findings).
- **Two-hop guide upgrade**: REVERSE_PROMPT.md's third hop expands from a single verification loop to the full verify→review→revise QA-loop guide; `extractFilledAnchors` extracted from verifyReverseAnchors for baseline reuse.
- **CLI wiring**: `global from-source` / `spec-from-source` gain `--review` and `--revise` options (combinable with --verify).

Regression tests: 13 added (4 baseline + 2 verify + 2 review + 5 revision gates), full suite 752/752 passing.

## v8.3.366 (2026-11-03) — Knowledge-graph/RAG pipeline evaluation fixes: precise query + requirement budget + CN→EN keyword unification + Layer 3 business slices

All four issues found in the architecture evaluation, plus the "technical analysis is hollow too" material-pipeline issue, resolved in one pass:

- **Precise analyze RAG query**: the retrieval query was upgraded from the iteration name (`ctx.iteration`) to the current feature unit's requirement text (first 2000 chars of SOURCE.md + platform), falling back to platform+iteration when no unit exists. The order-of-magnitude recall-precision gap of the iteration name is gone.
- **Requirement injection budget (anti token-blowup)**: new `buildBudgetedReqSection` (ai-context-generator, default 40K chars). Over-budget docs are truncated at paragraph boundaries with per-doc quotas, plus a "requirement reading list" telling the AI to Read originals on demand. Enabled in both the `generateAIContext` prompt file and the `analyzeSingleFeature` report's requirement section.
- **Keyword extraction unified to a single source (CN→EN mapping end-to-end)**: rag-engine had copied its own word tables (STOP_WORDS/SEMANTIC_MAP/expandKeywords/extractKeywords); its Chinese groups only mapped Chinese→Chinese synonyms, missing the utils/synonyms CN→EN mapping, so Chinese queries (「登录」) never matched English code symbols (`login`) — document RAG recall suffered. The duplicates are deleted (-257 lines) and everything now reuses `code-scanner.extractKeywords` (SEMANTIC_MAP bidirectional + utils/synonyms CN→EN + merged stop words).
- **global analyze Layer 3 business slices**: `buildLayer3ModuleContext` now extracts core function slices from matched files (≤3 files × 2 slices per module, body ≤40 lines, 6K-char budget), so real business rules/interaction logic reach the Layer 3 material; the prompt gains slice-usage guidance and a mandatory "distill business rules with source anchors (file:function)" instruction, fixing hollow "routes and summaries only" technical analysis.
- **Asset-boundary documentation**: new `docs/knowledge-assets-architecture.md` (six-asset consumption matrix + four source-entry gates + findRelevantCode/unifiedSearch/KG/code-graph boundary notes + three retrieval-quality defenses); unified-retrieval header comment documents the boundaries to stop new duplicate word tables or retrieval lines from sprouting.

Regression tests: 8 added (4 budget truncation + 4 CN→EN mapping), full suite 739/739 passing.

## v8.3.365 (2026-11-03) — Reverse-requirement hollowness fix: business slices in IR + depth activation + on-demand deep reads

User-verified feedback: `global from-source` produces hollow requirement docs — page routes and generic summaries only, missing functional/business/interaction detail. Four root causes:

- **IR material layer (fatal)**: the tree-sitter structural summary (summarizeCode) keeps only imports/symbols/apis and **deliberately drops method bodies**; business rules, error branches and interaction logic all live in function bodies → reverse output is nothing but routes and symbol names, and the AI can only guess summaries from signatures.
- **Guidance layer**: the two-hop prompt explicitly said "CLI has extracted, do NOT re-read source" — the AI was forbidden from reading the original code, leaving it with no material.
- **Parameter layer**: `--depth` was a dead parameter (declared, never consumed) — users setting deep got nothing.
- **Coverage layer**: hardcoded `files.slice(0, 8)` truncated large modules (20+ files).

Fixes (two-hop architecture unchanged, first-hop material upgraded):

- **Business slices in IR**: each IR gains a "Business Slices" section — sliceCodeFile (language-agnostic export slicer, full TS/JS/JSX coverage) extracts slices with JSDoc/signature/function body; frontend interaction logic (event-handler bodies) enters reverse material for the first time.
- **depth three tiers activated**: quick (≤3 files × 2 slices per module / body ≤30 lines), normal default (≤8 × 3 / ≤50), deep (≤20 × 5 / ≤50); per-module slice char budget of 10000 prevents IR bloat.
- **Prompt guidance rewritten**: "do NOT re-read source" removed; now "slices are the base material; when insufficient for rules/branches/interactions, use Read to deep-read the anchor file's function bodies" — fabrication ban and traceability anchors retained.
- **Related fix: sliceCodeFile truncation bug** — the signature line's braces were not counted in depth, so a function's opening `{` was invisible to the body loop, causing the first blank line or first closed block to be mistaken for "function end" — slices kept only the first few lines. This also degraded RAG code-slice quality; fixed by seeding brace depth from the signature line before the body loop.

## v8.3.364 (2026-11-03) — Translation chain hardening: explicit off notice + file passthrough channel + doc rule sync

External-project verification surfaced the root cause: the host AI actively passed `--translate-en off` based on a stale lesson (Windows shim escaping failures), rationalizing pinyin directory names. The CLI behaved correctly, but there were two small flaws and one documentation gap, now closed:

- **Explicit off notice**: `--translate-en off` previously degraded to pinyin silently (the help text also did not state the consequence), making users think "English names were never generated"; off mode now explicitly warns "English translation skipped, directory names will use pinyin" and points to the translation paths.
- **`--translate-response-file <path>` new option**: reads the translation JSON from a file, completely bypassing shell/npm shim quote escaping (the definitive fix for swallowed host-relay args on Windows); mutually exclusive with `--translate-response`, errors explicitly when the file is missing or empty.
- **Help text completion**: `--translate-en auto(default, LLM translation first, pinyin fallback) | host(host-AI relay) | off(disables translation, pinyin directory names)`.
- **Doc rule sync**: AGENTS.md naming rule updated to v8.3.363 (pure English slug, three-tier fallback, no proactive off); spec-unitize SKILL.md relay script gains the Windows passthrough solution and the off prohibition; six host command thin wrappers synced with the translation iron rule.

## v8.3.363 (2026-11-03) — Feature unit directory names drop doc/seq prefixes: pure English slug naming

Feature unit directory names changed from `{doc-name}-{chapter-seq}-{slug}` (e.g. new-feature-notification-01-inbox-notification) to a pure `{slug}` (e.g. inbox-notification) — the document-name prefix and chapter-sequence segment carry no unit semantics.

- **Template drops both docSlug and seq segments**: reserved-word/trailing-digit handling and chapter-seq concatenation removed; same-name chapters across documents are still deduplicated by the existing -2/-3 suffix mechanism.
- **Downstream compatibility**: legacy directories are not migrated; taskify's stripUnitSeqPrefix only strips a uniquely-hit -NN- segment, so the new format passes through unchanged and `{slug}-2` conflict suffixes are untouched (new regression assertions added).
- **INDEX directory-column refresh**: the directory column is now rebuilt whenever a title mapping exists — after re-slicing with English names or rename (pinyin directory → English directory), the INDEX directory column refreshes instead of pointing at the stale directory.
- **Ordering semantics**: filesystem order no longer equals document order; source chapter is recorded in SOURCE.md titles and INDEX.md.
- **English-name chain unchanged**: LLM translation first (cache/providers/host-AI relay) then pinyin fallback; auto_host_ai defaults to true so slicing in a host-AI environment produces English names. Legacy pinyin directories (pre-v8.3.272) get English names on re-slice via the three-way strategy.
- **Version alignment**: package.json had not been bumped since v8.3.350 (CHANGELOG already at 362); aligned to 8.3.363 now.

## v8.3.362 (2026-11-03) — Platform analysis moved to the unitize layer: auto-infer involved platforms after slicing and write back _matrix

Multi-platform feature units previously had their platform declarations filled only at analyze/taskify time, and a non-empty single-platform _matrix declaration was trusted by taskify outright (short-circuiting later inference), causing missed task splits. This round moves the platform/dependency analysis to right after unitize slicing (Plan A):

- **Post-slice auto analysis**: splitDocumentToUnits now returns the list of units written this run; unitize immediately analyzes each — empty declarations go through the six-layer inference with deterministic sources (explicit/directory/keyword) auto-written back to _matrix.md; already-declared single-platform units get superset detection via keyword + directory layers, showing extra candidates as hints only (never auto-overriding the "document belongs to platform" fact); no result in the first four layers emits an AI judgment prompt.
- **AI confirmation write-back entry**: new `unitize --confirm-platforms '<JSON>'` lets the host AI write back platforms/dependencies/apis after semantic judgment (platforms go through persistInferredPlatforms with a source note; dependencies/apis get block-level replacement preserving other fields).
- **Fixes along the way**: the inference write-back chain inferAndPersistFeaturePlatforms (v8.3.279) previously had zero callers (broken link), now wired in; superset detection bypasses inferFeaturePlatforms' Layer-2 matrix short-circuit by calling the keyword/directory layers directly.

**Verification**: zero tsc errors + 726 tests green (4 new unit tests: empty-declaration auto write-back / superset detection without override / pending prompt / confirmed write-back with all fields) + build passed; live-tested --confirm-platforms on Iteration-002 (old note replaced without stacking, all three fields written) then restored the data.

## v8.3.361 (2026-11-03) — Graph page entry points: reindex presentation marker + persistent status-panel link

The graph asset was easy to build but hard to open: graph.html had no command entry, and users had to remember a hidden path and open the file manually. This round adds two lightweight entry points.

- **reindex emits a `[SPECCORE_KNOWLEDGE: <path>]` marker**: after a successful code-graph rebuild, the marker is written to stdout as a plain line (no log prefix), so the host AI presents the graph page via present_files per protocol; terminal users can also copy the `🖼️ 图谱页面: .speccore/code-graph/graph.html` hint line to open it directly. `--check` only inspects without rebuilding and emits no marker.
- **status panel gains a persistent graph entry**: a new `🧩 图谱: .speccore/code-graph/graph.html` line at the panel footer (after the next-action line), shown whenever graph.html exists (appears as soon as reindex generates it), covering both initialized and uninitialized branches.

**Verification**: zero tsc errors + 722 tests green + build passed; live-checked that the `status` panel renders the graph line, `reindex` prints the marker on stdout, and `--check` prints zero markers.

## v8.3.360 (2026-11-01) — Graph page interaction fixes: working edge toggles, God orange badges, exit redraw

After the v8.3.358 two-layer view shipped, live testing exposed a batch of interaction defects: overview-layer edge/God toggles were inert (they only affected the member layer), God badges used the borderColor field that vis-network ignores, the detail panel covered the search box, drilled-in members scattered with overlaps, the page depended on an external CDN, and the node layer failed to repaint after exiting a community. This round fixes all six at once, each verified via browser canvas pixel sampling.

**P0 interaction fixes**

- **Overview-layer edge toggle by type**: EXTRACTED bridge edges ↔ showExtracted, MIXED bridge edges ↔ showInferred (they contain inferred components); initial state matches the toggles (MIXED hidden by default).
- **Overview-layer God toggle works**: God communities get orange border badges, toggling takes effect immediately; member-layer God nodes highlighted in sync.
- **Detail panel repositioned** below the search box, no longer overlapping it.

**P1 experience polish**

- **MIXED bridge edge legend** added (amber, overview layer only).
- **Local layout after drill-in**: existing community nodes pinned + 150-iteration stabilization, members no longer scatter with overlaps (0 overlapping pairs measured); stabilization-done callbacks centrally managed to avoid listener pile-up across rapid drill-ins.
- **vis-network vendored locally**: UMD downloaded into .speccore/code-graph/ (page opens offline), falls back to unpkg CDN when missing.

**Pitfalls recorded (three browser-side traps)**

- vis-network 10.x reads `color.border` when drawing borders — the top-level `borderColor` field is ignored. God badges now go through a color object (canvas sampling: 0 → 45k orange pixels).
- Literal `<script>`/`</script>` inside a `document.write` fallback string makes the HTML parser close the tag early — split as `'<scr'+'ipt'` and escape the tail as `'<\/script>'`; comments also avoid the literal sequence.
- Removing member nodes on exit corrupts vis-network 10.x node-layer rendering (community boxes lose their fill color; `redraw()` and attribute flips don't help) — exit now hides members instead of removing them, restoring via update on re-entry (measured 11.5k+ colored pixels).

**Verification**: tsc zero errors + all 722 tests green + build passes; reindex regenerated graph.html (197 communities / 1742 God nodes / 81 requirement links); browser-verified edge toggles, God orange badges (pixels 0 ↔ 45k), 0 overlaps on drill-in, unobstructed detail panel, exit repaint (all 9 steps passed incl. re-entry, rapid exit, drag/zoom), local vis with zero CDN references, zero console errors.

---

## v8.3.359 (2026-10-30) — analyze.ts progressive split in six batches: 7833 → 6310 lines, strategy-based mode dispatch

analyze.ts had grown to 7833 lines (the largest file in the repo), mixing the entry if-cascade with the unit domain, overview generation, and mode handlers. This round splits it progressively under the iron rule of "move the physics, not the logic; behavior unchanged; verify each step independently" — every batch passes tsc with zero errors and all 722 tests before the next one starts.

**Six batches (12 new files under analyze/)**

- **Batch A, shared core**: emitAiPrompt / AnalyzeOptions / parseDocMarkers sink into analyze/shared.ts — single source of truth for the AI handoff and option type.
- **Batch B, six small modes**: from-code / audit-fix / context-guard / module / feature / doc each become analyze/{mode}.ts (import depth ../../core/).
- **Batch C, overview**: overview mode + prompt builder + [DOC:xxx] writer move to analyze/overview.ts.
- **Batch D, unit domain family**: IterationUnit/UnitAnalysis types, UNITS_CACHE_DIR, list CRUD, unit analysis prompt, dispatch loop, quality report, and unitModes all move to analyze/units.ts (949 lines); analyze.ts switches to import + export-clause re-export (external compatibility kept, local scope bound).
- **Batch E, inline blocks become functions**: the --incremental/--reanalyze and --add-platform inline blocks become analyze/incremental.ts and analyze/add-platform.ts.
- **Batch F, entry registry (Strategy pattern)**: the 11 mode early-exit blocks collapse into an analyze/modes.ts registry — detect predicates decoupled from handlers, registration order identical to the old if-cascade; the only mode allowed to fall through, --context-guard, keeps its exact semantics.

**External anchors untouched**: analyzeCommand and buildMultiDocPrompt are still exported from analyze.ts (cli.ts / global.ts / prompt-builder.ts dependencies unchanged); analyze/*.ts submodules never import analyze.ts back — no circular dependencies.

- **Verification**: tsc zero errors + build + all 722 tests green; CLI smoke-tested seven modes live (context-guard / unit-modes / overview / incremental / module / feature / doc), from-code / full / add-platform dispatch predicates checked statically; HEAD comparison confirmed two pre-existing behaviors unchanged (below).
- **Pre-existing issues (not introduced here; behavior identical to HEAD)**: ① incremental-analyzer snapshot path `join(iterDir, '..', SNAPSHOT_FILE)` concatenates an absolute path, so a first --incremental run hits ENOENT; ② audit-fix's `!(await import('fs-extra')).pathExists()` awaits only the import, so the pathExists guard is a no-op and missing audit reports crash with ENOENT. Both await a future fix.

## v8.3.358 (2026-10-30) — Two-layer graph visualization + community detection rewrite: the 12MB hairball is history

After the "build·query·link·check" loop was wired, only "view" lagged behind: graph.html rendered everything in a single layer, a hairball on real projects with 10k+ nodes; community detection used connected components, so imports in a large codebase merged everything into one giant community, and — by definition — no edges could cross components (bridge edges always 0); 74% of nodes had no community. This round rewrites visualization and community detection, and sweeps out 7000+ duplicate edges and 26000 dangling edges.

**Two-layer view (P0 community aggregation, 12MB → 3.6MB)**

- **Community overview by default**: the page first draws only community nodes (196) plus aggregated bridge edges (cross-community edges merged per community pair) — instant load, no hairball; double-click a community to drill into its member layer, breadcrumb to return; both layers are precomputed CLI-side, the browser only switches.
- **Requirement sidebar + detail panel**: 51 requirement↔code links are clickable (highlight linked nodes and auto-drill into their community); node/community detail panel shows type, location, degree, God badge, and linked requirements.
- **Edge/God toggles + continuous hue palette**: EXTRACTED/INFERRED edges and God highlight are toggleable; 196 communities each get a distinct color, fixing the old palette where 30 communities collided at %10.
- **Physics convergence**: stabilization capped at 250 iterations, then physics is disabled — fixing nodes drifting forever and hundreds of overlapping pairs.

**Community detection rewrite (connected components → adaptive directory hierarchy)**

- **Directories as module boundaries**: starts at two-segment directory prefixes (src/core); communities over 500 members split recursively by deeper segments, falling back to per-file grouping when the directory bottoms out — any community's expanded layer stays manageable (largest observed: 834); cross-directory reference edges naturally become bridge edges (0 → 393).
- **Isolated nodes rehomed**: 12811 edge-less nodes join communities by directory, the giant "uncategorized" pool disappears; community ids are assigned by label lexicographic order, stable across rebuilds.

**Data hygiene (full/incremental parity)**

- **Dangling edge filtering**: edges pointing to external symbols (commander/Math.min) have no consumable node, so full builds now discard them uniformly (37287 → 4086 valid edges); degree/god/density statistics align with the incremental path.
- **Edge dedup**: the parser repeatedly extracted the same reference — the full build once carried 7178 duplicates; same key (source|target|type) keeps EXTRACTED first.
- **Incremental edge-loss fix**: the old implementation dropped all edges touching changed files, permanently losing "unchanged ↔ changed" edges; now only edges of deleted files are dropped, with the builder filtering stragglers.
- **Performance**: nested nodes.find (O(E×N), 37k edges × 17k nodes) in incremental merge replaced with a Map index.

- **Verification**: tsc clean + build + all 722 tests green (+3 community-detection tests); reindex smoke: 17196 nodes / 4086 edges / 196 communities, execute freshness at parity (4086 edges, both paths identical); browser-tested drill-in, requirement panel, and stationary nodes.

## v8.3.357 (2026-10-30) — Graph retrieval four-gap fix: pinyin mapping + forward link + public candidates + execute freshness

The previous four-ring repair wired up "build·query·link·check", but execution-stage graph retrieval still had four gaps: Chinese task names broke against English code names, the requirement→code forward channel was unused, public dependencies were never recommended, and the graph went stale during batch execution. All four closed this round.

**Chinese full-pinyin mapping (Chinese task names no longer absent)**

- **extractKeywords three-track extraction**: beyond camelCase/snake_case splitting, Chinese segments get three parallel tracks — full-pinyin concatenation (「站内信通知」→ zhanneixintongzhi, hits pinyin slugs), per-character pinyin (zhan/nei/xin/tong/zhi, hits scattered pinyin naming), and the original Chinese word (hits Chinese-named nodes); the convention mirrors the feature-unit naming rule (Chinese title → full pinyin).

**Forward link (requirement language drives retrieval)**

- **REQ.md as retrieval input**: the plugin reads the task's 00-specs/REQ.md requirement points (title + first 40 lines), extracts keywords, and uses REQ_CODE_LINK to hit linked code nodes forward (+4 weight) — when task-name matching misses, requirement text still backstops, so graph context never goes absent; the reverse link (node → requirement) is kept.

**Public dependency candidates (public logic now recommended)**

- **Cross-community bridge nodes pushed**: ranked by bridge degree (cross-community edge count), top 5 kept, prioritizing bridges connected to task-relevant communities — shared facilities used by multiple subsystems enter the candidates; injected as a "公共依赖候选" section urging reuse over rewrite.
- **God weighting made task-relevant**: global centrality no longer adds score unconditionally (globally "big" ≠ relevant to the current task); only keyword-matching god nodes keep +2.

**Execute freshness (batches see the new graph)**

- **Pre-batch incremental sync**: after acquiring the iteration lock and before listing tasks, execute syncs the source graph incrementally from the same-source file list — code written by task A becomes visible in task B's graph context; sync failure never blocks execution.
- **discoverCodeDirs shared by four**: source-dir discovery (PROJECT.yaml code_path → fallback src/) extracted as a shared function, de-duplicating reindex/doctor/execute with analyze reusing the same convention.

- **Verification**: tsc + build + full 719 tests green (+4 pinyin-mapping unit tests); execute --list-pending smoke synced 17164 nodes / 37226 edges in 1.8s (incremental sync proven live).

---

## v8.3.356 (2026-10-30) — Code-graph four-ring repair (build·query·link·check) + graph pipeline performance fix

The global code knowledge graph was previously "built but never queried, linked but not wired, checked but not really" — the build entry had zero callers, the query engine had no CLI integration, requirement linking wasn't hooked to from-source, and doctor only checked file existence. This release closes all four rings and defuses a hidden complexity bomb that exploded once the graph passed 10k nodes.

**Build — reindex full rebuild + analyze incremental upkeep**

- **reindex Phase 3 source-code graph**: full reindex now also rebuilds the source knowledge graph — source dirs are discovered from PROJECT.yaml per-platform code_path (falling back to src/), multi-dir collection filters noise (node_modules/dist/.git etc.); output includes 30 communities / 1713 god nodes / 17138 nodes.
- **analyze pre-Layer-1 incremental upkeep**: iteration analysis syncs the graph incrementally with the same-source file list before Layer 1, so the graph never lags behind the code during analysis.
- **collectSourceFiles shared by three commands**: analyze/doctor/reindex share one file-collection convention, preventing drift between three scanning rules.

**Query — query engine wired into prompt plugins**

- **execute impact surface**: explainNode shows the direct neighborhood of the top task-relevant node, so the implementing AI knows which existing symbols a change will touch.
- **analyze core dependency chain**: findPath shows the shortest path between the top two God nodes, giving the analyzing AI a glance at the system's core skeleton.

**Link — requirement-linker wired into the from-source chain**

- **Link on reverse-engineering**: analyzeFromCode now runs requirement↔code linking right after requirement extraction (REQ_CODE_LINK.json).
- **Global requirements included**: extractRequirements extends to .speccore/GLOBAL/requirements/ (recursive walk for subdirs); all 103 global requirements now participate in linking.

**Check — doctor checks graph freshness for real**

- **Multi-platform code_path discovery**: no longer scans only src/; source files are collected per PROJECT.yaml platform code_path.
- **File-level mtime comparison**: the graph is stale when any source file is newer than the graph's build time; the message shows both the graph time and the latest source change time.

**Performance fix**

- **idToNode Map index**: three nested nodes.find sites (detectCommunities / buildModuleMap / report generation) switched to Map indexing, plus early break on bridgeEdges — the old implementation froze for 20 minutes at 17135 nodes (billions of scans) after growing from 5287; the full reindex now finishes in 7.3s.

- **Verification**: tsc + build + full 715 tests green; real reindex smoke in 7.3s — 17138 nodes / 37180 edges / 30 communities / 1713 god nodes / 253 files, 81 requirement-linked code nodes (103 requirements, top link confidence 0.8).

---

## v8.3.355 (2026-10-29) — Assembly-chain action semantics + prototype references in AI plan

Two P0 items landed: **action semantic extraction** upgrades the auto-assembly chain from "element visibility" to "real clicks"; **prototype references in AI plan** bring prototype/design assets into the plan script, giving the executing AI visual reference points.

**Action semantic extraction (auto-assembly chain upgrade)**

- **Click steps generate real `click` actions**: when a flow-section step matches the element inventory and contains a click-class verb (点击/单击/点选/按下/勾选/选中/触发/提交/保存/删除/取消/关闭/确认/返回/刷新/搜索/查询), a `navigate + wait + click(selector)` scenario is generated; after the click only page liveness (body) is asserted, not the original element's visibility (elements disappear after close/delete clicks, which would be false positives).
- **Quote-stripping element matching**: step text is first stripped of corner brackets/quotes (「点击「新增」按钮」→「点击新增按钮」), significantly raising literal match rates against the element inventory (e.g. 「新增按钮」).
- **Prefer fewer actions over wrong actions**: input/select steps (fill/select need value parameters, which cannot be reliably inferred) never auto-generate actions and keep visibility assertions; steps that miss the element inventory keep the skeleton (page container + body fallback); the single character 「点」 is excluded from the verb dictionary (「重点」/「地点」no longer mis-trigger).

**Prototype references in AI plan**

- **Asset collection (collectPrototypeAssets)**: scans prototypes/, assets/designs/, assets/prototypes/, assets/screenshots/ under 010-requirements (up to 3 levels deep), collecting absolute paths of images and HTML files.
- **Plan "## 原型与设计稿参考" section**: when assets exist the plan header lists them for the executing AI to open and compare — complex flows gain visual references; plan.json gains a `prototypeAssets` field.

- **Verification**: tsc + build + full 715 tests green (+9 unit tests: 6 action-extraction + 3 asset-collection); real-browser end-to-end — a UI_SPEC element inventory plus a 「点击「新增」按钮」 flow step generated a VERIFY_SPEC with an auto-assembled click scenario passing 4/4 steps (real button click + page liveness).

---

## v8.3.354 (2026-10-29) — Login verification codes: AI-line retrieval hints + smoke-line auto-fill

Two-line implementation of login two-factor verification (verification code) conventions: **AI line** writes account `verification.note` retrieval hints into the plan script (main battlefield for real dynamic codes); **smoke line** adds an `auth.verification` block that auto-fills and resubmits when the password submit doesn't reach the success condition (practical for fixed-code scenarios). Four conventions: declare nearest to usage, prefer bypass on test environments, only declare the channel for dynamic codes (never store codes), and explicitly skip uncovers with skipped accounting.

**AI verification line**

- **Account `verification` field**: both env-inline accounts (environments/{env}.yaml tests.accounts) and accounts.yaml fallback accounts support `verification: { type, note }` — only the retrieval channel is declared, never the code itself.
- **Dual script hints**: new `## 登录验证码说明` section in the plan header lists all verification accounts (ref/type/note); common-layer login scenarios carry a nearby step hint; machine-readable plan.json gains `accountVerifications`.
- **Template**: accounts-example.yaml documents the verification block with an example.

**Smoke verification line**

- **auth.verification block**: `code_selector` / `code_submit_selector` (defaults to submit_selector) / `code_env` (env-var code source, takes precedence over fixed_code) / `fixed_code` (bypassable fixed code) / `code_timeout` (default 10000, also the short first-attempt success timeout) / `type` (report display).
- **performLogin two-step verification**: after password submit, first success check gets a short window (code_timeout when a verification block exists); if not reached, wait for the code input → fill → resubmit → re-check; missing code source degrades with a warning instead of blocking.
- **Transparent assembly & false-pass prevention**: the pre-smoke account assembly section shows verification readiness; verification not ready (code_env unset / fixed_code missing) is counted as skipped with an explicit report entry.

- **Docs**: testing-guide §4.5 gains a verification subsection (field table + three conventions); config-reference auth table gains verification entries.
- **Verification**: tsc + build + 706 tests green (+3 verification-convention unit tests); real-browser smoke proved the fixed-code 888888 full chain (password → code input → fill & submit → success page), wrong code degrades to logged-out state, and unset code_env shows assembly warning + explicit skip entry.

---

> 📌 **Note**: English entries below cover selected releases. For the complete version history (v8.3.194 → v8.3.289), see the Chinese [CHANGELOG.md](CHANGELOG.md).

## v8.3.353 (2026-10-29) — Verify-line six fixes: fine-spec pass-through + script pairing + zero false passes

Six verify-line wrap-ups: `--config` fine-spec pass-through, routes-trio misjudgment fix, AI script pairing refinement, acceptance-table step extraction, plus three false-pass eliminations (scenario exceptions, zero exit on failure, timeout string).

**Fine-spec pass-through**

- **--config fine scenarios passed through intact**: TestCase gains a `verify_scenarios` field — when a VERIFY_SPEC file is loaded via --config, all 22 actions + 9 assertions reach the smoke engine intact (no longer reduced to navigate-only reachability); TestConfig format supports both `tests[].verify_scenarios` arrays and single-scenario inline `actions`/`assertions`; relative navigate URLs are joined onto baseUrl, and absolute URLs are no longer double-prefixed.
- **Routes-trio misjudgment fix**: the reachability assertion becomes `visible + body` (a selector-less visible assertion always throws in the engine, so the historic trio misjudged reachable pages as failed); the engine now skips selector-less assertions and value-less navigates (reachability already proven by navigation), keeping legacy generated specs compatible.
- **Route/page scan navigate gets value**: generateSpecFromRoutes/Pages previously emitted navigate actions without value, which the engine always threw on — failing every scanned scenario; now filled with `baseUrl + path`.

**AI script refinements**

- **TEST pairing by title-keyword proximity**: replaces same-index modulo (mismatched flow/case counts rotated expected results wrongly); same-index tie-break + fallback to same-index when no overlap, so the common single-flow/single-case shape behaves unchanged.
- **Acceptance-table operation-step extraction**: `extractTableOperationSteps` extracts defensively (exact header match only, placeholder cells skipped, multi-table tolerant), shared by both lines — the AI line turns table steps into fine-grained steps, the smoke line (generateFlowScenariosFromSpec) turns them into flow-scenario skeletons.

**False-pass eliminations**

- **Scenario-level exceptions recorded as failed steps**: runScenario's outer exception previously recorded no step (empty steps' every is always true), reporting failures as "0/0 steps + 100% pass rate" — now the exception becomes a failed step.
- **Non-zero exit on verification failure**: both the UI report and the code-verification report now set exitCode=1 when summary.failed > 0 (CI previously couldn't sense failures); smoke/visual/API failures can now break the pipeline.
- **Timeout string normalization**: the verify command's commander default '120000' is a string; un-converted it made Playwright throw "expected float" — normalized at the verifyCommand entry.

- **Verification**: tsc + build + full 703 tests green; end-to-end smoke evidence — a fine scenario (navigate+click+text assertion) executed via --config passed 3/3 steps, a failing assertion showed 1/2 steps + exit=1, and a passing scenario exited 0.

## v8.3.352 (2026-10-29) — Deploy rollback & health checks + silent-skip fixes + four pipeline-hygiene fixes

Two fronts at once: the **deploy line** gains real rollback ("what to do after go-live") plus post-deploy health checks; the **verify line** kills "skipped = passed" false positives; plus four iteration-chain hygiene fixes (clarify / audit / backups / index).

**Deploy rollback & health checks**

- **Real rollback (deploy --rollback / --list-backups)**: four types supported — docker (re-tag the remote `.bak-*` image tag back to the original tag + restart the container) / ssh (extract the remote `.bak-*.tar.gz` over the dir + restart) / k8s (`kubectl rollout undo`) / helm (`helm rollback`). `--list-backups` is read-only (lists backups, changes nothing); `--rollback --backup-name <name>` picks a specific backup (docker tag name / k8s & helm revision number / ssh filename), defaulting to the most recent one; `--dry-run` previews the rollback commands; unsupported types (static/script/vercel/...) get a clear message.
- **Post-deploy health check (deploy.health_check config)**: `url` (HTTP probe, 2xx/3xx = healthy) or `command` (remote/local command, exit 0 = healthy; remote when ssh/docker/sftp/pm2 types have a host), with `retries` (default 5) / `interval_ms` (default 3000). Runs automatically after a successful deploy; failure **warns but never blocks** (already live and irreversible), and the summary report highlights the health state; the preview panel shows the config too.
- **Deploy problem ledger (.speccore/local/deploy-ledger.md)**: post-deploy test failures (pipeline) and health-check failures (deploy) are appended to a cross-iteration ledger — tabular records (time/kind/platform/env/test-type/severity/summary), idempotent append (history never overwritten), serving as a risk checklist before the next deploy; failures no longer flash past in the terminal log only.
- **Graceful empty-platforms fallback**: with no platforms configured in PROJECT.yaml, loadProjectConfigWithEnv no longer throws `platforms is not iterable` — it returns an empty array so the callers' existing empty-config checks kick in (deploy/pipeline/rollback all print readable hints).

**Silent-skip fixes (no more false passes)**

- **Skipped items counted explicitly**: UIVerifyReport.summary gains a `skipped` field; three degradation paths no longer evaporate silently — missing contract (API_CONTRACT.yaml absent / unparsable), account not ready (login scenario degrades to skip), URL undeterminable — each is counted into `skipped` and listed with its reason in both the summary report and a dedicated "skip list"; logUIReport renders it too.
- **Contract-required switch (verify --require-contract)**: a missing/unparsable API contract escalates to a verification failure (non-zero exit), killing the "missing contract = passed" illusion; the default stays skip-with-warning (backward compatible), and real API test failures count as failures as well.

**Four iteration-chain hygiene fixes**

- **Clarify state-machine idempotence**: an existing CLARIFY.md that is not a skeleton (`<!-- SPEC-SKELETON -->`) counts as clarified — analyze's pre-built skeletons are no longer misread as "already clarified", and re-clarification no longer overwrites the real artifact.
- **Audit orphan filtering**: after features re-slicing (units renamed/deleted), stale unit dirs under 020-specs no longer enter the quality audit (orphan dirs are not audited as modules); for legacy projects without features/, the filter auto-disables.
- **Slice-backup lifecycle (unitize --prune-backups [days])**: lifecycle management for overwrite timestamp backup dirs — no arg lists them only, a day count deletes backups older than N days.
- **INDEX dir-column backfill (doc2spec)**: title → actual dir-name mapping (incl. rename -2/-3 suffixes); skipped units record their existing dir name too, and legacy INDEX rows get their "目录" column backfilled from the current slicing mapping.

- **Tests**: 2 new test files (quality-audit-orphan two-scenario orphan filtering / requirement-clarifier-has-valid real-artifact detection); the deploy/verify changes passed tsc + build + smoke (--list-backups graceful empty-config hint, --require-contract non-zero exit on missing contract, ledger idempotent append); full suite 703/703 green.

## v8.3.350 (2026-10-29) — AI browser verification: accounts, layered scripts, dual-line switches

A new "AI browser verification" mode replaces the manual selector-config burden of smoke tests: the CLI slices interaction specs and test cases from 020-specs into natural-language verification scripts (with env entry URLs and account references); the host AI (Browser sub-agent) visually drives the interactions and business assertions; results are written back to JSON; the CLI then renders an HTML report. Scope: all units / deployed-only / named modules.

Core division of labor: **the CLI slices, never parses semantics** — it grabs raw paragraphs from UI_SPEC.md/TEST.md by headings, leaving semantic understanding and page operations to the executing AI.

- **Account config (separate file)**: templates/accounts-example.yaml → `.speccore/tests/accounts.yaml` on init (never overwrites; example always refreshed). Grouped by env with multiple roles; scripts reference account names only (e.g. `staging.admin`) — no password copies; the executing AI reads plaintext directly. Sensitive credentials support `${VAR}` env references: the plan records ref/field/varName/set into accountEnvVars with per-var warnings.
- **Deploy manifest**: deploy writes `.speccore/local/deploy-manifest.json` (env/time/platforms), powering `--scope deployed`.
- **Script generation (new src/core/ai-verify/)**: scope-resolver (all / deployed / modules:xxx, stacked with --platform) + plan-generator (entry from environments tests.base_urls, account picked by "platform match → unrestricted → first", SKELETON units skipped) → `Iteration-NNN/000-overview/ai-verify/` plan.json + AI_VERIFY_PLAN.md.
- **Layered scripts (common layer + modules layer)**: plan.json gains a `groups` view (flat `scenarios` kept for compatibility) — the **common layer** is CLI-templated per platform (entry reachability / login state / global navigation, id prefix `common__`, login skipped without accounts) and runs **before** the **modules layer** (per-unit UI_SPEC/TEST slices); login readiness is the modules prerequisite. Both AI_VERIFY_PLAN.md and the HTML report render per layer (layer head shows enabled state + note, closed layers marked ⏭️, legacy plans without groups fall back to per-platform rendering). `verify --ai` prints per-layer stats and a 4-step execution protocol (advance by layer → batch per platform → write results.json → --ai-report); the SKILL.md protocol advances by layer too. With no units, the common layer alone still yields a plan.
- **Dual-line switches (settings.tests)**: `.speccore.yml` gains `settings.tests` — `smoke.enabled` (config-driven smoke line; auto-triggered UI verification is skipped when off, explicit --ui/--config/--stage still runs with a warning), `ai_verify.enabled` (AI host verification line; explicit --ai still runs with a warning), `layered.common/modules` (per-layer toggles; closed layers generate no scenarios but keep their audit header). Semantics: **explicit CLI flags > config switches**, all defaults on. Synced across DEFAULT_CONFIG / types / validation / serializer / example templates, with the serializer-consistency machine lock and example-alignment tests guarding against silent field loss.
- **verify command wiring**: --ai / --scope / --platform / --env / --ai-report / --ai-judge; takeover markers `[SPECCORE_AI_VERIFY]` + `[SPECCORE_AI_VERIFY_ACCOUNTS]`; three-tier execution channel fallback in SKILL.md (Browser sub-agent → Playwright MCP → screenshots + `--ai-judge` visual fallback with executor audit). Existing --ui selector smoke is untouched — both modes coexist.
- **HTML font localization**: all 16 `fonts.googleapis` @imports replaced with local @font-face (bundled OFL variable fonts Orbitron.woff2 + JetBrainsMono.woff2 in templates/html/fonts/); page-bundle's ensureHtmlAssets copies fonts/ next to every HTML output dir (9 commands + template copy chain). mermaid/chart.js CDN JS left for a later pass.
- **"merge into {env}" intent**: ask gains a deterministic short-circuit — "合并/提交到 {env}" sentences always route to `pr --base <env>` (immune to execute's broad trigger "开发" and KB ordering); "合并需求" (no 到) still routes to analyze. `pr --base` now accepts env-name references (new resolveBaseBranch: env name → resolveEnvBranchRef → environments/{env}.yaml branch; literal branch names pass through) — same chain as pr_target env refs: "recognition in ask, resolution in pr". Domain detection aligned with the AMBIGUOUS_INTENTS mechanism: without speccore context words the answer first asks "speccore operation or plain discussion" (the sentence is common in everyday talk), while "用 speccore 合并到测试环境" goes straight through.
- **Intent-cache fuzzy-layer param guard**: parameterized sentence templates (e.g. "合并到{env}") no longer fuzzy-hit across slot words (测试 vs 开发) — the fuzzy layer now requires identical semantic token sets, serving only synonymous rewording, so a cached test result can never leak onto dev.
- **Prompt library dual-channel**: page-side edits were localStorage-only — the page now has export/import buttons, and the CLI gains `prompts --import <file>` (merged by id into .speccore/prompts/user/custom-imported.json) and `--export <file>`; all loaders parameterized on projectRoot (fixes --project-dir and init/welcome linkage). New-entry ids become `prompt-` + UUID (crypto.randomUUID with a timestamp fallback for file:// browsers), fixing same-millisecond Date.now() id collisions; edits no longer overwrite createdAt with undefined.
- **Setup guide AI verification block**: setup-guide step 6 gains a "测试验证 (v8.3.350+)" block (AI browser verification / visual fallback / `${VAR}` account refs) to onboard the freshly shipped AI verification.
- **Tests**: 5 new test files (scope-resolver / plan-generator incl. layered groups + layer toggles + common-layer scenarios / result-parser incl. layered rendering + legacy fallback / visual-judge / prompts incl. UUID id generation), 52 cases; build passes, full suite 692/692 green.
- **Five verification-system refinements (account convergence / contract split / trigger tiering / switch matrix / plan-header warning)**:
  - **Account convergence (tests.accounts as authoritative source)**: the AI-verification account authority moves from accounts.yaml into `environments/{env}.yaml` `tests.accounts` (declared locally; the account name is the ref, e.g. admin); accounts.yaml is demoted to a global fallback (used only when the env file has no accounts for that env), and its template header documents the new role. Login scenarios label the credential source; `${VAR}` scanning covers both sources; when the env file already declares accounts, the accounts.yaml placeholder template is no longer generated. The environment parser's tests whitelist gained the accounts field (the omission was caught by CLI smoke immediately). The plan now carries an `accountSources` field (machine-readable account-source hints); the `SPECCORE_AI_VERIFY_ACCOUNTS` marker and the SKILL execution protocol follow it and point to the actual source (the env file when inline accounts exist, so the executing AI never looks up credentials in the wrong file).
  - **Environment contract split (deploy contract vs verification contract)**: staging.yaml.example's tests block is now a standalone "verification contract" section — one env file carries two contracts with different consumers: the deploy contract (branch/platforms.build_cmd/platforms.deploy/stages/pipeline, consumed by build/deploy/pipeline) and the verification contract (tests.base_urls/visual_model/auth/accounts, consumed by the verify smoke line and AI verification line); comments label each field's consumer to prevent mixing deploy and verification params.
  - **Ambiguous trigger explicit tiering (priority tie-break)**: COMMAND_KB entries gain a `priority` field — equal trigger-length scores are decided by priority (higher wins, default 0), declaration order only as the last resort; verify declares priority:1 (the test-action sense wins when "验证" hangs on both verify and validate), and a KB header comment states "ambiguous entries must set priority explicitly — never rely on declaration order". The implicit first-come-first-served is now an explicit tier (symptom-level: multi-word shared triggers remain the root).
  - **Switch matrix (setup guide)**: the guide's verification block gains a "dual-line switches & layered scripts (settings.tests)" panel — smoke.enabled / ai_verify.enabled / layered.common+modules plus the three-path priority "CLI explicit args > config switches > quality-gate auto-trigger"; the account card now states the dual-source model (tests.accounts authoritative + accounts.yaml fallback).
 - **Plan-header degradation warning**: when the common layer lacks login accounts, AI_VERIFY_PLAN.md's header explicitly marks "公共能力层降级" — per-platform login-skip reasons, reminding the executing AI that the common layer covers reachability only (entry reachable / global navigation), with the fix path to add accounts; the warning is absent when accounts exist.
- **Requirement-chain audit fixes (clarify idempotency / orphan dirs / INDEX dir column / backup hint / interactive interview)**: an end-to-end audit of the unitize → clarify → analyze chain surfaced and fixed five issues:
  - **Clarify idempotency fix**: the clarify-detection loop now treats an already-landed `020-specs/{unit}/overview/CLARIFY.md` (non-skeleton) as "already clarified" and skips re-detection — no longer relying on the `_matrix.md` clarify flag, which had no write-back channel and kept re-prompting clarification on every analyze run.
  - **Interactive clarify protocol upgraded to six steps**: a "key-question interview" is now inserted before drafting — after the deep review (Step 1), the AI asks 3-5 highest-impact questions the source docs cannot answer (with 2-3 options each and a recommended choice) and waits for answers before generating Draft v1; the original steps renumber accordingly (interview → draft → comparison view → iterative confirmation → confirmed write). Auto mode is unchanged.
  - **Orphan 020-specs detection**: after pre-building skeletons, analyze compares top-level 020-specs directories (excluding overview/requirements) against the feature-unit list and warns about leftovers from a re-split — preventing QUALITY_AUDIT from auditing stale unit dirs as live modules.
  - **INDEX dir-column addition**: the 010-requirements INDEX table gains a 目录 column, backfilled from the title → dir-name map for preserved legacy rows (including skipped units) and written for new rows — no more guessing which directory a feature unit lives in.
  - **Backup accumulation hint**: when features/ contains timestamped split-backup directories (from overwrite), analyze prints a reminder that they are rollbackable copies and can be deleted once confirmed.
- **Skeleton-filter closure for clarify detection & audit + backup lifecycle**:
  - **hasValidClarifiedDocs skeleton filter**: the pure-prompt-mode (non --auto) clarify gate only checked CLARIFY.md existence, so analyze's pre-built skeletons (empty templates carrying the SPEC-SKELETON marker) were miscounted as clarified — clarification was silently skipped even when it never happened. Now only "exists and non-skeleton" counts as a real artifact (global and unit levels share the same predicate, aligned with the auto-branch idempotency check); 5 regression tests cover skeleton miscounting / half-coverage / mtime guard.
  - **QUALITY_AUDIT orphan filter**: the audit's 020-specs top-level scan now filters orphans (stale unit dirs from a re-split) against the features/ list — abandoned artifacts are no longer audited as live modules; projects without features/ automatically disable the filter; 2 tests added.
  - **unitize --prune-backups backup lifecycle**: overwrite timestamp backups previously had a hint but no cleanup path; new `--prune-backups [days]` — bare flag lists only (dry-run with age), a day count deletes backups older than N days; the analyze accumulation hint now points to this command.

## v8.3.348 (2026-10-28) — Deploy chain transparency: plan panel + automatic branch resolution + live config reads

The whole deploy journey is now visible — which environment, which platforms, which branch, which build command, where it deploys, and how it went:

- **Deploy plan panel**: before executing, deploy prints a per-platform plan — target branch (with source) → build command → deploy target, with dry-run / skip-build flags annotated.
- **Automatic branch resolution (4-level fallback)**: deploy no longer builds the workspace as-is; it resolves the target branch via "env platform-level branch → env global branch → PROJECT.yaml default_branch → subtask git-config source branch" and then checkout + pull; explicit --branch wins. New shared module src/core/deploy/branch-resolver.ts, reused by pipeline.
- **Transparent git output**: checkout / pull / merge output is passed through directly (what was pulled, conflict reasons) instead of being silently piped away.
- **Summary report branch column**: both deploy and pipeline summaries show the branch actually used per platform.
- **Live config reads on every run**: deploy re-reads PROJECT.yaml and environments/{env}.yaml from disk on every launch (no caching anywhere in the chain) — user edits to branch / build command / deploy target take effect immediately; env config is now also loaded by default when --env is omitted. The spec-deploy skill records the "read before execute" discipline.
- **Remote package backup switch**: ssh deploy tars the remote dir before SCP overwrite; docker remote deploy tags the old image before pull (zero-cost tag); retention backup_keep (default 5) auto-prunes the oldest. Four control layers — config fields backup/backup_keep + global CLI --backup/--no-backup + per-platform exclusion --skip-backup-for h5-mobile,order-api + ask natural language ("deploy with backup" / "deploy without backup" / "deploy to test, skip backup for h5-mobile" → per-platform exclusion). The plan panel shows backup status per platform. sftp unsupported for now (no remote shell).
- **ask deploy routing fix**: "deploy to X environment" was misrouted to the run --preset deploy pipeline (and the intent cache could freeze the misjudgment); it now deterministically routes to the deploy command, and the word "test" inside "test environment" is no longer mistaken for a test action.
- **pr --auto dead-flag fix**: the --auto flag passed by run pipeline pr steps was never registered in the CLI — it was silently swallowed and degraded to interactive waiting; it now expands to --force + --create-pr (non-interactive commit + PR creation).
- **pipeline backup switch pass-through**: pipeline registers --backup / --no-backup / --skip-backup-for and passes them through to its internal deploy step (same semantics and priority as the deploy command).
- **Examples fixed**: deploy-examples.yaml environment section updated to the new structure (env / defaults / platforms.{platform}.branch), with 4-level fallback, plan panel and backup field docs.

## v8.3.347 (2026-10-28) — Project card injection on demand: fuzzy platform names → project info mapping

When the user mentions a platform in natural language (platform name / business name / type word), the AI no longer needs the user to re-explain "what this project is, where the code lives":

- **Three-tier matching, multi-platform hits in parallel**: platform name (word boundary + compound-name segmentation, "H5端" → h5-mobile) + business-name fuzzy hit + type word ("前端" → all frontend platforms). Mentioning N platforms in one sentence injects N mini cards; unmentioned projects get zero injection.
- **Fuzzy layer**: normalization tolerance (case / spaces / hyphens) + Chinese sliding window — "预订" → booking service, "后台" → admin console; all 3 fields must appear in full to avoid generic words like "移动" / "程序" false-hitting.
- **Confidence grading**: platform name / full list / type word = certain (injected directly); sliding-window partial mention = ⚠️ suspected marker + guided verification — guesses are never mixed with confirmed info.
- **Four-layer hint system**: AGENTS.md "project quick reference" section (one-line resident pointer per platform) + ask hit injection + suspected marker + full cards persisted to .speccore/GLOBAL/PROJECTS.md (sourced from PROJECT.yaml platforms; AI reads on demand).
- **Docs health check synced**: full doc sweep after the command-surface convergence — stale references in clarify/synthesize/status-panel, ghost slash commands (/spec-progress, /spec-task-new …), broken repo-name layout in workspace-organization, run split examples unified to split-units.

## v8.3.346 (2026-10-26) — Command surface convergence: help panel 51 → 22 core commands

`speccore --help` used to list all 51 commands below the core box — "60+ commands" scared off new users. Now converged into three tiers:

- **22 core commands shown**: 13 pipeline stages (init → doc2spec → req-doc → unitize → analyze → taskify → plan → execute → verify → pipeline → pr → done → spec2doc) + base management (iteration/task) + smart entries (ask/run/next/dashboard/status/about/help).
- **29 commands hidden but fully functional**: low-frequency/ops/internal-orchestration commands (doctor/migrate/change/validate/global/search …) are hidden from the help panel — the ask intent dictionary, run pipeline orchestration, and internal calls still work, and typing the command directly still executes it. Hidden ≠ deleted.
- **Full-list entry**: new `speccore help --all` shows all commands in two sections (⭐ core / 🔧 more); the default `speccore help` category view converges to 6 core categories, with 9 missing command details (doc2spec/verify/pipeline/spec2doc …) filled in.
- **Single source of truth**: new `src/core/command-visibility.ts` (CORE_COMMANDS set) consumed by both the cli.ts hide pass and the help.ts full view — add/remove a command in one place; built on commander 11's `hidden` option (visibleCommands filtering), zero functional loss.
- **Core box synced**: help-panel.ts header box now shows the full 13-stage pipeline line, drops the hidden change/validate/rename/prompts, adds verify/pipeline/req-doc/status, and points to `help --all` at the bottom.
- **Docs synced**: README (zh/en) "complete commands" tables converge to the 22 core commands (dropped the "60 commands" wording); the static template templates/html/speccore-help.html removes ghost commands (code-index/history/knowledge/refresh/track) and rewrites into 6 core categories + a `help --all` hint; docs/command-reference.md and docs/commands.en.md note the panel convergence.

## v8.3.345 (2026-10-26) — FUNCTION_MAP unit-ID header compatibility

Fixes the "feature-unit name column misparse" breakage: analyze now writes FUNCTION_MAP with the header "| 单元ID | 功能模块/功能单元 | 中文名 | 涉及端 | 优先级 |" (first column is a unit ID like M-01), but parseFunctionMapTable still took the first column as the unit name — parsing name='M-01' instead of the directory name. Three taskify downstreams suffered: module-driven split produced task names/slugs like "m-01", extractOverviewContext keyword splitting yielded an empty set (feature-unit context entirely lost), and the coverage check reported false omissions.

- **Name-column header locating**: parseFunctionMapTable gains nameColIdx — the column whose header contains 「功能模块/功能单元」 but not 「涉及端」 (correct for both the new 2nd-column layout and the old 1st-column layout); without header info, fall back to — first cell if it's a unit-ID pattern (M-01/F-01) → take the second cell, otherwise take the first (legacy "| 目录名 | 名称 | …").
- **Trigger widened**: inTable detection for both the table parser and raw-row parser now accepts 「功能单元/功能模块」 dual headers, so the analyze aggregate template (「功能模块」 header) also triggers parsing and detection.
- **Detection unaffected**: detectNarrowPlatformDeclarations anchors on any cell exactly equal to the feature-unit directory name, decoupled from name-column locating; end-to-end verification on the meeting project real data returns gaps=0.

## v8.3.344 (2026-10-26) — iteration media asset injection (prototype HTML + reference screenshots/designs)

Closes the "asset directories have no channel" blind spot: previously only assets referenced by Markdown links inside already-loaded docs reached the context (processMarkdownContent expands in-doc links/images), while unreferenced prototype HTML, reference screenshots, and design mockups under 010-requirements/prototypes/ and assets/ (extracted/prototypes/designs/screenshots) had no channel at all — execute generated code without ever seeing the prototype, and analyze produced UI_SPEC without seeing the designs.

- **collectIterationMediaAssets**: buildPrompt scans the media directories for execute/analyze with an iteration (bounded-depth recursion). HTML prototypes go through renderHtmlPrototype for an ARIA semantic tree + screenshot path (multimodal hosts can view directly), with extractHtmlText fallback on render failure; images get vision-model descriptions (first 3) or a path+size listing (max 10). Caps prevent context bloat; no assets → silent null; scan failure is non-blocking.
- **analyze rawPrompt routing handoff**: the rawPrompt route discards regular extraSpecs, so media assets are appended alongside the reading list — analyze phase (UI_SPEC generation) now sees the visual assets too.
- **Asset-audit consistency**: all media injection goes through recordAssetAudit, so broken links/degradations stay visible in the audit block instead of silently vanishing.

## v8.3.343 (2026-10-23) — FUNCTION_MAP platform-coverage cross-check (narrow-declaration detection)

Fixes the "platforms declared at split-time ≠ platforms realized at analyze-time" breakage: the `platforms` field doc2spec writes into `_matrix.md` means "which platform this platform-level requirement doc belongs to" (often single), while the platform coverage analyze-phase AI writes into FUNCTION_MAP means "which platforms this feature unit involves across-end collaboration" (multiple) — both carried by the same field with no cross-check. Skeletons converge to the single-platform declaration, so backend platform-level specs for multi-platform units went largely missing: taskify had no backend specs to work from (hallucinated or skipped tasks), and execute generated incomplete code.

- **Narrow-declaration detection**: new `src/core/function-map.ts`. After analyze skeleton progress detection, FUNCTION_MAP coverage is compared against `_matrix` declarations (rows anchored by a cell exactly equal to the feature-unit directory name, with adaptive platform-column locating). Two gap classes are warned separately: ①missing — in FUNCTION_MAP but not `_matrix`, with no real specs under the platform dir → back-fill hint; ②undeclared — platform specs exist but `_matrix` doesn't declare them → declaration-sync hint (taskify's readMatrixPlatforms trusts any non-empty declaration, so without syncing, multi-platform subtasks still won't be generated). Warn-only, never writes back, so AI-generated FUNCTION_MAP can't pollute the authoritative declaration.
- **FUNCTION_MAP parsing consolidated**: `parseFunctionMap` (table + tree formats, adaptive platform-column tolerance) moved from taskify.ts into function-map.ts, shared by analyze detection and taskify splitting — eliminating dual-implementation drift.
- **DOC_MATRIX top-level check fix**: feature projects now skip the legacy `020-specs/{platform}/` top-level platform-doc check (already covered by computeFeatureBasedAnalyzeManifest under `{feature}/{platform}/`), fixing spurious top-level skeleton file creation.

## v8.3.342 (2026-10-22) — HTML page family linkage

Fixes the broken-link class of bugs where commands pop up HTML pages that don't exist, or whose in-page jump targets are missing: the welcome project card links to the ask onboarding / setup guide / help pages, but those targets were only generated after their own commands had been run; worse, welcome's TTY branches emitted the `[SPECCORE_WELCOME]` marker without writing the HTML file — host AIs opened a path that didn't exist. New `src/core/page-bundle.ts` idempotently back-fills all jump targets; welcome/ask/init entry points unified onto it.

- **Page-family bundle module**: `ensureAskPages` (onboarding + four mode pages + help + prompts), `ensureSetupGuidePage` (setup guide + prompts), `ensureWelcomeTargets` (all card jump targets) — idempotent, non-blocking on failure; ask.ts loaded via runtime dynamic import to avoid circular deps.
- **welcome broken-link fix**: AI branch and all three TTY branches now write the card and back-fill the family before emitting the marker — fixing the previous "marker without file" bug; phase/task-count computation hoisted to function scope.
- **ask/init consolidation**: ask's first-use/upgrade ceremony now calls `ensureAskPages` (copy + prompts linkage collapsed into one place); init's `writeSetupGuide` reuses `ensureSetupGuidePage`.

## v8.3.341 (2026-10-21) — engineering health + command inventory consolidation

Two themes: ①four improvements from the full-project health review — deploy engine switched from execSync template concatenation to execFileSync argument arrays (the only security-bearing item — closes the "config-as-command" injection surface), branch-type extraction and env-dir resolution consolidated into shared exports, pure functions in three core engines exported and slice-tested, analyze.ts monolithic function progressively split (8 mode-early-exit blocks, 476 lines, extracted into module-level functions); ②command inventory consolidation — 20 edge commands removed (pipeline core commands, progress exports, and friendly commands like welcome/help/about retained), all mention points (help / ask dictionary / completion / README / docs / IDE slash commands / runtime hints / template presets) cleaned up, index maintenance unified into reindex. Zero behavior change; full suite 621/621 passing.

### Deploy engine argument-array hardening (v8.3.341+)

11 shell-less command executions in `src/core/deploy/engine.ts` moved from execSync string templates to execFileSync argument arrays (new `runFile` wrapper): aws s3 sync, rsync, vercel, kubectl, scp/ssh, helm, pm2, serverless (Alibaba FC / AWS Lambda / Tencent SCF), etc. Config values pass as separate arguments, never interpreted by the shell — previously target/host/namespace values could inject shell metacharacters. Three semantics preserved: `cd X && cmd` transformed equivalently to `cwd=X` array execution; the `scp ${outputDir}/*` glob (previously shell-expanded) now expanded explicitly via the glob package; sshpass password passed as a separate argument (no quote concatenation). User-written shell commands (build_cmd/script/pre_deploy), tool-availability probes (sshpass -V), and pipelines keep execSync.

### Shared utils consolidation (v8.3.341+)

- **extractBranchTypeFromBranchName**: promoted from pr.ts to git-integration as a shared export (pure, testable); pr.ts reuses it; non-task branches (no type segment) return undefined.
- **envDirFor**: environment-config gains a parameterized export (explicit project root); update-env-configs' initEnvironmentConfigs reuses it — the path join segment now lives in one place.

### Core-engine pure functions exported + slice tests (v8.3.341+)

Three previously untested core engines gain slice tests (18 new cases):

- **structured-extractor**: isTsOrJs / detectLanguage / inferPlatform exported; tests cover TS/JS-family extensions (incl. mts/cts), Java/Python/Go detection, path→platform attribution.
- **prompt-builder**: extractInfoGaps (INFO_GAP extraction + dedup) and parseAiResponse (AI response JSON parsing) exported and tested — both are key parsers of the AI relay protocol.
- **extractBranchTypeFromBranchName**: task-branch type extraction, non-task branches → undefined, blank-name tolerance.

### analyze.ts monolithic split (v8.3.341+)

analyzeCommand (previously 2570 lines) is built from "mode early-exit blocks"; 8 zero-data-flow blocks are now module-level functions: analyzeFromCode / analyzeAuditFix / analyzeContextGuard (returns whether handled) / analyzeModuleMode / analyzeFeatureMode / analyzeDocMode / analyzeOverviewMode / analyzeUnitModes — 476 lines total (function down to 2094 lines). Dependency rules: `_projectRoot` passed as a parameter; narrowing lost by extraction (options.module/feature/doc) restored with non-null assertions. The main apply block (~1150 lines) remains for the next round due to the cross-block needsClarify data flow.

### Command inventory consolidation (v8.3.341+)

After auditing 67 command files, pipeline core commands, internal calls, progress exports, and friendly commands (welcome/help/about/doctor/dashboard) are retained; 20 edge commands removed: `knowledge`, `graph`, `rag-index`, `code-index`, `refresh`, `notify`, `workspace`, `recommend`, `baseline`, `diff`, `rollback`, `merge-check`, `verdict`, `impact`, `audit`, `history`, `handover`, `track` (registered as trace), `tracker` (dead file), plus orphan engines `smart-recommend`/`mermaid-render`. All mention points cleaned in sync:

- **Runtime hints relocated**: 25 hints across index-guard/doctor/analyze-engine/code-scanner/error-diagnosis pointing at `speccore refresh/code-index/verdict` now point at `speccore reindex` or the ARBITRATION_REPORT.md human-arbitration entry; the internal execSync call to the removed audit command in done.ts is dropped.
- **Intent dictionary converged**: intent-recognition drops 6 IntentType entries and intent blocks; "update/refresh index" triggers map to reindex; ask-engine command table / mapping table / workflows cleaned.
- **Display surface synced**: help category table, completion array, README command table, docs series (command-reference / commands.en / scenarios (both) / DESIGN / quick-reference and 15 files in total), 12 IDE slash commands, SKILL and slash templates generated by init, and the prompts governance presets all drop removed-command mentions (historical version-evolution rows retained; deprecated planning entries annotated "deprecated").

### .speccore.yml config comment unification (v8.3.341+)

Comments in .speccore.yml generated by init and config --upgrade are unified to the meeting-project baseline style (field-name: Chinese description + value → meaning) and stale comments that contradict real code are corrected:

- **Enum values corrected**: arbitration.mode comment simple → l1-only/report-only; settings.patterns.auto_save comment always/false → aggressive/off; ask.routing.mode comment local/llm → cli-only/host-ai-only; assignee.mode gains off; the renamed split command in arbitration description and ai.defaults description becomes taskify.
- **New sections annotated**: vision section gains comments for model/maxImagesPerPrompt/imageMaxSizeKb and a value → meaning enum for provider; agent_dispatch switches from a pre-section "=" list to a mode field comment with enums.
- **Reference example synced**: templates/speccore-yml-example.yml and its landed copy (.speccore/examples/config/SPECCORE-YML-EXAMPLE.yml) wording aligned (block_level description / UI-verify section header / devices-browsers block style / smoke inline comments), machine-lock test guarantees same-source identity.

## v8.3.340 (2026-10-21) — three-tier task naming alignment + member model expansion + PR target env reference

Major themes: ①taskify module/subtask/Git-branch three-tier naming aligned to feature unit names (no global counter, no platform-name redundancy), Git suffix defaults to owner pinyin initials; ②member model expansion (roles / on-project status / branch code). Also: iteration creation auto-initializes staffing & Git config snapshot, runtime dependency fix (MODULE_NOT_FOUND on global install), done/archival full-path unification, title normalization on-demand (off by default), config upgrade chain & static HTML page links fix, member wildcard semantics (* = full-stack / all directions), PR target decoupling (git.pr_target + branch_types[{type}].pr_target, independent of default_base), execute --module multi-value fuzzy matching, and PR target environment-name reference (pr_target: dev resolves to the environment's branch field in .speccore/environments/, unifying PR target with the pipeline/build/deploy environment model; literal branch names still work when no matching env file exists).

**PR target environment-name reference (v8.3.340+)**: `pr_target` (both `git.pr_target` and `branch_types[{type}].pr_target`) may reference an environment name defined under `.speccore/environments/` (e.g. `pr_target: dev` → `develop`); resolution falls back to the literal branch name when no matching env file exists or the env declares no `branch`. Values containing path separators or `.yaml`/`.yml` suffixes are treated as branch names, never resolved as environments.

## v8.3.301 (2026-10-08) — global from-source reinforced: EARS five-pattern ACs + traceability anchors + verification ring, ask auto-maps platform names

### Reverse requirement chain (global from-source)
- **EARS five-pattern upgrade**: UR acceptance criteria upgraded from the single "when X, system shall Y" form to five scenario patterns (Ubiquitous / Event-driven / State-driven / Unwanted / Optional), plus two anti-translationese hard rules (subject must be user/business object — no function-name literalism; must carry user value — "outputs JSON" is not an acceptance criterion)
- **Traceability anchors**: IR business-semantics section gains an anchor field (file#symbol); UR feature-unit table gains an anchor column, every AC carries `[溯源: \`{endpoint}/{module}\`]`
- **Verification ring (--verify)**: new `verifyReverseAnchors` deterministic check — every REQUIREMENT.md anchor is compared against the IR module whitelist; dangling anchors (referencing non-existent modules) are flagged as suspected AI hallucination and written to VERIFY_REPORT.md; REVERSE_PROMPT gains a third hop; both `global from-source` and `spec-from-source` support --verify

### ask intent recognition
- **Colloquial triggers expanded**: dictionary + extractParams add 12 reverse-phrase variants (按端反推/按端生成需求/生成需求文档/需求文档反推/代码生成需求/按模块反推/反推文档 etc.) — phrases without 反推/逆向 words now hit global from-source
- **Platform auto-mapping**: platform names or Chinese descriptions found in the sentence auto-append `--platform <name>` + `--src <code_path>` from PROJECT.yaml (`resolvePlatformFromInput` picks the longest name match to avoid substring collisions; config load failure degrades silently)
- **LLM fallback backfilled**: intent-ai placeholder fallback gains a global_reverse intent (reverse-semantics regex + suggested command)

### Docs
- DESIGN.md seven-layer section adds the "source-reverse requirement chain" design note (industry-consensus comparison + three-piece semantics)
- help.ts / SKILL.md synced with --verify and platform auto-mapping notes

## v8.3.300 (2026-10-08) — Branch pipeline health-check fixed: default_base/end-level overrides take effect + PROJECT.yaml upgrade blocking resolved

### Fixes (branch pipeline, this release)
- **git.default_base and end-level overrides never consumed (core bug)**: getEffectiveGitConfig was a dead function — types/defaults/serializers all existed but no caller; changing default_base or platforms[].default_branch/branch_types had no effect. Fixed: taskify now uses getEffectiveGitConfig (end-level merged) when writing the subtask "source branch"; default_base finally acts as the fallback anchor; null-platforms guard added
- **pr.ts PR target branch hardcoded 'main'**: three `options.base || 'main'` sites never read config. Fixed: resolvePrBase() falls back to PROJECT.yaml git.default_base
- **PROJECT.yaml protected_branches never took effect**: isProtectedBranch only read CONSTITUTION.md. Fixed: added getProtectedBranchesMerged / isProtectedBranchAsync (PROJECT.yaml global+end-level as primary source, CONSTITUTION.md fallback); switched 4 call sites in pr/execute
- **init template vs parse regex mismatch**: CONSTITUTION.md template used Markdown bold ("- **默认分支**:"), the parser never matched it — freshly init'ed projects read no default branch and empty protected branches → isProtectedBranch always false → pr would push directly to protected branches. Fixed: template de-bolded + line-anchored regex with double-sided asterisk support (also avoids false match on field-description lines like "> - **默认分支**：如 main...")
- **Misleading comment corrected**: unified-config.ts claimed "speccore update syncs to CONSTITUTION.md" while update explicitly keeps it untouched; now states PROJECT.yaml is the authoritative Git config source

### Fixes (config upgrade, v8.3.299 accumulated)
- **PROJECT.yaml upgrade blocked by project.description**: early init-generated PROJECT.yaml carried description/version, not in DEFAULT_PROJECT_CONFIG → judged "removed" → upgrade halted → git/code_scope never backfilled. Fixed: PROJECT_OPTIONAL_PATHS whitelist (project.description/project.version/verify) filters removed, user values preserved
- **verify serializer omission**: ProjectConfig.verify typed (v8.3.58+) but never serialized — lost on upgrade. Fixed: toProjectYaml now emits the verify section (router_file)
- **default_branch unconditionally wrote "undefined"**: fixed to conditional output
- **update report/behavior mismatch**: LEGACY whitelist only reached upgradeConfig; update check + checkAllUpgradeIssues still used raw diff and misreported "fields to delete". Fixed: three sites share the same filter

### Verification
- Build clean, 291 tests green
- 5 parser fixtures (bold / non-bold / description-line pollution / table-row pollution / wildcard semantics) all pass
- Double-upgrade shows "no upgrade needed" (no fake backfill); legacy project with description+verify upgrades once with git/code_scope backfilled, user values kept, no "undefined" written

## v8.3.298 (2026-09-29) — Legacy main-config upgrade blocking fixed: old fields auto-migrated, new fields no longer stuck

### Fixed
- **Old .speccore.yml upgrade blocked by "manual confirmation" (core bug)**: early versions kept platforms/git/code_scope/project in the main config (later moved to PROJECT.yaml), so upgrade detected them as `removed` → `requiresUserConfirmation` aborted → only an upgrade-diff.md was written, never the upgrade → users' configs never gained logging/verify_ui etc. Fix: legacy top-level field whitelist (project/platforms/git/code_scope auto-migrated into .speccore/PROJECT.yaml with backfill-only-if-empty semantics; tech_stack/team/conventions/error_codes dropped as deprecated); after filtering, removed no longer blocks and the upgrade runs fully automatic

### Verification
- 291 tests green; old-format repro: before the fix upgrade aborted (25 added + 6 removed awaiting confirmation) → after the fix one run completes, logging block & verify_ui section land on disk, old fields cleared, platforms fully migrated into PROJECT.yaml (name preserved)

## v8.3.297 (2026-09-29) — vision upgrade fake-fill fixed + config doc ownership correction

### Fixed
- **settings.vision upgrade fake-fill (hand-written serializer omission)**: the vision field had a type (v8.3.94) and docs, but DEFAULT_CONFIG never included it and the toConfigYaml serializer never emitted it — `config --upgrade` repeatedly claimed "auto-filled" while dropping it on save, so users never saw the vision block. Fix: DEFAULT_CONFIG now includes vision defaults (enabled: false / provider: qwen-vl / maxImagesPerPrompt: 10 / imageMaxSizeKb: 2048); serializer writes the vision block after the review section (enabled/provider/model/apiKey/endpoint/timeout/maxImagesPerPrompt/imageMaxSizeKb)

### Docs
- **config-reference.md ownership correction**: §3.15 tests / §3.16 stages / §3.17 pipeline.test now marked "not part of .speccore.yml — they belong to .speccore/environments/{env}.yaml (template: staging.yaml.example); writing them into the main config is silently ignored" — previously users configuring per the docs got no effect

### Verification
- 291 tests green; "run config --upgrade twice" check: first run writes the vision block to disk, second run reports no upgrade needed (fake-fill gone)

## v8.3.296 (2026-09-29) — Deploy template/script completion + config example audit + engine path-chain fix

### Added
- **Bare-server Nginx site template** `templates/deploy-nginx/`: nginx-site.conf (SPA fallback/gzip/static cache/API reverse proxy/WebSocket upgrade/healthz passthrough/HTTPS placeholder) + README — complements the Docker-scene nginx.conf for non-containerized Nginx
- **Node backend Dockerfile** `templates/deploy-docker/backend-node.Dockerfile`: multi-stage build + non-root runtime + HEALTHCHECK
- **5 concrete deploy scripts** `templates/deploy-scripts/`: deploy-compose.sh / deploy-ftp.sh (lftp) / deploy-password-ssh.sh (sshpass) / trigger-jenkins.sh / deploy-python.sh (venv+systemd) — `set -euo pipefail`, credentials via env vars only
- **Full main-config example** `templates/speccore-yml-example.yml` (222 lines): covers all current .speccore.yml fields (quality_gates.block_level/verify_ui, arbitration, settings.vision/optional_steps/pipelines/ai/smoke, tests.auth, stages, pipeline.test) with feature-version tags; `init` lands it at examples/config/SPECCORE-YML-EXAMPLE.yml
- **CI example delivery path**: templates/ci/github-actions.yml existed but init never copied it to user projects — now lands at examples/ci/

### Fixed
- **Deploy config path chain break (core bug)**: engine.ts resolved script/pm2_config/manifest/values paths only against the platform cwd, while init-generated examples use project-root-relative paths (.speccore/environments/scripts/...) — broken whenever code_path is set (helm values silently lost -f). New exported `resolveConfigPath` resolves against cwd first, then project root; applied to deployScript/deployK8s/deployHelm/deployPm2

### Enhanced
- **deploy-examples.yaml sections 13/14/15**: nginx_site / go_systemd+go_docker / python_gunicorn — 12 scenes → 15; script comments point to concrete files in templates/deploy-scripts/
- **VERIFY-EXAMPLE data-testid alignment**: login scenario switched to the three-part selector convention ({module}-{page}-{element}); added tests.auth auto-login notes (v8.3.215+)
- **config-reference.md §2 de-duplication**: stale full example (2026-08-28 schema, missing 8 newer fields) replaced with a skeleton overview pointing to the new template
- **staging.yaml.example & update-env-configs.ts**: data-testid three-part convention comment in the auth section

### Verification
- 291 tests green (285 + 6 resolveConfigPath cases); npm pack confirms deploy-scripts/, deploy-nginx/, backend-node.Dockerfile, speccore-yml-example.yml, ci/github-actions.yml all ship in the package

## v8.3.295 (2026-09-29) — Static asset publish chain fixed: onboarding link 404 cured + defensive hardening

### Fixes
- **Onboarding related-page 404 (core bug)**: `templates` was missing from package.json `files` whitelist, and both ask.ts/init.ts resolved templates via `process.cwd()/templates/html` (the user project root, which never exists) — first-ask onboarding never popped and all in-page mode cards / help links 404'd; setup-guide had been silently falling back to a「template missing」placeholder; init's example config copy (DEPLOY-EXAMPLE.yaml etc.) also silently failed. Fix: add `templates` to `files`; resolve template sources inside the package via `join(__dirname, '..', '..', 'templates', 'html')`.
- **Diagnosis: no onboarding after upgrade**: the switch `.speccore/local/.ask-onboarded` compares its recorded version against the CLI runtime version — when the global CLI was not actually upgraded (measured 8.3.282) the versions match and the page never pops; after upgrading, confirm `speccore --version` or run `speccore init` (its upgrade branch resets the marker).

### Hardening
- **generateFlowScenariosFromSpec structure defense**: matchElement/matchPageSelector now check `elementInfo.elements` existence and `pageTestIds` array-ness — malformed external input degrades gracefully instead of throwing TypeError.

### Verification
- 285 tests green; four rounds of targeted verification (spec-generator 10 checks / status --group-by / toSlug composite naming / smoke-engine DOM scan 5 structure points) all PASS
- meeting-system real run: after fix, all five related pages (explain/guide/match/pipeline/help) land in outputs/; `npm pack --dry-run` confirms the tarball ships all templates/html/*.html

## v8.3.294 (2026-09-29) — bugfix composite naming + contract baked into code + smoke selector self-heal hint

### Enhancements
- **bugfix task dir composite naming**: `buildTaskTopic` joins `{module-english}-{bug-english}` (e.g. Task-003-login-flow-timeout-crash) so bugs of the same module sit adjacent under 030-tasks/bugfix/; module name prefers AI `moduleTopic` (prompt-layer translation), falls back to toSlug pinyin for functionalUnit; duplicate-prefix guard when bugSlug already starts with moduleSlug; module segment capped at 15 chars, total under the 40-char nextTaskId limit
- **execute prompt data-testid mandate (two consumers synced)**: prompt-builder frontend requirements and execute.ts buildAgentContext checklist both now require「add data-testid per UI_SPEC element convention ({module}-{page}-{element}, page containers end with xxx-page) — smoke VERIFY_SPEC assertions depend on them」— closing the last broken link in「taskify assembles selector → execute writes attribute」
- **Smoke selector self-heal hint**: failed scenarios scan the page's real data-testid list while the page is still usable (`SmokeResult.domTestIds`, silently skipped when the page is gone); runSmokeTest aggregates a「selector self-heal hint」listing actual testids for fixing VERIFY_SPEC placeholder selectors — config is never auto-rewritten (avoids runtime misjudgment)

### Verification
- Six-branch naming verification (all-English / pinyin fallback / double pinyin / dedupe / no-module degradation / feature unaffected); build + 285 tests green

## v8.3.293 (2026-09-29) — Smoke assembly chain: three broken links fixed (element list extraction + flow scenario assembly + no-source Spec channel)

### New
- **UI_SPEC element list extraction `extractElementTestIds`**: supports three syntaxes (Markdown table with testid column on either side / inline enumeration / code attributes); template placeholders (btn-edit-{id}) auto-skipped; page containers (xxx-page) collected separately into pageTestIds
- **Flow scenario assembly `generateFlowScenariosFromSpec` (rewritten)**: three channels — ① plain flow arrow lines (A → B step chains) ② mermaid stateDiagram transitions (incl. `[*]` initial pseudo-state and self-loop skip) ③ descriptive arrows never mis-collected; section regex accepts Chinese ordinal prefixes (「## 五、交互状态」); matchElement bidirectional containment + token-split matching (「新增/编辑」→「新增按钮」) + shortest-element-name strategy; initial transition preferPage fallback asserts the page container
- **No-source Spec channel `generateSpecFromUiSpec`**: taskify with no source code extracts the element list + business flows from UI_SPEC/TEST and generates VERIFY_SPEC flow scenario skeletons — closing the「analysis-stage element convention → smoke config auto-assembly」loop

### Fixes
- **Root cause of zero flow scenarios**: admin-web-04 UI_SPEC interaction flows live in mermaid stateDiagram blocks under a Chinese-ordinal section header, which the old extractor never recognized — after the rewrite: 8 scenarios with 3 real assemblies (users-page/btn-add-user/dialog-disable)

### Verification
- Three-channel verification (stateDiagram assembly / plain flow lines / h5 descriptive arrows zero false-positive); build + 285 tests green

## v8.3.292 (2026-09-29) — Git config fix + Plan A logical grouping view

### Fixes
- **extractValue line-start anchoring**: regex now anchored with `^` + m flag — 「前缀」no longer misreads the「分支前缀: xxx」line; invalid placeholder values filtered
- **lifecycle board multi-root scan**: collectTasks previously only scanned the 030-tasks root level, missing the 030-tasks/{type}/ (feature/bugfix/refactor) layout — added multi-root scanning

### Enhancements
- **status --group-by feature logical grouping**: groups the task list by `.meta/feature` (module stats + module list two-panel view); `--type bugfix` auto-enables the grouped view; physical flat layout untouched (preserves the CLI's multi-consumer fixed-level scan contract)
- **verify findTaskDir layout compat**: supports both 030-tasks/{type}/ and root-level Task-* layouts

### Verification
- git fixture parse verified; meeting-system status --group-by feature rendered correctly; build + 285 tests green

## v8.3.291 (2026-09-29) — Task dependency chain fixed end-to-end: AI dependency analysis is no longer dropped; plan topology & branch merge finally have real data

### Fixes
- **taskify dropped the `dependencies` field (core bug)**: the AI-returned `dependencies` array was only used for log display, never written to `section._dependsOn` — so TASK.md「依赖任务」was always「无」and plan topology / execute dependency branch merging always got an empty array. Fix: pre-assign task IDs + build an「AI temp id → real taskId」mapping + resolve and write `_dependsOn`; unmappable references keep the original value (execute stage reports a hint)
- **scanTasks hardcoded empty dependencies**: three `dependencies: []` in state.ts never read TASK.md — added `parseDepsFromTaskMd` to parse the「依赖任务」field (both `- **依赖任务**: Task-xxx` and `| 依赖任务 | Task-xxx |` formats, comma/顿号 separated, deduped, non-Task noise filtered), subtask parse failure falls back to parent task
- **findBranchByTaskId parent-ID prefix fallback**: dependencies reference the parent task ID (e.g. Task-002-f1-booking) while git-mapping matches the subtask ID (Task-002-f1-booking-booking-service) — added `info.taskId.startsWith(taskId + '-')` fallback so cross-repo branch lookup no longer misses
- **--help/--version exit code**: exitOverride's commander.helpDisplayed/commander.version exceptions fell through to the default exit 1 (output was fine, but scripts/pipes saw failure) — added early exit 0 for both codes

### Enhancements
- **IMPACT.md「任务声明」dependency rows**: authoritative `_dependsOn` dependencies are listed first (type column marked「任务声明」), coexisting with API-text matching / semantic inference layers
- **Task summary dependency column**: TASK_SUMMARY now reads from resolved `_dependsOn` (previously the raw AI dependencies array, whose IDs didn't match what was persisted)
- **Platform-level analysis templates now require diagrams**: Phase 2 TECH.md skeleton「writing requirements」adds backend「core API sequence diagram or data model ER diagram (Mermaid sequenceDiagram/erDiagram)」and frontend「page route topology (Mermaid graph)」; UI_SPEC.md adds「core page interaction state diagram (Mermaid stateDiagram-v2, covering four states)」; QUALITY_RUBRICS 'UI_SPEC.md' checklist adds the diagram check — fixes functional-unit analysis docs having almost no diagrams (measured 5.4% mermaid coverage in the meeting project)

### Verification
- 285 tests green (7 new state-deps.test.ts cases: two formats / multiple separators / no deps / noise filtering / dedup)
- /tmp project end-to-end: taskify resolved 2 dependencies → TASK.md「依赖任务: Task-002-f1-booking」→ scanTasks read back `["Task-002-f1-booking"]` → plan topology correct (backend Phase 1, two frontends in parallel Phase 2) + Mermaid dependency graph renders correctly

## v8.3.290 (2026-09-28) — Smart resume for bare `run` + syntax sugar: high-frequency ops no longer depend on the ask engine

### New
- **bare `run` = smart resume**: with no args, detect breakpoints via milestone artifacts (9 milestones: import / unitize / analyze / audit / taskify / plan / execute / verify / deploy; predicates reuse PRECONDITIONS and existing analyze detectors), print a「Smart Resume Detection」panel (✅ done / 🔄 partial / ⬜ pending + artifact evidence)
- **Four state branches**: no requirement docs → [SPECCORE_RESUME] panel soft-stop (exit 10) asking the user to pick a requirement entry (import PRD / one-liner); fresh with docs → auto continue split-units → pipeline without asking; partially done → panel soft-stop asking「①continue from breakpoint ②re-unitize ③custom range」(② omitted when breakpoint is split-units); all done → point to wrap-up (run deliver / run docs)
- **hasRequirementDocs promoted to module level**: moved out of the autoPipeline closure (parameterized iterDir), shared by PRECONDITIONS and smart-resume detection
- **run positional grammar (sugar)**: `run <preset>` calls the named pipeline (incl. custom pipelines.custom, takes priority over same-named stage aliases); `run <stage/alias>` single-stage shortcut (continue from that stage to deploy verify, e.g. `run smoke` / `run split`); `run <from> to <to>` / `run <from>..<to>` stage ranges (parsed only when the first token hits a stage/alias, so one-liners like "fix login to support OTP" are not misread); `run <one-liner>` requirement entry; `--demand` escape hatch (explicit when the requirement text is a reserved word)
- **stage alias table as single source of truth**: new src/core/stage-aliases.ts (STAGE_ALIASES + resolveStageToken + parseRunRange + formatStageAliases + validateStageAliases startup self-check); aliases split→split-units, smoke→verify, deploy→pipeline, code→execute, tasks→taskify, ship→pr, archive→done, docs→spec2doc, import→doc2spec, req→req-doc; range parse failure (first token hits but last doesn't) errors with the alias table instead of silently falling back to a one-liner
- **analyze -g/--global**: sugar ≡ speccore global analyze (Layer 1→4 auto-advance)
- **unitize/doc2spec file positional args**: `unitize 需求.md` / `doc2spec PRD.docx` (--file kept for compatibility)
- **verify positional args**: `verify dev|pr|deploy|release` calls the test stage directly (≡ --stage, invalid values error)

### Docs
- spec-run SKILL.md + 6 agent command copies (.claude/.codebuddy/.cursor/.trae/.trae-cn/.windsurf) synced with the「smart resume + positional grammar」playbook: [SPECCORE_RESUME] panel → host AI asks the user via AskUserQuestion → runs the panel's command after user choice; must not auto-resume without confirmation; run grammar forms map to commands directly, not through ask
- `run --help` shows the grammar tree and alias table
- DESIGN.md new appendix「v8.3.290+ run smart resume & syntax sugar design」; README.md core pipeline section; docs/command-reference.md run section; AGENTS.md quick commands; help command run detail; HTML templates regenerated

### Verification
- 278 tests green; end-to-end: meeting project Iteration-014 (partial, features missing) panel honestly marked split-units breakpoint + exit 10; /tmp empty iteration no docs → requirement entry panel; /tmp fresh with docs → auto continue split-units → pipeline; /tmp fully-built iteration → 9/9 ✅ + 🎉 wrap-up pointer + exit 0; 12 run grammar forms tested one by one

---

## v8.3.193 (2026-09-19) — Full rename: iteration taskify

### Command rename
- `iteration split` fully renamed to `iteration taskify` (no transitional alias)
- Synced across: run.ts pipeline cmd/execSync, intent recognition id, ask KB, help/error-diagnosis/doctor/init hints, docs (9 `speccore split` → `speccore iteration taskify`)
- ask now distinguishes: "拆分任务" → `iteration taskify`; "从拆分到开发" → `run --from taskify`; "从切分功能单元到开发" → `run --from split-units`

### Repo sync
- Added GitHub remote `github` (windfallsheng/SpecCore.git), dual-remote sync with gitee

---

## v8.3.191 (2026-09-19) — ask Pipeline Orchestration + Naming Fix + Platform Type Unification

### ask natural-language pipeline orchestration
- run pipeline intent: recognizes preset names + start/end ranges ("from X to Y")
- colloquial stage normalization: 部署→pipeline, 提交→pr, 切分功能单元→split-units, 拆分/任务化→taskify
- run intent with preset/range gets priority (runForced skips ambiguity detection)
- new spec preset (doc2spec→taskify, import requirements → taskify to generate Spec)

### Naming fix: task split renamed split → taskify
- 「切分功能单元」(split-units) and 「拆分任务」(split) were confusing; task split stage key renamed to taskify
- command iteration split kept (alias taskify added); pipeline key/ask normalization/handoff/gate/preset all use taskify

### Platform type unification
- new resolvePlatformType unified entry: PROJECT.yaml type > CONSTITUTION.md platform list > directory-name regex fallback
- removes scattered hardcoded regex detection and inconsistent two-layer detection

### Split vs clarify responsibility separation
- split-units becomes an independent pipeline step; clarify is pure (req-doc no longer splits)

### Command audit & docs polish
- 3 overlapping command groups annotated with hierarchy
- help home highlights 10 core commands, de-emphasizes total count
- README/docs fixed outdated command counts (26+/20) and dev command remnants
- HTML templates cleaned (6 dead templates)
- config-reference added optional_steps tri-state + pipelines named pipelines
- analyze --from-code exposes --out-dir for custom reverse-requirement output dir

## v8.3.190 (2026-09-19) — Clarify Tri-state + Named Pipelines + js-yaml

### Clarify semantics refactor & tri-state switch

- **clarify renamed to req-doc**: clarify semantics reassigned, removing the "clarify = requirement documentation" ambiguity
- **Clarify tri-state switch**: `optional_steps.clarify` supports `auto` (professional-level detection) / `on` (force) / `off` (skip)
- **Three-layer override**: command flag (`--clarify`/`--skip-clarify`) > ask intent > config `optional_steps` > default `auto`
- **Quality report decoupling**: 7-dimension review (`assessRequirementQuality`) generates `QUALITY_REPORT.md` regardless of clarify mode — skipped clarify still leaves a report

### Pipeline refactor & named pipelines

- **dev split into run + next**: `run` = sole execution entry, `next` = progress guidance
- **Named pipeline system**: `init` removed from pipeline; built-in presets (`full`/`import`/`analyze`/`develop`/`deliver`/`deploy`/`docs`); user custom + default (`settings.pipelines`)
- **Default pipeline narrowed**: `pr`/`done`/`spec2doc` are standalone closing ops; default `develop` (analyze→verify)
- **plan single-task skip**: Task ≤ 1 skips plan, multiple tasks trigger planning
- **optional_steps extended**: clarify/verify/pipeline/pr/done/spec2doc six optional steps configurable

### Config parsing fix

- **parseYaml switched to js-yaml**: root-fixes "read-back asymmetry" — flow arrays, list placeholder `- # comment`, empty array `[]` resolved at once (js-yaml for read, handwritten for write to preserve comments)

### Intent recognition & subagent fixes

- Composite intent "analyze + split" now correctly enters pipeline orchestration
- Platform/feature-level subagent mapping gap fixed (`requirement-analyzer-admin-web` normalized mapping)
- req-doc subagent dispatch added

## v8.3.188 (2026-09-19) — Config Upgrade Pipeline Fixes & Diagnostics

### Config upgrade pipeline fixes (5 defects)

- **`detectConfigDiffFromFile`**: reads the on-disk raw YAML to detect missing fields (deep-merge autofill in `loadConfigWithMeta` masked missing fields, so `detectConfigDiff` never saw them)
- **`upgradeConfig`/`upgradeProjectConfig` early-return fix**: no longer return early on schema_version match + empty warnings; now keyed on fileDiff so same-version missing fields get backfilled
- **toYaml array serialization switched to block style**: the flow style `['desktop']` is not recognized by the custom parseYaml, round-tripping to a string and crashing `devices.map`; added `normalizeStringArray` to tolerate legacy dirty data
- **toYaml `pipeline`/`with_code` indentation fix**: were 4-space (nested under `review`), corrected to 2-space
- **toYaml `schema_version` uncommented**: was commented out, causing validateConfig to keep reporting "must be a number"

### Diagnostics

- **`doctor` spec-database consistency check**: upgraded from "directory existence only" to "compare against built-in defaults list", surfacing missing built-in files (e.g. new agents / `_INDEX`) with backfill suggestions
- **`update` stale-CLI warning**: warns when project init version > current CLI version, suggesting a CLI upgrade first

## v8.3.187 (2026-09-19) — Honesty Degradation System & Engineering Hardening

### Universal behavior rules refined (4 → 7)

- **`prompt-builder.ts` extracted `UNIVERSAL_BEHAVIOR_RULES` constant**: expanded from 4 to 7 rules, incorporating industry best practices
  - Added "read before write", "minimal changes", "proactive clarification", "confirm destructive operations"
  - Merged "don't pretend certainty" into "degrade to honesty", upgraded to "fact / inference / guess" confidence tiers
  - Basis: Claude Code official system prompt, Anthropic Prompt Library, Karpathy's 12 rules

### Dead code cleanup

- Removed 8 zero-reference command files (2009 lines): backup/context/current/global-status/health/import/lifecycle/status
- Removed `understandIntent` + `synthesizeIntent` dead code (321 lines; askEngine is the real ask entry point)

### Feature wiring (orphan A-class modules)

- **`refresh` wired `detectStaleGlobalDocs`**: detects stale global docs after refresh (≥1 day), prompts incremental rebuild
- **`search --global` wired `searchGlobalKnowledge`**: global-layer RAG + knowledge-graph semantic retrieval, distinct from keyword search
- **`dev` wired `generateHandoff`**: generates stage handoff summaries after key pipeline stages (13→6 stage mapping)

### Bug fixes (verified on meeting-system)

- **`config --project` option missing**: added to cli.ts, fixes doctor-suggested upgrade command reporting unknown option
- **`detectConfigDiff` open-dict misjudgment**: Record fields like `git.branch_types` no longer flag user-defined keys as removed
- **`detectStaleGlobalDocs` "0 days stale" noise**: only reports docs stale ≥1 day
- **Version comparison false positive**: about/update now use semver comparison, no longer report older versions as "new"

---

## v8.3.182 (2026-09-18) — Explicit Document Routing & Refined Whitelist

### Document Routing Table (r4)

- **`analyze.ts` `DOC_ROUTING` constant**: Explicitly defines document destination paths in code
  - Index class → `overview/` (FUNCTION_MAP.md / INTERACTION_MAP.md / PLATFORMS.md / CLARIFY.md / API_CONTRACT.yaml)
  - Content class → `{feature}/overview/` (REQUIREMENT.md / ANALYSIS.md / TECH.md / RISK.md / DEPS.md / REVIEW.md / MONITOR.md / DEV_GUIDE.md)
- **Iteration-level prompt adds "Document Routing Table" section**: Markdown table explicitly showing routing target, document type, and description for each document
- **Explicit ANALYSIS.md classification**: Belongs to content class, strictly prohibited from being placed under `020-specs/overview/`

### Two-Tier Whitelist (r3)

- **`prompt-builder.ts` whitelist refactor**: Changed from single whitelist to "core whitelist + conditional whitelist" two-tier structure
  - Core whitelist (CORE_EXTRA_FILES): CONTEXT.md, ERROR_CODES.md (loaded for all tasks)
  - Conditional whitelist (getPlatformExtraFiles): Dynamically loaded by platform type (backend → SCHEMA.md; frontend → COMPONENT_TREE.md / ROUTES.md / STATE.md)
- Files outside whitelist are collected and output via `console.warn`

### Budget Adjustment & Error Message Improvement (r5)

- **`CONSTITUTION.md` budget relaxed from 4000 to 6000 characters**
- **Improved error messages**: When budget exceeded, provides concrete suggestions for trimming (remove outdated comments, link to external docs, use tables, etc.)

### Module Clarification Auto-Imports Global Clarification (r1)

- **`analyze.ts` context loading logic**: When loading module clarifications, automatically detects and ensures global clarification `020-specs/overview/CLARIFY.md` is placed first

---

## v8.3.181 (2026-09-18) — Architecture Refinement & Context Control Hardening

### Clarification Output: Two-Level Clarification Structure (f1)

- **`hasValidClarifiedDocs` critical bug fix**: Removed erroneous `return false;`, restored source update detection logic
- **`analyze.ts` clarify marker write logic**: Supports new path formats `[CLARIFY:overview/CLARIFY.md]` and `[CLARIFY:{feature}/overview/CLARIFY.md]`, backward compatible with `[CLARIFY:requirements/xxx.md]`
- **`analyze.ts` requirement clarification validation**: Now uses `hasValidClarifiedDocs()` for unified detection (supports two-level paths + backward compatibility)
- **`analyze.ts` context loading**: Prioritizes `020-specs/overview/CLARIFY.md` (global) and `020-specs/{feature}/overview/CLARIFY.md` (module), falls back to legacy paths
- **`analyze.ts` prompt updates**: Phase 0 clarify prompt and confirm prompt path instructions updated to new format
- **`AGENTS.md` project structure**: Clarified functional boundaries between `020-specs/overview/` (index/relationship) and `020-specs/{feature}/overview/` (content/detail)

### Subtask File Whitelist (f2)

- **`prompt-builder.ts` `scanUserCustomFiles`**: Changed from "scan all" to "whitelist mode"
- Only loads files within `ALLOWED_EXTRA_FILES` whitelist (SCHEMA.md, TEST.md, REVIEW.md, etc.)
- Files outside whitelist are ignored with console warnings

### Per-File-Type Budget Segmentation (f4)

- **`prompt-builder.ts` `FILE_BUDGETS`**: Different budget limits per file type
  - Must be complete (error, no truncation): CONSTITUTION.md(4000), REQ.md(2000), API_CONTRACT.yaml(2000)
  - Can be truncated (truncate + warning): TASK.md(1500), TECH.md(3000), DEV_GUIDE.md(2000), others(1000)
- Applied in both **`loadExtraSpecs`** and **`loadAllTaskContext`**
- Fallback mode budgets relaxed to 2x

---

## v8.3.180 (2026-09-17) — Documentation Sync Update

### Comprehensive Design Document Sync for v8.3.177-179 Architecture Changes

- **`docs/DESIGN.md` New §1.5.18 Context Control Architecture**:
  - Metadata infrastructure (`_matrix.md` + `feature-metadata.ts`)
  - Overview two-phase generation (skeleton → full)
  - Plan phase CLI graph computation (`plan-graph.ts`)
  - Execute phase contract-only rules + reading list mode
  - Cross-phase context handoff + session boundaries

- **`docs/DESIGN.md` Agent Phase Table**: Added `overview-skeleton` (6K) and `overview-full` (8K)

- **`docs/overview.md` Core Flow Diagram**: `analyze → split` changed to `analyze(overview) → analyze(feature-unit) → split`

- **`docs/command-reference.md`**: Added `analyze --scope=overview --phase=skeleton|full` and `plan --prompt` CLI graph descriptions

- **`docs/task-directory-design.md`**: Added `_matrix.md` description to feature unit section

- **`AGENTS.md` Project Structure**: Added `_matrix.md` under `features/{feature}/`

- **`README.md`**: Synced core flow diagram and directory structure

---

## v8.3.179 (2026-09-17) — Fallback Mode Context Control Fix

### Fix `loadAllTaskContext` Overloading Related Task Documents

- **Related tasks contract-only** (`src/core/prompt-builder.ts`):
  - Before: After getting dependent tasks from knowledge graph, read **all .md files** under related task `00-specs/` (REQ.md/TECH.md/DEV_GUIDE.md etc.)
  - After: Only read related task's `API_CONTRACT.yaml` (prefer `_shared/`, fallback to `00-specs/`)
  - Context reduction: Related tasks from potentially thousands of lines → max 400 lines of contract

- **020-specs platform specs changed to reading list** (`src/core/prompt-builder.ts`):
  - Before: In fallback mode, directly loaded full content of all .md files under `020-specs/{feature}/{platform}/`
  - After: Changed to reading list mode, only listing file paths and feature names, not loading full text
  - Prevents loading too many other feature's platform specs in fallback mode causing context explosion

---

## v8.3.178 (2026-09-17) — Plan Phase CLI Graph + Execute Phase Contract-Only

### Plan Phase Enhancement (Context Control)

- **New `src/core/plan-graph.ts`**: CLI graph computation module
  - `buildPlanGraph()`: Scans tasks → builds dependency graph → topological sort → critical path
  - `computeBatches()`: Groups tasks into execution batches by dependency level
  - `findCriticalPath()`: Computes longest dependency chain (duration)
  - `detectResourceConflicts()`: Detects when same assignee has multiple tasks in one batch
  - `generatePlanJson()`: Generates 100-200 line structured JSON

- **Enhanced `speccore plan --prompt`**:
  - Auto-enables CLI graph mode when task count >= 5
  - CLI computes graph first (dependencies, batches, critical path, conflicts)
  - Outputs structured JSON to AI, AI only makes judgments (priority/resource conflicts, risks)
  - Context reduced from 3000+ lines (task docs) → 100-200 lines (JSON metadata)

### Execute Phase Enhancement (Contract-Only, No Implementation)

- **Modified `speccore execute --prompt` context loading**:
  - Other platforms in same Task: only loads `API_CONTRACT.yaml`, no longer loads `REQ.md`/`TECH.md`
  - Upstream dependency tasks: only loads `_shared/API_CONTRACT.yaml` (contract), not requirement docs
  - Shared task contract: continues loading `_shared/API_CONTRACT.yaml`
  - Each subtask context controlled to 500-600 lines, no accumulation

### Core Design Principles

- **Plan phase**: CLI does deterministic computation (graph algorithms), AI does judgment (conflicts, risks)
- **Execute phase**: Only pass interface contracts, never pass code implementation
- **Cross-task communication**: `API_CONTRACT.yaml` is the only information carrier between tasks

## v8.3.177 (2026-09-17) — Metadata Scanner + Overview Generation (Context Control Core)

### Feature Unit Metadata Infrastructure

- **New `_matrix.md`**: Auto-generated platform coverage matrix for each feature unit
  - Records `platforms` (involved ends), `dependencies`, `apis`
  - Created by `doc2spec --split`, supports manual adjustment
  - Serves as the sole metadata source for overview generation

- **New `src/core/feature-metadata.ts`**: Metadata scanner
  - `scanFeatureMetadata()`: Scans `features/` directory, reads each unit's `_matrix.md`
  - `extractSummary()`: Reads only first 2 sentences of `README.md`, never full content
  - `calculatePlatformCoverage()`: Computes platform coverage statistics
  - `findCrossFeatureApis()`: Identifies APIs referenced by multiple features

### Overview Generation (Two-Phase)

- **New `speccore analyze --scope=overview`**:
  - `--phase=skeleton` (default): Generates skeleton overview
    - Feature map (Mermaid dependency graph)
    - Platform coverage summary table
    - Feature unit inventory confirmation
    - Output controlled to 40-60 lines
  - `--phase=full`: Generates complete overview
    - System architecture diagram (service topology + data flow)
    - Cross-feature API inventory
    - Actual dependency relationship table
    - Output controlled to 60-80 lines

- **Supports `--apply` receiving AI results**: Auto-parses `[DOC:OVERVIEW]` / `[DOC:ARCHITECTURE]` markers, writes to `020-specs/overview/`

### Core Design Principles

- Overview only processes **50-80 lines of JSON metadata**, never touches full feature unit content
- CLI handles deterministic extraction (scanning `_matrix.md`), AI handles generative work (descriptions + diagrams)
- Overview is a **relationship map + index**, not a content summary

## v8.3.176 (2026-09-17) — Feature Unit Split + Change Tracking + Handoff Summary

### Feature Unit Split (P2-11 Context Control Foundation)

- **New `doc2spec --split`**: Automatically splits converted documents into feature units by `##` heading structure
  - Scans heading structure to identify feature unit boundaries
  - Filters non-feature sections (appendix, glossary, etc.)
  - Writes each unit to `features/{unit}/README.md`
  - Generates `.meta/source` origin marker
  - Generates `features/INDEX.md` unit index

### Feature Unit Management

- **New `speccore units` command**:
  - `units --list`: List all feature units (with status, origin)
  - `units --edit <unit>`: View unit content summary
  - `units --merge "A,B"`: Merge multiple units, mark originals as deprecated
  - `units --delete <unit>`: Delete unit (backup to `.trash/`)

### Change Tracking

- **Each feature unit supports change history**:
  - `CHANGELOG.md`: Records change type, description, time
  - `.meta/versions/`: Auto-backup old version before each change
  - Merge/delete operations automatically record change history

### Handoff Summary Generator

- **New `src/core/handoff-generator.ts`**:
  - `generateHandoff(from, to, iteration)`: Generate handoff summary after each stage
  - Supports analyze→split / split→plan / plan→execute / execute→review / review→done
  - Summaries stored in `.speccore/local/handoffs/` (not committed to Git)
  - Size limits: analyze→split ≤60 lines, plan→execute ≤150 lines

---

## v8.3.175 (2026-09-16) — Comprehensive Cleanup of Legacy Compatibility Code

### Cleanup Goals

- **Remove all version number comments**: No more `vX.Y.Z+:` markers in code
- **Remove backward compatibility descriptions**: All "backward compatible", "legacy", "old format", "old structure", "old path", "old layout" descriptions cleaned to current-state wording
- **Delete backward compatible commands**: `arch-update` (merged into `update --arch`)
- **Delete migration guides**: `docs/migration-guide.md` / `docs/migration-guide.en.md` (no legacy users, no migration needed)
- **Trim CHANGELOG**: Only keep v8.3.169 and later recent versions
- **Delete old RELEASE files**: `RELEASE-v6.89.0.md` / `RELEASE-v8.3.46.md`

### Scope

- `src/cli.ts` — Removed version comments + deleted `arch-update` command + cleaned welcome panel old path fallbacks
- `src/commands/` — Cleaned version comments and backward compatibility logic in analyze.ts / execute.ts / split.ts / change.ts / synthesize.ts / update.ts / init.ts etc.
- `src/core/` — Cleaned spec-paths.ts / prompt-builder.ts / state.ts / knowledge-graph.ts / verify-engine.ts / task-paths.ts / git-integration.ts etc.
- `docs/` — Deleted migration-guide.md / migration-guide.en.md
- `RELEASE-*.md` — Deleted v6.89.0 and v8.3.46 release notes

---

## v8.3.174 (2026-09-16) — P1 Concept Convergence: Quality Gate Layering + Subagent Rename + Mode Parameter Consolidation + Doc Split

### P1-4: Subagent Rename — SessionAgent Marker Unification

- Global replace `[SPECCORE_SUBAGENT]` → `[SPECCORE_SESSION_AGENT]` (Headless marker mode corresponds to SessionAgent concept)
- Updated `agent-adapter.ts` marker output, `AGENTS.md` marker documentation
- Preserved internal code variable names (implementation detail)

### P1-5: Analysis Strategy Unification

- New `ARCHITECTURE.md` retains only the three-layer analysis theoretical model
- Four-layer scanning / streaming analysis merged into Pipeline stage descriptions

### P1-6: Mode Parameter Convergence — Config First

- **`execute.ts`**: `strict` / `pipeline` / `withCode` read from `.speccore.yml` when not passed via CLI
- **`unified-config.ts`**: `settings` adds `pipeline?: boolean` and `with_code?: boolean` options
- CLI `--strict` / `--pipeline` / `--with-code` preserved (backward compatible), config file can set defaults

### P1-7: Quality Gate Layering — Default 4 + Strict Mode 12

- **`verify-engine.ts`**: `runQualityGate()` adds `strict?: boolean` parameter
- Default 4 critical checks: compile (blocking), unit test, API contract compliance, spec doc quality
- `strict=true` adds 12 checks: Lint, dependency integrity, security scan, Spec consistency, DEV_GUIDE compliance, Schema consistency, test coverage, review compliance, deploy checklist, error code consistency, knowledge graph dependency consistency, code file non-empty
- **`execute.ts`**: two `runQualityGate` calls pass `strict: options.strict`
- **`conflict-detector.ts`**: `detectConflicts` signature updated to support `strict` passthrough

### P1-8: Config File Convergence

- `.speccore.yml` `settings` section extended: supports `pipeline` / `with_code` / `validation.strict_mode`
- Mode parameter defaults moved from CLI to config file (CLI can still override)

### P1-9: Documentation Split

- Added `docs/ARCHITECTURE.md` (~205 lines): core architecture current state (global org + spec DB + iteration dirs + naming conventions)
- Added `docs/COMMANDS.md` (~135 lines): command reference (pipeline + quick reference + marker system)
- `DESIGN.md` (6214 lines) preserved as historical complete design document

---

## v8.3.173 (2026-09-16) — P0 Architecture Convergence: Path Fallback Removal + Anti-Mess Mechanism Simplification

### P0-1: Path Convergence — Remove All Fallback Branches

- **`spec-paths.ts`**: `resolveGlobalSpecPath()` removed `global/` and root directory fallbacks, only `overview/` remains
- **`knowledge-graph.ts`**: removed `020-specs/platforms/{platform}/` legacy path compatibility scanning
- **`analyze.ts`**: removed `docs['FUNCTION_MAP.md'] || docs['overview/'] || docs['global/']` triple fallback
- **`analyze.ts`**: removed `sanitizeSpecDirectories` auto-calls (function preserved for future `speccore migrate` tool)
- **`split.ts`**: removed `specContents['DEV_GUIDE.md'] || specContents['overview/DEV_GUIDE.md']` fallback
- **`audit.ts`**: removed `apiMap['overview/'] || apiMap['global/'] || apiMap['REQUIREMENT.md']` triple fallback
- **`spec-skeleton.ts`**: removed legacy structure compatibility (platform docs without feature module prefix)
- **`prompt-builder.ts`**: removed root `.md` file reading fallback, only reads `overview/`
- **`state.ts`**: removed iteration root directory old layout compatibility

### P0-2: Anti-Mess Mechanism Convergence — Simplify Prompt Path Constraints

- **`analyze.ts`**: simplified path hints from "don't create dirs + write correct path + don't bypass --apply" to "files pre-created, only overwrite existing files"
- **`split.ts`**: simplified "⚠️ Absolute Prohibition" section to "⚠️ Constraints", merged path constraints into single instruction

---

## v8.3.171 (2026-09-16) — Missing Items Fix + SDK Optimization

### Fixed: change Command SDK Dispatch Integration

- **change.ts `--prompt` mode**: added `[SPECCORE_SUBAGENT: impact-analyst]` marker + `dispatchSubagent` SDK dispatch attempt
- Unified trigger condition: non-TTY + Qoder environment
- Unified failure fallback: automatic fallback to Prompt mode

### Optimized: Qoder SDK Adapter Layer

- **`buildQoderAgentDefinition` tools field**: added `'Agent'` tool to support subagent recursive dispatch
- **`mapToQoderAgentName` mapping table expansion**: covers SpecCore core subagents (spec-analyzer, spec-executor, task-decomposer, schedule-planner, impact-analyst, code-reviewer, security-reviewer) → Qoder built-in agents
- **`dispatchSubagent` singleton optimization**: QoderSdkAdapter instance reuse, avoids repeated dynamic SDK imports on each call

---

## v8.3.170 (2026-09-16) — SDK Dispatch Coverage for All Prompt Mode Commands

### Extended: SDK Dispatch in All Prompt Mode Commands

- **`execute`**: `runPromptMode` integrates `dispatchSubagent`, supports `spec-executor` / `spec-executor-{platform}` subagent SDK dispatch
- **`split`**: `--prompt` mode integrates `dispatchSubagent`, supports `task-decomposer` subagent SDK dispatch
- **`plan`**: `--prompt` mode integrates `dispatchSubagent`, supports `schedule-planner` subagent SDK dispatch
- **Unified pattern**: triggers in non-TTY + Qoder environment, seamless fallback to Prompt mode on failure
- **Unified output**: on SDK success, outputs `[SPECCORE_RESULT]` + file change list + execution result summary

### Notes

- `ask` command not directly integrated: ask outputs `[SPECCORE_EXEC: speccore xxx]` command routing, target commands (analyze/split/plan/execute) trigger SDK dispatch themselves when executed
- Pipeline advancement points (`[SPECCORE_STEP_DONE]` + `[SPECCORE_NEXT_STEP]`) keep existing marker mode to avoid conflicts between CLI internal state machine and SDK async execution

---

## v8.3.169 (2026-09-16) — Qoder Agent SDK Integration: Real Multi-Agent Dispatch

### Qoder Agent SDK Integration (`src/core/agent-adapter.ts`)

- **Package**: `@qoder-ai/qoder-agent-sdk` as `optionalDependencies`
- **Real `QoderSdkAdapter` implementation** (replaces previous stub):
  - Dynamic `import()` loading with automatic Headless fallback
  - `dispatchSubagent()` calls `query({ prompt, options })` to invoke Qoder Agent directly
  - Builds `AgentDefinition` for custom subagents (`spec-analyzer`, `spec-executor`, etc.)
  - Consumes SDK message stream, collects text responses and file changes
  - Built-in agent name mapping (`general-purpose` / `Explore` / `Plan`)
- **New `dispatchSubagent` unified dispatch entry**:
  - Qoder environment → `QoderSdkAdapter.dispatchSubagent()`
  - Other environments → `null` (outer AI takes over via `[SPECCORE_SUBAGENT]` marker)
- **Headless always as fallback**: any SDK failure auto-falls back to text marker mode

### Multi-Tool Adapter Support (`src/core/ask-host-ai.ts`)

- **Extended `HostAiTool`**: added `cursor` / `windsurf` / `claude` / `codebuddy`
- **Fixed `detectHostAi`**: `.qoder` directory now correctly returns `'qoder'` (was incorrectly `'trae'`)
- **Precise directory mapping**: `DIR_TO_TOOL` maps each directory to its exact tool
- **Added `QODER_SESSION` env detection**

### Analyze Command Integration (`src/commands/analyze.ts`)

- **Pipeline mode SDK dispatch**: before outputting Prompt, attempts `dispatchSubagent` direct dispatch
- **Only triggers in non-TTY + Qoder environment**, seamless fallback to Prompt mode on failure
- **Result summary**: outputs `[SPECCORE_STEP_DONE]` + `[SPECCORE_RESULT]` + file change list on SDK success

### Architecture

- **Extended `AgentAdapterMode`**: `'headless' | 'qoder-sdk' | 'cursor-sdk' | 'windsurf-sdk' | 'claude-sdk' | 'codebuddy-sdk'`
- **Extended `AgentAdapter` interface**: added optional `dispatchSubagent()` method
- **`createAgentAdapter()` auto-detection**: selects adapter based on `detectHostAi()` (Qoder → QoderSdkAdapter, others → HeadlessAdapter)

---

