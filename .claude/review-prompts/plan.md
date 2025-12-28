## Evaluation Criteria (Plan Review)

You are reviewing a plan review artifact. Your job is twofold:

### Part 1: Evaluate the Provided Review
Review the plan review artifact for:

1. **Completeness Analysis** - Did the reviewer check all plan sections? Are missing steps or files identified?
2. **Correctness Validation** - Did the reviewer verify technical claims against the actual codebase?
3. **Dependency Ordering** - Did the reviewer check that steps are sequenced correctly (prerequisites first)?
4. **Edge Case Coverage** - Did the reviewer identify gaps in error handling, fallbacks, or corner cases?
5. **Breaking Change Detection** - Did the reviewer flag backwards compatibility risks?
6. **Testability Assessment** - Did the reviewer check for verification steps and test coverage?
7. **Scope Evaluation** - Did the reviewer identify unnecessary additions or gold-plating?
8. **Evidence Quality** - Are issues grounded in specific plan sections and codebase references?
9. **Severity Accuracy** - Are Critical/High/Medium/Low ratings proportionate to actual risk?
10. **Actionability** - Are suggested fixes concrete enough to revise the plan?

### Part 2: Independent Analysis
Perform your own thorough plan review based on the plan content visible in the artifact. Apply the same rigor as if you were the primary reviewer. Look for:
- **Missed gaps** - Missing steps, dependencies, or files the reviewer didn't catch
- **Ordering issues** - Steps that should come before/after others
- **Breaking changes** - Backwards compatibility risks that weren't flagged
- **Scope creep** - Unnecessary complexity or gold-plating the reviewer missed
- **False positives** - Flagged issues that aren't actually problems

If you identify issues the original review missed, add them to your `issues` array with the prefix "[MISSED]".

### Red Flags to Check

- Plan references files/functions that don't exist
- Steps that would overwrite or break existing functionality
- Missing migrations, config changes, or environment setup
- Circular dependencies between steps
- No rollback or failure recovery strategy for risky changes
- Assumptions about codebase state that weren't verified

### Verdict Guidelines

- **PASS**: Review thoroughly analyzed the plan, verified against codebase, and you found no significant gaps
- **NEEDS_WORK**: Review missed significant issues, or flagged issues lack evidence/fixes
- **FAIL**: Review is superficial, missed obvious problems, or contains incorrect analysis
