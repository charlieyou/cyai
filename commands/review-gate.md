---
description: Multi-model consensus review with user approval gate
argument-hint: <artifact-path>
---

# Review Gate (Autonomous Mode)

Run multi-model consensus review on an artifact. Two reviewers (Codex, Gemini) analyze the artifact in parallel. **The review loops automatically until all reviewers agree (PASS).**

## Usage

/review-gate path/to/artifact.md

## Autonomous Workflow

### 1. Trigger Review

Use the Bash tool to run the spawn script:

```bash
~/.local/bin/review-gate-spawn "$ARGUMENTS"
```

### 2. Automatic Review Loop

The Stop hook will automatically:
- Check reviewer completion
- If all reviewers PASS → auto-approve and proceed
- If not all PASS → present issues and request revision
- Clean state for re-review after you update the artifact

### 3. Revision Cycle

When reviewers don't all agree:
1. Review the issues presented from each reviewer
2. Update the session-scoped artifact (path from `review-gate-artifact-path`) to address the feedback
3. The review automatically re-runs (up to 5 iterations)

### 4. Completion

- **All reviewers PASS**: Auto-resolves and allows stop
- **Max iterations reached**: Falls back to manual decision

## Manual Override

If you need to force a decision after max iterations:

```bash
~/.local/bin/review-gate-resolve proceed  # Accept anyway
~/.local/bin/review-gate-resolve abort    # Discard
```
