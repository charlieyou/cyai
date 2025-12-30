# AI Configs

Shared skills, commands, and prompts for Claude Code.

## Setup

Run the linking script to symlink components to the appropriate directories:

```bash
./link-all.sh
```

This creates symlinks in:
- `~/.claude/skills/` for skills
- `~/.claude/commands/` for commands
- `~/.local/bin/` for wrapper scripts

The script is idempotent and can be run multiple times safely.

## Bin Scripts

### `claude` wrapper

A wrapper around the claude CLI that adds MCP server toggle flags:

```bash
claude              # Normal (uses settings.json)
claude +mail        # Enable mail MCP server
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
| `databricks-bundle` | Manage Databricks Asset Bundles (DABs) for infrastructure as code |
| `databricks-jobs` | Manage Databricks Jobs via CLI (create, run, monitor, delete jobs) |
| `databricks-sql` | Execute SQL queries against Databricks SQL Warehouses |
| `databricks-unity-catalog` | Manage Unity Catalog via Databricks CLI (catalogs, schemas, tables, volumes) |
| `grimp-architecture` | Explore Python import graphs and enforce layered architecture using grimp |
| `mala-logs` | Search and analyze mala orchestrator and Claude session logs |
| `pyspark-style` | PySpark code style and best practices for DataFrame API |

## Commands

| Command | Description |
|---------|-------------|
| `bd-breakdown` | Convert a review or feature plan into small, parallelizable Beads issues |
| `diary` | Create a structured diary entry from the current session |
| `reflect` | Analyze diary entries to identify patterns and propose AGENTS.md updates |

## Prompts

The `prompts/reviewers/` directory contains type-specific review prompt templates used by the [Cerberus plugin](https://github.com/your-org/cerberus) for multi-model code reviews.
