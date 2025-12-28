---
description: Multi-model code review
argument-hint: [--uncommitted | --base <branch> | --commit <sha> | <range>]
---

# Code Review

Review code changes with multi-model consensus.

## Gather Changes

Based on $ARGUMENTS, run the appropriate git command:

| Argument | Command |
|----------|---------|
| `--uncommitted` | `git diff` (unstaged) + `git diff --cached` (staged) + `git ls-files --others --exclude-standard` (untracked) |
| `--base <branch>` | `git diff <branch>...HEAD` |
| `--commit <sha>` | `git show <sha>` |
| `<sha1>..<sha2>` | `git log --oneline <range>` + `git diff <range>` |
| (none) | Default to `--uncommitted` |

For `--uncommitted`, also show contents of untracked files if they exist.

## Review Criteria

Analyze the code changes for:

1. **Correctness** - Does the code do what it intends? Logic errors?
2. **Security** - Injection, auth bypass, data exposure, secrets in code?
3. **Performance** - Obvious inefficiencies, N+1 queries, memory leaks?
4. **Maintainability** - Readable? Well-structured? Appropriate abstractions?
5. **Testing** - Edge cases handled? Test coverage adequate?
6. **Breaking Changes** - API changes that could break consumers?
7. **Error Handling** - Failures handled gracefully?

Focus on substantive issues. Ignore style nitpicks unless they impact readability.

## Severity Definitions

- **Critical**: Would cause data loss, security breach, financial error, or crash in production
- **High**: Will cause bugs under realistic conditions, or blocks understanding
- **Medium**: Correct but hard to maintain or extend
- **Low**: Style, naming, minor inconsistency

## Output Format

After completing the review, use the Bash tool to get the session-scoped artifact path:

```
~/.local/bin/review-gate artifact-path
```

Then use the Write tool to save the review to that path with this structure:

```markdown
<!-- review-type: code-review -->

# Code Review

## Summary
<1-2 sentence overview of changes>

## Changes Reviewed
- Mode: <uncommitted/base/commit/range>
- Files changed: <count>

## Issues

### [Critical] <title>
**File**: path/to/file.py:123
**Category**: Security|Correctness|Performance|...
**Description**: What's wrong
**Suggested Fix**: How to fix it

### [High] <title>
...

### [Medium] <title>
...

## Verdict
<PASS if no Critical/High issues, otherwise NEEDS_WORK or FAIL>
```

## Triggers Review Gate

After writing, the Stop hook will spawn Codex/Gemini to validate your review.
