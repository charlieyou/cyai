# AI Configs

Shared skills and commands for Claude Code and Codex CLI.

## Setup

Run the linking script to symlink skills and commands to the appropriate directories:

```bash
./link-all.sh
```

This creates symlinks in:
- `~/.claude/skills/` and `~/.codex/skills/` for skills
- `~/.claude/commands/` and `~/.codex/prompts/` for commands

The script is idempotent and can be run multiple times safely.

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
