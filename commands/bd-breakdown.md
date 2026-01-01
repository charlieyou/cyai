---
description: Convert a review or feature plan into small, parallelizable Beads issues with rich descriptions and dependencies.
argument-hint: <issue-scope>
---

# Beads Issue Breakdown (Reviews or Plans)

> **Upstream**: This skill accepts output from `/healthcheck` or any structured review/plan.

You are creating **bd (beads)** issues from a code review or a feature plan. Optimize for **parallel execution** by a swarm of agents and ensure each issue is **small enough for one agent to finish in a single thread**.

**Issue creation instructions (from command arguments):** $ARGUMENTS

Use the arguments above as the **authoritative scope** for what to create issues for. If they are missing, vague, or conflict with the input, ask up to 3 clarifying questions before producing issues.

If input is missing critical context (scope, expected behavior, or affected areas), ask **up to 3 clarifying questions** before producing issues.

Use the **beads skill** for this task. Produce bd-ready issues and dependency links.  
Execute the `bd` commands to create issues and dependencies (don’t just print them).

## De-duplication Requirement (Read Existing Issues First)

- **First, read open issues** in Beads before creating anything. Use `bd list --status open` (and also check `in_progress`/`blocked` if needed) to see what already exists.
- **For each candidate issue**, search for overlaps using `bd search`, `bd list --title-contains`, and/or `bd list --desc-contains`.
- **Only create a new issue if no existing issue matches the scope.**
- **If an existing issue matches but you have more context**, append it to the issue’s **description** (preserve existing content). Use `bd show <id> --json` to fetch the current description, then `bd update <id> --description "<old description>\n\n[Added Context]\n...">`.
- If a matching issue exists and there’s **no new context**, skip creation and note it in the Method block.

## Prompting Principles (Best Practices)

- **Be grounded**: Only create issues supported by the provided review/plan. If uncertain, say "Needs verification."
- **Be explicit**: State assumptions and missing context up front.
- **Be complete on interfaces**: When a task involves one side of a protocol (producer or consumer), ensure the other side is also covered.
- **Be atomic**: One issue = one clear outcome; avoid bundling unrelated fixes.
- **Be parallel-first**: Avoid file overlap unless strictly required.
- **Be consistent**: Use stable priority mapping and uniform wording.
- **Be actionable**: Every issue must have acceptance criteria and a test plan.

## Goals

- Create small, high-signal issues that are easy to pick up without prior context.
- Minimize file overlap across issues so agents can work in parallel.
- **Ensure correct dependencies**: if two issues touch the same file, they MUST have a dependency between them. Lean toward adding more dependencies rather than fewer — a missed dependency causes agent conflicts and wasted work.
- Include TDD guidance when appropriate.

## Sizing Rules

- Each issue must be completable by a single agent within **140k tokens** (staying under 75% of context window to preserve reasoning quality).
- If a task would exceed **140k tokens**, split it into a **parent epic** plus child issues.
- Each issue should touch **2–3 primary files** whenever possible.
- If a change spans 4+ files, consider a coordinating epic and split by file/domain.
- **Prefer fewer, larger issues** over many small ones — agent startup overhead is significant, so combining related work reduces total cost.
- **Epic default**: when creating 3+ related issues from a single review/plan scope, first create an umbrella epic for organization.

## Scope Atomicity Rules

**CRITICAL: Bundling too many things in one issue causes agents to skip items.**

- **Count distinct behaviors in the "In:" scope.** If more than 2-3 distinct behaviors are listed (look for semicolons or "and" conjunctions), split into separate issues.
- **Distinguish "modify existing" vs "add new"**: A single issue should NOT both modify an existing code path AND add a completely new code path. These have different failure modes and should be separate issues.
- **Phase/gate boundaries**: If implementing a multi-phase system (e.g., Gates 1-4, or before/after hooks), each phase that runs at a different point in execution should be a separate issue.
- **One outcome per issue**: Each issue should have ONE clear, verifiable outcome. If you need multiple bullet points to describe what "done" looks like, consider splitting.

Example of BAD scope (too many things bundled):
```
In: add Gate 1-4 sequencing; enforce clean-git checks; handle no-op resolution;
    run-level validation in worktree; follow-up issue on failure
```

Example of GOOD scope (split appropriately):
```
Issue A - In: update per-issue gate flow to use check_with_resolution; handle no-op resolution
Issue B - In: add run-level validation after all issues complete (Gate 4)
Issue C - In: create follow-up issue when run-level validation fails
```

## Epic and Parent-Child Rules

**Use `--parent` flag for hierarchical relationships, NOT `bd dep add`.**

- When creating child issues under an epic, use: `bd create "Title" --parent <epic-id> ...`
- Parent-child is for **organization/hierarchy**, not blocking
- **Do NOT** use `bd dep add` between epics and their children
- **Only use `bd dep add` for blocking dependencies** between sibling tasks that have:
  - File overlap (same file edited by both)
  - Logical ordering (task B needs output/types from task A)

## Parallelization Rules

**CRITICAL: Getting dependencies right is essential.** When in doubt, add the dependency. It is far better to have too many dependencies (slower but correct) than too few (agents clobbering each other's work).

- **If two issues touch the same file, they CANNOT run in parallel.** Add a dependency.
- Prefer splits by module/file/feature boundary.
- **Do not** create two issues that edit the same file unless one blocks the other.
- If overlap is unavoidable, add a dependency and explain the ordering.
- Avoid cross-cutting refactors that force multiple agents to touch the same files.
- **Err on the side of more dependencies.** A missed dependency causes merge conflicts and wasted agent work. An extra dependency just means sequential execution.

## Priority Mapping

- Critical -> P0
- High -> P1
- Medium -> P2
- Low -> P3 or P4 (use P4 for backlog cleanups)

## Type Derivation

When input comes from `/healthcheck`, derive Type from the issue's Category and Type fields:

| Category | Default Type | Notes |
|----------|--------------|-------|
| Correctness | bug | Broken behavior |
| Dead Code | chore | Cleanup, no behavior change |
| AI Smell | bug or task | bug if behavior broken, task if just smelly |
| Structure | task | Refactor work |
| Hygiene | chore | Cleanup |
| Architecture | task or epic | epic if spans 3+ files |
| Config Drift | task | Alignment work |

If the healthcheck issue already specifies a `Type` field, use that directly.

## Acceptance Criteria Quality

Acceptance criteria must describe **observable outcomes**, not **proxy metrics** that can be gamed or satisfied without achieving the actual goal.

Numeric targets are acceptable only when they directly measure user-visible behavior or system SLOs (e.g., latency, error rate), not internal structure (file size, LOC) or process (test counts, time spent).

If the upstream spec or plan includes gameable AC, do not copy them as-is; rewrite them into observable-outcome criteria.

### Anti-patterns (Gameable)

| Type | ❌ Bad AC | Why it fails |
|------|----------|--------------|
| Refactoring | "File under 500 lines" | Can inline, delete docs, split arbitrarily |
| Features | "Add 3 unit tests" | Tests can be trivial/meaningless |
| Performance | "Reduce function calls by 50%" | Can inline everything, hurt readability |
| Coverage | "Achieve 80% coverage" | Can add tests that assert nothing |
| Bugs | "Fix the crash" | Doesn't verify correct behavior restored |
| Process metrics | "Spend 2 days refactoring" / "Touch 5 files" | Time/effort/file-count says nothing about outcome |

### Good AC Patterns

| Type | ✅ Good AC | Why it works |
|------|-----------|--------------|
| Refactoring | "X delegates to Y; no direct Z manipulation" | Describes responsibility boundaries |
| Features | "Given X, when Y, then Z" | Observable behavior |
| Performance | "P95 latency < 200ms under load L" | Measurable user impact |
| Bugs | "Given [repro], system returns [expected]" | Verifies correct behavior |
| Cleanup | "No references to deprecated API remain" | Verifiable state |

### The Malicious Compliance Test

Before finalizing AC, ask:
1. **Can this be satisfied while missing the point?** → Rewrite
2. **Does this focus on a side effect (size, count, coverage) instead of behavior or invariants?** → Rewrite to describe the behavior or invariant
3. **Would a malicious-compliance agent pass this?** → Add behavioral constraint

## TDD Guidance

Add explicit TDD instructions **when changing logic or fixing a bug**:
- Add/adjust failing test first.
- Implement minimal fix.
- Refactor and run relevant tests.

## Output Format

Start with a short **Method** block (3–6 bullets): input type (review/plan), assumptions, and any missing context.

Then produce **Issue Specs** in the format below:

```
### [Handle] Title

Type: bug | feature | task | epic | chore
Priority: P0 | P1 | P2 | P3 | P4
Labels: optional (comma-separated)
Primary files: path1, path2
Dependencies: [HandleA, HandleB] (only if required)

Context:
- 2–5 bullets explaining the background and why this matters
- Include exact file/line pointers when available

Scope:
- In: what will be changed
- Out: explicit non-goals to prevent scope creep

Acceptance Criteria:
- Bullet list, testable outcomes

Test Plan:
- Bullet list (include TDD steps if applicable)

Notes for Agent:
- Constraints, edge cases, or gotchas
```

After the issue specs, **run bd commands** in this order:

1) `bd update --description` commands for any **existing** issues that need added context  
2) `bd create` commands in the same order as the issue list  
3) `bd label add` commands (if labels specified)  
4) `bd dep add` commands for dependencies

Use **issue handles as placeholders** for IDs:

```
# Create epic first
bd create "Epic: Feature X" -p 1 --type epic --description "..."
# returns: EPIC-ID

# Create child issues with --parent
bd create "Child task 1" -p 1 --type task --parent EPIC-ID --description "..."
# returns: ISSUE-A

bd create "Child task 2" -p 1 --type task --parent EPIC-ID --description "..."
# returns: ISSUE-B

# Only use bd dep add for blocking deps between siblings
bd dep add ISSUE-B ISSUE-A  # B is blocked by A (file overlap or logical order)
```

## Quality Checks Before Finalizing

- No duplicate issues
- **No two parallel issues edit the same file** — if they touch the same file, one MUST depend on the other
- **Verify every file appears in at most one independent issue** — scan the "Primary files" lists and ensure no file is listed in two issues that lack a dependency chain between them
- Dependencies must be complete: when uncertain, add the dependency (too many is safer than too few)
- **Protocol completeness**: For any issue that parses/receives signals (log markers, config flags, env vars), verify a corresponding issue exists for the component that produces those signals. For prompt-driven agent behavior, ensure the relevant prompt file (e.g., `src/prompts/implementer_prompt.md`) has a task to document the expected behavior.
- Every issue has clear acceptance criteria and test plan
- TDD included when appropriate
- All issues are grounded in the provided input; if input has `Confidence: Low` or `Medium`, add "Needs verification" to Context
- Each issue is within the 140k-token limit (otherwise split into epic + children)
- **Scope atomicity**: Each issue's "In:" section has ≤3 tightly related changes; if there are semicolon-separated items, verify they're truly coupled (would break if done separately)
- **No mixed modify+add**: Issues don't both modify existing code paths AND add new standalone features/phases
- **Single outcome**: Each issue has ONE verifiable "done" state, not multiple independent outcomes
