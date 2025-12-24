# Hooks for Beads Parallel Workflow

Claude Code hooks can automate coordination and cleanup in the beads multi-agent workflow.

## Hook Opportunities

| Hook | Use Case | Priority |
|------|----------|----------|
| **SubagentStop** | Auto-release file reservations on completion | High |
| **PreToolUse** | Enforce file locking before Edit/Write | High |
| **Stop** | Prevent orchestrator from stopping prematurely | Medium |
| **SessionStart** | Auto-setup Agent Mail registration | Low |
| **PostToolUse** | Remind subagents to check inbox | Low |

---

## 1. SubagentStop - Automatic Cleanup

**Problem solved:** Orphaned file reservations when subagents crash, timeout, or forget to release.

**When it fires:** After any `bd-implementer` subagent completes (success or failure).

**What the hook does:**
1. Parse subagent result to get agent_name and issue_id
2. Call `release_file_reservations` for that agent
3. Check if issue was closed; if not, reset to `ready`
4. Log metrics (duration, outcome)

**Impact:** Eliminates need for subagents to explicitly release reservations. Cleanup becomes automatic and reliable.

```json
{
  "hooks": {
    "SubagentStop": [
      {
        "matcher": "bd-implementer",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.config/claude/hooks/subagent-cleanup.py",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

**Hook script logic:**
```python
# subagent-cleanup.py (pseudocode)
input = json.load(sys.stdin)

# Extract agent identity from subagent's transcript
agent_name = extract_agent_name(input["transcript_path"])
issue_id = extract_issue_id(input)

# Always release reservations
mcp_call("release_file_reservations", agent_name=agent_name)

# Check if issue was closed
if not issue_closed(issue_id):
    run(f"bd update {issue_id} --status ready")
    log(f"Reset {issue_id} - subagent did not complete")

# Return decision
print(json.dumps({
    "decision": "approve",
    "reason": f"Cleaned up {agent_name}, issue {issue_id}"
}))
```

---

## 2. PreToolUse on Edit/Write - Enforce File Locking

**Problem solved:** Subagents editing files without reservations, causing conflicts.

**When it fires:** Before any Edit or Write tool executes.

**What the hook does:**
1. Get the file path from tool input
2. Query Agent Mail: does this agent hold a reservation for this path?
3. If no reservation → block with exit code 2
4. If reserved → allow

**Impact:** Makes file locking mandatory rather than advisory. Prevents accidental conflicts.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.config/claude/hooks/check-reservation.py",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

**Hook script logic:**
```python
# check-reservation.py (pseudocode)
input = json.load(sys.stdin)
file_path = input["tool_input"].get("file_path", "")

# Get agent's current reservations
reservations = mcp_call("list_reservations", agent_name=CURRENT_AGENT)

# Check if file is covered by any reservation
if not any(matches(file_path, r["pattern"]) for r in reservations):
    print(f"ERROR: No reservation for {file_path}", file=sys.stderr)
    print("Reserve the file first with file_reservation_paths()", file=sys.stderr)
    sys.exit(2)  # Block the edit

sys.exit(0)  # Allow
```

---

## 3. Stop Hook - Orchestrator Completion Check

**Problem solved:** Orchestrator stopping while subagents are still running.

**When it fires:** When `/bd-parallel` orchestrator tries to stop.

**What the hook does:**
1. Check if any background subagents are still running
2. Check if any issues are still in `in_progress` status
3. If work remains → block and force continue
4. If all done → allow stop

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.config/claude/hooks/orchestrator-stop.py",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

**Hook script logic:**
```python
# orchestrator-stop.py (pseudocode)
input = json.load(sys.stdin)

# Check for running subagents (parse transcript for active task_ids)
running = get_running_subagents(input["transcript_path"])

# Check beads status
in_progress = run("bd list --status in_progress --json")

if running or in_progress:
    print(json.dumps({
        "decision": "block",
        "reason": f"Still {len(running)} subagents running, {len(in_progress)} issues in progress. Continue monitoring."
    }))
else:
    print(json.dumps({
        "decision": "approve",
        "reason": "All work complete"
    }))
```

---

## 4. SessionStart - Auto-Setup

**Problem solved:** Manual Agent Mail registration at session start.

**When it fires:** When Claude Code session starts.

**What the hook does:**
1. Detect if this is a beads-enabled project (check for `.beads/` or `bd` command)
2. Inject repo path and setup instructions into context
3. Optionally set environment variables

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.config/claude/hooks/beads-setup.py",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

**Hook script output (added to context):**
```
Project path: /home/user/myproject
Agent Mail project_key: /home/user/myproject
To register: mcp__mcp-agent-mail__register_agent(project_key="/home/user/myproject", ...)
```

---

## 5. PostToolUse - Inbox Reminders

**Problem solved:** Subagents forgetting to check inbox during long implementations.

**When it fires:** After tool calls during implementation.

**What the hook does:**
1. Count tool calls since last inbox check
2. If > 10 calls → inject reminder as feedback to Claude
3. Reset counter after reminder

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.config/claude/hooks/inbox-reminder.py",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

---

## 6. PreToolUse on Bash - Validate bd close

**Problem solved:** Subagents closing issues without completing the work.

**When it fires:** Before `bd close` command executes.

**What the hook does:**
1. Check git status for uncommitted changes
2. Check if file reservations are still held
3. Block close if work appears incomplete

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.config/claude/hooks/validate-close.py",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

**Hook script logic:**
```python
# validate-close.py (pseudocode)
input = json.load(sys.stdin)
command = input["tool_input"].get("command", "")

if "bd close" not in command:
    sys.exit(0)  # Not relevant

# Check for uncommitted changes
status = run("git status --porcelain")
if status.strip():
    print("ERROR: Uncommitted changes exist. Commit before closing.", file=sys.stderr)
    sys.exit(2)

# Check reservations released
reservations = mcp_call("list_reservations", agent_name=CURRENT_AGENT)
if reservations:
    print("WARNING: File reservations still held. Release them first.", file=sys.stderr)
    # Could block (exit 2) or just warn (exit 0)

sys.exit(0)
```

---

## Implementation Priority

1. **SubagentStop cleanup** - Biggest impact, solves orphaned reservations
2. **PreToolUse file lock enforcement** - Prevents conflicts at source
3. **Stop hook for orchestrator** - Ensures completion
4. **Others** - Nice to have, lower priority

---

## Configuration Location

Hooks are configured in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SubagentStop": [...],
    "PreToolUse": [...],
    "Stop": [...]
  }
}
```

Or per-project in `.claude/settings.json`.

---

## TODO

- [ ] Implement SubagentStop cleanup hook
- [ ] Implement PreToolUse file lock enforcement
- [ ] Test hook reliability under various failure modes
- [ ] Document hook script dependencies (mcp client, etc.)
