## Evaluation Criteria (Healthcheck)

You are reviewing a healthcheck artifact. Your job is twofold:

### Part 1: Evaluate the Provided Review
Review the healthcheck artifact for:
1. **Coverage** - Does it identify real issues across all categories (Dead Code, AI Smell, Structure, Correctness, Hygiene, Config Drift)?
2. **Accuracy** - Are the issues correctly categorized and prioritized by severity?
3. **Actionability** - Are fixes concrete and implementable?
4. **Proportionality** - Is severity appropriate (Critical/High/Medium/Low)?
5. **Completeness** - Are acceptance criteria testable?
6. **Evidence** - Are issues grounded in specific code references?

### Part 2: Independent Analysis
Perform your own thorough healthcheck scan based on the code context visible in the artifact. Apply the same rigor as if you were the primary reviewer. Look for:
- **Missed issues** - Problems the original reviewer should have caught but didn't
- **Blind spots** - Categories or file areas that weren't adequately covered
- **Severity miscalibration** - Issues that should be rated higher or lower
- **False positives** - Flagged issues that aren't actually problems

If you identify issues the original review missed, add them to your `issues` array with the prefix "[MISSED]".

### Verdict Guidelines
- **PASS**: Review is thorough and you found no significant missed issues
- **NEEDS_WORK**: Review is acceptable but has gaps or missed issues worth addressing
- **FAIL**: Review has major blind spots, missed critical issues, or contains significant errors
