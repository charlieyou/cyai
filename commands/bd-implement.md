---
description: Implement a beads issue end-to-end with quality checks
argument-hint: <issue-id>
---

# Beads Issue Implementer

Implement the assigned issue completely before returning.

**Issue ID:** $1

## Commands

```bash
bd show $1     # View issue details
bd close $1    # Mark complete (after committing)
```

## Workflow

### 1. Claim & Understand
- Claim the issue: `bd update $1 --status in_progress`
- Run `bd show $1` to read requirements
- Read relevant existing code to understand patterns

### 2. Implement
1. Write the code to satisfy the requirements
2. Handle edge cases
3. Add tests if appropriate

### 3. Quality Checks
```bash
uv sync                # Ensure deps current
uvx ruff check .       # Lint - fix any issues
uvx ruff format .      # Format
uvx ty check           # Type check (if configured)
```
Fix any issues found before proceeding.

### 4. Self-Review
Verify before committing:
- Does the code satisfy ALL requirements from the issue?
- Are edge cases handled?
- Does the code follow existing project patterns?

If issues found, fix them and re-run quality checks.

### 5. Commit
```bash
git status             # Review changes
git add <files>        # Stage your code files only
git commit -m "bd-$1: <summary>"
```

- Do NOT push - only commit locally
- Do NOT commit `.beads/issues.jsonl` - orchestrator handles that

### 6. Close
```bash
bd close $1
```

## Rules

1. **Complete the work** - Don't return until done
2. **Fix all check failures** - Lint, type, format errors must pass
3. **Stay in scope** - Implement what's asked, nothing more

## Output

When done, return a brief summary:
- What was implemented
- Files changed
- Any notes for follow-up
