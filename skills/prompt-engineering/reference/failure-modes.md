# Common Failure Modes and Fixes

## Prompt Issues

| Problem | Diagnosis | Fix |
|---------|-----------|-----|
| Too verbose output | No length constraint | Add "Be concise" or word/sentence limits |
| Ignores instructions | Critical constraint is buried, vague, or contradicted | Make the constraint prominent and concrete; repeat only in long prompts or after observed failures |
| Hallucinations | No grounding constraint | Add "Only use provided context" + citation requirement |
| Wrong format | No format example | Provide explicit schema with example output |
| Inconsistent results | Ambiguous instructions | Add few-shot examples, be more specific |
| Over-literal interpretation | Missing context on intent | Explain the WHY behind instructions |
| Generic/bland output | No specificity guidance | Provide concrete alternatives and style examples |
| Misses edge cases | No error handling | Add "If X, then Y" instructions |
| Over-scaffolded prompt | Prompt dictates generic process: inspect, plan, edit, test, summarize | Replace with outcome, what good means, constraints, verification |
| Task expansion | Prompt tells model to read all guidance or satisfy every possible rule | Say to apply only relevant guidance; treat files/skills as constraints and shortcuts |
| Over-verification | Prompt requires broad tests/checks for low-risk work | Scale verification to risk/blast radius; skip for read-only tasks |
| Schema bloat | Exact JSON/schema required when user only needs prose | Use schema only when format is consumed downstream or drift is a known failure |
| Example bloat | Examples included for simple tasks | Add examples only for ambiguity, subjective judgment, or known failures |
| Response-ceremony bloat | Prompt over-specifies updates, headings, bullet counts, or final-answer rituals | Replace with concise final-response expectations |
| Wrong reasoning level | `high` used as default for GPT-5.5 | Use `medium` by default, `low` for narrow cheap checks, `xhigh` for maximum quality |

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

Scale testing to risk:
1. **Read-only explanation or advice**: No verification required unless the user asks for it.
2. **Low-risk prompt rewrite or copy edit**: Quick self-check against success criteria is enough.
3. **Normal prompt revision**: Test 1 normal case and 1 edge case.
4. **High-risk or production prompt**: Test normal, edge, adversarial, and out-of-scope cases.
