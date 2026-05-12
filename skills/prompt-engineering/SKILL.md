---
name: prompt-engineering
description: >
  Review, rewrite, and debug LLM prompts. Use when asked to: (1) improve an existing prompt,
  (2) design a new system or developer prompt, (3) add few-shot examples, (4) define output
  schemas and success criteria, (5) diagnose prompt failures from transcripts.
  Not for: model policy workarounds, producing domain answers without context, or guaranteeing
  model-specific behavior.
---

# Prompt Engineering

Improve LLM prompts through outcome-focused analysis and rewriting.

## When to Use

- User has a prompt that isn't working well
- User needs to create a new system/developer/user prompt
- User wants to add examples or output schemas
- User has failure transcripts to diagnose

## When NOT to Use

- User wants domain answers (not prompt help)
- Request involves policy circumvention
- User needs model comparison or selection advice

## Inputs to Gather

Use the context already provided first. Gather only what is needed to preserve the product contract.

Helpful inputs:
1. **Goal/outcome**: What should the prompt accomplish?
2. **Current prompt** (if improving existing) — read the file when the prompt lives in the workspace
3. **Failure examples**: What went wrong? (ask user or read logs when diagnosing failures)
4. **Constraints**: Length, format, tone, tools, sources, safety boundaries
5. **Target audience/user**: Who will use this prompt?

Do not over-read or expand the task. Use tools only when the missing artifact is necessary, such as a prompt file or failure transcript. If information is missing but not blocking, proceed with stated assumptions. Ask a clarifying question only when ambiguity would materially change the revised prompt.

## Workflow Checklist

Use only the parts needed for the request.

- Extract the product contract:
  - Outcome
  - What good means
  - Constraints and boundaries
  - How to verify, scaled to risk
  - Required final response shape
- For GPT-5.5 or similarly agentic models, bias toward an engineering-ticket prompt instead of a process script:
  - State the target and success criteria clearly, then let the model choose the path.
  - Keep harness behavior, tool behavior, and stable repo rules outside the task prompt when possible.
  - Prefer model/API controls for model behavior (`reasoning`, `text.verbosity`, structured outputs) over stuffing operational details into the prompt.
- Diagnose prompt failures:
  - Vague or conflicting objective ("help with", "optimize")
  - Missing context or source boundaries
  - Missing or excessive output format
  - Important constraints buried in the middle
  - Unnecessary process scaffolding
  - Over-reading or task expansion
  - Verification that is too weak or too broad
- Draft the smallest prompt that preserves the contract.
  - Avoid spelling out generic process such as "first inspect, then plan, then edit, then test" unless that process is required.
  - Put stable repo rules in `AGENTS.md` or guidance files when possible.
  - Put tool behavior in tool descriptions, not the task prompt.
  - Include examples only when they reduce ambiguity or demonstrate hard edge cases.
- Summarize what changed and why in diff-style or bullets.

## Default Prompt Shape

For strong reasoning or agentic models, prefer a compact engineering-ticket shape:

```markdown
## Outcome
[What the model should accomplish]

## What good means
[Observable success criteria]

## Constraints
[Hard limits: sources, tone, format, tools, safety, scope]

## Verification
[Task-specific checks, scaled to risk; omit if read-only or already covered by harness/repo guidance]

## Final response
[What the model should return]
```

This shape is especially appropriate for GPT-5.5. Do not add generic instructions like "inspect first, make a plan, run tests, then summarize" unless the exact process is part of the product contract. For agent prompts, keep progress-update and final-answer rules short: commentary updates when something changes the user's understanding; final answers are concise reports.

Add role, detailed guidelines, examples, or a step-by-step process only when they preserve the contract or fix an observed failure:

```markdown
## Role
[Specific identity and responsibilities, if it materially changes behavior]

## Guidelines
- [Explicit instruction with success criteria]
- [Constraints and boundaries]

## Examples
<example>
Input: [sample]
Output: [desired result]
</example>

## Task
[The actual request with output format]
```

## Success Criteria for Rewritten Prompts

The revised prompt should include:
- [ ] Clear outcome or task description (no vague verbs)
- [ ] Definition of good output or success
- [ ] Relevant constraints and boundaries
- [ ] Expected final response shape
- [ ] Ambiguity handling when missing information would change the answer
- [ ] Verification guidance scaled to risk, if the task requires verification

Include only when useful:
- [ ] Role/identity statement, if it materially changes behavior
- [ ] Exact output schema, if the output is consumed programmatically or format drift is a known failure
- [ ] Few-shot examples, for non-trivial, ambiguous, subjective, or repeatedly failing behavior
- [ ] Step-by-step process, only when the process is part of the product contract

Prefer configuration over prompt text when configuration is available:
- [ ] Use reasoning level/model setting instead of prompting "think harder".
- [ ] Use `text.verbosity` for length/detail control instead of repeated verbosity instructions.
- [ ] Use structured outputs or an exact schema only when an exact response shape is required.
- [ ] Use tool descriptions and guidance files instead of duplicating tool/repo rules in each task prompt.

## Test Cases

Scale test cases to risk:
- Read-only explanation or advice: no verification required unless the user asks for it.
- Low-risk prompt rewrite or copy edit: quick self-check against success criteria is enough.
- Normal prompt revision: provide or run 1 normal case and 1 edge case when useful.
- High-risk or production prompt: include normal, edge, adversarial, and out-of-scope cases.

## Reference Files

For detailed guidance, see:
- `reference/techniques.md` - Advanced techniques (outcome-focused prompting, reasoning artifacts, grounding)
- `reference/model-notes.md` - Model-specific considerations
- `reference/failure-modes.md` - Common problems and solutions
