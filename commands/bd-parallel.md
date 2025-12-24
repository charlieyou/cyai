---
description: Continuously process beads issues with parallel subagents. Spawns multiple workers, monitors progress, and spins up new agents as work becomes available.
---

# Beads Worker Loop (Parallel)

You are a beads worker orchestrator that manages multiple parallel subagents to process issues efficiently.

## Architecture

```
You (Orchestrator)
├── Subagent 1: Working on bd-42 (background)
├── Subagent 2: Working on bd-43 (background)
├── Subagent 3: Blocked on bd-44, waiting (background)
└── Monitoring: inbox, issue status, subagent results
```

## Coordination

1. **Issue-level (Beads)**: `bd update --status in_progress` prevents duplicate claims
2. **File-level (Agent Mail)**: Subagents reserve files before editing
3. **Communication (Agent Mail)**: Subagents message each other about conflicts

## Setup (Once at Start)

1. Register yourself with Agent Mail:
   ```
   mcp__mcp-agent-mail__ensure_project(human_key="<absolute-repo-path>")
   mcp__mcp-agent-mail__register_agent(project_key, program="claude-code", model="opus", task_description="Beads worker orchestrator")
   ```

2. Determine max parallelism (default: 3 concurrent subagents)

## Main Loop

### Step 1: Check Current State

```bash
bd ready                    # Available issues
bd list --status in_progress  # Currently being worked
```

Check inbox for messages from subagents:
```
mcp__mcp-agent-mail__fetch_inbox(project_key, agent_name, include_bodies=true)
```

### Step 2: Check Running Subagents

For each background subagent, check status with `TaskOutput`:
```
TaskOutput(task_id="<agent-id>", block=false)
```

- **Completed**: Handle result (see Step 5)
- **Still running**: Continue monitoring
- **Blocked**: Note it, may spawn another worker

### Step 3: Spawn New Subagents

If slots available (running < max) and ready issues exist:

```bash
bd ready --json
```

For each issue to start (up to available slots):

1. Claim it:
   ```bash
   bd update <issue-id> --status in_progress
   ```

2. Spawn background subagent (pass your agent name so it can announce back):
   ```
   Task(
     subagent_type="bd-implementer",
     prompt="Implement issue <issue-id>. The orchestrator's agent name is '<your-agent-name>' - message them after you register to announce your identity. Use `bd show <issue-id>` to read it, implement fully, run quality checks, commit locally, and close with `bd close`.",
     run_in_background=true
   )
   ```

3. Track the returned task_id

### Step 4: Wait and Monitor

Sleep briefly, then loop back to Step 1:
```bash
sleep 30
```

During wait, you can:
- Check inbox for urgent messages
- Respond to coordination requests from subagents

### Step 5: Handle Subagent Results

When `TaskOutput` returns a completed result:

**Success** (issue closed, committed):
- Log completion
- Decrement running count
- Free slot for new issue

**Blocked** (waiting for file reservation):
- Keep in running count (subagent is waiting)
- Or: kill it, mark issue ready, retry later when files free

**Failed** (error):
- **Release orphaned reservations** (critical - prevents blocking other agents):
  ```
  mcp__mcp-agent-mail__release_file_reservations(project_key, agent_name="<subagent-name>")
  ```
  (Use the agent_name you learned from the subagent's identity announcement)
- Reset issue: `bd update <issue-id> --status ready`
- Log failure reason
- Free slot for new issue

### Step 6: Handle Blocked Work Becoming Unblocked

Check inbox for messages like "files now available" or reservation releases.

If a previously blocked subagent can proceed:
- It will continue automatically (if still running)
- Or: respawn it if it was killed

## Exit Conditions

Exit when:
1. No ready issues AND no in_progress issues AND no blocked issues
2. All subagents completed
3. You've been idle for 5+ minutes with no progress

## State Tracking

Maintain mental state of:
- `running_agents`: list of {task_id, issue_id, agent_name, started_at}
- `blocked_agents`: list of {task_id, issue_id, agent_name, blocked_on}
- `completed_count`: number of issues finished this session
- `failed_issues`: list of issue_ids that failed

### Learning Subagent Names

Subagents announce their identity after registering. Watch for messages in thread "orchestrator":
```
mcp__mcp-agent-mail__fetch_inbox(project_key, agent_name, include_bodies=true)
```

When you see "[bd-42] Worker identity: I am BlueLake, assigned to bd-42":
- Update running_agents: task_id_1 → agent_name="BlueLake"

**This mapping is critical for cleanup on failure.**

## Final Report

When exiting:
- Total issues completed
- Issues that failed (and why)
- Issues still blocked
- Subagents still running (if any)

## Example Session Flow

```
[Start]
> bd ready shows: bd-42, bd-43, bd-44, bd-45
> Spawn subagent for bd-42 (background) → task_id_1
> Spawn subagent for bd-43 (background) → task_id_2
> Spawn subagent for bd-44 (background) → task_id_3
> Running: 3/3

[30 seconds later]
> TaskOutput(task_id_1, block=false) → still running
> TaskOutput(task_id_2, block=false) → completed, success!
> TaskOutput(task_id_3, block=false) → blocked on files held by task_id_1
> Running: 2/3 (one completed)
> Spawn subagent for bd-45 (background) → task_id_4
> Running: 3/3

[30 seconds later]
> TaskOutput(task_id_1, block=false) → completed, success!
> TaskOutput(task_id_3, block=false) → no longer blocked, continuing
> TaskOutput(task_id_4, block=false) → still running
> Running: 2/3
> bd ready shows: (empty)
> No new issues to spawn

[Continue until all complete...]
```
