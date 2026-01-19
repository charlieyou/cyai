---
name: beads
description: >-
  Manages issues via the br CLI (beads), a local-first tracker stored in .beads/
  (SQLite + JSONL). Use when capturing issues, finding ready work, claiming issues,
  managing dependencies, or syncing changes. Triggers: "br", "beads", "issue tracking".
---

# br — Agent Issue Tracker

Local-first issue tracker. SQLite for queries, JSONL for git sync.

**br never runs git.** After `br sync --flush-only`, you must `git add .beads/ && git commit`.

---

## Quick Reference

```bash
br init                              # Initialize .beads/ (first time only)
br ready --json                      # Unblocked issues ready to work
br create "Title" -t task -p 1       # Create (P0=critical, P4=backlog)
br update bd-abc --claim             # Claim issue (sets in_progress + assignee)
br close bd-abc --reason "Done"      # Close with reason
br sync --flush-only                 # Export DB → JSONL
git add .beads/ && git commit        # You handle git
```

---

## Agent Workflow

### 1. Find Work
```bash
br ready --json --limit 5            # Unblocked, not deferred
```

### 2. Claim
```bash
br update bd-123 --claim --json      # Atomic: assignee + status=in_progress
```

### 3. Work
Create discovered issues:
```bash
br create "Found bug" -t bug -p 1 --deps "discovered-from:bd-123" --json
```

### 4. Complete
```bash
br close bd-123 --reason "Implemented" --json
br close bd-123 --suggest-next --json  # Returns newly unblocked issues
```

### 5. Sync (Session End)
```bash
br sync --flush-only
git add .beads/ && git commit -m "Update issues"
git push
```

**After git pull** (if JSONL conflicts, resolve manually first):
```bash
br sync --import-only   # Import remote changes to DB
```

---

## Essential Commands

| Command | Purpose |
|---------|---------|
| `br ready` | Unblocked issues ready to work |
| `br list [filters]` | Query issues |
| `br create "Title" [opts]` | Create issue |
| `br show <id>` | View details |
| `br update <id> [opts]` | Modify issue |
| `br close <id> --reason "..."` | Close issue |
| `br dep add <A> <B>` | A depends on B |
| `br sync --flush-only` | Export to JSONL |

---

## Dependencies

Issues can block other issues:

```bash
# bd-feat depends on bd-schema (feat is blocked until schema closes)
br dep add bd-feat bd-schema

br ready              # Shows bd-schema (bd-feat is blocked)
br close bd-schema
br ready              # Now shows bd-feat (unblocked)

br graph bd-feat      # Visualize dependencies
```

---

## JSON Output

Always use `--json` for programmatic access:

```bash
br ready --json | jq '.[0].id'
br list --json -t bug -p 0 | jq '.[] | select(.priority <= 1)'
```

Key fields: `id`, `title`, `status`, `priority`, `issue_type`, `assignee`, `dependency_count`

---

## Priority Levels

| Level | Use Case |
|-------|----------|
| P0 | Critical: production down, security |
| P1 | High: blocking release |
| P2 | Medium (default) |
| P3 | Low |
| P4 | Backlog |

---

## Creating Quality Tasks

When creating tasks from a plan, follow the **No-Stragglers Invariant**: closing ALL tasks must fully implement the plan.

**Sizing limits:**
- Target: 3-8 files, 1-2 subsystems per task
- Hard limits: ≤12 files, ≤3 subsystems, ≤3 AC

**TDD ordering:**
1. One `[integration-path-test]` task per feature (skeleton + failing e2e)
2. Implementation tasks depend on skeleton
3. No separate "run tests" tasks—final impl task verifies all pass

**Good AC:** "Given X, when Y, then Z" (observable behavior)
**Bad AC:** "Add 3 tests" or "80% coverage" (gameable proxies)

See [reference/task-quality.md](reference/task-quality.md) for full guidance.

---

## Common Patterns

**Session start:**
```bash
export BD_ACTOR="agent-$(date +%Y%m%d)"
br ready --json --limit 10
```

**Bulk close:**
```bash
br close bd-123 bd-456 --reason "Sprint complete"
```

---

## Reference

For detailed information, see:

- [reference/task-quality.md](reference/task-quality.md) — Creating high-quality tasks (sizing, TDD, AC)
- [reference/commands.md](reference/commands.md) — Full command reference
- [reference/filters.md](reference/filters.md) — List/ready filter options
- [reference/troubleshooting.md](reference/troubleshooting.md) — Common errors and fixes
