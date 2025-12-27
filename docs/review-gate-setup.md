# Review Gate Setup

The multi-model review gate provides automated code review using multiple AI models. This guide covers the required configuration.

## Prerequisites

1. Run `./link-all.sh` to install the review-gate scripts to `~/.local/bin/`
2. Ensure `~/.local/bin` is in your PATH

## Hook Configuration

Add the following Stop hook to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [{
          "type": "command",
          "command": "~/.local/bin/review-gate-check",
          "timeout": 60
        }]
      }
    ]
  }
}
```

### Merging with Existing Configuration

If you already have a `hooks` key in your settings.json, add the Stop array to it:

```json
{
  "hooks": {
    "ExistingHook": [...],
    "Stop": [
      {
        "hooks": [{
          "type": "command",
          "command": "~/.local/bin/review-gate-check",
          "timeout": 60
        }]
      }
    ]
  }
}
```

## Verification

After adding the configuration:

1. Start a new Claude Code session
2. Run `/healthcheck` to generate a review artifact
3. Verify the review gate triggers when Claude stops
4. Confirm the PROCEED/REVISE/ABORT flow works correctly

## Timeout

The 60-second timeout is sufficient for the check script to:
- Detect review artifacts
- Spawn reviewer processes (if needed)
- Check reviewer progress
- Present results

If you experience timeouts with slow network connections, you can increase this value.

## Scripts

The review gate system uses these scripts in `~/.local/bin/`:

| Script | Purpose |
|--------|---------|
| `review-gate-check` | Stop hook that manages the review gate lifecycle |
| `review-gate-spawn` | Spawns reviewer processes for each model |
| `review-gate-resolve` | Resolves the gate with proceed/revise/abort |
