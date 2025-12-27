---
description: Architecture-focused review for high-leverage design improvements and refactors
---

# Architecture Check (Design & Refactor Review)

Perform a **principal-engineer-level** architecture review focused on **high-leverage design improvements**. Optimize for **maximum long-term payoff per hour invested**. Prefer **functional patterns** (pure functions, explicit data flow, composition) unless the codebase clearly benefits from OO constructs.

This is not a correctness bug hunt. Only flag correctness issues if they block architectural change or reveal systemic design flaws. Assume a healthcheck already covered dead code, AI smells, hygiene, and missing tests.

> **Downstream**: This output feeds directly into `/bd-breakdown` for ticket creation.

---

## Input

Review the files/directories specified by the user. If none specified, review the entire codebase starting from entry points and high-traffic modules.

---

## Ground Rules

- **Be evidence-based**: only cite issues you can point to in code that was actually inspected.
- **Avoid speculation**: if unsure, mark **"Needs verification"** and lower confidence.
- **Be specific**: tie every point to concrete files, modules, or functions (no generic advice).
- **Keep it incremental**: propose refactors that can land in steps; avoid "rewrite it all".
- **If no issues**: still provide the Method block and explicitly state no high‑leverage issues found.
- **Clarify only if blocked**: ask at most 1–3 questions only when a key architectural assumption would materially change the review; otherwise state assumptions in Method.
- **Keep excerpts tiny**: reference files and symbols; avoid long code blocks or large quotes.

---

## Priority Order

When in doubt, prioritize:

1. **Boundary clarity & dependency direction** – modules should have crisp responsibilities and one-way dependencies
2. **Testability & change isolation** – changes should be easy to validate without heavy setup
3. **Complexity & duplication hotspots** – high cyclomatic complexity, copy/paste logic, tangled flows
4. **Size & cohesion** – oversized files/modules, "god classes", mixed concerns
5. **Abstraction fitness** – too much abstraction (YAGNI) or too little (leaky, repetitive)

---

## Scope & Stopping Criteria

- Focus primarily on **structural issues** and **testability**; use complexity/duplication metrics as supporting evidence
- Stop after **3–5 clear examples per pattern** (pattern established)
- Skip low-impact refactors unless they unlock significant simplification
- Keep output concise; prioritize the **top 6–12** highest-leverage issues

---

## Out of Scope (Do Not Report)

- Style/formatting issues (leave to linters)
- Minor naming inconsistencies
- Missing documentation unless it blocks understanding
- Single-use code that's appropriately inlined
- Test coverage gaps (unless they indicate untestable design)
- Performance micro-optimizations without measured impact
- Dead code, ghost features, or AI-specific API misuse
- Hygiene cleanup (debug logs, stale TODOs, build artifacts)
- Correctness bugs unless they directly block the architectural change

---

## Traversal Strategy

1. **Map boundaries** (quick pass): entry points, public APIs, services, and core domains
2. **Trace dependency flow**: identify layers and check for dependency inversions
3. **Run hotspot tools** (if available): use metrics to rank candidates before deep-diving. If `lizard` is installed, run it first and pick your first 3–5 deep dives from its output.
3b. **Run dependency exploration** (if available): in Python repos, use `arch-grimp-*` helpers (or raw `grimp`) to map the import graph (fan-in/out, boundary leaks, cycles). Only enforce layer rules if the repo already defines them or you can state a tentative layering in the review.
4. **Validate reachability**: ensure hotspots are on real execution paths; skip dead code

Stop traversal once you have enough evidence to populate the top 6–12 issues.

---

## Tooling / Hotspot Pass (use if available)

Use tools to **rank** hotspots before deeper analysis.

### Complexity & Size
- Prefer **lizard** as the first-pass complexity/size tool when available. If it’s not installed, explicitly note that in the Method block and fall back to file-size ranking.
- Suggested thresholds (tune to language):
  - Cyclomatic complexity >= **15**
  - Function length >= **80** lines
  - File length >= **500** lines

Example commands (adjust extensions/paths):
```bash
lizard -C 15 -L 80 -w src
rg --files -g '*.{ts,js,py,go,java,kt,rb,cs}' | xargs wc -l | sort -nr | head -n 20
```

Optional (keep output manageable; adjust path/filters):
```bash
# Limit to top 15 functions
lizard -C 15 -L 80 -w src | head -n 20
```

### Dependency Exploration (Python)
- Prefer **arch-grimp** helper scripts (if available) to explore the import graph before choosing layers. They bootstrap a shared venv in `~/ai-configs/skills/grimp-architecture/.venv`.
- Use the `grimp-architecture` skill for packaging setup, helper usage, and incremental enforcement workflow.
- Start with **structure + fan-in/out**: identify top-level packages, modules that import too much, and modules imported by too many others.
- Use **shortest-chain** queries to confirm how a boundary is being crossed.
- If the repo already defines layers (or you can articulate a tentative layering), optionally run a layer check and record violations.

Example (replace `mypackage` and module names to match the repo; use the importable top-level package name):
```bash
arch-grimp-explore mypackage
arch-grimp-path mypackage.validation mypackage.orchestrator
arch-grimp-layers --layer mypackage.api --layer mypackage.domain --layer mypackage.infra
arch-grimp-layers --layer mypackage.api --layer mypackage.domain --layer mypackage.infra --json > .grimp-baseline.json
arch-grimp-diff --baseline .grimp-baseline.json --layer mypackage.api --layer mypackage.domain --layer mypackage.infra
```

### Duplicate Code
- Prefer `jscpd`, `simian`, or a built-in duplicate detector.
- If unavailable, look for repeated blocks via `rg` and sample comparisons.

Example:
```bash
jscpd --min-lines 30 --min-tokens 200 .
```

---

## What to Look For

### 1. Boundary & Dependency Smells
- Circular dependencies across layers
- UI/API code reaching into persistence or infra details
- Domain logic scattered across `utils/` or unrelated modules
- Inconsistent error handling or data validation across similar flows

### 2. Complexity & Duplication Hotspots
- Functions with complex branching or deep nesting
- Copy/paste logic across modules that should be shared
- "One-off" helpers duplicated in multiple files

### 3. Oversized or Confused Modules
- Files that mix IO + business rules + formatting
- "God classes" with too many responsibilities
- Classes that are only bags of functions (prefer a module of pure functions)

### 4. Abstraction Mismatch
- Over-abstracted layers that add indirection but no value
- Under-abstracted logic where similar flows diverge unnecessarily
- Leaky abstractions that force callers to know internal details

### 5. Testability Friction
- Hidden global state, time, randomness, or IO in core logic
- Heavy constructors or framework setup required just to test logic
- Tight coupling that makes unit tests impossible without integration scaffolding

---

## Functional Design Bias (prefer these refactors)

- Move side effects to the edges; keep core logic **pure and deterministic**
- Use **data-in/data-out** functions and compose with pipelines
- Replace stateful classes with **stateless modules** where possible
- Pass dependencies explicitly (function params) rather than via globals or singletons
- Model transformations as **small pure functions**; keep orchestration thin

Use OO only when it clearly improves ergonomics (e.g., polymorphism with real behavior variance).

---

## Verification Before Reporting

Before marking an issue as High or above:

1. Confirm the hotspot is **reachable** and on a meaningful path
2. Verify the behavior is not intentionally duplicated (performance or isolation)
3. Check for existing tests that already cover the hard-to-test area
4. If uncertain, mark **"Needs verification"** and lower confidence

---

## Severity Definitions

- **Critical**: Architecture causes production risk or data integrity issues (use sparingly)
- **High**: Architectural debt that blocks feature velocity or safe changes
- **Medium**: Design friction that slows changes but is not blocking
- **Low**: Improvement opportunity with limited ROI

---

## Output Format

Start with a short **Method** block (3–6 bullets) listing: tools run, entry points reviewed, key files scanned, and assumptions/unknowns. If hotspot or dependency tools were attempted (e.g., lizard, grimp), note whether they ran and what they surfaced.
Recommended bullet labels:
- Tools run:
- Entry points:
- Key files:
- Assumptions/unknowns:

Then produce a **single unified list** of issues, sorted by severity (Critical → High → Medium → Low).

For each issue:

```
### [Severity] Short title

**Primary files**: `path/to/file.ts:lines` (list all files touched; approximate lines fine)
**Category**: Boundaries | Testability | Complexity | Duplication | Cohesion | Abstraction
**Type**: bug | task | chore (use task for refactors; chore for cleanup; bug if behavior is broken)
**Confidence**: High | Medium | Low
**Context**:
- What's wrong (1 sentence)
- Why it matters / who or what breaks (1–2 sentences)
**Fix**: Concrete action to resolve (1–3 sentences). Include tests here unless tests are the only change.
**Non-goals**: What's explicitly out of scope (1–2 bullets; recommended for Medium+ severity)
**Acceptance Criteria**: 1–3 bullets
**Test Plan**: 1–2 bullets
**Agent Notes**: Gotchas, edge cases, or constraints an implementer should know (optional)
**Dependencies**: Optional – list other issues that must complete first
```

Keep descriptions tight. If you need more than 3 sentences, you're over-explaining.

---

## No Issues Found

If no high-leverage issues are found, still provide the Method block and output:

```
### No High-Leverage Issues Found

The architecture review found no issues meeting the severity threshold. [Brief note about what was checked and any positive observations about the codebase structure.]
```

---

## Final Step

After completing the review, use the Write tool to save this entire review output to `.review/latest.md`:

```
Write the complete review above to .review/latest.md
```

This enables automatic review gate validation if configured.
