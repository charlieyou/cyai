# Log Schema Reference

## Table of Contents
1. [Log Locations](#log-locations)
2. [Claude Session Log Schema](#claude-session-log-schema-jsonl)
3. [Mala Run Metadata Schema](#mala-run-metadata-schema-json)
4. [Common Search Patterns](#common-search-patterns)

## Log Locations

| Log Type | Location | Format |
|----------|----------|--------|
| Claude sessions (raw) | `~/.claude/projects/{encoded-path}/{session_id}.jsonl` | JSONL |
| Claude sessions (HTML) | `~/.claude/projects/{encoded-path}/session-{session_id}.html` | HTML |
| Mala runs | `~/.config/mala/runs/{encoded-path}/{timestamp}_{uuid}.json` | JSON |

Path encoding: `/home/user/repo` → `-home-user-repo`

## Claude Session Log Schema (JSONL)

Each line is a JSON object. Main fields:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Entry type: `user`, `assistant`, `queue-operation` |
| `sessionId` | string | Session UUID |
| `uuid` | string | Entry UUID |
| `parentUuid` | string | Parent entry UUID (conversation threading) |
| `timestamp` | string | ISO8601 timestamp |
| `cwd` | string | Working directory |
| `version` | string | Claude Code version (e.g., "2.0.72") |
| `gitBranch` | string | Current git branch |
| `isSidechain` | bool | Whether this is a sidechain message |
| `userType` | string | User type (e.g., "external") |
| `message` | object | The actual message content |

### Message Structure

```json
{
  "type": "assistant",
  "sessionId": "uuid",
  "uuid": "entry-uuid",
  "parentUuid": "parent-entry-uuid",
  "timestamp": "2025-12-28T07:23:53.572Z",
  "cwd": "/home/cyou/mala",
  "version": "2.0.72",
  "gitBranch": "main",
  "isSidechain": false,
  "message": {
    "role": "assistant",
    "content": [<blocks>]
  }
}
```

### Content Block Types

**Text:**
```json
{"type": "text", "text": "message content"}
```

**Tool use:**
```json
{
  "type": "tool_use",
  "id": "toolu_xxx",
  "name": "Bash",
  "input": {"command": "ls", "description": "List files"}
}
```

**Tool result:**
```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_xxx",
  "content": "output text",
  "is_error": false
}
```

### Tool Result Extended Fields

User entries with tool results include `toolUseResult`:

```json
{
  "type": "user",
  "message": {"role": "user", "content": [...]},
  "toolUseResult": {
    "stdout": "command output",
    "stderr": "",
    "interrupted": false,
    "isImage": false
  }
}
```

### Metadata Entries

```json
{"type": "queue-operation", "operation": "dequeue", "sessionId": "uuid", "timestamp": "..."}
```

## Mala Run Metadata Schema (JSON)

```json
{
  "run_id": "uuid",
  "started_at": "ISO8601",
  "completed_at": "ISO8601",
  "version": "0.1.0",
  "repo_path": "/path/to/repo",
  "config": {
    "max_agents": 2,
    "timeout_minutes": null,
    "max_issues": null,
    "epic_id": null,
    "braintrust_enabled": false,
    "max_gate_retries": 3,
    "max_review_retries": 5,
    "codex_review": true,
    "cli_args": {...}
  },
  "issues": {
    "issue-id": {
      "issue_id": "issue-id",
      "agent_id": "issue-id-shortuid",
      "status": "success|failed|timeout",
      "duration_seconds": 460.4,
      "session_id": "uuid",
      "log_path": "/path/to/session.jsonl",
      "error": null,
      "gate_attempts": 2,
      "review_attempts": 1,
      "quality_gate": {
        "passed": true,
        "evidence": {
          "pytest_ran": true,
          "ruff_check_ran": true,
          "ruff_format_ran": true,
          "ty_check_ran": true,
          "commit_found": true
        },
        "failure_reasons": []
      },
      "validation": {
        "passed": true,
        "commands_run": ["uv sync", "ruff format", "ruff check", "ty check", "pytest"],
        "commands_failed": [],
        "coverage_percent": 88.8,
        "e2e_passed": null,
        "artifacts": {
          "log_dir": "/tmp/mala-validation-logs-xxx",
          "worktree_path": "/tmp/.../worktrees/run-xxx/issue-id/1",
          "worktree_state": "removed|kept"
        }
      },
      "resolution": null,
      "codex_review_log_path": null
    }
  },
  "run_validation": {...}
}
```

## Common Search Patterns

### Find errors
```bash
grep '"is_error": true' session.jsonl
grep -E 'Exit code [1-9]' session.jsonl
```

### Find specific tools
```bash
grep '"name": "Bash"' session.jsonl
grep '"name": "Read"' session.jsonl
grep '"name": "Edit"' session.jsonl
```

### Find commits and git operations
```bash
grep -E 'git commit' session.jsonl
grep -E 'git (add|push|pull)' session.jsonl
```

### Find test runs
```bash
grep -E 'pytest|uv run pytest' session.jsonl
```

### Extract with jq
```bash
# Tool frequency count
jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | .name' session.jsonl | sort | uniq -c | sort -rn

# Failed tool results
jq -c 'select(.message.content) | .message.content[]? | select(.type=="tool_result" and .is_error==true)' session.jsonl
```
