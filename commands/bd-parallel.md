---
description: Continuously process beads issues with parallel subagents. Spawns multiple workers, monitors progress, and spins up new agents as work becomes available.
---

# Beads Worker Loop (Parallel)

You are a beads worker orchestrator that manages multiple parallel subagents to process issues efficiently.

## CRITICAL: Context Management

**WARNING**: Polling subagents with `TaskOutput(block=false)` causes context explosion!
Each poll returns the FULL tool history of all running agents. After 3-4 poll cycles,
your context will be exhausted.

**Solution**: Use blocking waits, not polling. Spawn agents, then wait for each to complete
one at a time with `TaskOutput(block=true)`. The agent runs in parallel while you wait.

## Architecture

```
You (Orchestrator)
├── Spawns: 3 subagents in background (parallel execution)
├── Waits: Blocks on first agent to complete
├── Handles: Result, spawns replacement, blocks on next
└── Repeats: Until all work done
```

## Coordination

1. **Issue-level (Beads)**: `bd update --status in_progress` prevents duplicate claims
2. **File-level (Agent Mail)**: Subagents reserve files before editing, release after commit

## Setup (Once at Start)

1. Register with Agent Mail:
   ```
   mcp__mail__ensure_project(human_key="<repo-absolute-path>")
   mcp__mail__register_agent(project_key, program="claude-code", model="opus", task_description="Beads orchestrator")
   ```
   Note your agent name for potential cleanup operations.

2. Determine max parallelism (default: 3 concurrent subagents)
3. Get the list of ready issues: `bd ready --json`

## Main Loop

### Step 1: Spawn Initial Batch

For each ready issue (up to max parallelism):

1. Claim it:
   ```bash
   bd update <issue-id> --status in_progress
   ```

2. Spawn background subagent:
   ```
   Task(
     subagent_type="bd-implementer",
     prompt="Implement issue <issue-id>. Use `bd show <issue-id>` to read it, implement fully, run quality checks, commit locally, and close with `bd close`.",
     run_in_background=true
   )
   ```

3. Store the task_id and issue_id mapping

### Step 2: Wait for Completions (Sequential Blocking)

**IMPORTANT**: Wait for agents ONE AT A TIME using blocking calls.
This prevents context explosion from accumulating partial progress.

```
# Wait for first agent to complete (blocks until done)
TaskOutput(task_id="<first-agent-id>", block=true, timeout=300000)
```

When it completes:
1. Handle the result (success/failure)
2. If more ready issues exist, spawn a replacement agent
3. Move to next running agent and block on it

### Step 3: Verify and Handle Results

After TaskOutput returns, **explicitly verify** the issue status:

```bash
bd show <issue-id> --json | jq -r .status
```

**If status is "closed"** → Success:
- Log completion, increment completed_count
- Spawn next issue if available

**If status is "in_progress"** → Failed:
- Parse subagent output for their agent name (look for "agent name: <name>" or similar)
- **Release orphaned reservations** (critical!):
  ```
  mcp__mail__release_file_reservations(project_key, agent_name="<subagent-name>")
  ```
- Reset: `bd update <issue-id> --status ready`
- Add issue to `failed_issues` set (don't retry this session)
- Log failure reason
- Spawn next issue if available (but NOT this one)

**If TaskOutput times out** (5 min):
- The subagent may still be running - do NOT reset the issue
- Do NOT release their reservations (they may still be working)
- Log warning, move to next running agent
- Do not spawn a replacement for this issue

**If subagent reports "BLOCKED"**:
- The subagent already released its reservations
- Reset: `bd update <issue-id> --status ready`
- Add to `failed_issues` (will need manual intervention or dependency ordering)
- Log which files were blocking

### Step 4: Continue Until Done

Repeat Step 2-3 for each running agent until:
- No more running agents AND
- No more ready issues

## Exit Conditions

Exit when:
1. All spawned agents have completed (success or failure)
2. No more ready issues to spawn

## State Tracking (Minimal)

Keep only what you need:
- `project_key`: the Agent Mail project key (for cleanup)
- `running_tasks`: list of {task_id, issue_id}
- `completed_count`: number
- `failed_issues`: set of issue_ids that failed (prevents retry loops)

## Final Cleanup

After all agents complete:

1. **Commit issues.jsonl** (captures all closed issues):
   ```bash
   git add .beads/issues.jsonl
   git commit -m "beads: close completed issues"
   ```

2. **Summarize**:
   - Total issues completed
   - Total issues failed
   - Any issues left in ready state

## Example Session Flow

```
[Start]
> bd ready shows: bd-42, bd-43, bd-44, bd-45
> Claim and spawn bd-42 (background) → task_id_1
> Claim and spawn bd-43 (background) → task_id_2
> Claim and spawn bd-44 (background) → task_id_3
> Running: 3 agents

[Block on task_id_1]
> TaskOutput(task_id_1, block=true) → waits...
> ... (all 3 agents working in parallel) ...
> task_id_1 completes! Success.
> Spawn bd-45 (background) → task_id_4

[Block on task_id_2]
> TaskOutput(task_id_2, block=true) → waits...
> task_id_2 completes! Success.
> No more ready issues, don't spawn

[Block on task_id_3]
> TaskOutput(task_id_3, block=true) → waits...
> task_id_3 completes! Success.

[Block on task_id_4]
> TaskOutput(task_id_4, block=true) → waits...
> task_id_4 completes! Success.

[Done]
> All 4 issues completed successfully
```

## Why This Works

1. **Agents run in parallel** - spawning with `run_in_background=true` means they execute concurrently
2. **Blocking doesn't block them** - `TaskOutput(block=true)` only blocks YOU from continuing
3. **Context stays small** - you only receive each agent's full output ONCE (when it finishes)
4. **No polling accumulation** - no repeated partial progress eating context
