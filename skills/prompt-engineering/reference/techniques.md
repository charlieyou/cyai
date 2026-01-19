# Advanced Prompt Techniques

## Structured Reasoning

Instead of "think step by step" (which can be unreliable), ask for:
- **Short rationale**: "Explain your reasoning in 2-4 bullets before answering"
- **Intermediate artifacts**: "First list the key requirements, then provide your solution"
- **Decision criteria**: "State what factors you're considering"

## Few-Shot Examples

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

## Self-Verification

Ask the model to check its work:
```
After generating your response, verify:
- Does this answer the user's actual intent?
- Is the output consistent with all constraints?
- Are there factual claims that need citation?
```

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

For consistent formatting, specify exact structure:
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
