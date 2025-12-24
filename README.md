# AI Configs

Shared skills, commands, and agents for Claude Code and Codex CLI.

## Setup

Run the linking script to symlink skills and commands to the appropriate directories:

```bash
./link-all.sh
```

This creates symlinks in:
- `~/.claude/skills/` and `~/.codex/skills/` for skills
- `~/.claude/commands/` and `~/.codex/prompts/` for commands
- `~/.claude/agents/` for subagents
- `~/.local/bin/` for wrapper scripts

The script is idempotent and can be run multiple times safely.

## Bin Scripts

### `claude` wrapper

A wrapper around the claude CLI that adds MCP server toggle flags:

```bash
claude              # Normal (uses settings.json)
claude +mail        # Enable agent-mail MCP server
claude +mail +foo   # Enable multiple servers
clauded +mail       # Composable with --dangerously-skip-permissions
```

**Setup:**

Create `~/.claude/mcp-servers.sh` with your server definitions (not committed):

```bash
# MCP Server definitions - DO NOT COMMIT (contains secrets)

declare -A SERVERS=(
  ["mail"]='{"type":"http","url":"http://127.0.0.1:8765/mcp/","headers":{"Authorization":"Bearer YOUR_TOKEN"}}'
  ["github"]='{"command":"gh-mcp"}'
)

# Servers enabled by default (empty = none)
DEFAULT_ENABLED=()
```

**Behavior:**
- No toggle flags → runs real claude with settings.json (normal behavior)
- With toggle flags → uses `--strict-mcp-config` (only specified servers, ignores settings.json)
- No config file → wrapper passes through to real claude (toggle flags ignored)

## Skills

| Skill | Description |
|-------|-------------|
| `databricks-jobs` | Manage Databricks Jobs via CLI (create, run, monitor, delete jobs) |

## Commands

| Command | Description |
|---------|-------------|
| `diary` | Create a structured diary entry from the current session |
| `healthcheck` | Perform a comprehensive code health review of a codebase |
| `reflect` | Analyze diary entries to identify patterns and propose AGENTS.md updates |

## bd-parallel

Python orchestrator for parallel beads issue processing using the Claude Agent SDK.
See [bd-parallel/README.md](bd-parallel/README.md) for details.

