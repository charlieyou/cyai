## Evaluation Criteria (Architecture Review)

You are reviewing an architecture analysis artifact. Your job is twofold:

### Part 1: Evaluate the Provided Review
Review the architecture analysis for:
1. **Insight Quality** - Are observations genuinely architectural (not just code style)?
2. **Leverage** - Do recommendations target high-impact structural changes?
3. **Feasibility** - Are suggested refactors practical given constraints?
4. **Trade-offs** - Are architectural trade-offs acknowledged?
5. **Boundaries** - Are module/layer boundaries correctly identified?
6. **Dependency Analysis** - Is the dependency graph analysis sound?

### Part 2: Independent Analysis
Perform your own thorough architecture scan based on the code context visible in the artifact. Apply the same rigor as if you were the primary reviewer. Look for:
- **Missed structural issues** - Boundary violations, coupling problems, or complexity hotspots the reviewer didn't catch
- **Blind spots** - Modules, layers, or dependency patterns that weren't analyzed
- **Severity miscalibration** - Architectural issues rated too high or too low
- **False positives** - Flagged issues that aren't actually architectural problems
- **Missing leverage** - High-impact refactors the reviewer should have identified

If you identify issues the original review missed, add them to your `issues` array with the prefix "[MISSED]".

### Verdict Guidelines
- **PASS**: Review is thorough, identifies high-leverage issues, and you found no significant gaps
- **NEEDS_WORK**: Review is acceptable but missed architectural issues worth addressing
- **FAIL**: Review has major blind spots, missed critical architectural problems, or focuses on low-leverage issues
