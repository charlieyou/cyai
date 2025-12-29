---
name: mala-logs
description: Search and analyze mala orchestrator and Claude session logs. Use when searching for session logs, debugging agent runs, finding tool errors, analyzing mala run history, or investigating issue-specific logs. Triggers on queries like "find logs for issue X", "what went wrong in the last run", "show tool errors", "list recent sessions".
---

# Mala & Claude Log Analysis

## Quick Reference

| Log Type | Location | Format |
|----------|----------|--------|
| Claude sessions | `~/.claude/projects/{encoded-path}/*.jsonl` | JSONL (raw) |
| Claude sessions | `~/.claude/projects/{encoded-path}/*.html` | HTML (rendered) |
| Mala runs | `~/.config/mala/runs/{encoded-path}/*.json` | JSON |

Path encoding: `/home/user/repo` → `-home-user-repo`

Note: `.jsonl` files contain raw conversation data for programmatic analysis. `.html` files are rendered views for human reading.

## Helper Scripts

Scripts are in this skill's `scripts/` directory. Run with full path or from skill dir.

### find-logs.py

```bash
# List recent sessions for current repo
python find-logs.py sessions --repo /path/to/repo --recent 10

# List mala run metadata
python find-logs.py runs --repo . --recent 5

# Find session by ID
python find-logs.py session <session-uuid> --repo .

# Find all logs for an issue (via run metadata)
python find-logs.py issue <issue-id> --repo .

# Search pattern in recent logs (regex)
python find-logs.py search "pytest.*failed" --repo . --recent 5
```

### parse-session.py

```bash
# Summary (entry count, tool frequency, error count)
python parse-session.py /path/to/session.jsonl --summary

# List all tool uses with inputs
python parse-session.py session.jsonl --tools

# Filter to specific tool (case-insensitive)
python parse-session.py session.jsonl --tools --filter Bash

# Limit results
python parse-session.py session.jsonl --tools --filter Bash --limit 5

# Show errors only
python parse-session.py session.jsonl --errors

# Show assistant text responses
python parse-session.py session.jsonl --text
```

## Direct CLI Patterns

### Quick log discovery

```bash
# Recent sessions (sorted by modification time)
ls -lt ~/.claude/projects/-home-cyou-mala/*.jsonl | head -10

# Open HTML view of a session
xdg-open ~/.claude/projects/-home-cyou-mala/session-*.html
```

### Search within logs

```bash
# Find tool errors
grep '"is_error": true' session.jsonl

# Find specific tool
grep '"name": "Bash"' session.jsonl

# Find failed commands
grep -E 'Exit code [1-9]' session.jsonl

# Find commits
grep -E 'git commit' session.jsonl
```

### Parse with jq

```bash
# Extract tool names and inputs
jq -c 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | {name, input}' session.jsonl

# Extract errors with context
jq -c 'select(.message.content) | .message.content[]? | select(.type=="tool_result" and .is_error==true) | {tool_use_id, content}' session.jsonl
```

## Issue → Log Path Workflow

```bash
# 1. Find run containing the issue
python find-logs.py issue mala-51q.1 --repo .
# Returns: session_id, log_path, status, duration

# 2. Parse the session
python parse-session.py /path/from/step1.jsonl --summary

# 3. Investigate errors
python parse-session.py /path/from/step1.jsonl --errors
```

See [references/log-schema.md](references/log-schema.md) for complete schema documentation.
