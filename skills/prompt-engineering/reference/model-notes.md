# Model-Specific Notes

These are general observations that may change as models evolve. Test with your specific use case.

## Claude (Anthropic)

- Responds well to XML tags for structure (`<context>`, `<instructions>`, `<examples>`)
- Supports prefilling assistant responses to guide format
- Place important instructions at both beginning AND end of long prompts
- Highly steerable with explicit instructions

## GPT Models (OpenAI)

- Use message roles effectively (system, user, assistant)
- Supports structured outputs (JSON mode) for consistent formatting
- Older GPT-style prompts sometimes benefited from explicit, detailed instructions with full logic; newer reasoning and agentic models generally perform better with concise outcome-focused instructions
- Reasoning models (o1, GPT-5.5, etc.): give high-level goals, success criteria, constraints, and verification expectations with less micromanagement

### GPT-5.5

GPT-5.5 is strongly agentic and works best with prompts that read like concise engineering tickets. Give it a concrete target and a way to verify success, then let it choose the path unless the path is the product:

```markdown
Outcome.
What good means.
Constraints.
How to verify.
Final answer expectations.
```

Guidance:
- Start with the smallest prompt that preserves the product contract.
- Prefer outcome-focused prompting over process-focused prompting.
- Avoid spelling out generic process such as "first inspect, then plan, then edit, then test" unless that exact process matters.
- Put repo rules in `AGENTS.md` or guidance files.
- Put tool behavior in tool descriptions.
- Treat skills and guidance files as constraints and shortcuts, not invitations to expand the task.
- Keep agent communication rules short; for example, commentary updates only when something changes the user's understanding, and final answers as concise reports.
- Use `text.verbosity` to control final-answer length when available instead of repeating detailed length choreography in prompts.
- Scale verification to risk and blast radius:
  - Read-only or explanation tasks usually need no verification.
  - Small localized edits need focused checks.
  - Shared or cross-module changes may need broader tests.

Reasoning levels:
- `low`: narrow, cheap-to-verify tasks.
- `medium`: default for normal deep work.
- `xhigh`: hard, ambiguous, or high-impact tasks where maximum quality matters more than cost and latency.
- Do not treat `high` as the safe default or normal escalation path; use `medium` by default and `xhigh` when quality justifies the cost.

Operational notes:
- Do not configure in-memory prompt caching for GPT-5.5; use extended prompt caching where appropriate.
- GPT-5.5 supports very large contexts, but large prompts can still increase cost and increase the chance of task expansion. Prefer compact prompts plus scoped context.

## Gemini (Google)

- Works well with both Markdown and XML formatting
- Effective with multimodal inputs (images, documents)
- Benefits from classifying input type (question, task, entity, completion)

## General Cross-Model Patterns

These tend to work across major models when they reduce ambiguity:
- Role/identity statements, when they materially change behavior
- Explicit output format, when format matters
- Few-shot examples for complex, subjective, format-sensitive, or repeatedly failing tasks
- Structured sections with headers
- Success criteria in the prompt
