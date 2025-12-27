---
description: Multi-model consensus review with user approval gate
argument-hint: <artifact-path>
---

# Review Gate

Run multi-model consensus review on an artifact. Three reviewers (Claude, Codex, Gemini) analyze the artifact in parallel, then present results for your decision.

## Usage

/review-gate path/to/artifact.md

## Workflow

### 1. Trigger Review

Use the Bash tool to run the spawn script:

```bash
~/.local/bin/review-gate-spawn "$ARGUMENTS"
```

### 2. Wait for Results

The Stop hook will automatically:
- Check reviewer completion
- Calculate consensus
- Present results table

### 3. Decide

Respond with one of:
- **PROCEED** - Continue to next stage
- **REVISE** - Address issues, re-run later
- **ABORT** - Stop the workflow

### 4. Resolve

After deciding, run:

```bash
~/.local/bin/review-gate-resolve <decision>
```
