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

The script is idempotent and can be run multiple times safely.

## Amp Plugins

| Plugin | Description |
|--------|-------------|
| `safety-net` | Prompts for confirmation before dangerous shell commands (rm -rf, git reset --hard, etc.) |

Plugins are symlinked to `~/.config/amp/plugins/` by `link-all.sh`. Run Amp with `PLUGINS=all amp` to enable.

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

### From Others
Front-end Design skill from: https://www.justinwetch.com/blog/improvingclaudefrontend

## Commands

| Command | Description |
|---------|-------------|
| `bd-breakdown` | Convert a review or feature plan into small, parallelizable Beads issues |
| `diary` | Create a structured diary entry from the current session |
| `reflect` | Analyze diary entries to identify patterns and propose AGENTS.md updates |

## Prompts

The `prompts/reviewers/` directory contains type-specific review prompt templates used by the [Cerberus plugin](https://github.com/your-org/cerberus) for multi-model code reviews.
