---
description: Iterative plan review with external reviewers
argument-hint: [path/to/plan.md]
---

# Plan Review (Iterative)

Spawn external reviewers (Codex, Gemini) to evaluate a plan file directly. Fix issues until all reviewers pass.

## Usage

Run review-gate spawn-plan-review with the plan path (or use session plan if none provided):

```bash
review-gate spawn-plan-review $ARGUMENTS
```

If no path is provided, the most recent plan from `~/.claude/plans/` will be used.

**CRITICAL: After spawning the reviewers, you MUST stop immediately.** Do not wait, poll, sleep, or check status. Just stop. The stop hook will automatically:
1. Wait for all reviewers to complete
2. Present findings if any reviewer found issues
3. Block your stop until you fix the plan and reviews pass

## How It Works

1. External reviewers (Codex, Gemini) evaluate the plan for:
   - Completeness and correctness
   - Order of operations and dependencies
   - Edge cases and error handling
   - Breaking changes and testability

2. The Stop hook waits for reviewers and checks consensus:
   - If all reviewers PASS: You may proceed
   - If any reviewer finds issues: You must fix the plan and try again

3. Fix issues in the plan file based on reviewer feedback, then the review automatically re-runs.

## Review Criteria

Reviewers evaluate the plan for:

- **Completeness** - Does it cover all necessary changes?
- **Correctness** - Are the proposed modifications technically sound?
- **Order of Operations** - Are steps sequenced correctly (dependencies first)?
- **Edge Cases** - Are error paths, fallbacks, and corner cases addressed?
- **Breaking Changes** - Are backwards compatibility concerns identified?
- **Testability** - Can the implementation be verified?

## Iteration Loop

The iterative review continues until:
- All reviewers agree the plan passes (unanimous PASS)
- Maximum iterations (5) are reached
- You manually resolve with `review-gate resolve proceed` or `review-gate resolve abort`
