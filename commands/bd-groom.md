---
description: Groom beads issues - improve descriptions/labels and identify dependencies
argument-hint: [open|blocked]
---

# Beads Issue Grooming

You are grooming existing bd (beads) issues to improve their quality and ensure dependencies are correctly identified.

**Arguments:** $ARGUMENTS

- `open` — groom only open issues
- `blocked` — groom only blocked issues
- No argument — groom all open/blocked issues

Use the **beads skill** for this task. **Execute all `bd` commands directly** — do not just print them.

## Phase 1: Load Issues

```bash
# If argument is "open":
bd list --status open

# If argument is "blocked":
bd list --status blocked

# If no argument:
bd list --status open --status blocked
```

## Phase 2: De-duplication Check

Before improving issues, scan for duplicates among non-closed issues only:

```bash
bd search "<keywords from issue title>" --status open --status blocked
```

For each issue, check if another non-closed issue covers the same scope:
- If **true duplicate**: Close one with `bd close <id> --reason "Duplicate of <other-id>"` and update survivor's description with "Related/merged from <closed-id>"
- If **partial overlap**: Note in description that they're related, ensure dependency exists
- If **no overlap**: Continue to grooming

## Phase 3: Improve Descriptions, Type, and Labels

**CRITICAL: Process EVERY issue from the list. Do not skip any open issues.**

**Skip issues with status `blocked`** — they're waiting on dependencies and will be groomed when unblocked.

For each non-blocked issue, run `bd show <id>` and evaluate:

### Type Validation

Ensure `Type` is set and matches the issue category:

| Category | Correct Type |
|----------|--------------|
| Broken behavior | bug |
| Cleanup, no behavior change | chore |
| New capability | feature |
| Refactor work | task |
| Spans 3+ files/large scope | epic |

Update if wrong:
```bash
bd update <id> --type <correct-type>
```

### Description Quality Checklist

A good description MUST have these sections:

```
Context
- Why does this matter? Background info

Location
- path/to/file.py:L10-L20 (specific file/line pointers)

Scope:
- In: what will be changed
- Out: explicit non-goals

Acceptance Criteria
- Testable, observable outcomes

Test Plan
- How to verify completion
- TDD steps if changing logic or fixing bugs

Notes for Agent:
- Constraints, edge cases, gotchas
```

Note: Some issues use `Primary files:` instead of `Location` - both are acceptable.

If any section is missing or weak:

1. **Use the `AskUserQuestion` tool** to ask what should go in the missing section:

```
Tool: AskUserQuestion
questions:
  - question: "Issue <id> is missing <section>. What should it contain?"
    header: "<section>"
    options:
      - label: "<suggested value based on issue title>"
        description: "Inferred from context"
      - label: "Skip this issue"
        description: "Leave as-is for now"
```

Example questions to ask:
- "Issue monty-xyz has no Acceptance Criteria. What observable outcome marks this as done?"
- "Issue monty-123 has vague Scope. What specifically is in/out of scope?"

**For missing Location/Primary files**: Use the `Explore` tool to search the codebase and identify the relevant files based on the issue title/description:

```
Tool: Explore
query: "<search based on issue title and context>"
```

Then update the issue with the discovered files directly. If Explore results are ambiguous, fall back to `AskUserQuestion`.

2. After getting user input, update the description:
```bash
bd show <id> --json  # Get current description
bd update <id> --description "<reshaped description preserving existing content>"
```

**Preserve existing content** - reshape and enrich the current description into standard sections, don't overwrite. Append new context rather than replacing.

**Do not invent missing context** - always use `AskUserQuestion` if you don't have enough information to fill a section properly. When in doubt, ASK.

**Batch questions** - prefer grouping missing sections for an issue into a single `AskUserQuestion` call with multiple questions.

**Ask liberally** - it's better to ask too many questions than to guess. Every missing or vague section should trigger a question unless Explore provides a clear answer.

### Acceptance Criteria Quality (Anti-Gameable)

AC must describe **observable outcomes**, not proxy metrics. Apply the malicious compliance test:

**Bad AC (rewrite these):**
- "File under 500 lines" → Can be gamed by inlining
- "Add 3 unit tests" → Tests can be trivial
- "Achieve 80% coverage" → Can add meaningless tests

**Good AC:**
- "Given X, when Y, then Z" (observable behavior)
- "No references to deprecated API remain" (verifiable state)
- "P95 latency < 200ms under load L" (measurable impact)

If existing AC are gameable, rewrite them to describe actual behavior/outcomes.

### TDD Guidance

For issues that change logic or fix bugs, ensure Test Plan includes:
1. Add/adjust failing test first
2. Implement minimal fix
3. Refactor and verify tests pass

### Atomicity Check

Flag issues that bundle too much:

- **Count distinct behaviors**: If >3 behaviors in Scope (look for semicolons, "and"), recommend splitting
- **Mixed modify+add**: Issue should NOT both modify existing AND add new code paths
- **Multi-phase work**: Each phase should be a separate issue
- **Token size**: If scope exceeds ~140k tokens of work, split into epic + children
- **One outcome per issue**: Each issue should have exactly one verifiable "done" state

If oversized/bundled, add to Notes: "GROOMING: Consider splitting - [reason]"

### Label Appropriateness

Ensure labels accurately categorize:
- Domain: `backend`, `frontend`, `api`, `database`, `infra`
- Concern: `security`, `performance`, `testing`, `docs`
- Size: `small`, `medium`, `large`

```bash
bd label add <id> <label>
```

### Priority Validation

Verify priority matches urgency:
- P0: Critical - blocks all work or production issue
- P1: High - important, should be done soon
- P2: Medium - normal priority
- P3: Low - nice to have
- P4: Backlog - someday/maybe

```bash
bd update <id> -p <new-priority>
```

## Phase 4: Identify Dependencies

**CRITICAL: Only add dependencies FROM open issues, never TO blocked issues.** Blocked issues already have dependencies — adding more to them creates unnecessary chains.

**CRITICAL: If two issues touch the same file, they CANNOT run in parallel.**

### Build File → Issues Mapping

1. Extract `Location` or `Primary files:` from each issue's description
2. **If Location is missing or vague, fix it first** using Explore (Phase 3) before building the map
3. Build mapping: `{file: [issue-ids...]}`

### Dependency Rules

For issues sharing files or logical coupling:

1. **File Overlap**: Same file in both → Add dependency
2. **Logical Ordering**: One needs output/types from other → Add dependency  
3. **Interface Coupling**: One defines interface other implements → Add dependency
4. **Data Flow**: One transforms data other consumes → Add dependency
5. **Protocol Completeness**: Producer/consumer pairs → Ensure both exist or note in description

### Epic/Parent-Child Rules

**Use `--parent` for hierarchy, NOT `bd dep add`:**
- Epic → children: Use `bd create --parent <epic-id>` or update existing
- **Do NOT** add dependencies between epics and their direct children
- **Only use `bd dep add`** for blocking deps between sibling tasks

### Add Missing Dependencies

**Skip blocked issues as the "blocked" side** — only add dependencies where the blocked issue is currently `open`.

```bash
bd dep list <id>  # Check existing

# Add dependency (blocker blocks blocked-issue)
# Only do this if blocked-issue has status=open
bd dep add <blocked-issue-id> <blocker-issue-id>
```

**When in doubt, add the dependency** (for open issues). Too many = slower but correct. Too few = merge conflicts.

## Phase 5: Protocol Completeness

For issues mentioning signals/interfaces (env vars, config flags, log markers, prompts):
- Check that companion issues exist for producers AND consumers
- If missing, add to Notes: "Needs counterpart issue: [description of missing side]"

## Phase 6: Report

Provide a summary:

### Issues Groomed
- List each issue with changes made (type, description, labels, priority)

### Dependencies Added
- List each new dependency with rationale (file overlap, logical order, etc.)

### Issues Flagged for Splitting
- Oversized or over-bundled issues that need human review

### Duplicates Found
- Issues closed as duplicates or marked as related

### Remaining Concerns
- Issues needing human input
- Ambiguous scope needing clarification
- Missing protocol counterparts

### Current State
```bash
bd ready    # Issues ready to work on
bd blocked  # Issues blocked and their blockers
bd stats    # Overall project health
```

## Quality Checks

Before finalizing:
- [ ] Every issue has Type, Context, Location, Scope, AC, Test Plan
- [ ] AC are observable outcomes, not gameable metrics
- [ ] Each issue has exactly one verifiable "done" outcome
- [ ] Issues touching the same file have a dependency between them (can't run in parallel)
- [ ] No `bd dep add` between epics and their children
- [ ] Priority reflects actual urgency
- [ ] Labels accurately categorize each issue
- [ ] Oversized/bundled issues are flagged for splitting
- [ ] No duplicate issues remain
- [ ] Protocol producer/consumer pairs are complete or noted

## Summary

At the end, provide a brief method summary:
- Total issues groomed
- Questions asked via AskUserQuestion
- Sections left unanswered (requiring follow-up)
- Dependencies added
- Issues flagged for splitting or human review
