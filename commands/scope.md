---
description: Interview the user to transform a vague feature idea into a detailed spec
argument-hint: <feature description>
---

# Feature Scoping Interview

Transform a vague feature request into a comprehensive specification through codebase research and targeted interviewing.

## Input

The user provides a brief feature description inline, e.g.:
- "add user authentication"
- "batch export functionality"
- "undo/redo for the editor"

## Process

### Phase 1: Codebase Research

Before asking any questions, deeply understand the existing codebase:

1. **Identify relevant areas**: Use Glob and Grep to find files, patterns, and conventions related to the feature
2. **Understand architecture**: How is the codebase structured? What patterns are used?
3. **Find integration points**: Where would this feature connect to existing code?
4. **Note existing conventions**: Naming, file organization, testing patterns, error handling
5. **Identify constraints**: Dependencies, tech stack limitations, existing abstractions

Document findings internally—these inform your questions and the final spec.

### Phase 2: Strategic Interviewing

Use the AskUserQuestion tool to conduct the interview. Ask questions that:
- You couldn't answer from reading the codebase
- Reveal unstated assumptions or preferences
- Uncover edge cases and error scenarios
- Clarify scope boundaries (what's explicitly NOT included)
- Surface integration concerns with existing systems

**Question Categories** (cover all, but adapt order based on context):

#### Scope & Boundaries
- What's the MVP vs. nice-to-have?
- What's explicitly out of scope?
- Are there related features that should be excluded?

#### User Experience
- Who uses this and in what context?
- What's the primary workflow/happy path?
- What feedback does the user need? (loading states, confirmations, errors)
- Are there accessibility requirements?

#### Technical Implementation
- Preferences on specific libraries, patterns, or approaches?
- Performance requirements or constraints?
- Data storage/persistence needs?
- API design preferences (if applicable)?

#### Edge Cases & Error Handling
- What happens when X fails?
- How should conflicts/race conditions be handled?
- What are the validation rules?
- Recovery and retry behavior?

#### Integration & Dependencies
- How does this interact with [existing system you found]?
- Does this affect [related feature you discovered]?
- Any migration or backwards compatibility concerns?

#### Testing & Validation
- How should this be tested?
- What constitutes "done"?
- Any specific acceptance criteria?

**Interview Guidelines**:
- Ask 2-4 questions at a time (use multiSelect when appropriate)
- Reference specific code you found: "I see you use X pattern in Y—should this follow the same approach?"
- Propose concrete options with tradeoffs rather than open-ended questions
- Skip obvious questions—leverage what you learned from the codebase
- If the user says "you decide" or similar, make a sensible choice and note it
- Continue until you have enough detail to write a complete implementation plan

### Phase 3: Spec Generation

When the interview is complete, write a comprehensive spec to a file.

**File location**: Ask the user where to save, or default to `docs/YYYY-MM-DD-FEATURE_NAME-spec.md` (using current date)

**Spec Structure**:

```markdown
# [Feature Name]

## Overview
[2-3 sentence summary of what this feature does and why]

## Goals
- [Primary objective]
- [Secondary objectives]

## Non-Goals (Out of Scope)
- [Explicitly excluded functionality]

## User Stories
- As a [user type], I want to [action] so that [benefit]

## Technical Design

### Architecture
[How this fits into the existing codebase, referencing specific files/patterns]

### Key Components
- [Component 1]: [purpose and responsibility]
- [Component 2]: [purpose and responsibility]

### Data Model
[If applicable: schemas, types, storage]

### API Design
[If applicable: endpoints, request/response formats]

## User Experience

### Primary Flow
1. [Step 1]
2. [Step 2]
3. [Step 3]

### Error States
- [Error scenario]: [How it's handled and displayed]

### Edge Cases
- [Edge case]: [Behavior]

## Implementation Plan
[Ordered list of implementation steps, referencing specific files to create/modify]

1. [ ] [First task]
2. [ ] [Second task]
3. [ ] [Third task]

## Testing Strategy
- [Unit tests]: [What to test]
- [Integration tests]: [What to test]
- [Manual testing]: [Scenarios to verify]

## Open Questions
[Any unresolved decisions or areas needing further clarification]

## Decisions Made
[Key decisions from the interview, with brief rationale]
- [Decision 1]: [Choice made] — [why]
```

### Phase 4: Multi-Model Review

After writing the initial spec, spawn the review gate to get feedback from external reviewers (Codex, Gemini, Claude):

```bash
~/.local/bin/review-gate spawn-spec-review [spec-path]
```

The review gate will:
1. Send the spec to multiple AI reviewers in parallel
2. Each reviewer evaluates for completeness, correctness, ordering, edge cases, and breaking changes
3. Block until all reviewers agree (unanimous PASS)

**If reviewers find issues:**
- Review the feedback carefully
- Revise the spec file to address each issue
- Re-run `~/.local/bin/review-gate spawn-spec-review [spec-path]` to trigger re-review
- Continue iterating until all reviewers pass (max 5 iterations)

**Review criteria applied:**
- Clarity of goals: Is it clear what problem this solves?
- Scope definition: Are boundaries and non-goals explicit?
- Technical feasibility: Are proposed components realistic?
- Implementation completeness: Are all steps covered?
- Edge case coverage: Are error paths addressed?
- Testability: Can success be verified?
- Actionability: Could a developer implement without clarification?

### Phase 5: Confirmation

After reviewers pass:
1. Summarize the final spec
2. Note any revisions made during review
3. Highlight remaining open questions
4. Offer to proceed to implementation or refine further
