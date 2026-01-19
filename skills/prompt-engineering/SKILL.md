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

Improve LLM prompts through structured analysis and rewriting.

## When to Use

- User has a prompt that isn't working well
- User needs to create a new system/developer/user prompt
- User wants to add examples or output schemas
- User has failure transcripts to diagnose

## When NOT to Use

- User wants domain answers (not prompt help)
- Request involves policy circumvention
- User needs model comparison or selection advice

## Required Inputs (Ask If Missing)

1. **Goal**: What should the prompt accomplish?
2. **Current prompt** (if improving existing)
3. **Failure examples**: What went wrong? (transcripts help)
4. **Constraints**: Length, format, tone, tools available
5. **Target audience**: Who will use this prompt?

## Workflow

### Step 1: Extract Requirements
- Identify the task type (classification, generation, analysis, agentic)
- List explicit constraints (format, length, tone)
- Note implicit requirements from context

### Step 2: Identify Failure Modes
Check for these common issues:
- Vague objective ("help with", "optimize")
- Missing output format specification
- No examples for ambiguous cases
- Important instructions buried in the middle
- Assumes context the model doesn't have

### Step 3: Draft Revised Prompt
Structure with clear sections:

```markdown
## Role
[Specific identity and responsibilities]

## Guidelines
- [Explicit instruction with success criteria]
- [Format requirements]
- [Constraints and boundaries]

## Examples
<example>
Input: [sample]
Output: [desired result]
</example>

## Task
[The actual request with output format]
```

### Step 4: Add Success Criteria
Include in the prompt:
- What good output looks like
- How to handle uncertainty ("If unclear, ask for...")
- Validation steps if applicable

### Step 5: Add Test Cases
Provide 2-4 scenarios:
- Normal case (should work perfectly)
- Edge case (incomplete input)
- Out-of-scope (should refuse gracefully)

### Step 6: Summarize Changes
Show what was changed and why in diff-style or bullet points.

## Success Criteria for Rewritten Prompts

The revised prompt MUST include:
- [ ] Clear role/identity statement
- [ ] Specific task description (no vague verbs)
- [ ] Output format/schema specification
- [ ] At least one example (for non-trivial tasks)
- [ ] Handling for ambiguous/missing inputs
- [ ] Constraints and boundaries

## Output Format

```
## Analysis
[Brief diagnosis of current prompt issues]

## Revised Prompt
[The improved prompt with sections]

## Test Cases
[2-4 scenarios to validate]

## Changes Summary
[What changed and why]
```

## Examples

### Bad Prompt
```
Help me analyze customer feedback and make it better.
```
Issues: Vague task, no format, no examples, unclear "better"

### Good Prompt
```
## Role
You are a customer feedback analyst for a SaaS product.

## Task
Analyze the customer feedback below and extract:
1. Primary sentiment (positive/negative/neutral)
2. Key issues mentioned (list up to 3)
3. Suggested action (1 sentence)

## Format
Return JSON:
{"sentiment": "...", "issues": [...], "action": "..."}

## Example
Input: "Love the product but the mobile app crashes constantly"
Output: {"sentiment": "mixed", "issues": ["mobile app stability"], "action": "Prioritize mobile app crash fixes"}

## Feedback to Analyze
{{feedback}}
```

## Reference Files

For detailed guidance, see:
- `reference/techniques.md` - Advanced techniques (CoT, prefilling, grounding)
- `reference/model-notes.md` - Model-specific considerations
- `reference/failure-modes.md` - Common problems and solutions
