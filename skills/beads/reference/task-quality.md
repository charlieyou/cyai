# Task Creation Quality Guide

When creating issues with `br create`, follow these guidelines to produce an executable work graph where closing all tasks guarantees the feature is *fully done*.

---

## The No-Stragglers Invariant

**Completing ALL generated tasks MUST fully implement the plan (100%, not "mostly").**

- Every plan Objective, Acceptance Criterion, and MUST/SHALL clause must have an owning task
- Every task must have explicit verification
- If you can't assign ownership for any obligation: create a prerequisite clarification task

---

## Sizing Rules

Size tasks by **files touched** and **subsystems crossed**:

| Metric | Target | Hard Limit |
|--------|--------|------------|
| Files | 3-8 | ≤12 |
| Subsystems | 1-2 | ≤3 |
| Acceptance Criteria | 1-2 | ≤3 |

**Mechanical sweep exception** (same change across many files):
- Up to 18 files allowed
- Must stay within 1 subsystem
- Requires grep-able pattern + scripted verification

**Split triggers** (task is too big):
- Uses "and then / after that / finally"
- "figure out / investigate / determine where"
- "central integration point / ties everything together"
- More than 3 AC or 3+ subsystems

---

## TDD Task Ordering

Per feature, tasks follow this order:

### 1. Skeleton + Integration Test Task
Title: include `[integration-path-test]`

Combines:
- Compile-ready skeleton (types, interfaces, DI bindings, stubs)
- Failing integration test through composition root

```bash
br create "[integration-path-test] Auth skeleton + failing e2e" \
  -t task -p 1 --description "..."
```

### 2. Implementation Tasks (parallel where safe)
- Every implementation task depends on the skeleton task
- Within each: write failing unit tests → implement → confirm integration passes
- Keep integration tests stable during implementation

```bash
br create "Implement token validation" -t task -p 2 \
  --deps "blocks:bd-skeleton" --description "..."
```

### 3. No Verification-Only Tasks
Do NOT create separate "run all tests" tasks. The final implementation task per feature must include verification that all tests pass.

---

## Dependency Patterns

Add dependencies when:
- Two tasks touch the same file (file overlap)
- Task consumes types/interfaces from another
- Wiring/skeleton must exist before behavior work

Constraints:
- Do NOT make tasks depend on parent epics (use `--parent` for grouping)

```bash
# T002 depends on T001 (file overlap or logical order)
br dep add bd-t002 bd-t001
```

---

## Acceptance Criteria Quality

### Good AC (observable outcomes)

| Type | Pattern |
|------|---------|
| Features | "Given X, when Y, then Z" |
| Refactoring | "X delegates to Y; no direct Z manipulation" |
| Performance | "P95 latency < 200ms under load L" |
| Bugs | "Given [repro], system returns [expected]" |
| Cleanup | "No references to deprecated API remain" |

### Bad AC (gameable proxies)

| Pattern | Why it fails |
|---------|--------------|
| "File under 500 lines" | Can inline, delete docs, split arbitrarily |
| "Add 3 unit tests" | Tests can be trivial/meaningless |
| "80% coverage" | Can add tests that assert nothing |
| "Fix the crash" | Doesn't verify correct behavior |

### The Malicious Compliance Test

For every AC, ask:
1. Can this be satisfied while missing the point? → Rewrite
2. Does it focus on side effects (counts/size) instead of behavior? → Rewrite
3. Would a malicious agent "pass" it? → Add constraints

---

## Task Description Structure

Every task description should include:

```markdown
## Goal
[Single outcome - one "done" state]

## Context
[Plan links, artifacts, prior decisions]

## Scope
[In/out boundaries]

## Changes
[Concrete file list: existing vs new, key edits, migrations]

## Acceptance Criteria
[Only the AC this task owns - ≤3]

## Verification
[Exact commands/steps that prove done]
```

---

## Special Task Types

### System Wiring Tasks

When introducing config/data/templates that propagate end-to-end:

```bash
br create "[system-wiring] Config propagation" -t task -p 1 \
  --description "Verify config loads, overrides work, value reaches runtime"
```

### Negative Case Coverage

Verification should explicitly cover:
- Invalid inputs / rejection behavior
- Precedence/merge/override semantics
- Startup vs runtime behavior (separate tests if needed)

---

## Quick Validation Checklist

Before creating tasks, verify:

- [ ] Every plan obligation has an owning task
- [ ] No task exceeds sizing limits
- [ ] Each feature has one `[integration-path-test]` task
- [ ] Dependencies added for file overlaps
- [ ] All AC are behavioral, not gameable
- [ ] Descriptions include required sections
