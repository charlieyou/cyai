# br List & Ready Filters

## br list Filters

```bash
br list \
  -s open -s in_progress \  # Status (repeatable)
  -t bug -t task \          # Type (repeatable)
  -p 0 -p 1 \               # Priority (repeatable)
  --priority-max 2 \        # Priority ceiling
  --assignee alice \        # Assigned to
  --unassigned \            # No assignee
  -l critical \             # Has label (AND logic)
  --label-any "ui,api" \    # Has any label (OR logic)
  --title-contains "auth" \ # Title substring
  --overdue \               # Past due date
  -a \                      # Include closed
  --deferred \              # Include deferred
  --limit 20 \              # Max results (0=unlimited)
  --sort priority \         # Sort: priority, created_at, updated_at, title
  -r \                      # Reverse sort
  --json
```

## br ready Filters

```bash
br ready \
  --limit 10 \              # Max results (default: 20)
  --assignee alice \        # Assigned to
  --unassigned \            # No assignee
  -l critical \             # Has label
  -t bug \                  # Type filter
  -p 0 -p 1 \               # Priority filter
  --sort hybrid \           # hybrid (default), priority, oldest
  --include-deferred \      # Include deferred
  --json
```

## Status Values

- `open` — Not started
- `in_progress` — Being worked on
- `blocked` — Waiting on dependencies
- `closed` — Complete

## Issue Types

- `task` — General work item
- `bug` — Defect to fix
- `feature` — New capability
- `epic` — Parent issue grouping work
- `chore` — Maintenance
- `docs` — Documentation
- `question` — Needs clarification

## Sort Options

| Sort | Description |
|------|-------------|
| `hybrid` | P0/P1 first by created_at, then others |
| `priority` | Priority ASC, then created_at |
| `oldest` | created_at ASC only |

## Output Formats

```bash
br list --format text      # Human-readable (default)
br list --format json      # JSON array
br list --format csv       # CSV with configurable fields
br list --fields id,title,priority --format csv
```
