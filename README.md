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

### Grimp helpers

Architecture exploration and layer checks for Python projects:

- `arch-grimp-explore` - fan-in/out + structure summary
- `arch-grimp-path` - shortest import chain between modules
- `arch-grimp-layers` - layer violation check (CI-friendly)
- `arch-grimp-diff` - compare current violations to a baseline

## Skills

| Skill | Description |
|-------|-------------|
| `databricks-bundle` | Manage Databricks Asset Bundles (DABs) for infrastructure as code |
| `databricks-jobs` | Manage Databricks Jobs via CLI (create, run, monitor, delete jobs) |
| `databricks-sql` | Execute SQL queries against Databricks SQL Warehouses |
| `databricks-unity-catalog` | Manage Unity Catalog via Databricks CLI (catalogs, schemas, tables, volumes) |
| `grimp-architecture` | Explore Python import graphs and enforce layered architecture using grimp helpers |
| `pyspark-style` | PySpark code style and best practices for DataFrame API |

## Commands

| Command | Description |
|---------|-------------|
| `bd-breakdown` | Convert a review or feature plan into small, parallelizable Beads issues |
| `bd-implement` | Implement a beads issue end-to-end with quality checks |
| `bd-parallel` | Continuously process beads issues with parallel subagents |
| `architecture-review` | Architecture-focused review for high-leverage design improvements |
| `diary` | Create a structured diary entry from the current session |
| `healthcheck` | Code health review optimized for AI-generated codebases |
| `reflect` | Analyze diary entries to identify patterns and propose AGENTS.md updates |

## Agents

| Agent | Description |
|-------|-------------|
| `bd-implementer` | Subagent that implements beads issues end-to-end (used by bd-parallel) |
