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
- Benefits from explicit, detailed instructions with full logic
- Reasoning models (o1, etc.): give high-level goals, less micromanagement

## Gemini (Google)

- Works well with both Markdown and XML formatting
- Effective with multimodal inputs (images, documents)
- Benefits from classifying input type (question, task, entity, completion)

## General Cross-Model Patterns

These tend to work across all major models:
- Clear role/identity statements
- Explicit output format specifications
- Few-shot examples for complex tasks
- Structured sections with headers
- Success criteria in the prompt
