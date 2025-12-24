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
| `bd-parallel` | Orchestrate parallel beads issue processing (see below) |

## Agents

| Agent | Description |
|-------|-------------|
| `bd-implementer` | Implements a single beads issue end-to-end with quality checks |

---

## Beads Parallel Workflow

A multi-agent system for processing beads issues in parallel.

### Architecture

```
/bd-parallel (Orchestrator Command)
├── bd-implementer subagent → bd-42 (background)
├── bd-implementer subagent → bd-43 (background)
├── bd-implementer subagent → bd-44 (background)
└── Monitors completion, spawns new workers as slots free up
```

### Coordination Layers

| Layer | Tool | Purpose |
|-------|------|---------|
| Issue-level | Beads (`bd`) | Prevents duplicate claims via status updates |
| File-level | Agent Mail | File reservations prevent edit conflicts |
| Communication | Agent Mail | Agents message each other about conflicts |

### How It Works

1. **Orchestrator (`/bd-parallel`)** registers with Agent Mail, spawns up to 3 parallel subagents
2. **Subagents (`bd-implementer`)** each:
   - Register with Agent Mail (get unique name like "BlueLake")
   - Announce identity to orchestrator
   - Reserve files before editing (15 min TTL, renewable)
   - Implement the issue, run quality checks, commit
   - Release reservations, close issue
3. **On file conflict**: Subagent messages the holder asking timeline, waits for response
4. **On failure**: Orchestrator releases orphaned reservations, resets issue status

### Usage

```bash
# Run the parallel worker
/bd-parallel

# Or implement a single issue directly
claude --agent bd-implementer --prompt "Implement bd-42"
```

### Key Design Decisions

- **15-minute TTL** for file reservations (fast recovery from failures)
- **Renewal every 10 minutes** for long-running tasks
- **Subagents check inbox every 5-10 tool calls** (responsive to coordination)
- **Parent claims issues before spawning** (subagents don't claim)
- **Subagents announce identity** so parent can clean up on failure

---

## Hooks

See [docs/beads-hooks.md](docs/beads-hooks.md) for how Claude Code hooks can automate:
- File reservation cleanup on subagent completion
- Mandatory file locking enforcement
- Orchestrator completion checks
- Inbox reminders

---

## TODOs

### Context Exhaustion Handling
When subagents run out of context mid-implementation:
- [ ] Detect context exhaustion (subagent returns incomplete)
- [ ] Save progress state (files modified, reservations held)
- [ ] Spawn continuation agent with summary of prior work
- [ ] Or: commit partial progress, mark issue as needs-continuation

### Deterministic Orchestration with Agent SDK
The orchestrator loop is entirely deterministic - consider replacing with Python:
- [ ] Prototype Python orchestrator using Anthropic SDK
- [ ] Compare token cost (zero orchestration tokens vs current)
- [ ] Test reliability of subprocess spawning vs background tasks
- [ ] Evaluate parallelism (asyncio.gather vs sequential)

### Hooks Implementation
- [ ] SubagentStop cleanup hook (auto-release reservations)
- [ ] PreToolUse file lock enforcement
- [ ] Stop hook for orchestrator completion check
- [ ] Test hook reliability under failure modes

### Other Improvements
- [ ] Deadlock detection (two agents waiting on each other)
- [ ] Metrics/logging for multi-agent sessions
- [ ] Graceful shutdown (message all subagents to wrap up)
- [ ] Refine beads agent setup to not require `--dangerously-skip-permissions` (allowlist specific tools/paths)
