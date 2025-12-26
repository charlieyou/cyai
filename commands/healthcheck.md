# Code Health Check (AI-Generated Codebases)

Perform a **pragmatic** code health review of this codebase. Optimize for **maximum long-term payoff per hour invested**—not exhaustive coverage. It's OK to leave low-impact issues unfixed.

---

## Priority Order

When in doubt, prioritize:

1. **Correctness & data integrity** – bugs, edge cases, unsafe behavior
2. **Delete & simplify** – dead code, unused abstractions, abandoned experiments
3. **Consistency & clarity** – same problem → same pattern; clear names and boundaries
4. **Tests** – critical flows must be tested
5. **Performance** – only where there's an actual or likely problem

---

## Scope & Stopping Criteria

- Spend ~70% of effort on structural issues, dead code, and correctness
- Proceed to architecture review only if earlier phases reveal systemic patterns
- Stop cataloging a category once you have 3–5 clear examples—the pattern is established
- Skip Low-severity issues unless they cluster (3+ instances = worth noting)
- Keep output concise; stop once patterns are clearly established
- Avoid duplicate "missing tests" tickets; include tests in the main fix unless tests are the only change

---

## Traversal Strategy

Don't scan randomly. Work systematically:

1. **Start at entry points**: `main.py`, `index.ts`, `app.py`, route definitions, exported modules
2. **Map outward**: follow the dependency graph from entry points to understand what's actually used
3. **Use heuristics to find hotspots**:
   - Large files (>400 lines)
   - Directories named `utils`, `helpers`, `common`, `shared` that are suspiciously large
   - Files with many `TODO`/`FIXME`/`HACK` comments
   - Recent additions or incomplete migrations (v1/v2 coexisting)
4. **Trace reachability**: code not reachable from entry points or public APIs = dead code candidate

---

## What to Look For

### 1. Dead, redundant, or ghost code

AI-generated code accumulates unused scaffolding fast.

- **Dead code**: unused functions, classes, variables, imports, entire modules, config flags never checked
- **Ghost features**: endpoints/components wired into routing but never called from any user flow; placeholder implementations (`return null`, `// TODO: implement`)
- **Duplicate systems**: multiple implementations of logging, HTTP clients, config loading, validation, database access

**Action**: Delete when safe. Merge when multiple implementations are in use.

---

### 2. AI-specific smells

These are the failure modes unique to AI-generated code:

**Hallucinated or misused APIs** — code that "looks right" but doesn't match reality:
- `response.json()` on an already-consumed Response
- `axios.get(...).data` (axios returns a promise, not the response)
- `useEffect` with missing dependencies that are actually used inside
- ORM calls like `Model.findOne({ where: id })` instead of `{ where: { id } }`
- Framework methods that don't exist (`router.middleware()` vs `router.use()`)
- Wrong parameter order or incorrect return type assumptions

**Partial implementations** — only the happy path exists:
- Missing error handling branches (empty `catch`, `// handle error` comments)
- No handling for: timeouts, pagination, retries, partial failures
- Validation that doesn't actually validate all inputs

**Redundant abstraction layers** — YAGNI violations:
- Thin wrappers that just pass through arguments
- Repository/service/controller layers that add no logic
- Generic factories or plugin systems used by 1–2 code paths
- Over-parameterized helpers used exactly once

---

### 3. Structural issues

- **Large files needing split**: >400 lines, or mixing unrelated concerns (business logic + HTTP + persistence in one file)
- **Oversized functions**: >50 lines, deeply nested, multiple responsibilities
- **Misplaced code**: domain logic in `utils/`, feature code in `common/`, UI code in shared modules
- **Misleading names**: `handleData`, `processStuff`, `UserService` that also manages billing

---

### 4. Correctness & robustness

- **Critical paths without tests**: auth, payments, data mutations, background jobs, external integrations
- **Shallow tests**: only check that code runs without throwing; over-mock everything; timing-based flakiness
- **Missing error handling**: unhandled rejections, swallowed exceptions, no validation at module boundaries
- **Type/contract mismatches**: API vs service vs DB layer disagreeing on shapes; stringly-typed fields where enums belong

---

### 5. Hygiene

- **Debug cruft**: `console.log`, `print()`, `debugger` left in production paths
- **Stale TODOs**: old, unclear, or blocking correctness on production paths
- **Build artifacts in source control**: `dist/`, `.pyc`, compiled bundles, generated clients
- **Stale docs**: READMEs describing different architecture than exists; non-working setup instructions

---

### 6. Architecture (only if patterns emerge)

- **Inconsistent patterns**: multiple approaches to state management, error handling, DI, logging across similar modules
- **Missing library opportunities**: hand-rolled HTTP clients, validation, parsing where standard libraries would be clearer and safer
- **Coupling violations**: UI reaching into DB models, cyclic dependencies, modules knowing too much about each other's internals

---

## Verification Before Reporting

Before flagging an issue as Critical or High:

1. Confirm the code path is actually reachable (not already dead)
2. Check if a test already covers the "missing" case
3. Verify "hallucinated APIs" aren't custom wrappers or aliases defined elsewhere
4. If uncertain, mark as **"Needs verification"** rather than asserting
5. State evidence of reachability (call path/config/entry). If unknown, lower confidence and severity.

---

## Severity Definitions

- **Critical**: Would cause data loss, security breach, financial error, or crash in production. Fix before any deployment.
- **High**: Will cause bugs under realistic (not just edge-case) conditions, or blocks understanding of critical paths. Fix this sprint.
- **Medium**: Correct but hard to maintain or extend. Creates drag but doesn't break things. Fix opportunistically.
- **Low**: Style, naming, minor inconsistency. Fix only if already touching the file.

---

## Output Format

Start with a short **Method** block (3–6 bullets) listing: tests run, entry points reviewed, key files scanned, and assumptions/unknowns.

Then produce a **single unified list** of issues, sorted by severity (Critical first, then High, Medium, Low).

For each issue:

```
### [Severity] Short title

**Primary files**: `path/to/file.ts:lines` (list all files touched; approximate lines fine)
**Category**: Correctness | Dead Code | AI Smell | Structure | Hygiene | Architecture | Config Drift
**Type**: bug | task | chore (use bug for broken behavior, task for refactors, chore for cleanup)
**Confidence**: High | Medium | Low
**Context**:
- What's wrong (1 sentence)
- Why it matters / who or what breaks (1–2 sentences)
- Related context if needed (optional)
**Fix**: Concrete action to resolve (1–3 sentences). Include tests here unless tests are the only change.
**Non-goals**: What's explicitly out of scope (1–2 bullets; recommended for Medium+ severity)
**Acceptance Criteria**: 1–3 bullets
**Test Plan**: 1–2 bullets
**Agent Notes**: Gotchas, edge cases, or constraints an implementer should know (optional)
**Dependencies**: Optional – list other issues that must complete first
```

Keep descriptions tight. If you need more than 3 sentences, you're over-explaining.

> **Downstream**: This output feeds directly into `/bd-breakdown` for ticket creation.

---

## Summary

After the issue list, provide:

### Top Investments

A table of the **10 highest-impact fixes** (risk reduction, correctness, clarity):

| # | Location | Issue | Severity | First Step |
|---|----------|-------|----------|------------|
| 1 | ... | ... | ... | ... |

### Recommendations

- **Do immediately** (this week): 3 specific items, prioritizing Critical/High
- **Plan for next sprint**: 3 specific items that address systemic issues
- **Backlog**: 1–2 Major Refactors worth planning, with suggested phase boundaries

Each recommendation should be concrete enough to create a ticket from directly.
