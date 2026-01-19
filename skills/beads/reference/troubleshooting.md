# br Troubleshooting

## "Database not initialized"

```bash
br init
```

## "Issue not found"

```bash
br list --json | jq '.[].id'  # Find correct ID
br show abc                    # Partial ID match works
```

## "Database locked"

```bash
br list --lock-timeout 10000   # Increase timeout (ms)
```

## "Cycle detected"

```bash
br dep cycles --json           # Find cycles
br dep remove bd-a bd-b        # Break cycle
```

## Sync conflicts after git merge

```bash
# Check for JSONL conflicts
git status .beads/

# Resolve manually, then:
br sync --import-only
```

## Stale database warning

```bash
br sync --status               # Check sync state
br sync --import-only          # Import remote changes
```

## JSON output garbled

```bash
br list --no-color --json      # Disable colors
br list --json 2>/dev/null     # Suppress stderr
```

## Debug logging

```bash
RUST_LOG=debug br ready --json 2>debug.log
br sync --flush-only -vv       # Verbose mode
```
