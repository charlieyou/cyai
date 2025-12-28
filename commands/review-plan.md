---
description: Multi-model consensus review for implementation plans
argument-hint: [path/to/plan.md | --list]
---

# Plan Review

Review an implementation plan with multi-model consensus to catch issues before coding begins.

## Input Sources

Based on $ARGUMENTS, determine the plan source:

| Argument | Source |
|----------|--------|
| (none) | Use the plan file from this session (see below) |
| `<path>` | Read the plan file at the specified path |
| `--list` | List recent plans from `~/.claude/plans/` and prompt user to select one |

**Finding this session's plan:**

If the user exited plan mode earlier in this conversation, you already know the plan file path - it was returned by ExitPlanMode and is visible in your conversation context. Use that path.

If no plan was created in this session, inform the user:
> No plan was created in this session. Either enter plan mode first, or specify a plan file path: `/review-plan path/to/plan.md`

## Review Criteria

Analyze the implementation plan for:

1. **Completeness** - Does it cover all necessary changes? Missing files or steps?
2. **Correctness** - Are the proposed modifications technically sound?
3. **Order of Operations** - Are steps sequenced correctly (dependencies first)?
4. **Edge Cases** - Are error paths, fallbacks, and corner cases addressed?
5. **Breaking Changes** - Are backwards compatibility concerns identified?
6. **Testability** - Can the implementation be verified? Are test steps included?
7. **Scope Creep** - Does it stick to what's needed, or introduce unnecessary changes?

Focus on whether following this plan would produce a working implementation.

## Ground Rules

- **Be evidence-based**: Only cite issues you can point to in the plan text.
- **Be specific**: Tie every point to concrete steps, files, or sections in the plan.
- **Consider context**: If the plan references existing code, verify those references are accurate.
- **Check dependencies**: Ensure external dependencies and prerequisites are identified.
- **Validate scope**: The plan should match the stated goal without gold-plating.

## Severity Definitions

- **Critical**: Plan would cause data loss, security issues, or fundamentally wrong implementation
- **High**: Plan has gaps that would cause bugs or require significant rework
- **Medium**: Plan is correct but unclear or could lead to maintainability issues
- **Low**: Minor omissions or style suggestions

## Codebase Verification

Before completing the review, verify key plan assumptions against the actual codebase:

1. Check that files/modules mentioned in the plan actually exist
2. Verify function signatures or APIs the plan intends to use or modify
3. Confirm the plan's understanding of current behavior is accurate
4. Identify any recent changes that might affect the plan

## Output Format

After completing the review, use the Bash tool to get the session-scoped artifact path:

```
~/.local/bin/review-gate artifact-path
```

Then use the Write tool to save the review to that path with this structure:

```markdown
<!-- review-type: plan -->

# Plan Review

## Summary
<1-2 sentence overview of the plan and its scope>

## Plan Analyzed
- Source: <file path from ~/.claude/plans/ or custom path>
- Goal: <what the plan aims to accomplish>
- Scope: <files/modules affected>

## Method
- Plan sections reviewed: <list main sections>
- Codebase files verified: <list key files checked>
- Assumptions validated: <list key assumptions tested>

## Issues

### [Critical] <title>
**Section**: <plan section or step number>
**Problem**: What's wrong with this part of the plan
**Impact**: What would go wrong if implemented as-is
**Suggested Fix**: How to revise the plan

### [High] <title>
**Section**: <plan section>
**Problem**: ...
**Impact**: ...
**Suggested Fix**: ...

### [Medium] <title>
...

## Missing Elements
<List any important aspects the plan doesn't address>

## Verdict
<PASS if no Critical/High issues, otherwise NEEDS_WORK with summary of required changes>
```

## No Issues Found

If the plan is solid, output:

```markdown
<!-- review-type: plan -->

# Plan Review

## Summary
<overview>

## Plan Analyzed
- Source: <path>
- Goal: <goal>
- Scope: <scope>

## Method
<what was checked>

## Issues
No significant issues found. The plan is complete, correctly ordered, and accounts for edge cases.

## Verdict
PASS - Plan is ready for implementation.
```

## Triggers Review Gate

After writing, the Stop hook will spawn Codex/Gemini to validate your review against plan-specific criteria.
