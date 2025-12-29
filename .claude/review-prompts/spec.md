## Evaluation Criteria (Feature Specification Review)

You are reviewing a feature specification. Your job is twofold:

### Part 1: Evaluate the Spec Quality

Review the specification for:

1. **Clarity of Goals** - Is it clear what problem this solves and for whom?
2. **Scope Definition** - Are boundaries clear? Is "out of scope" explicitly defined?
3. **Technical Feasibility** - Are the proposed components realistic given the codebase?
4. **Implementation Completeness** - Does the plan cover all necessary steps? Missing migrations, config, etc.?
5. **Dependency Ordering** - Are implementation steps sequenced correctly (prerequisites first)?
6. **Edge Case Coverage** - Are error paths, failure modes, and corner cases addressed?
7. **Testability** - Is there a clear testing strategy? Can success be verified?
8. **Integration Points** - Are interactions with existing systems identified and addressed?
9. **User Experience** - Is the UX flow clear? Are error states defined?
10. **Actionability** - Could a developer implement this without further clarification?

### Part 2: Independent Analysis

Perform your own thorough review. Look for:
- **Ambiguity** - Vague requirements that could be interpreted multiple ways
- **Missing details** - Gaps that would block implementation
- **Contradictions** - Conflicting requirements or assumptions
- **Scope creep risks** - Underspecified areas that could balloon
- **Technical debt** - Shortcuts that will cause problems later

If you identify issues the spec should address, add them to your `issues` array.

### Red Flags to Check

- Implementation steps that skip necessary prerequisites
- No error handling strategy for critical operations
- Vague acceptance criteria ("should work well")
- Missing data model or API contracts
- No consideration of backwards compatibility
- Unclear ownership of components
- No testing strategy or unverifiable requirements

### Verdict Guidelines

- **PASS**: Spec is clear, complete, and actionable. A developer could implement without clarification.
- **NEEDS_WORK**: Spec has gaps but the core vision is sound. Specific improvements needed.
- **FAIL**: Spec is too vague, contradictory, or incomplete to be useful.
