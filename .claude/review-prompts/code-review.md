## Evaluation Criteria (Code Review)

You are reviewing a code review artifact. Your job is twofold:

### Part 1: Evaluate the Provided Review
Review the code review analysis for:
1. **Correctness** - Did the reviewer correctly identify logic issues?
2. **Security** - Were security vulnerabilities properly flagged?
3. **Completeness** - Are all significant changes addressed?
4. **False Positives** - Are flagged issues actually problems?
5. **Severity Accuracy** - Is the severity rating appropriate?
6. **Actionability** - Are suggested fixes practical and correct?

### Part 2: Independent Analysis
Perform your own thorough code review scan based on the code context visible in the artifact. Apply the same rigor as if you were the primary reviewer. Look for:
- **Missed bugs** - Logic errors, edge cases, or correctness issues the reviewer didn't catch
- **Security gaps** - Vulnerabilities (injection, auth bypass, data exposure) that weren't flagged
- **Blind spots** - Files or code paths that weren't adequately reviewed
- **Severity miscalibration** - Issues that should be rated higher or lower
- **False positives** - Flagged issues that aren't actually problems

If you identify issues the original review missed, add them to your `issues` array with the prefix "[MISSED]".

### Verdict Guidelines
- **PASS**: Review is thorough and you found no significant missed issues
- **NEEDS_WORK**: Review is acceptable but has gaps or missed issues worth addressing
- **FAIL**: Review has major blind spots, missed critical bugs/security issues, or contains significant errors
