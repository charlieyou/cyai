# Common Failure Modes and Fixes

## Prompt Issues

| Problem | Diagnosis | Fix |
|---------|-----------|-----|
| Too verbose output | No length constraint | Add "Be concise" or word/sentence limits |
| Ignores instructions | Buried in middle of prompt | Move critical instructions to beginning AND end |
| Hallucinations | No grounding constraint | Add "Only use provided context" + citation requirement |
| Wrong format | No format example | Provide explicit schema with example output |
| Inconsistent results | Ambiguous instructions | Add few-shot examples, be more specific |
| Over-literal interpretation | Missing context on intent | Explain the WHY behind instructions |
| Generic/bland output | No specificity guidance | Provide concrete alternatives and style examples |
| Misses edge cases | No error handling | Add "If X, then Y" instructions |

## Vague Verbs to Replace

These verbs are ambiguous—replace with specific actions:

| Vague | Better |
|-------|--------|
| "Handle" | "Validate and return error message if invalid" |
| "Optimize" | "Reduce to under 100 words while preserving key points" |
| "Process" | "Extract the date, amount, and vendor name" |
| "Improve" | "Fix grammar errors and improve clarity" |
| "Help with" | "Generate 3 options for..." |

## Structural Problems

**Missing output format**
- Bad: "Analyze this data"
- Good: "Analyze this data and return: 1) Summary (2 sentences), 2) Key findings (bullet list), 3) Recommended action"

**Assumed context**
- Bad: "Use our standard format"
- Good: "Format as: [Header] - [Date] - [Summary in 50 words]"

**Contradictory instructions**
- Bad: "Be concise but thorough"
- Good: "Provide a thorough analysis in under 200 words"

## Testing Your Prompt

Before deploying, test with:
1. **Normal input**: Does it produce expected output?
2. **Edge case**: Missing fields, unusual format—does it handle gracefully?
3. **Adversarial**: Input that tries to break the format—does it stay on track?
4. **Out-of-scope**: Request outside the prompt's purpose—does it refuse appropriately?
