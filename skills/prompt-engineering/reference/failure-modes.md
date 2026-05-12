# Common Failure Modes and Fixes

Default to the smallest fix that preserves the product contract. Do not add schemas, examples, citations, or process steps unless they address the specific failure.

## Prompt Issues

| Problem | Diagnosis | Fix |
|---------|-----------|-----|
| Too verbose output | No length constraint or verbosity setting | Prefer `text.verbosity` when available; otherwise add one concise length expectation |
| Ignores instructions | Critical constraint is buried, vague, or contradicted | Make the constraint prominent and concrete; repeat only in long prompts or after observed failures |
| Hallucinations | No source boundary | Add a clear source boundary, such as "use only the provided context." Require citations only when evidence traceability matters. |
| Wrong format | Output contract is vague or underspecified | Make the expected output contract explicit. Use a schema when the output is programmatic or format drift is a known failure; add a short example only if instructions alone are insufficient. |
| Inconsistent results | Ambiguous instructions | Tighten the success criteria first; add few-shot examples only if ambiguity remains or failures recur. |
| Over-literal interpretation | Missing context on intent | Explain the WHY behind instructions |
| Generic/bland output | No specificity guidance | Provide concrete success criteria or style constraints; add a short exemplar only if needed. |
| Misses edge cases | No error handling | Add "If X, then Y" instructions |
| Over-scaffolded prompt | Prompt dictates generic process: inspect, plan, edit, test, summarize | Replace with outcome, what good means, constraints, verification |
| Task expansion | Prompt tells model to read all guidance or satisfy every possible rule | Say to apply only relevant guidance; treat files/skills as constraints and shortcuts |
| Over-verification | Prompt requires broad tests/checks for low-risk work | Scale verification to risk/blast radius; skip for read-only tasks |
| Schema bloat | Exact JSON/schema required when user only needs prose | Use schema only when format is consumed downstream or drift is a known failure |
| Example bloat | Examples included for simple tasks | Add examples only for ambiguity, subjective judgment, or known failures |
| Response-ceremony bloat | Prompt over-specifies updates, headings, bullet counts, or final-answer rituals | Replace with concise final-response expectations |
| Wrong reasoning level | `high` used as default for GPT-5.5 | Use `medium` by default, `low` for narrow cheap checks, `xhigh` for maximum quality |
| Length-control bloat | Prompt repeats detailed output-length and style instructions | Use `text.verbosity` or one concise final-response expectation when available |
| Prompt-cache misconfiguration | GPT-5.5 configured with in-memory prompt caching | Use extended prompt caching instead; do not request in-memory caching for GPT-5.5 |

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
