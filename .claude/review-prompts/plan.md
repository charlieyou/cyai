## Evaluation Criteria (Plan Review)

Review this plan review artifact for:

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

## Red Flags to Check

- Plan references files/functions that don't exist
- Steps that would overwrite or break existing functionality
- Missing migrations, config changes, or environment setup
- Circular dependencies between steps
- No rollback or failure recovery strategy for risky changes
- Assumptions about codebase state that weren't verified

## Verdict Guidelines

- **PASS**: Review thoroughly analyzed the plan, verified against codebase, no Critical/High issues remain
- **NEEDS_WORK**: Review missed significant issues, or flagged issues lack evidence/fixes
- **FAIL**: Review is superficial, missed obvious problems, or contains incorrect analysis

Focus on whether this review would catch problems before implementation begins.
