# Architecture Review Analysis

**IMPORTANT: This is a READ-ONLY review. Do NOT modify any files. Only analyze and report findings.**

Perform a **principal-engineer-level** architecture review focused on **high-leverage design improvements**. Optimize for **maximum long-term payoff per hour invested**. Prefer **functional patterns** (pure functions, explicit data flow, composition) unless the codebase clearly benefits from OO constructs.

This is not a correctness bug hunt. Only flag correctness issues if they block architectural change or reveal systemic design flaws.

## Traversal Strategy

1. **Map boundaries** (quick pass): entry points, public APIs, services, and core domains
2. **Trace dependency flow**: identify layers and check for dependency inversions
3. **Run hotspot analysis**: use metrics to rank candidates before deep-diving
   - Target: cyclomatic complexity >= 15, function length >= 80 lines, file length >= 500 lines
4. **Validate reachability**: ensure hotspots are on real execution paths; skip dead code

Stop traversal once you have enough evidence to populate the top 6-12 issues.

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

## Priority Order

When in doubt, prioritize:
1. **Boundary clarity & dependency direction** - modules should have crisp responsibilities and one-way dependencies
2. **Testability & change isolation** - changes should be easy to validate without heavy setup
3. **Complexity & duplication hotspots** - high cyclomatic complexity, copy/paste logic, tangled flows
4. **Size & cohesion** - oversized files/modules, "god classes", mixed concerns
5. **Abstraction fitness** - too much abstraction (YAGNI) or too little (leaky, repetitive)

## Functional Design Bias (prefer these refactors)

- Move side effects to the edges; keep core logic **pure and deterministic**
- Use **data-in/data-out** functions and compose with pipelines
- Replace stateful classes with **stateless modules** where possible
- Pass dependencies explicitly (function params) rather than via globals or singletons
- Model transformations as **small pure functions**; keep orchestration thin

Use OO only when it clearly improves ergonomics (e.g., polymorphism with real behavior variance).

## Output Format

Produce a structured architecture review with:

1. **Method** block (3-6 bullets): tools run, entry points reviewed, key files scanned, assumptions/unknowns

2. **Issues** sorted by severity (Critical -> High -> Medium -> Low), each with:
   - **Severity** and short title
   - **Primary files**: paths with approximate line numbers
   - **Category**: Boundaries | Testability | Complexity | Duplication | Cohesion | Abstraction
   - **Type**: bug | task | chore
   - **Confidence**: High | Medium | Low
   - **Context**: What's wrong, why it matters (1-3 sentences)
   - **Fix**: Concrete action to resolve (1-3 sentences)
   - **Acceptance Criteria**: 1-3 bullets
   - **Test Plan**: 1-2 bullets

## Severity Definitions

- **Critical**: Architecture causes production risk or data integrity issues (use sparingly)
- **High**: Architectural debt that blocks feature velocity or safe changes
- **Medium**: Design friction that slows changes but is not blocking
- **Low**: Improvement opportunity with limited ROI

## Ground Rules

- **Be evidence-based**: only cite issues you can point to in code that was actually inspected
- **Avoid speculation**: if unsure, mark "Needs verification" and lower confidence
- **Be specific**: tie every point to concrete files, modules, or functions (no generic advice)
- **Keep it incremental**: propose refactors that can land in steps; avoid "rewrite it all"
- **Keep excerpts tiny**: reference files and symbols; avoid long code blocks

## Out of Scope (Do Not Report)

- Style/formatting issues (leave to linters)
- Minor naming inconsistencies
- Missing documentation unless it blocks understanding
- Single-use code that's appropriately inlined
- Test coverage gaps (unless they indicate untestable design)
- Performance micro-optimizations without measured impact
- Dead code, ghost features, or AI-specific API misuse (covered by healthcheck)
- Hygiene cleanup (debug logs, stale TODOs, build artifacts)

## CRITICAL RULES

1. **DO NOT modify, create, or delete any files** - this is analysis only
2. **DO NOT attempt to fix issues** - only report them
3. **DO NOT install packages or run commands that change state**
4. You may only use read operations: list files, read files, search content
