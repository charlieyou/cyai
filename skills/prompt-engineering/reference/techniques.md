# Advanced Prompt Techniques

## Outcome-Focused Prompting

For GPT-5.5 and other strong reasoning or agentic models, default to a compact product contract:

```markdown
Outcome:
What good means:
Constraints:
How to verify:
Final response:
```

This is closer to an engineering ticket than a script. Name the target, success criteria, hard constraints, and verification signal; avoid prescribing the route unless the route itself matters.

Use detailed process instructions only when:
- The exact process is required by the product
- The model has repeatedly failed without them
- Compliance, auditability, or handoff requires visible intermediate artifacts

Otherwise, avoid generic scaffolding such as:
- "First inspect, then plan, then edit, then test"
- "Think step by step"
- "Always produce a detailed plan before answering"

Avoid response-ceremony scaffolding unless it is part of the product contract. Do not add detailed rules for progress updates, heading usage, prose-vs-bullets, or final-answer choreography when a concise final-response expectation is enough.

Prefer model configuration and harness design over prompt repetition:
- Set reasoning level instead of saying "think harder".
- Use `text.verbosity` when available instead of adding many output-length rules.
- Put durable repository rules in guidance files.
- Put tool-use mechanics in tool descriptions.

## Structured Reasoning

Do not ask for hidden chain-of-thought. Add visible reasoning artifacts only when they help the user evaluate the answer, support handoff, or fix an observed failure.

When useful, prefer:
- **Short rationale**: "Explain the decision in 2-4 bullets."
- **Decision criteria**: "State the factors you considered."
- **Assumptions**: "List any assumptions that materially affect the answer."

Avoid generic requirements like "think step by step" or "show your full reasoning."

## Few-Shot Examples

- Examples are optional. Use them when behavior is ambiguous, format-sensitive, subjective, or repeatedly failing. Do not add examples merely to satisfy a template.
- Show diverse input/output pairs demonstrating desired behavior
- Examples convey patterns better than descriptions
- Ensure examples align with behaviors you want (avoid contradictions)
- For classification: include one example per category

## Grounding to Context

Constrain the model to provided information:
```
Answer ONLY based on the provided context.
If the answer is not explicitly stated, respond: "Information not available in the provided context."
Do not use external knowledge.
```

## Verification Guidance

Verification should scale to risk and blast radius.

- Read-only explanation: no verification needed.
- Simple rewrite or copy edit: quick self-check is enough.
- Local code/config change: run or recommend focused checks.
- Shared, cross-module, or high-risk change: use broader tests.

Avoid prompting for broad verification when the agent harness or repo guidance already handles it.
Avoid prompting for verification on read-only analysis unless verification evidence is part of the requested deliverable.

## Prefilling (Claude-specific)

Start the assistant's response to guide format:
```
Human: Extract the data as JSON.
Assistant: {
  "
```

## XML Tags for Structure (Claude-preferred)

```xml
<context>
[Background information]
</context>

<instructions>
[What to do]
</instructions>

<examples>
[Input/output pairs]
</examples>
```

## Output Schemas

Use an exact schema only when the output is consumed programmatically or format drift is a known failure. If the user only needs readable prose, prefer a simple final-response shape instead.

Example:
```
Return your response as JSON with this schema:
{
  "summary": "string (max 100 words)",
  "confidence": "high|medium|low",
  "sources": ["array of references"]
}
```

## Handling Ambiguity

Specify behavior for unclear inputs:
```
If the request is ambiguous:
1. State your interpretation
2. Ask one clarifying question
3. Do not guess or make assumptions about [critical field]
```

Ask a clarifying question only when the missing information would materially change the output. Otherwise, state a reasonable assumption and proceed.
