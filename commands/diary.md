---
description: Create a structured diary entry from the current session transcript
---

# Create Diary Entry from Current Session

You are going to create a structured diary entry that documents what happened in the current session. This entry will be used later for reflection and pattern identification.

## Approach: Context-First Strategy

**Primary Method (use this first):**
Reflect on the conversation history loaded in this session. You have access to:

- All user messages and requests
- Your responses and tool invocations
- Files you read, edited, or wrote
- Errors encountered and solutions applied
- Design decisions discussed
- User preferences expressed

**When to use JSONL fallback (rare):**

- Session was compacted and context is incomplete
- You need precise statistics (exact tool counts, timestamps)
- User specifically requests detailed session analysis

## Steps to Follow

### 1. Create Diary Entry from Context (Primary Method)

Review the current conversation and create a diary entry based on what happened. No tool invocations needed for typical sessions.

### 2. Create the Diary Entry

Based on the conversation context (and optional metadata from Step 3), create a structured markdown diary entry with these sections:

```markdown
# Session Diary Entry

**Date**: [YYYY-MM-DD from timestamp]
**Time**: [HH:MM:SS from timestamp]
**Thread ID**: [amp thread ID]
**Project**: [project path]
**Git Branch**: [branch name if available]

## Task Summary

[2-3 sentences: What was the user trying to accomplish based on the user messages?]

## Work Summary

[Bullet list of what was accomplished:]

- Features implemented
- Bugs fixed
- Documentation added
- Tests written

## Design Decisions Made

[IMPORTANT: Document key technical decisions and WHY they were made:]

- Architectural choices (e.g., "Used React Context instead of Redux because...")
- Technology selections
- API design decisions
- Pattern selections

## Actions Taken

[Based on tool usage and file operations:]

- Files edited: [list paths from "FILES MODIFIED"]
- Commands executed: [from git operations]
- Tools used: [from tool usage counts]

## Code Review & PR Feedback

[CRITICAL: Capture any feedback about code quality or style:]

- PR comments mentioned
- Code quality feedback
- Linting issues
- Style preferences

## Challenges Encountered

[Based on errors and user corrections:]

- Errors encountered [from "ERRORS" section]
- Failed approaches
- Debugging steps

## Solutions Applied

[How problems were resolved]

## User Preferences Observed

[CRITICAL: Document preferences for commits, testing, code style, etc.]

### Commit & PR Preferences:

- [Any patterns around commit messages, PR descriptions]

### Code Quality Preferences:

- [Testing requirements, linting preferences]

### Technical Preferences:

- [Libraries, patterns, frameworks preferred]

## Code Patterns and Decisions

[Technical patterns used]

## Context and Technologies

[Project type, languages, frameworks]

## Notes

[Any other observations]
```

### 3. Save the Diary Entry

Run this command to save the entry:

```bash
# Create directory if needed
mkdir -p .agents/config/diary && \
# Determine filename using thread ID
TODAY=$(date +%Y-%m-%d) && \
THREAD_ID="[thread-id]" && \
DIARY_FILE=.agents/config/diary/${TODAY}-${THREAD_ID}.md && \
echo "Saved to: $DIARY_FILE"
```

Replace `[thread-id]` with the current thread ID (visible in the thread URL or amp status).

Use the Write tool to actually write the diary content to the determined file path.

### 4. Confirm Completion

Display:

- Path where diary was saved
- Brief summary of what was captured

## Important Guidelines

- **Be factual and specific**: Include concrete details (file paths, error messages)
- **Capture the 'why'**: Explain reasoning behind decisions
- **Document ALL user preferences**: Especially around commits, PRs, linting, testing
- **Include failures**: What didn't work is valuable learning
- **Keep it structured**: Follow the template consistently
- **Use context first**: Only parse JSONL files when truly necessary
