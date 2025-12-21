# Code Health Check (AI-Generated Codebases)

Perform a **comprehensive but pragmatic** code health review of this codebase.  
Optimize for **maximum long-term payoff per hour** spent. It's OK to leave low-impact nits unfixed.

Use the **oracle tool** to analyze the code deeply. Focus on:
- Correctness and robustness of critical paths
- Deletion and simplification of unused / overbuilt code
- Consistency of patterns and architecture
- Test coverage and operability

---

## Review Priorities

When in doubt, prioritize in this order:

1. **Correctness & data integrity** – bugs, edge cases, unsafe behavior.
2. **Delete & simplify** – dead code, unused abstractions, abandoned experiments.
3. **Consistency & clarity** – same problem, same pattern; clear names and boundaries.
4. **Tests & docs** – critical flows must be tested and at least minimally documented.
5. **Performance & reliability** – only where there is an actual or likely issue.

---

## Phase 0: Repo Signals & Inventory

Build a quick mental map of the system. Identify hotspots where AI‑generated code is likely weakest.

Analyze:

1. **Modules & responsibilities**
   - What are the main services/modules? (e.g., API, worker, UI, data layer)
   - Are there obvious "god" modules doing too much?

2. **Suspicious or AI-ish regions**
   - Directories or files with:
     - Very generic names (`utils.ts`, `helpers.js`, `common.ts`) that are very large.
     - Many TODO/FIXME/`HACK` comments or "temporary" wording.
     - Inconsistent style or different coding conventions within the same module.

3. **Churn & growth areas** (if history is available)
   - Recently added large files or subsystems.
   - Incomplete migrations (e.g., both v1 and v2 codepaths existing together).

Summarize briefly:
- "Key modules and responsibilities"
- "Likely hotspots for technical debt"

---

## Phase 1: Code Smells & Structural Issues

### 1. Size & complexity

Look for:

1. **Large files needing refactoring**
   - Files over **400–500 lines** or classes with many responsibilities.
   - Files mixing unrelated concerns (e.g., business logic + HTTP + persistence).

2. **Oversized functions**
   - Functions over ~50–70 lines or with deeply nested logic.
   - Functions with multiple conceptual responsibilities.

For each candidate, note:
- What primary responsibilities are mixed?
- A suggested way to split (new modules/functions).

---

### 2. Dead, redundant, or ghost code

AI-generated code often leaves unused scaffolding.

Find and flag:

1. **Dead code**
   - Unused functions, classes, variables, imports, or entire modules.
   - Exported APIs that are never imported anywhere.
   - Config flags / feature flags that are never checked.

2. **Ghost features**
   - Endpoints, CLI commands, React components, or modules that:
     - Are wired in routing or exports, **but never called from any user flow**, or
     - Contain placeholder/partial implementations (e.g., `// TODO: implement`, `return null`).
   - "V2" or "new_" variants that are never actually used.

3. **Duplicated / redundant systems**
   - Multiple implementations of:
     - Logging
     - HTTP clients
     - Database access
     - Configuration / environment loading
     - Validation / serialization
   - Look for near-identical utility functions across files.

Recommend:
- **Delete** when safe.
- **Merge** to a single implementation when multiple are used.

---

### 3. AI-specific code smells

Specifically hunt for:

1. **Hallucinated or misused APIs**
   - Library/framework calls that do not exist or are used with wrong parameters/return types.
   - Non-idiomatic use of core frameworks (e.g., React, Express, FastAPI, ORMs).
   - Code that "looks right" but doesn't match official docs.
   - Mark these as **Critical/High** if on critical paths.

2. **Partial implementations**
   - Functions with obvious missing branches (e.g., only handling "happy path").
   - Commented hints like `// handle error`, `// handle pagination`, but not implemented.
   - Validation functions that don't actually validate all inputs.

3. **Redundant abstraction layers**
   - Thin wrappers that only pass through arguments and don't add value.
   - Over-generalized helpers created once and never reused.
   - "Repository/service/util" layers that just forward calls.

Flag these as **YAGNI / simplification opportunities**.

---

## Phase 2: Organization & Hygiene

Look for:

1. **Misplaced files**
   - Domain logic in "utils" directories.
   - UI-specific code in shared/core modules.
   - Feature-specific files in generic/common folders.

2. **Misleading or vague names**
   - Files, functions, or variables with names that don't match their purpose:
     - `handleData`, `processStuff`, `doWork`, `manager`, `service`.
   - Names that lie about scope (e.g., `UserService` that also manages billing).

3. **Debug cruft & noise**
   - `console.log`, `print`, `debugger`, temporary metrics/logging left in hot paths.
   - TODO/FIXME comments that are:
     - Old, unclear, or no longer accurate.
     - Blocking correctness (e.g., `TODO: handle failure` on production path).

4. **Build artifacts & generated files in source control**
   - Compiled bundles, transpiled JS/TS, dist folders, `.pyc`, generated clients.
   - Large JSON snapshots or cached responses that should be ignored.

5. **Stale or misleading documentation**
   - READMEs that describe a different architecture than the code.
   - Old design docs or plans for features that were never fully built or were replaced.
   - Scripts or instructions that don't work anymore.

For each hygiene issue, recommend either:
- **Delete / clean up**, or
- **Update to match reality**.

---

## Phase 3: Correctness, Tests & Robustness

AI-generated code often looks plausible but lacks defensive checks.

Identify:

1. **Critical paths without tests**
   - Authentication, authorization, billing/payments, data mutations, background jobs.
   - Anything that touches external systems (DB, queues, third-party APIs).
   - Public API endpoints and main user actions.

Classify:
- "Critical path and **no tests**"
- "Critical path and **only shallow/happy-path tests**"

2. **Brittle or low-value tests**
   - Snapshot tests that assert large, unstable payloads.
   - Tests that:
     - Only check that a function runs without throwing.
     - Over-mock everything and don't represent real behavior.
   - Flaky patterns (timing-based sleeps, dependency on real time or network).

3. **Error handling & edge cases**
   - Unhandled rejections/exceptions.
   - Empty `catch` blocks or logging without remediation.
   - Inputs that aren't validated, especially on boundaries between modules or at API edges.
   - Missing handling for:
     - Timeouts
     - Partial failures from dependencies
     - Retries / idempotency when required

4. **Data integrity & contracts**
   - Type mismatches between layers (API vs service vs DB).
   - Manual stringly-typed fields where enums or well-defined types are expected.
   - Assumptions about schema that are not enforced anywhere.

---

## Phase 4: Architecture & Design

Identify design-level issues:

1. **Over-engineered systems (YAGNI)**
   - Complex plugin systems, generic factories, or configuration-driven designs used by only 1–2 code paths.
   - Abstractions created once and never reused.
   - Indirection that makes tracing behavior difficult without clear benefit.

2. **Missing library opportunities**
   - Hand-rolled:
     - HTTP/REST clients
     - Validation
     - Parsing and serialization
     - Common algorithms (search, caching, pagination)
   - Where a well-known library would be:
     - Clearer
     - Safer
     - Better tested

3. **Inconsistent patterns**
   - Multiple patterns for:
     - State management
     - Error handling
     - Logging and metrics
     - Dependency injection or configuration
   - Different styles across feature modules for the same tasks.

4. **Coupling & boundaries**
   - Modules that:
     - Know too much about each other's internals.
     - Reach directly into lower-level details (e.g., UI touching DB models).
   - Cyclic dependencies between modules.
   - Missing clear domain boundaries.

5. **API design problems**
   - Confusing or inconsistent parameter ordering and naming.
   - Inconsistent error codes or response shapes.
   - Surprising side effects (e.g., reads that mutate state).

For architectural issues, suggest:
- **Small, incremental refactors** rather than big rewrites.
- Clear target patterns (e.g., "Use pattern X used in module Y across all features").

---

## Output Format

For **each significant issue** (don't list every nit), output:

1. **Location** – File path and line numbers (approximate is fine).

2. **Severity**
   - **Critical** – Likely bug, data loss, security/privacy risk, or major user impact.
   - **High** – Affects reliability, maintainability of critical paths, or major complexity.
   - **Medium** – Localized maintainability / clarity / consistency issue.
   - **Low** – Cosmetic or minor improvement.

3. **Category** – One of: Structural/Size, Dead/Redundant Code, AI-Specific Smell, Organization/Hygiene, Correctness/Tests, Architecture/Design, Documentation

4. **Description** – What is wrong and why it matters (impact on correctness, maintainability, or user experience)

5. **Suggested fix** – Concrete, actionable steps. Prefer **small, incremental changes** over rewrites.

6. **Effort estimate**
   - **Quick fix** – <30 minutes
   - **Small refactor** – 0.5–1 day
   - **Major refactor** – >1 day or multi-step change

---

## Summary & Action Plan

Finish with a concise plan:

1. **Top 5–10 Health Investments**
   - List the **highest-leverage** issues (by impact / effort ratio).
   - For each: `Location → Issue → Impact → Effort → Recommended next step`.

2. **Immediate next sprint candidates (1–2 weeks)**
   - 3–5 items that should be done soon, especially Critical/High with Quick/Small effort.

3. **Longer-term refactors**
   - 2–3 Major refactors worth planning, if any.
   - Note clear boundaries and possible phases.

Focus on making this list directly usable to create tickets or tasks.
