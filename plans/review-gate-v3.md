# Review Gate v3 - Unified Plan

## Overview

Three review capabilities sharing common infrastructure:

| Capability | Status | Flow | What Claude Iterates On |
|------------|--------|------|-------------------------|
| **Generator Pipeline** | ✅ DONE | Generators → Synthesis → Review | Artifact |
| **Code Review Iterative** | ✅ DONE | Reviewers → Feedback → Fix | Code files |
| **Plan Review Iterative** | ✅ DONE | Reviewers → Feedback → Fix | Plan file |

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SHARED INFRASTRUCTURE                            │
│  bin/review-gate: spawning, polling, consensus, archiving, stop hook    │
└─────────────────────────────────────────────────────────────────────────┘
         │                           │                           │
         ▼                           ▼                           ▼
┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
│ GENERATOR PIPELINE│   │ CODE REVIEW       │   │ PLAN REVIEW       │
│ ✅ DONE           │   │ ✅ DONE           │   │ ✅ DONE           │
│ /healthcheck      │   │ /code-review      │   │ /plan-review      │
├───────────────────┤   ├───────────────────┤   ├───────────────────┤
│ Generators create │   │ Reviewers see     │   │ Reviewers see     │
│ drafts, Claude    │   │ git diff, Claude  │   │ plan file, Claude │
│ synthesizes       │   │ fixes code        │   │ fixes plan        │
└───────────────────┘   └───────────────────┘   └───────────────────┘
```

---

## Part 1: Generator Pipeline (✅ DONE)

### Design Decisions

| Decision | Choice |
|----------|--------|
| Generator pool | Codex + Gemini + Claude (hardcoded) |
| Output format | Free-form analysis, no constraints |
| Length limits | None - generators go as deep as needed |
| Context access | Generators search repo themselves |
| Prompts | Same core prompt with model-specific wrappers |
| Failure handling | Retry once, then continue with partial drafts |
| Min drafts required | Configurable via `MIN_DRAFTS`, default 1 |
| Synthesis model | Same as main Claude Code session |
| Draft attribution | Anonymous to Claude (model name in metadata only) |
| Conflict resolution | Claude picks a side using judgment |
| Logging | Structured JSON to filesystem |
| Draft versioning | Archive per iteration in numbered directories |
| Fix iterations | Claude edits directly (no re-generation) |
| Pool overlap | Allowed - same model can generate and review |

### Implementation

**Subcommand:** `review-gate generate --type=<healthcheck|architecture-review>`
- Spawns Codex + Gemini in parallel
- Waits for drafts with timeout
- Outputs anonymous drafts to stdout for Claude to synthesize

**Templates:** `.claude/generator-prompts/*.md`
- Free-form analysis prompts
- No format constraints

---

## Part 2: Code Review Iterative (✅ DONE)

### Goal
External reviewers evaluate code diff directly. Claude fixes code until unanimous pass.

### Design Decisions

| Decision | Choice |
|----------|--------|
| Conflicts | Claude picks a side |
| Re-review scope | Full re-review each iteration |
| Review memory | Reviewers see previous iteration feedback |
| Pass criteria | Unanimous pass required |
| Default scope | Explicit git changeset args required |
| Fix scope | Allow nearby fixes |
| Max iterations | User gate (show remaining, ask to proceed) |
| Tests | No auto-test |
| Specialization | Generalist pool (all review everything) |
| Commit timing | Commit on pass only |
| Visibility | Context-efficient (FS logs, minimal to Claude) |
| Feedback format | Free-form prose |
| Regressions | Reviewers catch it via full re-review |
| File boundaries | Allow related files if needed for fix |
| Suggestions | Claude decides whether to act |
| Review focus | Correctness first |
| Reviewer identity | Anonymous to Claude |
| Scope drift | Float with fixes (reviewers see current diff) |
| Inline prompt | Augments default criteria (post-MVP) |
| Historical commits | Fixup commits (post-MVP) |

### Implementation

#### 1. New subcommand: `review-gate spawn-code-review`

```bash
review_gate_spawn_code_review() {
    local diff_mode="${1:---uncommitted}"

    case "$diff_mode" in
        --uncommitted) DIFF=$(git diff && git diff --cached) ;;
        --base) DIFF=$(git diff "${2}"...HEAD) ;;
        --commit) DIFF=$(git show "${2}") ;;
        *) DIFF=$(git diff "$diff_mode") ;;
    esac

    # Build prompt with diff
    PROMPT="# Code Review
Review for correctness, security, error handling.

\`\`\`diff
$DIFF
\`\`\`

JSON output: {verdict, issues[], summary}"

    # Spawn reviewers, store diff_mode in state for re-spawn
    # trigger_source = "code-review-iterative"
}
```

#### 2. Modify `check` for iterative triggers

```bash
if [[ "$TRIGGER_SOURCE" == "code-review-iterative" ]]; then
    # Re-spawn regenerates fresh diff
    # Message tells Claude to fix code, not artifact
fi
```

#### 3. Updated command: `commands/code-review.md`

```markdown
---
description: Iterative code review with external reviewers
argument-hint: [--uncommitted | --base <branch> | --commit <sha> | <range>]
---

Run: review-gate spawn-code-review $ARGUMENTS
Fix issues in code until all reviewers pass.
```

---

## Part 3: Plan Review Iterative (✅ DONE)

### Goal
External reviewers evaluate plan file directly. Claude fixes plan until unanimous pass.

### Design Decisions

Same as Code Review Iterative, except:
| Decision | Choice |
|----------|--------|
| Default scope | Session plan or explicit path |
| Fix scope | Only the plan file |

### Implementation

#### 1. New subcommand: `review-gate spawn-plan-review`

```bash
review_gate_spawn_plan_review() {
    local plan_path="${1:-}"

    # Find session plan if not specified
    [[ -z "$plan_path" ]] && plan_path=$(ls -t ~/.claude/plans/*.md | head -1)

    PLAN_CONTENT=$(cat "$plan_path")

    PROMPT="# Plan Review
Completeness, correctness, ordering, edge cases.

\`\`\`markdown
$PLAN_CONTENT
\`\`\`

JSON output: {verdict, issues[], summary}"

    # Spawn reviewers, store plan_path in state
    # trigger_source = "plan-review-iterative"
}
```

#### 2. Modify `check` for plan triggers

```bash
if [[ "$TRIGGER_SOURCE" == "plan-review-iterative" ]]; then
    # Re-spawn re-reads plan file
    # Message tells Claude to fix plan at $PATH
fi
```

#### 3. New command: `commands/plan-review.md`

```markdown
---
description: Iterative plan review with external reviewers
argument-hint: [path/to/plan.md | --list]
---

Run: review-gate spawn-plan-review <plan-path>
Fix issues in plan until all reviewers pass.
```

---

## File Changes Summary

| File | Change |
|------|--------|
| `bin/review-gate` | Add `spawn-code-review` subcommand (~80 lines) |
| `bin/review-gate` | Add `spawn-plan-review` subcommand (~60 lines) |
| `bin/review-gate` | Modify `check` for iterative triggers (~30 lines) |
| `commands/code-review.md` | Updated for iterative flow |
| `commands/plan-review.md` | New command |

---

## State Structure

```json
{
  "version": 1,
  "status": "pending|awaiting_decision|resolved",
  "trigger_source": "healthcheck|code-review-iterative|plan-review-iterative",
  "mode": {
    "type": "artifact|code-diff|plan",
    "diff_args": "--base main",
    "plan_path": "/path/to/plan.md"
  },
  "reviewers": { ... },
  "consensus": { ... }
}
```

---

## Implementation Order

### Phase 1: Shared Infrastructure
1. Add `mode` field to state structure
2. Modify `check` to detect iterative triggers and:
   - Format different messages (fix code vs fix plan vs fix artifact)
   - Re-spawn with fresh content (re-read diff or plan)

### Phase 2: Code Review Iterative
1. Add `spawn-code-review` subcommand
2. Update `code-review.md` command
3. Test end-to-end

### Phase 3: Plan Review Iterative
1. Add `spawn-plan-review` subcommand
2. Create `plan-review.md` command
3. Test end-to-end
