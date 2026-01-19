# br Command Reference

## Issue Lifecycle

| Command | Purpose |
|---------|---------|
| `br create "Title" [opts]` | Create issue |
| `br q "Title"` | Quick capture (outputs ID only) |
| `br show <id>` | View details |
| `br update <id> [opts]` | Modify issue |
| `br close <id> [<id>...] --reason "..."` | Close one or more issues |
| `br reopen <id>` | Reopen closed issue |
| `br delete <id>` | Soft delete (tombstone) |

## Create Options

```bash
br create "Title" \
  -t feature \              # task, bug, feature, epic, chore, docs, question
  -p 1 \                    # 0-4 (0=critical, 4=backlog)
  -d, --description "..." \ # Description text
  -a alice \                # Assignee
  -l "ui,frontend" \        # Labels (comma-separated)
  --parent bd-epic \        # Parent issue
  --deps "blocks:bd-x" \    # Dependencies (types: blocks, relates, discovered-from)
  -e 120 \                  # Estimate (minutes)
  --due "+3d" \             # Due date
  --defer "+1w" \           # Defer until
  --json
```

## Update Options

```bash
br update <id> \
  --claim \                 # Atomic: sets assignee + status=in_progress
  --unclaim \               # Remove assignee, set status=open
  -s, --status <STATUS> \   # open, in_progress, blocked, closed
  -a, --assignee <NAME> \   # Set assignee
  -p, --priority <N> \      # Set priority (0-4)
  -l, --labels <LABELS> \   # Set labels
  -d, --description "..." \ # Update description
  --json
```

## Close Options

```bash
br close <id> [<id>...] \
  --reason "..." \          # Required: close reason
  --suggest-next \          # Returns newly unblocked issues
  --json
```

## Querying

| Command | Purpose |
|---------|---------|
| `br ready` | Unblocked, not deferred |
| `br list` | List with filters |
| `br blocked` | Blocked by dependencies |
| `br search <term>` | Full-text search |
| `br stale` | Issues without recent updates |

## Dependencies

| Command | Purpose |
|---------|---------|
| `br dep add <issue> <depends-on>` | A depends on B |
| `br dep remove <issue> <depends-on>` | Remove dependency |
| `br dep list <issue>` | Show dependencies |
| `br dep tree <issue>` | Dependency tree |
| `br dep cycles` | Detect cycles |
| `br graph <issue>` | Visualize dependencies |
| `br graph --all` | All open issues |

## Organization

| Command | Purpose |
|---------|---------|
| `br label add <id> label1,label2` | Add labels |
| `br label list-all` | All labels with counts |
| `br epic status` | Epic progress |
| `br comments add <id> "text"` | Add comment |
| `br defer <id> --until "+7d"` | Defer issue |
| `br undefer <id>` | Make ready again |

## Sync

| Command | Purpose |
|---------|---------|
| `br sync --flush-only` | Export DB → JSONL |
| `br sync --import-only` | Import JSONL → DB |
| `br sync --status` | Check sync state |

**Safety:** br sync never runs git. You must:
```bash
br sync --flush-only
git add .beads/
git commit -m "Update issues"
```

## Configuration

| Command | Purpose |
|---------|---------|
| `br config --get key` | Read config |
| `br config --set key=value` | Write config |
| `br init --prefix proj` | Initialize workspace |

## Diagnostics

| Command | Purpose |
|---------|---------|
| `br stats` | Project statistics |
| `br doctor` | Diagnostic checks |
| `br info` | Workspace metadata |
| `br where` | Show .beads directory |

## Global Flags

| Flag | Purpose |
|------|---------|
| `--json` | JSON output |
| `--quiet` | Suppress non-errors |
| `--no-color` | Disable colors |
| `-v` / `-vv` | Verbose logging |
| `--actor <name>` | Override actor name |
| `--lock-timeout <ms>` | SQLite busy timeout in milliseconds |

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `BD_ACTOR` | Default actor for audit trail |
| `BEADS_DIR` | Override .beads location |
| `NO_COLOR` | Disable colored output |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 2 | Database error |
| 3 | Issue not found |
| 4 | Validation error |
| 5 | Dependency cycle |
| 6 | Sync error |
